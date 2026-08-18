// Pure math for the viewer's fit/zoom toggle. Kept DOM-free so it can be
// unit-tested; viewer.js owns the actual elements and scroll calls.

// Scale that fits the whole image inside availWidth×availHeight, never
// enlarging past 100%.
export function fitScale(imageWidth, imageHeight, availWidth, availHeight) {
  if (imageWidth <= 0 || imageHeight <= 0) return 1;
  return Math.min(availWidth / imageWidth, availHeight / imageHeight, 1);
}

// Document scrollTop that centers the given fraction (0..1, top..bottom) of
// an image `zoomedHeight` tall starting at `offsetTop`, in a viewport
// `viewportHeight` tall.
export function zoomScrollTop(fraction, zoomedHeight, offsetTop, viewportHeight) {
  return Math.max(0, offsetTop + fraction * zoomedHeight - viewportHeight / 2);
}

// Inverse of zoomScrollTop: which fraction of the image currently sits at the
// viewport's center, clamped to 0..1.
export function visibleCenterFraction(scrollTop, viewportHeight, offsetTop, totalHeight) {
  if (totalHeight <= 0) return 0;
  const fraction = (scrollTop + viewportHeight / 2 - offsetTop) / totalHeight;
  return Math.min(1, Math.max(0, fraction));
}
