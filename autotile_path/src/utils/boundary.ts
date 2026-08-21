// boundary.ts — the road's outline.
//
// ⚠ ABOUT "the reference drawing", which this file cites a lot: it was a
// hand-drawn 16px sheet the whole generator was fitted against, and it is no
// longer in the repo — the generator reproduces it, which is what made deleting
// it the point rather than a loss. Every number below that says "measured" was
// measured against it, and those measurements are the reason the constants are
// what they are. They cannot be re-derived from anything still here, so they
// are written down where they are used.
//
// `layers` takes the art apart into silhouette / band / centreline. This
// file is what the split was FOR: the outline can be replaced outright while
// the other two layers are still the artist's, pixel for pixel.
//
// The three follow blob47's "clean edges" group, which is where the idea comes
// from. There a pattern is the geometry of the WHOLE outline — the distance
// field thresholded directly — and its irregular group (gravel, moss, thorn…)
// is the separate thing that displaces it with noise. These are the clean ones:
//
//   * 原版        the drawing's own edge, replayed. Nothing is computed.
//   * 直线圆角    straight runs joined by circular corners — blob47's `sharp`,
//                 "rounded corners, outline". Here it is the analytic skeleton
//                 that already fits this drawing to 92.70% of its pixels.
//   * 圆弧波浪线  the same skeleton with the boundary made of alternating
//                 CIRCULAR ARCS — blob47's `wave`, "regular circular arc edge".
//                 Its handle is the arc's RADIUS; how deep it swings follows
//                 from that and the period. See `arcRadiusFor`.
//
// An earlier version of this file displaced the drawn edge with the eight-way
// noise family instead. It is gone: displacement can only ever perturb a
// hand-drawn crumbly edge, so "straight" was never reachable that way, and the
// picker's effect was drowned by the art underneath it.
//
// ---------------------------------------------------------------------------
// What is generated and what is not
// ---------------------------------------------------------------------------
//
// ONLY the silhouette and the kerb. The surface stays the drawing's single flat
// tone and the centreline stays the artist's hand-scattered dashes, replayed
// and trimmed to whatever the new outline covers. That separation is not a
// policy, it is the measurement in `layers.test.ts`: zero of the reference drawing's 127
// centreline pixels sit in the outer ring, so the boundary has nowhere to reach
// them from.
//
// ---------------------------------------------------------------------------
// The three invariants
// ---------------------------------------------------------------------------
//
//  1. EVERY OPEN BORDER SHOWS ONE PROFILE, or the sheet stops tiling. For a
//     generated edge this is inherited from pathField's seam proof: at an open
//     border the nearest skeleton element is the arm crossing it, so every one
//     of the 16 tiles evaluates the same |offset| there, and `s` is that
//     border's own world coordinate. The wave periods all divide the tile, so
//     they are in phase across a seam too.
//
//     The wave has to be one-sided for this to hold — see `arcWaveOffset`,
//     which is where the cost of that is written down.
//
//  2. THE ROAD STAYS CONNECTED. The arcs bite from both sides at the same `s`,
//     so the road is `2*distance - amplitude` across at a pinch. That is not a
//     smooth bound in practice — see `ARC_CEILING`, which is measured.
//
//  3. CLOSED BORDERS STAY EMPTY. The closed-border mask enforces it outright;
//     `MAX_EDGE_DISTANCE` is where the outline would START being clipped by it,
//     which is a look constraint rather than a correctness one.
//
// All three are asserted per mask in `boundary.test.ts` rather than
// trusted — the last two versions of this file each broke one of them in a way
// the argument said was impossible.

import { BAND_NONE, BAND_EDGE, BAND_ALT, depthMap, OUTPUT_SIZE, type Layers } from './layers';
import { crumbleTone, isJunction, dashOn, alongFromCrossing, AXIAL_PERIODS } from './axial';
import { areaAt, maxAreaBend } from './areaField';
import { edgeDisplacement, type EdgeStyle } from './edgeStyles';
import { nearestElement, TILE_SIZE, BORDER_CLEARANCE, type ShapeParams } from './pathField';
import { DIRECTIONS } from './twoEdge';

/**
 * Which reading of the 16 masks the sheet is.
 *
 * ⚠ The same 16 masks mean two different things, and an importer that guesses
 * wrong gets a sheet that looks plausible and connects wrongly — which is why
 * the exported JSON names it.
 *
 *   network  the cell is a ROAD; the bits say which way it runs
 *   area     the cell IS terrain; the bits say whether it continues
 *
 * ⚠ THE AREA READING IS THE CHEAP ONE, and `docs/AUTOTILE_SCHEMES.md` §4 counts
 * the cost exactly: a quadrant needs five states and a 2-edge mask can express
 * four. The missing one is the CONCAVE corner, which needs the diagonal. So an
 * L-shaped region's inside corner has a step in it — measured, and see
 * `areaField.ts` for where and how big.
 */
export type Scheme = 'network' | 'area';

export const SCHEMES: readonly { id: Scheme; zh: string }[] = [
  { id: 'network', zh: '网络（路/河/墙）' },
  { id: 'area', zh: '区域（地形）' },
];

export type EdgeKind = 'straightRound' | 'arcWave';

export const EDGE_KINDS: readonly { id: EdgeKind; zh: string; usesWave: boolean }[] = [
  { id: 'straightRound', zh: '直线圆角', usesWave: false },
  { id: 'arcWave', zh: '圆弧波浪线', usesWave: true },
];

export function edgeUsesWave(kind: EdgeKind): boolean {
  return EDGE_KINDS.find((k) => k.id === kind)?.usesWave ?? false;
}

// ---------------------------------------------------------------------------
// 边界噪点 — the outline's own wobble, as opposed to its colouring
// ---------------------------------------------------------------------------
//
// This is the control the sheet was missing, and the measurement that says so
// is blunt: **路沿实心度 does not move a single opaque pixel.** At coverage 0
// and at coverage 1 the sheet has the same 9196 of them. It decides how many
// outer-ring pixels take a kerb TONE instead of the surface tone, and the
// silhouette underneath stays a clean mathematical threshold either way. So
// nothing in this file could dissolve an outline until now.
//
// The arc could not stand in for it either, because it is the wrong shape at
// the wrong scale. Measured off the reference drawing's straight north-south tile, at the
// art's own 16px, the extent of each flank per row:
//
//   left   4, 4, 4, 4, 3, 3, 2, 3, 4, 4, 4, 4, 5, 5, 4, 4
//   right  11,11,10,11,10, 9,10,10,11,11,10,11,12,11,12,11
//
// That is ±1 art pixel around the mean, occasionally 2, and it is APERIODIC:
// the autocorrelation of the deviation runs 0.62 at lag 1, 0.22 at lag 2 and
// -0.005 at lag 3, with no positive peak at any lag out to 8. The edge is
// correlated over about two pixels and then it is gone. The arc wave, next to
// it, is `9,9,9,9,10,11,11,10` repeating exactly every 8 px with an amplitude
// up to 4, and one-sided into the bargain — a scallop, not a hand.
//
// So the missing piece is a SMALL APERIODIC DISPLACEMENT OF THE OUTLINE, which
// is exactly what `edgeStyles` already is. That family is not new code and not
// the deleted experiment: it is the analytic mode's own, already tile-periodic
// and already swept by `edgeStyles.test.ts`, and its `gravel` entry was tuned
// against THIS drawing (its comment cites the 64.4% adjacent-boundary-pixel
// agreement that a smooth wobble overshoots and a pure dither undershoots).
//
// ⚠ NOT the displacement experiment that was deleted, and the difference is the
// whole point. That one perturbed the ARTIST'S crumbly edge, where the noise
// was drowned by the art beneath it and "straight" was unreachable by
// construction. This perturbs a GENERATED edge, which starts clean — the
// opposite direction, and the one where the control has something to do.
//
// Only the position-based half of the family is offered. `wave` and `scallop`
// are functions of `s`, which is what 圆弧波浪线 already is, and a second
// control for the same thing is the duplicate-entry failure. That exclusion
// also buys the seam argument outright: a displacement that never reads `s`
// cannot care which axis `s` came off, so the trap that forced the arc to be
// one-sided does not apply and this noise may bulge OUTWARD as the drawing's
// does. `boundary.test.ts` measures that rather than trusting it.
export const ROUGH_STYLES: readonly { id: EdgeStyle; zh: string }[] = [
  { id: 'smooth', zh: '无' },
  { id: 'hand', zh: '手绘' },
  { id: 'gravel', zh: '砂砾' },
  { id: 'jagged', zh: '碎石' },
  { id: 'boulder', zh: '巨砾' },
  { id: 'thorn', zh: '荆棘' },
  { id: 'moss', zh: '苔藓' },
];

/**
 * Jitter lattice cells per tile. Hardcoded rather than exposed, because every
 * style clamps it into its own range anyway — gravel forces at least 8, boulder
 * at most 3, moss 2 to 6 — so a slider would be a near-no-op on most of them.
 * 4 is the analytic mode's own default.
 */
const ROUGH_LATTICE = 4;

export const ROUGHNESS_STEP = 0.25;
/** The drawing wobbles by about 1 art px = 2 output px; 3 leaves headroom. */
export const MAX_ROUGHNESS = 3;
export const DEFAULT_ROUGHNESS = 2;

/**
 * How far the outline may wobble at this distance, in output px.
 *
 * ---------------------------------------------------------------------------
 * This was a measured table, and throwing it away was the right answer
 * ---------------------------------------------------------------------------
 *
 * The first version was a 6 x 60 sweep — one ceiling per style per distance,
 * measured over 12 seeds, in the shape `ARC_CEILING` has. It was wrong, and how
 * it was wrong is worth keeping: the binding failure was DETACHED SPECKS, one
 * or two pixels shed off the edge, and whether a given amplitude sheds one
 * depends on the SEED. Twelve seeds is a sample, not a proof. Tested at seeds
 * 13-20, which the table had never seen, it failed 60 times.
 *
 * More seeds does not fix a sampled bound, it only moves where it breaks. So
 * the specks are dealt with where they happen — `pruneOrphans` drops them at
 * generation time, without touching a single border pixel, so the seam is
 * untouched by construction.
 *
 * What is left here is the part that is exact and seed-free:
 *
 *   * `distance / 2` — how deep a bite the road can take. NOT `distance - 0.5`,
 *     which is what "cannot be bitten deeper than it is wide" gives and which
 *     is too generous by a lot: at distance 4 it allows a 3px wobble on a road
 *     8px across, and measured, that leaves 1px necks that come apart. Half the
 *     half-width is both safe and the honest reading of a control whose whole
 *     job is a hand's wobble.
 *   * `BORDER_CLEARANCE - distance` — nothing may bulge onto a closed border.
 *
 * Both are arithmetic and both hold for every seed. `MAX_ROUGHNESS` caps
 * it as a matter of taste rather than geometry: the drawing wobbles by about
 * one art pixel, so 3 output px is already well past imitating it.
 */
export function maxRoughness(distance: number): number {
  const envelope = Math.min(distance / 2, BORDER_CLEARANCE - distance);
  return Math.max(0, Math.min(MAX_ROUGHNESS,
    Math.floor(envelope / ROUGHNESS_STEP) * ROUGHNESS_STEP));
}

export function edgeUsesRough(o: EdgeOptions): boolean {
  return o.roughStyle !== 'smooth' && o.roughness > 0;
}

// ---------------------------------------------------------------------------
// 路沿花纹 — a periodic motif ON the kerb, as opposed to the kerb's colouring
// ---------------------------------------------------------------------------
//
// Three things now act on the kerb and they are deliberately separate:
//
//   路沿实心度  which TONE each kerb pixel takes (a dither; moves no pixel)
//   边界噪点    where the OUTLINE is (moves pixels; the kerb rides along)
//   路沿花纹    which pixels are kerb AT ALL, periodically along the road
//
// ⚠ THE MOTIF MUST BE EVALUATED ON BOTH SIDES OF THE KERB'S INNER FACE. An
// earlier version of this idea only ever ran on pixels that were already kerb,
// which made "thicken inward" set a kerb pixel to kerb — a complete no-op that
// rendered as a plain kerb and read as a subtlety rather than as the nothing it
// was. `tick` therefore looks at the surface pixel just inside, and `dash` at
// the kerb pixel itself.
//
// ⚠ It reads `along`, NOT `s`. One world axis cannot follow a road round a
// bend, so `s` jumps 14px at every corner — measured — and a dashed kerb would
// not hitch there, it would break. `along` is the continuous blend.
//
// Ticks grow INWARD only. Outward is where the border-clearance budget lives,
// and the outline has already spent it.
export type KerbMotif = 'none' | 'dash' | 'tick';

export const KERB_MOTIFS: readonly { id: KerbMotif; zh: string }[] = [
  { id: 'none', zh: '无' },
  { id: 'dash', zh: '虚线' },
  { id: 'tick', zh: '齿' },
];

/** Periods along the road, in output px. Divisors of the tile — see the seam. */
export const KERB_PERIODS = AXIAL_PERIODS;
export const DEFAULT_KERB_PERIOD = 8;

/**
 * Tooth widths in OUTPUT px, EVEN.
 *
 * A tooth is centred on the crossing by `alongFromCrossing`, so the test is
 * `r < width / 2` with `r` a half-integer on a straight run. An odd width puts
 * the threshold exactly on a sample and which pixels are painted stops being
 * decided by the control. Same fact the ribs and the centreline both meet.
 */
export const KERB_WIDTHS = [2, 4, 6] as const;
export const DEFAULT_KERB_WIDTH = 2;

/** The widest tooth this period can hold, leaving 2px of plain kerb between. */
export function maxKerbWidth(period: number): number {
  return Math.min(KERB_WIDTHS[KERB_WIDTHS.length - 1], period - 2);
}

/** The widths the control may offer at this period. Always at least one. */
export function kerbWidthsFor(period: number): number[] {
  const offered = KERB_WIDTHS.filter((w) => w <= maxKerbWidth(period));
  return offered.length > 0 ? offered : [KERB_WIDTHS[0] as number];
}

export function edgeUsesKerbMotif(o: EdgeOptions): boolean {
  return o.kerbMotif !== 'none';
}

/**
 * How the motif changes this pixel, given how deep into the kerb it is.
 *
 * `depth` is measured in kerb widths from the kerb's INNER face: 0 to 1 is the
 * kerb itself, negative is the surface just inside it.
 *
 *   +1  this kerb pixel breaks back to plain surface
 *   -1  this surface pixel becomes kerb
 *    0  leave it
 */
export function kerbShift(along: number, depth: number, o: EdgeOptions): number {
  switch (o.kerbMotif) {
    case 'none':
      return 0;
    case 'dash':
      // Half on, half off, phased so a crossroads is symmetric — the same call
      // the dashed centreline makes, through the same function.
      return depth >= 0 && depth < 1 && !dashOn(along, o.kerbPeriod) ? 1 : 0;
    case 'tick':
      return depth < 0 && depth >= -1
        && alongFromCrossing(along, o.kerbPeriod) < o.kerbWidth / 2 ? -1 : 0;
  }
}

/**
 * The skeleton the generated edges are built on, in 32-space units.
 *
 * Every number is measured off the reference drawing rather than chosen — it is the
 * fit that the (now deleted) analytic preset carried, which reproduces 92.70%
 * of the drawing's pixels. So "直线圆角" is not a different road, it is THIS
 * road with the artist's hand taken out of the edge.
 *
 * Hardcoded rather than exposed as sliders for now: the point of the control is
 * to change the character of the edge, and a width slider would let it drift
 * away from the art it is composited with.
 */
const FIT: ShapeParams = {
  bend: 11, cap: 'round', isolatedDot: true,
  dotScale: 1.6,   // replaced per call by `dotScaleFor` — see below
};
/** Surface half-width, then the kerb on top of it. 32-space units. */
const FIT_HALF_WIDTH = 5.25;
const FIT_KERB = 2;
const FIT_TOTAL = FIT_HALF_WIDTH + FIT_KERB;

/**
 * Kerb thickness, in OUTPUT pixels — the sheet is 32px per tile now, whatever
 * the art was drawn at. Fixed: the distance control moves the outer boundary
 * and the kerb rides on it, exactly as blob47's offset slides a band without
 * changing the widths inside it.
 */
export const KERB_PX = FIT_KERB;
/** What the fit measures the boundary-to-centre distance as. 32-space units. */
export const FIT_DISTANCE = FIT_TOTAL;

/**
 * How much of the road is SURFACE rather than kerb, in output px — the room a
 * centreline actually has to sit in.
 *
 * Under 原版 that is the fit's own half-width, because the boundary is then the
 * artist's and the fit is what measures it. Under a generated edge it follows
 * the distance control, since the kerb rides on the outer boundary rather than
 * being measured from the centre.
 */
export function surfaceHalfFor(o: EdgeOptions): number {
  // In the area reading `t` counts in from the boundary, so the "surface" a
  // motif has to live in is however deep the region gets — half a tile, less
  // the kerb — rather than a function of the inset.
  if (o.scheme === 'area') return Math.max(0, TILE_SIZE / 2 - KERB_PX);
  return Math.max(0, o.distance - KERB_PX);
}

/**
 * The corner radius the area reading uses, in output px.
 *
 * Taken from the ARC AMPLITUDE control rather than given one of its own: in the
 * network reading that slider says how deeply the outline swings, and here it
 * says how far the corner is cut. Both are "how much is taken off the edge",
 * both are bounded by the same geometry, and a second slider that meant almost
 * the same thing is how this app has repeatedly ended up with dead controls.
 */
export function areaBendFor(o: EdgeOptions): number {
  return Math.min(o.amplitude * 2, maxAreaBend(o.distance));
}

/**
 * Where the distance slider STARTS, which is not where the fit sits.
 *
 * The fit is a measurement of the drawing and stays one; this is a choice. It
 * only ever shows once the edge is no longer `asDrawn`, because under 原版 the
 * slider is hidden — there the drawn boundary IS the boundary. So the question
 * it answers is "how wide is a GENERATED road before anyone touches it", and
 * there the drawing's own 7.25 reads thin against a live edge.
 *
 * 11 and not more: the range runs to 15.5, but from about 11 up two roads a
 * cell apart stop having visible ground between them and read as one plaza.
 *
 * 11 and not 10.75: 11 is one of the entries where ARC_CEILING is back at the
 * full 4 (10.75 caps at 3.75), so starting here costs the wave nothing.
 */
export const DEFAULT_EDGE_DISTANCE = 11;

/**
 * How far the boundary may sit from the road's centre, in output pixels.
 *
 * RE-MEASURED at 32, not doubled from the 16px values — the same discipline
 * blob47 needed when it raised PATTERN_TILE_SIZE, where the positive end came
 * out at 6.25 and doubling would have claimed 5.5. Every number below is a
 * sweep of all 16 masks through the real pipeline, and it stops where blob47's
 * offset range stops:
 *
 *   * the top end stops before a tile draws on a CLOSED border, where the mask
 *     clips it flat against a neighbour that draws nothing.
 *   * the bottom end stops before a mask renders as nothing at all, or in
 *     pieces. Thinning on the way down is a legitimate look; vanishing is not.
 *
 * The ISOLATED DOT used to bind the top end far below the roads', because its
 * radius is `distance * dotScale` and at 1.6x it hit the border while a road
 * was still 3px clear. It no longer does — `dotScaleFor` pulls the multiplier
 * in as the road widens — so what binds now is the road itself, which is what
 * "push it to the edge" should mean.
 *
 * `boundary.test.ts` asserts the range is TIGHT in both directions.
 */
export const MIN_EDGE_DISTANCE = 0.75;
export const MAX_EDGE_DISTANCE = 15.5;
export const EDGE_DISTANCE_STEP = 0.25;

/**
 * The isolated cell's blob is `distance * dotScale` across, so at a wide road
 * it outgrows the tile long before the road does. The multiplier is therefore
 * pulled in to whatever still fits, exactly as the analytic recipe clamps
 * `dotScale` against BORDER_CLEARANCE.
 *
 * 1.6 is the measured value — an artist draws a lone cell as a blob you can
 * see, not as a road-width full stop — so it is kept wherever there is room,
 * and only given up when the alternative is a dot clipped square.
 */
export const DOT_SCALE = 1.6;

export function dotScaleFor(distance: number, rough = 0): number {
  if (distance <= 0) return DOT_SCALE;
  // The dot is drawn where `hypot / scale < distance + rough`, so its radius is
  // `scale * (distance + rough)` — the noise multiplies through the scale
  // rather than adding to the radius. Subtracting `rough` from the clearance
  // instead is the obvious wrong answer and it clips: at distance 11 with 1px
  // of noise it gives radius 15.8 against a 15.5 budget, and the isolated cell
  // is the first mask to fail.
  return Math.min(DOT_SCALE, BORDER_CLEARANCE / (distance + Math.max(0, rough)));
}

/**
 * The largest arc amplitude each distance can carry, measured the same way.
 *
 * ⚠ RE-MEASURED when the lobe became a true circular arc. It had to be: the
 * table describes where a shape stops fitting, and the shape changed. It moved
 * a long way — the ellipse collapsed at 4.75->5.00, 8.00, 9.00 and 13.00, and
 * the circle collapses at 5.00->5.25, 8.00->8.25, 9.00->9.25 and 13.00->13.25
 * instead, with almost every entry HIGHER because a gentler lobe pinches the
 * road less at the same depth. Do not carry a table across a shape change.
 *
 * A table and not a formula, for the same reason blob47 keeps a per-pattern
 * `PATTERN_OFFSET_RANGE`: the real answer is not smooth. It climbs with the
 * distance and then COLLAPSES before climbing back — those are pixel-grid
 * resonances between the arcs and the round cap on a dead end, and no tidy
 * expression
 * reproduces them. Guessing a smooth bound would either forbid settings that
 * work or allow ones that sever the road.
 *
 * RE-MEASURED at 32 rather than doubled from the 16px table; the shape is not
 * the same shape scaled, which is exactly what blob47 found when its own offset
 * range had to be re-derived.
 *
 * Indexed from MIN_EDGE_DISTANCE in steps of EDGE_DISTANCE_STEP. The test
 * asserts each entry is TIGHT: that value passes every invariant and one step
 * more fails.
 */
const ARC_CEILING: readonly number[] = [
  //  0.75  1.00  1.25  1.50   1.75  2.00  2.25  2.50
  0.25, 0.50, 0.75, 1.00,  1.25, 1.50, 1.75, 2.00,
  //  2.75  3.00  3.25  3.50   3.75  4.00  4.25  4.50
  2.25, 2.50, 2.75, 3.00,  3.25, 3.50, 3.75, 4.00,
  //  4.75  5.00  5.25  5.50   5.75  6.00  6.25  6.50
  4.00, 4.00, 2.25, 2.50,  2.75, 3.00, 3.25, 3.50,
  //  6.75  7.00  7.25  7.50   7.75  8.00  8.25  8.50
  3.75, 4.00, 4.00, 4.00,  4.00, 4.00, 2.75, 3.00,
  //  8.75  9.00  9.25  9.50   9.75 10.00 10.25 10.50
  2.50, 2.75, 2.25, 2.50,  2.75, 3.00, 3.25, 3.50,
  // 10.75 11.00 11.25 11.50  11.75 12.00 12.25 12.50
  3.75, 4.00, 4.00, 4.00,  4.00, 4.00, 4.00, 4.00,
  // 12.75 13.00 13.25 13.50  13.75 14.00 14.25 14.50
  4.00, 4.00, 2.25, 2.50,  2.75, 3.00, 3.25, 3.50,
  // 14.75 15.00 15.25 15.50
  3.75, 4.00, 4.00, 4.00,
];

/** How far the arcs may swing at this boundary distance, in output px. */
export function maxArcAmplitude(distance: number): number {
  const i = Math.round((distance - MIN_EDGE_DISTANCE) / EDGE_DISTANCE_STEP);
  return ARC_CEILING[Math.max(0, Math.min(ARC_CEILING.length - 1, i))];
}

/**
 * Wave periods, in OUTPUT pixels. All divide the 32px tile, which is what keeps
 * an arc in phase across a seam.
 *
 * 4 divides it too and is left out: one arc every four pixels is noise rather
 * than an arc, and at full amplitude it chopped a dead end's cap into slivers —
 * the connectivity test caught it at the 16px equivalent.
 */
export const ARC_PERIODS = [8, 16, 32] as const;
export const DEFAULT_ARC_PERIOD = 16;

/**
 * Wave depth, in pixels of the drawing: how much narrower the road gets at the
 * bottom of an arc than at the top of one.
 *
 * This is the ceiling of the ceilings — the actual limit depends on how far out
 * the boundary is, see `maxArcAmplitude`.
 */
export const MAX_ARC_AMPLITUDE = 4;
export const ARC_AMPLITUDE_STEP = 0.25;

export interface EdgeOptions {
  /** Which reading. See `Scheme` — it changes what the whole sheet means. */
  scheme: Scheme;
  kind: EdgeKind;
  /**
   * Distance from the road's centre to its outer boundary, in drawing pixels.
   * The kerb keeps its own width and rides outward with it.
   */
  distance: number;
  /** `arcWave` only: arc period along the road, in drawing pixels. */
  period: number;
  /** `arcWave` only: how far the arcs swing, in drawing pixels. */
  amplitude: number;
  /**
   * Share of the generated kerb ring that takes a TONE. 1 is a solid outline,
   * which is what blob47's clean edges look like; lower dithers the colouring.
   *
   * ⚠ It does not move the outline. Measured, the sheet has the same 9196
   * opaque pixels at 0 and at 1 — this dithers what colour a pixel already on
   * the road takes, and `roughness` is what dissolves the road's own shape.
   */
  coverage: number;
  /** Which noise displaces the outline itself. `smooth` is none. */
  roughStyle: EdgeStyle;
  /** How far it displaces it, in output px. 0 is none. */
  roughness: number;
  /** Dice, shared by the kerb dither and the outline noise — one hand drew both. */
  seed: number;
  /** A periodic motif ON the kerb: broken by a dash, or thickened by a tooth. */
  kerbMotif: KerbMotif;
  /** Its period along the road, in output px. Must divide the tile. */
  kerbPeriod: number;
  /** `tick` only: how wide a tooth is along the road, in output px. Even. */
  kerbWidth: number;
}

export const DEFAULT_EDGE: EdgeOptions = {
  scheme: 'network',
  kind: 'straightRound',
  distance: DEFAULT_EDGE_DISTANCE,
  period: DEFAULT_ARC_PERIOD,
  amplitude: 1,
  coverage: 1,
  roughStyle: 'smooth',
  roughness: DEFAULT_ROUGHNESS,
  seed: 1,
  kerbMotif: 'none',
  kerbPeriod: DEFAULT_KERB_PERIOD,
  kerbWidth: DEFAULT_KERB_WIDTH,
};

/**
 * How far the boundary swings at this point along the road, in drawing pixels.
 * Always in [-amplitude, 0] — the arcs bite INWARD only, never outward.
 *
 * The shape is a chain of alternating CIRCULAR ARCS, out for half a period and
 * in for the next, meeting at a corner where a sine would meet smoothly — that
 * corner is what makes the edge read as scalloped rather than wobbly, and it is
 * what blob47's menu calls a "regular circular arc edge".
 *
 * ---------------------------------------------------------------------------
 * It used to say that and not do it
 * ---------------------------------------------------------------------------
 *
 * The first version took a UNIT semicircle and scaled it by `period/2` along and
 * `amplitude/2` across. That is an ELLIPSE arc, and only a circle in the one
 * degenerate case where those two happen to be equal. Fitting a circle to it:
 *
 *   P=32 A=4   best fit R=21.5, max deviation 0.48px   (a true arc needs R=17)
 *   P=32 A=2   best fit R=41.8, max deviation 0.26px               R=32.5
 *   P=16 A=4   best fit R= 5.9, max deviation 0.35px               R=5
 *   P= 8 A=4   best fit R= 2.0, max deviation 0.00px  <- the degenerate one
 *
 * Half a pixel of deviation on a 32px tile is visible, and it is visible in the
 * specific way the user reported: an ellipse arc squashed this hard has VERTICAL
 * tangents where the lobes meet, so the boundary parks at each extreme for ten
 * rows and then crosses the middle in one. At P=32 A=4 it used four integer
 * columns in five steps and SKIPPED one entirely. The true arc uses five columns
 * in eight steps, spread 8-6-4-6-8. At P=16 A=3 the distribution goes from
 * 12-4-4-12 to a flat 8-8-8-8.
 *
 * `arcRadiusFor` is the other half of the fix: given the period, radius and
 * amplitude are the same degree of freedom, and RADIUS is the one that makes a
 * shallow small-angle sector expressible. See it for the conversion.
 *
 * The whole chain is then shifted so its outward peaks sit exactly ON the
 * straight-round outline instead of outside it. That is not cosmetic and it is
 * not free — it costs half the swing — but it is the only version that tiles:
 *
 *   an outward bulge lights up pixels 7.25 to 10.25 units from the skeleton,
 *   and out there, in a corner tile, the nearest skeleton element can be the
 *   OTHER arm. `s` then comes off a different axis, so two masks that must
 *   present the same border profile compute different phases and the sheet
 *   stops tiling. Measured: all 12 arcWave settings failed invariant 1 that
 *   way. Inside 7.25 the axis is uniform along every open border, for all 16
 *   masks, at both bend 4 and bend 11 — that is measured too.
 *
 * Visually it costs nothing, because "where the nominal outline was" is not
 * something the eye can see in the result.
 */
export function arcWaveOffset(s: number, period: number, amplitude: number): number {
  const half = amplitude / 2;
  if (half <= 0) return 0;
  const c = period / 4;                              // half-chord of one lobe
  const r = arcRadiusFor(period, amplitude);
  const phase = (((s % period) + period) % period) / period;
  const out = phase < 0.5;
  const u = (out ? phase * 2 : (phase - 0.5) * 2) * 2 - 1;   // -1..1 across the lobe
  const x = u * c;
  // The circle through both lobe ends and the apex: 0 at the ends, `half` at
  // the middle. Normalised so the caller still speaks in amplitude.
  const y = Math.sqrt(Math.max(0, r * r - x * x)) - (r - half);
  const k = Math.max(0, Math.min(1, y / half));
  return -half * (1 + (out ? -k : k));
}

/**
 * The radius of one lobe, given the period and how deep it swings.
 *
 * Given the PERIOD, radius and amplitude are the same degree of freedom — a
 * lobe is an arc through three known points, so fixing two of the three
 * quantities fixes the third. The same "three numbers, two degrees of freedom"
 * the dashed centreline's derived gap runs on.
 *
 * Radius is the handle worth exposing, because it is the one that makes the
 * shape legible: `r = period / 4` is a half-circle (a 90 degree half-angle, as
 * deep as the lobe can be), and a LARGE radius is a shallow small-angle sector
 * — the thing an eye reads as a gentle arc rather than a scallop. At period 32:
 *
 *   R=17  half-angle 28.1 deg   amplitude 4.00
 *   R=26  half-angle 17.8 deg   amplitude 2.50
 *   R=40  half-angle 11.5 deg   amplitude 1.62
 *   R=80  half-angle  5.7 deg   amplitude 0.80
 *
 * AMPLITUDE stays the stored quantity even so, and that is deliberate: it is
 * what `ARC_CEILING` is measured in, what the pinch bound is written in, and
 * what snaps onto a step that renders differently. A radius stored raw would
 * have dead stops all over its top end, where a whole span of radii round to
 * one amplitude and draw one picture. So the control moves in radius and the
 * value comes back through here — see `arcAmplitudeFor`.
 */
export function arcRadiusFor(period: number, amplitude: number): number {
  const c = period / 4;
  const h = Math.max(1e-6, amplitude / 2);
  return (c * c + h * h) / (2 * h);
}

/** The inverse: how deep a lobe of this radius swings, at this period. */
export function arcAmplitudeFor(period: number, radius: number): number {
  const c = period / 4;
  if (radius <= c) return 2 * c;                     // a half-circle, the deepest
  return 2 * (radius - Math.sqrt(radius * radius - c * c));
}

/** Half-angle of the lobe, in degrees. 90 is a half-circle. */
export function arcAngleFor(period: number, amplitude: number): number {
  const c = period / 4;
  const r = arcRadiusFor(period, amplitude);
  return (Math.asin(Math.max(-1, Math.min(1, c / r))) * 180) / Math.PI;
}

/**
 * Where the generated outline sits at this pixel: how far the boundary is, and
 * how far the pixel is. Inside when `t < outer`.
 *
 * Factored out so `wouldClip` asks exactly the question `generateEdge` answers,
 * rather than a second copy of it that could drift.
 */
export interface SkeletonAt {
  /** Distance across, from the road's centre. 32-space units. */
  t: number;
  /**
   * Distance ALONG, in the same 32-space the periods are quoted in — the world
   * coordinate of whichever axis `axis` names. JUMPS at a corner; the arc wave
   * uses it because its measured ARC_CEILING was taken with it.
   */
  s: number;
  /**
   * The same thing, CONTINUOUS through a corner. Anything drawing a motif that
   * has to read as one unbroken line wants this one — see `Nearest.along`, and
   * the 14px break it exists to remove.
   */
  along: number;
  /**
   * The same distance across, SIGNED: which side of the axis the pixel is on.
   *
   * Magnitude is `t`, so on an arm it is exactly the world coordinate minus the
   * tile centre. The SIGN comes from the world and therefore flips half way
   * round a corner, for the same reason `s` does and with the same excuse: a
   * road network has no orientation, so "left" is not a thing a tile can know.
   * A motif that leans to one side leans the other way after a bend.
   */
  signedT: number;
  /** Which arm `s` came off, or null where the field has no direction. */
  axis: 'x' | 'y' | null;
}

/**
 * Where this pixel sits on the fitted road: across, along, and off which arm.
 *
 * Exported because the centreline needs exactly this and nothing else, and a
 * second copy of the FIT constants is precisely how the two would drift apart
 * — a line drawn on a slightly different skeleton than the outline is a bug
 * with no symptom until someone looks closely at a corner.
 *
 * `dotScale` is taken from the edge options for the same reason: the isolated
 * cell's blob shrinks as the road widens, and a centreline computed against the
 * unshrunk one would sit off-centre on that tile alone. Under 原版 there is no
 * distance in play at all — the blob on screen is the artist's — so the fit's
 * own multiplier is what the field has to be asked about.
 */
export function skeletonAt(
  bits: number, x: number, y: number, size: number, o: EdgeOptions
): SkeletonAt | null {
  const scale = TILE_SIZE / size;
  const u = (x + 0.5) * scale;
  const v = (y + 0.5) * scale;
  const dotScale = dotScaleFor(o.distance, edgeUsesRough(o) ? o.roughness : 0);
  const near = nearestElement(u, v, bits, { ...FIT, dotScale });
  if (!Number.isFinite(near.t)) return null;
  // `s` in the SAME 32-space the periods are quoted in, so a motif keeps its
  // phase across a seam whatever the output resolution is.
  const s = near.axis === 'x' ? u : near.axis === 'y' ? v : 0;
  // Across is the OTHER axis: a road running east-west is crossed going north.
  const c = TILE_SIZE / 2;
  const across = near.axis === 'x' ? v - c : near.axis === 'y' ? u - c : 0;
  return {
    t: near.t,
    s,
    along: near.along ?? s,
    signedT: across < 0 ? -near.t : near.t,
    axis: near.axis,
  };
}

/**
 * (t, s) from the ARMS ALONE: straight rays out of the tile centre, one per
 * connection, and the nearest one wins.
 *
 * Used at junctions only. Thresholding the ROAD's skeleton there does not draw
 * a crossroads, it draws a star — the skeleton joins its arms with circular
 * arcs of radius `bend`, and anything narrow enough to read as a marking traces
 * those arcs as four long diagonals over the cross. `t` is the distance to the
 * nearest ray's axis and `s` runs along it, exactly the meanings `skeletonAt`
 * gives them, so everything downstream (the dash phase, a band's spacing, the
 * seam argument) is unchanged. A pixel behind the centre relative to a ray is
 * not on it; the other arms cover that side, which is what makes the union a
 * clean cross or T rather than a plus with stubs.
 */
function armAt(bits: number, x: number, y: number, size: number): SkeletonAt | null {
  const scale = TILE_SIZE / size;
  const u = (x + 0.5) * scale;
  const v = (y + 0.5) * scale;
  const c = TILE_SIZE / 2;
  let best: SkeletonAt | null = null;
  for (const d of DIRECTIONS) {
    if (!(bits & d.bit)) continue;
    const horizontal = d.dx !== 0;
    if ((horizontal ? (u - c) * d.dx : (v - c) * d.dy) < 0) continue;
    const t = horizontal ? Math.abs(v - c) : Math.abs(u - c);
    if (best && t >= best.t) continue;
    const s = horizontal ? u : v;
    const across = horizontal ? v - c : u - c;
    // At a junction the arms are straight rays, so there is no corner for the
    // two to differ over.
    best = { t, s, along: s, signedT: across, axis: horizontal ? 'x' : 'y' };
  }
  return best;
}

/**
 * Where a GENERATED layer reads its coordinates from: the arms at a junction,
 * the road's own skeleton everywhere else.
 *
 * One implementation for both of them, and that is deliberate for the reason
 * `skeletonAt` is shared rather than copied — a centreline and a surface
 * texture computed against slightly different roads is a bug with no symptom
 * until someone looks closely at a junction.
 */
export function roadCoords(
  bits: number, x: number, y: number, size: number, edge: EdgeOptions
): SkeletonAt | null {
  return isJunction(bits) ? armAt(bits, x, y, size) : skeletonAt(bits, x, y, size, edge);
}

/**
 * How far this pixel is from where the outline would be with no displacement,
 * and how far the outline actually is once the arc and the noise have moved it.
 *
 * ⚠ The two schemes put the ZERO in different places and that is the whole of
 * the difference downstream. In the network reading `t` is measured out from
 * the road's SKELETON and the outline sits at `distance`. In the area reading
 * there is no skeleton to measure from, so `t` is measured in from the region's
 * own BOUNDARY, negated so that "inside" is still "less than the threshold" —
 * and the threshold is then 0. Everything after this point, the arc swing, the
 * noise, the kerb, the ring peel, is written against that one comparison and
 * needs no second version of itself.
 */
function outlineAt(
  bits: number, x: number, y: number, size: number, o: EdgeOptions
): { t: number; outer: number; swing: number; along: number; edge?: number } | null {
  if (o.scheme === 'area') {
    const scale = TILE_SIZE / size;
    const u = (x + 0.5) * scale;
    const v = (y + 0.5) * scale;
    let rough = 0;
    if (edgeUsesRough(o)) {
      rough = o.roughness * edgeDisplacement(o.roughStyle, u, v, o.seed, ROUGH_LATTICE);
    }
    const at = areaAt(u, v, bits, { inset: o.distance, bend: areaBendFor(o) });
    // ⚠ The noise displaces the EDGE, never the flush sides. A connected side
    // is not a boundary and must stay exactly where it is or the sheet stops
    // tiling — so a fully surrounded cell is solid whatever the noise says.
    const cut = Math.min(at.inside, at.edge - rough);
    // Negated, because every test downstream is `t < outer` and here the
    // outline is simply where the distance runs out.
    return { t: -cut, outer: 0, swing: 0, along: 0, edge: at.edge };
  }
  const near = skeletonAt(bits, x, y, size, o);
  if (!near) return null;
  const swing = edgeUsesWave(o.kind) && near.axis !== null
    ? arcWaveOffset(near.s, o.period, o.amplitude)
    : 0;
  // The noise is a pure function of GLOBAL position — no style in the family
  // reads `s` at all any more — so two tiles sharing a border displace it
  // identically whatever each of them thinks its own axis is. That is what lets
  // this one be two-sided where the arc could not be.
  let rough = 0;
  if (edgeUsesRough(o)) {
    const scale = TILE_SIZE / size;
    rough = o.roughness
      * edgeDisplacement(o.roughStyle, (x + 0.5) * scale, (y + 0.5) * scale,
        o.seed, ROUGH_LATTICE);
  }
  return { t: near.t, outer: o.distance + swing + rough, swing, along: near.along };
}

/**
 * Would the outline have covered a CLOSED border, i.e. is it being clipped flat
 * against a neighbour that draws nothing?
 *
 * This is blob47's positive stop, restated: its offset range "stops before the
 * boundary reaches the cell border, where it would be clipped into a straight
 * line". The closed-border mask keeps the sheet correct at any distance, so
 * nothing breaks past this point — it just stops looking like a road and starts
 * looking like a road with a bite out of it, and the isolated dot goes first
 * because its radius is `distance * dotScale`.
 */
export function wouldClip(bits: number, size: number, o: EdgeOptions): boolean {
  for (const d of DIRECTIONS) {
    if (bits & d.bit) continue;
    for (let i = 0; i < size; i++) {
      const x = d.dx === 0 ? i : d.dx > 0 ? size - 1 : 0;
      const y = d.dy === 0 ? i : d.dy > 0 ? size - 1 : 0;
      const a = outlineAt(bits, x, y, size, o);
      if (a && a.t < a.outer) return true;
    }
  }
  return false;
}

/**
 * Drop every drawn component that is neither the main body nor touching an
 * OPEN border — without removing a single border pixel.
 *
 * This is what makes 边界噪点 safe at any amplitude rather than at a sampled
 * one. A displaced boundary sheds specks; the earlier displacement experiment
 * was abandoned partly over exactly that, "outward it sheds detached specks",
 * found by looking at a render. No ceiling measured over N seeds can promise it
 * will not, because seed N+1 is free to.
 *
 * ⚠ THE SEAM SURVIVES THIS, and the reason has to be exact. A component holding
 * a pixel on an OPEN border is never dropped, so no border pixel is ever
 * removed: the border profiles are byte-for-byte what they were and every seam
 * proof above still reads the same bytes. That matters because connectivity,
 * unlike a border profile, is a whole-tile property and therefore differs
 * between masks — "keep the largest" alone would remove different pixels in
 * different masks and split the very profiles the sheet tiles on.
 *
 * Keeping anything that reaches an open border is also the honest reading: such
 * a piece is not detached once the tile is laid down, it continues into the
 * neighbour.
 *
 * What this does NOT do is stop the road being bitten in half — two halves that
 * both reach open borders are both kept. That is what `maxRoughness`'s
 * `distance - 0.5` term is for, and that term is exact.
 */
function pruneOrphans(fill: Uint8Array, band: Uint8Array, bits: number, size: number): void {
  const comp = new Int32Array(size * size).fill(-1);
  const area: number[] = [];
  const onOpen: boolean[] = [];
  const stack: number[] = [];

  for (let start = 0; start < fill.length; start++) {
    if (!fill[start] || comp[start] >= 0) continue;
    const id = area.length;
    area.push(0);
    onOpen.push(false);
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      area[id]++;
      const x = i % size, y = (i / size) | 0;
      for (const d of DIRECTIONS) {
        if (!(bits & d.bit)) continue;
        const touching = d.dx !== 0
          ? x === (d.dx > 0 ? size - 1 : 0)
          : y === (d.dy > 0 ? size - 1 : 0);
        if (touching) onOpen[id] = true;
      }
      // 8-connected, matching the drawing: exactly 12 of its 1912 pixels hang
      // off a diagonal, so a 4-connected reading would call the art itself
      // broken.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const k = ny * size + nx;
          if (!fill[k] || comp[k] >= 0) continue;
          comp[k] = id;
          stack.push(k);
        }
      }
    }
  }

  // The main body is the biggest piece. On a mask with no open border at all —
  // the isolated cell — it is the only thing keeping anything.
  let best = -1, bestArea = -1;
  for (let id = 0; id < area.length; id++) {
    if (area[id] > bestArea) { bestArea = area[id]; best = id; }
  }
  for (let i = 0; i < fill.length; i++) {
    if (!fill[i]) continue;
    const id = comp[i];
    if (id === best || onOpen[id]) continue;
    fill[i] = 0;
    band[i] = BAND_NONE;
  }
}

/** 1 on any pixel of a closed border — where the tile may never draw. */
function closedBorderMask(bits: number, size: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  for (const d of DIRECTIONS) {
    if (bits & d.bit) continue;
    for (let i = 0; i < size; i++) {
      const x = d.dx === 0 ? i : d.dx > 0 ? size - 1 : 0;
      const y = d.dy === 0 ? i : d.dy > 0 ? size - 1 : 0;
      mask[y * size + x] = 1;
    }
  }
  return mask;
}

/**
 * Build the silhouette and kerb from the skeleton, and keep the artist's
 * surface tone and centreline on top.
 *
 * Everything is converted into pixels OF THE DRAWING before it is compared, so
 * the wave's period and amplitude mean what the UI says they mean at 16px
 * rather than in the 32-space the field is defined in.
 */
export function generateEdge(
  bits: number,
  o: EdgeOptions,
  size: number = OUTPUT_SIZE
): Layers {
  const closed = closedBorderMask(bits, size);

  const fill = new Uint8Array(size * size);
  const band = new Uint8Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (closed[i]) continue;                    // invariant 3
      // The kerb rides on the OUTER boundary rather than being measured from
      // the centre, so pulling the road in thins the surface and not the kerb —
      // which is what blob47's offset does, and the reason a narrow road still
      // reads as a road with an outline instead of as a bare stripe. It follows
      // the wobble for the same reason.
      const a = outlineAt(bits, x, y, size, o);
      if (!a) continue;
      const { t, outer, along } = a;
      if (t >= outer) continue;
      fill[i] = 1;
      // How far from a REAL boundary this pixel is. In the network reading
      // every side of the road is one; in the area reading the sides the
      // terrain runs through are not, and `outlineAt` says which.
      const fromEdge = a.edge ?? (outer - t);
      // The kerb is the outer ring of whatever the outline now is; it swings
      // with it so the surface underneath keeps its shape. Measured from the
      // OUTER edge rather than from the centre, so a wobble carries the kerb
      // with it instead of leaving bare surface poking through the dips.
      //
      // `depth` is in kerb widths from its INNER face, so it goes NEGATIVE on
      // the surface just inside — which is what makes a tooth expressible at
      // all. See `kerbShift`.
      let isKerb = fromEdge <= KERB_PX;
      if (edgeUsesKerbMotif(o)) {
        const shift = kerbShift(along, (KERB_PX - fromEdge) / KERB_PX, o);
        if (shift > 0) isKerb = false;
        else if (shift < 0) isKerb = true;
      }
      if (isKerb) {
        const tone = crumbleTone(x, y, { coverage: o.coverage, seed: o.seed });
        if (tone === 1) band[i] = BAND_EDGE;
        else if (tone === 2) band[i] = BAND_ALT;
      }
    }
  }

  // Specks first: a displaced boundary sheds them, and the ring peel below
  // would otherwise be describing a shape with confetti around it.
  if (edgeUsesRough(o)) pruneOrphans(fill, band, bits, size);

  // The rings are peeled from the silhouette this pass just built. They are the
  // across-road coordinate everything downstream reads, and they have to
  // describe THIS shape — see `depthMap`.
  return {
    size, fill, depth: depthMap(fill, size), band,
    centre: new Uint8Array(size * size),
  };
}

/**
 * Headroom against the closed-border budget, so the constants above cannot rot
 * silently. The arcs only ever bite inward, so the outline's furthest reach is
 * FIT_TOTAL itself — see invariant 3.
 */
export const arcClearance = () => BORDER_CLEARANCE - MAX_EDGE_DISTANCE;

/** Road width at the narrowest point of the wave, in output px. Invariant 2. */
export const arcPinchWidth = (distance: number, amplitude: number) =>
  2 * distance - amplitude;
