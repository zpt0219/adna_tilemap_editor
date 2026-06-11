// PropsPanel — the right sidebar. Layer + Object inspection, plus (when a pack
// is loaded) a Palette panel: convert a terrain object's autotile type and
// manually replace the palette bound to the selected object.

import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, isLocked, roleOf, type Layer, type LiteObject, type LiteType } from "../model";
import { colorForRole, rgbaCss } from "../generated/roleColors";
import { mappingCell, PaletteMode, type Palette, type PackRuntime } from "../pack/types";
import { roleTreeDistance, type Bindings } from "../pack/compile";

// Friendly object-type names (the engine TYPE → a word a map-maker reads).
const TYPE_LABEL: Record<LiteObject["type"], string> = {
  TERRAIN_2_CORNER: "Terrain",
  TERRAIN_2_EDGE: "Path",
  FIXED_RECT_GROUP: "Group",
  FIXED_RECT: "Rect",
  DUNGEON: "Dungeon",
};

// Terrain types a cell-matrix object can be converted between.
const TERRAIN_TYPES: [LiteType, string][] = [
  ["TERRAIN_2_CORNER", "2-Corner"],
  ["TERRAIN_2_EDGE", "2-Edge"],
  ["FIXED_RECT_GROUP", "Scatter"],
];

export interface PropsPanelProps {
  layer: Layer | null;
  /** selected objects, primary first ([...selected] order) */
  objects: LiteObject[];
  pack: PackRuntime | null;
  bindings: Bindings | null;
  onToggleLayerVisible: () => void;
  onSetObjectsVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onRename: (id: number, name: string) => void;
  onSetObjectType: (id: number, type: LiteType) => void;
  onSetPalette: (id: number, hash: string | null) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-val">{children}</span>
    </div>
  );
}

// A small atlas-cropped preview of a palette (its size[w,h] tile block).
function PaletteSwatch({ pack, palette, px = 40 }: { pack: PackRuntime; palette: Palette; px?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const [bx, by] = mappingCell(palette.mapping, 0, 0);
    const tr = palette.tileResolution;
    const sw = palette.size[0] * tr, sh = palette.size[1] * tr;
    const f = Math.min(px / sw, px / sh);
    const dw = Math.max(1, Math.round(sw * f)), dh = Math.max(1, Math.round(sh * f));
    ctx.clearRect(0, 0, px, px);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pack.atlas, bx, by, sw, sh, Math.floor((px - dw) / 2), Math.floor((px - dh) / 2), dw, dh);
  }, [pack, palette, px]);
  return <canvas ref={ref} width={px} height={px} className="pal-sw" />;
}

function PalettePicker({ pack, o, currentHash, onSetPalette }: {
  pack: PackRuntime; o: LiteObject; currentHash: string | undefined;
  onSetPalette: (id: number, hash: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const role = roleOf(o);
  const ranked = useMemo(() => {
    const arr = pack.palettes.map((p) => ({ p, d: roleTreeDistance(role, p.role) }));
    const list = showAll ? arr : arr.filter((x) => x.d <= 2);
    list.sort((a, b) => a.d - b.d || a.p.role.localeCompare(b.p.role) || a.p.style.localeCompare(b.p.style));
    return list;
  }, [pack, role, showAll]);

  return (
    <div className="pal-picker">
      <div className="pal-picker-head">
        <span className="prop-label">Palette</span>
        <button className="pal-auto" disabled={!o.tags["web.palette"]} onClick={() => onSetPalette(o.id, null)} title="恢复按 role 自动选">Auto</button>
        <label className="pal-all"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 全部</label>
      </div>
      <div className="pal-grid">
        {ranked.map(({ p, d }) => (
          <button
            key={p.hash}
            className={`pal-cell${p.hash === currentHash ? " sel" : ""}`}
            title={`${p.role}${p.style ? " · " + p.style : ""} · ${PaletteMode[p.mode] ?? p.mode}${d > 0 ? ` · d${d}` : ""}`}
            onClick={() => onSetPalette(o.id, p.hash)}
          >
            <PaletteSwatch pack={pack} palette={p} />
          </button>
        ))}
        {ranked.length === 0 && <span className="prop-empty">无同类 palette（勾「全部」看所有）</span>}
      </div>
    </div>
  );
}

function ObjectBody({ o, pack, bindings, onSetVisible, onToggleLock, onRename, onSetObjectType, onSetPalette }: {
  o: LiteObject;
  pack: PackRuntime | null;
  bindings: Bindings | null;
  onSetVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onRename: (id: number, name: string) => void;
  onSetObjectType: (id: number, type: LiteType) => void;
  onSetPalette: (id: number, hash: string | null) => void;
}) {
  const shown = displayName(o);
  const rgb = colorForRole(roleOf(o));
  const merged = Number(o.tags["web.merged"] ?? "1");
  const style = o.tags["blueprint.style"];
  const label = o.tags["blueprint.label"];

  const commit = (v: string) => { const t = v.trim(); if (t !== shown) onRename(o.id, t); };

  // effective bound palette: manual override wins, else the compiled binding
  const b = bindings?.get(o.id);
  const boundHash = b ? (b.kind === "frg" ? b.variants[0]?.hash : b.palette.hash) : undefined;
  const currentHash = o.tags["web.palette"] ?? boundHash;

  return (
    <>
      <div className="prop-titlerow">
        <span className="prop-swatch" style={{ background: rgbaCss(rgb, 1) }} />
        <input
          className="prop-name"
          defaultValue={shown}
          title="改名（回车确认）"
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      </div>
      <Row label="Type">{TYPE_LABEL[o.type] ?? o.type}</Row>
      <Row label="Role">{roleOf(o) || "—"}</Row>
      <Row label="Origin">({o.rect[0]}, {o.rect[1]})</Row>
      <Row label="Size">{o.rect[2]} × {o.rect[3]}</Row>
      {merged > 1 && <Row label="Merged">{merged} 个合并</Row>}
      {style && <Row label="Style">{style}</Row>}
      {label && <Row label="Label">{label}</Row>}

      {/* convert terrain type (fix 2-edge/2-corner mislabels) */}
      {o.terrain && (
        <Row label="Terrain">
          <span className="seg">
            {TERRAIN_TYPES.map(([t, lbl]) => (
              <button key={t} className={o.type === t ? "active" : ""} onClick={() => onSetObjectType(o.id, t)}>{lbl}</button>
            ))}
          </span>
        </Row>
      )}

      {/* manual palette replacement */}
      {pack && <PalettePicker pack={pack} o={o} currentHash={currentHash} onSetPalette={onSetPalette} />}

      <div className="prop-checks">
        <label className="prop-check">
          <input type="checkbox" checked={o.enabled} onChange={() => onSetVisible(!o.enabled)} /> Visible
        </label>
        <label className="prop-check">
          <input type="checkbox" checked={isLocked(o)} onChange={onToggleLock} /> Lock
        </label>
      </div>
    </>
  );
}

export function PropsPanel({ layer, objects, pack, bindings, onToggleLayerVisible, onSetObjectsVisible, onToggleLock, onRename, onSetObjectType, onSetPalette }: PropsPanelProps) {
  const primary = objects[0] ?? null;
  const allVisible = objects.length > 0 && objects.every((o) => o.enabled);

  return (
    <aside className="props">
      <section className="prop-section">
        <div className="prop-head">Layer</div>
        {!layer ? (
          <div className="prop-empty">未选中图层</div>
        ) : (
          <>
            <div className="prop-titlerow"><span className="prop-name static">{layer.name}</span></div>
            {layer.tags["web.category"] && <Row label="Category"><span className="prop-badge">{layer.tags["web.category"]}</span></Row>}
            <Row label="Objects">{layer.objects.length}</Row>
            <Row label="Y-sort">{layer.vertical ? "开 · 按 Y" : "关 · 地面"}</Row>
            <div className="prop-checks">
              <label className="prop-check">
                <input type="checkbox" checked={layer.enabled} onChange={onToggleLayerVisible} /> Visible
              </label>
            </div>
          </>
        )}
      </section>

      <div className="prop-divider" />

      <section className="prop-section">
        <div className="prop-head">Object</div>
        {objects.length === 0 ? (
          <div className="prop-empty">未选中对象</div>
        ) : objects.length > 1 ? (
          <>
            <div className="prop-titlerow"><span className="prop-name static">{objects.length} 个对象</span></div>
            <div className="prop-checks">
              <label className="prop-check">
                <input type="checkbox" checked={allVisible} onChange={() => onSetObjectsVisible(!allVisible)} /> Visible
              </label>
              <label className="prop-check">
                <input type="checkbox" checked={objects.every((o) => isLocked(o))} onChange={onToggleLock} /> Lock
              </label>
            </div>
          </>
        ) : primary ? (
          <ObjectBody
            key={primary.id}
            o={primary}
            pack={pack}
            bindings={bindings}
            onSetVisible={onSetObjectsVisible}
            onToggleLock={onToggleLock}
            onRename={onRename}
            onSetObjectType={onSetObjectType}
            onSetPalette={onSetPalette}
          />
        ) : null}
      </section>
    </aside>
  );
}
