// pathField.ts — the shape of a path tile, computed rather than baked.
//
// autotile_mixer stores its silhouettes as a quantised distance field because
// its generators (corner rounding, five noise functions) are unsolved and had
// to be baked once by hand. Nothing here is in that position: a path piece is
// the set of points within `halfWidth` of a skeleton made of straight segments
// and quarter arcs, which is exact arithmetic. So the field runs at render time
// and every parameter is live.
//
// ---------------------------------------------------------------------------
// The seam argument, which is the whole reason this scheme works
// ---------------------------------------------------------------------------
//
// A tile is painted knowing only its own four bits, so two tiles placed side by
// side must independently compute the SAME field along their shared border.
//
// They do, exactly, and not by luck:
//
//   * On an OPEN border the path crosses, so both tiles own an arm running
//     perpendicular to that border and reaching past it. For a border pixel the
//     perpendicular foot lands on that arm, giving `|offset from the arm|` — the
//     same expression on both sides. Every other feature of either tile is at
//     least tileSize/2 - 0.5 away, so it can never win the `min`. Measured over
//     all 16x16 compatible pairs: 0.00e+0 px of disagreement.
//
//   * On a CLOSED border the two tiles genuinely disagree (up to 12.65 px at
//     bend 8) and it does not matter, because the skeleton lives inside the
//     cross through the tile centre, which puts every closed-border pixel at
//     least tileSize/2 - 0.5 from it. As long as the band stops short of that,
//     both sides render level 0 and the disagreement is invisible.
//
// The second bullet is the one constraint in this file, and `maxHalfWidth`
// below is it written down. It is the same "half a tile" budget the 2-corner
// work arrived at (docs/AUTOTILE_2CORNER_POSTMORTEM.md) — resolution
// independent, and here it is spent by four controls at once.

import { DIRECTIONS, OPPOSITE } from './twoEdge';

export const TILE_SIZE = 32;
/** The tile centre, where every arm meets. */
const C = TILE_SIZE / 2;

/** Distance from a closed border's pixel centres to the centre cross. */
export const BORDER_CLEARANCE = TILE_SIZE / 2 - 0.5;

export type CapStyle = 'round' | 'flat';

/**
 * What the skeleton looks like. The path's WIDTH is not in here — that is
 * `BandParams.halfWidth`, because the surface boundary is just the innermost
 * band edge and having it in two places is how the two drift apart.
 */
export interface ShapeParams {
  /** Corner radius at a turn, in px. 0 is a hard right-angle bend. */
  bend: number;
  /** How a dead end finishes. */
  cap: CapStyle;
  /** Draw the neighbourless cell as a dot instead of leaving it empty. */
  isolatedDot: boolean;
  /**
   * How much bigger the isolated dot is than the road, as a multiple of the
   * road's own half-extent. Measured off the reference drawing at ~1.6: an artist draws a lone
   * cell as a blob you can see, not as a road-width full stop. 1 keeps the old
   * behaviour.
   */
  dotScale?: number;
}



const MIN_BEND = 0;
/** Leaves a 4px straight run before the arm reaches the border. */
export const MAX_BEND = C - 4;

function clampBend(bend: number): number {
  return Math.max(MIN_BEND, Math.min(MAX_BEND, bend));
}

/** Euclidean distance from a point to the segment ab. */
function segmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function bitCount(bits: number): number {
  let n = 0;
  for (const { bit } of DIRECTIONS) if (bits & bit) n++;
  return n;
}

/** True when `bits` holds an arm perpendicular to `bit`. */
function hasPerpendicular(bits: number, bit: number): boolean {
  for (const d of DIRECTIONS) {
    if (d.bit === bit || d.bit === OPPOSITE[bit]) continue;
    if (bits & d.bit) return true;
  }
  return false;
}

/**
 * Where an arm starts, measured out from the centre.
 *
 * An arm is pulled back by `bend` only when it actually turns — no arm facing
 * it, and something perpendicular to turn into. Pulling ALL of them back was
 * the first thing I tried and it punches a hole through the middle of every
 * T-junction: with bend 8 the centre sits 3.31 px from the nearest skeleton
 * piece, so any halfWidth under that renders the junction as two separate
 * roads passing behind each other.
 *
 * Keeping a straight-through pair whole fixes it at the source rather than by
 * clamping bend against halfWidth, and it also leaves a dead end's round cap
 * at the tile centre where it belongs instead of retreating with the slider.
 */
function armStart(bits: number, bit: number, bend: number): number {
  const turns = !(bits & OPPOSITE[bit]) && hasPerpendicular(bits, bit);
  return turns ? bend : 0;
}

/**
 * Which skeleton element is nearest, and how far.
 *
 * `axis` is what makes an ALONG-road coordinate possible: it names the world
 * axis that runs along the road here, so `s` can be taken as that axis's world
 * coordinate. See `pathCoords` for why that is the only choice available and
 * what it costs at a corner.
 */
export interface Nearest {
  /** Distance to the skeleton. Infinity when the tile draws nothing at all. */
  t: number;
  /** 'x' where the road runs east-west, 'y' north-south, null where it has no
   *  direction (the isolated dot). */
  axis: 'x' | 'y' | null;
  /**
   * The along-road coordinate, CONTINUOUS through a corner. null where the road
   * has no direction.
   *
   * On an arm this is exactly the world coordinate `axis` names, so at a border
   * it is that border's own coordinate and the seam argument is untouched. On
   * the ARC it is a blend of the two, which is the whole point of it existing:
   * `axis` can only ever name one world axis, so it has to switch somewhere
   * round the turn, and a motif read off it jumps by the difference. Measured
   * at the baked fit's bend of 11: **14 px between two touching pixels**, which
   * is not a hitch in a dashed line, it is a break.
   *
   * The blend runs linearly in ANGLE from one tangent point to the other, so it
   * agrees with each arm exactly where the arc meets it. It is not arc length —
   * a corner's true path is shorter than the two straight legs it replaces, and
   * no reparametrisation can fix that while both borders still have to report
   * their own world coordinate. The dashes near a bend stretch instead; nothing
   * breaks.
   *
   * `axis` is deliberately left as it was. Everything that reads it — the
   * analytic mode's own motifs, and the baked boundary's arc wave with its
   * measured ARC_CEILING — keeps the behaviour it was measured with.
   */
  along: number | null;
}

/**
 * The nearest point of the road's SKELETON, and the coordinates that come with
 * it. This is the whole geometry the sheet is built on.
 *
 * It used to apply the boundary noise here too, and that moved: displacing the
 * field would move `s` as well as `t`, so an along-road motif would be reading
 * a coordinate its own displacement had shifted. `boundary` adds the noise
 * to the OUTLINE instead — one number, at one place, after the field has
 * answered.
 */
export function nearestElement(
  px: number, py: number, bits: number, shape: ShapeParams
): Nearest {
  return nearestSmooth(px, py, bits, shape);
}

function nearestSmooth(
  px: number, py: number, bits: number, shape: ShapeParams
): Nearest {
  const b = bits & 0x0f;
  if (b === 0) {
    if (!shape.isolatedDot) return { t: Infinity, axis: null, along: null };
    // Dividing the distance scales the disc up, so every band edge scales with
    // it and the dot keeps the road's proportions rather than just its width.
    const scale = Math.max(0.25, shape.dotScale ?? 1);
    return { t: Math.hypot(px - C, py - C) / scale, axis: null, along: null };
  }

  const bend = clampBend(shape.bend);

  // A dead end is the one place the choice of metric is visible, so it gets its
  // own expression: Chebyshev distance to the arm instead of Euclidean. The
  // stub then finishes square at the same depth the round cap's arc reaches —
  // both stop `halfWidth` past the tile centre — and its kerb turns a right
  // angle round the tip instead of curving. Only a dead end has a cap to
  // choose; anything else runs through.
  if (shape.cap === 'flat' && bitCount(b) === 1) {
    const dir = DIRECTIONS.find((d) => d.bit === b)!;
    const along = (px - C) * dir.dx + (py - C) * dir.dy;   // positive = outward
    const across = Math.abs((px - C) * -dir.dy + (py - C) * dir.dx);
    return {
      t: Math.max(across, -along),
      axis: dir.dx !== 0 ? 'x' : 'y',
      along: dir.dx !== 0 ? px : py,
    };
  }

  let best: Nearest = { t: Infinity, axis: null, along: null };
  for (const dir of DIRECTIONS) {
    if (!(b & dir.bit)) continue;
    const start = armStart(b, dir.bit, bend);
    // The far end overshoots the border by 1 px so a border pixel's
    // perpendicular foot always lands ON the segment rather than on its
    // endpoint — that is what makes the border value exactly |offset|.
    const d = segmentDistance(
      px, py,
      C + dir.dx * start, C + dir.dy * start,
      C + dir.dx * (C + 1), C + dir.dy * (C + 1)
    );
    if (d < best.t) {
      best = { t: d, axis: dir.dx !== 0 ? 'x' : 'y', along: dir.dx !== 0 ? px : py };
    }
  }

  if (bend > 0) {
    // One quarter arc per pair of perpendicular arms. Its endpoints are the two
    // arms' start points, so the skeleton stays a single connected curve
    // whether or not those arms were pulled back.
    for (const d1 of DIRECTIONS) {
      if (!(b & d1.bit)) continue;
      for (const d2 of DIRECTIONS) {
        if (d2.bit <= d1.bit || !(b & d2.bit)) continue;
        if (d1.dx * d2.dx + d1.dy * d2.dy !== 0) continue;  // opposite pair
        const qx = C + (d1.dx + d2.dx) * bend;
        const qy = C + (d1.dy + d2.dy) * bend;
        const vx = px - qx;
        const vy = py - qy;
        // The arc spans the quadrant facing back toward the centre, i.e. the
        // directions -d1 and -d2 from its centre. Outside that wedge the two
        // arms are already the nearest thing, so there is nothing to add.
        if (vx * d1.dx + vy * d1.dy > 0) continue;
        if (vx * d2.dx + vy * d2.dy > 0) continue;
        const d = Math.abs(Math.hypot(vx, vy) - bend);
        if (d >= best.t) continue;
        // Halfway round the arc the road has turned 45 degrees and the other
        // arm's axis becomes the better description of "along". Switching there
        // rather than interpolating keeps `s` equal to a world coordinate
        // everywhere, which is the whole basis of the seam argument.
        const toD1 = -(vx * d1.dx + vy * d1.dy);
        const toD2 = -(vx * d2.dx + vy * d2.dy);
        const closer = toD1 >= toD2 ? d1 : d2;
        // `along` blends the two arms' world coordinates instead of picking
        // one: 0 at the arc's tangent to d1, 1 at its tangent to d2, linear in
        // the angle between. It therefore meets each arm's own value exactly
        // where the arc meets that arm, which is what makes it continuous.
        const phi = Math.atan2(toD1, toD2) / (Math.PI / 2);
        const c1 = d1.dx !== 0 ? px : py;
        const c2 = d2.dx !== 0 ? px : py;
        best = {
          t: d,
          axis: closer.dx !== 0 ? 'x' : 'y',
          along: (1 - phi) * c1 + phi * c2,
        };
      }
    }
  }

  return best;
}

/**
 * Distance from (px, py) to the tile's path skeleton, in 32-space px.
 *
 * Infinity means "this tile draws nothing" — only the empty mask, and only when
 * the isolated dot is switched off.
 */
export function skeletonDistance(
  px: number, py: number, bits: number, shape: ShapeParams
): number {
  return nearestElement(px, py, bits, shape).t;
}
