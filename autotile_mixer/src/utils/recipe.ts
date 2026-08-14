import { type PatternId } from './blob47Pattern';
import { type NoiseId } from './patternNoise';
import { type RibbonId } from './patternRibbon';
import {
  DEFAULT_CELL_SCALE, MIN_CELL_SCALE, MAX_CELL_SCALE,
  DEFAULT_RIPPLE_SCALE, MIN_RIPPLE_SCALE, MAX_RIPPLE_SCALE,
  DEFAULT_GEO_SCALE, type TextureId
} from './patternTexture';

export interface Recipe {
  roleHex: {
    terrainA: string;
    terrainB: string;
    edge: string;
  };
  patternId: PatternId;
  edgeSeed: number;
  outlineWidth: number;
  bandSteps: number;
  hardEdgeB: boolean;
  transparentB: boolean;
  bandBias: number;
  customShadesHex: string[] | null;

  patternNoise: NoiseId[];
  patternNoiseSeed: number;
  patternNoiseStrength: number;

  ribbonAlgo: RibbonId;
  ribbonAmount: number;
  ribbonPeriod: number;
  ribbonShades: number;
  ribbonInvert: boolean;
  customRibbonHex: (string | undefined)[] | null;

  textureAlgoA: TextureId;
  textureAlgoB: TextureId;
  textureAmountA: number;
  textureAmountB: number;
  textureShadesA: number;
  textureShadesB: number;
  textureSeedA: number;
  textureSeedB: number;
  cellScaleA: number;
  cellScaleB: number;
  rippleScaleA: number;
  rippleScaleB: number;
  geoScaleA: number;
  geoScaleB: number;
  customTexHex: {
    terrainA: (string | undefined)[] | null;
    terrainB: (string | undefined)[] | null;
  };
}

export interface PresetItem {
  id: string;
  name: string;
  recipe: Recipe;
  savedAt?: string;
  isBuiltin?: boolean;
}

export const DEFAULT_RECIPE: Recipe = {
  roleHex: {
    terrainA: '#3a7fc9',
    terrainB: '#5da832',
    edge: '#e8d5a0',
  },
  patternId: 'rounded',
  edgeSeed: 0,
  outlineWidth: 2,
  bandSteps: 4,
  hardEdgeB: false,
  transparentB: false,
  bandBias: 0,
  customShadesHex: null,

  patternNoise: [],
  patternNoiseSeed: 1234,
  patternNoiseStrength: 0.15,

  ribbonAlgo: 'none',
  ribbonAmount: 0.25,
  ribbonPeriod: 4,
  ribbonShades: 2,
  ribbonInvert: false,
  customRibbonHex: null,

  textureAlgoA: 'none',
  textureAlgoB: 'none',
  textureAmountA: 0.35,
  textureAmountB: 0.35,
  textureShadesA: 2,
  textureShadesB: 2,
  textureSeedA: 1,
  textureSeedB: 1,
  cellScaleA: DEFAULT_CELL_SCALE,
  cellScaleB: DEFAULT_CELL_SCALE,
  rippleScaleA: DEFAULT_RIPPLE_SCALE,
  rippleScaleB: DEFAULT_RIPPLE_SCALE,
  geoScaleA: DEFAULT_GEO_SCALE,
  geoScaleB: DEFAULT_GEO_SCALE,
  customTexHex: {
    terrainA: null,
    terrainB: null,
  },
};

export const BUILTIN_PRESETS: PresetItem[] = [
  {
    id: 'builtin_waterfront',
    name: '水岸（默认）',
    isBuiltin: true,
    recipe: DEFAULT_RECIPE,
  },
];

const VALID_PATTERNS: Set<PatternId> = new Set<PatternId>([
  'square', 'sharp', 'rounded', 'wave', 'jagged', 'gravel',
  'boulder', 'thorn', 'coast', 'moss', 'billow',
]);

const VALID_NOISES: Set<NoiseId> = new Set<NoiseId>(['white', 'blue', 'ordered']);
const VALID_RIBBONS: Set<RibbonId> = new Set<RibbonId>([
  'none', 'bevel', 'dashes', 'ticks', 'beads', 'rope', 'wave', 'grain', 'speckle',
  'along_brick_wall', 'along_cobbles2', 'along_weave', 'along_stone_floor',
  'along_breeze_block', 'along_octagonal',
]);
const VALID_TEXTURES: Set<TextureId> = new Set<TextureId>([
  'none', 'white', 'blue', 'ordered', 'ripple', 'ripple_diag', 'cells',
  'breeze_block', 'brick_wall', 'cobbles2', 'brick_floor', 'hexagon',
  'isometric', 'isometric_grid', 'octagonal', 'square', 'weave',
  'paving', 'paving3', 'paving5', 'stone_floor', 'water', 'brick_bond',
  'field', 'rubble', 'nonslip',
]);

function isHexColor(str: unknown): str is string {
  return typeof str === 'string' && /^#[0-9a-fA-F]{6}$/.test(str);
}

function clamp(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || isNaN(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || isNaN(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function sanitizeRecipe(raw: unknown): Recipe {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RECIPE };
  const obj = raw as Record<string, unknown>;

  const roleHexRaw = (obj.roleHex && typeof obj.roleHex === 'object') ? (obj.roleHex as Record<string, unknown>) : {};
  const terrainA = isHexColor(roleHexRaw.terrainA) ? roleHexRaw.terrainA : DEFAULT_RECIPE.roleHex.terrainA;
  const terrainB = isHexColor(roleHexRaw.terrainB) ? roleHexRaw.terrainB : DEFAULT_RECIPE.roleHex.terrainB;
  const edge = isHexColor(roleHexRaw.edge) ? roleHexRaw.edge : DEFAULT_RECIPE.roleHex.edge;

  const patternId = (typeof obj.patternId === 'string' && VALID_PATTERNS.has(obj.patternId as PatternId))
    ? (obj.patternId as PatternId)
    : DEFAULT_RECIPE.patternId;

  const edgeSeed = clampInt(obj.edgeSeed, 0, 99999, DEFAULT_RECIPE.edgeSeed);
  const outlineWidth = clampInt(obj.outlineWidth, 1, 4, DEFAULT_RECIPE.outlineWidth);
  const bandSteps = clampInt(obj.bandSteps, 3, 5, DEFAULT_RECIPE.bandSteps);
  const hardEdgeB = typeof obj.hardEdgeB === 'boolean' ? obj.hardEdgeB : DEFAULT_RECIPE.hardEdgeB;
  const transparentB = typeof obj.transparentB === 'boolean' ? obj.transparentB : DEFAULT_RECIPE.transparentB;
  const bandBias = clamp(obj.bandBias, -1, 1, DEFAULT_RECIPE.bandBias);

  let customShadesHex: string[] | null = null;
  if (Array.isArray(obj.customShadesHex) && obj.customShadesHex.length === bandSteps + 2) {
    customShadesHex = obj.customShadesHex.map((hex) => (isHexColor(hex) ? hex : ''));
    if (customShadesHex.some((h) => !h)) customShadesHex = null;
  }

  let patternNoise: NoiseId[] = DEFAULT_RECIPE.patternNoise;
  if (Array.isArray(obj.patternNoise)) {
    patternNoise = obj.patternNoise.filter((n): n is NoiseId => typeof n === 'string' && VALID_NOISES.has(n as NoiseId));
  }
  const patternNoiseSeed = clampInt(obj.patternNoiseSeed, 0, 99999, DEFAULT_RECIPE.patternNoiseSeed);
  const patternNoiseStrength = clamp(obj.patternNoiseStrength, 0, 2, DEFAULT_RECIPE.patternNoiseStrength);

  const ribbonAlgo = (typeof obj.ribbonAlgo === 'string' && VALID_RIBBONS.has(obj.ribbonAlgo as RibbonId))
    ? (obj.ribbonAlgo as RibbonId)
    : DEFAULT_RECIPE.ribbonAlgo;
  const ribbonAmount = clamp(obj.ribbonAmount, 0, 1, DEFAULT_RECIPE.ribbonAmount);
  const ribbonPeriod = clampInt(obj.ribbonPeriod, 1, 8, DEFAULT_RECIPE.ribbonPeriod);
  const ribbonShades = clampInt(obj.ribbonShades, 1, 4, DEFAULT_RECIPE.ribbonShades);
  const ribbonInvert = typeof obj.ribbonInvert === 'boolean' ? obj.ribbonInvert : DEFAULT_RECIPE.ribbonInvert;

  let customRibbonHex: (string | undefined)[] | null = null;
  if (Array.isArray(obj.customRibbonHex) && obj.customRibbonHex.length === ribbonShades + 1) {
    customRibbonHex = obj.customRibbonHex.map((h) => (isHexColor(h) ? h : undefined));
  }

  const textureAlgoA = (typeof obj.textureAlgoA === 'string' && VALID_TEXTURES.has(obj.textureAlgoA as TextureId))
    ? (obj.textureAlgoA as TextureId)
    : DEFAULT_RECIPE.textureAlgoA;
  const textureAlgoB = (typeof obj.textureAlgoB === 'string' && VALID_TEXTURES.has(obj.textureAlgoB as TextureId))
    ? (obj.textureAlgoB as TextureId)
    : DEFAULT_RECIPE.textureAlgoB;

  const textureAmountA = clamp(obj.textureAmountA, 0, 1, DEFAULT_RECIPE.textureAmountA);
  const textureAmountB = clamp(obj.textureAmountB, 0, 1, DEFAULT_RECIPE.textureAmountB);
  const textureShadesA = clampInt(obj.textureShadesA, 1, 4, DEFAULT_RECIPE.textureShadesA);
  const textureShadesB = clampInt(obj.textureShadesB, 1, 4, DEFAULT_RECIPE.textureShadesB);
  const textureSeedA = clampInt(obj.textureSeedA, 0, 99999, DEFAULT_RECIPE.textureSeedA);
  const textureSeedB = clampInt(obj.textureSeedB, 0, 99999, DEFAULT_RECIPE.textureSeedB);

  const cellScaleA = clampInt(obj.cellScaleA, MIN_CELL_SCALE, MAX_CELL_SCALE, DEFAULT_RECIPE.cellScaleA);
  const cellScaleB = clampInt(obj.cellScaleB, MIN_CELL_SCALE, MAX_CELL_SCALE, DEFAULT_RECIPE.cellScaleB);
  const rippleScaleA = clampInt(obj.rippleScaleA, MIN_RIPPLE_SCALE, MAX_RIPPLE_SCALE, DEFAULT_RECIPE.rippleScaleA);
  const rippleScaleB = clampInt(obj.rippleScaleB, MIN_RIPPLE_SCALE, MAX_RIPPLE_SCALE, DEFAULT_RECIPE.rippleScaleB);
  const geoScaleA = clampInt(obj.geoScaleA, 1, 8, DEFAULT_RECIPE.geoScaleA);
  const geoScaleB = clampInt(obj.geoScaleB, 1, 8, DEFAULT_RECIPE.geoScaleB);

  const customTexRaw = (obj.customTexHex && typeof obj.customTexHex === 'object')
    ? (obj.customTexHex as Record<string, unknown>)
    : {};
  let customTexA: (string | undefined)[] | null = null;
  if (Array.isArray(customTexRaw.terrainA) && customTexRaw.terrainA.length === textureShadesA + 1) {
    customTexA = customTexRaw.terrainA.map((h) => (isHexColor(h) ? h : undefined));
  }
  let customTexB: (string | undefined)[] | null = null;
  if (Array.isArray(customTexRaw.terrainB) && customTexRaw.terrainB.length === textureShadesB + 1) {
    customTexB = customTexRaw.terrainB.map((h) => (isHexColor(h) ? h : undefined));
  }

  return {
    roleHex: { terrainA, terrainB, edge },
    patternId,
    edgeSeed,
    outlineWidth,
    bandSteps,
    hardEdgeB,
    transparentB,
    bandBias,
    customShadesHex,

    patternNoise,
    patternNoiseSeed,
    patternNoiseStrength,

    ribbonAlgo,
    ribbonAmount,
    ribbonPeriod,
    ribbonShades,
    ribbonInvert,
    customRibbonHex,

    textureAlgoA,
    textureAlgoB,
    textureAmountA,
    textureAmountB,
    textureShadesA,
    textureShadesB,
    textureSeedA,
    textureSeedB,
    cellScaleA,
    cellScaleB,
    rippleScaleA,
    rippleScaleB,
    geoScaleA,
    geoScaleB,
    customTexHex: {
      terrainA: customTexA,
      terrainB: customTexB,
    },
  };
}
