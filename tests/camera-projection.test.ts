import { describe, expect, it } from "vitest";
import { frameContent, screenToWorld, wheelZoomFactor, worldToScreen, zoomAt, type Camera } from "../src/render/camera";
import { createGame } from "../src/game/state";
import { moonMission } from "../src/world/moon-mission";
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

describe("framing the predicted path", () => {
  it("opens the chart until a coast around Earth fits", () => {
    const game = createGame(moonMission);
    const camera: Camera = { x: 0, y: 0, zoom: 1 };
    frameContent(camera, 1440, 900, moonMission, game.prediction.path);
    const frame = moonMission.frame;
    if (!frame) throw new Error("frame");
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < game.prediction.path.length; i++) {
      minX = Math.min(minX, game.prediction.path[i].x);
      maxX = Math.max(maxX, game.prediction.path[i].x);
    }
    expect(maxX - minX).toBeGreaterThan(frame.maxX - frame.minX);
    const halfW = 1440 / (2 * camera.zoom);
    expect(camera.x - halfW).toBeLessThan(minX);
    expect(camera.x + halfW).toBeGreaterThan(maxX);
    expect(camera.zoom).toBeGreaterThanOrEqual(0.18);
    expect(camera.zoom).toBeLessThanOrEqual(6);
  });
});

describe("wheel zoom", () => {
  const oldK = 0.0011;
  const notch = 100;

  it("grows with the scroll and is symmetric in and out", () => {
    const small = wheelZoomFactor(-40, 0);
    const large = wheelZoomFactor(-200, 0);
    expect(small).toBeGreaterThan(1);
    expect(large).toBeGreaterThan(small);
    expect(wheelZoomFactor(200, 0)).toBeLessThan(wheelZoomFactor(40, 0));
    expect(wheelZoomFactor(40, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(120, 0) * wheelZoomFactor(-120, 0)).toBeCloseTo(1, 12);
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(3 * 16, 0), 12);
    expect(wheelZoomFactor(1, 2)).toBeCloseTo(wheelZoomFactor(800, 0), 12);
  });

  it("makes one mouse notch about two to three times the old log step", () => {
    const oldStep = notch * oldK;
    const nextStep = -Math.log(wheelZoomFactor(notch, 0));
    expect(nextStep / oldStep).toBeGreaterThan(2);
    expect(nextStep / oldStep).toBeLessThan(3);
  });

  it("keeps the point under the cursor and clamps the zoom", () => {
    const camera: Camera = { x: 40, y: -20, zoom: 1 };
    const before = screenToWorld(camera, 800, 600, 300, 200);
    zoomAt(camera, 800, 600, 300, 200, wheelZoomFactor(-notch, 0));
    const after = screenToWorld(camera, 800, 600, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(camera.zoom).toBeGreaterThan(1);

    zoomAt(camera, 800, 600, 300, 200, 1e6);
    expect(camera.zoom).toBe(6);
    zoomAt(camera, 800, 600, 300, 200, 1e-9);
    expect(camera.zoom).toBe(0.18);
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
