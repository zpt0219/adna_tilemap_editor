// blit.ts — draw real atlas tiles into the scene canvas. The scene ctx already
// has imageSmoothingEnabled=false, so tiles stay crisp at native (s===tileRes)
// and on the nearest-neighbour upscale `drawMap` does on blit.

import { mappingCell, type Palette } from "./types";

/** Blit one tileRes×tileRes atlas tile at atlas (ax,ay) to map tile (dx,dy). */
export function blitTile(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasImageSource,
  ax: number,
  ay: number,
  tileRes: number,
  dx: number,
  dy: number,
  s: number,
): void {
  ctx.drawImage(atlas, ax, ay, tileRes, tileRes, dx * s, dy * s, s, s);
}

/**
 * Stamp a FIXED_RECT (or scatter variant) palette: its size[w,h] grid of atlas
 * tiles, anchored at map tile (originX, originY).
 */
export function blitFixedRect(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasImageSource,
  palette: Palette,
  originX: number,
  originY: number,
  s: number,
): void {
  const [w, h] = palette.size;
  const tr = palette.tileResolution;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const [ax, ay] = mappingCell(palette.mapping, i, j);
      blitTile(ctx, atlas, ax, ay, tr, originX + i, originY + j, s);
    }
}
