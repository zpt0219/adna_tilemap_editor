// corpusCases.ts — what the parity corpus covers, and why.
//
// Every case here becomes one ground-truth PNG the desktop C++ port is checked
// against. Two rules the tiers are built on:
//
//   1. Enumerate from the app's own option lists (TEXTURE_GROUPS, RIBBON_GROUPS,
//      PATTERN_GROUPS), never from a hand-copied list. Adding a texture to the
//      app therefore adds it to the corpus, instead of silently leaving the new
//      one untested — which is exactly how a hand-copied list rots.
//   2. Vary a knob only where the app lets you vary it. textureUsesAmount /
//      geoScalesFor / ribbonUsesPeriod decide that, so a paving does not get 40
//      cases differing by a slider it ignores.
//
// The base palette is written out literally rather than taken from
// DEFAULT_RECIPE: the UI default is allowed to move, and the corpus must not
// move with it or every hash churns for a cosmetic change.

import { PATTERN_GROUPS, type PatternId } from '../src/utils/blob47Pattern';
import { type NoiseId, type NoiseTargetId } from '../src/utils/patternNoise';
import {
  RIBBON_GROUPS, ribbonUsesInvert, ribbonUsesPeriod, type RibbonId,
} from '../src/utils/patternRibbon';
import {
  TEXTURE_GROUPS, geoScalesFor, naturalGeoScale, naturalTextureAmount,
  textureUsesAmount, textureUsesGeoScale, type TextureId,
} from '../src/utils/patternTexture';
import { sanitizeRecipe, type Recipe } from '../src/utils/recipe';
import { type PaintOverrides } from '../src/utils/renderSheet';

export type Tier = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface CorpusCase {
  id: string;
  tier: Tier;
  /** Why this case exists — copied into the manifest so a failure explains itself. */
  note: string;
  recipe: Recipe;
  overrides?: PaintOverrides;
}

export const PATTERNS: readonly PatternId[] = PATTERN_GROUPS.flatMap((g) => g.items.map((i) => i.id));
export const RIBBONS: readonly RibbonId[] = RIBBON_GROUPS.flatMap((g) => g.items.map((i) => i.id));
export const TEXTURES: readonly TextureId[] = TEXTURE_GROUPS.flatMap((g) => g.items.map((i) => i.id));

/** Water on grass with a sand shore — a coloured base, so the normal (non-grey)
 *  shade path is what most of the corpus exercises. The achromatic branch and
 *  the saturated-terrain collapse get their own cases in L5. */
const BASE = sanitizeRecipe({
  roleHex: { terrainA: '#3a7fc9', terrainB: '#5da832', edge: '#e8d5a0' },
  patternId: 'rounded',
  bandSteps: 4,
  outlineWidth: 2,
  patternNoiseSeed: 1234,
  patternNoiseStrength: 0.15,
});

type Patch = Partial<Omit<Recipe, 'roleHex' | 'customTexHex'>> & {
  roleHex?: Partial<Recipe['roleHex']>;
  customTexHex?: Partial<Recipe['customTexHex']>;
};

function mk(tier: Tier, id: string, note: string, patch: Patch, overrides?: PaintOverrides): CorpusCase {
  const recipe = sanitizeRecipe({
    ...BASE,
    ...patch,
    roleHex: { ...BASE.roleHex, ...(patch.roleHex ?? {}) },
    customTexHex: { ...BASE.customTexHex, ...(patch.customTexHex ?? {}) },
  });
  return { id: `${tier}_${id}`, tier, note, recipe, overrides };
}

// --- L0: smoke ------------------------------------------------------------

function tierL0(): CorpusCase[] {
  return [mk('L0', 'base', 'The corpus base recipe, untouched.', {})];
}

// --- L1: silhouette geometry ----------------------------------------------
// The band's shape is what patternLevelsForMask decides, so this tier is the
// one that must go green before any colour work is believable.

function tierL1(): CorpusCase[] {
  const out: CorpusCase[] = [];
  for (const patternId of PATTERNS) {
    for (const bandSteps of [3, 4, 5]) {
      for (const outlineWidth of [1, 2, 3, 4]) {
        out.push(mk('L1', `${patternId}_steps${bandSteps}_outline${outlineWidth}`,
          `${patternId} at ${bandSteps} band steps, ${outlineWidth}px outline.`,
          { patternId, bandSteps, outlineWidth }));
      }
    }
    // Band position. The endpoints are where the offset clamps live, and each
    // pattern has its own travel (PATTERN_OFFSET_RANGE), so -1/+1 land on
    // different pixel offsets per pattern.
    for (const bandBias of [-1, -0.5, 0.5, 1]) {
      out.push(mk('L1', `${patternId}_bias${String(bandBias).replace('.', 'p').replace('-', 'm')}`,
        `${patternId} with the band pushed to ${bandBias} of its range.`,
        { patternId, bandBias }));
    }
    // hardEdgeB collapses the terrain-B shade and pulls the rest out by the
    // freed width — a different level table, not just a recolour.
    for (const bandSteps of [3, 5]) {
      out.push(mk('L1', `${patternId}_hardB_steps${bandSteps}`,
        `${patternId}, terrain B meeting the outline hard at ${bandSteps} steps.`,
        { patternId, bandSteps, hardEdgeB: true }));
    }
    out.push(mk('L1', `${patternId}_seed7`,
      `${patternId} re-rolled; a no-op for the patterns that are not reseedable.`,
      { patternId, edgeSeed: 7 }));
  }
  return out;
}

// --- L2: textures ---------------------------------------------------------
// The point of the whole corpus. Each texture is exercised on BOTH terrains,
// because patternPaint dispatches them through separate branches (texA on the
// solid level, texB on level 0) and texB is not even built when terrain B is
// transparent.

function textureCases(tex: TextureId, side: 'A' | 'B'): CorpusCase[] {
  if (tex === 'none') return [];
  const out: CorpusCase[] = [];
  const amount = naturalTextureAmount(tex);
  const geo = naturalGeoScale(tex);

  // Only one terrain carries a texture per case, so a difference is
  // attributable to one algorithm rather than to whichever of two it was.
  const base: Patch = side === 'A'
    ? { textureAlgoA: tex, textureAmountA: amount, textureShadesA: 4, geoScaleA: geo, textureAlgoB: 'none' }
    : { textureAlgoB: tex, textureAmountB: amount, textureShadesB: 4, geoScaleB: geo, textureAlgoA: 'none' };
  const put = (k: string, v: number) => (side === 'A' ? { [`${k}A`]: v } : { [`${k}B`]: v }) as Patch;
  const tag = `${tex}_${side}`;

  out.push(mk('L2', `${tag}_shades4`, `${tex} on terrain ${side} at its natural settings.`, base));
  for (const shades of [1, 2]) {
    out.push(mk('L2', `${tag}_shades${shades}`, `${tex} on terrain ${side} quantised to ${shades} shade(s).`,
      { ...base, ...put('textureShades', shades) }));
  }
  out.push(mk('L2', `${tag}_seed4242`, `${tex} on terrain ${side} with a different seed.`,
    { ...base, ...put('textureSeed', 4242) }));

  if (textureUsesAmount(tex)) {
    for (const a of [1, 0.15]) {
      out.push(mk('L2', `${tag}_amount${String(a).replace('.', 'p')}`,
        `${tex} on terrain ${side} at strength ${a}.`, { ...base, ...put('textureAmount', a) }));
    }
  }
  if (textureUsesGeoScale(tex)) {
    for (const g of geoScalesFor(tex)) {
      if (g.id === geo) continue;
      out.push(mk('L2', `${tag}_geo${g.id}`, `${tex} on terrain ${side} at motif size ${g.id}.`,
        { ...base, ...put('geoScale', g.id) }));
    }
  }
  if (tex === 'cells') {
    for (const c of [2, 6]) {
      out.push(mk('L2', `${tag}_cell${c}`, `${tex} on terrain ${side} at cell size ${c}.`,
        { ...base, ...put('cellScale', c) }));
    }
  }
  if (tex === 'ripple' || tex === 'ripple_diag') {
    for (const r of [2, 8]) {
      out.push(mk('L2', `${tag}_ripple${r}`, `${tex} on terrain ${side} at period ${r}.`,
        { ...base, ...put('rippleScale', r) }));
    }
  }
  return out;
}

function tierL2(): CorpusCase[] {
  const out: CorpusCase[] = [];
  for (const tex of TEXTURES) {
    out.push(...textureCases(tex, 'A'));
    out.push(...textureCases(tex, 'B'));
  }
  // Both terrains textured at once, and the transparent-B case where the B
  // texture must go inert rather than paint under a hole.
  const pairs: [TextureId, TextureId][] = [
    ['cells', 'brick_wall'], ['water', 'paving'], ['white', 'hexagon'],
    ['rubble', 'weave'], ['nonslip', 'octagonal'], ['ripple', 'stone_floor'],
  ];
  for (const [a, b] of pairs) {
    out.push(mk('L2', `pair_${a}_over_${b}`, `${a} on terrain A over ${b} on terrain B.`,
      { textureAlgoA: a, textureAlgoB: b, textureAmountA: naturalTextureAmount(a), textureAmountB: naturalTextureAmount(b),
        geoScaleA: naturalGeoScale(a), geoScaleB: naturalGeoScale(b) }));
    out.push(mk('L2', `pair_${a}_over_${b}_transparentB`,
      `${a} on terrain A with terrain B transparent — the B texture must not be built at all.`,
      { textureAlgoA: a, textureAlgoB: b, textureAmountA: naturalTextureAmount(a), textureAmountB: naturalTextureAmount(b),
        geoScaleA: naturalGeoScale(a), geoScaleB: naturalGeoScale(b), transparentB: true }));
  }
  return out;
}

// --- L3: ribbon motifs ----------------------------------------------------

function tierL3(): CorpusCase[] {
  const out: CorpusCase[] = [];
  for (const ribbonAlgo of RIBBONS) {
    if (ribbonAlgo === 'none') continue;
    // A wide outline so motifs with a minimum width actually have a canvas;
    // the narrow case is covered separately below.
    const base: Patch = { ribbonAlgo, outlineWidth: 4, ribbonAmount: 0.5, ribbonShades: 2 };
    out.push(mk('L3', `${ribbonAlgo}_base`, `${ribbonAlgo} on a 4px outline.`, base));
    for (const ribbonShades of [1, 4]) {
      out.push(mk('L3', `${ribbonAlgo}_shades${ribbonShades}`, `${ribbonAlgo} at ${ribbonShades} shade(s).`,
        { ...base, ribbonShades }));
    }
    for (const ribbonAmount of [1, 0.15]) {
      out.push(mk('L3', `${ribbonAlgo}_amount${String(ribbonAmount).replace('.', 'p')}`,
        `${ribbonAlgo} at coverage ${ribbonAmount}.`, { ...base, ribbonAmount }));
    }
    if (ribbonUsesPeriod(ribbonAlgo)) {
      for (const ribbonPeriod of [1, 8]) {
        out.push(mk('L3', `${ribbonAlgo}_period${ribbonPeriod}`, `${ribbonAlgo} at period ${ribbonPeriod}.`,
          { ...base, ribbonPeriod }));
      }
    }
    if (ribbonUsesInvert(ribbonAlgo)) {
      out.push(mk('L3', `${ribbonAlgo}_invert`, `${ribbonAlgo} inverted.`, { ...base, ribbonInvert: true }));
    }
    // A 1px outline is below several motifs' minimum width — the app warns and
    // paints anyway, so the port has to agree about what "anyway" looks like.
    out.push(mk('L3', `${ribbonAlgo}_narrow`, `${ribbonAlgo} squeezed onto a 1px outline.`,
      { ...base, outlineWidth: 1 }));
  }
  return out;
}

// --- L4: band grain -------------------------------------------------------
// noiseTargets is not part of a Recipe, so these ride on overrides. The gate it
// drives took three wrong versions to settle and leaving it uncovered is not an
// option — see the level-gate comment in patternPaint.

const NOISE_COMBOS: readonly NoiseId[][] = [
  ['white'], ['blue'], ['ordered'],
  ['white', 'blue'], ['white', 'ordered'], ['blue', 'ordered'],
  ['white', 'blue', 'ordered'],
];

const TARGET_SUBSETS: readonly NoiseTargetId[][] = [
  ['edge'], ['terrainA'], ['terrainB'],
  ['edge', 'terrainA'], ['edge', 'terrainB'], ['terrainA', 'terrainB'],
  ['edge', 'terrainA', 'terrainB'],
];

function tierL4(): CorpusCase[] {
  const out: CorpusCase[] = [];
  for (const combo of NOISE_COMBOS) {
    const tag = combo.join('+');
    for (const patternNoiseStrength of [0.15, 1, 2]) {
      out.push(mk('L4', `${tag}_strength${String(patternNoiseStrength).replace('.', 'p')}`,
        `Grain ${tag} at strength ${patternNoiseStrength}.`,
        { patternNoise: combo, patternNoiseStrength }));
    }
    out.push(mk('L4', `${tag}_seed99`, `Grain ${tag} on a different seed.`,
      { patternNoise: combo, patternNoiseSeed: 99, patternNoiseStrength: 1 }));
  }
  // Target zones, on one representative grain so the axis is isolated.
  for (const noiseTargets of TARGET_SUBSETS) {
    out.push(mk('L4', `targets_${noiseTargets.join('+')}`,
      `All three grains, but only ${noiseTargets.join('/')} may be moved out of.`,
      { patternNoise: ['white', 'blue', 'ordered'], patternNoiseStrength: 1 },
      { noiseTargets }));
  }
  // A band with no terrain-side zones at all: sharp's shade levels are
  // zero-width, so targeting either terrain is correctly a no-op.
  for (const noiseTargets of [['terrainA'], ['terrainB'], ['edge']] as NoiseTargetId[][]) {
    out.push(mk('L4', `sharp_targets_${noiseTargets.join('+')}`,
      `sharp has a band of pure outline — targeting a terrain side must do nothing.`,
      { patternId: 'sharp', patternNoise: ['blue'], patternNoiseStrength: 1 },
      { noiseTargets }));
  }
  // Picked grain colours, including the transparent-B case where the picked
  // terrain-B colour is inert.
  const noiseColours = { b: { r: 255, g: 0, b: 0 }, edge: { r: 0, g: 255, b: 0 }, a: { r: 0, g: 0, b: 255 } };
  out.push(mk('L4', 'colours_all', 'Grain with all three directions given picked colours.',
    { patternNoise: ['white', 'blue'], patternNoiseStrength: 1 }, { noiseColours }));
  out.push(mk('L4', 'colours_edge_only', 'Grain with only the outline direction picked.',
    { patternNoise: ['white'], patternNoiseStrength: 1 }, { noiseColours: { edge: noiseColours.edge } }));
  out.push(mk('L4', 'colours_transparentB', 'Picked grain colours with terrain B transparent.',
    { patternNoise: ['white', 'blue'], patternNoiseStrength: 1, transparentB: true }, { noiseColours }));
  // Grain interacting with a wider band and with a motif on the outline.
  out.push(mk('L4', 'steps5_strength2', 'Grain at 5 band steps, where the displacement span scales up.',
    { patternNoise: ['blue'], patternNoiseStrength: 2, bandSteps: 5 }));
  out.push(mk('L4', 'over_ribbon', 'Grain and a motif on the same outline — grained pixels must win.',
    { patternNoise: ['white'], patternNoiseStrength: 1, ribbonAlgo: 'beads', outlineWidth: 4 }));
  return out;
}

// --- L5: colour edges -----------------------------------------------------

function tierL5(): CorpusCase[] {
  const out: CorpusCase[] = [];

  // Achromatic bases take the recipe's hue outright (the s0 < 1e-6 branch)
  // instead of nudging their own, which is a different code path per role.
  const greys: [string, string][] = [
    ['white', '#ffffff'], ['black', '#000000'], ['mid', '#808080'],
  ];
  for (const [name, hex] of greys) {
    out.push(mk('L5', `greyA_${name}`, `Achromatic terrain A (${hex}) — takes the recipe hue outright.`,
      { roleHex: { terrainA: hex } }));
    out.push(mk('L5', `greyB_${name}`, `Achromatic terrain B (${hex}).`, { roleHex: { terrainB: hex } }));
    out.push(mk('L5', `greyEdge_${name}`, `Achromatic outline (${hex}).`, { roleHex: { edge: hex } }));
  }
  out.push(mk('L5', 'grey_all', 'Every role achromatic at once.',
    { roleHex: { terrainA: '#ffffff', terrainB: '#404040', edge: '#c0c0c0' } }));

  // A fully saturated terrain A has no headroom: the terrainA shade recipe only
  // ADDS saturation, so the band's inner steps collapse into the terrain colour.
  // Known and accepted behaviour — pinned here so the port reproduces it rather
  // than "fixing" it into a divergence.
  for (const [name, hex] of [['blue', '#0000ff'], ['red', '#ff0000'], ['green', '#00ff00']] as [string, string][]) {
    out.push(mk('L5', `saturatedA_${name}`, `Terrain A at full saturation (${hex}) — inner band steps collapse.`,
      { roleHex: { terrainA: hex }, bandSteps: 5 }));
  }

  // Hand-picked ramps. Each guard rejects an array of the wrong length, so both
  // the accepted and the rejected shape are worth pinning.
  for (const bandSteps of [3, 4, 5]) {
    const shades = Array.from({ length: bandSteps + 2 }, (_, i) =>
      `#${(0x201040 + i * 0x2a1830).toString(16).padStart(6, '0').slice(-6)}`);
    out.push(mk('L5', `customShades_steps${bandSteps}`, `Every band level overridden at ${bandSteps} steps.`,
      { bandSteps, customShadesHex: shades }));
  }
  out.push(mk('L5', 'customShades_wrongLength',
    'A ramp of the wrong length must be ignored, not applied to the wrong steps.',
    { bandSteps: 4, customShadesHex: ['#111111', '#222222'] }));

  out.push(mk('L5', 'customRibbon', 'Motif ramp overridden, with one step left derived.',
    { ribbonAlgo: 'bevel', outlineWidth: 4, ribbonShades: 3,
      customRibbonHex: ['#ff00ff', undefined, '#00ffff', '#ffff00'] }));
  out.push(mk('L5', 'customTexA', 'Terrain A texture ramp overridden.',
    { textureAlgoA: 'cells', textureShadesA: 3, textureAmountA: 0.6,
      customTexHex: { terrainA: ['#123456', '#654321', undefined, '#abcdef'] } }));
  out.push(mk('L5', 'customTexB', 'Terrain B texture ramp overridden.',
    { textureAlgoB: 'rubble', textureShadesB: 2, textureAmountB: 0.6,
      customTexHex: { terrainB: ['#0f0f0f', '#f0f0f0', '#7f7f7f'] } }));
  out.push(mk('L5', 'customTex_water', 'The water table keeps its dot colour at step 2 even when overridden.',
    { textureAlgoA: 'water', textureAmountA: 0.5,
      customTexHex: { terrainA: ['#001133', '#224466'] } }));

  // transparentB — the role goes transparent, not the level, so both of terrain
  // B's levels vanish and anything that lands there becomes a hole.
  out.push(mk('L5', 'transparentB_plain', 'Terrain B transparent, nothing else on.', { transparentB: true }));
  out.push(mk('L5', 'transparentB_hardEdge', 'Terrain B transparent with a hard edge.',
    { transparentB: true, hardEdgeB: true }));
  out.push(mk('L5', 'transparentB_ribbon', 'Terrain B transparent with a motif on the outline.',
    { transparentB: true, ribbonAlgo: 'rope', outlineWidth: 4 }));
  out.push(mk('L5', 'transparentB_steps5', 'Terrain B transparent at 5 band steps.',
    { transparentB: true, bandSteps: 5 }));

  return out;
}

// --- L6: seeded fuzz ------------------------------------------------------
// Deterministic: the same seed gives the same 500 recipes for ever, so a
// regenerated corpus diffs cleanly against the committed one.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FUZZ_SEED = 20260813;
export const FUZZ_COUNT = 500;

function tierL6(): CorpusCase[] {
  const rnd = mulberry32(FUZZ_SEED);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const hex = () => '#' + Math.floor(rnd() * 0x1000000).toString(16).padStart(6, '0');
  const quant = (lo: number, hi: number, step: number) =>
    Math.round((lo + rnd() * (hi - lo)) / step) * step;

  const out: CorpusCase[] = [];
  for (let i = 0; i < FUZZ_COUNT; i++) {
    const noises = (['white', 'blue', 'ordered'] as NoiseId[]).filter(() => rnd() < 0.35);
    const targets = (['edge', 'terrainA', 'terrainB'] as NoiseTargetId[]).filter(() => rnd() < 0.6);
    const texA = pick(TEXTURES);
    const texB = pick(TEXTURES);
    const overrides: PaintOverrides = {};
    if (targets.length > 0 && rnd() < 0.4) overrides.noiseTargets = targets;
    if (rnd() < 0.15) {
      overrides.noiseColours = {
        b: { r: int(0, 255), g: int(0, 255), b: int(0, 255) },
        edge: { r: int(0, 255), g: int(0, 255), b: int(0, 255) },
      };
    }
    out.push(mk('L6', `fuzz${String(i).padStart(3, '0')}`, 'Seeded fuzz.', {
      roleHex: { terrainA: hex(), terrainB: hex(), edge: hex() },
      patternId: pick(PATTERNS),
      edgeSeed: int(0, 99999),
      outlineWidth: int(1, 4),
      bandSteps: int(3, 5),
      hardEdgeB: rnd() < 0.25,
      transparentB: rnd() < 0.2,
      bandBias: quant(-1, 1, 0.05),
      patternNoise: noises,
      patternNoiseSeed: int(0, 99999),
      patternNoiseStrength: quant(0, 2, 0.05),
      ribbonAlgo: pick(RIBBONS),
      ribbonAmount: quant(0, 1, 0.05),
      ribbonPeriod: int(1, 8),
      ribbonShades: int(1, 4),
      ribbonInvert: rnd() < 0.5,
      textureAlgoA: texA,
      textureAlgoB: texB,
      textureAmountA: quant(0, 1, 0.05),
      textureAmountB: quant(0, 1, 0.05),
      textureShadesA: int(1, 4),
      textureShadesB: int(1, 4),
      textureSeedA: int(0, 99999),
      textureSeedB: int(0, 99999),
      cellScaleA: int(2, 6),
      cellScaleB: int(2, 6),
      rippleScaleA: int(2, 8),
      rippleScaleB: int(2, 8),
      geoScaleA: int(1, 8),
      geoScaleB: int(1, 8),
    }, Object.keys(overrides).length > 0 ? overrides : undefined));
  }
  return out;
}

export function buildCorpus(): CorpusCase[] {
  const all = [...tierL0(), ...tierL1(), ...tierL2(), ...tierL3(), ...tierL4(), ...tierL5(), ...tierL6()];
  const seen = new Set<string>();
  for (const c of all) {
    if (seen.has(c.id)) throw new Error(`duplicate corpus id: ${c.id}`);
    seen.add(c.id);
  }
  return all;
}
