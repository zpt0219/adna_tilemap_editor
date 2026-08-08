import { describe, it, expect } from 'vitest';
import {
  TEXTURE_PRESETS, DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES, MAX_TEXTURE_SHADES,
  textureShadeAt, textureColour, textureRamp, type TextureId,
} from './patternTexture';
import {
  REFERENCE_ROLE_COLOURS, paintPatternTileRGBA, patternRamp, toHexColour, NO_TEXTURE,
} from './patternPaint';
import { DEFAULT_PATTERN } from './blob47Pattern';
import { sample } from './patternNoise';

const ALGOS = TEXTURE_PRESETS.map((p) => p.id).filter((id) => id !== 'none');
const DEEP_BLUE = { r: 0x00, g: 0x18, b: 0xa0 };
const NEAR_WHITE = { r: 0xf8, g: 0xf8, b: 0xf8 };

const coverage = (algo: TextureId, amount: number, shades = DEFAULT_TEXTURE_SHADES) => {
  let n = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) if (textureShadeAt(algo, x, y, 0, amount, shades) > 0) n++;
  }
  return n / 256;
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
  // tile or it contradicts itself at every seam.
  it.each(ALGOS)('%s repeats with the 16px tile', (algo) => {
    for (let y = -18; y < 34; y++) {
      for (let x = -18; x < 34; x++) {
        const base = textureShadeAt(algo, ((x % 16) + 16) % 16, ((y % 16) + 16) % 16, 5, 0.5);
        expect(textureShadeAt(algo, x, y, 5, 0.5)).toBe(base);
      }
    }
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

  it.each(ALGOS.filter((id) => id !== 'weave'))('%s inks every pixel at full amount', (algo) => {
    expect(coverage(algo, 1)).toBe(1);
  });

  it('weave leaves its lightest facet as bare terrain even at full amount', () => {
    // Not an exemption for convenience: the reference art's lightest tone IS the
    // ground, which is what lets two picked colours reproduce it exactly. If this
    // ever reached 1 the terrain colour would have dropped out of the weave.
    expect(coverage('weave', 1)).toBeCloseTo(204 / 256, 6);
  });

  it.each(ALGOS)('%s keeps the strongest shade sparse', (algo) => {
    // Biased low on purpose: the top shade is a highlight, not half the surface.
    const counts = new Array(MAX_TEXTURE_SHADES + 1).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt(algo, x, y, 0, 1)]++;
    }
    expect(counts[1]).toBeGreaterThan(counts[MAX_TEXTURE_SHADES]);
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
  const lit = (algo: TextureId, amount: number) => {
    const on: [number, number][] = [];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) if (textureShadeAt(algo, x, y, 0, amount) > 0) on.push([x, y]);
    }
    return on;
  };

  // Both lattices are half-drop: every other course is shifted by half a brick.
  // Shifting by (half a brick, one course) therefore maps the pattern exactly
  // onto itself — which is the definition, not a consequence. The vector differs
  // because the bricks are 8x4 and the carpet cells 8x8.
  it.each([['brick', 4, 4], ['carpet', 4, 8]] as const)(
    '%s is a half-drop lattice',
    (algo, dx, dy) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          expect(textureShadeAt(algo, x + dx, y + dy, 0, 0.5))
            .toBe(textureShadeAt(algo, x, y, 0, 0.5));
        }
      }
    }
  );

  it('brick draws unbroken joint lines, not scatter', () => {
    // At a low amount only the joints themselves light up, and a bed joint is a
    // line: a full-width course, every pixel of it.
    const on = lit('brick', 0.3);
    const perRow = new Map<number, number>();
    for (const [, y] of on) perRow.set(y, (perRow.get(y) ?? 0) + 1);
    const fullRows = [...perRow.entries()].filter(([, n]) => n === 16).map(([y]) => y).sort((a, b) => a - b);
    // 4px courses over a 16px tile.
    expect(fullRows).toHaveLength(4);
    for (let i = 1; i < fullRows.length; i++) {
      expect(fullRows[i] - fullRows[i - 1]).toBe(4);
    }
  });

  it('brick is oblong, not square', () => {
    // 2:1 bricks. The bed joints repeat twice as often as the head joints do,
    // which is the whole difference between paving and graph paper.
    const on = lit('brick', 0.3);
    const rowsWithAny = new Set(on.map(([, y]) => y));
    const colsFullyLit = new Set<number>();
    for (let x = 0; x < 16; x++) {
      if (on.filter(([px]) => px === x).length === 16) colsFullyLit.add(x);
    }
    expect(rowsWithAny.size).toBe(16);   // every row meets a head joint
    expect(colsFullyLit.size).toBe(0);   // but no column runs unbroken: courses offset
  });

  it('brick offsets the vertical joints of neighbouring courses', () => {
    // Running bond, not a grid: the head joints of one course land mid-flag on
    // the next. Without this it reads as graph paper.
    const on = lit('brick', 0.3);
    const rows = new Map<number, number[]>();
    for (const [x, y] of on) rows.set(y, [...(rows.get(y) ?? []), x]);
    const courses = [...rows.entries()].filter(([, xs]) => xs.length === 2);
    const sets = courses.map(([, xs]) => xs.sort((a, b) => a - b).join(','));
    expect(new Set(sets).size).toBe(2); // two distinct joint alignments
  });

  it('carpet repeats four motifs that reach full strength', () => {
    // 8x8 cells over a 16px tile. Each carries a medallion (4px) and a closed
    // lozenge ring (16px); anything weaker means the motif washed out.
    let top = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (textureShadeAt('carpet', x, y, 0, 1, MAX_TEXTURE_SHADES) === MAX_TEXTURE_SHADES) top++;
      }
    }
    expect(top).toBe(4 * (4 + 16));
  });

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

  it('carpet leaves the ground between motifs untextured', () => {
    // The field has to come back to zero, or the "pattern" is just a wash.
    const on = lit('carpet', 0.5);
    expect(on.length).toBeLessThan(256);
    expect(on.length).toBeGreaterThan(0);
  });

  it('cells has sparse boundaries at low amount and varied interiors at full amount', () => {
    const sparse = lit('cells', 0.35);
    expect(sparse.length).toBeGreaterThan(0);
    expect(sparse.length).toBeLessThan(256);

    const shades = new Set<number>();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        shades.add(textureShadeAt('cells', x, y, 0, 1, MAX_TEXTURE_SHADES));
      }
    }
    expect(shades.size).toBeGreaterThan(2);
  });

  it('small_cells generates a dense 4x4 cellular grid', () => {
    const sparse = lit('small_cells', 0.35);
    expect(sparse.length).toBeGreaterThan(0);
    expect(sparse.length).toBeLessThan(256);

    const shades = new Set<number>();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        shades.add(textureShadeAt('small_cells', x, y, 0, 1, MAX_TEXTURE_SHADES));
      }
    }
    expect(shades.size).toBeGreaterThan(2);
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
    paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, 16, [], 0, 0, 1, 3,
      { ...NO_TEXTURE, ...tex });

  it('is inert when off', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, 16);
    expect(Array.from(paint({}))).toEqual(Array.from(bare));
    expect(Array.from(paint({ algoA: 'white', algoB: 'white', amountA: 0, amountB: 0 })))
      .toEqual(Array.from(bare));
  });

  it('changes the solid interior but leaves the band alone', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, 16);
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

  it('leaves the background tile flat unless terrain B is textured', () => {
    const flat = paintPatternTileRGBA(DEFAULT_PATTERN, -1, REFERENCE_ROLE_COLOURS, 16, [], 0, 0, 1, 3,
      { ...NO_TEXTURE, algoA: 'white', algoB: 'white', amountA: 1 });
    const b = REFERENCE_ROLE_COLOURS.terrainB;
    for (let i = 0; i < flat.length; i += 4) {
      expect([flat[i], flat[i + 1], flat[i + 2]]).toEqual([b.r, b.g, b.b]);
    }
  });
});
