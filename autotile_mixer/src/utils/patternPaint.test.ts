import { describe, it, expect } from 'vitest';
import { BLOB47_MASKS, BLOB47_LAYOUT, BLOB47_COLS, BLOB47_ROWS } from './blob47';
import {
  PATTERN_TILE_SIZE, patternLevelsForMask, patternFieldForMask, PATTERN_BACKGROUND,
  PATTERNS, PATTERN_GROUPS, DEFAULT_PATTERN, PATTERN_BANDS, PATTERN_OFFSET_RANGE,
  FIELD_STEP, FIELD_CHARS, clampOffset, bandsFor, bandNoiseSpan, patternLevelsFor,
  MIN_BAND_STEPS, MAX_BAND_STEPS, DEFAULT_BAND_STEPS,
  RESEEDABLE_PATTERNS, edgeJitterAmplitude, LEVEL_CACHE_MAX, levelCacheSize, type PatternId,
} from './blob47Pattern';
import {
  REFERENCE_ROLE_COLOURS,
  paintPatternTileRGBA,
  patternRamp,
  shadeColour,
  toHexColour,
  type RGB,
} from './patternPaint';

// The pattern is art, so these tests are a lock, not a specification: they fail
// when the baked grids or the shade recipes drift, which would silently change
// every tileset the app emits.

const ALL_PATTERNS = PATTERNS.map((p) => p.id);

/** Border pixel indices of a tileSize grid, keyed by the mask bit for that edge. */
const edgeIndices = (ts: number): [number, number[]][] => [
  [1, [...Array(ts).keys()]],
  [4, [...Array(ts).keys()].map((i) => ts * (ts - 1) + i)],
  [8, [...Array(ts).keys()].map((i) => i * ts)],
  [2, [...Array(ts).keys()].map((i) => i * ts + ts - 1)],
];

describe('blob47 built-in patterns', () => {
  it('offers a non-empty menu whose default is present', () => {
    expect(ALL_PATTERNS.length).toBeGreaterThan(1);
    expect(new Set(ALL_PATTERNS).size).toBe(ALL_PATTERNS.length);
    expect(ALL_PATTERNS).toContain(DEFAULT_PATTERN);
  });

  it('keeps the grouped menu and the flat list in step', () => {
    // The <select> renders groups; everything else iterates the flat list, so a
    // pattern dropped from one and not the other would silently go missing.
    const grouped = PATTERN_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(grouped).toEqual(ALL_PATTERNS);
    for (const g of PATTERN_GROUPS) expect(g.items.length).toBeGreaterThan(0);
  });

  it.each(ALL_PATTERNS)('%s has art for every canonical mask, 16x16, levels 0..4', (id) => {
    expect(BLOB47_MASKS).toHaveLength(47);
    for (const mask of BLOB47_MASKS) {
      const grid = patternLevelsForMask(id, mask);
      expect(grid).toHaveLength(PATTERN_TILE_SIZE * PATTERN_TILE_SIZE);
      expect(grid).toMatch(/^[0-4]+$/);
    }
  });

  it.each(ALL_PATTERNS)('%s paints the background as unshaded terrain B', (id) => {
    expect(patternLevelsForMask(id, -1)).toBe(PATTERN_BACKGROUND);
  });

  it.each(ALL_PATTERNS)('%s makes the solid-interior mask entirely terrain A', (id) => {
    // Every neighbour is terrain A, so nothing in the tile may be boundary.
    expect(patternLevelsForMask(id, 255)).toBe('4'.repeat(256));
  });

  it('gives every pattern a distinct silhouette', () => {
    const fingerprints = ALL_PATTERNS.map((id) =>
      BLOB47_MASKS.map((m) => patternLevelsForMask(id, m)).join('')
    );
    expect(new Set(fingerprints).size).toBe(ALL_PATTERNS.length);
  });

  it('rejects a non-canonical mask rather than painting nonsense', () => {
    // 16 is NE with neither adjacent edge — callers must canonicalize first.
    expect(() => patternLevelsForMask(DEFAULT_PATTERN, 16)).toThrow(/no art/);
  });

  it.each(ALL_PATTERNS)('%s stores a well-formed 16x16 field', (id) => {
    for (const mask of BLOB47_MASKS) {
      const f = patternFieldForMask(id, mask);
      expect(f).toHaveLength(PATTERN_TILE_SIZE * PATTERN_TILE_SIZE);
      for (const ch of f) expect(FIELD_CHARS).toContain(ch);
    }
  });

  it.each(ALL_PATTERNS)('%s has bands on the quantisation grid', (id) => {
    // Floor-quantising the field only preserves comparisons if no band falls
    // between two representable distances.
    for (const b of PATTERN_BANDS[id]) {
      expect(Math.abs(b / FIELD_STEP - Math.round(b / FIELD_STEP))).toBeLessThan(1e-9);
    }
    const [lo, hi] = PATTERN_OFFSET_RANGE[id];
    expect(lo).toBeLessThanOrEqual(0);
    expect(hi).toBeGreaterThan(0);
  });
});

describe('sliding the transition band', () => {
  it.each(ALL_PATTERNS)('%s is unchanged at offset 0', (id) => {
    for (const mask of BLOB47_MASKS) {
      expect(patternLevelsForMask(id, mask, 0)).toBe(patternLevelsForMask(id, mask));
    }
  });

  it.each(ALL_PATTERNS)('%s grows terrain A toward the border, shrinks it toward the centre', (id) => {
    const [lo, hi] = PATTERN_OFFSET_RANGE[id];
    const count4 = (o: number) =>
      BLOB47_MASKS.reduce((n, m) => n + [...patternLevelsForMask(id, m, o)]
        .filter((c) => c === '4').length, 0);
    if (hi > 0) expect(count4(hi)).toBeGreaterThan(count4(0));
    if (lo < 0) expect(count4(lo)).toBeLessThan(count4(0));
  });

  it.each(ALL_PATTERNS)('%s keeps the boundary off the cell border at max offset', (id) => {
    // The reason the positive end is bounded: past it the band butts against
    // the neighbouring tile and reads as a straight clipped line.
    const [, hi] = PATTERN_OFFSET_RANGE[id];
    const TS = PATTERN_TILE_SIZE;
    for (const mask of BLOB47_MASKS) {
      const g = patternLevelsForMask(id, mask, hi);
      const edges: [number, number[]][] = [
        [1, [...Array(TS).keys()]],
        [4, [...Array(TS).keys()].map((i) => TS * (TS - 1) + i)],
        [8, [...Array(TS).keys()].map((i) => i * TS)],
        [2, [...Array(TS).keys()].map((i) => i * TS + TS - 1)],
      ];
      for (const [bit, idx] of edges) {
        if (mask & bit) continue;
        for (const i of idx) expect(g[i]).toBe('0');
      }
    }
  });

  it.each(ALL_PATTERNS)('%s still renders something at the most negative offset', (id) => {
    // The reason the negative end is bounded: past it the smallest island is
    // eaten and a painted cell would render as empty terrain B.
    const [lo] = PATTERN_OFFSET_RANGE[id];
    const visible = [...patternLevelsForMask(id, 0, lo)].filter((c) => c !== '0').length;
    expect(visible).toBeGreaterThan(0);
  });

  it('clamps an out-of-range offset instead of distorting the tile', () => {
    const [lo, hi] = PATTERN_OFFSET_RANGE[DEFAULT_PATTERN];
    expect(clampOffset(DEFAULT_PATTERN, 99)).toBe(hi);
    expect(clampOffset(DEFAULT_PATTERN, -99)).toBe(lo);
    expect(patternLevelsForMask(DEFAULT_PATTERN, 110, 99))
      .toBe(patternLevelsForMask(DEFAULT_PATTERN, 110, hi));
  });
});

describe('shading from one colour per role', () => {
  it('derives the shades the recipes were tuned for', () => {
    // A drifting recipe changes every pattern at once, so pin the two outputs
    // the reference palette must produce.
    expect(toHexColour(shadeColour(REFERENCE_ROLE_COLOURS.terrainB, 'terrainB'))).toBe('#88c020');
    expect(toHexColour(shadeColour(REFERENCE_ROLE_COLOURS.terrainA, 'terrainA'))).toBe('#d8f0f8');
  });

  it('keeps a saturated terrain its own colour', () => {
    // Regression: the terrainA recipe's hue was solved against a white base, so
    // it is an *absolute* cool tint. Adding it to a coloured base rotated the
    // hue ~195 degrees and turned deep blue water into magenta.
    const water = { r: 0x00, g: 0x18, b: 0xa0 };
    const hueOf = (c: { r: number; g: number; b: number }) => {
      const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
      if (mx === mn) return 0;
      const d = mx - mn;
      const h = c.r === mx ? (c.g - c.b) / d : c.g === mx ? 2 + (c.b - c.r) / d : 4 + (c.r - c.g) / d;
      return ((h * 60) % 360 + 360) % 360;
    };
    for (const t of [0.25, 0.5, 1]) {
      const shaded = shadeColour(water, 'terrainA', t);
      const drift = Math.abs(hueOf(shaded) - hueOf(water));
      expect(Math.min(drift, 360 - drift)).toBeLessThan(20);
      expect(shaded.b).toBeGreaterThan(shaded.r); // still reads as blue
    }
  });

  it('tints an achromatic terrain instead of only darkening it', () => {
    // White has no hue to shift; the recipe supplies an absolute one. Without
    // that branch the rim would come out grey and the outline would read flat.
    const tint = shadeColour({ r: 255, g: 255, b: 255 }, 'terrainA');
    expect(tint.b).toBeGreaterThan(tint.r);
  });

  it('gives the five levels the expected reference palette', () => {
    expect(patternRamp(REFERENCE_ROLE_COLOURS).map(toHexColour)).toEqual([
      '#b0d848', '#88c020', '#afc6ff', '#d8f0f8', '#f8f8f8',
    ]);
  });
});

/** FNV-1a over the whole 128x96 sheet, laid out in BLOB47_LAYOUT order at 16px
 *  with the reference colours — the same quantity as hashing the exported PNG. */
function sheetHash(id: PatternId): number {
  const ts = PATTERN_TILE_SIZE;
  const w = BLOB47_COLS * ts;
  const h = BLOB47_ROWS * ts;
  const sheet = new Uint8ClampedArray(w * h * 4);
  BLOB47_LAYOUT.forEach((mask, slot) => {
    const px = paintPatternTileRGBA(id, mask, REFERENCE_ROLE_COLOURS, ts);
    const ox = (slot % BLOB47_COLS) * ts;
    const oy = Math.floor(slot / BLOB47_COLS) * ts;
    for (let y = 0; y < ts; y++) {
      for (let x = 0; x < ts; x++) {
        const src = (y * ts + x) * 4;
        sheet.set(px.subarray(src, src + 4), ((oy + y) * w + ox + x) * 4);
      }
    }
  });
  let hash = 0x811c9dc5;
  for (const byte of sheet) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash >>> 0;
}

describe('transition-band steps', () => {
  const COUNTS = [MIN_BAND_STEPS, 4, MAX_BAND_STEPS];

  it('adds one colour per step', () => {
    for (const n of COUNTS) {
      // levels = the band's colours plus the two solid terrains
      expect(patternLevelsFor(n)).toHaveLength(n + 2);
      expect(patternRamp(REFERENCE_ROLE_COLOURS, n)).toHaveLength(n + 2);
    }
  });

  it.each(ALL_PATTERNS)('%s is untouched at the default step count', (id) => {
    // The whole feature has to be inert until the slider is moved.
    for (const mask of BLOB47_MASKS) {
      expect(patternLevelsForMask(id, mask, 0, 16, DEFAULT_BAND_STEPS))
        .toBe(patternLevelsForMask(id, mask));
    }
  });

  it.each(ALL_PATTERNS)('%s keeps the band outer edge fixed as steps are added', (id) => {
    // This is why the offset range does not need re-measuring per count: the
    // first threshold, which both offset limits are derived from, never moves.
    for (const n of COUNTS) expect(bandsFor(id, n)[0]).toBe(bandsFor(id, MIN_BAND_STEPS)[0]);
  });

  it.each(ALL_PATTERNS)('%s grows only into terrain A', (id) => {
    for (const n of COUNTS) {
      const b = bandsFor(id, n);
      expect(b).toHaveLength(n + 1);
      // ascending, and every added threshold sits deeper than the last stored one
      for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThanOrEqual(b[i - 1]);
      expect(b.slice(0, 4)).toEqual([...PATTERN_BANDS[id]]);
    }
  });

  it('fades the added shades back toward clean terrain', () => {
    const levels = patternLevelsFor(MAX_BAND_STEPS);
    const inner = levels.filter((l) => l.role === 'terrainA');
    // strongest shade beside the outline, then weaker, ending on the raw colour
    expect(inner.map((l) => l.shade)).toEqual([1, 2 / 3, 1 / 3, 0]);
    for (let i = 1; i < inner.length; i++) {
      expect(inner[i].shade).toBeLessThan(inner[i - 1].shade);
    }
  });

  it('scales the shade recipe rather than switching it on and off', () => {
    const base = REFERENCE_ROLE_COLOURS.terrainB;
    const full = shadeColour(base, 'terrainB', 1);
    const half = shadeColour(base, 'terrainB', 0.5);
    expect(toHexColour(full)).toBe('#88c020');           // unchanged at t=1
    expect(toHexColour(shadeColour(base, 'terrainB'))).toBe(toHexColour(full));
    expect(toHexColour(shadeColour(base, 'terrainB', 0))).toBe(toHexColour(base));
    // half-shade sits between the two, not at either end
    expect(half.g).toBeGreaterThan(full.g);
    expect(half.g).toBeLessThan(base.g);
  });

  it.each(ALL_PATTERNS)('%s renders strictly more colours as steps are added', (id) => {
    // The honest property: moving the slider must do something for every
    // pattern. Not that all declared levels render — `sharp` has zero-width
    // shade bands by design and skips two of them (see below).
    const distinct = (n: number) => {
      const seen = new Set<string>();
      for (const mask of BLOB47_MASKS) {
        for (const ch of patternLevelsForMask(id, mask, 0, 32, n)) seen.add(ch);
      }
      return seen.size;
    };
    expect(distinct(4)).toBeGreaterThan(distinct(MIN_BAND_STEPS));
    expect(distinct(MAX_BAND_STEPS)).toBeGreaterThan(distinct(4));
  });

  it.each(ALL_PATTERNS)('%s scales the grain span with the band', (id) => {
    // Coverage grows on its own — a wider band holds more pixels. The span is
    // what stops the fixed one-level nudge from shrinking into invisibility
    // against the finer shades a wider band is sliced into.
    expect(bandNoiseSpan(id, MIN_BAND_STEPS)).toBe(1);
    expect(bandNoiseSpan(id, MAX_BAND_STEPS)).toBeGreaterThan(1);
    for (const n of COUNTS) expect(bandNoiseSpan(id, n)).toBeLessThanOrEqual(2);
  });

  it.each(ALL_PATTERNS)('%s grain reaches further at 5 steps than at 3', (id) => {
    const reach = (n: number) => {
      const clean = paintPatternTileRGBA(id, 110, REFERENCE_ROLE_COLOURS, 32, [], 0, 0, 1, n);
      const noisy = paintPatternTileRGBA(id, 110, REFERENCE_ROLE_COLOURS, 32, ['blue'], 0, 0, 1, n);
      let worst = 0;
      for (let i = 0; i < clean.length; i += 4) {
        const d = Math.max(Math.abs(clean[i] - noisy[i]),
                           Math.abs(clean[i + 1] - noisy[i + 1]),
                           Math.abs(clean[i + 2] - noisy[i + 2]));
        if (d > worst) worst = d;
      }
      return worst;
    };
    expect(reach(MAX_BAND_STEPS)).toBeGreaterThan(0);
    expect(reach(MIN_BAND_STEPS)).toBeGreaterThan(0);
  });

  it.each(ALL_PATTERNS)('%s grain never escapes the ramp, whatever the span', (id) => {
    const allowed = new Set(patternRamp(REFERENCE_ROLE_COLOURS, MAX_BAND_STEPS).map(toHexColour));
    for (const mask of [0, 31, 110, 255]) {
      const px = paintPatternTileRGBA(
        id, mask, REFERENCE_ROLE_COLOURS, 16, ['blue', 'white', 'clumped', 'ordered'],
        0, 0, 2, MAX_BAND_STEPS);
      for (let i = 0; i < px.length; i += 4) {
        expect(allowed).toContain(toHexColour({ r: px[i], g: px[i + 1], b: px[i + 2] }));
      }
    }
  });

  it.each(ALL_PATTERNS)('%s hard B edge collapses that shade and nothing else', (id) => {
    for (const n of COUNTS) {
      const soft = bandsFor(id, n);
      const hard = bandsFor(id, n, true);
      expect(hard).toHaveLength(soft.length);
      expect(hard[0]).toBe(soft[0]);        // outer edge fixed -> offsets stay valid
      expect(hard[1]).toBe(hard[0]);        // no terrain-B shade left
      // every other band keeps its width, just sits one shade closer out
      for (let i = 2; i < soft.length; i++) {
        expect(hard[i] - hard[i - 1]).toBeCloseTo(soft[i] - soft[i - 1], 9);
      }
    }
  });

  it.each(ALL_PATTERNS)('%s stops rendering the terrain-B shade when hard', (id) => {
    let softSeen = 0;
    let hardSeen = 0;
    for (const mask of BLOB47_MASKS) {
      for (const ch of patternLevelsForMask(id, mask, 0, 32, 4, false)) if (ch === '1') softSeen++;
      for (const ch of patternLevelsForMask(id, mask, 0, 32, 4, true)) if (ch === '1') hardSeen++;
    }
    expect(hardSeen).toBe(0);
    if (bandsFor(id, 4)[1] > bandsFor(id, 4)[0]) expect(softSeen).toBeGreaterThan(0);
  });

  it('hard B edge on sharp collapses the B shade', () => {
    const soft = bandsFor('sharp', 4);
    const hard = bandsFor('sharp', 4, true);
    expect(hard[1]).toBe(hard[0]);
    expect(hard[2] - hard[1]).toBeCloseTo(soft[2] - soft[1], 9);
  });

  it.each(ALL_PATTERNS)('%s hard B edge still keeps the boundary off the border', (id) => {
    const [, hi] = PATTERN_OFFSET_RANGE[id];
    for (const mask of BLOB47_MASKS) {
      const g = patternLevelsForMask(id, mask, hi, 16, MAX_BAND_STEPS, true);
      const edges: [number, number[]][] = [
        [1, [...Array(16).keys()]],
        [4, [...Array(16).keys()].map((i) => 16 * 15 + i)],
        [8, [...Array(16).keys()].map((i) => i * 16)],
        [2, [...Array(16).keys()].map((i) => i * 16 + 15)],
      ];
      for (const [bit, idx] of edges) {
        if (mask & bit) continue;
        for (const i of idx) expect(g[i]).toBe('0');
      }
    }
  });

  it('sharp has full shade bands matching rounded', () => {
    const b = PATTERN_BANDS.sharp;
    expect(b[1] - b[0]).toBe(1);
    expect(b[3] - b[2]).toBe(1);
    const five = bandsFor('sharp', MAX_BAND_STEPS);
    expect(five[5]).toBeGreaterThan(five[4]);
  });

  it.each(ALL_PATTERNS)('%s still keeps the boundary off the cell border at 5 steps', (id) => {
    const [, hi] = PATTERN_OFFSET_RANGE[id];
    for (const mask of BLOB47_MASKS) {
      const g = patternLevelsForMask(id, mask, hi, 16, MAX_BAND_STEPS);
      const edges: [number, number[]][] = [
        [1, [...Array(16).keys()]],
        [4, [...Array(16).keys()].map((i) => 16 * 15 + i)],
        [8, [...Array(16).keys()].map((i) => i * 16)],
        [2, [...Array(16).keys()].map((i) => i * 16 + 15)],
      ];
      for (const [bit, idx] of edges) {
        if (mask & bit) continue;
        for (const i of idx) expect(g[i]).toBe('0');
      }
    }
  });
});

describe('resolution', () => {
  const TS = PATTERN_TILE_SIZE;

  it.each(ALL_PATTERNS)('%s at 16px is exactly the stored field thresholded', (id) => {
    // Bilinear sampling must degenerate to a plain lookup here, or every
    // pattern would drift the moment the resampling path was introduced.
    for (const mask of BLOB47_MASKS) {
      const grid = patternLevelsForMask(id, mask, 0, TS);
      const field = patternFieldForMask(id, mask);
      const [b0, b1, b2, b3] = PATTERN_BANDS[id];
      let expected = '';
      for (let i = 0; i < field.length; i++) {
        const d = FIELD_CHARS.indexOf(field[i]) * FIELD_STEP;
        expected += d >= b3 ? '4' : d >= b2 ? '3' : d >= b1 ? '2' : d >= b0 ? '1' : '0';
      }
      expect(grid).toBe(expected);
    }
  });

  it.each(ALL_PATTERNS)('%s at 32px resolves detail a 2x upscale cannot', (id) => {
    // A nearest-neighbour blow-up would make every 2x2 output block uniform.
    // Thresholding the resampled field must break at least some of them, or
    // the extra resolution is buying nothing.
    let mixedBlocks = 0;
    for (const mask of BLOB47_MASKS) {
      const g = patternLevelsForMask(id, mask, 0, 32);
      for (let y = 0; y < 32; y += 2) {
        for (let x = 0; x < 32; x += 2) {
          const q = [g[y * 32 + x], g[y * 32 + x + 1], g[(y + 1) * 32 + x], g[(y + 1) * 32 + x + 1]];
          if (new Set(q).size > 1) mixedBlocks++;
        }
      }
    }
    expect(mixedBlocks).toBeGreaterThan(100);
  });

  it.each(ALL_PATTERNS)('%s keeps the boundary off the cell border at 32px too', (id) => {
    // The inset invariant has to survive resampling, including the clamped
    // half-pixel the interpolation reads past each edge.
    const [, hi] = PATTERN_OFFSET_RANGE[id];
    for (const mask of BLOB47_MASKS) {
      const g = patternLevelsForMask(id, mask, hi, 32);
      const edges: [number, number[]][] = [
        [1, [...Array(32).keys()]],
        [4, [...Array(32).keys()].map((i) => 32 * 31 + i)],
        [8, [...Array(32).keys()].map((i) => i * 32)],
        [2, [...Array(32).keys()].map((i) => i * 32 + 31)],
      ];
      for (const [bit, idx] of edges) {
        if (mask & bit) continue;
        for (const i of idx) expect(g[i]).toBe('0');
      }
    }
  });

  it('scales the band with the tile, so the art reads the same size', () => {
    // An outline 1px wide at 16 should be 2px wide at 32, not still 1px.
    const width = (ts: number) =>
      [...patternLevelsForMask('rounded', 110, 0, ts)].filter((c) => c === '2').length / ts;
    expect(width(32)).toBeGreaterThan(width(16) * 1.6);
  });

  it('adjusts outline width when outlineWidth parameter is provided', () => {
    const ts = 16;
    const countOutline = (w: number) =>
      [...patternLevelsForMask('rounded', 110, 0, ts, 3, false, 0, w)].filter((c) => c === '2').length;
    expect(countOutline(2.0)).toBeGreaterThan(countOutline(1.0));
  });

  it('paints RGBA at whatever size was asked for', () => {
    for (const ts of [16, 32]) {
      const px = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, ts);
      expect(px).toHaveLength(ts * ts * 4);
    }
  });
});

describe('painting', () => {
  it('emits opaque RGBA at the requested size', () => {
    const px = paintPatternTileRGBA(DEFAULT_PATTERN, 255, REFERENCE_ROLE_COLOURS, 32);
    expect(px).toHaveLength(32 * 32 * 4);
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
  });

  // Locks art, shade recipes, sheet layout and rounding in one number each.
  // Regenerate with the baker if a pattern is deliberately redesigned.
  const LOCKS = [
    ['square', 0xfc5eefe5],
    ['rounded', 0xee2a3175],
    ['sharp', 2866591765],
    ['jagged', 0xa4c760e7],
    ['gravel', 0x0e0e4c37],
    ['boulder', 0xae807907],
    ['thorn', 0x21fad4c7],
    ['coast', 0x876b3175],
    ['moss', 0x487fe7b7],
    ['billow', 0x765dd967],
  ] as const;

  it.each(LOCKS)('%s sheet is byte-stable', (id, expected) => {
    expect(sheetHash(id)).toBe(expected);
  });

  it('locks every pattern in the menu', () => {
    // Guards against adding a pattern without adding its lock above.
    expect([...ALL_PATTERNS].sort()).toEqual([...LOCKS.map(([id]) => id)].sort());
  });
});

describe('re-rolling an irregular edge', () => {
  const RESEEDABLE = ALL_PATTERNS.filter((id) => RESEEDABLE_PATTERNS.has(id));
  const CLEAN = ALL_PATTERNS.filter((id) => !RESEEDABLE_PATTERNS.has(id));
  const SEEDS = [1, 2, 7, 42, 1234, 99999];

  it('only offers a re-roll on patterns baked from a noisy field', () => {
    expect(RESEEDABLE.length).toBeGreaterThan(0);
    expect(CLEAN.sort()).toEqual(['square', 'rounded', 'sharp'].sort());
    for (const id of CLEAN) expect(edgeJitterAmplitude(id)).toBe(0);
    for (const id of RESEEDABLE) expect(edgeJitterAmplitude(id)).toBeGreaterThan(0);
  });

  it.each(ALL_PATTERNS)('%s is untouched at seed 0', (id) => {
    // The whole feature has to be inert until the dice is clicked.
    for (const mask of BLOB47_MASKS) {
      expect(patternLevelsForMask(id, mask, 0, 16, DEFAULT_BAND_STEPS, false, 0))
        .toBe(patternLevelsForMask(id, mask));
    }
  });

  it.each(CLEAN)('%s ignores the seed entirely', (id) => {
    for (const seed of SEEDS) {
      for (const mask of BLOB47_MASKS) {
        expect(patternLevelsForMask(id, mask, 0, 16, DEFAULT_BAND_STEPS, false, seed))
          .toBe(patternLevelsForMask(id, mask));
      }
    }
  });

  it.each(RESEEDABLE)('%s actually changes, and differently per seed', (id) => {
    const print = (seed: number) =>
      BLOB47_MASKS.map((m) => patternLevelsForMask(id, m, 0, 16, DEFAULT_BAND_STEPS, false, seed))
        .join('');
    const base = print(0);
    const variants = SEEDS.map(print);
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(SEEDS.length);
  });

  // THE invariant. A displaced field is exactly what docs/AUTOTILE_PATTERN_BAKE.md
  // §7.2 warns against, and this is why it is safe here: the amplitude is bounded
  // by the headroom the offset range already measured, so a border pixel on an
  // open edge cannot be pushed past bands[0] no matter the seed. Swept over every
  // pattern, mask, seed, both tile sizes, both step-count extremes and the whole
  // offset range, because one escaping pixel is a visible straight-line seam.
  it.each(RESEEDABLE)('%s never lets a re-roll touch the cell border', (id) => {
    const [lo, hi] = PATTERN_OFFSET_RANGE[id];
    // hi is where the budget is thinnest and 32px is where interpolation could
    // smuggle a value past it, so both stay in; the rest is trimmed to keep the
    // sweep under a few seconds.
    const offsets = [lo, 0, hi];
    const seeds = [1, 42, 99999];
    for (const ts of [16, 32]) {
      for (const steps of [MIN_BAND_STEPS, MAX_BAND_STEPS]) {
        for (const hardB of [false, true]) {
          for (const off of offsets) {
            for (const seed of seeds) {
              for (const mask of BLOB47_MASKS) {
                const g = patternLevelsForMask(id, mask, off, ts, steps, hardB, seed);
                for (const [bit, idx] of edgeIndices(ts)) {
                  if (mask & bit) continue;
                  for (const i of idx) expect(g[i]).toBe('0');
                }
              }
            }
          }
        }
      }
    }
  });

  it.each(RESEEDABLE)('%s spends its jitter budget on the offset slider', (id) => {
    // The two controls ask for the same headroom, so pushing the band fully
    // toward the border leaves nothing to jitter with. Documented, not a bug.
    const [, hi] = PATTERN_OFFSET_RANGE[id];
    expect(edgeJitterAmplitude(id, hi)).toBe(0);
    expect(edgeJitterAmplitude(id, 0)).toBe(hi);
    // Negative offsets buy room back rather than costing it.
    expect(edgeJitterAmplitude(id, PATTERN_OFFSET_RANGE[id][0])).toBe(hi);
  });

  it.each(RESEEDABLE)('%s still renders something after a re-roll', (id) => {
    // Jitter erodes; it must not erase a painted cell altogether.
    for (const seed of SEEDS) {
      const visible = [...patternLevelsForMask(id, 0, 0, 16, DEFAULT_BAND_STEPS, false, seed)]
        .filter((c) => c !== '0').length;
      expect(visible).toBeGreaterThan(0);
    }
  });

  it('resolves the same displaced shape at 32px, not a different one', () => {
    // The noise is sampled in FIELD space, so 32px is the same silhouette drawn
    // finer. Downsampling it back must land close to the 16px grid.
    const id = 'jagged';
    const at16 = patternLevelsForMask(id, 110, 0, 16, DEFAULT_BAND_STEPS, false, 7);
    const at32 = patternLevelsForMask(id, 110, 0, 32, DEFAULT_BAND_STEPS, false, 7);
    let same = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (at32[y * 2 * 32 + x * 2] === at16[y * 16 + x]) same++;
      }
    }
    expect(same).toBeGreaterThan(200); // of 256
  });

  describe('noise application across all pattern styles and regions', () => {
    it.each(ALL_PATTERNS)(
      'pattern %s produces noise specks in all 3 regions (edge, terrainA, terrainB)',
      (patternId) => {
        const mask = 15;
        const seed = 42;
        const tileSize = 16;
        const noises = ['blue', 'white'] as const;

        // Render clean tile without noise
        const cleanRGBA = paintPatternTileRGBA(
          patternId, mask, REFERENCE_ROLE_COLOURS, tileSize, [], 0, 0, 1, 3
        );

        // Render noisy tile with all 3 noiseTargets enabled
        const noisyAllRGBA = paintPatternTileRGBA(
          patternId, mask, REFERENCE_ROLE_COLOURS, tileSize, [...noises], 0, seed, 1, 3,
          undefined, false, 0, undefined, undefined, ['edge', 'terrainA', 'terrainB']
        );

        // Verify that noise produced pixel differences compared to clean tile
        let diffCount = 0;
        for (let i = 0; i < cleanRGBA.length; i += 4) {
          if (
            cleanRGBA[i] !== noisyAllRGBA[i] ||
            cleanRGBA[i + 1] !== noisyAllRGBA[i + 1] ||
            cleanRGBA[i + 2] !== noisyAllRGBA[i + 2]
          ) {
            diffCount++;
          }
        }
        expect(diffCount).toBeGreaterThan(0);

        // A zone can only be disturbed if the pattern actually HAS one. `sharp`
        // is authored with zero-width shade levels (PATTERN_BANDS), so its band
        // is nothing but outline and targeting either terrain side is correctly
        // a no-op. Derived from the level grid rather than naming the pattern.
        const zoneGrid = patternLevelsForMask(patternId, mask, 0, tileSize, 3);
        const zoneDefs = patternLevelsFor(3);
        const lastLvl = zoneDefs.length - 1;
        const hasZone = (role: string) => {
          for (let p = 0; p < tileSize * tileSize; p++) {
            const l = zoneGrid.charCodeAt(p) - 48;
            if (l > 0 && l < lastLvl && zoneDefs[l].role === role) return true;
          }
          return false;
        };

        // Test 1: Only 'terrainB' target enabled
        const noisyBOnly = paintPatternTileRGBA(
          patternId, mask, REFERENCE_ROLE_COLOURS, tileSize, [...noises], 0, seed, 1, 3,
          undefined, false, 0, undefined, undefined, ['terrainB']
        );
        let bDiffCount = 0;
        for (let i = 0; i < cleanRGBA.length; i += 4) {
          if (
            cleanRGBA[i] !== noisyBOnly[i] ||
            cleanRGBA[i + 1] !== noisyBOnly[i + 1] ||
            cleanRGBA[i + 2] !== noisyBOnly[i + 2]
          ) {
            bDiffCount++;
          }
        }
        expect(bDiffCount > 0).toBe(hasZone('terrainB'));

        // Strict verification: When only 'terrainB' is enabled, Terrain A base region must have ZERO noise leak
        const gridStr = patternLevelsForMask(patternId, mask, 0, tileSize, 3);
        const levelDefs = patternLevelsFor(3);
        let bOnlyADiffCount = 0;
        for (let y = 0; y < tileSize; y++) {
          for (let x = 0; x < tileSize; x++) {
            const lvl = gridStr.charCodeAt(y * tileSize + x) - 48;
            if (levelDefs[lvl]?.role === 'terrainA') {
              const i = (y * tileSize + x) * 4;
              if (
                cleanRGBA[i] !== noisyBOnly[i] ||
                cleanRGBA[i + 1] !== noisyBOnly[i + 1] ||
                cleanRGBA[i + 2] !== noisyBOnly[i + 2]
              ) {
                bOnlyADiffCount++;
              }
            }
          }
        }
        expect(bOnlyADiffCount).toBe(0);

        // Test 2: Only 'terrainA' target enabled
        const noisyAOnly = paintPatternTileRGBA(
          patternId, mask, REFERENCE_ROLE_COLOURS, tileSize, [...noises], 0, seed, 1, 3,
          undefined, false, 0, undefined, undefined, ['terrainA']
        );
        let aDiffCount = 0;
        for (let i = 0; i < cleanRGBA.length; i += 4) {
          if (
            cleanRGBA[i] !== noisyAOnly[i] ||
            cleanRGBA[i + 1] !== noisyAOnly[i + 1] ||
            cleanRGBA[i + 2] !== noisyAOnly[i + 2]
          ) {
            aDiffCount++;
          }
        }
        expect(aDiffCount > 0).toBe(hasZone('terrainA'));

        // Strict verification: When only 'terrainA' is enabled, Terrain B base region must have ZERO noise leak
        let aOnlyBDiffCount = 0;
        for (let y = 0; y < tileSize; y++) {
          for (let x = 0; x < tileSize; x++) {
            const lvl = gridStr.charCodeAt(y * tileSize + x) - 48;
            if (levelDefs[lvl]?.role === 'terrainB') {
              const i = (y * tileSize + x) * 4;
              if (
                cleanRGBA[i] !== noisyAOnly[i] ||
                cleanRGBA[i + 1] !== noisyAOnly[i + 1] ||
                cleanRGBA[i + 2] !== noisyAOnly[i + 2]
              ) {
                aOnlyBDiffCount++;
              }
            }
          }
        }
        expect(aOnlyBDiffCount).toBe(0);

        // Test 3: Only 'edge' target enabled
        const noisyEdgeOnly = paintPatternTileRGBA(
          patternId, mask, REFERENCE_ROLE_COLOURS, tileSize, [...noises], 0, seed, 1, 3,
          undefined, false, 0, undefined, undefined, ['edge']
        );
        let edgeDiffCount = 0;
        for (let i = 0; i < cleanRGBA.length; i += 4) {
          if (
            cleanRGBA[i] !== noisyEdgeOnly[i] ||
            cleanRGBA[i + 1] !== noisyEdgeOnly[i + 1] ||
            cleanRGBA[i + 2] !== noisyEdgeOnly[i + 2]
          ) {
            edgeDiffCount++;
          }
        }
        // Targeting the outline lets outline pixels dissolve OUTWARD, which is
        // why the destination guard is asymmetric — this stays meaningful even
        // for `sharp`, whose band is nothing but outline.
        expect(edgeDiffCount).toBeGreaterThan(0);

        // Test 4: All noise targets disabled (empty array [])
        const noisyNone = paintPatternTileRGBA(
          patternId, mask, REFERENCE_ROLE_COLOURS, tileSize, [...noises], 0, seed, 1, 3,
          undefined, false, 0, undefined, undefined, []
        );
        let noneDiffCount = 0;
        for (let i = 0; i < cleanRGBA.length; i += 4) {
          if (
            cleanRGBA[i] !== noisyNone[i] ||
            cleanRGBA[i + 1] !== noisyNone[i + 1] ||
            cleanRGBA[i + 2] !== noisyNone[i + 2]
          ) {
            noneDiffCount++;
          }
        }
        expect(noneDiffCount).toBe(0);
      }
    );
  });
});

// The two colour overrides are the app's only way to leave the derived palette.
// Neither had any coverage, and both fail QUIETLY when wrong — a mis-indexed
// ramp still paints a plausible-looking tile, and a leaked grain colour looks
// like a texture rather than a bug.
describe('custom colour overrides', () => {
  const PATTERN = DEFAULT_PATTERN;
  const MASK = 0; // an island: the largest transition band of any tile
  const TS = PATTERN_TILE_SIZE;

  /** Loud colours no shade recipe can produce from the reference palette. */
  const MAGENTA: RGB = { r: 255, g: 0, b: 255 };
  const CYAN: RGB = { r: 0, g: 255, b: 255 };
  const YELLOW: RGB = { r: 255, g: 255, b: 0 };

  const derived = () => patternRamp(REFERENCE_ROLE_COLOURS, DEFAULT_BAND_STEPS);
  const levelsOf = (steps = DEFAULT_BAND_STEPS) =>
    patternLevelsForMask(PATTERN, MASK, 0, TS, steps);

  /** Indices of the pixels painted exactly `c`. */
  const pixelsOf = (buf: Uint8ClampedArray, c: RGB): number[] => {
    const hits: number[] = [];
    for (let p = 0; p < TS * TS; p++) {
      const i = p * 4;
      if (buf[i] === c.r && buf[i + 1] === c.g && buf[i + 2] === c.b) hits.push(p);
    }
    return hits;
  };

  it('repaints exactly the pixels of the level it overrides', () => {
    const ramp = derived();
    const target = 2; // the outline
    const custom = ramp.map((c, i) => (i === target ? MAGENTA : c));

    const px = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, [], 0, 0, 1, DEFAULT_BAND_STEPS,
      undefined, false, 0, custom
    );

    const grid = levelsOf();
    const expected: number[] = [];
    for (let p = 0; p < TS * TS; p++) {
      if (grid.charCodeAt(p) - 48 === target) expected.push(p);
    }
    expect(expected.length).toBeGreaterThan(0);
    // Exact set equality, not a count: an off-by-one in the ramp index would
    // recolour a band of the same size one level over and still "pass" a count.
    expect(pixelsOf(px, MAGENTA)).toEqual(expected);
  });

  it('ignores an override of the wrong length instead of mis-indexing', () => {
    // The ramp length is tied to the step count, so a custom ramp saved at 3
    // steps must not be indexed into a 4-step band.
    const stale = derived().map(() => MAGENTA); // right colours, wrong length
    expect(stale.length).not.toBe(patternRamp(REFERENCE_ROLE_COLOURS, 4).length);

    const withStale = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, [], 0, 0, 1, 4,
      undefined, false, 0, stale
    );
    const withNone = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, [], 0, 0, 1, 4
    );

    expect(pixelsOf(withStale, MAGENTA)).toEqual([]);
    expect([...withStale]).toEqual([...withNone]);
  });

  it('applies grain in the picked colours', () => {
    const px = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, ['white'], 0, 7, 1, DEFAULT_BAND_STEPS,
      undefined, false, 0, undefined,
      { b: CYAN, edge: YELLOW, a: MAGENTA }
    );
    // The grain pushes pixels both ways, so both directions must show up.
    expect(pixelsOf(px, CYAN).length).toBeGreaterThan(0);
    expect(pixelsOf(px, MAGENTA).length).toBeGreaterThan(0);
  });

  it('keeps grain colours inside the transition band', () => {
    // The whole point of gating grain on `0 < level < solid`: a custom colour
    // reaching a solid terrain would tile as speckle across open ground.
    const px = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, ['white', 'clumped'], 0, 7, 2, DEFAULT_BAND_STEPS,
      undefined, false, 0, undefined,
      { b: CYAN, edge: YELLOW, a: MAGENTA }
    );
    const grid = levelsOf();
    const solid = derived().length - 1;
    for (const c of [CYAN, YELLOW, MAGENTA]) {
      for (const p of pixelsOf(px, c)) {
        const level = grid.charCodeAt(p) - 48;
        expect(level).toBeGreaterThan(0);
        expect(level).toBeLessThan(solid);
      }
    }
  });

  it('is inert when no grain algorithm is selected', () => {
    const plain = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, [], 0, 7, 1, DEFAULT_BAND_STEPS
    );
    const withColours = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, [], 0, 7, 1, DEFAULT_BAND_STEPS,
      undefined, false, 0, undefined,
      { b: CYAN, edge: YELLOW, a: MAGENTA }
    );
    expect([...withColours]).toEqual([...plain]);
  });

  it('lets the two overrides combine without either shadowing the other', () => {
    const custom = derived().map((c, i) => (i === 2 ? YELLOW : c));
    const px = paintPatternTileRGBA(
      PATTERN, MASK, REFERENCE_ROLE_COLOURS, TS, ['white'], 0, 7, 1, DEFAULT_BAND_STEPS,
      undefined, false, 0, custom, { b: CYAN, a: MAGENTA }
    );
    expect(pixelsOf(px, YELLOW).length).toBeGreaterThan(0); // ramp override survives
    expect(pixelsOf(px, CYAN).length).toBeGreaterThan(0);   // grain override survives
    expect(pixelsOf(px, MAGENTA).length).toBeGreaterThan(0);
  });
});

describe('level-grid cache', () => {
  // The cache key includes offset, tile size, step count, hard edge and seed, so
  // unlike the field cache its key space is unbounded: dragging the position
  // slider or rolling the edge seed mints entries nothing will ask for again.
  it('stays bounded as distinct configurations pile up', () => {
    const before = levelCacheSize();
    // `jagged` is reseedable and has positive offset headroom at 0, so every
    // seed produces a genuinely distinct key.
    for (let seed = 1; seed <= LEVEL_CACHE_MAX + 200; seed++) {
      patternLevelsForMask('jagged', 0, 0, PATTERN_TILE_SIZE, 3, false, seed);
    }
    expect(before).toBeLessThanOrEqual(LEVEL_CACHE_MAX);
    expect(levelCacheSize()).toBeLessThanOrEqual(LEVEL_CACHE_MAX);
  });

  it('is a pure optimisation — an evicted grid recomputes identically', () => {
    const args = ['jagged', 0, 0, PATTERN_TILE_SIZE, 3, false, 424242] as const;
    const first = patternLevelsForMask(...args);
    // Push well past the cap so the entry above is certainly gone.
    for (let seed = 900000; seed < 900000 + LEVEL_CACHE_MAX + 50; seed++) {
      patternLevelsForMask('jagged', 0, 0, PATTERN_TILE_SIZE, 3, false, seed);
    }
    expect(patternLevelsForMask(...args)).toBe(first);
  });
});
