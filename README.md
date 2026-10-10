# Adna Web Portal

Portal hub and gateway for the Adna toolchain web applications ([adna.world](https://adna.world) / [tilemap.art](https://tilemap.art)).

## Overview

This repository serves as the **portal hub** and **theoretical reference archive**:
- **Portal Landing Page**: [`server/index.html`](server/index.html) — data-driven responsive portal dashboard linking to toolchain apps.
- **Wang Tiles Archive**: [`wang_tiles/`](wang_tiles/) — mirrored classic Wang Tiles interactive demos and educational archive.
- **Server Gateway**: [`server/nginx.conf`](server/nginx.conf), [`server/deploy.sh`](server/deploy.sh).

## Independent Sub-Applications

Each toolchain web application is maintained as an independent repository and deploys its production `dist/` directly into `/var/www/adna/<app_name>/`:
- **64px Portrait Studio**: `64px-portrait-studio` (`/64px-portrait-studio/`)
- **Blueprint Studio (Reroll Editor)**: `blueprint_studio` (`/reroll/`)
- **Pixel Refiner**: `refiner` (`/refiner/`)
- **Autotile Mixer**: `autotile_mixer` (`/autotile_mixer/`)
- **Autotile Path**: `autotile_path` (`/autotile_path/`)
- **Asset Tagger**: `tagger` (`/tagger/`)

## Local Development

Run the local portal server:
```bash
node start-local.mjs
```
Visit http://localhost:3000 to preview the portal landing page and Wang Tiles archive.

## Deployment

Deploy portal changes and archives to `/var/www/adna`:
```bash
bash server/deploy.sh
```
