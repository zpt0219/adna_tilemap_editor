import React, { useRef, useEffect, useState } from "react";
import { Point, Layer, ToolType, RGBA } from "./types";
import { getBresenhamLine, getRectPoints, getCirclePoints } from "./utils/drawHelpers";
import { floodFill } from "./utils/floodFill";

interface CanvasViewProps {
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: string;
  tool: ToolType;
  brushSize: number;
  primaryColor: RGBA;
  secondaryColor: RGBA;
  showGrid: boolean;
  onUpdateLayerPixels: (layerId: string, newPixels: ImageData) => void;
  onCommitHistory: () => void;
  onPickColor: (color: RGBA) => void;
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  width,
  height,
  layers,
  activeLayerId,
  tool,
  brushSize,
  primaryColor,
  secondaryColor,
  showGrid,
  onUpdateLayerPixels,
  onCommitHistory,
  onPickColor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Zoom and Pan states
  const [zoom, setZoom] = useState<number>(12);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  // Drawing states
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawButton, setDrawButton] = useState<number>(0); // 0 = left click (primary), 2 = right click (secondary)
  const [lastPoint, setLastPoint] = useState<Point | null>(null);
  const [startPoint, setStartPoint] = useState<Point | null>(null); // For shapes
  const [previewPoints, setPreviewPoints] = useState<Point[]>([]);

  // Calculate default zoom and reset pan on dimensions change
  useEffect(() => {
    if (containerRef.current) {
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      const newZoom = Math.max(1, Math.min(64, Math.floor(Math.min(containerW, containerH) * 0.75 / Math.max(width, height))));
      setZoom(newZoom);
      setPan({ x: 0, y: 0 });
    }
  }, [width, height]);

  // Track spacebar for panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isSpacePressed) {
        // Prevent default spacebar scrolling
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isSpacePressed]);

  // Composite layers and render to display canvas
  const drawComposite = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Create temporary offscreen canvas for layer compositing (handles layer opacity)
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;

    // Draw layers from bottom (index 0) to top
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.visible || layer.opacity === 0) continue;

      tempCtx.clearRect(0, 0, width, height);
      tempCtx.putImageData(layer.pixels, 0, 0);

      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(tempCanvas, 0, 0);
    }

    // Reset alpha
    ctx.globalAlpha = 1.0;

    // Draw preview points if any (for shapes)
    if (previewPoints.length > 0) {
      const color = drawButton === 2 ? secondaryColor : primaryColor;
      const r = color.r;
      const g = color.g;
      const b = color.b;
      const a = Math.round(color.a * 255);

      const previewImgData = ctx.getImageData(0, 0, width, height);
      const data = previewImgData.data;

      previewPoints.forEach((pt) => {
        // Draw centered on pt based on brush size
        const halfMinus = Math.floor(-(brushSize - 1) / 2);
        const halfPlus = Math.ceil((brushSize - 1) / 2);

        for (let dy = halfMinus; dy <= halfPlus; dy++) {
          for (let dx = halfMinus; dx <= halfPlus; dx++) {
            const px = Math.round(pt.x + dx);
            const py = Math.round(pt.y + dy);

            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              if (tool === "eraser") {
                // Erase preview
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 0;
              } else {
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = a;
              }
            }
          }
        }
      });

      tempCtx.clearRect(0, 0, width, height);
      tempCtx.putImageData(previewImgData, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0);
    }
  };

  // Redraw whenever layers or previews change
  useEffect(() => {
    drawComposite();
  }, [layers, width, height, previewPoints, tool, brushSize, primaryColor, secondaryColor, drawButton]);

  // Zoom Handler
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    let newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
    newZoom = Math.max(1, Math.min(128, newZoom));
    setZoom(newZoom);
  };

  // Convert client cursor to grid coordinate
  const getGridCoords = (clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * height);

    return { x, y };
  };

  // Color picker implementation
  const pickColorAt = (pt: Point) => {
    if (pt.x < 0 || pt.x >= width || pt.y < 0 || pt.y >= height) return;

    // Search top-to-bottom for the first colored pixel
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible) continue;
      const idx = (pt.y * width + pt.x) * 4;
      const a = layer.pixels.data[idx + 3];
      if (a > 0) {
        onPickColor({
          r: layer.pixels.data[idx],
          g: layer.pixels.data[idx + 1],
          b: layer.pixels.data[idx + 2],
          a: a / 255,
        });
        return;
      }
    }
    // Default transparent pick
    onPickColor({ r: 0, g: 0, b: 0, a: 0 });
  };

  // Draw brush stroke on ImageData
  const drawBrushStroke = (pixels: ImageData, pt: Point, color: RGBA, isEraser: boolean) => {
    const data = pixels.data;
    const halfMinus = Math.floor(-(brushSize - 1) / 2);
    const halfPlus = Math.ceil((brushSize - 1) / 2);

    for (let dy = halfMinus; dy <= halfPlus; dy++) {
      for (let dx = halfMinus; dx <= halfPlus; dx++) {
        const px = pt.x + dx;
        const py = pt.y + dy;

        if (px >= 0 && px < width && py >= 0 && py < height) {
          const idx = (py * width + px) * 4;
          if (isEraser) {
            data[idx] = 0;
            data[idx + 1] = 0;
            data[idx + 2] = 0;
            data[idx + 3] = 0;
          } else {
            data[idx] = color.r;
            data[idx + 1] = color.g;
            data[idx + 2] = color.b;
            data[idx + 3] = Math.round(color.a * 255);
          }
        }
      }
    }
  };

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent) => {
    // Determine if we should pan
    const isMiddleClick = e.button === 1;
    if (isSpacePressed || isMiddleClick) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      // Capture pointer
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0 && e.button !== 2) return; // Only left/right click

    const pt = getGridCoords(e.clientX, e.clientY);
    if (!pt) return;

    // Lock pointer capture for drawing continuity
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const isRightClick = e.button === 2;
    const buttonUsed = isRightClick ? 2 : 0;
    setDrawButton(buttonUsed);

    const activeLayer = layers.find((l) => l.id === activeLayerId);
    if (!activeLayer) return;

    setIsDrawing(true);
    setLastPoint(pt);
    setStartPoint(pt);

    const color = isRightClick ? secondaryColor : primaryColor;

    if (tool === "picker") {
      pickColorAt(pt);
    } else if (tool === "bucket") {
      const clonedPixels = new ImageData(
        new Uint8ClampedArray(activeLayer.pixels.data),
        width,
        height
      );
      floodFill(clonedPixels, pt, color);
      onUpdateLayerPixels(activeLayerId, clonedPixels);
      onCommitHistory();
    } else if (tool === "pen" || tool === "eraser") {
      const clonedPixels = new ImageData(
        new Uint8ClampedArray(activeLayer.pixels.data),
        width,
        height
      );
      drawBrushStroke(clonedPixels, pt, color, tool === "eraser");
      onUpdateLayerPixels(activeLayerId, clonedPixels);
    }
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    if (!isDrawing) return;

    const pt = getGridCoords(e.clientX, e.clientY);
    if (!pt) return;

    const activeLayer = layers.find((l) => l.id === activeLayerId);
    if (!activeLayer) return;

    const color = drawButton === 2 ? secondaryColor : primaryColor;

    if (tool === "picker") {
      pickColorAt(pt);
    } else if (tool === "pen" || tool === "eraser") {
      if (lastPoint) {
        const clonedPixels = new ImageData(
          new Uint8ClampedArray(activeLayer.pixels.data),
          width,
          height
        );
        // Interpolate points between last and current to prevent gaps
        const linePoints = getBresenhamLine(lastPoint, pt);
        linePoints.forEach((p) => {
          drawBrushStroke(clonedPixels, p, color, tool === "eraser");
        });
        onUpdateLayerPixels(activeLayerId, clonedPixels);
      }
      setLastPoint(pt);
    } else if (tool === "line") {
      if (startPoint) {
        setPreviewPoints(getBresenhamLine(startPoint, pt));
      }
    } else if (tool === "rect") {
      if (startPoint) {
        setPreviewPoints(getRectPoints(startPoint, pt, false));
      }
    } else if (tool === "circle") {
      if (startPoint) {
        setPreviewPoints(getCirclePoints(startPoint, pt, false));
      }
    }
  };

  // Pointer Up
  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    const activeLayer = layers.find((l) => l.id === activeLayerId);
    if (!activeLayer) {
      setPreviewPoints([]);
      setStartPoint(null);
      setLastPoint(null);
      return;
    }

    const color = drawButton === 2 ? secondaryColor : primaryColor;

    // For shapes, commit them on mouse release
    if (previewPoints.length > 0) {
      const clonedPixels = new ImageData(
        new Uint8ClampedArray(activeLayer.pixels.data),
        width,
        height
      );
      previewPoints.forEach((pt) => {
        drawBrushStroke(clonedPixels, pt, color, tool === "eraser");
      });
      onUpdateLayerPixels(activeLayerId, clonedPixels);
    }

    setPreviewPoints([]);
    setStartPoint(null);
    setLastPoint(null);

    // Commit change to undo/redo history
    if (tool !== "picker") {
      onCommitHistory();
    }
  };

  // Prevent right-click context menu inside drawing area
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const canvasStyle: React.CSSProperties = {
    width: `${width * zoom}px`,
    height: `${height * zoom}px`,
    transform: `translate(${pan.x}px, ${pan.y}px)`,
    imageRendering: "pixelated",
  };

  const gridOverlayStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    backgroundSize: `${zoom}px ${zoom}px`,
    backgroundImage: `
      linear-gradient(to right, rgba(255, 255, 255, 0.12) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.12) 1px, transparent 1px)
    `,
  };

  return (
    <div
      ref={containerRef}
      className="viewport-container"
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
    >
      <div
        className={`checkerboard-bg ${isSpacePressed || isPanning ? "panning" : ""}`}
        style={canvasStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {showGrid && zoom >= 4 && <div style={gridOverlayStyle} />}
      </div>

      {/* Floating Viewport Status overlay */}
      <div className="status-bar" style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(28, 31, 38, 0.85)", backdropFilter: "blur(4px)" }}>
        <div className="status-bar-item">
          <span>尺寸: {width} x {height} px</span>
        </div>
        <div className="status-bar-item">
          <span>缩放: {Math.round((zoom / 1) * 100)}%</span>
          <span style={{ margin: "0 8px", color: "var(--line)" }}>|</span>
          <span>按住 空格 拖拽平移</span>
        </div>
      </div>
    </div>
  );
};
export default CanvasView;
