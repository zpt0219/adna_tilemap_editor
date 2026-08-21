// layers.ts — the four layers a road tile is made of, and how they stack.
//
// This started as a decomposition of a hand-drawn sheet: one role character per
// pixel, read back as silhouette / kerb / centreline so that any one of them
// could be regenerated while the other two stayed the artist's. The drawing is
// gone — the generator reproduces it now — and what survives is the part that
// was never about the art: the SHAPE OF THE DATA, and the ring index.
//
//   1. 地形A  `fill`     the silhouette. One flat colour.
//   2. 过渡带 `band`     the kerb: two dark tones dithered along the outer edge.
//   3. 中轴   `centre`   the line down the middle.
//   4. 路面   `surface`  where a texture darkens the surface. Optional, because
//                        a plain road has no such layer at all.
//
// Stacked fill -> surface -> band -> centre they compose to RGBA. The four are
// disjoint by construction — each stage skips what the ones before it claimed —
// so the order does not decide anything today, and it is fixed here anyway
// because it says what the layers MEAN: the texture is paint on the road, the
// kerb is the road's edge, and the centreline is drawn over both.
//
// `depth` is the other half of the point. It is the across-road coordinate,
// recovered from the silhouette by peeling rather than computed, so a stage can
// ask "how far in is this pixel" of whatever shape the stage before it made.

import type { RGB, RoleColours } from './palette';

/** Which tone the transition band puts on a pixel. */
export const BAND_NONE = 0;
export const BAND_EDGE = 1;
export const BAND_ALT = 2;

export interface Layers {
  size: number;
  /** 1 where the road is drawn at all. The silhouette. */
  fill: Uint8Array;
  /**
   * Rings from the silhouette's outer edge, 1-based; 0 where nothing is drawn.
   *
   * The across-road coordinate, recovered rather than computed. Interior deeper
   * than the peel can reach is pinned at `size`.
   */
  depth: Int16Array;
  /** BAND_NONE / BAND_EDGE / BAND_ALT. Only meaningful where `fill` is 1. */
  band: Uint8Array;
  /** 1 where the centreline is drawn. */
  centre: Uint8Array;
  /**
   * How dark the surface is at this pixel: 0 is its own flat tone, 1..n step
   * toward the kerb's colour.
   *
   * An INDEX rather than a flag, because 横向渐变 needs more than one step. The
   * scattered textures only ever write 1, which is why `SURF_ALT` is still a
   * named constant.
   *
   * OPTIONAL, unlike the other three: a road with no texture has no such layer,
   * and absent means "all plain" rather than "an array of zeroes".
   */
  surface?: Uint8Array;
}

/**
 * Ring index by repeated peeling, with the tile's border REPLICATED outward.
 *
 * The replication is the whole subtlety. A pixel on an open border is not on
 * the silhouette's edge — the road continues into the neighbour — but a tile
 * only holds its own square, so a naive peel would treat every border pixel as
 * an outer ring and wrap the road in a kerb that only exists at the seam.
 * Clamping out-of-bounds reads to the border pixel says "whatever is at the
 * edge continues", which is exactly right for a straight run crossing it, and
 * costs nothing on a closed border where that row is empty anyway.
 *
 * Reading the CURRENT eroded set rather than the original matters too: the
 * replica has to retreat as the peel does, or a border pixel would be held up
 * by a ghost of itself and never peel at all.
 */
export function depthMap(fill: Uint8Array, size: number): Int16Array {
  const depth = new Int16Array(size * size);
  const cur = Uint8Array.from(fill);
  const at = (x: number, y: number) =>
    cur[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];

  for (let d = 1; d <= size; d++) {
    const peeled: number[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (!cur[i]) continue;
        if (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)) continue;
        peeled.push(i);
      }
    }
    if (peeled.length === 0) break;
    for (const i of peeled) { depth[i] = d; cur[i] = 0; }
  }

  // A tile with no reachable edge (every neighbour drawn, all the way out) has
  // no ring to give; pin it past the deepest measurable one instead of leaving
  // it at 0, which means "not drawn".
  for (let i = 0; i < cur.length; i++) if (cur[i]) depth[i] = size;
  return depth;
}

/**
 * What a sheet is RENDERED and exported at, per tile.
 *
 * 32, and everything generated is evaluated AT 32. The reference this was
 * fitted to was drawn at 16, and its lattice is an artefact of that — measure
 * where the drawing put things, never copy the spacing it was forced into.
 */
export const OUTPUT_SIZE = 32;

/**
 * Stack the layers into RGBA.
 *
 * `ramp` maps a surface index to a tone; index 0 is never read because 0 means
 * "leave it". A single-step texture passes `[_, edgeAlt]` and the sheet stays
 * at four colours — the reference's own tones were a ramp, and `edgeAlt`
 * measures as `path` blended 53% toward `edge`, so the tone a second surface
 * layer wants was already in the palette. See `surfaceRamp`.
 */
export function composeLayers(
  layers: Layers,
  colours: RoleColours,
  ramp: readonly RGB[] = [colours.path, colours.edgeAlt],
  out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(
    new ArrayBuffer(layers.size * layers.size * 4)
  )
): Uint8ClampedArray<ArrayBuffer> {
  const { fill, band, centre, surface } = layers;
  for (let i = 0; i < fill.length; i++) {
    if (!fill[i]) continue;
    let c: RGB = colours.path;
    const s = surface?.[i] ?? 0;
    if (s > 0) c = ramp[Math.min(s, ramp.length - 1)] ?? colours.edgeAlt;
    if (band[i] === BAND_EDGE) c = colours.edge;
    else if (band[i] === BAND_ALT) c = colours.edgeAlt;
    if (centre[i]) c = colours.centre;
    const p = i * 4;
    out[p] = c.r;
    out[p + 1] = c.g;
    out[p + 2] = c.b;
    out[p + 3] = 255;
  }
  return out;
}
