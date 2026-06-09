import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedBundle, PaletteEntry, PaletteTags, TagsFile } from "./types";
import { buildFinalTags, downloadText, parseBundle, tagsFileToData } from "./bundle";
import { flattenTree } from "./roleTree";
import { Gallery } from "./components/Gallery";
import { Inspector } from "./components/Inspector";

const draftKey = (set: string) => `adna_tagger_draft_${set}`;
const RECENT_CAP = 8;

const isTagged = (t: PaletteTags | undefined): boolean => !!t && (!!t.role || t.style.length > 0);

export default function App() {
  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // active = the keyboard cursor / primary selection (for arrow nav + scroll-into-view)
  const [active, setActive] = useState<number | null>(null);
  // anchor for Shift range-select (the last plainly-picked index)
  const [anchor, setAnchor] = useState<number | null>(null);
  // gallery filter (lifted here so keyboard nav / range / select-all see the visible list)
  const [q, setQ] = useState("");
  const [onlyUntagged, setOnlyUntagged] = useState(false);
  // recently-applied roles (most recent first) — quick re-apply row in the Inspector
  const [recentRoles, setRecentRoles] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const fileInput = useRef<HTMLInputElement>(null);
  const tagsInput = useRef<HTMLInputElement>(null);

  const rolePaths = useMemo(() => flattenTree(bundle?.tree ?? null), [bundle]);

  // the visible (filtered) palette list — drives the gallery AND keyboard/range/select-all
  const items = useMemo<PaletteEntry[]>(() => {
    if (!bundle) return [];
    const query = q.trim().toLowerCase();
    return bundle.manifest.palettes.filter((p) => {
      const t = bundle.tagData[p.index];
      if (onlyUntagged && isTagged(t)) return false;
      if (!query) return true;
      const hay = `${p.index} ${p.mode} ${t?.role ?? ""} ${(t?.style ?? []).join(" ")}`.toLowerCase();
      return hay.includes(query);
    });
  }, [bundle, q, onlyUntagged]);

  // ---- load a bundle ----
  const loadBundleFile = useCallback(async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseBundle(file.name, buf);
      const draftRaw = localStorage.getItem(draftKey(parsed.manifest.palette_set));
      if (draftRaw) {
        try {
          const draft = JSON.parse(draftRaw) as Record<number, PaletteTags>;
          if (confirm("发现该 palette 集合上次未导出的本地草稿，是否恢复？")) parsed.tagData = draft;
        } catch { /* ignore bad draft */ }
      }
      setBundle(parsed);
      setSelected(new Set());
      setActive(parsed.manifest.palettes[0]?.index ?? null);
      setAnchor(null);
      setError("");
    } catch (e) {
      setError(`加载失败: ${(e as Error).message}`);
    }
  }, []);

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample/my_retro_clean.adnatags`);
      if (!res.ok) throw new Error(`sample 不可用 (${res.status})`);
      const parsed = parseBundle("my_retro_clean.adnatags (sample)", await res.arrayBuffer());
      setBundle(parsed);
      setSelected(new Set());
      setActive(parsed.manifest.palettes[0]?.index ?? null);
      setAnchor(null);
      setError("");
    } catch (e) {
      setError(`样例加载失败: ${(e as Error).message}`);
    }
  }, []);

  // ---- drag & drop anywhere ----
  useEffect(() => {
    const onDrop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) void loadBundleFile(f); };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => { window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onDragOver); };
  }, [loadBundleFile]);

  // ---- autosave draft to localStorage ----
  useEffect(() => {
    if (!bundle) return;
    localStorage.setItem(draftKey(bundle.manifest.palette_set), JSON.stringify(bundle.tagData));
  }, [bundle]);

  // ---- mutate tags for a set of palette indices ----
  const applyToSelection = useCallback(
    (indices: number[], patch: (cur: PaletteTags) => PaletteTags) => {
      setBundle((b) => {
        if (!b) return b;
        const tagData = { ...b.tagData };
        for (const i of indices) {
          const cur = tagData[i] ?? { role: "", style: [], status: "empty" as const };
          tagData[i] = patch(cur);
        }
        return { ...b, tagData };
      });
    },
    [],
  );

  // ---- selection: plain = single, ctrl/meta = toggle, shift = range over visible order ----
  const onSelect = useCallback((index: number, mods: { additive: boolean; range: boolean }) => {
    if (mods.range && anchor != null) {
      const a = items.findIndex((p) => p.index === anchor);
      const b = items.findIndex((p) => p.index === index);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelected(new Set(items.slice(lo, hi + 1).map((p) => p.index)));
        setActive(index);
        return; // keep anchor so the range can grow/shrink
      }
    }
    if (mods.additive) {
      setSelected((prev) => { const n = new Set(prev); if (n.has(index)) n.delete(index); else n.add(index); return n; });
    } else {
      setSelected(new Set([index]));
    }
    setActive(index);
    setAnchor(index);
  }, [items, anchor]);

  const selectAllFiltered = useCallback(() => {
    setSelected(new Set(items.map((p) => p.index)));
    if (items.length) { setActive(items[0].index); setAnchor(items[0].index); }
  }, [items]);

  // next untagged after `fromIndex` in visible order (wraps); null if none left
  const nextUntagged = useCallback((fromIndex: number): number | null => {
    if (!bundle) return null;
    const pos = items.findIndex((p) => p.index === fromIndex);
    const order = [...items.slice(pos + 1), ...items.slice(0, pos + 1)];
    for (const p of order) if (!isTagged(bundle.tagData[p.index])) return p.index;
    return null;
  }, [bundle, items]);

  // ---- set role on the selection; record recent; auto-advance to next untagged (single) ----
  const onSetRole = useCallback((path: string) => {
    const indices = [...selected];
    if (indices.length === 0) return;
    applyToSelection(indices, (cur) => ({ ...cur, role: path, status: "human_verified" }));
    setRecentRoles((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, RECENT_CAP));
    if (indices.length === 1) {
      const nxt = nextUntagged(indices[0]);
      if (nxt != null) { setSelected(new Set([nxt])); setActive(nxt); setAnchor(nxt); }
    }
  }, [selected, applyToSelection, nextUntagged]);

  // ---- load an external tags file, merge onto current doc ----
  const onLoadTagsFile = useCallback(async (file: File) => {
    if (!bundle) return;
    try {
      const tf = JSON.parse(await file.text()) as TagsFile;
      const incoming = tagsFileToData(tf, "ai_suggested");
      setBundle((b) => (b ? { ...b, tagData: { ...b.tagData, ...incoming } } : b));
      setError("");
    } catch (e) {
      setError(`tag 文件解析失败: ${(e as Error).message}`);
    }
  }, [bundle]);

  const onExport = useCallback(() => {
    if (!bundle) return;
    downloadText("final_tags.json", buildFinalTags(bundle.manifest.palette_set, bundle.tagData));
  }, [bundle]);

  // ---- keyboard navigation over the visible grid ----
  useEffect(() => {
    if (!bundle) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      if (items.length === 0) return;
      e.preventDefault();
      // columns = number of cells sharing the first row's offsetTop (responsive grid)
      const grid = document.querySelector(".grid");
      let cols = 1;
      if (grid && grid.children.length > 1) {
        const top0 = (grid.children[0] as HTMLElement).offsetTop;
        for (let i = 1; i < grid.children.length; i++) {
          if ((grid.children[i] as HTMLElement).offsetTop === top0) cols++; else break;
        }
      }
      const pos = Math.max(0, items.findIndex((p) => p.index === active));
      const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -cols : cols;
      const next = Math.min(items.length - 1, Math.max(0, pos + delta));
      const idx = items[next].index;
      setSelected(new Set([idx]));
      setActive(idx);
      setAnchor(idx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bundle, items, active]);

  const stats = useMemo(() => {
    if (!bundle) return { total: 0, tagged: 0 };
    const total = bundle.manifest.palettes.length;
    const tagged = Object.values(bundle.tagData).filter(isTagged).length;
    return { total, tagged };
  }, [bundle]);

  return (
    <div className="app">
      <header className="topbar">
        <strong>Adna Web Asset Tagger</strong>
        <button onClick={() => fileInput.current?.click()}>打开 .adnatags…</button>
        <input ref={fileInput} type="file" accept=".adnatags,.zip" hidden
          onChange={(e) => e.target.files?.[0] && loadBundleFile(e.target.files[0])} />
        <button disabled={!bundle} onClick={() => tagsInput.current?.click()}>Load tags…</button>
        <input ref={tagsInput} type="file" accept=".json" hidden
          onChange={(e) => e.target.files?.[0] && onLoadTagsFile(e.target.files[0])} />
        <span className="spacer" />
        {bundle && <span className="stat">{bundle.name} · {stats.tagged}/{stats.total} tagged</span>}
        <button disabled={!bundle} onClick={onExport}>导出 final_tags.json</button>
      </header>

      {error && <div className="error">{error}</div>}

      {!bundle ? (
        <div className="dropzone">
          <div>把 <code>.adnatags</code> 拖到这里，或点「打开 .adnatags…」</div>
          <button onClick={loadSample}>试用样例</button>
        </div>
      ) : (
        <div className="main">
          <Gallery
            bundle={bundle}
            items={items}
            selected={selected}
            active={active}
            q={q}
            onlyUntagged={onlyUntagged}
            setQ={setQ}
            setOnlyUntagged={setOnlyUntagged}
            onSelect={onSelect}
            onSelectAllFiltered={selectAllFiltered}
          />
          <Inspector
            bundle={bundle}
            selected={selected}
            rolePaths={rolePaths}
            recentRoles={recentRoles}
            onSetRole={onSetRole}
            applyToSelection={applyToSelection}
          />
        </div>
      )}
    </div>
  );
}
