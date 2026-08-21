// edgeStyles.ts — the family of boundary treatments.
//
// Every one of these returns a displacement in [-1, 1] which the caller scales
// by `roughness` and adds to `t`. They differ only in what they are a function
// of, and that difference is the whole taxonomy:
//
//   * position-based  (gravel, jagged, boulder, thorn, moss) — noise over the
//     tile, which is what autotile_mixer bakes;
//   * ALONG-ROAD      (wave, scallop) — a function of `s`, which a terrain
//     scheme cannot express at all. The mixer wants these and has to fake them
//     by bucketing the local tangent into four directions, because "distance
//     along the boundary" is a global quantity a blob47 tile cannot know. A
//     road knows it exactly on every straight run.
//
// ---------------------------------------------------------------------------
// Two rules, both load-bearing
// ---------------------------------------------------------------------------
//
//  1. EVERY generator must repeat with the 32px tile in both axes. A tile
//     paints in local coordinates, so only a tile-periodic function is also a
//     function of GLOBAL position, and only then do two neighbours agree about
//     where the boundary is. Lattices wrap their cell index; the pixel hash
//     wraps its coordinates; the along-road terms take wavelengths that divide
//     32. `edgeStyles.test.ts` sweeps all of it.
//
//  2. The amplitude is charged against the border-clearance budget by
//     `maxHalfWidth`, because a displacement pushes the boundary OUTWARD and
//     nothing may reach a closed border.

export type EdgeStyle =
  | 'smooth' | 'hand' | 'gravel' | 'jagged' | 'boulder' | 'thorn' | 'moss';

const TILE = 32;

/** Lattice hash in [0,1), wrapped so the lattice repeats with the tile. */
function cellHash(ix: number, iy: number, seed: number, per: number): number {
  const wx = ((ix % per) + per) % per;
  const wy = ((iy % per) + per) % per;
  let n = Math.imul(wx, 374761393) + Math.imul(wy, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [-1,1], periodic over `per` cells per tile. */
function value(u: number, v: number, seed: number, per: number): number {
  const fx = (u / TILE) * per, fy = (v / TILE) * per;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const fade = (t: number) => t * t * (3 - 2 * t);
  const tx = fade(fx - x0), ty = fade(fy - y0);
  const h = (ix: number, iy: number) => cellHash(ix, iy, seed, per) * 2 - 1;
  const a = h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx;
  const b = h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

/** Per-pixel hash in [-1,1], periodic with the tile. */
function grain(u: number, v: number, seed: number): number {
  const wx = ((Math.floor(u) % TILE) + TILE) % TILE;
  const wy = ((Math.floor(v) % TILE) + TILE) % TILE;
  let n = Math.imul(wx, 2246822519) + Math.imul(wy, 3266489917) + Math.imul(seed, 668265263);
  n = Math.imul(n ^ (n >>> 15), 2654435761);
  return (((n ^ (n >>> 13)) >>> 0) / 4294967296) * 2 - 1;
}

/**
 * Cellular noise: distance to the nearest feature point, one per lattice cell,
 * searched over the 3x3 neighbourhood with the cell index wrapped.
 *
 * The wrap is what makes it tile — a feature point in the last column is also
 * the feature point one tile to the left, so a boundary crossing the seam sees
 * the same cluster from both sides.
 */
function worley(u: number, v: number, seed: number, per: number): number {
  const fx = (u / TILE) * per, fy = (v / TILE) * per;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x0 + dx, cy = y0 + dy;
      const px = cx + cellHash(cx, cy, seed, per);
      const py = cy + cellHash(cx, cy, seed + 7919, per);
      const d = Math.hypot(fx - px, fy - py);
      if (d < best) best = d;
    }
  }
  // ~0 at a cell centre, ~1 between them; centre it.
  return Math.max(-1, Math.min(1, best * 2 - 1));
}

/**
 * Displacement of the boundary at this pixel, in [-1, 1].
 *
 * Every style here is a pure function of GLOBAL POSITION, and the two that were
 * not are gone. `wave` and `scallop` read the along-road coordinate, which is
 * what 圆弧波浪线 already is — and their absence is load-bearing, not tidiness:
 * it is what lets this noise be TWO-SIDED. An outward displacement that reads
 * `s` breaks the seam, because far from the skeleton a corner tile's nearest
 * element can be the other arm and `s` then comes off a different axis. A
 * displacement that never asks cannot care. See `boundary`.
 */
export function edgeDisplacement(
  style: EdgeStyle,
  u: number,
  v: number,
  seed: number,
  lattice: number
): number {
  if (style === 'smooth' || seed === 0) return 0;
  const per = Math.max(1, Math.round(lattice));
  switch (style) {
    case 'hand':
      // FITTED to the reference drawing, and the only entry here that is.
      //
      // The drawing's outline wobbles by about one art pixel around its mean
      // and is APERIODIC — measured on its straight north-south tile, the
      // autocorrelation of each flank's deviation runs 0.62 at lag 1, 0.22 at
      // lag 2 and -0.005 at lag 3, with no positive peak at any lag out to 8.
      // So it is correlated over roughly two art pixels and then it is gone.
      //
      // Sweeping this generator's lattice against that, at the 32px the sheet
      // is actually evaluated at, `per = 8` wins outright:
      //
      //   per   cell    acf lag1..4               rms vs the drawing
      //     4   8.0px   0.92 0.81 0.67 0.53             0.283
      //     6   5.3px   0.92 0.76 0.56 0.37             0.198
      //     8   4.0px   0.87 0.61 0.34 0.13             0.104   <-- fit
      //    10   3.2px   0.81 0.47 0.19 0.03             0.141
      //    16   2.0px   0.63 0.15 -0.03 -0.05           0.301
      //
      // A 4-output-pixel cell is two ART pixels, which is the correlation
      // length measured at 16px — two independent measurements landing on the
      // same number, which is the sort of thing worth writing down.
      //
      // PURE value noise, no grain term. That is the difference from `gravel`,
      // which uses this same generator at this same lattice and then mixes 65%
      // per-pixel dither into it. The dither is what sheds detached specks: at
      // 2px of amplitude `gravel` breaks the road into pieces on three of the
      // 16 masks while this one holds. A hand wobbles a line; it does not
      // sprinkle it.
      return value(u, v, seed, 8);
    case 'gravel':
      // Fine crumble. Mixed rather than pure because a hand-drawn edge measures
      // between the two: adjacent boundary pixels of the reference drawing agree
      // 64.4% of the time, where a smooth wobble is far higher and a pure
      // dither is 50%.
      return value(u, v, seed, Math.max(per, 8)) * 0.35 + grain(u, v, seed) * 0.65;
    case 'jagged':
      // Ridged: the folded absolute value puts creases where the noise crosses
      // zero, which reads as broken rock rather than as lumps.
      return 1 - 2 * Math.abs(value(u, v, seed, per));
    case 'boulder':
      // Same noise, coarse lattice, left smooth — big rolling masses.
      return value(u, v, seed, Math.max(1, Math.min(3, per)));
    case 'thorn': {
      // Ridged and sharpened: cubing pulls everything toward the creases, so
      // the edge spends most of its length flat and spikes at intervals.
      const r = 1 - 2 * Math.abs(value(u, v, seed, Math.max(per, 6)));
      return r * r * r;
    }
    case 'moss':
      return worley(u, v, seed, Math.max(2, Math.min(6, per)));
    default:
      return 0;
  }
}
