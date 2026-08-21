import { strToU8, zipSync } from 'fflate';
import { SHEET_TILE_SIZE } from './renderSheet';
import { SHEET_COLS, SHEET_ROWS, TWO_EDGE_LAYOUT, slotForBits } from './twoEdge';
import { RECIPE_VERSION, type Recipe } from './recipe';

export interface SheetExportData {
  app: string;
  version: number;
  scheme: 'two-edge-network' | 'two-edge-area';
  sheet: { file: string; tileSize: number; columns: number; rows: number; slots: number };
  bits: { N: number; E: number; S: number; W: number };
  layout: number[];
  /** bits -> slot, all 16 entries, so an importer needs no bit arithmetic. */
  bitsToSlot: number[];
  recipe: Recipe;
}

const BASE_NAME = `tileset_path2edge_${SHEET_TILE_SIZE}px`;

export function buildSheetExportData(recipe: Recipe): SheetExportData {
  return {
    app: 'autotile_path',
    version: RECIPE_VERSION,
    // Named because the same 16 masks also serve the AREA reading, where the
    // art means something else entirely. An importer that guesses wrong gets a
    // tileset that looks plausible and connects wrongly.
    scheme: recipe.edge.scheme === 'area' ? 'two-edge-area' : 'two-edge-network',
    sheet: {
      file: `${BASE_NAME}.png`,
      tileSize: SHEET_TILE_SIZE,
      columns: SHEET_COLS,
      rows: SHEET_ROWS,
      slots: TWO_EDGE_LAYOUT.length,
    },
    bits: { N: 1, E: 2, S: 4, W: 8 },
    layout: Array.from(TWO_EDGE_LAYOUT),
    bitsToSlot: Array.from({ length: 16 }, (_, bits) => slotForBits(bits)),
    recipe,
  };
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJsonFile(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

/** Bundle the rendered sheet with the mapping an engine needs to place it. */
export async function downloadSheetBundle(canvas: HTMLCanvasElement, recipe: Recipe) {
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((v) => (v ? resolve(v) : reject(new Error('PNG export failed'))), 'image/png');
  });
  const data = buildSheetExportData(recipe);
  const zip = zipSync({
    [data.sheet.file]: new Uint8Array(await png.arrayBuffer()),
    [`${BASE_NAME}.json`]: strToU8(JSON.stringify(data, null, 2)),
  });
  downloadBlob(`${BASE_NAME}.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }));
}
