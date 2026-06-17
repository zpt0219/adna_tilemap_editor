// model.ts — the web "lite subset" of the desktop TileMap document
// (WEB_LITE_REROLL_EDITOR.md §4.5). A blueprint is converted into this model
// (see convert.ts) and all editing/rendering acts on it. It is intentionally a
// SUBSET of the desktop schema: same object TYPEs, same per-object terrain
// matrix (§4.3), role/style carried as tags — no distributor/pass/base64.

import type { Vec2 } from "./types";

/** Object TYPEs we target — a subset of the desktop TiledObject::Type set. */
export type LiteType =
  | "TERRAIN_2_CORNER"
  | "TERRAIN_2_EDGE"
  | "FIXED_RECT"
  | "FIXED_RECT_GROUP"
  | "DUNGEON"
  | "HOUSE";

export type HouseDecorationKind = "door" | "window" | "chimney" | "any";

export const HOUSE_DECO_KINDS = ["door", "window", "chimney", "any"] as const satisfies readonly HouseDecorationKind[];

export const HOUSE_DECO_ROLES: Record<Exclude<HouseDecorationKind, "any">, string> = {
  door: "building_prop/door",
  window: "building_prop/window",
  chimney: "building_prop/chimney",
};

/** One movable house decoration: type + local top-left cell + optional palette
 *  hash override (FIXED_RECT). Unset palette = role-resolved for known kinds. */
export interface HouseDecoration {
  kind: HouseDecorationKind;
  cell: [number, number];
  palette?: string;
}

/** A composite house (desktop NineSliceHouseObject port): wall + roof nine-slice
 *  bands and a dynamic list of FIXED_RECT decorations. `wall`/`roof` and each
 *  decoration palette are optional hash overrides; unset = role-resolved. */
export interface HouseData {
  wallHeight: number;  // rows from the bottom (roof height = rect.h - wallHeight)
  overlap: number;     // wall rows extending up behind the roof (0 = none)
  wall?: string;
  roof?: string;
  decorations: HouseDecoration[]; // draw order = array order
}

/** [x, y, w, h] in tile coords (origin + size, w/h ≥ 1). */
export type Rect = [number, number, number, number];

/**
 * Per-object terrain matrix (§4.3) covering [ox..ox+w) × [oy..oy+h). `data[i]`
 * is 0 when the cell is present, -1 when empty — mirrors the engine's
 * Int16Matrix produced by makeFrgTerrain. Each terrain/FRG object owns its own
 * matrix so stacked terrain survives (not yet edited until MVP 2).
 */
export interface TerrainMatrix {
  ox: number;
  oy: number;
  w: number;
  h: number;
  data: Int16Array;
}

export interface LiteObject {
  /** session-stable id; stands in for engine layer-hash+index (§4.5) */
  id: number;
  type: LiteType;
  rect: Rect;
  enabled: boolean;
  /** carries blueprint.role / blueprint.style / blueprint.label; web.lock = lock */
  tags: Record<string, string>;
  /** present for TERRAIN_2_* and FIXED_RECT_GROUP */
  terrain?: TerrainMatrix;
  /** present for DUNGEON — absolute polygon points */
  borderPoints?: Vec2[];
  /** present for HOUSE — wall/roof bands + decoration slots */
  house?: HouseData;
}

export interface Layer {
  /** session-stable id; selection/visibility target (not exported) */
  id: number;
  name: string;
  enabled: boolean;
  color?: string;
  /** desktop "Vertical" stratum: upright objects (deco / buildings) that
   *  y-sort together across these layers, drawn above the flat ground layers.
   *  false/undefined = Ground (flat terrain, drawn in z-order). */
  vertical?: boolean;
  tags: Record<string, string>;
  objects: LiteObject[];
}

export interface LiteTileMap {
  name: string;
  /** flat layer list; array order = draw order (later index draws on top) */
  layers: Layer[];
  /** the source was a blueprint root → desktop renders the role overlay */
  isBlueprint: boolean;
  width: number;
  height: number;
  /** true when width/height came from content AABB, not the blueprint root */
  sizeInferred: boolean;
}

/** All objects in draw order: each layer's objects, layers in array order. */
export function* eachObject(map: LiteTileMap): Generator<LiteObject> {
  for (const layer of map.layers) for (const o of layer.objects) yield o;
}

/** Objects on enabled layers AND not individually hidden — what render /
 *  hit-test / legend should see. A hidden object (enabled=false) still lives in
 *  its layer's object list (so it stays in the panel and is re-selectable). */
export function* eachVisibleObject(map: LiteTileMap): Generator<LiteObject> {
  for (const layer of map.layers) if (layer.enabled) for (const o of layer.objects) if (o.enabled) yield o;
}

/** Bottom-edge Y — the y-sort depth key (an object whose base sits lower on the
 *  map draws in front). */
export function ySortKey(o: LiteObject): number { return o.rect[1] + o.rect[3]; }

/**
 * Visible objects in final composite order: flat **ground** layers first in
 * z-order, then every **vertical**-layer object merged into one group and
 * y-sorted by bottom edge — across categories — so a lower tree can draw in
 * front of a higher building. Mirrors desktop's Ground vs Vertical stratum
 * (the vertical objects are the Godot y-sorted Decoration bucket).
 *
 * Render AND hit-test both iterate this, so clicking picks whatever is drawn on
 * top. (`sort` is stable, so same-Y objects keep category + array order.)
 */
export function* eachVisibleDrawOrder(map: LiteTileMap): Generator<LiteObject> {
  const vertical: LiteObject[] = [];
  for (const layer of map.layers) {
    if (!layer.enabled) continue;
    for (const o of layer.objects) {
      if (!o.enabled) continue;
      if (layer.vertical) vertical.push(o); else yield o;
    }
  }
  vertical.sort((a, b) => ySortKey(a) - ySortKey(b));
  yield* vertical;
}

export function findObject(map: LiteTileMap, id: number): LiteObject | null {
  for (const o of eachObject(map)) if (o.id === id) return o;
  return null;
}

export function findLayer(map: LiteTileMap, id: number): Layer | null {
  for (const layer of map.layers) if (layer.id === id) return layer;
  return null;
}

/** The layer that owns object `id`, or null. */
export function layerOfObject(map: LiteTileMap, id: number): Layer | null {
  for (const layer of map.layers) for (const o of layer.objects) if (o.id === id) return layer;
  return null;
}

export function roleOf(o: LiteObject): string {
  return o.tags["blueprint.role"] ?? "";
}

function baseNameOf(o: LiteObject): string {
  return o.tags["web.baseName"] || o.tags["blueprint.label"] || roleOf(o) || o.tags["web.name"] || o.type;
}

/** Assign every object a stable unique `web.name` so list labels follow the object. */
export function assignUniqueObjectNames(map: LiteTileMap): void {
  const totals = new Map<string, number>();
  for (const o of eachObject(map)) {
    const base = baseNameOf(o);
    totals.set(base, (totals.get(base) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  for (const o of eachObject(map)) {
    const base = baseNameOf(o);
    const next = (seen.get(base) ?? 0) + 1;
    seen.set(base, next);
    o.tags["web.name"] = (totals.get(base) ?? 0) > 1 ? `${base} #${next}` : base;
  }
}

/** Stable label for the layer panel. */
export function displayName(o: LiteObject): string {
  return o.tags["web.name"] || o.tags["blueprint.label"] || roleOf(o) || o.type;
}

export function isLocked(o: LiteObject): boolean {
  return o.tags["web.lock"] === "true";
}

/** FIXED_RECT placeables are the only draggable type in MVP 1 (§3.4). */
export function isDraggable(o: LiteObject): boolean {
  return o.type === "FIXED_RECT" && !isLocked(o);
}

/** Deep copy of a terrain matrix (for undo snapshots). */
export function cloneTerrain(t: TerrainMatrix): TerrainMatrix {
  return { ox: t.ox, oy: t.oy, w: t.w, h: t.h, data: new Int16Array(t.data) };
}

/**
 * Paint (present=true) or erase (false) one cell of a terrain object's matrix,
 * growing the matrix + rect when painting outside the current bounds. Erasing
 * outside bounds is a no-op. Returns whether a cell value actually changed.
 */
export function setTerrainCell(o: LiteObject, x: number, y: number, present: boolean): boolean {
  let t = o.terrain;
  if (!t) {
    if (!present) return false;
    o.terrain = { ox: x, oy: y, w: 1, h: 1, data: Int16Array.of(0) };
    o.rect = [x, y, 1, 1];
    return true;
  }
  const within = x >= t.ox && y >= t.oy && x < t.ox + t.w && y < t.oy + t.h;
  if (within) {
    const idx = (y - t.oy) * t.w + (x - t.ox);
    const next = present ? 0 : -1;
    if (t.data[idx] === next) return false;
    t.data[idx] = next;
    return true;
  }
  if (!present) return false;
  // Grow to include (x,y).
  const nox = Math.min(t.ox, x);
  const noy = Math.min(t.oy, y);
  const nMaxX = Math.max(t.ox + t.w - 1, x);
  const nMaxY = Math.max(t.oy + t.h - 1, y);
  const nw = nMaxX - nox + 1;
  const nh = nMaxY - noy + 1;
  const data = new Int16Array(nw * nh).fill(-1);
  for (let r = 0; r < t.h; r++)
    for (let c = 0; c < t.w; c++) data[(t.oy + r - noy) * nw + (t.ox + c - nox)] = t.data[r * t.w + c];
  data[(y - noy) * nw + (x - nox)] = 0;
  t = { ox: nox, oy: noy, w: nw, h: nh, data };
  o.terrain = t;
  o.rect = [nox, noy, nw, nh];
  return true;
}

/** Translate an object (rect + terrain matrix origin + polygon points) by (dx,dy). */
export function translateObject(o: LiteObject, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  o.rect = [o.rect[0] + dx, o.rect[1] + dy, o.rect[2], o.rect[3]];
  if (o.terrain) {
    o.terrain = { ...o.terrain, ox: o.terrain.ox + dx, oy: o.terrain.oy + dy };
  }
  if (o.borderPoints) {
    o.borderPoints = o.borderPoints.map(([x, y]) => [x + dx, y + dy] as Vec2);
  }
}

export function cloneObjectDeep(o: LiteObject, id = o.id): LiteObject {
  const next: LiteObject = {
    ...o,
    id,
    rect: [...o.rect] as Rect,
    tags: { ...o.tags },
  };
  if (o.terrain) next.terrain = { ...o.terrain, data: new Int16Array(o.terrain.data) };
  if (o.borderPoints) next.borderPoints = o.borderPoints.map(([x, y]) => [x, y] as Vec2);
  if (o.house) {
    next.house = {
      ...o.house,
      decorations: o.house.decorations.map((deco) => ({ ...deco, cell: [...deco.cell] as [number, number] })),
    };
  }
  return next;
}
