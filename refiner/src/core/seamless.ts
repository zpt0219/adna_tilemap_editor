import type { RawImage, RGB } from "../shared/types";

export interface SeamlessOptions {
  bleedRadius: number; // 0 to 8 (0 means only edge pixels, >0 means blend inward)
  mode: "linear" | "cosine";
  horizontal: boolean;
  vertical: boolean;
}

const cloneImage = (img: RawImage): RawImage => ({
  width: img.width,
  height: img.height,
  data: new Uint8ClampedArray(img.data),
});

export function makeSeamless(img: RawImage, options: SeamlessOptions): RawImage {
  const { bleedRadius, mode, horizontal, vertical } = options;
  const out = cloneImage(img);
  const W = img.width;
  const H = img.height;

  // Helper to interpolate channels
  const blend = (origVal: number, edgeVal: number, t: number): number => {
    return Math.max(0, Math.min(255, Math.round(edgeVal * (1 - t) + origVal * t)));
  };

  // 1. Horizontal Seamless (Left-Right Sync)
  if (horizontal && W > 1) {
    for (let y = 0; y < H; y++) {
      const leftIdx = y * W * 4;
      const rightIdx = (y * W + (W - 1)) * 4;

      // Extract left and right edge pixels
      const rL = out.data[leftIdx];
      const gL = out.data[leftIdx + 1];
      const bL = out.data[leftIdx + 2];
      const aL = out.data[leftIdx + 3];

      const rR = out.data[rightIdx];
      const gR = out.data[rightIdx + 1];
      const bR = out.data[rightIdx + 2];
      const aR = out.data[rightIdx + 3];

      // Average color for the seam
      const edgeR = (rL + rR) / 2;
      const edgeG = (gL + gR) / 2;
      const edgeB = (bL + bR) / 2;
      const edgeA = (aL + aR) / 2;

      // Apply blending inward
      const maxB = Math.min(bleedRadius, Math.floor(W / 2));
      
      // If bleedRadius is 0, we just set the edge pixels directly
      if (maxB === 0) {
        out.data[leftIdx] = edgeR;
        out.data[leftIdx + 1] = edgeG;
        out.data[leftIdx + 2] = edgeB;
        out.data[leftIdx + 3] = edgeA;

        out.data[rightIdx] = edgeR;
        out.data[rightIdx + 1] = edgeG;
        out.data[rightIdx + 2] = edgeB;
        out.data[rightIdx + 3] = edgeA;
        continue;
      }

      for (let x = 0; x < maxB; x++) {
        const curLeftIdx = (y * W + x) * 4;
        const curRightIdx = (y * W + (W - 1 - x)) * 4;

        // Blending factor t: 0 at the edge, 1 at the bleed boundary
        let t = x / maxB;
        if (mode === "cosine") {
          t = (1 - Math.cos(t * Math.PI)) / 2;
        }

        // Blend left side
        out.data[curLeftIdx] = blend(out.data[curLeftIdx], edgeR, t);
        out.data[curLeftIdx + 1] = blend(out.data[curLeftIdx + 1], edgeG, t);
        out.data[curLeftIdx + 2] = blend(out.data[curLeftIdx + 2], edgeB, t);
        out.data[curLeftIdx + 3] = blend(out.data[curLeftIdx + 3], edgeA, t);

        // Blend right side
        out.data[curRightIdx] = blend(out.data[curRightIdx], edgeR, t);
        out.data[curRightIdx + 1] = blend(out.data[curRightIdx + 1], edgeG, t);
        out.data[curRightIdx + 2] = blend(out.data[curRightIdx + 2], edgeB, t);
        out.data[curRightIdx + 3] = blend(out.data[curRightIdx + 3], edgeA, t);
      }
    }
  }

  // 2. Vertical Seamless (Top-Bottom Sync)
  if (vertical && H > 1) {
    for (let x = 0; x < W; x++) {
      const topIdx = x * 4;
      const bottomIdx = ((H - 1) * W + x) * 4;

      // Extract top and bottom edge pixels
      const rT = out.data[topIdx];
      const gT = out.data[topIdx + 1];
      const bT = out.data[topIdx + 2];
      const aT = out.data[topIdx + 3];

      const rB = out.data[bottomIdx];
      const gB = out.data[bottomIdx + 1];
      const bB = out.data[bottomIdx + 2];
      const aB = out.data[bottomIdx + 3];

      // Average color for the seam
      const edgeR = (rT + rB) / 2;
      const edgeG = (gT + gB) / 2;
      const edgeB = (bT + bB) / 2;
      const edgeA = (aT + aB) / 2;

      const maxB = Math.min(bleedRadius, Math.floor(H / 2));

      // If bleedRadius is 0, we just set the edge pixels directly
      if (maxB === 0) {
        out.data[topIdx] = edgeR;
        out.data[topIdx + 1] = edgeG;
        out.data[topIdx + 2] = edgeB;
        out.data[topIdx + 3] = edgeA;

        out.data[bottomIdx] = edgeR;
        out.data[bottomIdx + 1] = edgeG;
        out.data[bottomIdx + 2] = edgeB;
        out.data[bottomIdx + 3] = edgeA;
        continue;
      }

      for (let y = 0; y < maxB; y++) {
        const curTopIdx = (y * W + x) * 4;
        const curBottomIdx = ((H - 1 - y) * W + x) * 4;

        // Blending factor t
        let t = y / maxB;
        if (mode === "cosine") {
          t = (1 - Math.cos(t * Math.PI)) / 2;
        }

        // Blend top side
        out.data[curTopIdx] = blend(out.data[curTopIdx], edgeR, t);
        out.data[curTopIdx + 1] = blend(out.data[curTopIdx + 1], edgeG, t);
        out.data[curTopIdx + 2] = blend(out.data[curTopIdx + 2], edgeB, t);
        out.data[curTopIdx + 3] = blend(out.data[curTopIdx + 3], edgeA, t);

        // Blend bottom side
        out.data[curBottomIdx] = blend(out.data[curBottomIdx], edgeR, t);
        out.data[curBottomIdx + 1] = blend(out.data[curBottomIdx + 1], edgeG, t);
        out.data[curBottomIdx + 2] = blend(out.data[curBottomIdx + 2], edgeB, t);
        out.data[curBottomIdx + 3] = blend(out.data[curBottomIdx + 3], edgeA, t);
      }
    }
  }

  return out;
}

/**
 * Shifts a RawImage by dx, dy (with wrap-around).
 * Useful for Aseprite-like Offset Shift view of seams.
 */
export function shiftImage(img: RawImage, dx: number, dy: number): RawImage {
  const out = cloneImage(img);
  const W = img.width;
  const H = img.height;
  
  // Normalize shifts
  const shiftX = ((dx % W) + W) % W;
  const shiftY = ((dy % H) + H) % H;

  if (shiftX === 0 && shiftY === 0) return out;

  for (let y = 0; y < H; y++) {
    const srcY = (y + shiftY) % H;
    for (let x = 0; x < W; x++) {
      const srcX = (x + shiftX) % W;
      
      const dstIdx = (y * W + x) * 4;
      const srcIdx = (srcY * W + srcX) * 4;
      
      out.data[dstIdx] = img.data[srcIdx];
      out.data[dstIdx + 1] = img.data[srcIdx + 1];
      out.data[dstIdx + 2] = img.data[srcIdx + 2];
      out.data[dstIdx + 3] = img.data[srcIdx + 3];
    }
  }

  return out;
}

export function cropRawImage(img: RawImage, rx: number, ry: number, rw: number, rh: number): RawImage {
  const out = new Uint8ClampedArray(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    const srcY = ry + y;
    if (srcY < 0 || srcY >= img.height) continue;
    const srcRowOffset = srcY * img.width;
    const dstRowOffset = y * rw;
    for (let x = 0; x < rw; x++) {
      const srcX = rx + x;
      if (srcX < 0 || srcX >= img.width) continue;
      const srcIdx = (srcRowOffset + srcX) * 4;
      const dstIdx = (dstRowOffset + x) * 4;
      
      out[dstIdx] = img.data[srcIdx];
      out[dstIdx + 1] = img.data[srcIdx + 1];
      out[dstIdx + 2] = img.data[srcIdx + 2];
      out[dstIdx + 3] = img.data[srcIdx + 3];
    }
  }
  return { width: rw, height: rh, data: out };
}

export function extractUniqueColors(img: RawImage): RGB[] {
  const colors = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a === 0) continue; // Skip transparent
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    colors.add(key);
  }
  return Array.from(colors).map((key) => ({
    r: (key >> 16) & 255,
    g: (key >> 8) & 255,
    b: key & 255,
  }));
}
