// Demo: run the extension against a real public web page and save the PNG.
// Same harness as e2e/run-e2e.mjs, pointed at a real URL.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = "/Users/katehostetler/Projects/chrome-ext";
const outPath = process.argv[3] || path.join(projectRoot, "e2e-artifacts", "demo-real-page.png");
const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error("usage: node demo-capture.mjs <url> [outPath]");
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpc-demo-"));
const extDir = path.join(workDir, "extension");
const downloadsDir = path.join(workDir, "downloads");
fs.mkdirSync(path.join(extDir, "lib"), { recursive: true });
fs.mkdirSync(downloadsDir, { recursive: true });

fs.cpSync(path.join(projectRoot, "extension"), extDir, { recursive: true });
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "extension/manifest.json"), "utf8")
);
manifest.host_permissions = ["<all_urls>"]; // demo harness only; real install uses activeTab
fs.writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(path.join(workDir, "profile"), {
  channel: "chromium",
  headless: true,
  viewport: null,
  downloadsPath: downloadsDir,
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--window-size=1280,900",
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });

  // Headless flow: no preview tab, straight to a PNG download.
  await worker.evaluate(() => chrome.storage.sync.set({ openPreview: false, autoFormats: ["png"] }));
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await captureFullPage(tab);
  });

  let item = null;
  for (let i = 0; i < 120 && !item; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const items = await worker.evaluate(() => chrome.downloads.search({ state: "complete" }));
    item = items[0] || null;
    const err = await worker.evaluate(() => globalThis.__fpcLastError || null);
    if (err) throw new Error(`capture failed: ${err}`);
  }
  if (!item) throw new Error("no completed download after 60s");

  let pngPath = fs.existsSync(item.filename) ? item.filename : null;
  if (!pngPath) {
    const files = fs.readdirSync(downloadsDir).map((f) => path.join(downloadsDir, f));
    pngPath = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  const buf = fs.readFileSync(pngPath);
  console.log(`PNG dimensions: ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
  fs.copyFileSync(pngPath, outPath);
  console.log(`saved: ${outPath}`);
} finally {
  await context.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}
