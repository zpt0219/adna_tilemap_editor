import { sampleNoise2D, sampleNoise2DTileable, FNL_FREQUENCY } from '@lib/noise';
import { blobWeightAt, BLOB47_BACKGROUND } from './blob47';

export type MaskStyle = 'linear' | 'arc' | 'pixel';

export interface RenderParams {
  tileSize: number;
  smoothness: number;
  easing?: string;
  maskStyle?: MaskStyle;
  pixelSteps?: number;
  noiseStrength?: number;
  noiseScale?: number;
  noiseSeed?: number;
  /** Wrap the noise lattice to tileSize instead of fading it out at the tile
   *  edges. Required for blob47, whose boundaries sit on the border (§6.1). */
  noiseTileable?: boolean;
  /** blob47 only: transition band width in cell units (0 < r < 1). */
  blobRadius?: number;
  /** blob47 only: smooth-min k for outer corners. Defaults from maskStyle. */
  cornerRounding?: number;
}

export const EASING_FUNCTIONS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  smoothstep: (t) => t * t * (3 - 2 * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};

// ===========================================================================
// 2-Corner Wang Tiles (16 tiles)
// ===========================================================================
// Standard bit-order: NE=1, SE=2, SW=4, NW=8
export function getWangCorners(i: number): [number, number, number, number] {
  const ne = (i >> 0) & 1;
  const se = (i >> 1) & 1;
  const sw = (i >> 2) & 1;
  const nw = (i >> 3) & 1;
  return [nw, ne, se, sw];
}

// Linear: bilinear interpolation of corner values — creates straight diagonal gradients
export function calculateWangBaseWeight(
  tx: number,
  ty: number,
  corners: [number, number, number, number]
): number {
  const [nw, ne, se, sw] = corners;
  const top = nw * (1 - tx) + ne * tx;
  const bot = sw * (1 - tx) + se * tx;
  return top * (1 - ty) + bot * ty;
}

// Arc: inverse-distance-squared weighting — creates rounded/organic arc boundaries
export function calculateArcWeight(
  tx: number,
  ty: number,
  corners: [number, number, number, number]
): number {
  const [nw, ne, se, sw] = corners;
  const eps = 0.04;
  const wNW = 1 / (tx * tx + ty * ty + eps);
  const wNE = 1 / ((1 - tx) * (1 - tx) + ty * ty + eps);
  const wSE = 1 / ((1 - tx) * (1 - tx) + (1 - ty) * (1 - ty) + eps);
  const wSW = 1 / (tx * tx + (1 - ty) * (1 - ty) + eps);
  const total = wNW + wNE + wSE + wSW;
  return (nw * wNW + ne * wNE + se * wSE + sw * wSW) / total;
}

// Pixel: quantize coordinates to a coarse grid — creates stair-step pixel art boundaries
export function calculatePixelWeight(
  tx: number,
  ty: number,
  corners: [number, number, number, number],
  steps: number
): number {
  const qtx = Math.min(1, (Math.floor(tx * steps) + 0.5) / steps);
  const qty = Math.min(1, (Math.floor(ty * steps) + 0.5) / steps);
  return calculateWangBaseWeight(qtx, qty, corners);
}

// ===========================================================================
// Simplified Blob Terrain (13 + 1 = 14 tiles)
// ===========================================================================
const BLOB_CORNERS: [number, number, number, number][] = [
  [1, 1, 1, 1], // 0: Center
  [0, 0, 1, 1], // 1: Edge Top
  [1, 1, 0, 0], // 2: Edge Bottom
  [0, 1, 1, 0], // 3: Edge Left
  [1, 0, 0, 1], // 4: Edge Right
  [0, 0, 1, 0], // 5: Outer TL
  [0, 0, 0, 1], // 6: Outer TR
  [0, 1, 0, 0], // 7: Outer BL
  [1, 0, 0, 0], // 8: Outer BR
  [0, 1, 1, 1], // 9: Inner TL
  [1, 0, 1, 1], // 10: Inner TR
  [1, 1, 0, 1], // 11: Inner BR
  [1, 1, 1, 0], // 12: Inner BL
  [0, 0, 0, 0], // 13: Background
];

// ===========================================================================
// Pixel-level tile blending
// ===========================================================================
export type TileWeightFn = (tx: number, ty: number) => number;

/** Weight sampler for the corner models (Wang 16 and blob 13+1 — both dual-grid). */
function cornerWeightFn(tileIndex: number, isWang: boolean, params: RenderParams): TileWeightFn {
  const { tileSize, maskStyle = 'linear', pixelSteps } = params;
  const corners = isWang
    ? getWangCorners(tileIndex)
    : BLOB_CORNERS[tileIndex] ?? ([0, 0, 0, 0] as [number, number, number, number]);
  const resolvedPixelSteps = pixelSteps ?? Math.max(2, Math.floor(tileSize / 8));

  return (tx, ty) =>
    maskStyle === 'arc'   ? calculateArcWeight(tx, ty, corners) :
    maskStyle === 'pixel' ? calculatePixelWeight(tx, ty, corners, resolvedPixelSteps) :
                            calculateWangBaseWeight(tx, ty, corners);
}

/**
 * Weight sampler for blob47 — cell-based, boundaries on the cell borders.
 * maskStyle is reused: 'linear' = sharp outer corners, 'arc' = rounded outer
 * corners, 'pixel' = quantized coordinates. See docs/AUTOTILE_SCHEMES.md §6.3.
 */
function blob47WeightFn(mask: number, params: RenderParams): TileWeightFn {
  const { tileSize, maskStyle = 'linear', pixelSteps, blobRadius = 0.5 } = params;
  if (mask === BLOB47_BACKGROUND) return () => 0;

  const radius = Math.max(0.05, Math.min(0.95, blobRadius));
  const cornerRounding = params.cornerRounding ?? (maskStyle === 'arc' ? radius : 0);
  const fieldParams = { radius, cornerRounding };

  if (maskStyle !== 'pixel') {
    return (tx, ty) => blobWeightAt(tx, ty, mask, fieldParams);
  }

  const steps = pixelSteps ?? Math.max(2, Math.floor(tileSize / 8));
  return (tx, ty) => {
    const qtx = Math.min(1, (Math.floor(tx * steps) + 0.5) / steps);
    const qty = Math.min(1, (Math.floor(ty * steps) + 0.5) / steps);
    return blobWeightAt(qtx, qty, mask, fieldParams);
  };
}

export function blendTilePixels(
  tileIndex: number,
  isWang: boolean,
  imgAData: ImageData | null,
  imgBData: ImageData | null,
  params: RenderParams
): ImageData {
  return blendTileWithWeight(cornerWeightFn(tileIndex, isWang, params), imgAData, imgBData, params);
}

/** Render one blob47 sheet slot. `mask` is a canonical mask, or BLOB47_BACKGROUND. */
export function blendBlob47TilePixels(
  mask: number,
  imgAData: ImageData | null,
  imgBData: ImageData | null,
  params: RenderParams
): ImageData {
  return blendTileWithWeight(blob47WeightFn(mask, params), imgAData, imgBData, params);
}

export function blendTileWithWeight(
  weightAt: TileWeightFn,
  imgAData: ImageData | null,
  imgBData: ImageData | null,
  params: RenderParams
): ImageData {
  const {
    tileSize, smoothness, easing,
    noiseStrength = 0, noiseScale = 5, noiseSeed = 0, noiseTileable = false,
  } = params;

  const outData = new ImageData(tileSize, tileSize);

  const getSourcePixel = (data: ImageData | null, px: number, py: number) => {
    if (!data) return { r: 255, g: 255, b: 255, a: 0 };
    const x = ((px % data.width) + data.width) % data.width;
    const y = ((py % data.height) + data.height) % data.height;
    const idx = (y * data.width + x) * 4;
    return {
      r: data.data[idx],
      g: data.data[idx + 1],
      b: data.data[idx + 2],
      a: data.data[idx + 3],
    };
  };

  const applyNoise = noiseStrength > 0;

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      // Normalized coordinates [0, 1]
      const tx = x / (tileSize - 1);
      const ty = y / (tileSize - 1);

      const weight = weightAt(tx, ty);

      // Soft transition factor (grassRatio)
      let grassRatio = 0.5;
      if (smoothness <= 0) {
        grassRatio = weight > 0.5 ? 1.0 : 0.0;
      } else {
        const low = 0.5 - smoothness / 2;
        const high = 0.5 + smoothness / 2;
        const t = Math.max(0, Math.min(1, (weight - low) / (high - low)));
        const easeFunc = EASING_FUNCTIONS[easing || 'linear'] || EASING_FUNCTIONS.linear;
        grassRatio = easeFunc(t);
      }

      // Edge noise perturbation — only active at the boundary band.
      if (applyNoise) {
        let noiseVal: number;
        let edgeFade: number;
        if (noiseTileable) {
          // Period-wrapped noise. Seams stay continuous because adjacent
          // placements show the same periodic pattern, so the jitter survives
          // at the tile border — which is exactly where blob47's boundaries
          // sit, and where the fade-out below would erase it (§6.1).
          const period = Math.max(1, Math.round(tileSize * noiseScale * FNL_FREQUENCY));
          noiseVal = sampleNoise2DTileable(
            noiseSeed, (x / tileSize) * period, (y / tileSize) * period, period, period
          );
          edgeFade = 1;
        } else {
          // Corner models put boundaries through the tile interior, so fading
          // the noise out at the tile edges keeps seams clean for free.
          noiseVal = sampleNoise2D(noiseSeed, x * noiseScale, y * noiseScale);
          edgeFade = Math.sin(tx * Math.PI) * Math.sin(ty * Math.PI);
        }
        const centeredNoise = noiseVal * 2 - 1;                      // [-1, 1]
        const boundaryWeight = grassRatio * (1 - grassRatio) * 4;    // peaks at alpha=0.5
        grassRatio = Math.max(0, Math.min(1,
          grassRatio + centeredNoise * boundaryWeight * edgeFade * noiseStrength
        ));
      }

      // Blend source textures (Alpha-aware blending where Grass sits on top of Dirt)
      const pixelA = getSourcePixel(imgAData, x, y);
      const pixelB = getSourcePixel(imgBData, x, y);

      const alphaA = (pixelA.a / 255.0) * grassRatio;
      const alphaB = pixelB.a / 255.0;

      const outAlpha = alphaA + alphaB * (1.0 - alphaA);

      let outR = 0;
      let outG = 0;
      let outB = 0;

      if (outAlpha > 0) {
        outR = Math.round((pixelA.r * alphaA + pixelB.r * alphaB * (1.0 - alphaA)) / outAlpha);
        outG = Math.round((pixelA.g * alphaA + pixelB.g * alphaB * (1.0 - alphaA)) / outAlpha);
        outB = Math.round((pixelA.b * alphaA + pixelB.b * alphaB * (1.0 - alphaA)) / outAlpha);
      }
      const outA = Math.round(outAlpha * 255.0);

      const outIdx = (y * tileSize + x) * 4;
      outData.data[outIdx] = outR;
      outData.data[outIdx + 1] = outG;
      outData.data[outIdx + 2] = outB;
      outData.data[outIdx + 3] = outA;
    }
  }

  return outData;
}
