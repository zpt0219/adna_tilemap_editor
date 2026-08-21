// renderSheet.ts — the one place a Recipe becomes pixels.
//
// Same rule autotile_mixer arrived at the hard way: the preview canvas, the
// playground and the exporter must all get byte-identical answers, and any
// second copy of this mapping drifts silently. No DOM, no React, plain RGBA out.
//
// There used to be TWO mappings here — one for a replayed hand-drawn sheet and
// one for a parametric field — and `paintTileRGBA` branched between them on the
// first line. There is one now. A tile is three stages over one skeleton:
//
//   1. the BOUNDARY   builds the silhouette and the kerb from the skeleton
//   2. the CENTRELINE draws into what the boundary left
//   3. the SURFACE    re-tones what the other two did not claim
//
// Each reads what the one before it produced, which is why they share a cache
// entry rather than three.

import { OUTPUT_SIZE, composeLayers, type Layers } from './layers';
import { type RoleColours } from './palette';
import { coloursOf, type Recipe } from './recipe';
import { generateEdge, type EdgeOptions } from './boundary';
import { centreLayers, type CentreOptions } from './centre';
import { surfaceLayers, surfaceRamp, type SurfaceOptions } from './surface';
import { SHEET_COLS, SHEET_ROWS, TWO_EDGE_LAYOUT } from './twoEdge';

export const SHEET_TILE_SIZE = OUTPUT_SIZE;
export const SHEET_WIDTH = SHEET_COLS * SHEET_TILE_SIZE;
export const SHEET_HEIGHT = SHEET_ROWS * SHEET_TILE_SIZE;

export interface PaintArgs {
  colours: RoleColours;
  edge: EdgeOptions;
  centre: CentreOptions;
  surface: SurfaceOptions;
}

export function recipeToPaintArgs(raw: Recipe): PaintArgs {
  return {
    colours: coloursOf(raw),
    edge: raw.edge,
    centre: raw.centre,
    surface: raw.surface,
  };
}

/**
 * Re-peeling and re-thresholding 16 tiles on every slider frame is wasteful,
 * so they are cached. Small, because one entry is 16 tiles and a drag mints a
 * fresh key per step.
 */
const TILE_CACHE = new Map<string, Layers>();
const TILE_CACHE_MAX = 128;

/**
 * Every field of an options object, in a stable order.
 *
 * Spelled generically, and that is the whole point. The key used to list the
 * fields by hand and it went stale the moment the centreline grew any: 长段,
 * 短段 and all three of 随机长短线's controls changed the recipe, changed the
 * note under the slider, and then hit a cached tile and changed NOTHING on the
 * sheet. The unit tests could not see it either, because they call the stage
 * functions directly and never touch this cache. Found by looking at the canvas
 * after clicking the seed button.
 *
 * Sorted rather than trusting insertion order: a recipe that arrived as JSON is
 * rebuilt by the sanitiser, but sorting costs nothing and removes the
 * assumption entirely.
 */
function keyOf(o: object): string {
  return JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * All three stages under one key: each reads what the one before it produced —
 * the centreline needs the boundary's silhouette and its rings, the texture
 * needs to know which pixels the other two have already claimed — so they
 * cannot be cached apart without each keying on its predecessors anyway.
 */
function tileLayers(bits: number, a: PaintArgs): Layers {
  const key = `${bits & 0x0f}:${keyOf(a.edge)}:${keyOf(a.centre)}:${keyOf(a.surface)}`;
  const hit = TILE_CACHE.get(key);
  if (hit) {
    TILE_CACHE.delete(key);
    TILE_CACHE.set(key, hit);
    return hit;
  }
  const made = surfaceLayers(
    centreLayers(generateEdge(bits, a.edge), bits, a.centre, a.edge),
    bits, a.surface, a.edge);
  TILE_CACHE.set(key, made);
  while (TILE_CACHE.size > TILE_CACHE_MAX) {
    const oldest = TILE_CACHE.keys().next();
    if (oldest.done) break;
    TILE_CACHE.delete(oldest.value);
  }
  return made;
}

export const tileCacheSize = () => TILE_CACHE.size;

/**
 * One tile as RGBA bytes.
 *
 * Everything outside the kerb stays at alpha 0, always. A path tile is laid
 * over ground it knows nothing about, so there is no second terrain for it to
 * paint and no shaded rim it could honestly derive.
 */
export function paintTileRGBA(bits: number, a: PaintArgs): Uint8ClampedArray<ArrayBuffer> {
  return composeLayers(tileLayers(bits, a), a.colours, surfaceRamp(a.colours, a.surface));
}

export function renderSheetRGBA(recipe: Recipe): Uint8ClampedArray<ArrayBuffer> {
  const a = recipeToPaintArgs(recipe);
  const ts = SHEET_TILE_SIZE;
  const w = SHEET_COLS * ts;
  const out = new Uint8ClampedArray(new ArrayBuffer(w * SHEET_ROWS * ts * 4));
  for (let slot = 0; slot < TWO_EDGE_LAYOUT.length; slot++) {
    const col = slot % SHEET_COLS;
    const row = Math.floor(slot / SHEET_COLS);
    const tile = paintTileRGBA(TWO_EDGE_LAYOUT[slot], a);
    const x0 = col * ts, y0 = row * ts;
    for (let y = 0; y < ts; y++) {
      const src = y * ts * 4;
      out.set(tile.subarray(src, src + ts * 4), ((y0 + y) * w + x0) * 4);
    }
  }
  return out;
}

/**
 * A map of path cells rendered as one image, autotiled.
 *
 * This is what the playground draws, and it is also the seam test's instrument:
 * rendering the same map from a global field and from per-tile lookups must
 * agree, and here that agreement is what "no visible seams" means.
 */
export function renderMapRGBA(
  recipe: Recipe,
  cells: ArrayLike<number>,
  cols: number,
  rows: number,
  bitsOf: (c: number, r: number) => number
): Uint8ClampedArray<ArrayBuffer> {
  const a = recipeToPaintArgs(recipe);
  const ts = SHEET_TILE_SIZE;
  const w = cols * ts;
  const out = new Uint8ClampedArray(new ArrayBuffer(w * rows * ts * 4));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cells[r * cols + c]) continue;
      const tile = paintTileRGBA(bitsOf(c, r), a);
      const x0 = c * ts;
      const y0 = r * ts;
      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const s = (y * ts + x) * 4;
          if (tile[s + 3] === 0) continue;    // let the layer below show through
          const dst = ((y0 + y) * w + x0 + x) * 4;
          out[dst] = tile[s];
          out[dst + 1] = tile[s + 1];
          out[dst + 2] = tile[s + 2];
          out[dst + 3] = tile[s + 3];
        }
      }
    }
  }
  return out;
}
