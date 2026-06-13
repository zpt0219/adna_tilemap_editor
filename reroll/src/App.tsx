import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { parseBlueprint } from "./blueprint";
import { blueprintToLite } from "./convert";
import { normalizeToCategories } from "./normalize";
import { assignUniqueObjectNames, cloneTerrain, displayName, findLayer, findObject, isLocked, layerOfObject, roleOf, setTerrainCell, type LiteObject, type LiteTileMap, type Rect } from "./model";
import { UndoStack, moveHouseDecoCommand, moveObjectCommand, moveObjectsCommand, paintTerrainCommand, renameObjectCommand, reorderLayerObjectsCommand, resizeObjectCommand, setHouseDecoPaletteCommand, setHouseSlotPaletteCommand, setObjectsEnabledCommand, setObjectPaletteCommand, setObjectTypeCommand, setWallHeightCommand, toggleLayerEnabledCommand, toggleObjectEnabledCommand, type Command, type TerrainSnapshot } from "./commands";
import type { LiteType } from "./model";
import { liteToWebSave } from "./saveFormat";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { downloadJson } from "./download";
import { colorForRole } from "./generated/roleColors";
import { CanvasView, type BrushState } from "./components/CanvasView";
import { PropsPanel } from "./components/PropsPanel";
import { loadPackFromUrl } from "./pack/loadPack";
import { compileMap } from "./pack/compile";
import type { PackRuntime } from "./pack/types";
import type { RenderMode } from "./render";

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
  const undo = useRef(new UndoStack());
  const stroke = useRef<{ id: number; before: TerrainSnapshot; dirty: boolean } | null>(null);
  const decoDrag = useRef<{ id: number; slot: number; before: [number, number] } | null>(null);
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
  const onHouseDecoStart = useCallback((id: number, slot: number) => {
    if (!map) { decoDrag.current = null; return; }
    const o = findObject(map, id);
    decoDrag.current = o?.house ? { id, slot, before: [...o.house.deco[slot].cell] as [number, number] } : null;
  }, [map]);

  const onHouseDecoMove = useCallback((id: number, slot: number, cell: [number, number]) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house) return;
    const cur = o.house.deco[slot].cell;
    if (cur[0] === cell[0] && cur[1] === cell[1]) return;
    o.house.deco[slot].cell = [...cell];
    setVersion((v) => v + 1); // live preview (also recompiles, but house bindings don't depend on cell)
  }, [map]);

  const onHouseDecoEnd = useCallback(() => {
    const d = decoDrag.current;
    decoDrag.current = null;
    if (!map || !d) return;
    const o = findObject(map, d.id);
    if (!o?.house) return;
    const after = [...o.house.deco[d.slot].cell] as [number, number];
    if (after[0] !== d.before[0] || after[1] !== d.before[1]) run(moveHouseDecoCommand(map, d.id, d.slot, d.before, after));
  }, [map, run]);

  // --- house inspector: per-slot palette + wall height ---
  const onSetHouseSlot = useCallback((id: number, slot: "wall" | "roof" | number, hash: string | null) => {
    if (!map) return;
    const o = findObject(map, id);
    if (!o?.house) return;
    const after = hash ?? undefined;
    if (slot === "wall" || slot === "roof") {
      if (o.house[slot] !== after) run(setHouseSlotPaletteCommand(map, id, slot, o.house[slot], after));
    } else {
      const before = o.house.deco[slot].palette;
      if (before !== after) run(setHouseDecoPaletteCommand(map, id, slot, before, after));
    }
  }, [map, run]);

  const onSetWallHeight = useCallback((id: number, height: number) => {
    if (!map) return;
    const o = findObject(map, id);
    if (o?.house && o.house.wallHeight !== height) run(setWallHeightCommand(map, id, o.house.wallHeight, height));
  }, [map, run]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo(); else onUndo();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && map) {
        if (e.key.toLowerCase() === "m") { e.preventDefault(); setMarquee((m) => !m); }
        else if (e.key === "Escape") setMarquee(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUndo, onRedo, map]);

  const activeLayer = useMemo(() => (map && activeLayerId != null ? findLayer(map, activeLayerId) : null), [map, activeLayerId, version]);
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
            <button className={marquee ? "active" : ""} onClick={() => setMarquee((m) => !m)} title="框选工具(M)：左键拖一次框选,松手自动退回">▭ Marquee</button>
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
            onPick={onPick}
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
          />
        </div>
      )}
    </div>
  );
}
