// Headless smoke check: load a URL, screenshot it, and report console / page
// errors. The web apps render on Canvas 2D, so a build pass isn't enough —
// this gives a real "did it render / did it throw" signal.
//
// Usage:
//   node tools/shot.mjs <url> [outfile] [waitMs]
// Examples:
//   node tools/shot.mjs https://adna.world/reroll/ /tmp/reroll.png
//   node tools/shot.mjs http://localhost:4173/ /tmp/local.png 2000
import { chromium } from "playwright";

const [url, out = "/tmp/shot.png", waitMs = "1500"] = process.argv.slice(2);
if (!url) {
  console.error("usage: node tools/shot.mjs <url> [outfile] [waitMs]");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => errors.push(`reqfailed: ${r.url()} (${r.failure()?.errorText})`));

try {
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(Number(waitMs));
  await page.screenshot({ path: out });
  console.log(`HTTP ${resp?.status()}  →  screenshot ${out}`);
} catch (e) {
  console.error(`navigation failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) console.log(`\n${errors.length} error(s):\n` + errors.join("\n"));
else console.log("no console/page errors");
