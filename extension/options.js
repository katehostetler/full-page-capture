import { DEFAULT_SETTINGS, normalizeSettings } from "./lib/settings.js";

const openPreviewEl = document.getElementById("openPreview");
const saveFolderEl = document.getElementById("saveFolder");
const formatEls = [...document.querySelectorAll('input[name="format"]')];
const savedEl = document.getElementById("saved");
const noticeEl = document.getElementById("notice");
let savedTimer = null;

const stored = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS, autoDownload: null });
const settings = normalizeSettings(stored);
openPreviewEl.checked = settings.openPreview;
saveFolderEl.value = settings.saveFolder;
for (const el of formatEls) el.checked = settings.autoFormats.includes(el.value);

async function save() {
  const raw = {
    openPreview: openPreviewEl.checked,
    autoFormats: formatEls.filter((el) => el.checked).map((el) => el.value),
    saveFolder: saveFolderEl.value,
  };
  const normalized = normalizeSettings(raw);

  // Preview off with nothing selected would make captures produce nothing;
  // normalizeSettings turns the preview back on — reflect that in the UI.
  const repaired = normalized.openPreview && !raw.openPreview;
  openPreviewEl.checked = normalized.openPreview;
  noticeEl.hidden = !repaired;

  await chrome.storage.sync.set(normalized);
  savedEl.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (savedEl.hidden = true), 1500);
}

openPreviewEl.addEventListener("change", save);
for (const el of formatEls) el.addEventListener("change", save);
saveFolderEl.addEventListener("change", save);
