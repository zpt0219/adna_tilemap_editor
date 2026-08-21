import { describe, it, expect } from 'vitest';
import { TWO_EDGE_LAYOUT, SHEET_COLS, SHEET_ROWS, slotForBits, bitsAt, bitsLabel, N, E, S, W } from './twoEdge';

describe('sheet layout', () => {
  it('is 4x4 and holds every mask exactly once', () => {
    expect(TWO_EDGE_LAYOUT).toHaveLength(SHEET_COLS * SHEET_ROWS);
    expect([...TWO_EDGE_LAYOUT].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
  });

  it('matches the engine matrix it was copied from', () => {
    // src/core/palette.cpp, mirrored in reroll/src/pack/autotile.ts. Locked so
    // the exported PNG stays drop-in for a TERRAIN_2_EDGE palette; if this ever
    // has to change, the engine side changes with it.
    expect(TWO_EDGE_LAYOUT).toEqual([
      4, 6, 14, 12,
      5, 7, 15, 13,
      1, 3, 11, 9,
      0, 2, 10, 8,
    ]);
  });

  it('slotForBits inverts the layout', () => {
    for (let bits = 0; bits < 16; bits++) {
      expect(TWO_EDGE_LAYOUT[slotForBits(bits)]).toBe(bits);
    }
  });
});

describe('bitsAt', () => {
  //  . X .
  //  X X X    a plus centred at (1,1)
  //  . X .
  const cols = 3, rows = 3;
  const cells = [0, 1, 0, 1, 1, 1, 0, 1, 0];

  it('reads the four orthogonal neighbours', () => {
    expect(bitsAt(cells, cols, rows, 1, 1)).toBe(N | E | S | W);
    expect(bitsAt(cells, cols, rows, 1, 0)).toBe(S);
    expect(bitsAt(cells, cols, rows, 0, 1)).toBe(E);
  });

  it('ignores diagonals — that is the whole scheme', () => {
    const diag = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(bitsAt(diag, cols, rows, 1, 1)).toBe(0);
  });

  it('outsideConnected decides whether the border is a dead end', () => {
    // The top-middle cell: its E and W neighbours are empty either way, so only
    // the N bit — the one facing off the map — is allowed to change.
    expect(bitsAt(cells, cols, rows, 1, 0, false)).toBe(S);
    expect(bitsAt(cells, cols, rows, 1, 0, true)).toBe(N | S);
  });
});

describe('bitsLabel', () => {
  it('names a mask by its directions', () => {
    expect(bitsLabel(0)).toBe('·');
    expect(bitsLabel(N | E)).toBe('NE');
    expect(bitsLabel(15)).toBe('NESW');
    expect(bitsLabel(W)).toBe('W');
  });
});
