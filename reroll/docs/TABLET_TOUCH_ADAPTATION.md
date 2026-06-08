# Reroll tablet-touch adaptation

Status: **spec, proposed**. Scope is the **web editor only**. Target devices are
tablet-class touch screens such as **Galaxy Fold unfolded**, small Android
tablets, and iPad Mini sized browsers. **Phone layout is out of scope.**

This doc answers three product questions first:

1. Why do web first, not Android app first?
2. How should the web app distinguish **desktop** vs **tablet touch**?
3. What is the smallest tablet-touch editor that is actually worth shipping?

## Why web first

For reroll, web has four immediate advantages:

- The code already exists. The current app is a working React + Canvas editor.
- Distribution is trivial: open a URL, load a blueprint, export a result.
- Desktop browser and unfolded Fold can share most of the same rendering /
  command / save pipeline.
- We can learn whether the real bottleneck is **layout** or **touch
  interaction** before paying the cost of an Android app.

Android app may still win later for long-session editing, native file workflows,
and better gesture control. But the fastest path to product truth is: **make the
web editor good on tablet touch first, then decide whether the remaining pain is
big enough to justify an app.**

## Non-goals

- No phone-first responsive design.
- No Android app implementation in this pass.
- No attempt to make desktop and touch use exactly the same interaction model.
- No hidden "mobile web" branch with a separate save format or object model.

The data path stays exactly the same:

`parseBlueprint -> blueprintToLite -> normalizeToCategories -> assignUniqueObjectNames`

## Device classes

The web should not branch on user-agent strings like "Android" / "iPhone" /
"desktop". For reroll the important distinction is **input capability**, then
screen size.

### `desktop-fine`

Use the current desktop UI when both are true:

- `matchMedia("(pointer: fine)").matches`
- `matchMedia("(hover: hover)").matches`

This covers mouse / trackpad devices.

### `tablet-touch`

Use the tablet-touch UI when both are true:

- `matchMedia("(pointer: coarse)").matches`
- viewport is tablet-class:
  - `min(window.innerWidth, window.innerHeight) >= 700`

This intentionally catches unfolded Fold-class devices and small tablets, even
though the hardware may still be "a phone" in marketing terms.

### `phone-touch`

Anything coarse-pointer below that size is phone-class and **out of scope** for
this plan. It may render, but we do not promise a full editing experience there.

## Current blockers in the existing reroll UI

The current app is structurally desktop-first.

### Layout blockers

- Top bar is a single dense row of buttons in [App.tsx](../src/App.tsx).
- Main area is a fixed three-column layout in [styles.css](../src/styles.css):
  left `Layers` = `200px`, right `Props` = `210px`, center canvas fills the rest.
- Selected-object actions float near the object in `.obj-toolbar`, which is fine
  for mouse but easy to occlude or mis-tap on touch.
- Status and Fit button are anchored over the canvas and compete for space on a
  smaller viewport.

### Interaction blockers

The bigger problem is not CSS, it is pointer semantics in
[CanvasView.tsx](../src/components/CanvasView.tsx):

- **MMB** pans.
- **RMB** picks / moves / group-moves.
- **LMB** paints, resizes, or box-selects when Marquee is armed.
- Resize depends on **hovering near an edge**.
- Zoom depends on **mouse wheel**.

These assumptions map badly to a touch screen.

## Product target

The goal is not "desktop reroll squeezed smaller". The goal is:

**a tablet-touch patch editor that is good at loading a map, navigating it,
selecting objects, moving them, painting existing terrain, adjusting rects, and
exporting.**

If a feature does not help that workflow, it should not force extra chrome or
gesture complexity into v1.

## Recommended tablet-touch layout

Desktop layout can stay as-is. Tablet-touch gets its own presentation layer.

### Landscape tablet-touch

- Left side: `Layers` rail, always visible, width about `220px`.
- Center: canvas takes all remaining width.
- Right `Props` panel is **not** always pinned. It becomes a slide-over panel or
  bottom sheet opened by a toolbar button.

### Portrait tablet-touch

- Canvas is full width.
- `Layers` and `Props` both move into bottom sheets / drawers.
- Only a compact top toolbar stays visible above the canvas.

### Shared tablet rules

- Canvas is always the priority.
- Checkbox hit targets must be larger than desktop.
- The floating selected-object toolbar should be removed or minimized on touch.
  Object actions belong in the inspector sheet, not in a tiny canvas popover.
- `Legend` should not occupy a permanent sidebar on tablet. Fold it into a sheet
  or secondary panel.

## Recommended tablet-touch interaction model

Do **not** emulate right-click. Touch should have its own explicit model.

### Navigation

- **One-finger tap**: select object.
- **Two-finger pan**: move the viewport.
- **Pinch**: zoom.
- `Fit` remains as a visible button.

This removes the current dependency on MMB and mouse wheel.

### Editing modes

Tablet-touch should use explicit modes. Recommended v1 modes:

- `Select`
- `Move`
- `Paint`
- `Resize`
- `Marquee`

`Pan` does not need its own mode if two-finger pan always works.

### Mode behavior

- `Select`: tap selects; tap empty does nothing.
- `Move`: drag selected object; if multiple are selected, drag moves the group.
- `Paint`: drag paints the currently selected terrain object.
- `Resize`: selected `FIXED_RECT` shows visible resize handles; drag a handle to
  resize.
- `Marquee`: drag a box once, then auto-return to `Select` like the current
  one-shot desktop marquee.

### Why explicit modes

Current desktop reroll overloads LMB / RMB / MMB. Touch has only contact points,
so mode clarity matters more than button fidelity. Tablet users should always be
able to answer: "What will happen if I drag with one finger right now?"

## Layer and object panel behavior on touch

### Layers

- Layer order remains fixed and matches desktop.
- Layer rows keep the checkbox on the left.
- Expanding / collapsing a layer must have a larger hit target than desktop.

### Objects

- Object rows keep the checkbox on the left.
- Stable names remain required; reorder must move the name with the object.
- Reorder stays **within one layer only**.

### Reorder on touch

Do not rely on browser-native HTML drag-and-drop for tablet-touch.

Desktop can keep the current drag behavior. Tablet-touch should use one of these:

1. Long-press then drag within the same expanded layer list.
2. Explicit reorder handle on the right side of the row.

Recommended: start with an explicit reorder handle. It is clearer, easier to hit,
and less likely to conflict with row selection.

## Minimal ship scope for tablet-touch v1

These are the must-have actions:

1. Load blueprint / sample.
2. Pan and zoom comfortably with touch.
3. Select an object.
4. Move selected object(s).
5. Paint an existing terrain object.
6. Resize a selected `FIXED_RECT`.
7. Toggle layer / object visible.
8. Reorder objects within one layer.
9. Export.

If all nine feel solid on unfolded Fold and small tablet browsers, the web
version has already crossed the line from demo to useful tool.

## What can wait

- Phone editing UX.
- Extra gesture shortcuts.
- Fancy floating contextual UI.
- Cross-layer object move.
- Android-native shell, local cache, recent files, or share-to-open workflows.

Those are good app candidates if the web version later proves valuable enough.

## Implementation plan

### Phase 1: device classification and layout split

- Add a small view-mode hook:
  - `desktop-fine`
  - `tablet-touch`
  - `phone-touch`
- Keep desktop rendering and commands unchanged.
- Add tablet-touch layout for top bar, layers rail, and props sheet.

Deliverable: unfolded Fold opens the app without feeling cramped.

### Phase 2: touch navigation in `CanvasView`

- Add two-finger pan.
- Add pinch zoom.
- Keep `touch-action: none`.
- Make `Fit` and status placement work in both portrait and landscape tablet
  layouts.

Deliverable: user can comfortably navigate the whole map without a mouse.

### Phase 3: explicit touch editing modes

- Add touch mode state above `CanvasView`.
- Remap single-finger drag behavior by mode.
- Replace edge-hover resize with visible handles.
- Keep one drag / stroke = one undo entry.

Deliverable: move / paint / resize are predictable on touch.

### Phase 4: touch-friendly side panels

- Turn right `Props` into a sheet.
- Enlarge checkbox and row hit areas.
- Add explicit object reorder handle for tablet-touch.

Deliverable: side-panel workflows no longer feel desktop-shrunk.

### Phase 5: ship decision gate

After the web tablet version feels good, reassess whether Android app is still
needed. Escalate to app only if the remaining pain clusters around:

- native file integration,
- long-session touch ergonomics,
- background/offline expectations,
- or gesture fidelity the browser still cannot provide cleanly.

## Success criteria

Tablet-touch is "good enough to ship" when all are true:

- A Fold unfolded in landscape can load, navigate, edit, and export without a
  mouse.
- No core action depends on RMB, MMB, hover, or wheel input.
- Canvas remains the visual priority.
- The same save / undo / command model is reused; no parallel mobile data path
  appears.
- Desktop behavior remains intact.
