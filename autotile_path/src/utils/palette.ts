// palette.ts — level index to RGB.
//
// The HSV shade recipes are lifted from autotile_mixer's `SHADE_RECIPES`, values
// and all, so a palette that looks right in one app looks right in the other.
// They are copied rather than imported: this app is meant to stand alone and a
// cross-app import would drag in blob47's baked pattern data with it. The cost
// is that a change over there has to be brought over by hand — which is fine
// while these are frozen constants, and is the first thing to revisit if they
// ever start moving.

export interface RGB { r: number; g: number; b: number }

/**
 * The centreline is a pickable colour but not a LEVEL: it is painted over the
 * surface rather than being a step in the across-road ramp, because its
 * position is a function of `s` as well as `t`. So it lives here and not in
 * pathField's `Role`.
 */
export type ColourRole = 'path' | 'edge' | 'centre' | 'edgeAlt';

export type RoleColours = Record<ColourRole, RGB>;

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function parseHexColour(hex: string): RGB {
  const s = hex.replace('#', '').trim();
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function toHexColour({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}
