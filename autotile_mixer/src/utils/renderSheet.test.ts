import { describe, it, expect } from 'vitest';
import {
  recipeToPaintArgs, renderSheetRGBA, renderLevelGrid,
  SHEET_WIDTH, SHEET_HEIGHT, SHEET_TILE_SIZE,
} from './renderSheet';
import { BLOB47_LAYOUT, BLOB47_COLS } from './blob47';
import { PATTERN_OFFSET_RANGE, patternLevelsForMask } from './blob47Pattern';
import { WATER_DOT_COLOUR } from './patternTexture';
import { DEFAULT_RECIPE, sanitizeRecipe, type Recipe } from './recipe';

const base = (patch: Partial<Recipe> = {}): Recipe =>
  sanitizeRecipe({ ...DEFAULT_RECIPE, ...patch });

function fnv1a(bytes: Uint8Array | Uint8ClampedArray): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
  return hash >>> 0;
}

describe('recipeToPaintArgs', () => {
  it('scales bandBias by the pattern\'s own offset range, not a fixed fraction', () => {
    // The thumbnail component used to do `(bias / 100) * (tileSize / 2)`, which
    // is ~100x too small and ignores the per-pattern travel. That divergence is
    // the reason this mapping has one home.
    for (const patternId of ['square', 'rounded', 'jagged'] as const) {
      const [lo, hi] = PATTERN_OFFSET_RANGE[patternId];
      expect(recipeToPaintArgs(base({ patternId, bandBias: 1 })).opts.offsetPx).toBe(hi);
      expect(recipeToPaintArgs(base({ patternId, bandBias: -1 })).opts.offsetPx).toBe(lo);
      expect(recipeToPaintArgs(base({ patternId, bandBias: 0 })).opts.offsetPx).toBe(0);
    }
    // Different patterns must not agree, or the range is not being consulted.
    expect(recipeToPaintArgs(base({ patternId: 'square', bandBias: 1 })).opts.offsetPx)
      .not.toBe(recipeToPaintArgs(base({ patternId: 'rounded', bandBias: 1 })).opts.offsetPx);
  });

  it('pins water to two shades and keeps its dot colour at step 2', () => {
    const args = recipeToPaintArgs(base({ textureAlgoA: 'water', textureShadesA: 4 }));
    expect(args.opts.texture!.shadesA).toBe(2);
    expect(args.opts.texture!.rampA?.[2]).toEqual(WATER_DOT_COLOUR);
  });

  it('paints the pavings at full strength whatever the amount slider says', () => {
    // textureUsesAmount is false for them; the control is hidden in the UI and
    // a hidden control must not still be acting.
    const args = recipeToPaintArgs(base({ textureAlgoA: 'brick_wall', textureAmountA: 0.05 }));
    expect(args.opts.texture!.amountA).toBe(1);
    // ...but an algorithm that does use it keeps the value.
    const white = recipeToPaintArgs(base({ textureAlgoA: 'white', textureAmountA: 0.05 }));
    expect(white.opts.texture!.amountA).toBe(0.05);
  });

  it('substitutes only the custom band shades that are set', () => {
    const derived = recipeToPaintArgs(base({ bandSteps: 3 })).opts.ramp!;
    const custom = ['#010203', '#040506', '#070809', '#0a0b0c', '#0d0e0f'];
    const args = recipeToPaintArgs(base({ bandSteps: 3, customShadesHex: custom }));
    expect(args.opts.ramp).toHaveLength(derived.length);
    expect(args.opts.ramp![0]).toEqual({ r: 1, g: 2, b: 3 });
    // A ramp of the wrong length is ignored rather than applied to the wrong steps.
    const wrong = recipeToPaintArgs(base({ bandSteps: 3, customShadesHex: ['#010203'] }));
    expect(wrong.opts.ramp).toEqual(derived);
  });

  it('takes the grain targets from overrides, defaulting to all three zones', () => {
    expect(recipeToPaintArgs(base()).opts.noiseTargets).toEqual(['edge', 'terrainA', 'terrainB']);
    expect(recipeToPaintArgs(base(), { noiseTargets: ['edge'] }).opts.noiseTargets).toEqual(['edge']);
  });
});

describe('renderSheetRGBA', () => {
  it('lays 48 slots out in the blob47 order at 32px', () => {
    const rgba = renderSheetRGBA(base());
    expect(rgba.length).toBe(SHEET_WIDTH * SHEET_HEIGHT * 4);
    expect(SHEET_WIDTH).toBe(256);
    expect(SHEET_HEIGHT).toBe(192);
    expect(SHEET_TILE_SIZE).toBe(32);
  });

  it('is a pure function of the recipe', () => {
    expect(fnv1a(renderSheetRGBA(base()))).toBe(fnv1a(renderSheetRGBA(base())));
    expect(fnv1a(renderSheetRGBA(base({ patternId: 'square' }))))
      .not.toBe(fnv1a(renderSheetRGBA(base({ patternId: 'moss' }))));
  });

  it('honours the grain overrides that are not part of a Recipe', () => {
    const r = base({ patternNoise: ['white'], patternNoiseStrength: 1 });
    const all = fnv1a(renderSheetRGBA(r, { noiseTargets: ['edge', 'terrainA', 'terrainB'] }));
    const edgeOnly = fnv1a(renderSheetRGBA(r, { noiseTargets: ['edge'] }));
    expect(all).not.toBe(edgeOnly);
  });
});

describe('renderLevelGrid', () => {
  it('is the per-slot level grid tiled into the sheet layout', () => {
    const recipe = base({ patternId: 'moss', bandSteps: 5, outlineWidth: 3, bandBias: 0.5 });
    const args = recipeToPaintArgs(recipe);
    const grid = renderLevelGrid(recipe);
    expect(grid).toHaveLength(SHEET_WIDTH * SHEET_HEIGHT);

    for (const slot of [0, 17, 47]) {
      const expected = patternLevelsForMask(
        args.patternId, BLOB47_LAYOUT[slot], args.opts.offsetPx, SHEET_TILE_SIZE,
        args.opts.bandSteps, args.opts.hardEdgeB, args.opts.edgeSeed, args.opts.outlineWidth
      );
      const col = slot % BLOB47_COLS;
      const row = Math.floor(slot / BLOB47_COLS);
      for (let y = 0; y < SHEET_TILE_SIZE; y++) {
        const from = (row * SHEET_TILE_SIZE + y) * SHEET_WIDTH + col * SHEET_TILE_SIZE;
        expect(grid.slice(from, from + SHEET_TILE_SIZE))
          .toBe(expected.slice(y * SHEET_TILE_SIZE, (y + 1) * SHEET_TILE_SIZE));
      }
    }
  });
});
