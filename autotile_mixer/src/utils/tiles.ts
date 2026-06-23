export interface RenderParams {
  tileSize: number;
  smoothness: number;
}

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
  const { tileSize, smoothness } = params;

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
        grassRatio = t * t * (3 - 2 * t); // smoothstep
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
