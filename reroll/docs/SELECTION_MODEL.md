# Reroll selection model — multi-select aligned with desktop

Status: **spec, agreed** — not yet implemented. Goal: the web editor's selection
behaves as close to the desktop editor as possible.

## Desktop reference (the source of truth)

Read from the engine repo `desktop/src/panels/`:

- **Buttons are split by role** (`tilemap_view.cpp`):
  - **RMB** = the *selection / manipulation* button. It is configurable
    (`toolbar.h` `RmbAction`), default **`RMB_SELECT_MOVE_OBJ`**: RMB click picks
    (`try_pick_at_tile`), RMB drag moves the picked object.
  - **MMB** = pan (always). RMB pans only if the user sets `RMB_PAN`.
  - **LMB** = the *active tool*: brush paint, resize, group-move, and **marquee**
    (`handle_lmb_actions`).
- **Pick — `try_pick_at_tile`**: Ctrl/Cmd-click on an object **in the active
  layer** → `toggle_select_object` (toggle membership, no layer switch);
  otherwise `select_layer` + `select_object` (switch layer, single select).
  → **multi-select is single-layer**.
- **Marquee — `apply_marquee_selection`**: active layer only; hit = **inclusive
  AABB overlap** of each object's world rect with the box; **additive** when
  Ctrl/Cmd was down at press (union with current), else replace (empty box
  clears). ~4px drag threshold; no drag → degrades to a pick (honours Ctrl).
- **Group move — `handle_group_move`**: with **2+ selected**, **no Ctrl**,
  pressing on a selected member → drag (>4px) moves the whole group; a plain
  click reduces the selection to just that member.
- **Panel — `object_list.cpp`** (within one layer's object list):
  - **Shift+click** → range from the anchor (current primary) to the clicked row,
    **replace** (`select_objects`). Shift wins over Ctrl.
  - **Ctrl/Cmd+click** → `toggle_select_object`.
  - plain click → `select_object` (single).
- **Selection ops** (`view_model.cpp`): `select_object` (replace single),
  `toggle_select_object` (Ctrl), `select_objects` (set a whole group),
  `select_layer`.

## Reroll mapping

Reroll already matches the desktop **default** button layout — **RMB = select +
move, MMB = pan, LMB = act on the selected object** (paint terrain / resize
rect). So we keep that and add the multi-select semantics on the same buttons.

| Action | Desktop | Reroll |
| --- | --- | --- |
| pick / switch layer | RMB click | **RMB click** (already) |
| Ctrl-toggle (single-layer) | Ctrl+RMB click | **Ctrl+RMB click** |
| move object | RMB drag | **RMB drag** (already) |
| group move (2+ selected) | LMB drag member | **RMB drag a selected member** |
| marquee | LMB drag (tool) | **RMB drag on empty** (Ctrl = additive) |
| pan | MMB | **MMB** (already) |
| paint / resize | LMB (brush/resize tool) | **LMB** (already) |
| panel Ctrl / Shift | same | **same, 1:1** |

### One deliberate placement: marquee on RMB

Desktop runs marquee on **LMB** because LMB is its tool-and-fallback-select
button. Reroll instead dedicates **RMB to all selection** (pick, Ctrl-toggle,
group-move) and keeps **LMB purely as the edit tool** (paint/resize) — the split
the web app already uses. So reroll's marquee lives on **RMB-drag-on-empty**: it
is still the same selection button, with the *exact* desktop marquee semantics
(active-layer, AABB intersect, Ctrl-additive, 4px threshold, no-drag → pick).
This replaces today's accidental "RMB-drag-empty pans" (pan stays on MMB).

## Rules (all mirrored from desktop)

1. **Single-layer.** A multi-selection only ever contains objects from one layer
   (the active layer). A plain pick in another layer switches the active layer and
   resets to a single selection. Ctrl/Shift that would cross layers is treated as
   a fresh single pick in the new layer (never accumulates across layers).
2. **RMB click** on object → `select` (switch layer if needed). **Ctrl+RMB**
   on an object in the active layer → toggle membership.
3. **RMB drag**:
   - on a member of a 2+ selection (no Ctrl) → **group move** (all selected move
     together); a no-drag press reduces to that one member.
   - on a single selected/just-picked object → move it.
   - on empty space → **marquee** (Ctrl at press = add to selection, else
     replace; empty result clears).
4. **Marquee hit** = object world-rect ∩ box (inclusive AABB), active layer only.
5. **Panel**: Shift = range-replace from anchor; Ctrl = toggle; plain = single.
   Anchor = the current primary selection; range is within one layer's list.
6. **Lock/visibility, paint, etc.** keep acting on the selection: lock already
   applies to all selected; the brush still targets the primary selected terrain.

## What this needs (notes for implementation, not done yet)

- **Model**: selection is already `Set<number>` (`App.tsx`). Add a small
  **anchor id** (primary) for Shift-range; reuse `[...selected][0]` as primary
  elsewhere.
- **`onSelect`**: extend the existing `(id, additive)` to carry a mode
  (`replace | toggle | range`) and enforce the single-layer rule (compare the
  hit's layer to the active layer).
- **CanvasView**: on RMB, branch press into pick / group-move / marquee by what's
  under the cursor and the modifier; draw the dashed marquee box; on release run
  the AABB hit test against the active layer.
- **Commands**: a **group-move** command (move several objects by one delta, with
  map-bounds clamping) — extends the existing `moveObjectCommand`. One drag = one
  undo. Marquee/selection changes are **not** undoable (match desktop: selection
  is transient, only edits are commands).
- **Hit test**: marquee uses object `rect` (bounding box) — cheap and matches
  desktop's world-rect AABB.

## Out of scope (for this pass)

Cut/copy/duplicate of a selection, cross-layer move, and an explicit "Marquee
tool" toggle (desktop's `M`) — desktop has these but they are separate features.
