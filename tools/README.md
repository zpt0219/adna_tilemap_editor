# tools — dev/test harness for the web apps

Headless-browser smoke checks (Playwright + Chromium). **Not** part of any app
build or the GitHub Pages deploy. Lets changes be verified by actually rendering
the page (the apps draw on Canvas 2D, so `npm run build` passing isn't enough).

## Setup (once)

```bash
cd tools
npm install
npx playwright install chromium          # browser binary → ~/.cache/ms-playwright
sudo npx playwright install-deps chromium # system libs (Ubuntu)
```

## Use

```bash
# 1) generic: load a URL, screenshot, report console/page errors
node tools/shot.mjs https://adna.world/reroll/ /tmp/reroll.png
node tools/shot.mjs http://127.0.0.1:4173/    /tmp/local.png 2000

# 2) interactive reroll smoke: load the bundled sample, screenshot the canvas
#    (start a local server first, e.g. `cd reroll && npx vite preview --port 4173`)
node tools/smoke-reroll.mjs http://127.0.0.1:4173/ /tmp/reroll-sample.png
```

Typical loop when editing an app: edit → `npm run build` (typecheck+bundle) →
`vite preview` → `smoke-*.mjs` screenshot → eyeball the PNG. Then
`./server/deploy.sh` to publish to https://adna.world.
