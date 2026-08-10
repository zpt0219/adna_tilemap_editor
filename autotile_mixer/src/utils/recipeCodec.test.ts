import { describe, it, expect } from 'vitest';
import { DEFAULT_RECIPE, BUILTIN_PRESETS, type Recipe } from './recipe';
import { encodeRecipe, decodeRecipe } from './recipeCodec';

describe('recipeCodec (V1 Binary Bit-Packing)', () => {
  it('encodes DEFAULT_RECIPE to a short Base64URL string', () => {
    const encoded = encodeRecipe(DEFAULT_RECIPE);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(30);
    expect(encoded.length).toBeLessThan(70);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('losslessly roundtrips DEFAULT_RECIPE', () => {
    const encoded = encodeRecipe(DEFAULT_RECIPE);
    const decoded = decodeRecipe(encoded);
    expect(decoded).toEqual(DEFAULT_RECIPE);
  });

  it('losslessly roundtrips all BUILTIN_PRESETS', () => {
    for (const preset of BUILTIN_PRESETS) {
      const encoded = encodeRecipe(preset.recipe);
      const decoded = decodeRecipe(encoded);
      expect(decoded).toEqual(preset.recipe);
    }
  });

  it('losslessly roundtrips recipes with custom shades and custom texture overrides', () => {
    const customRecipe: Recipe = {
      ...DEFAULT_RECIPE,
      bandSteps: 4,
      customShadesHex: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'],
      ribbonAlgo: 'dashes',
      ribbonShades: 2,
      customRibbonHex: [undefined, '#ff0000', '#00ff00'],
      textureAlgoA: 'water',
      textureShadesA: 2,
      cellScaleA: 6,
      cellScaleB: 5,
      rippleScaleA: 8,
      geoScaleA: 4,
      customTexHex: {
        terrainA: ['#000011', undefined, '#000033'],
        terrainB: null,
      },
    };

    const encoded = encodeRecipe(customRecipe);
    const decoded = decodeRecipe(encoded);
    expect(decoded).toEqual(customRecipe);
  });

  it('returns null on invalid or corrupted hash', () => {
    expect(decodeRecipe('')).toBeNull();
    expect(decodeRecipe('invalid_hash_str')).toBeNull();
    expect(decodeRecipe('@@@@')).toBeNull();
  });
});
