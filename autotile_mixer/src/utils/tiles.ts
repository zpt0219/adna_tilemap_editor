export interface RenderParams {
  tileSize: number;
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
  [1, 1, 0, 1], // 11: Inner BL
  [1, 1, 1, 0], // 12: Inner BR
  [0, 0, 0, 0], // 13: Background
];

// ===========================================================================
// Pixel-level tile blending
// ===========================================================================
export function blendTilePixels(
  tileIndex: number,
  isWang: boolean,
  params: RenderParams
): ImageData {
  const { tileSize } = params;

  const outData = new ImageData(tileSize, tileSize);
  const corners = isWang ? getWangCorners(tileIndex) : BLOB_CORNERS[tileIndex] ?? [0, 0, 0, 0] as [number, number, number, number];

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      // Normalized coordinates [0, 1]
      const tx = x / (tileSize - 1);
      const ty = y / (tileSize - 1);

      // Base Weight via bilinear interpolation
      const baseWeight = calculateWangBaseWeight(tx, ty, corners);

      // Evaluate grass ratio (hardcoded 0.5 threshold)
      const isGrass = baseWeight > 0.5;

      // Color mapping: Grass is Green, Dirt is Brown
      const color = isGrass ? [34, 197, 94, 255] : [120, 53, 15, 255];

      const outIdx = (y * tileSize + x) * 4;
      outData.data[outIdx] = color[0];
      outData.data[outIdx + 1] = color[1];
      outData.data[outIdx + 2] = color[2];
      outData.data[outIdx + 3] = color[3];
    }
  }

  return outData;
}
