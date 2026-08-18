import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  sanitizeSaveFolder,
  applySaveFolder,
} from "../extension/lib/settings.js";

describe("normalizeSettings", () => {
  it("returns defaults for empty or missing input", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid combinations, preserving canonical format order", () => {
    expect(normalizeSettings({ openPreview: true, autoFormats: ["pdf", "png"] })).toEqual({
      openPreview: true,
      autoFormats: ["png", "pdf"],
      saveFolder: "",
    });
    expect(normalizeSettings({ openPreview: false, autoFormats: ["jpg"] })).toEqual({
      openPreview: false,
      autoFormats: ["jpg"],
      saveFolder: "",
    });
  });

  it("forces the preview on when it is off with no auto formats", () => {
    expect(normalizeSettings({ openPreview: false, autoFormats: [] })).toEqual({
      openPreview: true,
      autoFormats: [],
      saveFolder: "",
    });
  });

  it("drops unknown formats and duplicate-proofs the list", () => {
    expect(
      normalizeSettings({ autoFormats: ["png", "webp", "png", "pdf"] }).autoFormats
    ).toEqual(["png", "pdf"]);
  });

  it("migrates the old single-choice autoDownload setting", () => {
    expect(normalizeSettings({ autoDownload: "pdf" }).autoFormats).toEqual(["pdf"]);
    expect(normalizeSettings({ autoDownload: "off" }).autoFormats).toEqual([]);
    expect(normalizeSettings({ openPreview: false, autoDownload: "png" })).toEqual({
      openPreview: false,
      autoFormats: ["png"],
      saveFolder: "",
    });
  });

  it("repairs invalid values to defaults", () => {
    expect(normalizeSettings({ openPreview: "yes", autoFormats: "png" })).toEqual(
      DEFAULT_SETTINGS
    );
  });

  it("carries the save folder through, sanitized", () => {
    expect(normalizeSettings({ saveFolder: " Screenshots/full page " }).saveFolder).toBe(
      "Screenshots/full page"
    );
  });
});

describe("sanitizeSaveFolder", () => {
  it("keeps normal names, including spaces and hyphens", () => {
    expect(sanitizeSaveFolder("My Screenshots/full-page")).toBe("My Screenshots/full-page");
  });

  it("blocks path traversal and absolute-ish input", () => {
    expect(sanitizeSaveFolder("../../etc")).toBe("etc");
    expect(sanitizeSaveFolder("/leading/slashes/")).toBe("leading/slashes");
    expect(sanitizeSaveFolder("a\\b")).toBe("a/b");
  });

  it("strips characters that are invalid in file paths", () => {
    expect(sanitizeSaveFolder('shots<>:"|?*2026')).toBe("shots2026");
  });

  it("returns empty string for unusable input", () => {
    expect(sanitizeSaveFolder("")).toBe("");
    expect(sanitizeSaveFolder("   ")).toBe("");
    expect(sanitizeSaveFolder(null)).toBe("");
    expect(sanitizeSaveFolder("..")).toBe("");
  });
});

describe("applySaveFolder", () => {
  it("prefixes when a folder is set and passes through when not", () => {
    expect(applySaveFolder("shots", "a.png")).toBe("shots/a.png");
    expect(applySaveFolder("", "a.png")).toBe("a.png");
  });
});
