import { useCallback, useEffect, useRef, useState } from "react";
import type { LiteObject, LiteTileMap, Rect } from "../model";
import { findObject, isLocked, roleOf } from "../model";
import type { RGB } from "../generated/roleColors";
import {
  buildHitGrid,
  drawMap,
  fitView,
  objectAt,
  renderScene,
  renderSceneRegion,
  sceneScaleFor,
  screenToTile,
  tileToScreen,
  type HitGrid,
  type View,
} from "../render";

export interface BrushState {
  rgb: RGB;
  size: number;
  erase: boolean;
  /** true when the selected object is a terrain object (so LMB paints) */
  ready: boolean;
}

interface Props {
  map: LiteTileMap;
  version: number;
  brush: BrushState;
  selected: Set<number>;
  onSelect: (id: number | null, additive: boolean) => void;
  onMove: (id: number, before: [number, number], after: [number, number]) => void;
  onResize: (id: number, before: Rect, after: Rect) => void;
  onToggleLock: () => void;
  onStrokeStart: (tx: number, ty: number) => void;
  onStrokePaint: (tx: number, ty: number) => void;
  onStrokeEnd: () => void;
}

interface Edges { l: boolean; r: boolean; t: boolean; b: boolean; }

interface Gesture {
  mode: "pan" | "move" | "resize" | "paint";
  downX: number;
  downY: number;
  downFx: number;
  downFy: number;
  lastX: number;
  lastY: number;
  lastTx?: number;
  lastTy?: number;
  moved: boolean;
  id?: number;
  startRect?: Rect;
  edges?: Edges;
}

interface SelBox { x: number; y: number; id: number; }

const MIN_SCALE = 0.5;
const MAX_SCALE = 64;
const CLICK_SLOP = 4;
const EDGE_MARGIN = 6; // px grab zone around a FIXED_RECT edge

const isTerrain = (o: LiteObject) => o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE";

// Which edges of `rect` (screen px) the cursor is near, or inside/outside.
function edgeGrab(view: View, rect: Rect, sx: number, sy: number): Edges | "inside" | "outside" {
  const [px, py] = tileToScreen(view, rect[0], rect[1]);
  const right = px + rect[2] * view.scale;
  const bottom = py + rect[3] * view.scale;
  if (sx < px - EDGE_MARGIN || sx > right + EDGE_MARGIN || sy < py - EDGE_MARGIN || sy > bottom + EDGE_MARGIN)
    return "outside";
  const l = Math.abs(sx - px) <= EDGE_MARGIN;
  const r = Math.abs(sx - right) <= EDGE_MARGIN;
  const t = Math.abs(sy - py) <= EDGE_MARGIN;
  const b = Math.abs(sy - bottom) <= EDGE_MARGIN;
  return l || r || t || b ? { l, r, t, b } : "inside";
}

function resizeRect(start: Rect, e: Edges, dx: number, dy: number, mapW: number, mapH: number): Rect {
  let [x, y, w, h] = start;
  if (e.l) { x += dx; w -= dx; }
  if (e.r) { w += dx; }
  if (e.t) { y += dy; h -= dy; }
  if (e.b) { h += dy; }
  if (w < 1) { if (e.l) x = start[0] + start[2] - 1; w = 1; }
  if (h < 1) { if (e.t) y = start[1] + start[3] - 1; h = 1; }
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > mapW) w = mapW - x;
  if (y + h > mapH) h = mapH - y;
  return [x, y, Math.max(1, w), Math.max(1, h)];
}

// Tile rect covered by an N×N brush at (tx,ty), clamped to the map.
function brushTileRect(tx: number, ty: number, size: number, mapW: number, mapH: number): Rect {
  const r = Math.floor(size / 2);
  const x0 = Math.max(0, tx - r), y0 = Math.max(0, ty - r);
  const x1 = Math.min(mapW, tx + r + 1), y1 = Math.min(mapH, ty + r + 1);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

function mergeRect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0] + a[2], b[0] + b[2]), y1 = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x0, y0, x1 - x0, y1 - y0];
}

function cursorFor(edges: Edges | "inside" | "outside"): string {
  if (edges === "inside") return "move";
  if (edges === "outside") return "default";
  const { l, r, t, b } = edges;
  if ((l && t) || (r && b)) return "nwse-resize";
  if ((r && t) || (l && b)) return "nesw-resize";
  if (l || r) return "ew-resize";
  if (t || b) return "ns-resize";
  return "default";
}

export function CanvasView({
  map, version, brush, selected,
  onSelect, onMove, onResize, onToggleLock, onStrokeStart, onStrokePaint, onStrokeEnd,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ scale: 8, offX: 0, offY: 0 });
  const hitRef = useRef<HitGrid>(buildHitGrid(map));
  // Cached static scene (KRAFT + objects + terrain); blitted every frame. Only
  // re-rendered when map data changes: a full re-render for structural edits, or
  // a dirty-rect region update for paint strokes (cf. desktop dirty_region_).
  const sceneRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const sceneScaleRef = useRef(sceneScaleFor(map));
  const sceneFullDirtyRef = useRef(true);
  const sceneRectDirtyRef = useRef<Rect | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const hoverTileRef = useRef<[number, number] | null>(null);
  const ghostRef = useRef<Rect | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const rafRef = useRef(0);
  const lastSelBox = useRef<string>("");
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const [hover, setHover] = useState<{ tx: number; ty: number; role: string; type: string } | null>(null);
  const [selBox, setSelBox] = useState<SelBox | null>(null);

  const primarySel = useCallback((): LiteObject | null => {
    const s = selectedRef.current;
    if (s.size === 0) return null;
    return findObject(map, [...s][0]);
  }, [map]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const { w, h, dpr } = sizeRef.current;
      const s = sceneScaleRef.current;
      if (sceneFullDirtyRef.current) {
        renderScene(sceneRef.current, map, s);
        sceneFullDirtyRef.current = false;
        sceneRectDirtyRef.current = null;
      } else if (sceneRectDirtyRef.current) {
        renderSceneRegion(sceneRef.current, map, s, sceneRectDirtyRef.current);
        sceneRectDirtyRef.current = null;
      }
      const ht = hoverTileRef.current;
      const showBrush = brushRef.current.ready && ht && gestureRef.current?.mode !== "move" && gestureRef.current?.mode !== "resize";
      drawMap(ctx, map, sceneRef.current, viewRef.current, w, h, dpr, {
        hoverTile: ht,
        selected,
        ghost: ghostRef.current,
        brush: showBrush
          ? { tx: ht[0], ty: ht[1], size: brushRef.current.size, rgb: brushRef.current.rgb, erase: brushRef.current.erase }
          : null,
      });
      let box: SelBox | null = null;
      if (selected.size > 0) {
        const o = findObject(map, [...selected][0]);
        if (o) {
          const [sx, sy] = tileToScreen(viewRef.current, o.rect[0], o.rect[1]);
          box = { x: sx, y: sy, id: o.id };
        }
      }
      const key = box ? `${Math.round(box.x)},${Math.round(box.y)},${box.id}` : "";
      if (key !== lastSelBox.current) { lastSelBox.current = key; setSelBox(box); }
    });
  }, [map, selected]);

  const resize = useCallback(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    sizeRef.current = { w, h, dpr };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    hitRef.current = buildHitGrid(map);
    sceneScaleRef.current = sceneScaleFor(map);
    sceneFullDirtyRef.current = true;
    sceneRectDirtyRef.current = null;
    const wrap = wrapRef.current;
    if (wrap) viewRef.current = fitView(map, wrap.clientWidth, wrap.clientHeight);
    hoverTileRef.current = null;
    ghostRef.current = null;
    setHover(null);
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => { hitRef.current = buildHitGrid(map); sceneFullDirtyRef.current = true; scheduleDraw(); /* eslint-disable-line */ }, [version]);
  useEffect(() => { scheduleDraw(); }, [selected, scheduleDraw]);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [resize]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const v = viewRef.current;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * Math.exp(-e.deltaY * 0.0015)));
    const [wtx, wty] = screenToTile(v, sx, sy);
    viewRef.current = { scale: next, offX: sx - wtx * next, offY: sy - wty * next };
    scheduleDraw();
  }, [scheduleDraw]);

  // Cursor hint based on the selected object under the pointer (no active gesture).
  const updateCursor = useCallback((sx: number, sy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (gestureRef.current) return;
    const sel = primarySel();
    let cur = "default";
    if (sel && brushRef.current.ready && !isLocked(sel)) cur = "crosshair";
    else if (sel && sel.type === "FIXED_RECT" && !isLocked(sel)) cur = cursorFor(edgeGrab(viewRef.current, sel.rect, sx, sy));
    canvas.style.cursor = cur;
  }, [primarySel]);

  const updateHover = useCallback((sx: number, sy: number) => {
    const [ftx, fty] = screenToTile(viewRef.current, sx, sy);
    const tx = Math.floor(ftx), ty = Math.floor(fty);
    const prev = hoverTileRef.current;
    if (!prev || prev[0] !== tx || prev[1] !== ty) {
      hoverTileRef.current = [tx, ty];
      const o = objectAt(hitRef.current, tx, ty);
      setHover({ tx, ty, role: o ? roleOf(o) : "", type: o?.type ?? "" });
      scheduleDraw();
    }
  }, [scheduleDraw]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [fx, fy] = screenToTile(viewRef.current, sx, sy);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const g: Gesture = { mode: "pan", downX: e.clientX, downY: e.clientY, downFx: fx, downFy: fy, lastX: e.clientX, lastY: e.clientY, moved: false };

    if (e.button === 1) { gestureRef.current = g; return; } // middle = pan

    if (e.button === 2) {
      // RMB = select + move
      e.preventDefault();
      const hit = objectAt(hitRef.current, tx, ty);
      onSelect(hit ? hit.id : null, false);
      if (hit && !isLocked(hit)) { g.mode = "move"; g.id = hit.id; g.startRect = hit.rect; ghostRef.current = hit.rect; }
      gestureRef.current = g;
      return;
    }

    // LMB = act on the selected object by type
    const sel = primarySel();
    if (!sel || isLocked(sel)) { gestureRef.current = null; return; }
    if (isTerrain(sel)) {
      g.mode = "paint"; g.lastTx = tx; g.lastTy = ty;
      gestureRef.current = g;
      onStrokeStart(tx, ty);
      sceneRectDirtyRef.current = mergeRect(sceneRectDirtyRef.current, brushTileRect(tx, ty, brushRef.current.size, map.width, map.height));
      scheduleDraw();
      return;
    }
    if (sel.type === "FIXED_RECT") {
      const grab = edgeGrab(viewRef.current, sel.rect, sx, sy);
      if (grab === "outside") { gestureRef.current = null; return; }
      g.id = sel.id; g.startRect = sel.rect; ghostRef.current = sel.rect;
      g.mode = grab === "inside" ? "move" : "resize";
      if (grab !== "inside") g.edges = grab;
      gestureRef.current = g;
      return;
    }
    // FRG / DUNGEON: interior move
    g.mode = "move"; g.id = sel.id; g.startRect = sel.rect; ghostRef.current = sel.rect;
    gestureRef.current = g;
  }, [map.width, map.height, onSelect, onStrokeStart, primarySel, scheduleDraw]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const g = gestureRef.current;
    if (g) {
      if (!g.moved && Math.hypot(e.clientX - g.downX, e.clientY - g.downY) > CLICK_SLOP) g.moved = true;
      if (g.mode === "paint") {
        const tx = Math.floor((sx - viewRef.current.offX) / viewRef.current.scale);
        const ty = Math.floor((sy - viewRef.current.offY) / viewRef.current.scale);
        if (tx !== g.lastTx || ty !== g.lastTy) {
          g.lastTx = tx; g.lastTy = ty;
          onStrokePaint(tx, ty);
          sceneRectDirtyRef.current = mergeRect(sceneRectDirtyRef.current, brushTileRect(tx, ty, brushRef.current.size, map.width, map.height));
        }
        scheduleDraw();
      } else if ((g.mode === "move" || g.mode === "resize") && g.startRect) {
        const [fx, fy] = screenToTile(viewRef.current, sx, sy);
        const dx = Math.round(fx - g.downFx), dy = Math.round(fy - g.downFy);
        if (g.mode === "move") ghostRef.current = [g.startRect[0] + dx, g.startRect[1] + dy, g.startRect[2], g.startRect[3]];
        else ghostRef.current = resizeRect(g.startRect, g.edges!, dx, dy, map.width, map.height);
        scheduleDraw();
      } else if (g.mode === "pan") {
        const v = viewRef.current;
        viewRef.current = { ...v, offX: v.offX + (e.clientX - g.lastX), offY: v.offY + (e.clientY - g.lastY) };
        g.lastX = e.clientX; g.lastY = e.clientY;
        scheduleDraw();
      }
    } else {
      updateCursor(sx, sy);
    }
    updateHover(sx, sy);
  }, [map.width, map.height, onStrokePaint, scheduleDraw, updateCursor, updateHover]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    if (g.mode === "paint") { onStrokeEnd(); return; }
    if ((g.mode === "move" || g.mode === "resize") && g.id != null && g.startRect) {
      const ghost = ghostRef.current; ghostRef.current = null;
      if (g.moved && ghost) {
        if (g.mode === "move") {
          const [x, y, w, h] = ghost;
          const onMap = x >= 0 && y >= 0 && x + w <= map.width && y + h <= map.height;
          if (onMap && (x !== g.startRect[0] || y !== g.startRect[1])) onMove(g.id, [g.startRect[0], g.startRect[1]], [x, y]);
        } else if (ghost[0] !== g.startRect[0] || ghost[1] !== g.startRect[1] || ghost[2] !== g.startRect[2] || ghost[3] !== g.startRect[3]) {
          onResize(g.id, g.startRect, ghost);
        }
      }
      scheduleDraw();
    }
  }, [map.width, map.height, onMove, onResize, onStrokeEnd, scheduleDraw]);

  const onPointerLeave = useCallback(() => { hoverTileRef.current = null; setHover(null); scheduleDraw(); }, [scheduleDraw]);
  const resetView = useCallback(() => {
    const wrap = wrapRef.current;
    if (wrap) viewRef.current = fitView(map, wrap.clientWidth, wrap.clientHeight);
    scheduleDraw();
  }, [map, scheduleDraw]);

  const selObj: LiteObject | null = selBox ? findObject(map, selBox.id) : null;
  const locked = selObj ? isLocked(selObj) : false;

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      <button className="reset-view" onClick={resetView} title="重置视图(Fit)">⤢ Fit</button>

      {selObj && selBox && (
        <div className="obj-toolbar" style={{ left: selBox.x, top: selBox.y - 36 }}>
          <span className="ot-type">{selObj.type.replace(/_/g, " ").toLowerCase()}</span>
          {roleOf(selObj) && <code className="ot-role">{roleOf(selObj)}</code>}
          <button onClick={onToggleLock} className={locked ? "active" : ""}>
            {locked ? "🔒 Unlock" : "🔓 Lock"}
          </button>
        </div>
      )}

      <div className="status">
        <span>
          {map.width}×{map.height} tiles
          {map.sizeInferred && <em className="muted"> (尺寸按内容推断)</em>}
        </span>
        {hover && (
          <span className="hover">
            ({hover.tx}, {hover.ty})
            {hover.role && <> · role <code>{hover.role}</code></>}
            {hover.type && <> · {hover.type.replace(/_/g, " ").toLowerCase()}</>}
          </span>
        )}
      </div>
    </div>
  );
}
