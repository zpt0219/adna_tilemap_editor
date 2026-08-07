import { describe, it, expect } from 'vitest';
import {
  NOISE_PRESETS, DEFAULT_NOISES, DEFAULT_NOISE_STRENGTH, MAX_NOISE_STRENGTH,
  noiseStep, type NoiseId,
} from './patternNoise';
import { REFERENCE_ROLE_COLOURS, paintPatternTileRGBA, patternRamp, toHexColour } from './patternPaint';
import { DEFAULT_PATTERN } from './blob47Pattern';

const ALL: NoiseId[] = NOISE_PRESETS.map((n) => n.id);
const SINGLES = ALL.map((id) => [id] as NoiseId[]);
const disturbed = (sel: readonly NoiseId[], seed = 0) => {
  let n = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) if (noiseStep(sel, x, y, seed) !== 0) n++;
  }
  return n;
};

describe('noise presets', () => {
  it('lists a unique set and defaults to off', () => {
    expect(new Set(ALL).size).toBe(ALL.length);
    expect(DEFAULT_NOISES).toHaveLength(0);
  });

  it('an empty selection is a no-op', () => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(noiseStep([], x, y)).toBe(0);
    }
  });

  it.each(SINGLES)('%s only ever shifts by -1, 0 or +1', (id) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect([-1, 0, 1]).toContain(noiseStep([id], x, y));
    }
  });

  // The load-bearing property. A tile is painted with no knowledge of its
  // neighbours, so the grain must be a function of position modulo the tile —
  // otherwise it disagrees with itself across every seam.
  it.each(SINGLES)('%s repeats with the 16px tile, so seams stay continuous', (id) => {
    for (let y = -20; y < 36; y++) {
      for (let x = -20; x < 36; x++) {
        const base = noiseStep([id], ((x % 16) + 16) % 16, ((y % 16) + 16) % 16);
        expect(noiseStep([id], x, y)).toBe(base);
      }
    }
  });

  it('every algorithm produces a different field', () => {
    const prints = SINGLES.map((sel) => {
      const out: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out.push(noiseStep(sel, x, y));
      return out.join('');
    });
    expect(new Set(prints).size).toBe(ALL.length);
  });

  it.each(SINGLES)('%s disturbs a sane share of pixels', (id) => {
    const share = disturbed([id]) / 256;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.65);
  });

  it('blue noise is evenly spread, not clustered like white noise', () => {
    const spread = (id: NoiseId) => {
      const pts: [number, number][] = [];
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) if (noiseStep([id], x, y) === -1) pts.push([x, y]);
      }
      const wrapD = (a: number, b: number) => Math.min(Math.abs(a - b), 16 - Math.abs(a - b));
      const ds = pts.map(([x1, y1], i) =>
        Math.min(...pts.filter((_, j) => i !== j)
          .map(([x2, y2]) => Math.hypot(wrapD(x1, x2), wrapD(y1, y2)))));
      return ds.reduce((a, b) => a + b, 0) / ds.length;
    };
    expect(spread('blue')).toBeGreaterThan(spread('white'));
  });
});

describe('stacking algorithms', () => {
  it('still never moves a pixel more than one level', () => {
    // Four votes could sum to -4; the clamp is what keeps the result a dissolve
    // instead of a hole punched clean through the band.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect([-1, 0, 1]).toContain(noiseStep(ALL, x, y));
    }
  });

  it('is order-independent', () => {
    const a: NoiseId[] = ['blue', 'clumped', 'ordered'];
    const b: NoiseId[] = ['ordered', 'blue', 'clumped'];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(noiseStep(a, x, y)).toBe(noiseStep(b, x, y));
    }
  });

  it('stays 16-periodic when stacked', () => {
    for (let y = -18; y < 34; y++) {
      for (let x = -18; x < 34; x++) {
        const base = noiseStep(ALL, ((x % 16) + 16) % 16, ((y % 16) + 16) % 16);
        expect(noiseStep(ALL, x, y)).toBe(base);
      }
    }
  });

  it('disturbs more than either part alone', () => {
    const pair: NoiseId[] = ['clumped', 'blue'];
    expect(disturbed(pair)).toBeGreaterThan(disturbed(['clumped']));
    expect(disturbed(pair)).toBeGreaterThan(disturbed(['blue']));
  });

  it('produces a field that is not just one of its parts', () => {
    const print = (sel: readonly NoiseId[]) => {
      const out: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out.push(noiseStep(sel, x, y));
      return out.join('');
    };
    const combo = print(['clumped', 'blue']);
    expect(combo).not.toBe(print(['clumped']));
    expect(combo).not.toBe(print(['blue']));
  });

  it('a repeated algorithm votes twice, and the clamp absorbs it', () => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(noiseStep(['blue', 'blue'], x, y)).toBe(noiseStep(['blue'], x, y));
      }
    }
  });
});

describe('seeding', () => {
  const SEEDS = [0, 1, 2, 7, 42, 1234, 99999];
  const print = (sel: readonly NoiseId[], seed: number) => {
    const out: number[] = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out.push(noiseStep(sel, x, y, seed));
    return out.join('');
  };

  it('seed 0 is the authored pattern', () => {
    for (const id of ALL) expect(print([id], 0)).toBe(print([id], undefined as unknown as number));
  });

  // The load-bearing property again: a seed must relabel the grain, never
  // break its period, or every seam in the tileset splits open.
  it.each(SEEDS)('stays 16-periodic at seed %i', (seed) => {
    for (const id of ALL) {
      for (let y = -18; y < 34; y++) {
        for (let x = -18; x < 34; x++) {
          const base = noiseStep([id], ((x % 16) + 16) % 16, ((y % 16) + 16) % 16, seed);
          expect(noiseStep([id], x, y, seed)).toBe(base);
        }
      }
    }
  });

  it.each(ALL)('%s actually changes with the seed', (id) => {
    const seen = new Set(SEEDS.map((s) => print([id], s)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it.each(SEEDS)('blue noise is still blue at seed %i', (seed) => {
    // A shift/flip relabels the torus, so the even spacing must survive. If a
    // future seed scheme re-hashed the table instead, this is what would fail.
    const spread = (id: NoiseId) => {
      const pts: [number, number][] = [];
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) if (noiseStep([id], x, y, seed) === -1) pts.push([x, y]);
      }
      const wrapD = (a: number, b: number) => Math.min(Math.abs(a - b), 16 - Math.abs(a - b));
      const ds = pts.map(([x1, y1], i) =>
        Math.min(...pts.filter((_, j) => i !== j)
          .map(([x2, y2]) => Math.hypot(wrapD(x1, x2), wrapD(y1, y2)))));
      return ds.reduce((a, b) => a + b, 0) / ds.length;
    };
    expect(spread('blue')).toBeGreaterThan(spread('white'));
  });

  it.each(SEEDS)('disturbs the same share of pixels at seed %i', (seed) => {
    // A shift cannot change how many pixels fall under the threshold, and the
    // hashed ones must not drift either — the seed changes where, not how much.
    for (const id of ALL) {
      const n = disturbed([id], seed) / 256;
      expect(n).toBeGreaterThan(0.2);
      expect(n).toBeLessThan(0.65);
    }
  });

  it('keeps stacking bounded at any seed', () => {
    for (const seed of SEEDS) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) expect([-1, 0, 1]).toContain(noiseStep(ALL, x, y, seed));
      }
    }
  });

  it('salts each algorithm so stacked ones do not shift in lockstep', () => {
    // Same seed, but blue and ordered must not land on the same phase.
    const a = print(['blue'], 7);
    const b = print(['ordered'], 7);
    expect(a).not.toBe(b);
  });

  it('repaints a tile when only the seed changes', () => {
    const s0 = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, 16, ['blue'], 0, 0);
    const s9 = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, 16, ['blue'], 0, 9);
    expect(Array.from(s9)).not.toEqual(Array.from(s0));
  });
});

describe('grain amount', () => {
  const share = (sel: readonly NoiseId[], strength: number, seed = 0) => {
    let n = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) if (noiseStep(sel, x, y, seed, strength) !== 0) n++;
    }
    return n / 256;
  };

  it('defaults to the tuned amounts', () => {
    for (const id of ALL) {
      expect(share([id], DEFAULT_NOISE_STRENGTH)).toBe(share([id], undefined as unknown as number));
    }
  });

  it.each(ALL)('%s vanishes at 0', (id) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(noiseStep([id], x, y, 0, 0)).toBe(0);
    }
  });

  it.each(ALL)('%s never disturbs fewer pixels as the amount rises', (id) => {
    let prev = -1;
    for (let s = 0; s <= MAX_NOISE_STRENGTH + 1e-9; s += 0.1) {
      const v = share([id], s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('disturbs every band pixel with one algorithm at the top', () => {
    // The share is capped at half down / half up — past that there is nothing
    // left to disturb, and the two thresholds would start crossing over.
    expect(share(['clumped'], MAX_NOISE_STRENGTH)).toBe(1);
  });

  it('is damped by opposing votes when stacked at the top, not amplified', () => {
    // Worth knowing: near the top, stacking works *against* itself, because one
    // algorithm's "push toward A" cancels another's "push toward B". Loudest is
    // one algorithm at full, not four.
    expect(share(ALL, MAX_NOISE_STRENGTH))
      .toBeLessThan(share(['clumped'], MAX_NOISE_STRENGTH));
    expect(share(ALL, MAX_NOISE_STRENGTH)).toBeGreaterThan(0.7);
  });

  it('never inverts, however far the amount is pushed', () => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect([-1, 0, 1]).toContain(noiseStep(ALL, x, y, 0, MAX_NOISE_STRENGTH));
        expect([-1, 0, 1]).toContain(noiseStep(ALL, x, y, 0, 99));
      }
    }
  });

  it('stays 16-periodic at every amount', () => {
    for (const s of [0.25, 0.5, 1, 1.5, MAX_NOISE_STRENGTH]) {
      for (let y = -18; y < 34; y++) {
        for (let x = -18; x < 34; x++) {
          const base = noiseStep(ALL, ((x % 16) + 16) % 16, ((y % 16) + 16) % 16, 3, s);
          expect(noiseStep(ALL, x, y, 3, s)).toBe(base);
        }
      }
    }
  });

  it('leaves the tile untouched at 0 even with algorithms ticked', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, 16, []);
    const zero = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, 16, ALL, 0, 0, 0);
    expect(Array.from(zero)).toEqual(Array.from(bare));
  });

  it('keeps the solid interior clean however loud it gets', () => {
    const px = paintPatternTileRGBA(
      DEFAULT_PATTERN, 255, REFERENCE_ROLE_COLOURS, 16, ALL, 0, 0, MAX_NOISE_STRENGTH);
    const solid = patternRamp(REFERENCE_ROLE_COLOURS)[4];
    for (let i = 0; i < px.length; i += 4) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([solid.r, solid.g, solid.b]);
    }
  });
});

describe('noise applied to a pattern', () => {
  const SELECTIONS: NoiseId[][] = [...SINGLES, ['clumped', 'blue'], ALL];

  it.each(SELECTIONS)('%s leaves a solid interior tile untouched', (...sel) => {
    // Mask 255 is entirely level 4 — the grain must not speckle open terrain.
    const px = paintPatternTileRGBA(DEFAULT_PATTERN,255, REFERENCE_ROLE_COLOURS, 16, sel as NoiseId[]);
    const solid = patternRamp(REFERENCE_ROLE_COLOURS)[4];
    for (let i = 0; i < px.length; i += 4) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([solid.r, solid.g, solid.b]);
    }
  });

  it.each(SELECTIONS)('%s leaves the background tile untouched', (...sel) => {
    const px = paintPatternTileRGBA(DEFAULT_PATTERN,-1, REFERENCE_ROLE_COLOURS, 16, sel as NoiseId[]);
    const field = patternRamp(REFERENCE_ROLE_COLOURS)[0];
    for (let i = 0; i < px.length; i += 4) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([field.r, field.g, field.b]);
    }
  });

  it.each(SELECTIONS)('%s stays inside the five-colour ramp', (...sel) => {
    const allowed = new Set(patternRamp(REFERENCE_ROLE_COLOURS).map(toHexColour));
    for (const mask of [0, 31, 110, 175, 255]) {
      const px = paintPatternTileRGBA('rounded', mask, REFERENCE_ROLE_COLOURS, 16, sel as NoiseId[]);
      for (let i = 0; i < px.length; i += 4) {
        expect(allowed).toContain(toHexColour({ r: px[i], g: px[i + 1], b: px[i + 2] }));
      }
    }
  });

  it('an empty selection paints exactly the untouched pattern', () => {
    const bare = paintPatternTileRGBA('rounded', 110, REFERENCE_ROLE_COLOURS, 16);
    const empty = paintPatternTileRGBA('rounded', 110, REFERENCE_ROLE_COLOURS, 16, []);
    expect(Array.from(empty)).toEqual(Array.from(bare));
  });

  it('actually changes the band when switched on', () => {
    const clean = paintPatternTileRGBA('rounded', 110, REFERENCE_ROLE_COLOURS, 16, []);
    const grainy = paintPatternTileRGBA('rounded', 110, REFERENCE_ROLE_COLOURS, 16, ['blue']);
    expect(Array.from(grainy)).not.toEqual(Array.from(clean));
  });
});
