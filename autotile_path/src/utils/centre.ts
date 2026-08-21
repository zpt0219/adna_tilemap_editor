// centre.ts — the line down the middle of the road.
//
// The second layer of the three to come off the artist's hand. `boundary`
// took the outline; this takes the line down the middle, and the two are
// deliberately independent controls: a generated edge with the drawn dashes on
// it, or the artist's crumbly edge with a surveyed line inside it, are both
// reachable and both are things someone might want.
//
//   * 原版      the drawing's own dashes, replayed. Nothing is computed.
//   * 无花纹    no centreline at all — a plain dirt track.
//   * 直线圆角  one solid line on the fitted skeleton. Straight runs joined by
//               a circular corner, for the same reason the boundary's entry of
//               that name is: it is `t < w/2` on the same field, so the corner
//               is an arc without anyone drawing one.
//   * 双直线    two parallel lines, spaced off the ROAD's width rather than off
//               a second slider.
//   * 虚线      the solid line, chopped by a period along the road.
//   * 长短虚线  a long dash and a short one alternating, with the three
//               lengths exposed.
//   * 随机长短线  dashes of random length scattered along the axis AND nudged off
//               it sideways, never two of them touching. The sideways nudge is
//               the drawing's own: see JITTER_STEP.
//
// ---------------------------------------------------------------------------
// What the drawing measures as, since these numbers are the defaults
// ---------------------------------------------------------------------------
//
// the reference drawing has 127 centreline pixels across its 16 masks. Against the fitted
// skeleton their distance-across `t` falls (32-space, half-unit bins):
//
//   t<=1   89 px  70.1%      t<=2.5  100 px  78.7%      t<=3  122 px  96.1%
//
// So the artist's line is one drawing-pixel wide and sits ON the axis, with a
// second loose cluster about 1.5 drawing-pixels off it. `DEFAULT_CENTRE_WIDTH`
// is 2 output px — that same 1px line, lifted by the same factor of 2 the rest
// of the art is lifted by. It is a measurement, not a taste.
//
// JUNCTIONS ARE NOT SUPPRESSED, and that is measured too. The analytic mode
// stops its centreline short of a crossing (`junctionRadius` in axial.ts),
// which is what a real road does. This drawing does the opposite: the 4-arm
// mask puts 5 of its 13 centre pixels within 7.25 units of the tile centre and
// the 3-arm masks 5 to 7 of theirs. A dirt track's line runs straight through.
// Copying the analytic rule here would have contradicted the art it composites
// with. (The four CORNER masks do have zero centre pixels near the middle —
// but that is 5 pixels per tile in total, far too thin to model.)
//
// ---------------------------------------------------------------------------
// The four rules a generated line obeys
// ---------------------------------------------------------------------------
//
//  1. IT NEVER TOUCHES THE OUTER RING. Not a policy — the drawing's own line
//     never does either, 0 of 127 px, which is the measurement `layers`
//     was written to expose. Enforcing it here keeps a generated line off the
//     kerb whichever boundary it is composited with, including the crumbly
//     as-drawn one where "the kerb" is a broken two-tone dither rather than a
//     ring you could threshold against.
//
//  2. AT A JUNCTION THE LINES ARE STRAIGHT. Three or more arms meet at the
//     tile centre, and thresholding the ROAD's skeleton there does not draw a
//     crossroads — it draws a star. The skeleton joins its arms with circular
//     arcs of radius `bend` (11, against a road 14.5px across), so a hairline
//     threshold picks those arcs up as four long diagonals laid over the cross:
//
//         ............##.##.##............
//         ..........###..##..###..........
//         ........####...##...####........
//         ################################
//
//     That is the road's true centre — a road that wide really does cut its
//     corners — but as a painted marking it reads as a star, so at a junction
//     the line comes off the ARMS instead: straight rays out of the tile centre,
//     one per connection, unioned. See `armAt`.
//
//     A 2-arm CORNER keeps the arc. One line turning is not several lines
//     meeting, and its bend is the shape the road actually has there.
//
//  3. A CORNER IS ONE UNBROKEN LINE. The along-road coordinate has to be a
//     world coordinate at a border for the seams to work, and one world axis
//     cannot follow a road round a bend, so `s` switches axis mid-turn and
//     jumps — 14 px between touching pixels at the fit's bend of 11. Every
//     dashed motif here therefore reads `along`, the continuous blend, and not
//     `s`. What survives is a stretch: a corner's real path is shorter than the
//     two straight legs it replaces, so the dashes lengthen slightly round the
//     bend instead of breaking.
//
//  4. IT IS A FUNCTION OF (s, t) ON A SHARED AXIS, so every seam proof
//     the boundary rests on carries over unchanged: at an open border the
//     nearest skeleton element is the arm crossing it, so all 16 masks compute
//     the same `t` there, and `s` is that border's own world coordinate. The
//     dash periods divide the tile, so a dash keeps its phase across a seam.
//     The arm rays are on those same axes, so swapping one for the other at a
//     junction changes nothing a border can see.
//
// All four are asserted per mask in `centre.test.ts`. 随机长短线 is the one
// exception to the SYMMETRY that rules 2 and 4 buy, and only that: it is
// scattered along the road and leans off it, deliberately, so a crossroads' two
// arms differ. Its own describe block carries the measurements for that.

import {
  wrap, axialHash, dashOn, alongFromCrossing, AXIAL_PERIODS, DEFAULT_PERIOD,
} from './axial';
import { roadCoords, surfaceHalfFor, type EdgeOptions, type SkeletonAt } from './boundary';
import type { Layers } from './layers';
import { TILE_SIZE } from './pathField';

export type CentreKind =
  'none' | 'straightRound' | 'doubleLine' | 'dashed' | 'longShort' | 'randomDash';

export const CENTRE_KINDS: readonly {
  id: CentreKind; zh: string; drawn: boolean; usesPeriod: boolean;
}[] = [
  { id: 'none', zh: '无花纹', drawn: false, usesPeriod: false },
  { id: 'straightRound', zh: '直线圆角', drawn: true, usesPeriod: false },
  { id: 'doubleLine', zh: '双直线', drawn: true, usesPeriod: false },
  { id: 'dashed', zh: '虚线', drawn: true, usesPeriod: true },
  { id: 'longShort', zh: '长短虚线', drawn: true, usesPeriod: true },
  // No period: its period IS the tile. See `randomRuns`.
  { id: 'randomDash', zh: '随机长短线', drawn: true, usesPeriod: false },
];

/** Does this kind take a width, i.e. is there a line to be wide? */
export function centreIsDrawn(kind: CentreKind): boolean {
  return CENTRE_KINDS.find((k) => k.id === kind)?.drawn ?? false;
}

export function centreUsesPeriod(kind: CentreKind): boolean {
  return CENTRE_KINDS.find((k) => k.id === kind)?.usesPeriod ?? false;
}

/**
 * Line width in OUTPUT px, across the road. THREE values, and a radio.
 *
 * It started as a 1–6 by 0.5 slider, mirroring the analytic centreline's, and
 * measuring it killed that outright. A solid line is symmetric about the axis
 * and pixel centres sit on half-integers, so on a straight run it can only ever
 * cover an EVEN number of columns — and 11 slider stops land on three of them:
 *
 *   width 1        0 px      the setting draws nothing at all
 *   width 1.5–3    2 px      four stops, one result
 *   width 3.5–5    4 px
 *   width 5.5–6    6 px
 *
 * (Measured on a straight run at 32px output. The baked sheet is not literally
 * empty at width 1 because a corner's arc puts `t` off the half-integer grid,
 * which makes it worse rather than better: the line exists on bends and not on
 * straights.) The analytic mode's slider has exactly the same three steps in it
 * — that one is pre-existing and untouched here.
 *
 * So the control offers the three widths that exist. Every step is one more
 * pixel per side, and the label is literally true on a straight run.
 */
export const CENTRE_WIDTHS = [2, 4, 6] as const;
export const DEFAULT_CENTRE_WIDTH = 2;

/** Nearest offered width. `<=` so a tie rounds up, matching snapPeriod. */
export function snapCentreWidth(w: number): number {
  return CENTRE_WIDTHS.reduce((best: number, v: number) =>
    Math.abs(v - w) <= Math.abs(best - w) ? v : best, CENTRE_WIDTHS[0] as number);
}

/**
 * The widest line THIS road can carry — which is only ever a limit for 双直线.
 *
 * Same rule the arc amplitude follows against the boundary distance: a control
 * must not offer a value the geometry will quietly take back. Two lines on a
 * distance-4 road have exactly 1px each to live in, so 4px and 6px there are
 * not choices, they are three names for the same picture. One line has no such
 * problem — it grows from the axis outward and the ring rule trims it.
 *
 * Never returns nothing: on a road with no surface at all the narrowest width
 * is still the answer, and `doubleLineWidth` draws zero lines for it.
 */
export function maxCentreWidth(kind: CentreKind, surfaceHalf: number): number {
  const widest = CENTRE_WIDTHS[CENTRE_WIDTHS.length - 1];
  if (kind !== 'doubleLine') return widest;
  const room = 2 * (surfaceHalf * DOUBLE_SPREAD) - DOUBLE_GAP;
  let best: number = CENTRE_WIDTHS[0];
  for (const w of CENTRE_WIDTHS) if (w / 2 <= room) best = w;
  return best;
}

/** The widths the control may offer here. Always at least one. */
export function centreWidthsFor(kind: CentreKind, surfaceHalf: number): number[] {
  const ceiling = maxCentreWidth(kind, surfaceHalf);
  return CENTRE_WIDTHS.filter((w) => w <= ceiling);
}

/** Dash periods, in output px. Divisors of the tile — see AXIAL_PERIODS. */
export const CENTRE_PERIODS = AXIAL_PERIODS;
const DEFAULT_CENTRE_PERIOD = DEFAULT_PERIOD;


/**
 * 长短虚线: one long dash and one short one per period, with EQUAL gaps.
 *
 *     |<--------------- period --------------->|
 *     [==== long ====]  gap  [= short =]  gap
 *
 * Everything below is forced by two things already settled, not chosen:
 *
 *   * THE GAPS ARE EQUAL and the long dash is centred on the tile centre, so
 *     the cycle is a mirror about that point. That is the symmetry the junction
 *     needed — see `dashOn` — and an unequal pair of gaps would lose it again.
 *     It also puts the SHORT dash centred on the seam, which is the same
 *     mirror seen from the other end.
 *   * THE LONG AND SHORT LENGTHS ARE EVEN, the gaps whole. `r` (distance along
 *     the road from the nearest long dash's centre) is a half-integer, because
 *     pixel centres are; a threshold at `long/2` is then a half-integer too
 *     unless `long` is even, and a sample landing exactly on a threshold is
 *     decided by which way `<` happens to point. Same grid argument as
 *     CENTRE_WIDTHS. So both lengths step by 2, and the gap comes out whole for
 *     free because the period is even.
 *
 * The gap is DERIVED rather than exposed: three lengths that must sum to the
 * period are two degrees of freedom, and a third slider could only ever be one
 * the other two immediately take back.
 */
export const DASH_LENGTH_STEP = 2;
export const MIN_LONG = 4;
export const MIN_SHORT = 2;

/** Longest long dash this period can hold: short >= 2 and each gap >= 1. */
export function maxLong(period: number): number {
  return period - MIN_SHORT - 2;
}

/**
 * Longest short dash, against the long one AND the period.
 *
 * `long - 2` is what keeps the two distinguishable: at equal lengths the motif
 * is a plain 虚线 with half the period, i.e. a menu entry that duplicates its
 * neighbour — the failure this app has shipped four times.
 */
export function maxShort(period: number, long: number): number {
  return Math.min(long - DASH_LENGTH_STEP, period - long - 2);
}

/** The equal gap either side of the short dash, in output px. Always whole. */
export function dashGap(o: CentreOptions): number {
  return (o.period - o.long - o.short) / 2;
}

/** Nearest legal even length. `<=` so a tie rounds up, matching snapPeriod. */
export function snapDashLength(v: number, min: number, max: number): number {
  const snapped = Math.round(v / DASH_LENGTH_STEP) * DASH_LENGTH_STEP;
  return Math.max(min, Math.min(max, snapped));
}


/**
 * 随机长短线: dashes of random length scattered along the axis.
 *
 * ---------------------------------------------------------------------------
 * What "random" can and cannot mean here
 * ---------------------------------------------------------------------------
 *
 * It cannot mean per-tile noise. A tileset has SIXTEEN tiles and a map lays the
 * same one down over and over, so whatever is painted on a straight run repeats
 * every 32 px no matter what this function does. Randomness buys a layout that
 * does not look measured — it cannot buy a road that never repeats.
 *
 * So the layout is drawn ONCE from the seed and is a pure function of position:
 * the same seed always gives the same road, and every tile agrees with every
 * other at every seam, which is the only way the sheet stays a tileset.
 *
 * ---------------------------------------------------------------------------
 * Why it is NOT folded about the crossing, unlike every other motif here
 * ---------------------------------------------------------------------------
 *
 * It was, for exactly one revision. Folding buys mirror symmetry about the
 * crossing for free, which is what `dashOn` needed — but it also halves the
 * budget to 16 px, and this motif spends its budget on PIECES. Measured over 40
 * seeds, counting the seeds whose dashes use both sides of the axis:
 *
 *   lengths 2-4   38/40      mean weight 0.80 px off the axis
 *   lengths 2-6   20/40                  1.49
 *   lengths 2-8    8/40                  1.82
 *   lengths 4-8    0/26                  1.92
 *
 * Long dashes leave room for ONE leanable dash per half, and one dash can only
 * lean one way — so the whole road drifted to one side and stayed there. That
 * is not a tuning problem, it is 16 px not being enough road.
 *
 * Unfolded, the layout runs the whole 32 px cycle: a dash pinned across the
 * crossing, then an independent walk outward each way, meeting at the seam with
 * a gap. Twice the pieces, each leaning on its own.
 *
 * What that costs, stated plainly: this motif alone has NO mirror symmetry, so
 * a crossroads' north arm and its south arm differ. 虚线 and 长短虚线 keep
 * theirs. The drawing does the same thing — its own 4-way tile disagrees with
 * its mirror image in 104 pixels — and a scattered line that mirrored would not
 * read as scattered.
 *
 * ---------------------------------------------------------------------------
 * Never two dashes touching
 * ---------------------------------------------------------------------------
 *
 * Guaranteed by construction rather than by rejection sampling: every gap is
 * drawn from the SAME range as the dashes, so it is at least `randMin`. At the
 * seam the two outward walks each stop `randMin/2` short, so what they leave
 * between them is a full gap as well. Two dashes that touch would not read as
 * two dashes at all, they would read as one longer one, and the whole motif is
 * the length distribution.
 *
 * Lengths step by ONE output pixel. What has to hold is that no run BOUNDARY
 * lands on a pixel centre, and the along coordinate is a half-integer on a
 * straight run, so the boundaries must be whole — which any whole length gives.
 *
 * ONE piece is different: the dash on the crossing is centred there, so its
 * ends are `mid ± length/2` and an odd length would put both on half-integers.
 * That one is rounded to an even length. Everything else takes the full 32px
 * grid; quantising it all to the drawing's 2px lattice would throw away half
 * the detail this sheet has, and the drawing's lattice is an artefact of it
 * having been drawn at 16, not a property of the road.
 */
/** Shortest piece, in OUTPUT px. 1 would be a dot; 2 is the thinnest dash. */
export const RAND_MIN = 2;
/**
 * The shortest piece may not be set past 4, measured. At 6 the crossing's dash
 * plus one gap already spends the tile, so EVERY seed lays exactly one dash and
 * "random" describes nothing — 40 of 40 came out with a single run. A control
 * whose top setting turns the feature off is the dead-setting pattern this app
 * keeps re-learning.
 */
export const MAX_RAND_MIN = 4;
/**
 * 8 and not more, measured. A half is 16 px long and every piece — dash AND gap
 * — comes out of it, so a range reaching 10 spends the whole half on two draws:
 * over seeds 1,2,3,7 the layout collapsed to a SINGLE dash three times out of
 * four. At 8 the same seeds lay down three to five pieces, which is what makes
 * the length distribution visible at all.
 */
export const RAND_MAX = 8;

/**
 * How far a dash leans off the axis, in STEPS of one OUTPUT pixel.
 *
 * The idea is measured off the drawing: the reference drawing's centreline does not sit on one
 * line. On the north-south tile its dashes are in art columns 6, 7 and 8, on
 * the east-west tile in art rows 7, 8 and 9 — three positions, one ART pixel
 * apart, which on the 32px sheet are the offsets -3, -1 and +1.
 *
 * The SPACING of those three is not copied, and that is deliberate. The art is
 * drawn at 16 and replayed by pixel replication, so its lattice is two output
 * pixels wide and its line can only ever sit on odd offsets — the axis falls on
 * a boundary between art pixels, so a one-art-pixel line cannot straddle it.
 * That is a property of the DRAWING, not of the road. This sheet is 32px and
 * the generated motifs are evaluated at 32, so the lean steps by ONE output
 * pixel and reaches every offset the artist could not: twice the positions,
 * over the same span.
 *
 * Never zero, though. A magnitude of 0 is "did not lean", and drawing it as one
 * of the options is what made a third of the seeds show no lean at all — the
 * defect this control was reported for. `k` runs from 1.
 *
 * Whole numbers, not halves: `signedT` is a half-integer on a straight run and
 * the width is even, so an integer lean keeps every threshold clear of a pixel
 * centre. That one IS a 32px grid fact and it stays.
 */
const DEFAULT_JITTER = 2;

/** The lean of the `k`-th step, in output px. Never zero. */
export const jitterAt = (k: number) => k;

/**
 * How many steps this road can take: far enough out and the ring rule simply
 * deletes the dash, which would read as the motif randomly dropping pieces.
 * Leaves a pixel of surface outside the dash's own far edge.
 *
 * On the as-drawn road with a 2px line this comes out at 3 output px, which is
 * exactly the span the artist used (-3 to +1) at twice their resolution.
 */
export function maxJitter(width: number, surfaceHalf: number): number {
  return Math.max(0, Math.floor(surfaceHalf - width / 2 - 1));
}

/**
 * Which way this dash leans, in output px. Even, and centred on zero.
 *
 * The runs are sorted ALONG the road, so alternating along the list is
 * alternating along the road — which is the whole point. Interleaving the two
 * outward walks instead would put every dash on one side of the crossing to the
 * left and every one on the other side to the right, which is precisely the
 * drift this exists to stop.
 *
 * It alternates by position among the LEANABLE runs, not by raw index, and the
 * difference is not cosmetic. The crossing sits between two of them, so `c-1`
 * and `c+1` are two apart and share a parity: alternating on the raw index gave
 * them the SAME side. Measured, that was the whole failure — with lengths 4-8 a
 * tile holds three runs, both leanable ones landed on one side, and 0 of 38
 * seeds used both.
 *
 * THE DASH ON THE CROSSING NEVER LEANS, and that is not tidiness. Near a
 * junction every pixel belongs to whichever ARM is nearest, so a dash nudged
 * sideways off the vertical arm only exists where `|u-16| <= |v-16|` — and
 * right at the crossing `|v-16|` is small, so the leaned dash has nowhere to be
 * and the junction comes out BARE. Measured: with a lean of one step the whole
 * 6x6 centre of the crossroads held zero centre pixels. Index 0 is the
 * crossing's own dash, so it stays on the axis and 路口不断线 survives.
 */
export function jitterOf(
  index: number, layout: RandomLayout, o: CentreOptions, steps: number
): number {
  if (steps <= 0 || index === layout.crossing) return 0;
  // ONE leanable dash cannot be balanced by anything, so it does not lean at
  // all. A long-dash setting fits exactly one on a third of its seeds, and a
  // lone leaning dash is not "scattered about the axis", it is a road with a
  // bump on one side — which is what this whole revision was reported for.
  if (layout.runs.length - 1 < 2) return 0;
  // HOW FAR is drawn; WHICH SIDE alternates. Drawing the side too looked wrong
  // and the reason is arithmetic: a tile holds only two or three leanable
  // dashes, so an independent coin lands them all on one side about half the
  // time, and the line reads as having drifted off the road rather than as
  // wandering along it. Alternating makes every seed weave about the axis;
  // the seed still picks which way the first one goes, and the magnitudes are
  // still random, so no two seeds weave the same.
  //
  // A separate hash stream from the lengths (the +101), or a seed that made the
  // dashes long would also always make them lean the same way.
  const k = 1 + Math.min(steps - 1, Math.floor(axialHash(index, 101, o.seed) * steps));
  const first = axialHash(0, 202, o.seed) < 0.5 ? 1 : -1;
  const rank = index < layout.crossing ? index : index - 1;
  return (rank % 2 === 0 ? first : -first) * jitterAt(k);
}

export interface RandomLayout {
  /** [start, end) runs along the road, sorted, inside [0, TILE_SIZE). */
  runs: readonly (readonly [number, number])[];
  /** Which of them straddles the crossing. That one never leans. */
  crossing: number;
}

const RUN_CACHE = new Map<string, RandomLayout>();

export function randomRuns(o: CentreOptions): RandomLayout {
  const key = `${o.randMin}:${o.randMax}:${o.seed}`;
  const hit = RUN_CACHE.get(key);
  if (hit) return hit;

  const size = TILE_SIZE;
  const mid = size / 2;
  const lo = o.randMin;
  const steps = o.randMax - lo + 1;
  const pick = (i: number) =>
    lo + Math.min(steps - 1, Math.floor(axialHash(i, 0, o.seed) * steps));

  let i = 0;
  // The crossing's own dash, centred on it, so its length is rounded to an even
  // one — see the note above. Rounded DOWN, then floored at the smallest even
  // length the range allows, so it can never fall outside it.
  const first = Math.max(2 * Math.ceil(lo / 2), 2 * Math.floor(pick(i++) / 2));
  const cross: readonly [number, number] = [mid - first / 2, mid + first / 2];

  // Outward each way. A draw that would overrun the seam is SHORTENED into the
  // room left rather than dropped: dropping it leaves a long draw near the end
  // with nothing after it, and measured, that collapsed three of four seeds to
  // a single dash. What is never allowed is a piece touching the seam, because
  // it would meet the next tile's first piece and the two would read as one.
  const up: (readonly [number, number])[] = [];
  for (let r = cross[1]; ;) {
    const start = r + pick(i++);
    const room = Math.floor(size - lo / 2 - start);
    if (room < lo) break;
    const end = start + Math.min(pick(i++), room);
    up.push([start, end]);
    r = end;
  }
  const down: (readonly [number, number])[] = [];
  for (let r = cross[0]; ;) {
    const end = r - pick(i++);
    const room = Math.floor(end - lo / 2);
    if (room < lo) break;
    const start = end - Math.min(pick(i++), room);
    down.push([start, end]);
    r = start;
  }
  down.reverse();

  const made: RandomLayout = { runs: [...down, cross, ...up], crossing: down.length };
  RUN_CACHE.set(key, made);
  return made;
}

/** Which run holds `r`, or -1. The index is what picks the dash's lean. */
function runIndexAt(r: number, runs: readonly (readonly [number, number])[]): number {
  for (let i = 0; i < runs.length; i++) if (r >= runs[i][0] && r < runs[i][1]) return i;
  return -1;
}

/**
 * Where 双直线 puts its two lines, as a share of the surface half-width.
 *
 * Derived from the road rather than exposed as a second slider, the same trick
 * `surfaceShift`'s ruts use: a wider road spaces its lines further apart, which
 * is what makes it read as wider. Half way out is where a real road's lane
 * divider sits relative to its kerb.
 */
const DOUBLE_SPREAD = 0.5;

/** Clear surface that must remain between the two lines, in output px. */
const DOUBLE_GAP = 1;

/**
 * How wide EACH of the two lines is, in output px.
 *
 * Half the setting, so 中轴线宽 means the same thing for all three kinds: the
 * total ink laid across the road. 双直线 at 4px is two 2px lines, 直线圆角 at
 * 4px is one 4px line.
 *
 * The gap is protected before the width is: two lines that touch are one line,
 * and a menu entry that renders identically to its neighbour is the failure
 * this app has now shipped four times (see the fingerprint test). So the width
 * saturates on a narrow road instead of closing the gap — and on a road with no
 * surface left at all, returns 0 and draws nothing, which is honest: there is
 * nowhere for two lines to be.
 */
export function doubleLineWidth(width: number, surfaceHalf: number): number {
  const room = 2 * (surfaceHalf * DOUBLE_SPREAD) - DOUBLE_GAP;
  return room < 1 ? 0 : Math.min(width / 2, room);
}

/**
 * Where each line's INNER face sits, snapped to the pixel grid.
 *
 * Snapped, and that is the whole difference between a control that works and
 * one that flickers: an unsnapped band of width 1 centred at t=1.0 spans
 * (0.5, 1.5) and contains no pixel centre whatsoever, so 双直线 rendered as
 * NOTHING on a distance-4 road while every arithmetic check said it was fine.
 * Pinning the inner face to an integer makes the band cover exactly `w` pixel
 * columns per side, whatever fraction the road's half-width happens to be.
 */
export function doubleLineInner(width: number, surfaceHalf: number): number {
  const w = doubleLineWidth(width, surfaceHalf);
  return w <= 0 ? 0 : Math.max(1, Math.round(surfaceHalf * DOUBLE_SPREAD - w / 2));
}

export interface CentreOptions {
  kind: CentreKind;
  /** Total width across, in output px. `doubleLine` uses it per line. */
  width: number;
  /** Along-road period in output px. Must divide the tile. */
  period: number;
  /** `longShort` only: the long dash, in output px. Even. */
  long: number;
  /** `longShort` only: the short dash, in output px. Even, and < long. */
  short: number;
  /** `randomDash` only: shortest dash AND shortest gap, in output px. Even. */
  randMin: number;
  /** `randomDash` only: longest dash, in output px. Even, and > randMin. */
  randMax: number;
  /** `randomDash` only: how far a dash may lean off the axis, in STEPS. */
  randJitter: number;
  /** `randomDash` only: dice. */
  seed: number;
}

/**
 * Legal at EVERY offered period, which is the constraint that picks them.
 *
 * The period is one field shared with 虚线, so switching kind does not reset it
 * — a default long dash of 8 would be illegal the moment someone arrived from
 * 虚线 at period 8, where `maxLong` is 4. At 4 + 2 the motif fits the smallest
 * period with a 1px gap either side, and there is room to open it up from
 * there.
 */
export const DEFAULT_LONG = 4;
export const DEFAULT_SHORT = 2;

/**
 * The period to arrive at when 长短虚线 is first picked, if the one in hand
 * leaves nothing to adjust.
 *
 * 8 is legal but rigid: `maxLong(8)` is 4 and `maxShort(8, 4)` is 2, so both
 * sliders are pinned to their minimum and the motif has exactly one form. The
 * period is shared with 虚线, whose default is 8, so that is precisely the
 * state someone arrives in. 16 is the smallest one with room to move.
 */
export const ROOMY_LONGSHORT_PERIOD = 16;

/** Has this period any room for the two lengths to move, or is it pinned? */
export function longShortIsRigid(period: number): boolean {
  return maxLong(period) <= MIN_LONG && maxShort(period, MIN_LONG) <= MIN_SHORT;
}

export const DEFAULT_CENTRE: CentreOptions = {
  kind: 'randomDash',
  width: DEFAULT_CENTRE_WIDTH,
  period: DEFAULT_CENTRE_PERIOD,
  long: DEFAULT_LONG,
  short: DEFAULT_SHORT,
  randMin: 2,
  randMax: 6,
  randJitter: DEFAULT_JITTER,
  seed: 1,
};

/**
 * The periods a kind can offer.
 *
 * 长短虚线 cannot use 4: two dashes and two gaps need at least 4+2+2 = 8 px of
 * period before anything is even one pixel long.
 */
export function centrePeriodsFor(kind: CentreKind): number[] {
  return CENTRE_PERIODS.filter((p) => kind !== 'longShort' || maxLong(p) >= MIN_LONG);
}

/**
 * Is this pixel on the generated line?
 *
 * A pure function of (s, t) and the road's own half-width — nothing here reads
 * the pixel's position on the tile, which is what makes rule 3 hold.
 */
function onGeneratedCentre(
  near: SkeletonAt, o: CentreOptions, surfaceHalf: number
): boolean {
  const half = o.width / 2;
  switch (o.kind) {
    case 'none':
      return false;
    case 'straightRound':
      return near.t < half;
    case 'dashed':
      // Half on, half off. The duty cycle is fixed so the period is the only
      // thing to reason about — the same call axial.ts's `dash` makes. The
      // PHASE is not the same call: see `dashOn`.
      return near.t < half && dashOn(near.along, o.period);
    case 'randomDash': {
      // The period is the whole tile, and the layout is NOT folded — see
      // `randomRuns` for what folding cost.
      const layout = randomRuns(o);
      const i = runIndexAt(wrap(near.along, TILE_SIZE), layout.runs);
      if (i < 0) return false;
      const lean = jitterOf(i, layout, o,
        Math.min(o.randJitter, maxJitter(o.width, surfaceHalf)));
      return Math.abs(near.signedT - lean) < half;
    }
    case 'longShort': {
      if (near.t >= half) return false;
      const r = alongFromCrossing(near.along, o.period);
      const g = dashGap(o);
      // Out from the long dash's centre: the long half, a gap, then the short
      // dash's half. Past that is the next period's long half, which `r` has
      // already folded back.
      return r < o.long / 2
        || (r >= o.long / 2 + g && r < o.long / 2 + g + o.short / 2);
    }
    case 'doubleLine': {
      const w = doubleLineWidth(o.width, surfaceHalf);
      if (w <= 0) return false;
      // `t` is unsigned, so ONE band is already two lines — one either side of
      // the axis. That is why there is no sign anywhere here.
      const inner = doubleLineInner(o.width, surfaceHalf);
      return near.t >= inner && near.t < inner + w;
    }
  }
}

/**
 * The outermost ring a generated line may occupy.
 *
 * 2, i.e. never ring 1. See rule 1 — this is the drawing's own behaviour, and
 * `layers.test.ts` asserts the drawn line satisfies it independently.
 */
export const MIN_CENTRE_RING = 2;

/**
 * Replace the centre layer, leaving the silhouette and the kerb exactly as they
 * came in.
 *
 * `layers` must already be the POST-boundary layers, so `depth` describes the
 * silhouette actually being painted — that is why `generateEdge` re-peels it
 * rather than passing the drawing's rings through.
 */
export function centreLayers(
  layers: Layers,
  bits: number,
  o: CentreOptions,
  edge: EdgeOptions
): Layers {
  const { size, fill, depth } = layers;
  const centre = new Uint8Array(size * size);

  if (o.kind !== 'none') {
    const surfaceHalf = surfaceHalfFor(edge);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (!fill[i] || depth[i] < MIN_CENTRE_RING) continue;   // rule 1
        const near = roadCoords(bits, x, y, size, edge);
        if (near && onGeneratedCentre(near, o, surfaceHalf)) centre[i] = 1;
      }
    }
  }

  return { ...layers, centre };
}
