import React, { useState, useRef, useEffect } from "react";
import { CanvasView } from "./CanvasView";
import { Layer, ToolType, RGBA } from "./types";
import { HistoryManager } from "./utils/history";
import "./styles.css";

// Pico-8 & DB32 hybrid palette - 32 rich pixel art colors
const PRESET_COLORS: string[] = [
  "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
  "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
  "#291814", "#4b2416", "#81421f", "#8f9779", "#4fa4a5", "#1a507f", "#73419c", "#ff4f78",
  "#ffd36e", "#7ffcff", "#ffffff", "#8b9bb4", "#4b692f", "#373737", "#222222", "#0a0a0a"
];

function rgbaToHex(c: RGBA): string {
  const r = c.r.toString(16).padStart(2, "0");
  const g = c.g.toString(16).padStart(2, "0");
  const b = c.b.toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function hexToRgba(hex: string, alpha = 1.0): RGBA {
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((char) => char + char).join("");
  }
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return { r, g, b, a: alpha };
}

export const PixelEditor: React.FC = () => {
  // Canvas Size
  const [width, setWidth] = useState<number>(32);
  const [height, setHeight] = useState<number>(32);

  // Layers
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string>("");
  const [editingLayerId, setEditingLayerId] = useState<string>("");
  const [editNameText, setEditNameText] = useState<string>("");

  // Tools & Settings
  const [tool, setTool] = useState<ToolType>("pen");
  const [brushSize, setBrushSize] = useState<number>(1);
  const [primaryColor, setPrimaryColor] = useState<RGBA>({ r: 255, g: 255, b: 255, a: 1.0 });
  const [secondaryColor, setSecondaryColor] = useState<RGBA>({ r: 0, g: 0, b: 0, a: 0.0 }); // transparent default
  const [colorMode, setColorMode] = useState<"primary" | "secondary">("primary");
  const [showGrid, setShowGrid] = useState<boolean>(true);

  // History stack
  const historyManager = useRef<HistoryManager>(new HistoryManager(50));
  const [, setHistoryVersion] = useState<number>(0);

  // Modals
  const [isResizeModalOpen, setIsResizeModalOpen] = useState<boolean>(false);
  const [resizeWidthInput, setResizeWidthInput] = useState<number>(32);
  const [resizeHeightInput, setResizeHeightInput] = useState<number>(32);

  // Initialize first layer on mount
  useEffect(() => {
    const defaultLayerId = "layer-1";
    const initialLayer: Layer = {
      id: defaultLayerId,
      name: "图层 1",
      visible: true,
      opacity: 1.0,
      pixels: new ImageData(width, height),
    };
    const initialLayers = [initialLayer];
    setLayers(initialLayers);
    setActiveLayerId(defaultLayerId);

    historyManager.current.init(initialLayers, defaultLayerId);
    setHistoryVersion(0);
  }, []);

  // Update history changes
  const commitHistory = () => {
    historyManager.current.pushState(layers, activeLayerId);
    setHistoryVersion((v) => v + 1);
  };

  // Undo / Redo
  const handleUndo = () => {
    const prev = historyManager.current.undo();
    if (prev) {
      setLayers(prev.layers);
      setActiveLayerId(prev.activeLayerId);
      setHistoryVersion((v) => v + 1);
    }
  };

  const handleRedo = () => {
    const next = historyManager.current.redo();
    if (next) {
      setLayers(next.layers);
      setActiveLayerId(next.activeLayerId);
      setHistoryVersion((v) => v + 1);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts if writing in input
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (cmdOrCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      } else if (!cmdOrCtrl && !e.altKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "b":
            setTool("pen");
            break;
          case "e":
            setTool("eraser");
            break;
          case "g":
            setTool("bucket");
            break;
          case "i":
            setTool("picker");
            break;
          case "l":
            setTool("line");
            break;
          case "r":
            setTool("rect");
            break;
          case "c":
            setTool("circle");
            break;
          case "h":
            setShowGrid((prev) => !prev);
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [layers, activeLayerId]);

  // Update pixels directly from CanvasView drawing
  const updateLayerPixels = (layerId: string, newPixels: ImageData) => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => (l.id === layerId ? { ...l, pixels: newPixels } : l))
    );
  };

  // Layer Management actions
  const addLayer = () => {
    const newId = `layer-${Date.now()}`;
    const newLayer: Layer = {
      id: newId,
      name: `图层 ${layers.length + 1}`,
      visible: true,
      opacity: 1.0,
      pixels: new ImageData(width, height),
    };
    const nextLayers = [...layers, newLayer];
    setLayers(nextLayers);
    setActiveLayerId(newId);

    // Commit to history
    historyManager.current.pushState(nextLayers, newId);
    setHistoryVersion((v) => v + 1);
  };

  const deleteLayer = (id: string) => {
    if (layers.length <= 1) return;

    const nextLayers = layers.filter((l) => l.id !== id);
    let nextActiveId = activeLayerId;
    if (activeLayerId === id) {
      const idx = layers.findIndex((l) => l.id === id);
      nextActiveId = layers[idx === 0 ? 1 : idx - 1].id;
    }

    setLayers(nextLayers);
    setActiveLayerId(nextActiveId);

    // Commit to history
    historyManager.current.pushState(nextLayers, nextActiveId);
    setHistoryVersion((v) => v + 1);
  };

  const toggleLayerVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextLayers = layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    setLayers(nextLayers);
    // Committing to history is not strictly necessary for visibility, but keeps state simple
    historyManager.current.pushState(nextLayers, activeLayerId);
    setHistoryVersion((v) => v + 1);
  };

  const handleLayerOpacityChange = (id: string, opacity: number) => {
    const nextLayers = layers.map((l) => (l.id === id ? { ...l, opacity } : l));
    setLayers(nextLayers);
  };

  const commitLayerOpacity = () => {
    commitHistory();
  };

  const startRenameLayer = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingLayerId(id);
    setEditNameText(currentName);
  };

  const finishRenameLayer = (id: string) => {
    if (!editNameText.trim()) {
      setEditingLayerId("");
      return;
    }
    const nextLayers = layers.map((l) => (l.id === id ? { ...l, name: editNameText } : l));
    setLayers(nextLayers);
    setEditingLayerId("");
    historyManager.current.pushState(nextLayers, activeLayerId);
    setHistoryVersion((v) => v + 1);
  };

  const moveLayerOrder = (index: number, direction: "up" | "down", e: React.MouseEvent) => {
    e.stopPropagation();
    const targetIdx = direction === "up" ? index + 1 : index - 1;
    if (targetIdx < 0 || targetIdx >= layers.length) return;

    const nextLayers = [...layers];
    const temp = nextLayers[index];
    nextLayers[index] = nextLayers[targetIdx];
    nextLayers[targetIdx] = temp;

    setLayers(nextLayers);
    historyManager.current.pushState(nextLayers, activeLayerId);
    setHistoryVersion((v) => v + 1);
  };

  // Dimensions resizing / clearing
  const handleOpenResizeModal = () => {
    setResizeWidthInput(width);
    setResizeHeightInput(height);
    setIsResizeModalOpen(true);
  };

  const handleConfirmResize = (mode: "crop" | "clear") => {
    const w = Math.max(1, Math.min(256, resizeWidthInput));
    const h = Math.max(1, Math.min(256, resizeHeightInput));

    if (mode === "clear") {
      // Clear all layers, create single active layer of new dimensions
      const defaultLayerId = "layer-1";
      const initialLayer: Layer = {
        id: defaultLayerId,
        name: "图层 1",
        visible: true,
        opacity: 1.0,
        pixels: new ImageData(w, h),
      };
      const initialLayers = [initialLayer];
      setLayers(initialLayers);
      setActiveLayerId(defaultLayerId);
      setWidth(w);
      setHeight(h);
      historyManager.current.init(initialLayers, defaultLayerId);
    } else {
      // Crop/extend existing layers
      const nextLayers = layers.map((layer) => {
        const newImgData = new ImageData(w, h);
        const oldW = width;
        const oldData = layer.pixels.data;
        const newData = newImgData.data;

        const copyW = Math.min(oldW, w);
        const copyH = Math.min(height, h);

        for (let y = 0; y < copyH; y++) {
          for (let x = 0; x < copyW; x++) {
            const oldIdx = (y * oldW + x) * 4;
            const newIdx = (y * w + x) * 4;
            newData[newIdx] = oldData[oldIdx];
            newData[newIdx + 1] = oldData[oldIdx + 1];
            newData[newIdx + 2] = oldData[oldIdx + 2];
            newData[newIdx + 3] = oldData[oldIdx + 3];
          }
        }
        return {
          ...layer,
          pixels: newImgData,
        };
      });

      setLayers(nextLayers);
      setWidth(w);
      setHeight(h);
      historyManager.current.init(nextLayers, activeLayerId);
    }

    setIsResizeModalOpen(false);
    setHistoryVersion((v) => v + 1);
  };

  // Export PNG helper
  const exportPNG = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;

    // Render layers from bottom to top
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.visible || layer.opacity === 0) continue;

      tempCtx.clearRect(0, 0, width, height);
      tempCtx.putImageData(layer.pixels, 0, 0);

      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(tempCanvas, 0, 0);
    }

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `adna-pixel-${width}x${height}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Selected Color Helpers
  const handleColorChange = (hex: string) => {
    const rgb = hexToRgba(hex);
    if (colorMode === "primary") {
      setPrimaryColor({ ...rgb, a: primaryColor.a });
    } else {
      setSecondaryColor({ ...rgb, a: secondaryColor.a });
    }
  };

  const handleColorPick = (color: RGBA) => {
    if (colorMode === "primary") {
      setPrimaryColor(color);
    } else {
      setSecondaryColor(color);
    }
  };

  // Undo / Redo active checks
  const canUndo = historyManager.current.getUndoCount() > 1;
  const canRedo = historyManager.current.getRedoCount() > 0;

  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="brand">
            <span className="brand-accent">Adna</span> Pixel Editor
          </div>
          <button className="btn" onClick={() => window.location.href = "/"}>
            ↩ 首页
          </button>
        </div>

        <div className="top-bar-center">
          <button className="btn" disabled={!canUndo} onClick={handleUndo} title="撤销 (Ctrl+Z)">
            ↩ 撤销
          </button>
          <button className="btn" disabled={!canRedo} onClick={handleRedo} title="重做 (Ctrl+Y)">
            ↪ 重做
          </button>
          <div style={{ width: "1px", height: "18px", backgroundColor: "var(--line)", margin: "0 4px" }} />
          <button
            className={`btn ${showGrid ? "active" : ""}`}
            onClick={() => setShowGrid(!showGrid)}
            title="网格显示 (G)"
          >
            # 网格
          </button>
          <button className="btn" onClick={handleOpenResizeModal}>
            📐 调整画布尺寸 ({width}x{height})
          </button>
        </div>

        <div className="top-bar-right">
          <button className="btn btn-primary" onClick={exportPNG}>
            💾 导出 PNG
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="main-workspace">
        {/* Left Toolbar */}
        <aside className="left-sidebar">
          <div className="tool-section">
            <button
              className={`btn btn-icon ${tool === "pen" ? "active" : ""}`}
              onClick={() => setTool("pen")}
              title="铅笔/笔刷 (B)"
            >
              ✏️
            </button>
            <button
              className={`btn btn-icon ${tool === "eraser" ? "active" : ""}`}
              onClick={() => setTool("eraser")}
              title="橡皮擦 (E)"
            >
              🧹
            </button>
            <button
              className={`btn btn-icon ${tool === "bucket" ? "active" : ""}`}
              onClick={() => setTool("bucket")}
              title="油漆桶 (G)"
            >
              🪣
            </button>
            <button
              className={`btn btn-icon ${tool === "picker" ? "active" : ""}`}
              onClick={() => setTool("picker")}
              title="吸色管 (I)"
            >
              🎯
            </button>
          </div>

          <div className="tool-divider" />

          <div className="tool-section">
            <button
              className={`btn btn-icon ${tool === "line" ? "active" : ""}`}
              onClick={() => setTool("line")}
              title="直线绘制 (L)"
            >
              ➖
            </button>
            <button
              className={`btn btn-icon ${tool === "rect" ? "active" : ""}`}
              onClick={() => setTool("rect")}
              title="矩形绘制 (R)"
            >
              ⬜
            </button>
            <button
              className={`btn btn-icon ${tool === "circle" ? "active" : ""}`}
              onClick={() => setTool("circle")}
              title="圆形绘制 (C)"
            >
              ⚪
            </button>
          </div>

          <div className="tool-divider" />

          {/* Brush Size Selector */}
          <div className="brush-size-control">
            <span>尺寸</span>
            <div className="brush-size-dots">
              {[1, 2, 3, 4].map((size) => (
                <div
                  key={size}
                  className={`brush-dot ${brushSize === size ? "active" : ""}`}
                  style={{ width: `${size * 2 + 3}px`, height: `${size * 2 + 3}px` }}
                  onClick={() => setBrushSize(size)}
                  title={`笔刷大小: ${size}px`}
                />
              ))}
            </div>
            <span>{brushSize}px</span>
          </div>
        </aside>

        {/* Canvas Center Area */}
        <CanvasView
          width={width}
          height={height}
          layers={layers}
          activeLayerId={activeLayerId}
          tool={tool}
          brushSize={brushSize}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          showGrid={showGrid}
          onUpdateLayerPixels={updateLayerPixels}
          onCommitHistory={commitHistory}
          onPickColor={handleColorPick}
        />

        {/* Right Sidebar */}
        <aside className="right-sidebar">
          {/* Colors Panel */}
          <section className="panel-section">
            <div className="panel-title">
              <span>颜色面板</span>
            </div>
            <div className="color-picker-container">
              <div className="color-preview-row">
                <div className="color-swaps">
                  {/* Secondary color box */}
                  <div
                    className="color-box secondary"
                    style={{ backgroundColor: rgbaToHex(secondaryColor) }}
                    onClick={() => setColorMode("secondary")}
                    title="背景/副色"
                  />
                  {/* Primary color box */}
                  <div
                    className="color-box primary"
                    style={{ backgroundColor: rgbaToHex(primaryColor) }}
                    onClick={() => setColorMode("primary")}
                    title="主色"
                  />
                </div>
                <input
                  type="text"
                  className="color-hex-input"
                  value={rgbaToHex(colorMode === "primary" ? primaryColor : secondaryColor)}
                  onChange={(e) => handleColorChange(e.target.value)}
                  maxLength={7}
                  placeholder="#ffffff"
                />
                <div style={{ position: "relative", width: "28px", height: "28px", overflow: "hidden", borderRadius: "50%", border: "1px solid var(--line)" }}>
                  <input
                    type="color"
                    className="color-box-input"
                    value={rgbaToHex(colorMode === "primary" ? primaryColor : secondaryColor)}
                    onChange={(e) => handleColorChange(e.target.value)}
                    style={{ position: "absolute", top: "-5px", left: "-5px", width: "40px", height: "40px", cursor: "pointer" }}
                  />
                  🎨
                </div>
              </div>

              {/* Preset Palette */}
              <div className="palette-grid">
                {PRESET_COLORS.map((hex) => (
                  <div
                    key={hex}
                    className="palette-swatch"
                    style={{ backgroundColor: hex }}
                    onClick={() => handleColorPick(hexToRgba(hex))}
                    title={hex}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Layers Panel */}
          <section className="panel-section" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="panel-title">
              <span>图层管理</span>
              <button className="btn" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={addLayer}>
                + 新建
              </button>
            </div>

            <div className="layers-list">
              {layers
                .slice()
                .reverse() // Draw top layers first in the UI list
                .map((layer, reverseIdx) => {
                  const idx = layers.length - 1 - reverseIdx;
                  const isActive = layer.id === activeLayerId;
                  const isEditing = layer.id === editingLayerId;

                  return (
                    <div
                      key={layer.id}
                      className={`layer-item ${isActive ? "active" : ""}`}
                      onClick={() => setActiveLayerId(layer.id)}
                    >
                      {/* Visibility Toggle */}
                      <button
                        className={`layer-visibility ${!layer.visible ? "hidden" : ""}`}
                        onClick={(e) => toggleLayerVisibility(layer.id, e)}
                        title={layer.visible ? "隐藏图层" : "显示图层"}
                      >
                        {layer.visible ? "👁️" : "🕶️"}
                      </button>

                      {/* Layer Name Display / Editor */}
                      {isEditing ? (
                        <input
                          type="text"
                          className="layer-name-input"
                          value={editNameText}
                          onChange={(e) => setEditNameText(e.target.value)}
                          onBlur={() => finishRenameLayer(layer.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishRenameLayer(layer.id);
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="layer-name"
                          onDoubleClick={(e) => startRenameLayer(layer.id, layer.name, e)}
                          title="双击重命名"
                        >
                          {layer.name}
                        </span>
                      )}

                      {/* Opacity slider */}
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(layer.opacity * 100)}
                        className="layer-opacity-slider"
                        onChange={(e) => handleLayerOpacityChange(layer.id, parseFloat(e.target.value) / 100)}
                        onMouseUp={commitLayerOpacity}
                        title={`透明度: ${Math.round(layer.opacity * 100)}%`}
                        onClick={(e) => e.stopPropagation()}
                      />

                      {/* Sorting Actions */}
                      <div className="layer-actions">
                        <button
                          className="layer-action-btn"
                          disabled={idx === layers.length - 1}
                          onClick={(e) => moveLayerOrder(idx, "up", e)}
                          title="上移一层"
                        >
                          ▲
                        </button>
                        <button
                          className="layer-action-btn"
                          disabled={idx === 0}
                          onClick={(e) => moveLayerOrder(idx, "down", e)}
                          title="下移一层"
                        >
                          ▼
                        </button>
                        <button
                          className="layer-action-btn"
                          disabled={layers.length <= 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteLayer(layer.id);
                          }}
                          title="删除图层"
                          style={{ color: "var(--danger)" }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        </aside>
      </main>

      {/* Resize Modal */}
      {isResizeModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">调整画布尺寸</div>
            <div className="modal-form-group">
              <label className="modal-form-label">宽度 (px, 限制 1-256)</label>
              <input
                type="number"
                className="color-hex-input"
                value={resizeWidthInput}
                min={1}
                max={256}
                onChange={(e) => setResizeWidthInput(parseInt(e.target.value) || 32)}
              />
            </div>
            <div className="modal-form-group">
              <label className="modal-form-label">高度 (px, 限制 1-256)</label>
              <input
                type="number"
                className="color-hex-input"
                value={resizeHeightInput}
                min={1}
                max={256}
                onChange={(e) => setResizeHeightInput(parseInt(e.target.value) || 32)}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-danger" onClick={() => setIsResizeModalOpen(false)}>
                取消
              </button>
              <button className="btn" onClick={() => handleConfirmResize("crop")}>
                裁剪/扩展画布
              </button>
              <button className="btn btn-primary" onClick={() => handleConfirmResize("clear")}>
                新建空白项目
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default PixelEditor;
