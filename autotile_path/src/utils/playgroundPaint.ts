/** One integer cell coordinate in the playground. */
export interface GridCell {
  col: number;
  row: number;
}

/**
 * Every grid cell crossed by a stroke segment, including both endpoints.
 * Bresenham's algorithm keeps rapid pointer/touch moves from leaving holes
 * between the browser's coalesced move events — which for a path editor is not
 * cosmetic, since a hole in the stroke is a break in the network.
 */
export function cellsAlongSegment(from: GridCell, to: GridCell): GridCell[] {
  const cells: GridCell[] = [];
  let col = from.col;
  let row = from.row;
  const dCol = Math.abs(to.col - col);
  const dRow = Math.abs(to.row - row);
  const stepCol = col < to.col ? 1 : -1;
  const stepRow = row < to.row ? 1 : -1;
  let error = dCol - dRow;

  for (;;) {
    cells.push({ col, row });
    if (col === to.col && row === to.row) return cells;
    const twiceError = error * 2;
    if (twiceError > -dRow) {
      error -= dRow;
      col += stepCol;
    }
    if (twiceError < dCol) {
      error += dCol;
      row += stepRow;
    }
  }
}
