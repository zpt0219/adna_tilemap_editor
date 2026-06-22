// compile.ts — bind a palette to each blueprint object by role
// (mirrors src/core/palette_manager.cpp resolvePaletteForRoleIn + roleTreeDistance,
// and src/command/commands_blueprint.cpp compileLayer's FRG branch). MVP style
// ranking only (no MiniLM cosine): prefer palettes sharing a style word.

import { DEFAULT_FRG_PLACEMENT_MODE, type FrgPlacementMode, eachObject, roleOf, type LiteObject, type LiteTileMap, type LiteType } from "../model";
import { decorationRole } from "../house";
import { PaletteMode, type Palette, type PackRuntime } from "./types";
import { assignPlacedFrgCells } from "./frg";
import { hashString, mulberry32 } from "./rng";
import { isMatrixAutotile } from "./autotile";
import { isStructureMode } from "./slice";
import { DEFAULT_FRG_NOISE_CONFIG, noiseConfigFromTags } from "../terrainNoise";

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
  HOUSE: [PaletteMode.NINE_PATCH, PaletteMode.CLIFF], // houses resolve slots separately; this is unused
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
  | { kind: "frg"; variants: Palette[]; cellVariant: Int16Array }
  | { kind: "house"; wall: Palette | null; roof: Palette | null; deco: (Palette | null)[] };

export type Bindings = Map<number, Binding>;

const objSeed = (o: LiteObject): number =>
  hashString(`${o.tags["web.name"] ?? ""}|${roleOf(o)}|${o.tags["blueprint.style"] ?? ""}`);

function resolveFrgCells(
  o: LiteObject,
  byHash: Map<string, Palette>,
  palettes: Palette[],
): { variants: Palette[]; weights: number[]; explicit: boolean; placementMode: FrgPlacementMode } {
  if (o.frg) {
    const variants: Palette[] = [];
    const weights: number[] = [];
    for (const cell of o.frg.cells) {
      const palette = byHash.get(cell.palette);
      if (!palette) continue;
      variants.push(palette);
      weights.push(Math.max(0, Math.round(cell.weight)));
    }
    return { variants, weights, explicit: true, placementMode: o.frg.placementMode ?? DEFAULT_FRG_PLACEMENT_MODE };
  }
  const role = roleOf(o);
  const style = o.tags["blueprint.style"] ?? "";
  const override = o.tags["web.palette"] ? byHash.get(o.tags["web.palette"]) : undefined;
  const variants = override ? [override] : resolvePalettesForRole(palettes, role, style, 6);
  return {
    variants,
    weights: variants.map(() => 100),
    explicit: false,
    placementMode: DEFAULT_FRG_PLACEMENT_MODE,
  };
}

function bindingKind(mode: number): "auto" | "slice" | "fixed" {
  if (isMatrixAutotile(mode)) return "auto";
  if (isStructureMode(mode)) return "slice";
  return "fixed";
}

// Resolve a house slot's palette: closest role tier, preferring `preferMode`.
function resolveSlotPalette(palettes: Palette[], role: string, style: string, seed: number, preferMode: PaletteMode): Palette | null {
  const tier = tierFor(palettes, role, style);
  if (tier.length === 0) return null;
  const pref = tier.filter((p) => p.mode === preferMode);
  const pool = pref.length ? pref : tier;
  return pool[Math.floor(mulberry32(seed)() * pool.length)] ?? null;
}

// A decoration slot must be a FIXED_RECT palette (else not drawn — desktop parity).
function resolveDecoPalette(palettes: Palette[], role: string, style: string, seed: number): Palette | null {
  const fr = tierFor(palettes, role, style).filter((p) => p.mode === PaletteMode.FIXED_RECT);
  return fr.length ? fr[Math.floor(mulberry32(seed)() * fr.length)] : null;
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
    if (!role && !override && !(o.type === "FIXED_RECT_GROUP" && o.frg)) continue;
    const style = o.tags["blueprint.style"] ?? "";
    const seed = objSeed(o);

    if (o.type === "HOUSE" && o.house) {
      const h = o.house;
      const pick = (hash?: string) => (hash ? byHash.get(hash) ?? null : null);
      // wall: explicit override → building/house_wall → fall back to the CLIFF body
      const wall = pick(h.wall)
        ?? resolveSlotPalette(pack.palettes, "building/house_wall", style, seed ^ 0x11, PaletteMode.NINE_PATCH)
        ?? resolveSlotPalette(pack.palettes, "building/house", style, seed ^ 0x13, PaletteMode.CLIFF);
      const roof = pick(h.roof)
        ?? resolveSlotPalette(pack.palettes, "building/house_roof", style, seed ^ 0x17, PaletteMode.NINE_PATCH);
      const deco = h.decorations.map((decoration, i) => {
        const role = decorationRole(decoration.kind);
        return pick(decoration.palette) ?? (role ? resolveDecoPalette(pack.palettes, role, style, seed ^ (0x20 + i)) : null);
      });
      out.set(o.id, { kind: "house", wall, roof, deco });
      continue;
    }

    if (o.type === "FIXED_RECT_GROUP" && o.terrain) {
      const frg = resolveFrgCells(o, byHash, pack.palettes);
      const noise = noiseConfigFromTags(o.tags, "web.frg", DEFAULT_FRG_NOISE_CONFIG);
      if (frg.explicit) {
        out.set(o.id, {
          kind: "frg",
          variants: frg.variants,
          cellVariant: assignPlacedFrgCells(o.terrain, frg.variants, frg.weights, frg.placementMode, noise),
        });
        continue;
      }
      if (frg.variants.length === 0) continue;
      out.set(o.id, {
        kind: "frg",
        variants: frg.variants,
        cellVariant: assignPlacedFrgCells(o.terrain, frg.variants, frg.weights, frg.placementMode, noise),
      });
      continue;
    }
    const palette = override ?? resolvePaletteForRole(pack.palettes, role, style, seed, o.type);
    if (!palette) continue;
    out.set(o.id, { kind: bindingKind(palette.mode), palette });
  }
  return out;
}
