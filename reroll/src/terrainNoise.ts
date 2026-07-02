import type { LiteObject, TerrainMatrix } from "./model";
import { mulberry32 } from "./pack/rng";
import { perlin2 } from "@lib/noise";

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

function tagKeys(prefix: string): [string, string, string, string] {
  return [`${prefix}.seed`, `${prefix}.scale`, `${prefix}.min`, `${prefix}.max`];
}

export function sampleNoiseValue(col: number, row: number, cfg: TerrainNoiseConfig): number {
  const value = (perlin2(cfg.seed, 10000 + col * realScale(cfg.scale), 10000 + row * realScale(cfg.scale)) + 1) * 0.5;
  return clamp(value, 0, 1);
}

function inRange(value: number, range: [number, number]): boolean {
  const lo = scaleRange(clamp(range[0], 0, 1));
  const hi = scaleRange(clamp(range[1], 0, 1));
  return value >= lo && value <= hi;
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
