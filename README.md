# Adna Portal

Portal and reference archives for [adna.world](https://adna.world) / [tilemap.art](https://tilemap.art).

## Overview

This repository hosts:
- **Portal Landing Page**: [`server/index.html`](server/index.html)
- **Wang Tiles Archive**: [`wang_tiles/`](wang_tiles/) — classic Wang Tiles interactive demos and educational theory archive.
- **Server Gateway**: [`server/nginx.conf`](server/nginx.conf), [`server/deploy.sh`](server/deploy.sh).

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
