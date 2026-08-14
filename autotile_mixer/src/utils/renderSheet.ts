// renderSheet.ts — the one place a Recipe becomes pixels.
//
// This used to live inside App.tsx as a pile of useMemo()s. It is out here now
// because three callers need the exact same answer and any drift between them
// is invisible until someone diffs two PNGs:
//
//   1. the app's preview canvas,
//   2. the corpus generator (tools/gen-corpus.ts), which bakes the ground-truth
//      images the desktop port is verified against,
//   3. the desktop C++ port, for which this file is the porting spec.
//
// So: no DOM, no React, no ImageData. Plain RGBA out, runs under node.
//
// If you change anything in here you have changed what every existing recipe
// renders to. Re-bake the corpus and review the diff — that is what it is for.

import { BLOB47_LAYOUT, BLOB47_COLS, BLOB47_ROWS } from './blob47';
import {
  PATTERN_TILE_SIZE,
  PATTERN_OFFSET_RANGE,
  patternLevelsForMask,
} from './blob47Pattern';
import {
  DEFAULT_NOISE_TARGETS,
  type NoiseTargetId,
} from './patternNoise';
import {
  paintPatternTileRGBA,
  patternRamp,
  parseHexColour,
  DEFAULT_TEXTURE_COLOURS,
  type PaintOptions,
  type RGB,
  type RoleColours,
  type TextureOptions,
} from './patternPaint';
import {
  textureUsesAmount,
  WATER_DOT_COLOUR,
  type TextureId,
} from './patternTexture';
import { sanitizeRecipe, type Recipe } from './recipe';

export const SHEET_TILE_SIZE = PATTERN_TILE_SIZE;
export const SHEET_WIDTH = BLOB47_COLS * SHEET_TILE_SIZE;
export const SHEET_HEIGHT = BLOB47_ROWS * SHEET_TILE_SIZE;

/**
 * Paint inputs that are NOT part of a Recipe.
 *
 * The grain's target zones and picked colours change pixels but were never
 * added to the recipe schema, so they do not survive a save, a share link, or a
 * trip through the desktop app. Rather than widen the schema (and with it the
 * share-code format) they are passed alongside, which keeps them reachable from
 * the corpus — the level-gate rule in paintPatternTileRGBA took three wrong
 * versions to get right and leaving it untested is not an option.
 */
export interface PaintOverrides {
  noiseTargets?: readonly NoiseTargetId[];
  noiseColours?: { b?: RGB; edge?: RGB; a?: RGB };
}

export interface PaintArgs {
  patternId: Recipe['patternId'];
  roleColours: RoleColours;
  opts: PaintOptions;
}

/** A sparse hex ramp as the painter wants it, or undefined when nothing is set. */
function parseCustomRamp(
  hexes: readonly (string | null | undefined)[] | null | undefined,
  shadeCount: number
): (RGB | undefined)[] | undefined {
  if (!hexes || !hexes.some(Boolean)) return undefined;
  const sliced = hexes.slice(0, shadeCount + 1);
  if (!sliced.some(Boolean)) return undefined;
  return sliced.map((h) => (h ? parseHexColour(h) : undefined));
}

/**
 * Resolve a Recipe into everything paintPatternTileRGBA takes.
 *
 * Every derivation the UI does between a stored field and a paint parameter
 * lives here, and each one is load-bearing:
 *
 *   bandBias -> offsetPx   the slider is normalised because each pattern has its
 *                          own usable travel (PATTERN_OFFSET_RANGE).
 *   water    -> 2 shades   the water table only has two, and a stale 4 from
 *                          another algorithm would index off the end.
 *   amount   -> 1          the pavings ignore the strength slider and its
 *                          control is hidden; a hidden control must not act.
 *   water    -> ramp[2]    the dot colour is part of the motif, not the palette.
 */
export function recipeToPaintArgs(raw: Recipe, overrides: PaintOverrides = {}): PaintArgs {
  const r = sanitizeRecipe(raw);

  const roleColours: RoleColours = {
    terrainA: parseHexColour(r.roleHex.terrainA),
    terrainB: parseHexColour(r.roleHex.terrainB),
    edge: parseHexColour(r.roleHex.edge),
  };

  const [lo, hi] = PATTERN_OFFSET_RANGE[r.patternId];
  const offsetPx = r.bandBias < 0 ? -r.bandBias * lo : r.bandBias * hi;

  const derivedRamp = patternRamp(roleColours, r.bandSteps);
  const ramp = r.customShadesHex && r.customShadesHex.length === derivedRamp.length
    ? derivedRamp.map((c, i) => (r.customShadesHex![i] ? parseHexColour(r.customShadesHex![i]) : c))
    : derivedRamp;

  const shadesA = r.textureAlgoA === 'water' ? 2 : r.textureShadesA;
  const shadesB = r.textureAlgoB === 'water' ? 2 : r.textureShadesB;
  const amountA = textureUsesAmount(r.textureAlgoA) ? r.textureAmountA : 1;
  const amountB = textureUsesAmount(r.textureAlgoB) ? r.textureAmountB : 1;

  const textureRampFor = (
    hexes: (string | undefined)[] | null,
    algo: TextureId,
    shadeCount: number
  ): (RGB | undefined)[] | undefined => {
    const custom = parseCustomRamp(hexes, shadeCount);
    if (algo !== 'water') return custom;
    const waterRamp: (RGB | undefined)[] = custom ? [...custom] : new Array(3).fill(undefined);
    waterRamp[2] ??= WATER_DOT_COLOUR;
    return waterRamp;
  };

  const texture: TextureOptions = {
    algoA: r.textureAlgoA,
    algoB: r.textureAlgoB,
    amountA,
    amountB,
    shadesA,
    shadesB,
    seedA: r.textureSeedA,
    seedB: r.textureSeedB,
    cellScaleA: r.cellScaleA,
    cellScaleB: r.cellScaleB,
    rippleScaleA: r.rippleScaleA,
    rippleScaleB: r.rippleScaleB,
    geoScaleA: r.geoScaleA,
    geoScaleB: r.geoScaleB,
    colourA: DEFAULT_TEXTURE_COLOURS.terrainA,
    colourB: DEFAULT_TEXTURE_COLOURS.terrainB,
    rampA: textureRampFor(r.customTexHex.terrainA, r.textureAlgoA, shadesA),
    rampB: textureRampFor(r.customTexHex.terrainB, r.textureAlgoB, shadesB),
  };

  return {
    patternId: r.patternId,
    roleColours,
    opts: {
      tileSize: SHEET_TILE_SIZE,
      offsetPx,
      bandSteps: r.bandSteps,
      hardEdgeB: r.hardEdgeB,
      edgeSeed: r.edgeSeed,
      outlineWidth: r.outlineWidth,
      noises: r.patternNoise,
      noiseSeed: r.patternNoiseSeed,
      noiseStrength: r.patternNoiseStrength,
      noiseTargets: overrides.noiseTargets ?? DEFAULT_NOISE_TARGETS,
      noiseColours: overrides.noiseColours,
      ribbon: {
        algo: r.ribbonAlgo,
        amount: r.ribbonAmount,
        period: r.ribbonPeriod,
        shades: r.ribbonShades,
        // One dice for the edge: the silhouette re-roll and the motif's phase
        // both follow it, so rolling once changes the edge rather than one
        // aspect of it.
        seed: r.edgeSeed,
        invert: r.ribbonInvert,
        ramp: r.customRibbonHex?.length === r.ribbonShades + 1
          ? r.customRibbonHex.map((h) => (h ? parseHexColour(h) : undefined))
          : undefined,
      },
      texture,
      ramp,
      transparentB: r.transparentB,
    },
  };
}

/**
 * The whole 8x6 sheet as RGBA bytes, row-major over the full 256x192.
 *
 * Deliberately not routed through a canvas. `canvas.toBlob` may premultiply and
 * zero the RGB under alpha=0 (which `transparentB` produces on most of the
 * sheet), and it does so differently across browsers — so a canvas round-trip
 * would make the ground truth depend on which machine baked it.
 */
export function renderSheetRGBA(
  recipe: Recipe,
  overrides: PaintOverrides = {}
): Uint8ClampedArray<ArrayBuffer> {
  const a = recipeToPaintArgs(recipe, overrides);
  // Backed by a plain ArrayBuffer (not ArrayBufferLike) so the result can be
  // handed straight to `new ImageData(...)` — same reason paintPatternTileRGBA
  // does it.
  const out = new Uint8ClampedArray(new ArrayBuffer(SHEET_WIDTH * SHEET_HEIGHT * 4));

  for (let i = 0; i < BLOB47_LAYOUT.length; i++) {
    const col = i % BLOB47_COLS;
    const row = Math.floor(i / BLOB47_COLS);
    const tile = paintPatternTileRGBA(a.patternId, BLOB47_LAYOUT[i], a.roleColours, a.opts);
    const x0 = col * SHEET_TILE_SIZE;
    const y0 = row * SHEET_TILE_SIZE;
    for (let y = 0; y < SHEET_TILE_SIZE; y++) {
      const src = y * SHEET_TILE_SIZE * 4;
      const dst = ((y0 + y) * SHEET_WIDTH + x0) * 4;
      out.set(tile.subarray(src, src + SHEET_TILE_SIZE * 4), dst);
    }
  }
  return out;
}

/**
 * The sheet's level grid — one digit per pixel, same 256x192 layout.
 *
 * This is the silhouette with the palette taken away, and it is what makes a
 * parity failure diagnosable: differences that hug a level boundary are a
 * quantisation flip (a float problem), differences that fill a level are a
 * palette problem, and differences scattered through one level are a texture
 * problem. Without it a failure report is just a pixel count.
 */
export function renderLevelGrid(recipe: Recipe, overrides: PaintOverrides = {}): string {
  const a = recipeToPaintArgs(recipe, overrides);
  const { opts } = a;
  const rows: string[][] = Array.from({ length: SHEET_HEIGHT }, () => new Array<string>(BLOB47_COLS));

  for (let i = 0; i < BLOB47_LAYOUT.length; i++) {
    const col = i % BLOB47_COLS;
    const row = Math.floor(i / BLOB47_COLS);
    const grid = patternLevelsForMask(
      a.patternId, BLOB47_LAYOUT[i], opts.offsetPx, SHEET_TILE_SIZE,
      opts.bandSteps, opts.hardEdgeB, opts.edgeSeed, opts.outlineWidth
    );
    for (let y = 0; y < SHEET_TILE_SIZE; y++) {
      rows[row * SHEET_TILE_SIZE + y][col] = grid.slice(y * SHEET_TILE_SIZE, (y + 1) * SHEET_TILE_SIZE);
    }
  }
  return rows.map((r) => r.join('')).join('');
}
