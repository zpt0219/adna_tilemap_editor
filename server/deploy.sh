#!/usr/bin/env bash
# Deploy Adna Portal (Landing Page & Wang Tiles archive) to /var/www/adna for nginx (:80 / :443).
#   /var/www/adna/index.html  ← server/index.html  (landing page)
#   /var/www/adna/wang_tiles/ ← wang_tiles/        (theory archive)
#
# NOTE: Independent sub-projects (reroll/blueprint_studio, tagger, refiner,
# autotile_mixer, autotile_path, 64px-portrait-studio, etc.) manage their own
# repositories and deploy their dist/ directly to /var/www/adna/<app_name>/.
# This script deploys the portal and wang_tiles without wiping other apps.
set -eu

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT=/var/www/adna

echo "==> publishing portal & wang_tiles to $WEBROOT"
sudo mkdir -p "$WEBROOT/wang_tiles"
sudo rsync -a --delete "$REPO/wang_tiles/" "$WEBROOT/wang_tiles/"
sudo cp "$REPO/server/index.html" "$WEBROOT/index.html"
sudo rm -rf "$WEBROOT/pixel_editor"
sudo chown -R www-data:www-data "$WEBROOT"

echo "==> done. live at https://adna.world/ (and http://$(curl -s --max-time 3 ifconfig.me || echo SERVER_IP)/)"
