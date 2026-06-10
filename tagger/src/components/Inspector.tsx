import { useMemo, useState } from "react";
import type { ParsedBundle, PaletteTags } from "../types";
import type { RolePath } from "../roleTree";

interface Props {
  bundle: ParsedBundle;
  selected: Set<number>;
  rolePaths: RolePath[];
  recentRoles: string[];
  onSetRole: (path: string) => void;
  applyToSelection: (indices: number[], patch: (cur: PaletteTags) => PaletteTags) => void;
}

export function Inspector({ bundle, selected, rolePaths, recentRoles, onSetRole, applyToSelection }: Props) {
  const [roleFilter, setRoleFilter] = useState("");
  const [styleDraft, setStyleDraft] = useState("");

  const indices = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const single = indices.length === 1 ? indices[0] : -1;

  const tagsOf = (i: number): PaletteTags =>
    bundle.tagData[i] ?? { role: "", style: [], status: "empty" };

  const commonRole = useMemo(() => {
    if (indices.length === 0) return "";
    const r = tagsOf(indices[0]).role;
    return indices.every((i) => tagsOf(i).role === r) ? r : " mixed";
  }, [indices, bundle]);

  const styleUnion = useMemo(() => {
    const s = new Set<string>();
    for (const i of indices) for (const t of tagsOf(i).style) s.add(t);
    return [...s];
  }, [indices, bundle]);

  const usedStyles = useMemo(() => {
    const s = new Set<string>();
    for (const t of Object.values(bundle.tagData)) for (const x of t.style) s.add(x);
    return [...s].sort();
  }, [bundle]);

  const filteredRoles = useMemo(() => {
    const query = roleFilter.trim().toLowerCase();
    if (!query) return rolePaths;
    return rolePaths.filter((r) => r.path.toLowerCase().includes(query) || r.label.toLowerCase().includes(query));
  }, [rolePaths, roleFilter]);

  if (indices.length === 0) {
    return <aside className="inspector"><p className="muted">点选左侧 palette（方向键移动 · Shift 范围 · Ctrl/Cmd 加选）</p></aside>;
  }

  const addStyle = (tag: string) => {
    const t = tag.trim();
    if (!t) return;
    applyToSelection(indices, (cur) =>
      cur.style.includes(t) ? cur : { ...cur, style: [...cur.style, t], status: "human_verified" },
    );
  };
  const removeStyle = (tag: string) =>
    applyToSelection(indices, (cur) => ({ ...cur, style: cur.style.filter((x) => x !== tag), status: "human_verified" }));
  const clearTags = () =>
    applyToSelection(indices, () => ({ role: "", style: [], status: "empty" }));

  const meta = single >= 0 ? bundle.manifest.palettes.find((p) => p.index === single) : undefined;

  return (
    <aside className="inspector">
      <div className="insp-head">
        {single >= 0 ? (
          <>
            <strong>#{single}</strong> · {meta?.mode}
            <div className="muted small">hash {meta?.hash}</div>
          </>
        ) : (
          <strong>{indices.length} 个选中（批量）</strong>
        )}
        <button className="link" onClick={clearTags}>清空标注</button>
      </div>

      <section>
        <div className="lbl">Role（闭集树，单选）</div>
        <div className="cur-role">
          {commonRole === " mixed" ? <em className="muted">（多个不同）</em>
            : commonRole ? <code>{commonRole}</code> : <span className="muted">未设置</span>}
        </div>
        {recentRoles.length > 0 && (
          <div className="recent">
            <span className="muted small">最近：</span>
            {recentRoles.map((p) => (
              <button key={p} className="recent-role" title={p} onClick={() => onSetRole(p)}>
                {p.split("/").pop()}
              </button>
            ))}
          </div>
        )}
        <input
          className="role-filter"
          placeholder="过滤 role…"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        />
        <div className="role-list">
          {filteredRoles.map((r) => (
            <button
              key={r.path}
              className={`role-row d${Math.min(r.depth, 3)} ${commonRole === r.path ? "active" : ""}`}
              onClick={() => onSetRole(r.path)}
              title={`${r.label} · ${r.objectType}${r.stratum ? ` · ${r.stratum}` : ""}`}
            >
              <span className="rp">
                {r.path}
                {r.stratum && (
                  <span className={`strat ${r.stratum}`} title={r.stratum}>
                    {r.stratum === "ground" ? "地" : r.stratum === "vertical" ? "立" : r.stratum}
                  </span>
                )}
              </span>
              <span className="ot">{r.objectType}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="lbl">Style（自由多值，预制 + 自定义）</div>
        <div className="chips">
          {styleUnion.map((s) => (
            <span key={s} className="chip" onClick={() => removeStyle(s)} title="点击移除">{s} ×</span>
          ))}
          {styleUnion.length === 0 && <span className="muted small">无</span>}
        </div>
        <input
          placeholder="输入 style 回车添加…"
          value={styleDraft}
          onChange={(e) => setStyleDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { addStyle(styleDraft); setStyleDraft(""); } }}
        />
        {usedStyles.length > 0 && (
          <div className="presets">
            {usedStyles.map((s) => (
              <button key={s} className="preset" onClick={() => addStyle(s)}>+ {s}</button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
