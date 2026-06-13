// api.ts — client for the tagger backend (server/tagapi.mjs) at /api/.
// Lets tagging happen on a phone: list server bundles, fetch one, and sync the
// draft back so you can resume on any device. Password stored in localStorage,
// sent as the x-tag-pw header on every call.

import type { PaletteTags } from "./types";

const PW_KEY = "adna_tag_pw";
export const getPw = (): string => localStorage.getItem(PW_KEY) || "";
export const setPw = (pw: string): void => localStorage.setItem(PW_KEY, pw);

const auth = () => ({ "x-tag-pw": getPw() });

export interface ServerBundle {
  name: string;
  size: number;
  mtime: number;
  hasProgress: boolean;
  tagged: number;
}

/** Validate a password against the server (does not store it). */
export async function ping(pw: string): Promise<boolean> {
  try {
    const r = await fetch("/api/ping", { headers: { "x-tag-pw": pw } });
    return r.ok;
  } catch { return false; }
}

export async function listBundles(): Promise<ServerBundle[]> {
  const r = await fetch("/api/bundles", { headers: auth() });
  if (r.status === 401) throw new Error("401");
  if (!r.ok) throw new Error(`列表失败 (${r.status})`);
  return (await r.json()).bundles as ServerBundle[];
}

export async function getBundle(name: string): Promise<ArrayBuffer> {
  const r = await fetch(`/api/bundle?name=${encodeURIComponent(name)}`, { headers: auth() });
  if (!r.ok) throw new Error(`下载失败 (${r.status})`);
  return r.arrayBuffer();
}

export async function getTags(name: string): Promise<Record<number, PaletteTags>> {
  const r = await fetch(`/api/tags?name=${encodeURIComponent(name)}`, { headers: auth() });
  if (!r.ok) return {};
  const j = await r.json();
  return (j.tagData as Record<number, PaletteTags>) || {};
}

export async function putTags(name: string, paletteSet: string, tagData: Record<number, PaletteTags>): Promise<void> {
  await fetch(`/api/tags?name=${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ palette_set: paletteSet, tagData }),
  });
}

/** The reroll editor's current default palette pack (public, no password). */
export async function getRerollPack(): Promise<ArrayBuffer> {
  const r = await fetch("/api/reroll-pack");
  if (!r.ok) throw new Error(`获取 reroll 包失败 (${r.status})`);
  return r.arrayBuffer();
}

/** Overwrite the reroll default pack (password required). */
export async function putRerollPack(bytes: Uint8Array): Promise<void> {
  const r = await fetch("/api/reroll-pack", { method: "PUT", headers: { ...auth() }, body: new Blob([bytes as BlobPart]) });
  if (r.status === 401) throw new Error("密码错误");
  if (!r.ok) throw new Error(`上传失败 (${r.status})`);
}
