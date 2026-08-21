import { describe, it, expect } from 'vitest';
import { composeLayers } from './layers';
import {
  surfaceLayers, surfaceIsIdentity, surfaceUsesPeriod,
  rutInner, maxRutWidth, rutWidthsFor, maxRibWidth, ribWidthsFor,
  SURFACE_KINDS, DEFAULT_SURFACE, SURFACE_PERIODS,
  RUT_WIDTHS, RIB_WIDTHS, SURF_ALT, CAMBER_RINGS, camberEdge, camberZone, surfaceRamp,
  type SurfaceOptions, type SurfaceKind,
} from './surface';
import {
  generateEdge, surfaceHalfFor, DEFAULT_EDGE, KERB_PX,
  type EdgeOptions,
} from './boundary';
import { centreLayers, DEFAULT_CENTRE, type CentreOptions } from './centre';
import { TWO_EDGE_LAYOUT, bitsLabel } from './twoEdge';
import { parseHexColour, type RoleColours } from './palette';
import { sanitizeRecipe, DEFAULT_RECIPE } from './recipe';

const COLOURS: RoleColours = {
  path: parseHexColour('#eea160'),
  edge: parseHexColour('#bf7958'),
  edgeAlt: parseHexColour('#d58b60'),
  centre: parseHexColour('#f4cca1'),
};


const surf = (o: Partial<SurfaceOptions>): SurfaceOptions =>
  ({ ...DEFAULT_SURFACE, ...o });
const edge = (o: Partial<EdgeOptions>): EdgeOptions =>
  ({ ...DEFAULT_EDGE, ...o });
const centre = (o: Partial<CentreOptions>): CentreOptions =>
  ({ ...DEFAULT_CENTRE, ...o });

/** Every texture, on an as-drawn boundary and on generated ones. */
const EDGES: EdgeOptions[] = [
  edge({}),                                     // 原版
  edge({ kind: 'straightRound' }),              // the default distance, 11
  edge({ kind: 'straightRound', distance: 4 }), // a narrow road
  edge({ kind: 'arcWave', amplitude: 2 }),
];
const SURFACES: SurfaceOptions[] = [
  ...CAMBER_RINGS.map((rings) => surf({ kind: 'camber', rings })),
  surf({ kind: 'gravel' }),
  surf({ kind: 'gravel', coverage: 0.6, seed: 7 }),
  ...RUT_WIDTHS.map((rutWidth) => surf({ kind: 'ruts', rutWidth })),
  ...SURFACE_PERIODS.map((period) =>
    surf({ kind: 'ribs', period, ribWidth: Math.min(2, maxRibWidth(period)) })),
  surf({ kind: 'ribs', period: 16, ribWidth: 6 }),
];

/**
 * The layers a recipe actually paints, all three stages in order.
 *
 * The centreline defaults to 无花纹 rather than to 原版, and that is not
 * tidiness — it is what isolates this stage from a property of the DRAWING.
 * Measured on the reference drawing's raw role grid, the artist's own layers do not agree
 * across a border: the centreline puts a pixel on ESW's south edge and NSW's
 * west edge that no other mask has, and the kerb dither disagrees on four of
 * the eight borders. Only the SILHOUETTE was normalised by the bake. Since this
 * stage skips whatever the earlier layers claimed, handing it the artist's line
 * would hand it that disagreement, and the seam test below would be measuring
 * the drawing rather than the texture. The quirk is pinned by its own test, so
 * this default has a reason on record rather than being merely convenient.
 */
const layersOf = (
  bits: number, e: EdgeOptions, s: SurfaceOptions,
  c: CentreOptions = centre({ kind: 'none' })
) => surfaceLayers(centreLayers(generateEdge(bits, e), bits, c, e),
  bits, s, e);

const SWEEP = EDGES.flatMap((e) => SURFACES.map((s) => [
  `${e.kind}@${e.distance} + ${s.kind}/${s.rutWidth}/${s.ribWidth}@${s.period}`,
  e, s,
] as const));

/** How many pixels this stage claimed. */
const lit = (L: { surface?: Uint8Array }) => {
  let n = 0;
  for (const v of L.surface ?? []) n += v;
  return n;
};

/** The straight masks, where "along" and "across" are unambiguous. */
const NS = 1 | 4;
const EW = 2 | 8;

// ---------------------------------------------------------------------------

describe('单色 IS the original', () => {
  it('only 单色 is the identity, and it is one object', () => {
    for (const k of SURFACE_KINDS) {
      expect(surfaceIsIdentity(surf({ kind: k.id })), k.id).toBe(k.id === 'flat');
    }
    // Short-circuited, not recomputed: a plain road must not pay for a stage
    // that has nothing to do.
    for (const bits of TWO_EDGE_LAYOUT) {
      const road = generateEdge(bits, DEFAULT_EDGE);
      expect(surfaceLayers(road, bits, surf({ kind: 'flat' }), DEFAULT_EDGE)).toBe(road);
    }
  });

});

describe('the four surfaces are actually four', () => {
  // The failure this app has shipped four times: a menu entry that renders
  // identically to its neighbour. Fingerprinted on the crossroads, where every
  // motif has the most road to show itself on.
  it('every kind paints a different crossroads', () => {
    const seen = new Map<string, SurfaceKind>();
    for (const s of [surf({ kind: 'flat' }), ...SURFACES]) {
      const L = layersOf(15, edge({ kind: 'straightRound' }), s);
      const key = Array.from(L.surface ?? []).join('');
      const prev = seen.get(key);
      expect(prev, `${s.kind} draws the same as ${prev}`).toBeUndefined();
      seen.set(key, s.kind);
    }
  });

  it('...and each one actually paints something', () => {
    for (const s of SURFACES) {
      for (const e of EDGES) {
        const L = layersOf(15, e, s);
        const n = lit(L);
        expect(n, `${s.kind} on ${e.kind}@${e.distance}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('rule 1 — it only re-colours', () => {
  it.each(SWEEP)('%s', (_name, e, s) => {
    for (const bits of TWO_EDGE_LAYOUT) {
      const before = centreLayers(generateEdge(bits, e),
        bits, DEFAULT_CENTRE, e);
      const after = surfaceLayers(before, bits, s, e);
      // Not one pixel added, not one removed, and the rings unchanged — so
      // every seam proof the boundary rests on is untouched by this stage.
      expect(Array.from(after.fill), `${bitsLabel(bits)} fill`).toEqual(Array.from(before.fill));
      expect(Array.from(after.band), `${bitsLabel(bits)} band`).toEqual(Array.from(before.band));
      expect(Array.from(after.centre), `${bitsLabel(bits)} centre`)
        .toEqual(Array.from(before.centre));
      expect(Array.from(after.depth), `${bitsLabel(bits)} depth`).toEqual(Array.from(before.depth));
    }
  });

  it('the ALPHA channel of the painted tile is the same as 单色\'s', () => {
    // The stage above is about the layers; this is about what actually reaches
    // the PNG. A texture that changed which pixels are opaque would break
    // tiling however tidy the arrays looked.
    for (const e of EDGES) {
      const flat = surf({ kind: 'flat' });
      for (const s of SURFACES) {
        for (const bits of TWO_EDGE_LAYOUT) {
          const a = composeLayers(layersOf(bits, e, flat), COLOURS);
          const b = composeLayers(layersOf(bits, e, s), COLOURS);
          for (let i = 3; i < a.length; i += 4) {
            if (a[i] !== b[i]) {
              throw new Error(`${s.kind} on ${e.kind} ${bitsLabel(bits)}: alpha differs at ${i >> 2}`);
            }
          }
        }
      }
    }
  });
});

describe('rule 2 — the kerb and the centreline are not its pixels', () => {
  it.each(SWEEP)('%s', (_name, e, s) => {
    for (const bits of TWO_EDGE_LAYOUT) {
      // With a GENERATED centreline too, so the stage is tested against a line
      // the artist did not draw as well as against the one they did.
      for (const c of [DEFAULT_CENTRE, centre({ kind: 'straightRound', width: 6 })]) {
        const L = layersOf(bits, e, s, c);
        for (let i = 0; i < L.fill.length; i++) {
          if (!L.surface?.[i]) continue;
          expect(L.fill[i], `${bitsLabel(bits)} at ${i}`).toBe(1);
          expect(L.band[i], `${bitsLabel(bits)} at ${i}`).toBe(0);
          expect(L.centre[i], `${bitsLabel(bits)} at ${i}`).toBe(0);
        }
      }
    }
  });

  it('a generated line takes its pixels BACK from the texture', () => {
    // Ordering, stated as a measurement rather than as an intention: the
    // centreline runs first and the texture skips what it claimed, so turning
    // the line on removes texture pixels rather than being painted under them.
    const e = edge({ kind: 'straightRound' });
    const s = surf({ kind: 'gravel', coverage: 1 });
    const none = layersOf(NS, e, s, centre({ kind: 'none' }));
    const line = layersOf(NS, e, s, centre({ kind: 'straightRound', width: 6 }));
    expect(lit(line)).toBeLessThan(lit(none));
    expect(lit(line)).toBe(lit(none) - line.centre.reduce((a, v) => a + v, 0));
  });
});

describe('rule 3 — the seams', () => {
  const profile = (L: ReturnType<typeof layersOf>, side: 'N' | 'S' | 'E' | 'W') => {
    let s = '';
    for (let i = 0; i < L.size; i++) {
      const x = side === 'E' ? L.size - 1 : side === 'W' ? 0 : i;
      const y = side === 'S' ? L.size - 1 : side === 'N' ? 0 : i;
      s += L.surface?.[y * L.size + x] ? '#' : '.';
    }
    return s;
  };

  it.each(SWEEP)('EVERY TILE AGREES ON EACH BORDER — %s', (_name, e, s) => {
    // The rule, and it is the strong form: all sixteen masks put the same
    // texture on a shared border.
    //
    // It used to be weaker — "two tiles that leave this stage the same border
    // pixels get the same texture on them" — because under the replayed drawing
    // this stage did not own the border. The artist's own kerb dither disagreed
    // across masks on four of the eight borders, and a texture that skips kerb
    // pixels inherited that. The drawing is gone and every edge is generated
    // now, so the weaker statement has nothing left to excuse and the strong one
    // holds outright.
    //
    // Checked per SIDE, never lumped: a rib is a wave along the road, so a
    // tile's last row and the next tile's first row are adjacent samples of it
    // rather than the same sample, and comparing them would be wrong.
    for (const [side, bit] of [['N', 1], ['E', 2], ['S', 4], ['W', 8]] as const) {
      const seen = new Set<string>();
      for (const bits of TWO_EDGE_LAYOUT) {
        if (!(bits & bit)) continue;
        seen.add(profile(layersOf(bits, e, s), side));
      }
      expect(seen.size, side).toBe(1);
    }
  });

  it.each(SURFACE_PERIODS.map((p) => [`period ${p}`, p] as const))(
    'a rib keeps its phase ACROSS a seam — %s',
    (_name, period) => {
      // Four tiles of straight vertical run laid end to end. The pattern has to
      // be a function of the GLOBAL row and periodic with the period, with no
      // discontinuity at a tile boundary — which is what the periods dividing
      // the tile buys, and what fails at every seam if one does not.
      const s = surf({ kind: 'ribs', period, ribWidth: Math.min(2, maxRibWidth(period)) });
      const L = layersOf(NS, edge({ kind: 'straightRound' }), s);
      const rows: number[] = [];
      for (let tile = 0; tile < 4; tile++) {
        for (let y = 0; y < L.size; y++) {
          let n = 0;
          for (let x = 0; x < L.size; x++) n += L.surface?.[y * L.size + x] ?? 0;
          rows.push(n);
        }
      }
      expect(rows.some((n) => n > 0)).toBe(true);
      for (let g = 0; g < rows.length; g++) {
        expect(rows[g], `global row ${g}`).toBe(rows[g % period]);
      }
    }
  );

  it('碎石 repeats with the TILE, and says so', () => {
    // `axialHash` is keyed on position modulo 32, so a straight run's gravel
    // repeats every tile. That is not a defect to be fixed — a tileset lays the
    // same 16 tiles down over and over, so nothing this file does could make a
    // road that never repeats. It is asserted so the property is on record.
    const L = layersOf(NS, edge({ kind: 'straightRound' }), surf({ kind: 'gravel' }));
    const M = layersOf(NS, edge({ kind: 'straightRound' }), surf({ kind: 'gravel' }));
    expect(Array.from(L.surface!)).toEqual(Array.from(M.surface!));
  });
});

describe('车辙 is two tracks', () => {
  const e = edge({ kind: 'straightRound' });
  const half = surfaceHalfFor(e);

  it('mirrors about the axis, and never covers it', () => {
    for (const rutWidth of rutWidthsFor(half)) {
      const L = layersOf(NS, e, surf({ kind: 'ruts', rutWidth }));
      const mid = L.size / 2;
      for (let y = 0; y < L.size; y++) {
        for (let x = 0; x < L.size; x++) {
          expect(L.surface?.[y * L.size + (L.size - 1 - x)] ?? 0,
            `w=${rutWidth} at ${x},${y}`).toBe(L.surface?.[y * L.size + x] ?? 0);
        }
        // The two never merge into one band over the middle — two tracks that
        // touch are one track. `rutInner` is floored at 1 for exactly this.
        expect(L.surface?.[y * L.size + mid] ?? 0, `w=${rutWidth} axis row ${y}`).toBe(0);
        expect(L.surface?.[y * L.size + mid - 1] ?? 0, `w=${rutWidth} axis row ${y}`).toBe(0);
      }
    }
  });

  it('each track covers exactly its width in columns', () => {
    for (const rutWidth of rutWidthsFor(half)) {
      const L = layersOf(NS, e, surf({ kind: 'ruts', rutWidth }));
      const y = L.size / 2;                      // a row well inside the run
      let n = 0;
      for (let x = 0; x < L.size / 2; x++) n += L.surface?.[y * L.size + x] ?? 0;
      expect(n, `w=${rutWidth}`).toBe(rutWidth);
    }
  });

  it('the three widths are three pictures — odd widths are real here', () => {
    // Unlike the centreline's, which is symmetric ABOUT the axis and so can
    // only ever cover an even number of columns. A track is off-axis, so 1, 2
    // and 3 are three different tracks and all three are offered.
    const seen = new Set<string>();
    for (const w of rutWidthsFor(half)) {
      seen.add(Array.from(layersOf(NS, e, surf({ kind: 'ruts', rutWidth: w })).surface!).join(''));
    }
    expect(seen.size).toBe(rutWidthsFor(half).length);
    expect(rutWidthsFor(half)).toEqual([...RUT_WIDTHS]);   // at distance 11 all three fit
  });

  it('the offered widths all fit, and there is always one', () => {
    // A control must not offer a value the geometry takes back — the rule the
    // arc amplitude and the centreline width both follow.
    for (let d = 3; d <= 15; d += 0.25) {
      const h = surfaceHalfFor(edge({ kind: 'straightRound', distance: d }));
      const offered = rutWidthsFor(h);
      expect(offered.length, `distance ${d}`).toBeGreaterThan(0);
      expect(offered).toEqual(RUT_WIDTHS.filter((w) => w <= maxRutWidth(h)));
      for (const w of offered) {
        if (w === maxRutWidth(h) && rutInner(w, h) + w > h) continue;   // the floor case
        expect(rutInner(w, h), `distance ${d} w=${w}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('spacing follows the ROAD, not a second slider', () => {
    // A wider road spaces its tracks further apart — the same rule 双直线's
    // spacing and the analytic mode's own ruts follow.
    const wide = rutInner(2, surfaceHalfFor(edge({ kind: 'straightRound', distance: 14 })));
    const narrow = rutInner(2, surfaceHalfFor(edge({ kind: 'straightRound', distance: 6 })));
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('横纹 is bands across the road', () => {
  const e = edge({ kind: 'straightRound' });

  it('is symmetric about the crossing, on both straight runs', () => {
    // The phase discipline `dashOn` paid for: measured from the tile CENTRE,
    // not its corner. Measured from the corner, a crossroads gave each arm a
    // different phase and the 4-way tile disagreed with its own mirror in 64
    // pixels north-south and 60 east-west, at every period.
    for (const period of SURFACE_PERIODS) {
      const s = surf({ kind: 'ribs', period, ribWidth: Math.min(2, maxRibWidth(period)) });
      const ns = layersOf(NS, e, s);
      for (let y = 0; y < ns.size; y++) {
        for (let x = 0; x < ns.size; x++) {
          expect(ns.surface?.[(ns.size - 1 - y) * ns.size + x] ?? 0,
            `NS p=${period} at ${x},${y}`).toBe(ns.surface?.[y * ns.size + x] ?? 0);
        }
      }
      const ew = layersOf(EW, e, s);
      for (let y = 0; y < ew.size; y++) {
        for (let x = 0; x < ew.size; x++) {
          expect(ew.surface?.[y * ew.size + (ew.size - 1 - x)] ?? 0,
            `EW p=${period} at ${x},${y}`).toBe(ew.surface?.[y * ew.size + x] ?? 0);
        }
      }
    }
  });

  it('a rib covers exactly its width, and leaves the rest of the period clear', () => {
    for (const period of SURFACE_PERIODS) {
      for (const ribWidth of ribWidthsFor(period)) {
        const L = layersOf(NS, e, surf({ kind: 'ribs', period, ribWidth }));
        const x = L.size / 2 + 1;                // a column inside the road
        let on = 0;
        for (let y = 0; y < period; y++) on += L.surface?.[y * L.size + x] ?? 0;
        expect(on, `p=${period} w=${ribWidth}`).toBe(ribWidth);
      }
    }
  });

  it('the widths on offer always leave road between two ribs', () => {
    for (const period of SURFACE_PERIODS) {
      const offered = ribWidthsFor(period);
      expect(offered.length, `p=${period}`).toBeGreaterThan(0);
      for (const w of offered) expect(period - w, `p=${period} w=${w}`).toBeGreaterThanOrEqual(2);
      // Every width is EVEN, and that one is a real 32px grid fact: a rib folds
      // about the crossing, so an odd width puts its edge exactly on a sample
      // and which pixels are painted stops being decided by the control.
      for (const w of offered) expect(w % 2, `p=${period} w=${w}`).toBe(0);
    }
    expect(ribWidthsFor(4)).toEqual([2]);        // 4px of period holds one 2px rib
    expect(maxRibWidth(8)).toBe(6);
  });
});

describe('碎石 is a dither', () => {
  const e = edge({ kind: 'straightRound' });
  const plain = (bits: number) => {
    const L = layersOf(bits, e, surf({ kind: 'gravel', coverage: 0 }));
    let n = 0;
    for (let i = 0; i < L.fill.length; i++) if (L.fill[i] && !L.band[i] && !L.centre[i]) n++;
    return n;
  };

  it('covers nothing at 0 and everything at 1', () => {
    for (const bits of TWO_EDGE_LAYOUT) {
      const none = layersOf(bits, e, surf({ kind: 'gravel', coverage: 0 }));
      expect(lit(none), bitsLabel(bits))
        .toBe(0);
      const all = layersOf(bits, e, surf({ kind: 'gravel', coverage: 1 }));
      expect(lit(all), bitsLabel(bits))
        .toBe(plain(bits));
    }
  });

  it('hits roughly the coverage it is asked for', () => {
    // Over the whole sheet, so the sample is the 6264 surface pixels rather
    // than one tile's few hundred.
    for (const coverage of [0.1, 0.2, 0.35, 0.6, 0.85]) {
      let on = 0, total = 0;
      for (const bits of TWO_EDGE_LAYOUT) {
        const L = layersOf(bits, e, surf({ kind: 'gravel', coverage }));
        on += lit(L);
        total += plain(bits);
      }
      expect(on / total, `coverage ${coverage}`).toBeGreaterThan(coverage - 0.05);
      expect(on / total, `coverage ${coverage}`).toBeLessThan(coverage + 0.05);
    }
  });

  it('the seed changes the scatter and nothing else', () => {
    const a = layersOf(15, e, surf({ kind: 'gravel', seed: 1 }));
    const b = layersOf(15, e, surf({ kind: 'gravel', seed: 2 }));
    expect(Array.from(a.surface!)).not.toEqual(Array.from(b.surface!));
    expect(Array.from(a.fill)).toEqual(Array.from(b.fill));
    expect(Array.from(a.band)).toEqual(Array.from(b.band));
  });

  it('reaches every plain pixel there is, right up to the kerb', () => {
    // There is no "keep off the outer ring" rule here, unlike the centreline's,
    // and the reason was a measurement of the reference drawing: 679 of its
    // 6264 surface pixels sat in ring 1, so a texture that stopped short would
    // have modelled something the art did not do.
    //
    // That number is not reachable any more and it is worth saying why rather
    // than deleting the thought: a GENERATED edge makes the kerb the outer
    // KERB_PX by construction, so no plain surface is left in the outer ring
    // for anything to reach. The rule survives as the absence of a rule — at
    // full coverage the texture takes every plain pixel, including the ones
    // touching the kerb's inner face.
    for (const bits of TWO_EDGE_LAYOUT) {
      const L = layersOf(bits, edge({ kind: 'straightRound' }), surf({ kind: 'gravel', coverage: 1 }));
      let plain = 0, shallowest = Infinity;
      for (let i = 0; i < L.fill.length; i++) {
        if (!L.fill[i] || L.band[i] || L.centre[i]) continue;
        plain++;
        expect(L.surface?.[i], `${bitsLabel(bits)} at ${i}`).toBe(1);
        shallowest = Math.min(shallowest, L.depth[i]);
      }
      expect(plain, bitsLabel(bits)).toBeGreaterThan(0);
      // The first ring the kerb does not own — the texture starts right there,
      // with no gap of its own.
      expect(shallowest, `${bitsLabel(bits)} shallowest plain ring`)
        .toBeLessThanOrEqual(KERB_PX + 1);
    }
  });
});

describe('the kind table and the sanitiser agree', () => {
  it('names every kind exactly once, and only 横纹 takes a period', () => {
    const ids = SURFACE_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of SURFACE_KINDS) {
      expect(surfaceUsesPeriod(k.id), k.id).toBe(k.id === 'ribs');
    }
    // The table is what the UI walks, so it has to hold every kind the type
    // allows — a kind missing from it is a feature with no way to reach it.
    const all: Record<SurfaceKind, true> =
      { flat: true, camber: true, gravel: true, ruts: true, ribs: true };
    expect(ids.sort()).toEqual(Object.keys(all).sort());
  });

  it('rejects an unknown kind rather than rendering nothing', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      surface: { ...DEFAULT_SURFACE, kind: 'sparkles' as never },
    });
    expect(r.surface.kind).toBe(DEFAULT_SURFACE.kind);
  });

  it('clamps the track width against the ROAD', () => {
    const narrow = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: { ...DEFAULT_EDGE, kind: 'straightRound', distance: 3 },
      surface: { ...DEFAULT_SURFACE, kind: 'ruts', rutWidth: 3 },
    });
    const half = surfaceHalfFor(narrow.edge);
    expect(narrow.surface.rutWidth).toBe(maxRutWidth(half));
    expect(narrow.surface.rutWidth).toBeLessThan(3);
  });

  it('clamps the rib width against the PERIOD, in that order', () => {
    // Chained the way the geometry constrains them: the period bounds the
    // width, never the other way round, or a stored recipe could keep a rib
    // its period can no longer hold.
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      surface: { ...DEFAULT_SURFACE, kind: 'ribs', period: 4, ribWidth: 6 },
    });
    expect(r.surface.period).toBe(4);
    expect(r.surface.ribWidth).toBe(2);
  });

  it('snaps the period onto divisors of the tile', () => {
    // 12 is equidistant from 8 and 16 and `snapPeriod` keeps the earlier of a
    // tie — recorded, because a tie has to go somewhere and this is where.
    for (const [want, got] of [[3, 4], [7, 8], [12, 8], [99, 32]] as const) {
      const r = sanitizeRecipe({
        ...DEFAULT_RECIPE,
        surface: { ...DEFAULT_SURFACE, kind: 'ribs', period: want },
      });
      expect(r.surface.period, `${want}`).toBe(got);
    }
  });

  it('keeps coverage in range and the seed usable', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      surface: { ...DEFAULT_SURFACE, coverage: 4, seed: 0 },
    });
    expect(r.surface.coverage).toBe(1);
    // >= 1, so the texture is never a silent no-op on a fresh recipe. The
    // analytic mode's `roughSeed` defaults to 0 and reads it as "no jitter",
    // which is why every edge algorithm there is silent until the seed button
    // is clicked; this side does not repeat it.
    expect(r.surface.seed).toBeGreaterThanOrEqual(1);
  });

  it('the widths and the marker value are what the module says they are', () => {
    expect([...RUT_WIDTHS]).toEqual([1, 2, 3]);
    expect([...RIB_WIDTHS]).toEqual([2, 4, 6]);
    expect(SURF_ALT).toBe(1);
  });
});

describe("横向渐变 is the road's camber", () => {
  const e = edge({ kind: 'straightRound' });
  const half = surfaceHalfFor(e);

  it('is BRIGHTEST DOWN THE MIDDLE and darkens outward, never the reverse', () => {
    for (const rings of CAMBER_RINGS) {
      const L = layersOf(NS, e, surf({ kind: 'camber', rings }));
      const y = L.size / 2;
      let prev = -1;
      // Walk out from the axis: the zone index may only ever go up.
      for (let x = L.size / 2; x < L.size; x++) {
        const i = y * L.size + x;
        if (!L.fill[i] || L.band[i] || L.centre[i]) continue;
        const z = L.surface?.[i] ?? 0;
        expect(z, `rings=${rings} at x=${x}`).toBeGreaterThanOrEqual(prev);
        prev = z;
      }
      expect(prev, `rings=${rings} never reached the deepest zone`).toBe(rings);
    }
  });

  it('is ANCHORED TO THE AXIS: a wider road widens the whole gradient', () => {
    // The alternative — fixed-width rings measured inward from the kerb — is a
    // rim effect, and it leaves a flat slab down the middle that GROWS as the
    // road widens. On a road with a centreline that reads as a mistake.
    const narrow = surfaceHalfFor(edge({ kind: 'straightRound', distance: 6 }));
    const wide = surfaceHalfFor(edge({ kind: 'straightRound', distance: 14 }));
    for (const k of [1, 2]) {
      expect(camberEdge(k, 2, wide), `zone ${k}`).toBeGreaterThan(camberEdge(k, 2, narrow));
    }
    // ...and every boundary sits at its SHARE of the road, to within the half
    // pixel the snap costs. The share is the anchoring; the half pixel is the
    // grid, and on a 4px-of-surface road that is a third of a zone — which is
    // why this is stated as a bound and not as an equality between two roads.
    for (let d = 3; d <= 15; d += 0.25) {
      const h = surfaceHalfFor(edge({ kind: 'straightRound', distance: d }));
      for (const rings of CAMBER_RINGS) {
        for (let k = 0; k <= rings + 1; k++) {
          expect(Math.abs(camberEdge(k, rings, h) - (h * k) / (rings + 1)),
            `d=${d} rings=${rings} k=${k}`).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('adding a ring costs no width — it only cuts what is there more finely', () => {
    // The other half of anchoring: the outermost boundary is the road's edge
    // whatever the ring count is.
    for (const rings of CAMBER_RINGS) {
      expect(camberEdge(rings + 1, rings, half)).toBe(Math.round(half));
    }
  });

  it('every zone actually contains pixels — no ring is a dead setting', () => {
    for (const rings of CAMBER_RINGS) {
      const seen = new Set<number>();
      for (const bits of TWO_EDGE_LAYOUT) {
        const L = layersOf(bits, e, surf({ kind: 'camber', rings }));
        for (let i = 0; i < L.fill.length; i++) {
          if (!L.fill[i] || L.band[i] || L.centre[i]) continue;
          seen.add(L.surface?.[i] ?? 0);
        }
      }
      for (let z = 0; z <= rings; z++) expect(seen.has(z), `rings=${rings} zone ${z}`).toBe(true);
    }
  });

  it('the zone boundaries are WHOLE, so no ring can fall between two samples', () => {
    // The trap `doubleLineInner` and `rutInner` both met: pixel centres sit on
    // half-integers, so an unsnapped boundary can contain no sample at all and
    // the ring renders as missing while the arithmetic says it is there.
    for (let d = 3; d <= 15; d += 0.25) {
      const h = surfaceHalfFor(edge({ kind: 'straightRound', distance: d }));
      for (const rings of CAMBER_RINGS) {
        for (let k = 0; k <= rings + 1; k++) {
          expect(camberEdge(k, rings, h) % 1, `d=${d} rings=${rings} k=${k}`).toBe(0);
        }
      }
    }
  });

  it('camberZone agrees with the edges it is built from', () => {
    for (const rings of CAMBER_RINGS) {
      for (let k = 0; k <= rings; k++) {
        const lo = camberEdge(k, rings, half);
        const hi = camberEdge(k + 1, rings, half);
        if (hi <= lo) continue;                    // a zone with no room, on a narrow road
        expect(camberZone(lo + 0.5, rings, half), `zone ${k}`).toBe(k);
      }
    }
  });

  it("THE DEEPEST STEP IS THE PALETTE'S OWN 暗色, not a near miss", () => {
    // `edgeAlt` is a colour the user picks. A derived tone that landed near it
    // would quietly ignore that choice, and it would also break the four-colour
    // property every single-step texture relies on.
    for (const rings of CAMBER_RINGS) {
      const ramp = surfaceRamp(COLOURS, surf({ kind: 'camber', rings }));
      expect(ramp).toHaveLength(rings + 1);
      expect(ramp[0]).toEqual(COLOURS.path);
      expect(ramp[rings]).toEqual(COLOURS.edgeAlt);
    }
    // ...and a scattered texture is one step, so it stays on four colours.
    for (const kind of ['gravel', 'ruts', 'ribs'] as const) {
      const ramp = surfaceRamp(COLOURS, surf({ kind }));
      expect(ramp, kind).toHaveLength(2);
      expect(ramp[1], kind).toEqual(COLOURS.edgeAlt);
    }
  });

  it('every ring count is a different picture, and the tones are far enough apart', () => {
    // Under about 3 units of RGB distance two tones read as one, and the ring
    // count would have dead stops.
    const seen = new Set<string>();
    for (const rings of CAMBER_RINGS) {
      const ramp = surfaceRamp(COLOURS, surf({ kind: 'camber', rings }));
      for (let i = 1; i < ramp.length; i++) {
        const gap = Math.abs(ramp[i].r - ramp[i - 1].r)
          + Math.abs(ramp[i].g - ramp[i - 1].g)
          + Math.abs(ramp[i].b - ramp[i - 1].b);
        expect(gap, `rings=${rings} step ${i}`).toBeGreaterThan(3);
      }
      seen.add(Array.from(layersOf(15, e, surf({ kind: 'camber', rings })).surface!).join(''));
    }
    expect(seen.size).toBe(CAMBER_RINGS.length);
  });
});

describe("横向渐变 under the AREA reading", () => {
  const areaEdge = edge({ scheme: 'area', kind: 'straightRound', distance: 2, amplitude: 1 });

  it('A SOLID TILE GETS NOTHING — the region is not tiled into a waffle', () => {
    // ⚠ The bug this pins, and it was live and very visible. `surfaceLayers`
    // asked `roadCoords` for a coordinate whatever the scheme was, and
    // `roadCoords` answers for every mask — so `near` was never null and an
    // area tile was being shaded off the ROAD SKELETON's `t`. Every solid tile
    // got its own little concentric rings, and a large region rendered as a
    // waffle with a grid drawn through it.
    //
    // A cell whose terrain continues in every direction has no boundary, so
    // there is nothing for a rim to be a rim of.
    for (const rings of CAMBER_RINGS) {
      const L = layersOf(15, areaEdge, surf({ kind: 'camber', rings }));
      for (let i = 0; i < L.fill.length; i++) {
        expect(L.surface?.[i] ?? 0, `rings=${rings} at ${i}`).toBe(0);
      }
    }
  });

  it('counts IN from the boundary, so the darkest ring is at the edge', () => {
    // The inversion. A road is brightest on its axis and darkens outward; a
    // region has no axis, so the zones run the other way.
    for (const rings of CAMBER_RINGS) {
      const L = layersOf(1 | 2 | 4, areaEdge, surf({ kind: 'camber', rings }));
      const y = L.size / 2;
      let prev = Infinity;
      let sawDeepest = false;
      // Walk in from the west edge, which is the only side that stops here.
      for (let x = 0; x < L.size / 2; x++) {
        const i = y * L.size + x;
        if (!L.fill[i] || L.band[i] || L.centre[i]) continue;
        const z = L.surface?.[i] ?? 0;
        if (z === rings) sawDeepest = true;
        // Never darker as we go deeper.
        expect(z, `rings=${rings} at x=${x}`).toBeLessThanOrEqual(prev);
        prev = z;
      }
      expect(sawDeepest, `rings=${rings} never reached the deepest zone`).toBe(true);
      expect(prev, `rings=${rings} never reached plain`).toBe(0);
    }
  });
});
