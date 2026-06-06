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

Role-first, evaluated in order, first match wins. The blueprint already encodes
shape as the engine type — `TERRAIN_2` for areas, **frg** for scatter/clusters
(stones, grass tufts, building clusters) — so we use role for *what* and type for
*area vs scatter*.

1. `role ∈ {ocean, sea}` → **Background** (special-cased to the bottom).
2. building `role ∈ {house, building, barn, shop, tower, hut, cabin, cottage,
   manor, mill, shed, stable}` → **Building** — even when authored as an frg
   cluster.
3. `role ∈ {road, path, corridor, street, bridge, trail, lane}` /
   `{wall, fence, border, hedge, railing}` or type `TERRAIN_2_EDGE` → **Path**.
4. vegetation `role ∈ {forest, tree, woods, orchard, grove, jungle, bush, shrub}`
   → **Terrain Deco**, **re-typed to frg** — continuous area `forest` becomes a
   tree frg too (we don't keep area-forest as terrain).
5. **frg** scatter: a terrain-vocabulary role (rock/stone, grass, …) →
   **Terrain Deco** (stones, grass tufts); anything else (props) →
   **Building Deco**.
6. **`FIXED_RECT` / `DUNGEON`** → **Building Deco**.
7. everything left (a `TERRAIN_2` area) → **Terrain**.

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
▸ Background      water (ocean)
▾ Terrain         mountain (cliff) · sand · field (18 → 1) · water (lake+pond)
▾ Path            road · brick road            (no fences in this sample)
▾ Terrain Deco    trees (forest + 2 trees) · grass (tufts) · rocks (stones)
▾ Building        house #1 … #13 · building    ← individual
▾ Building Deco   dock · boat · prop           ← individual
```

47 objects collapse to a handful of merged areas; the houses (and the building
cluster) stay separate. Here `grass` and `rock` were authored as frg scatter, so
they land in Terrain Deco; `cliff` is a `TERRAIN_2` area, so it is Terrain.

## Implementation plan (keeps the faithful importer intact)

1. **`convert.ts` unchanged** — it stays a faithful port of the engine importer
   (guarded by the round-trip test). Re-grouping must not touch it.
2. **New normalize pass** (post-convert): assign categories → re-type vegetation
   to frg → merge by color → order into the fixed z-order.
3. **Collapsible layer panel** UI: categories collapsed by default; expand to
   list the objects under each.
4. **`saveFormat` update**: emit the one-level, desktop-subset category tree.
