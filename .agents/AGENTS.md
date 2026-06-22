# Project-Scoped Rules: Adna Tilemap Editor

## Deployment Rule
Every time you complete any changes to the web application source files (under `reroll/`, `tagger/`, `refiner/`, or landing page `server/index.html`), you must automatically trigger a website rebuild and deployment to the live site `adna.world` by running the following script in the workspace root:

```bash
bash server/deploy.sh
```

Ensure that the script runs successfully without errors. Always inform the user that the site has been redeployed with the latest updates.
