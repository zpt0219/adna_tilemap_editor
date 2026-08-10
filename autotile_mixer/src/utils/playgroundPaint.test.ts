import { describe, expect, it } from 'vitest';
import { cellsAlongSegment } from './playgroundPaint';

describe('cellsAlongSegment', () => {
  it('fills every crossed cell in a fast horizontal stroke', () => {
    expect(cellsAlongSegment({ col: 1, row: 3 }, { col: 5, row: 3 })).toEqual([
      { col: 1, row: 3 }, { col: 2, row: 3 }, { col: 3, row: 3 },
      { col: 4, row: 3 }, { col: 5, row: 3 },
    ]);
  });

  it('connects diagonal endpoints and includes each endpoint once', () => {
    const cells = cellsAlongSegment({ col: 1, row: 1 }, { col: 4, row: 4 });
    expect(cells).toEqual([
      { col: 1, row: 1 }, { col: 2, row: 2 },
      { col: 3, row: 3 }, { col: 4, row: 4 },
    ]);
  });
});
