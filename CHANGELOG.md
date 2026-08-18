# Changelog

## v0.6.0 — 2026-08-18

- Preview tab now opens zoomed out so the whole capture is visible at once. Click the image (magnifying-glass cursor) to zoom in centered on that spot, click again — or use the new header magnifier button — to zoom back out.

## v0.5.0 — 2026-08-17

Initial public release.

- Full-page capture: scrolls, stitches, and saves as PNG, JPG, or PDF
- Preview tab with download buttons, or auto-download any combination of formats
- Optional save subfolder inside Downloads
- Toolbar progress popup with a live bar and Stop button
- Handles sticky headers, inner scroll containers (Google Images-style apps), and lazy-loading pages
- Splits very tall pages at the canvas limit and any file over ~24MB
- 100% local: no network requests, `activeTab`-only access
