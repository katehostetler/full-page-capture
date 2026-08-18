// Frame stitching shared by the offscreen document and the viewer tab.
// Needs a DOM (document.createElement("canvas")) — both callers are extension
// pages. Not usable from the service worker.
import { computeSlices, splitCountForBytes, MAX_FILE_BYTES } from "./plan.js";
import { buildPdf } from "./pdf.js";

/**
 * frames: [{ dataUrl, y }] where y is the achieved scroll offset in CSS px.
 * metrics: { totalHeight, windowHeight, rect } — rect is the scrolling
 * region's viewport box in CSS px (the full viewport when the window itself
 * scrolls; an inner container's box when the page scrolls inside one, in
 * which case each frame is cropped to it).
 * Returns canvases (one per slice, in order) at physical-pixel scale.
 */
export async function stitchFrames(frames, metrics) {
  if (!frames.length) throw new Error("No frames to stitch");
  const bitmaps = [];
  for (const frame of frames) {
    const blob = await (await fetch(frame.dataUrl)).blob();
    bitmaps.push({ bitmap: await createImageBitmap(blob), y: frame.y });
  }

  // Captures come back at physical-pixel size; derive the effective scale from
  // the first frame rather than trusting devicePixelRatio (zoom affects it).
  const windowHeight = metrics.windowHeight || metrics.viewportHeight;
  const scale = bitmaps[0].bitmap.height / windowHeight;
  const rect = metrics.rect || {
    x: 0,
    y: 0,
    width: bitmaps[0].bitmap.width / scale,
    height: windowHeight,
  };
  const src = {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
  const totalPhysicalHeight = Math.round(metrics.totalHeight * scale);

  const canvases = computeSlices(totalPhysicalHeight).map((slice) => {
    const canvas = document.createElement("canvas");
    canvas.width = src.width;
    canvas.height = slice.height;
    const ctx = canvas.getContext("2d");
    for (const { bitmap, y } of bitmaps) {
      ctx.drawImage(
        bitmap,
        src.x,
        src.y,
        src.width,
        src.height,
        0,
        Math.round(y * scale) - slice.top,
        src.width,
        src.height
      );
    }
    return canvas;
  });

  for (const { bitmap } of bitmaps) bitmap.close();
  return canvases;
}

export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))), type, quality)
  );
}

/**
 * Encode slice canvases as PNG or JPEG blobs, re-splitting any canvas whose
 * encoded file exceeds maxBytes so no single download is enormous.
 */
export async function canvasesToImageBlobs(canvases, type, quality, maxBytes = MAX_FILE_BYTES) {
  const blobs = [];
  for (const canvas of canvases) {
    const blob = await canvasToBlob(canvas, type, quality);
    const pieces = splitCountForBytes(blob.size, maxBytes);
    if (pieces === 1) {
      blobs.push(blob);
      continue;
    }
    const pieceHeight = Math.ceil(canvas.height / pieces);
    for (const slice of computeSlices(canvas.height, pieceHeight)) {
      const sub = document.createElement("canvas");
      sub.width = canvas.width;
      sub.height = slice.height;
      sub
        .getContext("2d")
        .drawImage(canvas, 0, slice.top, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      blobs.push(await canvasToBlob(sub, type, quality));
    }
  }
  return blobs;
}

/** One multi-page PDF (JPEG-compressed pages) from the slice canvases. */
export async function canvasesToPdfBlob(canvases) {
  const pages = [];
  for (const canvas of canvases) {
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    pages.push({
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    });
  }
  return new Blob([buildPdf(pages)], { type: "application/pdf" });
}
