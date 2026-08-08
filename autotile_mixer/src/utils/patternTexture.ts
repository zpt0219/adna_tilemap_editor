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

/**
 * `ripple`, `web`, `brick` and `carpet` are texture-only; the rest are shared
 * with the band grain. The last two are geometric rather than noisy — for those
 * `amount` reads as line weight instead of scatter density.
 */
export type TextureId = 'none' | NoiseId | 'ripple' | 'web' | 'cells' | 'brick' | 'carpet' | 'weave';

export const TEXTURE_PRESETS: readonly { id: TextureId; zh: string; en: string }[] = [
  { id: 'none', zh: '无纹理', en: 'None' },
  { id: 'ripple', zh: '波纹 · 横向短划（水面）', en: 'Ripples — short horizontal dashes' },
  { id: 'web', zh: '涟漪网 · 细线连成的网', en: 'Web — thin connected veins' },
  { id: 'cells', zh: '细胞 · 多边形裂纹', en: 'Cells — polygonal cell boundaries' },
  { id: 'brick', zh: '方砖路面 · 错缝铺装', en: 'Paving — square flags, running bond' },
  { id: 'carpet', zh: '地毯花纹 · 菱格团花', en: 'Carpet — diamond lattice medallions' },
  { id: 'weave', zh: '斜铺砖 · 菱格编织', en: 'Weave — diagonal interlocking bricks' },
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
 * A tileable Voronoi cell field. Unlike `webField`, this keeps a little of the
 * nearest cell's identity in the interior, so full strength reads as softly
 * varied polygon tiles with darker shared boundaries rather than as a vein
 * network. The lattice is 2x2 over the 16px period; all cell coordinates are
 * wrapped before hashing, which makes the field agree exactly at every seam.
 */
function cellsField(x: number, y: number, seed: number): number {
  // Two cells across the 16px period gives the larger, more legible cells in
  // the reference instead of the dense 4x4 micro-cell look.
  const per = 2;
  const fx = (x / 16) * per;
  const fy = (y / 16) * per;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let f1 = 9, f2 = 9;
  let nearestX = 0, nearestY = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx;
      const iy = cy + dy;
      const wx = ((ix % per) + per) % per;
      const wy = ((iy % per) + per) % per;
      // Keep the points away from lattice corners so cells stay readable at
      // 16px, while the second hash gives each cell an independent y offset.
      const px = ix + 0.16 + hash01(wx, wy, seed ^ 0x3c6ef3);
      const py = iy + 0.16 + hash01(wx, wy, seed ^ 0xa54ff5);
      const d = Math.hypot(px - fx, py - fy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        nearestX = wx;
        nearestY = wy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }

  // F2-F1 is small on a Voronoi boundary. A modest cell-local floor keeps the
  // interiors from becoming empty when the user selects all texture shades.
  const boundary = 1 - Math.min(1, (f2 - f1) * 2.4);
  const interior = 0.12 + 0.16 * hash01(nearestX, nearestY, seed ^ 0x510e52);
  return Math.max(interior, boundary);
}

/**
 * Wrap into the tile before anything else looks at the coordinate. The two
 * geometric fields below are built on lattices rather than hashes, so this is
 * what makes their 16-periodicity structural instead of something to check:
 * negative and out-of-tile coordinates land on the same pixel by construction.
 */
const wrap16 = (v: number) => ((v % 16) + 16) % 16;

/**
 * Paving laid in running bond: 8x4 bricks with every other course half-dropped,
 * and the field reads as nearness to a joint. `amount` therefore behaves as
 * mortar weight — the joint lines appear first at low amounts and thicken from
 * there, rather than the surface filling with scatter.
 *
 * Both 8 and 4 divide 16 and the half-drop repeats every two courses, so the
 * pattern closes on the tile in both axes.
 *
 * The 1.5 falloff is load-bearing, not a taste call. A 2:1 brick puts 88 of the
 * 256 pixels on a joint, so a wider falloff would leave the strongest shade
 * more common than the weakest — the opposite of what a highlight is, and what
 * the sparsity test rejects. At 1.5 a joint is a crisp line with one soft pixel
 * beside it: 88 at full strength against 168 below half.
 */
function brickField(x: number, y: number, seed: number): number {
  const SX = 8;
  const SY = 4;
  const px = wrap16(x + (seed & 15));
  const py = wrap16(y + ((seed >>> 4) & 15));
  const ox = (Math.floor(py / SY) % 2) * (SX / 2); // running bond
  const fx = (((px - ox) % SX) + SX) % SX;
  const fy = py % SY;
  const d = Math.min(Math.min(fx, SX - fx), Math.min(fy, SY - fy));
  return 1 - Math.min(1, d / 1.5);
}

/**
 * A half-drop diamond lattice: each 8x8 cell carries a lozenge outline with a
 * medallion at its centre, the classic kilim/carpet motif. Manhattan distance
 * from the cell centre gives the diamond for free — the outline is one ring of
 * that distance, the medallion another.
 *
 * The two rings sit at distances the pixel grid can actually hit (cell centres
 * fall between pixels, so the distance is always a whole number), which is what
 * lets the motif reach full strength instead of washing out.
 */
function carpetField(x: number, y: number, seed: number): number {
  const S = 8;
  const px = wrap16(x + (seed & 15));
  const py = wrap16(y + ((seed >>> 4) & 15));
  const ox = (Math.floor(py / S) % 2) * (S / 2);
  const u = ((((px - ox) % S) + S) % S) - (S - 1) / 2;
  const v = (py % S) - (S - 1) / 2;
  const m = Math.abs(u) + Math.abs(v);
  const medallion = 1 - Math.min(1, Math.abs(m - 1) / 1.5);
  const lozenge = 1 - Math.min(1, Math.abs(m - 4) / 1.5);
  return Math.max(0, Math.max(medallion, lozenge));
}

/**
 * Diagonal interlocking brick weave, traced from `assets/test3.png`.
 *
 * Baked rather than derived: four rhombic facets interlock around a shared
 * point with one of them outlined, and no field expression gets that — the
 * generator would have to encode the four orientations anyway, at which point
 * the table IS the cheaper description. It is a 16x16 tile already, which is
 * exactly the period everything here has to have.
 *
 * Each digit is the luminance RANK of the reference's five tones, 0 lightest.
 * That is what lets two picked colours reproduce the reference: rank 0 stays the
 * plain terrain colour and rank 4 is the texture colour at full strength.
 */
const WEAVE =
  '0032222222311300' +
  '0003222222233000' +
  '0004422222230000' +
  '0043342222300000' +
  '0433334223000000' +
  '4333333430000000' +
  '4333333340000003' +
  '1433333334000031' +
  '1143333333400311' +
  '1114333333343111' +
  '1113433333341111' +
  '1132243333411111' +
  '1322224334111111' +
  '3222222441111111' +
  '3222222231111113' +
  '0322222223111130';

/** The weave's own tone count; `shades` rescales onto the caller's ramp. */
const WEAVE_RANKS = 4;

/**
 * The weave names its shade outright instead of being thresholded into one:
 * its tones are already a ramp, so `amount` scales the ramp — full weave at 1,
 * flattening toward the bare terrain as it drops.
 */
function weaveShade(x: number, y: number, seed: number, amount: number, shades: number): number {
  const px = wrap16(x + (seed & 15));
  const py = wrap16(y + ((seed >>> 4) & 15));
  const rank = WEAVE.charCodeAt(py * 16 + px) - 48;
  const k = Math.round((rank * shades * Math.min(1, amount)) / WEAVE_RANKS);
  return Math.max(0, Math.min(shades, k));
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
  // Baked art, not a field: it already knows which tone each pixel is.
  if (texture === 'weave') return weaveShade(x, y, s, amount, shades);
  const n = texture === 'ripple' ? rippleField(x, y, s)
    : texture === 'web' ? webField(x, y, s)
      : texture === 'cells' ? cellsField(x, y, s)
        : texture === 'brick' ? brickField(x, y, s)
          : texture === 'carpet' ? carpetField(x, y, s)
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

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/**
 * The `shades + 1` colours a textured terrain is drawn with, index 0 being the
 * plain terrain colour.
 *
 * With an explicit `target` the ramp walks from the terrain colour to exactly
 * that colour, which lets the texture be any colour at all rather than a
 * brightness shift of the terrain — a grass field can carry yellow flecks, water
 * white foam. Without one it falls back to deriving the shift, which is what
 * makes a freshly picked terrain colour look textured before anything is set.
 */
export function textureRamp(
  base: RGB,
  target: RGB | undefined,
  shades: number = DEFAULT_TEXTURE_SHADES
): RGB[] {
  const n = Math.max(1, shades);
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n;
    if (!target) return textureColour(base, t);
    return {
      r: mix(base.r, target.r, t),
      g: mix(base.g, target.g, t),
      b: mix(base.b, target.b, t),
    };
  });
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
