import { describe, it, expect } from 'vitest';
import {
  renderSheetRGBA, renderMapRGBA, paintTileRGBA, recipeToPaintArgs,
  SHEET_WIDTH, SHEET_HEIGHT, SHEET_TILE_SIZE,
} from './renderSheet';
import {
  DEFAULT_RECIPE, sanitizeRecipe, coloursOf, PRESETS, readRecipeFile, RECIPE_VERSION,
  type Recipe,
} from './recipe';
import { parseHexColour, toHexColour } from './palette';
import { bitsAt, N, E, S, W } from './twoEdge';
import { DEFAULT_CENTRE, type CentreOptions } from './centre';
import { DEFAULT_SURFACE, type SurfaceOptions } from './surface';

const recipe = (over: Partial<Recipe> = {}): Recipe => sanitizeRecipe({ ...DEFAULT_RECIPE, ...over });

describe('sheet', () => {
  it('is 4x4 tiles of RGBA', () => {
    const px = renderSheetRGBA(recipe());
    expect(SHEET_WIDTH).toBe(128);
    expect(SHEET_HEIGHT).toBe(128);
    expect(px).toHaveLength(SHEET_WIDTH * SHEET_HEIGHT * 4);
  });

  it('paints something in every slot, including the isolated cell', () => {
    const px = renderSheetRGBA(recipe());
    for (let slot = 0; slot < 16; slot++) {
      const x0 = (slot % 4) * SHEET_TILE_SIZE;
      const y0 = Math.floor(slot / 4) * SHEET_TILE_SIZE;
      let any = false;
      for (let y = 0; y < SHEET_TILE_SIZE && !any; y++) {
        for (let x = 0; x < SHEET_TILE_SIZE; x++) {
          if (px[((y0 + y) * SHEET_WIDTH + x0 + x) * 4 + 3] !== 0) { any = true; break; }
        }
      }
      expect(any, `slot ${slot}`).toBe(true);
    }
  });
});

describe('only the road is painted — everything else is nothing', () => {
  it('uses exactly the four palette colours, and no others', () => {
    // The property the surface texture had to preserve when it wanted a second
    // tone: it reuses `edgeAlt` rather than inventing a fifth colour, so a
    // sheet is still four tones however it is configured.
    const r = sanitizeRecipe({
      ...DEFAULT_RECIPE,
      edge: { ...DEFAULT_RECIPE.edge, coverage: 0.5 },
      centre: { ...DEFAULT_CENTRE, kind: 'randomDash' },
      surface: { ...DEFAULT_SURFACE, kind: 'gravel' },
    });
    const allowed = new Set(Object.values(coloursOf(r)).map(toHexColour));
    const px = renderSheetRGBA(r);
    const seen = new Set<string>();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      seen.add(toHexColour({ r: px[i], g: px[i + 1], b: px[i + 2] }));
    }
    for (const c of seen) expect(allowed.has(c), c).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('every pixel is either fully opaque or fully transparent', () => {
    // A path tile is laid over ground it knows nothing about, so there is no
    // second terrain to blend with and no honest partial alpha.
    const px = renderSheetRGBA(recipe());
    for (let i = 3; i < px.length; i += 4) {
      expect(px[i] === 0 || px[i] === 255).toBe(true);
    }
  });

  it('the preview ground colour never reaches a pixel of the sheet', () => {
    const ground = '#ff00ff';
    const px = renderSheetRGBA(recipe({ previewGroundHex: ground }));
    const g = parseHexColour(ground);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      expect(px[i] === g.r && px[i + 1] === g.g && px[i + 2] === g.b).toBe(false);
    }
  });
});

describe('palette', () => {
  it('round-trips hex', () => {
    for (const h of ['#000000', '#ffffff', '#eea160', '#1a2b3c']) {
      expect(toHexColour(parseHexColour(h))).toBe(h);
    }
  });
});

describe('sanitizeRecipe', () => {
  it('rejects junk without throwing', () => {
    const r = sanitizeRecipe({ edge: null, roleHex: 'no' } as never);
    expect(r.edge.kind).toBe(DEFAULT_RECIPE.edge.kind);
    expect(r.roleHex.path).toBe(DEFAULT_RECIPE.roleHex.path);
  });

  it('every preset survives its own sanitiser unchanged', () => {
    // A preset that the sanitiser rewrites is a preset that never rendered
    // the way it was written.
    for (const p of PRESETS) expect(sanitizeRecipe(p.recipe), p.id).toEqual(p.recipe);
  });

  it('every preset paints a different sheet', () => {
    const seen = new Map<string, string>();
    for (const p of PRESETS) {
      const px = renderSheetRGBA(p.recipe);
      let h = 0x811c9dc5;
      for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      const key = String(h >>> 0);
      const prev = seen.get(key);
      expect(prev, `${p.id} draws the same as ${prev}`).toBeUndefined();
      seen.set(key, p.id);
    }
  });
});

describe('map rendering', () => {
  it('a cell with no path draws nothing', () => {
    const cols = 2, rows = 1;
    const cells = [1, 0];
    const px = renderMapRGBA(recipe(), cells, cols, rows, (c, row) => bitsAt(cells, cols, rows, c, row));
    const w = cols * SHEET_TILE_SIZE;
    for (let y = 0; y < SHEET_TILE_SIZE; y++) {
      for (let x = SHEET_TILE_SIZE; x < w; x++) {
        expect(px[(y * w + x) * 4 + 3]).toBe(0);
      }
    }
  });

  it('every direction of a crossroads is drawn', () => {
    const a = recipeToPaintArgs(recipe());
    const tile = paintTileRGBA(N | E | S | W, a);
    const opaqueAt = (x: number, y: number) => tile[(y * SHEET_TILE_SIZE + x) * 4 + 3] !== 0;
    expect(opaqueAt(16, 0)).toBe(true);
    expect(opaqueAt(16, SHEET_TILE_SIZE - 1)).toBe(true);
    expect(opaqueAt(0, 16)).toBe(true);
    expect(opaqueAt(SHEET_TILE_SIZE - 1, 16)).toBe(true);
    // ...and the tile corners, which no arm reaches, are not.
    expect(opaqueAt(0, 0)).toBe(false);
    expect(opaqueAt(SHEET_TILE_SIZE - 1, SHEET_TILE_SIZE - 1)).toBe(false);
  });
});

describe('the tile cache sees every field of the recipe', () => {
  // The cache key used to name the fields by hand, and it went stale the moment
  // the centreline grew any: 长段, 短段 and all three of 随机长短线's controls
  // moved the recipe, moved the note under the slider, then hit a cached tile
  // and changed nothing on the sheet. Nothing in the unit tests could see it —
  // they call `centreLayers` directly and never reach this cache. So the test
  // for it lives HERE, on the painted output, and it walks the fields rather
  // than naming them, so the next field added is covered without being added.

  const BAKED = sanitizeRecipe({
    ...DEFAULT_RECIPE,
    edge: { ...DEFAULT_RECIPE.edge, kind: 'straightRound' },
  });

  const hash = (r: Recipe) => {
    const px = renderSheetRGBA(r);
    let h = 0x811c9dc5;
    for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };

  /** A second legal value for every field of the centre options. */
  const OTHER: Record<string, [CentreOptions, CentreOptions]> = {
    kind: [{ kind: 'straightRound' }, { kind: 'dashed' }].map((o) =>
      ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    width: [{ kind: 'straightRound', width: 2 }, { kind: 'straightRound', width: 6 }].map((o) =>
      ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    period: [{ kind: 'dashed', period: 8 }, { kind: 'dashed', period: 16 }].map((o) =>
      ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    long: [{ kind: 'longShort', period: 16, long: 4 }, { kind: 'longShort', period: 16, long: 10 }]
      .map((o) => ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    short: [
      { kind: 'longShort', period: 32, long: 20, short: 2 },
      { kind: 'longShort', period: 32, long: 20, short: 8 },
    ].map((o) => ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    randMin: [
      { kind: 'randomDash', randMin: 2, randMax: 8 },
      { kind: 'randomDash', randMin: 6, randMax: 8 },
    ].map((o) => ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    randMax: [
      { kind: 'randomDash', randMin: 2, randMax: 4 },
      { kind: 'randomDash', randMin: 2, randMax: 8 },
    ].map((o) => ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    seed: [{ kind: 'randomDash', seed: 1 }, { kind: 'randomDash', seed: 4 }].map((o) =>
      ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
    randJitter: [
      { kind: 'randomDash', seed: 3, randJitter: 0 },
      { kind: 'randomDash', seed: 3, randJitter: 2 },
    ].map((o) => ({ ...DEFAULT_CENTRE, ...o })) as [CentreOptions, CentreOptions],
  };

  it('every centre field is covered by a case here', () => {
    // So a new field cannot be added without either a case or a deliberate
    // decision to leave one out.
    expect(Object.keys(OTHER).sort()).toEqual(Object.keys(DEFAULT_CENTRE).sort());
  });

  it.each(Object.keys(OTHER))('changing %s repaints the sheet', (field) => {
    const [a, b] = OTHER[field];
    const ra = sanitizeRecipe({ ...BAKED, centre: a });
    const rb = sanitizeRecipe({ ...BAKED, centre: b });
    // The sanitiser must not have collapsed the two into one setting, or the
    // test would pass by drawing the same thing twice.
    expect(ra.centre, field).not.toEqual(rb.centre);
    expect(hash(ra), field).not.toBe(hash(rb));
  });

  /** And the same for the surface options, walked the same way. */
  const OTHER_SURFACE: Record<string, [SurfaceOptions, SurfaceOptions]> = {
    kind: [{ kind: 'gravel' }, { kind: 'ruts' }].map((o) =>
      ({ ...DEFAULT_SURFACE, ...o })) as [SurfaceOptions, SurfaceOptions],
    coverage: [{ kind: 'gravel', coverage: 0.2 }, { kind: 'gravel', coverage: 0.6 }].map((o) =>
      ({ ...DEFAULT_SURFACE, ...o })) as [SurfaceOptions, SurfaceOptions],
    seed: [{ kind: 'gravel', seed: 1 }, { kind: 'gravel', seed: 7 }].map((o) =>
      ({ ...DEFAULT_SURFACE, ...o })) as [SurfaceOptions, SurfaceOptions],
    rutWidth: [{ kind: 'ruts', rutWidth: 1 }, { kind: 'ruts', rutWidth: 3 }].map((o) =>
      ({ ...DEFAULT_SURFACE, ...o })) as [SurfaceOptions, SurfaceOptions],
    ribWidth: [
      { kind: 'ribs', period: 16, ribWidth: 2 },
      { kind: 'ribs', period: 16, ribWidth: 6 },
    ].map((o) => ({ ...DEFAULT_SURFACE, ...o })) as [SurfaceOptions, SurfaceOptions],
    period: [{ kind: 'ribs', period: 8 }, { kind: 'ribs', period: 16 }].map((o) =>
      ({ ...DEFAULT_SURFACE, ...o })) as [SurfaceOptions, SurfaceOptions],
    rings: [{ kind: 'camber', rings: 1 }, { kind: 'camber', rings: 3 }].map((o) =>
      ({ ...DEFAULT_SURFACE, ...o })) as [SurfaceOptions, SurfaceOptions],
  };

  it('every surface field is covered by a case here', () => {
    expect(Object.keys(OTHER_SURFACE).sort()).toEqual(Object.keys(DEFAULT_SURFACE).sort());
  });

  it.each(Object.keys(OTHER_SURFACE))('changing surface %s repaints the sheet', (field) => {
    const [a, b] = OTHER_SURFACE[field];
    const ra = sanitizeRecipe({ ...BAKED, surface: a });
    const rb = sanitizeRecipe({ ...BAKED, surface: b });
    expect(ra.surface, field).not.toEqual(rb.surface);
    expect(hash(ra), field).not.toBe(hash(rb));
  });

  it('...and the same recipe still gives the same sheet, twice running', () => {
    const r = sanitizeRecipe({
      ...BAKED,
      centre: { ...DEFAULT_CENTRE, kind: 'randomDash', seed: 5 },
      surface: { ...DEFAULT_SURFACE, kind: 'gravel', seed: 5 },
    });
    expect(hash(r)).toBe(hash(r));
  });
});

describe('a saved recipe is REFUSED rather than silently reset', () => {
  // The bug this exists for, measured before it was fixed: a v1 file — the
  // shape exported before the drawing and the second generator were deleted —
  // went through `sanitizeRecipe` and came out byte-identical to DEFAULT_RECIPE
  // apart from its colours. Every piece of geometry gone, no error, no warning.
  // The sanitiser is right to fill gaps and drop strangers; it is just the
  // wrong tool for "this file is from another era".
  const V1 = JSON.stringify({
    v: 1,
    recipe: {
      bakedId: 'test6norm', halfWidth: 9, bend: 4, shadeRings: 3,
      centre: { enabled: true, pattern: 'dash', width: 2, period: 8 },
      surface: { algo: 'ruts', amount: 0.6, period: 8 },
      roleHex: { path: '#c9a97e', edge: '#4a3a2a', centre: '#e8dcc0', edgeAlt: '#6b5540' },
    },
  });

  it('names the version rather than loading it', () => {
    const read = readRecipeFile(V1);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toContain('第 1 版');
      expect(read.reason).toContain(String(RECIPE_VERSION));
    }
  });

  it('...and would otherwise have been indistinguishable from the default', () => {
    // The measurement that makes the refusal worth the code. If this ever stops
    // holding, the silent path stopped being silent and the guard could relax.
    const smuggled = sanitizeRecipe(JSON.parse(V1).recipe);
    expect(smuggled.edge).toEqual(DEFAULT_RECIPE.edge);
    expect(smuggled.centre).toEqual(DEFAULT_RECIPE.centre);
    expect(smuggled.surface).toEqual(DEFAULT_RECIPE.surface);
  });

  it('catches an old shape even with no version at all', () => {
    // A hand-edited file, or one from before the wrapper carried `v`.
    const read = readRecipeFile(JSON.stringify({ bakedId: null, halfWidth: 9 }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain('halfWidth');
  });

  it('accepts what this version writes, and round-trips it', () => {
    for (const p of PRESETS) {
      const read = readRecipeFile(JSON.stringify({ v: RECIPE_VERSION, recipe: p.recipe }));
      expect(read.ok, p.id).toBe(true);
      if (read.ok) expect(read.recipe).toEqual(p.recipe);
    }
  });

  it('refuses junk without throwing', () => {
    for (const junk of ['', 'not json', '[]', 'null', '{"nope":1}']) {
      const read = readRecipeFile(junk);
      expect(read.ok, junk).toBe(false);
      if (!read.ok) expect(read.reason.length).toBeGreaterThan(0);
    }
  });
});
