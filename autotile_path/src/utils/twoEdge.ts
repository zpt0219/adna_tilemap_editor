// twoEdge.ts — the 2-edge Wang scheme in its NETWORK reading.
//
// A cell is a piece of path. The four orthogonal neighbours say which way the
// path continues, so the four bits are directions of travel, not "the terrain
// carries on over there". That is the whole difference from the area reading
// (docs/AUTOTILE_SCHEMES.md §1) and it is why this app exists: the same 16
// masks, a completely different shape per mask.
//
// 16 masks, no canonicalisation — every combination of four bits is a distinct
// piece. Nothing collapses the way blob47's 256 collapse to 47.

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

/** Unit offsets per bit, y pointing down. Order fixes nothing but readability. */
export const DIRECTIONS: readonly { bit: number; dx: number; dy: number; id: 'N' | 'E' | 'S' | 'W' }[] = [
  { bit: N, dx: 0, dy: -1, id: 'N' },
  { bit: E, dx: 1, dy: 0, id: 'E' },
  { bit: S, dx: 0, dy: 1, id: 'S' },
  { bit: W, dx: -1, dy: 0, id: 'W' },
];

/** The bit facing back at you from the neighbour in that direction. */
export const OPPOSITE: Record<number, number> = { [N]: S, [E]: W, [S]: N, [W]: E };

export const SHEET_COLS = 4;
export const SHEET_ROWS = 4;

/**
 * Sheet order, lifted verbatim from the engine's `TWO_EDGE_MATRIX`
 * (`src/core/palette.cpp`, mirrored in `reroll/src/pack/autotile.ts`), where
 * `MATRIX[row][col]` is the neighbour-bit value that grid cell (col, row)
 * serves.
 *
 * Copied rather than invented so the exported 128x128 PNG drops straight into a
 * `TERRAIN_2_EDGE` palette with no remapping. A prettier arrangement would cost
 * exactly that interchange, which is the only reason this app's output is worth
 * more than a screenshot.
 */
export const TWO_EDGE_LAYOUT: readonly number[] = [
  4, 6, 14, 12,
  5, 7, 15, 13,
  1, 3, 11, 9,
  0, 2, 10, 8,
];

const SLOT_FOR_BITS: readonly number[] = (() => {
  const t = new Array<number>(16).fill(-1);
  TWO_EDGE_LAYOUT.forEach((bits, slot) => { t[bits] = slot; });
  return t;
})();

/** Sheet slot 0..15 for a neighbour mask. */
export function slotForBits(bits: number): number {
  return SLOT_FOR_BITS[bits & 0x0f];
}

/** Human-readable name, used by the sheet preview's labels. */
export function bitsLabel(bits: number): string {
  const s = DIRECTIONS.filter((d) => bits & d.bit).map((d) => d.id).join('');
  return s === '' ? '·' : s;
}

/**
 * Neighbour mask for one cell of a path map. `cells[r * cols + c]` is truthy
 * where the path is present.
 *
 * `outsideConnected` decides what lies past the map border: false makes the
 * border a dead end, true makes every path run off the edge. Both are wanted —
 * the first is right for a finished map, the second for judging a tile in
 * isolation — so it is a parameter rather than a convention.
 */
export function bitsAt(
  cells: ArrayLike<number>,
  cols: number,
  rows: number,
  c: number,
  r: number,
  outsideConnected = false
): number {
  let bits = 0;
  for (const { bit, dx, dy } of DIRECTIONS) {
    const nc = c + dx;
    const nr = r + dy;
    const outside = nc < 0 || nr < 0 || nc >= cols || nr >= rows;
    const on = outside ? outsideConnected : cells[nr * cols + nc] !== 0;
    if (on) bits |= bit;
  }
  return bits;
}
