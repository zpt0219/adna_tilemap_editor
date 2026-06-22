import React, { useState, useEffect, useRef, useMemo } from "react";
import { processImage, ProcessResult, ProcessOptions } from "./core/processor";
import { upscaleNearest } from "./core/ops";
// Config is referenced internally by the core processor
import { RawImage, RGB } from "./shared/types";
import { imageToRawImage, drawRawImageToCanvas, drawGridToCanvas } from "./utils/io";
import { zipSync } from "fflate";

// Utility helpers for colors
function hexToRgb(hex: string): RGB {
  const cleanHex = hex.replace(/^#/, "");
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(rgb: RGB): string {
  const r = Math.max(0, Math.min(255, rgb.r)).toString(16).padStart(2, "0");
  const g = Math.max(0, Math.min(255, rgb.g)).toString(16).padStart(2, "0");
  const b = Math.max(0, Math.min(255, rgb.b)).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

interface RefinerSettings {
  gridDetectionMode: "auto" | "hint" | "force" | "off";
  detectionQuantStep: number;
  sampleWindow: number;
  forcePixelsW: string;
  forcePixelsH: string;
  hintPixelsW: string;
  hintPixelsH: string;
  preRemoveBackground: boolean;
  postRemoveBackground: boolean;
  bgRemovalScope: "off" | "selected" | "outer" | "all";
  bgConnectivity: "4" | "8";
  backgroundTolerance: number;
  floatingMaxPixels: number;
  trimToContent: boolean;
  trimAlphaThreshold: number;
  autoGridFromTrimmed: boolean;
  fastAutoGridFromTrimmed: boolean;
  makeSquare: boolean;
  keepAspectRatio: boolean;
  reduceColorMode: string;
  colorCount: number;
  ditherMode: "none" | "floyd-steinberg" | "bayer-2x2" | "bayer-4x4" | "bayer-8x8" | "ordered";
  ditherStrength: number;
  bgExtractionMethod: "none" | "top-left" | "bottom-left" | "top-right" | "bottom-right" | "rgb";
  bgRgb: string;
  outlineStyle: "none" | "rounded" | "sharp";
  outlineColor: string;
}

const DEFAULT_SETTINGS: RefinerSettings = {
  gridDetectionMode: "auto",
  detectionQuantStep: 64,
  sampleWindow: 3,
  forcePixelsW: "",
  forcePixelsH: "",
  hintPixelsW: "",
  hintPixelsH: "",
  preRemoveBackground: true,
  postRemoveBackground: true,
  bgRemovalScope: "outer",
  bgConnectivity: "4",
  backgroundTolerance: 64,
  floatingMaxPixels: 0,
  trimToContent: true,
  trimAlphaThreshold: 16,
  autoGridFromTrimmed: true,
  fastAutoGridFromTrimmed: true,
  makeSquare: false,
  keepAspectRatio: false,
  reduceColorMode: "none",
  colorCount: 32,
  ditherMode: "none",
  ditherStrength: 0,
  bgExtractionMethod: "top-left",
  bgRgb: "#ffffff",
  outlineStyle: "none",
  outlineColor: "#ffffff",
};

interface SessionItem {
  id: string;
  name: string;
  originalImage: RawImage;
  processedResult: ProcessResult | null;
  status: "idle" | "processing" | "success" | "error";
  error?: string;
}

const BUILTIN_PRESETS: { name: string; settings: RefinerSettings }[] = [
  { name: "Default (Auto Grid + Trans BG)", settings: DEFAULT_SETTINGS },
  {
    name: "NES Retro Color + Dither",
    settings: {
      ...DEFAULT_SETTINGS,
      reduceColorMode: "nes",
      ditherMode: "floyd-steinberg",
      ditherStrength: 50,
    },
  },
  {
    name: "Game Boy Original Green Tint",
    settings: {
      ...DEFAULT_SETTINGS,
      reduceColorMode: "gb_legacy",
      colorCount: 4,
      ditherMode: "ordered",
      ditherStrength: 80,
    },
  },
  {
    name: "Icon Outlined (White Outline)",
    settings: {
      ...DEFAULT_SETTINGS,
      makeSquare: true,
      keepAspectRatio: true,
      outlineStyle: "rounded",
      outlineColor: "#ffffff",
    },
  },
  {
    name: "1:1 Raw Pixel Clean (No Grid)",
    settings: {
      ...DEFAULT_SETTINGS,
      gridDetectionMode: "off",
      trimToContent: false,
      autoGridFromTrimmed: false,
    },
  },
];

export default function App() {
  const [settings, setSettings] = useState<RefinerSettings>(DEFAULT_SETTINGS);
  const [customPaletteText, setCustomPaletteText] = useState<string>("");
  const [userPresets, setUserPresets] = useState<{ name: string; settings: RefinerSettings }[]>([]);
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number>(0);
  const [presetSaveName, setPresetSaveName] = useState<string>("");
  const [isSavingPreset, setIsSavingPreset] = useState<boolean>(false);

  // Accordion state
  const [accordionOpen, setAccordionOpen] = useState<Record<string, boolean>>({
    grid: true,
    background: false,
    color: false,
    outline: false,
  });

  // Sessions and UI viewport state
  const [sessionList, setSessionList] = useState<SessionItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [viewMode, setViewMode] = useState<"slider" | "side" | "processed" | "original">("slider");
  const [zoomScale, setZoomScale] = useState<number | "fit">(4);
  const [showPixelGrid, setShowPixelGrid] = useState<boolean>(false);
  const [showCellGrid, setShowCellGrid] = useState<boolean>(true);
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [exportScale, setExportScale] = useState<number>(1);
  
  // Toast notifications
  const [toast, setToast] = useState<{ message: string; isDanger?: boolean } | null>(null);

  // Refs for dragging compare slider
  const isDraggingRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Canvas refs
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const processedCanvasRef = useRef<HTMLCanvasElement>(null);
  const rawOriginalCanvasRef = useRef<HTMLCanvasElement>(null);
  const sideOriginalCanvasRef = useRef<HTMLCanvasElement>(null);
  const sideProcessedCanvasRef = useRef<HTMLCanvasElement>(null);

  const activeItem = activeIndex >= 0 && activeIndex < sessionList.length ? sessionList[activeIndex] : null;

  // Load user presets from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("adna-pixel-refiner-presets");
    if (saved) {
      try {
        setUserPresets(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse presets", e);
      }
    }
  }, []);

  const showToast = (message: string, isDanger = false) => {
    setToast({ message, isDanger });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  const toggleAccordion = (section: string) => {
    setAccordionOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Parsed custom palette hex codes
  const parsedCustomPalette = useMemo<RGB[] | undefined>(() => {
    if (settings.reduceColorMode !== "fixed" || !customPaletteText) return undefined;
    const matches = customPaletteText.match(/#[0-9a-fA-F]{6}/g);
    if (!matches) return undefined;
    return matches.map(hexToRgb);
  }, [settings.reduceColorMode, customPaletteText]);

  // Load preset handler
  const handleSelectPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value);
    setSelectedPresetIndex(idx);
    if (idx < BUILTIN_PRESETS.length) {
      setSettings(BUILTIN_PRESETS[idx].settings);
      showToast(`Loaded Built-in Preset: ${BUILTIN_PRESETS[idx].name}`);
    } else {
      const userIdx = idx - BUILTIN_PRESETS.length;
      if (userPresets[userIdx]) {
        setSettings(userPresets[userIdx].settings);
        showToast(`Loaded Custom Preset: ${userPresets[userIdx].name}`);
      }
    }
  };

  // Save preset handler
  const handleSavePreset = () => {
    if (!presetSaveName.trim()) {
      showToast("Please enter a preset name.", true);
      return;
    }
    const updated = [...userPresets, { name: presetSaveName, settings }];
    setUserPresets(updated);
    localStorage.setItem("adna-pixel-refiner-presets", JSON.stringify(updated));
    setSelectedPresetIndex(BUILTIN_PRESETS.length + updated.length - 1);
    setPresetSaveName("");
    setIsSavingPreset(false);
    showToast(`Preset "${presetSaveName}" saved!`);
  };

  // Delete preset handler
  const handleDeletePreset = () => {
    if (selectedPresetIndex < BUILTIN_PRESETS.length) {
      showToast("Cannot delete built-in presets.", true);
      return;
    }
    const userIdx = selectedPresetIndex - BUILTIN_PRESETS.length;
    const name = userPresets[userIdx].name;
    const updated = userPresets.filter((_, i) => i !== userIdx);
    setUserPresets(updated);
    localStorage.setItem("adna-pixel-refiner-presets", JSON.stringify(updated));
    setSelectedPresetIndex(0);
    setSettings(BUILTIN_PRESETS[0].settings);
    showToast(`Preset "${name}" deleted.`);
  };

  // Handle setting updates
  const updateSetting = <K extends keyof RefinerSettings>(key: K, value: RefinerSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // File Upload Handlers
  const handleFiles = async (files: FileList) => {
    const newItems: SessionItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;
      try {
        const originalImage = await imageToRawImage(file);
        newItems.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          originalImage,
          processedResult: null,
          status: "idle",
        });
      } catch (err) {
        console.error("Error parsing file " + file.name, err);
        showToast(`Failed to parse ${file.name}`, true);
      }
    }
    if (newItems.length > 0) {
      setSessionList((prev) => {
        const next = [...prev, ...newItems];
        if (prev.length === 0) setActiveIndex(0);
        return next;
      });
      showToast(`Added ${newItems.length} image(s) to workspace.`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Run image processing whenever active item or settings change
  useEffect(() => {
    if (activeIndex < 0 || activeIndex >= sessionList.length) return;
    const item = sessionList[activeIndex];
    
    // Construct options
    const options: ProcessOptions = {
      enableGridDetection: settings.gridDetectionMode !== "off",
      preRemoveBackground: settings.preRemoveBackground,
      postRemoveBackground: settings.postRemoveBackground,
      bgRemovalScope: settings.bgRemovalScope,
      bgConnectivity: settings.bgConnectivity,
      backgroundTolerance: settings.backgroundTolerance,
      floatingMaxPixels: settings.floatingMaxPixels,
      trimToContent: settings.trimToContent,
      trimAlphaThreshold: settings.trimAlphaThreshold,
      autoGridFromTrimmed: settings.autoGridFromTrimmed,
      fastAutoGridFromTrimmed: settings.fastAutoGridFromTrimmed,
      makeSquare: settings.makeSquare,
      keepAspectRatio: settings.keepAspectRatio,
      reduceColors: settings.reduceColorMode !== "none",
      reduceColorMode: settings.reduceColorMode,
      colorCount: settings.colorCount,
      ditherMode: settings.ditherMode,
      ditherStrength: settings.ditherStrength,
      bgExtractionMethod: settings.bgExtractionMethod,
      bgRgb: settings.bgRgb,
      outlineStyle: settings.outlineStyle,
      outlineColor: hexToRgb(settings.outlineColor),
      detectionQuantStep: settings.detectionQuantStep,
      sampleWindow: settings.sampleWindow,
    };

    if (settings.gridDetectionMode === "force") {
      const w = parseInt(settings.forcePixelsW);
      const h = parseInt(settings.forcePixelsH);
      if (!isNaN(w) && w > 0 && !isNaN(h) && h > 0) {
        options.forcePixelsW = w;
        options.forcePixelsH = h;
      }
    } else if (settings.gridDetectionMode === "hint") {
      const w = parseInt(settings.hintPixelsW);
      const h = parseInt(settings.hintPixelsH);
      if (!isNaN(w) && w > 0 && !isNaN(h) && h > 0) {
        options.hintPixelsW = w;
        options.hintPixelsH = h;
      }
    }

    if (settings.reduceColorMode === "fixed" && parsedCustomPalette) {
      options.fixedPalette = parsedCustomPalette;
    }

    setSessionList((prev) => {
      const next = [...prev];
      next[activeIndex] = { ...item, status: "processing" };
      return next;
    });

    try {
      // Process synchronously since it runs fast
      const processedResult = processImage(item.originalImage, options);
      setSessionList((prev) => {
        const next = [...prev];
        next[activeIndex] = {
          ...item,
          processedResult,
          status: "success",
        };
        return next;
      });
    } catch (err: any) {
      console.error(err);
      setSessionList((prev) => {
        const next = [...prev];
        next[activeIndex] = {
          ...item,
          status: "error",
          error: err.message || "Failed to process image.",
        };
        return next;
      });
    }
  }, [
    activeIndex,
    settings.gridDetectionMode,
    settings.detectionQuantStep,
    settings.sampleWindow,
    settings.forcePixelsW,
    settings.forcePixelsH,
    settings.hintPixelsW,
    settings.hintPixelsH,
    settings.preRemoveBackground,
    settings.postRemoveBackground,
    settings.bgRemovalScope,
    settings.bgConnectivity,
    settings.backgroundTolerance,
    settings.floatingMaxPixels,
    settings.trimToContent,
    settings.trimAlphaThreshold,
    settings.autoGridFromTrimmed,
    settings.fastAutoGridFromTrimmed,
    settings.makeSquare,
    settings.keepAspectRatio,
    settings.reduceColorMode,
    settings.colorCount,
    settings.ditherMode,
    settings.ditherStrength,
    settings.bgExtractionMethod,
    settings.bgRgb,
    settings.outlineStyle,
    settings.outlineColor,
    parsedCustomPalette,
  ]);

  // Helper to draw detected cell grid
  const drawCellGrid = (canvas: HTMLCanvasElement, grid: any) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const cw = grid.cellW;
    const ch = grid.cellH;
    const ox = grid.cropX ?? grid.offsetX;
    const oy = grid.cropY ?? grid.offsetY;
    const outW = grid.outW ?? Math.floor((canvas.width - ox) / cw);
    const outH = grid.outH ?? Math.floor((canvas.height - oy) / ch);

    ctx.strokeStyle = "rgba(0, 255, 0, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical lines
    for (let i = 0; i <= outW; i++) {
      const x = ox + i * cw;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    // Horizontal lines
    for (let j = 0; j <= outH; j++) {
      const y = oy + j * ch;
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
  };

  // Render viewport canvases
  useEffect(() => {
    if (!activeItem) return;

    // 1. Draw slider bottom layer (Compare Original)
    if (viewMode === "slider" && originalCanvasRef.current && activeItem.processedResult?.compareBefore) {
      drawRawImageToCanvas(activeItem.processedResult.compareBefore, originalCanvasRef.current);
    }

    // 2. Draw slider top layer (Compare Processed)
    if (viewMode === "slider" && processedCanvasRef.current && activeItem.processedResult?.result) {
      drawRawImageToCanvas(activeItem.processedResult.result, processedCanvasRef.current);
      if (showPixelGrid) {
        drawGridToCanvas(processedCanvasRef.current.width, processedCanvasRef.current.height, processedCanvasRef.current);
      }
    }

    // 3. Draw raw original view
    if (viewMode === "original" && rawOriginalCanvasRef.current && activeItem.originalImage) {
      drawRawImageToCanvas(activeItem.originalImage, rawOriginalCanvasRef.current);
      if (showCellGrid && activeItem.processedResult?.grid) {
        drawCellGrid(rawOriginalCanvasRef.current, activeItem.processedResult.grid);
      }
    }

    // 4. Draw side-by-side original layer
    if (viewMode === "side" && sideOriginalCanvasRef.current && activeItem.processedResult?.compareBefore) {
      drawRawImageToCanvas(activeItem.processedResult.compareBefore, sideOriginalCanvasRef.current);
      if (showCellGrid && activeItem.processedResult?.grid) {
        drawCellGrid(sideOriginalCanvasRef.current, activeItem.processedResult.grid);
      }
    }

    // 5. Draw side-by-side processed layer
    if (viewMode === "side" && sideProcessedCanvasRef.current && activeItem.processedResult?.result) {
      drawRawImageToCanvas(activeItem.processedResult.result, sideProcessedCanvasRef.current);
      if (showPixelGrid) {
        drawGridToCanvas(sideProcessedCanvasRef.current.width, sideProcessedCanvasRef.current.height, sideProcessedCanvasRef.current);
      }
    }
  }, [activeItem, viewMode, showCellGrid, showPixelGrid, sliderPos]);

  // Drag Compare Slider Logic
  const handleSliderMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pct);
  };

  // Export & Download Single Image
  const handleDownload = (scale: number = 1) => {
    if (!activeItem || !activeItem.processedResult?.result) return;
    const img = activeItem.processedResult.result;
    const target = scale > 1 ? upscaleNearest(img, scale) : img;

    const canvas = document.createElement("canvas");
    drawRawImageToCanvas(target, canvas);

    const link = document.createElement("a");
    const timestamp = Math.floor(Date.now() / 1000);
    const filename = activeItem.name.substring(0, activeItem.name.lastIndexOf(".")) || activeItem.name;
    link.download = `${filename}_refined_x${scale}_${timestamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast(`Downloaded: ${link.download}`);
  };

  // Download All as ZIP using fflate
  const handleDownloadAll = async () => {
    const successItems = sessionList.filter((item) => item.status === "success" && item.processedResult);
    if (successItems.length === 0) {
      showToast("No processed images to export.", true);
      return;
    }

    showToast("Zipping images...");
    const files: Record<string, Uint8Array> = {};

    for (const item of successItems) {
      if (!item.processedResult) continue;
      const img = item.processedResult.result;
      const target = exportScale > 1 ? upscaleNearest(img, exportScale) : img;

      const canvas = document.createElement("canvas");
      drawRawImageToCanvas(target, canvas);

      // Convert to blob and then to Uint8Array
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const baseName = item.name.substring(0, item.name.lastIndexOf(".")) || item.name;
        const finalName = exportScale > 1 ? `${baseName}_refined_x${exportScale}.png` : `${baseName}_refined.png`;
        files[finalName] = new Uint8Array(arrayBuffer);
      }
    }

    try {
      const zipData = zipSync(files);
      const blob = new Blob([zipData], { type: "application/zip" });
      const link = document.createElement("a");
      link.download = `pixel_refiner_batch_x${exportScale}.zip`;
      link.href = URL.createObjectURL(blob);
      link.click();
      showToast("Batch zip download complete!");
    } catch (err) {
      console.error(err);
      showToast("Failed to generate ZIP file.", true);
    }
  };

  // GPL Palette exporter
  const handleDownloadGPL = () => {
    if (!activeItem || !activeItem.processedResult?.extractedPalette) return;
    const colors = activeItem.processedResult.extractedPalette;
    let gpl = "GIMP Palette\n";
    gpl += `Name: ${activeItem.name.split(".")[0] || "PixelRefiner"} GPL\n`;
    gpl += "Columns: 8\n#\n";
    colors.forEach((c, i) => {
      gpl += `${c.r.toString().padStart(3)} ${c.g.toString().padStart(3)} ${c.b.toString().padStart(3)}\tColor ${i}\n`;
    });

    const blob = new Blob([gpl], { type: "text/plain" });
    const link = document.createElement("a");
    link.download = `${activeItem.name.split(".")[0] || "palette"}.gpl`;
    link.href = URL.createObjectURL(blob);
    link.click();
    showToast(`Exported GPL: ${link.download}`);
  };

  // Copy extracted palette to clipboard as hex text
  const handleCopyExtractedColors = () => {
    if (!activeItem || !activeItem.processedResult?.extractedPalette) return;
    const hexList = activeItem.processedResult.extractedPalette.map(rgbToHex).join(", ");
    navigator.clipboard.writeText(hexList).then(
      () => showToast("Copied extracted palette hex list!"),
      () => showToast("Failed to copy color codes.", true)
    );
  };

  // Load extracted colors into custom palette input
  const handleImportExtractedColors = () => {
    if (!activeItem || !activeItem.processedResult?.extractedPalette) return;
    const hexList = activeItem.processedResult.extractedPalette.map(rgbToHex).join("\n");
    setCustomPaletteText(hexList);
    updateSetting("reduceColorMode", "fixed");
    showToast("Extracted colors imported as Fixed Palette!");
  };

  // Extracted unique colors
  const activePalette = useMemo(() => {
    return activeItem?.processedResult?.extractedPalette || [];
  }, [activeItem?.processedResult]);

  return (
    <div className="refiner-app" onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* Toast Alert */}
      {toast && (
        <div className={`toast-msg ${toast.isDanger ? "danger" : ""}`}>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Bar */}
      <header className="header">
        <div className="brand">
          <div className="logo-badge">R</div>
          <div className="brand-text">
            <h1>ADNA Pixel Refiner</h1>
            <p>AI 像素图优化与裁切工具 — 去锯齿 · 栅格重建 · 自动去背</p>
          </div>
        </div>
        <div className="nav-links">
          <a href="/" className="nav-btn">← 返回主页</a>
          <a href="/reroll/" className="nav-btn">Reroll 编辑器</a>
          <a href="/tagger/" className="nav-btn">资源标注工具</a>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="main-layout">
        {/* Sidebar Settings Panel */}
        <aside className="sidebar">
          <div className="sidebar-scroll">
            
            {/* Presets Manager Panel */}
            <div className="presets-section">
              <div className="presets-header">
                <span>预设配置 presets</span>
                {selectedPresetIndex >= BUILTIN_PRESETS.length && (
                  <button className="text-button danger-text" onClick={handleDeletePreset} style={{background: 'none', border: 'none', color: 'var(--danger)', fontSize: '0.75rem', cursor: 'pointer'}}>删除</button>
                )}
              </div>
              <div className="preset-controls">
                <select
                  className="preset-select"
                  value={selectedPresetIndex}
                  onChange={handleSelectPreset}
                >
                  <optgroup label="内置预设 (Built-in)">
                    {BUILTIN_PRESETS.map((p, idx) => (
                      <option key={idx} value={idx}>{p.name}</option>
                    ))}
                  </optgroup>
                  {userPresets.length > 0 && (
                    <optgroup label="我的预设 (Custom)">
                      {userPresets.map((p, idx) => (
                        <option key={idx + BUILTIN_PRESETS.length} value={idx + BUILTIN_PRESETS.length}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                
                {!isSavingPreset ? (
                  <button className="btn-small" onClick={() => setIsSavingPreset(true)}>保存</button>
                ) : (
                  <div style={{display: 'flex', gap: '4px', marginTop: '6px', width: '100%'}}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="预设名称..."
                      value={presetSaveName}
                      onChange={(e) => setPresetSaveName(e.target.value)}
                      style={{padding: '4px 8px'}}
                    />
                    <button className="btn-small accent" onClick={handleSavePreset}>确认</button>
                    <button className="btn-small" onClick={() => setIsSavingPreset(false)}>取消</button>
                  </div>
                )}
              </div>
            </div>

            {/* Accordion 1: Grid Detection */}
            <div className="accordion-item">
              <button
                className={`accordion-header ${accordionOpen.grid ? "active" : ""}`}
                onClick={() => toggleAccordion("grid")}
              >
                <span>🌐 栅格重建 (Grid & Resolution)</span>
                <span>{accordionOpen.grid ? "▼" : "▶"}</span>
              </button>
              {accordionOpen.grid && (
                <div className="accordion-content">
                  <div className="form-group">
                    <div className="label-wrapper">
                      <span>检测模式 Detection Mode</span>
                    </div>
                    <select
                      className="form-select"
                      value={settings.gridDetectionMode}
                      onChange={(e) => updateSetting("gridDetectionMode", e.target.value as any)}
                    >
                      <option value="auto">自动对齐 (Auto Grid)</option>
                      <option value="hint">参考像素 + 自动 (Pixel + Auto)</option>
                      <option value="force">强制像素 (Pixel Only)</option>
                      <option value="off">不重建 (Off 1:1)</option>
                    </select>
                  </div>

                  {settings.gridDetectionMode === "force" && (
                    <div className="form-row">
                      <div className="form-group">
                        <label className="label-wrapper">宽 Force Width</label>
                        <input
                          type="number"
                          className="form-input"
                          value={settings.forcePixelsW}
                          onChange={(e) => updateSetting("forcePixelsW", e.target.value)}
                          placeholder="e.g. 64"
                        />
                      </div>
                      <div className="form-group">
                        <label className="label-wrapper">高 Force Height</label>
                        <input
                          type="number"
                          className="form-input"
                          value={settings.forcePixelsH}
                          onChange={(e) => updateSetting("forcePixelsH", e.target.value)}
                          placeholder="e.g. 64"
                        />
                      </div>
                    </div>
                  )}

                  {settings.gridDetectionMode === "hint" && (
                    <div className="form-row">
                      <div className="form-group">
                        <label className="label-wrapper">参考宽 Hint Width</label>
                        <input
                          type="number"
                          className="form-input"
                          value={settings.hintPixelsW}
                          onChange={(e) => updateSetting("hintPixelsW", e.target.value)}
                          placeholder="e.g. 64"
                        />
                      </div>
                      <div className="form-group">
                        <label className="label-wrapper">参考高 Hint Height</label>
                        <input
                          type="number"
                          className="form-input"
                          value={settings.hintPixelsH}
                          onChange={(e) => updateSetting("hintPixelsH", e.target.value)}
                          placeholder="e.g. 64"
                        />
                      </div>
                    </div>
                  )}

                  {settings.gridDetectionMode !== "off" && (
                    <>
                      <div className="form-group">
                        <div className="label-wrapper">
                          <span>特征模糊提取 Quant Step</span>
                          <span className="label-val">{settings.detectionQuantStep}</span>
                        </div>
                        <input
                          type="range"
                          className="form-range"
                          min="1"
                          max="128"
                          value={settings.detectionQuantStep}
                          onChange={(e) => updateSetting("detectionQuantStep", parseInt(e.target.value))}
                        />
                      </div>

                      <div className="form-group">
                        <div className="label-wrapper">
                          <span>中值采样窗口 Sample Window</span>
                          <span className="label-val">{settings.sampleWindow}px</span>
                        </div>
                        <input
                          type="range"
                          className="form-range"
                          min="1"
                          max="9"
                          step="2"
                          value={settings.sampleWindow}
                          onChange={(e) => updateSetting("sampleWindow", parseInt(e.target.value))}
                        />
                      </div>

                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={settings.fastAutoGridFromTrimmed}
                          onChange={(e) => updateSetting("fastAutoGridFromTrimmed", e.target.checked)}
                        />
                        <span>启用快速对齐 (Fast Search Mode)</span>
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Accordion 2: Background Removal */}
            <div className="accordion-item">
              <button
                className={`accordion-header ${accordionOpen.background ? "active" : ""}`}
                onClick={() => toggleAccordion("background")}
              >
                <span>🪄 背景提取与去背 (Transparency)</span>
                <span>{accordionOpen.background ? "▼" : "▶"}</span>
              </button>
              {accordionOpen.background && (
                <div className="accordion-content">
                  <div className="form-group">
                    <div className="label-wrapper">
                      <span>背景采样提取 Method</span>
                    </div>
                    <select
                      className="form-select"
                      value={settings.bgExtractionMethod}
                      onChange={(e) => updateSetting("bgExtractionMethod", e.target.value as any)}
                    >
                      <option value="none">不提取</option>
                      <option value="top-left">左上角像素 (Top-Left)</option>
                      <option value="bottom-left">左下角像素 (Bottom-Left)</option>
                      <option value="top-right">右上角像素 (Top-Right)</option>
                      <option value="bottom-right">右下角像素 (Bottom-Right)</option>
                      <option value="rgb">指定RGB颜色 (Custom RGB)</option>
                    </select>
                  </div>

                  {settings.bgExtractionMethod === "rgb" && (
                    <div className="form-group">
                      <div className="label-wrapper">
                        <span>指定背景色 Custom Color</span>
                      </div>
                      <div className="picker-row">
                        <input
                          type="color"
                          className="color-picker"
                          value={settings.bgRgb}
                          onChange={(e) => updateSetting("bgRgb", e.target.value)}
                        />
                        <input
                          type="text"
                          className="form-input"
                          value={settings.bgRgb}
                          onChange={(e) => updateSetting("bgRgb", e.target.value)}
                          maxLength={7}
                        />
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <div className="label-wrapper">
                      <span>去背容差 Tolerance</span>
                      <span className="label-val">{settings.backgroundTolerance}</span>
                    </div>
                    <input
                      type="range"
                      className="form-range"
                      min="0"
                      max="255"
                      value={settings.backgroundTolerance}
                      onChange={(e) => updateSetting("backgroundTolerance", parseInt(e.target.value))}
                    />
                  </div>

                  <div className="form-group">
                    <div className="label-wrapper">
                      <span>泛洪连接 Scope</span>
                    </div>
                    <select
                      className="form-select"
                      value={settings.bgRemovalScope}
                      onChange={(e) => updateSetting("bgRemovalScope", e.target.value as any)}
                    >
                      <option value="off">不清除</option>
                      <option value="outer">仅外部透明 (Outer Only)</option>
                      <option value="selected">所选匹配 (Selected)</option>
                      <option value="all">全图匹配 (All)</option>
                    </select>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <div className="label-wrapper">
                        <span>连通性 Connectivity</span>
                      </div>
                      <select
                        className="form-select"
                        value={settings.bgConnectivity}
                        onChange={(e) => updateSetting("bgConnectivity", e.target.value as any)}
                      >
                        <option value="4">4-方向</option>
                        <option value="8">8-方向</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <div className="label-wrapper">
                        <span>噪声杂点过滤 Noise Limit</span>
                      </div>
                      <input
                        type="number"
                        className="form-input"
                        value={settings.floatingMaxPixels}
                        onChange={(e) => updateSetting("floatingMaxPixels", Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        placeholder="0 (关闭)"
                      />
                    </div>
                  </div>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.trimToContent}
                      onChange={(e) => updateSetting("trimToContent", e.target.checked)}
                    />
                    <span>去除多余透明边缘 (Trim Bounds)</span>
                  </label>

                  {settings.trimToContent && (
                    <div className="form-group">
                      <div className="label-wrapper">
                        <span>裁切透明阈值 Alpha Threshold</span>
                        <span className="label-val">{settings.trimAlphaThreshold}</span>
                      </div>
                      <input
                        type="range"
                        className="form-range"
                        min="1"
                        max="255"
                        value={settings.trimAlphaThreshold}
                        onChange={(e) => updateSetting("trimAlphaThreshold", parseInt(e.target.value))}
                      />
                    </div>
                  )}

                  <div className="form-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={settings.preRemoveBackground}
                        onChange={(e) => updateSetting("preRemoveBackground", e.target.checked)}
                      />
                      <span>预处理去背 (Pre-remove)</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={settings.postRemoveBackground}
                        onChange={(e) => updateSetting("postRemoveBackground", e.target.checked)}
                      />
                      <span>后处理去背 (Post-remove)</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Accordion 3: Color Reduction */}
            <div className="accordion-item">
              <button
                className={`accordion-header ${accordionOpen.color ? "active" : ""}`}
                onClick={() => toggleAccordion("color")}
              >
                <span>🎨 颜色控制与抖动 (Colors & Palette)</span>
                <span>{accordionOpen.color ? "▼" : "▶"}</span>
              </button>
              {accordionOpen.color && (
                <div className="accordion-content">
                  <div className="form-group">
                    <div className="label-wrapper">
                      <span>颜色限制 Mode</span>
                    </div>
                    <select
                      className="form-select"
                      value={settings.reduceColorMode}
                      onChange={(e) => updateSetting("reduceColorMode", e.target.value)}
                    >
                      <option value="none">不限色 (None)</option>
                      <option value="auto">自动聚类 (K-Means Auto)</option>
                      <option value="fixed">自定义色板 (Fixed Palette)</option>
                      <option value="mono">黑白双色 (Monochrome)</option>
                      <option value="gb_legacy">Game Boy 掌机经典</option>
                      <option value="gb_pocket">Game Boy Pocket 灰色</option>
                      <option value="gb_light">Game Boy Light 背光</option>
                      <option value="pico8">PICO-8 像素画色板</option>
                      <option value="nes">FC 红白机红蓝色板</option>
                      <option value="pc98">PC-9801 复古色板</option>
                      <option value="msx">MSX1 色板</option>
                      <option value="c64">Commodore 64 色板</option>
                      <option value="arne16">Arne16 复古色板</option>
                    </select>
                  </div>

                  {settings.reduceColorMode === "auto" && (
                    <div className="form-group">
                      <div className="label-wrapper">
                        <span>聚类颜色数量 Max Colors</span>
                        <span className="label-val">{settings.colorCount} colors</span>
                      </div>
                      <input
                        type="range"
                        className="form-range"
                        min="2"
                        max="256"
                        value={settings.colorCount}
                        onChange={(e) => updateSetting("colorCount", parseInt(e.target.value))}
                      />
                    </div>
                  )}

                  {settings.reduceColorMode === "fixed" && (
                    <div className="form-group">
                      <div className="label-wrapper">
                        <span>十六进制色表 Hex Color List</span>
                      </div>
                      <textarea
                        className="palette-text-area"
                        placeholder="每行一个或逗号分隔: #ff0000, #00ff00..."
                        value={customPaletteText}
                        onChange={(e) => setCustomPaletteText(e.target.value)}
                      />
                      {activePalette.length > 0 && (
                        <button
                          type="button"
                          className="btn-small accent"
                          onClick={handleImportExtractedColors}
                          style={{alignSelf: "flex-start"}}
                        >
                          使用当前提取色板
                        </button>
                      )}
                    </div>
                  )}

                  {settings.reduceColorMode !== "none" && (
                    <>
                      <div className="form-group">
                        <div className="label-wrapper">
                          <span>抖动模式 Dithering Mode</span>
                        </div>
                        <select
                          className="form-select"
                          value={settings.ditherMode}
                          onChange={(e) => updateSetting("ditherMode", e.target.value as any)}
                        >
                          <option value="none">无抖动 (No Dither)</option>
                          <option value="floyd-steinberg">Floyd-Steinberg (扩散)</option>
                          <option value="bayer-2x2">Bayer 2x2 网格</option>
                          <option value="bayer-4x4">Bayer 4x4 网格</option>
                          <option value="bayer-8x8">Bayer 8x8 网格</option>
                          <option value="ordered">Ordered 矩阵抖动</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <div className="label-wrapper">
                          <span>抖动强度 Strength</span>
                          <span className="label-val">{settings.ditherStrength}%</span>
                        </div>
                        <input
                          type="range"
                          className="form-range"
                          min="0"
                          max="100"
                          value={settings.ditherStrength}
                          onChange={(e) => updateSetting("ditherStrength", parseInt(e.target.value))}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Accordion 4: Outline */}
            <div className="accordion-item">
              <button
                className={`accordion-header ${accordionOpen.outline ? "active" : ""}`}
                onClick={() => toggleAccordion("outline")}
              >
                <span>✏️ 描边勾线 (Sprite Outline)</span>
                <span>{accordionOpen.outline ? "▼" : "▶"}</span>
              </button>
              {accordionOpen.outline && (
                <div className="accordion-content">
                  <div className="form-group">
                    <div className="label-wrapper">
                      <span>勾边风格 Outline Style</span>
                    </div>
                    <select
                      className="form-select"
                      value={settings.outlineStyle}
                      onChange={(e) => updateSetting("outlineStyle", e.target.value as any)}
                    >
                      <option value="none">无描边</option>
                      <option value="rounded">圆润 8-方向 (Rounded)</option>
                      <option value="sharp">锐利 4-方向 (Sharp)</option>
                    </select>
                  </div>

                  {settings.outlineStyle !== "none" && (
                    <div className="form-group">
                      <div className="label-wrapper">
                        <span>描边颜色 Outline Color</span>
                      </div>
                      <div className="picker-row">
                        <input
                          type="color"
                          className="color-picker"
                          value={settings.outlineColor}
                          onChange={(e) => updateSetting("outlineColor", e.target.value)}
                        />
                        <input
                          type="text"
                          className="form-input"
                          value={settings.outlineColor}
                          onChange={(e) => updateSetting("outlineColor", e.target.value)}
                          maxLength={7}
                        />
                      </div>
                    </div>
                  )}

                  <div className="form-row" style={{marginTop: '4px'}}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={settings.makeSquare}
                        onChange={(e) => updateSetting("makeSquare", e.target.checked)}
                      />
                      <span>强转正方形 (Make Square)</span>
                    </label>

                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={settings.keepAspectRatio}
                        onChange={(e) => updateSetting("keepAspectRatio", e.target.checked)}
                      />
                      <span>保留宽高比 (Keep Aspect)</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

          </div>
        </aside>

        {/* Viewport Area */}
        <main className="viewport-panel">
          
          {/* Toolbar */}
          <div className="toolbar">
            <div className="toolbar-group">
              <span className="toolbar-title">
                {activeItem ? `📄 ${activeItem.name}` : "未载入文件 No Image"}
              </span>
              {activeItem && activeItem.processedResult && (
                <span className="label-val" style={{fontSize: '0.75rem'}}>
                  ({activeItem.originalImage.width}x{activeItem.originalImage.height} → {activeItem.processedResult.result.width}x{activeItem.processedResult.result.height})
                </span>
              )}
            </div>

            <div className="toolbar-group">
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${viewMode === "slider" ? "active" : ""}`}
                  onClick={() => setViewMode("slider")}
                >
                  滑块对比
                </button>
                <button
                  className={`toggle-btn ${viewMode === "side" ? "active" : ""}`}
                  onClick={() => setViewMode("side")}
                >
                  左右分屏
                </button>
                <button
                  className={`toggle-btn ${viewMode === "processed" ? "active" : ""}`}
                  onClick={() => setViewMode("processed")}
                >
                  效果图
                </button>
                <button
                  className={`toggle-btn ${viewMode === "original" ? "active" : ""}`}
                  onClick={() => setViewMode("original")}
                >
                  原图
                </button>
              </div>

              <div className="toolbar-divider"></div>

              <div className="toggle-group">
                <button className={`toggle-btn ${zoomScale === "fit" ? "active" : ""}`} onClick={() => setZoomScale("fit")}>自适应</button>
                <button className={`toggle-btn ${zoomScale === 1 ? "active" : ""}`} onClick={() => setZoomScale(1)}>1x</button>
                <button className={`toggle-btn ${zoomScale === 2 ? "active" : ""}`} onClick={() => setZoomScale(2)}>2x</button>
                <button className={`toggle-btn ${zoomScale === 4 ? "active" : ""}`} onClick={() => setZoomScale(4)}>4x</button>
                <button className={`toggle-btn ${zoomScale === 8 ? "active" : ""}`} onClick={() => setZoomScale(8)}>8x</button>
                <button className={`toggle-btn ${zoomScale === 16 ? "active" : ""}`} onClick={() => setZoomScale(16)}>16x</button>
              </div>

              {viewMode === "original" || viewMode === "side" ? (
                <label className="checkbox-label" style={{marginLeft: '12px', fontSize: '0.75rem'}}>
                  <input type="checkbox" checked={showCellGrid} onChange={(e) => setShowCellGrid(e.target.checked)} />
                  <span>参考网格</span>
                </label>
              ) : null}

              {viewMode === "processed" || viewMode === "side" || viewMode === "slider" ? (
                <label className="checkbox-label" style={{marginLeft: '12px', fontSize: '0.75rem'}}>
                  <input type="checkbox" checked={showPixelGrid} onChange={(e) => setShowPixelGrid(e.target.checked)} />
                  <span>像素网格</span>
                </label>
              ) : null}
            </div>
          </div>

          {/* Canvas viewport container */}
          <div className="canvas-viewport">
            {!activeItem ? (
              <div className="dropzone" onClick={() => document.getElementById("file-loader")?.click()}>
                <div className="dropzone-icon">📁</div>
                <div className="dropzone-title">拖拽图片到这里，或点击选择</div>
                <div className="dropzone-sub">支持 PNG / JPG / WebP 等格式，处理完全在浏览器本地完成，不传输服务器</div>
                <input
                  type="file"
                  id="file-loader"
                  multiple
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
              </div>
            ) : activeItem.status === "processing" ? (
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '2rem', marginBottom: '8px', animation: 'spin 1s linear infinite'}}>⌛</div>
                <div>正在处理像素图 Processing...</div>
              </div>
            ) : activeItem.status === "error" ? (
              <div style={{textAlign: 'center', color: 'var(--danger)'}}>
                <div style={{fontSize: '2rem', marginBottom: '8px'}}>⚠️</div>
                <div>处理出错: {activeItem.error}</div>
              </div>
            ) : (
              /* Success View rendering */
              <div className="chessboard-bg" style={{position: 'relative'}}>
                
                {/* 1. Slider Compare Mode */}
                {viewMode === "slider" && activeItem.processedResult && (
                  <div
                    ref={containerRef}
                    className="compare-container"
                    style={
                      zoomScale === "fit"
                        ? { width: activeItem.processedResult.result.width * 4, height: activeItem.processedResult.result.height * 4, maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
                        : {
                            width: activeItem.processedResult.result.width * zoomScale,
                            height: activeItem.processedResult.result.height * zoomScale,
                          }
                    }
                    onMouseMove={(e) => isDraggingRef.current && handleSliderMove(e.clientX)}
                    onTouchMove={(e) => isDraggingRef.current && e.touches[0] && handleSliderMove(e.touches[0].clientX)}
                    onMouseLeave={() => { isDraggingRef.current = false; }}
                    onMouseUp={() => { isDraggingRef.current = false; }}
                    onTouchEnd={() => { isDraggingRef.current = false; }}
                  >
                    {/* Bottom original aligned */}
                    <canvas
                      ref={originalCanvasRef}
                      className="viewport-canvas compare-bottom-layer"
                      style={{ width: "100%", height: "100%" }}
                    />
                    {/* Top processed clipped */}
                    <div
                      className="compare-top-layer"
                      style={{ width: `${sliderPos}%` }}
                    >
                      <canvas
                        ref={processedCanvasRef}
                        className="viewport-canvas"
                        style={
                          zoomScale === "fit"
                            ? { width: activeItem.processedResult.result.width * 4, height: activeItem.processedResult.result.height * 4 }
                            : {
                                width: activeItem.processedResult.result.width * zoomScale,
                                height: activeItem.processedResult.result.height * zoomScale,
                              }
                        }
                      />
                    </div>
                    {/* Divider Line */}
                    <div
                      className="compare-slider-bar"
                      style={{ left: `${sliderPos}%` }}
                      onMouseDown={(e) => { e.preventDefault(); isDraggingRef.current = true; }}
                      onTouchStart={() => { isDraggingRef.current = true; }}
                    >
                      <div className="compare-slider-handle">↔</div>
                    </div>
                  </div>
                )}

                {/* 2. Processed Only Mode */}
                {viewMode === "processed" && activeItem.processedResult?.result && (
                  <div style={{position: 'relative'}}>
                    <canvas
                      ref={processedCanvasRef}
                      className="viewport-canvas"
                      style={
                        zoomScale === "fit"
                          ? { maxWidth: '100%', maxHeight: '70vh', height: 'auto', display: 'block' }
                          : {
                              width: activeItem.processedResult.result.width * zoomScale,
                              height: activeItem.processedResult.result.height * zoomScale,
                            }
                      }
                    />
                  </div>
                )}

                {/* 3. Original Only Mode */}
                {viewMode === "original" && activeItem.originalImage && (
                  <div style={{position: 'relative'}}>
                    <canvas
                      ref={rawOriginalCanvasRef}
                      className="viewport-canvas"
                      style={
                        zoomScale === "fit"
                          ? { maxWidth: '100%', maxHeight: '70vh', height: 'auto', display: 'block' }
                          : {
                              width: activeItem.originalImage.width * zoomScale,
                              height: activeItem.originalImage.height * zoomScale,
                            }
                      }
                    />
                  </div>
                )}

                {/* 4. Side by Side Mode */}
                {viewMode === "side" && activeItem.processedResult && (
                  <div style={{ display: "flex", gap: "24px", padding: "12px" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "0.75rem", marginBottom: "4px", color: "var(--muted)" }}>对齐原画 Alignment Original</div>
                      <canvas
                        ref={sideOriginalCanvasRef}
                        className="viewport-canvas"
                        style={
                          zoomScale === "fit"
                            ? { maxWidth: '40vw', maxHeight: '60vh', height: 'auto' }
                            : {
                                width: activeItem.processedResult.result.width * zoomScale,
                                height: activeItem.processedResult.result.height * zoomScale,
                              }
                        }
                      />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "0.75rem", marginBottom: "4px", color: "var(--muted)" }}>优化像素图 Refined Sprite</div>
                      <canvas
                        ref={sideProcessedCanvasRef}
                        className="viewport-canvas"
                        style={
                          zoomScale === "fit"
                            ? { maxWidth: '40vw', maxHeight: '60vh', height: 'auto' }
                            : {
                                width: activeItem.processedResult.result.width * zoomScale,
                                height: activeItem.processedResult.result.height * zoomScale,
                              }
                        }
                      />
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>

          {/* Extracted Palette Swatches panel */}
          {activePalette.length > 0 && (
            <div className="palette-display">
              <div className="palette-display-header">
                <span className="palette-display-title">提取色表 extracted colors ({activePalette.length})</span>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button className="btn-small" onClick={handleCopyExtractedColors}>复制Hex</button>
                  <button className="btn-small" onClick={handleDownloadGPL}>导出 .GPL 色板</button>
                </div>
              </div>
              <div className="palette-swatches">
                {activePalette.map((rgb, idx) => {
                  const hex = rgbToHex(rgb);
                  return (
                    <div
                      key={idx}
                      className="swatch"
                      style={{ backgroundColor: hex }}
                      onClick={() => copyToClipboard(hex)}
                    >
                      <div className="swatch-tooltip">{hex}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom Filmstrip Panel */}
          <div className="filmstrip-panel">
            <span className="filmstrip-title">图片列表 Filmstrip</span>
            
            <div className="filmstrip-scroll">
              {sessionList.map((item, idx) => (
                <div
                  key={item.id}
                  className={`thumb-card ${activeIndex === idx ? "active" : ""}`}
                  onClick={() => setActiveIndex(idx)}
                >
                  {/* Generate simple visual indicator of image */}
                  <img
                    className="thumb-img"
                    src={
                      item.processedResult
                        ? (() => {
                            const c = document.createElement("canvas");
                            drawRawImageToCanvas(item.processedResult.result, c);
                            return c.toDataURL("image/png");
                          })()
                        : (() => {
                            const c = document.createElement("canvas");
                            drawRawImageToCanvas(item.originalImage, c);
                            return c.toDataURL("image/png");
                          })()
                    }
                    alt={item.name}
                  />
                  <button
                    className="thumb-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionList((prev) => prev.filter((_, i) => i !== idx));
                      if (activeIndex >= idx) {
                        setActiveIndex((prev) => Math.max(0, prev - 1));
                      }
                      if (sessionList.length <= 1) {
                        setActiveIndex(-1);
                      }
                      showToast(`Removed "${item.name}"`);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              
              {/* Quick Add More button */}
              <div
                className="thumb-card"
                style={{ borderStyle: "dashed", fontSize: "1.5rem", color: "var(--muted)" }}
                onClick={() => document.getElementById("file-loader-quick")?.click()}
              >
                +
                <input
                  type="file"
                  id="file-loader-quick"
                  multiple
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
              </div>
            </div>

            <div className="filmstrip-actions">
              {activeItem && activeItem.status === "success" && (
                <div className="action-dropdown">
                  <button className="action-main" onClick={() => handleDownload(1)}>下载当前图</button>
                  <select
                    className="action-arrow"
                    style={{backgroundColor: 'var(--accent-hover)', border: 'none', color: 'white', padding: '8px', cursor: 'pointer', outline: 'none'}}
                    onChange={(e) => {
                      const scale = parseInt(e.target.value);
                      if (scale > 0) handleDownload(scale);
                      e.target.value = "0";
                    }}
                  >
                    <option value="0">缩放倍率 Export Scale</option>
                    <option value="1">x1 原始像素</option>
                    <option value="2">x2 缩放</option>
                    <option value="4">x4 缩放</option>
                    <option value="8">x8 缩放</option>
                    <option value="16">x16 缩放</option>
                    <option value="32">x32 缩放</option>
                  </select>
                </div>
              )}

              {sessionList.length > 0 && (
                <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                  <select
                    className="form-select"
                    style={{padding: '6px 10px', fontSize: '0.8rem', width: 'auto'}}
                    value={exportScale}
                    onChange={(e) => setExportScale(parseInt(e.target.value))}
                  >
                    <option value="1">导出 x1 ZIP</option>
                    <option value="2">导出 x2 ZIP</option>
                    <option value="4">导出 x4 ZIP</option>
                    <option value="8">导出 x8 ZIP</option>
                    <option value="16">导出 x16 ZIP</option>
                  </select>
                  <button className="nav-btn primary" onClick={handleDownloadAll} style={{padding: '8px 14px'}}>
                    📦 批量导出打包
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// Copy color swatch helper
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(
    () => {
      // Global alert fallback
      const notification = document.createElement("div");
      notification.textContent = `Hex ${text} copied to clipboard!`;
      notification.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #10b981;
        color: white;
        padding: 10px 16px;
        border-radius: 4px;
        font-size: 0.8rem;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2500);
    }
  );
}
