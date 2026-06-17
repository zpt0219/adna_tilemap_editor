// PropsPanel — the right sidebar. Layer + Object inspection, plus palette
// selection via a shared modal picker backed by the loaded pack.

import { useCallback, useMemo, useState } from "react";
import { displayName, isLocked, roleOf, type HouseDecorationKind, type Layer, type LiteObject, type LiteType } from "../model";
import { colorForRole, rgbaCss } from "../generated/roleColors";
import type { Palette, PackRuntime } from "../pack/types";
import type { Bindings } from "../pack/compile";
import { decorationRole } from "../house";
import { PalettePickerModal, type PaletteAssignRequest } from "./PalettePickerModal";
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
  actionLabel = "Change...",
}: {
  pack: PackRuntime;
  label: string;
  current: Palette | null;
  hasOverride: boolean;
  onChange: () => void;
  onAuto: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="pal-field">
      <div className="pal-picker-head">
        <span className="prop-label">{label}</span>
        <button className="pal-auto" onClick={onChange}>{actionLabel}</button>
        <button className="pal-auto" disabled={!hasOverride} onClick={onAuto} title="恢复按 role 自动选">Auto</button>
      </div>
      <div className="pal-current">
        {current ? <PaletteSwatch pack={pack} palette={current} px={36} /> : <div className="pal-placeholder">Auto</div>}
        <span className="pal-current-text" title={paletteSummary(current)}>{paletteSummary(current)}</span>
      </div>
    </div>
  );
}

function DecorationEditor({
  o,
  pack,
  index,
  current,
  currentHash,
  onOpenPalettePicker,
  onSetHouseSlot,
  onRemoveHouseDecoration,
}: {
  o: LiteObject;
  pack: PackRuntime;
  index: number;
  current: Palette | null;
  currentHash: string | undefined;
  onOpenPalettePicker: (request: PaletteAssignRequest) => void;
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
      <PaletteField
        pack={pack}
        label="Palette"
        current={current}
        hasOverride={!!deco.palette}
        onChange={() => onOpenPalettePicker({
          title: `Select ${label} Palette`,
          role: decorationRole(deco.kind),
          currentHash,
          hasOverride: !!deco.palette,
          onPick: (hash) => onSetHouseSlot(o.id, index, hash),
          onAuto: () => onSetHouseSlot(o.id, index, null),
        })}
        onAuto={() => onSetHouseSlot(o.id, index, null)}
      />
    </div>
  );
}

function HouseSlots({ o, pack, bindings, paletteByHash, onOpenPalettePicker, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: {
  o: LiteObject;
  pack: PackRuntime;
  bindings: Bindings | null;
  paletteByHash: Map<string, Palette>;
  onOpenPalettePicker: (request: PaletteAssignRequest) => void;
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
  const pick = (hash?: string) => (hash ? paletteByHash.get(hash) ?? null : null);
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
      <PaletteField
        pack={pack}
        label="Wall"
        current={pick(h.wall) ?? hb?.wall ?? null}
        hasOverride={!!h.wall}
        onChange={() => onOpenPalettePicker({
          title: "Select Wall Palette",
          role: "building/house_wall",
          currentHash: h.wall ?? hb?.wall?.hash,
          hasOverride: !!h.wall,
          onPick: (hash) => onSetHouseSlot(o.id, "wall", hash),
          onAuto: () => onSetHouseSlot(o.id, "wall", null),
        })}
        onAuto={() => onSetHouseSlot(o.id, "wall", null)}
      />
      <PaletteField
        pack={pack}
        label="Roof"
        current={pick(h.roof) ?? hb?.roof ?? null}
        hasOverride={!!h.roof}
        onChange={() => onOpenPalettePicker({
          title: "Select Roof Palette",
          role: "building/house_roof",
          currentHash: h.roof ?? hb?.roof?.hash,
          hasOverride: !!h.roof,
          onPick: (hash) => onSetHouseSlot(o.id, "roof", hash),
          onAuto: () => onSetHouseSlot(o.id, "roof", null),
        })}
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
          current={pick(deco.palette) ?? hb?.deco[index] ?? null}
          currentHash={deco.palette ?? hb?.deco[index]?.hash}
          onOpenPalettePicker={onOpenPalettePicker}
          onSetHouseSlot={onSetHouseSlot}
          onRemoveHouseDecoration={onRemoveHouseDecoration}
        />
      ))}
    </>
  );
}

function ObjectBody({ o, pack, bindings, paletteByHash, onOpenPalettePicker, onSetVisible, onToggleLock, onRename, onSetObjectType, onSetPalette, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: {
  o: LiteObject;
  pack: PackRuntime | null;
  bindings: Bindings | null;
  paletteByHash: Map<string, Palette>;
  onOpenPalettePicker: (request: PaletteAssignRequest) => void;
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
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
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

export function PropsPanel({ layer, objects, pack, bindings, onToggleLayerVisible, onSetObjectsVisible, onToggleLock, onRename, onSetObjectType, onSetPalette, onSetHouseSlot, onSetWallHeight, onSetHouseOverlap, onAddHouseDecoration, onRemoveHouseDecoration, onGenerateHouseDecorations }: PropsPanelProps) {
  const primary = objects[0] ?? null;
  const allVisible = objects.length > 0 && objects.every((o) => o.enabled);
  const paletteByHash = useMemo(() => new Map((pack?.palettes ?? []).map((p) => [p.hash, p])), [pack]);
  const [picker, setPicker] = useState<PaletteAssignRequest | null>(null);

  const onClosePicker = useCallback(() => setPicker(null), []);
  const onOpenPalettePicker = useCallback((request: PaletteAssignRequest) => {
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
            onAddHouseDecoration={onAddHouseDecoration}
            onRemoveHouseDecoration={onRemoveHouseDecoration}
            onGenerateHouseDecorations={onGenerateHouseDecorations}
          />
        ) : null}
      </section>
      <PalettePickerModal pack={pack} request={picker} onClose={onClosePicker} />
    </aside>
  );
}
