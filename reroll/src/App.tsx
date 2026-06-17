import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { parseBlueprint } from "./blueprint";
import { blueprintToLite } from "./convert";
import { normalizeToCategories } from "./normalize";
import { assignUniqueObjectNames, cloneObjectDeep, cloneTerrain, displayName, findLayer, findObject, isLocked, layerOfObject, roleOf, setTerrainCell, translateObject, type HouseDecorationKind, type LiteObject, type LiteTileMap, type Rect } from "./model";
import { UndoStack, createObjectCommand, createObjectsCommand, deleteObjectsCommand, moveHouseDecoCommand, moveObjectCommand, moveObjectsCommand, paintTerrainCommand, renameObjectCommand, reorderLayerObjectsCommand, resizeObjectCommand, setHouseDecoPaletteCommand, setHouseDecorationsCommand, setHouseOverlapCommand, setHouseSlotPaletteCommand, setObjectsEnabledCommand, setObjectPaletteCommand, setObjectTypeCommand, setWallHeightCommand, toggleLayerEnabledCommand, toggleObjectEnabledCommand, type Command, type LayerObjectSnapshot, type TerrainSnapshot } from "./commands";
import type { LiteType } from "./model";
import { liteToWebSave } from "./saveFormat";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { downloadJson } from "./download";
import { colorForRole } from "./generated/roleColors";
import { CanvasView, type BrushState } from "./components/CanvasView";
import { PaletteSwatch } from "./components/PaletteSwatch";
import { PropsPanel } from "./components/PropsPanel";
import { loadPackFromUrl } from "./pack/loadPack";
import { compileMap } from "./pack/compile";
import { PaletteMode, type Palette, type PackRuntime } from "./pack/types";
import type { RenderMode } from "./render";
import { generateDecorations } from "./house";
import { createObjectForRole, type CreateKind } from "./objectFactory";
import { createKindsForRole, roleRoot } from "./roleTree";

const isTerrain = (o: LiteObject | null) => !!o && (o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE");

type DropSide = "before" | "after";

interface DraggedObject {
  layerId: number;
  objectId: number;
}

interface DropTarget {
  layerId: number;
  targetId: number;
  side: DropSide;
}

interface ClipboardEntry {
  index: number;
  object: LiteObject;
}

interface ObjectClipboard {
  layerId: number;
  layerName: string;
  entries: ClipboardEntry[];
  pasteCount: number;
}

interface CreatePaletteChoice {
  kind: CreateKind;
  palette: Palette;
  role: string;
}

function dropSideFromEvent(e: ReactDragEvent<HTMLDivElement>): DropSide {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function reorderWithinLayer(ids: number[], sourceId: number, targetId: number, side: DropSide): number[] {
  if (sourceId === targetId) return ids;
  const without = ids.filter((id) => id !== sourceId);
  const at = without.indexOf(targetId);
  if (at < 0) return ids;
  const next = [...without];
  next.splice(side === "before" ? at : at + 1, 0, sourceId);
  return next;
}

function sameOrder(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function uniqueName(existing: Set<string>, base: string): string {
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }
  let n = 2;
  while (existing.has(`${base} #${n}`)) n++;
  const next = `${base} #${n}`;
  existing.add(next);
  return next;
}

const CREATE_KIND_LABEL: Record<CreateKind, string> = {
  terrain_area: "Area",
  terrain_line: "Line",
  fixed_rect: "Rect",
  fixed_rect_group: "FRG",
  house: "House",
};

const DEFAULT_KIND_ORDER: CreateKind[] = ["terrain_area", "terrain_line", "fixed_rect", "fixed_rect_group", "house"];
const BUILDING_KIND_ORDER: CreateKind[] = ["house", "fixed_rect", "fixed_rect_group", "terrain_area", "terrain_line"];

function paletteSupportsKind(mode: PaletteMode, kind: CreateKind): boolean {
  if (kind === "terrain_area") return mode === PaletteMode.TWO_CORNER || mode === PaletteMode.QUAD;
  if (kind === "terrain_line") return mode === PaletteMode.TWO_EDGE || mode === PaletteMode.CONTOUR;
  if (kind === "fixed_rect" || kind === "fixed_rect_group") {
    return mode === PaletteMode.FIXED_RECT || mode === PaletteMode.NINE_PATCH || mode === PaletteMode.H_STRETCH || mode === PaletteMode.V_STRETCH;
  }
  return mode === PaletteMode.CLIFF;
}

function paletteCreateKinds(palette: Palette): CreateKind[] {
  const roleKinds = createKindsForRole(palette.role);
  return roleKinds.filter((kind) => paletteSupportsKind(palette.mode, kind));
}

export default function App() {
  const [map, setMap] = useState<LiteTileMap | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  // palette pack + real-tile rendering
  const [pack, setPack] = useState<PackRuntime | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("mixed");
  const [packVersion, setPackVersion] = useState(0);
  // draggable width of the right props panel (px), persisted
  const [propsWidth, setPropsWidth] = useState(() => Number(localStorage.getItem("reroll_props_w")) || 240);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // anchor for Shift-range selection (the last plainly-picked / Ctrl-toggled id)
  const [anchorId, setAnchorId] = useState<number | null>(null);
  // one-shot Marquee tool armed (docs/SELECTION_MODEL.md); LMB box-selects, then pops back
  const [marquee, setMarquee] = useState(false);
  const [brushSize, setBrushSize] = useState(3);
  const [brushErase, setBrushErase] = useState(false);
  // active layer = pure highlight + selection scope (not undoable, not exported)
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState<DraggedObject | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [createKind, setCreateKind] = useState<CreateKind>("fixed_rect");
  const [createPaletteHash, setCreatePaletteHash] = useState("");
  const [createArmed, setCreateArmed] = useState(false);
  const [clipboard, setClipboard] = useState<ObjectClipboard | null>(null);
  const undo = useRef(new UndoStack());
  const stroke = useRef<{ id: number; before: TerrainSnapshot; dirty: boolean } | null>(null);
  const decoDrag = useRef<{ id: number; index: number; before: [number, number] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);

  const build = useCallback((name: string, text: string) => {
    let lite = normalizeToCategories(blueprintToLite(parseBlueprint(name, text)));
    assignUniqueObjectNames(lite);
    // resume an unfinished local session for this source, if the user wants it
    const draft = loadDraft(name);
    if (draft) {
      const when = new Date(draft.savedAt).toLocaleString();
      if (confirm(`发现「${name}」上次未完成的修改（保存于 ${when}）。\n\n确定 = 继续上次进度；取消 = 放弃改动,重新打开。`)) {
        lite = draft.map;
      } else {
        clearDraft(name);
      }
    }
    undo.current = new UndoStack();
    setMap(lite);
    setSelected(new Set());
    setAnchorId(null);
    setMarquee(false);
    setClipboard(null);
    setActiveLayerId(lite.layers[0]?.id ?? null);
    setExpanded(new Set());
    setVersion(0);
    setError("");
  }, []);

  const load = useCallback((name: string, text: string) => {
    build(name, text);
  }, [build]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const loadFile = useCallback(async (file: File) => {
    try { load(file.name, await file.text()); }
    catch (e) { setError(`加载失败: ${(e as Error).message}`); }
  }, [load]);

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample/test_village_strict.blueprint.json`);
      if (!res.ok) throw new Error(`sample 不可用 (${res.status})`);
      load("test_village_strict (sample)", await res.text());
    } catch (e) { setError(`样例加载失败: ${(e as Error).message}`); }
  }, [load]);

  // load the palette pack once: prefer the server's live default (kept current by
  // the tagger's "apply roles" button), fall back to the bundled copy (gh-pages/offline).
  useEffect(() => {
    loadPackFromUrl("/api/reroll-pack")
      .catch(() => loadPackFromUrl(`${import.meta.env.BASE_URL}sample/palettes.adnapalettepack`))
      .then(setPack)
      .catch((e) => setError(`palette pack 加载失败: ${(e as Error).message}`));
  }, []);

  // open straight to the rendered sample village (so the live/Pages link shows
  // tiles immediately); the user can still drop or open their own blueprint
  useEffect(() => { void loadSample(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  // bind a palette to each object by role (also recompiled on edits — type
  // conversion / palette override change the bindings; version bumps on every command)
  const bindings = useMemo(() => (map && pack ? compileMap(map, pack) : null), [map, pack, version]);
  // invalidate the cached scene when bindings / render mode change
  useEffect(() => { setPackVersion((v) => v + 1); }, [bindings, renderMode]);

  useEffect(() => {
    const onDrop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) void loadFile(f); };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => { window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onDragOver); };
  }, [loadFile]);

  // drag the canvas|props divider to resize the right panel
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) =>
      setPropsWidth(Math.min(560, Math.max(180, window.innerWidth - ev.clientX)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
  useEffect(() => { localStorage.setItem("reroll_props_w", String(propsWidth)); }, [propsWidth]);

  // autosave the edit session to localStorage (debounced) — only after a real
  // edit (version>0), so just opening a map doesn't create a phantom "resume?" draft
  useEffect(() => {
    if (!map || version === 0) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveDraft(map.name, map), 500);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [map, version]);

  // --- commands ---
  const run = useCallback((cmd: Command) => { undo.current.push(cmd); setVersion((v) => v + 1); }, []);
  const onUndo = useCallback(() => { undo.current.undo(); setVersion((v) => v + 1); }, []);
  const onRedo = useCallback(() => { undo.current.redo(); setVersion((v) => v + 1); }, []);

  const onExport = useCallback(() => {
    if (!map) return;
    const base = (map.name || "map").replace(/\s*\(sample\)$/, "").replace(/\.[^.]+$/, "") || "map";
    downloadJson(`${base}.adnaweb.json`, liteToWebSave(map));
    clearDraft(map.name); // saved to disk → drop the local resume draft
  }, [map]);

  const onMove = useCallback((id: number, before: [number, number], after: [number, number]) => {
    if (map) run(moveObjectCommand(map, id, before, after));
  }, [map, run]);

  const onResize = useCallback((id: number, before: Rect, after: Rect) => {
    if (map) run(resizeObjectCommand(map, id, before, after));
  }, [map, run]);

  const onToggleLock = useCallback(() => {
    if (!map || selected.size === 0) return;
    const ids = [...selected];
    const lock = ids.some((id) => { const o = findObject(map, id); return o ? !isLocked(o) : false; });
    const apply = (l: boolean) => ids.forEach((id) => {
      const o = findObject(map, id);
      if (o) { if (l) o.tags["web.lock"] = "true"; else delete o.tags["web.lock"]; }
    });
    run({ label: lock ? "Lock" : "Unlock", do: () => apply(lock), undo: () => apply(!lock) });
  }, [map, selected, run]);

  // --- terrain brush stroke (paints the SELECTED terrain object) ---
  const paintDab = useCallback((id: number, tx: number, ty: number): boolean => {
    if (!map) return false;
    const o = findObject(map, id);
    if (!o) return false;
    const r = Math.floor(brushSize / 2);
    let changed = false;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        if (setTerrainCell(o, x, y, !brushErase)) changed = true;
      }
    return changed;
  }, [map, brushSize, brushErase]);

  const onStrokeStart = useCallback((tx: number, ty: number) => {
    if (!map || selected.size === 0) { stroke.current = null; return; }
    const o = findObject(map, [...selected][0]);
    if (!o || !isTerrain(o) || isLocked(o) || !o.terrain) { stroke.current = null; return; }
    stroke.current = {
      id: o.id,
      before: { terrain: cloneTerrain(o.terrain), rect: [...o.rect] as Rect },
      dirty: paintDab(o.id, tx, ty),
    };
  }, [map, selected, paintDab]);

  const onStrokePaint = useCallback((tx: number, ty: number) => {
    if (stroke.current && paintDab(stroke.current.id, tx, ty)) stroke.current.dirty = true;
  }, [paintDab]);

  const onStrokeEnd = useCallback(() => {
    const s = stroke.current;
    stroke.current = null;
    if (!map || !s || !s.dirty) return;
    const o = findObject(map, s.id);
    if (!o || !o.terrain) return;
    const after: TerrainSnapshot = { terrain: cloneTerrain(o.terrain), rect: [...o.rect] as Rect };
    run(paintTerrainCommand(map, s.id, s.before, after));
  }, [map, run]);

  // --- selection (single-layer; docs/SELECTION_MODEL.md) ---
  const revealLayer = useCallback((layerId: number) => {
    setActiveLayerId(layerId);
    setExpanded((p) => new Set(p).add(layerId));
  }, []);

  // Replace selection with a single object (switch active layer, set anchor).
  const selectSingle = useCallback((id: number) => {
    if (!map) return;
    const ly = layerOfObject(map, id);
    if (ly) revealLayer(ly.id);
    setSelected(new Set([id]));
    setAnchorId(id);
  }, [map, revealLayer]);

  // Ctrl-toggle membership; only within the active layer (else switch + single).
  const toggleSelect = useCallback((id: number) => {
    if (!map) return;
    const ly = layerOfObject(map, id);
    if (!ly) return;
    if (ly.id !== activeLayerId) { selectSingle(id); return; }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setAnchorId(id);
    setExpanded((p) => new Set(p).add(ly.id));
  }, [map, activeLayerId, selectSingle]);

  // Shift-range from anchor to id within one layer's object order (replace).
  const selectRange = useCallback((id: number) => {
    if (!map) return;
    const ly = layerOfObject(map, id);
    if (!ly || anchorId == null || ly.id !== activeLayerId) { selectSingle(id); return; }
    const ai = ly.objects.findIndex((o) => o.id === anchorId);
    const ti = ly.objects.findIndex((o) => o.id === id);
    if (ai < 0 || ti < 0) { selectSingle(id); return; }
    const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai];
    setSelected(new Set(ly.objects.slice(lo, hi + 1).map((o) => o.id)));
    revealLayer(ly.id); // anchor unchanged so the range can grow/shrink
  }, [map, anchorId, activeLayerId, selectSingle, revealLayer]);

  // RMB pick: plain = single, Ctrl = toggle. Empty click is a no-op.
  const onPick = useCallback((id: number | null, additive: boolean) => {
    if (id == null) return;
    if (additive) toggleSelect(id); else selectSingle(id);
  }, [toggleSelect, selectSingle]);

  // Panel row click with modifiers.
  const onObjectClick = useCallback((id: number, mods: { ctrl: boolean; shift: boolean }) => {
    if (mods.shift) selectRange(id);
    else if (mods.ctrl) toggleSelect(id);
    else selectSingle(id);
  }, [selectRange, toggleSelect, selectSingle]);

  // Marquee release: select active-layer objects whose rect intersects the box.
  const onMarquee = useCallback((loX: number, loY: number, hiX: number, hiY: number, additive: boolean) => {
    if (!map || activeLayerId == null) return;
    const ly = findLayer(map, activeLayerId);
    if (!ly) return;
    const hits = ly.objects
      .filter((o) => { const [x, y, w, h] = o.rect; return x <= hiX && x + w - 1 >= loX && y <= hiY && y + h - 1 >= loY; })
      .map((o) => o.id);
    setSelected((prev) => (additive ? new Set([...prev, ...hits]) : new Set(hits)));
    if (hits.length) setAnchorId(hits[0]);
  }, [map, activeLayerId]);

  const onMoveGroup = useCallback((ids: number[], dx: number, dy: number) => {
    if (map) run(moveObjectsCommand(map, ids, dx, dy));
  }, [map, run]);

  // --- layer panel actions ---
  const onToggleLayer = useCallback((layerId: number) => {
    if (map) run(toggleLayerEnabledCommand(map, layerId));
  }, [map, run]);

  const onToggleObject = useCallback((objectId: number) => {
    if (map) run(toggleObjectEnabledCommand(map, objectId));
  }, [map, run]);

  // --- props panel actions ---
  const onToggleLayerVisible = useCallback(() => {
    if (map && activeLayerId != null) run(toggleLayerEnabledCommand(map, activeLayerId));
  }, [map, activeLayerId, run]);

  const onSetObjectsVisible = useCallback((visible: boolean) => {
    if (map && selected.size) run(setObjectsEnabledCommand(map, [...selected], visible));
  }, [map, selected, run]);

  const onRename = useCallback((id: number, name: string) => {
    if (!map) return;
    const o = findObject(map, id);
    if (o) run(renameObjectCommand(map, id, o.tags["web.name"] ?? "", name));
  }, [map, run]);

  // convert a terrain object's autotile type (fix 2-edge/2-corner mislabels)
  const onSetObjectType = useCallback((id: number, type: LiteType) => {
    if (!map) return;
    const o = findObject(map, id);
    if (o && o.type !== type) run(setObjectTypeCommand(map, id, o.type, type));
  }, [map, run]);

  // manually pick (hash) or reset (null) the palette bound to an object
  const onSetPalette = useCallback((id: number, hash: string | null) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o) return;
    const before = o.tags["web.palette"];
    const after = hash ?? undefined;
    if (before !== after) run(setObjectPaletteCommand(map, id, before, after));
  }, [map, run]);

  // --- house decoration drag (door/window/chimney within the house rect) ---
  const onHouseDecoStart = useCallback((id: number, index: number) => {
    if (!map) { decoDrag.current = null; return; }
    const o = findObject(map, id);
    decoDrag.current = o?.house?.decorations[index] ? { id, index, before: [...o.house.decorations[index].cell] as [number, number] } : null;
  }, [map]);

  const onHouseDecoMove = useCallback((id: number, index: number, cell: [number, number]) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house?.decorations[index]) return;
    const cur = o.house.decorations[index].cell;
    if (cur[0] === cell[0] && cur[1] === cell[1]) return;
    o.house.decorations[index].cell = [...cell];
    setVersion((v) => v + 1); // live preview (also recompiles, but house bindings don't depend on cell)
  }, [map]);

  const onHouseDecoEnd = useCallback(() => {
    const d = decoDrag.current;
    decoDrag.current = null;
    if (!map || !d) return;
    const o = findObject(map, d.id);
    if (!o?.house?.decorations[d.index]) return;
    const after = [...o.house.decorations[d.index].cell] as [number, number];
    if (after[0] !== d.before[0] || after[1] !== d.before[1]) run(moveHouseDecoCommand(map, d.id, d.index, d.before, after));
  }, [map, run]);

  // --- house inspector: palettes, overlap, dynamic decorations ---
  const onSetHouseSlot = useCallback((id: number, slot: "wall" | "roof" | number, hash: string | null) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house) return;
    const after = hash ?? undefined;
    if (slot === "wall" || slot === "roof") {
      if (o.house[slot] !== after) run(setHouseSlotPaletteCommand(map, id, slot, o.house[slot], after));
    } else {
      const before = o.house.decorations[slot]?.palette;
      if (before !== after) run(setHouseDecoPaletteCommand(map, id, slot, before, after));
    }
  }, [map, run]);

  const onSetWallHeight = useCallback((id: number, height: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (o?.house && o.house.wallHeight !== height) run(setWallHeightCommand(map, id, o.house.wallHeight, height));
  }, [map, run]);

  const onSetHouseOverlap = useCallback((id: number, overlap: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house || o.house.overlap === overlap) return;
    run(setHouseOverlapCommand(map, id, o.house.overlap, overlap));
  }, [map, run]);

  const onAddHouseDecoration = useCallback((id: number, kind: HouseDecorationKind, palette?: string) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house) return;
    const before = o.house.decorations.map((deco) => ({ ...deco, cell: [...deco.cell] as [number, number] }));
    const after = [...before, { kind, cell: [0, 0] as [number, number], ...(palette ? { palette } : {}) }];
    run(setHouseDecorationsCommand(map, id, before, after, "Add decoration"));
  }, [map, run]);

  const onRemoveHouseDecoration = useCallback((id: number, index: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house?.decorations[index]) return;
    const before = o.house.decorations.map((deco) => ({ ...deco, cell: [...deco.cell] as [number, number] }));
    const after = before.filter((_, i) => i !== index);
    run(setHouseDecorationsCommand(map, id, before, after, "Remove decoration"));
  }, [map, run]);

  const onGenerateHouseDecorations = useCallback((id: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house) return;
    const hb = bindings?.get(id);
    if (!hb || hb.kind !== "house") return;
    const before = o.house.decorations.map((deco) => ({ ...deco, cell: [...deco.cell] as [number, number] }));
    const seed = Math.floor(Math.random() * 0xffffffff);
    const after = generateDecorations(o.house, o.rect, hb.deco, seed);
    if (JSON.stringify(before) !== JSON.stringify(after)) run(setHouseDecorationsCommand(map, id, before, after, "Generate decorations"));
  }, [map, bindings, run]);
  const onObjectDragStart = useCallback((layerId: number, objectId: number) => (e: ReactDragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${layerId}:${objectId}`);
    setDragging({ layerId, objectId });
    setDropTarget(null);
  }, []);

  const onObjectDragOver = useCallback((layerId: number, objectId: number) => (e: ReactDragEvent<HTMLDivElement>) => {
    if (!dragging || dragging.layerId !== layerId || dragging.objectId === objectId) return;
    e.preventDefault();
    const side = dropSideFromEvent(e);
    setDropTarget((prev) => (
      prev && prev.layerId === layerId && prev.targetId === objectId && prev.side === side
        ? prev
        : { layerId, targetId: objectId, side }
    ));
    e.dataTransfer.dropEffect = "move";
  }, [dragging]);

  const onObjectDrop = useCallback((layerId: number, objectId: number) => (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!map || !dragging || dragging.layerId !== layerId || dragging.objectId === objectId) return;
    const layer = findLayer(map, layerId);
    if (!layer) return;
    const before = layer.objects.map((o) => o.id);
    const after = reorderWithinLayer(before, dragging.objectId, objectId, dropSideFromEvent(e));
    if (!sameOrder(before, after)) run(reorderLayerObjectsCommand(map, layerId, before, after));
    setDragging(null);
    setDropTarget(null);
  }, [map, dragging, run]);

  const onObjectDragEnd = useCallback(() => {
    setDragging(null);
    setDropTarget(null);
  }, []);

  const nextObjectId = useCallback((cur: LiteTileMap) => {
    let maxId = -1;
    for (const layer of cur.layers) for (const obj of layer.objects) maxId = Math.max(maxId, obj.id);
    return maxId + 1;
  }, []);

  const collectActiveLayerSelection = useCallback(() => {
    if (!map || activeLayerId == null) return null;
    const layer = findLayer(map, activeLayerId);
    if (!layer) return null;
    const entries = layer.objects
      .map((obj, index) => ({ object: obj, index }))
      .filter((entry) => selected.has(entry.object.id));
    return entries.length > 0 ? { layer, entries } : null;
  }, [map, activeLayerId, selected]);

  const cloneSelectionIntoSnapshots = useCallback((
    layerId: number,
    entries: ClipboardEntry[],
    step: number,
    existingNames: Set<string>,
  ) => {
    if (!map) return { snapshots: [] as LayerObjectSnapshot[], ids: [] as number[] };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const entry of entries) {
      const obj = entry.object;
      minX = Math.min(minX, obj.rect[0]);
      minY = Math.min(minY, obj.rect[1]);
      maxX = Math.max(maxX, obj.rect[0] + obj.rect[2]);
      maxY = Math.max(maxY, obj.rect[1] + obj.rect[3]);
    }
    const unitDx = maxX < map.width ? 1 : minX > 0 ? -1 : 0;
    const unitDy = maxY < map.height ? 1 : minY > 0 ? -1 : 0;
    const dx = unitDx * Math.max(1, step);
    const dy = unitDy * Math.max(1, step);
    const insertAt = Math.max(...entries.map((entry) => entry.index)) + 1;
    let nextId = nextObjectId(map);
    const snapshots: LayerObjectSnapshot[] = [];
    const ids: number[] = [];
    entries.forEach((entry, offsetIndex) => {
      const clone = cloneObjectDeep(entry.object, nextId++);
      translateObject(clone, dx, dy);
      const baseName = clone.tags["web.baseName"] || clone.tags["blueprint.label"] || roleOf(clone) || clone.type;
      clone.tags["web.name"] = uniqueName(existingNames, baseName);
      snapshots.push({ layerId, index: insertAt + offsetIndex, object: clone });
      ids.push(clone.id);
    });
    return { snapshots, ids };
  }, [map, nextObjectId]);

  const onCopySelection = useCallback(() => {
    const active = collectActiveLayerSelection();
    if (!active) return;
    setClipboard({
      layerId: active.layer.id,
      layerName: active.layer.name,
      entries: active.entries.map((entry) => ({ index: entry.index, object: cloneObjectDeep(entry.object) })),
      pasteCount: 0,
    });
  }, [collectActiveLayerSelection]);

  const onDeleteSelection = useCallback(() => {
    if (!map || selected.size === 0) return;
    const snapshots: LayerObjectSnapshot[] = [];
    for (const layer of map.layers) {
      layer.objects.forEach((obj, index) => {
        if (selected.has(obj.id)) snapshots.push({ layerId: layer.id, index, object: cloneObjectDeep(obj) });
      });
    }
    if (snapshots.length === 0) return;
    run(deleteObjectsCommand(map, snapshots));
    setSelected(new Set());
    setAnchorId(null);
  }, [map, selected, run]);

  const onDuplicateSelection = useCallback(() => {
    const active = collectActiveLayerSelection();
    if (!active || !map) return;
    const existingNames = new Set<string>();
    for (const mapLayer of map.layers) for (const obj of mapLayer.objects) existingNames.add(displayName(obj));
    const clipboardEntries = active.entries.map((entry) => ({ index: entry.index, object: cloneObjectDeep(entry.object) }));
    const { snapshots, ids: newIds } = cloneSelectionIntoSnapshots(active.layer.id, clipboardEntries, 1, existingNames);
    if (snapshots.length === 0) return;
    run(createObjectsCommand(map, snapshots));
    setSelected(new Set(newIds));
    setAnchorId(newIds[0] ?? null);
    setExpanded((prev) => new Set(prev).add(active.layer.id));
  }, [collectActiveLayerSelection, cloneSelectionIntoSnapshots, map, run]);

  const canPaste = !!(map && activeLayerId != null && clipboard && clipboard.entries.length > 0 && clipboard.layerId === activeLayerId);
  const pasteTitle = !clipboard
    ? "没有可粘贴对象"
    : clipboard.layerId !== activeLayerId
      ? `只能粘贴回 ${clipboard.layerName} 层`
      : "粘贴当前剪贴板 (Cmd/Ctrl+V)";

  const onPasteClipboard = useCallback(() => {
    if (!map || activeLayerId == null || !clipboard || clipboard.layerId !== activeLayerId || clipboard.entries.length === 0) return;
    const existingNames = new Set<string>();
    for (const mapLayer of map.layers) for (const obj of mapLayer.objects) existingNames.add(displayName(obj));
    const { snapshots, ids: newIds } = cloneSelectionIntoSnapshots(
      activeLayerId,
      clipboard.entries.map((entry) => ({ index: entry.index, object: cloneObjectDeep(entry.object) })),
      clipboard.pasteCount + 1,
      existingNames,
    );
    if (snapshots.length === 0) return;
    run(createObjectsCommand(map, snapshots));
    setSelected(new Set(newIds));
    setAnchorId(newIds[0] ?? null);
    setExpanded((prev) => new Set(prev).add(activeLayerId));
    setClipboard((prev) => prev && prev.layerId === activeLayerId ? { ...prev, pasteCount: prev.pasteCount + 1 } : prev);
  }, [map, activeLayerId, clipboard, cloneSelectionIntoSnapshots, run]);

  const activeLayer = useMemo(() => (map && activeLayerId != null ? findLayer(map, activeLayerId) : null), [map, activeLayerId, version]);
  const activeRoot = activeLayer?.tags["role.root"] ?? "";
  const createPaletteChoices = useMemo(() => {
    if (!pack || !activeRoot) return [] as CreatePaletteChoice[];
    const out: CreatePaletteChoice[] = [];
    for (const palette of pack.palettes) {
      if (roleRoot(palette.role) !== activeRoot) continue;
      for (const kind of paletteCreateKinds(palette)) out.push({ kind, palette, role: palette.role });
    }
    out.sort((a, b) =>
      a.kind.localeCompare(b.kind)
      || a.role.localeCompare(b.role)
      || a.palette.style.localeCompare(b.palette.style)
      || a.palette.hash.localeCompare(b.palette.hash));
    return out;
  }, [pack, activeRoot]);
  const createKindOptions = useMemo(
    () => {
      const seen = new Set(createPaletteChoices.map((choice) => choice.kind));
      const order = activeRoot === "building" ? BUILDING_KIND_ORDER : DEFAULT_KIND_ORDER;
      return order.filter((kind) => seen.has(kind));
    },
    [createPaletteChoices, activeRoot],
  );
  const createPaletteOptions = useMemo(
    () => createPaletteChoices.filter((choice) => choice.kind === createKind),
    [createPaletteChoices, createKind],
  );
  const selectedCreateChoice = useMemo(
    () => createPaletteOptions.find((choice) => choice.palette.hash === createPaletteHash) ?? null,
    [createPaletteOptions, createPaletteHash],
  );

  useEffect(() => {
    if (createKindOptions.length === 0) {
      setCreateArmed(false);
      setCreatePaletteHash("");
      return;
    }
    setCreateKind((prev) => (createKindOptions.includes(prev) ? prev : createKindOptions[0]));
  }, [createKindOptions]);

  useEffect(() => {
    if (createPaletteOptions.length === 0) {
      setCreatePaletteHash("");
      setCreateArmed(false);
      return;
    }
    setCreatePaletteHash((prev) => createPaletteOptions.some((choice) => choice.palette.hash === prev) ? prev : createPaletteOptions[0].palette.hash);
  }, [createPaletteOptions]);

  useEffect(() => {
    if (createArmed) setMarquee(false);
  }, [createArmed]);

  const onCreateAt = useCallback((tx: number, ty: number) => {
    if (!map || !activeLayer || !selectedCreateChoice || !createKindOptions.includes(createKind)) return;
    const id = nextObjectId(map);
    const created = createObjectForRole(map, id, selectedCreateChoice.role, createKind, tx, ty, {
      paletteHash: selectedCreateChoice.palette.hash,
      size: selectedCreateChoice.palette.size,
      style: selectedCreateChoice.palette.style,
    });
    run(createObjectCommand(map, activeLayer.id, created));
    setSelected(new Set([id]));
    setAnchorId(id);
    setExpanded((prev) => new Set(prev).add(activeLayer.id));
    setCreateArmed(false);
  }, [map, activeLayer, selectedCreateChoice, createKind, createKindOptions, nextObjectId, run]);

  useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo(); else onUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selected.size > 0) {
        e.preventDefault();
        onCopySelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && canPaste) {
        e.preventDefault();
        onPasteClipboard();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && selected.size > 0) {
        e.preventDefault();
        onDuplicateSelection();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selected.size > 0) {
        e.preventDefault();
        onDeleteSelection();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && map) {
        if (e.key.toLowerCase() === "m") { e.preventDefault(); setMarquee((m) => !m); }
        else if (e.key === "Escape") { setMarquee(false); setCreateArmed(false); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUndo, onRedo, map, selected.size, canPaste, onCopySelection, onPasteClipboard, onDuplicateSelection, onDeleteSelection]);

  const selObjs = useMemo(() => (map ? ([...selected].map((id) => findObject(map, id)).filter(Boolean) as LiteObject[]) : []), [map, selected, version]);
  const selObj = selObjs[0] ?? null;
  const selIsTerrain = isTerrain(selObj);
  const selLocked = selObj ? isLocked(selObj) : false;
  const brush: BrushState = {
    rgb: selObj ? colorForRole(roleOf(selObj)) : [255, 255, 255],
    size: brushSize,
    erase: brushErase,
    ready: selIsTerrain && !selLocked,
  };
  const canUndo = undo.current.canUndo;
  const canRedo = undo.current.canRedo;

  return (
    <div className="app">
      <header className="topbar">
        <strong>Adna Web Lite Reroll</strong>
        <span className="badge">右键选/移 · 左键涂/缩放</span>
        <button onClick={() => fileInput.current?.click()}>打开 blueprint.json…</button>
        <input ref={fileInput} type="file" accept=".json" hidden
          onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
        {map && (
          <>
            <button disabled={!canUndo} onClick={onUndo} title="撤销 (Cmd/Ctrl+Z)">↶ Undo</button>
            <button disabled={!canRedo} onClick={onRedo} title="重做 (Shift+Cmd/Ctrl+Z)">↷ Redo</button>
            <button onClick={onExport} title="导出 adna-web-lite 存档">⤓ Export</button>
            <button disabled={selected.size === 0} onClick={onCopySelection} title="复制当前对象/组到内部剪贴板 (Cmd/Ctrl+C)">⧉ Copy</button>
            <button disabled={!canPaste} onClick={onPasteClipboard} title={pasteTitle}>⎘ Paste</button>
            <button disabled={selected.size === 0} onClick={onDeleteSelection} title="删除当前对象/组 (Delete)">⌫ Delete</button>
            <button className={marquee ? "active" : ""} onClick={() => {
              setMarquee((m) => {
                const next = !m;
                if (next) setCreateArmed(false);
                return next;
              });
            }} title="框选工具(M)：左键拖一次框选,松手自动退回">▭ Marquee</button>
            {pack && (
              <>
                <span className="ts-sep" />
                <span className="ts-label">Tiles</span>
                <span className="seg">
                  <button className={renderMode === "blueprint" ? "active" : ""} onClick={() => setRenderMode("blueprint")} title="抽象示意图(role 颜色)">Overlay</button>
                  <button className={renderMode === "mixed" ? "active" : ""} onClick={() => setRenderMode("mixed")} title="已绑定的画真实图块,其余示意">Mixed</button>
                  <button className={renderMode === "real" ? "active" : ""} onClick={() => setRenderMode("real")} title="只画真实图块">Real</button>
                </span>
              </>
            )}
            {selIsTerrain && (
              <>
                <span className="ts-sep" />
                <span className="ts-label">Brush · <code>{roleOf(selObj!)}</code></span>
                <span className="seg">
                  {[1, 3, 5].map((n) => (
                    <button key={n} className={brushSize === n ? "active" : ""} onClick={() => setBrushSize(n)}>{n}</button>
                  ))}
                </span>
                <span className="seg">
                  <button className={!brushErase ? "active" : ""} onClick={() => setBrushErase(false)}>Paint</button>
                  <button className={brushErase ? "active" : ""} onClick={() => setBrushErase(true)}>Erase</button>
                </span>
                {selLocked && <span className="muted small">已锁定</span>}
              </>
            )}
          </>
        )}
        <span className="spacer" />
        {map && <span className="stat">{map.name}{version > 0 && <em className="muted"> · 进度已存本地</em>}</span>}
      </header>

      {error && <div className="error">{error}</div>}

      {!map ? (
        <div className="dropzone">
          <div>把 <code>blueprint.json</code> 拖到这里，或点「打开 blueprint.json…」</div>
          <button onClick={loadSample}>试用样例</button>
        </div>
      ) : (
        <div className="main" style={{ "--props-w": `${propsWidth}px` } as CSSProperties}>
          <aside className="layers">
            <div className="layers-head">
              <span className="legend-title">Layers</span>
            </div>
            {activeLayer && (
              <div className="create-panel">
                <div className="create-head">
                  <span className="legend-title">Palette Create</span>
                  <button
                    className={createArmed ? "active" : ""}
                    disabled={!selectedCreateChoice || createKindOptions.length === 0}
                    onClick={() => {
                      setMarquee(false);
                      setCreateArmed((v) => !v);
                    }}
                  >
                    {createArmed ? "Cancel" : "Place"}
                  </button>
                </div>
                <div className="seg create-kind">
                  {createKindOptions.map((kind) => (
                    <button key={kind} className={createKind === kind ? "active" : ""} onClick={() => setCreateKind(kind)}>
                      {CREATE_KIND_LABEL[kind]}
                    </button>
                  ))}
                </div>
                <div className="pal-grid create-palette-grid">
                  {createPaletteOptions.map((choice) => (
                    <button
                      key={choice.palette.hash}
                      className={`pal-cell${createPaletteHash === choice.palette.hash ? " sel" : ""}`}
                      title={`${choice.palette.style || choice.role.split("/").slice(-1)[0] || "palette"} · ${CREATE_KIND_LABEL[choice.kind]}`}
                      onClick={() => setCreatePaletteHash(choice.palette.hash)}
                    >
                      <PaletteSwatch pack={pack!} palette={choice.palette} />
                    </button>
                  ))}
                  {createPaletteOptions.length === 0 && <span className="prop-empty">No palette choices for this layer</span>}
                </div>
                {selectedCreateChoice && (
                  <div className="create-meta">
                    <div className="create-style">{selectedCreateChoice.palette.style || "untagged"}</div>
                    <div className="create-size">{selectedCreateChoice.palette.size[0]} × {selectedCreateChoice.palette.size[1]} · {CREATE_KIND_LABEL[selectedCreateChoice.kind]}</div>
                  </div>
                )}
                <div className="prop-hint">
                  {createArmed
                    ? `Click map to place ${selectedCreateChoice?.palette.style || selectedCreateChoice?.role || "object"}`
                    : `Choose a palette thumbnail first; role/style will follow the selected palette`}
                </div>
              </div>
            )}
            {map.layers.map((ly) => {
              const open = expanded.has(ly.id);
              return (
                <div key={ly.id} className="layer-group">
                  <div
                    className={`layer-row${ly.id === activeLayerId ? " active" : ""}${ly.enabled ? "" : " hidden"}`}
                    onClick={() => { setActiveLayerId(ly.id); toggleExpand(ly.id); }}
                  >
                    <button className="caret" onClick={(e) => { e.stopPropagation(); toggleExpand(ly.id); }}>
                      {open ? "▾" : "▸"}
                    </button>
                    <input
                      className="row-check"
                      type="checkbox"
                      checked={ly.enabled}
                      title={ly.enabled ? "显示" : "隐藏"}
                      onChange={() => onToggleLayer(ly.id)}
                      onClick={(e) => { e.stopPropagation(); }}
                    />
                    <span className="layer-name" title={ly.name}>{ly.name}</span>
                    <span className="layer-count">{ly.objects.length}</span>
                  </div>
                  {open && ly.objects.map((o) => {
                    const label = displayName(o);
                    return (
                      <div
                        key={o.id}
                        className={`obj-row${selected.has(o.id) ? " selected" : ""}${o.enabled ? "" : " hidden"}${dragging?.objectId === o.id ? " dragging" : ""}${dropTarget?.layerId === ly.id && dropTarget.targetId === o.id ? ` drop-${dropTarget.side}` : ""}`}
                        draggable
                        onClick={(e) => onObjectClick(o.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
                        onDragStart={onObjectDragStart(ly.id, o.id)}
                        onDragOver={onObjectDragOver(ly.id, o.id)}
                        onDrop={onObjectDrop(ly.id, o.id)}
                        onDragEnd={onObjectDragEnd}
                      >
                        <input
                          className="row-check"
                          type="checkbox"
                          checked={o.enabled}
                          title={o.enabled ? "显示" : "隐藏"}
                          onChange={() => onToggleObject(o.id)}
                          onClick={(e) => { e.stopPropagation(); }}
                        />
                        <span className="obj-name" title={label}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </aside>
          <CanvasView
            map={map}
            version={version}
            pack={pack}
            bindings={bindings}
            renderMode={renderMode}
            packVersion={packVersion}
            onHouseDecoStart={onHouseDecoStart}
            onHouseDecoMove={onHouseDecoMove}
            onHouseDecoEnd={onHouseDecoEnd}
            brush={brush}
            selected={selected}
            marqueeArmed={marquee}
            createArmed={createArmed}
            onPick={onPick}
            onCreateAt={onCreateAt}
            onCopySelection={onCopySelection}
            canPasteClipboard={canPaste}
            onPasteClipboard={onPasteClipboard}
            onDeleteSelection={onDeleteSelection}
            onMove={onMove}
            onMoveGroup={onMoveGroup}
            onResize={onResize}
            onToggleLock={onToggleLock}
            onStrokeStart={onStrokeStart}
            onStrokePaint={onStrokePaint}
            onStrokeEnd={onStrokeEnd}
            onMarquee={onMarquee}
            onMarqueeDone={() => setMarquee(false)}
          />
          <div className="resizer" onMouseDown={startResize} title="拖动调整右栏宽度" />
          <PropsPanel
            layer={activeLayer}
            objects={selObjs}
            pack={pack}
            bindings={bindings}
            onToggleLayerVisible={onToggleLayerVisible}
            onSetObjectsVisible={onSetObjectsVisible}
            onToggleLock={onToggleLock}
            onRename={onRename}
            onSetObjectType={onSetObjectType}
            onSetPalette={onSetPalette}
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
          />
        </div>
      )}
    </div>
  );
}
