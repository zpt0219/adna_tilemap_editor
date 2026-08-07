// patternPaint.ts — turn the built-in blob47 pattern into pixels.
//
// The caller picks ONE colour per role (terrain A, terrain B, outline); the
// shaded levels come from the recipes baked into blob47Pattern.ts, so there is
// nothing to tune and no field to evaluate — the silhouette is art data and
// this module only colours it in.
//
// Kept free of ImageData so it runs headless under vitest; App wraps the RGBA
// buffer when it needs to blit.

import {
  PATTERN_LEVELS,
  PATTERN_TILE_SIZE,
  SHADE_RECIPES,
  DEFAULT_BAND_STEPS,
  bandNoiseSpan,
  patternLevelsFor,
  patternLevelsForMask,
  type PatternId,
  type PatternRole,
} from './blob47Pattern';
import {
  DEFAULT_NOISES, DEFAULT_NOISE_SEED, DEFAULT_NOISE_STRENGTH, noiseStep, type NoiseId,
} from './patternNoise';
import {
  DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES, textureColour, textureShadeAt, type TextureId,
} from './patternTexture';

/** Speckle applied inside the solid terrains. `amount` 0 disables per terrain. */
export interface TextureOptions {
  algo: TextureId;
  amountA: number;
  amountB: number;
  shades: number;
  seed: number;
}

export const NO_TEXTURE: TextureOptions = {
  algo: DEFAULT_TEXTURE,
  amountA: 0,
  amountB: 0,
  shades: DEFAULT_TEXTURE_SHADES,
  seed: 0,
};

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type RoleColours = Record<PatternRole, RGB>;

/** The reference palette this pattern was authored against. */
export const DEFAULT_ROLE_COLOURS: RoleColours = {
  terrainA: { r: 248, g: 248, b: 248 },
  terrainB: { r: 176, g: 216, b: 72 },
  edge: { r: 175, g: 198, b: 255 },
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function parseHexColour(hex: string): RGB {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

export function toHexColour({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

// --- HSV, matching the reference solve exactly ------------------------------
function rgbToHsv({ r, g, b }: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const range = mx - mn;
  if (range === 0) return [0, 0, mx];
  const rc = (mx - R) / range;
  const gc = (mx - G) / range;
  const bc = (mx - B) / range;
  let h: number;
  if (R === mx) h = bc - gc;
  else if (G === mx) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  h = (h / 6) % 1;
  return [h < 0 ? h + 1 : h, range / mx, mx];
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  if (s === 0) return { r: clamp255(v * 255), g: clamp255(v * 255), b: clamp255(v * 255) };
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const table: [number, number, number][] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ];
  const [R, G, B] = table[((i % 6) + 6) % 6];
  return { r: clamp255(R * 255), g: clamp255(G * 255), b: clamp255(B * 255) };
}

/**
 * A role's shaded variant. An achromatic base has no hue to shift, so the
 * recipe's `hue` is taken as an absolute one — that is what lets a plain white
 * terrain still pick up the cool rim tint the pattern was drawn with.
 */
export function shadeColour(c: RGB, role: PatternRole, t = 1): RGB {
  if (t <= 0) return c;
  const recipe = SHADE_RECIPES[role];
  const [h0, s0, v0] = rgbToHsv(c);
  // An achromatic base has no hue to nudge, so it takes the recipe's outright
  // and lets the scaled saturation decide how much of it shows. A coloured base
  // keeps its own hue and is only nudged — rotating it by the grey tint's hue
  // would send a deep blue off to magenta.
  const h = s0 < 1e-6 ? recipe.greyHue : (h0 + recipe.hue * t + 1) % 1;
  return hsvToRgb(
    h,
    Math.max(0, Math.min(1, s0 + recipe.sat * t)),
    Math.max(0, Math.min(1, v0 * (1 + (recipe.val - 1) * t)))
  );
}

/** The level colours, indexed by the digits in the level grid. */
export function patternRamp(colours: RoleColours, bandSteps?: number): RGB[] {
  const levels = bandSteps === undefined ? PATTERN_LEVELS : patternLevelsFor(bandSteps);
  return levels.map(({ role, shade }) =>
    shade > 0 ? shadeColour(colours[role], role, shade) : colours[role]
  );
}

/**
 * One tile as RGBA bytes.
 *
 * `tileSize` must be a multiple of PATTERN_TILE_SIZE. That is not cosmetic: the
 * grain repeats every 16 output pixels, so seams (which fall every `tileSize`
 * pixels) only line up with it when 16 divides `tileSize`.
 */
export function paintPatternTileRGBA(
  pattern: PatternId,
  mask: number,
  colours: RoleColours,
  tileSize: number = PATTERN_TILE_SIZE,
  noises: readonly NoiseId[] = DEFAULT_NOISES,
  offsetPx = 0,
  noiseSeed = DEFAULT_NOISE_SEED,
  noiseStrength = DEFAULT_NOISE_STRENGTH,
  bandSteps = DEFAULT_BAND_STEPS,
  texture: TextureOptions = NO_TEXTURE,
  hardEdgeB = false
): Uint8ClampedArray<ArrayBuffer> {
  const ramp = patternRamp(colours, bandSteps);
  const grid = patternLevelsForMask(pattern, mask, offsetPx, tileSize, bandSteps, hardEdgeB);
  const solid = ramp.length - 1;

  // Texture shades are a handful of colours, not a per-pixel computation.
  const shades = Math.max(1, texture.shades);
  const texOn = texture.algo !== 'none';
  const texA = texOn && texture.amountA > 0
    ? Array.from({ length: shades + 1 }, (_, k) => textureColour(colours.terrainA, k / shades))
    : null;
  const texB = texOn && texture.amountB > 0
    ? Array.from({ length: shades + 1 }, (_, k) => textureColour(colours.terrainB, k / shades))
    : null;
  // Grain displacement scales with the band so it keeps reading as the band
  // widens; at the default step count this is 1 and nothing changes.
  const span = bandNoiseSpan(pattern, bandSteps);
  // Backed by a plain ArrayBuffer (not ArrayBufferLike) so the result can be
  // handed straight to `new ImageData(...)`.
  const out = new Uint8ClampedArray(new ArrayBuffer(tileSize * tileSize * 4));
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      let level = grid.charCodeAt(y * tileSize + x) - 48;
      // Grain lives on the transition band only, and is sampled in OUTPUT
      // space so it gets finer along with the art instead of blocking up.
      if (level > 0 && level < solid && noises.length > 0) {
        level = Math.max(0, Math.min(solid,
          level + noiseStep(noises, x, y, noiseSeed, noiseStrength) * span));
      }
      // Texture speckles the solid terrains only; the band keeps its own grain.
      let rgb = ramp[level];
      if (texA && level === solid) {
        const k = textureShadeAt(texture.algo, x, y, texture.seed, texture.amountA, shades);
        if (k > 0) rgb = texA[k];
      } else if (texB && level === 0) {
        const k = textureShadeAt(texture.algo, x, y, texture.seed, texture.amountB, shades);
        if (k > 0) rgb = texB[k];
      }
      const { r, g, b } = rgb;
      const i = (y * tileSize + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
