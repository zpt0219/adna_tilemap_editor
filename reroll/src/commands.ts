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
