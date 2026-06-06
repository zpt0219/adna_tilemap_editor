// GENERATED FILE — do not edit by hand.
// Source of truth: desktop/src/blueprint_palette.h (blueprint_color_for_role).
// Regenerate: npm run generate   (scripts/gen-role-colors.mjs)
//
// Substring match, FIRST hit wins, ORDER-SENSITIVE — mirrors the engine header
// and scripts/render_overlay.py exactly (WEB_LITE_REROLL_EDITOR.md §2.4).

export type RGB = [number, number, number];

export interface RoleColorRule {
  /** lowercase substrings; any match selects this rule's color */
  tokens: string[];
  rgb: RGB;
}

/** Ordered rules; evaluate top-to-bottom, first substring hit wins. */
export const ROLE_COLOR_RULES: RoleColorRule[] = [
  { tokens: ["door", "entrance", "gate"], rgb: [250, 170, 45] },
  { tokens: ["cobble", "paved", "pavement", "flagstone", "brick_road", "brick_path", "stone_road", "stone_path"], rgb: [180, 175, 165] },
  { tokens: ["road", "path", "corridor", "bridge", "street", "lane"], rgb: [135, 95, 55] },
  { tokens: ["wall", "fence", "border", "hedge"], rgb: [225, 95, 85] },
  { tokens: ["room", "bedroom", "kitchen", "hall"], rgb: [125, 125, 225] },
  { tokens: ["water", "river", "pond", "lake", "sea", "ocean", "pool", "stream"], rgb: [70, 135, 240] },
  { tokens: ["sand", "beach", "dune", "shore"], rgb: [246, 223, 88] },
  { tokens: ["snow", "snowfield", "frost", "glacier", "icy"], rgb: [238, 236, 224] },
  { tokens: ["tree", "forest", "wood", "orchard", "grove", "jungle", "bush", "shrub"], rgb: [38, 115, 58] },
  { tokens: ["grass", "meadow", "pasture", "lawn", "vegetation", "garden", "park"], rgb: [155, 215, 120] },
  { tokens: ["field", "crop", "wheat", "plot", "farmland", "paddy"], rgb: [150, 158, 90] },
  { tokens: ["dirt", "soil", "ground", "mud", "tilled"], rgb: [200, 160, 105] },
  { tokens: ["mountain", "rock", "hill", "cliff", "stone", "boulder"], rgb: [155, 50, 45] },
  { tokens: ["house", "building", "barn", "shop", "tower", "hut", "cabin", "cottage", "manor", "mill", "shed", "stable"], rgb: [70, 95, 142] },
];

/** Fallback color when no rule matches (stall / well / dock / prop). */
export const ROLE_FALLBACK_RGB: RGB = [170, 120, 235];

/** Resolve a role string to its overlay color (first substring hit wins). */
export function colorForRole(role: string): RGB {
  const r = (role || "").toLowerCase();
  for (const rule of ROLE_COLOR_RULES) {
    for (const t of rule.tokens) {
      if (r.includes(t)) return rule.rgb;
    }
  }
  return ROLE_FALLBACK_RGB;
}

/** CSS rgba() string for an RGB triple; alpha in [0,1]. */
export function rgbaCss([r, g, b]: RGB, alpha = 1): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
