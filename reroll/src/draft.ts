// draft.ts — autosave the in-memory edit session to localStorage so an
// interrupted session can resume. Unlike the adna-web-lite *export* format
// (saveFormat.ts, for disk/desktop handoff), this is a FAITHFUL snapshot of the
// live LiteTileMap: it keeps object ids, the `vertical` y-sort stratum, terrain
// matrices, and every tag (incl. web.palette / web.lock / web.name), so undo
// targets and render order survive a reload. Keyed by the source name, so
// reopening the same blueprint/sample finds its draft.

import type { LiteTileMap } from "./model";

const PREFIX = "reroll_draft_";
const VERSION = 1;

const keyFor = (name: string) => PREFIX + name;

interface Envelope {
  v: number;
  savedAt: number;
  map: unknown; // LiteTileMap with terrain.data as number[] (Int16Array isn't JSON-safe)
}

// terrain.data (Int16Array) → number[] for JSON, and back on load.
function toJSON(map: LiteTileMap): unknown {
  return {
    ...map,
    layers: map.layers.map((l) => ({
      ...l,
      objects: l.objects.map((o) => (o.terrain ? { ...o, terrain: { ...o.terrain, data: Array.from(o.terrain.data) } } : o)),
    })),
  };
}

function fromJSON(m: any): LiteTileMap {
  for (const l of m.layers ?? []) {
    for (const o of l.objects ?? []) {
      if (o.terrain && Array.isArray(o.terrain.data)) o.terrain.data = Int16Array.from(o.terrain.data);
    }
  }
  return m as LiteTileMap;
}

export function saveDraft(name: string, map: LiteTileMap): void {
  try {
    const env: Envelope = { v: VERSION, savedAt: Date.now(), map: toJSON(map) };
    localStorage.setItem(keyFor(name), JSON.stringify(env));
  } catch { /* quota / serialization failure → skip (autosave is best-effort) */ }
}

/** The saved draft for `name`, or null if none / unreadable / version mismatch. */
export function loadDraft(name: string): { map: LiteTileMap; savedAt: number } | null {
  const raw = localStorage.getItem(keyFor(name));
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Envelope;
    if (env.v !== VERSION || !env.map) return null;
    return { map: fromJSON(env.map), savedAt: env.savedAt };
  } catch {
    return null;
  }
}

export function clearDraft(name: string): void {
  localStorage.removeItem(keyFor(name));
}
