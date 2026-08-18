import { buildFilename } from "./lib/plan.js";
import { applySaveFolder } from "./lib/settings.js";
import { stitchFrames, canvasesToImageBlobs, canvasesToPdfBlob } from "./lib/stitch.js";
import { fitScale, zoomScrollTop, visibleCenterFraction } from "./lib/zoom.js";

const captureId = new URLSearchParams(location.search).get("capture");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const previewEl = document.getElementById("preview");
const zoomBtn = document.getElementById("zoom-toggle");
const pngBtn = document.getElementById("download-png");
const jpgBtn = document.getElementById("download-jpg");
const pdfBtn = document.getElementById("download-pdf");

const frames = [];
let expectedFrames = null;
let meta = null;
let settings = null;
let canvases = null;
let rendering = false;

function showError(message) {
  statusEl.textContent = "";
  errorEl.textContent = message;
  errorEl.hidden = false;
}

// Register the frame listener BEFORE announcing readiness so no frame is missed.
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "viewer" || message.captureId !== captureId) return;
  if (message.type === "fpc-frame") {
    frames.push({ dataUrl: message.dataUrl, y: message.y });
    statusEl.textContent = `Receiving frames… ${frames.length}${expectedFrames ? `/${expectedFrames}` : ""}`;
    maybeRender();
  }
});

async function maybeRender() {
  if (rendering || expectedFrames === null || frames.length < expectedFrames) return;
  rendering = true;
  statusEl.textContent = "Stitching your screenshot…";
  try {
    canvases = await stitchFrames(frames, meta);
    frames.length = 0;
    for (const canvas of canvases) previewEl.appendChild(canvas);

    const width = canvases[0].width;
    const height = canvases.reduce((sum, c) => sum + c.height, 0);
    statusEl.textContent = `${width}×${height}px`;
    imageSize = { width, height };
    applyZoomState();
    for (const btn of [zoomBtn, pngBtn, jpgBtn, pdfBtn]) btn.disabled = false;

    for (const format of settings.autoFormats) {
      if (format === "png") downloadImage("image/png", "png");
      if (format === "jpg") downloadImage("image/jpeg", "jpg");
      if (format === "pdf") downloadPdf();
    }
  } catch (err) {
    showError(`Stitching failed: ${err.message || err}`);
  }
}

// Oversized results are split into multiple files (see canvasesToImageBlobs),
// so the blob list — not the canvas list — decides part numbering.
async function downloadImage(mime, ext) {
  const when = new Date(meta.capturedAt);
  const blobs = await canvasesToImageBlobs(canvases, mime, mime === "image/jpeg" ? 0.9 : undefined);
  for (let i = 0; i < blobs.length; i++) {
    await chrome.downloads.download({
      url: URL.createObjectURL(blobs[i]),
      filename: applySaveFolder(
        settings.saveFolder,
        buildFilename(meta.hostname, when, blobs.length > 1 ? i + 1 : null, ext)
      ),
      saveAs: false,
    });
  }
}

async function downloadPdf() {
  const blob = await canvasesToPdfBlob(canvases);
  await chrome.downloads.download({
    url: URL.createObjectURL(blob),
    filename: applySaveFolder(
      settings.saveFolder,
      buildFilename(meta.hostname, new Date(meta.capturedAt), null, "pdf")
    ),
    saveAs: false,
  });
}

// --- Fit/zoom toggle ---------------------------------------------------
// The page opens zoomed out (whole capture scaled to fit the window).
// Clicking the image zooms in centered on the clicked spot; clicking again —
// or the toolbar magnifier — zooms back out. Canvases keep their full
// resolution; only the CSS width of #preview changes.
let imageSize = null;
let zoomed = false;

const previewTop = () => previewEl.getBoundingClientRect().top + window.scrollY;

function applyZoomState() {
  if (!imageSize) return;
  document.body.classList.toggle("zoomed", zoomed);
  previewEl.classList.toggle("zoomed", zoomed);
  previewEl.classList.toggle("fit", !zoomed);
  zoomBtn.setAttribute("aria-label", zoomed ? "Zoom out" : "Zoom in");
  zoomBtn.title = zoomed ? "Zoom out" : "Zoom in";
  if (zoomed) {
    previewEl.style.width = "";
    return;
  }
  const headerHeight = document.querySelector("header").offsetHeight;
  const gaps = (canvases.length - 1) * 4;
  const availWidth = previewEl.parentElement.clientWidth - 48;
  const availHeight = window.innerHeight - headerHeight - 48 - gaps;
  const scale = fitScale(imageSize.width, imageSize.height, availWidth, availHeight);
  previewEl.style.width = `${Math.max(1, Math.floor(imageSize.width * scale))}px`;
}

// fraction = which part of the image (0 top .. 1 bottom) to center afterwards.
function setZoomed(next, fraction) {
  zoomed = next;
  applyZoomState();
  if (zoomed) {
    window.scrollTo(0, zoomScrollTop(fraction, previewEl.offsetHeight, previewTop(), window.innerHeight));
  } else {
    window.scrollTo(0, 0);
  }
}

previewEl.addEventListener("click", (event) => {
  if (!imageSize) return;
  if (zoomed) {
    setZoomed(false);
  } else {
    const rect = previewEl.getBoundingClientRect();
    setZoomed(true, (event.clientY - rect.top) / rect.height);
  }
});

zoomBtn.addEventListener("click", () => {
  if (!imageSize) return;
  const fraction = visibleCenterFraction(
    window.scrollY,
    window.innerHeight,
    previewTop(),
    previewEl.offsetHeight
  );
  setZoomed(!zoomed, fraction);
});

window.addEventListener("resize", () => {
  if (!zoomed) applyZoomState();
});

pngBtn.addEventListener("click", () => downloadImage("image/png", "png"));
jpgBtn.addEventListener("click", () => downloadImage("image/jpeg", "jpg"));
pdfBtn.addEventListener("click", downloadPdf);

const init = await chrome.runtime.sendMessage({
  target: "background",
  type: "fpc-viewer-ready",
  captureId,
});
if (!init || init.error) {
  showError(init ? init.error : "Could not reach the extension. Take a new capture.");
} else {
  meta = init.metrics;
  settings = init.settings;
  expectedFrames = init.frameCount;
  maybeRender();
}
