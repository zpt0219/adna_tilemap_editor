// slice.ts — render "structure" palettes (NINE_PATCH / CLIFF / H_STRETCH /
// V_STRETCH) by nine-slicing the palette grid over the object's rect. Ported
// from src/object/nine_slice.h (nineSliceAxisIndex) — the same mapping
// PrimitiveObject and HouseObject use, so houses/bridges/roofs slice identically.

import type { Rect } from "../model";
import { mappingCell, PaletteMode, type Palette } from "./types";
import { blitTile } from "./blit";

/** Map object-axis coord `idx` (0..n-1) to a palette index along that axis, for
 *  a P-wide nine-slice with border `b`. Verbatim port of nineSliceAxisIndex. */
function axisIndex(idx: number, n: number, b: number, P: number): number {
  b = Math.min(Math.max(b, 0), Math.floor((P - 1) / 2));
  const bEff = Math.min(b, Math.floor(n / 2));
  if (idx < bEff) return idx;
  if (idx >= n - bEff) return P - 1 - (n - 1 - idx);
  const cCount = P - 2 * b; // center band width (>= 1)
  const k = idx - bEff;
  return b + ((Math.floor(cCount / 2) + k) % cCount);
}

const autoEdge = (e: number, size: number): number => (e >= 0 ? e : Math.floor((size - 1) / 2));

/** Modes drawn by stretching a palette grid over an object footprint. */
export function isStructureMode(mode: number): boolean {
  return mode === PaletteMode.NINE_PATCH || mode === PaletteMode.CLIFF ||
    mode === PaletteMode.EDGE_CLIFF || mode === PaletteMode.HOUSE1 ||
    mode === PaletteMode.H_STRETCH || mode === PaletteMode.V_STRETCH;
}

/** Nine-slice the palette over `rect` (tile coords), blitting atlas tiles. */
export function blitNineSlice(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasImageSource,
  palette: Palette,
  rect: Rect,
  s: number,
): void {
  const [ox, oy, w, h] = rect;
  const [pw, ph] = palette.size;
  const ex = autoEdge(palette.edge?.[0] ?? -1, pw);
  const ey = autoEdge(palette.edge?.[1] ?? -1, ph);
  const tr = palette.tileResolution;
  for (let ly = 0; ly < h; ly++) {
    const pr = axisIndex(ly, h, ey, ph);
    for (let lx = 0; lx < w; lx++) {
      const pc = axisIndex(lx, w, ex, pw);
      const [ax, ay] = mappingCell(palette.mapping, pc, pr);
      blitTile(ctx, atlas, ax, ay, tr, ox + lx, oy + ly, s);
    }
  }
}
