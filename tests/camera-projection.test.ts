import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen, type Camera } from "../src/render/camera";
import { powerHex } from "../src/render/palette";

/** The pre-Three mapping. The orthographic camera must reproduce it. */
function analytic(camera: Camera, width: number, height: number, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - camera.x) * camera.zoom + width / 2,
    y: (camera.y - y) * camera.zoom + height / 2,
  };
}

describe("top-down camera", () => {
  const cameras: Camera[] = [
    { x: 0, y: 0, zoom: 1 },
    { x: 320, y: -80, zoom: 0.73 },
    { x: -40, y: 560, zoom: 2.4 },
    { x: 12.5, y: 4.25, zoom: 0.18 },
  ];
  const points = [
    [0, 0],
    [68, 0],
    [60, 560],
    [690, 30],
    [-200, 140],
  ];

  it("projects world points through the Three camera", () => {
    for (const camera of cameras) {
      for (const [x, y] of points) {
        const expected = analytic(camera, 1440, 900, x, y);
        const got = worldToScreen(camera, 1440, 900, x, y);
        expect(got.x).toBeCloseTo(expected.x, 4);
        expect(got.y).toBeCloseTo(expected.y, 4);
      }
    }
  });

  it("round-trips a screen point", () => {
    const camera: Camera = { x: 180, y: 240, zoom: 1.15 };
    const back = screenToWorld(camera, 1280, 720, 400, 250);
    const again = worldToScreen(camera, 1280, 720, back.x, back.y);
    expect(again.x).toBeCloseTo(400, 3);
    expect(again.y).toBeCloseTo(250, 3);
  });
});

describe("arrow power ramp", () => {
  it("hits the design stops, including 62%", () => {
    expect(powerHex(0)).toBe("#3DE0C2");
    expect(powerHex(0.5)).toBe("#FFC857");
    expect(powerHex(1)).toBe("#FF5A5F");
    expect(powerHex(0.62)).toBe("#FFAE59");
  });
});
