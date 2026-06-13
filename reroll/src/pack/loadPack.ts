// loadPack.ts — unzip an `.adnapalettepack` and build a PackRuntime.

import { unzipSync, strFromU8 } from "fflate";
import { decodeMappingMatrix } from "./decode";
import type { Palette, PackManifest, PackRuntime, PaletteRecord } from "./types";

async function parsePackBytes(buf: ArrayBuffer): Promise<PackRuntime> {
  const files = unzipSync(new Uint8Array(buf));
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as PackManifest;
  const palettesFile = JSON.parse(strFromU8(files["palettes.json"])) as { palettes: PaletteRecord[] };

  // join palettes.json records (renderable defs) to manifest entries (role/style) by hash
  const recByHash = new Map<string, PaletteRecord>();
  for (const r of palettesFile.palettes) recByHash.set(r.hash, r);

  const palettes: Palette[] = [];
  for (const m of manifest.palettes) {
    const rec = recByHash.get(m.hash);
    if (!rec) continue;
    palettes.push({
      hash: m.hash,
      mode: m.mode,
      role: m.role ?? rec.tags?.["blueprint.role"] ?? "",
      style: m.style ?? rec.tags?.["blueprint.style"] ?? "",
      size: rec.size,
      tileResolution: rec.tileResolution,
      edge: rec.edge ?? [-1, -1],
      mapping: decodeMappingMatrix(rec.mappingMatrix),
    });
  }

  const atlas = await decodeAtlas(files[manifest.atlas.path]);
  return { atlas, tileResolution: manifest.atlas.tileResolution, palettes };
}

// Decode the atlas PNG to something drawImage-able. Prefer createImageBitmap
// (fast, off-thread); fall back to an HTMLImageElement where it's unavailable or
// throws (some headless/embedded WebViews), so rendering never silently fails.
async function decodeAtlas(bytes: Uint8Array): Promise<CanvasImageSource> {
  const blob = new Blob([bytes as BlobPart], { type: "image/png" });
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(blob); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function loadPackFromUrl(url: string): Promise<PackRuntime> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pack 不可用 (${res.status})`);
  return parsePackBytes(await res.arrayBuffer());
}

export async function loadPackFromFile(file: File): Promise<PackRuntime> {
  return parsePackBytes(await file.arrayBuffer());
}
