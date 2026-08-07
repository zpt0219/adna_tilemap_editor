// patternTexture.ts — speckle inside the solid terrains, so a filled region
// reads as a material rather than a flat wash.
//
// It reuses the noise fields from patternNoise, which means it inherits their
// one non-negotiable property: everything here is a pure function of (x, y)
// modulo the 16px pattern tile. A tile is painted knowing nothing about its
// neighbours, so anything that is not 16-periodic disagrees with itself across
// every seam.
//
// Texture applies only to the two SOLID levels (open terrain B, and the filled
// interior of terrain A). The transition band has its own grain; texturing it
// as well would just muddy the edge.

import { sample, type NoiseId } from './patternNoise';
import type { RGB } from './patternPaint';

/** `ripple` and `web` are texture-only; the rest are shared with the band grain. */
export type TextureId = 'none' | NoiseId | 'ripple' | 'web';

export const TEXTURE_PRESETS: readonly { id: TextureId; zh: string; en: string }[] = [
  { id: 'none', zh: '无纹理', en: 'None' },
  { id: 'ripple', zh: '波纹 · 横向短划（水面）', en: 'Ripples — short horizontal dashes' },
  { id: 'web', zh: '涟漪网 · 细线连成的网', en: 'Web — thin connected veins' },
  { id: 'white', zh: '白噪散点 · 细碎', en: 'White speckle — fine' },
  { id: 'blue', zh: '蓝噪散点 · 均匀', en: 'Blue speckle — even' },
  { id: 'clumped', zh: '云斑 · 成片', en: 'Clumped — patchy' },
  { id: 'ordered', zh: '有序网点 · 规则', en: 'Ordered — regular' },
];

export const DEFAULT_TEXTURE: TextureId = 'none';
export const MIN_TEXTURE_SHADES = 1;
export const MAX_TEXTURE_SHADES = 4;
export const DEFAULT_TEXTURE_SHADES = 4;

/** Salt, so texture never lands in step with the band grain off one seed. */
const TEXTURE_SALT = 0x5bd1;

// --- texture-only fields ---------------------------------------------------
// Both are built on lattices whose cell counts divide 16, so they repeat with
// the tile exactly like everything else here does.

function hash01(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise on a deliberately anisotropic lattice: wide cells across, one
 * pixel tall down. Correlated horizontally and independent vertically, it
 * thresholds into the short horizontal dashes pixel art draws water with —
 * which no isotropic field produces, however it is tuned.
 */
function rippleField(x: number, y: number, seed: number): number {
  const perX = 4;   // 4 cells across 16px -> ~4px of horizontal correlation
  const perY = 16;  // one cell per row -> rows stay independent
  const fx = (x / 16) * perX;
  const iy = ((y % perY) + perY) % perY;
  const x0 = Math.floor(fx);
  const u = smooth(fx - x0);
  const h = (ix: number) => hash01(((ix % perX) + perX) % perX, iy, seed);
  return h(x0) * (1 - u) + h(x0 + 1) * u;
}

/**
 * Cellular (Worley) noise read at its *edges*: near-equal distance to the two
 * closest feature points means the pixel sits on a cell boundary, and those
 * boundaries join up into one connected filigree.
 */
function webField(x: number, y: number, seed: number): number {
  const per = 4;
  const fx = (x / 16) * per;
  const fy = (y / 16) * per;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let f1 = 9, f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx;
      const iy = cy + dy;
      const wx = ((ix % per) + per) % per;
      const wy = ((iy % per) + per) % per;
      const px = ix + hash01(wx, wy, seed);
      const py = iy + hash01(wx, wy, seed ^ 0x9e37);
      const d = Math.hypot(px - fx, py - fy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return 1 - Math.min(1, (f2 - f1) * 1.6);
}

/**
 * Which texture shade a pixel takes: 0 for the plain terrain colour, 1..shades
 * for progressively stronger ones.
 *
 * `amount` is the fraction of pixels that get any texture at all. Within that
 * fraction the strength is biased low (u squared), so the strongest shade stays
 * a sparse highlight instead of half the surface — which is how the speckle in
 * a hand-drawn material actually distributes.
 */
export function textureShadeAt(
  texture: TextureId,
  x: number,
  y: number,
  seed: number,
  amount: number,
  shades: number = DEFAULT_TEXTURE_SHADES
): number {
  if (texture === 'none' || amount <= 0 || shades < 1) return 0;
  const s = (seed ^ TEXTURE_SALT) >>> 0;
  const n = texture === 'ripple' ? rippleField(x, y, s)
    : texture === 'web' ? webField(x, y, s)
      : sample(texture, x, y, s);
  const cut = 1 - Math.min(1, amount);
  if (n < cut) return 0;
  const u = cut >= 1 ? 1 : (n - cut) / (1 - cut);
  return Math.min(shades, 1 + Math.floor(shades * u * u));
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec. 709 luminance, 0..1 — decides which way a colour has room to move. */
function luminance({ r, g, b }: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * A terrain colour shifted for texture, `t` in (0, 1].
 *
 * The direction follows the colour's luminance rather than being fixed: a deep
 * blue has nowhere to go but lighter, a near-white nowhere but darker. Picking
 * by value instead would misread strongly saturated darks — a full-saturation
 * blue sits high in HSV value while reading almost black.
 */
export function textureColour(c: RGB, t: number): RGB {
  if (t <= 0) return c;
  const [h, s, v] = rgbToHsv(c);
  const lighten = luminance(c) < 0.5;
  const nv = lighten ? v * (1 + 0.3 * t) : v * (1 - 0.18 * t);
  const ns = lighten ? s * (1 - 0.15 * t) : s * (1 + 0.1 * t);
  return hsvToRgb(h, clamp01(ns), clamp01(nv));
}

// --- local HSV, kept here so this module does not depend on patternPaint ----
function rgbToHsv({ r, g, b }: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const range = mx - mn;
  if (range === 0) return [0, 0, mx];
  const rc = (mx - R) / range, gc = (mx - G) / range, bc = (mx - B) / range;
  let hue: number;
  if (R === mx) hue = bc - gc;
  else if (G === mx) hue = 2 + rc - bc;
  else hue = 4 + gc - rc;
  hue = (hue / 6) % 1;
  return [hue < 0 ? hue + 1 : hue, range / mx, mx];
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const to255 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  if (s === 0) return { r: to255(v), g: to255(v), b: to255(v) };
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const table: [number, number, number][] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ];
  const [R, G, B] = table[((i % 6) + 6) % 6];
  return { r: to255(R), g: to255(G), b: to255(B) };
}
