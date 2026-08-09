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
 * `ripple`, `brick` and `carpet` are texture-only; the rest are shared
 * with the band grain. The last two are geometric rather than noisy — for those
 * `amount` reads as line weight instead of scatter density.
 */
export type TextureId =
  | 'none' | NoiseId | 'ripple' | 'cells' | 'medium_cells' | 'small_cells'
  | 'brick' | 'carpet' | 'weave' | 'paving' | 'paving3' | 'paving5';

export const TEXTURE_PRESETS: readonly { id: TextureId; zh: string; en: string }[] = [
  { id: 'none', zh: '无纹理', en: 'None' },
  { id: 'ripple', zh: '波纹 · 横向短划（水面）', en: 'Ripples — short horizontal dashes' },
  { id: 'cells', zh: '大细胞 · 2x2 多边形', en: 'Large Cells — 2x2 polygonal cells' },
  { id: 'medium_cells', zh: '中细胞 · 3x3 多边形', en: 'Medium Cells — 3x3 polygonal cells' },
  { id: 'small_cells', zh: '小细胞 · 4x4 细小多边形', en: 'Small Cells — 4x4 fine polygonal cells' },
  { id: 'brick', zh: '方砖路面 · 错缝铺装', en: 'Paving — square flags, running bond' },
  { id: 'carpet', zh: '地毯花纹 · 菱格团花', en: 'Carpet — diamond lattice medallions' },
  { id: 'weave', zh: '斜铺砖 · 菱格编织', en: 'Weave — diagonal interlocking bricks' },
  { id: 'paving', zh: '乱砌石板 · 大小板错拼（32）', en: 'Paving — random ashlar flags (32)' },
  { id: 'paving3', zh: '立方体 · 等距方块（32）', en: 'Paving3 — isometric cubes (32)' },
  { id: 'paving5', zh: '互锁铺砖 · 曲边咬合（32）', en: 'Paving5 — interlocking curved pavers (32)' },
  { id: 'white', zh: '白噪散点 · 细碎', en: 'White speckle — fine' },
  { id: 'blue', zh: '蓝噪散点 · 均匀', en: 'Blue speckle — even' },
  { id: 'clumped', zh: '云斑 · 成片', en: 'Clumped — patchy' },
  { id: 'ordered', zh: '有序网点 · 规则', en: 'Ordered — regular' },
];

/**
 * The three Stagecast pavings are traced from 32x32 art that is genuinely
 * 32-periodic — measured, not assumed: shifting any of them by 16 leaves 800+
 * of 1024 pixels disagreeing, and that holds for the joint mask alone too, so
 * there is no 16-periodic core hiding under the tint variation.
 */
const PERIOD_32: readonly TextureId[] = [
  'paving', 'paving3', 'paving5',
  // The geometric fields were widened so their motifs read at the same scale as
  // the pavings: at the old size they repeated four times inside one 32px tile
  // and looked like a finer material sitting next to a coarser one. Widening the
  // motif and widening the period are not the same thing, though — `brick` is
  // absent because a 16x8 running bond still maps onto itself every 16px in both
  // axes, measured, even though its flags are now twice the size.
  'ripple', 'cells', 'medium_cells', 'small_cells', 'carpet',
];

/**
 * The output-pixel period of a texture, which must DIVIDE the tile size for the
 * texture to be seamless — a seam falls every tile, and only lands on a period
 * boundary when it divides. The sheet is emitted at 32 only, so both 16 and 32
 * are fine here; a texture with any other period would need this checked again.
 */
export function texturePeriod(texture: TextureId): 16 | 32 {
  return PERIOD_32.includes(texture) ? 32 : 16;
}

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
  const perX = 4;   // 4 cells across 32px -> ~8px of horizontal correlation
  const perY = 32;  // one cell per row -> rows stay independent
  const fx = (x / 32) * perX;
  const iy = ((y % perY) + perY) % perY;
  const x0 = Math.floor(fx);
  const u = smooth(fx - x0);
  const h = (ix: number) => hash01(((ix % perX) + perX) % perX, iy, seed);
  return h(x0) * (1 - u) + h(x0 + 1) * u;
}

/**
 * A tileable Voronoi cell field. Unlike `webField`, this keeps a little of the
 * nearest cell's identity in the interior, so full strength reads as softly
 * varied polygon tiles with darker shared boundaries rather than as a vein
 * network.
 * `per` defines the number of cells across the 32px tile (2 for 2x2, 3 for 3x3, 4 for 4x4).
 */
function cellsField(x: number, y: number, seed: number, per = 2): number {
  const fx = (x / 32) * per;
  const fy = (y / 32) * per;
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

      // For 3x3 (medium) and 4x4 (small) cells, use fully random free-floating Voronoi points
      // so cells wander naturally without any rigid grid skeleton or square box lines.
      const px = per >= 3
        ? ix + hash01(wx, wy, seed ^ 0x3c6ef3)
        : ix + (wy % 2) * 0.5 + 0.16 + hash01(wx, wy, seed ^ 0x3c6ef3) * 0.55;
      const py = per >= 3
        ? iy + hash01(wx, wy, seed ^ 0xa54ff5)
        : iy + 0.16 + hash01(wx, wy, seed ^ 0xa54ff5) * 0.55;

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

  // F2-F1 is small on a Voronoi boundary. Tune boundary multiplier for raster thickness
  // to ensure continuous boundary lines across integer pixel samples.
  const boundaryMult = per === 4 ? 1.6 : per === 3 ? 2.0 : 2.4;
  const boundary = 1 - Math.min(1, (f2 - f1) * boundaryMult);
  const interior = 0.10 + 0.14 * hash01(nearestX, nearestY, seed ^ 0x510e52);
  return Math.max(interior, boundary);
}

/**
 * Wrap into the tile before anything else looks at the coordinate. The two
 * geometric fields below are built on lattices rather than hashes, so this is
 * what makes their 16-periodicity structural instead of something to check:
 * negative and out-of-tile coordinates land on the same pixel by construction.
 */
const wrapN = (v: number, n: number) => ((v % n) + n) % n;
const wrap32 = (v: number) => wrapN(v, 32);

/**
 * Paving laid in running bond: 16x8 bricks with every other course half-dropped,
 * and the field reads as nearness to a joint. `amount` therefore behaves as
 * mortar weight — the joint lines appear first at low amounts and thicken from
 * there, rather than the surface filling with scatter.
 *
 * Both 16 and 8 divide 32 and the half-drop repeats every two courses, so the
 * pattern closes on the tile in both axes.
 *
 * The 1.5 falloff is load-bearing, not a taste call. It keeps a joint one crisp
 * line wide with a single soft pixel beside it, which is what leaves the
 * strongest shade rarer than the weakest — the sparsity test rejects the other
 * way round. Over the 32px period that is 184 pixels at full strength against
 * 840 below half.
 */
function brickField(x: number, y: number, seed: number): number {
  const SX = 16;
  const SY = 8;
  const px = wrap32(x + (seed & 31));
  const py = wrap32(y + ((seed >>> 4) & 31));
  const ox = (Math.floor(py / SY) % 2) * (SX / 2); // running bond
  const fx = (((px - ox) % SX) + SX) % SX;
  const fy = py % SY;
  const d = Math.min(Math.min(fx, SX - fx), Math.min(fy, SY - fy));
  return 1 - Math.min(1, d / 1.5);
}

/**
 * A half-drop diamond lattice: each 16x16 cell carries a lozenge outline with a
 * medallion at its centre, the classic kilim/carpet motif. Manhattan distance
 * from the cell centre gives the diamond for free — the outline is one ring of
 * that distance, the medallion another.
 *
 * The two rings sit at distances the pixel grid can actually hit (cell centres
 * fall between pixels, so the distance is always a whole number), which is what
 * lets the motif reach full strength instead of washing out.
 */
function carpetField(x: number, y: number, seed: number): number {
  const S = 16;
  const px = wrap32(x + (seed & 31));
  const py = wrap32(y + ((seed >>> 4) & 31));
  const ox = (Math.floor(py / S) % 2) * (S / 2);
  const u = ((((px - ox) % S) + S) % S) - (S - 1) / 2;
  const v = (py % S) - (S - 1) / 2;
  const m = Math.abs(u) + Math.abs(v);
  const medallion = 1 - Math.min(1, Math.abs(m - 2) / 1.5);
  const lozenge = 1 - Math.min(1, Math.abs(m - 8) / 1.5);
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

/**
 * Three pavings traced from Guy Walker's Stagecast seamless-pattern gallery
 * (mirrored at boristhebrave.com/permanent/24/06/cr31/stagecast/wang/patts.html),
 * sources `art/patt/paving2.gif`, `art/icons/cu1.gif`, `art/patt/pav5.gif`.
 *
 * Same encoding as WEAVE — luminance rank, 0 lightest — but 32x32, because the
 * art is. See PERIOD_32 for why that is allowed and what it costs.
 *
 * The rank is ordinal, so it flattens hue differences the source drew with: in
 * `paving3` two faces sit 0.8 luminance apart (#f79779 against #e79f64) and are
 * told apart only by rarity, the 68-pixel tone taking the deeper rank because a
 * sparse tone in pixel art is shading rather than a face. On a one-dimensional
 * ramp they land on adjacent steps instead of reading as two colours.
 */
const PAVING =
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '44444444444222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333444444444444444441111111114' +
  '33333422222222224000041111111114' +
  '33333422222222224000041111111114' +
  '33333422222222224000041111111114' +
  '33333422222222224000041111111114' +
  '44444422222222224444444444444444' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222444444444444444444444422222' +
  '22222400004111111111111111422222' +
  '22222400004111111111111111422222' +
  '22222400004111111111111111422222' +
  '22222400004111111111111111422222' +
  '44444444444111111111111111444444' +
  '22222222224111111111111111400004' +
  '22222222224111111111111111400004' +
  '22222222224111111111111111400004' +
  '22222222224111111111111111400004' +
  '22222222224444444444444444444444';

const PAVING3 =
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '44444443000000000000000344444444' +
  '11111134300000000000003431111114' +
  '11111113430000000000034311111114' +
  '11111111343000000000343111111114' +
  '11111111134300000003431111111114' +
  '11111111113430000034311111111114' +
  '11111111111343000343111111111114' +
  '11111111111134303431111111111114' +
  '11111111111113434311111111111114' +
  '11111111111111343111111111111114' +
  '11111111111113434311111111111114' +
  '11111111111134303431111111111114' +
  '11111111111343000343111111111114' +
  '11111111113430000034311111111114' +
  '11111111134300000003431111111114' +
  '11111111343000000000343111111114' +
  '11111113430000000000034311111114' +
  '11111134300000000000003431111114' +
  '44444443000000000000000344444444' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222244444444444444444442222222';

const PAVING5 =
  '44444444444222222222241111111111' +
  '43333333334222222222241111111111' +
  '33333333333422222222241111111114' +
  '33333333333422222222241111111114' +
  '33333333333342222222241111111143' +
  '33333333333342222222444111111143' +
  '33333333333342222444000444111143' +
  '33333333333334444000000000444433' +
  '43333333334444000000000000000444' +
  '24443334441114000000000000000422' +
  '22224441111111400000000000004222' +
  '22222411111111400000000000004222' +
  '22222411111111140000000000042222' +
  '22222411111111140000000000042222' +
  '22222411111111140000000000042222' +
  '22222411111111114000000000422222' +
  '22222411111111114444444444422222' +
  '22222411111111114333333333422222' +
  '22222411111111143333333333342222' +
  '22222411111111143333333333342222' +
  '22222411111111143333333333342222' +
  '22222411111111433333333333334222' +
  '22224441111111433333333333334222' +
  '24440004441114333333333333333422' +
  '40000000004444333333333333333444' +
  '00000000000004444333333333444400' +
  '00000000000042222444333444111140' +
  '00000000000042222222444111111140' +
  '00000000000042222222241111111140' +
  '00000000000422222222241111111114' +
  '00000000000422222222241111111114' +
  '40000000004222222222241111111111';

/** Every baked table so far tops out at rank 4; `shades` rescales onto the caller's ramp. */
const BAKED_RANKS = 4;

/**
 * Baked art names its shade outright instead of being thresholded into one: the
 * tones are already a ramp, so `amount` scales that ramp — full pattern at 1,
 * flattening toward the bare terrain as it drops.
 *
 * `size` is the table's own edge length, which is also its output-pixel period,
 * so the seed offset has to wrap at `size` rather than at 16 — offsetting a
 * 32-wide table by a 0..15 amount would sample the wrong half of it.
 */
function bakedShade(
  table: string,
  size: number,
  x: number,
  y: number,
  seed: number,
  amount: number,
  shades: number
): number {
  // The shift stays at 4 rather than widening with `size` so that weave, the
  // table this generalises, keeps the exact seed-to-offset mapping its locked
  // sheet hashes were taken with.
  const m = size - 1;
  const px = wrapN(x + (seed & m), size);
  const py = wrapN(y + ((seed >>> 4) & m), size);
  const rank = table.charCodeAt(py * size + px) - 48;
  const k = Math.round((rank * shades * Math.min(1, amount)) / BAKED_RANKS);
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
  if (texture === 'weave') return bakedShade(WEAVE, 16, x, y, s, amount, shades);
  if (texture === 'paving') return bakedShade(PAVING, 32, x, y, s, amount, shades);
  if (texture === 'paving3') return bakedShade(PAVING3, 32, x, y, s, amount, shades);
  if (texture === 'paving5') return bakedShade(PAVING5, 32, x, y, s, amount, shades);
  const n = texture === 'ripple' ? rippleField(x, y, s)
    : texture === 'cells' ? cellsField(x, y, s, 2)
      : texture === 'medium_cells' ? cellsField(x, y, s, 3)
        : texture === 'small_cells' ? cellsField(x, y, s, 4)
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
