import { useMemo, useState } from "react";
import type { ParsedBundle, PaletteTags } from "../types";

interface Props {
  bundle: ParsedBundle;
  selected: Set<number>;
  onSelect: (index: number, additive: boolean) => void;
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
  const col = li % g.cols;
  const row = Math.floor(li / g.cols);
  const x = col * g.cell_w + g.pad;
  const y = row * g.cell_h + g.pad;
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

export function Gallery({ bundle, selected, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [onlyUntagged, setOnlyUntagged] = useState(false);

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    return bundle.manifest.palettes.filter((p) => {
      const t = bundle.tagData[p.index];
      if (onlyUntagged && t && (t.role || t.style.length)) return false;
      if (!query) return true;
      const hay = `${p.index} ${p.mode} ${t?.role ?? ""} ${(t?.style ?? []).join(" ")}`.toLowerCase();
      return hay.includes(query);
    });
  }, [bundle, q, onlyUntagged]);

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
        <span className="muted">{items.length} 项</span>
      </div>
      <div className="grid">
        {items.map((p) => {
          const t = bundle.tagData[p.index];
          const st = statusOf(t);
          return (
            <div
              key={p.index}
              className={`cell ${st} ${selected.has(p.index) ? "sel" : ""}`}
              onClick={(e) => onSelect(p.index, e.metaKey || e.ctrlKey || e.shiftKey)}
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
