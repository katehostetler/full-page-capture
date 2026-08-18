// Record a demo GIF: load the extension in Chromium, capture a real page,
// and film the page scrolling itself + the preview tab appearing.
// Pure-JS pipeline (pngjs + gifenc) — no ffmpeg needed.
//
//   node scripts/make-demo-gif.mjs [url] [out.gif]
import { chromium } from "playwright";
import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targetUrl = process.argv[2] || "https://gofullpage.com";
const outPath = process.argv[3] || path.join(projectRoot, "docs", "demo.gif");

const OUT_W = 768; // gif width; height follows aspect
const FRAME_DELAY_MS = 350;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpc-gif-"));
const extDir = path.join(workDir, "extension");
fs.cpSync(path.join(projectRoot, "extension"), extDir, { recursive: true });
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "extension/manifest.json"), "utf8")
);
manifest.host_permissions = ["<all_urls>"]; // harness only; real install uses activeTab
fs.writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(path.join(workDir, "profile"), {
  channel: "chromium",
  headless: true,
  viewport: null,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--window-size=1280,800",
  ],
});

const frames = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(page) {
  try {
    frames.push(await page.screenshot({ type: "png" }));
  } catch {
    // Page mid-navigation — skip this frame.
  }
}

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  await worker.evaluate(() => chrome.storage.sync.set({ openPreview: true, autoFormats: [] }));

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
  await snap(page); // opening shot

  let viewerPage = null;
  context
    .waitForEvent("page", { predicate: (p) => p.url().includes("viewer.html"), timeout: 90000 })
    .then((p) => (viewerPage = p))
    .catch(() => {});

  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    captureFullPage(tab); // not awaited — we film while it runs
  });

  // Act 1: the page scrolls and captures itself.
  for (let i = 0; i < 80 && !viewerPage; i++) {
    await snap(page);
    await sleep(FRAME_DELAY_MS);
  }
  if (!viewerPage) throw new Error("viewer tab never opened");

  // Act 2: the preview tab stitches and shows the result.
  await viewerPage.waitForSelector("#preview canvas", { timeout: 60000 });
  await viewerPage.waitForFunction(() => !document.getElementById("download-png").disabled);
  for (let i = 0; i < 4; i++) {
    await snap(viewerPage);
    await sleep(FRAME_DELAY_MS);
  }

  // Act 3: glide down the preview to show off the full-page result.
  const scrollInfo = await viewerPage.evaluate(() => ({
    total: document.body.scrollHeight,
    viewport: window.innerHeight,
  }));
  const glideSteps = 10;
  for (let i = 1; i <= glideSteps; i++) {
    await viewerPage.evaluate(
      ({ total, viewport, frac }) => window.scrollTo(0, (total - viewport) * frac),
      { ...scrollInfo, frac: i / glideSteps }
    );
    await sleep(120);
    await snap(viewerPage);
  }
  for (let i = 0; i < 3; i++) await snap(viewerPage); // hold the final frame

  console.log(`captured ${frames.length} frames; encoding…`);

  // --- Encode: decode PNGs, downscale (nearest neighbor), write GIF ---
  const gif = GIFEncoder();
  let outH = null;
  for (const [index, buf] of frames.entries()) {
    const png = PNG.sync.read(buf);
    const scale = OUT_W / png.width;
    outH = outH ?? Math.round(png.height * scale);
    const rgba = new Uint8Array(OUT_W * outH * 4);
    for (let y = 0; y < outH; y++) {
      const srcY = Math.min(png.height - 1, Math.round(y / scale));
      for (let x = 0; x < OUT_W; x++) {
        const srcX = Math.min(png.width - 1, Math.round(x / scale));
        const s = (srcY * png.width + srcX) * 4;
        const d = (y * OUT_W + x) * 4;
        rgba[d] = png.data[s];
        rgba[d + 1] = png.data[s + 1];
        rgba[d + 2] = png.data[s + 2];
        rgba[d + 3] = 255;
      }
    }
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    const isLast = index === frames.length - 1;
    gif.writeFrame(indexed, OUT_W, outH, { palette, delay: isLast ? 1500 : FRAME_DELAY_MS });
  }
  gif.finish();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(gif.bytes()));
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB, ${OUT_W}x${outH})`);
} finally {
  await context.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}
