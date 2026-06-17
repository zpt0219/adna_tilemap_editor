import { useEffect, useMemo, useState } from "react";
import { roleTreeDistance } from "../pack/compile";
import { PaletteMode, type PackRuntime } from "../pack/types";
import { PaletteSwatch } from "./PaletteSwatch";

export interface PalettePickerRequest {
  title: string;
  role: string;
  currentHash?: string;
  hasOverride: boolean;
  onPick: (hash: string) => void;
  onAuto: () => void;
}

export function PalettePickerModal({
  pack,
  request,
  onClose,
}: {
  pack: PackRuntime | null;
  request: PalettePickerRequest | null;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { setShowAll(false); }, [request?.title, request?.role]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  const ranked = useMemo(() => {
    if (!pack || !request) return [];
    const arr = pack.palettes.map((p) => ({ p, d: roleTreeDistance(request.role, p.role) }));
    const list = showAll ? arr : arr.filter((x) => x.d <= 2);
    list.sort((a, b) => a.d - b.d || a.p.role.localeCompare(b.p.role) || a.p.style.localeCompare(b.p.style));
    return list;
  }, [pack, request, showAll]);

  if (!pack || !request) return null;

  return (
    <div className="pal-modal-backdrop" onClick={onClose}>
      <div className="pal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pal-modal-head">
          <div>
            <div className="pal-modal-title">{request.title}</div>
            <div className="pal-modal-sub">{request.role || "未指定 role"}</div>
          </div>
          <button onClick={onClose} title="关闭">Close</button>
        </div>
        <div className="pal-picker-head pal-modal-toolbar">
          <button className="pal-auto" disabled={!request.hasOverride} onClick={request.onAuto} title="恢复按 role 自动选">Auto</button>
          <label className="pal-all"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 全部</label>
        </div>
        <div className="pal-grid pal-modal-grid">
          {ranked.map(({ p, d }) => (
            <button
              key={p.hash}
              className={`pal-cell pal-modal-cell${p.hash === request.currentHash ? " sel" : ""}`}
              title={`${p.role}${p.style ? " · " + p.style : ""} · ${PaletteMode[p.mode] ?? p.mode}${d > 0 ? ` · d${d}` : ""}`}
              onClick={() => request.onPick(p.hash)}
            >
              <PaletteSwatch pack={pack} palette={p} px={52} />
              <span className="pal-cell-meta">{p.role.split("/").pop() || p.role}</span>
            </button>
          ))}
          {ranked.length === 0 && <span className="prop-empty">无同类 palette（勾「全部」看所有）</span>}
        </div>
      </div>
    </div>
  );
}
