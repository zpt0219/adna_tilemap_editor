// house.ts — geometry helpers for the HouseObject port (mirrors desktop
// src/object/house_object.cpp: regionForPart, _clampDecoCell, decorationAt,
// _initDecoDefaults). Pure functions over HouseData + the house rect; decoration
// sizes come from the resolved slot palettes (the compile binding).

import { DECO_COUNT, type HouseData, type HouseDeco, type Rect } from "./model";
import type { Palette } from "./pack/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** wallHeight clamped to a valid band within a rect of height `h`. */
export function wallHeightOf(house: HouseData, h: number): number {
  return clamp(house.wallHeight, 1, Math.max(1, h - 1));
}

/** world-space region rect for part 0 = wall band, 1 = roof band. */
export function regionForPart(house: HouseData, rect: Rect, part: 0 | 1): Rect {
  const [ox, oy, w, h] = rect;
  const wallH = wallHeightOf(house, h);
  const overlap = house.overlap < 0 ? 0 : house.overlap; // auto(-1) → 0 for v1
  if (part === 0) {
    const wallTop = Math.max(0, h - wallH - overlap); // wall extends up behind the roof
    return [ox, oy + wallTop, w, h - wallTop];
  }
  return [ox, oy, w, Math.max(0, h - wallH)]; // roof = top rows
}

const sizeOf = (p: Palette | null | undefined): [number, number] => (p ? p.size : [1, 1]);

/** clamp a deco top-left cell so its footprint stays inside the house rect. */
export function clampDecoCell(rectW: number, rectH: number, sz: [number, number], cell: [number, number]): [number, number] {
  return [clamp(cell[0], 0, Math.max(0, rectW - sz[0])), clamp(cell[1], 0, Math.max(0, rectH - sz[1]))];
}

/** the effective (clamped) cell of a slot given its resolved palette. */
export function effectiveDecoCell(house: HouseData, rect: Rect, slot: number, palette: Palette | null): [number, number] {
  return clampDecoCell(rect[2], rect[3], sizeOf(palette), house.deco[slot].cell);
}

/** world rect [x,y,w,h] of a slot's footprint (null palette → null). */
export function decoWorldRect(house: HouseData, rect: Rect, slot: number, palette: Palette | null): Rect | null {
  if (!palette) return null;
  const [cx, cy] = effectiveDecoCell(house, rect, slot, palette);
  return [rect[0] + cx, rect[1] + cy, palette.size[0], palette.size[1]];
}

/** slot at a world tile (reverse draw order so the top sprite wins), or -1. */
export function decorationAt(house: HouseData, rect: Rect, deco: (Palette | null)[], wx: number, wy: number): number {
  for (let slot = DECO_COUNT - 1; slot >= 0; slot--) {
    const r = decoWorldRect(house, rect, slot, deco[slot] ?? null);
    if (r && wx >= r[0] && wx < r[0] + r[2] && wy >= r[1] && wy < r[1] + r[3]) return slot;
  }
  return -1;
}

/** default deco cells for a fresh w×h house (door / window / chimney). */
export function defaultDecoCells(w: number, h: number, wallH: number): HouseDeco[] {
  const roofH = Math.max(1, h - wallH);
  return [
    { cell: [Math.floor(w / 2), h - 1] },
    { cell: [Math.max(0, Math.floor(w / 2) - 1), h - 1 - Math.floor(wallH / 2)] },
    { cell: [Math.min(w - 1, Math.floor((w * 2) / 3)), Math.max(0, Math.floor(roofH / 2) - 1)] },
  ];
}

/** build fresh HouseData for a w×h footprint. */
export function makeHouse(w: number, h: number): HouseData {
  const wallHeight = Math.max(1, Math.floor(h / 2));
  return { wallHeight, overlap: 0, deco: defaultDecoCells(w, h, wallHeight) };
}
