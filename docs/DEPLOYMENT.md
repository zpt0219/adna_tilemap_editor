# Deployment

The web apps (`reroll/`, `tagger/`) ship to **two** places. Both build from a
single checkout — no other repo needed.

| Target | URL | What | How |
| --- | --- | --- | --- |
| Self-hosted | https://adna.world/ (`/reroll`, `/tagger`) | both apps + landing page | `server/deploy.sh` (run on the server) |
| GitHub Pages | https://zpt0219.github.io/adna_tilemap_editor/ | **reroll only** | `server/publish-reroll-pages.sh` → `gh-pages` branch |

Keep the two in sync by running both after a change you want public.

## Prerequisites

- **Node 20+ and npm** (local build for both targets).
- **adna.world deploy** runs *on the Tencent Tokyo server* (public IP
  43.153.186.119): needs `sudo` (passwordless there) to write `/var/www/adna`,
  with nginx + HTTPS already configured.
- **GitHub Pages publish** needs push access to the `origin` remote
  (`git@github.com:zpt0219/adna_tilemap_editor.git`).

## A) Self-hosted — adna.world

```bash
bash server/deploy.sh
```

Builds `reroll` and `tagger`, then publishes to `/var/www/adna` (landing page +
`/reroll/` + `/tagger/`) via `rsync --delete`. nginx serves `/var/www`, so a
rebuild never disrupts the live site mid-copy. Re-run after pulling changes.

## B) GitHub Pages — reroll

```bash
bash server/publish-reroll-pages.sh
```

This runs `npm ci && npm run build` in `reroll/`, then **force-pushes the built
`reroll/dist` (plus a `.nojekyll` marker) to the `gh-pages` branch** as a single
commit. GitHub Pages serves that branch directly — **no CI build**. Wait ~1 min
after pushing, then load the URL above. The page auto-loads the bundled sample
(`test_village_strict`) so it opens straight to a rendered map.

**One-time repo setting** (already done; re-check if Pages ever resets):
Settings → Pages → Build and deployment → Source = **Deploy from a branch** →
Branch = **`gh-pages`** / **`(root)`** → Save.

### Why a prebuilt branch instead of an Actions build?

The previous `.github/workflows/deploy-pages.yml` (build in CI → `deploy-pages`)
was removed because the GitHub runner's **`npm ci` crashes with
`Exit handler never called!`** — an npm-internal bug. It exits `0` with an
**incomplete `node_modules`**, so `tsc` then fails with a cascade of
`Cannot find module 'react'` / `'fflate'` and implicit-`any` errors. This is a
runner-environment problem, not a code problem: a clean `git clone` +
`npm ci && npm run build` builds fine locally. Pinning the npm version did not
help. Building locally and publishing the artifacts sidesteps it entirely.

If GitHub later fixes the runner and you want CI back, restore the workflow from
git history and switch Pages Source back to "GitHub Actions".

## Notes

- `reroll`'s Vite `base` is `"./"` (relative asset URLs), so the same `dist`
  works at any sub-path — adna.world `/reroll/` and the Pages project sub-path
  both resolve correctly.
- `reroll` renders real tiles from a palette pack bundled at
  `reroll/public/sample/palettes.adnapalettepack` (+ the `test_village_strict`
  blueprint). Updating those = re-run the relevant publish script.
- The role→color table is generated at build time from
  `reroll/vendor/blueprint_palette.h` (see the main README); no action needed for
  deploys beyond running the build.
