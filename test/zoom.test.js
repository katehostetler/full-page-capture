import { describe, it, expect } from "vitest";
import { fitScale, zoomScrollTop, visibleCenterFraction } from "../extension/lib/zoom.js";

describe("fitScale", () => {
  it("scales a tall image down so its height fits", () => {
    // 1000×9000 image into a 900×600 box: height is the constraint.
    expect(fitScale(1000, 9000, 900, 600)).toBeCloseTo(600 / 9000);
  });

  it("scales a wide image down so its width fits", () => {
    expect(fitScale(2000, 500, 900, 600)).toBeCloseTo(900 / 2000);
  });

  it("never scales up past 100% for small images", () => {
    expect(fitScale(300, 200, 900, 600)).toBe(1);
  });

  it("returns 1 for degenerate zero-size images", () => {
    expect(fitScale(0, 0, 900, 600)).toBe(1);
  });
});

describe("zoomScrollTop", () => {
  it("centers the clicked fraction of the image in the viewport", () => {
    // Clicked halfway down an image that is 8000px tall when zoomed,
    // starting 100px from the top of the document, in an 800px viewport:
    // target = 100 + 0.5*8000 - 800/2 = 3700.
    expect(zoomScrollTop(0.5, 8000, 100, 800)).toBe(3700);
  });

  it("clamps to the top of the document for clicks near the top", () => {
    expect(zoomScrollTop(0, 8000, 100, 800)).toBe(0);
  });
});

describe("visibleCenterFraction", () => {
  it("reports which fraction of the image is centered in the viewport", () => {
    // Scrolled so the viewport center sits at document y=4100 over an image
    // spanning 100..8100 → fraction (4100-100)/8000 = 0.5.
    expect(visibleCenterFraction(3700, 800, 100, 8000)).toBeCloseTo(0.5);
  });

  it("clamps to 0..1 when scrolled past the image edges", () => {
    expect(visibleCenterFraction(-500, 800, 100, 8000)).toBe(0);
    expect(visibleCenterFraction(999999, 800, 100, 8000)).toBe(1);
  });

  it("returns 0 for a degenerate zero-height image", () => {
    expect(visibleCenterFraction(0, 800, 100, 0)).toBe(0);
  });
});
