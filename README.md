# Adna TileMap Editor — Web

Home of the **web front-ends** for the Adna tilemap toolchain. Split out of the
engine repo so web development has its own repo, build, and history.

| App | What it is |
| --- | --- |
| [`reroll/`](reroll/) | Web Lite Reroll Editor — blueprint JSON viewer / reroll / terrain-brush patch tool (Vite + React + TS + Canvas 2D). |
| [`tagger/`](tagger/) | Web Asset Tagger — browser-only human-review tool for palette role/style tagging. |

Each app is a standalone Vite project; see its own README for run/build steps
(`cd reroll && npm install && npm run dev`).

**Deploying** (adna.world self-host + GitHub Pages): see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Self-contained — no other-repo dependency

This repo builds and runs from a **single checkout** and is meant to ship as a
public website, so it depends on no other repo at build or runtime.

It was split out of the Adna engine project (a separate, private repo), and web
development happens here going forward. The engine repo remains the *origin* of a
couple of shared assets, but this repo carries its own **vendored snapshots** of
them rather than reaching across:

- **Blueprint role→color palette.** `reroll` generates
  [`reroll/src/generated/roleColors.ts`](reroll/src/generated/roleColors.ts) from
  a vendored copy of the engine header at
  [`reroll/vendor/blueprint_palette.h`](reroll/vendor/blueprint_palette.h) (a
  verbatim snapshot of upstream `desktop/src/blueprint_palette.h`). `npm run
  generate` (wired into `predev`/`prebuild`) re-emits the table from that local
  file — no network, no sibling repo.

  *Re-sync when the engine palette changes:* copy upstream
  `desktop/src/blueprint_palette.h` over `reroll/vendor/blueprint_palette.h` (or
  set `$BLUEPRINT_PALETTE_H` to it), then `npm run generate`.

- **Design docs.** The plan/schema/design docs live in the private engine repo;
  the sub-app READMEs name them for reference only — nothing in the build reads
  them, and they aren't linked here.
