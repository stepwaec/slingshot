import { describe, expect, it } from "vitest";
import { rasterPixels } from "../src/render/art-sprite";
import { svgSizedForRaster } from "../src/render/svg-bake";

describe("svg raster size", () => {
  it("paints at the canvas size and keeps the viewBox", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle r="34"/></svg>`;
    const sized = svgSizedForRaster(svg, 480, 480);
    expect(sized).toContain('width="480"');
    expect(sized).toContain('height="480"');
    expect(sized).toContain('viewBox="0 0 120 120"');
    expect(sized).not.toContain('width="120"');
  });

  it("adds a viewBox from the old size before overwriting it", () => {
    const sized = svgSizedForRaster(`<svg width="40" height="20"></svg>`, 80, 40);
    expect(sized).toContain('viewBox="0 0 40 20"');
    expect(sized).toContain('width="80"');
    expect(sized).toContain('height="40"');
  });

  it("bakes viewBox × DPR × zoom without stretching a strip", () => {
    expect(rasterPixels(120, 120, 2, 1)).toEqual({ width: 240, height: 240 });
    const strip = rasterPixels(428, 68, 1, 0.25);
    expect(strip.width / strip.height).toBeCloseTo(428 / 68, 1);
    expect(strip.height).toBeLessThan(32);
    const capped = rasterPixels(600, 600, 2, 4);
    expect(Math.max(capped.width, capped.height)).toBeLessThanOrEqual(2048);
    expect(capped.width).toBe(capped.height);
  });
});
