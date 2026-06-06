import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseBlueprint } from "./blueprint";
import { blueprintToLite } from "./convert";
import { normalizeToCategories } from "./normalize";
import { cloneTerrain, displayName, findObject, isLocked, layerOfObject, roleOf, setTerrainCell, type LiteObject, type LiteTileMap, type Rect } from "./model";
import { UndoStack, moveLayerCommand, moveObjectCommand, paintTerrainCommand, resizeObjectCommand, toggleLayerEnabledCommand, type Command, type TerrainSnapshot } from "./commands";
import { activeLegend } from "./legend";
import { liteToWebSave } from "./saveFormat";
import { downloadJson } from "./download";
import { colorForRole, rgbaCss } from "./generated/roleColors";
import { CanvasView, type BrushState } from "./components/CanvasView";

const isTerrain = (o: LiteObject | null) => !!o && (o.type === "TERRAIN_2_CORNER" || o.type === "TERRAIN_2_EDGE");

export default function App() {
  const [map, setMap] = useState<LiteTileMap | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [brushSize, setBrushSize] = useState(3);
  const [brushErase, setBrushErase] = useState(false);
  // active layer = pure highlight + the reorder target (not undoable, not exported)
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null);
  // category-layer model on/off (docs/LAYER_MODEL.md); off = raw blueprint layers
  const [normalize, setNormalize] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const undo = useRef(new UndoStack());
  const stroke = useRef<{ id: number; before: TerrainSnapshot; dirty: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const source = useRef<{ name: string; text: string } | null>(null);

  const build = useCallback((name: string, text: string, norm: boolean) => {
    let lite = blueprintToLite(parseBlueprint(name, text));
    if (norm) lite = normalizeToCategories(lite);
    undo.current = new UndoStack();
    setMap(lite);
    setSelected(new Set());
    setActiveLayerId(lite.layers[0]?.id ?? null);
    setExpanded(new Set());
    setVersion(0);
    setError("");
  }, []);

  const load = useCallback((name: string, text: string) => {
    source.current = { name, text };
    build(name, text, normalize);
  }, [build, normalize]);

  const onToggleNormalize = useCallback(() => {
    setNormalize((n) => {
      const next = !n;
      if (source.current) build(source.current.name, source.current.text, next);
      return next;
    });
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
      const res = await fetch(`${import.meta.env.BASE_URL}sample/beach_village.blueprint.json`);
      if (!res.ok) throw new Error(`sample 不可用 (${res.status})`);
      load("beach_village (sample)", await res.text());
    } catch (e) { setError(`样例加载失败: ${(e as Error).message}`); }
  }, [load]);

  useEffect(() => {
    const onDrop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) void loadFile(f); };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => { window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onDragOver); };
  }, [loadFile]);

  // --- commands ---
  const run = useCallback((cmd: Command) => { undo.current.push(cmd); setVersion((v) => v + 1); }, []);
  const onUndo = useCallback(() => { undo.current.undo(); setVersion((v) => v + 1); }, []);
  const onRedo = useCallback(() => { undo.current.redo(); setVersion((v) => v + 1); }, []);

  const onExport = useCallback(() => {
    if (!map) return;
    const base = (map.name || "map").replace(/\s*\(sample\)$/, "").replace(/\.[^.]+$/, "") || "map";
    downloadJson(`${base}.adnaweb.json`, liteToWebSave(map));
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

  const onSelect = useCallback((id: number | null, additive: boolean) => {
    // selecting an object highlights its owning layer (active = pure highlight)
    if (id != null && map) {
      const ly = layerOfObject(map, id);
      if (ly) { setActiveLayerId(ly.id); setExpanded((p) => new Set(p).add(ly.id)); }
    }
    setSelected((prev) => {
      if (id == null) return new Set();
      const next = new Set(additive ? prev : []);
      if (additive && prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [map]);

  // --- layer panel actions ---
  const onToggleLayer = useCallback((layerId: number) => {
    if (map) run(toggleLayerEnabledCommand(map, layerId));
  }, [map, run]);

  const onMoveActiveLayer = useCallback((dir: -1 | 1) => {
    if (!map || activeLayerId == null) return;
    const from = map.layers.findIndex((l) => l.id === activeLayerId);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= map.layers.length) return;
    run(moveLayerCommand(map, from, to));
  }, [map, activeLayerId, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) onRedo(); else onUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUndo, onRedo]);

  const legend = useMemo(() => (map ? activeLegend(map) : []), [map, version]);
  const selObj = useMemo(() => (map && selected.size ? findObject(map, [...selected][0]) : null), [map, selected, version]);
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
            <span className="seg" title="大类层模型 / 原始 blueprint 层">
              <button className={normalize ? "active" : ""} onClick={() => { if (!normalize) onToggleNormalize(); }}>大类</button>
              <button className={!normalize ? "active" : ""} onClick={() => { if (normalize) onToggleNormalize(); }}>原始</button>
            </span>
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
        {map && <span className="stat">{map.name}</span>}
      </header>

      {error && <div className="error">{error}</div>}

      {!map ? (
        <div className="dropzone">
          <div>把 <code>blueprint.json</code> 拖到这里，或点「打开 blueprint.json…」</div>
          <button onClick={loadSample}>试用样例</button>
        </div>
      ) : (
        <div className="main">
          <aside className="layers">
            <div className="layers-head">
              <span className="legend-title">Layers</span>
              <span className="seg">
                <button title="上移(更靠前)" disabled={activeLayerId == null} onClick={() => onMoveActiveLayer(1)}>↑</button>
                <button title="下移(更靠后)" disabled={activeLayerId == null} onClick={() => onMoveActiveLayer(-1)}>↓</button>
              </span>
            </div>
            {/* panel top = front (drawn on top) → render the array reversed */}
            {[...map.layers].reverse().map((ly) => {
              const open = expanded.has(ly.id);
              const total: Record<string, number> = {};
              for (const o of ly.objects) { const n = displayName(o); total[n] = (total[n] ?? 0) + 1; }
              const seen: Record<string, number> = {};
              return (
                <div key={ly.id} className="layer-group">
                  <div
                    className={`layer-row${ly.id === activeLayerId ? " active" : ""}${ly.enabled ? "" : " hidden"}`}
                    onClick={() => { setActiveLayerId(ly.id); toggleExpand(ly.id); }}
                  >
                    <button className="caret" onClick={(e) => { e.stopPropagation(); toggleExpand(ly.id); }}>
                      {open ? "▾" : "▸"}
                    </button>
                    <button
                      className="eye"
                      title={ly.enabled ? "隐藏" : "显示"}
                      onClick={(e) => { e.stopPropagation(); onToggleLayer(ly.id); }}
                    >
                      {ly.enabled ? "👁" : "🚫"}
                    </button>
                    <span className="layer-name" title={ly.name}>{ly.name}</span>
                    <span className="layer-count">{ly.objects.length}</span>
                  </div>
                  {open && ly.objects.map((o) => {
                    const base = displayName(o);
                    const occ = (seen[base] = (seen[base] ?? 0) + 1);
                    const label = total[base] > 1 ? `${base} #${occ}` : base;
                    return (
                      <div
                        key={o.id}
                        className={`obj-row${selected.has(o.id) ? " selected" : ""}`}
                        onClick={() => onSelect(o.id, false)}
                      >
                        <span className="obj-swatch" style={{ background: rgbaCss(colorForRole(roleOf(o)), 1) }} />
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
            brush={brush}
            selected={selected}
            onSelect={onSelect}
            onMove={onMove}
            onResize={onResize}
            onToggleLock={onToggleLock}
            onStrokeStart={onStrokeStart}
            onStrokePaint={onStrokePaint}
            onStrokeEnd={onStrokeEnd}
          />
          <aside className="legend">
            <div className="legend-title">Legend</div>
            {legend.map((r) => (
              <div key={r.label} className="legend-row">
                <span className="legend-swatch" style={{ background: rgbaCss(r.rgb, 1) }} />
                {r.label}
              </div>
            ))}
            <div className="legend-help">
              右键点=选物体 · 右键拖=移动<br />
              左键(选中地形)=涂/擦 · 左键(选中建筑)=拖边缩放/内部移动<br />
              中键平移 · 滚轮缩放 · Cmd/Ctrl+Z 撤销
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
