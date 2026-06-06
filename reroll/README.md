# Adna Web Lite Reroll Editor

Web front-end for the blueprint flywheel — a lightweight viewer / reroll /
patch tool for AI-generated map drafts. Plan: `docs/WEB_LITE_REROLL_EDITOR.md`
(in the private engine repo). Scaffolded after the sibling `../tagger/` (Vite +
React + TS + Canvas 2D).

> This repo is the home of Adna web development and builds standalone. The
> **engine, docs, and palette are authoritative in the private engine repo**;
> the `docs/…` and `desktop/…` names below refer to files there (not linked).

## Status — MVP 2 (terrain brush)

Loads a blueprint JSON, **converts it into the lite TileMap subset** (a Layer
subtree of typed objects — a faithful TS port of the engine importer, see
`convert.ts`), renders it on Canvas 2D at overlay parity, and edits it. Top-bar
**Select | Terrain** toggle.

- **View**: role→color render reproducing `overlay.png`; middle-drag pan, wheel
  zoom, hover (tile coord + role + type).
- **Mouse model — desktop-like, type-dispatched** (no Select/Terrain tool toggle):
  - **Right button** = select + move: RMB click picks the object under the cursor
    (cyan outline + floating toolbar: type · role · Lock); RMB drag moves it.
  - **Left button** acts on the *selected* object by type:
    - terrain selected → **brush paint/erase** that object's own matrix (1/3/5
      brush; grows the matrix as you paint outside it). Only the active object's
      matrix changes, so stacking is preserved (water over forest, erase → forest
      survives). Brush strip (size · Paint/Erase) shows when a terrain is selected.
    - `FIXED_RECT` selected → grab an **edge/corner = resize**, interior = move
      (resize handles drawn on the selection).
  - Lock (`web.lock` 🔒): locked objects still select (to unlock) but don't move/
    resize/paint. One drag / stroke = one undo.
- **Undo / redo**: `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` and toolbar buttons.

### Rendering performance

The static map (KRAFT + objects + terrain) is rendered to an **offscreen scene
canvas** (`renderScene`, terrain cells run-length batched). Every frame just blits
that scene (`drawImage`) and draws the dynamic overlay (grid as two batched
strokes, selection, ghost, hover, brush). So pan / zoom / hover don't re-rasterize
the map — they hold 60 fps.

The scene is re-rendered only on data change, and **paint strokes use a dirty-rect
update** (`renderSceneRegion`) — like the desktop renderer's `dirty_region_` +
`glTexSubImage2D` (`desktop/src/tile_renderer.cpp`): each dab re-renders only the
brush's tile rect (clipping the cell scan to it, skipping objects that don't
intersect), so painting stays cheap regardless of map size. Structural edits
(move / resize / lock / undo) fall back to a full `renderScene`.
- **Export**: writes a web-owned **`adna-web-lite`** save file (the edited lite
  TileMap, readable JSON) — spec in `docs/WEB_LITE_SCHEMA.md` (private engine repo).
  A desktop-side loader that opens it as a new map is a later pass.

Constraints: **canvas size = blueprint root `width`/`height`** (content-AABB
fallback only when absent); the app never creates or resizes maps (§3.6). MVP 2
edits **existing** terrain only (no new terrain-type creation). No real textures
yet (MVP 0.5, waits on the palette preset); no single-object reroll (the blueprint
schema has no `variant` field — waits on the preset).

### Cells→terrain rule (mirrors the engine)

`objectTypeFor`'s terrain vocabulary has gaps relative to the role→color
vocabulary (e.g. `cliff` / `boulder` are in the mountain *color* bucket but not
the *type* terrain list). Both `convert.ts` and the engine importer
(`blueprint_importer.cpp`) apply the same structural rule: an object authored
with explicit `cells` is a terrain area even when its role word isn't in that
list. Without it, a 600-cell `cliff` would collapse to a translucent bbox and
drop its cells. (This was an engine bug found while building MVP 1 — fixed in
`blueprint_importer.cpp` with a regression test in `tests/test_serialize_roundtrip.cpp`.)

## role→color is generated, not hand-copied

The overlay palette has one source of truth, kept bit-identical across the engine
header, the PIL preview, and the docs (§2.4). This app is the *fourth* consumer,
so `src/generated/roleColors.ts` is **generated at build time** by
`scripts/gen-role-colors.mjs`, which parses a **vendored snapshot** of the engine
header at [`vendor/blueprint_palette.h`](vendor/blueprint_palette.h)
(`blueprint_color_for_role`) — so this repo builds from a single checkout with no
dependency on the engine repo. The generated file is committed so a standalone
checkout still builds; `npm run generate` (wired into `predev`/`prebuild`)
re-syncs it from `vendor/blueprint_palette.h`. To pull a newer palette: copy the
upstream `desktop/src/blueprint_palette.h` over `vendor/blueprint_palette.h` (or
set `$BLUEPRINT_PALETTE_H` to it) and run `npm run generate`. **Do not edit
`src/generated/` by hand.**

## Develop

```bash
cd reroll
npm install
npm run dev       # runs generate, then vite — open http://localhost:5173
npm run build     # tsc -b && vite build (also regenerates the color table)
```

Click **试用样例** to load the bundled `public/sample/beach_village.blueprint.json`,
or drag any `blueprint.json` onto the window.

## Layout

```
scripts/gen-role-colors.mjs   build-time role→color generator (parses the engine header)
src/
  generated/roleColors.ts     GENERATED — ordered role→color rules + colorForRole()
  types.ts                    blueprint JSON contracts (mirrors render_overlay.py schema)
  blueprint.ts                parse blueprint JSON + resolve canvas size
  convert.ts                  blueprint → lite TileMap (faithful port of blueprint_importer.cpp)
  model.ts                    lite TileMap types + helpers (translate, setTerrainCell, cloneTerrain)
  commands.ts                 Command + UndoStack; move / lock / paint-terrain commands
  saveFormat.ts               lite TileMap → adna-web-lite export (docs/WEB_LITE_SCHEMA.md)
  download.ts                 client-side JSON download helper
  render.ts                   cached-scene Canvas 2D renderer (offscreen scene blit + dynamic overlay) + hit-grid
  legend.ts                   active-role legend + ruleIndexForRole (shared color bucket)
  components/CanvasView.tsx    canvas + RMB select/move + LMB paint/resize/move + pan/zoom/hover
  App.tsx                     load · undo stack · selection · brush state · contextual brush strip · export · legend
```
