// axial.ts — the along-road half of a path's geometry, and the dice.
//
// A terrain autotiler only ever asks "how far am I from the boundary". A path
// is a curve with a WIDTH, so it also has an along-road coordinate, and the
// motifs that read it — dashes, ribs, a scattered line — are what this file
// serves. What survives here after the second generator was retired is the part
// every stage still shares: the periods that divide the tile, the wrap, the
// junction test, and the two hashes.
//
// ⚠ EVERY periodic or random thing here is TILE-PERIODIC, and that is not a
// style choice. A tile paints in local coordinates and a map lays the same 16
// tiles down over and over, so only a function that repeats with the tile is
// also a function of GLOBAL position — and only then do two neighbours agree
// about what is drawn where they meet.

import { DIRECTIONS } from './twoEdge';
import { TILE_SIZE } from './pathField';

export const AXIAL_PERIODS = [4, 8, 16, 32] as const;
export const DEFAULT_PERIOD = 8;

export function snapPeriod(p: number): number {
  let best: number = AXIAL_PERIODS[0];
  for (const c of AXIAL_PERIODS) if (Math.abs(c - p) < Math.abs(best - p)) best = c;
  return best;
}

/** Positive remainder, so a negative `s` still lands in [0, period). */
export const wrap = (v: number, period: number) => ((v % period) + period) % period;

// ---------------------------------------------------------------------------
// Phase — where a periodic motif sits relative to the crossing
// ---------------------------------------------------------------------------
//
// Shared by every stage that repeats along the road: the dashed centreline, the
// surface ribs, the kerb motif. ⚠ ONE implementation on purpose. Two copies of
// "where does a period sit" drift, and the symptom is a junction that is not
// symmetric — which is exactly the bug the phase below was written to fix.

/**
 * Is the dash ON at this point along the road?
 *
 * Phased so the wave is a MIRROR about the tile centre, which is what makes a
 * junction symmetric. `wrap(s, P) < P/2` — the obvious form, and the one
 * `axial.ts` uses — measures from the tile's corner, so at a crossroads the
 * four arms all carried different phases: measured, the 4-way tile disagreed
 * with its own mirror image in 64 pixels north-south and 60 east-west, at every
 * period. It looked like the dashes had been scattered.
 *
 * Two things fix it, and both are needed:
 *
 *   * `- TILE_SIZE/2` moves the origin to the crossing. It only bites at period
 *     32, where 16 is half a period rather than a whole number of them — at 4,
 *     8 and 16 it is a no-op. Without it, period 32 centres its GAP on the
 *     crossing and its dash on the seam, which is symmetric but is the wrong
 *     one of the two: 路口不断线 was already settled, off the drawing.
 *   * `+ P/4` lands the centre of an ON block on the crossing rather than an
 *     edge of one. A square wave mirrors about its block centres, and they sit
 *     a quarter period from where the wave turns on.
 *
 * Still a pure function of the coordinate with period P, and P divides the
 * tile, so both seam proofs are exactly as they were — the shift is a constant
 * and every tile applies the same one.
 *
 * The half-open `<` never decides anything here: the shifts are integers and
 * pixel centres are half-integers, so no sample ever lands on a block edge.
 */
export function dashOn(s: number, period: number): boolean {
  return wrap(s - TILE_SIZE / 2 + period / 4, period) < period / 2;
}

/**
 * Distance along the road from the nearest LONG dash's centre, in output px.
 *
 * The long centres sit on the tile centre and every period from it, so this is
 * symmetric about the crossing by construction rather than by arithmetic luck.
 */
export function alongFromCrossing(s: number, period: number): number {
  return Math.abs(wrap(s - TILE_SIZE / 2 + period / 2, period) - period / 2);
}

// ---------------------------------------------------------------------------
// Junctions
// ---------------------------------------------------------------------------

/** Three or more arms: the along-road axis is ambiguous here. */
export function isJunction(bits: number): boolean {
  let n = 0;
  for (const { bit } of DIRECTIONS) if (bits & bit) n++;
  return n >= 3;
}

/**
 * Tile-periodic per-pixel hash in [0,1).
 *
 * Keyed on the pixel index modulo the tile, so it is a pure function of global
 * position and two tiles agree wherever they share a pixel column or row. Every
 * irregular motif here goes through it rather than through Math.random, for
 * exactly that reason.
 */
export function axialHash(a: number, b: number, seed: number): number {
  const wa = ((Math.floor(a) % 32) + 32) % 32;
  const wb = ((Math.floor(b) % 32) + 32) % 32;
  let n = Math.imul(wa, 2246822519) + Math.imul(wb, 3266489917) + Math.imul(seed | 0, 668265263);
  n = Math.imul(n ^ (n >>> 15), 2654435761);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

/**
 * Which tone a dithered kerb ring takes at this pixel.
 *
 * 0 leaves it plain surface, 1 is the kerb colour, 2 is its second tone.
 *
 * Not a stylistic invention — it is what the reference drawing measured as. Its
 * outermost ring was 57% plain surface, 29% `#bf7958` and 14% `#d58b60`, with
 * both dark tones sitting 86-100% in that one ring and no periodicity along the
 * edge that a chi-square could find. So the "kerb" of a hand-drawn dirt path is
 * a broken, two-tone, one-pixel dither rather than an outline, and the default
 * weights below are those measured shares.
 */
export interface DitherOptions {
  /** Share of the ring that stays kerb-coloured, 0..1. */
  coverage?: number;
  /** Dice. */
  seed?: number;
}

export function crumbleTone(x: number, y: number, o: DitherOptions): 0 | 1 | 2 {
  const cov = o.coverage ?? 0.43;
  const h = axialHash(x, y, o.seed ?? 1);
  if (h >= cov) return 0;
  return h < cov * 0.67 ? 1 : 2;
}
