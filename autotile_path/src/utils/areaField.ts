// areaField.ts — the AREA reading of the same 16 masks.
//
// The network reading says "this cell is a road and my neighbours tell me which
// way it runs". The area reading says "this cell IS terrain and my neighbours
// tell me whether the terrain continues". Same 16 masks, completely different
// art — an importer that guesses wrong gets a sheet that looks plausible and
// connects wrongly, which is why the export names the scheme.
//
// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------
//
// A rounded rectangle. Each of the four sides is either flush with the tile
// border (that neighbour continues the terrain) or pulled in by `inset` (it
// does not). A corner is rounded only where BOTH of its sides are pulled in —
// a convex corner. Where both sides are flush the corner is solid, and where
// one is flush the straight edge simply runs on.
//
// That is quadrant states 1, 3, 4 and 5 of the five a blob needs, which is
// exactly what a 2-edge mask can carry.
//
// ---------------------------------------------------------------------------
// ⚠ THE FIFTH STATE — the concave corner — IS NOT EXPRESSIBLE, AND THAT IS THE
// SCHEME, NOT THIS FILE
// ---------------------------------------------------------------------------
//
// A concave corner happens when both edges connect but the DIAGONAL does not.
// A 2-edge mask has no diagonal bit, so this reading has to assume the corner
// filled. `docs/AUTOTILE_SCHEMES.md` §4 counts it: 4 positions x 5 states = 20
// quadrant primitives, of which a 2-edge set covers 16, and the four it misses
// are precisely the concave corners.
//
// The consequence is a SEAM one, and it is measured rather than argued — see
// `areaSeamMismatch`. It is not a bug to be fixed here: no function of four
// bits can know about the fifth neighbour.

import { TILE_SIZE, type Nearest } from './pathField';
import { DIRECTIONS } from './twoEdge';

export interface AreaParams {
  /** How far a disconnected side is pulled in from the tile border, in px. */
  inset: number;
  /** Radius of a convex corner, in px. 0 is a hard right angle. */
  bend: number;
}

/** The largest corner radius an inset can carry without eating the whole side. */
export function maxAreaBend(inset: number): number {
  return Math.max(0, Math.min(TILE_SIZE / 2 - inset, TILE_SIZE / 2 - 1));
}

export interface AreaAt {
  /** How far inside the region, counting every side. Negative outside. */
  inside: number;
  /**
   * How far from a side the terrain actually STOPS at, ignoring the ones it
   * runs through. `Infinity` when the cell is surrounded and has no edge at all.
   *
   * ⚠ THE TWO ARE NOT THE SAME AND CONFLATING THEM BREAKS TILING. A connected
   * side is not a boundary — the terrain continues into the neighbour — so
   * nothing may be drawn along it and nothing may displace it. Using `inside`
   * for the kerb wraps a fully surrounded cell in an outline it should not
   * have; using it for the noise lets the wobble eat a border that has to stay
   * flush, and then the sheet stops tiling. Both were live bugs before this
   * split existed.
   */
  edge: number;
}

/**
 * Distance to a rounded rectangle, done the standard way: fold the point into
 * the first quadrant of the box, then measure to the corner arc if it is past
 * both flats and to the nearer flat otherwise. The rounding is applied per
 * CORNER rather than to the box as a whole, because only some corners are
 * convex — which is the whole content of the mask.
 */
export function areaAt(u: number, v: number, bits: number, o: AreaParams): AreaAt {
  let n = 0, e = 0, s = 0, w = 0;
  for (const d of DIRECTIONS) {
    const off = (bits & d.bit) ? 0 : o.inset;
    if (d.dy < 0) n = off;
    else if (d.dy > 0) s = off;
    else if (d.dx > 0) e = off;
    else w = off;
  }

  // Distance to each of the four straight sides, positive inside.
  const dN = v - n;
  const dS = (TILE_SIZE - s) - v;
  const dW = u - w;
  const dE = (TILE_SIZE - e) - u;

  let inside = Math.min(dN, dS, dW, dE);
  // Only a side the terrain STOPS at is an edge.
  let edge = Math.min(
    n > 0 ? dN : Infinity, s > 0 ? dS : Infinity,
    w > 0 ? dW : Infinity, e > 0 ? dE : Infinity
  );

  // A corner is rounded only when BOTH its sides are inset. Anywhere else the
  // straight distance is already the answer.
  const r = Math.max(0, Math.min(o.bend, maxAreaBend(o.inset)));
  if (r > 0) {
    const corners: [number, number, boolean][] = [
      [dN, dW, n > 0 && w > 0],
      [dN, dE, n > 0 && e > 0],
      [dS, dW, s > 0 && w > 0],
      [dS, dE, s > 0 && e > 0],
    ];
    for (const [p, q, rounded] of corners) {
      if (!rounded) continue;
      // Only inside the corner's own r x r square does the arc decide anything.
      if (p >= r || q >= r) continue;
      const dist = r - Math.hypot(r - p, r - q);
      if (dist < inside) inside = dist;
      if (dist < edge) edge = dist;
    }
  }
  return { inside, edge };
}

/** Just the inside distance, for the callers that only need to know in or out. */
export function areaDistance(u: number, v: number, bits: number, o: AreaParams): number {
  return areaAt(u, v, bits, o).inside;
}

/**
 * The area field dressed as the network one, so the three stages can read it.
 *
 * `t` is distance from the BOUNDARY rather than from a skeleton, and that is
 * the honest translation: an area has no centreline to measure from. The
 * boundary stage compares `t` against a threshold either way, so it does not
 * care which — but everything that reads `s` does, and there is no along-road
 * coordinate here at all. `axis` is null for exactly that reason, and the
 * motifs that need one are not offered in this scheme.
 */
export function areaNearest(u: number, v: number, bits: number, o: AreaParams): Nearest {
  return { t: areaDistance(u, v, bits, o), axis: null, along: null };
}
