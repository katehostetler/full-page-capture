// End-to-end check: load the unpacked extension in real Chromium and verify
// both capture flows:
//   Scenario 1 (headless): preview off, auto-download PNG -> file downloads
//   Scenario 2 (viewer): preview tab opens -> click Download PNG and PDF
//
// Playwright cannot click the extension's toolbar button, so the test copy of
// the extension gets <all_urls> patched in (captureVisibleTab accepts only
// <all_urls> or a real activeTab grant) and captures are triggered from inside
// the service worker. The shipped manifest stays activeTab-only.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpc-e2e-"));
const extDir = path.join(workDir, "extension");
const profileDir = path.join(workDir, "profile");
const downloadsDir = path.join(workDir, "downloads");
const artifactsDir = path.join(projectRoot, "e2e-artifacts");
for (const dir of [extDir, downloadsDir, artifactsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const PAGE_HEIGHT = 5000;

// --- Build a patched test copy of the extension ---
fs.cpSync(path.join(projectRoot, "extension"), extDir, { recursive: true });
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "extension/manifest.json"), "utf8")
);
manifest.host_permissions = ["<all_urls>"];
fs.writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

// --- Tall test page: labeled bands every 500px plus a fixed header ---
const bands = Array.from({ length: PAGE_HEIGHT / 500 }, (_, i) => {
  const hue = (i * 47) % 360;
  return `<div style="height:500px;background:hsl(${hue},70%,85%);font:bold 40px sans-serif;padding:20px;box-sizing:border-box">Band ${i + 1} — y=${i * 500}px</div>`;
}).join("");
const html = `<!doctype html><html><body style="margin:0">
<div style="position:fixed;top:0;left:0;right:0;height:60px;background:#d93025;color:#fff;font:bold 30px/60px sans-serif;text-align:center;z-index:9">FIXED HEADER</div>
${bands}</body></html>`;

// Page that scrolls inside an inner container while the window never moves
// (the Google-Images shape that used to stitch the same viewport repeatedly).
const INNER_HEIGHT = 4000;
const innerBands = Array.from({ length: INNER_HEIGHT / 500 }, (_, i) => {
  const hue = (i * 61) % 360;
  return `<div style="height:500px;background:hsl(${hue},70%,85%);font:bold 40px sans-serif;padding:20px;box-sizing:border-box">Inner ${i + 1} — y=${i * 500}px</div>`;
}).join("");
const containerHtml = `<!doctype html><html><body style="margin:0;height:100vh;overflow:hidden">
<div style="height:60px;background:#333;color:#fff;font:bold 30px/60px sans-serif;text-align:center">STATIC BAR</div>
<div id="scroller" style="height:calc(100vh - 60px);overflow-y:auto">${innerBands}</div>
</body></html>`;

// "Googlish" page: the window scrolls a tiny bit (footer), the real content
// scrolls in an inner container, and a bar re-fixes itself via JS on every
// scroll — all three behaviors that broke real Google Images captures.
const GOOGLISH_HEIGHT = 4000;
const googlishBands = Array.from({ length: GOOGLISH_HEIGHT / 500 }, (_, i) => {
  const hue = (i * 83) % 360;
  return `<div style="height:500px;background:hsl(${hue},70%,85%);font:bold 40px sans-serif;padding:70px 20px 20px;box-sizing:border-box">Googlish ${i + 1} — y=${i * 500}px</div>`;
}).join("");
const googlishHtml = `<!doctype html><html><body style="margin:0">
<div id="bar" style="position:fixed;top:0;left:0;right:0;height:50px;background:#d93025;color:#fff;font:bold 26px/50px sans-serif;text-align:center;z-index:9">STICKY SEARCH BAR</div>
<div id="scroller" style="height:100vh;overflow-y:auto">${googlishBands}</div>
<div style="height:80px;background:#222;color:#fff;font:20px/80px sans-serif;text-align:center">FOOTER</div>
<script>
  const bar = document.getElementById("bar");
  document.getElementById("scroller").addEventListener("scroll", () => {
    bar.style.position = "fixed";
    bar.style.visibility = "visible";
  });
</script>
</body></html>`;

// Lazy-growing page: starts at 2000px, appends content when scrolled near the
// bottom (like an image-results feed), topping out at 5000px.
const growingHtml = `<!doctype html><html><body style="margin:0">
<div id="content"></div>
<script>
  let bands = 0;
  function addBand() {
    const div = document.createElement("div");
    div.style.cssText = "height:500px;background:hsl(" + ((bands * 47) % 360) + ",70%,85%);font:bold 40px sans-serif;padding:20px;box-sizing:border-box";
    div.textContent = "Grown " + (bands + 1) + " — y=" + bands * 500 + "px";
    document.getElementById("content").appendChild(div);
    bands++;
  }
  for (let i = 0; i < 4; i++) addBand();
  window.addEventListener("scroll", () => {
    while (bands < 10 && window.scrollY + innerHeight > document.body.scrollHeight - 400) addBand();
  });
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (req.url.startsWith("/container")) return res.end(containerHtml);
  if (req.url.startsWith("/googlish")) return res.end(googlishHtml);
  if (req.url.startsWith("/growing")) return res.end(growingHtml);
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://localhost:${server.address().port}/`;

const fail = (msg) => {
  console.error(`E2E FAIL: ${msg}`);
  process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chromium", // full build in new-headless mode; extensions work here
  headless: true,
  viewport: null,
  downloadsPath: downloadsDir,
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--window-size=1000,800",
  ],
});

// Wait for `expected` new completed chrome.downloads items beyond
// `previousCount`, then return the newest files on disk, newest first.
// (Playwright renames intercepted downloads to GUIDs, so contents — not
// names — are what we verify here.)
async function waitForNewDownloads(worker, previousCount, expected = 1) {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const err = await worker.evaluate(() => globalThis.__fpcLastError || null);
    if (err) throw new Error(`capture failed inside extension: ${err}`);
    const items = await worker.evaluate(() => chrome.downloads.search({ state: "complete" }));
    if (items.length >= previousCount + expected) {
      await sleep(300); // let the files finish landing on disk
      const files = fs
        .readdirSync(downloadsDir)
        .map((f) => path.join(downloadsDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (files.length < expected) throw new Error("downloads reported complete but files missing");
      return files.slice(0, expected).map((f) => fs.readFileSync(f));
    }
  }
  throw new Error(`did not reach ${expected} new completed download(s) after 30s`);
}

const downloadCount = (worker) =>
  worker.evaluate(() => chrome.downloads.search({ state: "complete" }).then((i) => i.length));

const isPng = (buf) => buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const metrics = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    dpr: window.devicePixelRatio,
  }));
  const expectedHeight = PAGE_HEIGHT * metrics.dpr;

  // ---------- Scenario 1: headless auto-download PNG + JPG together ----------
  console.log("scenario 1: preview off, auto-download png+jpg");
  await worker.evaluate(() =>
    chrome.storage.sync.set({ openPreview: false, autoFormats: ["png", "jpg"] })
  );
  let before = await downloadCount(worker);
  await worker.evaluate(async (targetUrl) => {
    const [tab] = await chrome.tabs.query({ url: targetUrl });
    if (!tab) throw new Error("test tab not found from service worker");
    await captureFullPage(tab);
  }, url);
  const headlessBufs = await waitForNewDownloads(worker, before, 2);
  const headlessPng = headlessBufs.find((b) => isPng(b));
  const headlessJpg = headlessBufs.find((b) => b.subarray(0, 2).toString("hex") === "ffd8");
  if (!headlessPng) fail("scenario 1: no PNG among the downloads");
  if (!headlessJpg) fail("scenario 1: no JPEG among the downloads");
  const s1 = pngSize(headlessPng);
  console.log(`scenario 1 PNG: ${s1.width}x${s1.height}, JPG: ${headlessJpg.length} bytes`);
  if (Math.abs(s1.height - expectedHeight) > 20) {
    fail(`scenario 1: height ${s1.height} not within 20px of ${expectedHeight}`);
  }
  if (s1.width < metrics.innerWidth * metrics.dpr - 40) {
    fail(`scenario 1: width ${s1.width} much smaller than viewport`);
  }
  fs.writeFileSync(path.join(artifactsDir, "e2e-capture.png"), headlessPng);

  // ---------- Scenario 2: preview tab with manual PNG + PDF buttons ----------
  console.log("scenario 2: preview tab, manual downloads");
  await worker.evaluate(() => chrome.storage.sync.set({ openPreview: true, autoFormats: [] }));
  await page.bringToFront();
  const viewerPromise = context.waitForEvent("page", {
    predicate: (p) => p.url().includes("viewer.html"),
    timeout: 30000,
  });
  await worker.evaluate(async (targetUrl) => {
    const [tab] = await chrome.tabs.query({ url: targetUrl });
    await captureFullPage(tab);
  }, url);
  const viewer = await viewerPromise;
  await viewer.waitForSelector("#preview canvas", { timeout: 30000 });
  await viewer.waitForFunction(() => !document.getElementById("download-png").disabled, null, {
    timeout: 30000,
  });
  const statusText = await viewer.locator("#status").textContent();
  console.log(`viewer status: ${statusText}`);
  await viewer.screenshot({ path: path.join(artifactsDir, "e2e-viewer.png") });

  // Zoom: the viewer opens fitted so the whole capture is visible at once,
  // clicking the image zooms in centered on the click, and the toolbar
  // magnifier zooms back out.
  const viewportH = await viewer.evaluate(() => window.innerHeight);
  const fitBox = await viewer.locator("#preview").boundingBox();
  console.log(`viewer fit: preview ${Math.round(fitBox.height)}px in ${viewportH}px viewport`);
  if (fitBox.height > viewportH) fail("zoom: preview does not fit the viewport on open");
  await viewer
    .locator("#preview")
    .click({ position: { x: fitBox.width / 2, y: fitBox.height / 2 } });
  const zoomedHeight = await viewer.evaluate(
    () => document.getElementById("preview").getBoundingClientRect().height
  );
  if (zoomedHeight <= viewportH) fail("zoom: clicking the preview did not zoom in");
  const zoomScrollY = await viewer.evaluate(() => window.scrollY);
  if (zoomScrollY <= 0) fail("zoom: did not scroll to the clicked spot");
  await viewer.screenshot({ path: path.join(artifactsDir, "e2e-viewer-zoomed.png") });
  await viewer.click("#zoom-toggle");
  const refitBox = await viewer.locator("#preview").boundingBox();
  if (refitBox.height > viewportH) fail("zoom: toolbar toggle did not zoom back out");

  before = await downloadCount(worker);
  await viewer.click("#download-png");
  const [pngBuf] = await waitForNewDownloads(worker, before);
  if (!isPng(pngBuf)) fail("scenario 2: PNG button did not produce a PNG");
  const s2 = pngSize(pngBuf);
  console.log(`scenario 2 PNG: ${s2.width}x${s2.height}`);
  if (Math.abs(s2.height - expectedHeight) > 20) {
    fail(`scenario 2: PNG height ${s2.height} not within 20px of ${expectedHeight}`);
  }

  before = await downloadCount(worker);
  await viewer.click("#download-jpg");
  const [jpgBuf] = await waitForNewDownloads(worker, before);
  if (jpgBuf.subarray(0, 2).toString("hex") !== "ffd8") {
    fail("scenario 2: JPG button did not produce a JPEG");
  }
  console.log(`scenario 2 JPG: ${jpgBuf.length} bytes`);

  before = await downloadCount(worker);
  await viewer.click("#download-pdf");
  const [pdfBuf] = await waitForNewDownloads(worker, before);
  const pdfText = pdfBuf.toString("latin1");
  if (!pdfText.startsWith("%PDF-1.4")) fail("scenario 2: PDF button did not produce a PDF");
  if (!pdfText.includes("/Count 1")) fail("scenario 2: PDF should have exactly one page");
  if (!pdfText.includes(`/Width ${s2.width}`)) fail("scenario 2: PDF image width mismatch");
  console.log(`scenario 2 PDF: ${pdfBuf.length} bytes, 1 page`);
  fs.writeFileSync(path.join(artifactsDir, "e2e-capture.pdf"), pdfBuf);
  await viewer.close();

  // ---------- Scenario 3: page scrolling inside an inner container ----------
  console.log("scenario 3: inner scroll container");
  await worker.evaluate(() =>
    chrome.storage.sync.set({ openPreview: false, autoFormats: ["png"] })
  );
  const containerPage = await context.newPage();
  await containerPage.goto(`${url}container`, { waitUntil: "networkidle" });
  const containerMetrics = await containerPage.evaluate(() => ({
    dpr: window.devicePixelRatio,
    scrollerWidth: document.getElementById("scroller").clientWidth,
  }));
  before = await downloadCount(worker);
  await containerPage.bringToFront();
  await worker.evaluate(async (targetUrl) => {
    const [tab] = await chrome.tabs.query({ url: targetUrl + "container" });
    if (!tab) throw new Error("container tab not found");
    await captureFullPage(tab);
  }, url);
  const [containerBuf] = await waitForNewDownloads(worker, before);
  if (!isPng(containerBuf)) fail("scenario 3: not a PNG");
  const s3 = pngSize(containerBuf);
  console.log(`scenario 3 PNG: ${s3.width}x${s3.height}`);
  const expectedInner = INNER_HEIGHT * containerMetrics.dpr;
  if (Math.abs(s3.height - expectedInner) > 20) {
    fail(`scenario 3: height ${s3.height} not within 20px of ${expectedInner} — container scroll broken`);
  }
  if (Math.abs(s3.width - containerMetrics.scrollerWidth * containerMetrics.dpr) > 40) {
    fail(`scenario 3: width ${s3.width} not cropped to the container`);
  }
  fs.writeFileSync(path.join(artifactsDir, "e2e-container.png"), containerBuf);
  await containerPage.close();

  // ---------- Scenario 3b: googlish page (footer scroll + inner container + JS sticky) ----------
  console.log("scenario 3b: googlish page");
  const googlishPage = await context.newPage();
  await googlishPage.goto(`${url}googlish`, { waitUntil: "networkidle" });
  before = await downloadCount(worker);
  await googlishPage.bringToFront();
  await worker.evaluate(async (targetUrl) => {
    const [tab] = await chrome.tabs.query({ url: targetUrl + "googlish" });
    if (!tab) throw new Error("googlish tab not found");
    await captureFullPage(tab);
  }, url);
  const [googlishBuf] = await waitForNewDownloads(worker, before);
  if (!isPng(googlishBuf)) fail("scenario 3b: not a PNG");
  const s3b = pngSize(googlishBuf);
  console.log(`scenario 3b PNG: ${s3b.width}x${s3b.height}`);
  const expectedGooglish = 4000 * metrics.dpr;
  if (Math.abs(s3b.height - expectedGooglish) > 40) {
    fail(`scenario 3b: height ${s3b.height} not near ${expectedGooglish} — truncated or repeated`);
  }
  fs.writeFileSync(path.join(artifactsDir, "e2e-googlish.png"), googlishBuf);
  await googlishPage.close();

  // ---------- Scenario 3c: lazy-growing page ----------
  console.log("scenario 3c: lazy-growing page");
  const growingPage = await context.newPage();
  await growingPage.goto(`${url}growing`, { waitUntil: "networkidle" });
  before = await downloadCount(worker);
  await growingPage.bringToFront();
  await worker.evaluate(async (targetUrl) => {
    const [tab] = await chrome.tabs.query({ url: targetUrl + "growing" });
    if (!tab) throw new Error("growing tab not found");
    await captureFullPage(tab);
  }, url);
  const [growingBuf] = await waitForNewDownloads(worker, before);
  const s3c = pngSize(growingBuf);
  console.log(`scenario 3c PNG: ${s3c.width}x${s3c.height}`);
  const expectedGrown = 5000 * metrics.dpr;
  if (Math.abs(s3c.height - expectedGrown) > 40) {
    fail(`scenario 3c: height ${s3c.height} not near ${expectedGrown} — growth not followed`);
  }
  fs.writeFileSync(path.join(artifactsDir, "e2e-growing.png"), growingBuf);
  await growingPage.close();

  // ---------- Scenario 4: Stop button in the progress popup cancels ----------
  // The real popup anchors to the toolbar icon (unreachable from Playwright),
  // so open progress.html as a tab: same page, same pull-state + cancel path.
  console.log("scenario 4: cancel via progress popup stop button");
  await page.bringToFront();
  before = await downloadCount(worker);
  await worker.evaluate((targetUrl) => {
    chrome.tabs.query({ url: targetUrl }).then(([tab]) => captureFullPage(tab));
  }, url);
  await sleep(1500); // capture underway
  const popupSet = await worker.evaluate(() => chrome.action.getPopup({}));
  if (!popupSet.includes("progress.html")) {
    fail(`scenario 4: icon popup not attached during capture (got "${popupSet}")`);
  }
  const extId = new URL(worker.url()).host;
  const progressPage = await context.newPage();
  await progressPage.goto(`chrome-extension://${extId}/progress.html`);
  await progressPage.waitForFunction(
    () => document.getElementById("bar").style.width !== "" && document.getElementById("bar").style.width !== "0%",
    null,
    { timeout: 10000 }
  );
  await progressPage.screenshot({ path: path.join(artifactsDir, "e2e-progress.png") });
  await progressPage.click("#stop");
  await sleep(8000); // ample time for the capture to have finished if not cancelled
  if ((await downloadCount(worker)) !== before) fail("scenario 4: capture completed despite Stop");
  const popupAfter = await worker.evaluate(() => chrome.action.getPopup({}));
  if (popupAfter !== "") fail(`scenario 4: icon popup not detached after cancel ("${popupAfter}")`);
  const err = await worker.evaluate(() => globalThis.__fpcLastError || null);
  if (err) fail(`scenario 4: cancel surfaced an error: ${err}`);
  // The popup must close itself on cancel — a frozen "Stopping…" panel reads
  // as the extension hanging.
  if (!progressPage.isClosed()) fail("scenario 4: progress popup did not close itself after Stop");
  console.log("scenario 4: cancelled cleanly, no download, popup closed itself");

  // ---------- Scenario 4b: second icon click cancels (fullscreen fallback) ----------
  console.log("scenario 4b: cancel via second toolbar click");
  before = await downloadCount(worker);
  await worker.evaluate((targetUrl) => {
    chrome.tabs.query({ url: targetUrl }).then(([tab]) => captureFullPage(tab));
  }, url);
  await sleep(1500); // capture underway
  await worker.evaluate((targetUrl) => {
    chrome.tabs.query({ url: targetUrl }).then(([tab]) => captureFullPage(tab)); // the "second click"
  }, url);
  await sleep(8000);
  if ((await downloadCount(worker)) !== before) {
    fail("scenario 4b: capture completed despite second click");
  }
  const err2 = await worker.evaluate(() => globalThis.__fpcLastError || null);
  if (err2) fail(`scenario 4b: second-click cancel surfaced an error: ${err2}`);
  const title = await worker.evaluate(() => chrome.action.getTitle({}));
  if (title !== "Capture full page screenshot") {
    fail(`scenario 4b: action title not restored (got "${title}")`);
  }
  console.log("scenario 4b: second click cancelled cleanly, title restored");

  if (process.exitCode !== 1) console.log("E2E PASS");
} catch (err) {
  fail(err.stack || String(err));
} finally {
  await context.close();
  server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}
