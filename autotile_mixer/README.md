# Adna Autotile Mixer

[English](README.md) · [简体中文](README.zh-CN.md)

`autotile_mixer` is a browser-only React + TypeScript tool for designing and
previewing a seamless 32px Blob47 terrain tileset. Pick a palette, shape the
transition edge, add an outline motif and material texture, then test the
result on a live tilemap before exporting it.

There is no backend and no account. All rendering happens in the browser. The
current recipe and user presets are saved locally in `localStorage`.

## Features

- Generates the complete Blob47 set: 47 canonical tiles in an 8 × 6 sheet
  (192 × 256px at the fixed 32px tile size).
- Three role colours: terrain A, terrain B, and the outline edge.
- Ten baked edge patterns:
  `square`, `rounded`, `sharp`, `jagged`, `gravel`, `boulder`, `thorn`,
  `coast`, `moss`, and `billow`.
- Configurable transition band: 3–5 shades, band position, outline width,
  hard terrain-B edge, and optional transparent terrain B.
- Outline motifs such as bevel, dashes, ticks, beads, rope, wave, grain,
  speckle, and motifs laid along masonry textures.
- Terrain textures including organic grain, ripples, Voronoi cells,
  geometry, masonry, paving, water lines, and noise patterns.
- Interactive 16 × 10 playground with live neighbour-based tile selection.
  It uses Pointer Events, so mouse, pen, and touch use the same interaction
  path.
- Playground tools:
  - **Paint** draws terrain A.
  - **Eraser** removes terrain A and restores terrain B.
  - Fill A and clear/fill B shortcuts are also available.
- Built-in and user presets, automatic session saving, and compact URL sharing
  through a versioned recipe codec.
- Separate recipe JSON import/export for archiving and team workflows.
- One-click ZIP export containing only the generated PNG and the tileset
  mapping JSON. The recipe is intentionally kept as a separate export.

## Run locally

From this directory:

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally:

```text
http://localhost:5173/
```

To run the complete repository landing page and all built sub-apps, use the
repository-level launcher instead:

```bash
cd ..
node start-local.mjs
```

Then open:

```text
http://localhost:3000/autotile_mixer/
```

## Build and test

```bash
npm run build   # TypeScript check + production Vite build
npm test        # Vitest unit tests
npm run lint    # ESLint
npm run preview # Serve the production build locally
```

The test suite covers Blob47 canonicalisation, distance fields, seam-safe
pattern painting, noise, ribbons, textures, recipe sanitisation, URL codec
round-trips, i18n, and playground stroke rasterisation.

## Using the playground

The playground stores a binary cell map: `1` is terrain A and `0` is terrain B.
Each cell's eight neighbours are converted into the Blob47 mask and looked up
in the 47-tile layout.

1. Choose **Paint** or **Eraser**.
2. Drag across the canvas with a mouse, pen, or finger.
3. Use the scale buttons to enlarge the preview.
4. Turn off **Markers** when judging the final art.

The canvas uses `touch-action: none` so a drag paints instead of scrolling the
page. Pointer capture keeps a stroke continuous even when the pointer moves
quickly or briefly leaves the canvas.

## Export formats

### Tileset ZIP

The **Download PNG + JSON** button creates a ZIP containing:

```text
tileset_blob47_<pattern>_32px.png
tileset_blob47_<pattern>_32px.json
```

The JSON includes:

- format/application version;
- tile size, sheet dimensions, and slot count;
- the eight neighbour-bit values (`N`, `E`, `S`, `W`, `NE`, `SE`, `SW`, `NW`);
- the sheet layout;
- a 256-entry raw-mask-to-slot lookup table;
- the recipe used to render the sheet.

The PNG is exported from the clean off-screen canvas, so preview grid lines
and playground markers are never baked into the file.

### Recipe JSON

The **Export Recipe** button writes a versioned JSON file containing the full
render recipe. **Import Recipe** accepts either that `{ v, recipe }` wrapper or
a raw recipe object. Invalid or out-of-range values are sanitised back to safe
defaults instead of being applied unchecked.

### Share links

**Copy Share Link** encodes the recipe into the URL hash as `#r=<payload>`. The
codec is versioned so future fields can be added without invalidating existing
links.

## Blob47 convention

Blob47 is a cell-based autotile scheme. The four cardinal bits describe open
neighbours and the four diagonal bits are only meaningful when their two
adjacent cardinal edges are also open. Canonicalising all 256 raw masks leaves
47 distinct tile states.

The convention used by the exporter is:

```text
N  = 1    E  = 2    S  = 4    W  = 8
NE = 16   SE = 32   SW = 64   NW = 128
```

The generated art is tile-periodic. Pattern fields, noise, ribbons, and
textures are all constrained by seam-safety rules so neighbouring tiles can be
placed without visible discontinuities.

## Project layout

```text
src/
  App.tsx                   UI, recipe state, canvas rendering, interactions
  App.css                   Application layout and controls
  shared/i18n.ts            Chinese/English labels
  utils/blob47.ts           Masks, canonicalisation, 47-slot layout
  utils/blob47Pattern.ts    Baked edge fields and pattern metadata
  utils/patternPaint.ts     Pixel painting and role/ramp compositing
  utils/patternNoise.ts     Transition-band noise algorithms
  utils/patternRibbon.ts    Outline/ribbon motifs
  utils/patternTexture.ts   Solid terrain textures
  utils/patterns/generated.ts
                            Generated distance-field pattern data
  utils/recipe.ts           Recipe model, defaults, sanitisation, presets
  utils/recipeCodec.ts      Compact URL recipe encoder/decoder
  utils/exportSheet.ts      PNG/JSON/ZIP export helpers
  utils/playgroundPaint.ts  Continuous drag-to-cell rasterisation
```

## Design boundaries

- The output tile size is currently fixed at 32px.
- This app generates Blob47 tiles only; 2-corner and 2-edge Wang schemes are
  documented separately but are not selectable in this UI.
- Terrain A/B are roles in the generated tileset, not separate imported image
  layers. The playground eraser changes the test map back to terrain B; it does
  not modify the generated tileset art.
- There is no user-uploaded tileset pipeline and no server-side rendering.

## Related documentation

Repository-level design notes explain the scheme and bake invariants in:

- [`../docs/AUTOTILE_SCHEMES.md`](../docs/AUTOTILE_SCHEMES.md)
- [`../docs/AUTOTILE_PATTERN_BAKE.md`](../docs/AUTOTILE_PATTERN_BAKE.md)
- [`../docs/AUTOTILE_MIXER_PRESETS.md`](../docs/AUTOTILE_MIXER_PRESETS.md)
- [`../docs/autotile_pattern_extension.md`](../docs/autotile_pattern_extension.md)
