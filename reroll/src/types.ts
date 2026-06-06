// Blueprint JSON data contracts — mirrored from the flywheel's blueprint schema
// as consumed by scripts/render_overlay.py (the no-engine PIL preview that MVP 0
// reproduces in the browser). See WEB_LITE_REROLL_EDITOR.md §2.1–2.2.
//
// A blueprint object describes geometry by role + one or more of: rect, cells,
// points. render_overlay.py draws all present shapes (the ifs are independent).
// We keep unknown fields untyped/pass-through (forward-compat, §4.5).

export type Vec2 = [number, number];
export type Rect = [number, number, number, number]; // [x, y, w, h] in tile coords

export interface BlueprintObject {
  role?: string;
  /** discriminates FRG scatter (subtle cells) from terrain/road/water (opaque) */
  type?: string;
  shape?: string;
  rect?: Rect;
  cells?: Vec2[];
  points?: Vec2[];
  label?: string;
  // any other authoring fields are preserved but unused by the viewer
  [k: string]: unknown;
}

export interface BlueprintLayer {
  name?: string;
  objects?: BlueprintObject[];
  layers?: BlueprintLayer[];
}

export interface BlueprintRoot extends BlueprintLayer {
  width?: number;
  height?: number;
  map_size?: Vec2 | { width?: number; height?: number };
  fidelity?: unknown;
  source_image?: string;
}

/** Top-level file: either the root directly, or wrapped under `blueprint`. */
export interface BlueprintFile extends BlueprintRoot {
  blueprint?: BlueprintRoot;
}

/** A blueprint loaded into the viewer: the root plus a resolved canvas size. */
export interface LoadedBlueprint {
  name: string;
  root: BlueprintRoot;
  width: number; // tiles
  height: number; // tiles
  /** true when width/height came from content AABB, not the blueprint root */
  sizeInferred: boolean;
}
