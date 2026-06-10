import { useEffect, useMemo, useRef, useState } from "react";
import type { ParsedBundle, PaletteEntry, PaletteTags } from "../types";

interface Props {
  bundle: ParsedBundle;
  items: PaletteEntry[];
  selected: Set<number>;
  active: number | null;
  q: string;
  onlyUntagged: boolean;
  onlyCoarse: boolean;
  roleFilter: string;
  styleFilter: Set<string>;
  setQ: (v: string) => void;
  setOnlyUntagged: (v: boolean) => void;
  setOnlyCoarse: (v: boolean) => void;
  setRoleFilter: (v: string) => void;
  setStyleFilter: (updater: (prev: Set<string>) => Set<string>) => void;
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

export function Gallery({ bundle, items, selected, active, q, onlyUntagged, onlyCoarse, roleFilter, styleFilter, setQ, setOnlyUntagged, setOnlyCoarse, setRoleFilter, setStyleFilter, onSelect, onSelectAllFiltered }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [styleOpen, setStyleOpen] = useState(false);

  // distinct roles / styles actually present in the bundle, for the filters
  const { roleOptions, styleOptions } = useMemo(() => {
    const roles = new Set<string>(), styles = new Set<string>();
    for (const p of bundle.manifest.palettes) {
      const t = bundle.tagData[p.index];
      if (t?.role) roles.add(t.role);
      for (const s of t?.style ?? []) styles.add(s);
    }
    return {
      roleOptions: [...roles].sort(),
      styleOptions: [...styles].sort((a, b) => a.localeCompare(b)),
    };
  }, [bundle]);

  const toggleStyle = (s: string) =>
    setStyleFilter((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

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
        <select className="role-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} title="按 role 过滤">
          <option value="">全部 role ({roleOptions.length})</option>
          {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button
          className={`flt-btn${styleFilter.size ? " on" : ""}`}
          onClick={() => setStyleOpen((o) => !o)}
          title="按 style 过滤"
        >
          style{styleFilter.size ? ` (${styleFilter.size})` : ""} {styleOpen ? "▲" : "▼"}
        </button>
        <label>
          <input type="checkbox" checked={onlyUntagged} onChange={(e) => setOnlyUntagged(e.target.checked)} />
          只看未标注
        </label>
        <label title="role 落在父级/内部节点(非叶子),即还没细分到底">
          <input type="checkbox" checked={onlyCoarse} onChange={(e) => setOnlyCoarse(e.target.checked)} />
          只看非叶 role
        </label>
        <button disabled={items.length === 0} onClick={onSelectAllFiltered} title="选中当前筛选出的全部，便于批量套 role">
          全选筛选 ({items.length})
        </button>
        <span className="muted">方向键移动 · Shift 范围选 · Ctrl/Cmd 加选</span>
      </div>

      {styleOpen && (
        <div className="style-filter">
          {styleOptions.length === 0 && <span className="muted">该 bundle 还没有任何 style</span>}
          {styleOptions.map((s) => (
            <button
              key={s}
              className={`chip${styleFilter.has(s) ? " on" : ""}`}
              onClick={() => toggleStyle(s)}
            >
              {s}
            </button>
          ))}
          {styleFilter.size > 0 && (
            <button className="chip clear" onClick={() => setStyleFilter(() => new Set())}>清空</button>
          )}
        </div>
      )}
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
