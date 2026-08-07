// patternNoise.ts — optional grain on a pattern's transition band.
//
// Every algorithm here is a PURE function of (x, y) taken modulo the 16px
// pattern tile. That is not a stylistic choice: a tile is painted without any
// knowledge of its neighbours, so a post-process that reads nearby pixels would
// disagree with itself across a seam. Being per-pixel and 16-periodic makes the
// grain a function of global position, which is exactly what keeps the tileset
// seamless. Anything added here must keep both properties.
//
// The grain is applied only to levels 1..3 — the transition band. Levels 0 and
// 4 are the solid terrains and stay clean.

export type NoiseId = 'white' | 'blue' | 'clumped' | 'ordered';

export const NOISE_PRESETS: readonly { id: NoiseId; zh: string; en: string }[] = [
  { id: 'blue', zh: '蓝噪点 · 均匀细颗粒', en: 'Blue noise — even fine grain' },
  { id: 'white', zh: '白噪点 · 随机沙粒', en: 'White noise — random sand' },
  { id: 'clumped', zh: '云斑 · 成团斑驳', en: 'Clumped — patchy blotches' },
  { id: 'ordered', zh: '有序网点 · 规则半调', en: 'Ordered — regular halftone' },
];

/** Nothing selected = no grain. */
export const DEFAULT_NOISES: readonly NoiseId[] = [];

/** Seed 0 means "the tables and hashes exactly as authored". */
export const DEFAULT_NOISE_SEED = 0;

/** Multiplier on every algorithm's share. 1 = the tuned amounts below. */
export const DEFAULT_NOISE_STRENGTH = 1;
export const MAX_NOISE_STRENGTH = 2;

/** Fraction of band pixels pushed one level each way. Tuned per algorithm so
 *  the presets read as roughly equal strength despite different distributions. */
const AMOUNT: Record<NoiseId, number> = {
  white: 0.22,
  blue: 0.24,
  clumped: 0.26,
  ordered: 0.19,
};

/**
 * Half the pixels down and half up is total disturbance — there is nothing
 * past it. Beyond 0.5 the two thresholds would overlap and pixels meant to go
 * up would start going down instead, so the share is capped rather than left
 * to invert.
 */
const MAX_SHARE = 0.5;

// 16x16 void-and-cluster blue noise (Ulichney), toroidal, values 0..255.
// Generated offline; 16 divides the tile so it repeats with the pattern.
const BLUE = [
  228, 182, 246, 42, 98, 29, 127, 44, 211, 8, 83, 164, 217, 2, 93, 123,
  85, 26, 135, 74, 163, 238, 194, 89, 175, 117, 225, 31, 106, 151, 252, 40,
  174, 109, 196, 218, 3, 141, 60, 229, 25, 156, 49, 199, 66, 189, 55, 210,
  9, 236, 53, 91, 179, 111, 19, 149, 76, 250, 100, 140, 239, 16, 130, 158,
  65, 147, 125, 36, 247, 70, 221, 185, 124, 193, 4, 171, 84, 114, 227, 97,
  249, 192, 17, 201, 134, 167, 46, 102, 33, 64, 208, 45, 219, 27, 178, 38,
  79, 169, 103, 231, 82, 10, 204, 233, 159, 242, 92, 126, 157, 63, 139, 213,
  119, 52, 32, 155, 59, 118, 144, 86, 14, 136, 181, 18, 253, 195, 96, 1,
  202, 244, 132, 214, 180, 254, 41, 190, 113, 54, 222, 75, 108, 48, 226, 146,
  23, 183, 87, 5, 105, 24, 209, 68, 232, 165, 34, 148, 188, 12, 168, 69,
  110, 62, 153, 230, 72, 173, 131, 152, 0, 99, 207, 121, 235, 90, 129, 237,
  160, 43, 206, 116, 35, 241, 94, 50, 248, 184, 73, 21, 56, 212, 39, 197,
  95, 251, 20, 138, 162, 198, 22, 220, 122, 37, 137, 240, 172, 150, 81, 6,
  133, 216, 77, 186, 88, 57, 112, 177, 80, 161, 215, 101, 13, 115, 245, 187,
  166, 107, 51, 224, 7, 234, 143, 15, 200, 61, 28, 191, 78, 223, 58, 30,
  67, 11, 154, 120, 203, 170, 71, 255, 104, 145, 243, 128, 47, 176, 142, 205,
];

// Bayer 8x8, values 0..63. 8 divides 16, so it also repeats with the tile.
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

const wrap16 = (v: number) => ((v % 16) + 16) % 16;

/** Uncorrelated hash in [0,1). Seed 0 leaves the mix untouched. */
function hash01(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Scramble bits for a table-driven algorithm. Salted per algorithm so stacked
 * ones do not shift in lockstep, and 0 for seed 0 so that seed means "the
 * tables exactly as authored".
 */
function seedBits(seed: number, salt: number): number {
  if (seed === 0) return 0;
  let n = Math.imul(seed, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 15), 0xc2b2ae35);
  return (n ^ (n >>> 13)) >>> 0;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a 4x4 lattice over the tile — period 16, so it wraps. */
function valueNoise(x: number, y: number, seed: number): number {
  const per = 4;
  const fx = (x / 16) * per;
  const fy = (y / 16) * per;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fade(fx - x0);
  const v = fade(fy - y0);
  const h = (ix: number, iy: number) =>
    hash01(((ix % per) + per) % per, ((iy % per) + per) % per, seed);
  const a = h(x0, y0) * (1 - u) + h(x0 + 1, y0) * u;
  const b = h(x0, y0 + 1) * (1 - u) + h(x0 + 1, y0 + 1) * u;
  return a * (1 - v) + b * v;
}

/**
 * Noise value in [0,1) for a pattern-space pixel.
 *
 * The two table-driven algorithms cannot simply be re-hashed — the blue-noise
 * matrix is blue *because* of how its values are arranged, and Bayer is Bayer
 * for the same reason. So their seed picks a toroidal shift plus a flip, which
 * relabels the torus without disturbing either property, and above all keeps
 * the 16-pixel period the seams depend on.
 */
export function sample(noise: NoiseId, x: number, y: number, seed: number): number {
  const px = wrap16(x);
  const py = wrap16(y);
  switch (noise) {
    case 'blue': {
      const s = seedBits(seed, 1);
      let ax = (px + (s & 15)) & 15;
      let ay = (py + ((s >>> 4) & 15)) & 15;
      const t = (s >>> 8) & 7;
      if (t & 1) { const k = ax; ax = ay; ay = k; }
      if (t & 2) ax = 15 - ax;
      if (t & 4) ay = 15 - ay;
      return BLUE[ay * 16 + ax] / 256;
    }
    case 'ordered': {
      const s = seedBits(seed, 2);
      const ax = (px + (s & 7)) & 7;
      const ay = (py + ((s >>> 3) & 7)) & 7;
      return BAYER8[ay * 8 + ax] / 64;
    }
    case 'clumped': return valueNoise(px, py, seed);
    case 'white': return hash01(px, py, seed);
    default: return 0.5;
  }
}

function stepOf(
  noise: NoiseId, x: number, y: number, seed: number, strength: number
): number {
  const p = Math.min(MAX_SHARE, (AMOUNT[noise] ?? 0) * strength);
  if (p <= 0) return 0;
  const n = sample(noise, x, y, seed);
  if (n < p) return -1;
  if (n >= 1 - p) return 1;
  return 0;
}

/**
 * Level shift for a transition-band pixel: -1 pulls it toward terrain B, +1
 * toward terrain A, 0 leaves it. Callers must only apply this to levels 1..3.
 *
 * Algorithms stack: each votes independently and the votes are summed, then
 * clamped back to one step. So selecting more of them disturbs more pixels
 * without ever moving one further than a single level — which is what keeps
 * the result reading as a dissolve rather than a hole punched through the
 * band. Opposing votes cancel, and the sum is order-independent.
 *
 * Combinations are genuinely different from their parts: `clumped` decides
 * which stretches of the band erode heavily while `blue` supplies the fine
 * grain inside them.
 */
export function noiseStep(
  noises: readonly NoiseId[],
  x: number,
  y: number,
  seed = DEFAULT_NOISE_SEED,
  strength = DEFAULT_NOISE_STRENGTH
): number {
  if (strength <= 0) return 0;
  let total = 0;
  for (const id of noises) total += stepOf(id, x, y, seed, strength);
  return total < -1 ? -1 : total > 1 ? 1 : total;
}
