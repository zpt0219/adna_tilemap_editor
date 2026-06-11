// types.ts — the `.adnapalettepack` data contract (see
// tile_map_editor_imgui/web/blueprint_to_palette.md §7). A pack is a zip of
// manifest.json + palettes.json + atlas.png (+ atlas.adnastyle, unused here).

/** Palette::Mode ints from the engine (src/core/palette.h). Only the ones that
 *  appear in the shipped pack matter; the rest are listed for completeness. */
export enum PaletteMode {
  QUAD = 0,
  TWO_EDGE = 1,
  TWO_CORNER = 2,
  BLOB_6_8 = 3,
  BLOB_7_7 = 4,
  CLIFF = 5,
  NINE_PATCH = 6,
  FREE = 7,
  FIXED_RECT = 8,
  CONTOUR = 9,
  DUNGEON = 10,
  EDGE_CLIFF = 11,
  HOUSE1 = 12,
  CHAIN = 13,
  H_STRETCH = 15,
  V_STRETCH = 16,
}

/** One entry of manifest.json `palettes[]`. */
export interface ManifestPalette {
  index: number;
  hash: string;
  originalHash?: string;
  mode: number;
  role: string;
  style: string;
  rect: { x: number; y: number; w: number; h: number };
}

export interface PackManifest {
  kind: string;
  atlas: { path: string; width: number; height: number; tileResolution: number; styleSidecar?: string };
  paletteCount: number;
  palettes: ManifestPalette[];
}

/** One entry of palettes.json `palettes[]` (the renderable definition). */
export interface PaletteRecord {
  hash: string;
  mode: number;
  size: [number, number];
  tileResolution: number;
  edge?: [number, number];
  stratum?: string;
  mappingMatrix: { width: number; height: number; data_b64: string };
  tags?: Record<string, string>;
}

/** Decoded mapping grid: cell (i,j) → atlas pixel coord. `cells` holds
 *  [x0,y0,x1,y1,…] row-major (2 ints per cell). */
export interface MappingMatrix {
  width: number;
  height: number;
  cells: Int32Array;
}

/** A merged, decoded palette (manifest entry ⋈ palettes.json record). */
export interface Palette {
  hash: string;
  mode: PaletteMode;
  role: string;
  style: string;
  size: [number, number];
  tileResolution: number;
  /** nine-slice border width per axis; [-1,-1] = auto (floor((size-1)/2)) */
  edge: [number, number];
  mapping: MappingMatrix;
  /** lazily-built 16-entry autotile LUT (bit → flat atlas-xy index*2); P2 only */
  lut?: Int32Array;
}

/** Everything the renderer needs once a pack is loaded. */
export interface PackRuntime {
  atlas: ImageBitmap;
  tileResolution: number;
  palettes: Palette[];
}

/** Read an atlas pixel coord [x,y] for mapping grid cell (i,j). */
export function mappingCell(m: MappingMatrix, i: number, j: number): [number, number] {
  const k = (j * m.width + i) * 2;
  return [m.cells[k], m.cells[k + 1]];
}
