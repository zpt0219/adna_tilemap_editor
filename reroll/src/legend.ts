// legend.ts — derive the active-role legend shown alongside the map, mirroring
// the bottom legend baked into scripts/render_overlay.py. Colors come from the
// generated role→color table (no hand-copied palette).

import { ROLE_COLOR_RULES, colorForRole, type RGB } from "./generated/roleColors";
import { eachVisibleObject, roleOf, type LiteTileMap } from "./model";

// Index of the first matching rule for a role, or -1 for the fallback bucket.
export function ruleIndexForRole(role: string): number {
  const r = (role || "").toLowerCase();
  for (let i = 0; i < ROLE_COLOR_RULES.length; i++) {
    for (const t of ROLE_COLOR_RULES[i].tokens) if (r.includes(t)) return i;
  }
  return -1;
}

// Friendly label + representative role, in the same order as render_overlay's
// ALL_LEGEND. Each representative role resolves (via the rules) to one bucket.
const LEGEND_ROWS: { label: string; role: string }[] = [
  { label: "water", role: "water" },
  { label: "forest/tree", role: "forest" },
  { label: "grass", role: "grass" },
  { label: "crops", role: "field" },
  { label: "dirt", role: "dirt" },
  { label: "sand/beach", role: "sand" },
  { label: "snow", role: "snow" },
  { label: "mountain", role: "mountain" },
  { label: "dirt road", role: "road" },
  { label: "brick road", role: "cobble" },
  { label: "fence/wall", role: "wall" },
  { label: "building", role: "building" },
  { label: "door", role: "door" },
  { label: "prop", role: "__fallback__" }, // matches nothing → fallback bucket
  { label: "room", role: "room" },
];

export interface LegendRow {
  label: string;
  rgb: RGB;
}

/** Legend rows whose color bucket is actually present in the map. */
export function activeLegend(map: LiteTileMap): LegendRow[] {
  const activeBuckets = new Set<number>();
  for (const o of eachVisibleObject(map)) activeBuckets.add(ruleIndexForRole(roleOf(o)));

  const rows = LEGEND_ROWS.filter((r) => activeBuckets.has(ruleIndexForRole(r.role))).map((r) => ({
    label: r.label,
    rgb: colorForRole(r.role),
  }));
  // Empty blueprint: show the full legend rather than nothing.
  return rows.length ? rows : LEGEND_ROWS.map((r) => ({ label: r.label, rgb: colorForRole(r.role) }));
}
