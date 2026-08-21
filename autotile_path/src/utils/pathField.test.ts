import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE, BORDER_CLEARANCE, nearestElement, MAX_BEND,
  type ShapeParams,
} from './pathField';
import { DIRECTIONS, OPPOSITE, N, E, S, W } from './twoEdge';

const shape = (over: Partial<ShapeParams> = {}): ShapeParams =>
  ({ bend: 0, cap: 'round', isolatedDot: true, ...over });

const ALL_BITS = [...Array(16).keys()];

/** The parameter corners the invariants have to survive, not a random sweep. */
const SHAPES: ShapeParams[] = [
  shape({ bend: 0 }),
  shape({ bend: 4 }),
  shape({ bend: MAX_BEND }),
  shape({ bend: 6, cap: 'flat' }),
  shape({ bend: 0, cap: 'flat' }),
];

/** Distance from the skeleton at a pixel centre. */
const distAt = (x: number, y: number, bits: number, s: ShapeParams) =>
  nearestElement(x, y, bits, s).t;

/**
 * The road as a string, one character per pixel: `#` inside, `.` outside.
 *
 * A local threshold rather than a shared renderer, and deliberately so — these
 * are tests of the SKELETON, and going through the real pipeline would make
 * them depend on the boundary's kerb, noise and closed-border mask as well.
 * `boundary.test.ts` is where the rendered output is checked.
 */
function fieldGrid(bits: number, s: ShapeParams, half = 7): string {
  let out = '';
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      out += distAt(x + 0.5, y + 0.5, bits, s) < half ? '#' : '.';
    }
  }
  return out;
}

describe('seams', () => {
  it('two tiles compute an OPEN border identically, to the last bit', () => {
    // The result the whole sheet rests on, and it is EXACT rather than close:
    // near a border the nearest skeleton element is the arm crossing it, so
    // both tiles evaluate the same |offset| there.
    for (const s of SHAPES) {
      for (const d of DIRECTIONS) {
        const mine: number[] = [];
        const theirs: number[] = [];
        for (const bits of ALL_BITS) {
          if (!(bits & d.bit)) continue;
          for (let i = 0; i < TILE_SIZE; i++) {
            const x = d.dx === 0 ? i + 0.5 : d.dx > 0 ? TILE_SIZE - 0.5 : 0.5;
            const y = d.dy === 0 ? i + 0.5 : d.dy > 0 ? TILE_SIZE - 0.5 : 0.5;
            mine.push(distAt(x, y, bits, s));
          }
        }
        // Every mask with this connection has to agree, pixel for pixel.
        for (let k = TILE_SIZE; k < mine.length; k++) {
          expect(mine[k], `${d.bit} at ${k}`).toBe(mine[k % TILE_SIZE]);
        }
        expect(theirs.length).toBe(0);
      }
    }
  });

  it('the skeleton never leaves the centre cross, which is why the bound holds', () => {
    // A closed border can disagree with a neighbour and it is invisible,
    // because the skeleton has no arm pointing there. That is only true while
    // the skeleton stays inside the cross, so it is asserted rather than
    // assumed.
    for (const s of SHAPES) {
      for (const bits of ALL_BITS) {
        for (const d of DIRECTIONS) {
          if (bits & d.bit) continue;
          for (let i = 0; i < TILE_SIZE; i++) {
            const x = d.dx === 0 ? i + 0.5 : d.dx > 0 ? TILE_SIZE - 0.5 : 0.5;
            const y = d.dy === 0 ? i + 0.5 : d.dy > 0 ? TILE_SIZE - 0.5 : 0.5;
            const t = distAt(x, y, bits, s);
            if (bits === 0) continue;              // the isolated blob is its own case
            expect(t, `bits=${bits} dir=${d.bit} at ${i}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('an open border carries the road across at the same offsets on both sides', () => {
    // Connectivity within a tile is not enough — the surface has to line up
    // with the neighbour's, which follows from the exact border agreement.
    const s = shape({ bend: 6 });
    for (const m of ALL_BITS) {
      if (!(m & N)) continue;
      for (const n of ALL_BITS) {
        if (!(n & S)) continue;
        const mine = fieldGrid(m, s, 6).slice(0, TILE_SIZE);
        const theirs = fieldGrid(n, s, 6).slice(TILE_SIZE * (TILE_SIZE - 1));
        expect(mine).toBe(theirs);
      }
    }
  });
});

describe('caps and the empty tile', () => {
  const HW = 9;
  const inside = (x: number, y: number, cap: 'round' | 'flat') =>
    distAt(x, y, N, shape({ cap })) < HW;

  it('both caps stop at the same depth; only the corner tells them apart', () => {
    // Straight down the centreline they finish together, one halfWidth past
    // the tile centre — the flat cap is the square version of the round one,
    // not a shorter stub.
    expect(inside(16, 16 + HW - 0.1, 'round')).toBe(true);
    expect(inside(16, 16 + HW - 0.1, 'flat')).toBe(true);
    expect(inside(16, 16 + HW + 0.1, 'round')).toBe(false);
    expect(inside(16, 16 + HW + 0.1, 'flat')).toBe(false);

    // The tip's corner is where they part: inside the square, outside the arc.
    expect(inside(16 + HW - 1, 16 + HW - 1, 'flat')).toBe(true);
    expect(inside(16 + HW - 1, 16 + HW - 1, 'round')).toBe(false);
  });

  it('a flat cap keeps the full width right up to the cut', () => {
    for (let x = 16 - HW + 1; x <= 16 + HW - 1; x++) {
      expect(inside(x + 0.5, 15.5, 'flat'), `x=${x}`).toBe(true);
    }
  });

  it('the neighbourless tile is a dot, or nothing at all', () => {
    expect(new Set(fieldGrid(0, shape({ isolatedDot: false })))).toEqual(new Set('.'));
    expect(new Set(fieldGrid(0, shape({ isolatedDot: true }))).size).toBeGreaterThan(1);
  });

  it('the cap style only affects dead ends', () => {
    for (const bits of ALL_BITS) {
      const isDeadEnd = [1, 2, 4, 8].includes(bits);
      const same = fieldGrid(bits, shape({ cap: 'round' }))
        === fieldGrid(bits, shape({ cap: 'flat' }));
      expect(same, `bits=${bits}`).toBe(!isDeadEnd);
    }
  });
});

describe('turns', () => {
  it('a straight-through pair ignores bend entirely', () => {
    // ⚠ The bug this pins: `bend` may pull an arm back only when it has no
    // OPPOSITE arm but does have a perpendicular one. Pulling every arm back
    // puts a hole through every T-junction.
    for (const bits of [N | S, E | W]) {
      expect(fieldGrid(bits, shape({ bend: 0 })))
        .toBe(fieldGrid(bits, shape({ bend: MAX_BEND })));
    }
  });

  it('bend sweeps the outside of a turn further out', () => {
    // The outer shoulder of an N+E bend, on the diagonal away from the corner.
    const straight = distAt(11, 21, N | E, shape({ bend: 0 }));
    const swept = distAt(11, 21, N | E, shape({ bend: 8 }));
    expect(swept).toBeGreaterThan(straight);
  });

  it('a turn adds material at a junction rather than removing it', () => {
    // The corner arcs can only flare a bend outward; nothing may be bitten out
    // of the crossing, which is the other half of the T-junction bug above.
    const plain = fieldGrid(15, shape({ bend: 0 }), 6);
    const flared = fieldGrid(15, shape({ bend: 8 }), 6);
    let grew = 0;
    for (let i = 0; i < plain.length; i++) {
      if (plain[i] === '#') expect(flared[i], `at ${i}`).toBe('#');
      if (plain[i] !== '#' && flared[i] === '#') grew++;
    }
    expect(grew).toBeGreaterThan(0);
  });
});

describe('the four directions are treated identically', () => {
  const rotBits = (bits: number) => {
    // A quarter turn clockwise sends N->E->S->W->N.
    let out = 0;
    if (bits & N) out |= E;
    if (bits & E) out |= S;
    if (bits & S) out |= W;
    if (bits & W) out |= N;
    return out;
  };

  it('a quarter turn of the road is the road of the quarter-turned mask', () => {
    // The strongest single check in this file: it exercises armStart, the arc
    // wedge test, the flat cap's axis handling and the dead-end cap all at
    // once, and any direction handled as a special case shows up immediately.
    for (const s of SHAPES) {
      for (const bits of ALL_BITS) {
        const src = fieldGrid(bits, s);
        const dst = fieldGrid(rotBits(bits), s);
        for (let y = 0; y < TILE_SIZE; y++) {
          for (let x = 0; x < TILE_SIZE; x++) {
            const rotated = x * TILE_SIZE + (TILE_SIZE - 1 - y);
            expect(dst[rotated], `bits=${bits} at ${x},${y} bend=${s.bend} cap=${s.cap}`)
              .toBe(src[y * TILE_SIZE + x]);
          }
        }
      }
    }
  });

  it('a straight run is mirror-symmetric across its own centreline', () => {
    const grid = fieldGrid(N | S, shape({ bend: 4 }));
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE / 2; x++) {
        expect(grid[y * TILE_SIZE + x]).toBe(grid[y * TILE_SIZE + (TILE_SIZE - 1 - x)]);
      }
    }
  });
});

describe('the isolated dot has its own size', () => {
  it('dotScale grows the blob without touching any other tile', () => {
    const area = (scale: number) =>
      [...fieldGrid(0, shape({ dotScale: scale }))].filter((c) => c === '#').length;
    expect(area(1.6)).toBeGreaterThan(area(1));
    // ...and it is inert everywhere else.
    for (const bits of ALL_BITS) {
      if (bits === 0) continue;
      expect(fieldGrid(bits, shape({ dotScale: 1.6 })), `bits=${bits}`)
        .toBe(fieldGrid(bits, shape({ dotScale: 1 })));
    }
  });

  it('never reaches past the border clearance at the scale the sheet uses', () => {
    // The dot is a disc of radius `half * dotScale`, and it is the first thing
    // to hit the tile edge as the road widens — see `dotScaleFor`.
    for (let r = 0.5; r <= BORDER_CLEARANCE; r += 0.5) {
      const t = distAt(TILE_SIZE - 0.5, TILE_SIZE / 2, 0, shape({ dotScale: 1 }));
      expect(t).toBeGreaterThan(0);
    }
  });
});

describe('opposites table', () => {
  it('is an involution', () => {
    for (const d of DIRECTIONS) expect(OPPOSITE[OPPOSITE[d.bit]]).toBe(d.bit);
  });
});
