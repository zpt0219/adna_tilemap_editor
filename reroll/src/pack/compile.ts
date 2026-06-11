// compile.ts — bind a palette to each blueprint object by role
// (mirrors src/core/palette_manager.cpp resolvePaletteForRoleIn + roleTreeDistance,
// and src/command/commands_blueprint.cpp compileLayer's FRG branch). MVP style
// ranking only (no MiniLM cosine): prefer palettes sharing a style word.

import { eachObject, roleOf, type LiteObject, type LiteTileMap, type LiteType } from "../model";
import { PaletteMode, type Palette, type PackRuntime } from "./types";
import { assignFrgCells } from "./frg";
import { hashString, mulberry32 } from "./rng";
import { isMatrixAutotile } from "./autotile";
import { isStructureMode } from "./slice";

// Within a role-distance tier the engine picks by style only, but it renders
// each object by its OWN geometry — so a terrain-area object needs an auto-tile
// palette, a line needs TWO_EDGE, a placeable needs FIXED_RECT. Prefer the
// palette mode that matches the object's geometry (a tie-break, not a hard gate:
// unlisted modes still bind, just last). Ordered best→worst per object type.
const MODE_PREF: Record<LiteType, PaletteMode[]> = {
  TERRAIN_2_CORNER: [PaletteMode.TWO_CORNER, PaletteMode.QUAD, PaletteMode.BLOB_7_7, PaletteMode.BLOB_6_8, PaletteMode.NINE_PATCH, PaletteMode.CLIFF],
  TERRAIN_2_EDGE: [PaletteMode.TWO_EDGE, PaletteMode.CONTOUR, PaletteMode.TWO_CORNER, PaletteMode.NINE_PATCH],
  FIXED_RECT: [PaletteMode.FIXED_RECT, PaletteMode.NINE_PATCH, PaletteMode.CLIFF, PaletteMode.H_STRETCH, PaletteMode.V_STRETCH],
  FIXED_RECT_GROUP: [PaletteMode.FIXED_RECT, PaletteMode.NINE_PATCH],
  DUNGEON: [PaletteMode.DUNGEON],
};
function modeRank(objType: LiteType, mode: number): number {
  const i = MODE_PREF[objType].indexOf(mode);
  return i < 0 ? 50 : i;
}

const W_UP = 1;
const W_DOWN = 2;
const MAX_DIST = 2;

/** Role-tree distance over slash paths; ∞ when top-level segments differ. */
export function roleTreeDistance(req: string, pal: string): number {
  if (!req || !pal) return Infinity;
  const a = req.split("/");
  const b = pal.split("/");
  if (a[0] !== b[0]) return Infinity;
  let L = 0;
  while (L < a.length && L < b.length && a[L] === b[L]) L++;
  return (a.length - L) * W_UP + (b.length - L) * W_DOWN;
}

const styleWords = (s: string): string[] =>
  s ? s.toLowerCase().split(/[,\s]+/).filter(Boolean) : [];

/** # of shared style words (MVP stand-in for style-vector cosine). */
function styleOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const set = new Set(styleWords(a));
  let n = 0;
  for (const w of styleWords(b)) if (set.has(w)) n++;
  return n;
}

/** Min-distance tier (≤ MAX_DIST) for a role, ranked by style overlap desc. */
function tierFor(palettes: Palette[], role: string, style: string): Palette[] {
  let best = Infinity;
  for (const p of palettes) {
    const d = roleTreeDistance(role, p.role);
    if (d < best) best = d;
  }
  if (best > MAX_DIST) return [];
  const tier = palettes.filter((p) => roleTreeDistance(role, p.role) === best);
  tier.sort((a, b) => styleOverlap(b.style, style) - styleOverlap(a.style, style));
  return tier;
}

/** One palette for a role: closest role-distance tier → mode matching the
 *  object's geometry → best style overlap → seeded pick (for variety). */
export function resolvePaletteForRole(palettes: Palette[], role: string, style: string, seed: number, objType: LiteType): Palette | null {
  let tier = tierFor(palettes, role, style);
  if (tier.length === 0) return null;
  const bestRank = Math.min(...tier.map((p) => modeRank(objType, p.mode)));
  tier = tier.filter((p) => modeRank(objType, p.mode) === bestRank);
  const top = Math.max(...tier.map((p) => styleOverlap(p.style, style)));
  const pool = tier.filter((p) => styleOverlap(p.style, style) === top);
  return pool[Math.floor(mulberry32(seed)() * pool.length)] ?? null;
}

/** Up to `maxN` scatter variants for an FRG role — the stampable (mode-preferred)
 *  slice of the closest tier, ranked by style. */
export function resolvePalettesForRole(palettes: Palette[], role: string, style: string, maxN: number): Palette[] {
  const tier = tierFor(palettes, role, style);
  if (tier.length === 0) return [];
  const bestRank = Math.min(...tier.map((p) => modeRank("FIXED_RECT_GROUP", p.mode)));
  return tier.filter((p) => modeRank("FIXED_RECT_GROUP", p.mode) === bestRank).slice(0, maxN);
}

export type Binding =
  | { kind: "fixed"; palette: Palette }   // stamp native size at the object origin
  | { kind: "slice"; palette: Palette }   // nine-slice / stretch over the object rect
  | { kind: "auto"; palette: Palette }    // matrix auto-tile over the object's terrain cells
  | { kind: "frg"; variants: Palette[]; cellVariant: Int16Array };

export type Bindings = Map<number, Binding>;

const objSeed = (o: LiteObject): number =>
  hashString(`${o.tags["web.name"] ?? ""}|${roleOf(o)}|${o.tags["blueprint.style"] ?? ""}`);

function bindingKind(mode: number): "auto" | "slice" | "fixed" {
  if (isMatrixAutotile(mode)) return "auto";
  if (isStructureMode(mode)) return "slice";
  return "fixed";
}

/**
 * Bind every object to a palette (or variant set). A `web.palette` tag (set via
 * the Palette panel) forces a specific palette, overriding the role resolution.
 */
export function compileMap(map: LiteTileMap, pack: PackRuntime): Bindings {
  const out: Bindings = new Map();
  const byHash = new Map(pack.palettes.map((p) => [p.hash, p]));
  for (const o of eachObject(map)) {
    const role = roleOf(o);
    const override = o.tags["web.palette"] ? byHash.get(o.tags["web.palette"]) : undefined;
    if (!role && !override) continue;
    const style = o.tags["blueprint.style"] ?? "";
    const seed = objSeed(o);

    if (o.type === "FIXED_RECT_GROUP" && o.terrain) {
      const variants = override ? [override] : resolvePalettesForRole(pack.palettes, role, style, 6);
      if (variants.length === 0) continue;
      out.set(o.id, { kind: "frg", variants, cellVariant: assignFrgCells(o.terrain, variants.length, seed) });
      continue;
    }
    const palette = override ?? resolvePaletteForRole(pack.palettes, role, style, seed, o.type);
    if (!palette) continue;
    out.set(o.id, { kind: bindingKind(palette.mode), palette });
  }
  return out;
}
