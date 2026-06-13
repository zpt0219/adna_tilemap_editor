// tagapi.mjs — tiny zero-dependency backend for the Web Asset Tagger so tagging
// can happen on a phone, away from the desktop. Sits behind nginx at /api/
// (HTTPS). Single-user; a trivial shared password gates every call.
//
//   GET  /api/ping                 -> {ok:true}                 (validate password)
//   GET  /api/bundles              -> {bundles:[{name,size,mtime,hasProgress,tagged}]}
//   GET  /api/bundle?name=X        -> raw .adnatags bytes
//   GET  /api/tags?name=X          -> saved draft {palette_set?, tagData:{}} (or empty)
//   PUT  /api/tags?name=X  <json>  -> save the draft for that bundle
//
// Data layout (TAG_DATA, default /home/ubuntu/game_dev/adna-tagger-data):
//   adnatags/<name>.adnatags        you drop these here (scp / SFTP / Jupyter)
//   .progress/<name>.adnatags.json  this service writes the resumable drafts (hidden; leave it)
//
// Run via systemd (server/adna-tagapi.service). The password comes from env
// TAG_PW, set in a LOCAL file outside the repo (see adna-tagapi.env.example) —
// never hard-code the real password here. Falls back to a placeholder.
import http from "node:http";
import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.TAG_PORT || 8717);
const PW = process.env.TAG_PW || "changeme";
const ROOT = process.env.TAG_DATA || "/home/ubuntu/game_dev/adna-tagger-data";
const BUNDLES = path.join(ROOT, "adnatags");   // you drop .adnatags files here
const TAGS = path.join(ROOT, ".progress");      // auto-saved drafts (hidden; leave it)
// The reroll editor's default palette pack — served live (GET, public) so reroll
// always loads the latest, and overwritten by the tagger's "apply roles" button
// (PUT, password). It IS the repo file, so committing it updates GitHub Pages too.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REROLL_PACK = process.env.REROLL_PACK || path.join(__dirname, "..", "reroll", "public", "sample", "palettes.adnapalettepack");

await mkdir(BUNDLES, { recursive: true });
await mkdir(TAGS, { recursive: true });

const send = (res, code, body, type = "application/json") => {
  const data = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(data);
};

// accept only a bare .adnatags filename (no path traversal)
const safeName = (n) => !!n && /^[\w.\- ]+\.adnatags$/.test(n) && !n.includes("/") && !n.includes("..");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    // Public (no password): reroll fetches its default pack here.
    if (p === "/api/reroll-pack" && req.method === "GET") {
      try { return send(res, 200, await readFile(REROLL_PACK), "application/octet-stream"); }
      catch { return send(res, 404, { error: "no pack" }); }
    }

    const pw = req.headers["x-tag-pw"] || url.searchParams.get("pw");
    if (pw !== PW) return send(res, 401, { error: "bad password" });

    // Overwrite the reroll default pack (the tagger "apply roles → reroll" button).
    if (p === "/api/reroll-pack" && req.method === "PUT") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await writeFile(REROLL_PACK, Buffer.concat(chunks));
      return send(res, 200, { ok: true });
    }

    if (p === "/api/ping") return send(res, 200, { ok: true });

    if (p === "/api/bundles" && req.method === "GET") {
      const files = (await readdir(BUNDLES)).filter((f) => f.toLowerCase().endsWith(".adnatags"));
      const out = [];
      for (const name of files.sort()) {
        const s = await stat(path.join(BUNDLES, name));
        let tagged = 0, hasProgress = false;
        try {
          const t = JSON.parse(await readFile(path.join(TAGS, name + ".json"), "utf8"));
          hasProgress = true;
          tagged = Object.values(t.tagData || {}).filter((x) => x && (x.role || (x.style || []).length)).length;
        } catch { /* no draft yet */ }
        out.push({ name, size: s.size, mtime: s.mtimeMs, hasProgress, tagged });
      }
      return send(res, 200, { bundles: out });
    }

    if (p === "/api/bundle" && req.method === "GET") {
      const name = url.searchParams.get("name");
      if (!safeName(name)) return send(res, 400, { error: "bad name" });
      return send(res, 200, await readFile(path.join(BUNDLES, name)), "application/octet-stream");
    }

    if (p === "/api/tags" && req.method === "GET") {
      const name = url.searchParams.get("name");
      if (!safeName(name)) return send(res, 400, { error: "bad name" });
      try { return send(res, 200, await readFile(path.join(TAGS, name + ".json"))); }
      catch { return send(res, 200, { tagData: {} }); }
    }

    if (p === "/api/tags" && req.method === "PUT") {
      const name = url.searchParams.get("name");
      if (!safeName(name)) return send(res, 400, { error: "bad name" });
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString("utf8");
      JSON.parse(body); // validate JSON before writing
      await writeFile(path.join(TAGS, name + ".json"), body);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`tagapi on 127.0.0.1:${PORT} · data=${ROOT}`));
