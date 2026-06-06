import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedBundle, PaletteTags, TagsFile } from "./types";
import { buildFinalTags, downloadText, parseBundle, tagsFileToData } from "./bundle";
import { flattenTree } from "./roleTree";
import { Gallery } from "./components/Gallery";
import { Inspector } from "./components/Inspector";

const draftKey = (set: string) => `adna_tagger_draft_${set}`;

export default function App() {
  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>("");
  const fileInput = useRef<HTMLInputElement>(null);
  const tagsInput = useRef<HTMLInputElement>(null);

  const rolePaths = useMemo(() => flattenTree(bundle?.tree ?? null), [bundle]);

  // ---- load a bundle ----
  const loadBundleFile = useCallback(async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseBundle(file.name, buf);
      // restore a local draft for this palette set if present
      const draftRaw = localStorage.getItem(draftKey(parsed.manifest.palette_set));
      if (draftRaw) {
        try {
          const draft = JSON.parse(draftRaw) as Record<number, PaletteTags>;
          if (confirm("发现该 palette 集合上次未导出的本地草稿，是否恢复？")) {
            parsed.tagData = draft;
          }
        } catch { /* ignore bad draft */ }
      }
      setBundle(parsed);
      setSelected(new Set());
      setError("");
    } catch (e) {
      setError(`加载失败: ${(e as Error).message}`);
    }
  }, []);

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample/my_retro_clean.adnatags`);
      if (!res.ok) throw new Error(`sample 不可用 (${res.status})`);
      const buf = await res.arrayBuffer();
      const parsed = parseBundle("my_retro_clean.adnatags (sample)", buf);
      setBundle(parsed);
      setSelected(new Set());
      setError("");
    } catch (e) {
      setError(`样例加载失败: ${(e as Error).message}`);
    }
  }, []);

  // ---- drag & drop anywhere ----
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) void loadBundleFile(f);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
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

  // ---- selection ----
  const onSelect = useCallback((index: number, additive: boolean) => {
    setSelected((prev) => {
      const next = new Set(additive ? prev : []);
      if (additive && prev.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // ---- load an external tags file, merge onto current doc (§3.1.1) ----
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

  // ---- export ----
  const onExport = useCallback(() => {
    if (!bundle) return;
    const text = buildFinalTags(bundle.manifest.palette_set, bundle.tagData);
    downloadText("final_tags.json", text);
  }, [bundle]);

  const stats = useMemo(() => {
    if (!bundle) return { total: 0, tagged: 0 };
    const total = bundle.manifest.palettes.length;
    const tagged = Object.values(bundle.tagData).filter((t) => t.role || t.style.length).length;
    return { total, tagged };
  }, [bundle]);

  return (
    <div className="app">
      <header className="topbar">
        <strong>Adna Web Asset Tagger</strong>
        <button onClick={() => fileInput.current?.click()}>打开 .adnatags…</button>
        <input
          ref={fileInput}
          type="file"
          accept=".adnatags,.zip"
          hidden
          onChange={(e) => e.target.files?.[0] && loadBundleFile(e.target.files[0])}
        />
        <button disabled={!bundle} onClick={() => tagsInput.current?.click()}>
          Load tags…
        </button>
        <input
          ref={tagsInput}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => e.target.files?.[0] && onLoadTagsFile(e.target.files[0])}
        />
        <span className="spacer" />
        {bundle && (
          <span className="stat">
            {bundle.name} · {stats.tagged}/{stats.total} tagged
          </span>
        )}
        <button disabled={!bundle} onClick={onExport}>
          导出 final_tags.json
        </button>
      </header>

      {error && <div className="error">{error}</div>}

      {!bundle ? (
        <div className="dropzone">
          <div>把 <code>.adnatags</code> 拖到这里，或点「打开 .adnatags…」</div>
          <button onClick={loadSample}>试用样例</button>
        </div>
      ) : (
        <div className="main">
          <Gallery bundle={bundle} selected={selected} onSelect={onSelect} />
          <Inspector
            bundle={bundle}
            selected={selected}
            rolePaths={rolePaths}
            applyToSelection={applyToSelection}
          />
        </div>
      )}
    </div>
  );
}
