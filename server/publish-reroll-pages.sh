#!/usr/bin/env bash
# Build reroll locally and publish reroll/dist to the `gh-pages` branch, so
# GitHub Pages serves it WITHOUT a CI build (the GitHub runner's `npm ci` has
# been crashing with "Exit handler never called!", leaving node_modules
# incomplete). Pages must be set to: Settings → Pages → Source = "Deploy from a
# branch" → gh-pages / (root). Re-run this after changing reroll to update Pages.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="$(git -C "$REPO" remote get-url origin)"

echo "==> building reroll"
( cd "$REPO/reroll" && npm ci && npm run build )

echo "==> publishing reroll/dist to gh-pages"
TMP="$(mktemp -d)"
cp -r "$REPO/reroll/dist/." "$TMP/"
touch "$TMP/.nojekyll" # serve files as-is (no Jekyll, keep _-prefixed/asset files)
git -C "$TMP" init -q
git -C "$TMP" checkout -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" commit -qm "deploy reroll dist"
git -C "$TMP" push -fq "$REMOTE" gh-pages
rm -rf "$TMP"
echo "==> done. (set Pages source to gh-pages branch if not already)"
