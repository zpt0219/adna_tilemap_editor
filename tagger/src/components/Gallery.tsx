import { useEffect, useRef } from "react";
import type { ParsedBundle, PaletteEntry, PaletteTags } from "../types";

interface Props {
  bundle: ParsedBundle;
  items: PaletteEntry[];
  selected: Set<number>;
  active: number | null;
  q: string;
  onlyUntagged: boolean;
  setQ: (v: string) => void;
  setOnlyUntagged: (v: boolean) => void;
  onSelect: (index: number, mods: { additive: boolean; range: boolean }) => void;
  onSelectAllFiltered: () => void;
}

function statusOf(t: PaletteTags | undefined): PaletteTags["status"] {
  if (!t || (!t.role && t.style.length === 0)) return "empty";
  return t.status === "human_verified" ? "human_verified" : "ai_suggested";
}

// Crops palette `index`'s swatch out of its contact sheet via background-position.
function Swatch({ bundle, index }: { bundle: ParsedBundle; index: number }) {
  const g = bundle.manifest.grid;
  const sheetIdx = Math.floor(index / g.per_sheet);
  const li = index % g.per_sheet;
  const x = (li % g.cols) * g.cell_w + g.pad;
  const y = Math.floor(li / g.cols) * g.cell_h + g.pad;
  const url = bundle.sheetUrls[sheetIdx];
  return (
    <div
      className="swatch"
      style={{
        width: g.swatch,
        height: g.swatch,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundPosition: `-${x}px -${y}px`,
      }}
    />
  );
}

export function Gallery({ bundle, items, selected, active, q, onlyUntagged, setQ, setOnlyUntagged, onSelect, onSelectAllFiltered }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);

  // keep the keyboard cursor in view
  useEffect(() => {
    if (active == null || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="gallery">
      <div className="gallery-bar">
        <input
          placeholder="搜索 index / mode / role / style…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label>
          <input type="checkbox" checked={onlyUntagged} onChange={(e) => setOnlyUntagged(e.target.checked)} />
          只看未标注
        </label>
        <button disabled={items.length === 0} onClick={onSelectAllFiltered} title="选中当前筛选出的全部，便于批量套 role">
          全选筛选 ({items.length})
        </button>
        <span className="muted">方向键移动 · Shift 范围选 · Ctrl/Cmd 加选</span>
      </div>
      <div className="grid" ref={gridRef}>
        {items.map((p) => {
          const t = bundle.tagData[p.index];
          const st = statusOf(t);
          return (
            <div
              key={p.index}
              data-index={p.index}
              className={`cell ${st}${selected.has(p.index) ? " sel" : ""}${active === p.index ? " active" : ""}`}
              onClick={(e) => onSelect(p.index, { additive: e.metaKey || e.ctrlKey, range: e.shiftKey })}
              title={`#${p.index} · ${p.mode}${t?.role ? ` · ${t.role}` : ""}`}
            >
              <Swatch bundle={bundle} index={p.index} />
              <div className="cell-meta">
                <span className="idx">{p.index}</span>
                {t?.role && <span className="role">{t.role.split("/").pop()}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
