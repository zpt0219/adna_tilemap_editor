# WEB_LITE_SCHEMA — `adna-web-lite` save format

Status: v1 (2026-06-05)
Owner: `web/reroll/` (the Web Lite Reroll Editor)
Related: `docs/WEB_LITE_REROLL_EDITOR.md` (§4 data model, §4.5 lite profile, §16),
`web/reroll/src/model.ts` (the in-memory lite TileMap this serializes).

This is the **web-owned** on-disk format the web editor exports. It is a readable
serialization of the lite TileMap — a documented subset of the desktop TileMap
document (`WEB_LITE_REROLL_EDITOR.md` §4: "web 不发明新格式,而是用 desktop
TileMap 文档的一个子集"). The web app writes this format; a desktop-side loader
(future pass) reads it and opens it **as a new map** using the mapping in §3.

It is intentionally **not** the desktop save format (`save_format.cpp`): no
base64 matrices, no `Recti` objects, no enum ints, no palettes. Those live only
on the desktop side; this format stays web-natural and human-diffable.

---

## 1. Top level

```jsonc
{
  "format": "adna-web-lite",   // magic string; loaders MUST check this
  "version": 1,                // schema version (this doc); bump on breaking change
  "name": "beach_village",     // display name (no semantics)
  "width": 112,                // canvas width in tiles  = blueprint root width (§3.6)
  "height": 64,                // canvas height in tiles = blueprint root height
  "tileResolution": 16,        // px/tile hint; blueprints are res-agnostic → default 16
  "layers": Layer[]            // flat layer list, array order = draw order (see §2)
}
```

`width`/`height` are the authoritative canvas size — the web app never resizes a
map (`WEB_LITE_REROLL_EDITOR.md` §3.6). A loader sizes the new map to these.

The web model is a **flat ordered layer list, not a tree** — the blueprint's
layer tree is flattened on import (DFS pre-order; deep layers get a `parent/child`
name prefix). Array order **is** draw order: `layers[i]` draws under `layers[i+1]`.

## 2. Layer

```jsonc
Layer = {
  "name": "__BLUEPRINT__",
  "enabled": true,                             // ALWAYS present; hidden layers export enabled:false
  "tags": { "adna.kind": "blueprint", ... },   // optional; omitted when empty
  "objects": Object[]                          // this layer's objects, in draw order
}
```

When the map originated from a blueprint, **every exported layer carries
`tags["adna.kind"] = "blueprint"`** (stamped on export). On the desktop this makes
each a *blueprint root*, which renders the role→color overlay with **no palettes
required** (`desktop/src/panels/tilemap_view.cpp` `draw_blueprint_overlay`;
`isBlueprintRoot()` / default `BlueprintRenderMode::BLUEPRINT`, `src/core/layer.h`).
So an exported web map opens looking exactly like the web overlay.

`enabled` is exported verbatim — a layer hidden in the web editor exports
`enabled:false` and opens hidden on the desktop (desktop `Layer` has the field).

## 3. Object

```jsonc
Object = {
  "type":  "FIXED_RECT" | "TERRAIN_2_CORNER" | "TERRAIN_2_EDGE"
         | "FIXED_RECT_GROUP" | "DUNGEON",   // string names (a subset of TiledObject::Type)
  "rect":  [x, y, w, h],                       // origin + size, tile coords, w/h ≥ 1
  "enabled": true,
  "tags":  { "blueprint.role": "house", ... }, // role drives overlay color; web.lock etc. preserved
  "cells":  [[x, y], ...],   // TERRAIN_2_* and FIXED_RECT_GROUP only — present terrain cells (absolute)
  "points": [[x, y], ...]    // DUNGEON only — absolute border polygon
}
```

- **Geometry by type**: `FIXED_RECT` uses `rect` only. `TERRAIN_2_*` and
  `FIXED_RECT_GROUP` carry `cells` (the per-object terrain footprint; `rect` is the
  cells' AABB). `DUNGEON` carries `points`.
- **`tags`** are copied verbatim, including `blueprint.role` / `blueprint.style` /
  `blueprint.label` and any unknown keys (e.g. `web.lock`) — forward-compatible
  round-trip (§4.5). Empty `tags` are omitted.

## 4. Mapping to the desktop save schema (for the future loader)

A desktop loader converts each field to the desktop save encoding (verified
against `src/serialize/json_codec.{h,cpp}`, `src/serialize/save_format.cpp`,
`src/object/tiled_object.h`):

| web-lite field | desktop save encoding |
|---|---|
| `type` (string) | `TiledObject::Type` int: `FIXED_RECT=1`, `DUNGEON=10`, `TERRAIN_2_CORNER=11`, `TERRAIN_2_EDGE=12`, `FIXED_RECT_GROUP=15` |
| `rect: [x,y,w,h]` | `Recti` `{minX:x, minY:y, maxX:x+w-1, maxY:y+h-1}` (inclusive) |
| `cells: [[x,y]…]` | `Int16Matrix` over the rect AABB: present cell = `0`, empty = `-1`; serialized `{width,height,data_b64}` (base64 of row-major little-endian int16) |
| `points: [[x,y]…]` | `borderPoints`, **object-local** (subtract `rect` origin) |
| `tags` | object tags, verbatim |
| `name`/`width`/`height`/`tileResolution` | `tilemap.{width,height,tileResolution}`; layer/object `name` |
| `layers` (flat, ordered) | `tilemap.layers` — the web layers become **sibling** top-level layers under the desktop root, same order |
| `enabled` (per layer) | desktop `Layer::enabled`, verbatim (hidden stays hidden) |
| per-layer `tags["adna.kind"]="blueprint"` | blueprint-root flag → overlay render mode |

The loader emits the desktop root `{ "tilemap": { formatVersion, width, height,
tileResolution, palettes: [], layers: [<converted layers…>] } }` (handler
context keys default — old files with only `tilemap` still load). The flat web
`layers` map directly to `tilemap.layers` siblings in the same order. Objects need
no palette; the blueprint overlay renders from `blueprint.role` tags.

**FRG note**: web exports `cells` only. The loader reconstructs the terrain
matrix from `cells` and defaults the REAL-mode scatter fields (`noise` /
`occupation` / cell weights); they're irrelevant to the role overlay.

## 5. Versioning

`version` is this document's schema version. Additive fields don't bump it;
removing/renaming a field or changing an encoding does. Loaders should accept any
`version ≤` their own and ignore unknown fields.
