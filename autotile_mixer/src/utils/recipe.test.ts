import { describe, it, expect } from 'vitest';
import { sanitizeRecipe, DEFAULT_RECIPE, BUILTIN_PRESETS } from './recipe';

describe('sanitizeRecipe', () => {
  it('returns DEFAULT_RECIPE on null, undefined or non-object input', () => {
    expect(sanitizeRecipe(null)).toEqual(DEFAULT_RECIPE);
    expect(sanitizeRecipe(undefined)).toEqual(DEFAULT_RECIPE);
    expect(sanitizeRecipe('invalid')).toEqual(DEFAULT_RECIPE);
    expect(sanitizeRecipe(123)).toEqual(DEFAULT_RECIPE);
  });

  it('returns DEFAULT_RECIPE on empty object', () => {
    expect(sanitizeRecipe({})).toEqual(DEFAULT_RECIPE);
  });

  it('preserves valid builtin preset recipes', () => {
    for (const preset of BUILTIN_PRESETS) {
      const sanitized = sanitizeRecipe(preset.recipe);
      expect(sanitized).toEqual(preset.recipe);
    }
  });

  it('clamps numerical values that exceed defined bounds', () => {
    const raw = {
      edgeSeed: 9999999, // max 99999
      outlineWidth: 10,   // max 4
      bandSteps: 1,       // min 3
      bandBias: 5,        // max 1
      patternNoiseStrength: -2, // min 0
      cellScaleA: 0.1,    // min 0.5
    };
    const sanitized = sanitizeRecipe(raw);
    expect(sanitized.edgeSeed).toBe(99999);
    expect(sanitized.outlineWidth).toBe(4);
    expect(sanitized.bandSteps).toBe(3);
    expect(sanitized.bandBias).toBe(1);
    expect(sanitized.patternNoiseStrength).toBe(0);
    expect(sanitized.cellScaleA).toBe(0.5);
  });

  it('falls back to default enum values if unknown string is provided', () => {
    const raw = {
      patternId: 'non_existent_pattern',
      ribbonAlgo: 'super_ring',
      textureAlgoA: 'magic',
    };
    const sanitized = sanitizeRecipe(raw);
    expect(sanitized.patternId).toBe(DEFAULT_RECIPE.patternId);
    expect(sanitized.ribbonAlgo).toBe(DEFAULT_RECIPE.ribbonAlgo);
    expect(sanitized.textureAlgoA).toBe(DEFAULT_RECIPE.textureAlgoA);
  });

  it('falls back to default colors when hex color is invalid', () => {
    const raw = {
      roleHex: {
        terrainA: 'blue',
        terrainB: '#12345',
        edge: '#GGGGGG',
      },
    };
    const sanitized = sanitizeRecipe(raw);
    expect(sanitized.roleHex.terrainA).toBe(DEFAULT_RECIPE.roleHex.terrainA);
    expect(sanitized.roleHex.terrainB).toBe(DEFAULT_RECIPE.roleHex.terrainB);
    expect(sanitized.roleHex.edge).toBe(DEFAULT_RECIPE.roleHex.edge);
  });

  it('rejects customShadesHex if array length does not equal bandSteps + 2', () => {
    const raw = {
      bandSteps: 4,
      customShadesHex: ['#111111', '#222222'], // length 2 != 6
    };
    const sanitized = sanitizeRecipe(raw);
    expect(sanitized.customShadesHex).toBeNull();
  });
});
