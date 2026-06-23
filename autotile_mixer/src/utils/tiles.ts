export interface RenderParams {
  tileSize: number;
  smoothness: number;
  easing?: string;
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  } else if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  } else {
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  }
}

export const EASING_FUNCTIONS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  smoothstep: (t) => t * t * (3 - 2 * t),
  
  // Sine
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

  // Quad
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,

  // Cubic
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  // Quart
  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutQuart: (t) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,

  // Quint
  easeInQuint: (t) => t * t * t * t * t,
  easeOutQuint: (t) => 1 - Math.pow(1 - t, 5),
  easeInOutQuint: (t) => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2,

  // Expo
  easeInExpo: (t) => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
  easeOutExpo: (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeInOutExpo: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5
      ? Math.pow(2, 20 * t - 10) / 2
      : (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  // Circ
  easeInCirc: (t) => 1 - Math.sqrt(1 - Math.pow(t, 2)),
  easeOutCirc: (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  easeInOutCirc: (t) =>
    t < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,

  // Back
  easeInBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInOutBack: (t) => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },

  // Elastic
  easeInElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  },
  easeOutElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeInOutElastic: (t) => {
    const c5 = (2 * Math.PI) / 4.5;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  },

  // Bounce
  easeInBounce: (t) => 1 - easeOutBounce(1 - t),
  easeOutBounce: easeOutBounce,
  easeInOutBounce: (t) =>
    t < 0.5
      ? (1 - easeOutBounce(1 - 2 * t)) / 2
      : (1 + easeOutBounce(2 * t - 1)) / 2,
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

export function calculateWangBaseWeight(
  tx: number,
  ty: number,
  corners: [number, number, number, number]
): number {
  const [nw, ne, se, sw] = corners;
  // Bilinear interpolation:
  const top = nw * (1 - tx) + ne * tx;
  const bot = sw * (1 - tx) + se * tx;
  return top * (1 - ty) + bot * ty;
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
export function blendTilePixels(
  tileIndex: number,
  isWang: boolean,
  imgAData: ImageData | null,
  imgBData: ImageData | null,
  params: RenderParams
): ImageData {
  const { tileSize, smoothness, easing } = params;

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

  const corners = isWang ? getWangCorners(tileIndex) : BLOB_CORNERS[tileIndex] ?? [0, 0, 0, 0] as [number, number, number, number];

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      // Normalized coordinates [0, 1]
      const tx = x / (tileSize - 1);
      const ty = y / (tileSize - 1);

      // Base Weight via bilinear interpolation
      const baseWeight = calculateWangBaseWeight(tx, ty, corners);

      // Soft transition factor (grassRatio)
      let grassRatio = 0.5;
      if (smoothness <= 0) {
        grassRatio = baseWeight > 0.5 ? 1.0 : 0.0;
      } else {
        const low = 0.5 - smoothness / 2;
        const high = 0.5 + smoothness / 2;
        const t = Math.max(0, Math.min(1, (baseWeight - low) / (high - low)));
        const easeFunc = EASING_FUNCTIONS[easing || 'linear'] || EASING_FUNCTIONS.linear;
        grassRatio = easeFunc(t);
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
