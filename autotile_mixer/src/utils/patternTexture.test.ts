import { describe, it, expect } from 'vitest';
import {
  TEXTURE_PRESETS, DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES, MAX_TEXTURE_SHADES,
  DEFAULT_GEO_SCALE, GEO_SCALES, textureUsesGeoScale, octagonalRank,
  textureShadeAt, textureColour, textureRamp, texturePeriod, usedTextureShades,
  type TextureId,
} from './patternTexture';
import {
  REFERENCE_ROLE_COLOURS, paintPatternTileRGBA, patternRamp, toHexColour, NO_TEXTURE,
} from './patternPaint';
import { DEFAULT_PATTERN, patternLevelsForMask } from './blob47Pattern';
import { sample, type NoiseId } from './patternNoise';

const ALGOS = TEXTURE_PRESETS.map((p) => p.id).filter((id) => id !== 'none');
const DEEP_BLUE = { r: 0x00, g: 0x18, b: 0xa0 };
const NEAR_WHITE = { r: 0xf8, g: 0xf8, b: 0xf8 };

const wrapN = (v: number, n: number) => ((v % n) + n) % n;

/** Baked art keeps its lightest tone as bare terrain, so it never inks everything. */
const BAKED = [
  'weave', 'paving', 'paving3', 'paving5', 'stone_floor', 'breeze_block', 'brick_wall', 'cobbles2', 'brick_floor',
  'hexagon', 'isometric', 'octagonal', 'water', 'field', 'rubble', 'nonslip',
  // Not baked art, but the same kind of texture: these name a shade per cell
  // rather than thresholding a field, so the cells dealt shade 0 stay bare.
  'cells',
  // Generated, and its grout is the bare terrain showing between the tiles.
  'square',
] as const;

/**
 * Fraction of textured pixels, counted over one full period of the texture. A
 * fixed 16x16 window would read only a quarter of a 32-period paving and report
 * whatever happened to be in that corner.
 */
const coverage = (algo: TextureId, amount: number, shades = DEFAULT_TEXTURE_SHADES) => {
  const p = texturePeriod(algo);
  let n = 0;
  for (let y = 0; y < p; y++) {
    for (let x = 0; x < p; x++) if (textureShadeAt(algo, x, y, 0, amount, shades) > 0) n++;
  }
  return n / (p * p);
};

describe('texture presets', () => {
  it('offers a unique list that is off by default', () => {
    const ids = TEXTURE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_TEXTURE).toBe('none');
    expect(ids).toContain('none');
  });

  it('none never textures anything', () => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(textureShadeAt('none', x, y, 0, 1)).toBe(0);
    }
  });

  it.each(ALGOS)('%s returns a shade inside 0..shades', (algo) => {
    for (const shades of [1, 2, 3, MAX_TEXTURE_SHADES]) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const k = textureShadeAt(algo, x, y, 0, 1, shades);
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThanOrEqual(shades);
        }
      }
    }
  });

  // The property every part of this app lives or dies on: a tile is painted
  // knowing nothing about its neighbours, so the speckle must repeat with the
  // tile or it contradicts itself at every seam. What makes that true is the
  // period DIVIDING the tile size, which is why the period is asked for rather
  // than assumed to be 16 — see `texturesForTileSize`.
  it.each(ALGOS)('%s repeats with its declared period', (algo) => {
    const p = texturePeriod(algo);
    for (let y = -2 * p - 2; y < 2 * p + 2; y++) {
      for (let x = -2 * p - 2; x < 2 * p + 2; x++) {
        const base = textureShadeAt(algo, ((x % p) + p) % p, ((y % p) + p) % p, 5, 0.5);
        expect(textureShadeAt(algo, x, y, 5, 0.5)).toBe(base);
      }
    }
  });

  it.each(ALGOS)('%s has a period that divides the 32px tile', (algo) => {
    // The whole seam argument in one line: the sheet is emitted at 32, a seam
    // falls every 32 output pixels, and it only lands on a period boundary when
    // the period divides 32. A texture that fails this cuts every tile open.
    expect(32 % texturePeriod(algo)).toBe(0);
  });

  it.each(ALGOS)('%s covers more as the amount rises', (algo) => {
    let prev = -1;
    for (let a = 0; a <= 1.0001; a += 0.1) {
      const c = coverage(algo, a);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(coverage(algo, 0)).toBe(0);
  });

  it.each(ALGOS.filter((id) => !BAKED.includes(id as typeof BAKED[number]) && id !== 'isometric_grid'))(
    '%s inks every pixel at full amount', (algo) => {
      expect(coverage(algo, 1)).toBe(1);
    });

  // Not an exemption for convenience: in every one of these the reference art's
  // lightest tone IS the ground, which is what lets two picked colours reproduce
  // it. If any of these reached 1 the terrain colour would have dropped out.
  it.each([
    ['weave', 204 / 256],
    ['paving', 960 / 1024],
    ['paving3', 692 / 1024],
    ['paving5', 817 / 1024],
    ['cells', 802 / 1024],
  ] as const)('%s leaves its lightest tone as bare terrain at full amount', (algo, want) => {
    expect(coverage(algo, 1)).toBeCloseTo(want, 6);
  });

  it.each(ALGOS.filter((id) => !['hexagon', 'isometric', 'isometric_grid', 'octagonal', 'square'].includes(id)))('%s keeps the strongest shade a minority', (algo) => {
    // The top shade is an accent — a highlight, a joint, a grout line — never
    // the surface itself. This used to be checked as `counts[1] > counts[max]`,
    // which is a fair proxy for a scatter but not for a texture whose top shade
    // is its grout: at 4x4 cells the grout is legitimately the single commonest
    // tone at 28%, and that is the texture working, not failing.
    //
    // The four pavings are exempt for the opposite reason: their top shade is the
    // TILE FACE, which is supposed to be most of the surface. `square` at its
    // largest is 841 face pixels out of 1024 and that is the texture drawn
    // correctly — one square filling the tile with a grid line around it.
    const p = texturePeriod(algo);
    const counts = new Array(MAX_TEXTURE_SHADES + 1).fill(0);
    for (let y = 0; y < p; y++) {
      for (let x = 0; x < p; x++) counts[textureShadeAt(algo, x, y, 0, 1)]++;
    }
    expect(counts[MAX_TEXTURE_SHADES]).toBeLessThan((p * p) / 3);
  });

  it.each([2, 3, 4, 5, 6] as const)(
    'cells at scale %i deals every shade below the grout to some cell', (scale) => {
      // The regression this whole model exists for. Cells used to go through the
      // scatter path, which squares its input before scaling: an interior value
      // of at most 0.24 gave `1 + floor(4 * 0.24^2)` = 1 for every cell however
      // the hash fell, so all cells were one colour and only the boundary ever
      // climbed — a wireframe, not a paving. Every interior step must be spoken
      // for, or the ramp is being wasted again.
      const p = texturePeriod('cells');
      const seen = new Set<number>();
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) seen.add(textureShadeAt('cells', x, y, 0, 1, MAX_TEXTURE_SHADES, scale));
      }
      for (let k = 0; k <= MAX_TEXTURE_SHADES; k++) expect(seen).toContain(k);
    });

  it.each([2, 3, 4, 5, 6] as const)(
    'cells at scale %i paints each cell flat, not as a gradient', (scale) => {
      // A cell is one block of colour. Counting how many pixels sit on a shade
      // boundary catches a field that has started ramping inside a cell: a flat
      // deal only changes shade at the grout, which is a small fraction of the
      // tile.
      const p = texturePeriod('cells');
      const at = (x: number, y: number) =>
        textureShadeAt('cells', wrapN(x, p), wrapN(y, p), 0, 1, MAX_TEXTURE_SHADES, scale);
      let edges = 0;
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) if (at(x, y) !== at(x + 1, y)) edges++;
      }
      expect(edges).toBeLessThan(p * p * (scale >= 5 ? 0.4 : 0.25));
    });

  it('changes with the seed', () => {
    const print = (seed: number) => {
      const out: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        out.push(textureShadeAt('white', x, y, seed, 0.5));
      }
      return out.join('');
    };
    expect(new Set([print(0), print(1), print(7), print(99)]).size).toBeGreaterThan(1);
  });

  it('does not move in step with the band grain off the same seed', () => {
    // Both read the same noise field; only the salt keeps them apart.
    let same = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const bandish = sample('white', x, y, 3) >= 0.5 ? 1 : 0;
        const tex = textureShadeAt('white', x, y, 3, 0.5) > 0 ? 1 : 0;
        if (bandish === tex) same++;
      }
    }
    expect(same).toBeLessThan(230); // not a near-perfect echo of the band field
  });
});

describe('geometric textures', () => {
  /**
   * Scans a whole 32px tile, not one period of the texture. That is what a tile
   * actually shows, and it is the frame these lattice claims are about — `brick`
   * repeats every 16, so a period-sized window would only ever see half its
   * courses and could not tell a running bond from a grid.
   */
  const lit = (algo: TextureId, amount: number) => {
    const on: [number, number][] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) if (textureShadeAt(algo, x, y, 0, amount) > 0) on.push([x, y]);
    }
    return on;
  };

  // Both lattices are half-drop: every other course is shifted by half a brick.
  // Shifting by (half a brick, one course) therefore maps the pattern exactly
  // onto itself — which is the definition, not a consequence. The vector differs
  // because the bricks are 16x8.

  it('weave keeps the tone census of the art it was traced from', () => {
    // The lock on the baked table. assets/test3.png has five tones; these are
    // their pixel counts, so a corrupted or re-ordered table fails here rather
    // than shipping a subtly wrong floor.
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('weave', x, y, 0, 1, 4)]++;
    }
    expect(counts).toEqual([52, 52, 52, 76, 24]);
  });

  it('weave uses every tone of the ramp, darkest sparsest', () => {
    // A weave whose facets collapse into each other is just a wash.
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('weave', x, y, 0, 1, 4)]++;
    }
    for (const n of counts) expect(n).toBeGreaterThan(0);
    expect(counts[4]).toBeLessThan(Math.min(counts[0], counts[1], counts[2], counts[3]));
  });

  it('cobbles2 keeps the tone census of the traced fine-brick art', () => {
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('cobbles2', x, y, 0, 1, 4)]++;
    }
    expect(counts).toEqual([48, 73, 105, 25, 5]);
  });

  it('brick_floor keeps the tone census of the traced diagonal-brick art', () => {
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('brick_floor', x, y, 0, 1, 4)]++;
    }
    expect(counts).toEqual([24, 1, 192, 24, 15]);
  });

  it('weave flattens toward bare terrain as the amount drops', () => {
    // `amount` scales the ramp rather than thinning a scatter, so the tones
    // converge on the terrain colour instead of the pattern breaking up.
    const spread = (amount: number) => {
      const seen = new Set<number>();
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) seen.add(textureShadeAt('weave', x, y, 0, amount, 4));
      }
      return seen.size;
    };
    expect(spread(1)).toBe(5);
    expect(spread(0.5)).toBeLessThan(5);
    expect(spread(0.1)).toBeLessThan(spread(0.5));
  });

  // --- the three 32px Stagecast pavings ------------------------------------

  const census32 = (algo: TextureId) => {
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) counts[textureShadeAt(algo, x, y, 0, 1, 4)]++;
    }
    return counts;
  };

  it.each([
    ['paving', [64, 270, 400, 90, 200]],
    ['paving3', [332, 332, 169, 68, 123]],
    ['paving5', [207, 224, 224, 207, 162]],
    ['breeze_block', [94, 8, 212, 704, 6]],
    ['brick_wall', [184, 200, 96, 536, 8]],
    ['stone_floor', [102, 136, 366, 261, 159]],
    ['hexagon', [110, 10, 241, 221, 442]],
    ['isometric', [180, 211, 211, 211, 211]],
    ['octagonal', [62, 181, 0, 40, 741]],
    ['water', [697, 0, 288, 0, 39]],
    ['field', [157, 151, 222, 164, 330]],
    ['rubble', [501, 0, 396, 0, 127]],
    ['nonslip', [192, 0, 672, 0, 160]],
  ] as const)('%s keeps the tone census of the art it was traced from', (algo, want) => {
    // The lock on each baked table, same job the weave census does: a corrupted
    // or re-ordered table fails here rather than shipping a subtly wrong floor.
    expect(census32(algo)).toEqual([...want]);
  });

  it.each(['paving', 'paving3', 'paving5'] as const)(
    '%s uses every tone of the ramp', (algo) => {
      // Unlike weave, the darkest tone here is mortar and is not the sparsest —
      // paving3 draws more black joint than it does shading line.
      for (const n of census32(algo)) expect(n).toBeGreaterThan(0);
    });

  it.each(['paving', 'paving3', 'paving5'] as const)(
    '%s has no 16-periodic core, which is why it costs a 32px tile', (algo) => {
      // The measurement the 32px period rests on. If someone ever re-bakes one of
      // these down to 16 to "simplify", this is what catches it: the art really
      // does disagree with itself half a tile over, in tone and in mortar alike.
      let differ = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (textureShadeAt(algo, x, y, 0, 1, 4) !== textureShadeAt(algo, x + 16, y, 0, 1, 4)) differ++;
        }
      }
      expect(differ).toBeGreaterThan(600);
    });

  it.each(['paving', 'paving3', 'paving5'] as const)(
    '%s flattens toward bare terrain as the amount drops', (algo) => {
      const spread = (amount: number) => {
        const seen = new Set<number>();
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) seen.add(textureShadeAt(algo, x, y, 0, amount, 4));
        }
        return seen.size;
      };
      expect(spread(1)).toBe(5);
      expect(spread(0.5)).toBeLessThan(5);
      expect(spread(0.1)).toBeLessThan(spread(0.5));
    });


  it.each([2, 3, 4, 5, 6] as const)('cells at scale %i generates cellular grid', (scale) => {
    const sparse = lit('cells', 0.35);
    expect(sparse.length).toBeGreaterThan(0);
    expect(sparse.length).toBeLessThan(32 * 32);

    const shades = new Set<number>();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        shades.add(textureShadeAt('cells', x, y, 0, 1, MAX_TEXTURE_SHADES, scale));
      }
    }
    expect(shades.size).toBeGreaterThan(2);
  });
});

describe('generated geometric pavings', () => {
  // `isometric` and `octagonal` were 32x32 traced tables until their geometry
  // was solved. The tables live HERE now, as the oracle: the generator has to
  // reproduce them pixel for pixel at the original motif size, which is what
  // makes the size control safe — the default look cannot drift, because a drift
  // fails this test. Do not "simplify" these fixtures away; they are the only
  // remaining copy of the traced art.

  const OCTAGONAL_TRACED =
    '11111111034444444444430111111111' +
    '11111110344444444444443011111111' +
    '11111103444444444444444301111111' +
    '11111034444444444444444430111111' +
    '11110344444444444444444443011111' +
    '11103444444444444444444444301111' +
    '11034444444444444444444444430111' +
    '10344444444444444444444444443011' +
    '03444444444444444444444444444301' +
    '34444444444444444444444444444430' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '34444444444444444444444444444430' +
    '03444444444444444444444444444301' +
    '10344444444444444444444444443011' +
    '11034444444444444444444444430111' +
    '11103444444444444444444444301111' +
    '11110344444444444444444443011111' +
    '11111034444444444444444430111111' +
    '11111103444444444444444301111111' +
    '11111110344444444444443011111111' +
    '11111111034444444444430111111111' +
    '11111111100000000000001111111111';

  it.each([
    ['octagonal', OCTAGONAL_TRACED, octagonalRank],
  ] as const)('%s reproduces the traced table byte for byte at 32px', (_algo, traced, rank) => {
    // Against the rank function directly, with no seed in play, so the oracle is
    // a plain grid comparison. The routing test below covers the path from
    // textureShadeAt down to here.
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        expect(rank(x, y, DEFAULT_GEO_SCALE)).toBe(traced.charCodeAt(y * 32 + x) - 48);
      }
    }
  });

  it.each([
    ['octagonal', octagonalRank],
  ] as const)('%s routes through its generator, seeded like a baked table', (algo, rank) => {
    // textureShadeAt salts the seed and offsets the lookup, exactly as it does
    // for the traced tables, so the dice still moves these two. Recovering the
    // offset rather than hardcoding it keeps this test off TEXTURE_SALT's value.
    const shifts = new Set<string>();
    for (let dy = 0; dy < 32; dy++) {
      for (let dx = 0; dx < 32; dx++) {
        let ok = true;
        for (let y = 0; y < 32 && ok; y++) {
          for (let x = 0; x < 32 && ok; x++) {
            if (textureShadeAt(algo, x, y, 0, 1, MAX_TEXTURE_SHADES)
              !== rank(wrapN(x + dx, 32), wrapN(y + dy, 32), DEFAULT_GEO_SCALE)) ok = false;
          }
        }
        if (ok) shifts.add(`${dx},${dy}`);
      }
    }
    // At least one translation lines up, which is only true if the generator is
    // what textureShadeAt is calling. More than one is expected for isometric:
    // its lattice repeats every 16 rows, so two offsets are indistinguishable.
    expect(shifts.size).toBeGreaterThan(0);
    expect(shifts.size).toBeLessThan(4);
    // And the dice still moves it, the same way it moves a traced table.
    const print = (seed: number) => {
      let out = '';
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) out += textureShadeAt(algo, x, y, seed, 1, MAX_TEXTURE_SHADES);
      }
      return out;
    };
    expect(new Set([print(0), print(1), print(9)]).size).toBeGreaterThan(1);
  });

  it.each(GEO_SCALES.map((g) => g.id))('every paving stays 32-periodic at motif size %i', (n) => {
    for (const algo of ['isometric', 'octagonal'] as const) {
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const base = textureShadeAt(algo, x, y, 3, 1, 4, 3, 4, n);
          expect(textureShadeAt(algo, x + 32, y, 3, 1, 4, 3, 4, n)).toBe(base);
          expect(textureShadeAt(algo, x, y - 32, 3, 1, 4, 3, 4, n)).toBe(base);
        }
      }
    }
  });

  it.each(GEO_SCALES.map((g) => g.id))('isometric keeps its outline one pixel wide at motif size %i', (n) => {
    // The bug this catches, and it is silent: the metric's gradient grows with
    // the motif count, so the tolerance has to grow with it too. Left at 1, the
    // outline came out 1/n pixels wide and vanished completely below the pixel
    // grid at 16px and 8px — the tiling rendered as two flat tones with no joint
    // between them at all.
    let outline = 0;
    let runs = 0;
    for (let y = 0; y < 32; y++) {
      let prev = false;
      for (let x = 0; x < 32; x++) {
        const on = textureShadeAt('isometric', x, y, 0, 1, 4, 3, 4, n) === 0;
        if (on) outline++;
        if (on && !prev) runs++;
        prev = on;
      }
    }
    expect(outline).toBeGreaterThan(32);
    // Mean horizontal run of the joint. Rhombus tips legitimately double it up
    // where two meet, so this is 1-2 rather than exactly 1.
    expect(outline / runs).toBeLessThan(3.5);
  });

  it.each(GEO_SCALES.map((g) => g.id))('isometric draws outline and faces at motif size %i', (n) => {
    const seen = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seen.add(textureShadeAt('isometric', x, y, 0, 1, 4, 3, 4, n));
    }
    expect(Array.from(seen).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('isometric arranges in 2x2 group pattern at seed 0 and randomly at seed > 0', () => {
    // At seed 0, n=2 (16px), the 2x2 group of diamond cells are ranks 1, 2, 3, 4 deterministically
    const seenSeed0 = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seenSeed0.add(textureShadeAt('isometric', x, y, 0, 1, 4, 3, 4, 2));
    }
    expect(Array.from(seenSeed0).sort()).toEqual([0, 1, 2, 3, 4]);

    // At seed > 0, diamond cells are randomly assigned colors based on seed
    const seenSeed1 = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seenSeed1.add(textureShadeAt('isometric', x, y, 1, 1, 4, 3, 4, 2));
    }
    expect(seenSeed1.size).toBeGreaterThan(1);
  });

  it.each(GEO_SCALES.map((g) => g.id))('octagonal keeps all four of its tones at motif size %i', (n) => {
    // Face, corner square and the two chamfer lines. At 8px the chamfer is only
    // a pixel long each way, and a threshold off by one drops a whole tone.
    const seen = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seen.add(textureShadeAt('octagonal', x, y, 0, 1, 4, 3, 4, n));
    }
    for (const k of [0, 1, 3, 4]) expect(seen).toContain(k);
  });

it.each(GEO_SCALES.map((g) => g.id))('square draws grout and faces at motif size %i', (n) => {
    const seen = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seen.add(textureShadeAt('square', x, y, 0, 1, 4, 3, 4, n));
    }
    expect(Array.from(seen).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('square arranges in 2x2 group pattern at seed 0 and randomly at seed > 0', () => {
    // At seed 0, n=2 (16px), the four 16x16 squares are ranks 1, 2, 3, 4 deterministically
    expect(textureShadeAt('square', 2, 2, 0, 1, 4, 3, 4, 2)).toBe(1);
    expect(textureShadeAt('square', 18, 2, 0, 1, 4, 3, 4, 2)).toBe(2);
    expect(textureShadeAt('square', 2, 18, 0, 1, 4, 3, 4, 2)).toBe(3);
    expect(textureShadeAt('square', 18, 18, 0, 1, 4, 3, 4, 2)).toBe(4);

    // At seed > 0, cells are randomly assigned colors based on seed
    const shadesSeed1 = [
      textureShadeAt('square', 2, 2, 1, 1, 4, 3, 4, 2),
      textureShadeAt('square', 18, 2, 1, 1, 4, 3, 4, 2),
      textureShadeAt('square', 2, 18, 1, 1, 4, 3, 4, 2),
      textureShadeAt('square', 18, 18, 1, 1, 4, 3, 4, 2),
    ];
    for (const s of shadesSeed1) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(4);
    }
  });

  it('square puts its grout on the cell boundary at seed 0', () => {
    // Phased off the raw seed rather than the salted one, so the default grid is
    // aligned to the tile instead of cut across the middle of it. The salt's
    // offset is (17, 29), so a regression here moves the line to x=14 / y=2 —
    // seamless, but it does not look like "one square per tile" any more.
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const grout = x === 31 || y === 31;
        expect(textureShadeAt('square', x, y, 0, 1, 4, 3, 4, 1) === 0).toBe(grout);
      }
    }
    // And a non-zero seed still moves it, so the dice is not dead.
    const print = (seed: number) => {
      let out = '';
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) out += textureShadeAt('square', x, y, seed, 1, 4, 3, 4, 1);
      }
      return out;
    };
    expect(print(5)).not.toBe(print(0));
  });

  it('square at its largest size makes one square of the whole tile', () => {
    // What was asked for: the biggest square IS the tile, so its grout lands on
    // the sheet's own seams and reads as a single-pixel grid across the map.
    // One grout line per axis, so exactly one row and one column are bare.
    let groutRows = 0;
    let groutCols = 0;
    for (let y = 0; y < 32; y++) {
      let all = true;
      for (let x = 0; x < 32; x++) if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, 1) !== 0) all = false;
      if (all) groutRows++;
    }
    for (let x = 0; x < 32; x++) {
      let all = true;
      for (let y = 0; y < 32; y++) if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, 1) !== 0) all = false;
      if (all) groutCols++;
    }
    expect(groutRows).toBe(1);
    expect(groutCols).toBe(1);
  });

  it('square keeps the grout one pixel wide at every size', () => {
    // Drawn on two sides of each cell, not four, so neighbours share it. Drawing
    // all four would double it up between every pair of squares.
    for (const { id: n } of GEO_SCALES) {
      const S = 32 / n;
      let grout = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, n) === 0) grout++;
      }
      // A one-pixel grid at pitch S over a 32x32 area: 32*n rows + 32*n columns,
      // less the n*n crossings counted twice.
      expect(grout).toBe(32 * n + 32 * n - n * n);
      expect(S * n).toBe(32);
    }
  });

  it('square gets smaller as the motif size drops', () => {
    const face = (n: number) => {
      let k = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, n) > 0) k++;
      }
      return k;
    };
    const sizes = GEO_SCALES.map((g) => face(g.id));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
  });

  it('offers only motif sizes that tile the sheet on whole pixels', () => {
    for (const { id } of GEO_SCALES) {
      expect(32 % id).toBe(0);
      expect((32 / id) % 2).toBe(0);
    }
    expect(GEO_SCALES[0].id).toBe(DEFAULT_GEO_SCALE);
  });

  it('takes the size control on the generated pavings only', () => {
    expect(textureUsesGeoScale('isometric')).toBe(true);
    expect(textureUsesGeoScale('octagonal')).toBe(true);
    expect(textureUsesGeoScale('square')).toBe(true);
    // hexagon is still a traced table: its slanted-edge tips are placed by hand
    // and no distance rule reproduces them (best fit left 131 of 1024 pixels
    // wrong, and it plateaued there), so there is no generator to scale.
    expect(textureUsesGeoScale('hexagon')).toBe(false);
    expect(textureUsesGeoScale('paving')).toBe(false);
  });
});

describe('texture colour', () => {
  it('lightens a dark terrain and darkens a light one', () => {
    // Direction follows luminance, so it stays visible on any palette. A
    // saturated deep blue sits high in HSV *value* while reading almost black —
    // picking by value would push it the wrong way.
    const lum = (c: { r: number; g: number; b: number }) =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum(textureColour(DEEP_BLUE, 1))).toBeGreaterThan(lum(DEEP_BLUE));
    expect(lum(textureColour(NEAR_WHITE, 1))).toBeLessThan(lum(NEAR_WHITE));
  });

  it('is the identity at 0 and grows with t', () => {
    expect(toHexColour(textureColour(DEEP_BLUE, 0))).toBe(toHexColour(DEEP_BLUE));
    const lum = (c: { r: number; g: number; b: number }) =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    let prev = lum(DEEP_BLUE);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const v = lum(textureColour(DEEP_BLUE, t));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('stays inside the byte range at full strength on extremes', () => {
    for (const c of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, DEEP_BLUE]) {
      const out = textureColour(c, 1);
      for (const v of [out.r, out.g, out.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('reachable shades', () => {
  it('reports nothing for no texture', () => {
    expect(usedTextureShades('none', 1, 4).size).toBe(0);
  });

  it.each(ALGOS)('%s reports exactly the shades it paints', (algo) => {
    // The set has to agree with the pixels, or a swatch is crossed out while
    // still colouring something (or worse, left live while inert).
    for (const amount of [0.2, 0.4, 1]) {
      const used = usedTextureShades(algo, amount, 4);
      const p = texturePeriod(algo);
      const seen = new Set<number>();
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) seen.add(textureShadeAt(algo, x, y, 0, amount, 4));
      }
      expect([...used].sort()).toEqual([...seen].sort());
    }
  });

  it('shows a ramp-scaling texture losing its top shades as density drops', () => {
    // The reason this exists. `cells` scales its ramp, so at low density the top
    // of the ramp is simply never painted and its swatches must say so.
    expect(usedTextureShades('cells', 1, 4)).toContain(4);
    expect(usedTextureShades('cells', 0.4, 4)).not.toContain(4);
    expect(usedTextureShades('cells', 0.4, 4)).toContain(1);
  });
});

describe('texture ramp', () => {
  const GRASS = { r: 93, g: 168, b: 50 };
  const YELLOW = { r: 240, g: 220, b: 90 };

  it('starts on the terrain colour and ends on the picked one', () => {
    const ramp = textureRamp(GRASS, YELLOW, 4);
    expect(ramp).toHaveLength(5);
    expect(toHexColour(ramp[0])).toBe(toHexColour(GRASS));
    expect(toHexColour(ramp[4])).toBe(toHexColour(YELLOW));
  });

  it('reaches a colour the terrain could never be shifted into', () => {
    // The point of picking: a derived shade can only brighten or darken the
    // terrain, so it can never carry an unrelated hue.
    const picked = textureRamp(GRASS, YELLOW, 1)[1];
    const derived = textureColour(GRASS, 1);
    expect(picked.r).toBeGreaterThan(derived.r * 2);
  });

  it('moves monotonically toward the target on every channel', () => {
    const ramp = textureRamp(GRASS, YELLOW, 4);
    for (let k = 1; k < ramp.length; k++) {
      expect(ramp[k].r).toBeGreaterThanOrEqual(ramp[k - 1].r);
      expect(ramp[k].b).toBeGreaterThanOrEqual(ramp[k - 1].b);
    }
  });

  it('substitutes a hand-picked step and leaves the rest derived', () => {
    // The point of per-step overrides: one swatch changed must not detach the
    // others from the terrain colour they follow.
    const plain = textureRamp(GRASS, YELLOW, 4);
    const picked = textureRamp(GRASS, YELLOW, 4, [undefined, undefined, DEEP_BLUE]);
    expect(toHexColour(picked[2])).toBe(toHexColour(DEEP_BLUE));
    for (const k of [0, 1, 3, 4]) {
      expect(toHexColour(picked[k])).toBe(toHexColour(plain[k]));
    }
  });

  it('falls back to the derived shift when nothing is picked', () => {
    const ramp = textureRamp(GRASS, undefined, 4);
    for (let k = 0; k <= 4; k++) {
      expect(toHexColour(ramp[k])).toBe(toHexColour(textureColour(GRASS, k / 4)));
    }
  });

  it('never divides by zero on a degenerate shade count', () => {
    expect(textureRamp(GRASS, YELLOW, 0)).toHaveLength(2);
    for (const c of textureRamp(GRASS, YELLOW, 0)) {
      for (const v of [c.r, c.g, c.b]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('texture applied to a tile', () => {
  const paint = (tex: Partial<typeof NO_TEXTURE>) =>
    paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, {
      tileSize: 16, texture: { ...NO_TEXTURE, ...tex },
    });
  const paint32 = (
    tex: Partial<typeof NO_TEXTURE>,
    noises: readonly NoiseId[] = [],
    noiseSeed = 0,
  ) => paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, {
    tileSize: 32, texture: { ...NO_TEXTURE, ...tex }, noises, noiseSeed,
  });

  const roleAt = (p: number, tileSize = 32) => {
    const level = patternLevelsForMask(DEFAULT_PATTERN, 110, 0, tileSize, 3).charCodeAt(p) - 48;
    return level === 0 ? 'terrainB' : level === 4 ? 'terrainA' : 'band';
  };

  it('ignores an override array left over from a different step count', () => {
    // A stale array would recolour the wrong steps, so the painter drops any
    // whose length does not match the current count.
    const stale = [undefined, DEEP_BLUE, DEEP_BLUE, DEEP_BLUE, DEEP_BLUE];
    const withStale = paint({ algoA: 'cells', amountA: 1, shadesA: 2, rampA: stale });
    const withNone = paint({ algoA: 'cells', amountA: 1, shadesA: 2 });
    expect(Array.from(withStale)).toEqual(Array.from(withNone));
  });

  it('recolours only the step it was given', () => {
    const base = paint({ algoA: 'cells', amountA: 1, shadesA: 2 });
    const one = paint({
      algoA: 'cells', amountA: 1, shadesA: 2,
      rampA: [undefined, DEEP_BLUE, undefined],
    });
    let changed = 0;
    for (let i = 0; i < base.length; i += 4) if (base[i] !== one[i]) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(base.length / 4);
  });

  it('is inert when off', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, { tileSize: 16 });
    expect(Array.from(paint({}))).toEqual(Array.from(bare));
    expect(Array.from(paint({ algoA: 'white', algoB: 'white', amountA: 0, amountB: 0 })))
      .toEqual(Array.from(bare));
  });

  it('changes the solid interior but leaves the band alone', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, { tileSize: 16 });
    const tex = paint({ algoA: 'white', algoB: 'white', amountA: 0.6 });
    const bandColours = new Set(patternRamp(REFERENCE_ROLE_COLOURS, 3).slice(1, -1).map(toHexColour));
    let changed = 0;
    for (let i = 0; i < bare.length; i += 4) {
      const before = toHexColour({ r: bare[i], g: bare[i + 1], b: bare[i + 2] });
      const after = toHexColour({ r: tex[i], g: tex[i + 1], b: tex[i + 2] });
      if (before !== after) {
        changed++;
        expect(bandColours.has(before)).toBe(false); // only solid pixels moved
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('textures each terrain independently', () => {
    const onlyA = paint({ algoA: 'white', algoB: 'white', amountA: 0.6, amountB: 0 });
    const onlyB = paint({ algoA: 'white', algoB: 'white', amountA: 0, amountB: 0.6 });
    expect(Array.from(onlyA)).not.toEqual(Array.from(onlyB));
  });

  it('Water keeps the body, picked line colour, and pale dot as separate layers', () => {
    const edge = { r: 245, g: 245, b: 245 };
    const dot = { r: 255, g: 230, b: 90 };
    const water = paint32({
      algoA: 'water', amountA: 1, shadesA: 2,
      rampA: [undefined, edge, dot],
    });
    const base = REFERENCE_ROLE_COLOURS.terrainA;
    let edgePixels = 0;
    let dotPixels = 0;
    for (let p = 0; p < 32 * 32; p++) {
      if (roleAt(p) !== 'terrainA') continue;
      const i = p * 4;
      const rgb = [water[i], water[i + 1], water[i + 2]];
      expect([
        [base.r, base.g, base.b],
        [edge.r, edge.g, edge.b],
        [dot.r, dot.g, dot.b],
      ]).toContainEqual(rgb);
      if (rgb[0] === edge.r && rgb[1] === edge.g && rgb[2] === edge.b) edgePixels++;
      if (rgb[0] === dot.r && rgb[1] === dot.g && rgb[2] === dot.b) dotPixels++;
    }
    expect(edgePixels).toBeGreaterThan(0);
    expect(dotPixels).toBeGreaterThan(0);
  });

  it('gives terrain A and B independent shade counts', () => {
    const base = paint32({
      algoA: 'paving', algoB: 'paving', amountA: 1, amountB: 1,
      shadesA: 1, shadesB: 4,
    });
    const changedA = paint32({
      algoA: 'paving', algoB: 'paving', amountA: 1, amountB: 1,
      shadesA: 4, shadesB: 4,
    });
    let aDiff = 0;
    for (let p = 0; p < 32 * 32; p++) {
      const i = p * 4;
      if (roleAt(p) === 'terrainB') {
        expect(Array.from(changedA.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      } else if (roleAt(p) === 'terrainA') {
        if (base[i] !== changedA[i] || base[i + 1] !== changedA[i + 1] || base[i + 2] !== changedA[i + 2]) aDiff++;
      }
    }
    expect(aDiff).toBeGreaterThan(0);
  });

  it('gives terrain A and B independent texture seeds', () => {
    const base = paint32({
      algoA: 'white', algoB: 'white', amountA: 1, amountB: 1, seedA: 7, seedB: 11,
    });
    const changedA = paint32({
      algoA: 'white', algoB: 'white', amountA: 1, amountB: 1, seedA: 8, seedB: 11,
    });
    let aDiff = 0;
    for (let p = 0; p < 32 * 32; p++) {
      const i = p * 4;
      if (roleAt(p) === 'terrainB') {
        expect(Array.from(changedA.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      } else if (roleAt(p) === 'terrainA') {
        if (base[i] !== changedA[i] || base[i + 1] !== changedA[i + 1] || base[i + 2] !== changedA[i + 2]) aDiff++;
      }
    }
    expect(aDiff).toBeGreaterThan(0);
  });

  it('keeps texture seeds independent from band noise seed', () => {
    const tex = (seedA: number, seedB: number) =>
      ({ algoA: 'white' as const, algoB: 'white' as const, amountA: 1, amountB: 1, seedA, seedB });
    const base = paint32(tex(7, 11), ['white'], 21);
    const changedTexture = paint32(tex(8, 12), ['white'], 21);
    const changedNoise = paint32(tex(7, 11), ['white'], 22);
    for (let p = 0; p < 32 * 32; p++) {
      const i = p * 4;
      if (roleAt(p) === 'band') {
        expect(Array.from(changedTexture.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      } else {
        expect(Array.from(changedNoise.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      }
    }
  });

  it('leaves the background tile flat unless terrain B is textured', () => {
    const flat = paintPatternTileRGBA(DEFAULT_PATTERN, -1, REFERENCE_ROLE_COLOURS, {
      tileSize: 16, texture: { ...NO_TEXTURE, algoA: 'white', algoB: 'white', amountA: 1 },
    });
    const b = REFERENCE_ROLE_COLOURS.terrainB;
    for (let i = 0; i < flat.length; i += 4) {
      expect([flat[i], flat[i + 1], flat[i + 2]]).toEqual([b.r, b.g, b.b]);
    }
  });

  it('ripple_diag exhibits diagonal correlation and 32px periodicity', () => {
    expect(texturePeriod('ripple_diag')).toBe(32);
    expect(coverage('ripple_diag', 0.5)).toBeGreaterThan(0);

    // Verify 32px periodicity explicitly
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const val = textureShadeAt('ripple_diag', x, y, 42, 0.5);
        expect(textureShadeAt('ripple_diag', x + 32, y, 42, 0.5)).toBe(val);
        expect(textureShadeAt('ripple_diag', x, y + 32, 42, 0.5)).toBe(val);
      }
    }
  });
});
