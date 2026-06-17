import {
  HOUSE_DECO_ROLES,
  type HouseData,
  type HouseDecoration,
  type HouseDecorationKind,
  type Rect,
} from "./model";
import type { Palette } from "./pack/types";
import { axisIndex } from "./pack/slice";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sizeOf = (p: Palette | null | undefined): [number, number] => (p ? p.size : [1, 1]);

export function wallHeightOf(house: HouseData, h: number): number {
  return clamp(house.wallHeight, 1, Math.max(1, h - 1));
}

export function decorationRole(kind: HouseDecorationKind): string | null {
  return kind === "any" ? null : HOUSE_DECO_ROLES[kind];
}

export function clampDecoCell(rectW: number, rectH: number, sz: [number, number], cell: [number, number]): [number, number] {
  return [clamp(cell[0], 0, Math.max(0, rectW - sz[0])), clamp(cell[1], 0, Math.max(0, rectH - sz[1]))];
}

export function effectiveDecorationCell(house: HouseData, rect: Rect, index: number, palette: Palette | null): [number, number] {
  return clampDecoCell(rect[2], rect[3], sizeOf(palette), house.decorations[index]?.cell ?? [0, 0]);
}

export function decorationWorldRect(house: HouseData, rect: Rect, index: number, palette: Palette | null): Rect | null {
  if (!palette) return null;
  const [cx, cy] = effectiveDecorationCell(house, rect, index, palette);
  return [rect[0] + cx, rect[1] + cy, palette.size[0], palette.size[1]];
}

export function decorationAt(house: HouseData, rect: Rect, deco: (Palette | null)[], wx: number, wy: number): number {
  for (let index = house.decorations.length - 1; index >= 0; index--) {
    const r = decorationWorldRect(house, rect, index, deco[index] ?? null);
    if (r && wx >= r[0] && wx < r[0] + r[2] && wy >= r[1] && wy < r[1] + r[3]) return index;
  }
  return -1;
}

export function autoWallOverlapRows(
  rectW: number,
  rectH: number,
  wallHeight: number,
  roof: Palette | null,
  isRoofCellEmpty: ((col: number, row: number) => boolean) | null,
): number {
  if (!roof || !isRoofCellEmpty) return 0;
  const roofH = rectH - wallHeight;
  if (roofH <= 0) return 0;
  const ex = roof.edge[0] >= 0 ? roof.edge[0] : Math.floor((roof.size[0] - 1) / 2);
  const ey = roof.edge[1] >= 0 ? roof.edge[1] : Math.floor((roof.size[1] - 1) / 2);
  let maxRun = 0;
  for (let col = 0; col < rectW; col++) {
    const pc = axisIndex(col, rectW, ex, roof.size[0]);
    let run = 0;
    let sawSolid = false;
    for (let row = roofH - 1; row >= 0; row--) {
      const pr = axisIndex(row, roofH, ey, roof.size[1]);
      if (isRoofCellEmpty(pc, pr)) {
        run++;
      } else {
        sawSolid = true;
        break;
      }
    }
    if (!sawSolid) return 1;
    if (run > maxRun) maxRun = run;
  }
  return Math.min(maxRun, roofH);
}

export function wallOverlapRows(
  house: HouseData,
  rect: Rect,
  roof: Palette | null = null,
  isRoofCellEmpty: ((col: number, row: number) => boolean) | null = null,
): number {
  const wallH = wallHeightOf(house, rect[3]);
  if (house.overlap >= 0) return clamp(house.overlap, 0, rect[3] - wallH);
  return autoWallOverlapRows(rect[2], rect[3], wallH, roof, isRoofCellEmpty);
}

export function regionForPart(house: HouseData, rect: Rect, part: 0 | 1, overlapRows = Math.max(0, house.overlap)): Rect {
  const [ox, oy, w, h] = rect;
  const wallH = wallHeightOf(house, h);
  if (part === 0) {
    const wallTop = Math.max(0, h - wallH - overlapRows);
    return [ox, oy + wallTop, w, h - wallTop];
  }
  return [ox, oy, w, Math.max(0, h - wallH)];
}

export function makeHouse(_w: number, h: number): HouseData {
  const wallHeight = Math.max(1, Math.floor(h / 2));
  return { wallHeight, overlap: -1, decorations: [] };
}

export function normalizeHouseData(raw: unknown, rect: Rect): HouseData {
  const fallback = makeHouse(rect[2], rect[3]);
  if (!raw || typeof raw !== "object") return fallback;
  const src = raw as {
    wallHeight?: unknown;
    overlap?: unknown;
    wall?: unknown;
    roof?: unknown;
    decorations?: unknown;
    deco?: unknown;
  };
  const wallHeight = typeof src.wallHeight === "number" ? Math.round(src.wallHeight) : fallback.wallHeight;
  const overlap = typeof src.overlap === "number" ? Math.round(src.overlap) : fallback.overlap;
  const rawDecorations = Array.isArray(src.decorations) ? src.decorations : Array.isArray(src.deco) ? src.deco : [];
  const legacyKinds: HouseDecorationKind[] = ["door", "window", "chimney"];
  const decorations: HouseDecoration[] = rawDecorations.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const deco = entry as { kind?: unknown; cell?: unknown; palette?: unknown };
    const cellSrc = Array.isArray(deco.cell) ? deco.cell : null;
    if (!cellSrc || cellSrc.length < 2) return [];
    const kindRaw = typeof deco.kind === "string" ? deco.kind.toLowerCase() : "";
    const kind = (kindRaw === "door" || kindRaw === "window" || kindRaw === "chimney" || kindRaw === "any")
      ? kindRaw as HouseDecorationKind
      : legacyKinds[index] ?? "any";
    const out: HouseDecoration = {
      kind,
      cell: [Math.round(Number(cellSrc[0]) || 0), Math.round(Number(cellSrc[1]) || 0)],
    };
    if (typeof deco.palette === "string" && deco.palette) out.palette = deco.palette;
    return [out];
  });
  return {
    wallHeight,
    overlap,
    ...(typeof src.wall === "string" && src.wall ? { wall: src.wall } : {}),
    ...(typeof src.roof === "string" && src.roof ? { roof: src.roof } : {}),
    decorations,
  };
}

export function resizeHouse(house: HouseData, beforeRect: Rect, afterRect: Rect): HouseData {
  const dH = afterRect[3] - beforeRect[3];
  const wallHeight = clamp(house.wallHeight, 1, Math.max(1, afterRect[3] - 1));
  return {
    ...house,
    wallHeight,
    decorations: house.decorations.map((deco) => {
      const shiftedY = deco.kind === "chimney" ? deco.cell[1] : deco.cell[1] + dH;
      return { ...deco, cell: clampDecoCell(afterRect[2], afterRect[3], [1, 1], [deco.cell[0], shiftedY]) };
    }),
  };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseWeighted<T>(items: { value: T; weight: number }[], rng: () => number): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)]?.value ?? null;
  let pick = rng() * total;
  for (const item of items) {
    if (pick < item.weight) return item.value;
    pick -= item.weight;
  }
  return items[items.length - 1]?.value ?? null;
}

export function generateDecorations(
  house: HouseData,
  rect: Rect,
  palettes: (Palette | null)[],
  seed: number,
): HouseDecoration[] {
  if (house.decorations.length === 0) return house.decorations;
  const rng = mulberry32(seed);
  const [w, h] = [rect[2], rect[3]];
  const wallHeight = wallHeightOf(house, h);
  const roofH = Math.max(1, h - wallHeight);
  const centerX = (w - 1) * 0.5;

  const next = house.decorations.map((deco) => ({ ...deco, cell: [...deco.cell] as [number, number] }));

  const placeByKind = (kind: "door" | "window" | "chimney", index: number) => {
    const p = palettes[index];
    const [pw, ph] = sizeOf(p);
    if (kind === "door") {
      const y = Math.max(0, h - ph);
      const candidates = Array.from({ length: Math.max(1, w - pw + 1) }, (_, x0) => ({
        value: [x0, y] as [number, number],
        weight: Math.max(0.001, 1 - Math.abs(x0 + pw * 0.5 - centerX) / Math.max(1, w * 0.5)),
      }));
      const pick = chooseWeighted(candidates, rng);
      if (pick) next[index].cell = pick;
      return;
    }
    if (kind === "window") {
      const y = wallHeight >= ph + 1
        ? Math.max(0, h - Math.ceil(wallHeight * 0.6))
        : Math.max(0, h - ph);
      const candidates = Array.from({ length: Math.max(1, w - pw + 1) }, (_, x0) => ({
        value: [x0, Math.min(h - ph, y)] as [number, number],
        weight: Math.max(0.25, 1 - Math.abs(x0 + pw * 0.5 - centerX) / Math.max(1, w * 0.5)),
      }));
      const pick = chooseWeighted(candidates, rng);
      if (pick) next[index].cell = pick;
      return;
    }
    const maxY = Math.max(0, roofH - ph);
    const candidates: { value: [number, number]; weight: number }[] = [];
    for (let y = 0; y <= maxY; y++) {
      for (let x = 0; x <= Math.max(0, w - pw); x++) {
        const backBias = 1 - y / Math.max(1, roofH - 1);
        const centerBias = Math.max(0.05, 1 - Math.abs(x + pw * 0.5 - centerX) / Math.max(1, w * 0.5));
        candidates.push({ value: [x, y], weight: backBias * backBias * centerBias });
      }
    }
    const pick = chooseWeighted(candidates, rng);
    if (pick) next[index].cell = pick;
  };

  next.forEach((deco, index) => {
    if (deco.kind === "any") return;
    placeByKind(deco.kind, index);
  });

  return next.map((deco, index) => ({
    ...deco,
    cell: clampDecoCell(w, h, sizeOf(palettes[index]), deco.cell),
  }));
}
