// render.ts — pure Canvas 2D drawing of a lite TileMap, reproducing the look of
// scripts/render_overlay.py (KRAFT parchment, role-colored shapes, tile grid)
// plus editor overlays (selection, lock badge, drag ghost). No React / DOM state.

import type { LiteObject, LiteTileMap, Rect } from "./model";
import { eachVisibleObject, isLocked, roleOf } from "./model";
import { colorForRole, rgbaCss, type RGB } from "./generated/roleColors";

// --- constants mirrored from render_overlay.py ---
export const KRAFT = "rgb(228, 207, 168)";
const RECT_FILL_A = 100 / 255;
const CELL_TERRAIN_A = 235 / 255;
const CELL_SCATTER_A = 110 / 255;
const POLY_FILL_A = 80 / 255;
const GRID_MAJOR_EVERY = 10;
const GRID_MINOR = "rgba(70, 55, 40, 0.086)"; // 22/255
const GRID_MAJOR = "rgba(70, 55, 40, 0.235)"; // 60/255
const BORDER = "rgb(0, 0, 0)";
const SELECT = "rgba(90, 220, 255, 0.95)";

export interface View {
  scale: number;
  offX: number;
  offY: number;
}

export interface BrushPreview {
  tx: number;
  ty: number;
  size: number;
  rgb: RGB;
  erase: boolean;
}

export interface DrawOpts {
  hoverTile: [number, number] | null;
  selected: Set<number>;
  /** snapped destination rect(s) of an in-progress drag, drawn as ghosts
   *  (one for a single move/resize, many for a group move) */
  ghost: Rect[] | null;
  /** N×N brush cursor (terrain tool); null otherwise */
  brush: BrushPreview | null;
  /** in-progress marquee box in screen px; null otherwise */
  marquee: { x: number; y: number; w: number; h: number } | null;
}

export function tileToScreen(v: View, tx: number, ty: number): [number, number] {
  return [tx * v.scale + v.offX, ty * v.scale + v.offY];
}
export function screenToTile(v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.offX) / v.scale, (sy - v.offY) / v.scale];
}

export function fitView(size: { width: number; height: number }, vw: number, vh: number, pad = 24): View {
  const sx = (vw - pad * 2) / size.width;
  const sy = (vh - pad * 2) / size.height;
  const scale = Math.max(0.1, Math.min(sx, sy));
  return { scale, offX: (vw - size.width * scale) / 2, offY: (vh - size.height * scale) / 2 };
}

/**
 * Draw one frame: blit the cached `scene` image (KRAFT + objects + terrain) to
 * the map rect, then draw the dynamic overlay (grid, selection, ghost, border,
 * hover/brush) fresh. The scene is re-rendered (renderScene) only when map data
 * changes — pan/zoom/hover reuse it, so per-frame cost stays low.
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  map: LiteTileMap,
  scene: HTMLCanvasElement,
  view: View,
  vw: number,
  vh: number,
  dpr: number,
  opts: DrawOpts,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#20242b";
  ctx.fillRect(0, 0, vw, vh);

  const [ox, oy] = tileToScreen(view, 0, 0);
  const mapW = map.width * view.scale;
  const mapH = map.height * view.scale;

  if (scene.width > 0 && scene.height > 0)
    ctx.drawImage(scene, 0, 0, scene.width, scene.height, ox, oy, mapW, mapH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, mapW, mapH);
  ctx.clip();

  drawGrid(ctx, view, ox, oy, map.width, map.height);
  drawSelection(ctx, map, view, opts.selected);
  if (opts.ghost) for (const g of opts.ghost) drawGhost(ctx, view, g);
  ctx.restore();

  ctx.lineWidth = 3;
  ctx.strokeStyle = BORDER;
  ctx.strokeRect(ox - 1.5, oy - 1.5, mapW + 3, mapH + 3);

  if (opts.marquee) drawMarquee(ctx, opts.marquee);
  if (opts.brush) drawBrushPreview(ctx, view, opts.brush);
  else if (opts.hoverTile) {
    const [tx, ty] = opts.hoverTile;
    if (tx >= 0 && ty >= 0 && tx < map.width && ty < map.height) {
      const [hx, hy] = tileToScreen(view, tx, ty);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.strokeRect(hx + 1, hy + 1, view.scale - 2, view.scale - 2);
    }
  }
}

function drawBrushPreview(ctx: CanvasRenderingContext2D, view: View, b: BrushPreview): void {
  const r = Math.floor(b.size / 2);
  const [px, py] = tileToScreen(view, b.tx - r, b.ty - r);
  const side = b.size * view.scale;
  ctx.save();
  ctx.lineWidth = 2;
  if (b.erase) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(235, 95, 85, 0.95)";
    ctx.fillStyle = "rgba(235, 95, 85, 0.15)";
  } else {
    ctx.strokeStyle = rgbaCss(b.rgb, 1);
    ctx.fillStyle = rgbaCss(b.rgb, 0.3);
  }
  ctx.fillRect(px, py, side, side);
  ctx.strokeRect(px, py, side, side);
  ctx.restore();
}

/**
 * Pixels-per-tile for the cached scene image. Bounded so the offscreen canvas
 * stays modest for large maps; the scene is up/down-scaled on blit (color blocks
 * tolerate nearest-neighbor scaling). Only depends on map size, so the scene
 * survives zoom/pan/hover.
 */
export function sceneScaleFor(map: LiteTileMap): number {
  const maxDim = Math.max(map.width, map.height, 1);
  return Math.max(6, Math.min(24, Math.floor(2800 / maxDim)));
}

/**
 * Render the static scene (KRAFT + objects + terrain) into `cv` at `s` px/tile.
 * Re-run only when map data changes — `drawMap` blits the result every frame.
 * (PIL composites translucent pixels by replacement; Canvas source-over blends —
 * identical except where translucent objects overlap, already accepted.)
 */
export function renderScene(cv: HTMLCanvasElement, map: LiteTileMap, s: number): void {
  cv.width = Math.max(1, map.width * s);
  cv.height = Math.max(1, map.height * s);
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = KRAFT;
  ctx.fillRect(0, 0, cv.width, cv.height);
  for (const o of eachVisibleObject(map)) drawObjectToScene(ctx, o, s, null);
}

/**
 * Re-render ONLY the dirty tile rect into the existing scene canvas — the
 * dirty-region update (cf. desktop tile_renderer's dirty_region_ +
 * glTexSubImage2D). Repaints KRAFT over the rect, then redraws only the objects
 * that intersect it, clipped. Used for paint strokes (small, frequent, local);
 * structural edits fall back to the full renderScene.
 */
export function renderSceneRegion(cv: HTMLCanvasElement, map: LiteTileMap, s: number, dirty: Rect): void {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dirty[0] * s, dirty[1] * s, dirty[2] * s, dirty[3] * s);
  ctx.clip();
  ctx.fillStyle = KRAFT;
  ctx.fillRect(dirty[0] * s, dirty[1] * s, dirty[2] * s, dirty[3] * s);
  for (const o of eachVisibleObject(map)) if (rectsOverlap(o.rect, dirty)) drawObjectToScene(ctx, o, s, dirty);
  ctx.restore();
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

// Draw one object into the scene at `s` px/tile. `clip` (when set) limits the
// terrain-cell scan to the dirty rect so a big terrain object stays cheap.
function drawObjectToScene(ctx: CanvasRenderingContext2D, o: LiteObject, s: number, clip: Rect | null): void {
  const rgb = colorForRole(roleOf(o));
  switch (o.type) {
    case "FIXED_RECT": {
      const [x, y, w, h] = o.rect;
      ctx.fillStyle = rgbaCss(rgb, RECT_FILL_A);
      ctx.fillRect(x * s, y * s, w * s, h * s);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgbaCss(rgb, 1);
      ctx.strokeRect(x * s, y * s, w * s, h * s);
      break;
    }
    case "DUNGEON":
      if (o.borderPoints && o.borderPoints.length > 1) {
        ctx.beginPath();
        o.borderPoints.forEach((p, i) => (i ? ctx.lineTo(p[0] * s, p[1] * s) : ctx.moveTo(p[0] * s, p[1] * s)));
        ctx.closePath();
        ctx.fillStyle = rgbaCss(rgb, POLY_FILL_A);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgbaCss(rgb, 1);
        ctx.stroke();
      }
      break;
    case "FIXED_RECT_GROUP":
      fillTerrainRuns(ctx, o, s, rgbaCss(rgb, CELL_SCATTER_A), clip);
      break;
    case "TERRAIN_2_CORNER":
    case "TERRAIN_2_EDGE":
      fillTerrainRuns(ctx, o, s, rgbaCss(rgb, CELL_TERRAIN_A), clip);
      break;
  }
}

// Fill present terrain cells, merging consecutive cells in each row into one
// fillRect (run-length). `clip` clamps the scan to the dirty tile rect.
function fillTerrainRuns(ctx: CanvasRenderingContext2D, o: LiteObject, s: number, style: string, clip: Rect | null): void {
  const t = o.terrain;
  if (!t) return;
  ctx.fillStyle = style;
  let r0 = 0, r1 = t.h, c0 = 0, c1 = t.w;
  if (clip) {
    r0 = Math.max(0, clip[1] - t.oy);
    r1 = Math.min(t.h, clip[1] + clip[3] - t.oy);
    c0 = Math.max(0, clip[0] - t.ox);
    c1 = Math.min(t.w, clip[0] + clip[2] - t.ox);
  }
  for (let r = r0; r < r1; r++) {
    const base = r * t.w;
    let c = c0;
    while (c < c1) {
      if (t.data[base + c] !== 0) { c++; continue; }
      let e = c + 1;
      while (e < c1 && t.data[base + e] === 0) e++;
      ctx.fillRect((t.ox + c) * s, (t.oy + r) * s, (e - c) * s, s);
      c = e;
    }
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, map: LiteTileMap, view: View, selected: Set<number>): void {
  if (selected.size === 0) return;
  const s = view.scale;
  for (const o of eachVisibleObject(map)) {
    if (!selected.has(o.id)) continue;
    const [x, y, w, h] = o.rect;
    const [px, py] = tileToScreen(view, x, y);
    const ww = w * s, hh = h * s;
    ctx.lineWidth = 2;
    ctx.strokeStyle = SELECT;
    ctx.strokeRect(px - 1, py - 1, ww + 2, hh + 2);
    // Resize handles on an unlocked FIXED_RECT (affordance for edge/corner drag).
    if (o.type === "FIXED_RECT" && !isLocked(o)) {
      ctx.fillStyle = SELECT;
      const hs = 5;
      for (const hx of [px, px + ww / 2, px + ww])
        for (const hy of [py, py + hh / 2, py + hh]) {
          if (hx === px + ww / 2 && hy === py + hh / 2) continue; // skip center
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        }
    }
    if (isLocked(o)) {
      ctx.font = `${Math.max(11, Math.min(20, s))}px system-ui`;
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText("🔒", px + 2, py + 2);
    }
  }
}

function drawGhost(ctx: CanvasRenderingContext2D, view: View, ghost: Rect): void {
  const s = view.scale;
  const [px, py] = tileToScreen(view, ghost[0], ghost[1]);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = SELECT;
  ctx.fillStyle = "rgba(90, 220, 255, 0.18)";
  ctx.fillRect(px, py, ghost[2] * s, ghost[3] * s);
  ctx.strokeRect(px, py, ghost[2] * s, ghost[3] * s);
  ctx.restore();
}

// Dashed rubber-band box for the marquee tool (screen px, unclipped).
function drawMarquee(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }): void {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(80, 200, 120, 0.95)";
  ctx.fillStyle = "rgba(80, 200, 120, 0.14)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: View,
  ox: number,
  oy: number,
  cols: number,
  rows: number,
): void {
  const s = view.scale;
  const mapW = cols * s;
  const mapH = rows * s;
  const showMinor = s >= 4;
  // Accumulate all minor / major lines into two Path2Ds → two strokes per frame.
  const minor = new Path2D();
  const major = new Path2D();
  for (let i = 0; i <= cols; i++) {
    const isMajor = i % GRID_MAJOR_EVERY === 0;
    if (!isMajor && !showMinor) continue;
    const x = Math.round(ox + i * s) + 0.5;
    const p = isMajor ? major : minor;
    p.moveTo(x, oy);
    p.lineTo(x, oy + mapH);
  }
  for (let j = 0; j <= rows; j++) {
    const isMajor = j % GRID_MAJOR_EVERY === 0;
    if (!isMajor && !showMinor) continue;
    const y = Math.round(oy + j * s) + 0.5;
    const p = isMajor ? major : minor;
    p.moveTo(ox, y);
    p.lineTo(ox + mapW, y);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID_MINOR;
  ctx.stroke(minor);
  ctx.lineWidth = 2;
  ctx.strokeStyle = GRID_MAJOR;
  ctx.stroke(major);
}

// --- hover / click hit-testing ---------------------------------------------

export interface HitGrid {
  objects: LiteObject[];
  owner: Int32Array; // index into `objects`, or -1
  width: number;
  height: number;
}

export function buildHitGrid(map: LiteTileMap): HitGrid {
  const { width, height } = map;
  const owner = new Int32Array(width * height).fill(-1);
  const objects: LiteObject[] = [];
  const set = (tx: number, ty: number, idx: number) => {
    if (tx >= 0 && ty >= 0 && tx < width && ty < height) owner[ty * width + tx] = idx;
  };
  for (const o of eachVisibleObject(map)) {
    const idx = objects.length;
    objects.push(o);
    if (o.terrain) {
      const t = o.terrain;
      for (let i = 0; i < t.data.length; i++) {
        if (t.data[i] === 0) set(t.ox + (i % t.w), t.oy + Math.floor(i / t.w), idx);
      }
    } else if (o.type === "DUNGEON" && o.borderPoints && o.borderPoints.length > 2) {
      rasterPolygon(o.borderPoints, idx, set);
    } else {
      const [x, y, w, h] = o.rect;
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) set(tx, ty, idx);
    }
  }
  return { objects, owner, width, height };
}

function rasterPolygon(points: [number, number][], idx: number, set: (tx: number, ty: number, i: number) => void): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  for (let ty = Math.floor(minY); ty < Math.ceil(maxY); ty++)
    for (let tx = Math.floor(minX); tx < Math.ceil(maxX); tx++)
      if (pointInPoly(tx + 0.5, ty + 0.5, points)) set(tx, ty, idx);
}

function pointInPoly(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function objectAt(hit: HitGrid, tx: number, ty: number): LiteObject | null {
  if (tx < 0 || ty < 0 || tx >= hit.width || ty >= hit.height) return null;
  const idx = hit.owner[ty * hit.width + tx];
  return idx >= 0 ? hit.objects[idx] : null;
}
