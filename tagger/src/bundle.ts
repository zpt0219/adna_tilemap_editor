import { unzipSync, strFromU8 } from "fflate";
import type { Manifest, ParsedBundle, PaletteTags, TagsFile, TagTree } from "./types";

// Normalize a TagsFile (style may be string or string[]) into the in-app
// tagData map keyed by palette index.
export function tagsFileToData(
  tags: TagsFile,
  status: PaletteTags["status"],
): Record<number, PaletteTags> {
  const out: Record<number, PaletteTags> = {};
  for (const t of tags.palette_tags ?? []) {
    const style = Array.isArray(t.style)
      ? t.style
      : typeof t.style === "string"
        ? t.style.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    out[t.index] = { role: t.role ?? "", style, status };
  }
  return out;
}

// Parses an .adnatags ArrayBuffer into a ParsedBundle. Throws on a missing
// manifest. A missing tree or tags only degrades gracefully.
export function parseBundle(name: string, buf: ArrayBuffer): ParsedBundle {
  const files = unzipSync(new Uint8Array(buf));

  const manifestRaw = files["manifest.json"];
  if (!manifestRaw) throw new Error("bundle has no manifest.json");
  const manifest = JSON.parse(strFromU8(manifestRaw)) as Manifest;

  let tree: TagTree | null = null;
  if (files["palette_tag_tree.json"]) {
    try {
      tree = JSON.parse(strFromU8(files["palette_tag_tree.json"])) as TagTree;
    } catch {
      tree = null;
    }
  }

  let tagData: Record<number, PaletteTags> = {};
  if (files["tags.json"]) {
    try {
      tagData = tagsFileToData(JSON.parse(strFromU8(files["tags.json"])) as TagsFile, "ai_suggested");
    } catch {
      tagData = {};
    }
  }

  // Sheet PNGs -> object URLs, in manifest.sheet order.
  const sheetUrls = (manifest.sheet ?? []).map((path) => {
    const data = files[path];
    if (!data) return "";
    const blob = new Blob([data], { type: "image/png" });
    return URL.createObjectURL(blob);
  });

  return { name, manifest, tree, sheetUrls, tagData };
}

// Builds final_tags.json text from the current tagData (only tagged palettes).
export function buildFinalTags(paletteSet: string, tagData: Record<number, PaletteTags>): string {
  const palette_tags = Object.entries(tagData)
    .map(([idx, t]) => ({ idx: Number(idx), t }))
    .filter(({ t }) => t.role || t.style.length > 0)
    .sort((a, b) => a.idx - b.idx)
    .map(({ idx, t }) => {
      const e: { index: number; role?: string; style?: string[] } = { index: idx };
      if (t.role) e.role = t.role;
      if (t.style.length) e.style = t.style;
      return e;
    });
  return JSON.stringify({ palette_set: paletteSet, palette_tags }, null, 2);
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
