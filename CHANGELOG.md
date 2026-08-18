# Changelog

All notable changes to the chrome-ext project will be documented in this file.

---

## 2026-08-17 (repo tidy for public release)

### Changed
- All extension code moved into `extension/` — the repo root is now just README, LICENSE, CHANGELOG, and four folders; "Load unpacked" points at `extension/`
- e2e harnesses simplified: they copy the `extension/` folder wholesale instead of maintaining a file list

---


## 2026-08-17 (progress redesign + public-repo prep) — v0.5.0

### Changed
- Progress is now a real toolbar popup: during capture, clicking the icon opens a 320px panel with a percentage progress bar and a "✕ Stop capture" button (anchored to the icon, so it works in macOS fullscreen); the separate popup window is gone
- Badge shows percent done (e.g. `42%`) instead of a frame counter — "3/5" wrongly implied five output files
- README rewritten for the public repo: simple install/use instructions and a prominent privacy section (100% local, zero network calls, activeTab-only)
- Keyboard shortcut Alt+Shift+P still cancels a running capture

### Added
- MIT LICENSE
- Settings screenshot in the README (`docs/settings.png`)

### Fixed
- `chrome.action.openPopup()` is no longer awaited — it can hang indefinitely and was able to stall a capture
- Progress popup no longer freezes at "Stopping…" — it now closes itself when the capture ends or is cancelled
- Viewer tab URL trimmed: capture ids are 8 characters instead of a full UUID (the letter-jumble before `/viewer.html` is the extension id Chrome assigns — that part is Chrome's, not removable)

---

## 2026-08-17 (fix: always-available stop) — v0.4.2

### Added
- Clicking the toolbar icon (or pressing Alt+Shift+P) during a capture now stops it — needed because the progress popup window can be invisible when Chrome is macOS-fullscreen (new windows open in a separate Space); tooltip reads "Capturing… click to stop" while running

---

## 2026-08-17 (fix: lazy-page truncation) — v0.4.1

### Fixed
- Google Images-style pages no longer truncate after a few frames: the scroller is chosen by comparing scrollable range (an inner container beats a footer-only window scroll), scrolls are re-issued after the settle delay, the loop retries twice before concluding the page ended, and page growth is followed (up to 50 frames)
- Sticky bars that re-fix themselves via JS on scroll are re-hidden before every frame instead of once

### Removed
- `computeScrollPositions` (pre-planned scroll offsets) — replaced by the adaptive loop

---

## 2026-08-17 (later still: settings redesign, steady progress window, save location) — v0.4.0

### Added
- Auto-download is now **multi-select** (PNG/JPG/PDF checkboxes, any combination); old single-choice setting migrates automatically
- Save-location setting: a subfolder inside Downloads (blank = Downloads root) — Chrome only permits extensions to write inside Downloads
- Progress UI is now a small separate popup window (like GoFullPage's) that stays steadily visible with only the bar moving; it can't appear in the screenshot, so the old per-frame hide/show flicker is gone entirely

### Changed
- Settings rule: preview off + no formats selected would produce nothing, so the preview auto-re-enables with an explanatory notice (replaces the confusing "falls back to PNG" footnote)
- With the preview open, auto-downloads run from the viewer; headless captures download every selected format
- Version 0.4.0

### Removed
- Injected in-page progress overlay (replaced by the popup window)

---

## 2026-08-17 (later: icon, JPG, progress + cancel, container-scroll fix) — v0.3.0

### Added
- JPG as a download option (viewer button + settings radio + headless auto-download)
- In-page progress popup during capture: progress bar, frame counter, and a Stop button that cancels cleanly; hidden at the instant of each capture so it never appears in the screenshot
- Size-based file splitting: PNG/JPG downloads over ~24MB are split into `_part<n>` files

### Fixed
- Pages that scroll inside an inner container (e.g. Google Images) previously stitched the same viewport repeatedly — the real scroller is now detected, scrolled, and frames are cropped to it; capture also stops if the scroll position stops advancing
- Overlay could appear in the first captured frame — injected DOM changes now wait for a repaint (double rAF) before capture

### Changed
- Toolbar icon redesigned: camera fills the full canvas with a transparent background (was small inside a rounded tile)
- Version bump to 0.3.0

---

## 2026-08-17 (feature: preview tab, PDF export, settings) — v0.2.0

### Added
- Preview tab after capture: shows the stitched screenshot with Download PNG / Download PDF buttons (`viewer.html/js/css`)
- PDF export via `lib/pdf.js`, a dependency-free writer embedding JPEG pages; long split captures become one multi-page PDF
- Settings page (`options.html`, embedded options UI): preview tab on/off, auto-download Off/PNG/PDF, stored in `chrome.storage.sync`
- `lib/stitch.js` — canvas stitching shared by viewer and offscreen document
- `lib/settings.js` — settings defaults + validation
- 11 new unit tests (PDF structure/xref, settings normalization, filename extensions) — 25 total
- e2e scenario 2: preview tab opens, both download buttons clicked and files verified (PNG dimensions, PDF page structure)

### Changed
- Default behavior: preview tab opens and auto-download is off (was: always auto-download PNG). If both are turned off, captures fall back to PNG download
- Runtime messages now carry a `target` field (background/viewer/offscreen routing)
- Version bump to 0.2.0; added `storage` permission and `options_ui`

---

## 2026-08-17

### Added
- Toolbar icon: cute camera on a light orange background (`icons/icon.svg` + generated 16/32/48/128 PNGs, wired into manifest `icons` and `action.default_icon`)
- `scripts/make-icons.mjs` — regenerates icon PNGs from the SVG via Playwright
- `e2e/demo-capture.mjs` — capture any real URL from the terminal for manual testing

### Changed
- e2e harnesses copy `icons/` into the test extension so the manifest stays loadable

---

## 2026-08-15 (feature: full-page capture)

### Added
- MV3 extension "Full Page Capture": toolbar click or Alt+Shift+P scrolls the page, captures each viewport via `captureVisibleTab`, stitches frames in an offscreen document, and auto-downloads the PNG (`hostname_date_time.png`, no save dialog)
- Fixed/sticky elements hidden after the first frame so headers don't repeat
- Tall pages split into `_part<n>.png` files at the ~16,000px canvas limit
- Unit tests (vitest, 14 tests) for scroll planning, filename building, and slice math
- End-to-end test (`e2e/run-e2e.mjs`): loads the unpacked extension in Playwright Chromium, captures a 5,000px page, verifies PNG dimensions (1000×5000 confirmed)

---

## 2026-08-15

### Added
- Initialized project with git
- Created `CHANGELOG.md` for tracking all changes
- Created `README.md` with project overview and structure
