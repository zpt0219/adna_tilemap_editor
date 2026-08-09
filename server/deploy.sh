#!/usr/bin/env bash
# Build both web apps and publish them under /var/www/adna for nginx (:80).
#   /var/www/adna/index.html  ← server/index.html  (landing page)
#   /var/www/adna/reroll/     ← reroll/dist
#   /var/www/adna/tagger/     ← tagger/dist
# Re-run after pulling changes. nginx serves /var/www so a rebuild never
# disrupts the live site mid-copy (rsync --delete swaps atomically per file).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT=/var/www/adna

echo "==> building reroll"
( cd "$REPO/reroll" && npm ci && npm run build )

echo "==> building tagger"
( cd "$REPO/tagger" && npm ci && npm run build )

echo "==> building refiner"
( cd "$REPO/refiner" && npm ci && npm run build )

echo "==> building autotile_mixer"
( cd "$REPO/autotile_mixer" && npm ci && npm run build )

echo "==> building pixel_editor"
( cd "$REPO/pixel_editor" && npm ci && npm run build )

echo "==> publishing to $WEBROOT"
sudo mkdir -p "$WEBROOT/reroll" "$WEBROOT/tagger" "$WEBROOT/refiner" "$WEBROOT/autotile_mixer" "$WEBROOT/pixel_editor" "$WEBROOT/wang_tiles"
sudo rsync -a --delete "$REPO/reroll/dist/"  "$WEBROOT/reroll/"
sudo rsync -a --delete "$REPO/tagger/dist/"  "$WEBROOT/tagger/"
sudo rsync -a --delete "$REPO/refiner/dist/"  "$WEBROOT/refiner/"
sudo rsync -a --delete "$REPO/autotile_mixer/dist/"  "$WEBROOT/autotile_mixer/"
sudo rsync -a --delete "$REPO/pixel_editor/dist/"  "$WEBROOT/pixel_editor/"
sudo rsync -a --delete "$REPO/wang_tiles/"  "$WEBROOT/wang_tiles/"
sudo cp "$REPO/server/index.html" "$WEBROOT/index.html"
sudo chown -R www-data:www-data "$WEBROOT"

echo "==> done. live at http://$(curl -s --max-time 3 ifconfig.me || echo SERVER_IP)/"
