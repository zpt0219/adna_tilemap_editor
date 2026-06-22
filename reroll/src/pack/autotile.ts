// autotile.ts — pick the right atlas tile per cell for matrix auto-tile modes.
// Ported from src/util/int16_matrix.cpp (getCellNeighborBitTwoCorner/TwoEdge) +
// src/core/palette.cpp (NEIGHBOR_MATRIX tables, iterateValidCell) + misc.cpp
// (Dir4/Corner4 bit values). Our TerrainMatrix encodes present=0 / empty=-1, so
// threshold 0 matches the engine; `borderAsConnected` controls whether
// out-of-bounds counts as filled when computing the neighbor mask.

import type { TerrainMatrix } from "../model";
import type { LiteType } from "../model";
import type { Rect } from "../model";
import { mappingCell, PaletteMode, type Palette } from "./types";
import { blitTile } from "./blit";

// real engine bit values (src/util/misc.cpp)
const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;
const UP_RIGHT = UP | RIGHT, RIGHT_DOWN = RIGHT | DOWN, LEFT_DOWN = LEFT | DOWN, UP_LEFT = UP | LEFT;
const C_TR = 1, C_BR = 2, C_BL = 4, C_TL = 8;

// src/core/palette.cpp — MATRIX[j][i] = the neighbor-bit value that grid cell (i,j) serves
const TWO_EDGE_MATRIX = [
  [4, 6, 14, 12],
  [5, 7, 15, 13],
  [1, 3, 11, 9],
  [0, 2, 10, 8],
];
const TWO_CORNER_MATRIX = [
  [4, 3, 14, 6],
  [10, 7, 15, 13],
  [1, 9, 11, 12],
  [0, 2, 5, 8],
];

/** present iff in-bounds and the cell value ≥ 0 (0=present, -1=empty).
 *  When `borderAsConnected`, out-of-bounds counts as filled. Local matrix coords. */
function present(t: TerrainMatrix, c: number, r: number, borderAsConnected: boolean): boolean {
  if (c < 0 || r < 0 || c >= t.w || r >= t.h) return borderAsConnected;
  return t.data[r * t.w + c] >= 0;
}

function bitsTwoEdge(t: TerrainMatrix, c: number, r: number, borderAsConnected: boolean): number {
  let b = 0;
  if (present(t, c, r - 1, borderAsConnected)) b |= UP;
  if (present(t, c + 1, r, borderAsConnected)) b |= RIGHT;
  if (present(t, c, r + 1, borderAsConnected)) b |= DOWN;
  if (present(t, c - 1, r, borderAsConnected)) b |= LEFT;
  return b;
}

function bitsTwoCorner(t: TerrainMatrix, c: number, r: number, borderAsConnected: boolean): number {
  let mask = 0;
  if (present(t, c, r - 1, borderAsConnected)) mask |= UP;
  if (present(t, c + 1, r, borderAsConnected)) mask |= RIGHT;
  if (present(t, c, r + 1, borderAsConnected)) mask |= DOWN;
  if (present(t, c - 1, r, borderAsConnected)) mask |= LEFT;
  let bits = 0;
  if ((mask & UP_RIGHT) === UP_RIGHT && present(t, c + 1, r - 1, borderAsConnected)) bits |= C_TR;
  if ((mask & RIGHT_DOWN) === RIGHT_DOWN && present(t, c + 1, r + 1, borderAsConnected)) bits |= C_BR;
  if ((mask & LEFT_DOWN) === LEFT_DOWN && present(t, c - 1, r + 1, borderAsConnected)) bits |= C_BL;
  if ((mask & UP_LEFT) === UP_LEFT && present(t, c - 1, r - 1, borderAsConnected)) bits |= C_TL;
  return bits;
}

export function terrainNeighborBits(type: LiteType, t: TerrainMatrix, c: number, r: number, borderAsConnected = false): number {
  return type === "TERRAIN_2_CORNER"
    ? bitsTwoCorner(t, c, r, borderAsConnected)
    : bitsTwoEdge(t, c, r, borderAsConnected);
}

/** 16-entry inverse LUT: bits → atlas (x,y), stored as [x0,y0,…] (2 ints/bit). */
function buildAutotileLUT(palette: Palette): Int32Array {
  const matrix = palette.mode === PaletteMode.TWO_CORNER ? TWO_CORNER_MATRIX : TWO_EDGE_MATRIX;
  const lut = new Int32Array(16 * 2).fill(-1);
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const bits = matrix[j][i];
      const [ax, ay] = mappingCell(palette.mapping, i, j);
      lut[bits * 2] = ax;
      lut[bits * 2 + 1] = ay;
    }
  return lut;
}

/** True if this palette mode is handled by the matrix auto-tiler here. */
export function isMatrixAutotile(mode: number): boolean {
  return mode === PaletteMode.TWO_CORNER || mode === PaletteMode.TWO_EDGE;
}

/** Atlas (x,y) for a single auto-tile cell (for per-tile y-sorted drawing), or
 *  null if the mode isn't matrix-autotile / the cell maps nowhere. */
export function autotileCellAtlas(palette: Palette, t: TerrainMatrix, c: number, r: number, borderAsConnected = false): [number, number] | null {
  if (!isMatrixAutotile(palette.mode)) return null;
  const lut = (palette.lut ??= buildAutotileLUT(palette));
  const bits = palette.mode === PaletteMode.TWO_CORNER ? bitsTwoCorner(t, c, r, borderAsConnected) : bitsTwoEdge(t, c, r, borderAsConnected);
  const ax = lut[bits * 2];
  return ax < 0 ? null : [ax, lut[bits * 2 + 1]];
}

/**
 * Draw a terrain object's present cells with auto-tiled atlas tiles. Returns
 * true if handled (matrix mode), false for modes not yet supported (caller falls
 * back). `clip` limits the cell scan to a dirty rect (tile coords).
 */
export function drawAutotile(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasImageSource,
  palette: Palette,
  t: TerrainMatrix,
  s: number,
  clip: Rect | null,
  borderAsConnected = false,
): boolean {
  if (!isMatrixAutotile(palette.mode)) return false;
  const lut = (palette.lut ??= buildAutotileLUT(palette));
  const bitsOf = palette.mode === PaletteMode.TWO_CORNER ? bitsTwoCorner : bitsTwoEdge;
  const tr = palette.tileResolution;
  let r0 = 0, r1 = t.h, c0 = 0, c1 = t.w;
  if (clip) {
    r0 = Math.max(0, clip[1] - t.oy);
    r1 = Math.min(t.h, clip[1] + clip[3] - t.oy);
    c0 = Math.max(0, clip[0] - t.ox);
    c1 = Math.min(t.w, clip[0] + clip[2] - t.ox);
  }
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) {
      if (t.data[r * t.w + c] < 0) continue; // empty
      const bits = bitsOf(t, c, r, borderAsConnected);
      const ax = lut[bits * 2];
      if (ax < 0) continue; // no tile mapped for this configuration
      blitTile(ctx, atlas, ax, lut[bits * 2 + 1], tr, t.ox + c, t.oy + r, s);
    }
  return true;
}
