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
  outlineWidthPx,
  bandNoiseSpan,
  patternLevelsFor,
  patternLevelsForMask,
  patternBandCoords,
  type PatternId,
  type PatternRole,
} from './blob47Pattern';
import {
  DEFAULT_NOISES, DEFAULT_NOISE_SEED, DEFAULT_NOISE_STRENGTH, DEFAULT_NOISE_TARGETS,
  noiseStep, type NoiseId, type NoiseTargetId,
} from './patternNoise';
import {
  NO_RIBBON, ribbonShadeAt, type RibbonOptions,
} from './patternRibbon';
import {
  DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES, DEFAULT_CELL_SCALE, DEFAULT_RIPPLE_SCALE,
  DEFAULT_GEO_SCALE,
  textureColour, textureRamp, textureShadeAt, type TextureId,
} from './patternTexture';

/**
 * Speckle applied inside the solid terrains. `amount` 0 disables per terrain.
 *
 * The algorithm is per terrain as well as the amount and colour: the two solid
 * regions are different materials, and the whole point of the geometric ones is
 * that paving under grass wants a different field from the grass itself.
 */
export interface TextureOptions {
  algoA: TextureId;
  algoB: TextureId;
  amountA: number;
  amountB: number;
  shadesA: number;
  shadesB: number;
  seedA: number;
  seedB: number;
  cellScaleA?: number;
  cellScaleB?: number;
  rippleScaleA?: number;
  rippleScaleB?: number;
  /** Motif size for the generated geometric pavings; see GEO_SCALES. */
  geoScaleA?: number;
  geoScaleB?: number;
  /**
   * What each terrain's texture fades toward. Independent of the terrain and
   * band colours on purpose — the speckle in hand-drawn pixel art is usually a
   * different material, not a lighter version of the ground. Omitted means
   * derive it from the terrain colour (see textureRamp).
   */
  colourA?: RGB;
  colourB?: RGB;
  /**
   * Per-step overrides of the A/B ramps above, sparse and indexed from the bare
   * terrain at 0. Length must match that terrain's shade count + 1 or it is ignored — a stale
   * array from a different step count would recolour the wrong steps, which is
   * the same guard the band ramp carries.
   */
  rampA?: readonly (RGB | undefined)[];
  rampB?: readonly (RGB | undefined)[];
}

export const NO_TEXTURE: TextureOptions = {
  algoA: DEFAULT_TEXTURE,
  algoB: DEFAULT_TEXTURE,
  amountA: 0,
  amountB: 0,
  shadesA: DEFAULT_TEXTURE_SHADES,
  shadesB: DEFAULT_TEXTURE_SHADES,
  seedA: 0,
  seedB: 0,
  cellScaleA: DEFAULT_CELL_SCALE,
  cellScaleB: DEFAULT_CELL_SCALE,
  rippleScaleA: DEFAULT_RIPPLE_SCALE,
  rippleScaleB: DEFAULT_RIPPLE_SCALE,
  geoScaleA: DEFAULT_GEO_SCALE,
  geoScaleB: DEFAULT_GEO_SCALE,
};

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type RoleColours = Record<PatternRole, RGB>;

/**
 * The palette the shade recipes were solved against. It is a TEST FIXTURE, not
 * a UI default: the locked sheet hashes exist to catch a silhouette changing,
 * so they have to be measured against a palette that never moves. Changing what
 * the app starts up with must not disturb them.
 */
export const REFERENCE_ROLE_COLOURS: RoleColours = {
  terrainA: { r: 248, g: 248, b: 248 },
  terrainB: { r: 176, g: 216, b: 72 },
  edge: { r: 175, g: 198, b: 255 },
};

/**
 * What the app opens with: water on grass, with a sand shoreline.
 *
 * Terrain A is the painted region, so painting makes ponds and lakes in a grass
 * field. Terrain A's blue is deliberately short of full saturation — the
 * terrainA shade recipe only ADDS saturation (see SHADE_RECIPES), so a base at
 * s=1 has nowhere to go and the band's inner steps would collapse into the
 * terrain colour, leaving just the outline.
 */
export const DEFAULT_ROLE_COLOURS: RoleColours = {
  terrainA: { r: 58, g: 127, b: 201 },  // #3a7fc9 water
  terrainB: { r: 93, g: 168, b: 50 },   // #5da832 grass
  edge: { r: 232, g: 213, b: 160 },     // #e8d5a0 sand
};

/**
 * What the texture pickers open on: the shift the old auto-derivation would
 * have produced for the default terrains. Derived rather than written out, so
 * the starting point cannot drift away from textureColour().
 */
export const DEFAULT_TEXTURE_COLOURS: { terrainA: RGB; terrainB: RGB } = {
  terrainA: textureColour(DEFAULT_ROLE_COLOURS.terrainA, 1),
  terrainB: textureColour(DEFAULT_ROLE_COLOURS.terrainB, 1),
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
 * Everything that changes a tile's pixels beyond its pattern, mask and palette.
 *
 * An options object rather than the positional list this used to be: the band
 * refactor took it past sixteen parameters, at which point a call site is a row
 * of bare `undefined`s and adding one in the middle silently shifts the rest.
 */
export interface PaintOptions {
  /** Must be a multiple of PATTERN_TILE_SIZE — see the seam note below. */
  tileSize?: number;
  offsetPx?: number;
  bandSteps?: number;
  hardEdgeB?: boolean;
  /** Re-roll of the baked silhouette; 0 means exactly as baked. Also the
   *  ribbon motif's phase, because one edge should answer to one dice. */
  edgeSeed?: number;
  outlineWidth?: number;
  /** Grain on the transition band. The algorithms stack; empty means none. */
  noises?: readonly NoiseId[];
  noiseSeed?: number;
  noiseStrength?: number;
  /** Which of the band's three zones the grain may move a pixel out of. */
  noiseTargets?: readonly NoiseTargetId[];
  /** Picked colours for the grain, one per direction it nudges a pixel. */
  noiseColours?: { b?: RGB; edge?: RGB; a?: RGB };
  /** What is painted inside the outline. */
  ribbon?: RibbonOptions;
  /** Speckle inside the two solid terrains. */
  texture?: TextureOptions;
  /** Overrides the whole derived level ramp; ignored unless it matches length. */
  ramp?: readonly RGB[];
}

/**
 * One tile as RGBA bytes.
 *
 * `tileSize` must be a multiple of PATTERN_TILE_SIZE. That is not cosmetic: the
 * texture fields repeat every 16 or 32 output pixels, so seams (which fall every
 * `tileSize` pixels) only line up with them when that period divides `tileSize`.
 */
export function paintPatternTileRGBA(
  pattern: PatternId,
  mask: number,
  colours: RoleColours,
  opts: PaintOptions = {}
): Uint8ClampedArray<ArrayBuffer> {
  const {
    tileSize = PATTERN_TILE_SIZE,
    offsetPx = 0,
    bandSteps = DEFAULT_BAND_STEPS,
    hardEdgeB = false,
    edgeSeed = 0,
    outlineWidth,
    noises = DEFAULT_NOISES,
    noiseSeed = DEFAULT_NOISE_SEED,
    noiseStrength = DEFAULT_NOISE_STRENGTH,
    noiseTargets = DEFAULT_NOISE_TARGETS,
    noiseColours,
    ribbon = NO_RIBBON,
    texture = NO_TEXTURE,
    ramp: customRamp,
  } = opts;

  const derived = patternRamp(colours, bandSteps);
  const ramp = customRamp && customRamp.length === derived.length ? customRamp : derived;
  const levelDefs = patternLevelsFor(bandSteps);
  const grid = patternLevelsForMask(
    pattern, mask, offsetPx, tileSize, bandSteps, hardEdgeB, edgeSeed, outlineWidth
  );
  const solid = ramp.length - 1;

  // Texture shades are a handful of colours, not a per-pixel computation.
  const fitRamp = (r: readonly (RGB | undefined)[] | undefined, n: number) =>
    r && r.length === n + 1 ? r : undefined;
  const shadesA = Math.max(1, texture.shadesA);
  const shadesB = Math.max(1, texture.shadesB);
  const texA = texture.algoA !== 'none' && texture.amountA > 0
    ? textureRamp(colours.terrainA, texture.colourA, shadesA, fitRamp(texture.rampA, shadesA))
    : null;
  const texB = texture.algoB !== 'none' && texture.amountB > 0
    ? textureRamp(colours.terrainB, texture.colourB, shadesB, fitRamp(texture.rampB, shadesB))
    : null;

  // The outline is one level, whatever the step count — extra steps are added
  // on the terrain-A side, so its index is found rather than assumed.
  const edgeLevel = levelDefs.findIndex((l) => l.role === 'edge');
  const ribShades = Math.max(1, ribbon.shades);
  const ribbonOn = ribbon.algo !== 'none' && ribbon.amount > 0 && mask >= 0;
  const ribRamp = ribbonOn
    ? textureRamp(ramp[edgeLevel], ribbon.colour, ribShades, fitRamp(ribbon.ramp, ribShades))
    : null;
  const coords = ribbonOn
    ? patternBandCoords(
        pattern, mask, offsetPx, tileSize, bandSteps, hardEdgeB, edgeSeed, outlineWidth
      )
    : null;
  const ribWidth = ribbonOn
    ? Math.max(1, outlineWidthPx(pattern, bandSteps, hardEdgeB, outlineWidth, tileSize))
    : 1;

  // Grain displacement scales with the band so it keeps reading as the band
  // widens; at the default step count this is 1 and nothing changes.
  const span = bandNoiseSpan(pattern, bandSteps);

  // Backed by a plain ArrayBuffer (not ArrayBufferLike) so the result can be
  // handed straight to `new ImageData(...)`.
  const out = new Uint8ClampedArray(new ArrayBuffer(tileSize * tileSize * 4));
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const p = y * tileSize + x;
      const level = grid.charCodeAt(p) - 48;
      let rgb = ramp[level];
      // Grain lives on the transition band only, and is sampled in OUTPUT
      // space so it gets finer along with the art instead of blocking up.
      let grained = false;
      if (level > 0 && level < solid && noises.length > 0) {
        const step = noiseStep(noises, x, y, noiseSeed, noiseStrength) * span;

        if (step !== 0) {
          const nextLvl = Math.max(0, Math.min(solid, level + step));
          const fromRole = levelDefs[level]?.role;
          const nextRole = levelDefs[nextLvl]?.role;

          // The band is partitioned into three zones — the outline, the
          // terrain-A side and the terrain-B side — and a displacement touches
          // TWO of them, so both ends are checked. Either one alone leaks, and
          // both leaks are visible on the outline:
          //
          //   source only      a B-side pixel is promoted INTO the outline
          //                    level, scattering outline-coloured specks along
          //                    the band;
          //   destination only an outline pixel is demoted to the B side,
          //                    punching terrain-coloured holes in the outline.
          //
          // The guard is deliberately asymmetric rather than "both roles must
          // be targeted": moving OUT of a targeted zone is always allowed, so
          // that targeting the outline alone still dissolves it outward instead
          // of becoming a checkbox that does nothing. Only moving INTO the
          // outline is gated, because the outline is the one zone whose job is
          // to stay a readable line.
          const keepNoise =
            Boolean(fromRole && noiseTargets.includes(fromRole)) &&
            (nextRole !== 'edge' || noiseTargets.includes('edge'));

          if (keepNoise) {
            grained = true;
            if (nextRole === 'edge' && noiseColours?.edge) {
              rgb = noiseColours.edge;
            } else if (step < 0 && noiseColours?.b) {
              rgb = noiseColours.b;
            } else if (step > 0 && noiseColours?.a) {
              rgb = noiseColours.a;
            } else {
              rgb = ramp[nextLvl];
            }
          }
        }
      }
      // A grained pixel has already left the outline, so the motif does not get
      // to paint over it — the grain is what is eating the line, and a motif
      // drawn on top would fill the holes back in.
      if (!grained && ribRamp && coords && level === edgeLevel) {
        const k = ribbonShadeAt(
          ribbon.algo, coords.s[p], coords.depth[p], ribWidth,
          ribbon.seed, ribbon.amount, ribShades, ribbon.period, ribbon.invert
        );
        if (k > 0) rgb = ribRamp[k];
      } else if (texA && level === solid) {
        const k = textureShadeAt(
          texture.algoA, x, y, texture.seedA, texture.amountA, shadesA,
          texture.cellScaleA ?? DEFAULT_CELL_SCALE, texture.rippleScaleA ?? DEFAULT_RIPPLE_SCALE,
          texture.geoScaleA ?? DEFAULT_GEO_SCALE
        );
        if (k > 0) rgb = texA[k];
      } else if (texB && level === 0) {
        const k = textureShadeAt(
          texture.algoB, x, y, texture.seedB, texture.amountB, shadesB,
          texture.cellScaleB ?? DEFAULT_CELL_SCALE, texture.rippleScaleB ?? DEFAULT_RIPPLE_SCALE,
          texture.geoScaleB ?? DEFAULT_GEO_SCALE
        );
        if (k > 0) rgb = texB[k];
      }
      const { r, g, b } = rgb;
      const i = p * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
