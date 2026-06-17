// PropsPanel — the right sidebar. Layer + Object inspection, plus palette
// selection via a shared modal picker backed by the loaded pack.

import { useCallback, useMemo, useState } from "react";
import { DECO_ROLES, displayName, isLocked, roleOf, type Layer, type LiteObject, type LiteType } from "../model";
import { colorForRole, rgbaCss } from "../generated/roleColors";
import type { Palette, PackRuntime } from "../pack/types";
import type { Bindings } from "../pack/compile";
import { PalettePickerModal, type PalettePickerRequest } from "./PalettePickerModal";
import { PaletteSwatch } from "./PaletteSwatch";

// Friendly object-type names (the engine TYPE → a word a map-maker reads).
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
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-val">{children}</span>
    </div>
  );
}

function paletteSummary(p: Palette | null): string {
  if (!p) return "Auto";
  return p.style ? `${p.role} · ${p.style}` : p.role;
}

function PaletteField({
  pack,
  label,
  current,
  hasOverride,
  onChange,
  onAuto,
}: {
  pack: PackRuntime;
  label: string;
  current: Palette | null;
  hasOverride: boolean;
  onChange: () => void;
  onAuto: () => void;
}) {
  return (
    <div className="pal-field">
      <div className="pal-picker-head">
        <span className="prop-label">{label}</span>
        <button className="pal-auto" onClick={onChange}>Change...</button>
        <button className="pal-auto" disabled={!hasOverride} onClick={onAuto} title="恢复按 role 自动选">Auto</button>
      </div>
      <div className="pal-current">
        {current ? <PaletteSwatch pack={pack} palette={current} px={36} /> : <div className="pal-placeholder">Auto</div>}
        <span className="pal-current-text" title={paletteSummary(current)}>{paletteSummary(current)}</span>
      </div>
    </div>
  );
}

// House inspector: wall-height/overlap steppers + per-slot palette controls.
function HouseSlots({ o, pack, bindings, paletteByHash, onOpenPalettePicker, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap }: {
  o: LiteObject; pack: PackRuntime; bindings: Bindings | null; paletteByHash: Map<string, Palette>;
  onOpenPalettePicker: (request: PalettePickerRequest) => void;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
}) {
  const h = o.house!;
  const b = bindings?.get(o.id);
  const hb = b && b.kind === "house" ? b : null;
  const maxWallH = Math.max(1, o.rect[3] - 1);
  const maxOverlap = Math.max(0, o.rect[3] - h.wallHeight);
  const pick = (hash?: string) => (hash ? paletteByHash.get(hash) ?? null : null);
  const slots: { label: string; role: string; key: "wall" | "roof" | number; currentHash?: string; current: Palette | null; over: boolean }[] = [
    { label: "Wall", role: "building/house_wall", key: "wall", currentHash: h.wall ?? hb?.wall?.hash, current: pick(h.wall) ?? hb?.wall ?? null, over: !!h.wall },
    { label: "Roof", role: "building/house_roof", key: "roof", currentHash: h.roof ?? hb?.roof?.hash, current: pick(h.roof) ?? hb?.roof ?? null, over: !!h.roof },
    ...["Door", "Window", "Chimney"].map((label, i) => ({
      label,
      role: DECO_ROLES[i],
      key: i,
      currentHash: h.deco[i].palette ?? hb?.deco[i]?.hash,
      current: pick(h.deco[i].palette) ?? hb?.deco[i] ?? null,
      over: !!h.deco[i].palette,
    })),
  ];
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
          className="prop-num" type="number" min={0} max={maxOverlap} value={Math.max(0, h.overlap)}
          onChange={(e) => onSetHouseOverlap(o.id, Math.max(0, Math.min(maxOverlap, parseInt(e.target.value, 10) || 0)))}
        />
      </Row>
      <div className="prop-hint">拖动门/窗在房子范围内移动</div>
      {slots.map((sl) => (
        <PaletteField
          key={sl.label} pack={pack} label={sl.label} hasOverride={sl.over}
          current={sl.current}
          onChange={() => onOpenPalettePicker({
            title: `Select ${sl.label} Palette`,
            role: sl.role,
            currentHash: sl.currentHash,
            hasOverride: sl.over,
            onPick: (hash) => onSetHouseSlot(o.id, sl.key, hash),
            onAuto: () => onSetHouseSlot(o.id, sl.key, null),
          })}
          onAuto={() => onSetHouseSlot(o.id, sl.key, null)}
        />
      ))}
    </>
  );
}

function ObjectBody({ o, pack, bindings, paletteByHash, onOpenPalettePicker, onSetVisible, onToggleLock, onRename, onSetObjectType, onSetPalette, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap }: {
  o: LiteObject;
  pack: PackRuntime | null;
  bindings: Bindings | null;
  paletteByHash: Map<string, Palette>;
  onOpenPalettePicker: (request: PalettePickerRequest) => void;
  onSetVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onRename: (id: number, name: string) => void;
  onSetObjectType: (id: number, type: LiteType) => void;
  onSetPalette: (id: number, hash: string | null) => void;
  onSetHouseSlot: (id: number, slot: "wall" | "roof" | number, hash: string | null) => void;
  onSetWallHeight: (id: number, height: number) => void;
  onSetHouseOverlap: (id: number, overlap: number) => void;
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
  const currentPalette = (o.tags["web.palette"] ? paletteByHash.get(o.tags["web.palette"]) : undefined)
    ?? (boundHash ? paletteByHash.get(boundHash) : undefined)
    ?? null;

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
            paletteByHash={paletteByHash}
            onOpenPalettePicker={onOpenPalettePicker}
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
          />
        : <PaletteField
            pack={pack}
            label="Palette"
            current={currentPalette}
            hasOverride={!!o.tags["web.palette"]}
            onChange={() => onOpenPalettePicker({
              title: "Select Palette",
              role: roleOf(o),
              currentHash,
              hasOverride: !!o.tags["web.palette"],
              onPick: (h) => onSetPalette(o.id, h),
              onAuto: () => onSetPalette(o.id, null),
            })}
            onAuto={() => onSetPalette(o.id, null)}
          />
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

export function PropsPanel({ layer, objects, pack, bindings, onToggleLayerVisible, onSetObjectsVisible, onToggleLock, onRename, onSetObjectType, onSetPalette, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap }: PropsPanelProps) {
  const primary = objects[0] ?? null;
  const allVisible = objects.length > 0 && objects.every((o) => o.enabled);
  const paletteByHash = useMemo(() => new Map((pack?.palettes ?? []).map((p) => [p.hash, p])), [pack]);
  const [picker, setPicker] = useState<PalettePickerRequest | null>(null);

  const onClosePicker = useCallback(() => setPicker(null), []);
  const onOpenPalettePicker = useCallback((request: PalettePickerRequest) => {
    setPicker({
      ...request,
      onPick: (hash) => { request.onPick(hash); setPicker(null); },
      onAuto: () => { request.onAuto(); setPicker(null); },
    });
  }, []);

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
            paletteByHash={paletteByHash}
            onOpenPalettePicker={onOpenPalettePicker}
            onSetVisible={onSetObjectsVisible}
            onToggleLock={onToggleLock}
            onRename={onRename}
            onSetObjectType={onSetObjectType}
            onSetPalette={onSetPalette}
            onSetHouseSlot={onSetHouseSlot}
            onSetWallHeight={onSetWallHeight}
            onSetHouseOverlap={onSetHouseOverlap}
          />
        ) : null}
      </section>
      <PalettePickerModal pack={pack} request={picker} onClose={onClosePicker} />
    </aside>
  );
}
