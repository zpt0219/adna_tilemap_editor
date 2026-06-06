// gen-role-colors.mjs — build-time generator for the role→color table.
//
// The blueprint role→color palette has ONE source of truth, kept bit-identical
// across three engine-side consumers (see WEB_LITE_REROLL_EDITOR.md §2.4):
//   · desktop/src/blueprint_palette.h          (engine source of truth)
//   · scripts/render_overlay.py                (no-engine PIL preview)
//   · docs/BLUEPRINT_AUTHORING.md §4           (doc color table)
//
// This repo is self-contained — it builds from a single checkout with NO
// dependency on any other repo (it ships as a public website). To make that
// possible the palette header is VENDORED here at:
//   vendor/blueprint_palette.h
// which is a verbatim snapshot of the authoritative original in the (private)
// Adna engine repo: desktop/src/blueprint_palette.h.
//
// This generator is the web viewer's copy of the palette: rather than
// hand-maintaining a TS table that can drift from the snapshot, it parses the
// vendored header and emits src/generated/roleColors.ts (committed). Run
// `npm run generate` (wired into predev/prebuild) to re-emit it.
//
// To re-sync after the engine palette changes: copy the upstream header over
// vendor/blueprint_palette.h (or point $BLUEPRINT_PALETTE_H at it), then
// `npm run generate`.
//
// Matching is substring, FIRST hit wins, ORDER-SENSITIVE — we preserve the
// header's rule order exactly.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../src/generated/roleColors.ts");

// Vendored snapshot by default; $BLUEPRINT_PALETTE_H overrides it for re-syncing
// straight from an engine-repo checkout.
const SRC = process.env.BLUEPRINT_PALETTE_H
  ? resolve(process.env.BLUEPRINT_PALETTE_H)
  : resolve(here, "../vendor/blueprint_palette.h");

const header = readFileSync(SRC, "utf8");

// Isolate the body of blueprint_color_for_role(...). Only that function uses
// IM_COL32 returns, so slicing from its name to EOF is sufficient.
const fnStart = header.indexOf("blueprint_color_for_role");
if (fnStart < 0) throw new Error(`could not find blueprint_color_for_role in ${SRC}`);
const body = header.slice(fnStart);

// Walk has("token") and IM_COL32(r,g,b,alpha) occurrences in source order.
// Accumulate tokens until a return color is hit, then flush one rule. The final
// return has no preceding has() tokens within its segment → it's the fallback.
const tokenOrColor = /has\("([^"]+)"\)|IM_COL32\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*alpha\s*\)/g;

const rules = []; // { tokens: string[], rgb: [r,g,b] }
let fallback = null;
let acc = [];
let m;
while ((m = tokenOrColor.exec(body)) !== null) {
  if (m[1] !== undefined) {
    acc.push(m[1]);
  } else {
    const rgb = [Number(m[2]), Number(m[3]), Number(m[4])];
    if (acc.length === 0) {
      fallback = rgb; // the trailing `return IM_COL32(...)` with no has() guard
    } else {
      rules.push({ tokens: acc, rgb });
      acc = [];
    }
  }
}

if (!rules.length || !fallback) {
  throw new Error(`parse produced ${rules.length} rules, fallback=${fallback}; header format changed?`);
}

const ts = `// GENERATED FILE — do not edit by hand.
// Source: vendor/blueprint_palette.h (blueprint_color_for_role) — a vendored
//   snapshot of the Adna engine's desktop/src/blueprint_palette.h.
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
${rules.map((r) => `  { tokens: [${r.tokens.map((t) => JSON.stringify(t)).join(", ")}], rgb: [${r.rgb.join(", ")}] },`).join("\n")}
];

/** Fallback color when no rule matches (stall / well / dock / prop). */
export const ROLE_FALLBACK_RGB: RGB = [${fallback.join(", ")}];

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
  return \`rgba(\${r}, \${g}, \${b}, \${alpha})\`;
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, ts);
console.log(`gen-role-colors: ${rules.length} rules + fallback → ${OUT}`);
