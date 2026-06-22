import type { LiteObject, TerrainMatrix } from "./model";
import { mulberry32 } from "./pack/rng";

export interface TerrainNoiseConfig {
  seed: number;
  scale: number;
  range: [number, number];
}

const DEFAULT_CONFIG: TerrainNoiseConfig = {
  seed: 1337,
  scale: 6.5,
  range: [0.5, 1.0],
};

export const DEFAULT_MORPH_NOISE_CONFIG: TerrainNoiseConfig = {
  seed: 1337,
  scale: 1.7,
  range: [0.0, 1.0],
};

export const DEFAULT_FRG_NOISE_CONFIG: TerrainNoiseConfig = {
  seed: 1337,
  scale: 7.5,
  range: [0.0, 1.0],
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function scaleRange(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  if (v < 0.5) {
    const t = Math.sqrt(v / 0.5);
    return t / 2;
  }
  const t = (v - 0.5) / 0.5;
  return 0.5 + (t * t) / 2;
}

function realScale(scale: number): number {
  if (scale >= 3) {
    if (scale >= 5) {
      const t = (scale - 5) * 3;
      return 5 + t * t * t;
    }
    const t = scale - 3;
    return 1 + t * t;
  }
  const t = scale / 3;
  return t * t;
}

const FNL_FREQUENCY = 0.01;
const PRIME_X = 501125321;
const PRIME_Y = 1136930381;
const GRADIENTS_2D = new Float32Array([
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.38268343236509, 0.923879532511287, 0.923879532511287, 0.38268343236509, 0.923879532511287, -0.38268343236509, 0.38268343236509, -0.923879532511287,
  -0.38268343236509, -0.923879532511287, -0.923879532511287, -0.38268343236509, -0.923879532511287, 0.38268343236509, -0.38268343236509, 0.923879532511287,
]);

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2(seed: number, xPrimed: number, yPrimed: number): number {
  let hash = (seed ^ xPrimed ^ yPrimed) | 0;
  hash = Math.imul(hash, 0x27d4eb2d) | 0;
  return hash;
}

function gradCoord2(seed: number, xPrimed: number, yPrimed: number, xd: number, yd: number): number {
  let hash = hash2(seed, xPrimed, yPrimed);
  hash ^= hash >> 15;
  hash &= 127 << 1;
  const xg = GRADIENTS_2D[hash];
  const yg = GRADIENTS_2D[hash | 1];
  return xd * xg + yd * yg;
}

function fastNoiseLitePerlin2(seed: number, x: number, y: number): number {
  x *= FNL_FREQUENCY;
  y *= FNL_FREQUENCY;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);

  const xd0 = x - x0;
  const yd0 = y - y0;
  const xd1 = xd0 - 1;
  const yd1 = yd0 - 1;

  const xs = fade(xd0);
  const ys = fade(yd0);

  const x0p = Math.imul(x0, PRIME_X);
  const y0p = Math.imul(y0, PRIME_Y);
  const x1p = (x0p + PRIME_X) | 0;
  const y1p = (y0p + PRIME_Y) | 0;

  const xf0 = lerp(gradCoord2(seed, x0p, y0p, xd0, yd0), gradCoord2(seed, x1p, y0p, xd1, yd0), xs);
  const xf1 = lerp(gradCoord2(seed, x0p, y1p, xd0, yd1), gradCoord2(seed, x1p, y1p, xd1, yd1), xs);
  return lerp(xf0, xf1, ys) * 1.4247691104677813;
}

export function sampleNoiseValue(col: number, row: number, cfg: TerrainNoiseConfig): number {
  const value = (fastNoiseLitePerlin2(cfg.seed, 10000 + col * realScale(cfg.scale), 10000 + row * realScale(cfg.scale)) + 1) * 0.5;
  return clamp(value, 0, 1);
}

function inRange(value: number, range: [number, number]): boolean {
  const lo = scaleRange(clamp(range[0], 0, 1));
  const hi = scaleRange(clamp(range[1], 0, 1));
  return value >= lo && value <= hi;
}

function tagKeys(prefix: string): [string, string, string, string] {
  return [`${prefix}.seed`, `${prefix}.scale`, `${prefix}.min`, `${prefix}.max`];
}

export function noiseConfigFromTags(tags: Record<string, string>, prefix: string, fallback: TerrainNoiseConfig): TerrainNoiseConfig {
  const [tagSeed, tagScale, tagMin, tagMax] = tagKeys(prefix);
  const seed = Number.parseInt(tags[tagSeed] ?? "", 10);
  const scale = Number.parseFloat(tags[tagScale] ?? "");
  const min = Number.parseFloat(tags[tagMin] ?? "");
  const max = Number.parseFloat(tags[tagMax] ?? "");
  return {
    seed: Number.isFinite(seed) ? seed : fallback.seed,
    scale: Number.isFinite(scale) ? scale : fallback.scale,
    range: [
      Number.isFinite(min) ? clamp(min, 0, 1) : fallback.range[0],
      Number.isFinite(max) ? clamp(max, 0, 1) : fallback.range[1],
    ],
  };
}

export function applyNoiseConfig(tags: Record<string, string>, prefix: string, cfg: TerrainNoiseConfig): Record<string, string> {
  const [tagSeed, tagScale, tagMin, tagMax] = tagKeys(prefix);
  return {
    ...tags,
    [tagSeed]: String(Math.max(0, Math.round(cfg.seed))),
    [tagScale]: String(cfg.scale),
    [tagMin]: String(clamp(cfg.range[0], 0, 1)),
    [tagMax]: String(clamp(cfg.range[1], 0, 1)),
  };
}

export function noiseAllowsCell(col: number, row: number, cfg: TerrainNoiseConfig): boolean {
  return inRange(sampleNoiseValue(col, row, cfg), cfg.range);
}

export function terrainNoiseConfigFromObject(o: LiteObject): TerrainNoiseConfig {
  return noiseConfigFromTags(o.tags, "web.rand", DEFAULT_CONFIG);
}

export function applyTerrainNoiseConfig(tags: Record<string, string>, cfg: TerrainNoiseConfig): Record<string, string> {
  return applyNoiseConfig(tags, "web.rand", cfg);
}

export function randomizeTerrainNoiseSeed(cfg: TerrainNoiseConfig): TerrainNoiseConfig {
  const rng = mulberry32((cfg.seed >>> 0) ^ 0x9e3779b9);
  return { ...cfg, seed: Math.floor(rng() * 100000) };
}

export const randomizeNoiseSeed = randomizeTerrainNoiseSeed;

export function frgNoiseConfigFromObject(o: LiteObject): TerrainNoiseConfig {
  return noiseConfigFromTags(o.tags, "web.frg", DEFAULT_FRG_NOISE_CONFIG);
}

export function regenerateTerrainByNoise(terrain: TerrainMatrix, cfg: TerrainNoiseConfig): TerrainMatrix {
  const next: TerrainMatrix = {
    ox: terrain.ox,
    oy: terrain.oy,
    w: terrain.w,
    h: terrain.h,
    data: new Int16Array(terrain.w * terrain.h).fill(-1),
  };
  const halfW = Math.floor(terrain.w / 2);
  const halfH = Math.floor(terrain.h / 2);
  for (let row = 0; row < terrain.h; row++) {
    for (let col = 0; col < terrain.w; col++) {
      const value = sampleNoiseValue(col - halfW, row - halfH, cfg);
      next.data[row * terrain.w + col] = inRange(value, cfg.range) ? 0 : -1;
    }
  }
  return next;
}
