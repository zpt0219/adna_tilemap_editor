import type { BlueprintFile, BlueprintLayer, BlueprintObject, BlueprintRoot, LoadedBlueprint } from "./types";

// Depth-first object iteration in DRAW ORDER: a layer's own objects first, then
// its child layers recursively (matches render_overlay.py iter_objects/draw_layer).
export function* iterObjects(layer: BlueprintLayer): Generator<BlueprintObject> {
  for (const obj of layer.objects ?? []) yield obj;
  for (const child of layer.layers ?? []) yield* iterObjects(child);
}

// Bounding-box size from content (+margin), used only when the root carries no
// explicit width/height. Mirrors render_overlay.py infer_map_size.
function inferSize(root: BlueprintRoot, margin = 2): { width: number; height: number } {
  let mx = 0;
  let my = 0;
  for (const obj of iterObjects(root)) {
    if (obj.rect) {
      const [x, y, w, h] = obj.rect;
      mx = Math.max(mx, x + w);
      my = Math.max(my, y + h);
    }
    for (const c of obj.cells ?? []) {
      mx = Math.max(mx, c[0] + 1);
      my = Math.max(my, c[1] + 1);
    }
    for (const p of obj.points ?? []) {
      mx = Math.max(mx, p[0] + 1);
      my = Math.max(my, p[1] + 1);
    }
  }
  return { width: Math.max(1, mx + margin), height: Math.max(1, my + margin) };
}

// Resolve canvas size from the blueprint root. Per §3.6 the web app never
// creates or resizes maps — the canvas IS the blueprint's width/height. We only
// fall back to a content AABB when the root omits them (mirrors render_overlay).
function resolveSize(root: BlueprintRoot): { width: number; height: number; inferred: boolean } {
  let w = root.width;
  let h = root.height;
  const ms = root.map_size;
  if ((w == null || h == null) && Array.isArray(ms) && ms.length === 2) {
    w = w ?? ms[0];
    h = h ?? ms[1];
  } else if ((w == null || h == null) && ms && typeof ms === "object") {
    w = w ?? (ms as { width?: number }).width;
    h = h ?? (ms as { height?: number }).height;
  }
  if (w == null || h == null) {
    const inf = inferSize(root);
    return { width: w ?? inf.width, height: h ?? inf.height, inferred: true };
  }
  return { width: w, height: h, inferred: false };
}

// Parse blueprint JSON text into a viewer-ready LoadedBlueprint. The file may be
// the root directly or wrapped under a top-level `blueprint` key.
export function parseBlueprint(name: string, text: string): LoadedBlueprint {
  const data = JSON.parse(text) as BlueprintFile;
  const root: BlueprintRoot = data.blueprint ?? data;
  const { width, height, inferred } = resolveSize(root);
  return { name, root, width, height, sizeInferred: inferred };
}

// FRG scatter cells render subtle; terrain/road/water cells render near-opaque.
// Mirrors render_overlay.py's shp check.
export function isScatter(obj: BlueprintObject): boolean {
  const shp = String(obj.shape ?? obj.type ?? "").toLowerCase();
  return shp === "fixed_rect_group" || shp === "fixed-rect-group" || shp === "frg";
}
