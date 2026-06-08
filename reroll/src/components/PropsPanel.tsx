// PropsPanel — the right sidebar. Two stacked sections aligned with desktop's
// Layer Attrs + Object Attrs (layer_attrs.cpp / object_attrs.cpp), drastically
// simplified to what the web lite model actually carries: no palette / z-index /
// blueprint-root / custom-params (the model has none of those). Most fields are
// read-only inspection; editable = layer Visible, object Visible / Lock / name.

import { displayName, isLocked, roleOf, type Layer, type LiteObject } from "../model";
import { colorForRole, rgbaCss } from "../generated/roleColors";

// Friendly object-type names (the engine TYPE → a word a map-maker reads).
const TYPE_LABEL: Record<LiteObject["type"], string> = {
  TERRAIN_2_CORNER: "Terrain",
  TERRAIN_2_EDGE: "Path",
  FIXED_RECT_GROUP: "Group",
  FIXED_RECT: "Rect",
  DUNGEON: "Dungeon",
};

export interface PropsPanelProps {
  layer: Layer | null;
  /** selected objects, primary first ([...selected] order) */
  objects: LiteObject[];
  onToggleLayerVisible: () => void;
  onSetObjectsVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onRename: (id: number, name: string) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-val">{children}</span>
    </div>
  );
}

function ObjectBody({ o, onSetVisible, onToggleLock, onRename }: {
  o: LiteObject;
  onSetVisible: (visible: boolean) => void;
  onToggleLock: () => void;
  onRename: (id: number, name: string) => void;
}) {
  const shown = displayName(o);
  const rgb = colorForRole(roleOf(o));
  const merged = Number(o.tags["web.merged"] ?? "1");
  const style = o.tags["blueprint.style"];
  const label = o.tags["blueprint.label"];

  // Rename web.name on Enter/blur, but only when the text actually changed from
  // what was shown (avoids writing the role/label fallback into web.name).
  const commit = (v: string) => { const t = v.trim(); if (t !== shown) onRename(o.id, t); };

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

export function PropsPanel({ layer, objects, onToggleLayerVisible, onSetObjectsVisible, onToggleLock, onRename }: PropsPanelProps) {
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
          <ObjectBody key={primary.id} o={primary} onSetVisible={onSetObjectsVisible} onToggleLock={onToggleLock} onRename={onRename} />
        ) : null}
      </section>
    </aside>
  );
}
