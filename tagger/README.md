# Adna Web Asset Tagger

Static, browser-only tool for the **human review** step of palette role/style
tagging (plan + design live in the private engine repo:
`docs/WEB_ASSET_TAGGER_PLAN.md` and `docs/TAG_SYSTEM_DESIGN.md`).
It never calls a backend or a model — you
drop in a `.adnatags` bundle exported by the engine, review/edit tags visually,
and export `final_tags.json` to feed back via the `import_palette_tags` headless
command.

> Web dev lives in this repo and builds standalone; the **engine and docs are
> authoritative in the private engine repo**.

## Run

```bash
cd tagger
npm install
npm run dev        # http://localhost:5173  ("试用样例" loads public/sample/*.adnatags)
npm run build      # type-check + static build to dist/
```

## Workflow

1. Engine: `export_palette_bundle` → `<name>.adnatags` (zip: manifest + role tree
   snapshot + current `tags.json` + contact sheets).
2. Here: drop the `.adnatags` in. The gallery slices each palette swatch out of
   the contact sheet (by `manifest.grid`); existing tags load from `tags.json`.
3. Review: click a swatch (Cmd/Ctrl/Shift-click to multi-select), pick a **role**
   from the closed tree (cascading list, bound to the bundled `palette_tag_tree.json`),
   add free **style** tags (multi-value; preset quick-adds from styles already used).
   Status border: grey = untagged, yellow = ai_suggested, green = human_verified.
4. Optionally **Load tags…** to merge an external tag JSON (e.g. an AI-produced
   pass) onto the current document by index.
5. **导出 final_tags.json**. Progress autosaves to `localStorage` per palette set.

## Stack

React + Vite + TypeScript. `fflate` for in-browser zip. No other runtime deps.
