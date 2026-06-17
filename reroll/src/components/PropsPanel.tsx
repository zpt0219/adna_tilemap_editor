// PropsPanel — the right sidebar. Layer + Object inspection, plus (when a pack
// is loaded) a Palette panel: convert a terrain object's autotile type and
// manually replace the palette bound to the selected object.

import { useMemo, useState } from "react";
import { displayName, isLocked, roleOf, type HouseDecorationKind, type Layer, type LiteObject, type LiteType } from "../model";
import { colorForRole, rgbaCss } from "../generated/roleColors";
import { PaletteMode, type PackRuntime } from "../pack/types";
import { roleTreeDistance, type Bindings } from "../pack/compile";
import { decorationRole } from "../house";
import { PaletteSwatch } from "./PaletteSwatch";

// Friendly object-type names (the engine TYPE -> a word a map-maker reads).
const TYPE_LABEL: Record<LiteObject["type"], string> = {
  TERRAIN_2_CORNER: "Terrain",
  TERRAIN_2_EDGE: "Path",
  FIXED_RECT_GROUP: "Group",
  FIXED_RECT: "Rect",
  DUNGEON: "Dungeon",
  HOUSE: "House",
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
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
  onAddHouseDecoration: (id: number, kind: HouseDecorationKind, palette?: string) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
  onGenerateHouseDecorations: (id: number) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-val">{children}</span>
    </div>
  );
}

// Reusable palette grid for one role/slot: in-range candidates (or 全部), with
// the current one highlighted, an Auto reset, and a click -> onPick(hash).
function PalettePicker({ pack, label, role, currentHash, hasOverride, onPick, onAuto }: {
  pack: PackRuntime; label: string; role: string | null; currentHash: string | undefined;
  hasOverride: boolean; onPick: (hash: string) => void; onAuto: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const ranked = useMemo(() => {
    const arr = pack.palettes
      .filter((p) => role ? true : p.mode === PaletteMode.FIXED_RECT)
      .map((p) => ({ p, d: role ? roleTreeDistance(role, p.role) : 0 }));
    const list = showAll || !role ? arr : arr.filter((x) => x.d <= 2);
    list.sort((a, b) => a.d - b.d || a.p.role.localeCompare(b.p.role) || a.p.style.localeCompare(b.p.style));
    return list;
  }, [pack, role, showAll]);

  return (
    <div className="pal-picker">
      <div className="pal-picker-head">
        <span className="prop-label">{label}</span>
        <button className="pal-auto" disabled={!hasOverride} onClick={onAuto} title="恢复按 role 自动选">Auto</button>
        <label className="pal-all"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 全部</label>
      </div>
      <div className="pal-grid">
        {ranked.map(({ p, d }) => (
          <button
            key={p.hash}
            className={`pal-cell${p.hash === currentHash ? " sel" : ""}`}
            title={`${p.role}${p.style ? " · " + p.style : ""} · ${PaletteMode[p.mode] ?? p.mode}${d > 0 ? ` · d${d}` : ""}`}
            onClick={() => onPick(p.hash)}
          >
            <PaletteSwatch pack={pack} palette={p} />
          </button>
        ))}
        {ranked.length === 0 && <span className="prop-empty">无同类 palette（勾「全部」看所有）</span>}
      </div>
    </div>
  );
}

function DecorationEditor({ o, pack, index, currentHash, onSetHouseSlot, onRemoveHouseDecoration }: {
  o: LiteObject;
  pack: PackRuntime;
  index: number;
  currentHash: string | undefined;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
}) {
  const deco = o.house!.decorations[index];
  const label = deco.kind[0].toUpperCase() + deco.kind.slice(1);
  return (
    <div className="pal-picker">
      <div className="pal-picker-head">
        <span className="prop-label">{label} #{index + 1}</span>
        <button className="pal-auto" onClick={() => onRemoveHouseDecoration(o.id, index)}>Remove</button>
      </div>
      <div className="prop-hint">Cell ({deco.cell[0]}, {deco.cell[1]}) · drag on canvas to place</div>
      <PalettePicker
        pack={pack}
        label="Palette"
        role={decorationRole(deco.kind)}
        currentHash={currentHash}
        hasOverride={!!deco.palette}
        onPick={(hash) => onSetHouseSlot(o.id, index, hash)}
        onAuto={() => onSetHouseSlot(o.id, index, null)}
      />
    </div>
  );
}

function HouseSlots({ o, pack, bindings, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: {
  o: LiteObject;
  pack: PackRuntime;
  bindings: Bindings | null;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
  onAddHouseDecoration: (id: number, kind: HouseDecorationKind, palette?: string) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
  onGenerateHouseDecorations: (id: number) => void;
}) {
  const h = o.house!;
  const b = bindings?.get(o.id);
  const hb = b && b.kind === "house" ? b : null;
  const maxWallH = Math.max(1, o.rect[3] - 1);
  return (
    <>
      <Row label="Wall H">
        <input
          className="prop-num" type="number" min={1} max={maxWallH} value={h.wallHeight}
          onChange={(e) => onSetWallHeight(o.id, Math.max(1, Math.min(maxWallH, parseInt(e.target.value, 10) || 1)))}
        />
      </Row>
      <Row label="Overlap">
        <input
          className="prop-num" type="number" min={-1} max={Math.max(0, o.rect[3] - 1)} value={h.overlap}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10);
            const next = Number.isNaN(raw) ? 0 : raw;
            onSetHouseOverlap(o.id, Math.max(-1, Math.min(Math.max(0, o.rect[3] - 1), next)));
          }}
        />
      </Row>
      <div className="prop-hint">`-1` = auto overlap, `0` = none. Decorations drag before resize, matching desktop.</div>
      <div className="prop-checks">
        <button onClick={() => onGenerateHouseDecorations(o.id)} disabled={h.decorations.length === 0}>Generate</button>
        <button onClick={() => onAddHouseDecoration(o.id, "door")}>+ Door</button>
        <button onClick={() => onAddHouseDecoration(o.id, "window")}>+ Window</button>
        <button onClick={() => onAddHouseDecoration(o.id, "chimney")}>+ Chimney</button>
        <button onClick={() => onAddHouseDecoration(o.id, "any")}>+ Any</button>
      </div>
      <PalettePicker
        pack={pack}
        label="Wall"
        role="building/house_wall"
        currentHash={h.wall ?? hb?.wall?.hash}
        hasOverride={!!h.wall}
        onPick={(hash) => onSetHouseSlot(o.id, "wall", hash)}
        onAuto={() => onSetHouseSlot(o.id, "wall", null)}
      />
      <PalettePicker
        pack={pack}
        label="Roof"
        role="building/house_roof"
        currentHash={h.roof ?? hb?.roof?.hash}
        hasOverride={!!h.roof}
        onPick={(hash) => onSetHouseSlot(o.id, "roof", hash)}
        onAuto={() => onSetHouseSlot(o.id, "roof", null)}
      />
      {h.decorations.length === 0 ? (
        <div className="prop-empty">No decorations</div>
      ) : h.decorations.map((deco, index) => (
        <DecorationEditor
          key={`${deco.kind}-${index}`}
          o={o}
          pack={pack}
          index={index}
          currentHash={deco.palette ?? hb?.deco[index]?.hash}
          onSetHouseSlot={onSetHouseSlot}
          onRemoveHouseDecoration={onRemoveHouseDecoration}
        />
      ))}
    </>
  );
}

function ObjectBody({ o, pack, bindings, onSetVisible, onToggleLock, onRename, onSetObjectType, onSetPalette, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: {
  o: LiteObject;
  pack: PackRuntime | null;
  bindings: Bindings | null;
  onSetVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onRename: (id: number, name: string) => void;
  onSetObjectType: (id: number, type: LiteType) => void;
  onSetPalette: (id: number, hash: string | null) => void;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
  onAddHouseDecoration: (id: number, kind: HouseDecorationKind, palette?: string) => void;
  onRemoveHouseDecoration: (id: number, index: number) => void;
  onGenerateHouseDecorations: (id: number) => void;
}) {
  const shown = displayName(o);
  const rgb = colorForRole(roleOf(o));
  const merged = Number(o.tags["web.merged"] ?? "1");
  const style = o.tags["blueprint.style"];
  const label = o.tags["blueprint.label"];

  const commit = (v: string) => { const t = v.trim(); if (t !== shown) onRename(o.id, t); };

  // effective bound palette: manual override wins, else the compiled binding
  const b = bindings?.get(o.id);
  const boundHash = !b ? undefined
    : b.kind === "frg" ? b.variants[0]?.hash
    : b.kind === "house" ? b.wall?.hash
    : b.palette.hash;
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

      {/* palette: house slots, or single-object override */}
      {pack && (o.type === "HOUSE" && o.house
        ? <HouseSlots
            o={o}
            pack={pack}
            bindings={bindings}
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
          />
        : <PalettePicker
            pack={pack} label="Palette" role={roleOf(o)} currentHash={currentHash} hasOverride={!!o.tags["web.palette"]}
            onPick={(h) => onSetPalette(o.id, h)} onAuto={() => onSetPalette(o.id, null)} />
      )}

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

export function PropsPanel({ layer, objects, pack, bindings, onToggleLayerVisible, onSetObjectsVisible, onToggleLock, onRename, onSetObjectType, onSetPalette, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: PropsPanelProps) {
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
            {layer.tags["role.root"] && <Row label="Role"><span className="prop-badge">{layer.tags["role.root"]}</span></Row>}
            {layer.tags["role.object_type"] && <Row label="Family"><span className="prop-badge">{layer.tags["role.object_type"]}</span></Row>}
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
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
          />
        ) : null}
      </section>
    </aside>
  );
}
