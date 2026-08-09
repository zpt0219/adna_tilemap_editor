import { describe, it, expect } from 'vitest';
import {
  RIBBONS, RIBBON_GROUPS, RIBBON_MIN_WIDTH, RIBBON_PERIODS, DEFAULT_RIBBON,
  DEFAULT_RIBBON_PERIOD, MIN_RIBBON_SHADES, MAX_RIBBON_SHADES, NO_RIBBON,
  ribbonShadeAt, ribbonUsesInvert, ribbonUsesPeriod, snapRibbonPeriod, usedRibbonShades,
  type RibbonId,
} from './patternRibbon';
import {
  PATTERN_TILE_SIZE, patternLevelsForMask, patternBandCoords,
  BAND_CACHE_MAX, bandCacheSize, PATTERNS, type PatternId,
} from './blob47Pattern';
import { canonicalizeBlobMask, BLOB47_MASKS, N, E, S, W, NE, SE, SW, NW } from './blob47';

const ALL: RibbonId[] = RIBBONS.map((r) => r.id).filter((id) => id !== 'none');

describe('the ribbon menu', () => {
  it('keeps the grouped menu and the flat list in step', () => {
    const grouped = RIBBON_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(grouped).toEqual(RIBBONS.map((r) => r.id));
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const g of RIBBON_GROUPS) expect(g.items.length).toBeGreaterThan(0);
  });

  it('gives every motif a minimum width and a default that is drawn, not flat', () => {
    for (const id of RIBBONS.map((r) => r.id)) {
      expect(RIBBON_MIN_WIDTH[id]).toBeGreaterThanOrEqual(1);
    }
    expect(DEFAULT_RIBBON).not.toBe('none');
    expect(RIBBON_MIN_WIDTH[DEFAULT_RIBBON]).toBeLessThanOrEqual(2);
  });

  // The seam rule, restated as a menu constraint: `s` is a local coordinate that
  // differs from the global one by a multiple of the tile size, so a period that
  // does not divide it restarts the motif at every seam.
  it('offers only periods that divide the tile', () => {
    for (const p of RIBBON_PERIODS) expect(PATTERN_TILE_SIZE % p).toBe(0);
    expect(RIBBON_PERIODS).toContain(DEFAULT_RIBBON_PERIOD);
    expect(snapRibbonPeriod(6)).toBe(8);
    expect(snapRibbonPeriod(999)).toBe(16);
    for (const p of RIBBON_PERIODS) expect(snapRibbonPeriod(p)).toBe(p);
  });

  it('says which controls each motif actually reads', () => {
    expect(ribbonUsesPeriod('dashes')).toBe(true);
    expect(ribbonUsesPeriod('bevel')).toBe(false);
    expect(ribbonUsesInvert('bevel')).toBe(true);
    expect(ribbonUsesInvert('dashes')).toBe(false);
  });
});

describe('ribbon motifs', () => {
  const scan = (id: RibbonId, opts: Partial<{
    width: number; amount: number; shades: number; period: number; invert: boolean; seed: number;
  }> = {}) => {
    const { width = 4, amount = 1, shades = 2, period = 8, invert = false, seed = 0 } = opts;
    const out: number[] = [];
    for (let i = -40; i < 40; i++) {
      for (let j = 0; j < width; j++) {
        out.push(ribbonShadeAt(id, i, (j + 0.5) / width, width, seed, amount, shades, period, invert));
      }
    }
    return out;
  };

  it.each(ALL)('%s stays inside 0..shades', (id) => {
    for (const shades of [MIN_RIBBON_SHADES, 2, MAX_RIBBON_SHADES]) {
      for (const k of scan(id, { shades })) {
        expect(Number.isInteger(k)).toBe(true);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(shades);
      }
    }
  });

  it.each(ALL)('%s paints nothing at amount 0', (id) => {
    expect(scan(id, { amount: 0 }).every((k) => k === 0)).toBe(true);
  });

  it.each(ALL)('%s paints something at its minimum width', (id) => {
    const w = RIBBON_MIN_WIDTH[id];
    expect(scan(id, { width: w, amount: 0.75 }).some((k) => k > 0)).toBe(true);
  });

  // The periodic motifs are the ones the seam argument is about, so their
  // period has to be real: shifting by it must reproduce the motif exactly.
  it.each(ALL.filter(ribbonUsesPeriod))('%s repeats on the period it was given', (id) => {
    for (const period of RIBBON_PERIODS) {
      for (let i = -20; i < 20; i++) {
        for (let j = 0; j < 4; j++) {
          const d = (j + 0.5) / 4;
          expect(ribbonShadeAt(id, i + period, d, 4, 0, 0.6, 2, period, false))
            .toBe(ribbonShadeAt(id, i, d, 4, 0, 0.6, 2, period, false));
        }
      }
    }
  });

  it.each(ALL.filter(ribbonUsesPeriod))('%s changes when the period does', (id) => {
    // Half strength: at a full duty cycle a periodic motif covers the whole
    // ribbon and every period looks alike.
    expect(scan(id, { period: 4, amount: 0.5 }).join())
      .not.toBe(scan(id, { period: 16, amount: 0.5 }).join());
  });

  it.each(ALL.filter((id) => !ribbonUsesPeriod(id)))('%s ignores the period control', (id) => {
    expect(scan(id, { period: 2, amount: 0.5 }).join())
      .toBe(scan(id, { period: 16, amount: 0.5 }).join());
  });

  it.each(ALL.filter(ribbonUsesInvert))('%s mirrors across the width when inverted', (id) => {
    const w = 4;
    for (let i = -10; i < 10; i++) {
      for (let j = 0; j < w; j++) {
        const d = (j + 0.5) / w;
        expect(ribbonShadeAt(id, i, d, w, 0, 0.8, 2, 8, true))
          .toBe(ribbonShadeAt(id, i, 1 - d, w, 0, 0.8, 2, 8, false));
      }
    }
  });

  it('bevel grades across the width and reads only the width', () => {
    // The default motif, and the one that has to work at a 2px outline: one
    // plain face and one lit face, growing into a gradient as it widens.
    const at = (w: number, j: number) =>
      ribbonShadeAt('bevel', 0, (j + 0.5) / w, w, 0, 1, 2, 8, false);
    expect(at(2, 0)).toBe(0);
    expect(at(2, 1)).toBeGreaterThan(0);
    expect([at(6, 0), at(6, 5)]).toEqual([0, 2]);
    for (let j = 0; j + 1 < 6; j++) expect(at(6, j + 1)).toBeGreaterThanOrEqual(at(6, j));
    // No dependence on position along the edge.
    for (let i = -8; i < 8; i++) {
      expect(ribbonShadeAt('bevel', i, 0.9, 4, 0, 1, 2, 8, false)).toBe(at(4, 3));
    }
  });

  it('dashes spend `amount` as a duty cycle', () => {
    const lit = (amount: number) => {
      let n = 0;
      for (let i = 0; i < 64; i++) if (ribbonShadeAt('dashes', i, 0.5, 4, 0, amount, 2, 8, false) > 0) n++;
      return n / 64;
    };
    expect(lit(0.25)).toBeCloseTo(0.25, 2);
    expect(lit(0.5)).toBeCloseTo(0.5, 2);
    expect(lit(1)).toBe(1);
  });

  // Bevel is the exception on purpose: it reads only the depth, so a dice roll
  // has nothing to slide and the control is inert for it.
  it.each(ALL.filter((id) => id !== 'bevel'))('%s slides along the edge with the seed', (id) => {
    const seen = new Set([0, 1, 3, 5, 13, 21].map((seed) => scan(id, { seed, amount: 0.5 }).join()));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('leaves bevel alone whatever the seed, having no phase to shift', () => {
    for (const seed of [0, 1, 7, 99]) {
      expect(scan('bevel', { seed }).join()).toBe(scan('bevel', { seed: 0 }).join());
    }
  });

  it.each(ALL)('%s reports the shades it actually paints', (id) => {
    for (const amount of [0.3, 0.7, 1]) {
      const used = usedRibbonShades(id, 4, amount, 3, 8, false);
      const scanned = new Set(scan(id, { amount, shades: 3 }));
      // Reported must cover what a real scan finds — a swatch greyed out with
      // pixels on screen is the failure this guards.
      for (const k of scanned) expect(used).toContain(k);
    }
  });

  it('is off when the caller says none', () => {
    expect(NO_RIBBON.algo).toBe('none');
    for (let i = 0; i < 32; i++) {
      expect(ribbonShadeAt('none', i, 0.5, 4, 0, 1, 2, 8, false)).toBe(0);
    }
  });
});

// The one property of ribbon space that could not be settled by argument. `s`
// is picked from the local gradient, and at a tile border that gradient is
// computed from clamped samples — the neighbour's field is not there to read.
// If the orientation class comes out different on the two sides of a seam, the
// motif switches coordinate system mid-run and the phase hitches.
//
// The measurement that settled it is comparative, and the comparison is the
// whole point. Re-phasing is INTRINSIC to picking a coordinate from the local
// tangent: two adjacent outline pixels inside a single tile already land in
// different buckets 4% of the time on `rounded` and 16% on `moss`, because that
// is what a silhouette baked from noise does. So the question is not whether
// seams re-phase — everything does — but whether a seam is a WORSE place for it
// than anywhere else. It is not, and that is what these tests pin: if the border
// handling in `derivative` regressed, the seam rate would climb away from the
// in-tile rate and this would fail.
describe('ribbon coordinates across seams', () => {
  const N32 = PATTERN_TILE_SIZE;

  const maskAt = (filled: (c: number, r: number) => boolean, c: number, r: number) => {
    let m = 0;
    if (filled(c, r - 1)) m |= N;
    if (filled(c + 1, r)) m |= E;
    if (filled(c, r + 1)) m |= S;
    if (filled(c - 1, r)) m |= W;
    if (filled(c + 1, r - 1)) m |= NE;
    if (filled(c + 1, r + 1)) m |= SE;
    if (filled(c - 1, r + 1)) m |= SW;
    if (filled(c - 1, r - 1)) m |= NW;
    return canonicalizeBlobMask(m);
  };

  const LAYOUTS: readonly ((c: number, r: number) => boolean)[] = [
    (_c, r) => r === 3,                          // a horizontal strip
    (c) => c === 3,                              // a vertical strip
    (c, r) => r >= c,                            // a 45 degree shoreline
    (c, r) => r + c >= 7,                        // the other diagonal
    (c, r) => c >= 2 && c <= 5 && r >= 2 && r <= 5,  // a solid block
    (c, r) => (c + r) % 3 !== 0,                 // ragged, for the corner cases
  ];

  /** Outline pixel pairs facing each other across a seam, and how many jump. */
  const seamPhase = (pattern: PatternId) => {
    let pairs = 0;
    let jumps = 0;
    for (const filled of LAYOUTS) {
      for (let r = 1; r < 7; r++) {
        for (let c = 1; c < 7; c++) {
          if (!filled(c, r)) continue;
          const here = patternBandCoords(pattern, maskAt(filled, c, r));
          const hereLv = patternLevelsForMask(pattern, maskAt(filled, c, r));

          // The seam to the east: this tile's last column against the next
          // tile's first.
          if (filled(c + 1, r)) {
            const east = patternBandCoords(pattern, maskAt(filled, c + 1, r));
            const eastLv = patternLevelsForMask(pattern, maskAt(filled, c + 1, r));
            for (let y = 0; y < N32; y++) {
              const a = y * N32 + (N32 - 1);
              const b = y * N32;
              if (hereLv.charCodeAt(a) - 48 !== 2 || eastLv.charCodeAt(b) - 48 !== 2) continue;
              pairs++;
              if (Math.abs((east.s[b] + (c + 1) * N32) - (here.s[a] + c * N32)) > 1 + 1e-6) jumps++;
            }
          }

          // And the seam to the south.
          if (filled(c, r + 1)) {
            const south = patternBandCoords(pattern, maskAt(filled, c, r + 1));
            const southLv = patternLevelsForMask(pattern, maskAt(filled, c, r + 1));
            for (let x = 0; x < N32; x++) {
              const a = (N32 - 1) * N32 + x;
              const b = x;
              if (hereLv.charCodeAt(a) - 48 !== 2 || southLv.charCodeAt(b) - 48 !== 2) continue;
              pairs++;
              if (Math.abs((south.s[b] + (r + 1) * N32) - (here.s[a] + r * N32)) > 1 + 1e-6) jumps++;
            }
          }
        }
      }
    }
    return { pairs, jumps };
  };

  /** The same measurement between neighbours INSIDE a tile, as the baseline. */
  const inTilePhase = (pattern: PatternId) => {
    let pairs = 0;
    let jumps = 0;
    for (const mask of BLOB47_MASKS) {
      const levels = patternLevelsForMask(pattern, mask);
      const coords = patternBandCoords(pattern, mask);
      const step = (a: number, b: number) => {
        if (levels.charCodeAt(a) - 48 !== 2 || levels.charCodeAt(b) - 48 !== 2) return;
        pairs++;
        if (Math.abs(coords.s[b] - coords.s[a]) > 1 + 1e-6) jumps++;
      };
      for (let y = 0; y < N32; y++) for (let x = 0; x + 1 < N32; x++) step(y * N32 + x, y * N32 + x + 1);
      for (let y = 0; y + 1 < N32; y++) for (let x = 0; x < N32; x++) step(y * N32 + x, (y + 1) * N32 + x);
    }
    return { pairs, jumps };
  };

  it.each(PATTERNS.map((p) => p.id))('%s re-phases no more often at a seam than inside a tile', (id) => {
    const seam = seamPhase(id);
    const inside = inTilePhase(id);
    expect(seam.pairs).toBeGreaterThan(20);
    expect(inside.pairs).toBeGreaterThan(1000);
    // Measured, seam rate against in-tile rate: square, rounded, sharp, jagged,
    // boulder, billow and thorn re-phase at a seam exactly ZERO times; coast
    // 7.7% against 7.3%; moss 14.0% against 18.7%, i.e. better at seams than
    // inside. `gravel` is the one outlier at 17.4% against 8.5% — 27 pixels out
    // of 155, on the pattern whose silhouette is deliberately the most crumbly.
    // The slack is set to catch that rate doubling, not to be tight around it.
    expect(seam.jumps / seam.pairs).toBeLessThanOrEqual(inside.jumps / inside.pairs + 0.1);
  });

  // The clean-edged patterns are the ones an along-axis motif is really for, so
  // they get an absolute bound rather than a comparative one.
  it.each(['square', 'rounded', 'sharp', 'boulder'] as const)(
    '%s holds its phase over long stretches, seams included', (id) => {
      const seam = seamPhase(id);
      const inside = inTilePhase(id);
      expect(seam.jumps).toBe(0);
      expect(inside.jumps / inside.pairs).toBeLessThan(0.1);
    });

  it('depth spans the outline and nothing wider', () => {
    // The other ribbon coordinate, which needs no seam argument — it is the
    // distance the level grid already agrees on — but does need its ends pinned,
    // or every motif would be squashed against one face.
    for (const id of PATTERNS.map((p) => p.id)) {
      const levels = patternLevelsForMask(id, 15);
      const coords = patternBandCoords(id, 15);
      let lo = 1;
      let hi = 0;
      for (let p = 0; p < N32 * N32; p++) {
        if (levels.charCodeAt(p) - 48 !== 2) continue;
        lo = Math.min(lo, coords.depth[p]);
        hi = Math.max(hi, coords.depth[p]);
        expect(coords.depth[p]).toBeGreaterThanOrEqual(0);
        expect(coords.depth[p]).toBeLessThanOrEqual(1);
      }
      expect(lo).toBeLessThanOrEqual(0.25);
      expect(hi).toBeGreaterThan(0.5);
    }
  });

  it('caches ribbon coordinates without growing without bound', () => {
    for (let seed = 1; seed <= BAND_CACHE_MAX + 60; seed++) {
      patternBandCoords('jagged', 0, 0, N32, 3, false, seed);
    }
    expect(bandCacheSize()).toBeLessThanOrEqual(BAND_CACHE_MAX);
  });
});
