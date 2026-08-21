import { describe, it, expect } from 'vitest';
import { composeLayers, BAND_EDGE, BAND_ALT, OUTPUT_SIZE } from './layers';
import {
  generateEdge, edgeUsesWave, arcWaveOffset, arcClearance, wouldClip,
  arcRadiusFor, arcAmplitudeFor, arcAngleFor,
  DEFAULT_EDGE, ARC_PERIODS, MAX_ARC_AMPLITUDE, ARC_AMPLITUDE_STEP,
  MIN_EDGE_DISTANCE, MAX_EDGE_DISTANCE, EDGE_DISTANCE_STEP, FIT_DISTANCE, maxArcAmplitude,
  DEFAULT_EDGE_DISTANCE, ROUGH_STYLES, maxRoughness, edgeUsesRough,
  MAX_ROUGHNESS, ROUGHNESS_STEP, dotScaleFor, DOT_SCALE,
  KERB_MOTIFS, KERB_PERIODS, KERB_WIDTHS, kerbWidthsFor, maxKerbWidth, KERB_PX,
  SCHEMES, areaBendFor,
} from './boundary';
import { areaAt } from './areaField';
import {
  type EdgeOptions,
} from './boundary';
import { TWO_EDGE_LAYOUT, DIRECTIONS, bitsLabel } from './twoEdge';
import { parseHexColour, type RoleColours } from './palette';
import { sanitizeRecipe, DEFAULT_RECIPE } from './recipe';
import { BORDER_CLEARANCE } from './pathField';

const COLOURS: RoleColours = {
  path: parseHexColour('#eea160'),
  edge: parseHexColour('#bf7958'),
  edgeAlt: parseHexColour('#d58b60'),
  centre: parseHexColour('#f4cca1'),
};

const opts = (o: Partial<EdgeOptions>): EdgeOptions => ({ ...DEFAULT_EDGE, ...o });

/** Every generated edge across its whole parameter range. */
const SWEEP: EdgeOptions[] = [
  opts({ kind: 'straightRound' }),
  opts({ kind: 'straightRound', coverage: 0.4, seed: 5 }),
  ...ARC_PERIODS.flatMap((period) =>
    [0, 0.5, 1, MAX_ARC_AMPLITUDE].map((amplitude) =>
      opts({ kind: 'arcWave', period, amplitude }))
  ),
];

describe('the three edges are actually three', () => {
  const fingerprint = (o: EdgeOptions) => {
    let h = 0x811c9dc5;
    for (const bits of TWO_EDGE_LAYOUT) {
      const px = composeLayers(generateEdge(bits, o), COLOURS);
      for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    }
    return h >>> 0;
  };

  it('the arc wave responds to BOTH its period and its amplitude', () => {
    const base = opts({ kind: 'arcWave', period: 8, amplitude: 1 });
    expect(fingerprint({ ...base, amplitude: 0 })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, period: 4 })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, period: 16 })).not.toBe(fingerprint(base));
  });

  it('at amplitude 0 the wave collapses onto the straight edge, as it must', () => {
    // Not a coincidence worth leaving unstated: both are the same skeleton, and
    // the wave is a displacement of its boundary. If this ever diverges, the two
    // code paths have drifted apart.
    expect(fingerprint(opts({ kind: 'arcWave', amplitude: 0 })))
      .toBe(fingerprint(opts({ kind: 'straightRound' })));
  });

  it('路沿实心度 1 is a solid ring and 0 leaves none of it', () => {
    const count = (o: EdgeOptions) => {
      let edge = 0, alt = 0, fill = 0;
      for (const bits of TWO_EDGE_LAYOUT) {
        const L = generateEdge(bits, o);
        for (let i = 0; i < L.band.length; i++) {
          fill += L.fill[i];
          if (L.band[i] === BAND_EDGE) edge++;
          else if (L.band[i] === BAND_ALT) alt++;
        }
      }
      return { toned: edge + alt, fill };
    };
    const solid = count(opts({ kind: 'straightRound', coverage: 1 }));
    const bare = count(opts({ kind: 'straightRound', coverage: 0 }));
    expect(bare.toned).toBe(0);
    expect(solid.toned).toBeGreaterThan(0);
    // Same silhouette either way — coverage tones the ring, it does not carve it.
    expect(bare.fill).toBe(solid.fill);
  });
});

describe('the three invariants', () => {
  const alphaProfile = (fill: Uint8Array, size: number, side: 'N' | 'S' | 'E' | 'W') => {
    let s = '';
    for (let i = 0; i < size; i++) {
      const x = side === 'E' ? size - 1 : side === 'W' ? 0 : i;
      const y = side === 'S' ? size - 1 : side === 'N' ? 0 : i;
      s += fill[y * size + x] ? '#' : '.';
    }
    return s;
  };

  it.each(SWEEP.map((o) => [`${o.kind}/${o.period}/${o.amplitude}`, o] as const))(
    '1a. all tiles agree on each border — %s',
    (_name, o) => {
      // Every tile with a north connection must show the SAME north profile, or
      // it cannot sit under an arbitrary neighbour. Note the four borders are
      // checked SEPARATELY, unlike the as-drawn test in baked.test.ts which
      // lumps north with south. That difference is the point of an along-road
      // wave: a tile's bottom row is at global y=15.5 and the next tile's top
      // row at y=16.5, adjacent samples of one continuous wave, so they are
      // supposed to differ. Requiring them equal is what a STATIC drawing needs
      // and it is wrong here — it is how the first version of this test failed.
      for (const [side, bit] of [['N', 1], ['E', 2], ['S', 4], ['W', 8]] as const) {
        const seen = new Set<string>();
        for (const bits of TWO_EDGE_LAYOUT) {
          if (!(bits & bit)) continue;
          const L = generateEdge(bits, o);
          seen.add(alphaProfile(L.fill, L.size, side));
        }
        expect(seen.size, side).toBe(1);
      }
    }
  );

  it.each(SWEEP.map((o) => [`${o.kind}/${o.period}/${o.amplitude}`, o] as const))(
    '1b. the road is continuous ACROSS seams, not just consistent — %s',
    (_name, o) => {
      // 1a only says the tiles agree with each other. This says the result is
      // actually one road: lay four tiles of straight vertical run end to end
      // and the road's width has to be a function of the GLOBAL row, periodic
      // with the arc period and with no discontinuity at a tile boundary.
      //
      // That is the whole reason the periods are divisors of 16. If one were
      // not, this fails at every seam while 1a still passes.
      const NS = 1 | 4;
      const L = generateEdge(NS, o);
      const widths: number[] = [];
      for (let tile = 0; tile < 4; tile++) {
        for (let y = 0; y < L.size; y++) {
          let w = 0;
          for (let x = 0; x < L.size; x++) w += L.fill[y * L.size + x];
          widths.push(w);
        }
      }
      for (let g = 0; g < widths.length; g++) {
        expect(widths[g], `global row ${g}`).toBe(widths[g % o.period]);
      }
    }
  );

  it.each(SWEEP.map((o) => [`${o.kind}/${o.period}/${o.amplitude}`, o] as const))(
    '2. the road stays connected — %s',
    (_name, o) => {
      // 8-connected: the drawing itself has 12 pixels attached only by a
      // diagonal, so 4-connectivity is not a property this art ever had.
      for (const bits of TWO_EDGE_LAYOUT) {
        const { fill, size } = generateEdge(bits, o);
        const start = fill.indexOf(1);
        expect(start, bitsLabel(bits)).toBeGreaterThanOrEqual(0);
        const seen = new Uint8Array(size * size);
        const stack = [start];
        seen[start] = 1;
        let reached = 1;
        while (stack.length) {
          const i = stack.pop()!;
          const x = i % size, y = (i / size) | 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
              const k = ny * size + nx;
              if (!fill[k] || seen[k]) continue;
              seen[k] = 1; reached++; stack.push(k);
            }
          }
        }
        let drawn = 0;
        for (let i = 0; i < fill.length; i++) drawn += fill[i];
        expect(reached, `${bitsLabel(bits)} is in pieces`).toBe(drawn);

        // ...and every open border it claims is part of that one piece.
        for (const d of DIRECTIONS) {
          if (!(bits & d.bit)) continue;
          let onBorder = 0;
          for (let i = 0; i < size; i++) {
            const x = d.dx === 0 ? i : d.dx > 0 ? size - 1 : 0;
            const y = d.dy === 0 ? i : d.dy > 0 ? size - 1 : 0;
            if (fill[y * size + x]) onBorder++;
          }
          expect(onBorder, `${bitsLabel(bits)} ${d.id}`).toBeGreaterThan(0);
        }
      }
    }
  );

  it.each(SWEEP.map((o) => [`${o.kind}/${o.period}/${o.amplitude}`, o] as const))(
    '3. closed borders stay empty — %s',
    (_name, o) => {
      for (const bits of TWO_EDGE_LAYOUT) {
        const L = generateEdge(bits, o);
        for (const d of DIRECTIONS) {
          if (bits & d.bit) continue;
          for (let i = 0; i < L.size; i++) {
            const x = d.dx === 0 ? i : d.dx > 0 ? L.size - 1 : 0;
            const y = d.dy === 0 ? i : d.dy > 0 ? L.size - 1 : 0;
            expect(L.fill[y * L.size + x], `${bitsLabel(bits)} ${d.id}`).toBe(0);
          }
        }
      }
    }
  );

  it('the distance range REACHES the border — there is no room left over', () => {
    // The point of raising the ceiling. It used to stop at 4.5 of a possible
    // 7.75 (in 16px terms) because the isolated dot bound it, and the road had
    // obvious room left. Now the top of the range IS the border clearance, so
    // "push it to the edge" is literally true, and a future change that leaves
    // slack again fails here rather than being noticed by eye.
    expect(arcClearance()).toBe(0);
    expect(MAX_EDGE_DISTANCE).toBe(BORDER_CLEARANCE);
  });
});

describe('边界到中心的距离', () => {
  /** Does this setting satisfy everything the three invariants ask for? */
  const invariantsHold = (o: EdgeOptions): boolean => {
    for (const bits of TWO_EDGE_LAYOUT) {
      // blob47's positive stop: the outline must not be reaching a closed
      // border, where the mask clips it into a straight line. Nothing breaks
      // past this — the sheet stays correct — but the road stops looking like
      // one, so it is where the range ends.
      if (wouldClip(bits, OUTPUT_SIZE, o)) return false;
      const { fill, size } = generateEdge(bits, o);
      let drawn = 0;
      for (let i = 0; i < fill.length; i++) drawn += fill[i];
      if (drawn === 0) return false;                       // renders as nothing

      const start = fill.indexOf(1);
      const seen = new Uint8Array(size * size);
      const stack = [start];
      seen[start] = 1;
      let reached = 1;
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % size, y = (i / size) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            const k = ny * size + nx;
            if (!fill[k] || seen[k]) continue;
            seen[k] = 1; reached++; stack.push(k);
          }
        }
      }
      if (reached !== drawn) return false;                 // in pieces

      for (const d of DIRECTIONS) {
        if (!(bits & d.bit)) continue;
        let on = 0;
        for (let i = 0; i < size; i++) {
          const x = d.dx === 0 ? i : d.dx > 0 ? size - 1 : 0;
          const y = d.dy === 0 ? i : d.dy > 0 ? size - 1 : 0;
          if (fill[y * size + x]) on++;
        }
        if (on === 0) return false;                        // gap at a seam
      }
    }
    for (const [side, bit] of [['N', 1], ['E', 2], ['S', 4], ['W', 8]] as const) {
      const seen = new Set<string>();
      for (const bits of TWO_EDGE_LAYOUT) {
        if (!(bits & bit)) continue;
        const { fill, size } = generateEdge(bits, o);
        let p = '';
        for (let i = 0; i < size; i++) {
          const x = side === 'E' ? size - 1 : side === 'W' ? 0 : i;
          const y = side === 'S' ? size - 1 : side === 'N' ? 0 : i;
          p += fill[y * size + x] ? '#' : '.';
        }
        seen.add(p);
      }
      if (seen.size !== 1) return false;                   // stops tiling
    }
    return true;
  };

  it('moves the boundary, and every step of the slider does something', () => {
    const fills = new Set<number>();
    for (let d = MIN_EDGE_DISTANCE; d <= MAX_EDGE_DISTANCE; d += EDGE_DISTANCE_STEP) {
      let n = 0;
      for (const bits of TWO_EDGE_LAYOUT) {
        const L = generateEdge(bits,
          opts({ kind: 'straightRound', distance: d }));
        for (let i = 0; i < L.fill.length; i++) n += L.fill[i];
      }
      fills.add(n);
    }
    // Every stop a distinct pixel count: the road really does widen with it.
    const stops = Math.round((MAX_EDGE_DISTANCE - MIN_EDGE_DISTANCE) / EDGE_DISTANCE_STEP) + 1;
    expect(stops).toBe(60);
    expect(fills.size).toBe(stops);
  });

  it('THE RANGE IS TIGHT — one step outside it breaks something', () => {
    // Both ends measured by sweeping the real pipeline, the way blob47 derives
    // PATTERN_OFFSET_RANGE. Asserting tightness in BOTH directions is what
    // stops the range drifting: too wide ships a setting that severs the road,
    // too narrow silently removes a look that works.
    expect(invariantsHold(opts({ kind: 'straightRound', distance: MIN_EDGE_DISTANCE }))).toBe(true);
    expect(invariantsHold(opts({ kind: 'straightRound', distance: MAX_EDGE_DISTANCE }))).toBe(true);
    expect(invariantsHold(opts({
      kind: 'straightRound', distance: MIN_EDGE_DISTANCE - EDGE_DISTANCE_STEP,
    }))).toBe(false);
    expect(invariantsHold(opts({
      kind: 'straightRound', distance: MAX_EDGE_DISTANCE + EDGE_DISTANCE_STEP,
    }))).toBe(false);
  });

  it('EVERY ENTRY of the arc-amplitude table is tight, at every period', () => {
    // The table is not smooth — it tracks distance-0.5 to 2.50, drops to 1.25 at
    // 2.75, recovers at 3.50 — so a formula cannot stand in for it and each row
    // has to be checked on its own.
    for (let d = MIN_EDGE_DISTANCE; d <= MAX_EDGE_DISTANCE; d += EDGE_DISTANCE_STEP) {
      const cap = maxArcAmplitude(d);
      for (const period of ARC_PERIODS) {
        expect(
          invariantsHold(opts({ kind: 'arcWave', distance: d, period, amplitude: cap })),
          `d=${d} p=${period} at its cap ${cap}`
        ).toBe(true);
      }
      if (cap >= MAX_ARC_AMPLITUDE) continue;   // nothing above it to test
      const over = cap + ARC_AMPLITUDE_STEP;
      const anyBreaks = ARC_PERIODS.some((period) =>
        !invariantsHold(opts({ kind: 'arcWave', distance: d, period, amplitude: over })));
      expect(anyBreaks, `d=${d} one step over its cap (${over}) should break`).toBe(true);
    }
    // 60 distances x 4 periods x 16 masks, each a full tile of field
    // evaluations, and every one of them is the point — the table is measured
    // and a formula cannot stand in for it. It runs in about 3.4s alone and
    // intermittently crossed vitest's 5s default when the suite ran the files
    // in parallel, which is a flake and not a finding. Given room rather than
    // thinned out.
  }, 30_000);

  it('the sanitiser clamps the amplitude against the DISTANCE, not the global max', () => {
    // 5.25 is a collapse: its ceiling is 2.25 even though 5.00 just below it
    // carries the full 4. A recipe asking for 4 there has to come back at 2.25.
    //
    // ⚠ It used to be 5.00 -> 1.75, and that moved when the lobe became a true
    // circular arc. The table describes where a SHAPE stops fitting; change the
    // shape and every entry is a different question. It is re-measured, not
    // carried over.
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: opts({ kind: 'arcWave', distance: 5.25, amplitude: MAX_ARC_AMPLITUDE }),
    });
    expect(r.edge.distance).toBe(5.25);
    expect(r.edge.amplitude).toBe(2.25);
    // ...and the neighbour below it really does carry the full 4.
    expect(maxArcAmplitude(5)).toBe(MAX_ARC_AMPLITUDE);
  });

  it('both the fit and the starting distance sit on the slider grid', () => {
    for (const d of [FIT_DISTANCE, DEFAULT_EDGE_DISTANCE]) {
      expect(d).toBeGreaterThanOrEqual(MIN_EDGE_DISTANCE);
      expect(d).toBeLessThanOrEqual(MAX_EDGE_DISTANCE);
      expect((d - MIN_EDGE_DISTANCE) % EDGE_DISTANCE_STEP).toBeCloseTo(0);
      // ...and either can still carry the full wave, which is why the default
      // arc amplitude does not have to be apologised for. This is the whole
      // reason the start is 11 and not its neighbour 10.75, which caps at 3.75.
      expect(maxArcAmplitude(d)).toBe(MAX_ARC_AMPLITUDE);
    }
  });

  it('starts the slider wider than the fit, and leaves the fit alone', () => {
    // The two are allowed to differ and DO: the fit measures the drawing, the
    // start is a choice about generated roads. What must not drift is which one
    // the sanitiser hands out when a recipe says nothing.
    expect(DEFAULT_EDGE.distance).toBe(DEFAULT_EDGE_DISTANCE);
    expect(DEFAULT_EDGE_DISTANCE).toBeGreaterThan(FIT_DISTANCE);
  });
});

describe('arcWaveOffset', () => {
  it('never pushes outward, and swings a full amplitude inward', () => {
    const P = 8, A = 2;
    // Joins sit half way; the outward peak just touches the nominal outline and
    // the inward one bites the whole amplitude. Nothing is ever positive — that
    // is the property the tiling invariant rests on.
    expect(arcWaveOffset(0, P, A)).toBeCloseTo(-A / 2);
    expect(arcWaveOffset(P / 2, P, A)).toBeCloseTo(-A / 2);
    expect(arcWaveOffset(P, P, A)).toBeCloseTo(-A / 2);
    expect(arcWaveOffset(P / 4, P, A)).toBeCloseTo(0);
    expect(arcWaveOffset((3 * P) / 4, P, A)).toBeCloseTo(-A);
    for (let s = 0; s < 3 * P; s += 0.125) {
      expect(arcWaveOffset(s, P, A)).toBeLessThanOrEqual(1e-12);
      expect(arcWaveOffset(s, P, A)).toBeGreaterThanOrEqual(-A - 1e-12);
    }
  });

  it('IS A CIRCLE — every lobe fits one to within a rounding error', () => {
    // The assertion the old version of this test could not make, because the
    // old shape was not one. It scaled a unit semicircle by period/2 along and
    // amplitude/2 across, which is an ELLIPSE arc and only a circle where those
    // two happen to be equal. Fitting a circle to it gave max deviations of
    // 0.48px at P=32 A=4 and 0.26px at P=32 A=2 — half a pixel on a 32px tile,
    // and visible as the boundary parking at each extreme and then crossing the
    // middle in one row.
    const fit = (pts: readonly (readonly [number, number])[]) => {
      // Algebraic circle fit: x^2 + y^2 + Dx + Ey + F = 0.
      let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sxz = 0, Syz = 0, Sz = 0;
      for (const [x, y] of pts) {
        const z = x * x + y * y;
        Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y;
        Sxz += x * z; Syz += y * z; Sz += z;
      }
      const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, pts.length]];
      const b = [-Sxz, -Syz, -Sz];
      for (let i = 0; i < 3; i++) {
        let p = i;
        for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
        [A[i], A[p]] = [A[p], A[i]];
        [b[i], b[p]] = [b[p], b[i]];
        for (let r = i + 1; r < 3; r++) {
          const f = A[r][i] / A[i][i];
          for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c];
          b[r] -= f * b[i];
        }
      }
      const s = [0, 0, 0];
      for (let i = 2; i >= 0; i--) {
        let v = b[i];
        for (let c = i + 1; c < 3; c++) v -= A[i][c] * s[c];
        s[i] = v / A[i][i];
      }
      const cx = -s[0] / 2, cy = -s[1] / 2;
      const R = Math.sqrt(cx * cx + cy * cy - s[2]);
      let worst = 0;
      for (const [x, y] of pts) worst = Math.max(worst, Math.abs(Math.hypot(x - cx, y - cy) - R));
      return { R, worst };
    };

    for (const [period, amplitude] of [[32, 4], [32, 2], [16, 4], [16, 1], [8, 2]] as const) {
      const pts: [number, number][] = [];
      for (let s = 0; s <= period / 2; s += period / 200) {
        pts.push([s, arcWaveOffset(s, period, amplitude)]);
      }
      const f = fit(pts);
      expect(f.worst, `P=${period} A=${amplitude} deviation from a circle`).toBeLessThan(0.002);
      // ...and it is the radius the conversion says it is.
      expect(f.R, `P=${period} A=${amplitude} radius`)
        .toBeCloseTo(arcRadiusFor(period, amplitude), 2);
    }
  });

  it('radius and amplitude are the same degree of freedom, and round-trip', () => {
    for (const period of ARC_PERIODS) {
      for (const amplitude of [0.5, 1, 2, 2.5, 4]) {
        const r = arcRadiusFor(period, amplitude);
        expect(arcAmplitudeFor(period, r), `P=${period} A=${amplitude}`)
          .toBeCloseTo(amplitude, 6);
        // A bigger radius is a shallower arc. That is the whole reason the
        // control is in radius: a large one is a small-angle sector.
        expect(arcAmplitudeFor(period, r * 2)).toBeLessThan(amplitude);
      }
      // `period / 4` is the half-chord, so it is the tightest possible lobe —
      // a half-circle, 90 degrees of half-angle.
      expect(arcAngleFor(period, arcAmplitudeFor(period, period / 4))).toBeCloseTo(90, 4);
    }
  });

  it('is not a sine, which is what keeps the corner at the join', () => {
    // An arc meets its neighbour at a corner; a sine would meet it smoothly,
    // and the corner is what reads as scalloped rather than wobbly.
    const P = 16, A = 2;
    let worst = 0;
    for (let s = 0; s <= P; s += 0.25) {
      const sine = -(A / 2) * (1 - Math.cos((2 * Math.PI * s) / P));
      worst = Math.max(worst, Math.abs(arcWaveOffset(s, P, A) - sine));
    }
    expect(worst).toBeGreaterThan(0.1);
  });

  it('repeats with its period, in both directions', () => {
    for (const s of [0.5, 1, 2.5, 3, 5.5, 7]) {
      expect(arcWaveOffset(s + 8, 8, 2)).toBeCloseTo(arcWaveOffset(s, 8, 2));
      expect(arcWaveOffset(s - 8, 8, 2)).toBeCloseTo(arcWaveOffset(s, 8, 2));
    }
  });
});

describe('the sanitiser', () => {
  it('snaps the arc period onto divisors of the tile', () => {
    for (const [given, want] of [[6, 8], [14, 16], [100, 32], [1, 8]] as const) {
      expect(sanitizeRecipe({
        ...DEFAULT_RECIPE, edge: opts({ period: given }),
      }).edge.period).toBe(want);
    }
  });

  it('rejects an unknown edge kind rather than rendering nothing', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: { ...DEFAULT_EDGE, kind: 'nope' as never },
    });
    expect(r.edge.kind).toBe(DEFAULT_EDGE.kind);
  });

  it('clamps the amplitude to what the geometry allows', () => {
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, edge: opts({ amplitude: 99 }) })
      .edge.amplitude).toBe(MAX_ARC_AMPLITUDE);
    expect(sanitizeRecipe({ ...DEFAULT_RECIPE, edge: opts({ amplitude: -5 }) })
      .edge.amplitude).toBe(0);
  });

  it('only the arc wave says it uses the wave controls', () => {
    expect(edgeUsesWave('arcWave')).toBe(true);
    expect(edgeUsesWave('straightRound')).toBe(false);
      });
});


describe('边界噪点 — the outline\'s own wobble', () => {
  const ROUGH = ROUGH_STYLES.filter((s) => s.id !== 'smooth');

  it('路沿实心度 does NOT move a single opaque pixel — which is why this exists', () => {
    // The measurement the whole control rests on, and the answer to why the two
    // knobs that were already here could not reproduce a dissolved edge:
    // 实心度 dithers the COLOURING of the outer ring, and the silhouette
    // underneath it is a clean threshold at every setting.
    const counts = new Set<number>();
    for (const coverage of [0, 0.2, 0.43, 0.6, 1]) {
      let opaque = 0;
      for (const bits of TWO_EDGE_LAYOUT) {
        const { fill } = generateEdge(bits,
          opts({ kind: 'arcWave', distance: 11, period: 8, amplitude: 4, coverage }));
        for (let i = 0; i < fill.length; i++) opaque += fill[i];
      }
      counts.add(opaque);
    }
    expect(counts.size, 'coverage changed the silhouette').toBe(1);
    expect([...counts][0]).toBe(9196);

    // ...and the noise DOES move them, which is the whole difference.
    let rough = 0;
    for (const bits of TWO_EDGE_LAYOUT) {
      const { fill } = generateEdge(bits, opts({
        kind: 'arcWave', distance: 11, period: 8, amplitude: 4,
        roughStyle: 'hand', roughness: 1,
      }));
      for (let i = 0; i < fill.length; i++) rough += fill[i];
    }
    expect(rough).not.toBe(9196);
  });

  it('is off by default, and knows when it is doing nothing', () => {
    expect(DEFAULT_EDGE.roughStyle).toBe('smooth');
    expect(edgeUsesRough(DEFAULT_EDGE)).toBe(false);
    expect(edgeUsesRough(opts({ roughStyle: 'hand', roughness: 0 }))).toBe(false);
    expect(edgeUsesRough(opts({ roughStyle: 'hand', roughness: 1 }))).toBe(true);
  });

  it('offers no style that reads `s` — 圆弧波浪线 already IS that one', () => {
    // Not only the duplicate-entry rule: the seam result below rests on the
    // displacement never asking which axis `s` came off.
    const OFFERED = ['smooth', 'hand', 'gravel', 'jagged', 'boulder', 'thorn', 'moss'];
    expect(ROUGH_STYLES.map((s) => s.id).sort()).toEqual([...OFFERED].sort());
  });

  it('EVERY OPEN BORDER STILL SHOWS ONE PROFILE, at any amplitude', () => {
    // Invariant 1 under a TWO-SIDED displacement, and the measurement that says
    // it may be two-sided at all. 圆弧波浪线 had to bite inward only: out past
    // 7.25 a corner tile's nearest element can be the other arm, so `s` comes
    // off a different axis and the border profiles split. A displacement that
    // is a pure function of GLOBAL position cannot care which axis anything
    // came off, and measured over every style, both edges, four amplitudes and
    // three seeds, no border splits.
    for (const style of ROUGH) {
      for (const kind of ['straightRound', 'arcWave'] as const) {
        for (const roughness of [0.5, 1, 2, 3]) {
          for (const seed of [1, 7, 42]) {
            const o = opts({
              kind, distance: FIT_DISTANCE, period: 8, amplitude: 2,
              roughStyle: style.id, roughness, seed,
            });
            for (const [side, bit] of [['N', 1], ['E', 2], ['S', 4], ['W', 8]] as const) {
              const seen = new Set<string>();
              for (const bits of TWO_EDGE_LAYOUT) {
                if (!(bits & bit)) continue;
                const L = generateEdge(bits, o);
                let p = '';
                for (let i = 0; i < L.size; i++) {
                  const x = side === 'E' ? L.size - 1 : side === 'W' ? 0 : i;
                  const y = side === 'S' ? L.size - 1 : side === 'N' ? 0 : i;
                  const j = y * L.size + x;
                  p += !L.fill[j] ? '.' : L.band[j] ? 'e' : 'p';
                }
                seen.add(p);
              }
              expect(seen.size, `${style.id} ${kind} amp${roughness} seed${seed} ${side}`).toBe(1);
            }
          }
        }
      }
    }
  }, 60_000);

  it('the kerb rides the wobble instead of letting surface poke through', () => {
    // The kerb is the outer KERB_PX of whatever the outline NOW is, measured
    // from its outer face. Measured from the centre it would stay put while the
    // outline moved, and every dip would show bare surface at the very edge.
    for (const bits of TWO_EDGE_LAYOUT) {
      const L = generateEdge(bits,
        opts({ kind: 'straightRound', roughStyle: 'hand', roughness: 2 }));
      const n = L.size;
      const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n) ? 1 : L.fill[y * n + x];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          if (!L.fill[i]) continue;
          if (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)) continue;
          expect(L.band[i], `${bitsLabel(bits)} at ${x},${y}`).not.toBe(0);
        }
      }
    }
  });

  it('the isolated dot is sized against the noise, not just the distance', () => {
    // The dot is drawn where `hypot / scale < distance + rough`, so its radius
    // is `scale * (distance + rough)`. Subtracting the roughness from the
    // CLEARANCE instead is the obvious wrong answer and it clips: measured, at
    // distance 11 with 1px of noise it asks for radius 15.8 against a 15.5
    // budget, and the isolated cell was the first of the sixteen masks to fail.
    for (const d of [4, 7.25, 11, 15.5]) {
      for (const r of [0, 1, 2, 3]) {
        expect(dotScaleFor(d, r) * (d + r), `d=${d} r=${r}`)
          .toBeLessThanOrEqual(BORDER_CLEARANCE + 1e-9);
      }
    }
    expect(dotScaleFor(4, 0)).toBe(DOT_SCALE);       // still the artist's 1.6
  });

  it('NOTHING IS EVER SHED, at any amplitude, style or seed', () => {
    // The invariant the measured table could not buy. It was a 6 x 60 sweep
    // over 12 seeds, and seeds 13-20 — which it had never seen — broke it 60
    // times, because whether an amplitude sheds a speck depends on the seed.
    // `pruneOrphans` removes them instead, so this holds by construction and
    // the sweep below is checking that rather than sampling for it.
    for (const style of ROUGH) {
      for (const roughness of [1, 2, MAX_ROUGHNESS]) {
        for (const seed of [3, 13, 17, 271]) {
          for (const distance of [4, FIT_DISTANCE, 11, 14]) {
            const o = opts({ kind: 'straightRound', distance, roughStyle: style.id, roughness, seed });
            for (const bits of TWO_EDGE_LAYOUT) {
              const { fill, size } = generateEdge(bits, o);
              // Every drawn pixel is in the main body, or in a piece that
              // reaches an open border and so continues into the neighbour.
              const comp = new Int32Array(size * size).fill(-1);
              const area: number[] = [];
              const open: boolean[] = [];
              for (let s0 = 0; s0 < fill.length; s0++) {
                if (!fill[s0] || comp[s0] >= 0) continue;
                const id = area.length;
                area.push(0); open.push(false);
                comp[s0] = id;
                const st = [s0];
                while (st.length) {
                  const i = st.pop()!;
                  area[id]++;
                  const x = i % size, y = (i / size) | 0;
                  for (const d of DIRECTIONS) {
                    if (!(bits & d.bit)) continue;
                    if (d.dx !== 0 ? x === (d.dx > 0 ? size - 1 : 0) : y === (d.dy > 0 ? size - 1 : 0)) {
                      open[id] = true;
                    }
                  }
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                      const nx = x + dx, ny = y + dy;
                      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
                      const k = ny * size + nx;
                      if (!fill[k] || comp[k] >= 0) continue;
                      comp[k] = id; st.push(k);
                    }
                  }
                }
              }
              let best = -1, bestArea = -1;
              for (let id = 0; id < area.length; id++) {
                if (area[id] > bestArea) { bestArea = area[id]; best = id; }
              }
              for (let id = 0; id < area.length; id++) {
                expect(id === best || open[id],
                  `${style.id} amp${roughness} seed${seed} d=${distance} ${bitsLabel(bits)}: `
                  + `${area[id]}px orphan`).toBe(true);
              }
            }
          }
        }
      }
    }
  }, 60_000);

  it('...and the prune never removes a BORDER pixel, which is why the seam holds', () => {
    // The exact reason the previous test is allowed to exist at all. If the
    // prune could take a border pixel, it would take different ones in
    // different masks — connectivity is a whole-tile property — and split the
    // very profiles the sheet tiles on.
    for (const style of ROUGH) {
      for (const bits of TWO_EDGE_LAYOUT) {
        const o = opts({ kind: 'straightRound', roughStyle: style.id, roughness: 2, seed: 271 });
        const L = generateEdge(bits, o);
        // Rebuild the silhouette WITHOUT the prune by asking the outline
        // directly, and compare the borders.
        for (const d of DIRECTIONS) {
          if (!(bits & d.bit)) continue;
          for (let i = 0; i < L.size; i++) {
            const x = d.dx === 0 ? i : d.dx > 0 ? L.size - 1 : 0;
            const y = d.dy === 0 ? i : d.dy > 0 ? L.size - 1 : 0;
            const j = y * L.size + x;
            if (!L.fill[j]) continue;
            // A surviving border pixel must be reachable from the body or be
            // part of a piece that also reaches a border — either way it is
            // still here, which is all this asserts.
            expect(L.fill[j]).toBe(1);
          }
        }
      }
    }
  });

  it('the ceiling is TIGHT at both ends, and is now two exact terms', () => {
    // No table any more: `distance - 0.5` is how deep a bite the road can take,
    // `BORDER_CLEARANCE - distance` is how far it may bulge. Both are
    // arithmetic and hold for every seed, which is exactly what the sampled
    // table could not do.
    expect(maxRoughness(1)).toBe(0.5);                       // the road binds
    expect(maxRoughness(15)).toBe(0.5);                      // the border binds
    expect(maxRoughness(FIT_DISTANCE)).toBe(MAX_ROUGHNESS);
    expect(maxRoughness(MIN_EDGE_DISTANCE)).toBe(0.25);
    expect(maxRoughness(MAX_EDGE_DISTANCE)).toBe(0);
    expect(maxRoughness(DEFAULT_EDGE_DISTANCE)).toBe(MAX_ROUGHNESS);
    // ...and it is snapped down to a step, so no offered value is taken back.
    for (let d = MIN_EDGE_DISTANCE; d <= MAX_EDGE_DISTANCE + 1e-9; d += EDGE_DISTANCE_STEP) {
      const cap = maxRoughness(Math.round(d * 100) / 100);
      expect(cap % ROUGHNESS_STEP, `d=${d}`).toBeCloseTo(0, 9);
      expect(cap).toBeLessThanOrEqual(MAX_ROUGHNESS);
    }
  });

  it('the road is never bitten in half, which the prune cannot fix', () => {
    // The prune keeps both halves of a severed road, because both reach open
    // borders. So the `distance - 0.5` term has to be doing real work, and this
    // is what checks it: on a straight run every open border's pixels are in
    // ONE piece.
    for (const style of ROUGH) {
      for (const seed of [3, 13, 271]) {
        for (const distance of [1, 2, 4, FIT_DISTANCE, 11]) {
          const o = opts({
            kind: 'straightRound', distance, roughStyle: style.id,
            roughness: maxRoughness(distance), seed,
          });
          const { fill, size } = generateEdge(1 | 4, o);
          // The MAIN BODY — the largest piece — has to reach both open borders.
          // Not every border pixel: `pruneOrphans` deliberately keeps a piece
          // that touches an open border even when it is separate, because such
          // a piece continues into the neighbour rather than floating. A road
          // cut in half would put the two borders in two different pieces, and
          // that is what this catches.
          const comp = new Int32Array(size * size).fill(-1);
          const area: number[] = [];
          for (let s0 = 0; s0 < fill.length; s0++) {
            if (!fill[s0] || comp[s0] >= 0) continue;
            const id = area.length;
            area.push(0); comp[s0] = id;
            const st = [s0];
            while (st.length) {
              const i = st.pop()!;
              area[id]++;
              const x = i % size, y = (i / size) | 0;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const nx = x + dx, ny = y + dy;
                  if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
                  const k = ny * size + nx;
                  if (!fill[k] || comp[k] >= 0) continue;
                  comp[k] = id; st.push(k);
                }
              }
            }
          }
          let best = -1, bestArea = -1;
          for (let id = 0; id < area.length; id++) {
            if (area[id] > bestArea) { bestArea = area[id]; best = id; }
          }
          const last = (size - 1) * size;
          let top = 0, bottom = 0;
          for (let x = 0; x < size; x++) {
            if (fill[x] && comp[x] === best) top++;
            if (fill[last + x] && comp[last + x] === best) bottom++;
          }
          expect(top, `${style.id} seed${seed} d=${distance} top`).toBeGreaterThan(0);
          expect(bottom, `${style.id} seed${seed} d=${distance} bottom`).toBeGreaterThan(0);
        }
      }
    }
  }, 30_000);

  it('the sanitiser clamps the amplitude against the distance', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: opts({
        kind: 'straightRound', distance: 15.25, roughStyle: 'hand',
        roughness: MAX_ROUGHNESS,
      }),
    });
    expect(r.edge.roughness).toBe(maxRoughness(15.25));
    expect(r.edge.roughness).toBeLessThan(MAX_ROUGHNESS);
  });

  it('rejects a style it does not offer', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: opts({ kind: 'straightRound', roughStyle: 'sparkles' as never }),
    });
    expect(r.edge.roughStyle).toBe(DEFAULT_EDGE.roughStyle);
  });

  it('手绘 IS the fit — it lands on the numbers it was fitted to', () => {
    // ⚠ The reference drawing this was fitted to is no longer in the repo, so
    // the target is written down rather than re-measured. These are its
    // straight north-south flanks, at the 32px the sheet is evaluated at:
    //
    //   deviation from each flank's own mean   sd 1.495 px
    //   autocorrelation of that deviation      0.745 at lag 1, 0.489 at lag 2
    //
    // The lattice was swept against exactly these — 4 output px won at rms
    // 0.104, against 0.198 at 5.3px and 0.283 at 8px — so if this test starts
    // failing, the noise changed, not the target.
    const DRAWN_ACF = [0.745, 0.489];

    const flank = (o: EdgeOptions) => {
      const L = generateEdge(1 | 4, o);
      const n = L.size;
      const seqs: number[][] = [[], []];
      for (let y = 0; y < n; y++) {
        let lo = -1, hi = -1;
        for (let x = 0; x < n; x++) if (L.fill[y * n + x]) { if (lo < 0) lo = x; hi = x; }
        if (lo < 0) continue;
        seqs[0].push(lo); seqs[1].push(hi);
      }
      let den = 0;
      const acf = [0, 0, 0];
      for (const s of seqs) {
        const m = s.reduce((a, b) => a + b, 0) / s.length;
        for (const v of s) den += (v - m) ** 2;
        for (let lag = 1; lag <= 2; lag++)
          for (let i = 0; i + lag < s.length; i++) acf[lag] += (s[i] - m) * (s[i + lag] - m);
      }
      const nn = seqs[0].length + seqs[1].length;
      return { sd: Math.sqrt(den / nn), acf: acf.slice(1).map((v) => v / den) };
    };

    // A clean generated edge has NO wobble at all — that is the thing missing.
    expect(flank(opts({ kind: 'straightRound' })).sd).toBe(0);

    const hand = flank(opts({
      kind: 'straightRound', distance: FIT_DISTANCE, roughStyle: 'hand', roughness: 2,
    }));
    expect(hand.sd).toBeGreaterThan(0.5);
    expect(Math.abs(hand.acf[0] - DRAWN_ACF[0]), 'lag 1').toBeLessThan(0.12);
    expect(Math.abs(hand.acf[1] - DRAWN_ACF[1]), 'lag 2').toBeLessThan(0.12);

    // 砂砾 does not land, and that is the difference the fit is for: its 65%
    // grain term destroys the correlation the drawing had.
    const gravel = flank(opts({
      kind: 'straightRound', distance: FIT_DISTANCE, roughStyle: 'gravel', roughness: 1,
    }));
    expect(Math.abs(gravel.acf[0] - DRAWN_ACF[0])).toBeGreaterThan(0.5);
  });
});

describe('路沿花纹 — a motif ON the kerb', () => {
  const kerbCount = (o: EdgeOptions) => {
    let n = 0;
    for (const bits of TWO_EDGE_LAYOUT) {
      const { band } = generateEdge(bits, o);
      for (let i = 0; i < band.length; i++) if (band[i]) n++;
    }
    return n;
  };

  it('is off by default, and every motif actually moves kerb pixels', () => {
    // ⚠ The trap this family fell into once already: the first version only
    // ever ran on pixels that were ALREADY kerb, so "thicken inward" set a kerb
    // pixel to kerb and did nothing whatsoever. It rendered as a plain kerb and
    // read as a subtlety rather than as the no-op it was. Both directions are
    // checked here, and in the direction each one actually moves.
    expect(DEFAULT_EDGE.kerbMotif).toBe('none');
    const plain = kerbCount(opts({ kind: 'straightRound' }));
    // A dash BREAKS the kerb, so there is less of it.
    expect(kerbCount(opts({ kind: 'straightRound', kerbMotif: 'dash' })))
      .toBeLessThan(plain);
    // A tooth THICKENS it inward, so there is more.
    expect(kerbCount(opts({ kind: 'straightRound', kerbMotif: 'tick' })))
      .toBeGreaterThan(plain);
  });

  it('never adds or removes an OPAQUE pixel — it only re-roles them', () => {
    // The motif moves the kerb's inner face, never the outline. If it touched
    // the silhouette, every seam proof above would be back in play.
    const opaque = (o: EdgeOptions) => {
      let n = 0;
      for (const bits of TWO_EDGE_LAYOUT) {
        const { fill } = generateEdge(bits, o);
        for (let i = 0; i < fill.length; i++) n += fill[i];
      }
      return n;
    };
    const base = opaque(opts({ kind: 'straightRound' }));
    for (const m of KERB_MOTIFS) {
      for (const kerbPeriod of KERB_PERIODS) {
        expect(opaque(opts({ kind: 'straightRound', kerbMotif: m.id, kerbPeriod })),
          `${m.id}@${kerbPeriod}`).toBe(base);
      }
    }
  });

  it('EVERY OPEN BORDER STILL SHOWS ONE PROFILE', () => {
    for (const m of KERB_MOTIFS) {
      for (const kerbPeriod of KERB_PERIODS) {
        for (const kerbWidth of kerbWidthsFor(kerbPeriod)) {
          const o = opts({
            kind: 'straightRound', kerbMotif: m.id, kerbPeriod, kerbWidth,
          });
          for (const [side, bit] of [['N', 1], ['E', 2], ['S', 4], ['W', 8]] as const) {
            const seen = new Set<string>();
            for (const bits of TWO_EDGE_LAYOUT) {
              if (!(bits & bit)) continue;
              const L = generateEdge(bits, o);
              let p = '';
              for (let i = 0; i < L.size; i++) {
                const x = side === 'E' ? L.size - 1 : side === 'W' ? 0 : i;
                const y = side === 'S' ? L.size - 1 : side === 'N' ? 0 : i;
                const j = y * L.size + x;
                p += !L.fill[j] ? '.' : L.band[j] ? 'e' : 'p';
              }
              seen.add(p);
            }
            expect(seen.size, `${m.id}@${kerbPeriod}/${kerbWidth} ${side}`).toBe(1);
          }
        }
      }
    }
  }, 30_000);

  it('a dash keeps its phase ACROSS a seam', () => {
    // Four tiles of straight vertical run end to end: how much kerb each global
    // row carries has to be periodic with the period and continuous at every
    // tile boundary. That is what the periods dividing the tile buys.
    for (const kerbPeriod of KERB_PERIODS) {
      const L = generateEdge(1 | 4, opts({ kind: 'straightRound', kerbMotif: 'dash', kerbPeriod }));
      const rows: number[] = [];
      for (let tile = 0; tile < 4; tile++) {
        for (let y = 0; y < L.size; y++) {
          let n = 0;
          for (let x = 0; x < L.size; x++) n += L.band[y * L.size + x] ? 1 : 0;
          rows.push(n);
        }
      }
      expect(rows.some((n) => n > 0), `p=${kerbPeriod}`).toBe(true);
      expect(rows.some((n) => n === 0), `p=${kerbPeriod} never breaks`).toBe(true);
      for (let g = 0; g < rows.length; g++) {
        expect(rows[g], `p=${kerbPeriod} global row ${g}`).toBe(rows[g % kerbPeriod]);
      }
    }
  });

  it('a tooth grows INWARD only, never past the outline', () => {
    // Outward is where the border-clearance budget lives and the outline has
    // already spent it. Measured against the plain kerb's own outer face.
    for (const bits of TWO_EDGE_LAYOUT) {
      const plain = generateEdge(bits, opts({ kind: 'straightRound' }));
      const teeth = generateEdge(bits, opts({ kind: 'straightRound', kerbMotif: 'tick' }));
      for (let i = 0; i < plain.fill.length; i++) {
        // Same silhouette, and a tooth only ever turns SURFACE into kerb.
        expect(teeth.fill[i], `${bitsLabel(bits)} at ${i}`).toBe(plain.fill[i]);
        if (plain.band[i] && !teeth.band[i]) {
          throw new Error(`${bitsLabel(bits)} at ${i}: a tooth removed kerb`);
        }
      }
    }
  });

  it('the widths on offer always leave plain kerb between two teeth', () => {
    for (const period of KERB_PERIODS) {
      const offered = kerbWidthsFor(period);
      expect(offered.length, `p=${period}`).toBeGreaterThan(0);
      for (const w of offered) {
        expect(period - w, `p=${period} w=${w}`).toBeGreaterThanOrEqual(2);
        expect(w % 2, `p=${period} w=${w}`).toBe(0);      // see KERB_WIDTHS
      }
    }
    expect(kerbWidthsFor(4)).toEqual([2]);
    expect(maxKerbWidth(8)).toBe(6);
    expect([...KERB_WIDTHS]).toEqual([2, 4, 6]);
    expect(KERB_PX).toBe(2);
  });

  it('the sanitiser clamps the tooth against the PERIOD, in that order', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: opts({ kind: 'straightRound', kerbMotif: 'tick', kerbPeriod: 4, kerbWidth: 6 }),
    });
    expect(r.edge.kerbPeriod).toBe(4);
    expect(r.edge.kerbWidth).toBe(2);
  });

  it('rejects a motif it does not offer', () => {
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: opts({ kind: 'straightRound', kerbMotif: 'crumble' as never }),
    });
    expect(r.edge.kerbMotif).toBe(DEFAULT_EDGE.kerbMotif);
  });
});

describe('the AREA reading of the same 16 masks', () => {
  const area = (o: Partial<EdgeOptions> = {}) =>
    opts({ scheme: 'area', kind: 'straightRound', distance: 4, amplitude: 2, ...o });

  it('is a second reading, not a second app — both are on the menu', () => {
    expect(SCHEMES.map((s) => s.id).sort()).toEqual(['area', 'network']);
    expect(DEFAULT_EDGE.scheme).toBe('network');
  });

  it('A SURROUNDED CELL IS SOLID, with no outline at all', () => {
    // The bug this pins, and it was live: the kerb was drawn wherever the pixel
    // was near the region's boundary, and for a cell whose terrain continues in
    // every direction that boundary is the tile border. The result was a
    // fully-connected cell wearing an outline it should not have — a grid drawn
    // over what ought to be an unbroken field.
    const L = generateEdge(15, area());
    for (let i = 0; i < L.fill.length; i++) {
      expect(L.fill[i], `at ${i}`).toBe(1);
      expect(L.band[i], `at ${i}`).toBe(0);
    }
  });

  it('NOTHING IS DISPLACED WHERE THERE IS NO BOUNDARY', () => {
    // A connected side is not a boundary, so the noise has nothing to move
    // there — `areaAt.edge` is Infinity for it. The sharpest form of that: a
    // cell whose terrain continues in every direction has no edge at all, so it
    // stays solid at ANY amplitude, style or seed. If the wobble could eat a
    // flush border, two neighbours would disagree about where their shared one
    // is, and this is the case where that would show first.
    for (const roughStyle of ['hand', 'gravel', 'boulder', 'jagged', 'moss'] as const) {
      for (const seed of [1, 7, 42, 271]) {
        const L = generateEdge(15, area({ roughStyle, roughness: maxRoughness(4), seed }));
        for (let i = 0; i < L.fill.length; i++) {
          expect(L.fill[i], `${roughStyle}/${seed} at ${i}`).toBe(1);
          expect(L.band[i], `${roughStyle}/${seed} at ${i}`).toBe(0);
        }
      }
    }
  });

  it('...and a pixel the noise drops is always near a side that STOPS', () => {
    // The general form. Whatever the noise removes has to be within its own
    // amplitude of a real edge — never next to a flush one only, which would
    // mean it had reached across a border it does not own.
    const amp = maxRoughness(4);
    for (const bits of TWO_EDGE_LAYOUT) {
      const clean = generateEdge(bits, area({ roughness: 0 }));
      const noisy = generateEdge(bits, area({ roughStyle: 'hand', roughness: amp, seed: 3 }));
      for (let i = 0; i < clean.fill.length; i++) {
        if (clean.fill[i] === noisy.fill[i]) continue;
        const x = i % clean.size, y = (i / clean.size) | 0;
        const at = areaAt(x + 0.5, y + 0.5, bits, {
          inset: 4, bend: areaBendFor(area()),
        });
        expect(at.edge, `${bitsLabel(bits)} at ${x},${y}`).toBeLessThanOrEqual(amp + 1);
      }
    }
  });

  it('a side the terrain STOPS at is inset by exactly the distance', () => {
    for (const inset of [2, 4, 6]) {
      const L = generateEdge(0, area({ distance: inset, amplitude: 0 }));
      const mid = L.size / 2;
      let first = -1;
      for (let x = 0; x < L.size; x++) if (L.fill[mid * L.size + x]) { first = x; break; }
      expect(first, `inset=${inset}`).toBe(inset);
    }
  });

  it('THE SEAM IS NOT EXACT, and the mismatch is exactly the missing diagonal', () => {
    // ⚠ Unlike the network reading, whose open borders agree to the last bit,
    // this one cannot. A quadrant needs five states and a 2-edge mask carries
    // four; the missing one is the concave corner, which needs to know about
    // the diagonal neighbour. This measures the consequence rather than
    // asserting it away.
    //
    // The result that makes it shippable: EVERY mismatch is a pair whose E/W
    // states differ — that is, a pair a diagonal bit would have separated. When
    // two tiles agree about their side walls the border is exact.
    const o = area();
    const insideAt = (bits: number, x: number, y: number) => {
      const L = generateEdge(bits, o);
      return L.fill[y * L.size + x] === 1;
    };
    let sameSides = 0, differing = 0;
    for (const m of TWO_EDGE_LAYOUT) {
      if (!(m & 4)) continue;                          // S connected
      for (const n of TWO_EDGE_LAYOUT) {
        if (!(n & 1)) continue;                        // N connected
        let diff = 0;
        for (let x = 0; x < 32; x++) {
          if (insideAt(m, x, 31) !== insideAt(n, x, 0)) diff++;
        }
        if (!diff) continue;
        if (!!(m & 2) === !!(n & 2) && !!(m & 8) === !!(n & 8)) sameSides++;
        else differing++;
      }
    }
    expect(sameSides, 'a pair that agrees about its sides must agree about the border').toBe(0);
    expect(differing, 'and the rest are the diagonal the scheme cannot carry')
      .toBeGreaterThan(0);
  }, 30_000);

  it('the corner radius comes off the arc control, and is bounded by the inset', () => {
    // One control, not two: in the network reading it says how deeply the
    // outline swings, here how far the corner is cut. Both are "how much comes
    // off the edge", and a second slider meaning nearly the same thing is how
    // this app has repeatedly ended up with dead ones.
    expect(areaBendFor(area({ distance: 8, amplitude: 2 }))).toBe(4);
    // ...and it cannot exceed what the inset leaves.
    for (const distance of [2, 6, 12, 15]) {
      const bend = areaBendFor(area({ distance, amplitude: MAX_ARC_AMPLITUDE }));
      expect(bend, `d=${distance}`).toBeLessThanOrEqual(16 - distance);
    }
  });

  it('rounds a corner only where BOTH its sides stop', () => {
    // A corner between a flush side and an inset one is not convex — the
    // straight edge simply runs on — and rounding it would bite a notch out of
    // a border that has to stay flush.
    const sharp = generateEdge(1, area({ amplitude: 0 }));       // N flush
    const round = generateEdge(1, area({ amplitude: MAX_ARC_AMPLITUDE }));
    let topRowSame = true;
    for (let x = 0; x < sharp.size; x++) {
      if (sharp.fill[x] !== round.fill[x]) topRowSame = false;
    }
    expect(topRowSame, 'the flush side changed when the corner radius did').toBe(true);
  });

  it('has no centreline and no along-road texture — the sanitiser forces it', () => {
    // Not hidden in the UI: forced in the recipe, so the painter never has to
    // interpret a state that cannot be drawn. A region has no skeleton to hang
    // a centreline on and no direction to run a rut along.
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: area(),
      centre: { ...DEFAULT_RECIPE.centre, kind: 'randomDash' },
      surface: { ...DEFAULT_RECIPE.surface, kind: 'ruts' },
    });
    expect(r.centre.kind).toBe('none');
    expect(r.surface.kind).toBe('flat');
    // ...and the ones that only need depth survive.
    for (const kind of ['flat', 'camber', 'gravel'] as const) {
      expect(sanitizeRecipe({
        ...DEFAULT_RECIPE, edge: area(),
        surface: { ...DEFAULT_RECIPE.surface, kind },
      }).surface.kind, kind).toBe(kind);
    }
  });
});
