import { useMemo } from "react";
import type { ParsedBundle, PaletteEntry, PaletteTags } from "../types";
import type { RolePath } from "../roleTree";
import { Inspector } from "./Inspector";

interface Props {
  bundle: ParsedBundle;
  items: PaletteEntry[];
  active: number | null;
  onlyUntagged: boolean;
  setOnlyUntagged: (v: boolean) => void;
  onSelect: (index: number, mods: { additive: boolean; range: boolean }) => void;
  // Inspector passthrough
  selected: Set<number>;
  rolePaths: RolePath[];
  recentRoles: string[];
  onSetRole: (path: string) => void;
  applyToSelection: (indices: number[], patch: (cur: PaletteTags) => PaletteTags) => void;
}

// A big swatch cropped from the contact sheet, scaled up (nearest-neighbor) so
// the pixel art is legible on a phone.
function BigSwatch({ bundle, index }: { bundle: ParsedBundle; index: number }) {
  const g = bundle.manifest.grid;
  const sheetIdx = Math.floor(index / g.per_sheet);
  const li = index % g.per_sheet;
  const x = (li % g.cols) * g.cell_w + g.pad;
  const y = Math.floor(li / g.cols) * g.cell_h + g.pad;
  const url = bundle.sheetUrls[sheetIdx];
  const scale = Math.max(2, Math.round(220 / g.swatch));
  const px = g.swatch * scale;
  return (
    <div className="big-swatch" style={{ width: px, height: px }}>
      <div
        style={{
          width: g.swatch,
          height: g.swatch,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          imageRendering: "pixelated",
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundRepeat: "no-repeat",
          backgroundPosition: `-${x}px -${y}px`,
        }}
      />
    </div>
  );
}

export function MobileTagger(props: Props) {
  const { bundle, items, active, onlyUntagged, setOnlyUntagged, onSelect } = props;
  const pos = useMemo(() => items.findIndex((p) => p.index === active), [items, active]);
  const cur = pos >= 0 ? items[pos] : undefined;
  const tagged = useMemo(
    () => Object.values(bundle.tagData).filter((t) => t && (t.role || t.style.length)).length,
    [bundle],
  );
  const go = (delta: number) => {
    const n = Math.min(items.length - 1, Math.max(0, pos + delta));
    if (items[n]) onSelect(items[n].index, { additive: false, range: false });
  };

  return (
    <div className="mobile">
      <div className="m-bar">
        <button disabled={pos <= 0} onClick={() => go(-1)}>◀</button>
        <span className="m-prog">
          {cur ? `#${cur.index} · ${cur.mode}` : "—"} · {tagged}/{bundle.manifest.palettes.length}
        </span>
        <button disabled={pos < 0 || pos >= items.length - 1} onClick={() => go(1)}>▶</button>
        <label className="m-only">
          <input type="checkbox" checked={onlyUntagged} onChange={(e) => setOnlyUntagged(e.target.checked)} />
          未标
        </label>
      </div>

      {cur ? (
        <>
          <div className="m-swatch"><BigSwatch bundle={bundle} index={cur.index} /></div>
          <Inspector
            bundle={bundle}
            selected={props.selected}
            rolePaths={props.rolePaths}
            recentRoles={props.recentRoles}
            onSetRole={props.onSetRole}
            applyToSelection={props.applyToSelection}
          />
        </>
      ) : (
        <div className="muted" style={{ padding: 24 }}>没有可标注的 palette（试试关掉「未标」过滤）</div>
      )}
    </div>
  );
}
