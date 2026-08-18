import { buildFilename, MAX_FRAMES } from "./lib/plan.js";
import { DEFAULT_SETTINGS, normalizeSettings, applySaveFolder } from "./lib/settings.js";

// chrome.tabs.captureVisibleTab is rate-limited to ~2 calls/sec; this delay
// also gives lazy-loaded content a beat to render after each scroll.
const CAPTURE_DELAY_MS = 600;

let captureInProgress = false;
let cancelRequested = false;
let progressState = null; // { current, total } for late-loading progress windows

class CancelledError extends Error {}

// Captures waiting for their viewer tab to load, keyed by capture id.
const pendingCaptures = new Map();

chrome.action.onClicked.addListener((tab) => captureFullPage(tab));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-full-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) captureFullPage(tab);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "background") return false;
  if (message.type === "fpc-cancel") {
    cancelRequested = true;
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "fpc-progress-ready") {
    sendResponse(progressState || {});
    return false;
  }
  if (message.type === "fpc-viewer-ready") {
    const pending = pendingCaptures.get(message.captureId);
    if (!pending) {
      sendResponse({ error: "This capture has expired — take a new one." });
      return false;
    }
    pendingCaptures.delete(message.captureId);
    sendResponse({
      frameCount: pending.frames.length,
      metrics: pending.metrics,
      settings: pending.settings,
    });
    streamFramesToViewer(message.captureId, pending.frames);
    return false;
  }
  return false;
});

async function streamFramesToViewer(captureId, frames) {
  for (const frame of frames) {
    await chrome.runtime.sendMessage({
      target: "viewer",
      type: "fpc-frame",
      captureId,
      dataUrl: frame.dataUrl,
      y: frame.y,
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSettings() {
  // autoDownload is the pre-0.4 key; normalizeSettings migrates it.
  const stored = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS, autoDownload: null });
  return normalizeSettings(stored);
}

async function setBadge(text, color = "#E86A2F") {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

// The progress UI is the toolbar popup: during a capture the icon gains a
// popup (progress.html) with a live bar and a Stop button. Anchored to the
// icon, it stays visible even in macOS fullscreen (separate windows don't),
// and it's never part of the captured tab so it can't appear in screenshots.
async function attachProgressPopup() {
  await chrome.action.setPopup({ popup: "progress.html" });
  // Best-effort, fire-and-forget: openPopup can reject OR never settle (no
  // visible toolbar), so it must not be awaited — the capture would stall.
  try {
    chrome.action.openPopup().catch(() => {});
  } catch {
    // Not always permitted — the user can click the icon to see progress.
  }
}

async function updateProgress(current, total) {
  progressState = { current, total };
  // The badge shows completion percent, NOT a frame count — a "3/5" counter
  // reads as "you're getting 5 files", which it isn't.
  const percent = Math.min(99, Math.round((current / Math.max(total, 1)) * 100));
  await setBadge(`${percent}%`);
  try {
    await chrome.runtime.sendMessage({ target: "progress", type: "fpc-progress", current, total });
  } catch {
    // Popup not open right now; it pulls the state when it opens.
  }
}

async function detachProgressPopup() {
  progressState = null;
  // Tell an already-open popup to close itself — without this it sits
  // frozen at "Stopping…" after a cancel (or at NN% after completion).
  try {
    await chrome.runtime.sendMessage({ target: "progress", type: "fpc-done" });
  } catch {
    // Popup wasn't open.
  }
  await chrome.action.setPopup({ popup: "" });
}

async function captureFullPage(tab) {
  // Clicking the icon (or the shortcut) during a capture stops it — the
  // always-visible escape hatch, since the progress popup can be hidden by
  // macOS fullscreen Spaces.
  if (captureInProgress) {
    cancelRequested = true;
    return;
  }
  captureInProgress = true;
  cancelRequested = false;
  try {
    await chrome.action.setTitle({ title: "Capturing… click to stop" });
    await doCapture(tab);
    await setBadge("");
  } catch (err) {
    if (err instanceof CancelledError) {
      await setBadge("");
      return;
    }
    globalThis.__fpcLastError = String(err && err.stack ? err.stack : err);
    console.error("Full page capture failed:", err);
    await setBadge("ERR", "#d93025");
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  } finally {
    await chrome.action.setTitle({ title: "Capture full page screenshot" });
    await detachProgressPopup();
    captureInProgress = false;
  }
}

async function doCapture(tab) {
  const settings = await getSettings();

  const exec = (func, args = []) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });

  const [{ result: metrics }] = await exec(getPageMetrics);

  const vh = metrics.viewportHeight;
  const frames = [];
  // Lazy-loading pages (Google Images and friends) grow while we scroll and
  // may briefly clamp scrollTop until new content renders, so the loop is
  // adaptive: re-scroll after the settle delay, follow page growth, and retry
  // with extra waits before concluding the page has really ended.
  let targetEnd = metrics.totalHeight;
  let y = 0;
  let lastAchieved = -1;
  let stuckRetries = 0;

  if (targetEnd > vh) await attachProgressPopup();

  try {
    while (frames.length < MAX_FRAMES) {
      if (cancelRequested) throw new CancelledError();
      const estimatedFrames = Math.max(frames.length + 1, Math.ceil(targetEnd / vh));
      await updateProgress(frames.length + 1, estimatedFrames);

      await exec(scrollStep, [y, frames.length > 0]);
      await sleep(CAPTURE_DELAY_MS);
      if (cancelRequested) throw new CancelledError();
      // Re-issue the scroll after content had time to render: a lazy page may
      // have clamped the first attempt. Also re-hides any sticky bars the
      // page re-created meanwhile.
      const [{ result: step }] = await exec(scrollStep, [y, frames.length > 0]);
      targetEnd = Math.max(targetEnd, Math.min(step.total, MAX_FRAMES * vh));

      if (frames.length > 0 && step.y <= lastAchieved) {
        // No progress — give the lazy loader one more beat, twice, then stop.
        if (stuckRetries++ < 2) {
          await sleep(800);
          continue;
        }
        break;
      }
      stuckRetries = 0;

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      frames.push({ dataUrl, y: step.y });
      lastAchieved = step.y;
      if (step.y + vh >= targetEnd - 2) break; // reached the bottom
      y = step.y + vh;
    }
  } finally {
    await exec(restorePage, [metrics.originalScrollY]);
  }

  // The stitched canvas should cover exactly what was captured.
  metrics.totalHeight = lastAchieved + vh;
  metrics.capturedAt = Date.now();

  if (settings.openPreview) {
    // Hand off to the viewer tab: it stitches, previews, and also runs any
    // selected auto-downloads (so they aren't downloaded twice here).
    // Short id keeps the viewer tab's URL tidy; captures live seconds and
    // one at a time, so 8 hex chars is plenty.
    const captureId = crypto.randomUUID().slice(0, 8);
    pendingCaptures.set(captureId, { frames, metrics, settings });
    setTimeout(() => pendingCaptures.delete(captureId), 60_000);
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`viewer.html?capture=${captureId}`),
      index: tab.index + 1,
    });
    return;
  }

  // Headless path: download every selected format. normalizeSettings
  // guarantees autoFormats is non-empty whenever the preview is off.
  await setBadge("...");
  const items = await stitchInOffscreen(frames, metrics, settings.autoFormats);
  const when = new Date(metrics.capturedAt);
  for (const item of items) {
    await chrome.downloads.download({
      url: item.url,
      filename: applySaveFolder(
        settings.saveFolder,
        buildFilename(metrics.hostname, when, item.part, item.ext)
      ),
      saveAs: false,
    });
  }
}

async function stitchInOffscreen(frames, metrics, formats) {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Stitch captured frames into a full-page image and expose it as a blob URL.",
    });
  }
  // Frames are sent one at a time to stay under the runtime message size cap.
  await chrome.runtime.sendMessage({ target: "offscreen", type: "fpc-reset" });
  for (const frame of frames) {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "fpc-add-frame",
      dataUrl: frame.dataUrl,
      y: frame.y,
    });
  }
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "fpc-stitch",
    metrics,
    formats,
  });
  if (!response || response.error) {
    throw new Error(response ? response.error : "No response from offscreen stitcher");
  }
  return response.items;
}

// Exposed so the e2e harness can trigger a capture from the worker context,
// where no real toolbar click is possible.
globalThis.captureFullPage = captureFullPage;

// ---- Functions below are injected into the page, not run in the worker ----

function getPageMetrics() {
  const winScroller = document.scrollingElement || document.documentElement;
  const windowScrollable = winScroller.scrollHeight - window.innerHeight > 4;

  // Some pages (Google Images, many web apps) scroll inside an inner
  // container while the window itself barely moves (or not at all). Capturing
  // those by scrolling the window stitches the same viewport over and over —
  // find the largest scrollable element and compare how far each can
  // actually scroll.
  const windowRange = winScroller.scrollHeight - window.innerHeight;
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollHeight - el.clientHeight < 100) continue;
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue;
    const box = el.getBoundingClientRect();
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  // Prefer the container when the window can't scroll, or when the container
  // scrolls much further than the window (footer-only window scroll).
  let scroller = null; // null = the window scrolls
  if (best) {
    const containerRange = best.scrollHeight - best.clientHeight;
    if (!windowScrollable || containerRange > windowRange * 2) scroller = best;
  }
  window.__fpcScroller = scroller;

  let rect;
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    rect = {
      x: Math.max(0, box.left),
      y: Math.max(0, box.top),
      width: Math.min(box.width, window.innerWidth - Math.max(0, box.left)),
      height: Math.min(scroller.clientHeight, window.innerHeight - Math.max(0, box.top)),
    };
  } else {
    rect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  }

  return {
    totalHeight: scroller
      ? scroller.scrollHeight
      : Math.max(winScroller.scrollHeight, document.body ? document.body.scrollHeight : 0),
    viewportHeight: scroller ? rect.height : window.innerHeight,
    windowHeight: window.innerHeight,
    rect,
    dpr: window.devicePixelRatio,
    originalScrollY: scroller ? scroller.scrollTop : window.scrollY,
    hostname: location.hostname,
  };
}

function scrollStep(y, hideFixed) {
  document.documentElement.style.scrollBehavior = "auto";
  const scroller = window.__fpcScroller;
  if (hideFixed) {
    // Re-scan every frame: pages like Google re-create or re-fix their
    // sticky bars via JS on scroll, so hiding once is not enough.
    if (!window.__fpcHidden) window.__fpcHidden = [];
    const known = new Set(window.__fpcHidden.map(([el]) => el));
    for (const el of document.querySelectorAll("*")) {
      const position = getComputedStyle(el).position;
      if (position !== "fixed" && position !== "sticky") continue;
      if (!known.has(el)) window.__fpcHidden.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    }
  }
  if (scroller) {
    scroller.scrollTo({ top: y, behavior: "instant" });
    return { y: scroller.scrollTop, total: scroller.scrollHeight };
  }
  window.scrollTo({ top: y, behavior: "instant" });
  const winScroller = document.scrollingElement || document.documentElement;
  return { y: window.scrollY, total: winScroller.scrollHeight };
}

function restorePage(originalScrollY) {
  if (window.__fpcHidden) {
    for (const [el, visibility] of window.__fpcHidden) el.style.visibility = visibility;
    delete window.__fpcHidden;
  }
  const scroller = window.__fpcScroller;
  if (scroller) scroller.scrollTo({ top: originalScrollY, behavior: "instant" });
  else window.scrollTo({ top: originalScrollY, behavior: "instant" });
  delete window.__fpcScroller;
  document.documentElement.style.scrollBehavior = "";
}
