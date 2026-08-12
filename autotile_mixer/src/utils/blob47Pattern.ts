// blob47Pattern.ts — the built-in boundary patterns, one 32x32 grid per
// canonical blob47 mask (docs/AUTOTILE_SCHEMES.md §5).
//
// A pattern is ART DATA, baked once; nothing here is derived at runtime. Each
// cell is a LEVEL naming a (role, shaded) pair, so a caller supplies ONE colour
// per role and shadeColour() produces the shaded variants from the recipes
// below.
//
// The grids live in ./patterns, synthesised from the distance field and stored
// compactly. patternPaint.test.ts locks every pattern's pixels.

import { GENERATED_FIELDS } from './patterns/generated';

export type PatternRole = 'terrainA' | 'terrainB' | 'edge';

export type PatternId =
  | 'square' | 'sharp' | 'rounded' | 'wave'
  | 'jagged' | 'gravel' | 'boulder' | 'thorn' | 'coast' | 'moss' | 'billow';

/** Outline width limits, in pixels of the 32px tile. */
export const MIN_OUTLINE_WIDTH = 1;
export const MAX_OUTLINE_WIDTH = 6;
export const OUTLINE_WIDTH_STEP = 0.5;
export const DEFAULT_OUTLINE_WIDTH = 2.0;

/**
 * Menu contents, grouped. The "clean" group thresholds the distance field
 * directly; the "textured" group displaces it with tile-periodic noise first,
 * which is what gives those their irregular silhouettes.
 */
export const PATTERN_GROUPS: readonly {
  zh: string; en: string;
  items: readonly { id: PatternId; zh: string; en: string }[];
}[] = [
  {
    zh: '规整边缘', en: 'Clean edges',
    items: [
      { id: 'square', zh: '纯直角 · 方角描边', en: 'Square — 90° right angles' },
      { id: 'rounded', zh: '圆润 · 全四级过渡', en: 'Rounded — soft corners, full ramp' },
      { id: 'sharp', zh: '硬边 · 弧角描边', en: 'Sharp — rounded corners, outline' },
      { id: 'wave', zh: '波浪 · 规则圆弧边', en: 'Wave — regular circular arc edge' },
    ],
  },
  {
    zh: '不规则边缘', en: 'Irregular edges',
    items: [
      { id: 'jagged', zh: '粗糙 · 岩石碎边', en: 'Jagged — rough rocky edge' },
      { id: 'gravel', zh: '砂砾 · 细碎颗粒边', en: 'Gravel — fine crumbling edge' },
      { id: 'boulder', zh: '巨砾 · 大块起伏', en: 'Boulder — large rolling masses' },
      { id: 'billow', zh: '云絮 · 扇贝鼓边', en: 'Billow — scalloped bulges' },
      { id: 'coast', zh: '海岸 · 多层碎屑', en: 'Coast — multi-scale fractal edge' },
      { id: 'moss', zh: '苔藓 · 团簇细胞', en: 'Moss — clustered cellular edge' },
      { id: 'thorn', zh: '荆棘 · 尖刺边', en: 'Thorn — spiky ridged edge' },
    ],
  },
];

/** Flattened, in menu order. */
export const PATTERNS = PATTERN_GROUPS.flatMap((g) => g.items);

export const DEFAULT_PATTERN: PatternId = 'rounded';

/** What each level takes its colour from. */
/** Transition-band steps: the colours strictly between the two solid terrains. */
export const MIN_BAND_STEPS = 3;
export const MAX_BAND_STEPS = 5;
export const DEFAULT_BAND_STEPS = 3;

/** Width of each added step, in pixels of the 32-space field. */
export const BAND_STEP_PX = 2;

/**
 * What each level takes its colour from: a role, and how strongly that role's
 * shade recipe is applied (0 = the picked colour untouched, 1 = full shade).
 *
 * Extra steps go on the terrain-A side, fading from the full shade next to the
 * outline back toward clean terrain. Keeping them all on that side leaves the
 * band's outer edge — and with it the entire usable offset range — exactly
 * where it sits at three steps, so nothing downstream has to be re-measured.
 */
export function patternLevelsFor(
  steps: number = DEFAULT_BAND_STEPS
): readonly { role: PatternRole; shade: number }[] {
  const inner = Math.max(1, steps - 2); // shade steps on the terrain-A side
  const out: { role: PatternRole; shade: number }[] = [
    { role: 'terrainB', shade: 0 }, // open field
    { role: 'terrainB', shade: 1 }, // field side of the outline
    { role: 'edge', shade: 0 },     // the outline itself
  ];
  for (let k = inner; k >= 1; k--) out.push({ role: 'terrainA', shade: k / inner });
  out.push({ role: 'terrainA', shade: 0 }); // solid interior
  return out;
}

export const PATTERN_LEVELS = patternLevelsFor(DEFAULT_BAND_STEPS);

/**
 * How each role derives its shaded variant, in HSV. `hue` is added to the base
 * hue, or used as an absolute hue when the base is achromatic — which is what
 * lets a plain white terrain still pick up the cool rim tint instead of coming
 * out flat grey.
 *
 * terrainB shades the way pixel art conventionally does — darker, more
 * saturated, hue nudged along; terrainA keeps its brightness and picks up a
 * cool cast, reading as the outline bleeding inward. Shared by every pattern so
 * a palette carries across when you switch between them.
 */
export const SHADE_RECIPES: Record<
  PatternRole,
  { hue: number; greyHue: number; sat: number; val: number }
> = {
  // `hue` is a shift applied to the base's own hue. `greyHue` is the absolute
  // hue used when the base has none to shift — the two are separate fields on
  // purpose: collapsing them into one number means a saturated terrain gets
  // *rotated* by what was only ever meant as a tint for a grey one, which turns
  // a deep blue into magenta.
  terrainA: { hue: 0, greyHue: 0.541667, sat: 0.129032, val: 1.000000 },
  terrainB: { hue: 0.012037, greyHue: 0.012037, sat: 0.166667, val: 0.888889 },
  edge: { hue: 0, greyHue: 0, sat: 0, val: 1 }, // the outline has no shaded level
};

export const PATTERN_TILE_SIZE = 32;

/** Background: every pixel is unshaded terrain B (drawn where no tile applies). */
export const PATTERN_BACKGROUND = '0'.repeat(PATTERN_TILE_SIZE * PATTERN_TILE_SIZE);

// --- stored field ---------------------------------------------------------
/** Quantisation of the stored distance field, in pixels of the 32px tile. */
export const FIELD_STEP = 0.25;
/**
 * Digits of the stored field, least distance first: printable ASCII 35..126
 * less `'` and `\`, which would need escaping inside the generated string
 * literals. 90 digits at FIELD_STEP covers 22.25px.
 *
 * Base-62 was enough while a tile was 16px, where it reached 15.25. At 32 a
 * pixel is half as wide, so every distance doubles: boulder's outermost band is
 * 14 and the offset slider adds up to 2.5 on top, which base-62 could not have
 * represented — the field would have saturated inside the band and flattened it.
 */
export const FIELD_CHARS = (() => {
  let s = '';
  for (let c = 35; c <= 126; c++) {
    if (c === 39 || c === 92) continue;
    s += String.fromCharCode(c);
  }
  return s;
})();

const CHAR_VALUE: number[] = (() => {
  const t = new Array<number>(128).fill(0);
  for (let i = 0; i < FIELD_CHARS.length; i++) t[FIELD_CHARS.charCodeAt(i)] = i;
  return t;
})();

/**
 * Where each pattern puts its four level boundaries, as distances in pixels
 * from the terrain-B side. Every value is a multiple of FIELD_STEP so the
 * field's floor-quantisation cannot straddle one.
 */
export const PATTERN_BANDS: Record<PatternId, readonly [number, number, number, number]> = {
  square: [7, 9, 11, 13],
  sharp: [7, 9, 11, 13],
  rounded: [7, 9, 11, 13],
  wave: [7, 9, 11, 13],
  jagged: [7, 9, 11, 13],
  gravel: [7, 9, 11, 13],
  boulder: [8, 10, 12, 14],
  thorn: [7.5, 9, 10, 12],
  coast: [7.5, 9.5, 11.5, 13.5],
  moss: [7, 9, 11, 13],
  billow: [7, 9, 11, 13],
};

/**
 * How far the band may be slid, in pixels: [toward the cell centre, toward the
 * cell border]. Both ends are measured, not guessed —
 *   * the positive end stops before the boundary reaches the cell border, where
 *     it would be clipped into a straight line against the neighbouring tile;
 *   * the negative end stops before the smallest island (mask 0) disappears
 *     completely and a painted cell renders as nothing. Islands *thinning* on
 *     the way there is a legitimate look, so only vanishing is a hard stop.
 * Patterns with big noise amplitude or heavy corner rounding have little room,
 * which is why the range is per pattern rather than global.
 *
 * Re-derived when the field moved to 32px rather than doubled: the positive end
 * carries a fixed FIELD_STEP of slack, which is half as wide relative to a
 * 32-space pixel, so square gains 6.25 where doubling would have said 5.5.
 */
export const PATTERN_OFFSET_RANGE: Record<PatternId, readonly [number, number]> = {
  square: [-8.5, 6.25],
  sharp: [-8.5, 6.25],
  rounded: [-3.75, 2.75],
  wave: [-3.75, 2.75],
  jagged: [-5.5, 1.0],
  gravel: [-5.25, 1.5],
  boulder: [-4.0, 1.25],
  thorn: [-4.5, 1.25],
  coast: [-3.75, 2.25],
  moss: [-5.75, 1.0],
  billow: [-2.75, 1.0],
};

const FIELDS: Record<PatternId, Record<number, string>> = {
  square: GENERATED_FIELDS.square,
  sharp: GENERATED_FIELDS.sharp,
  rounded: GENERATED_FIELDS.rounded,
  wave: GENERATED_FIELDS.rounded,
  jagged: GENERATED_FIELDS.jagged,
  gravel: GENERATED_FIELDS.gravel,
  boulder: GENERATED_FIELDS.boulder,
  thorn: GENERATED_FIELDS.thorn,
  coast: GENERATED_FIELDS.coast,
  moss: GENERATED_FIELDS.moss,
  billow: GENERATED_FIELDS.billow,
};

/** Bounded by the art itself: 10 patterns x 47 canonical masks. */
const FIELD_CACHE = new Map<string, string>();

/**
 * Level grids are keyed by every knob that changes them — offset, tile size,
 * step count, hard edge, seed — so unlike FIELD_CACHE the key space is
 * unbounded. One drag of the band-position slider mints 41 offsets x 47 masks,
 * and every roll of the edge-seed dice mints 47 more that nothing will ever ask
 * for again. Left uncapped it only ever grows.
 *
 * A working set is the 47 masks of one configuration, so this holds about 20 of
 * them — enough to drag a slider back and forth without re-thresholding. At
 * 32px a grid is 1024 chars, putting the ceiling near 2 MB.
 */
export const LEVEL_CACHE_MAX = 1024;
const LEVEL_CACHE = new Map<string, string>();

/** Exposed for the eviction test; nothing in the app needs it. */
export const levelCacheSize = () => LEVEL_CACHE.size;

/** A hit re-inserts, which is what makes Map's insertion order an LRU order. */
function levelCacheGet(key: string): string | undefined {
  const hit = LEVEL_CACHE.get(key);
  if (hit === undefined) return undefined;
  LEVEL_CACHE.delete(key);
  LEVEL_CACHE.set(key, hit);
  return hit;
}

function levelCacheSet(key: string, value: string): void {
  LEVEL_CACHE.set(key, value);
  while (LEVEL_CACHE.size > LEVEL_CACHE_MAX) {
    const oldest = LEVEL_CACHE.keys().next();
    if (oldest.done) break;
    LEVEL_CACHE.delete(oldest.value);
  }
}

/** Flat 256-char distance field for a canonical mask. */
export function patternFieldForMask(pattern: PatternId, mask: number): string {
  const key = `${pattern}:${mask}`;
  let flat = FIELD_CACHE.get(key);
  if (flat === undefined) {
    const raw = FIELDS[pattern]?.[mask];
    if (raw === undefined) throw new Error(`blob47Pattern: no art for ${pattern} mask ${mask}`);
    flat = raw.replace(/\s+/g, '');
    FIELD_CACHE.set(key, flat);
  }
  return flat;
}

/**
 * The level thresholds for a given step count. The stored four are the
 * three-step case; further steps are appended one BAND_STEP_PX deeper each,
 * growing the band into terrain A and leaving its outer edge untouched.
 */
export function bandsFor(
  pattern: PatternId,
  steps: number = DEFAULT_BAND_STEPS,
  hardEdgeB = false,
  outlineWidth?: number
): number[] {
  const base = PATTERN_BANDS[pattern];
  const adjusted = [...base] as [number, number, number, number];
  if (outlineWidth !== undefined) {
    const mid = (base[1] + base[2]) / 2;
    const wShadeB = base[1] - base[0];
    const wShadeA = base[3] - base[2];
    // The outline grows about the drawn boundary, but `base[0]` is PINNED: it is
    // the band's outer edge, and every offset limit and displacement budget in
    // this file was measured against it. Letting the width push it outward broke
    // the inset invariant outright — at the maximum offset a 3px outline put
    // 5196 band pixels on open cell borders, where the neighbour draws plain
    // terrain and the boundary reads as a straight clipped line.
    //
    // So the terrain-B ring is what gives way. It is squeezed to nothing and
    // then the outline slides inward, keeping the width that was asked for
    // rather than being clipped to fit.
    adjusted[1] = Math.max(base[0], mid - outlineWidth / 2);
    adjusted[2] = adjusted[1] + outlineWidth;
    adjusted[0] = Math.max(base[0], adjusted[1] - wShadeB);
    adjusted[3] = adjusted[2] + wShadeA;
  }
  const extra = Math.max(0, Math.min(MAX_BAND_STEPS, steps) - MIN_BAND_STEPS);
  const out: number[] = [...adjusted];
  for (let k = 1; k <= extra; k++) out.push(adjusted[3] + BAND_STEP_PX * k);
  if (!hardEdgeB) return out;
  // Collapse the terrain-B shade so open terrain meets the outline with nothing
  // in between, and pull the rest out by the width that freed up — the outline
  // keeps the weight the pattern was authored with rather than absorbing it.
  // `out[0]` is untouched, which is what keeps every offset limit valid.
  const w = out[1] - out[0];
  return out.map((b, i) => (i === 0 ? b : b - w));
}

/** The outline's own width, in output pixels — how wide the ribbon canvas is. */
export function outlineWidthPx(
  pattern: PatternId,
  steps: number = DEFAULT_BAND_STEPS,
  hardEdgeB = false,
  outlineWidth?: number,
  tileSize: number = PATTERN_TILE_SIZE
): number {
  const b = bandsFor(pattern, steps, hardEdgeB, outlineWidth);
  return ((b[2] - b[1]) * tileSize) / PATTERN_TILE_SIZE;
}

/**
 * How many levels the grain may move a pixel, for a given step count.
 *
 * Coverage already scales on its own — a wider band simply has more pixels in
 * it. What does not scale is the displacement: a fixed one-level nudge is a
 * smaller and smaller fraction of the band as steps are added, and on the
 * terrain-A side consecutive shades are close enough that it stops reading at
 * all. So the span grows with the band's width, keeping the grain the same
 * strength relative to the gradient it sits in.
 *
 * Capped at two: past that a single grain pixel would jump most of the way
 * across the band and read as confetti rather than a dissolving edge.
 */
export function bandNoiseSpan(pattern: PatternId, steps: number = DEFAULT_BAND_STEPS): number {
  const width = (n: number) => {
    const b = bandsFor(pattern, n);
    return b[b.length - 1] - b[0];
  };
  const base = width(MIN_BAND_STEPS);
  if (base <= 0) return 1;
  return Math.max(1, Math.min(2, Math.round(width(steps) / base)));
}

/** Clamp an offset into what the pattern can actually take. */
export function clampOffset(pattern: PatternId, offsetPx: number): number {
  const [lo, hi] = PATTERN_OFFSET_RANGE[pattern];
  return Math.max(lo, Math.min(hi, offsetPx));
}

/**
 * Patterns whose silhouette was baked from a noise-displaced field. Only these
 * take a re-roll: jittering `sharp` or `rounded` would not be a variation of
 * them, it would be a different pattern wearing their name.
 */
export const RESEEDABLE_PATTERNS: ReadonlySet<PatternId> = new Set<PatternId>([
  'wave', 'jagged', 'gravel', 'boulder', 'thorn', 'coast', 'moss', 'billow',
]);

/**
 * How far a re-roll may push the boundary, in pixels of the field.
 *
 * This is the one number that keeps runtime field displacement safe, so the
 * derivation matters. The inset invariant is that a pixel on an OPEN cell edge
 * must stay level 0, i.e. `d < bands[0]` — the neighbour draws plain terrain B
 * there, and a boundary reaching the border gets clipped into a straight line.
 *
 * `PATTERN_OFFSET_RANGE`'s positive end was measured as
 * `hi = floor((bands[0] - mx - FIELD_STEP) / FIELD_STEP) * FIELD_STEP`, where
 * `mx` is the largest stored field value on any open edge. So
 * `mx + hi <= bands[0] - FIELD_STEP`. Adding a displacement bounded by `A`:
 *
 *     mx + off + A <= (bands[0] - FIELD_STEP - hi) + off + A
 *
 * which stays under `bands[0]` whenever `A <= hi - off`. Negative offsets only
 * buy more room, hence the `max(0, off)`.
 *
 * The consequence to know about: pushing the band all the way toward the border
 * spends the whole budget, and the re-roll goes quiet. That is not a bug to fix
 * — it is the same headroom being asked for twice.
 *
 */
export function edgeJitterAmplitude(pattern: PatternId, offsetPx = 0): number {
  if (!RESEEDABLE_PATTERNS.has(pattern)) return 0;
  const [, hi] = PATTERN_OFFSET_RANGE[pattern];
  return Math.max(0, hi - Math.max(0, clampOffset(pattern, offsetPx)));
}

/**
 * Tile-periodic value noise over the field, in [-1, 1].
 *
 * The lattice is expressed as cells per tile, so it repeats with the tile and
 * every seam stays continuous whatever PATTERN_TILE_SIZE is.
 */
function edgeNoise(u: number, v: number, seed: number): number {
  const per = 4;
  const fx = (u / PATTERN_TILE_SIZE) * per;
  const fy = (v / PATTERN_TILE_SIZE) * per;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const fade = (t: number) => t * t * (3 - 2 * t);
  const tx = fade(fx - x0);
  const ty = fade(fy - y0);
  const h = (ix: number, iy: number) => {
    const wx = ((ix % per) + per) % per;
    const wy = ((iy % per) + per) % per;
    let n = Math.imul(wx, 374761393) + Math.imul(wy, 668265263) + Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const a = h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx;
  const b = h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Bilinear sample of a stored field, in field pixel-centre coordinates
 * (sample `i` sits at u = i). Out-of-range reads clamp to the edge; the
 * boundary is always inset well away from the tile border, so the replicated
 * half-pixel never lands anywhere the transition band can reach.
 */
function sampleField(field: string, u: number, v: number): number {
  const N = Math.sqrt(field.length) | 0;
  const scale = N / PATTERN_TILE_SIZE;
  const fu = u * scale;
  const fv = v * scale;
  const x0 = Math.floor(fu);
  const y0 = Math.floor(fv);
  const tx = fu - x0;
  const ty = fv - y0;
  const cl = (n: number) => (n < 0 ? 0 : n > N - 1 ? N - 1 : n);
  const gx0 = cl(x0), gx1 = cl(x0 + 1), gy0 = cl(y0), gy1 = cl(y0 + 1);
  const g = (x: number, y: number) => CHAR_VALUE[field.charCodeAt(y * N + x)];
  const a = g(gx0, gy0) * (1 - tx) + g(gx1, gy0) * tx;
  const b = g(gx0, gy1) * (1 - tx) + g(gx1, gy1) * tx;
  return (a * (1 - ty) + b * ty) * FIELD_STEP;
}

/**
 * Flat level grid (digits 0..4), `tileSize` squared, for a canonical mask, with
 * the transition band slid by `offsetPx` — positive toward the cell border,
 * negative toward its centre. `mask < 0` is the background tile.
 *
 * `tileSize` defaults to PATTERN_TILE_SIZE, where the sample points land exactly
 * on the stored ones and the interpolation degenerates to a plain lookup. Asking
 * for anything else resamples and thresholds at that resolution rather than
 * scaling the level grid — the point of storing a field is that distance is
 * smooth and interpolates, so a boundary stays genuinely resolved instead of
 * turning into blocks. Bands are in field units, so the art scales with it.
 */
export function patternLevelsForMask(
  pattern: PatternId,
  mask: number,
  offsetPx = 0,
  tileSize: number = PATTERN_TILE_SIZE,
  bandSteps: number = DEFAULT_BAND_STEPS,
  hardEdgeB = false,
  edgeSeed = 0,
  outlineWidth?: number
): string {
  if (mask < 0) return '0'.repeat(tileSize * tileSize);
  const off = clampOffset(pattern, offsetPx);
  // Seed 0 means "the silhouette exactly as baked", so the whole displacement
  // drops out rather than being computed and multiplied by zero.
  const amp = edgeSeed === 0 ? 0 : edgeJitterAmplitude(pattern, off);
  const owKey = outlineWidth !== undefined ? outlineWidth : '';
  const key = `${pattern}:${mask}:${off}:${tileSize}:${bandSteps}:${hardEdgeB}:${amp > 0 ? edgeSeed : 0}:${owKey}`;
  let levels = levelCacheGet(key);
  if (levels === undefined) {
    const field = patternFieldForMask(pattern, mask);
    const bands = bandsFor(pattern, bandSteps, hardEdgeB, outlineWidth);
    const scale = PATTERN_TILE_SIZE / tileSize;
    let out = '';
    for (let y = 0; y < tileSize; y++) {
      const v = (y + 0.5) * scale - 0.5;
      for (let x = 0; x < tileSize; x++) {
        const u = (x + 0.5) * scale - 0.5;
        const dBase = sampleField(field, u, v);
        let waveOffset = 0;
        if (pattern === 'wave') {
          let wavelength = 16;
          let presetAmp = 1.4;
          let phase = 0;
          if (edgeSeed !== 0) {
            let n1 = Math.imul(edgeSeed, 374761393) ^ 0x1f3b2a;
            n1 = Math.imul(n1 ^ (n1 >>> 13), 1274126177);
            const hash = Math.abs(n1 ^ (n1 >>> 16));

            wavelength = (hash & 1) === 0 ? 16 : 32;
            presetAmp = 1.3 + (hash % 8) * 0.1;
            phase = (hash % 13);
          }

          const headroom = edgeJitterAmplitude('wave', off);
          const waveAmp = Math.max(0, Math.min(presetAmp, headroom));

          // Sample field gradient to project wave along edge direction
          const gx = sampleField(field, u + 0.5, v) - sampleField(field, u - 0.5, v);
          const gy = sampleField(field, u, v + 0.5) - sampleField(field, u, v - 0.5);
          const lenSq = gx * gx + gy * gy;
          let wy2 = 1.0;
          let wx2 = 0.0;
          if (lenSq > 1e-4) {
            wy2 = (gy * gy) / lenSq;
            wx2 = (gx * gx) / lenSq;
          }

          const wu = Math.sin((2 * Math.PI * (u + phase)) / wavelength);
          const wv = Math.sin((2 * Math.PI * (v + phase)) / wavelength);
          const waveVal = wy2 * wu + wx2 * wv;

          const borderFade = Math.max(0, Math.min(1, (dBase - 2.5) / 2.0));
          waveOffset = waveAmp * borderFade * waveVal;
        }
        const jitter = (amp > 0 && pattern !== 'wave') ? amp * edgeNoise(u, v, edgeSeed) : 0;
        const d = dBase + off + waveOffset + jitter;
        // Bands ascend, so the last one passed is the level. Levels stay below
        // 10, which is what keeps one digit per pixel workable.
        let level = 0;
        while (level < bands.length && d >= bands[level]) level++;
        out += level;
      }
    }
    levels = out;
    levelCacheSet(key, levels);
  }
  return levels;
}

/**
 * Ribbon coordinates for every pixel: `s` along the outline and `depth` across
 * it. Only meaningful where the level grid says the pixel is the outline; the
 * rest is filled but never read.
 *
 * `depth` comes free — it is the distance the level grid already computes and
 * then throws away by quantising into a digit.
 *
 * `s` is the part with a real constraint behind it. True arc length is a global
 * quantity and a tile knows nothing about its neighbours, so it cannot be had.
 * What can: classify the local tangent into one of four orientations and take
 * the world coordinate that runs along it. On any straight run that IS arc
 * length exactly, it is a pure function of global position so it agrees across
 * seams, and it only jumps phase where the orientation class changes — around a
 * corner, where a one-pixel hitch in the dash spacing is invisible.
 *
 * The diagonals are `x±y` UN-normalised, and that is forced rather than chosen.
 * A tile is painted in local coordinates, so `s` is only usable if it is
 * congruent to the global one modulo the motif's period. `x` and `y` shift by
 * exactly 32 per tile, and `x±y` by 32*(col±row) — all multiples of 32, so any
 * period dividing 32 keeps its phase across every seam. Dividing by sqrt(2) for
 * euclidean spacing would make the per-tile shift 22.63 and every diagonal run
 * would restart its motif at each seam. The price is that a 45° run advances at
 * a different rate than a straight one, so motifs read about 1.4x larger there.
 * That is why RIBBON_PERIODS holds only divisors of 32.
 *
 * The gradient is taken from the STORED field, ignoring the re-roll's
 * displacement — the re-roll rewrites where the boundary sits, not which way it
 * runs, and central differences of the jitter would cost four more noise
 * evaluations per pixel to swing the classification by a fraction of a bucket.
 */
export interface BandCoords {
  /** Distance along the outline, in output pixels. Outline pixels only. */
  s: Float32Array;
  /** 0 at the terrain-B face of the outline, 1 at the terrain-A face. */
  depth: Float32Array;
}

/**
 * Smaller than LEVEL_CACHE because an entry is 8 KB rather than 1 KB: 128
 * covers two full 47-mask working sets, which is what a slider drag touches.
 */
export const BAND_CACHE_MAX = 128;
const BAND_CACHE = new Map<string, BandCoords>();

export const bandCacheSize = () => BAND_CACHE.size;

/**
 * Half-width of the stencil the outline's direction is estimated over.
 *
 * A one-pixel central difference is far too local to survive the noise baked
 * into the irregular silhouettes: measured as the share of ADJACENT outline
 * pixels that land in different orientation buckets — which is what makes a
 * motif re-phase — a single-pixel gradient gives 39% on moss and 36% on thorn,
 * against 6.4% on square. Averaging the difference over seven rows brings those
 * to 16% and 12% while leaving the clean patterns untouched to the digit
 * (square 6.4%, sharp 5.5%), because it smooths the direction estimate without
 * touching where the boundary actually sits.
 *
 * Seven is where it stops: that is already the width of the whole transition
 * band, and a wider stencil starts reading across thin features instead of
 * along them.
 */
const GRAD_RADIUS = 3;

/**
 * One component of the field's gradient, per unit distance, averaged across the
 * stencil.
 *
 * The one-sided cases matter more than they look. `sampleField` clamps, so a
 * plain central difference at the last column subtracts a replicated sample and
 * comes out HALF the size it should be — which does not change its sign but
 * skews gx against gy, and with it the bucket. Scaling by the span that was
 * actually spanned is what keeps a border column comparable with the tile next
 * to it.
 */
function derivative(field: string, u: number, v: number, horizontal: boolean): number {
  const N = PATTERN_TILE_SIZE;
  const at = (d: number, k: number) =>
    horizontal ? sampleField(field, u + d, v + k) : sampleField(field, u + k, v + d);
  const c = horizontal ? u : v;
  const r = radiusAt(c, N);
  const lo = Math.max(-r, -c);
  const hi = Math.min(r, N - 1 - c);
  const span = hi - lo;
  if (span <= 0) return 0;
  let total = 0;
  let n = 0;
  for (let k = -r; k <= r; k++) {
    total += at(hi, k) - at(lo, k);
    n++;
  }
  return total / (n * span);
}

/**
 * The stencil shrinks as it nears a tile border, and that is the whole seam
 * story.
 *
 * A wide stencil at the last column can only look BACKWARD, while the first
 * column of the tile beside it can only look forward — two disjoint seven-pixel
 * windows on opposite sides of the seam, which on a noisy silhouette routinely
 * disagree. Measured with a fixed radius of 3: `billow` re-phased at 78% of its
 * seam pixel pairs against 18% inside a tile, and `coast` at 46% against 12%.
 * Narrowing to a single pixel exactly at the border makes the two windows
 * adjacent instead of disjoint, which is the closest a tile can get to reading
 * its neighbour, and brings the seam rate back down to the in-tile one. Only two
 * columns and two rows per tile pay the noisier estimate.
 */
function radiusAt(c: number, n: number): number {
  return Math.max(1, Math.min(GRAD_RADIUS, Math.min(c, n - 1 - c)));
}

export function patternBandCoords(
  pattern: PatternId,
  mask: number,
  offsetPx = 0,
  tileSize: number = PATTERN_TILE_SIZE,
  bandSteps: number = DEFAULT_BAND_STEPS,
  hardEdgeB = false,
  edgeSeed = 0,
  outlineWidth?: number
): BandCoords {
  const off = clampOffset(pattern, offsetPx);
  const amp = edgeSeed === 0 || mask < 0 ? 0 : edgeJitterAmplitude(pattern, off);
  const owKey = outlineWidth !== undefined ? outlineWidth : '';
  const key = `${pattern}:${mask}:${off}:${tileSize}:${bandSteps}:${hardEdgeB}:${amp > 0 ? edgeSeed : 0}:${owKey}`;
  const hit = BAND_CACHE.get(key);
  if (hit) {
    BAND_CACHE.delete(key);
    BAND_CACHE.set(key, hit);
    return hit;
  }
  const n = tileSize * tileSize;
  const coords: BandCoords = { s: new Float32Array(n), depth: new Float32Array(n) };
  if (mask >= 0) {
    const field = patternFieldForMask(pattern, mask);
    const bands = bandsFor(pattern, bandSteps, hardEdgeB, outlineWidth);
    const inner = bands[1];
    const width = Math.max(1e-6, bands[2] - bands[1]);
    const scale = PATTERN_TILE_SIZE / tileSize;
    for (let y = 0; y < tileSize; y++) {
      const v = (y + 0.5) * scale - 0.5;
      for (let x = 0; x < tileSize; x++) {
        const u = (x + 0.5) * scale - 0.5;
        const jitter = amp > 0 ? amp * edgeNoise(u, v, edgeSeed) : 0;
        const d = sampleField(field, u, v) + off + jitter;
        const i = y * tileSize + x;
        coords.depth[i] = Math.max(0, Math.min(1, (d - inner) / width));
        // Only the outline is ever asked for its `s`, and the stencil below is
        // 7x7 — so skipping the ~85% of a tile that is solid terrain is most of
        // the cost of this pass.
        if (d < inner || d >= bands[2]) continue;
        const gx = derivative(field, u, v, true);
        const gy = derivative(field, u, v, false);
        // The tangent is the gradient turned a quarter turn. Its sign does not
        // matter — an edge running east is the same edge running west — so the
        // angle is folded into [0, pi) before it is bucketed.
        let ang = Math.atan2(gx, -gy);
        if (ang < 0) ang += Math.PI;
        if (ang >= Math.PI) ang -= Math.PI;
        const bucket = Math.floor((ang + Math.PI / 8) / (Math.PI / 4)) % 4;
        coords.s[i] =
          bucket === 0 ? x
          : bucket === 1 ? x + y
          : bucket === 2 ? y
          : x - y;
      }
    }
  }
  BAND_CACHE.set(key, coords);
  while (BAND_CACHE.size > BAND_CACHE_MAX) {
    const oldest = BAND_CACHE.keys().next();
    if (oldest.done) break;
    BAND_CACHE.delete(oldest.value);
  }
  return coords;
}
