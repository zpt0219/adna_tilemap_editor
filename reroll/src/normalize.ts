// normalize.ts — post-convert pass that re-groups a converted blueprint into the
// fixed category-layer model (docs/LAYER_MODEL.md).
//
// convert.ts stays a FAITHFUL port of the engine importer; this is a separate
// transform on top of its output. It:
//   1. assigns every object to a category = f(role, type),
//   2. re-types vegetation to frg (Terrain Deco),
//   3. merges mergeable objects by rendered COLOR within a category,
//      while leaving primitive (FIXED_RECT / DUNGEON) objects individual,
//   4. emits the categories as a flat layer list ordered bottom→top (z-order).

import type { Layer, LiteObject, LiteTileMap, LiteType, Rect, TerrainMatrix } from "./model";
import { colorForRole } from "./generated/roleColors";

// --- category table (draw order, bottom → top) ------------------------------

type CategoryKey = "background" | "terrain" | "path" | "terrain_deco" | "building" | "building_deco";

interface CategoryDef {
  key: CategoryKey;
  name: string;
  /** canonical engine type for merged areas; null = keep objects as-is (primitives) */
  canonical: LiteType | null;
  merge: boolean;
}

// Array order IS the z-order: index 0 draws at the bottom.
const CATEGORIES: CategoryDef[] = [
  { key: "background", name: "Background", canonical: "TERRAIN_2_CORNER", merge: true },
  { key: "terrain", name: "Terrain", canonical: "TERRAIN_2_CORNER", merge: true },
  { key: "path", name: "Path", canonical: "TERRAIN_2_EDGE", merge: true },
  { key: "terrain_deco", name: "Terrain Deco", canonical: "FIXED_RECT_GROUP", merge: true },
  { key: "building", name: "Building", canonical: null, merge: false },
  { key: "building_deco", name: "Building Deco", canonical: null, merge: false },
];

// --- role vocabularies (substring match, mirrors the palette buckets) --------

const EDGE_ROLES = ["road", "path", "corridor", "street", "bridge", "trail", "lane", "wall", "fence", "border", "hedge", "railing"];
const VEG_ROLES = ["forest", "tree", "woods", "wood", "orchard", "grove", "jungle", "bush", "shrub"];
const BUILDING_ROLES = ["house", "building", "barn", "shop", "tower", "hut", "cabin", "cottage", "manor", "mill", "shed", "stable"];
const WATER_BASE = ["ocean", "sea"];
// terrain-area vocabulary (the palette's terrain buckets). As a TERRAIN_2 area
// these are Terrain; as an FRG scatter they are Terrain Deco (stones, tufts).
const TERRAIN_ROLES = [
  "water", "river", "pond", "lake", "pool", "stream",
  "grass", "meadow", "lawn", "pasture", "vegetation", "garden",
  "field", "crop", "wheat", "farm", "plot", "paddy",
  "dirt", "soil", "mud", "ground", "tilled",
  "sand", "beach", "dune", "shore",
  "snow", "ice", "frost", "glacier",
  "mountain", "rock", "cliff", "stone", "hill", "boulder",
];

const hasWord = (role: string, words: string[]): boolean => words.some((w) => role.includes(w));

/**
 * category = f(role, type) — see docs/LAYER_MODEL.md §Assignment. Role-first:
 * building words always Build; vegetation always Deco; for FRG scatter, natural
 * terrain words are Deco (stones / grass tufts) and everything else is a prop.
 */
function categoryOf(role: string, type: LiteType): CategoryKey {
  const r = role.toLowerCase();
  if (hasWord(r, WATER_BASE)) return "background";
  if (hasWord(r, BUILDING_ROLES)) return "building"; // even a building authored as an frg cluster
  if (type === "TERRAIN_2_EDGE" || hasWord(r, EDGE_ROLES)) return "path";
  if (hasWord(r, VEG_ROLES)) return "terrain_deco"; // forest/tree → tree frg (incl. area forest)
  if (type === "FIXED_RECT_GROUP") return hasWord(r, TERRAIN_ROLES) ? "terrain_deco" : "building_deco";
  if (type === "FIXED_RECT" || type === "DUNGEON") return "building_deco";
  return "terrain"; // remaining TERRAIN_2 areas
}

// --- friendly names for merged areas ----------------------------------------

const FRIENDLY: { words: string[]; label: string }[] = [
  { words: ["water", "river", "pond", "lake", "ocean", "sea", "pool", "stream"], label: "water" },
  { words: ["brick", "cobble", "paved", "pavement", "flagstone"], label: "brick road" },
  { words: ["road", "path", "street", "lane", "bridge", "corridor"], label: "road" },
  { words: ["wall", "fence", "hedge", "border", "railing"], label: "fence" },
  { words: ["forest", "tree", "woods", "grove", "jungle", "bush", "shrub"], label: "trees" },
  { words: ["field", "crop", "wheat", "farm", "plot", "paddy"], label: "field" },
  { words: ["grass", "meadow", "lawn", "pasture"], label: "grass" },
  { words: ["dirt", "soil", "mud", "ground", "tilled"], label: "dirt" },
  { words: ["sand", "beach", "dune", "shore"], label: "sand" },
  { words: ["snow", "ice", "frost", "glacier"], label: "snow" },
  { words: ["rock", "stone", "boulder"], label: "rocks" },
  { words: ["mountain", "cliff", "hill"], label: "mountain" },
];

function friendlyName(role: string): string {
  const r = role.toLowerCase();
  for (const f of FRIENDLY) if (hasWord(r, f.words)) return f.label;
  return role || "area";
}

// --- geometry helpers --------------------------------------------------------

interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

const boundsToRect = (b: Bounds): Rect => [b.minX, b.minY, b.maxX - b.minX + 1, b.maxY - b.minY + 1];

function objectBounds(o: LiteObject): Bounds {
  if (o.terrain) {
    const t = o.terrain;
    return { minX: t.ox, minY: t.oy, maxX: t.ox + t.w - 1, maxY: t.oy + t.h - 1 };
  }
  const [x, y, w, h] = o.rect;
  return { minX: x, minY: y, maxX: x + w - 1, maxY: y + h - 1 };
}

const roleOfObj = (o: LiteObject): string => o.tags["blueprint.role"] ?? "";

/** Merge several area objects (each with its own matrix) into one matrix by OR-ing
 *  their present cells over the union bounds. */
function mergeTerrains(objs: LiteObject[]): TerrainMatrix {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) {
    const b = objectBounds(o);
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const data = new Int16Array(w * h).fill(-1);
  const put = (x: number, y: number) => {
    const cx = x - minX, cy = y - minY;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) data[cy * w + cx] = 0;
  };
  for (const o of objs) {
    if (o.terrain) {
      const t = o.terrain;
      for (let i = 0; i < t.data.length; i++) {
        if (t.data[i] === 0) put(t.ox + (i % t.w), t.oy + Math.floor(i / t.w));
      }
    } else {
      const [x, y, ww, hh] = o.rect;
      for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) put(xx, yy);
    }
  }
  return { ox: minX, oy: minY, w, h, data };
}

function presentCells(o: LiteObject): number {
  if (o.terrain) {
    let n = 0;
    for (let i = 0; i < o.terrain.data.length; i++) if (o.terrain.data[i] === 0) n++;
    return n;
  }
  return o.rect[2] * o.rect[3];
}

// --- main --------------------------------------------------------------------

/** Re-group a converted lite TileMap into the fixed category-layer model. */
export function normalizeToCategories(map: LiteTileMap): LiteTileMap {
  let nextObj = 0;
  let nextLayer = 0;

  // bucket every object by category
  const byCat = new Map<CategoryKey, LiteObject[]>();
  for (const c of CATEGORIES) byCat.set(c.key, []);
  for (const layer of map.layers) {
    for (const o of layer.objects) {
      byCat.get(categoryOf(roleOfObj(o), o.type))!.push(o);
    }
  }

  const layers: Layer[] = [];
  for (const cat of CATEGORIES) {
    const items = byCat.get(cat.key)!;
    if (items.length === 0) continue;

    let objects: LiteObject[];
    if (cat.merge) {
      // group by rendered color; one merged area per color
      const groups = new Map<string, LiteObject[]>();
      for (const o of items) {
        const key = colorForRole(roleOfObj(o)).join(",");
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
      }
      objects = [...groups.values()].map((group) => {
        // representative role = most common in the group
        const counts = new Map<string, number>();
        for (const o of group) {
          const r = roleOfObj(o);
          counts.set(r, (counts.get(r) ?? 0) + 1);
        }
        const repRole = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const terrain = mergeTerrains(group);
        return {
          id: nextObj++,
          type: cat.canonical!,
          rect: boundsToRect({ minX: terrain.ox, minY: terrain.oy, maxX: terrain.ox + terrain.w - 1, maxY: terrain.oy + terrain.h - 1 }),
          enabled: group.some((o) => o.enabled),
          tags: { "blueprint.role": repRole, "web.baseName": friendlyName(repRole), "web.merged": String(group.length) },
          terrain,
        } as LiteObject;
      });
      // larger areas underneath (drawn first within the layer)
      objects.sort((a, b) => presentCells(b) - presentCells(a));
    } else {
      // primitives: keep individual, fresh ids, tags preserved
      objects = items.map((o) => ({ ...o, id: nextObj++, rect: [...o.rect] as Rect, tags: { ...o.tags } }));
    }

    layers.push({
      id: nextLayer++,
      name: cat.name,
      enabled: true,
      tags: { "web.category": cat.key },
      objects,
    });
  }

  return { ...map, layers };
}
