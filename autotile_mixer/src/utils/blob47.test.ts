import { describe, it, expect } from 'vitest';
import {
  N, E, S, W, NE, SE, SW, NW,
  canonicalizeBlobMask,
  BLOB47_MASKS,
  BLOB47_LAYOUT,
  BLOB47_COLS,
  BLOB47_ROWS,
  BLOB47_BACKGROUND,
  blobIndexForMask,
  blobSlotForMask,
  blobWeightAt,
} from './blob47';

const ALL_EDGES = N | E | S | W;
const ALL_MASKS = Array.from({ length: 256 }, (_, m) => m);

/** Sample the field on an interior grid and fingerprint it. */
function fieldSignature(mask: number, cornerRounding = 0, steps = 12): string {
  const out: string[] = [];
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const tx = (i + 0.5) / steps;
      const ty = (j + 0.5) / steps;
      out.push(blobWeightAt(tx, ty, mask, { radius: 0.5, cornerRounding }).toFixed(6));
    }
  }
  return out.join(',');
}

describe('mask algebra', () => {
  it('collapses the 256 neighbourhoods onto exactly 47 canonical masks', () => {
    const canonical = new Set(ALL_MASKS.map(canonicalizeBlobMask));
    expect(canonical.size).toBe(47);
    expect(BLOB47_MASKS).toHaveLength(47);
    expect([...canonical].sort((a, b) => a - b)).toEqual(BLOB47_MASKS);
  });

  it('is idempotent', () => {
    for (const m of ALL_MASKS) {
      expect(canonicalizeBlobMask(canonicalizeBlobMask(m))).toBe(canonicalizeBlobMask(m));
    }
  });

  it('keeps a corner bit only when both adjacent edges are set', () => {
    expect(canonicalizeBlobMask(N | E | NE)).toBe(N | E | NE);
    expect(canonicalizeBlobMask(N | NE)).toBe(N);          // E missing -> NE dropped
    expect(canonicalizeBlobMask(E | NE)).toBe(E);          // N missing -> NE dropped
    expect(canonicalizeBlobMask(NE)).toBe(0);
    expect(canonicalizeBlobMask(0xff)).toBe(0xff);         // everything connected
  });

  it('indexes every raw mask into 0..46', () => {
    for (const m of ALL_MASKS) {
      const idx = blobIndexForMask(m);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(47);
      expect(BLOB47_MASKS[idx]).toBe(canonicalizeBlobMask(m));
    }
  });
});

describe('sheet layout', () => {
  it('fills a 6x8 sheet with every canonical mask and no background slot', () => {
    expect(BLOB47_ROWS * BLOB47_COLS).toBe(48);
    expect(BLOB47_LAYOUT).toHaveLength(48);
    // A terrain-B cell draws no tile, so the sheet carries no background entry.
    expect(BLOB47_LAYOUT).not.toContain(BLOB47_BACKGROUND);
    expect(new Set(BLOB47_LAYOUT)).toEqual(new Set(BLOB47_MASKS));
  });

  it('spends its one spare slot on a second copy of the solid tile', () => {
    const counts = new Map<number, number>();
    for (const m of BLOB47_LAYOUT) counts.set(m, (counts.get(m) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n > 1);
    expect(repeated).toEqual([[0xff, 2]]);
  });

  it('resolves every raw mask to a slot holding that mask', () => {
    for (const m of ALL_MASKS) {
      const slot = blobSlotForMask(m);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(48);
      expect(BLOB47_LAYOUT[slot]).toBe(canonicalizeBlobMask(m));
    }
  });
});

describe('distance field', () => {
  // The load-bearing property: the geometry must dedupe exactly the way the
  // combinatorics does, or 47 tiles would not be enough to cover 256 contexts.
  // See docs/AUTOTILE_SCHEMES.md §5.3.
  it('produces exactly 47 distinct fields across all 256 neighbourhoods', () => {
    expect(new Set(ALL_MASKS.map((m) => fieldSignature(m))).size).toBe(47);
  });

  it('ignores non-canonical corner bits', () => {
    for (const m of ALL_MASKS) {
      expect(fieldSignature(m)).toBe(fieldSignature(canonicalizeBlobMask(m)));
    }
  });

  // Rounding is applied only between orthogonal pairs precisely so this still
  // holds — smoothing a diagonal in would silently reintroduce 256 classes.
  it('still ignores them with corner rounding enabled', () => {
    for (const m of ALL_MASKS) {
      expect(fieldSignature(m, 0.4)).toBe(fieldSignature(canonicalizeBlobMask(m), 0.4));
    }
    expect(new Set(ALL_MASKS.map((m) => fieldSignature(m, 0.4))).size).toBe(47);
  });

  it('is solid when every neighbour is terrain A', () => {
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const w = blobWeightAt((i + 0.5) / 8, (j + 0.5) / 8, 0xff, { radius: 0.5 });
        expect(w).toBe(1);
      }
    }
  });

  it('ramps away from an open border', () => {
    // North open, everything else connected: weight must grow with depth.
    const mask = canonicalizeBlobMask(E | S | W);
    const shallow = blobWeightAt(0.5, 0.05, mask, { radius: 0.5 });
    const mid = blobWeightAt(0.5, 0.2, mask, { radius: 0.5 });
    const deep = blobWeightAt(0.5, 0.8, mask, { radius: 0.5 });
    expect(shallow).toBeLessThan(mid);
    expect(mid).toBeLessThan(deep);
    expect(deep).toBe(1);
    expect(shallow).toBeCloseTo(0.05 / 0.5, 6);
  });

  it('cuts an inner corner notch when a diagonal is missing', () => {
    const withDiag = ALL_EDGES | NE | SE | SW | NW;      // fully solid
    const withoutNE = ALL_EDGES | SE | SW | NW;          // NE diagonal is terrain B
    // Near the NE corner (tx -> 1, ty -> 0).
    expect(blobWeightAt(0.95, 0.05, withDiag, { radius: 0.5 })).toBe(1);
    expect(blobWeightAt(0.95, 0.05, withoutNE, { radius: 0.5 })).toBeLessThan(1);
    // The notch is local — the opposite corner is untouched.
    expect(blobWeightAt(0.05, 0.95, withoutNE, { radius: 0.5 })).toBe(1);
  });

  it('rounds outer corners only when asked', () => {
    // N and E both open -> convex corner at the NE of the cell.
    const mask = canonicalizeBlobMask(S | W);
    const at = (k: number) => blobWeightAt(0.75, 0.25, mask, { radius: 0.5, cornerRounding: k });
    expect(at(0.4)).toBeLessThan(at(0));
  });

  it('stays within [0, 1]', () => {
    for (const m of ALL_MASKS) {
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 6; i++) {
          const w = blobWeightAt((i + 0.5) / 6, (j + 0.5) / 6, m, { radius: 0.5, cornerRounding: 0.4 });
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
