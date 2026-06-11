// frg.ts — assign a scatter variant to each active cell of an FRG object.
// Mirrors the intent of fixed_rect_group_object.cpp (reselectCellByRegion):
// per active cell pick a variant deterministically by position+seed. Exact noise
// parity with desktop is not required — only variety + reproducibility.

import type { TerrainMatrix } from "../model";
import { hashString } from "./rng";

/**
 * For each present cell (data===0) pick a variant index [0..n); empty cells (-1)
 * stay -1. Returns an Int16Array parallel to `terrain.data`.
 */
export function assignFrgCells(terrain: TerrainMatrix, nVariants: number, seed: number): Int16Array {
  const out = new Int16Array(terrain.data.length).fill(-1);
  if (nVariants <= 0) return out;
  for (let i = 0; i < terrain.data.length; i++) {
    if (terrain.data[i] !== 0) continue;
    const x = terrain.ox + (i % terrain.w);
    const y = terrain.oy + Math.floor(i / terrain.w);
    out[i] = hashString(`${x},${y},${seed}`) % nVariants;
  }
  return out;
}
