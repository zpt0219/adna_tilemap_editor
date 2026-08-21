import { describe, it, expect } from 'vitest';
import { composeLayers, OUTPUT_SIZE } from './layers';
import {
  centreLayers, centreIsDrawn, centreUsesPeriod,
  doubleLineWidth, doubleLineInner, snapCentreWidth, centreWidthsFor, maxCentreWidth,
  dashGap, centrePeriodsFor, maxLong, maxShort,
  longShortIsRigid, ROOMY_LONGSHORT_PERIOD, randomRuns, RAND_MAX, MAX_RAND_MIN,
  maxJitter, jitterOf, jitterAt,
  MIN_LONG, MIN_SHORT, DASH_LENGTH_STEP, DEFAULT_LONG, DEFAULT_SHORT,
  CENTRE_KINDS, DEFAULT_CENTRE, CENTRE_PERIODS, CENTRE_WIDTHS,
  DEFAULT_CENTRE_WIDTH, MIN_CENTRE_RING,
  type CentreOptions,
} from './centre';
import {
  generateEdge, surfaceHalfFor, DEFAULT_EDGE, FIT_DISTANCE,
  MIN_EDGE_DISTANCE, MAX_EDGE_DISTANCE,
  type EdgeOptions,
} from './boundary';
import { TWO_EDGE_LAYOUT, DIRECTIONS, bitsLabel } from './twoEdge';
import { isJunction, dashOn, alongFromCrossing } from './axial';
import { TILE_SIZE } from './pathField';
import { skeletonAt } from './boundary';
import { parseHexColour, type RoleColours } from './palette';
import { sanitizeRecipe, DEFAULT_RECIPE } from './recipe';

const COLOURS: RoleColours = {
  path: parseHexColour('#eea160'),
  edge: parseHexColour('#bf7958'),
  edgeAlt: parseHexColour('#d58b60'),
  centre: parseHexColour('#f4cca1'),
};


const centre = (o: Partial<CentreOptions>): CentreOptions =>
  ({ ...DEFAULT_CENTRE, ...o });
const edge = (o: Partial<EdgeOptions>): EdgeOptions =>
  ({ ...DEFAULT_EDGE, ...o });

/** Every generated centreline, on both an as-drawn and a generated boundary. */
const EDGES: EdgeOptions[] = [
  edge({}),                                     // 原版
  edge({ kind: 'straightRound' }),              // the default distance, 11
  edge({ kind: 'straightRound', distance: 4 }), // a narrow road
  edge({ kind: 'arcWave', amplitude: 2 }),
];
const WIDEST = CENTRE_WIDTHS[CENTRE_WIDTHS.length - 1];
const CENTRES: CentreOptions[] = [
  centre({ kind: 'none' }),
  centre({ kind: 'straightRound' }),
  centre({ kind: 'straightRound', width: WIDEST }),
  centre({ kind: 'doubleLine' }),
  centre({ kind: 'doubleLine', width: WIDEST }),
  ...CENTRE_PERIODS.map((period) => centre({ kind: 'dashed', period })),
  ...centrePeriodsFor('longShort').map((period) =>
    centre({ kind: 'longShort', period, long: Math.min(DEFAULT_LONG, maxLong(period)) })),
  centre({ kind: 'longShort', period: 32, long: 20, short: 8 }),
  centre({ kind: 'randomDash' }),
  centre({ kind: 'randomDash', randMin: 4, randMax: RAND_MAX, seed: 7 }),
  centre({ kind: 'randomDash', randJitter: 0 }),
];

/** The layers a recipe actually paints, both stages applied in order. */
const layersOf = (bits: number, e: EdgeOptions, c: CentreOptions) =>
  centreLayers(generateEdge(bits, e), bits, c, e);

const SWEEP = EDGES.flatMap((e) => CENTRES.map((c) => [
  `${e.kind}@${e.distance} + ${c.kind}/${c.width}/${c.period}`,
  e, c,
] as const));

describe('the six centrelines are actually six', () => {
  const fingerprint = (c: CentreOptions, e = DEFAULT_EDGE) => {
    let h = 0x811c9dc5;
    for (const bits of TWO_EDGE_LAYOUT) {
      const px = composeLayers(layersOf(bits, e, c), COLOURS);
      for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    }
    return h >>> 0;
  };

  it('every kind renders differently — no silently-dead menu entry', () => {
    const seen = CENTRE_KINDS.map((k) => fingerprint(centre({ kind: k.id })));
    expect(new Set(seen).size).toBe(CENTRE_KINDS.length);
  });

  it('...on a generated boundary too, where the road is a different width', () => {
    const e = edge({ kind: 'straightRound' });
    const seen = CENTRE_KINDS.map((k) => fingerprint(centre({ kind: k.id }), e));
    expect(new Set(seen).size).toBe(CENTRE_KINDS.length);
  });

  it('EVERY width the control OFFERS does something, and none collide', () => {
    // The reason the width is three radio stops and not an 11-stop slider:
    // measured, that slider had one dead setting and four pairs of duplicates.
    // This is the guard that keeps it that way — and it also covers 双直线
    // never collapsing into 直线圆角, which is what protecting the gap buys.
    //
    // "Offers" is load-bearing: on a narrow road two lines have one pixel each
    // to live in, so 4px and 6px there are the same picture. That is why the
    // ceiling exists rather than being discovered by eye.
    for (const e of EDGES) {
      const half = surfaceHalfFor(e);
      const seen = new Set<number>();
      let n = 0;
      for (const kind of ['doubleLine', 'straightRound'] as const) {
        for (const w of centreWidthsFor(kind, half)) {
          seen.add(fingerprint(centre({ kind, width: w }), e));
          n++;
        }
      }
      expect(seen.size, `${e.kind}@${e.distance}`).toBe(n);
    }
  });

  it('the width ceiling only ever binds 双直线, and only on a narrow road', () => {
    for (const kind of ['straightRound', 'dashed', 'none'] as const) {
      for (let half = 0; half <= 16; half += 0.25) {
        expect(maxCentreWidth(kind, half), `${kind} ${half}`).toBe(WIDEST);
      }
    }
    // The as-drawn road and the default generated one both carry everything;
    // a distance-4 road carries one width. Those are the numbers, stated.
    expect(maxCentreWidth('doubleLine', surfaceHalfFor(edge({})))).toBe(WIDEST);
    expect(maxCentreWidth('doubleLine', surfaceHalfFor(edge({ kind: 'straightRound' }))))
      .toBe(WIDEST);
    expect(maxCentreWidth('doubleLine', surfaceHalfFor(edge({ kind: 'straightRound', distance: 4 }))))
      .toBe(CENTRE_WIDTHS[0]);
    // ...and it never offers an empty menu, whatever the road.
    for (let half = 0; half <= 16; half += 0.25) {
      expect(centreWidthsFor('doubleLine', half).length, `${half}`).toBeGreaterThan(0);
    }
  });

  it('the sanitiser takes the ceiling too, so no stored recipe outruns it', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: { ...DEFAULT_EDGE, kind: 'straightRound', distance: 4 },
      centre: { ...DEFAULT_CENTRE, kind: 'doubleLine', width: WIDEST },
    });
    expect(r.centre.width).toBe(CENTRE_WIDTHS[0]);
    // ...and leaves it alone where the road can carry it.
    const wide = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: { ...DEFAULT_CENTRE, kind: 'doubleLine', width: WIDEST },
    });
    expect(wide.centre.width).toBe(WIDEST);
  });

  it('a solid line is exactly as wide as it says, on a straight run', () => {
    // The label has to be literally true, since that is the reason the three
    // stops were chosen over a slider whose numbers meant nothing.
    const NS = 1 | 4;
    for (const w of CENTRE_WIDTHS) {
      const L = layersOf(NS, DEFAULT_EDGE, centre({ kind: 'straightRound', width: w }));
      const mid = Math.floor(L.size / 2);
      let n = 0;
      for (let x = 0; x < L.size; x++) n += L.centre[mid * L.size + x];
      expect(n, `width ${w}`).toBe(w);
    }
  });

  it('虚线 responds to its period, and is a subset of the solid line', () => {
    const base = centre({ kind: 'straightRound' });
    const seen = CENTRE_PERIODS.map((period) => fingerprint(centre({ kind: 'dashed', period })));
    expect(new Set(seen).size).toBe(CENTRE_PERIODS.length);
    // A dash is the solid line with pieces taken out — never a pixel the solid
    // line does not have. That is what makes the period a pure cut.
    for (const period of CENTRE_PERIODS) {
      for (const bits of TWO_EDGE_LAYOUT) {
        const solid = layersOf(bits, DEFAULT_EDGE, base);
        const dash = layersOf(bits, DEFAULT_EDGE, centre({ kind: 'dashed', period }));
        for (let i = 0; i < dash.centre.length; i++) {
          if (dash.centre[i]) expect(solid.centre[i], `${bitsLabel(bits)} @${period}`).toBe(1);
        }
      }
    }
  });

  it('无花纹 leaves no centreline anywhere', () => {
    for (const e of EDGES) {
      for (const bits of TWO_EDGE_LAYOUT) {
        const L = layersOf(bits, e, centre({ kind: 'none' }));
        expect(L.centre.reduce((a, b) => a + b, 0), `${e.kind} ${bitsLabel(bits)}`).toBe(0);
      }
    }
  });

  it('a wider line is never a smaller one, and somewhere it is bigger', () => {
    for (const kind of ['straightRound', 'dashed'] as const) {
      let grew = false;
      let prev = -1;
      for (const w of CENTRE_WIDTHS) {
        let n = 0;
        for (const bits of TWO_EDGE_LAYOUT) {
          const L = layersOf(bits, DEFAULT_EDGE, centre({ kind, width: w }));
          for (let i = 0; i < L.centre.length; i++) n += L.centre[i];
        }
        expect(n, `${kind} @${w}`).toBeGreaterThanOrEqual(prev);
        if (n > prev && prev >= 0) grew = true;
        prev = n;
      }
      expect(grew, kind).toBe(true);
    }
  });
});

describe('rule 1 — a generated line never touches the outer ring', () => {
  it.each(SWEEP)('%s', (_name, e, c) => {
    for (const bits of TWO_EDGE_LAYOUT) {
      const L = layersOf(bits, e, c);
      for (let i = 0; i < L.centre.length; i++) {
        if (!L.centre[i]) continue;
        expect(L.fill[i], `${bitsLabel(bits)} off the road`).toBe(1);
        expect(L.depth[i], `${bitsLabel(bits)} in ring ${L.depth[i]}`)
          .toBeGreaterThanOrEqual(MIN_CENTRE_RING);
      }
      // ...which on a closed border is implied, but assert it outright: that
      // border may never hold a pixel of any layer.
      for (const d of DIRECTIONS) {
        if (bits & d.bit) continue;
        for (let i = 0; i < L.size; i++) {
          const x = d.dx === 0 ? i : d.dx > 0 ? L.size - 1 : 0;
          const y = d.dy === 0 ? i : d.dy > 0 ? L.size - 1 : 0;
          expect(L.centre[y * L.size + x], `${bitsLabel(bits)} ${d.id}`).toBe(0);
        }
      }
    }
  });
});

describe('rule 2 — a junction is straight lines and nothing else', () => {
  // What this replaced: thresholding the road's skeleton at a junction picked
  // up the corner ARCS that join its arms, and drew four long diagonals over
  // the cross — a star, not a crossroads. The arcs have radius `bend` = 11 on
  // a road 14.5px across, so they are not a subtlety; they are most of the
  // tile. Every assertion below is about there being no diagonal left.

  /** How far from an axis this kind can possibly draw, in 32-space. */
  const reach = (c: CentreOptions, e: EdgeOptions) => {
    const half = surfaceHalfFor(e);
    if (c.kind === 'doubleLine') {
      return doubleLineInner(c.width, half) + doubleLineWidth(c.width, half);
    }
    // 随机长短线 leans off the axis on purpose, so its reach is the lean plus
    // the line. Still nowhere near a diagonal, which is what this is about.
    // `randJitter` counts STEPS; the lean it buys is `jitterAt` of that.
    const steps = c.kind === 'randomDash' ? Math.min(c.randJitter, maxJitter(c.width, half)) : 0;
    return (steps > 0 ? jitterAt(steps) : 0) + c.width / 2;
  };

  it.each(SWEEP)('every junction pixel is ALONG one of the two axes — %s', (_name, e, c) => {
    for (const bits of TWO_EDGE_LAYOUT) {
      if (!isJunction(bits)) continue;
      const L = layersOf(bits, e, c);
      const scale = TILE_SIZE / L.size;
      const mid = TILE_SIZE / 2;
      const r = reach(c, e);
      for (let y = 0; y < L.size; y++) {
        for (let x = 0; x < L.size; x++) {
          if (!L.centre[y * L.size + x]) continue;
          const du = Math.abs((x + 0.5) * scale - mid);
          const dv = Math.abs((y + 0.5) * scale - mid);
          // Within reach of the vertical axis, or of the horizontal one. A
          // DIAGONAL pixel is near neither, which is exactly how the star
          // showed up — its arcs sit `bend` away from both.
          expect(Math.min(du, dv) < r, `${bitsLabel(bits)} at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('a junction draws a line down EVERY arm and none where there is no arm', () => {
    for (const bits of TWO_EDGE_LAYOUT) {
      if (!isJunction(bits)) continue;
      const L = layersOf(bits, DEFAULT_EDGE, centre({ kind: 'straightRound' }));
      for (const d of DIRECTIONS) {
        let onBorder = 0;
        for (let i = 0; i < L.size; i++) {
          const x = d.dx === 0 ? i : d.dx > 0 ? L.size - 1 : 0;
          const y = d.dy === 0 ? i : d.dy > 0 ? L.size - 1 : 0;
          onBorder += L.centre[y * L.size + x];
        }
        if (bits & d.bit) expect(onBorder, `${bitsLabel(bits)} ${d.id}`).toBe(2);
        else expect(onBorder, `${bitsLabel(bits)} ${d.id}`).toBe(0);
      }
    }
  });

  it('a CORNER keeps the road\'s own bend — one line turning is not a junction', () => {
    // Stated so the scope cannot drift silently: the fix is for masks where
    // several lines meet. A corner's diagonal is the road really cutting the
    // corner, and its silhouette does not even cover the elbow a straight L
    // would need — forcing one there would break the line rather than
    // straighten it.
    for (const bits of [3, 6, 9, 12]) {
      expect(isJunction(bits), bitsLabel(bits)).toBe(false);
      const L = layersOf(bits, DEFAULT_EDGE, centre({ kind: 'straightRound' }));
      const scale = TILE_SIZE / L.size;
      const mid = TILE_SIZE / 2;
      let offAxis = 0;
      for (let y = 0; y < L.size; y++) {
        for (let x = 0; x < L.size; x++) {
          if (!L.centre[y * L.size + x]) continue;
          const du = Math.abs((x + 0.5) * scale - mid);
          const dv = Math.abs((y + 0.5) * scale - mid);
          if (du >= 1 && dv >= 1) offAxis++;
        }
      }
      expect(offAxis, bitsLabel(bits)).toBeGreaterThan(0);
    }
  });
});

describe('rule 3 — a corner is ONE unbroken line', () => {
  // The along-road coordinate has to be a border's own world coordinate at that
  // border, and one world axis cannot follow a road round a bend. `s` therefore
  // switches axis mid-turn and JUMPS: measured at the fit's bend of 11, 14 px
  // between two touching pixels, on all four corner masks. A dashed line does
  // not hitch there, it breaks. `along` blends the two instead.

  const CORNERS = [3, 6, 9, 12];
  const E = edge({ kind: 'straightRound' });

  /** Biggest step in a coordinate between 4-adjacent pixels near the line. */
  const worstStep = (bits: number, pick: (n: NonNullable<ReturnType<typeof skeletonAt>>) => number) => {
    const size = OUTPUT_SIZE;
    const v: (number | null)[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = skeletonAt(bits, x, y, size, E);
        v.push(n && n.t < 3 ? pick(n) : null);
      }
    }
    let worst = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = v[y * size + x];
        if (a === null) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          if (x + dx >= size || y + dy >= size) continue;
          const b = v[(y + dy) * size + (x + dx)];
          if (b !== null) worst = Math.max(worst, Math.abs(a - b));
        }
      }
    }
    return worst;
  };

  it('`along` never jumps between touching pixels, and `s` still does', () => {
    for (const bits of CORNERS) {
      // A straight run steps by exactly 1 per pixel; round a bend `along`
      // stretches to at most 1.85, because a corner's real path is shorter than
      // the two straight legs it replaces and that difference has to go
      // somewhere. Under 2 is "continuous"; 14 is not.
      expect(worstStep(bits, (n) => n.along), `${bitsLabel(bits)} along`).toBeLessThan(2);
      // ...and this is why it exists. If this ever drops below 2, `s` has been
      // fixed at the source and the two can be merged.
      expect(worstStep(bits, (n) => n.s), `${bitsLabel(bits)} s`).toBeGreaterThan(10);
    }
    for (const bits of [1 | 4, 2 | 8]) {
      expect(worstStep(bits, (n) => n.along), `${bitsLabel(bits)}`).toBeCloseTo(1);
    }
  });

  it('...and at every open border it is still that border\'s world coordinate', () => {
    // The seam argument rests on this and nothing else, so it is asserted
    // directly rather than inferred from the profile tests.
    for (const bits of TWO_EDGE_LAYOUT) {
      const size = OUTPUT_SIZE;
      for (const d of DIRECTIONS) {
        if (!(bits & d.bit)) continue;
        for (let i = 0; i < size; i++) {
          const x = d.dx === 0 ? i : d.dx > 0 ? size - 1 : 0;
          const y = d.dy === 0 ? i : d.dy > 0 ? size - 1 : 0;
          const n = skeletonAt(bits, x, y, size, E);
          if (!n || n.t >= 3) continue;
          expect(n.along, `${bitsLabel(bits)} ${d.id} at ${x},${y}`).toBeCloseTo(n.s);
        }
      }
    }
  });

  it('a dashed corner carries no over-long dash', () => {
    // The break showed up as a duty cycle, which is the cheapest thing to pin:
    // a 50%-duty dash covered 64% of the corner's centreline when the phase
    // jumped, because the jump skipped a gap and ran two dashes together.
    const dash = centre({ kind: 'dashed', period: 8 });
    const solid = centre({ kind: 'straightRound' });
    const count = (bits: number, c: CentreOptions) =>
      layersOf(bits, E, c).centre.reduce((a: number, b: number) => a + b, 0);
    // A straight run is exact: half of it, to the pixel.
    for (const bits of [1 | 4, 2 | 8]) {
      expect(count(bits, dash) * 2, bitsLabel(bits)).toBe(count(bits, solid));
    }
    for (const bits of CORNERS) {
      const duty = count(bits, dash) / count(bits, solid);
      // Below half, never above: round the bend `along` runs faster than a
      // pixel, so the dashes there are shorter rather than longer. Measured
      // 38-40%. Anything at or above 50% means the phase has started skipping
      // gaps again.
      expect(duty, `${bitsLabel(bits)} duty`).toBeGreaterThan(0.3);
      expect(duty, `${bitsLabel(bits)} duty`).toBeLessThan(0.45);
    }
  });
});

describe('a junction is symmetric — the dash phase included', () => {
  // The dash used to be phased from the tile's CORNER (`wrap(s, P)`, which is
  // what axial.ts does), so the four arms of a crossroads each carried a
  // different phase. Measured before the fix: the 4-way tile disagreed with its
  // own mirror image in 64 px north-south and 60 east-west, at every period.

  /** The masks a flip maps to themselves: N<->S for 'y', E<->W for 'x'. */
  const symmetric = (bits: number, axis: 'x' | 'y') =>
    axis === 'y' ? ((bits & 1) !== 0) === ((bits & 4) !== 0)
                 : ((bits & 2) !== 0) === ((bits & 8) !== 0);

  // A GENERATED boundary, because the drawing itself is not symmetric — it is
  // hand-made, and asking the artist's crumbly edge to mirror would be asking
  // the wrong question. What has to mirror is the marking.
  const SYM_EDGE = edge({ kind: 'straightRound' });

  // 随机长短线 is left out entirely, and that is the one deliberate hole in
  // this rule. It is scattered ALONG the road (its layout is not folded about
  // the crossing — see `randomRuns` for the measurement that forced that) and
  // nudged ACROSS it, so neither mirror survives. Both are what the motif was
  // asked for, and the drawing does the same: its own 4-way tile disagrees with
  // its mirror image in 104 pixels.
  it.each(CENTRES
    .filter((c) => c.kind !== 'none' && c.kind !== 'randomDash')
    .map((c) => [`${c.kind}/${c.width}/${c.period}`, c] as const))(
    'every mask mirrors wherever the MASK does — %s',
    (_name, c) => {
      for (const bits of TWO_EDGE_LAYOUT) {
        const L = layersOf(bits, SYM_EDGE, c);
        for (const axis of ['x', 'y'] as const) {
          if (!symmetric(bits, axis)) continue;
          for (let y = 0; y < L.size; y++) {
            for (let x = 0; x < L.size; x++) {
              const mx = axis === 'x' ? L.size - 1 - x : x;
              const my = axis === 'y' ? L.size - 1 - y : y;
              expect(L.centre[my * L.size + mx], `${bitsLabel(bits)} ${axis} at ${x},${y}`)
                .toBe(L.centre[y * L.size + x]);
            }
          }
        }
      }
    }
  );

  it('the crossroads is symmetric under a QUARTER TURN too', () => {
    for (const c of CENTRES) {
      if (c.kind === 'none') continue;
      if (c.kind === 'randomDash') continue;                        // see above
      const L = layersOf(15, SYM_EDGE, c);
      for (let y = 0; y < L.size; y++) {
        for (let x = 0; x < L.size; x++) {
          // (x,y) -> (size-1-y, x) is a quarter turn about the tile centre.
          expect(L.centre[x * L.size + (L.size - 1 - y)], `${c.kind}/${c.period} at ${x},${y}`)
            .toBe(L.centre[y * L.size + x]);
        }
      }
    }
  });

  it('the dash wave itself mirrors about the crossing, at every period', () => {
    for (const period of CENTRE_PERIODS) {
      for (let d = 0.5; d < TILE_SIZE / 2; d += 1) {
        expect(dashOn(TILE_SIZE / 2 + d, period), `period ${period} at +-${d}`)
          .toBe(dashOn(TILE_SIZE / 2 - d, period));
      }
    }
  });

  it('...and a dash COVERS the crossing rather than leaving a hole in it', () => {
    // Which of the two symmetric phases to take. 路口不断线 was already settled
    // off the drawing — 5 of the 4-way mask's 13 centre pixels sit within 7.25
    // of the tile centre — so the ON block is centred there, not the gap. The
    // `- TILE_SIZE/2` in `dashOn` is what makes period 32 obey this too.
    for (const period of CENTRE_PERIODS) {
      expect(dashOn(TILE_SIZE / 2 + 0.5, period), `period ${period}`).toBe(true);
      expect(dashOn(TILE_SIZE / 2 - 0.5, period), `period ${period}`).toBe(true);
    }
    for (const period of CENTRE_PERIODS) {
      const L = layersOf(15, SYM_EDGE, centre({ kind: 'dashed', period }));
      const mid = L.size / 2;
      expect(L.centre[mid * L.size + mid], `period ${period}`).toBe(1);
    }
  });
});

describe('rule 4 — the seams', () => {
  const centreProfile = (L: ReturnType<typeof layersOf>, side: 'N' | 'S' | 'E' | 'W') => {
    let s = '';
    for (let i = 0; i < L.size; i++) {
      const x = side === 'E' ? L.size - 1 : side === 'W' ? 0 : i;
      const y = side === 'S' ? L.size - 1 : side === 'N' ? 0 : i;
      s += L.centre[y * L.size + x] ? '|' : '.';
    }
    return s;
  };

  it.each(SWEEP)('4a. all tiles agree on each border — %s', (_name, e, c) => {
    // Same argument the boundary rests on, and the same trap: the four borders
    // are checked SEPARATELY, because a dash is a wave along the road and a
    // tile's last row and the next tile's first row are adjacent samples of it,
    // not the same sample.
    for (const [side, bit] of [['N', 1], ['E', 2], ['S', 4], ['W', 8]] as const) {
      const seen = new Set<string>();
      for (const bits of TWO_EDGE_LAYOUT) {
        if (!(bits & bit)) continue;
        seen.add(centreProfile(layersOf(bits, e, c), side));
      }
      expect(seen.size, side).toBe(1);
    }
  });

  it.each(CENTRE_PERIODS.map((p) => [`period ${p}`, p] as const))(
    '4b. a dash keeps its phase ACROSS a seam — %s',
    (_name, period) => {
      // Four tiles of straight vertical run laid end to end: the dash pattern
      // has to be a function of the GLOBAL row, periodic with the period and
      // with no discontinuity at a tile boundary. This is what the periods
      // dividing the tile buys, and it fails at every seam if one does not.
      const NS = 1 | 4;
      const c = centre({ kind: 'dashed', period });
      const L = layersOf(NS, DEFAULT_EDGE, c);
      const rows: number[] = [];
      for (let tile = 0; tile < 4; tile++) {
        for (let y = 0; y < L.size; y++) {
          let n = 0;
          for (let x = 0; x < L.size; x++) n += L.centre[y * L.size + x];
          rows.push(n);
        }
      }
      expect(rows.some((n) => n > 0)).toBe(true);
      for (let g = 0; g < rows.length; g++) {
        expect(rows[g], `global row ${g}`).toBe(rows[g % period]);
      }
    }
  );
});

describe('the centre stage touches nothing else', () => {
  it.each(SWEEP)('%s', (_name, e, c) => {
    for (const bits of TWO_EDGE_LAYOUT) {
      const before = generateEdge(bits, e);
      const after = centreLayers(before, bits, c, e);
      expect(Array.from(after.fill), `${bitsLabel(bits)} fill`).toEqual(Array.from(before.fill));
      expect(Array.from(after.band), `${bitsLabel(bits)} band`).toEqual(Array.from(before.band));
      expect(Array.from(after.depth), `${bitsLabel(bits)} depth`).toEqual(Array.from(before.depth));
    }
  });

});

describe('双直线 is two lines', () => {
  it('a cut across a straight road crosses exactly two of them', () => {
    // Measured the way you would look at it: walk a row across a north-south
    // road and count the runs of centre pixels.
    const NS = 1 | 4;
    for (const e of EDGES) {
      const half = surfaceHalfFor(e);
      if (doubleLineWidth(DEFAULT_CENTRE_WIDTH, half) <= 0) continue;
      const L = layersOf(NS, e, centre({ kind: 'doubleLine' }));
      const mid = Math.floor(L.size / 2);
      let runs = 0;
      for (let x = 0; x < L.size; x++) {
        const here = L.centre[mid * L.size + x];
        const prev = x > 0 ? L.centre[mid * L.size + x - 1] : 0;
        if (here && !prev) runs++;
      }
      expect(runs, `${e.kind}@${e.distance}`).toBe(2);
    }
  });

  it('the gap is protected before the width is, at every road width', () => {
    for (let half = 0; half <= 16; half += 0.25) {
      for (const width of CENTRE_WIDTHS) {
        const w = doubleLineWidth(width, half);
        if (w <= 0) continue;
        // The clear surface between the two lines is twice the inner face, and
        // it is a whole number of pixels because that face is snapped.
        const inner = doubleLineInner(width, half);
        expect(inner, `half ${half} width ${width}`).toBe(Math.round(inner));
        expect(2 * inner, `half ${half} width ${width}`).toBeGreaterThanOrEqual(1);
        expect(w, `half ${half} width ${width}`).toBeLessThanOrEqual(width / 2);
      }
    }
  });

  it('a road with no surface left gets no lines rather than a fudged one', () => {
    expect(doubleLineWidth(WIDEST, 0)).toBe(0);
    expect(surfaceHalfFor(edge({ kind: 'straightRound', distance: MIN_EDGE_DISTANCE }))).toBe(0);
  });

  it('the two lines spread as the road widens — that is where the spacing is from', () => {
    const spread = (distance: number) => {
      const e = edge({ kind: 'straightRound', distance });
      const NS = 1 | 4;
      const L = layersOf(NS, e, centre({ kind: 'doubleLine' }));
      const mid = Math.floor(L.size / 2);
      const xs: number[] = [];
      for (let x = 0; x < L.size; x++) if (L.centre[mid * L.size + x]) xs.push(x);
      return xs.length ? xs[xs.length - 1] - xs[0] : 0;
    };
    expect(spread(MAX_EDGE_DISTANCE)).toBeGreaterThan(spread(8));
    expect(spread(8)).toBeGreaterThan(spread(5));
  });
});

describe('长短虚线 is a long dash and a short one', () => {
  /** The motif read off a straight run, as a run-length list along the road. */
  const runsAlong = (c: CentreOptions) => {
    const NS = 1 | 4;
    const L = layersOf(NS, edge({ kind: 'straightRound' }), c);
    const mid = Math.floor(L.size / 2);
    const runs: { on: boolean; n: number }[] = [];
    for (let y = 0; y < L.size; y++) {
      const on = L.centre[y * L.size + mid] === 1;
      const last = runs[runs.length - 1];
      if (last && last.on === on) last.n++;
      else runs.push({ on, n: 1 });
    }
    return runs;
  };

  it('lays down exactly one long and one short per period', () => {
    for (const period of centrePeriodsFor('longShort')) {
      for (const long of [MIN_LONG, Math.min(8, maxLong(period)), maxLong(period)]) {
        const short = Math.max(MIN_SHORT, Math.min(4, maxShort(period, long)));
        const c = centre({ kind: 'longShort', period, long, short });
        const lit = runsAlong(c).filter((r) => r.on).map((r) => r.n);
        const total = lit.reduce((a, b) => a + b, 0);
        // Over one tile there are 32/period repeats, each laying long + short
        // pixels of line. Runs that touch the tile edge are cut by it, so the
        // TOTAL is what can be asserted exactly rather than the run list.
        expect(total, `${period}/${long}/${short}`).toBe((32 / period) * (long + short));
      }
    }
  });

  it('the two lengths are always distinguishable — never the same dash twice', () => {
    for (const period of centrePeriodsFor('longShort')) {
      for (let long = MIN_LONG; long <= maxLong(period); long += DASH_LENGTH_STEP) {
        expect(maxShort(period, long), `${period}/${long}`)
          .toBeLessThanOrEqual(long - DASH_LENGTH_STEP);
      }
    }
  });

  it('the gap is whole, equal on both sides, and never vanishes', () => {
    for (const period of centrePeriodsFor('longShort')) {
      for (let long = MIN_LONG; long <= maxLong(period); long += DASH_LENGTH_STEP) {
        const top = maxShort(period, long);
        if (top < MIN_SHORT) continue;
        for (let short = MIN_SHORT; short <= top; short += DASH_LENGTH_STEP) {
          const g = dashGap(centre({ kind: 'longShort', period, long, short }));
          expect(g, `${period}/${long}/${short}`).toBe(Math.round(g));
          expect(g, `${period}/${long}/${short}`).toBeGreaterThanOrEqual(1);
          expect(long + short + 2 * g).toBe(period);
        }
      }
    }
  });

  it('never lands a threshold on a pixel centre — the lengths stay even', () => {
    // Why both lengths step by 2. `r` is a half-integer, so a threshold at
    // long/2 is one too unless long is even, and then `<` alone decides whether
    // that pixel is painted.
    for (const period of centrePeriodsFor('longShort')) {
      expect(maxLong(period) % DASH_LENGTH_STEP).toBe(0);
      expect(MIN_LONG % DASH_LENGTH_STEP).toBe(0);
      expect(MIN_SHORT % DASH_LENGTH_STEP).toBe(0);
      for (let d = 0.5; d < 32; d += 1) {
        expect(alongFromCrossing(d, period) % 1, `${period} at ${d}`).toBeCloseTo(0.5);
      }
    }
  });

  it('is centred on the crossing, and mirrors about it', () => {
    for (const period of centrePeriodsFor('longShort')) {
      const c = centre({ kind: 'longShort', period, long: Math.min(DEFAULT_LONG, maxLong(period)) });
      const L = layersOf(15, edge({ kind: 'straightRound' }), c);
      const mid = L.size / 2;
      expect(L.centre[mid * L.size + mid], `period ${period}`).toBe(1);
      for (let y = 0; y < L.size; y++) {
        for (let x = 0; x < L.size; x++) {
          expect(L.centre[(L.size - 1 - y) * L.size + x], `period ${period} at ${x},${y}`)
            .toBe(L.centre[y * L.size + x]);
        }
      }
    }
  });

  it('both sliders move the picture, at every period', () => {
    const fp = (c: CentreOptions) => {
      let h = 0x811c9dc5;
      for (const bits of TWO_EDGE_LAYOUT) {
        const px = composeLayers(layersOf(bits, DEFAULT_EDGE, c), COLOURS);
        for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      }
      return h >>> 0;
    };
    for (const period of centrePeriodsFor('longShort')) {
      const seen = new Set<number>();
      let n = 0;
      for (let long = MIN_LONG; long <= maxLong(period); long += DASH_LENGTH_STEP) {
        for (let short = MIN_SHORT; short <= maxShort(period, long); short += DASH_LENGTH_STEP) {
          seen.add(fp(centre({ kind: 'longShort', period, long, short })));
          n++;
        }
      }
      expect(seen.size, `period ${period}`).toBe(n);
    }
  });

  it('the sanitiser chains period -> long -> short, and never leaves them stuck', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: { ...DEFAULT_CENTRE, kind: 'longShort', period: 4, long: 99, short: 99 },
    });
    // 4 is not offered to this kind; it takes the nearest that is.
    expect(centrePeriodsFor('longShort')).not.toContain(4);
    expect(r.centre.period).toBe(8);
    expect(r.centre.long).toBe(maxLong(8));
    expect(r.centre.short).toBe(maxShort(8, maxLong(8)));
    expect(dashGap(r.centre)).toBeGreaterThanOrEqual(1);

    // Odd lengths land on an even one rather than between two.
    const odd = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: { ...DEFAULT_CENTRE, kind: 'longShort', period: 32, long: 13, short: 3 },
    });
    expect(odd.centre.long % DASH_LENGTH_STEP).toBe(0);
    expect(odd.centre.short % DASH_LENGTH_STEP).toBe(0);
    expect(odd.centre.long + odd.centre.short + 2 * dashGap(odd.centre)).toBe(32);

    // Shrinking the period drags the lengths down with it, in one pass.
    const tight = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: { ...DEFAULT_CENTRE, kind: 'longShort', period: 8, long: 28, short: 14 },
    });
    expect(tight.centre.long).toBeLessThanOrEqual(maxLong(8));
    expect(tight.centre.short).toBeLessThanOrEqual(maxShort(8, tight.centre.long));
  });

  it('exactly one offered period is rigid, and the escape from it is real', () => {
    // The UI opens the period up when 长短虚线 is picked at a period with no
    // room. That is only worth doing if the target actually has room, and only
    // honest if the rigid case is the one it claims to be.
    expect(longShortIsRigid(8)).toBe(true);
    expect(longShortIsRigid(ROOMY_LONGSHORT_PERIOD)).toBe(false);
    expect(centrePeriodsFor('longShort')).toContain(ROOMY_LONGSHORT_PERIOD);
    expect(centrePeriodsFor('longShort').filter(longShortIsRigid)).toEqual([8]);
    // ...and "room" means both sliders can move, not just one.
    expect(maxLong(ROOMY_LONGSHORT_PERIOD)).toBeGreaterThan(MIN_LONG);
    expect(maxShort(ROOMY_LONGSHORT_PERIOD, DEFAULT_LONG + DASH_LENGTH_STEP))
      .toBeGreaterThan(MIN_SHORT);
  });

  it('the defaults are legal, and are a long dash with a short one', () => {
    expect(DEFAULT_SHORT).toBeLessThan(DEFAULT_LONG);
    expect(DEFAULT_LONG).toBeLessThanOrEqual(maxLong(DEFAULT_CENTRE.period));
    expect(DEFAULT_SHORT).toBeLessThanOrEqual(maxShort(DEFAULT_CENTRE.period, DEFAULT_LONG));
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE }).centre.long).toBe(DEFAULT_LONG);
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE }).centre.short).toBe(DEFAULT_SHORT);
  });
});

describe('随机长短线 scatters dashes and never lets two touch', () => {
  const E = edge({ kind: 'straightRound' });
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  // 6-8 is not here because the sanitiser no longer allows it: see MAX_RAND_MIN.
  const RANGES = [[2, 3], [2, 4], [2, 6], [2, 8], [3, 5], [4, 8]] as const;

  /**
   * The motif down FOUR tiles of straight run, as alternating run lengths.
   *
   * Four tiles and not one, because the interesting joins are at the seams —
   * within a single tile the first and last runs are cut by its edges and every
   * length there is a lie.
   */
  const runsDown = (c: CentreOptions) => {
    const NS = 1 | 4;
    const L = layersOf(NS, E, c);
    const mid = Math.floor(L.size / 2);
    const out: { on: boolean; n: number }[] = [];
    for (let tile = 0; tile < 4; tile++) {
      for (let y = 0; y < L.size; y++) {
        const on = L.centre[y * L.size + mid] === 1;
        const last = out[out.length - 1];
        if (last && last.on === on) last.n++;
        else out.push({ on, n: 1 });
      }
    }
    return out;
  };

  it('NO TWO DASHES EVER TOUCH — every gap holds, at every seed and range', () => {
    // The promise, stated the way it can fail: two dashes with nothing between
    // them are not two dashes, they are one longer one. So the check is on both
    // sides — no gap shorter than the minimum, and no dash LONGER than the
    // maximum, which is what a merged pair would look like.
    for (const seed of SEEDS) {
      for (const [randMin, randMax] of RANGES) {
        const c = centre({ kind: 'randomDash', randMin, randMax, seed });
        const runs = runsDown(c);
        // Drop the first and last: the 4-tile strip cuts them.
        for (const r of runs.slice(1, -1)) {
          const label = `seed ${seed} ${randMin}-${randMax} ${r.on ? 'dash' : 'gap'} ${r.n}`;
          if (r.on) expect(r.n, label).toBeLessThanOrEqual(randMax);
          else expect(r.n, label).toBeGreaterThanOrEqual(randMin);
        }
      }
    }
  });

  it('...and the layout itself keeps its gaps, including across the seam', () => {
    for (const seed of SEEDS) {
      for (const [randMin, randMax] of RANGES) {
        const c = centre({ kind: 'randomDash', randMin, randMax, seed });
        const { runs, crossing } = randomRuns(c);
        expect(runs.length, `seed ${seed}`).toBeGreaterThan(0);
        // One dash always straddles the crossing, so 路口不断线 holds.
        expect(runs[crossing][0], 'crossing').toBeLessThanOrEqual(TILE_SIZE / 2);
        expect(runs[crossing][1], 'crossing').toBeGreaterThan(TILE_SIZE / 2);
        for (let i = 0; i < runs.length; i++) {
          const [a, b] = runs[i];
          expect(b - a, `seed ${seed} run ${i}`).toBeGreaterThan(0);
          expect(b - a, `seed ${seed} run ${i}`).toBeLessThanOrEqual(randMax);
          // Only the crossing's dash has to be even; the rest take whole pixels.
          if (i === crossing) expect((b - a) % 2, `seed ${seed} crossing`).toBe(0);
          // WHOLE, so no run boundary lands on a pixel centre: the along
          // coordinate is a half-integer. Even LENGTHS are what make the
          // crossing's own dash, which is centred and so halved, land whole.
          expect(a % 1, `seed ${seed} start ${a}`).toBe(0);
          expect(b % 1, `seed ${seed} end ${b}`).toBe(0);
          expect(a, `seed ${seed} run ${i}`).toBeGreaterThanOrEqual(0);
          expect(b, `seed ${seed} run ${i}`).toBeLessThanOrEqual(TILE_SIZE);
          if (i > 0) expect(a - runs[i - 1][1], `seed ${seed} gap ${i}`).toBeGreaterThanOrEqual(randMin);
        }
        // The two walks meet at the seam, and what is left there is the gap the
        // next tile's first dash will see.
        const seam = runs[0][0] + (TILE_SIZE - runs[runs.length - 1][1]);
        expect(seam, `seed ${seed} seam gap`).toBeGreaterThanOrEqual(randMin);
      }
    }
  });

  it('the lengths really do vary, rather than one length wearing a seed', () => {
    // Otherwise it is 虚线 with extra controls. Measured over the layouts, not
    // over the render, so a road that happens to clip a dash cannot fake it.
    for (const [randMin, randMax] of RANGES) {
      if (randMin === randMax) continue;
      const lengths = new Set<number>();
      for (const seed of SEEDS) {
        for (const [a, b] of randomRuns(centre({ kind: 'randomDash', randMin, randMax, seed })).runs) {
          lengths.add(b - a);
        }
      }
      expect(lengths.size, `${randMin}-${randMax}`).toBeGreaterThan(1);
    }
  });

  it('a seed is a road: same seed same picture, different seeds different ones', () => {
    const fp = (c: CentreOptions) => {
      let h = 0x811c9dc5;
      for (const bits of TWO_EDGE_LAYOUT) {
        const px = composeLayers(layersOf(bits, E, c), COLOURS);
        for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      }
      return h >>> 0;
    };
    const c = centre({ kind: 'randomDash', seed: 3 });
    expect(fp(c)).toBe(fp(centre({ kind: 'randomDash', seed: 3 })));
    const seen = new Set(SEEDS.map((seed) => fp(centre({ kind: 'randomDash', seed }))));
    // Not all distinct — two seeds may draw the same lengths — but a seed
    // button that mostly does nothing is the failure worth catching.
    expect(seen.size).toBeGreaterThan(SEEDS.length / 2);
  });

  it('covers the crossing, and the dash there never leans', () => {
    for (const seed of SEEDS) {
      const c = centre({ kind: 'randomDash', seed });
      const L = layersOf(15, E, c);
      const mid = L.size / 2;
      // 路口不断线: the crossing's own dash is unleaned, so the centre PIXEL
      // itself is painted, not merely something near it.
      expect(L.centre[mid * L.size + mid], `seed ${seed}`).toBe(1);
    }
  });

  it('the weight sits ON the axis, not off to one side', () => {
    // The complaint that unfolded this motif: with a 16px budget a long-dash
    // setting fitted ONE leanable dash per half, one dash can only lean one
    // way, and the road drifted. Measured then: lengths 4-8 used both sides on
    // 0 of 26 seeds. This is that measurement, kept as a floor.
    for (const [randMin, randMax] of RANGES) {
      let bothSides = 0, seeds = 0, drift = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = centre({ kind: 'randomDash', randMin, randMax, seed, randJitter: 2 });
        const { runs, crossing } = randomRuns(c);
        const leans = runs.map((_, i) => jitterOf(i, { runs, crossing }, c, 2));
        if (!leans.some((l) => l !== 0)) continue;
        seeds++;
        if (leans.some((l) => l > 0) && leans.some((l) => l < 0)) bothSides++;
        let sum = 0, n = 0;
        for (let i = 0; i < runs.length; i++) {
          const px = runs[i][1] - runs[i][0];
          sum += leans[i] * px; n += px;
        }
        drift += Math.abs(sum / n);
      }
      // EVERY seed that leans at all leans both ways. Not "most": a lone dash
      // now stays on the axis rather than tipping the road, so the only seeds
      // counted here are those with something to balance.
      expect(seeds, `${randMin}-${randMax}`).toBeGreaterThan(20);
      expect(bothSides, `${randMin}-${randMax} both sides`).toBe(seeds);
      expect(drift / seeds, `${randMin}-${randMax} drift`).toBeLessThan(1);
    }
  });

  it('leans ACROSS the road, which is the whole point and breaks that mirror', () => {
    // The measurement this came from: the reference drawing's centreline is not on one line.
    // Its north-south tile puts dashes in art columns 6, 7 and 8, its east-west
    // tile in art rows 7, 8 and 9 — three positions, one art pixel apart. So a
    // lean of 2 output px is the drawing's own, and the mirror it breaks is the
    // one across the road, never the one along it.
    const leaning = centre({ kind: 'randomDash', seed: 3, randJitter: 1 });
    const flat = centre({ kind: 'randomDash', seed: 3, randJitter: 0 });

    const columns = (bits: number, c: CentreOptions, across: 'x' | 'y') => {
      const L = layersOf(bits, E, c);
      const seen = new Set<number>();
      for (let y = 0; y < L.size; y++) {
        for (let x = 0; x < L.size; x++) {
          if (L.centre[y * L.size + x]) seen.add(across === 'x' ? x : y);
        }
      }
      return seen;
    };
    // A flat motif uses exactly the two columns its width covers; a leaning one
    // uses more. That is "I can see the lean", stated as a number.
    for (const [bits, across] of [[1 | 4, 'x'], [2 | 8, 'y']] as const) {
      expect(columns(bits, flat, across).size, `${bitsLabel(bits)} flat`).toBe(2);
      expect(columns(bits, leaning, across).size, `${bitsLabel(bits)} leaning`).toBeGreaterThan(2);
    }
    // ...and it really is a mirror-breaker, not just extra pixels.
    const L = layersOf(1 | 4, E, leaning);
    let mismatches = 0;
    for (let y = 0; y < L.size; y++) {
      for (let x = 0; x < L.size; x++) {
        if (L.centre[y * L.size + x] !== L.centre[y * L.size + (L.size - 1 - x)]) mismatches++;
      }
    }
    expect(mismatches).toBeGreaterThan(0);
  });

  it('the lean is WHOLE, bounded by the road, and never zero off the crossing', () => {
    for (const e of EDGES) {
      const half = surfaceHalfFor(e);
      for (const width of CENTRE_WIDTHS) {
        const steps = maxJitter(width, half);
        // The far edge of a leaning dash still leaves a pixel of surface, so
        // the ring rule cannot delete it — a motif that randomly drops pieces
        // is not what "random lengths" means.
        if (steps > 0) {
          expect(jitterAt(steps) + width / 2, `${e.kind} w${width}`)
            .toBeLessThanOrEqual(half - 1);
        }
        // The crossing's dash never leans — see `jitterOf`.
        const layout = { runs: Array.from({ length: 12 }, (_, k) => [k, k + 1] as const), crossing: 3 };
        expect(jitterOf(3, layout, centre({ kind: 'randomDash' }), steps), 'the crossing').toBe(0);
        for (let i = 0; i < 12; i++) {
          if (i === 3) continue;
          const lean = jitterOf(i, layout, centre({ kind: 'randomDash' }), steps);
          if (steps === 0) { expect(lean, `${e.kind} w${width} #${i}`).toBe(0); continue; }
          expect(Math.abs(lean), `${e.kind} w${width} #${i}`).toBeLessThanOrEqual(jitterAt(steps));
          // Whole, so no threshold lands on a pixel centre; and never zero,
          // because zero means "did not lean" and that is not one of the
          // options — see `jitterAt`.
          expect(Math.abs(lean % 1), `${e.kind} w${width} #${i}`).toBe(0);
          expect(lean, `${e.kind} w${width} #${i}`).not.toBe(0);
        }
      }
    }
  });

  it('the lean reaches the artist span, at twice the artist resolution', () => {
    // The reference drawing put its dashes at -3, -1, +1: a span of 3 either
    // side, on a 2px lattice because it was drawn at 16 and replayed by
    // replication. On a road of the same width the lean allows 3 steps, and the
    // steps are 1px — same reach, every position in between now available.
    //
    // Pinned to the FIT distance, which is that road: it is what the span was
    // measured against, and any other width is a different road.
    const asDrawnRoad = surfaceHalfFor(edge({ distance: FIT_DISTANCE }));
    expect(maxJitter(DEFAULT_CENTRE_WIDTH, asDrawnRoad)).toBe(3);
    expect([jitterAt(1), jitterAt(2), jitterAt(3)]).toEqual([1, 2, 3]);
  });

  it('the sanitiser keeps the range apart and the seed a whole number', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: {
        ...DEFAULT_CENTRE, kind: 'randomDash',
        randMin: 99, randMax: 1, seed: 0.4,
      },
    });
    expect(r.centre.randMin).toBe(MAX_RAND_MIN);
    // The floor moves with randMin, so the two can never meet.
    expect(r.centre.randMax).toBe(r.centre.randMin + 1);
    expect(r.centre.randMax).toBeLessThanOrEqual(RAND_MAX);
    expect(r.centre.seed).toBeGreaterThanOrEqual(1);
    expect(r.centre.seed % 1).toBe(0);

    // ODD lengths are legal here: the sheet is 32px and these are generated at
    // 32, so only the crossing's centred dash needs an even one.
    const odd = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: { ...DEFAULT_CENTRE, kind: 'randomDash', randMin: 3, randMax: 7 },
    });
    expect(odd.centre.randMin).toBe(3);
    expect(odd.centre.randMax).toBe(7);
  });
});

describe('the kind table and the sanitiser agree', () => {
  it('only the drawn kinds take a width, and only 虚线 takes a period', () => {
    expect(CENTRE_KINDS.filter((k) => k.usesPeriod).map((k) => k.id))
      .toEqual(['dashed', 'longShort']);
    expect(centreUsesPeriod('dashed')).toBe(true);
    expect(centreUsesPeriod('straightRound')).toBe(false);
    expect(centreIsDrawn('none')).toBe(false);
    expect(centreIsDrawn('doubleLine')).toBe(true);
  });

  it('snaps the width and the period, and rejects a kind it does not have', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: { ...DEFAULT_CENTRE, kind: 'nope' as never, width: 99, period: 7 },
    });
    expect(r.centre.kind).toBe(DEFAULT_CENTRE.kind);
    expect(r.centre.width).toBe(WIDEST);
    expect(r.centre.period).toBe(8);
    const low = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      centre: { ...DEFAULT_CENTRE, kind: 'dashed', width: -3, period: 999 },
    });
    expect(low.centre.width).toBe(CENTRE_WIDTHS[0]);
    expect(low.centre.period).toBe(CENTRE_PERIODS[CENTRE_PERIODS.length - 1]);
    // A width off the grid lands on the nearest one that exists, never between.
    for (const w of [1, 2.4, 3.1, 5.9, 7]) {
      expect(CENTRE_WIDTHS).toContain(snapCentreWidth(w));
      expect(sanitizeRecipe({ ...DEFAULT_RECIPE, centre: { ...DEFAULT_CENTRE, width: w } })
        .centre.width).toBe(snapCentreWidth(w));
    }
  });

  it('every period divides the tile, or a dash breaks at every seam', () => {
    for (const p of CENTRE_PERIODS) expect(32 % p, `${p}`).toBe(0);
  });
});
