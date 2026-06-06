// convert.ts — blueprint JSON → web lite TileMap (a Layer subtree of LiteObjects).
//
// FAITHFUL PORT of the engine importer src/serialize/blueprint_importer.cpp
// (objectTypeFor / rasterizePath / makeFrgTerrain / convertObject / convertLayer).
// That C++ file is the SOURCE OF TRUTH — keep this in step with it (a future
// round-trip test guards drift, WEB_LITE_REROLL_EDITOR.md §15). Differences from
// the engine are intentional and noted inline (web is lenient: it skips an
// invalid object instead of aborting the whole import).

import type { BlueprintLayer, BlueprintObject, LoadedBlueprint, Vec2 } from "./types";
import type { Layer, LiteObject, LiteType, Rect, TerrainMatrix } from "./model";

// Inclusive integer bounds, matching the engine's Recti (minX..maxX inclusive).
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const lower = (s: unknown): string => String(s ?? "").toLowerCase();

function intValue(v: unknown, fallback: number): number {
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

function readPoints(j: unknown): Vec2[] {
  if (!Array.isArray(j)) return [];
  const out: Vec2[] = [];
  for (const p of j) {
    if (Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number") {
      out.push([p[0], p[1]]);
    } else if (p && typeof p === "object" && "x" in p && "y" in p) {
      out.push([Number((p as { x: number }).x), Number((p as { y: number }).y)]);
    }
  }
  return out;
}

// Read an explicit rect from the object, as inclusive bounds. Mirrors readRect:
// array [x,y,w,h], {minX,minY,maxX,maxY}, or {x,y,w/width,h/height}.
function readRect(src: BlueprintObject): Bounds | null {
  const r = src.rect as unknown;
  const fromOriginSize = (x: number, y: number, w: number, h: number): Bounds => ({
    minX: x,
    minY: y,
    maxX: x + Math.max(1, w) - 1,
    maxY: y + Math.max(1, h) - 1,
  });
  if (Array.isArray(r) && r.length >= 4) return fromOriginSize(r[0], r[1], r[2], r[3]);
  if (r && typeof r === "object") {
    const o = r as Record<string, number>;
    if ("minX" in o && "maxX" in o) return { minX: o.minX, minY: o.minY, maxX: o.maxX, maxY: o.maxY };
    if ("x" in o && "y" in o) return fromOriginSize(o.x, o.y, o.w ?? o.width ?? 1, o.h ?? o.height ?? 1);
  }
  return null;
}

function aabbOf(points: Vec2[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = points[0][0], minY = points[0][1], maxX = points[0][0], maxY = points[0][1];
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

const boundsToRect = (b: Bounds): Rect => [b.minX, b.minY, b.maxX - b.minX + 1, b.maxY - b.minY + 1];

// --- objectTypeFor (ported verbatim, precedence-sensitive) ---
function objectTypeFor(role: string, typeOrShape: string, width: number): LiteType {
  const t = typeOrShape;
  const has = (...ks: string[]) => ks.some((k) => role.includes(k));
  if (t === "fixed_rect_group" || t === "fixed-rect-group" || t === "frg" || t === "cells")
    return "FIXED_RECT_GROUP";
  if (t === "path" || t === "polyline" || has("road", "path", "corridor", "street", "bridge", "trail", "lane"))
    return width <= 1 ? "TERRAIN_2_EDGE" : "TERRAIN_2_CORNER";
  if (has("wall", "fence", "border", "hedge", "railing")) return "TERRAIN_2_EDGE";
  if (t === "polygon" || t === "contour" || t === "dungeon" || has("room", "bedroom", "kitchen", "hall"))
    return "DUNGEON";
  if (has(
    "water", "river", "pond", "lake", "ocean", "sea",
    "forest", "tree", "woods", "vegetation", "garden", "grass", "lawn",
    "field", "crop", "meadow", "farmland",
    "mountain", "rock", "hill", "sand", "beach", "dirt", "mud",
    "snow", "ice", "swamp", "ground", "floor", "terrain",
  ))
    return "TERRAIN_2_CORNER";
  return "FIXED_RECT";
}

// --- path rasterization (Bresenham + width radius), ported from rasterizePath ---
function rasterizePath(points: Vec2[], width: number): Vec2[] {
  const seen = new Set<string>();
  const out: Vec2[] = [];
  const radius = Math.max(0, Math.floor(width / 2));
  const addThick = (cx: number, cy: number) => {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const k = `${cx + dx},${cy + dy}`;
        if (!seen.has(k)) { seen.add(k); out.push([cx + dx, cy + dy]); }
      }
  };
  if (points.length === 0) return out;
  if (points.length === 1) { addThick(points[0][0], points[0][1]); return out; }
  for (let i = 1; i < points.length; i++) {
    let [x, y] = points[i - 1];
    const [bx, by] = points[i];
    const dx = Math.abs(bx - x), sx = x < bx ? 1 : -1;
    const dy = -Math.abs(by - y), sy = y < by ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      addThick(x, y);
      if (x === bx && y === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  return out;
}

function cellsFromBounds(b: Bounds): Vec2[] {
  const out: Vec2[] = [];
  for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) out.push([x, y]);
  return out;
}

// makeFrgTerrain: cells → per-object matrix over `bounds` (0 present, -1 empty).
function makeTerrain(cells: Vec2[], b: Bounds): TerrainMatrix {
  const w = b.maxX - b.minX + 1;
  const h = b.maxY - b.minY + 1;
  const data = new Int16Array(w * h).fill(-1);
  for (const [x, y] of cells) {
    const cx = x - b.minX, cy = y - b.minY;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) data[cy * w + cx] = 0;
  }
  return { ox: b.minX, oy: b.minY, w, h, data };
}

const isTerrainPath = (t: LiteType) => t === "TERRAIN_2_EDGE" || t === "TERRAIN_2_CORNER";

function objectTags(src: BlueprintObject): Record<string, string> {
  const tags: Record<string, string> = {};
  if (src.tags && typeof src.tags === "object") {
    for (const [k, v] of Object.entries(src.tags as Record<string, unknown>)) {
      if (k) tags[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  const put = (k: string, v: unknown) => {
    const s = typeof v === "string" ? v : v == null ? "" : String(v);
    if (s) tags[k] = s;
  };
  put("blueprint.role", src.role);
  put("blueprint.style", (src as { style?: unknown }).style);
  put("blueprint.label", src.label);
  put("blueprint.source_id", (src as { source_id?: unknown }).source_id);
  put("blueprint.width", (src as { width?: unknown }).width);
  return tags;
}

// convertObject → LiteObject, or null when geometry is missing (web skips it).
function convertObject(src: BlueprintObject, allocId: () => number): LiteObject | null {
  if (!src || typeof src !== "object") return null;
  const role = lower(src.role);
  const typeStr = lower(src.type ?? src.shape ?? "rect");
  const width = intValue((src as { width?: unknown }).width, 1);

  const points = readPoints(src.points);
  const cells = readPoints(src.cells);

  let type = objectTypeFor(role, typeStr, width);
  // Structural cells→terrain rule, MIRRORING the engine importer
  // (blueprint_importer.cpp objectTypeFor, bottom branch): an object authored with
  // explicit `cells` is terrain-shaped by construction, so it's an area terrain
  // even when its role word isn't in objectTypeFor's terrain vocabulary (which has
  // gaps relative to the color buckets — e.g. "cliff"/"boulder"). Without this a
  // 600-cell cliff would collapse into a FIXED_RECT bbox and drop its cells.
  if (type === "FIXED_RECT" && cells.length > 0) type = "TERRAIN_2_CORNER";

  let bounds = readRect(src) ?? aabbOf(points) ?? aabbOf(cells);
  if (!bounds || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return null;

  const obj: LiteObject = {
    id: allocId(),
    type,
    rect: boundsToRect(bounds),
    enabled: (src as { enabled?: boolean }).enabled !== false,
    tags: objectTags(src),
  };

  if (type === "DUNGEON") {
    if (points.length) obj.borderPoints = points;
  } else if (isTerrainPath(type)) {
    // cell precedence: explicit cells > rasterized polyline > whole rect.
    const terrainCells = cells.length ? cells : points.length ? rasterizePath(points, width) : cellsFromBounds(bounds);
    if (!terrainCells.length) return null;
    bounds = aabbOf(terrainCells)!;
    obj.rect = boundsToRect(bounds);
    obj.terrain = makeTerrain(terrainCells, bounds);
  } else if (type === "FIXED_RECT_GROUP") {
    if (!cells.length) return null;
    obj.terrain = makeTerrain(cells, bounds);
  }
  return obj;
}

function layerTags(src: BlueprintLayer, root: boolean): Record<string, string> {
  const tags: Record<string, string> = {};
  const s = src as Record<string, unknown>;
  if (s.tags && typeof s.tags === "object") {
    for (const [k, v] of Object.entries(s.tags as Record<string, unknown>)) {
      if (k) tags[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  if (root) tags["adna.kind"] = "blueprint";
  const put = (k: string, v: unknown) => { if (typeof v === "string" && v) tags[k] = v; };
  put("blueprint.role", s.role);
  put("blueprint.style", s.style);
  put("blueprint.label", s.label);
  return tags;
}

interface Allocators {
  obj: () => number;
  layer: () => number;
}

// Flatten the blueprint layer tree into an ordered list (web has no tree, only a
// flat draw-order list — WEB_LITE_REROLL_EDITOR.md). DFS pre-order so the result
// matches the old recursive eachObject() draw order. A node becomes a layer when
// it is the root or carries objects; empty intermediate nodes are skipped but
// still contribute their name as a prefix so deep layers stay disambiguated.
function flattenLayer(
  src: BlueprintLayer,
  root: boolean,
  prefix: string,
  index: number,
  alloc: Allocators,
  out: Layer[],
): void {
  const s = src as Record<string, unknown>;
  const base = (typeof s.name === "string" && s.name) || (root ? "__BLUEPRINT__" : `layer_${index + 1}`);
  const name = prefix ? `${prefix}/${base}` : base;
  const objects: LiteObject[] = [];
  for (const o of src.objects ?? []) {
    const lite = convertObject(o, alloc.obj);
    if (lite) objects.push(lite);
  }
  if (root || objects.length > 0) {
    out.push({
      id: alloc.layer(),
      name,
      enabled: (s.enabled as boolean) !== false,
      color: typeof s.color === "string" ? s.color : undefined,
      tags: layerTags(src, root),
      objects,
    });
  }
  const rawChildren = (s.layers ?? s.children) as BlueprintLayer[] | undefined;
  // The root's __BLUEPRINT__ name is not a useful prefix; start children clean.
  const childPrefix = root ? "" : name;
  (rawChildren ?? []).forEach((c, i) => flattenLayer(c, false, childPrefix, i, alloc, out));
}

/** Convert a parsed blueprint into the lite TileMap. Canvas size is carried over
 * unchanged (= blueprint root width/height, §3.6). */
export function blueprintToLite(loaded: LoadedBlueprint): import("./model").LiteTileMap {
  let nextObj = 0;
  let nextLayer = 0;
  const alloc: Allocators = { obj: () => nextObj++, layer: () => nextLayer++ };
  const layers: Layer[] = [];
  flattenLayer(loaded.root, true, "", 0, alloc, layers);
  const isBlueprint = layers.length > 0 && layers[0].tags["adna.kind"] === "blueprint";
  return { name: loaded.name, layers, isBlueprint, width: loaded.width, height: loaded.height, sizeInferred: loaded.sizeInferred };
}
