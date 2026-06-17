// saveFormat.ts — serialize the lite TileMap to the `adna-web-lite` save format
// (docs/WEB_LITE_SCHEMA.md). This is the web-owned export format; a desktop
// loader (future pass) reads it and opens it as a new map per the doc's §4
// mapping. Readable + web-natural: string type names, [x,y,w,h] rects, terrain
// as an absolute cell list, tags verbatim — no base64/Recti/enum-ints here.

import type { LiteObject, LiteTileMap, Layer } from "./model";
import type { Vec2 } from "./types";

export const WEB_SAVE_FORMAT = "adna-web-lite";
export const WEB_SAVE_VERSION = 1;

export interface WebSaveHouse {
  wallHeight: number;
  overlap: number;
  wall?: string;
  roof?: string;
  decorations: { slot: number; cell: Vec2; palette?: string }[];
}

export interface WebSaveObject {
  type: LiteObject["type"];
  rect: [number, number, number, number];
  enabled: boolean;
  tags?: Record<string, string>;
  cells?: Vec2[];
  points?: Vec2[];
  house?: WebSaveHouse;
}

export interface WebSaveLayer {
  name: string;
  enabled: boolean;
  tags?: Record<string, string>;
  objects: WebSaveObject[];
}

export interface WebSaveFile {
  format: typeof WEB_SAVE_FORMAT;
  version: number;
  name: string;
  width: number;
  height: number;
  tileResolution: number;
  layers: WebSaveLayer[];
}

const hasTags = (t: Record<string, string>) => Object.keys(t).length > 0;

// Present terrain cells as absolute [x,y] (matrix positions where data === 0).
function terrainCells(o: LiteObject): Vec2[] {
  const t = o.terrain;
  if (!t) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < t.data.length; i++) {
    if (t.data[i] === 0) out.push([t.ox + (i % t.w), t.oy + Math.floor(i / t.w)]);
  }
  return out;
}

function objectJson(o: LiteObject): WebSaveObject {
  const out: WebSaveObject = { type: o.type, rect: [...o.rect], enabled: o.enabled };
  if (hasTags(o.tags)) out.tags = { ...o.tags };
  switch (o.type) {
    case "TERRAIN_2_CORNER":
    case "TERRAIN_2_EDGE":
    case "FIXED_RECT_GROUP":
      out.cells = terrainCells(o);
      break;
    case "DUNGEON":
      if (o.borderPoints) out.points = o.borderPoints.map((p) => [p[0], p[1]] as Vec2);
      break;
    case "HOUSE":
      if (o.house) {
        const h = o.house;
        out.house = {
          wallHeight: h.wallHeight,
          overlap: h.overlap,
          ...(h.wall ? { wall: h.wall } : {}),
          ...(h.roof ? { roof: h.roof } : {}),
          decorations: h.deco.map((d, slot) => ({ slot, cell: [d.cell[0], d.cell[1]] as Vec2, ...(d.palette ? { palette: d.palette } : {}) })),
        };
      }
      break;
    case "FIXED_RECT":
      break;
  }
  return out;
}

// `isBlueprint` stamps every exported layer with adna.kind=blueprint so the
// desktop loader renders each as a blueprint overlay (no palettes needed). The
// flat web layers map to desktop root.layers as siblings (WEB_LITE_SCHEMA §4).
function layerJson(layer: Layer, isBlueprint: boolean): WebSaveLayer {
  const tags = { ...layer.tags };
  if (isBlueprint) tags["adna.kind"] = "blueprint";
  const out: WebSaveLayer = {
    name: layer.name,
    enabled: layer.enabled, // exported verbatim, including hidden (enabled=false)
    objects: layer.objects.map(objectJson),
  };
  if (hasTags(tags)) out.tags = tags;
  return out;
}

/** Serialize a lite TileMap into the `adna-web-lite` save object. */
export function liteToWebSave(map: LiteTileMap): WebSaveFile {
  return {
    format: WEB_SAVE_FORMAT,
    version: WEB_SAVE_VERSION,
    name: map.name,
    width: map.width,
    height: map.height,
    tileResolution: 16,
    layers: map.layers.map((l) => layerJson(l, map.isBlueprint)),
  };
}
