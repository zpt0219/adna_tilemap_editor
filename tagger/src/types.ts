// Data contracts mirrored from the engine's .adnatags bundle
// (see docs/WEB_ASSET_TAGGER_PLAN.md, docs/TAG_SYSTEM_DESIGN.md).

export interface Grid {
  cols: number;
  cell_w: number;
  cell_h: number;
  swatch: number;
  pad: number;
  label_h: number;
  per_sheet: number;
}

export interface PaletteEntry {
  index: number;
  hash: string;
  mode: string;
}

export interface Manifest {
  palette_set: string;
  tile_size: number;
  grid: Grid;
  sheet: string[];
  palettes: PaletteEntry[];
}

export interface TreeNode {
  id: string;
  label?: string;
  object_type?: string;
  feeds_modes?: string[];
  stratum?: string; // "ground" | "vertical" — declared per node in the engine tree
  children: TreeNode[];
}

export interface TagTree {
  version: number;
  scope?: string;
  categories: TreeNode[];
}

// One palette's tags as edited in the tool. role is a tree path string
// ("nature_prop/tree/pine"); style is a free, multi-value array.
export type TagStatus = "empty" | "ai_suggested" | "human_verified";

export interface PaletteTags {
  role: string;
  style: string[];
  status: TagStatus;
}

// Shape of tags.json (in-bundle current tags) and final_tags.json (export),
// plus any external tag file loaded via "Load tags".
export interface TagsFile {
  palette_set: string;
  palette_tags: { index: number; role?: string; style?: string[] | string }[];
}

// Fully-parsed bundle held in app state.
export interface ParsedBundle {
  name: string;
  manifest: Manifest;
  tree: TagTree | null;
  sheetUrls: string[]; // object URLs, indexed to match manifest.sheet order
  tagData: Record<number, PaletteTags>;
}
