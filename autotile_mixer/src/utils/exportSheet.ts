import { BLOB47_LAYOUT, BLOB47_COLS, BLOB47_ROWS, blobSlotForMask } from './blob47';
import { type Recipe } from './recipe';

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
