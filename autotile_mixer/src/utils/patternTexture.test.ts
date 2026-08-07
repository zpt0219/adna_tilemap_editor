import { describe, it, expect } from 'vitest';
import {
  TEXTURE_PRESETS, DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES, MAX_TEXTURE_SHADES,
  textureShadeAt, textureColour, type TextureId,
} from './patternTexture';
import {
  DEFAULT_ROLE_COLOURS, paintPatternTileRGBA, patternRamp, toHexColour, NO_TEXTURE,
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
    expect(coverage(algo, 1)).toBe(1);
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

describe('texture applied to a tile', () => {
  const paint = (tex: Partial<typeof NO_TEXTURE>) =>
    paintPatternTileRGBA(DEFAULT_PATTERN, 110, DEFAULT_ROLE_COLOURS, 16, [], 0, 0, 1, 3,
      { ...NO_TEXTURE, ...tex });

  it('is inert when off', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, DEFAULT_ROLE_COLOURS, 16);
    expect(Array.from(paint({}))).toEqual(Array.from(bare));
    expect(Array.from(paint({ algo: 'white', amountA: 0, amountB: 0 })))
      .toEqual(Array.from(bare));
  });

  it('changes the solid interior but leaves the band alone', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, DEFAULT_ROLE_COLOURS, 16);
    const tex = paint({ algo: 'white', amountA: 0.6 });
    const bandColours = new Set(patternRamp(DEFAULT_ROLE_COLOURS, 3).slice(1, -1).map(toHexColour));
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
    const onlyA = paint({ algo: 'white', amountA: 0.6, amountB: 0 });
    const onlyB = paint({ algo: 'white', amountA: 0, amountB: 0.6 });
    expect(Array.from(onlyA)).not.toEqual(Array.from(onlyB));
  });

  it('leaves the background tile flat unless terrain B is textured', () => {
    const flat = paintPatternTileRGBA(DEFAULT_PATTERN, -1, DEFAULT_ROLE_COLOURS, 16, [], 0, 0, 1, 3,
      { ...NO_TEXTURE, algo: 'white', amountA: 1 });
    const b = DEFAULT_ROLE_COLOURS.terrainB;
    for (let i = 0; i < flat.length; i += 4) {
      expect([flat[i], flat[i + 1], flat[i + 2]]).toEqual([b.r, b.g, b.b]);
    }
  });
});
