import type { LiteObject, LiteType, TerrainMatrix } from "./model";
import { terrainNeighborBits } from "./pack/autotile";
import { noiseAllowsCell, type TerrainNoiseConfig } from "./terrainNoise";

export type BitwiseObjectOp = "AND" | "OR" | "SUBTRACT" | "COPY";

export function isBitwiseSupported(o: LiteObject | null | undefined): o is LiteObject & { terrain: TerrainMatrix } {
  return !!o?.terrain && (o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE" || o.type === "FIXED_RECT_GROUP");
}

function overlapRect(a: TerrainMatrix, b: TerrainMatrix): [number, number, number, number] | null {
  const minX = Math.max(a.ox, b.ox);
  const minY = Math.max(a.oy, b.oy);
  const maxX = Math.min(a.ox + a.w, b.ox + b.w);
  const maxY = Math.min(a.oy + a.h, b.oy + b.h);
  if (maxX <= minX || maxY <= minY) return null;
  return [minX, minY, maxX - minX, maxY - minY];
}

export function hasBitwiseOverlap(target: TerrainMatrix, source: TerrainMatrix): boolean {
  return overlapRect(target, source) != null;
}

export function terrainMatrixEquals(a: TerrainMatrix, b: TerrainMatrix): boolean {
  if (a.ox !== b.ox || a.oy !== b.oy || a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

export function applyBitwiseObjectOp(target: TerrainMatrix, source: TerrainMatrix, op: BitwiseObjectOp): TerrainMatrix {
  const region = overlapRect(target, source);
  const next: TerrainMatrix = {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.data),
  };
  if (!region) return next;
  const [rx, ry, rw, rh] = region;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const di = (y - target.oy) * target.w + (x - target.ox);
      const si = (y - source.oy) * source.w + (x - source.ox);
      const dv = next.data[di];
      const sv = source.data[si];
      switch (op) {
        case "AND":
          if (sv < 0) next.data[di] = -1;
          break;
        case "OR":
          if (sv >= 0 && dv < 0) next.data[di] = 0;
          break;
        case "SUBTRACT":
          if (dv >= 0 && sv >= 0) next.data[di] = -1;
          break;
        case "COPY":
          next.data[di] = sv < 0 ? -1 : (dv < 0 ? 0 : dv);
          break;
      }
    }
  }
  return next;
}

export function fillTerrainMatrix(target: TerrainMatrix, filled: boolean): TerrainMatrix {
  return {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.w * target.h).fill(filled ? 0 : -1),
  };
}

const OFFSETS_8: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],            [1, 0],
  [-1, 1],  [0, 1],   [1, 1],
];

function countPresentNeighbors(t: TerrainMatrix, col: number, row: number, borderAsConnected: boolean): number {
  let count = 0;
  for (const [dx, dy] of OFFSETS_8) {
    const x = col + dx;
    const y = row + dy;
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) {
      if (borderAsConnected) count++;
      continue;
    }
    if (t.data[y * t.w + x] >= 0) count++;
  }
  return count;
}

function countEmptyNeighbors(t: TerrainMatrix, col: number, row: number, borderAsConnected: boolean): number {
  let count = 0;
  for (const [dx, dy] of OFFSETS_8) {
    const x = col + dx;
    const y = row + dy;
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) {
      if (!borderAsConnected) count++;
      continue;
    }
    if (t.data[y * t.w + x] < 0) count++;
  }
  return count;
}

export function dilateTerrainMatrix(target: TerrainMatrix, cfg: TerrainNoiseConfig, borderAsConnected: boolean): TerrainMatrix {
  const next: TerrainMatrix = {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.data),
  };
  for (let row = 0; row < target.h; row++) {
    for (let col = 0; col < target.w; col++) {
      const idx = row * target.w + col;
      if (target.data[idx] >= 0) continue;
      if (countPresentNeighbors(target, col, row, borderAsConnected) <= 0) continue;
      if (noiseAllowsCell(col, row, cfg)) next.data[idx] = 0;
    }
  }
  return next;
}

export function erodeTerrainMatrix(target: TerrainMatrix, cfg: TerrainNoiseConfig, borderAsConnected: boolean): TerrainMatrix {
  const next: TerrainMatrix = {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.data),
  };
  for (let row = 0; row < target.h; row++) {
    for (let col = 0; col < target.w; col++) {
      const idx = row * target.w + col;
      if (target.data[idx] < 0) continue;
      if (countEmptyNeighbors(target, col, row, borderAsConnected) <= 0) continue;
      if (noiseAllowsCell(col, row, cfg)) next.data[idx] = -1;
    }
  }
  return next;
}

export function flipTerrainMatrix(target: TerrainMatrix): TerrainMatrix {
  const next: TerrainMatrix = {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.data),
  };
  for (let i = 0; i < next.data.length; i++) next.data[i] = next.data[i] < 0 ? 0 : -1;
  return next;
}

export function removeTerrainValue(target: TerrainMatrix, value: number): TerrainMatrix {
  const next: TerrainMatrix = {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.data),
  };
  for (let i = 0; i < next.data.length; i++) {
    if (next.data[i] === value) next.data[i] = -1;
  }
  return next;
}

export function removeZeroLikeDesktop(target: TerrainMatrix, type: LiteType, borderAsConnected: boolean): TerrainMatrix {
  if (type !== "TERRAIN_2_CORNER" && type !== "TERRAIN_2_EDGE") {
    return removeTerrainValue(target, 0);
  }
  const next: TerrainMatrix = {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.data),
  };
  for (let row = 0; row < target.h; row++) {
    for (let col = 0; col < target.w; col++) {
      const idx = row * target.w + col;
      if (target.data[idx] < 0) continue;
      if (terrainNeighborBits(type, target, col, row, borderAsConnected) === 0) next.data[idx] = -1;
    }
  }
  return next;
}

export function keepBorderTerrainMatrix(target: TerrainMatrix): TerrainMatrix {
  const next: TerrainMatrix = {
    ox: target.ox,
    oy: target.oy,
    w: target.w,
    h: target.h,
    data: new Int16Array(target.data),
  };
  const keep = new Uint8Array(target.w * target.h);
  for (let row = 0; row < target.h; row++) {
    for (let col = 0; col < target.w; col++) {
      const idx = row * target.w + col;
      if (target.data[idx] < 0) continue;
      for (const [dx, dy] of OFFSETS_8) {
        const x = col + dx;
        const y = row + dy;
        if (x < 0 || y < 0 || x >= target.w || y >= target.h) {
          keep[idx] = 1;
          break;
        }
        if (target.data[y * target.w + x] < 0) {
          keep[idx] = 1;
          break;
        }
      }
    }
  }
  for (let i = 0; i < next.data.length; i++) {
    if (next.data[i] >= 0 && keep[i] === 0) next.data[i] = -1;
  }
  return next;
}
