// Pure capture-planning logic, shared by the service worker, the offscreen
// stitcher, and the unit tests. No chrome.* or DOM APIs allowed in this file.

// Chrome caps canvas dimensions around 16384px; stay safely under it so a
// single slice never fails to rasterize.
export const MAX_SLICE_HEIGHT_PX = 16000;

// Safety valve for infinitely-scrolling or badly-measured pages.
export const MAX_FRAMES = 50;

// Downloads bigger than this get split into multiple files.
export const MAX_FILE_BYTES = 24 * 1024 * 1024;

/** How many files a blob of `bytes` must be split into to stay under the cap. */
export function splitCountForBytes(bytes, maxBytes = MAX_FILE_BYTES) {
  if (bytes <= maxBytes) return 1;
  return Math.ceil(bytes / maxBytes);
}

/**
 * `hostname_YYYY-MM-DD_HH.MM.SS.<ext>`, with an optional `_part<n>` suffix
 * when the page is too tall for a single PNG. Uses local time.
 */
export function buildFilename(hostname, date, part = null, ext = "png") {
  const host =
    String(hostname || "page")
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page";
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  const suffix = part ? `_part${part}` : "";
  return `${host}_${stamp}${suffix}.${ext}`;
}

/**
 * Split a stitched image of `totalPhysicalHeight` device px into canvas-safe
 * slices of at most `maxSliceHeight` px: [{ top, height }, ...].
 */
export function computeSlices(totalPhysicalHeight, maxSliceHeight = MAX_SLICE_HEIGHT_PX) {
  if (totalPhysicalHeight <= 0) return [];
  const slices = [];
  for (let top = 0; top < totalPhysicalHeight; top += maxSliceHeight) {
    slices.push({ top, height: Math.min(maxSliceHeight, totalPhysicalHeight - top) });
  }
  return slices;
}
