// blob47Pattern.ts — the built-in boundary patterns, one 16x16 grid per
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
  | 'sharp' | 'rounded' | 'bold'
  | 'jagged' | 'gravel' | 'boulder' | 'thorn' | 'coast' | 'moss' | 'billow';

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
      { id: 'rounded', zh: '圆润 · 全四级过渡', en: 'Rounded — soft corners, full ramp' },
      { id: 'sharp', zh: '硬边 · 直角细描边', en: 'Sharp — square corners, 1px outline' },
      { id: 'bold', zh: '粗描边 · 2px 轮廓', en: 'Bold — heavy 2px outline' },
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

/** Width of each added step, in pixels of the 16-space field. */
export const BAND_STEP_PX = 1;

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

export const PATTERN_TILE_SIZE = 16;

/** Background: every pixel is unshaded terrain B (drawn where no tile applies). */
export const PATTERN_BACKGROUND = '0'.repeat(PATTERN_TILE_SIZE * PATTERN_TILE_SIZE);

// --- stored field ---------------------------------------------------------
/** Quantisation of the stored distance field, in pixels. */
export const FIELD_STEP = 0.25;
/** Base-62 digits, least distance first. */
export const FIELD_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

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
  sharp: [3.5, 3.5, 4.5, 4.5],
  rounded: [3.5, 4.5, 5.5, 6.5],
  bold: [2.5, 3.5, 5.5, 6.5],
  jagged: [3.5, 4.5, 5.5, 6.5],
  gravel: [3.5, 4.5, 5.5, 6.5],
  boulder: [4, 5, 6, 7],
  thorn: [3.75, 4.5, 5, 6],
  coast: [3.75, 4.75, 5.75, 6.75],
  moss: [3.5, 4.5, 5.5, 6.5],
  billow: [3.5, 4.5, 5.5, 6.5],
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
 */
export const PATTERN_OFFSET_RANGE: Record<PatternId, readonly [number, number]> = {
  sharp: [-4, 2.75],
  rounded: [-1.75, 2.75],
  bold: [-3.5, 1.75],
  jagged: [-5, 1],
  gravel: [-5, 1.5],
  boulder: [-2.25, 1.25],
  thorn: [-4.5, 1.25],
  coast: [-2.75, 2.25],
  moss: [-4.5, 1],
  billow: [-1.5, 1],
};

const FIELDS: Record<PatternId, Record<number, string>> = {
  sharp: GENERATED_FIELDS.sharp,
  rounded: GENERATED_FIELDS.rounded,
  bold: GENERATED_FIELDS.bold,
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
  hardEdgeB = false
): number[] {
  const base = PATTERN_BANDS[pattern];
  const extra = Math.max(0, Math.min(MAX_BAND_STEPS, steps) - MIN_BAND_STEPS);
  const out: number[] = [...base];
  for (let k = 1; k <= extra; k++) out.push(base[3] + BAND_STEP_PX * k);
  if (!hardEdgeB) return out;
  // Collapse the terrain-B shade so open terrain meets the outline with nothing
  // in between, and pull the rest out by the width that freed up — the outline
  // keeps the weight the pattern was authored with rather than absorbing it.
  // `out[0]` is untouched, which is what keeps every offset limit valid.
  const w = out[1] - out[0];
  return out.map((b, i) => (i === 0 ? b : b - w));
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
  'jagged', 'gravel', 'boulder', 'thorn', 'coast', 'moss', 'billow',
]);

/**
 * How far a re-roll may push the boundary, in pixels of the 16-space field.
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
 */
export function edgeJitterAmplitude(pattern: PatternId, offsetPx = 0): number {
  if (!RESEEDABLE_PATTERNS.has(pattern)) return 0;
  const [, hi] = PATTERN_OFFSET_RANGE[pattern];
  return Math.max(0, hi - Math.max(0, clampOffset(pattern, offsetPx)));
}

/**
 * Tile-periodic value noise over the 16-space field, in [-1, 1].
 *
 * Sampled in FIELD space rather than output space, so 32px output resolves the
 * same displaced silhouette more finely instead of drawing a different one —
 * exactly how the field itself is resampled. The lattice divides 16, so it
 * repeats with the tile and every seam stays continuous.
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
 * Bilinear sample of a stored field, in 16-space pixel-centre coordinates
 * (sample `i` sits at u = i). Out-of-range reads clamp to the edge; the
 * boundary is always inset well away from the tile border, so the replicated
 * half-pixel never lands anywhere the transition band can reach.
 */
function sampleField(field: string, u: number, v: number): number {
  const N = PATTERN_TILE_SIZE;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const tx = u - x0;
  const ty = v - y0;
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
 * Above 16px the stored field is resampled and thresholded at the output
 * resolution rather than the level grid being scaled up. That is the point of
 * storing a field: distance is smooth and interpolates, so the boundary is
 * genuinely resolved at the finer grid instead of turning into 2x2 blocks.
 * Bands stay in 16-space units, so an outline drawn 1px wide at 16 comes out
 * 2px wide at 32 — the same art, larger.
 *
 * At tileSize 16 the sample points land exactly on the stored ones and the
 * interpolation degenerates to a plain lookup, so nothing changes there.
 */
export function patternLevelsForMask(
  pattern: PatternId,
  mask: number,
  offsetPx = 0,
  tileSize: number = PATTERN_TILE_SIZE,
  bandSteps: number = DEFAULT_BAND_STEPS,
  hardEdgeB = false,
  edgeSeed = 0
): string {
  if (mask < 0) return '0'.repeat(tileSize * tileSize);
  const off = clampOffset(pattern, offsetPx);
  // Seed 0 means "the silhouette exactly as baked", so the whole displacement
  // drops out rather than being computed and multiplied by zero.
  const amp = edgeSeed === 0 ? 0 : edgeJitterAmplitude(pattern, off);
  const key = `${pattern}:${mask}:${off}:${tileSize}:${bandSteps}:${hardEdgeB}:${amp > 0 ? edgeSeed : 0}`;
  let levels = levelCacheGet(key);
  if (levels === undefined) {
    const field = patternFieldForMask(pattern, mask);
    const bands = bandsFor(pattern, bandSteps, hardEdgeB);
    const scale = PATTERN_TILE_SIZE / tileSize;
    let out = '';
    for (let y = 0; y < tileSize; y++) {
      const v = (y + 0.5) * scale - 0.5;
      for (let x = 0; x < tileSize; x++) {
        const u = (x + 0.5) * scale - 0.5;
        const jitter = amp > 0 ? amp * edgeNoise(u, v, edgeSeed) : 0;
        const d = sampleField(field, u, v) + off + jitter;
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
