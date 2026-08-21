// surface.ts — the road SURFACE, the third and last layer to come off the
// artist's hand.
//
// `boundary` took the outline, `centre` took the line down the middle.
// What is left is the thing in between, and the drawing states it very plainly:
//
//   the reference drawing, all 16 masks, 1912 drawn pixels
//     p  surface      1566   81.9%
//     e  kerb          151    7.9%
//     c  centreline    127    6.6%
//     a  kerb 2nd tone  68    3.6%
//
// Four fifths of the art is ONE FLAT TONE. So this stage is not like the other
// two: there is no 原版 to replay that differs from 单色, because 单色 IS what
// the artist drew. The identity entry says so rather than pretending otherwise
// — a menu entry that renders identically to its neighbour is the failure this
// app has shipped four times, and shipping it as a pair would be worse.
//
// ---------------------------------------------------------------------------
// The tone a texture paints with, and why it is not a new colour
// ---------------------------------------------------------------------------
//
// It is `edgeAlt`, the palette's fourth entry — the tone the artist used for
// the kerb's dither. That choice is a measurement, not a convenience. the reference drawing's
// four tones are not four arbitrary colours: `edgeAlt` sits on the straight
// line from `path` to `edge`, at
//
//   r  238 -> 191, alt 213    k = 0.532
//   g  161 -> 121, alt 139    k = 0.550
//   HSV value 0.933 -> 0.749, alt 0.835   k = 0.532
//
//   best RGB blend  k = 0.530,  rms 2.49 of 255
//
// i.e. the surface tone pushed 53% of the way toward the kerb tone. That is
// exactly "the outline bleeding inward", which is what a second surface tone
// wants to be — so the drawing already contains the colour this stage needs and
// there is no reason to invent one.
//
// The analytic ramp's shaded surface (`SHADE_RECIPES.path`) is NOT usable here
// and that is worth writing down: its recipe is `val: 1.0`, so it only adds
// saturation and leaves the brightness alone. On this saturated orange that is
// a difference of nothing much, and the recipe is a frozen constant with an
// open question hanging over it. This stage does not touch it.
//
// So the sheet still ships in exactly four colours, whichever texture is on.
//
// ---------------------------------------------------------------------------
// The three rules
// ---------------------------------------------------------------------------
//
//  1. IT ONLY RE-COLOURS. This stage never adds a pixel and never removes one:
//     it runs over pixels the silhouette already claims and moves them between
//     two tones. So every seam proof the boundary rests on is untouched, for
//     the same reason `surfaceShift` works in the level domain rather than the
//     field domain — displacing the field would move the outline and put the
//     whole argument back in play, and re-ranking a pixel between colours it
//     could already have had cannot.
//
//  2. IT NEVER TOUCHES THE KERB OR THE CENTRELINE. The other two stages own
//     those pixels; this one is what is left over. There is no rule against
//     the OUTER RING here, unlike the centreline's — measured, 679 of the
//     drawing's surface pixels are in ring 1, so the surface genuinely does
//     reach the edge and a texture that stopped short of it would be modelling
//     something the art does not do.
//
//  3. IT IS A FUNCTION OF (s, t) ON THE SHARED AXIS, or of (x, y) through a
//     tile-periodic hash. Same rule the centreline's fourth is: at an open
//     border the nearest skeleton element is the arm crossing it, so all 16
//     masks compute the same `t` there and `s` is that border's own world
//     coordinate; the rib period divides the tile; and `axialHash` is keyed on
//     position modulo 32, so two tiles agree wherever they share a column.
//
// All three are asserted per mask in `surface.test.ts`.

import { axialHash, alongFromCrossing, AXIAL_PERIODS, DEFAULT_PERIOD } from './axial';
import { roadCoords, surfaceHalfFor, type EdgeOptions, type SkeletonAt } from './boundary';
import type { Layers } from './layers';
import type { RGB, RoleColours } from './palette';

export type SurfaceKind = 'flat' | 'camber' | 'gravel' | 'ruts' | 'ribs';

/**
 * Which kinds an AREA sheet can offer.
 *
 * 车辙 and 横纹 are out, and not as a simplification: both are functions of the
 * ALONG-ROAD coordinate, and a filled region does not have one. There is no
 * direction in "this cell is grass". 横向渐变 survives because it reads only
 * how deep a pixel is, which a region has as surely as a road does — it just
 * counts in from the boundary instead of out from an axis.
 */
export const AREA_SURFACE_KINDS: readonly SurfaceKind[] = ['flat', 'camber', 'gravel'];

export const SURFACE_KINDS: readonly {
  id: SurfaceKind; zh: string; usesPeriod: boolean;
}[] = [
  { id: 'flat', zh: '单色', usesPeriod: false },
  { id: 'camber', zh: '横向渐变', usesPeriod: false },
  { id: 'gravel', zh: '碎石', usesPeriod: false },
  { id: 'ruts', zh: '车辙', usesPeriod: false },
  { id: 'ribs', zh: '横纹', usesPeriod: true },
];

/** The flat tone the artist drew — the painter short-circuits the whole stage. */
export function surfaceIsIdentity(o: SurfaceOptions): boolean {
  return o.kind === 'flat';
}

export function surfaceUsesPeriod(kind: SurfaceKind): boolean {
  return SURFACE_KINDS.find((k) => k.id === kind)?.usesPeriod ?? false;
}

// ---------------------------------------------------------------------------
// 横向渐变 — the road's camber, a pure function of `t`
// ---------------------------------------------------------------------------
//
// The one motif here that is not a marking: the road is brightest down its
// crown and darkens toward the kerb, the way a real cambered surface catches
// light. It is the one thing this file inherited from the generator that was
// retired, and it was NOT a copy — the old one moved pixels down a level ramp
// that no longer exists, so it is rebuilt on this stage's own terms.
//
// ⚠ ANCHORED TO THE AXIS, and that is the whole design. The surface is divided
// into `rings + 1` equal zones measured OUT FROM THE CENTRELINE, brightest in
// the middle, so widening the road widens the whole gradient with it. The
// alternative — fixed-width rings measured inward from the kerb — is a RIM
// effect: it leaves a flat slab down the middle that grows as the road widens,
// and on a road with anything drawn along its centre that reads as a mistake.
// Anchoring also means adding a ring costs no width; it only cuts the surface
// it already has more finely.
//
// The tones come from `surfaceRamp`, and the ring count is genuinely bounded by
// the palette rather than by taste — see it for the measurement.
export const CAMBER_RINGS = [1, 2, 3] as const;
export const DEFAULT_CAMBER_RINGS = 2;

/**
 * Where zone `k` ends, in output px from the axis. Snapped to the pixel grid.
 *
 * Snapped for the reason `doubleLineInner` and `rutInner` are, and it is the
 * same trap every time: pixel centres sit on half-integers, so an unsnapped
 * boundary can fall between two of them and a zone can contain no sample at
 * all. On a narrow road that renders as a missing ring while every arithmetic
 * check says the ring is there.
 */
export function camberEdge(k: number, rings: number, surfaceHalf: number): number {
  return Math.round((surfaceHalf * k) / (rings + 1));
}

/** Which zone this distance-across falls in: 0 is the crown, `rings` the kerb. */
export function camberZone(t: number, rings: number, surfaceHalf: number): number {
  for (let k = 1; k <= rings; k++) if (t < camberEdge(k, rings, surfaceHalf)) return k - 1;
  return rings;
}

// ---------------------------------------------------------------------------
// 车辙 — two darker tracks along the road
// ---------------------------------------------------------------------------

/**
 * Where a wheel track sits, as a share of the surface half-width.
 *
 * Taken from the analytic mode's own ruts (`surfaceShift` in axial.ts), which
 * put the track centre at 0.55 of the half-width, and derived from the ROAD
 * rather than exposed as a second slider for the reason 双直线's spacing is:
 * a wider road spaces its tracks further apart, and that is what makes it read
 * as wider. A cart does not widen its axle to match the lane.
 */
const RUT_SPREAD = 0.55;

/** Track widths in OUTPUT px. A track is not symmetric about the axis, so odd
 *  widths are real here — unlike the centreline's, which can only cover an even
 *  number of columns. All three render differently; measured. */
export const RUT_WIDTHS = [1, 2, 3] as const;
export const DEFAULT_RUT_WIDTH = 2;

/**
 * Where a track's INNER face sits, snapped to the pixel grid.
 *
 * Snapped for the reason `doubleLineInner` is, and it is the same trap: pixel
 * centres are half-integers, so an unsnapped band can fall between two of them
 * and contain no sample at all. It rendered as nothing while every arithmetic
 * check said it was fine. With both faces on integers the track covers exactly
 * `width` columns per side, whatever fraction the half-width happens to be.
 *
 * Floored at 1, so the two tracks never merge into one band over the axis —
 * two tracks that touch are one track, and 车辙 would then be 直线圆角 in a
 * different colour.
 */
export function rutInner(width: number, surfaceHalf: number): number {
  return Math.max(1, Math.round(surfaceHalf * RUT_SPREAD - width / 2));
}

/**
 * The widest track THIS road can carry without running into the kerb.
 *
 * Same rule the arc amplitude and the centreline width follow: a control must
 * not offer a value the geometry quietly takes back. Never returns nothing —
 * on a road with no surface left the narrowest is still the answer, and it
 * simply has nowhere to paint.
 */
export function maxRutWidth(surfaceHalf: number): number {
  let best: number = RUT_WIDTHS[0];
  for (const w of RUT_WIDTHS) if (rutInner(w, surfaceHalf) + w <= surfaceHalf) best = w;
  return best;
}

/** The track widths the control may offer here. Always at least one. */
export function rutWidthsFor(surfaceHalf: number): number[] {
  const ceiling = maxRutWidth(surfaceHalf);
  return RUT_WIDTHS.filter((w) => w <= ceiling);
}

// ---------------------------------------------------------------------------
// 横纹 — bands ACROSS the road
// ---------------------------------------------------------------------------

/** Rib periods along the road, in output px. Divisors of the tile — rule 3. */
export const SURFACE_PERIODS = AXIAL_PERIODS;

/**
 * Rib widths in OUTPUT px, EVEN — and this one is a genuine 32px grid fact
 * rather than the drawing's lattice showing through.
 *
 * A rib is centred on the crossing, so `alongFromCrossing` folds about its
 * middle and the test is `r < width / 2` with `r` a half-integer on a straight
 * run. An odd width puts `width / 2` exactly on a sample, and then which
 * pixels are painted is decided by which way `<` happens to fall rather than by
 * the number in the control.
 */
export const RIB_WIDTHS = [2, 4, 6] as const;
export const DEFAULT_RIB_WIDTH = 2;

/**
 * The widest rib this period can hold, leaving at least 2px of road between
 * two of them. A rib as wide as its period is a solid dark road, which is
 * 单色 in the other colour.
 */
export function maxRibWidth(period: number): number {
  return Math.min(RIB_WIDTHS[RIB_WIDTHS.length - 1], period - 2);
}

/** The rib widths the control may offer at this period. Always at least one. */
export function ribWidthsFor(period: number): number[] {
  const ceiling = maxRibWidth(period);
  const offered = RIB_WIDTHS.filter((w) => w <= ceiling);
  return offered.length > 0 ? offered : [RIB_WIDTHS[0] as number];
}

// ---------------------------------------------------------------------------
// 碎石 — a seeded dither
// ---------------------------------------------------------------------------

/**
 * How much of the surface darkens, 0..1.
 *
 * The default is well under the kerb's own 0.43. That number was solved to
 * reproduce the drawing's EDGE, where the dither is the boundary and has to
 * carry it; here it is a texture over open road, and at 0.43 the road reads as
 * two-tone rather than as gravelly.
 *
 * The grain is ONE OUTPUT PIXEL. The drawing's own dither is two px wide, and
 * that is not a property of gravel — it is the art having been drawn at 16 and
 * replayed by pixel replication. See the note on the 32px rule in
 * `centre`'s jitter: measure WHERE the drawing puts things, never copy the
 * spacing it was forced into.
 */
export const DEFAULT_GRAVEL_COVERAGE = 0.2;

export interface SurfaceOptions {
  kind: SurfaceKind;
  /** `gravel` only: share of the surface that darkens, 0..1. */
  coverage: number;
  /** `gravel` only: dice. Clamped >= 1 — see the analytic mode's seed-0 trap. */
  seed: number;
  /** `ruts` only: each track's width across the road, in output px. */
  rutWidth: number;
  /** `ribs` only: a rib's width along the road, in output px. Even. */
  ribWidth: number;
  /** `ribs` only: the along-road period, in output px. Must divide the tile. */
  period: number;
  /** `camber` only: how many darker zones between the crown and the kerb. */
  rings: number;
}

export const DEFAULT_SURFACE: SurfaceOptions = {
  kind: 'flat',
  coverage: DEFAULT_GRAVEL_COVERAGE,
  seed: 1,
  rutWidth: DEFAULT_RUT_WIDTH,
  ribWidth: DEFAULT_RIB_WIDTH,
  period: DEFAULT_PERIOD,
  rings: DEFAULT_CAMBER_RINGS,
};

/**
 * Does this pixel take the darker tone?
 *
 * `near` is null where the field has no direction at all (the isolated blob's
 * centre), and then only the position-keyed motifs can answer — which is why
 * gravel is tested before it is consulted.
 */
function onDarkSurface(
  near: SkeletonAt | null,
  x: number,
  y: number,
  o: SurfaceOptions,
  surfaceHalf: number,
  depth: number
): number {
  switch (o.kind) {
    case 'flat':
      return 0;
    case 'camber':
      // A pure function of how deep the pixel is, so it says nothing about
      // where ALONG anything it sits — which is why it needs no seam argument
      // of its own, and why it is the one motif that works in both readings.
      //
      // ⚠ The two readings measure depth from opposite ends and the zones have
      // to follow. A road is brightest on its axis and darkens outward, so it
      // counts `t` OUT from the skeleton. A region has no axis; the honest
      // reading is the ring index peeled off its own silhouette, counting IN
      // from the boundary — so the zone order inverts.
      //
      // ⚠ Branch on the SCHEME, not on whether `near` happens to be null. It
      // never is: `roadCoords` answers for any mask, so an area tile was being
      // shaded off the road skeleton's `t` — which put a ring inside every
      // solid tile and tiled the whole region into a waffle.
      if (!near) {
        const rings = Math.round(o.rings);
        return depth <= 0 ? 0 : Math.max(0, rings - camberZone(depth - 1, rings, surfaceHalf));
      }
      return camberZone(near.t, Math.round(o.rings), surfaceHalf);
    case 'gravel':
      // Keyed on position modulo the tile, so two tiles agree wherever they
      // share a column or a row. That is rule 3 for a motif with no geometry.
      return axialHash(x, y, o.seed) < o.coverage ? SURF_ALT : 0;
    case 'ruts': {
      if (!near) return 0;
      // `t` is unsigned, so ONE band is already two tracks — one either side of
      // the axis. Same reason 双直线 has no sign anywhere in it.
      const inner = rutInner(o.rutWidth, surfaceHalf);
      return near.t >= inner && near.t < inner + o.rutWidth ? SURF_ALT : 0;
    }
    case 'ribs': {
      if (!near) return 0;
      return alongFromCrossing(near.along, o.period) < o.ribWidth / 2 ? SURF_ALT : 0;
    }
  }
}

/** What `Layers.surface` holds. */
export const SURF_PLAIN = 0;
export const SURF_ALT = 1;

/**
 * The tone for each surface index: 0 is the plain surface, the last is `edgeAlt`.
 *
 * ⚠ THE DEEPEST STEP IS ALWAYS `edgeAlt` ITSELF, not a blend that happens to
 * land near it. That matters twice over: `edgeAlt` is a colour the user picks,
 * so a derived near-miss would quietly ignore their choice; and it keeps every
 * scattered texture — 碎石 / 车辙 / 横纹, all of which write a single step — on
 * exactly four colours, which is a property the sheet test pins.
 *
 * ⚠ MORE THAN ONE RING DOES MEAN MORE THAN FOUR COLOURS, and that is the cost
 * of 横向渐变 stated plainly. The intermediate tones are blends from `path`
 * toward `edgeAlt`. Measured on the reference palette (`#eea160` -> `#d58b60`),
 * the gaps between adjacent tones:
 *
 *   1 ring    step 47      (nothing derived at all)
 *   2 rings   steps 23, 24
 *   3 rings   steps 16, 15, 16
 *
 * All visible — under about 3 they would not be and the control would have dead
 * stops. Three is the ceiling for the same reason: a fourth would put adjacent
 * tones about 12 apart on a road that has only a few pixels of surface to spend
 * them on, and the ring would have nowhere to live anyway.
 *
 * That `edgeAlt` is a sensible place to END is itself measured: the reference
 * drawing's four tones were a ramp, and its `edgeAlt` sits at k = 0.530 on the
 * line from `path` to `edge` (RGB best fit, rms 2.49 of 255).
 */
export function surfaceRamp(colours: RoleColours, o: SurfaceOptions): RGB[] {
  const steps = o.kind === 'camber' ? Math.max(1, Math.round(o.rings)) : 1;
  const out: RGB[] = [colours.path];
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    out.push(i === steps ? colours.edgeAlt : {
      r: Math.round(colours.path.r + k * (colours.edgeAlt.r - colours.path.r)),
      g: Math.round(colours.path.g + k * (colours.edgeAlt.g - colours.path.g)),
      b: Math.round(colours.path.b + k * (colours.edgeAlt.b - colours.path.b)),
    });
  }
  return out;
}

/**
 * Re-tone the surface, leaving the silhouette, the kerb and the centreline
 * exactly as the stages before this one left them.
 *
 * The three earlier layers are read and none is written: this returns the same
 * arrays with one more beside them. Rule 1 is enforced right here, in the
 * `continue` — a pixel that is not plain surface is never even asked about.
 */
export function surfaceLayers(
  layers: Layers,
  bits: number,
  o: SurfaceOptions,
  edge: EdgeOptions
): Layers {
  if (surfaceIsIdentity(o)) return layers;
  const { size, fill, band, centre, depth } = layers;
  const surface = new Uint8Array(size * size);
  const surfaceHalf = surfaceHalfFor(edge);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!fill[i] || band[i] || centre[i]) continue;          // rule 2
      // An area has no road to take coordinates from — see `onDarkSurface`.
      const near = edge.scheme === 'area' ? null : roadCoords(bits, x, y, size, edge);
      surface[i] = onDarkSurface(near, x, y, o, surfaceHalf, depth[i]);
    }
  }

  return { ...layers, surface };
}
