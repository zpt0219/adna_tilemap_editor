// frg.ts — assign a scatter variant to each active cell of an FRG object.
// Mirrors fixed_rect_group_object.cpp: each active cell samples the FRG noise,
// rejects values outside the configured range, then picks a weighted cell entry.

import type { FrgPlacementMode, TerrainMatrix } from "../model";
import type { Palette } from "./types";
import type { TerrainNoiseConfig } from "../terrainNoise";
import { noiseAllowsCell, sampleNoiseValue } from "../terrainNoise";

interface FrgStamp {
  x: number;
  y: number; // bottom-left/base cell
  w: number;
  h: number;
}

function activeAt(terrain: TerrainMatrix, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= terrain.w || y >= terrain.h) return false;
  return terrain.data[y * terrain.w + x] === 0;
}

function chooseWeightedIndexByNoise(x: number, y: number, weights: number[], noise: TerrainNoiseConfig): number {
  if (!noiseAllowsCell(x, y, noise)) return -1;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return -1;
  const n = sampleNoiseValue(x, y, noise);
  let pick = (n * 1000) - Math.floor(n * 1000);
  let accum = 0;
  for (let i = weights.length - 1; i >= 0; i--) {
    const weight = weights[i];
    if (weight <= 0) continue;
    accum += weight / total;
    if (accum >= pick) return i;
  }
  return 0;
}

function modeAllowsFootprint(terrain: TerrainMatrix, x: number, y: number, w: number, h: number, mode: FrgPlacementMode): boolean {
  switch (mode) {
    case "y_sorted_stacking":
    case "row_no_overlap":
      for (let dx = 0; dx < w; dx++) {
        if (!activeAt(terrain, x + dx, y)) return false;
      }
      return true;
    case "full_collision":
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          if (!activeAt(terrain, x + dx, y - dy)) return false;
        }
      }
      return true;
    case "free":
    case "base_collision":
    default:
      return true;
  }
}

function rectsOverlap(a: FrgStamp, b: FrgStamp): boolean {
  const aTop = a.y - a.h + 1;
  const bTop = b.y - b.h + 1;
  return a.x < b.x + b.w && a.x + a.w > b.x && aTop < bTop + b.h && aTop + a.h > bTop;
}

function containsBase(stamp: FrgStamp, x: number, y: number): boolean {
  const top = stamp.y - stamp.h + 1;
  return x >= stamp.x && x < stamp.x + stamp.w && y >= top && y <= stamp.y;
}

function rowIntersects(stamp: FrgStamp, x: number, y: number, w: number): boolean {
  return stamp.y === y && x < stamp.x + stamp.w && x + w > stamp.x;
}

function placementAllows(stamps: FrgStamp[], x: number, y: number, w: number, h: number, mode: FrgPlacementMode): boolean {
  const next: FrgStamp = { x, y, w, h };
  switch (mode) {
    case "base_collision":
      return !stamps.some((stamp) => containsBase(stamp, x, y));
    case "y_sorted_stacking":
      return !stamps.some((stamp) => rowIntersects(stamp, x, y, w));
    case "row_no_overlap":
    case "full_collision":
      return !stamps.some((stamp) => rectsOverlap(stamp, next));
    case "free":
    default:
      return true;
  }
}

export function assignPlacedFrgCells(
  terrain: TerrainMatrix,
  palettes: Palette[],
  weights: ArrayLike<number>,
  mode: FrgPlacementMode,
  noise: TerrainNoiseConfig,
): Int16Array {
  const out = new Int16Array(terrain.data.length).fill(-1);
  const normalized = Array.from({ length: weights.length }, (_, i) => Math.max(0, Math.floor(Number(weights[i]) || 0)));
  const total = normalized.reduce((sum, weight) => sum + weight, 0);
  if (palettes.length <= 0 || total <= 0) return out;

  const placed: FrgStamp[] = [];
  for (let row = 0; row < terrain.h; row++) {
    for (let col = 0; col < terrain.w; col++) {
      const idx = row * terrain.w + col;
      if (terrain.data[idx] !== 0) continue;
      const variant = chooseWeightedIndexByNoise(col, row, normalized, noise);
      if (variant < 0) continue;
      const palette = palettes[variant];
      if (!palette) continue;
      const [w, h] = palette.size;
      if (!modeAllowsFootprint(terrain, col, row, w, h, mode)) continue;
      if (!placementAllows(placed, col, row, w, h, mode)) continue;
      placed.push({ x: col, y: row, w, h });
      out[idx] = variant;
    }
  }
  return out;
}
