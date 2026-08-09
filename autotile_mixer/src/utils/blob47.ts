// blob47.ts — cell-based 8-neighbour autotile (47 tiles) synthesized from two
// terrain textures by a distance field. See docs/AUTOTILE_SCHEMES.md.
//
// This is a THIRD model, not an extension of the existing "blob 13+1" in
// tiles.ts — that one is corner-Wang (dual-grid) wearing a blob label (§7).
// Here the cell itself is terrain A and the 8 neighbours decide how its borders
// are treated, so boundaries land ON the cell edges rather than through the
// tile interior.

// ---------------------------------------------------------------------------
// Bit layout (§8) — mirrors the engine's Dir4/Corner4 ordering in misc.cpp.
// ---------------------------------------------------------------------------
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
export const NE = 16;
export const SE = 32;
export const SW = 64;
export const NW = 128;

/** The four (corner bit, required edge bits) pairs. A corner only carries
 *  information when both of its adjacent edges connect. */
const CORNER_DEPS: [number, number][] = [
  [NE, N | E],
  [SE, S | E],
  [SW, S | W],
  [NW, N | W],
];

/**
 * Drop corner bits whose two adjacent edges are not both set — they cannot
 * affect the rendered tile (proof in §5.3), so the 256 raw neighbourhoods
 * collapse onto exactly 47 canonical masks.
 */
export function canonicalizeBlobMask(mask: number): number {
  let m = mask & 0xff;
  for (const [corner, deps] of CORNER_DEPS) {
    if ((m & deps) !== deps) m &= ~corner;
  }
  return m;
}

/** The 47 canonical masks, ascending. Order defines the sheet layout. */
export const BLOB47_MASKS: number[] = (() => {
  const seen = new Set<number>();
  for (let m = 0; m < 256; m++) seen.add(canonicalizeBlobMask(m));
  return [...seen].sort((a, b) => a - b);
})();

const MASK_TO_INDEX: Int16Array = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let m = 0; m < 256; m++) {
    table[m] = BLOB47_MASKS.indexOf(canonicalizeBlobMask(m));
  }
  return table;
})();

/** 0..46 for any of the 256 raw neighbourhood masks. */
export function blobIndexForMask(mask: number): number {
  return MASK_TO_INDEX[mask & 0xff];
}

// ---------------------------------------------------------------------------
// Sheet layout — 6 rows x 8 cols = 48 slots.
// ---------------------------------------------------------------------------
export const BLOB47_COLS = 8;
export const BLOB47_ROWS = 6;

/** Sentinel for "no tile" — the cell is plain terrain B, i.e. the layer below. */
export const BLOB47_BACKGROUND = -1;

/**
 * The conventional blob47 sheet order: adjacent slots continue each other, so
 * the sheet reads as one coherent picture instead of 48 loose tiles, and it
 * interchanges with tilesets authored to the same convention.
 *
 * All 47 canonical masks appear. The solid tile (255) fills the two slots the
 * arrangement leaves spare, and there is deliberately **no background slot** —
 * a terrain-B cell draws no tile at all.
 */
export const BLOB47_LAYOUT: number[] = [
    6,  10,  46,  76,  38, 110,  78,  12,
    7,  14,  31, 175, 127, 255, 205,   5,
   39,  79,  15,  63, 223, 159, 141,   1,
   23, 143,  13,  55, 239, 111,  77,   4,
    3,  11,  47,  95, 191, 255, 207,   9,
    0,   2,  27, 137,  19, 155, 139,   8,
];

const MASK_TO_SLOT: Int16Array = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let m = 0; m < 256; m++) {
    table[m] = BLOB47_LAYOUT.indexOf(canonicalizeBlobMask(m));
  }
  return table;
})();

/** Sheet slot (0..47) holding the tile for a raw neighbourhood mask. */
export function blobSlotForMask(mask: number): number {
  return MASK_TO_SLOT[mask & 0xff];
}

// ---------------------------------------------------------------------------
// Distance field
// ---------------------------------------------------------------------------

export interface BlobFieldParams {
  /** Transition band width in cell units. Must stay < 1 or the field would
   *  depend on cells outside the 3x3 that blob47 encodes (§6.2). */
  radius: number;
  /** Smooth-min k for convex (outer) corners. 0 = sharp 90° corners (§6.3). */
  cornerRounding?: number;
}

/** Euclidean distance from a point to an axis-aligned box; 0 when inside. */
function boxDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}


/** Neighbour cell offsets, in the same order as the edge bits. */
const ORTHO: [number, number, number][] = [
  [0, -1, N],
  [1, 0, E],
  [0, 1, S],
  [-1, 0, W],
];

const DIAGONAL: [number, number, number][] = [
  [1, -1, NE],
  [1, 1, SE],
  [-1, 1, SW],
  [-1, -1, NW],
];

/** Adjacent edge-bit pairs that form a convex corner when both are open. */
const CONVEX_PAIRS: [number, number][] = [
  [0, 1], // N + E
  [1, 2], // E + S
  [2, 3], // S + W
  [3, 0], // W + N
];

/**
 * Coverage of terrain A at (tx, ty) inside the centre cell, where tx/ty are in
 * [0, 1] cell units with y pointing down. Returns 1 deep inside A, ramping to 0
 * across the boundary band.
 *
 * The field is the clamped distance to the union of the neighbouring cells that
 * are NOT terrain A. Straight edges, rounded inner corners and outer corners all
 * fall out of that one expression (§5.2).
 *
 * Invariance: diagonals are folded in with a plain min, and corner rounding is
 * applied only between *orthogonal* pairs. So a diagonal bit can never influence
 * the result unless both of its adjacent edges are set — the field depends only
 * on canonicalizeBlobMask(mask), which is what makes 47 tiles sufficient.
 * Rounding diagonals too would break that and silently reintroduce 256 classes.
 */
export function blobWeightAt(
  tx: number,
  ty: number,
  mask: number,
  params: BlobFieldParams
): number {
  const { radius, cornerRounding = 0 } = params;

  // Distance to each open orthogonal neighbour (Infinity when it is terrain A).
  const orthoDist = [Infinity, Infinity, Infinity, Infinity];
  for (let i = 0; i < 4; i++) {
    const [dx, dy, bit] = ORTHO[i];
    if (mask & bit) continue;
    orthoDist[i] = boxDist(tx, ty, dx, dy, dx + 1, dy + 1);
  }

  let d = Math.min(orthoDist[0], orthoDist[1], orthoDist[2], orthoDist[3]);

  for (const [dx, dy, bit] of DIAGONAL) {
    if (mask & bit) continue;
    d = Math.min(d, boxDist(tx, ty, dx, dy, dx + 1, dy + 1));
  }

  if (cornerRounding > 0) {
    const r = cornerRounding;
    for (const [a, b] of CONVEX_PAIRS) {
      const da = orthoDist[a];
      const db = orthoDist[b];
      if (da < r && db < r) {
        const dCorner = r - Math.hypot(r - da, r - db);
        d = Math.min(d, dCorner);
      }
    }
  }

  if (!isFinite(d)) return 1; // every neighbour is terrain A — solid interior
  return Math.max(0, Math.min(1, d / radius));
}
