# Deployment

Deploy portal landing page and Wang Tiles archives to `adna.world` / `tilemap.art`.

## Self-hosted (Production)

```bash
bash server/deploy.sh
```

Publishes `server/index.html` and `wang_tiles/` to `/var/www/adna`.
Sub-apps are managed and deployed independently from their own repositories.
