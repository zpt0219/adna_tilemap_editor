// patternRibbon.ts — the outline band treated as a ribbon-shaped canvas.
//
// The outline is `outlineWidth` pixels wide, it follows the silhouette, and left
// flat it reads as a drawn-on marker line. Everything here paints inside it.
//
// Separate from the band grain in patternNoise, which erodes the band by moving
// painted pixels between levels. This decorates the line rather than eating it,
// so a grained pixel is skipped by the motif — see the paint loop.
//
// Ribbon space is two coordinates, both supplied by blob47Pattern:
//
//   s      — distance ALONG the edge, in output pixels. Not true arc length,
//            which is a global quantity a tile cannot know: it is the world
//            coordinate picked by the local tangent's orientation class, which
//            IS exact arc length along any straight run and only jumps phase
//            where the orientation class changes (see patternBandCoords).
//   depth  — position ACROSS the ribbon, 0 at the terrain-B face and 1 at the
//            terrain-A face, whatever the width.
//
// Both are pure functions of global position, so the seam rule in
// blob47-seam-safety holds here exactly as it does for the terrain textures.
//
// Motifs are authored in (s, depth) rather than borrowed from the terrain
// library because a 2px-tall strip of a 32x32 paving is not a paving — the
// eight below are drawn for a ribbon. The `along_*` ids are the exception, and
// they are the reason ribbon space is worth having: a 2-D texture sampled at
// (s, depth) comes out running ALONG the edge instead of across it, so
// `brick_wall` becomes a single course of bricks laid down the shoreline.

import { textureShadeAt, type TextureId } from './patternTexture';
import type { RGB } from './patternPaint';

export type RibbonId =
  | 'none'
  | 'bevel' | 'dashes' | 'ticks' | 'beads' | 'rope' | 'wave' | 'grain' | 'speckle'
  | 'along_brick_wall' | 'along_cobbles2' | 'along_weave'
  | 'along_stone_floor' | 'along_breeze_block' | 'along_octagonal';

/** Which 2-D texture each `along_*` id lays down the axis. */
const ALONG_SOURCE: Partial<Record<RibbonId, TextureId>> = {
  along_brick_wall: 'brick_wall',
  along_cobbles2: 'cobbles2',
  along_weave: 'weave',
  along_stone_floor: 'stone_floor',
  along_breeze_block: 'breeze_block',
  along_octagonal: 'octagonal',
};

/**
 * The narrowest outline each motif still reads at, in output pixels. A bevel
 * needs two faces, a bead needs a middle; below that they collapse into a
 * flat line and the control lies about what it does, so the UI greys them out
 * rather than letting the user wonder.
 */
export const RIBBON_MIN_WIDTH: Record<RibbonId, number> = {
  none: 1,
  bevel: 2, dashes: 1, ticks: 2, beads: 3, rope: 3, wave: 3, grain: 1, speckle: 1,
  along_brick_wall: 3, along_cobbles2: 3, along_weave: 3,
  along_stone_floor: 3, along_breeze_block: 3, along_octagonal: 3,
};

export const RIBBON_GROUPS: readonly {
  zh: string; en: string;
  items: readonly { id: RibbonId; zh: string; en: string }[];
}[] = [
  {
    zh: '带内花纹', en: 'Ribbon motifs',
    items: [
      { id: 'none', zh: '纯色 · 不加花纹', en: 'Flat — no motif' },
      { id: 'bevel', zh: '倒角 · 内亮外暗', en: 'Bevel — lit inside, dark out' },
      { id: 'dashes', zh: '虚线 · 等距断口', en: 'Dashes — evenly broken' },
      { id: 'ticks', zh: '齿纹 · 垂直短划', en: 'Ticks — perpendicular strokes' },
      { id: 'beads', zh: '珠链 · 等距圆点', en: 'Beads — dots along the edge' },
      { id: 'rope', zh: '缆绳 · 斜向绞纹', en: 'Rope — slanted twist' },
      { id: 'wave', zh: '波浪 · 起伏高光', en: 'Wave — undulating highlight' },
      { id: 'grain', zh: '颗粒 · 带内碎点', en: 'Grain — scatter in the ribbon' },
      { id: 'speckle', zh: '沿边细点 · 均匀', en: 'Speckle — even fine dots' },
    ],
  },
  {
    zh: '沿轴纹理', en: 'Textures laid along the axis',
    items: [
      { id: 'along_brick_wall', zh: '砖墙 · 沿边一列砖', en: 'Brick wall — one course' },
      { id: 'along_cobbles2', zh: '细密砖 · 沿边小块', en: 'Cobbles — fine bricks' },
      { id: 'along_weave', zh: '编织 · 沿边菱格', en: 'Weave — diagonal braid' },
      { id: 'along_stone_floor', zh: '石板 · 沿边不规则块', en: 'Stone — irregular slabs' },
      { id: 'along_breeze_block', zh: '通风砖 · 沿边细孔', en: 'Breeze block — perforated' },
      { id: 'along_octagonal', zh: '八边形 · 沿边切角砖', en: 'Octagonal — chamfered' },
    ],
  },
];

export const RIBBONS = RIBBON_GROUPS.flatMap((g) => g.items);

/**
 * A bevel by default rather than a flat line. It costs no parameters, it is
 * what pixel art does to a two-pixel outline anyway, and it is the single
 * change that stops a thick outline reading as a marker stroke.
 */
export const DEFAULT_RIBBON: RibbonId = 'bevel';
export const DEFAULT_RIBBON_AMOUNT = 0.5;
export const DEFAULT_RIBBON_SHADES = 2;
export const MIN_RIBBON_SHADES = 1;
export const MAX_RIBBON_SHADES = 3;
/**
 * Divisors of the tile size, and nothing else. `s` is a LOCAL coordinate that
 * differs from the global one by a multiple of 32 (see patternBandCoords),
 * so only a period dividing 32 keeps its phase across a seam — at period 6 a
 * dashed outline would visibly restart at every tile boundary. 32 itself is
 * left out: one repeat per tile is a stripe, not a motif.
 */
export const RIBBON_PERIODS = [2, 4, 8, 16] as const;
export const DEFAULT_RIBBON_PERIOD = 8;

/** Snap an arbitrary period onto the seam-safe set, for stored settings. */
export const snapRibbonPeriod = (p: number): number =>
  RIBBON_PERIODS.reduce((best, v) => (Math.abs(v - p) <= Math.abs(best - p) ? v : best), RIBBON_PERIODS[0]);

/**
 * Motifs with no repeat of their own along the edge, so the period control is
 * inert for them. The `along_*` ids are here too: their repeat is the source
 * table's, which is already a divisor of the tile.
 */
const APERIODIC: readonly RibbonId[] = [
  'none', 'bevel', 'grain', 'speckle',
  'along_brick_wall', 'along_cobbles2', 'along_weave',
  'along_stone_floor', 'along_breeze_block', 'along_octagonal',
];
export const ribbonUsesPeriod = (id: RibbonId) => !APERIODIC.includes(id);

/** Motifs whose depth split can be flipped; the others ignore `invert`. */
const FLIPPABLE: readonly RibbonId[] = ['bevel', 'wave', 'rope'];
export const ribbonUsesInvert = (id: RibbonId) => FLIPPABLE.includes(id);

/**
 * What is painted inside the outline. Shaped like TextureOptions on purpose —
 * both quantise a field into `0..shades` and both hand that to `textureRamp`,
 * so the swatch row and the colour-override plumbing are the same code.
 */
export interface RibbonOptions {
  algo: RibbonId;
  /** Duty cycle for the periodic motifs, shade scale for the rest. */
  amount: number;
  /** Repeat along the edge, in output pixels. Inert for the aperiodic motifs. */
  period: number;
  shades: number;
  seed: number;
  /** Mirrors the depth split, so a bevel can be lit from either face. */
  invert: boolean;
  /** What the ramp walks toward; omitted derives it from the outline colour. */
  colour?: RGB;
  /** Sparse per-step overrides, indexed from the bare outline colour at 0. */
  ramp?: readonly (RGB | undefined)[];
}

export const NO_RIBBON: RibbonOptions = {
  algo: 'none',
  amount: 0,
  period: DEFAULT_RIBBON_PERIOD,
  shades: DEFAULT_RIBBON_SHADES,
  seed: 0,
  invert: false,
};

/** Salt so a ribbon and a terrain on the same seed do not share a phase. */
const RIBBON_SALT = 0x2c9f;

function hash01(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Positive remainder; `s` is negative on half the tiles. */
const modp = (v: number, m: number) => ((v % m) + m) % m;

/**
 * Which ribbon shade a pixel takes: 0 for the plain outline colour, 1..shades
 * for progressively stronger ones — the same contract `textureShadeAt` has, so
 * both feed the same `textureRamp` and the same swatch row.
 *
 * `depth` is clamped by the caller to [0, 1]; `widthPx` is how many output
 * pixels that spans, which the motifs that think in pixels (beads, grain, the
 * along_* strips) need and the fractional ones ignore.
 */
export function ribbonShadeAt(
  id: RibbonId,
  s: number,
  depth: number,
  widthPx: number,
  seed: number,
  amount: number,
  shades: number,
  period: number,
  invert: boolean
): number {
  if (id === 'none' || amount <= 0 || shades < 1) return 0;
  const sd = (seed ^ RIBBON_SALT) >>> 0;
  const isFlipped = id === 'bevel' ? !invert : invert;
  const dp = isFlipped && ribbonUsesInvert(id) ? 1 - depth : depth;
  const T = Math.max(1, period);
  // A seeded phase shift slides the motif along the edge. Only the phase moves:
  // the period has to stay put or the dice would change the design, not the
  // arrangement. Whole pixels, and the same everywhere, so it cannot disturb the
  // congruence that keeps `s` usable across a seam.
  const sp = s + (sd % 32);
  const cap = (k: number) => Math.max(0, Math.min(shades, k));

  const src = ALONG_SOURCE[id];
  if (src) {
    // The strip is sampled at its own resolution: `depth` spans the ribbon, so
    // a 4px outline shows four rows of the source table however wide the table
    // is, and the motif runs along the edge rather than across it.
    const ty = Math.min(widthPx - 1, Math.floor(dp * widthPx));
    return textureShadeAt(src, Math.floor(sp), ty, seed, amount, shades);
  }

  switch (id) {
    case 'bevel': {
      // Stepped across the width: at 2px this is one plain face and one lit
      // face, and it grows into a real gradient as the outline thickens.
      const k = Math.floor(dp * (shades + 1));
      return cap(Math.round(Math.min(shades, k) * amount));
    }
    case 'dashes': {
      // `amount` is the duty cycle, so the control reads as "how much of the
      // edge is dash" rather than as an opacity.
      return modp(sp, T) < T * amount ? shades : 0;
    }
    case 'ticks': {
      // A stroke stays one pixel wide whatever the strength — that is what
      // separates it from a dash — so `amount` spends itself on the shade.
      return modp(sp, T) < 1 ? cap(Math.round(shades * amount)) : 0;
    }
    case 'beads': {
      const ds = modp(sp + T / 2, T) - T / 2;
      const dd = (dp - 0.5) * widthPx;
      const r = Math.max(1, amount * Math.min(T / 2, widthPx / 2));
      const q = Math.sqrt(ds * ds + dd * dd);
      if (q > r) return 0;
      // One softer ring inside the rim so a bead reads as round rather than as
      // a square block, which is all a two-shade ramp can give it.
      return q > r - 1 ? cap(shades - 1) : shades;
    }
    case 'rope': {
      // The slant is one ribbon width per period, which is what makes the
      // strands look like they wrap rather than like leaning stripes.
      const u = modp(sp + dp * widthPx, T) / T;
      if (u >= amount) return 0;
      const t = amount <= 0 ? 0 : u / amount;
      return cap(1 + Math.floor((shades - 1) * (1 - Math.abs(2 * t - 1))));
    }
    case 'wave': {
      // The bevel's split line, pushed up and down the width as it runs.
      const split = 0.5 + 0.35 * Math.sin((2 * Math.PI * sp) / T);
      return dp > split ? cap(Math.round(shades * amount)) : 0;
    }
    case 'grain': {
      const n = hash01(Math.floor(sp), Math.floor(dp * widthPx), sd);
      const cut = 1 - Math.min(1, amount);
      if (n < cut) return 0;
      const u = cut >= 1 ? 1 : (n - cut) / (1 - cut);
      return Math.min(shades, 1 + Math.floor(shades * u * u));
    }
    case 'speckle': {
      // Grain's even-coverage sibling: a checker offset by row, thinned by
      // amount, which lands dots along the edge instead of in clumps.
      const ix = Math.floor(sp);
      const iy = Math.floor(dp * widthPx);
      if (((ix + iy) & 1) === 1) return 0;
      return hash01(ix, iy, sd ^ 0x51) < amount * 2 ? shades : 0;
    }
    default:
      return 0;
  }
}

/**
 * Which ribbon shades a motif actually paints, for greying out the swatches
 * that have nothing on screen. Scanned rather than derived for the same reason
 * `usedTextureShades` is: `amount` means a duty cycle to one motif and a shade
 * scale to another, and keeping a second copy of that would get one wrong.
 */
export function usedRibbonShades(
  id: RibbonId,
  widthPx: number,
  amount: number,
  shades: number,
  period: number,
  invert: boolean
): Set<number> {
  const used = new Set<number>();
  if (id === 'none') return used;
  const w = Math.max(1, Math.round(widthPx));
  const span = Math.max(32, Math.ceil(period) * 4);
  for (let i = 0; i < span; i++) {
    for (let j = 0; j < w; j++) {
      const depth = (j + 0.5) / w;
      used.add(ribbonShadeAt(id, i, depth, w, 0, amount, shades, period, invert));
    }
  }
  return used;
}
