import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { parseBlueprint } from "./blueprint";
import { blueprintToLite } from "./convert";
import { normalizeToCategories } from "./normalize";
import { DEFAULT_FRG_PLACEMENT_MODE, assignUniqueObjectNames, cloneObjectDeep, cloneTerrain, displayName, findLayer, findObject, isLocked, layerOfObject, roleOf, setTerrainCell, translateObject, type FrgCellData, type FrgPlacementMode, type HouseDecorationKind, type LiteObject, type LiteTileMap, type Rect } from "./model";
import { UndoStack, bitwiseObjectCommand, createObjectCommand, createObjectsCommand, deleteObjectsCommand, moveHouseDecoCommand, moveObjectCommand, moveObjectsCommand, paintTerrainCommand, randomizeTerrainCommand, renameObjectCommand, reorderLayerObjectsCommand, resizeObjectCommand, setFrgCellsCommand, setFrgPlacementModeCommand, setHouseDecoPaletteCommand, setHouseDecorationsCommand, setHouseOverlapCommand, setHouseSlotPaletteCommand, setObjectRectCommand, setObjectsEnabledCommand, setObjectPaletteCommand, setObjectTypeCommand, setWallHeightCommand, terrainMutationWithTagsCommand, toggleLayerEnabledCommand, toggleObjectEnabledCommand, type Command, type LayerObjectSnapshot, type TerrainSnapshot } from "./commands";
import type { LiteType } from "./model";
import { liteToWebSave } from "./saveFormat";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { downloadJson } from "./download";
import { colorForRole } from "./generated/roleColors";
import { applyBitwiseObjectOp, dilateTerrainMatrix, erodeTerrainMatrix, fillTerrainMatrix, flipTerrainMatrix, hasBitwiseOverlap, isBitwiseSupported, keepBorderTerrainMatrix, removeZeroLikeDesktop, terrainMatrixEquals, type BitwiseObjectOp } from "./bitwise";
import { BitwiseObjectModal } from "./components/BitwiseObjectModal";
import { CanvasView, type BrushState } from "./components/CanvasView";
import { PalettePickerModal, type PaletteCreateRequest } from "./components/PalettePickerModal";
import { PropsPanel } from "./components/PropsPanel";
import { loadPackFromUrl } from "./pack/loadPack";
import { compileMap } from "./pack/compile";
import { PaletteMode, type Palette, type PackRuntime } from "./pack/types";
import { isStructureMode } from "./pack/slice";
import type { RenderMode } from "./render";
import { generateDecorations } from "./house";
import { createObjectForRole, type CreateKind } from "./objectFactory";
import { createKindsForRole, roleRoot } from "./roleTree";
import { applyNoiseConfig, applyTerrainNoiseConfig, regenerateTerrainByNoise, type TerrainNoiseConfig } from "./terrainNoise";

const isTerrain = (o: LiteObject | null) => !!o && (o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE");
const borderAsConnected = (o: LiteObject) => o.tags["borderAsConnected"] === "true";

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

const HOUSE_CREATE_ROLE = "building/house";
const HOUSE_WALL_ROLE = "building/house_wall";
const HOUSE_ROOF_ROLE = "building/house_roof";

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

function sortCreateChoices<T extends CreatePaletteChoice>(choices: T[]): T[] {
  return choices.slice().sort((a, b) =>
    a.kind.localeCompare(b.kind)
    || a.role.localeCompare(b.role)
    || a.palette.style.localeCompare(b.palette.style)
    || a.palette.hash.localeCompare(b.palette.hash));
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

function rectEquals(a: Rect, b: Rect): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function cloneTerrainForRect(terrain: TerrainSnapshot["terrain"]): TerrainSnapshot["terrain"] {
  return cloneTerrain(terrain);
}

function terrainAabb(terrain: TerrainSnapshot["terrain"]): Rect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let row = 0; row < terrain.h; row++) {
    for (let col = 0; col < terrain.w; col++) {
      if (terrain.data[row * terrain.w + col] < 0) continue;
      const wx = terrain.ox + col;
      const wy = terrain.oy + row;
      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

function resizeTerrainToRect(terrain: TerrainSnapshot["terrain"], rect: Rect): TerrainSnapshot["terrain"] {
  const next = { ox: rect[0], oy: rect[1], w: rect[2], h: rect[3], data: new Int16Array(rect[2] * rect[3]).fill(-1) };
  for (let row = 0; row < terrain.h; row++) {
    for (let col = 0; col < terrain.w; col++) {
      if (terrain.data[row * terrain.w + col] < 0) continue;
      const wx = terrain.ox + col;
      const wy = terrain.oy + row;
      const nx = wx - next.ox;
      const ny = wy - next.oy;
      if (nx < 0 || ny < 0 || nx >= next.w || ny >= next.h) continue;
      next.data[ny * next.w + nx] = terrain.data[row * terrain.w + col];
    }
  }
  return next;
}

export default function App() {
  const [lang, setLang] = useState<'zh' | 'en'>(() => {
    return (localStorage.getItem('adna_lang') as 'zh' | 'en') || 'zh';
  });
  const [map, setMap] = useState<LiteTileMap | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  // palette pack + real-tile rendering
  const [pack, setPack] = useState<PackRuntime | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("mixed");
  const [packVersion, setPackVersion] = useState(0);
  const [layersWidth, setLayersWidth] = useState(() => Number(localStorage.getItem("reroll_layers_w")) || 280);
  // draggable width of the right props panel (px), persisted
  const [propsWidth, setPropsWidth] = useState(() => Number(localStorage.getItem("reroll_props_w")) || 240);
  const [selected, setSelected] = useState<Set<number>>(new Set());
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
  const [createHouseWallHash, setCreateHouseWallHash] = useState("");
  const [createHouseRoofHash, setCreateHouseRoofHash] = useState("");
  const [createArmed, setCreateArmed] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [bitwiseTargetId, setBitwiseTargetId] = useState<number | null>(null);
  const [bitwiseSourceId, setBitwiseSourceId] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<ObjectClipboard | null>(null);
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const undo = useRef(new UndoStack());
  const stroke = useRef<{ id: number; before: TerrainSnapshot; dirty: boolean } | null>(null);
  const decoDrag = useRef<{ id: number; index: number; before: [number, number] } | null>(null);
  const terrainNoisePreview = useRef<{ id: number; before: TerrainSnapshot; beforeTags: Record<string, string> } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);

  const build = useCallback((name: string, text: string) => {
    let lite = normalizeToCategories(blueprintToLite(parseBlueprint(name, text)));
    assignUniqueObjectNames(lite);
    // resume an unfinished local session for this source, if the user wants it
    const draft = loadDraft(name);
    if (draft) {
      const when = new Date(draft.savedAt).toLocaleString();
      const confirmMsg = lang === 'zh'
        ? `发现「${name}」上次未完成的修改（保存于 ${when}）。\n\n确定 = 继续上次进度；取消 = 放弃改动,重新打开。`
        : `Unsaved draft of "${name}" found (from ${when}).\n\nOK = continue editing; Cancel = discard draft and reload.`;
      if (confirm(confirmMsg)) {
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
    terrainNoisePreview.current = null;
    setVersion(0);
    setError("");
  }, []);

  const load = useCallback((name: string, text: string) => {
    build(name, text);
  }, [build]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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
  const effectiveFrgCells = useCallback((o: LiteObject): FrgCellData[] => {
    if (o.type !== "FIXED_RECT_GROUP") return [];
    if (o.frg) return o.frg.cells.map((cell) => ({ ...cell }));
    const binding = bindings?.get(o.id);
    if (binding?.kind === "frg") return binding.variants.map((palette) => ({ palette: palette.hash, weight: 100 }));
    const override = o.tags["web.palette"];
    return override ? [{ palette: override, weight: 100 }] : [];
  }, [bindings]);
  const effectiveFrgPlacementMode = useCallback((o: LiteObject): FrgPlacementMode => {
    if (o.type !== "FIXED_RECT_GROUP") return DEFAULT_FRG_PLACEMENT_MODE;
    return o.frg?.placementMode ?? DEFAULT_FRG_PLACEMENT_MODE;
  }, []);
  // invalidate the cached scene when bindings / render mode change
  useEffect(() => { setPackVersion((v) => v + 1); }, [bindings, renderMode]);

  useEffect(() => {
    const onDrop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) void loadFile(f); };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => { window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onDragOver); };
  }, [loadFile]);

  // drag the layers|canvas divider to resize the left panel
  const startLayersResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) =>
      setLayersWidth(Math.min(420, Math.max(220, ev.clientX)));
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

  // drag the canvas|props divider to resize the right panel
  const startPropsResize = useCallback((e: React.MouseEvent) => {
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
  useEffect(() => { localStorage.setItem("reroll_layers_w", String(layersWidth)); }, [layersWidth]);
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
    setExpanded((prev) => new Set(prev).add(layerId));
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
  }, [map, activeLayerId, selectSingle]);

  const selectRange = useCallback((id: number) => {
    if (!map) return;
    const ly = layerOfObject(map, id);
    if (!ly || anchorId == null || ly.id !== activeLayerId) { selectSingle(id); return; }
    const ai = ly.objects.findIndex((o) => o.id === anchorId);
    const ti = ly.objects.findIndex((o) => o.id === id);
    if (ai < 0 || ti < 0) { selectSingle(id); return; }
    const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai];
    setSelected(new Set(ly.objects.slice(lo, hi + 1).map((o) => o.id)));
    revealLayer(ly.id);
  }, [map, anchorId, activeLayerId, selectSingle, revealLayer]);

  // RMB pick: plain = single, Ctrl = toggle. Empty click is a no-op.
  const onPick = useCallback((id: number | null, additive: boolean) => {
    if (id == null) return;
    if (additive) toggleSelect(id); else selectSingle(id);
  }, [toggleSelect, selectSingle]);

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

  const onSetRectToMap = useCallback((id: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o) return;
    const beforeRect = [...o.rect] as Rect;
    const afterRect: Rect = [0, 0, map.width, map.height];
    if (rectEquals(beforeRect, afterRect)) return;
    const beforeTerrain = o.terrain ? cloneTerrainForRect(o.terrain) : undefined;
    const afterTerrain = o.terrain ? resizeTerrainToRect(o.terrain, afterRect) : undefined;
    run(setObjectRectCommand(map, id, beforeRect, afterRect, beforeTerrain, afterTerrain));
  }, [map, run]);

  const onSetRectToAabb = useCallback((id: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o) return;
    const beforeRect = [...o.rect] as Rect;
    const afterRect = o.terrain ? terrainAabb(o.terrain) : beforeRect;
    if (!afterRect || rectEquals(beforeRect, afterRect)) return;
    const beforeTerrain = o.terrain ? cloneTerrainForRect(o.terrain) : undefined;
    const afterTerrain = o.terrain ? resizeTerrainToRect(o.terrain, afterRect) : undefined;
    run(setObjectRectCommand(map, id, beforeRect, afterRect, beforeTerrain, afterTerrain));
  }, [map, run]);

  const commitRandomizeTerrain = useCallback((id: number, config: TerrainNoiseConfig, previewBase?: { before: TerrainSnapshot; beforeTags: Record<string, string> }) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.terrain || !(o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE")) return;
    const before: TerrainSnapshot = previewBase?.before ?? { terrain: cloneTerrain(o.terrain), rect: [...o.rect] as Rect };
    const beforeTags = previewBase?.beforeTags ?? { ...o.tags };
    const after: TerrainSnapshot = { terrain: regenerateTerrainByNoise(before.terrain, config), rect: [...before.rect] as Rect };
    const afterTags = applyTerrainNoiseConfig(beforeTags, config);
    if (terrainMatrixEquals(before.terrain, after.terrain) && JSON.stringify(beforeTags) === JSON.stringify(afterTags)) return;
    run(randomizeTerrainCommand(map, id, before, after, beforeTags, afterTags));
  }, [map, run]);

  const onRandomizeTerrain = useCallback((id: number, config: TerrainNoiseConfig) => {
    terrainNoisePreview.current = null;
    commitRandomizeTerrain(id, config);
  }, [commitRandomizeTerrain]);

  const onPreviewTerrainNoise = useCallback((id: number, config: TerrainNoiseConfig) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.terrain || !(o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE")) return;
    let preview = terrainNoisePreview.current;
    if (!preview || preview.id !== id) {
      preview = {
        id,
        before: { terrain: cloneTerrain(o.terrain), rect: [...o.rect] as Rect },
        beforeTags: { ...o.tags },
      };
      terrainNoisePreview.current = preview;
    }
    o.terrain = regenerateTerrainByNoise(preview.before.terrain, config);
    o.rect = [...preview.before.rect];
    o.tags = applyTerrainNoiseConfig(preview.beforeTags, config);
    setVersion((v) => v + 1);
  }, [map]);

  const onCancelTerrainNoisePreview = useCallback(() => {
    if (!map) return;
    const preview = terrainNoisePreview.current;
    if (!preview) return;
    const o = findObject(map, preview.id);
    terrainNoisePreview.current = null;
    if (!o) return;
    o.terrain = cloneTerrain(preview.before.terrain);
    o.rect = [...preview.before.rect];
    o.tags = { ...preview.beforeTags };
    setVersion((v) => v + 1);
  }, [map]);

  const onCommitTerrainNoisePreview = useCallback((id: number, config: TerrainNoiseConfig) => {
    const preview = terrainNoisePreview.current;
    terrainNoisePreview.current = null;
    if (preview && preview.id === id) {
      commitRandomizeTerrain(id, config, { before: preview.before, beforeTags: preview.beforeTags });
      return;
    }
    commitRandomizeTerrain(id, config);
  }, [commitRandomizeTerrain]);

  const onSetTerrainBorderAsConnected = useCallback((id: number, enabled: boolean) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o || !(o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE")) return;
    const before = { ...o.tags };
    const after = { ...o.tags };
    if (enabled) after.borderAsConnected = "true";
    else delete after.borderAsConnected;
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    run({
      label: "Border as connected",
      do: () => {
        const target = findObject(map, id);
        if (target) target.tags = { ...after };
      },
      undo: () => {
        const target = findObject(map, id);
        if (target) target.tags = { ...before };
      },
    });
  }, [map, run]);

  const onRunMorph = useCallback((id: number, mode: "dilate" | "erode" | "erode_dilate" | "dilate_erode", dilate: TerrainNoiseConfig, erode: TerrainNoiseConfig) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!isBitwiseSupported(o)) return;
    const before: TerrainSnapshot = { terrain: cloneTerrain(o.terrain), rect: [...o.rect] as Rect };
    const beforeTags = { ...o.tags };
    const connected = borderAsConnected(o);
    let nextTerrain = cloneTerrain(o.terrain);
    switch (mode) {
      case "dilate":
        nextTerrain = dilateTerrainMatrix(nextTerrain, dilate, connected);
        break;
      case "erode":
        nextTerrain = erodeTerrainMatrix(nextTerrain, erode, connected);
        break;
      case "erode_dilate":
        nextTerrain = erodeTerrainMatrix(nextTerrain, erode, connected);
        nextTerrain = dilateTerrainMatrix(nextTerrain, dilate, connected);
        break;
      case "dilate_erode":
        nextTerrain = dilateTerrainMatrix(nextTerrain, dilate, connected);
        nextTerrain = erodeTerrainMatrix(nextTerrain, erode, connected);
        break;
    }
    const afterTags = applyNoiseConfig(applyNoiseConfig(o.tags, "web.dilate", dilate), "web.erode", erode);
    if (terrainMatrixEquals(before.terrain, nextTerrain) && JSON.stringify(beforeTags) === JSON.stringify(afterTags)) return;
    const after: TerrainSnapshot = { terrain: nextTerrain, rect: [...o.rect] as Rect };
    const label = mode === "dilate" ? "Dilate"
      : mode === "erode" ? "Erode"
      : mode === "erode_dilate" ? "Erode then dilate"
      : "Dilate then erode";
    run(terrainMutationWithTagsCommand(map, id, before, after, beforeTags, afterTags, label));
  }, [map, run]);

  const onOpenBitwise = useCallback((id: number) => {
    if (!map) return;
    const target = findObject(map, id);
    if (!isBitwiseSupported(target)) return;
    setBitwiseTargetId(id);
  }, [map]);

  const onInitBitwise = useCallback((id: number, filled: boolean) => {
    if (!map) return;
    const target = findObject(map, id);
    if (!isBitwiseSupported(target)) return;
    const before: TerrainSnapshot = { terrain: cloneTerrain(target.terrain), rect: [...target.rect] as Rect };
    const afterTerrain = fillTerrainMatrix(target.terrain, filled);
    if (terrainMatrixEquals(before.terrain, afterTerrain)) return;
    const after: TerrainSnapshot = { terrain: afterTerrain, rect: [...target.rect] as Rect };
    run(bitwiseObjectCommand(map, id, before, after, filled ? "Init full" : "Init empty"));
  }, [map, run]);

  const onRunBitwiseQuickOp = useCallback((id: number, op: "keep_border" | "flip" | "remove_zero") => {
    if (!map) return;
    const target = findObject(map, id);
    if (!isBitwiseSupported(target)) return;
    const before: TerrainSnapshot = { terrain: cloneTerrain(target.terrain), rect: [...target.rect] as Rect };
    const afterTerrain = op === "keep_border"
      ? keepBorderTerrainMatrix(target.terrain)
      : op === "flip"
        ? flipTerrainMatrix(target.terrain)
        : removeZeroLikeDesktop(target.terrain, target.type, borderAsConnected(target));
    if (terrainMatrixEquals(before.terrain, afterTerrain)) return;
    const after: TerrainSnapshot = { terrain: afterTerrain, rect: [...target.rect] as Rect };
    const label = op === "keep_border" ? "Keep border" : op === "flip" ? "Flip" : "Remove zero";
    run(bitwiseObjectCommand(map, id, before, after, label));
  }, [map, run]);

  const onCloseBitwise = useCallback(() => {
    setBitwiseTargetId(null);
    setBitwiseSourceId(null);
  }, []);

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

  const onAddFrgCell = useCallback((id: number, paletteHash: string) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o || o.type !== "FIXED_RECT_GROUP") return;
    const before = effectiveFrgCells(o);
    if (before.some((cell) => cell.palette === paletteHash)) return;
    const after = [...before, { palette: paletteHash, weight: 100 }];
    run(setFrgCellsCommand(map, id, before, after, "Add FRG cell"));
  }, [map, run, effectiveFrgCells]);

  const onRemoveFrgCell = useCallback((id: number, index: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o || o.type !== "FIXED_RECT_GROUP") return;
    const before = effectiveFrgCells(o);
    if (index < 0 || index >= before.length) return;
    const after = before.filter((_, i) => i !== index);
    run(setFrgCellsCommand(map, id, before, after, "Delete FRG cell"));
  }, [map, run, effectiveFrgCells]);

  const onSetFrgCellWeight = useCallback((id: number, index: number, weight: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o || o.type !== "FIXED_RECT_GROUP") return;
    const before = effectiveFrgCells(o);
    if (index < 0 || index >= before.length) return;
    const nextWeight = Math.max(0, Math.round(weight));
    if (before[index].weight === nextWeight) return;
    const after = before.map((cell, i) => (i === index ? { ...cell, weight: nextWeight } : cell));
    run(setFrgCellsCommand(map, id, before, after, "FRG cell weight"));
  }, [map, run, effectiveFrgCells]);

  const onSetFrgPlacementMode = useCallback((id: number, placementMode: FrgPlacementMode) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o || o.type !== "FIXED_RECT_GROUP") return;
    const before = effectiveFrgPlacementMode(o);
    if (before === placementMode) return;
    run(setFrgPlacementModeCommand(map, id, before, placementMode));
  }, [map, run, effectiveFrgPlacementMode]);

  const onApplyFrgNoise = useCallback((id: number, config: TerrainNoiseConfig) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o || o.type !== "FIXED_RECT_GROUP" || !o.terrain) return;
    const before: TerrainSnapshot = { terrain: cloneTerrain(o.terrain), rect: [...o.rect] as Rect };
    const beforeTags = { ...o.tags };
    const afterTags = applyNoiseConfig(o.tags, "web.frg", config);
    if (JSON.stringify(beforeTags) === JSON.stringify(afterTags)) return;
    const after: TerrainSnapshot = { terrain: cloneTerrain(o.terrain), rect: [...o.rect] as Rect };
    run(terrainMutationWithTagsCommand(map, id, before, after, beforeTags, afterTags, "FRG noise"));
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
    return sortCreateChoices(out);
  }, [pack, activeRoot]);
  const houseWallChoices = useMemo(() => {
    if (!pack || activeRoot !== "building") return [] as CreatePaletteChoice[];
    const out: CreatePaletteChoice[] = [];
    for (const palette of pack.palettes) {
      if (!isStructureMode(palette.mode)) continue;
      if (palette.role !== HOUSE_WALL_ROLE && !(palette.role === HOUSE_CREATE_ROLE && palette.mode === PaletteMode.CLIFF)) continue;
      out.push({ kind: "house", palette, role: palette.role });
    }
    return sortCreateChoices(out);
  }, [pack, activeRoot]);
  const houseRoofChoices = useMemo(() => {
    if (!pack || activeRoot !== "building") return [] as CreatePaletteChoice[];
    const out: CreatePaletteChoice[] = [];
    for (const palette of pack.palettes) {
      if (!isStructureMode(palette.mode)) continue;
      if (palette.role !== HOUSE_ROOF_ROLE) continue;
      out.push({ kind: "house", palette, role: palette.role });
    }
    return sortCreateChoices(out);
  }, [pack, activeRoot]);
  const createKindOptions = useMemo(
    () => {
      const seen = new Set(createPaletteChoices.map((choice) => choice.kind));
      if (houseWallChoices.length > 0 && houseRoofChoices.length > 0) seen.add("house");
      const order = activeRoot === "building" ? BUILDING_KIND_ORDER : DEFAULT_KIND_ORDER;
      return order.filter((kind) => seen.has(kind));
    },
    [createPaletteChoices, houseWallChoices, houseRoofChoices, activeRoot],
  );
  const createPaletteOptions = useMemo(
    () => createPaletteChoices.filter((choice) => choice.kind === createKind),
    [createPaletteChoices, createKind],
  );
  const selectedCreateChoice = useMemo(
    () => createKind === "house" ? null : createPaletteOptions.find((choice) => choice.palette.hash === createPaletteHash) ?? null,
    [createKind, createPaletteOptions, createPaletteHash],
  );
  const selectedCreateHouseWall = useMemo(
    () => houseWallChoices.find((choice) => choice.palette.hash === createHouseWallHash) ?? null,
    [houseWallChoices, createHouseWallHash],
  );
  const selectedCreateHouseRoof = useMemo(
    () => houseRoofChoices.find((choice) => choice.palette.hash === createHouseRoofHash) ?? null,
    [houseRoofChoices, createHouseRoofHash],
  );

  useEffect(() => {
    if (createKindOptions.length === 0) {
      setCreateArmed(false);
      setCreatePaletteHash("");
      setCreateHouseWallHash("");
      setCreateHouseRoofHash("");
      return;
    }
    setCreateKind((prev) => (createKindOptions.includes(prev) ? prev : createKindOptions[0]));
  }, [createKindOptions]);

  useEffect(() => {
    if (createKind === "house") return;
    if (createPaletteOptions.length === 0) {
      setCreatePaletteHash("");
      setCreateArmed(false);
      setCreateModalOpen(false);
      return;
    }
    setCreatePaletteHash((prev) => createPaletteOptions.some((choice) => choice.palette.hash === prev) ? prev : createPaletteOptions[0].palette.hash);
  }, [createKind, createPaletteOptions]);

  useEffect(() => {
    if (createKind !== "house") return;
    if (houseWallChoices.length === 0 || houseRoofChoices.length === 0) {
      setCreateArmed(false);
      setCreateModalOpen(false);
      return;
    }
    setCreateHouseWallHash((prev) => houseWallChoices.some((choice) => choice.palette.hash === prev) ? prev : houseWallChoices[0].palette.hash);
    setCreateHouseRoofHash((prev) => houseRoofChoices.some((choice) => choice.palette.hash === prev) ? prev : houseRoofChoices[0].palette.hash);
  }, [createKind, houseWallChoices, houseRoofChoices]);

  useEffect(() => {
    if (createArmed) setMarquee(false);
  }, [createArmed]);

  useEffect(() => {
    if (!createArmed) return;
    if (createKind === "house") {
      if (!selectedCreateHouseWall || !selectedCreateHouseRoof) setCreateArmed(false);
      return;
    }
    if (!selectedCreateChoice) setCreateArmed(false);
  }, [createArmed, createKind, selectedCreateChoice, selectedCreateHouseWall, selectedCreateHouseRoof]);

  const openCreateModal = useCallback(() => {
    if (!activeLayer || createKindOptions.length === 0) return;
    setMarquee(false);
    setCreateArmed(false);
    setCreateModalOpen(true);
  }, [activeLayer, createKindOptions]);

  const createPickerRequest = useMemo<PaletteCreateRequest | null>(() => {
    if (!createModalOpen || !activeLayer || createKindOptions.length === 0) return null;
    return {
      mode: "create",
      title: "Create Object",
      subtitle: `${activeLayer.name} · ${activeRoot || "layer role"}`,
      kindOptions: createKindOptions.map((kind) => ({ kind, label: CREATE_KIND_LABEL[kind] })),
      selectedKind: createKind,
      onSelectKind: (kind) => setCreateKind(kind as CreateKind),
      onConfirm: () => {
        if (createKind === "house") {
          if (!selectedCreateHouseWall || !selectedCreateHouseRoof) return;
        } else if (!selectedCreateChoice) return;
        setCreateModalOpen(false);
        setCreateArmed(true);
      },
      ...(createKind === "house"
        ? {
            selectionMode: "house" as const,
            houseSlots: [
              {
                key: "wall",
                label: "Wall Palette",
                role: HOUSE_WALL_ROLE,
                currentHash: createHouseWallHash,
                choices: houseWallChoices.map((choice) => ({ kind: choice.kind, role: choice.role, palette: choice.palette })),
                onPick: (hash: string) => setCreateHouseWallHash(hash),
              },
              {
                key: "roof",
                label: "Roof Palette",
                role: HOUSE_ROOF_ROLE,
                currentHash: createHouseRoofHash,
                choices: houseRoofChoices.map((choice) => ({ kind: choice.kind, role: choice.role, palette: choice.palette })),
                onPick: (hash: string) => setCreateHouseRoofHash(hash),
              },
            ],
          }
        : {
            selectionMode: "single" as const,
            choices: createPaletteChoices.map((choice) => ({ kind: choice.kind, role: choice.role, palette: choice.palette })),
            currentHash: createPaletteHash,
            onPick: (hash: string) => setCreatePaletteHash(hash),
          }),
      confirmDisabled: createKind === "house" ? !selectedCreateHouseWall || !selectedCreateHouseRoof : !selectedCreateChoice,
      confirmLabel: "Place",
    };
  }, [createModalOpen, activeLayer, activeRoot, createKindOptions, createKind, createPaletteChoices, createPaletteHash, selectedCreateChoice, createHouseWallHash, createHouseRoofHash, houseWallChoices, houseRoofChoices, selectedCreateHouseWall, selectedCreateHouseRoof]);

  const onCreateAt = useCallback((tx: number, ty: number) => {
    if (!map || !activeLayer || !createKindOptions.includes(createKind)) return;
    const id = nextObjectId(map);
    const created = createKind === "house"
      ? (() => {
          if (!selectedCreateHouseWall || !selectedCreateHouseRoof) return null;
          const width = Math.max(2, selectedCreateHouseWall.palette.size[0], selectedCreateHouseRoof.palette.size[0]);
          const height = Math.max(2, selectedCreateHouseWall.palette.size[1] + selectedCreateHouseRoof.palette.size[1] - 1);
          return createObjectForRole(map, id, HOUSE_CREATE_ROLE, createKind, tx, ty, {
            houseWallHash: selectedCreateHouseWall.palette.hash,
            houseRoofHash: selectedCreateHouseRoof.palette.hash,
            size: [width, height],
            style: selectedCreateHouseRoof.palette.style || selectedCreateHouseWall.palette.style,
          });
        })()
      : (() => {
          if (!selectedCreateChoice) return null;
          return createObjectForRole(map, id, selectedCreateChoice.role, createKind, tx, ty, {
            paletteHash: selectedCreateChoice.palette.hash,
            size: selectedCreateChoice.palette.size,
            style: selectedCreateChoice.palette.style,
          });
        })();
    if (!created) return;
    run(createObjectCommand(map, activeLayer.id, created));
    setSelected(new Set([id]));
    setAnchorId(id);
    setCreateArmed(false);
  }, [map, activeLayer, selectedCreateChoice, selectedCreateHouseWall, selectedCreateHouseRoof, createKind, createKindOptions, nextObjectId, run]);

  const createPlacementLabel = useMemo(() => {
    if (createKind === "house") {
      if (!selectedCreateHouseWall || !selectedCreateHouseRoof) return "";
      const wall = selectedCreateHouseWall.palette.style || "wall";
      const roof = selectedCreateHouseRoof.palette.style || "roof";
      return `house (${wall} / ${roof})`;
    }
    return selectedCreateChoice ? (selectedCreateChoice.palette.style || selectedCreateChoice.role) : "";
  }, [createKind, selectedCreateChoice, selectedCreateHouseWall, selectedCreateHouseRoof]);

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
        else if (e.key === "Escape") { setMarquee(false); setCreateArmed(false); setCreateModalOpen(false); onCloseBitwise(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUndo, onRedo, map, selected.size, canPaste, onCopySelection, onPasteClipboard, onDuplicateSelection, onDeleteSelection, onCloseBitwise]);

  const selObjs = useMemo(() => (map ? ([...selected].map((id) => findObject(map, id)).filter(Boolean) as LiteObject[]) : []), [map, selected, version]);
  const bitwiseTarget = useMemo(() => (map && bitwiseTargetId != null ? findObject(map, bitwiseTargetId) : null), [map, bitwiseTargetId, version]);
  const bitwiseSources = useMemo(() => {
    if (!map || !isBitwiseSupported(bitwiseTarget)) return [] as {
      id: number;
      label: string;
      layerId: number;
      layerName: string;
      type: LiteType;
      role: string;
      overlap: boolean;
      origin: [number, number];
      size: [number, number];
    }[];
    const out: {
      id: number;
      label: string;
      layerId: number;
      layerName: string;
      type: LiteType;
      role: string;
      overlap: boolean;
      origin: [number, number];
      size: [number, number];
    }[] = [];
    for (const layer of map.layers) {
      for (const obj of layer.objects) {
        if (obj.id === bitwiseTarget.id || !isBitwiseSupported(obj)) continue;
        out.push({
          id: obj.id,
          label: displayName(obj),
          layerId: layer.id,
          layerName: layer.name,
          type: obj.type,
          role: roleOf(obj),
          overlap: hasBitwiseOverlap(bitwiseTarget.terrain, obj.terrain),
          origin: [obj.rect[0], obj.rect[1]],
          size: [obj.rect[2], obj.rect[3]],
        });
      }
    }
    return out;
  }, [map, bitwiseTarget, version]);
  useEffect(() => {
    if (!bitwiseTargetId || bitwiseSources.length === 0) {
      setBitwiseSourceId(null);
      return;
    }
    if (bitwiseSourceId != null && bitwiseSources.some((source) => source.id === bitwiseSourceId)) return;
    setBitwiseSourceId(bitwiseSources.find((source) => source.overlap)?.id ?? bitwiseSources[0].id);
  }, [bitwiseTargetId, bitwiseSources, bitwiseSourceId]);
  const onApplyBitwise = useCallback((op: BitwiseObjectOp) => {
    if (!map || !isBitwiseSupported(bitwiseTarget) || bitwiseSourceId == null) return;
    const source = findObject(map, bitwiseSourceId);
    if (!isBitwiseSupported(source)) return;
    const before: TerrainSnapshot = { terrain: cloneTerrain(bitwiseTarget.terrain), rect: [...bitwiseTarget.rect] as Rect };
    const afterTerrain = applyBitwiseObjectOp(bitwiseTarget.terrain, source.terrain, op);
    if (terrainMatrixEquals(before.terrain, afterTerrain)) {
      onCloseBitwise();
      return;
    }
    const after: TerrainSnapshot = { terrain: afterTerrain, rect: [...bitwiseTarget.rect] as Rect };
    run(bitwiseObjectCommand(map, bitwiseTarget.id, before, after, `Bitwise ${op}`));
    onCloseBitwise();
  }, [map, bitwiseTarget, bitwiseSourceId, run, onCloseBitwise]);
  const bitwiseRequest = useMemo(() => {
    if (!map || !isBitwiseSupported(bitwiseTarget)) return null;
    const targetLayer = layerOfObject(map, bitwiseTarget.id);
    return {
      targetLabel: displayName(bitwiseTarget),
      targetLayerName: targetLayer?.name ?? "Unknown layer",
      targetType: bitwiseTarget.type,
      targetRole: roleOf(bitwiseTarget),
      sources: bitwiseSources,
      selectedSourceId: bitwiseSourceId,
      onSelectSource: (id: number) => setBitwiseSourceId(id),
      onApply: onApplyBitwise,
    };
  }, [map, bitwiseTarget, bitwiseSources, bitwiseSourceId, onApplyBitwise]);
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
        <span className="badge">{lang === 'zh' ? '右键选/移 · 左键涂/缩放' : 'Right-click select/move · Left-click paint/zoom'}</span>
        <button onClick={() => fileInput.current?.click()}>{lang === 'zh' ? '打开 blueprint.json…' : 'Open blueprint.json…'}</button>
        <input ref={fileInput} type="file" accept=".json" hidden
          onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
        {map && (
          <>
            <button disabled={!canUndo} onClick={onUndo} title={lang === 'zh' ? "撤销 (Cmd/Ctrl+Z)" : "Undo (Cmd/Ctrl+Z)"}>↶ Undo</button>
            <button disabled={!canRedo} onClick={onRedo} title={lang === 'zh' ? "重做 (Shift+Cmd/Ctrl+Z)" : "Redo (Shift+Cmd/Ctrl+Z)"}>↷ Redo</button>
            <button onClick={onExport} title={lang === 'zh' ? "导出 adna-web-lite 存档" : "Export Save File"}>⤓ Export</button>
            <button disabled={selected.size === 0} onClick={onCopySelection} title={lang === 'zh' ? "复制当前对象/组到内部剪贴板 (Cmd/Ctrl+C)" : "Copy current object/group to clipboard (Cmd/Ctrl+C)"}>⧉ Copy</button>
            <button disabled={!canPaste} onClick={onPasteClipboard} title={pasteTitle}>⎘ Paste</button>
            <button disabled={selected.size === 0} onClick={onDeleteSelection} title={lang === 'zh' ? "删除当前对象/组 (Delete)" : "Delete current object/group (Delete)"}>⌫ Delete</button>
            <button className={marquee ? "active" : ""} onClick={() => {
              setMarquee((m) => {
                const next = !m;
                if (next) setCreateArmed(false);
                return next;
              });
            }} title={lang === 'zh' ? "框选工具(M)：左键拖一次框选,松手自动退回" : "Marquee Selection Tool (M): drag left click to select, releases automatically"}>▭ {lang === 'zh' ? '框选' : 'Marquee'}</button>
            {pack && (
              <>
                <span className="ts-sep" />
                <span className="ts-label">Tiles</span>
                <span className="seg">
                  <button className={renderMode === "blueprint" ? "active" : ""} onClick={() => setRenderMode("blueprint")} title={lang === 'zh' ? "抽象示意图(role 颜色)" : "Abstract blueprint layout (role colors)"}>Overlay</button>
                  <button className={renderMode === "mixed" ? "active" : ""} onClick={() => setRenderMode("mixed")} title={lang === 'zh' ? "已绑定的画真实图块,其余示意" : "Mixed real tiles and blueprint layout representation"}>Mixed</button>
                  <button className={renderMode === "real" ? "active" : ""} onClick={() => setRenderMode("real")} title={lang === 'zh' ? "只画真实图块" : "Real tiles rendering only"}>Real</button>
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
                  <button className={!brushErase ? "active" : ""} onClick={() => setBrushErase(false)}>{lang === 'zh' ? '绘制' : 'Paint'}</button>
                  <button className={brushErase ? "active" : ""} onClick={() => setBrushErase(true)}>{lang === 'zh' ? '擦除' : 'Erase'}</button>
                </span>
                {selLocked && <span className="muted small">{lang === 'zh' ? '已锁定' : 'Locked'}</span>}
              </>
            )}
          </>
        )}
        <span className="spacer" />
        {map && <span className="stat">{map.name}{version > 0 && <em className="muted">{lang === 'zh' ? ' · 进度已存本地' : ' · Saved locally'}</em>}</span>}
        <button
          style={{
            marginLeft: '12px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: 'pointer',
            color: 'var(--fg)'
          }}
          onClick={() => {
            const nextLang = lang === 'zh' ? 'en' : 'zh';
            setLang(nextLang);
            localStorage.setItem('adna_lang', nextLang);
          }}
        >
          🌐 {lang === 'zh' ? 'English' : '简体中文'}
        </button>
      </header>

      {error && <div className="error">{error}</div>}

      {!map ? (
        <div className="dropzone">
          <div>{lang === 'zh' ? <>把 <code>blueprint.json</code> 拖到这里，或点「打开 blueprint.json…」</> : <>Drag <code>blueprint.json</code> here, or click "Open blueprint.json..."</>}</div>
          <button onClick={loadSample}>{lang === 'zh' ? '试用样例' : 'Try Sample'}</button>
        </div>
      ) : (
        <div className="main" style={{ "--layers-w": `${layersWidth}px`, "--props-w": `${propsWidth}px` } as CSSProperties}>
          <aside className="layers">
            <div className="layers-head">
              <span className="legend-title">Layers</span>
              <div className="layers-actions">
                <button
                  className={createArmed ? "active" : ""}
                  disabled={!activeLayer || createKindOptions.length === 0}
                  onClick={openCreateModal}
                  title="选择类型和 palette，然后点击地图放置"
                >
                  Add Obj
                </button>
                <button disabled={selected.size === 0} onClick={onDuplicateSelection} title="复制当前对象/组">Dup Obj</button>
                <button disabled={selected.size === 0} onClick={onDeleteSelection} title="删除当前对象/组">Del Obj</button>
              </div>
            </div>
            {createArmed && createPlacementLabel && (
              <div className="prop-hint layer-hint">
                Click map to place {createPlacementLabel}. Press Esc to cancel.
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
          <div className="resizer left-resizer" onMouseDown={startLayersResize} title="拖动调整左栏宽度" />
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
          <div className="resizer right-resizer" onMouseDown={startPropsResize} title="拖动调整右栏宽度" />
          <PropsPanel
            layer={activeLayer}
            mapSize={[map.width, map.height]}
            objects={selObjs}
            pack={pack}
            bindings={bindings}
            onToggleLayerVisible={onToggleLayerVisible}
            onSetObjectsVisible={onSetObjectsVisible}
            onToggleLock={onToggleLock}
            onSetRectToMap={onSetRectToMap}
            onSetRectToAabb={onSetRectToAabb}
            onRandomizeTerrain={onRandomizeTerrain}
            onPreviewTerrainNoise={onPreviewTerrainNoise}
            onCommitTerrainNoisePreview={onCommitTerrainNoisePreview}
            onCancelTerrainNoisePreview={onCancelTerrainNoisePreview}
            onSetTerrainBorderAsConnected={onSetTerrainBorderAsConnected}
            onRunMorph={onRunMorph}
            onInitBitwise={onInitBitwise}
            onRunBitwiseQuickOp={onRunBitwiseQuickOp}
            onOpenBitwise={onOpenBitwise}
            onRename={onRename}
            onSetObjectType={onSetObjectType}
            onSetPalette={onSetPalette}
            onAddFrgCell={onAddFrgCell}
            onRemoveFrgCell={onRemoveFrgCell}
            onSetFrgCellWeight={onSetFrgCellWeight}
            onSetFrgPlacementMode={onSetFrgPlacementMode}
            onApplyFrgNoise={onApplyFrgNoise}
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
          />
          <PalettePickerModal pack={pack} request={createPickerRequest} onClose={() => setCreateModalOpen(false)} />
          <BitwiseObjectModal request={bitwiseRequest} onClose={onCloseBitwise} />
        </div>
      )}
    </div>
  );
}
