import { stitchFrames, canvasesToImageBlobs, canvasesToPdfBlob } from "./lib/stitch.js";

// Frames accumulate here between fpc-reset and fpc-stitch messages.
let frames = [];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;
  if (message.type === "fpc-reset") {
    frames = [];
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "fpc-add-frame") {
    frames.push({ dataUrl: message.dataUrl, y: message.y });
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "fpc-stitch") {
    stitch(message)
      .then((items) => sendResponse({ items }))
      .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
    return true; // async response
  }
  return false;
});

async function stitch({ metrics, formats }) {
  const canvases = await stitchFrames(frames, metrics);
  frames = [];

  const items = [];
  for (const format of formats) {
    if (format === "pdf") {
      const blob = await canvasesToPdfBlob(canvases);
      items.push({ url: URL.createObjectURL(blob), ext: "pdf", part: null });
      continue;
    }
    const mime = format === "jpg" ? "image/jpeg" : "image/png";
    const blobs = await canvasesToImageBlobs(canvases, mime, format === "jpg" ? 0.9 : undefined);
    for (let i = 0; i < blobs.length; i++) {
      items.push({
        url: URL.createObjectURL(blobs[i]),
        ext: format,
        part: blobs.length > 1 ? i + 1 : null,
      });
    }
  }
  return items;
}
