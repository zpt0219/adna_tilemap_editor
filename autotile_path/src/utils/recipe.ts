// recipe.ts — every knob the app has, and the rules that keep them consistent.
//
// A Recipe is the whole state: three generated stages and a palette. It used to
// carry two more things — a `bakedId` naming a hand-drawn sheet to replay, and
// a parallel set of fields for a second, older generator. Both are gone. What
// is left generates one road from one skeleton, so there is one place to look
// for any given behaviour.
//
// ---------------------------------------------------------------------------
// Everything here is CHAINED, and the order is the geometry's, not taste
// ---------------------------------------------------------------------------
//
// The controls are not independent. How far out the boundary sits decides how
// deep an arc it can carry and how much surface is left inside it; how much
// surface is left decides how wide a centreline fits and how far a wheel track
// can sit from the axis; a rib's period decides how wide the rib can be. So the
// sanitiser computes them in that order and clamps each against what the ones
// before it left.
//
// The rule every one of those clamps serves: A CONTROL MUST NOT OFFER A VALUE
// THE SANITISER WILL TAKE BACK. This app has shipped four controls that moved
// without changing a pixel, and this is the cheapest guard against a fifth.

import { snapPeriod } from './axial';
import { OUTPUT_SIZE } from './layers';
import { type EdgeStyle } from './edgeStyles';
import {
  DEFAULT_EDGE, EDGE_KINDS, ARC_AMPLITUDE_STEP,
  ARC_PERIODS, MIN_EDGE_DISTANCE, MAX_EDGE_DISTANCE, EDGE_DISTANCE_STEP, maxArcAmplitude,
  surfaceHalfFor, ROUGH_STYLES, maxRoughness, ROUGHNESS_STEP,
  KERB_MOTIFS, KERB_WIDTHS, KERB_PERIODS, maxKerbWidth, type KerbMotif,
  SCHEMES, type Scheme,
  type EdgeKind, type EdgeOptions,
} from './boundary';
import {
  DEFAULT_CENTRE, CENTRE_KINDS, snapCentreWidth, maxCentreWidth,
  centrePeriodsFor, snapDashLength, maxLong, maxShort, MIN_LONG, MIN_SHORT,
  RAND_MIN, RAND_MAX, MAX_RAND_MIN, maxJitter,
  type CentreKind, type CentreOptions,
} from './centre';
import {
  DEFAULT_SURFACE, SURFACE_KINDS, AREA_SURFACE_KINDS, RUT_WIDTHS, RIB_WIDTHS,
  CAMBER_RINGS, maxRutWidth, maxRibWidth,
  type SurfaceKind, type SurfaceOptions,
} from './surface';
import type { RoleColours } from './palette';
import { parseHexColour } from './palette';

export interface Recipe {
  /** The outline: how far out it sits, what shape it takes, how it dissolves. */
  edge: EdgeOptions;
  /** The line down the middle. Independent of the boundary in both directions. */
  centre: CentreOptions;
  /** What the road surface between them does. */
  surface: SurfaceOptions;
  /** The only colours in the tileset. Everything else is transparent. */
  roleHex: { path: string; edge: string; centre: string; edgeAlt: string };
  /**
   * NOT part of the tileset — the app paints it behind the playground so the
   * road can be judged against a ground, the way it will actually be used. It
   * never reaches a pixel of the exported PNG.
   */
  previewGroundHex: string;
}

/**
 * The per-field fallback table the sanitiser reads.
 *
 * ⚠ NOT the look the app opens on. Those are two different things and
 * conflating them is a bug this project's sibling actually shipped — see
 * `defaultRecipe`.
 */
export const DEFAULT_RECIPE: Recipe = {
  edge: DEFAULT_EDGE,
  centre: DEFAULT_CENTRE,
  surface: DEFAULT_SURFACE,
  roleHex: { path: '#c9a97e', edge: '#4a3a2a', centre: '#e8dcc0', edgeAlt: '#6b5540' },
  previewGroundHex: '#5f8a4a',
};

const snap = (v: number, step: number) => Math.round(v / step) * step;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim())
    ? (v.trim().startsWith('#') ? v.trim() : '#' + v.trim())
    : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

const EDGE_IDS = EDGE_KINDS.map((k) => k.id);
const ROUGH_IDS = ROUGH_STYLES.map((s) => s.id);
const KERB_MOTIF_IDS = KERB_MOTIFS.map((m) => m.id);
const SCHEME_IDS = SCHEMES.map((s) => s.id);
const CENTRE_IDS = CENTRE_KINDS.map((k) => k.id);
const SURFACE_IDS = SURFACE_KINDS.map((k) => k.id);

/** Nearest offered value. `<=` so a tie rounds up, matching snapPeriod. */
function nearest(want: number, offered: readonly number[]): number {
  return offered.reduce((best: number, v: number) =>
    Math.abs(v - want) <= Math.abs(best - want) ? v : best, offered[0] as number);
}

/** Force a recipe into the ranges the geometry allows. See the header. */
export function sanitizeRecipe(raw: Partial<Recipe> | null | undefined): Recipe {
  const d = DEFAULT_RECIPE;
  const r = raw ?? {};

  const bakedDistance = Math.max(MIN_EDGE_DISTANCE, Math.min(MAX_EDGE_DISTANCE,
    snap(num(r.edge?.distance, d.edge.distance), EDGE_DISTANCE_STEP)));

  // Built before the return because the CENTRELINE is clamped against it: how
  // much surface the boundary leaves is what decides how wide a line fits.
  // Chained: WHICH noise it is bounds how far it may wobble, because the styles
  // with a per-pixel term shed loose specks long before the smooth ones bite
  // through. Only the position-based ones are offered — `wave` and `scallop`
  // read `s`, which is what 圆弧波浪线 already is, and the seam argument for a
  // two-sided noise rests on it never reading `s` at all.
  const bakedRoughStyle = oneOf<EdgeStyle>(
    r.edge?.roughStyle, ROUGH_IDS, d.edge.roughStyle);

  const kerbPeriod = nearest(
    snapPeriod(num(r.edge?.kerbPeriod, d.edge.kerbPeriod)), KERB_PERIODS);

  const scheme = oneOf<Scheme>(r.edge?.scheme, SCHEME_IDS, d.edge.scheme);

  const edge: EdgeOptions = {
    scheme,
    kind: oneOf<EdgeKind>(r.edge?.kind, EDGE_IDS, d.edge.kind),
    distance: bakedDistance,
    // Divisors of the tile only, so an arc keeps its phase across a seam.
    period: nearest(num(r.edge?.period, d.edge.period), ARC_PERIODS),
    // Against the DISTANCE's own ceiling, not the global one: how far the
    // arcs may swing depends on how far out the boundary is, and a setting
    // the geometry cannot carry would sever the road rather than look bold.
    amplitude: Math.max(0, Math.min(maxArcAmplitude(bakedDistance),
      snap(num(r.edge?.amplitude, d.edge.amplitude), ARC_AMPLITUDE_STEP))),
    coverage: Math.max(0, Math.min(1,
      snap(num(r.edge?.coverage, d.edge.coverage), 0.01))),
    // Only the position-based styles: `wave` and `scallop` read `s`, which is
    // what 圆弧波浪线 already is, and the seam argument for a two-sided noise
    // rests on it never reading `s` at all.
    roughStyle: bakedRoughStyle,
    // Against the DISTANCE's own ceiling, like the arc amplitude: this noise is
    // two-sided, so half of it pushes outward and spends the closed-border
    // budget the distance has already eaten into.
    roughness: Math.max(0, Math.min(maxRoughness(bakedDistance),
      snap(num(r.edge?.roughness, d.edge.roughness), ROUGHNESS_STEP))),
    seed: Math.max(1, Math.round(num(r.edge?.seed, d.edge.seed))),
    kerbMotif: oneOf<KerbMotif>(r.edge?.kerbMotif, KERB_MOTIF_IDS, d.edge.kerbMotif),
    kerbPeriod,
    // Chained: the period bounds the tooth, never the other way round, or a
    // stored recipe could keep a tooth its period can no longer hold.
    kerbWidth: Math.min(
      nearest(num(r.edge?.kerbWidth, d.edge.kerbWidth), KERB_WIDTHS),
      Math.max(KERB_WIDTHS[0], maxKerbWidth(kerbPeriod))),
  };

  // ⚠ An AREA sheet has no centreline and cannot have one: every kind here is
  // drawn on the road's skeleton, and a filled region has no skeleton. Forced
  // rather than hidden, so a recipe is never in a state the painter has to
  // interpret.
  const centreKind = scheme === 'area' ? 'none' : oneOf<CentreKind>(
    r.centre?.kind, CENTRE_IDS, d.centre.kind);
  // Snapped to the periods THIS kind has: 长短虚线 needs 8px before its four
  // pieces are a pixel each, so 4 is not on offer there.
  const centrePeriod = nearest(
    snapPeriod(num(r.centre?.period, d.centre.period)),
    centrePeriodsFor(centreKind));
  const centreLong = snapDashLength(num(r.centre?.long, d.centre.long),
    MIN_LONG, Math.max(MIN_LONG, maxLong(centrePeriod)));
  // Whole output pixels, not the drawing's 2px lattice: the sheet is 32 and
  // these are generated at 32. Only the CROSSING dash needs an even length, and
  // `randomRuns` rounds that one itself.
  const randMin = Math.max(RAND_MIN, Math.min(MAX_RAND_MIN,
    Math.round(num(r.centre?.randMin, d.centre.randMin))));
  const centreWidth = Math.min(
    snapCentreWidth(num(r.centre?.width, d.centre.width)),
    maxCentreWidth(centreKind, surfaceHalfFor(edge)));

  // Chained the same way the centreline's are, and against the same road: the
  // rib's period bounds its width, and the boundary's surface half-width bounds
  // the track's. A stored recipe that arrives with a track too wide for the
  // road it is now on gets the widest one that fits, not the one it asked for.
  const ribPeriod = snapPeriod(num(r.surface?.period, d.surface.period));

  return {
    edge,
    centre: {
      kind: centreKind,
      // Snapped to the three widths that EXIST — a solid line is symmetric
      // about the axis, so it can only cover an even number of columns (see
      // CENTRE_WIDTHS, which is measured) — and then clamped against what this
      // road can carry, the same way the arc amplitude is clamped against the
      // distance. Beyond that ceiling 双直线 would render three widths as one
      // picture.
      width: centreWidth,
      period: centrePeriod,
      // Chained, in the order the geometry constrains them: the period bounds
      // the long dash, and the long dash bounds the short one. Doing it the
      // other way round would let a stored recipe keep a short dash the long
      // one can no longer be longer than.
      long: centreLong,
      short: snapDashLength(num(r.centre?.short, d.centre.short),
        MIN_SHORT, Math.max(MIN_SHORT, maxShort(centrePeriod, centreLong))),
      // Chained the same way: the shortest run bounds the longest, and they
      // must differ by a step or every dash comes out the same length and the
      // motif is a plain 虚线 wearing a seed.
      randMin,
      randMax: Math.max(randMin + 1, Math.min(RAND_MAX,
        Math.round(num(r.centre?.randMax, d.centre.randMax)))),
      // Against what the ROAD can carry, like every other across-road number
      // here: nudged too far the ring rule deletes the dash outright, and the
      // motif would read as randomly dropping pieces rather than leaning.
      randJitter: Math.max(0, Math.min(
        maxJitter(centreWidth, surfaceHalfFor(edge)),
        Math.round(num(r.centre?.randJitter, d.centre.randJitter)))),
      seed: Math.max(1, Math.round(num(r.centre?.seed, d.centre.seed))),
    },
    surface: {
      // Same reason: 车辙 and 横纹 read the along-road coordinate, and a region
      // does not have one. See AREA_SURFACE_KINDS.
      kind: oneOf<SurfaceKind>(
        r.surface?.kind,
        scheme === 'area' ? AREA_SURFACE_KINDS : SURFACE_IDS,
        scheme === 'area' ? 'flat' : d.surface.kind),
      coverage: Math.max(0, Math.min(1,
        snap(num(r.surface?.coverage, d.surface.coverage), 0.01))),
      seed: Math.max(1, Math.round(num(r.surface?.seed, d.surface.seed))),
      // A track is not symmetric about the axis, so odd widths are real here —
      // unlike the centreline's, which can only cover an even number of columns.
      rutWidth: Math.min(
        nearest(num(r.surface?.rutWidth, d.surface.rutWidth), RUT_WIDTHS),
        maxRutWidth(surfaceHalfFor(edge))),
      // Even, and that one IS a pixel-grid fact: a rib is centred on the
      // crossing, so an odd width puts its edge exactly on a sample.
      ribWidth: Math.min(
        nearest(num(r.surface?.ribWidth, d.surface.ribWidth), RIB_WIDTHS),
        Math.max(RIB_WIDTHS[0], maxRibWidth(ribPeriod))),
      period: ribPeriod,
      rings: nearest(num(r.surface?.rings, d.surface.rings), CAMBER_RINGS),
    },
    roleHex: {
      path: hex(r.roleHex?.path, d.roleHex.path),
      edge: hex(r.roleHex?.edge, d.roleHex.edge),
      centre: hex(r.roleHex?.centre, d.roleHex.centre),
      edgeAlt: hex(r.roleHex?.edgeAlt, d.roleHex.edgeAlt),
    },
    previewGroundHex: hex(r.previewGroundHex, d.previewGroundHex),
  };
}

/** Tiles ship at one size, and everything generated is evaluated at it. */
export { OUTPUT_SIZE as TILE_PX };

export function coloursOf(r: Recipe): RoleColours {
  return {
    path: parseHexColour(r.roleHex.path),
    edge: parseHexColour(r.roleHex.edge),
    centre: parseHexColour(r.roleHex.centre),
    edgeAlt: parseHexColour(r.roleHex.edgeAlt),
  };
}

/**
 * What shape a saved recipe is in.
 *
 * ⚠ BUMP THIS whenever a field is renamed or removed, and the reason is a bug
 * this app actually shipped: `sanitizeRecipe` fills every missing field from
 * `DEFAULT_RECIPE` and ignores every field it does not know, which is exactly
 * right for a hostile value and exactly WRONG for a file from an older version.
 * A v1 recipe — `bakedId`, `halfWidth`, `shadeRings`, `centre.pattern` — is
 * perfectly good JSON describing a shape that no longer exists, so it used to
 * load as the default road with its colours kept and every piece of geometry
 * silently discarded. No error, no warning, just somebody else's road.
 *
 * 1 -> 2 (2026-08-20): the hand-drawn sheet and the second generator were
 * deleted. `bakedId` and every analytic field went with them, and
 * `bakedEdge`/`bakedCentre`/`bakedSurface` became `edge`/`centre`/`surface`.
 */
export const RECIPE_VERSION = 2;

export type RecipeFile =
  | { ok: true; recipe: Recipe }
  | { ok: false; reason: string };

/**
 * Parse a downloaded recipe, REFUSING anything this version cannot honestly
 * read rather than sanitising it into silence.
 *
 * Accepts both wrappers the app has ever written: `{ v, recipe }` from the JSON
 * button and `{ version, recipe }` from the PNG+JSON bundle.
 */
export function readRecipeFile(text: string): RecipeFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: '这不是一个 JSON 文件。' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: '这不是一个 JSON 文件。' };
  }

  const box = parsed as Record<string, unknown>;
  const inner = (box.recipe ?? box) as Record<string, unknown>;
  const v = typeof box.v === 'number' ? box.v
    : typeof box.version === 'number' ? box.version
    : null;

  // A version we know is too old is worth naming precisely — the user's file is
  // not corrupt, it is from before a deletion.
  if (v !== null && v !== RECIPE_VERSION) {
    return {
      ok: false,
      reason: `这是第 ${v} 版的配方，当前是第 ${RECIPE_VERSION} 版。`
        + '第 1 版存的是手绘图的回放和旧参数化模式的字段，那两样都已经删掉了，'
        + '直接读进来会只剩颜色、几何全部变成默认值。',
    };
  }
  // No version at all, or a version that matches but a shape that does not:
  // recognise the old fields structurally so a hand-edited file is caught too.
  if ('bakedId' in inner || 'halfWidth' in inner || 'shadeRings' in inner
    || 'bakedEdge' in inner) {
    return {
      ok: false,
      reason: '这份配方里有旧版才有的字段（bakedId / halfWidth / bakedEdge 之类）。'
        + '那些字段已经不存在了，读进来几何会全部变成默认值。',
    };
  }
  if (v === null && !('edge' in inner)) {
    return { ok: false, reason: '这份 JSON 里没有配方。' };
  }
  return { ok: true, recipe: sanitizeRecipe(inner as Partial<Recipe>) };
}

export interface Preset { id: string; zh: string; en: string; recipe: Recipe }

/**
 * Starting points, not a gallery.
 *
 * There used to be two, and they were the two readings of a hand-drawn sheet.
 * The drawing is gone — the generator reproduces it — so what a preset is now
 * is a place to start from, and every other corner of the parameter space is
 * reachable from the controls.
 *
 * ⚠ The PALETTE below is the drawing's own four tones, and they are worth
 * keeping even though the art is not. They are not four arbitrary colours:
 * `edgeAlt` measures as `path` blended 53% toward `edge` (RGB rms 2.49/255),
 * which is why the surface texture can reuse it instead of inventing a fifth.
 * See the header of `surface.ts`.
 */
const DIRT = { path: '#eea160', edge: '#bf7958', centre: '#f4cca1', edgeAlt: '#d58b60' };

export const PRESETS: readonly Preset[] = [
  {
    // The fit: the constants swept against the reference drawing, which
    // reproduced 92.70% of its pixels, plus the hand-drawn wobble on top.
    id: 'dirt', zh: '土径', en: 'Dirt track',
    recipe: sanitizeRecipe({
      ...DEFAULT_RECIPE,
      roleHex: DIRT,
      edge: {
        ...DEFAULT_EDGE, kind: 'straightRound', distance: 7.25,
        roughStyle: 'hand', roughness: 2, coverage: 0.43,
      },
      centre: { ...DEFAULT_CENTRE, kind: 'randomDash' },
      surface: { ...DEFAULT_SURFACE, kind: 'flat' },
    }),
  },
  {
    // The same road with every edge surveyed — no noise, solid kerb, a ruled
    // line down the middle. The other end of the same controls.
    id: 'paved', zh: '铺装路', en: 'Paved road',
    recipe: sanitizeRecipe({
      ...DEFAULT_RECIPE,
      roleHex: DIRT,
      edge: { ...DEFAULT_EDGE, kind: 'straightRound', distance: 11, coverage: 1 },
      centre: { ...DEFAULT_CENTRE, kind: 'dashed', period: 8 },
      surface: { ...DEFAULT_SURFACE, kind: 'ruts' },
    }),
  },
];

export const DEFAULT_PRESET_ID = 'dirt';

/**
 * What the app opens on.
 *
 * ⚠ Deliberately not `DEFAULT_RECIPE`. That is the sanitiser's per-field
 * fallback table, not a look; starting from it leaves the preset row naming a
 * preset that is not on screen.
 */
export function defaultRecipe(): Recipe {
  return PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)?.recipe
    ?? sanitizeRecipe(DEFAULT_RECIPE);
}
