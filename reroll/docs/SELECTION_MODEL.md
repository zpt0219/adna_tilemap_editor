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
  Marquee is an explicit **one-shot tool** (`handle_marquee_tool`, toolbar
  "Marquee (M)" / `M` key): arming it makes LMB box-select regardless of
  selection, and one completed box disarms it (`set_marquee_mode(false)`).
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
| marquee | LMB drag, one-shot tool (M) | **LMB drag, one-shot Marquee tool (M)** (Ctrl = additive) |
| pan | MMB | **MMB** (already) |
| paint / resize | LMB (brush/resize tool) | **LMB** (already) |
| panel Ctrl / Shift | same | **same, 1:1** |

### Marquee = one-shot LMB tool (`handle_marquee_tool`)

Exactly like desktop: marquee is an explicit, **one-shot tool** on **LMB**, not a
gesture you can do anytime. A toolbar button **"Marquee (M)"** (and the **`M`**
key) arms it; while armed, LMB-drag draws the box and on release it **auto-pops
back to the normal tool** (Aseprite-style — desktop `set_marquee_mode(false)` on
release). Because it's an explicit mode it runs **regardless of what's selected**,
so it never collides with LMB painting/resizing. Semantics are identical to
desktop: active-layer only, AABB intersect, **Ctrl/Cmd at press = additive**, ~4px
threshold, and **no-drag → pick** (honours Ctrl toggle).

The toolbar button shows armed/disarmed state; arming marquee is the only place
LMB stops being the edit tool, and only until one box completes.

## Rules (all mirrored from desktop)

1. **Single-layer.** A multi-selection only ever contains objects from one layer
   (the active layer). A plain pick in another layer switches the active layer and
   resets to a single selection. Ctrl/Shift that would cross layers is treated as
   a fresh single pick in the new layer (never accumulates across layers).
2. **RMB click** on object → `select` (switch layer if needed). **Ctrl+RMB**
   on an object in the active layer → toggle membership. RMB click on empty =
   no-op (matches desktop `try_pick_at_tile`; it does not clear).
3. **RMB drag**:
   - on a member of a 2+ selection (no Ctrl) → **group move** (all selected move
     together); a no-drag press reduces to that one member.
   - on a single selected/just-picked object → move it.
   - on empty space → no-op (RMB does not marquee; pan is MMB).
4. **Marquee** (LMB, only while the one-shot Marquee tool is armed) →
   Ctrl at press = add to selection, else replace; empty box clears. **Hit** =
   object world-rect ∩ box (inclusive AABB), active layer only.
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
- **Marquee tool state**: a one-shot `marquee` flag (toolbar button **"Marquee
  (M)"** + `M` shortcut). While armed, LMB-drag box-selects; on release the flag
  clears (pops back). Mirror desktop `toolbar` `marquee_mode_` /
  `set_marquee_mode` and `handle_marquee_tool`.
- **CanvasView**: on RMB, branch press into pick / group-move / move by what's
  under the cursor + modifier. When the marquee tool is armed, LMB runs the
  box-select gesture (draw the dashed box; on release run the active-layer AABB
  hit test, then disarm). Otherwise LMB stays paint/resize.
- **Commands**: a **group-move** command (move several objects by one delta, with
  map-bounds clamping) — extends the existing `moveObjectCommand`. One drag = one
  undo. Marquee/selection changes are **not** undoable (match desktop: selection
  is transient, only edits are commands).
- **Hit test**: marquee uses object `rect` (bounding box) — cheap and matches
  desktop's world-rect AABB.

## Out of scope (for this pass)

Cut/copy/duplicate of a selection and cross-layer move — desktop has these but
they are separate features.
