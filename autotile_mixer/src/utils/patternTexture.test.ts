import { describe, it, expect } from 'vitest';
import {
  TEXTURE_PRESETS, DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES, MAX_TEXTURE_SHADES,
  DEFAULT_GEO_SCALE, GEO_SCALES, textureUsesGeoScale, octagonalRank,
  nonslipRank, hexagonRank, brickBondRank, naturalGeoScale, geoScalesFor,
  textureShadeAt, textureColour, textureRamp, texturePeriod, usedTextureShades,
  textureUsesAmount, naturalTextureAmount, DEFAULT_TEXTURE_AMOUNT,
  type TextureId,
} from './patternTexture';
import {
  REFERENCE_ROLE_COLOURS, paintPatternTileRGBA, patternRamp, toHexColour, NO_TEXTURE,
} from './patternPaint';
import { DEFAULT_PATTERN, patternLevelsForMask } from './blob47Pattern';
import { sample, type NoiseId } from './patternNoise';

const ALGOS = TEXTURE_PRESETS.map((p) => p.id).filter((id) => id !== 'none');
const DEEP_BLUE = { r: 0x00, g: 0x18, b: 0xa0 };
const NEAR_WHITE = { r: 0xf8, g: 0xf8, b: 0xf8 };

const wrapN = (v: number, n: number) => ((v % n) + n) % n;

/** Baked art keeps its lightest tone as bare terrain, so it never inks everything. */
const BAKED = [
  'weave', 'paving', 'paving3', 'paving5', 'stone_floor', 'breeze_block', 'brick_wall', 'cobbles2', 'brick_floor',
  'hexagon', 'isometric', 'octagonal', 'water', 'field', 'rubble', 'nonslip',
  // Not baked art, but the same kind of texture: these name a shade per cell
  // rather than thresholding a field, so the cells dealt shade 0 stay bare.
  'cells',
  // Generated, and its grout is the bare terrain showing between the tiles.
  'square',
  // Inverted: its brick FACE is the bare terrain, and the ramp paints the
  // joints and bevel on top, so most of the sheet is deliberately rank 0.
  'brick_bond',
] as const;

/**
 * Fraction of textured pixels, counted over one full period of the texture. A
 * fixed 16x16 window would read only a quarter of a 32-period paving and report
 * whatever happened to be in that corner.
 */
const coverage = (algo: TextureId, amount: number, shades = DEFAULT_TEXTURE_SHADES) => {
  const p = texturePeriod(algo);
  let n = 0;
  for (let y = 0; y < p; y++) {
    for (let x = 0; x < p; x++) if (textureShadeAt(algo, x, y, 0, amount, shades) > 0) n++;
  }
  return n / (p * p);
};

/**
 * The shape every generated geometry has to have, settled 2026-08-09:
 *
 *   - the joint between tiles is the TOP shade, fixed;
 *   - one face is left as the bare terrain colour;
 *   - the remaining faces take the shades between, one flat block each.
 *
 * These are the tests that make it a rule instead of six coincidences. Before
 * them: `octagonal` gave every octagon the same tone and spent a shade on a bevel
 * ring; `square` dealt four tints inside a single 32px tile with no joint between
 * them; `hexagon` and `isometric_grid` left a swatch unreachable; `isometric`
 * coloured one diamond two different ways either side of a seam.
 *
 * The joint and the terrain face were briefly the other way round. `cells` had the
 * arrangement above from the start and the rest were brought onto it, not the
 * other way about.
 */
describe('the paving standard', () => {
  // isometric_grid is deliberately absent: its three facets are the three sides of
  // one solid and meet each other at the cube's centre with no joint between them.
  // Inking that junction would turn every cube back into three loose rhombi. Its
  // outline-plus-three-flat-faces claim is covered by the shade-census test.
  const PAVINGS = ['square', 'isometric', 'octagonal', 'hexagon'] as const;
  const JOINT = MAX_TEXTURE_SHADES;
  /**
   * The traced masonry that draws a joint at all, as opposed to the organic
   * tables. Measured rather than read off the encoding: for each of these the
   * joint rank is a pure one-pixel line and every other rank is a region.
   *
   * Which of them needed the ladder ROTATED is a different question and a smaller
   * list — see JOINT_AT_RANK_0. The first five were traced with the mortar on rank
   * 0; the three Stagecast pavings and `weave` already had it on the top rank, and
   * `weave` in particular looks like it belongs in the rotation list and does not,
   * because its rank 0 is 63% solid, i.e. a face.
   */
  const JOINTED_MASONRY = [
    'brick_wall', 'cobbles2', 'brick_floor', 'breeze_block', 'stone_floor',
    'paving', 'paving3', 'paving5', 'weave',
  ] as const;
  const grid = (algo: TextureId, n: number, seed = 0) => {
    const p = texturePeriod(algo);
    const m: number[][] = [];
    for (let y = 0; y < p; y++) {
      const row: number[] = [];
      for (let x = 0; x < p; x++) row.push(textureShadeAt(algo, x, y, seed, 1, 4, 3, 4, n));
      m.push(row);
    }
    return m;
  };

  it.each(PAVINGS.flatMap((a) => geoScalesFor(a).map((g) => [a, g.id] as const)))(
    '%s at motif size %i draws its joint on the top shade and its faces flat', (algo, n) => {
      const m = grid(algo, n);
      const p = m.length;
      const at = (x: number, y: number) => m[wrapN(y, p)][wrapN(x, p)];

      // 1. There IS a joint, and it is a LINE rather than a region: no 2x2 block
      //    is entirely joint, which is exactly "one pixel wide everywhere". A
      //    four-neighbour test would be wrong here — a grid crossing legitimately
      //    has all four of its neighbours on the joint.
      let joint = 0;
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) {
          if (at(x, y) !== JOINT) continue;
          joint++;
          const block = at(x + 1, y) === JOINT && at(x, y + 1) === JOINT
            && at(x + 1, y + 1) === JOINT;
          expect(`${algo}@${n} 2x2 joint block at ${x},${y}: ${block}`)
            .toBe(`${algo}@${n} 2x2 joint block at ${x},${y}: false`);
        }
      }
      expect(joint).toBeGreaterThan(0);

      // 2. Every face the joint encloses is a single shade, the bare-terrain one
      //    included. Four-connected, which is what a one-pixel joint actually
      //    separates — two tiles meeting at a corner touch diagonally and are
      //    still visually distinct.
      const seen = Array.from({ length: p }, () => new Array<boolean>(p).fill(false));
      for (let y0 = 0; y0 < p; y0++) {
        for (let x0 = 0; x0 < p; x0++) {
          if (m[y0][x0] === JOINT || seen[y0][x0]) continue;
          const stack = [[x0, y0]];
          seen[y0][x0] = true;
          const shade = m[y0][x0];
          while (stack.length) {
            const [x, y] = stack.pop()!;
            const where = `${algo}@${n} face(${x0},${y0}) px(${x},${y})`;
            expect(`${where}=${at(x, y)}`).toBe(`${where}=${shade}`);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = wrapN(x + dx, p);
              const ny = wrapN(y + dy, p);
              if (m[ny][nx] !== JOINT && !seen[ny][nx]) { seen[ny][nx] = true; stack.push([nx, ny]); }
            }
          }
        }
      }

      // 3. One face is left as the bare terrain. That is the half of the rule the
      //    joint used to occupy, and nothing else here would notice its loss.
      expect(`${algo}@${n} has a terrain face: ${m.some((r) => r.includes(0))}`)
        .toBe(`${algo}@${n} has a terrain face: true`);
    });

  it.each(PAVINGS.flatMap((a) => geoScalesFor(a).map((g) => [a, g.id] as const)))(
    '%s at motif size %i only ever paints shades 1..4', (algo, n) => {
      for (const seed of [0, 1, 7]) {
        for (const row of grid(algo, n, seed)) {
          for (const v of row) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(MAX_TEXTURE_SHADES);
          }
        }
      }
    });

  it('cells inks its grout with the top shade and deals its cells from the terrain up', () => {
    // The arrangement the rest were brought onto, and it holds at every cell
    // count, which is what makes it the reference.
    for (const scale of [2, 3, 4, 5, 6]) {
      const counts = new Map<number, number>();
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const k = textureShadeAt('cells', x, y, 0, 1, 4, scale);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
      // Grout exists and is the minority. The bound is loose because grout is a
      // perimeter and cells are an area: measured, a one-pixel line round 4 cells
      // is 13% of the tile and round 36 of them is 43%. That is the lattice, not a
      // fat line — the thick-core fraction stays under a tenth at every scale.
      expect(counts.get(JOINT)!).toBeGreaterThan(0);
      expect(counts.get(JOINT)!).toBeLessThan(0.5 * 1024);
      // And every face slot is drawn, the bare-terrain one included.
      for (const k of [0, 1, 2, 3]) expect(counts.get(k) ?? 0).toBeGreaterThan(0);
    }
  });

  it('keeps the joint on a shade of its own however few shades there are', () => {
    // The bug: `rankToShade` mapped the whole 0..4 ladder proportionally, so at two
    // shades rank 3 and rank 4 both landed on shade 2 — a face came out the same
    // colour as the line separating it from its neighbour, and nothing in the
    // panel said so because both counted as "used". The top rank is mapped apart
    // from the rest now.
    //
    // Measured as the joint's pixel count: it must not lose a single pixel to a
    // face, at any shade count, for anything that draws a joint.
    const jointPixels = (algo: TextureId, shades: number, n: number) => {
      const p = texturePeriod(algo);
      let k = 0;
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) {
          if (textureShadeAt(algo, x, y, 0, 1, shades, 3, 4, n) === shades) k++;
        }
      }
      return k;
    };
    for (const algo of [...PAVINGS, 'cells', ...JOINTED_MASONRY] as const) {
      const n = textureUsesGeoScale(algo) ? naturalGeoScale(algo) : DEFAULT_GEO_SCALE;
      const at4 = jointPixels(algo, 4, n);
      expect(`${algo} joint at 4 shades: ${at4 > 0}`).toBe(`${algo} joint at 4 shades: true`);
      for (const shades of [3, 2, 1]) {
        expect(`${algo} joint at ${shades} shades: ${jointPixels(algo, shades, n)}`)
          .toBe(`${algo} joint at ${shades} shades: ${at4}`);
      }
    }
  });

  it('hides the density control exactly where it would quantise the ramp', () => {
    // The rule behind textureUsesAmount, measured rather than declared. A texture
    // that names its shade outright has that shade ROUNDED by `amount`, so the
    // slider merges levels instead of thinning coverage — at the 0.4 the app used
    // to open on, every one of them lost the top two shades outright.
    for (const algo of ALGOS) {
      const full = usedTextureShades(algo, 1, 4);
      const dimmed = usedTextureShades(algo, 0.4, 4);
      const quantises = [3, 4].every((k) => full.has(k) && !dimmed.has(k));
      if (!quantises) continue;
      expect(`${algo}: density ${textureUsesAmount(algo) ? 'shown' : 'hidden'}`)
        .toBe(`${algo}: density hidden`);
    }
    // And the ones that keep it are the ones it thins, which is what it claims.
    for (const algo of ALGOS) {
      if (!textureUsesAmount(algo)) continue;
      expect(coverage(algo, 0.3)).toBeLessThan(coverage(algo, 0.9));
    }
  });
});

describe('texture presets', () => {
  it('offers a unique list that is off by default', () => {
    const ids = TEXTURE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_TEXTURE).toBe('none');
    expect(ids).toContain('none');
  });

  it('none never textures anything', () => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(textureShadeAt('none', x, y, 0, 1)).toBe(0);
    }
  });

  it.each(ALGOS)('%s returns a shade inside 0..shades', (algo) => {
    for (const shades of [1, 2, 3, MAX_TEXTURE_SHADES]) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const k = textureShadeAt(algo, x, y, 0, 1, shades);
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThanOrEqual(shades);
        }
      }
    }
  });

  // The property every part of this app lives or dies on: a tile is painted
  // knowing nothing about its neighbours, so the speckle must repeat with the
  // tile or it contradicts itself at every seam. What makes that true is the
  // period DIVIDING the tile size, which is why the period is asked for rather
  // than assumed to be 16 — see `texturesForTileSize`.
  it.each(ALGOS)('%s repeats with its declared period', (algo) => {
    const p = texturePeriod(algo);
    for (let y = -2 * p - 2; y < 2 * p + 2; y++) {
      for (let x = -2 * p - 2; x < 2 * p + 2; x++) {
        const base = textureShadeAt(algo, ((x % p) + p) % p, ((y % p) + p) % p, 5, 0.5);
        expect(textureShadeAt(algo, x, y, 5, 0.5)).toBe(base);
      }
    }
  });

  it.each(ALGOS)('%s has a period that divides the 32px tile', (algo) => {
    // The whole seam argument in one line: the sheet is emitted at 32, a seam
    // falls every 32 output pixels, and it only lands on a period boundary when
    // the period divides 32. A texture that fails this cuts every tile open.
    expect(32 % texturePeriod(algo)).toBe(0);
  });

  it.each(ALGOS)('%s covers more as the amount rises', (algo) => {
    let prev = -1;
    for (let a = 0; a <= 1.0001; a += 0.1) {
      const c = coverage(algo, a);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(coverage(algo, 0)).toBe(0);
  });

  it.each(ALGOS.filter((id) => !BAKED.includes(id as typeof BAKED[number]) && id !== 'isometric_grid'))(
    '%s inks every pixel at full amount', (algo) => {
      expect(coverage(algo, 1)).toBe(1);
    });

  // Not an exemption for convenience: in every one of these the reference art's
  // lightest tone IS the ground, which is what lets two picked colours reproduce
  // it. If any of these reached 1 the terrain colour would have dropped out.
  it.each([
    ['weave', 204 / 256],
    ['paving', 960 / 1024],
    ['paving3', 692 / 1024],
    ['paving5', 817 / 1024],
    ['cells', 802 / 1024],
  ] as const)('%s leaves its lightest tone as bare terrain at full amount', (algo, want) => {
    expect(coverage(algo, 1)).toBeCloseTo(want, 6);
  });

  it.each(ALGOS.filter((id) => !['hexagon', 'isometric', 'isometric_grid', 'octagonal', 'square'].includes(id)))('%s keeps the strongest shade a minority', (algo) => {
    // The top shade is an accent — a highlight, a joint, a grout line — never
    // the surface itself. This used to be checked as `counts[1] > counts[max]`,
    // which is a fair proxy for a scatter but not for a texture whose top shade
    // is its grout: at 4x4 cells the grout is legitimately the single commonest
    // tone at 28%, and that is the texture working, not failing.
    //
    // The four pavings are exempt for the opposite reason: their top shade is the
    // TILE FACE, which is supposed to be most of the surface. `square` at its
    // largest is 841 face pixels out of 1024 and that is the texture drawn
    // correctly — one square filling the tile with a grid line around it.
    const p = texturePeriod(algo);
    const counts = new Array(MAX_TEXTURE_SHADES + 1).fill(0);
    for (let y = 0; y < p; y++) {
      for (let x = 0; x < p; x++) counts[textureShadeAt(algo, x, y, 0, 1)]++;
    }
    expect(counts[MAX_TEXTURE_SHADES]).toBeLessThan((p * p) / 3);
  });

  it.each([2, 3, 4, 5, 6] as const)(
    'cells at scale %i deals every shade below the grout to some cell', (scale) => {
      // The regression this whole model exists for. Cells used to go through the
      // scatter path, which squares its input before scaling: an interior value
      // of at most 0.24 gave `1 + floor(4 * 0.24^2)` = 1 for every cell however
      // the hash fell, so all cells were one colour and only the boundary ever
      // climbed — a wireframe, not a paving. Every interior step must be spoken
      // for, or the ramp is being wasted again.
      const p = texturePeriod('cells');
      const seen = new Set<number>();
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) seen.add(textureShadeAt('cells', x, y, 0, 1, MAX_TEXTURE_SHADES, scale));
      }
      for (let k = 0; k <= MAX_TEXTURE_SHADES; k++) expect(seen).toContain(k);
    });

  it.each([2, 3, 4, 5, 6] as const)(
    'cells at scale %i paints each cell flat, not as a gradient', (scale) => {
      // A cell is one block of colour. Counting how many pixels sit on a shade
      // boundary catches a field that has started ramping inside a cell: a flat
      // deal only changes shade at the grout, which is a small fraction of the
      // tile.
      const p = texturePeriod('cells');
      const at = (x: number, y: number) =>
        textureShadeAt('cells', wrapN(x, p), wrapN(y, p), 0, 1, MAX_TEXTURE_SHADES, scale);
      let edges = 0;
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) if (at(x, y) !== at(x + 1, y)) edges++;
      }
      expect(edges).toBeLessThan(p * p * (scale >= 5 ? 0.4 : 0.25));
    });

  it('changes with the seed', () => {
    const print = (seed: number) => {
      const out: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        out.push(textureShadeAt('white', x, y, seed, 0.5));
      }
      return out.join('');
    };
    expect(new Set([print(0), print(1), print(7), print(99)]).size).toBeGreaterThan(1);
  });

  it('does not move in step with the band grain off the same seed', () => {
    // Both read the same noise field; only the salt keeps them apart.
    let same = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const bandish = sample('white', x, y, 3) >= 0.5 ? 1 : 0;
        const tex = textureShadeAt('white', x, y, 3, 0.5) > 0 ? 1 : 0;
        if (bandish === tex) same++;
      }
    }
    expect(same).toBeLessThan(230); // not a near-perfect echo of the band field
  });
});

describe('geometric textures', () => {
  /**
   * Scans a whole 32px tile, not one period of the texture. That is what a tile
   * actually shows, and it is the frame these lattice claims are about — `brick`
   * repeats every 16, so a period-sized window would only ever see half its
   * courses and could not tell a running bond from a grid.
   */
  const lit = (algo: TextureId, amount: number) => {
    const on: [number, number][] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) if (textureShadeAt(algo, x, y, 0, amount) > 0) on.push([x, y]);
    }
    return on;
  };

  // Both lattices are half-drop: every other course is shifted by half a brick.
  // Shifting by (half a brick, one course) therefore maps the pattern exactly
  // onto itself — which is the definition, not a consequence. The vector differs
  // because the bricks are 16x8.

  it('weave keeps the tone census of the art it was traced from', () => {
    // The lock on the baked table. assets/test3.png has five tones; these are
    // their pixel counts, so a corrupted or re-ordered table fails here rather
    // than shipping a subtly wrong floor.
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('weave', x, y, 0, 1, 4)]++;
    }
    expect(counts).toEqual([52, 52, 52, 76, 24]);
  });

  it('weave uses every tone of the ramp, darkest sparsest', () => {
    // A weave whose facets collapse into each other is just a wash.
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('weave', x, y, 0, 1, 4)]++;
    }
    for (const n of counts) expect(n).toBeGreaterThan(0);
    expect(counts[4]).toBeLessThan(Math.min(counts[0], counts[1], counts[2], counts[3]));
  });

  it('cobbles2 keeps the tone census of the traced fine-brick art', () => {
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('cobbles2', x, y, 0, 1, 4)]++;
    }
    // ROTATED 2026-08-09 so the mortar lands on the top rank like every other
    // geometry here: rank 0 moved to the end and every face stepped down one, in
    // that order, so the art's own light-to-dark ordering is untouched.
    expect(counts).toEqual([73, 105, 25, 5, 48]);
  });

  it('brick_floor keeps the tone census of the traced diagonal-brick art', () => {
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) counts[textureShadeAt('brick_floor', x, y, 0, 1, 4)]++;
    }
    // ROTATED 2026-08-09 so the mortar lands on the top rank like every other
    // geometry here: rank 0 moved to the end and every face stepped down one, in
    // that order, so the art's own light-to-dark ordering is untouched.
    // Its second-lightest tone is a single pixel, so the bare-terrain face here is
    // one pixel. That is the traced art's tone census, not a mapping error.
    expect(counts).toEqual([1, 192, 24, 15, 24]);
  });

  it('weave flattens toward bare terrain as the amount drops', () => {
    // `amount` scales the ramp rather than thinning a scatter, so the tones
    // converge on the terrain colour instead of the pattern breaking up.
    const spread = (amount: number) => {
      const seen = new Set<number>();
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) seen.add(textureShadeAt('weave', x, y, 0, amount, 4));
      }
      return seen.size;
    };
    expect(spread(1)).toBe(5);
    expect(spread(0.5)).toBeLessThan(5);
    expect(spread(0.1)).toBeLessThan(spread(0.5));
  });

  // --- the three 32px Stagecast pavings ------------------------------------

  const census32 = (algo: TextureId) => {
    const counts = new Array(5).fill(0);
    // At the size the art was DRAWN at, which is no longer the size the texture
    // opens on: square and octagonal are 32px art that the panel now opens one
    // size down, because a 32px period holds one motif and their deal needs four.
    // Measuring a census against a different size compares two pictures.
    const n = algo === 'nonslip' ? 4 : DEFAULT_GEO_SCALE;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) counts[textureShadeAt(algo, x, y, 0, 1, 4, 3, 4, n)]++;
    }
    return counts;
  };

  it.each([
    ['paving', [64, 270, 400, 90, 200]],
    ['paving3', [332, 332, 169, 68, 123]],
    ['paving5', [207, 224, 224, 207, 162]],
    // Rotated: mortar 94 to the top, faces down one. Its second-lightest tone is
    // 8 pixels, so the bare-terrain face is nearly absent — the art's census, not
    // a mapping error.
    ['breeze_block', [8, 212, 704, 6, 94]],
    // Rotated: mortar 184 to the top, faces down one.
    ['brick_wall', [200, 96, 536, 8, 184]],
    // Rotated: joint 102 to the top, faces down one.
    ['stone_floor', [136, 366, 261, 159, 102]],
    // Tips merged into the outline (2026-08-09), which moved 30 pixels from
    // the two tip shades into rank 0. Was [110, 10, 241, 221, 442].
    // Then four-toned: the traced art gave one tone two of the four face slots,
    // so the census went from [140, 0, 221, 221, 442] to an even quarter each,
    // and the outline moved from rank 0 to the top rank.
    ['hexagon', [221, 221, 221, 221, 140]],
    ['isometric', [211, 211, 211, 211, 180]],
    // Was [62, 181, 0, 40, 741]: one tone for every octagon, one for the corner
    // square, one for a bevel ring, and shade 2 unreachable. The outline is the
    // same 62 pixels, now on the top rank; the bevel's 40 went into the face. At
    // this size the period holds one octagon, so it takes the first of the three
    // face ranks — the bare terrain — and two swatches correctly grey out.
    ['octagonal', [781, 0, 0, 181, 62]],
    ['water', [697, 0, 288, 0, 39]],
    ['field', [157, 151, 222, 164, 330]],
    ['rubble', [501, 0, 396, 0, 127]],
    // Was [192, 0, 672, 0, 160] — core 192, plate 672, shadow 160 — when the
    // plate was a shade and the core was the bare terrain. The REGIONS are
    // untouched: 96 + 96 is the same 192 pixels of core, 80 + 80 the same 160 of
    // shadow, and the plate is the same 672. Only which tone each takes moved.
    ['nonslip', [672, 80, 80, 96, 96]],
  ] as const)('%s keeps the tone census of the art it was traced from', (algo, want) => {
    // The lock on each baked table, same job the weave census does: a corrupted
    // or re-ordered table fails here rather than shipping a subtly wrong floor.
    expect(census32(algo)).toEqual([...want]);
  });

  it.each(['paving', 'paving3', 'paving5'] as const)(
    '%s uses every tone of the ramp', (algo) => {
      // Unlike weave, the darkest tone here is mortar and is not the sparsest —
      // paving3 draws more black joint than it does shading line.
      for (const n of census32(algo)) expect(n).toBeGreaterThan(0);
    });

  it.each(['paving', 'paving3', 'paving5'] as const)(
    '%s has no 16-periodic core, which is why it costs a 32px tile', (algo) => {
      // The measurement the 32px period rests on. If someone ever re-bakes one of
      // these down to 16 to "simplify", this is what catches it: the art really
      // does disagree with itself half a tile over, in tone and in mortar alike.
      let differ = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (textureShadeAt(algo, x, y, 0, 1, 4) !== textureShadeAt(algo, x + 16, y, 0, 1, 4)) differ++;
        }
      }
      expect(differ).toBeGreaterThan(600);
    });

  it.each(['paving', 'paving3', 'paving5'] as const)(
    '%s flattens toward bare terrain as the amount drops', (algo) => {
      const spread = (amount: number) => {
        const seen = new Set<number>();
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) seen.add(textureShadeAt(algo, x, y, 0, amount, 4));
        }
        return seen.size;
      };
      expect(spread(1)).toBe(5);
      expect(spread(0.5)).toBeLessThan(5);
      expect(spread(0.1)).toBeLessThan(spread(0.5));
    });


  it.each([2, 3, 4, 5, 6] as const)('cells at scale %i generates cellular grid', (scale) => {
    const sparse = lit('cells', 0.35);
    expect(sparse.length).toBeGreaterThan(0);
    expect(sparse.length).toBeLessThan(32 * 32);

    const shades = new Set<number>();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        shades.add(textureShadeAt('cells', x, y, 0, 1, MAX_TEXTURE_SHADES, scale));
      }
    }
    expect(shades.size).toBeGreaterThan(2);
  });
});

describe('generated geometric pavings', () => {
  // `isometric` and `octagonal` were 32x32 traced tables until their geometry
  // was solved. The tables live HERE now, as the oracle: the generator has to
  // reproduce them pixel for pixel at the original motif size, which is what
  // makes the size control safe — the default look cannot drift, because a drift
  // fails this test. Do not "simplify" these fixtures away; they are the only
  // remaining copy of the traced art.

  const OCTAGONAL_TRACED =
    '11111111034444444444430111111111' +
    '11111110344444444444443011111111' +
    '11111103444444444444444301111111' +
    '11111034444444444444444430111111' +
    '11110344444444444444444443011111' +
    '11103444444444444444444444301111' +
    '11034444444444444444444444430111' +
    '10344444444444444444444444443011' +
    '03444444444444444444444444444301' +
    '34444444444444444444444444444430' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '44444444444444444444444444444440' +
    '34444444444444444444444444444430' +
    '03444444444444444444444444444301' +
    '10344444444444444444444444443011' +
    '11034444444444444444444444430111' +
    '11103444444444444444444444301111' +
    '11110344444444444444444443011111' +
    '11111034444444444444444430111111' +
    '11111103444444444444444301111111' +
    '11111110344444444444443011111111' +
    '11111111034444444444430111111111' +
    '11111111100000000000001111111111';

  it('octagonal keeps the traced silhouette pixel for pixel at 32px', () => {
    // The oracle survives the 2026-08-09 reshading as a SILHOUETTE oracle. Which
    // pixels are outline, which are octagon and which are corner square is still
    // the traced art's, exactly; only the tone each region takes has moved.
    //
    // The traced art's own tones map onto the regions like this:
    //   0        the outline
    //   3, 4     the octagon face — 4 is the face, 3 a bevel ring just inside it
    //   1        the corner square
    // A one-pixel ring is not a face, so 3 folds into 4; that is the only regional
    // change, and it is why this compares against a merged copy rather than the
    // raw table.
    const region = (t: number) => (t === 0 ? 'line' : t === 1 ? 'square' : 'face');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const got = octagonalRank(x, y, DEFAULT_GEO_SCALE);
        const want = OCTAGONAL_TRACED.charCodeAt(y * 32 + x) - 48;
        const gotRegion = got === MAX_TEXTURE_SHADES ? 'line'
          : got === MAX_TEXTURE_SHADES - 1 ? 'square' : 'face';
        expect(`${x},${y} ${gotRegion}`).toBe(`${x},${y} ${region(want)}`);
      }
    }
  });

  it.each([
    ['octagonal', octagonalRank],
  ] as const)('%s routes through its generator, seeded like a baked table', (algo, rank) => {
    // textureShadeAt salts the seed and offsets the lookup, exactly as it does
    // for the traced tables, so the dice still moves these two. Recovering the
    // offset rather than hardcoding it keeps this test off TEXTURE_SALT's value.
    const shifts = new Set<string>();
    for (let dy = 0; dy < 32; dy++) {
      for (let dx = 0; dx < 32; dx++) {
        let ok = true;
        for (let y = 0; y < 32 && ok; y++) {
          for (let x = 0; x < 32 && ok; x++) {
            if (textureShadeAt(algo, x, y, 0, 1, MAX_TEXTURE_SHADES)
              !== rank(wrapN(x + dx, 32), wrapN(y + dy, 32), DEFAULT_GEO_SCALE)) ok = false;
          }
        }
        if (ok) shifts.add(`${dx},${dy}`);
      }
    }
    // At least one translation lines up, which is only true if the generator is
    // what textureShadeAt is calling. More than one is expected for isometric:
    // its lattice repeats every 16 rows, so two offsets are indistinguishable.
    expect(shifts.size).toBeGreaterThan(0);
    expect(shifts.size).toBeLessThan(4);
    // And the dice still moves it, the same way it moves a traced table.
    const print = (seed: number) => {
      let out = '';
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) out += textureShadeAt(algo, x, y, seed, 1, MAX_TEXTURE_SHADES);
      }
      return out;
    };
    expect(new Set([print(0), print(1), print(9)]).size).toBeGreaterThan(1);
  });

  it.each(GEO_SCALES.map((g) => g.id))('every paving stays 32-periodic at motif size %i', (n) => {
    for (const algo of ['isometric', 'octagonal'] as const) {
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const base = textureShadeAt(algo, x, y, 3, 1, 4, 3, 4, n);
          expect(textureShadeAt(algo, x + 32, y, 3, 1, 4, 3, 4, n)).toBe(base);
          expect(textureShadeAt(algo, x, y - 32, 3, 1, 4, 3, 4, n)).toBe(base);
        }
      }
    }
  });

  it.each(GEO_SCALES.map((g) => g.id))('isometric keeps its outline one pixel wide at motif size %i', (n) => {
    // The bug this catches, and it is silent: the metric's gradient grows with
    // the motif count, so the tolerance has to grow with it too. Left at 1, the
    // outline came out 1/n pixels wide and vanished completely below the pixel
    // grid at 16px and 8px — the tiling rendered as two flat tones with no joint
    // between them at all.
    let outline = 0;
    let runs = 0;
    for (let y = 0; y < 32; y++) {
      let prev = false;
      for (let x = 0; x < 32; x++) {
        const on = textureShadeAt('isometric', x, y, 0, 1, 4, 3, 4, n) === MAX_TEXTURE_SHADES;
        if (on) outline++;
        if (on && !prev) runs++;
        prev = on;
      }
    }
    expect(outline).toBeGreaterThan(32);
    // Mean horizontal run of the joint. Rhombus tips legitimately double it up
    // where two meet, so this is 1-2 rather than exactly 1.
    expect(outline / runs).toBeLessThan(3.5);
  });

  it.each(GEO_SCALES.map((g) => g.id))('isometric draws outline and faces at motif size %i', (n) => {
    const seen = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seen.add(textureShadeAt('isometric', x, y, 0, 1, 4, 3, 4, n));
    }
    expect(Array.from(seen).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('isometric arranges in 2x2 group pattern at seed 0 and randomly at seed > 0', () => {
    // At seed 0, n=2 (16px), the 2x2 group of diamond cells are ranks 1, 2, 3, 4 deterministically
    const seenSeed0 = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seenSeed0.add(textureShadeAt('isometric', x, y, 0, 1, 4, 3, 4, 2));
    }
    expect(Array.from(seenSeed0).sort()).toEqual([0, 1, 2, 3, 4]);

    // At seed > 0, diamond cells are randomly assigned colors based on seed
    const seenSeed1 = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seenSeed1.add(textureShadeAt('isometric', x, y, 1, 1, 4, 3, 4, 2));
    }
    expect(seenSeed1.size).toBeGreaterThan(1);
  });

  it.each(GEO_SCALES.map((g) => g.id))('octagonal draws outline, octagons and corner squares at motif size %i', (n) => {
    const seen = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seen.add(textureShadeAt('octagonal', x, y, 0, 1, 4, 3, 4, n));
    }
    // Outline on the top shade, the corner square one below it, and at least one
    // octagon face — which at the coarsest size is the bare terrain.
    expect(seen).toContain(MAX_TEXTURE_SHADES);
    expect(seen).toContain(MAX_TEXTURE_SHADES - 1);
    expect([0, 1, 2].some((k) => seen.has(k))).toBe(true);
    // A 32px period holds exactly one octagon, so it reaches one face rank and no
    // more; every smaller size holds a 2x2 block of them and reaches all three.
    expect(Array.from(seen).sort()).toEqual(n === 1 ? [0, 3, 4] : [0, 1, 2, 3, 4]);
  });

it.each(GEO_SCALES.map((g) => g.id))('square draws grout and faces at motif size %i', (n) => {
    const seen = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) seen.add(textureShadeAt('square', x, y, 0, 1, 4, 3, 4, n));
    }
    // The 32px square IS the period, so it can only be one tile and one tone —
    // the first of the face ranks, which is the bare terrain, plus its joint. The
    // four tints it used to show there were dealt on a 16px lattice while the
    // grout stayed on the 32px one, i.e. four colours inside a single square with
    // no joint between them.
    expect(Array.from(seen).sort()).toEqual(n === 1 ? [0, 4] : [0, 1, 2, 3, 4]);
  });

  it('square arranges in 2x2 group pattern at seed 0 and randomly at seed > 0', () => {
    // At seed 0, n=2 (16px), the four 16x16 squares take the four face ranks in
    // reading order, starting from the bare terrain.
    expect(textureShadeAt('square', 2, 2, 0, 1, 4, 3, 4, 2)).toBe(0);
    expect(textureShadeAt('square', 18, 2, 0, 1, 4, 3, 4, 2)).toBe(1);
    expect(textureShadeAt('square', 2, 18, 0, 1, 4, 3, 4, 2)).toBe(2);
    expect(textureShadeAt('square', 18, 18, 0, 1, 4, 3, 4, 2)).toBe(3);

    // At seed > 0, cells are randomly assigned colors based on seed
    const shadesSeed1 = [
      textureShadeAt('square', 2, 2, 1, 1, 4, 3, 4, 2),
      textureShadeAt('square', 18, 2, 1, 1, 4, 3, 4, 2),
      textureShadeAt('square', 2, 18, 1, 1, 4, 3, 4, 2),
      textureShadeAt('square', 18, 18, 1, 1, 4, 3, 4, 2),
    ];
    for (const s of shadesSeed1) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(MAX_TEXTURE_SHADES);
    }
  });

  it('square puts its grout on the cell boundary at seed 0', () => {
    // Phased off the raw seed rather than the salted one, so the default grid is
    // aligned to the tile instead of cut across the middle of it. The salt's
    // offset is (17, 29), so a regression here moves the line to x=14 / y=2 —
    // seamless, but it does not look like "one square per tile" any more.
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const grout = x === 31 || y === 31;
        expect(textureShadeAt('square', x, y, 0, 1, 4, 3, 4, 1) === MAX_TEXTURE_SHADES).toBe(grout);
      }
    }
    // And a non-zero seed still moves it, so the dice is not dead.
    const print = (seed: number) => {
      let out = '';
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) out += textureShadeAt('square', x, y, seed, 1, 4, 3, 4, 1);
      }
      return out;
    };
    expect(print(5)).not.toBe(print(0));
  });

  it('square at its largest size makes one square of the whole tile', () => {
    // What was asked for: the biggest square IS the tile, so its grout lands on
    // the sheet's own seams and reads as a single-pixel grid across the map.
    // One grout line per axis, so exactly one row and one column are bare.
    let groutRows = 0;
    let groutCols = 0;
    for (let y = 0; y < 32; y++) {
      let all = true;
      for (let x = 0; x < 32; x++) {
        if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, 1) !== MAX_TEXTURE_SHADES) all = false;
      }
      if (all) groutRows++;
    }
    for (let x = 0; x < 32; x++) {
      let all = true;
      for (let y = 0; y < 32; y++) {
        if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, 1) !== MAX_TEXTURE_SHADES) all = false;
      }
      if (all) groutCols++;
    }
    expect(groutRows).toBe(1);
    expect(groutCols).toBe(1);
  });

  it('square keeps the grout one pixel wide at every size', () => {
    // Drawn on two sides of each cell, not four, so neighbours share it. Drawing
    // all four would double it up between every pair of squares.
    for (const { id: n } of GEO_SCALES) {
      const S = 32 / n;
      let grout = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, n) === MAX_TEXTURE_SHADES) grout++;
        }
      }
      // A one-pixel grid at pitch S over a 32x32 area: 32*n rows + 32*n columns,
      // less the n*n crossings counted twice.
      expect(grout).toBe(32 * n + 32 * n - n * n);
      expect(S * n).toBe(32);
    }
  });

  it('square gets smaller as the motif size drops', () => {
    // Counted as face area, i.e. everything that is not the joint. More motifs
    // means more joint, so less of the tile is face.
    const face = (n: number) => {
      let k = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (textureShadeAt('square', x, y, 0, 1, 4, 3, 4, n) !== MAX_TEXTURE_SHADES) k++;
        }
      }
      return k;
    };
    const sizes = GEO_SCALES.map((g) => face(g.id));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
  });

  // Non-slip was a traced 32x32 table whose content is really an 8x8 motif. It
  // lives here now, same as the other two: the generator must reproduce it pixel
  // for pixel at its natural size. Only remaining copy of the traced art.
  const NONSLIP_TRACED =
    '22042244220422442204224422042244' +
    '20042222200422222004222220042222' +
    '00422222004222220042222200422222' +
    '04222222042222220422222204222222' +
    '42220222422202224222022242220222' +
    '22220022222200222222002222220022' +
    '22224002222240022222400222224002' +
    '22222404222224042222240422222404' +
    '22042244220422442204224422042244' +
    '20042222200422222004222220042222' +
    '00422222004222220042222200422222' +
    '04222222042222220422222204222222' +
    '42220222422202224222022242220222' +
    '22220022222200222222002222220022' +
    '22224002222240022222400222224002' +
    '22222404222224042222240422222404' +
    '22042244220422442204224422042244' +
    '20042222200422222004222220042222' +
    '00422222004222220042222200422222' +
    '04222222042222220422222204222222' +
    '42220222422202224222022242220222' +
    '22220022222200222222002222220022' +
    '22224002222240022222400222224002' +
    '22222404222224042222240422222404' +
    '22042244220422442204224422042244' +
    '20042222200422222004222220042222' +
    '00422222004222220042222200422222' +
    '04222222042222220422222204222222' +
    '42220222422202224222022242220222' +
    '22220022222200222222002222220022' +
    '22224002222240022222400222224002' +
    '22222404222224042222240422222404';

  it('nonslip keeps the traced plate pixel for pixel at its natural size', () => {
    // A silhouette oracle since the 2026-08-09 reshading, same as octagonal's.
    // Which pixels are plate, dash core and dash shadow is still the traced art's
    // exactly; what moved is that the plate became the bare terrain and the four
    // shades were split between the two dash directions.
    //
    // The traced art's tones: 2 is the plate, 0 the dash core, 4 its shadow. It
    // does not distinguish the two dash directions — the generator does, which is
    // why this compares regions rather than tones.
    const region = (r: number) => (r === 0 ? 'plate' : r >= 3 ? 'core' : 'shadow');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const traced = NONSLIP_TRACED.charCodeAt(y * 32 + x) - 48;
        const want = traced === 2 ? 'plate' : traced === 0 ? 'core' : 'shadow';
        expect(`${x},${y} ${region(nonslipRank(x, y, naturalGeoScale('nonslip')))}`)
          .toBe(`${x},${y} ${want}`);
      }
    }
  });

  it('nonslip gives each dash direction its own core and shadow shade', () => {
    // What the four pickers mean, and the reason none of them is dead: shadows on
    // 1 and 2, cores on 3 and 4, the down-left dash taking the odd one of each
    // pair. Setting 1 = 2 and 3 = 4 gives back the plain two-tone plate.
    for (const n of geoScalesFor('nonslip').map((g) => g.id)) {
      const seen = new Set<number>();
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) seen.add(nonslipRank(x, y, n));
      }
      expect(Array.from(seen).sort()).toEqual([0, 1, 2, 3, 4]);
    }
    // The down-left dash runs along x + y and the down-right one along x - y, so
    // a pixel's shade has to agree with which of the two it sits on.
    const downLeft = new Set<number>();
    const downRight = new Set<number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const r = nonslipRank(x, y, 4);
        if (r === 1 || r === 3) downLeft.add(wrapN(x + y, 8));
        if (r === 2 || r === 4) downRight.add(wrapN(x - y, 8));
      }
    }
    // Each direction occupies a handful of adjacent diagonals and no more — the
    // core, its shadow, and the cap that bridges them.
    expect(downLeft.size).toBe(3);
    expect(downRight.size).toBe(3);
  });

  it('nonslip caps its dashes with one constant pixel at every size', () => {
    // The bug: the tail cap and the shadow's overhang were `4u` and `7u`, so they
    // grew with the motif. At 32px that put a four-pixel wedge on the end of a
    // stroke drawn with the same 2px nib as the 8px one. They are the rounding on
    // a stroke end, so they are one pixel whatever the size.
    //
    // Measured as the shadow's length minus the core's, along each dash: a
    // constant overhang means a constant difference.
    for (const n of geoScalesFor('nonslip').map((g) => g.id)) {
      const len = (want: readonly number[]) => {
        let k = 0;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) if (want.includes(nonslipRank(x, y, n))) k++;
        }
        return k;
      };
      // Core is 2 rows deep, shadow 1, so per unit of length the core lays down
      // two pixels and the shadow one. The cap adds its single pixel to both rows
      // of the shadow, which is what rounds the tip.
      const cells = (32 / (8 * Math.max(1, Math.round(4 / n)))) ** 2;
      const u = Math.max(1, Math.round(4 / n));
      const core = 3 * u;
      // Per cell, per direction: 2 * core core-pixels, and core + 1 + 1 shadow.
      expect(len([3, 4])).toBe(2 * core * 2 * cells);
      expect(len([1, 2])).toBe((core + 2) * 2 * cells);
    }
  });

  it('nonslip reads the density slider as dash length, not as a ramp scale', () => {
    // The one texture the control still shows, and the reason it does: it changes
    // the geometry rather than rounding the shade ladder, so no shade ever goes
    // dead however low it is set. Its cell size cannot do this job — that has to
    // divide 32, so it only offers 8, 16 and 32.
    expect(textureUsesAmount('nonslip')).toBe(true);
    const shades = (amount: number) => {
      const seen = new Set<number>();
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) seen.add(textureShadeAt('nonslip', x, y, 0, amount, 4, 3, 4, 4));
      }
      return seen;
    };
    for (const a of [1, 0.6, 0.3, 0.1]) {
      expect(`${a}: ${Array.from(shades(a)).sort().join('')}`).toBe(`${a}: 01234`);
    }
    // And it does shorten the dash, which is the whole point.
    expect(coverage('nonslip', 0.3)).toBeLessThan(coverage('nonslip', 1));
    // It opens on the full-length dash, the traced art, rather than inheriting
    // whatever a scatter field left the slider on.
    expect(naturalTextureAmount('nonslip')).toBe(1);
    expect(naturalTextureAmount('white')).toBe(DEFAULT_TEXTURE_AMOUNT);
  });

  it('nonslip is the 8px one of the family, and scales up only', () => {
    expect(naturalGeoScale('nonslip')).toBe(4);
    expect(32 / naturalGeoScale('nonslip')).toBe(8);
    expect(naturalGeoScale('isometric')).toBe(DEFAULT_GEO_SCALE);
    // square and octagonal are 32px art but open at 16: a 32px period holds one
    // motif each, so the four-shade deal has nothing to deal and two or three
    // swatches grey out the moment the texture is picked. The 32px size is still
    // in the list, it is just not where they start.
    for (const t of ['square', 'octagonal'] as const) {
      expect(naturalGeoScale(t)).toBe(2);
      expect(geoScalesFor(t).map((g) => g.id)).toContain(DEFAULT_GEO_SCALE);
    }
    // Its motif is built on an 8px cell in whole eighths, so 4px would put the
    // dash length and both dash offsets on half pixels. The list drops it rather
    // than clamping, which would leave a button that silently does nothing.
    expect(geoScalesFor('nonslip').map((g) => g.id)).not.toContain(8);
    expect(geoScalesFor('nonslip').map((g) => 32 / g.id)).toEqual([32, 16, 8]);
    expect(geoScalesFor('square')).toEqual(GEO_SCALES);
  });

  it.each(geoScalesFor('nonslip').map((g) => g.id))('nonslip repeats every 32 pixels at size %i', (n) => {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const base = nonslipRank(x, y, n);
        expect(nonslipRank(x + 32, y, n)).toBe(base);
        expect(nonslipRank(x, y - 32, n)).toBe(base);
      }
    }
  });

  it.each(geoScalesFor('nonslip').map((g) => g.id))('nonslip keeps its lines 2px thin at size %i', (n) => {
    // The decision this locks: the line WEIGHT does not scale, only the dash
    // length and the spacing. Scaling the weight too was rendered and rejected —
    // it turns 32px into coarse wedges. A core run across the band is 2 pixels
    // whatever the size, so the widest horizontal run of core stays 2.
    let widest = 0;
    for (let y = 0; y < 32; y++) {
      let run = 0;
      for (let x = 0; x < 64; x++) {
        run = nonslipRank(wrapN(x, 32), y, n) >= 3 ? run + 1 : 0;
        widest = Math.max(widest, run);
      }
    }
    expect(widest).toBe(2);
  });

  it.each(geoScalesFor('nonslip').map((g) => g.id))('nonslip draws both dash directions at size %i', (n) => {
    // Two dashes crossing, not one. Every dark pixel sits on a diagonal run, and
    // both diagonal directions have to be present or it is a single hatch.
    let down = 0;
    let up = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (nonslipRank(x, y, n) !== 0) continue;
        if (nonslipRank(wrapN(x + 1, 32), wrapN(y + 1, 32), n) === 0) down++;
        if (nonslipRank(wrapN(x - 1, 32), wrapN(y + 1, 32), n) === 0) up++;
      }
    }
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(0);
  });



  // Hexagon's traced table, kept as the reference rather than an oracle: the
  // generator is deliberately NOT byte-exact against it. The art ran a ring of
  // hand-placed "tip" pixels along each hexagon's slanted edges, one shade off
  // the face; merging them into the outline is what put hexagon on the same model
  // as the rest, and it is what these tests measure against. Only remaining copy
  // of the traced art.
  const HEXAGON_TRACED =
    '44442000000000002444444444444444' +
    '44440333333333330444444444444444' +
    '44401333333333331044444444444444' +
    '44203333333333333024444444444444' +
    '44033333333333333304444444444444' +
    '40133333333333333310444444444444' +
    '20333333333333333330244444444444' +
    '03333333333333333333044444444444' +
    '13333333333333333333100000000000' +
    '03333333333333333333022222222222' +
    '00333333333333333330022222222222' +
    '20133333333333333310222222222222' +
    '22033333333333333302222222222222' +
    '22003333333333333002222222222222' +
    '22201333333333331022222222222222' +
    '22220333333333330222222222222222' +
    '22220000000000000222222222222222' +
    '22220444444444440222222222222222' +
    '22202444444444442022222222222222' +
    '22004444444444444002222222222222' +
    '22044444444444444402222222222222' +
    '20244444444444444420222222222222' +
    '00444444444444444440022222222222' +
    '04444444444444444444022222222222' +
    '24444444444444444444200000000000' +
    '04444444444444444444044444444444' +
    '20444444444444444440244444444444' +
    '40244444444444444420444444444444' +
    '44044444444444444404444444444444' +
    '44204444444444444024444444444444' +
    '44402444444444442044444444444444' +
    '44440444444444440444444444444444';

  /**
   * The traced art with each face's tip pixels folded into the outline: inside a
   * face, any pixel whose rank is not the face's majority rank was a tip.
   */
  const hexMerged = () => {
    const at = (x: number, y: number) =>
      HEXAGON_TRACED.charCodeAt(wrapN(y, 32) * 32 + wrapN(x, 32)) - 48;
    const out = new Array(1024).fill(0);
    const seen = new Set<number>();
    for (let sy = 0; sy < 32; sy++) {
      for (let sx = 0; sx < 32; sx++) {
        const k0 = sy * 32 + sx;
        if (at(sx, sy) === 0 || seen.has(k0)) continue;
        const q = [[sx, sy]];
        seen.add(k0);
        const tally = new Map<number, number>();
        for (let i = 0; i < q.length; i++) {
          const [cx, cy] = q[i];
          tally.set(at(cx, cy), (tally.get(at(cx, cy)) ?? 0) + 1);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = wrapN(cx + dx, 32);
            const ny = wrapN(cy + dy, 32);
            const k = ny * 32 + nx;
            if (seen.has(k) || at(nx, ny) === 0) continue;
            seen.add(k);
            q.push([nx, ny]);
          }
        }
        let major = 0;
        let best = -1;
        for (const [rank, count] of tally) if (count > best) { best = count; major = rank; }
        for (const [cx, cy] of q) out[cy * 32 + cx] = at(cx, cy) === major ? major : 0;
      }
    }
    return out;
  };

  it('hexagon differs from the traced art only in where a diagonal step lands', () => {
    // The whole justification for hexagon not being byte-exact. Two things have
    // to hold, and they are what make the deviation harmless:
    //   1. every disagreement is outline-versus-face, never face-versus-face, so
    //      no region is ever the wrong colour;
    //   2. the tone census is identical, i.e. the pixels are swapped, not lost.
    // The count is locked exactly so any change to the model shows up here.
    // Compared as a PARTITION rather than tone for tone: the traced art coloured
    // the four face slots with three tones, giving one of them two slots, and all
    // four are distinct now. So what has to hold is that the faces are cut in the
    // same places — every got-tone maps to exactly one traced tone, i.e. the new
    // colouring only ever splits a traced region, never merges two.
    const want = hexMerged();
    let diff = 0;
    const gotCensus = new Array(5).fill(0);
    const toTraced = new Map<number, number>();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        // The traced art inks its outline as tone 0; the generator inks it as the
        // top rank, so the two are compared as "is this pixel outline" rather than
        // by tone.
        const got = hexagonRank(x, y, naturalGeoScale('hexagon'));
        const gotLine = got === MAX_TEXTURE_SHADES;
        const w = want[y * 32 + x];
        gotCensus[got]++;
        if (gotLine === (w === 0)) {
          if (!gotLine) {
            expect(toTraced.get(got) ?? w).toBe(w);
            toTraced.set(got, w);
          }
          continue;
        }
        // The only disagreements left are outline-versus-face, which is the
        // diagonal-step story: 16 pixels swapped each way, none lost.
        diff++;
      }
    }
    expect(diff).toBe(32);
    // Four faces, three traced tones behind them — the art used one of them twice.
    expect(new Set(toTraced.values()).size).toBe(3);
    expect(gotCensus).toEqual([221, 221, 221, 221, 140]);
  });

  it('hexagon gives each of its four faces a tone of its own', () => {
    // The traced art tinted the four face slots with three tones, so one covered
    // twice the area of the others and one swatch was dead. A hex grid needs three
    // colours to avoid a collision and this lattice offers four slots, so the
    // fourth is free — see HEX_FACES for the adjacency argument. The outline sits
    // on the top rank and the first face is the bare terrain.
    const counts = new Array(5).fill(0);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) counts[hexagonRank(x, y, 1)]++;
    }
    expect(counts).toEqual([221, 221, 221, 221, 140]);
  });

  it.each(geoScalesFor('hexagon').map((g) => g.id))(
    'hexagon colours a face the same on both sides of a seam at size %i', (n) => {
      // The bug this exists for: going 32px right is (column, row) -> (c+2, r-1),
      // so indexing the face tone by the row parity alone flips it across every
      // seam and one hexagon comes out two colours. 52 pixels were wrong before
      // the floor(c/2) term went in.
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const base = hexagonRank(x, y, n);
          expect(hexagonRank(x + 32, y, n)).toBe(base);
          expect(hexagonRank(x, y + 32, n)).toBe(base);
          expect(hexagonRank(x - 32, y - 32, n)).toBe(base);
        }
      }
    });

  it.each(geoScalesFor('hexagon').map((g) => g.id))(
    'hexagon draws every face tone at size %i', (n) => {
      const counts = new Map<number, number>();
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const k = hexagonRank(x, y, n);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
      // Outline plus all four faces, and the outline never swallows them — which
      // is what the smallest offered size is bounded to avoid.
      for (const k of [0, 1, 2, 3, MAX_TEXTURE_SHADES]) {
        expect(counts.get(k) ?? 0).toBeGreaterThan(0);
      }
      expect(counts.get(MAX_TEXTURE_SHADES)!).toBeLessThan(0.75 * 1024);
    });

  it('hexagon keeps its flat edges one pixel wide', () => {
    // The horizontal walls are axis-aligned, so a half-pixel threshold has to
    // rasterise them to exactly one row. The slanted walls come out two wide
    // where the step falls, which is a rasterised diagonal, not a fat line.
    let flatRuns = 0;
    for (let y = 0; y < 32; y++) {
      let run = 0;
      for (let x = 0; x < 32; x++) {
        run = hexagonRank(x, y, 1) === MAX_TEXTURE_SHADES ? run + 1 : 0;
      }
      if (run >= 10) flatRuns++;      // a full flat edge spans the hexagon's top
    }
    expect(flatRuns).toBeGreaterThan(0);
    for (let x = 0; x < 32; x++) {
      let run = 0;
      let widest = 0;
      for (let y = 0; y < 64; y++) {
        run = hexagonRank(x, wrapN(y, 32), 1) === MAX_TEXTURE_SHADES ? run + 1 : 0;
        widest = Math.max(widest, run);
      }
      expect(widest).toBeLessThan(5);  // no column is a thick vertical bar
    }
  });

  it.each(geoScalesFor('brick_bond').map((g) => g.id))(
    'brick_bond uses the terrain for the face and all four shades on top at size %i', (n) => {
      // The point of this texture: the brick is the ground. Rank 0 is the face,
      // and every one of the four shades has a job — highlight, shadow, bed
      // joint, head joint. A shade that never appears is a wasted colour picker.
      const counts = new Map<number, number>();
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const k = brickBondRank(x, y, n);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
      // Bed joint, head joint, bottom shadow and the face are always there. The
      // top highlight is the one that gives way on the smallest brick, where four
      // rows cannot hold a joint, two bevels and any face at all.
      for (const k of [0, 2, 3, 4]) expect(counts.get(k) ?? 0).toBeGreaterThan(0);
      expect(counts.get(1) ?? 0).toBeGreaterThan(n === 4 ? -1 : 0);
      if (n === 4) expect(counts.get(1) ?? 0).toBe(0);
      // The face has to stay the majority of the brick, or it is all bevel.
      expect(counts.get(0)!).toBeGreaterThan(1024 / 5);
    });

  it.each(geoScalesFor('brick_bond').map((g) => g.id))(
    'brick_bond offsets every other course by half a brick at size %i', (n) => {
      // What makes it a running bond rather than a stack bond. Read the head
      // joints off each course and check the shift, rather than trusting the
      // formula that produced them.
      const bw = 32 / n;
      const bh = 16 / n;
      const headsOf = (course: number) => {
        const y = course * bh + 1;          // a row inside the brick, below the bed
        const at: number[] = [];
        for (let x = 0; x < 32; x++) if (brickBondRank(x, wrapN(y, 32), n) === 4) at.push(x);
        return at;
      };
      const courses = 32 / bh;
      for (let c = 0; c + 1 < courses; c++) {
        const a = headsOf(c);
        const b = headsOf(c + 1);
        expect(a.length).toBe(32 / bw);
        expect(b.length).toBe(32 / bw);
        // Every head joint moved by half a brick, modulo the brick width.
        expect(b.map((v) => wrapN(v - bw / 2, bw)).sort()).toEqual(a.map((v) => wrapN(v, bw)).sort());
      }
    });

  it.each(geoScalesFor('brick_bond').map((g) => g.id))(
    'brick_bond keeps both joints one pixel wide at size %i', (n) => {
      const bh = 16 / n;
      // The bed joint is one unbroken row per course, and nothing else is a full row.
      let fullRows = 0;
      for (let y = 0; y < 32; y++) {
        let all = true;
        for (let x = 0; x < 32; x++) if (brickBondRank(x, y, n) !== 3) all = false;
        if (all) fullRows++;
      }
      expect(fullRows).toBe(32 / bh);
      // And no head joint is wider than a pixel.
      for (let y = 0; y < 32; y++) {
        let run = 0;
        for (let x = 0; x < 64; x++) {
          run = brickBondRank(wrapN(x, 32), y, n) === 4 ? run + 1 : 0;
          expect(run).toBeLessThan(2);
        }
      }
    });

  it('brick_bond lets the bed joint win where the two joints cross', () => {
    // A T-junction takes the bed joint's shade, which is what the traced
    // BRICK_WALL does — its horizontal mortar rows run unbroken. Drawing the head
    // joint through instead chops every course line into dashes.
    const n = naturalGeoScale('brick_bond');
    const bh = 16 / n;
    for (let y = 0; y < 32; y += bh) {
      for (let x = 0; x < 32; x++) expect(brickBondRank(x, y, n)).toBe(3);
    }
  });

  it.each(geoScalesFor('brick_bond').map((g) => g.id))(
    'brick_bond repeats every 32 pixels at size %i', (n) => {
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const base = brickBondRank(x, y, n);
          expect(brickBondRank(x + 32, y, n)).toBe(base);
          expect(brickBondRank(x, y - 32, n)).toBe(base);
        }
      }
    });

  it('brick_bond opens on the proportions of the traced art, and scales from there', () => {
    // 16x8 bricks, which is what BRICK_WALL was drawn at.
    expect(naturalGeoScale('brick_bond')).toBe(2);
    expect(32 / naturalGeoScale('brick_bond')).toBe(16);
    // 4x2 is not offered: one bed-joint row plus the two bevel rows is three of
    // the four, so there would be no face left.
    expect(geoScalesFor('brick_bond').map((g) => 32 / g.id)).toEqual([32, 16, 8]);
  });

  it('offers only motif sizes that tile the sheet on whole pixels', () => {
    for (const { id } of GEO_SCALES) {
      expect(32 % id).toBe(0);
      expect((32 / id) % 2).toBe(0);
    }
    expect(GEO_SCALES[0].id).toBe(DEFAULT_GEO_SCALE);
  });

  it('takes the size control on the generated pavings only', () => {
    expect(textureUsesGeoScale('isometric')).toBe(true);
    expect(textureUsesGeoScale('octagonal')).toBe(true);
    expect(textureUsesGeoScale('square')).toBe(true);
    // hexagon joined them once its hand-placed edge tips were merged into the
    // outline; before that no distance rule could reproduce it (best fit left
    // 131 of 1024 pixels wrong and plateaued there).
    expect(textureUsesGeoScale('hexagon')).toBe(true);
    expect(textureUsesGeoScale('paving')).toBe(false);
  });
});

describe('texture colour', () => {
  it('lightens a dark terrain and darkens a light one', () => {
    // Direction follows luminance, so it stays visible on any palette. A
    // saturated deep blue sits high in HSV *value* while reading almost black —
    // picking by value would push it the wrong way.
    const lum = (c: { r: number; g: number; b: number }) =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum(textureColour(DEEP_BLUE, 1))).toBeGreaterThan(lum(DEEP_BLUE));
    expect(lum(textureColour(NEAR_WHITE, 1))).toBeLessThan(lum(NEAR_WHITE));
  });

  it('is the identity at 0 and grows with t', () => {
    expect(toHexColour(textureColour(DEEP_BLUE, 0))).toBe(toHexColour(DEEP_BLUE));
    const lum = (c: { r: number; g: number; b: number }) =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    let prev = lum(DEEP_BLUE);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const v = lum(textureColour(DEEP_BLUE, t));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('stays inside the byte range at full strength on extremes', () => {
    for (const c of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, DEEP_BLUE]) {
      const out = textureColour(c, 1);
      for (const v of [out.r, out.g, out.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('reachable shades', () => {
  it('reports nothing for no texture', () => {
    expect(usedTextureShades('none', 1, 4).size).toBe(0);
  });

  it.each(ALGOS)('%s reports exactly the shades it paints', (algo) => {
    // The set has to agree with the pixels, or a swatch is crossed out while
    // still colouring something (or worse, left live while inert).
    for (const amount of [0.2, 0.4, 1]) {
      const used = usedTextureShades(algo, amount, 4);
      const p = texturePeriod(algo);
      const seen = new Set<number>();
      for (let y = 0; y < p; y++) {
        for (let x = 0; x < p; x++) seen.add(textureShadeAt(algo, x, y, 0, amount, 4));
      }
      expect([...used].sort()).toEqual([...seen].sort());
    }
  });

  it('shows a ramp-scaling texture losing its top shades as density drops', () => {
    // The reason this exists. `cells` scales its ramp, so at low density the top
    // of the ramp is simply never painted and its swatches must say so.
    expect(usedTextureShades('cells', 1, 4)).toContain(4);
    expect(usedTextureShades('cells', 0.4, 4)).not.toContain(4);
    expect(usedTextureShades('cells', 0.4, 4)).toContain(1);
  });
});

describe('texture ramp', () => {
  const GRASS = { r: 93, g: 168, b: 50 };
  const YELLOW = { r: 240, g: 220, b: 90 };

  it('starts on the terrain colour and ends on the picked one', () => {
    const ramp = textureRamp(GRASS, YELLOW, 4);
    expect(ramp).toHaveLength(5);
    expect(toHexColour(ramp[0])).toBe(toHexColour(GRASS));
    expect(toHexColour(ramp[4])).toBe(toHexColour(YELLOW));
  });

  it('reaches a colour the terrain could never be shifted into', () => {
    // The point of picking: a derived shade can only brighten or darken the
    // terrain, so it can never carry an unrelated hue.
    const picked = textureRamp(GRASS, YELLOW, 1)[1];
    const derived = textureColour(GRASS, 1);
    expect(picked.r).toBeGreaterThan(derived.r * 2);
  });

  it('moves monotonically toward the target on every channel', () => {
    const ramp = textureRamp(GRASS, YELLOW, 4);
    for (let k = 1; k < ramp.length; k++) {
      expect(ramp[k].r).toBeGreaterThanOrEqual(ramp[k - 1].r);
      expect(ramp[k].b).toBeGreaterThanOrEqual(ramp[k - 1].b);
    }
  });

  it('substitutes a hand-picked step and leaves the rest derived', () => {
    // The point of per-step overrides: one swatch changed must not detach the
    // others from the terrain colour they follow.
    const plain = textureRamp(GRASS, YELLOW, 4);
    const picked = textureRamp(GRASS, YELLOW, 4, [undefined, undefined, DEEP_BLUE]);
    expect(toHexColour(picked[2])).toBe(toHexColour(DEEP_BLUE));
    for (const k of [0, 1, 3, 4]) {
      expect(toHexColour(picked[k])).toBe(toHexColour(plain[k]));
    }
  });

  it('falls back to the derived shift when nothing is picked', () => {
    const ramp = textureRamp(GRASS, undefined, 4);
    for (let k = 0; k <= 4; k++) {
      expect(toHexColour(ramp[k])).toBe(toHexColour(textureColour(GRASS, k / 4)));
    }
  });

  it('never divides by zero on a degenerate shade count', () => {
    expect(textureRamp(GRASS, YELLOW, 0)).toHaveLength(2);
    for (const c of textureRamp(GRASS, YELLOW, 0)) {
      for (const v of [c.r, c.g, c.b]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('texture applied to a tile', () => {
  const paint = (tex: Partial<typeof NO_TEXTURE>) =>
    paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, {
      tileSize: 16, texture: { ...NO_TEXTURE, ...tex },
    });
  const paint32 = (
    tex: Partial<typeof NO_TEXTURE>,
    noises: readonly NoiseId[] = [],
    noiseSeed = 0,
  ) => paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, {
    tileSize: 32, texture: { ...NO_TEXTURE, ...tex }, noises, noiseSeed,
  });

  const roleAt = (p: number, tileSize = 32) => {
    const level = patternLevelsForMask(DEFAULT_PATTERN, 110, 0, tileSize, 3).charCodeAt(p) - 48;
    return level === 0 ? 'terrainB' : level === 4 ? 'terrainA' : 'band';
  };

  it('ignores an override array left over from a different step count', () => {
    // A stale array would recolour the wrong steps, so the painter drops any
    // whose length does not match the current count.
    const stale = [undefined, DEEP_BLUE, DEEP_BLUE, DEEP_BLUE, DEEP_BLUE];
    const withStale = paint({ algoA: 'cells', amountA: 1, shadesA: 2, rampA: stale });
    const withNone = paint({ algoA: 'cells', amountA: 1, shadesA: 2 });
    expect(Array.from(withStale)).toEqual(Array.from(withNone));
  });

  it('recolours only the step it was given', () => {
    const base = paint({ algoA: 'cells', amountA: 1, shadesA: 2 });
    const one = paint({
      algoA: 'cells', amountA: 1, shadesA: 2,
      rampA: [undefined, DEEP_BLUE, undefined],
    });
    let changed = 0;
    for (let i = 0; i < base.length; i += 4) if (base[i] !== one[i]) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(base.length / 4);
  });

  it('is inert when off', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, { tileSize: 16 });
    expect(Array.from(paint({}))).toEqual(Array.from(bare));
    expect(Array.from(paint({ algoA: 'white', algoB: 'white', amountA: 0, amountB: 0 })))
      .toEqual(Array.from(bare));
  });

  it('changes the solid interior but leaves the band alone', () => {
    const bare = paintPatternTileRGBA(DEFAULT_PATTERN, 110, REFERENCE_ROLE_COLOURS, { tileSize: 16 });
    const tex = paint({ algoA: 'white', algoB: 'white', amountA: 0.6 });
    const bandColours = new Set(patternRamp(REFERENCE_ROLE_COLOURS, 3).slice(1, -1).map(toHexColour));
    let changed = 0;
    for (let i = 0; i < bare.length; i += 4) {
      const before = toHexColour({ r: bare[i], g: bare[i + 1], b: bare[i + 2] });
      const after = toHexColour({ r: tex[i], g: tex[i + 1], b: tex[i + 2] });
      if (before !== after) {
        changed++;
        expect(bandColours.has(before)).toBe(false); // only solid pixels moved
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('textures each terrain independently', () => {
    const onlyA = paint({ algoA: 'white', algoB: 'white', amountA: 0.6, amountB: 0 });
    const onlyB = paint({ algoA: 'white', algoB: 'white', amountA: 0, amountB: 0.6 });
    expect(Array.from(onlyA)).not.toEqual(Array.from(onlyB));
  });

  it('Water keeps the body, picked line colour, and pale dot as separate layers', () => {
    const edge = { r: 245, g: 245, b: 245 };
    const dot = { r: 255, g: 230, b: 90 };
    const water = paint32({
      algoA: 'water', amountA: 1, shadesA: 2,
      rampA: [undefined, edge, dot],
    });
    const base = REFERENCE_ROLE_COLOURS.terrainA;
    let edgePixels = 0;
    let dotPixels = 0;
    for (let p = 0; p < 32 * 32; p++) {
      if (roleAt(p) !== 'terrainA') continue;
      const i = p * 4;
      const rgb = [water[i], water[i + 1], water[i + 2]];
      expect([
        [base.r, base.g, base.b],
        [edge.r, edge.g, edge.b],
        [dot.r, dot.g, dot.b],
      ]).toContainEqual(rgb);
      if (rgb[0] === edge.r && rgb[1] === edge.g && rgb[2] === edge.b) edgePixels++;
      if (rgb[0] === dot.r && rgb[1] === dot.g && rgb[2] === dot.b) dotPixels++;
    }
    expect(edgePixels).toBeGreaterThan(0);
    expect(dotPixels).toBeGreaterThan(0);
  });

  it('gives terrain A and B independent shade counts', () => {
    const base = paint32({
      algoA: 'paving', algoB: 'paving', amountA: 1, amountB: 1,
      shadesA: 1, shadesB: 4,
    });
    const changedA = paint32({
      algoA: 'paving', algoB: 'paving', amountA: 1, amountB: 1,
      shadesA: 4, shadesB: 4,
    });
    let aDiff = 0;
    for (let p = 0; p < 32 * 32; p++) {
      const i = p * 4;
      if (roleAt(p) === 'terrainB') {
        expect(Array.from(changedA.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      } else if (roleAt(p) === 'terrainA') {
        if (base[i] !== changedA[i] || base[i + 1] !== changedA[i + 1] || base[i + 2] !== changedA[i + 2]) aDiff++;
      }
    }
    expect(aDiff).toBeGreaterThan(0);
  });

  it('gives terrain A and B independent texture seeds', () => {
    const base = paint32({
      algoA: 'white', algoB: 'white', amountA: 1, amountB: 1, seedA: 7, seedB: 11,
    });
    const changedA = paint32({
      algoA: 'white', algoB: 'white', amountA: 1, amountB: 1, seedA: 8, seedB: 11,
    });
    let aDiff = 0;
    for (let p = 0; p < 32 * 32; p++) {
      const i = p * 4;
      if (roleAt(p) === 'terrainB') {
        expect(Array.from(changedA.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      } else if (roleAt(p) === 'terrainA') {
        if (base[i] !== changedA[i] || base[i + 1] !== changedA[i + 1] || base[i + 2] !== changedA[i + 2]) aDiff++;
      }
    }
    expect(aDiff).toBeGreaterThan(0);
  });

  it('keeps texture seeds independent from band noise seed', () => {
    const tex = (seedA: number, seedB: number) =>
      ({ algoA: 'white' as const, algoB: 'white' as const, amountA: 1, amountB: 1, seedA, seedB });
    const base = paint32(tex(7, 11), ['white'], 21);
    const changedTexture = paint32(tex(8, 12), ['white'], 21);
    const changedNoise = paint32(tex(7, 11), ['white'], 22);
    for (let p = 0; p < 32 * 32; p++) {
      const i = p * 4;
      if (roleAt(p) === 'band') {
        expect(Array.from(changedTexture.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      } else {
        expect(Array.from(changedNoise.subarray(i, i + 4))).toEqual(Array.from(base.subarray(i, i + 4)));
      }
    }
  });

  it('leaves the background tile flat unless terrain B is textured', () => {
    const flat = paintPatternTileRGBA(DEFAULT_PATTERN, -1, REFERENCE_ROLE_COLOURS, {
      tileSize: 16, texture: { ...NO_TEXTURE, algoA: 'white', algoB: 'white', amountA: 1 },
    });
    const b = REFERENCE_ROLE_COLOURS.terrainB;
    for (let i = 0; i < flat.length; i += 4) {
      expect([flat[i], flat[i + 1], flat[i + 2]]).toEqual([b.r, b.g, b.b]);
    }
  });

  it('ripple_diag exhibits diagonal correlation and 32px periodicity', () => {
    expect(texturePeriod('ripple_diag')).toBe(32);
    expect(coverage('ripple_diag', 0.5)).toBeGreaterThan(0);

    // Verify 32px periodicity explicitly
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const val = textureShadeAt('ripple_diag', x, y, 42, 0.5);
        expect(textureShadeAt('ripple_diag', x + 32, y, 42, 0.5)).toBe(val);
        expect(textureShadeAt('ripple_diag', x, y + 32, 42, 0.5)).toBe(val);
      }
    }
  });
});
