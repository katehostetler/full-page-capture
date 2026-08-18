import { describe, it, expect } from "vitest";
import {
  buildFilename,
  computeSlices,
  splitCountForBytes,
  MAX_SLICE_HEIGHT_PX,
  MAX_FILE_BYTES,
} from "../extension/lib/plan.js";

describe("buildFilename", () => {
  const date = new Date(2026, 7, 15, 9, 5, 3); // Aug 15 2026, 09:05:03 local

  it("formats hostname and local timestamp", () => {
    expect(buildFilename("example.com", date)).toBe("example.com_2026-08-15_09.05.03.png");
  });

  it("sanitizes characters that are invalid in filenames", () => {
    expect(buildFilename("Sub_Domain:8080/path", date)).toBe(
      "sub-domain-8080-path_2026-08-15_09.05.03.png"
    );
  });

  it("falls back when hostname is empty (e.g. file:// pages)", () => {
    expect(buildFilename("", date)).toBe("page_2026-08-15_09.05.03.png");
  });

  it("appends a part suffix for split captures", () => {
    expect(buildFilename("example.com", date, 2)).toBe("example.com_2026-08-15_09.05.03_part2.png");
  });

  it("supports other file extensions", () => {
    expect(buildFilename("example.com", date, null, "pdf")).toBe(
      "example.com_2026-08-15_09.05.03.pdf"
    );
  });
});

describe("computeSlices", () => {
  it("uses a single slice when under the canvas limit", () => {
    expect(computeSlices(5000)).toEqual([{ top: 0, height: 5000 }]);
  });

  it("splits tall images into canvas-safe slices", () => {
    const total = MAX_SLICE_HEIGHT_PX * 2 + 500;
    expect(computeSlices(total)).toEqual([
      { top: 0, height: MAX_SLICE_HEIGHT_PX },
      { top: MAX_SLICE_HEIGHT_PX, height: MAX_SLICE_HEIGHT_PX },
      { top: MAX_SLICE_HEIGHT_PX * 2, height: 500 },
    ]);
  });

  it("slices always sum to the total height", () => {
    const total = 40_321;
    const slices = computeSlices(total, 7000);
    expect(slices.reduce((sum, s) => sum + s.height, 0)).toBe(total);
  });

  it("returns no slices for an empty image", () => {
    expect(computeSlices(0)).toEqual([]);
  });
});

describe("splitCountForBytes", () => {
  it("keeps files under the cap whole", () => {
    expect(splitCountForBytes(1000)).toBe(1);
    expect(splitCountForBytes(MAX_FILE_BYTES)).toBe(1);
  });

  it("splits oversized files into enough pieces", () => {
    expect(splitCountForBytes(MAX_FILE_BYTES + 1)).toBe(2);
    expect(splitCountForBytes(MAX_FILE_BYTES * 2.5)).toBe(3);
  });

  it("respects a custom cap", () => {
    expect(splitCountForBytes(100, 30)).toBe(4);
  });
});
