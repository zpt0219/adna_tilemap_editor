# Reroll layer model — category layers

Status: **spec, agreed** — not yet implemented. This is the target model for how
reroll groups a converted blueprint into editable layers.

## Why

A blueprint authors terrain as many small objects (the bundled
`beach_village` has 28 objects on its `land` layer alone — 18 of them are
separate `field` patches). The authored layer names (`land/roads/town/docks`)
also mix unrelated things (the `land` layer holds ocean + ground + forest). That
is too granular and not organized the way you draw a map.

Reroll re-groups everything into a small, fixed set of **category layers ordered
by draw order (z-order)** — bottom to top, the way you'd paint a map. Each
category is a collapsible layer; expanding it lists the objects hanging under it.

The goal: a drastically simpler structure than desktop's, while staying a
**subset** of the desktop tilemap format so desktop can still load what we
export.

## The categories (bottom → top = draw order)

| z | Category | Engine type | What goes in it | Merge? |
| --- | --- | --- | --- | --- |
| ① bottom | **Background** | `TERRAIN_2` | `ocean` / `sea` (it *is* the base) | merge |
| ② | **Terrain** | `TERRAIN_2_CORNER` | grass / dirt / sand / field / mountain (cliff+rock) / water (lake+pond+river) | merge |
| ③ | **Path** | `TERRAIN_2_EDGE` | dirt road / brick road / fence / wall / hedge … | merge |
| ④ | **Terrain Deco** | `FIXED_RECT_GROUP` (frg) | trees / rocks / tufts of grass … — one frg per kind | merge |
| ⑤ | **Building** | `FIXED_RECT` (primitive) | individual houses | **no** |
| ⑥ top | **Building Deco** | `FIXED_RECT` / frg | props, signs, etc. | primitives: no |

`Path` sits above `Terrain` and below `Terrain Deco`; walls/fences live here too.

## Assignment — `category = f(role, type)`

Evaluate in order, first match wins:

1. `role ∈ {ocean, sea}` → **Background** (special-cased to the bottom).
2. `role ∈ {road, path, corridor, street, bridge, trail, lane}` or
   `{wall, fence, border, hedge, railing}` (≈ `TERRAIN_2_EDGE`) → **Path**.
3. vegetation `role ∈ {forest, tree, woods, wood, orchard, grove, jungle, bush,
   shrub}` → **Terrain Deco**, and **re-typed to frg** — continuous area
   `forest` is treated as a tree frg too (we don't keep area-forest as terrain).
4. any other **frg** object → **Terrain Deco**.
5. **`FIXED_RECT`**: a building role (house/building/barn/shop/tower/…) →
   **Building**; otherwise → **Building Deco**.
6. everything left (a `TERRAIN_2_CORNER` area) → **Terrain**.

## Merge — one rule

- Within a category, **mergeable objects are collapsed by rendered color** (the
  overlay color from `src/generated/roleColors.ts`). So `lake+pond+river` → one
  blue water area; 18 `field` → one olive field; `cliff+rock` → one deep-red
  mountain; tree-green → one tree frg; rock-red → one rock frg.
- **Primitive objects are never merged** — they stay listed individually. A
  *primitive* is a single `FIXED_RECT` placeable (a house, a boat, a well),
  **including future resizable / nine-slice placeables**.
- Merging is **within a category only** — an olive Terrain field and an
  olive-colored deco never merge across categories.
- Stacking is preserved: a cell may belong to several category layers at once;
  the higher category draws on top, and erasing it reveals the one below
  (grass under trees survives). Each merged area keeps its own terrain matrix,
  same as today (see [`model.ts`](../src/model.ts) `TerrainMatrix`).

## Export (compatibility)

- Export stays a **layer tree, but only one level deep**: the top-level layers
  are these categories, with objects hanging directly under them.
- Each object keeps its **engine `type` + `role`**; merged areas are valid
  `TERRAIN_2` / frg objects.
- Result: the web's exported tilemap is a **subset of the desktop format**
  (desktop trees can nest deeper; web only emits the shallow case), so desktop
  loads it directly. No need to reconstruct the original authored layer tree.

## Worked example — `beach_village`

```
▸ Background      ocean
▾ Terrain         water (lake+pond) · sand · grass · field land (18 → 1) · mountain (cliff+rock)
▾ Path            road · brick_road            (no fences in this sample)
▾ Terrain Deco    trees (forest + 2 trees → 1 frg)
▾ Building        house #1 … #13 · building    ← individual
▾ Building Deco   boat · dock · prop           ← individual
```

28-on-one-layer collapses into a few merged areas; the houses stay separate.

## Implementation plan (keeps the faithful importer intact)

1. **`convert.ts` unchanged** — it stays a faithful port of the engine importer
   (guarded by the round-trip test). Re-grouping must not touch it.
2. **New normalize pass** (post-convert): assign categories → re-type vegetation
   to frg → merge by color → order into the fixed z-order.
3. **Collapsible layer panel** UI: categories collapsed by default; expand to
   list the objects under each.
4. **`saveFormat` update**: emit the one-level, desktop-subset category tree.
