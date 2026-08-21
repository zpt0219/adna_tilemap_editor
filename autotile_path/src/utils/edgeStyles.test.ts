import { describe, it, expect } from 'vitest';
import { edgeDisplacement, type EdgeStyle } from './edgeStyles';
import { TILE_SIZE } from './pathField';
import { ROUGH_STYLES } from './boundary';

/**
 * Every style the boundary can be given.
 *
 * Taken from the boundary's own list rather than a second copy of it, so a
 * style that is added there cannot skip these checks — which is the only way a
 * non-tiling one would ever reach the sheet.
 */
const IDS = ROUGH_STYLES.map((s) => s.id) as EdgeStyle[];

describe('every edge style', () => {
  it.each(IDS)('%s stays inside [-1, 1]', (style) => {
    for (let u = 0.5; u < TILE_SIZE; u += 0.5) {
      for (let v = 0.5; v < TILE_SIZE; v += 0.5) {
        const d = edgeDisplacement(style, u, v, 5, 4);
        expect(d).toBeGreaterThanOrEqual(-1);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(IDS)('%s repeats with the tile in both axes', (style) => {
    // The one property that makes a per-tile evaluation equal the global one,
    // and therefore the only reason two neighbours agree about the boundary.
    // A lattice that did not wrap its cell index would fail here and nowhere
    // else until it was in a game.
    for (const seed of [1, 5, 38]) {
      for (const lattice of [2, 4, 8]) {
        for (let u = 0.5; u < TILE_SIZE; u += 1) {
          for (let v = 0.5; v < TILE_SIZE; v += 3) {
            const here = edgeDisplacement(style, u, v, seed, lattice);
            expect(edgeDisplacement(style, u + TILE_SIZE, v, seed, lattice))
              .toBeCloseTo(here, 9);
            expect(edgeDisplacement(style, u, v + TILE_SIZE, seed, lattice))
              .toBeCloseTo(here, 9);
            expect(edgeDisplacement(style, u - TILE_SIZE, v, seed, lattice))
              .toBeCloseTo(here, 9);
          }
        }
      }
    }
  });

  it.each(IDS)('%s is inert at seed 0', (style) => {
    // Not decoration: the analytic mode this file used to serve defaulted its
    // seed to 0 and read it as "no jitter", which made every style there a
    // silent no-op until a button was clicked. The boundary clamps its seed to
    // 1 and never hits this, and the behaviour stays pinned so the trap cannot
    // come back through a different door.
    for (let u = 0.5; u < TILE_SIZE; u += 1) {
      expect(edgeDisplacement(style, u, 7.5, 0, 4)).toBe(0);
    }
  });

  it('NONE of them reads the along-road coordinate', () => {
    // The exclusion the two-sided noise rests on. A displacement that asked
    // where it was ALONG the road would break the seam, because far from the
    // skeleton a corner tile's nearest element can be the other arm and the
    // along-road coordinate then comes off a different axis. There is no way to
    // ask any more — the parameter is gone — and this is the assertion that
    // says the family is complete without it.
    expect(edgeDisplacement.length).toBe(5);       // style, u, v, seed, lattice
  });

  it('every style draws a different picture', () => {
    // The duplicate-entry guard. A menu of noises that render alike is the
    // failure this app keeps re-learning.
    const seen = new Map<string, EdgeStyle>();
    for (const style of IDS) {
      let s = '';
      for (let u = 0.5; u < TILE_SIZE; u += 1) {
        for (let v = 0.5; v < TILE_SIZE; v += 1) {
          s += edgeDisplacement(style, u, v, 3, 4).toFixed(3) + ',';
        }
      }
      const prev = seen.get(s);
      expect(prev, `${style} draws the same as ${prev}`).toBeUndefined();
      seen.set(s, style);
    }
  });

  it('smooth is exactly nothing, and the rest are not', () => {
    for (let u = 0.5; u < TILE_SIZE; u += 1) {
      expect(edgeDisplacement('smooth', u, 7.5, 3, 4)).toBe(0);
    }
    for (const style of IDS.filter((s) => s !== 'smooth')) {
      let moved = 0;
      for (let u = 0.5; u < TILE_SIZE; u += 1) {
        if (edgeDisplacement(style, u, 7.5, 3, 4) !== 0) moved++;
      }
      expect(moved, style).toBeGreaterThan(0);
    }
  });
});
