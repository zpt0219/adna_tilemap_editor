// commands.ts — simplified command model + undo stack (WEB_LITE_REROLL_EDITOR.md §9).
// Each command captures its target by id at construction (ADR-003 spirit: capture
// at init, resolve by id in do/undo — never re-read live selection).

import {
  cloneTerrain,
  findLayer,
  findObject,
  isLocked,
  translateObject,
  type LiteTileMap,
  type LiteType,
  type Rect,
  type TerrainMatrix,
} from "./model";

export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

export class UndoStack {
  private undoArr: Command[] = [];
  private redoArr: Command[] = [];

  /** Run a command and record it (clears the redo branch). */
  push(c: Command): void {
    c.do();
    this.undoArr.push(c);
    this.redoArr = [];
  }
  undo(): void {
    const c = this.undoArr.pop();
    if (c) { c.undo(); this.redoArr.push(c); }
  }
  redo(): void {
    const c = this.redoArr.pop();
    if (c) { c.do(); this.undoArr.push(c); }
  }
  get canUndo(): boolean { return this.undoArr.length > 0; }
  get canRedo(): boolean { return this.redoArr.length > 0; }
}

function setPosition(map: LiteTileMap, id: number, x: number, y: number): void {
  const o = findObject(map, id);
  if (o) translateObject(o, x - o.rect[0], y - o.rect[1]);
}

/** Move an object from `before` to `after` (top-left tile coords). */
export function moveObjectCommand(
  map: LiteTileMap,
  id: number,
  before: [number, number],
  after: [number, number],
): Command {
  return {
    label: "Move",
    do: () => setPosition(map, id, after[0], after[1]),
    undo: () => setPosition(map, id, before[0], before[1]),
  };
}

/**
 * Move several objects together by one (dx,dy) delta (group move). Captures the
 * id list + delta; do/undo translate every still-present member. One drag = one
 * undo. The caller is responsible for clamping the delta so the group stays on
 * the map (see CanvasView).
 */
export function moveObjectsCommand(map: LiteTileMap, ids: number[], dx: number, dy: number): Command {
  const shift = (sx: number, sy: number) =>
    ids.forEach((id) => { const o = findObject(map, id); if (o) translateObject(o, sx, sy); });
  return { label: "Move", do: () => shift(dx, dy), undo: () => shift(-dx, -dy) };
}

/** Resize an object's rect (FIXED_RECT). Captures target by id. */
export function resizeObjectCommand(map: LiteTileMap, id: number, before: Rect, after: Rect): Command {
  const set = (r: Rect) => {
    const o = findObject(map, id);
    if (o) o.rect = [...r];
  };
  return { label: "Resize", do: () => set(after), undo: () => set(before) };
}

function setLock(map: LiteTileMap, id: number, locked: boolean): void {
  const o = findObject(map, id);
  if (!o) return;
  if (locked) o.tags["web.lock"] = "true";
  else delete o.tags["web.lock"];
}

/** Toggle an object's lock to `locked` (lock = a `web.lock` tag). */
export function toggleLockCommand(map: LiteTileMap, id: number, locked: boolean): Command {
  return {
    label: locked ? "Lock" : "Unlock",
    do: () => setLock(map, id, locked),
    undo: () => setLock(map, id, !locked),
  };
}

/** Lock state of an id (helper for toolbar wiring). */
export function lockedOf(map: LiteTileMap, id: number): boolean {
  const o = findObject(map, id);
  return o ? isLocked(o) : false;
}

/**
 * Show/hide several objects at once (per-object `enabled`). Captures each id's
 * prior state so undo restores a mixed selection exactly. Hidden objects drop
 * out of render + hit-test (eachVisibleObject) but stay in the layer list.
 */
export function setObjectsEnabledCommand(map: LiteTileMap, ids: number[], enabled: boolean): Command {
  const before = ids.map((id) => findObject(map, id)?.enabled ?? true);
  const set = (id: number, v: boolean) => { const o = findObject(map, id); if (o) o.enabled = v; };
  return {
    label: enabled ? "Show" : "Hide",
    do: () => ids.forEach((id) => set(id, enabled)),
    undo: () => ids.forEach((id, i) => set(id, before[i])),
  };
}

/** Rename an object's display name (the `web.name` tag; empty clears it). */
export function renameObjectCommand(map: LiteTileMap, id: number, before: string, after: string): Command {
  const set = (name: string) => {
    const o = findObject(map, id);
    if (!o) return;
    if (name) o.tags["web.name"] = name; else delete o.tags["web.name"];
  };
  return { label: "Rename", do: () => set(after), undo: () => set(before) };
}

/** Change a terrain object's autotile type (e.g. fix a 2-edge/2-corner mislabel).
 *  Geometry (the cell matrix) is unchanged; the bound palette is re-resolved. */
export function setObjectTypeCommand(map: LiteTileMap, id: number, before: LiteType, after: LiteType): Command {
  const set = (t: LiteType) => { const o = findObject(map, id); if (o) o.type = t; };
  return { label: "Change type", do: () => set(after), undo: () => set(before) };
}

/** Force a specific pack palette on an object (the `web.palette` tag), or clear
 *  it (undefined) to fall back to automatic role resolution. */
export function setObjectPaletteCommand(map: LiteTileMap, id: number, before: string | undefined, after: string | undefined): Command {
  const set = (hash: string | undefined) => {
    const o = findObject(map, id);
    if (!o) return;
    if (hash) o.tags["web.palette"] = hash; else delete o.tags["web.palette"];
  };
  return { label: after ? "Set palette" : "Reset palette", do: () => set(after), undo: () => set(before) };
}

/** Move a house decoration slot to a new (already-clamped) local cell. */
export function moveHouseDecoCommand(map: LiteTileMap, id: number, slot: number, before: [number, number], after: [number, number]): Command {
  const set = (cell: [number, number]) => { const o = findObject(map, id); if (o?.house) o.house.deco[slot].cell = [...cell]; };
  return { label: "Move decoration", do: () => set(after), undo: () => set(before) };
}

/** Set / clear a decoration slot's palette override (hash). */
export function setHouseDecoPaletteCommand(map: LiteTileMap, id: number, slot: number, before: string | undefined, after: string | undefined): Command {
  const set = (h: string | undefined) => {
    const o = findObject(map, id);
    if (!o?.house) return;
    if (h) o.house.deco[slot].palette = h; else delete o.house.deco[slot].palette;
  };
  return { label: "Decoration palette", do: () => set(after), undo: () => set(before) };
}

/** Set / clear the wall or roof slot palette override (hash). */
export function setHouseSlotPaletteCommand(map: LiteTileMap, id: number, slot: "wall" | "roof", before: string | undefined, after: string | undefined): Command {
  const set = (h: string | undefined) => {
    const o = findObject(map, id);
    if (!o?.house) return;
    if (h) o.house[slot] = h; else delete o.house[slot];
  };
  return { label: `${slot} palette`, do: () => set(after), undo: () => set(before) };
}

/** Change a house's wall-band height (rows from the bottom). */
export function setWallHeightCommand(map: LiteTileMap, id: number, before: number, after: number): Command {
  const set = (v: number) => { const o = findObject(map, id); if (o?.house) o.house.wallHeight = v; };
  return { label: "Wall height", do: () => set(after), undo: () => set(before) };
}

/** Change a house's wall/roof overlap rows. */
export function setHouseOverlapCommand(map: LiteTileMap, id: number, before: number, after: number): Command {
  const set = (v: number) => { const o = findObject(map, id); if (o?.house) o.house.overlap = v; };
  return { label: "House overlap", do: () => set(after), undo: () => set(before) };
}

export interface TerrainSnapshot {
  terrain: TerrainMatrix;
  rect: Rect;
}

/**
 * One terrain brush stroke = one command. `before`/`after` are matrix+rect
 * snapshots of the painted object (the stroke may have grown the matrix). `do`
 * is idempotent — at push time the live object already holds `after`.
 */
export function paintTerrainCommand(
  map: LiteTileMap,
  id: number,
  before: TerrainSnapshot,
  after: TerrainSnapshot,
): Command {
  const restore = (s: TerrainSnapshot) => {
    const o = findObject(map, id);
    if (o) { o.terrain = cloneTerrain(s.terrain); o.rect = [...s.rect]; }
  };
  return { label: "Paint terrain", do: () => restore(after), undo: () => restore(before) };
}

// --- layer commands (document state → undoable; active-layer highlight is not) ---

/** Toggle a layer's visibility (enabled). Captured by layer id. */
export function toggleLayerEnabledCommand(map: LiteTileMap, layerId: number): Command {
  const set = (v: boolean) => { const l = findLayer(map, layerId); if (l) l.enabled = v; };
  const before = findLayer(map, layerId)?.enabled ?? true;
  return { label: "Toggle layer", do: () => set(!before), undo: () => set(before) };
}

/** Toggle an object's visibility (enabled). Captured by object id. */
export function toggleObjectEnabledCommand(map: LiteTileMap, objectId: number): Command {
  const set = (v: boolean) => { const o = findObject(map, objectId); if (o) o.enabled = v; };
  const before = findObject(map, objectId)?.enabled ?? true;
  return { label: "Toggle object", do: () => set(!before), undo: () => set(before) };
}

function setLayerObjectOrder(map: LiteTileMap, layerId: number, order: number[]): void {
  const layer = findLayer(map, layerId);
  if (!layer || order.length !== layer.objects.length) return;
  const byId = new Map(layer.objects.map((o) => [o.id, o]));
  const next = order.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => o != null);
  if (next.length !== layer.objects.length) return;
  layer.objects = next;
}

/** Restore a layer's object order from captured id lists. */
export function reorderLayerObjectsCommand(
  map: LiteTileMap,
  layerId: number,
  before: number[],
  after: number[],
): Command {
  return {
    label: "Reorder objects",
    do: () => setLayerObjectOrder(map, layerId, after),
    undo: () => setLayerObjectOrder(map, layerId, before),
  };
}
