// Interactive smoke for reroll: load the page, click 试用样例 to load the
// bundled sample, and screenshot the rendered canvas. Proves the convert →
// normalize → Canvas-2D render path actually draws (not just a blank shell).
//
// Usage: node tools/smoke-reroll.mjs [baseUrl] [outfile]
//   node tools/smoke-reroll.mjs http://127.0.0.1:4173/ /tmp/reroll-sample.png
import { chromium } from "playwright";

const [base = "http://127.0.0.1:4173/", out = "/tmp/reroll-sample.png"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });
await page.getByText("试用样例").click();
await page.waitForSelector("canvas", { timeout: 10000 });
await page.waitForTimeout(1500); // let the scene render
await page.screenshot({ path: out });

// sanity: how many layer rows showed up (category-layer panel)
const layers = await page.locator(".layer-row").count().catch(() => -1);
console.log(`screenshot ${out}  ·  layer rows: ${layers}`);
console.log(errors.length ? `\nerrors:\n${errors.join("\n")}` : "no console/page errors");
await browser.close();
