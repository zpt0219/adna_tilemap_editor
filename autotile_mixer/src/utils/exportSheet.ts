import { BLOB47_LAYOUT, BLOB47_COLS, BLOB47_ROWS, blobSlotForMask } from './blob47';
import { type Recipe } from './recipe';
import { strToU8, zipSync } from 'fflate';

export interface SheetExportData {
  app: string;
  version: number;
  sheet: {
    file: string;
    tileSize: number;
    columns: number;
    rows: number;
    slots: number;
  };
  bits: {
    N: number;
    E: number;
    S: number;
    W: number;
    NE: number;
    SE: number;
    SW: number;
    NW: number;
  };
  layout: number[];
  maskToSlot: number[];
  recipe: Recipe;
}

export function buildSheetExportData(recipe: Recipe): SheetExportData {
  const maskToSlot: number[] = new Array(256);
  for (let mask = 0; mask < 256; mask++) {
    maskToSlot[mask] = blobSlotForMask(mask);
  }

  const fileName = `tileset_blob47_${recipe.patternId}_${recipe.tileSize}px.png`;

  return {
    app: 'autotile_blob47',
    version: 1,
    sheet: {
      file: fileName,
      tileSize: recipe.tileSize,
      columns: BLOB47_COLS,
      rows: BLOB47_ROWS,
      slots: BLOB47_LAYOUT.length,
    },
    bits: {
      N: 1,
      E: 2,
      S: 4,
      W: 8,
      NE: 16,
      SE: 32,
      SW: 64,
      NW: 128,
    },
    layout: Array.from(BLOB47_LAYOUT),
    maskToSlot,
    recipe,
  };
}

export function downloadJsonFile(filename: string, data: unknown) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

/** Bundle the rendered sheet, engine mapping metadata, and editable recipe. */
export async function downloadSheetBundle(canvas: HTMLCanvasElement, recipe: Recipe) {
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png');
  });
  const data = buildSheetExportData(recipe);
  const dataName = `tileset_blob47_${recipe.patternId}_${recipe.tileSize}px.json`;
  const pngName = data.sheet.file;
  const zip = zipSync({
    [pngName]: new Uint8Array(await png.arrayBuffer()),
    [dataName]: strToU8(JSON.stringify(data, null, 2)),
  });
  downloadBlob(`tileset_blob47_${recipe.patternId}_${recipe.tileSize}px.zip`, new Blob([zip], { type: 'application/zip' }));
}
