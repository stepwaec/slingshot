import { describe, expect, it } from "vitest";
import { simConfigFromLevel, passage } from "../src/level/catalog";
import {
  TIME_BANDS,
  TIME_WARM_S,
  clockDisplayS,
  rateAtDisplayS,
  timeBand,
} from "../src/render/palette";
import { theme } from "../src/render/theme";
import {
  PINCH_CELL,
  PINCH_REACH,
  bodyCompactness,
  clampPinch,
  contourAim,
  contourRadius,
  funnelRadius,
  funnelWeight,
  pinchTowardMasses,
  placeContourLabels,
} from "../src/render/gravityField";
import { horizonRadius, properTimeRate, type SimConfig } from "../src/sim/physics";

const gamma = theme.gravity.heatGamma;

const empty: SimConfig = {
  g: 1,
  dt: 1 / 60,
  c: 10,
  bodies: [],
  bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
  maxSteps: 100,
  targetId: "none",
  periapsisMargin: 1,
};

/** Black hole with r_s = r_b, the gravity-time.svg sample. */
function hole(radius = 22, x = 0, y = 0, id = "hole"): SimConfig {
  const c = 10;
  const mass = (radius * c * c) / 2;
  return {
    ...empty,
    c,
    bodies: [
      {
        id,
        name: id,
        kind: "blackhole",
        x,
        y,
        mass,
        radius,
      },
    ],
  };
}

describe("clock-rate bands", () => {
  it("follows rate^2.4 and keeps six unblended bands", () => {
    expect(gamma).toBe(2.4);
    expect(TIME_BANDS).toHaveLength(6);
    expect(clockDisplayS(1, gamma)).toBe(1);
    expect(clockDisplayS(0, gamma)).toBe(0);
    expect(clockDisplayS(0.9, gamma)).toBeCloseTo(Math.pow(0.9, 2.4), 12);
    expect(timeBand(1)).toBeNull();
    expect(timeBand(TIME_BANDS[0].sHigh)).toBeNull();

    const interiors = [0.84, 0.69, 0.51, 0.33, 0.17, 0.05];
    for (let i = 0; i < interiors.length; i++) {
      const band = timeBand(interiors[i]);
      expect(band?.id).toBe(TIME_BANDS[i].id);
      expect(band?.color).toBe(TIME_BANDS[i].color);
      expect(band?.alpha).toBe(TIME_BANDS[i].alpha);
    }
  });

  it("uses the header thresholds, with warm colour only deep in the well", () => {
    const edges = [0.9, 0.78, 0.6, 0.42, 0.24, 0.1];
    const labels = ["×0.96", "×0.90", "×0.81", "×0.70", "×0.55", "×0.38"];
    for (let i = 0; i < edges.length; i++) {
      expect(TIME_BANDS[i].sHigh).toBe(edges[i]);
      expect(TIME_BANDS[i].label).toBe(labels[i]);
      const rate = rateAtDisplayS(edges[i], gamma);
      expect(clockDisplayS(rate, gamma)).toBeCloseTo(edges[i], 12);
    }
    expect(TIME_WARM_S).toBe(0.6);
    expect(timeBand(clockDisplayS(0.93, gamma))?.id).toBe("slow1");
    expect(timeBand(clockDisplayS(0.85, gamma))?.id).toBe("slow2");
    expect(timeBand(clockDisplayS(0.85, gamma))?.color).toBe("#3D8BFF");
    expect(timeBand(clockDisplayS(0.7, gamma))?.id).toBe("amber");
    expect(timeBand(0)?.id).toBe("stop");
    expect(timeBand(0)?.color).toBe("#FFF3D6");
    expect(timeBand(0)?.alpha).toBe(0.97);
    for (const band of TIME_BANDS) {
      if (band.sHigh < TIME_WARM_S || band.id === "amber") expect(band.alpha).toBeGreaterThanOrEqual(0.92);
    }
    expect(TIME_BANDS[0].alpha).toBe(0.16);
    expect(TIME_BANDS[1].alpha).toBe(0.32);
  });
});

describe("gravity funnel", () => {
  it("crushes rings at a black hole and stays nearly flat far out", () => {
    const rb = 22;
    const c = 1;
    const r0 = rb * (1 + 3 * c);
    expect(funnelRadius(r0, rb, c)).toBeNull();
    expect(funnelRadius(r0 + 1e-6, rb, c)).toBeCloseTo(rb, 4);

    let previous = rb;
    for (let r = r0 + 0.5; r < 400; r += 7) {
      const next = funnelRadius(r, rb, c);
      expect(next).not.toBeNull();
      expect(next!).toBeGreaterThan(previous);
      previous = next!;
    }

    const near = funnelRadius(r0 + 2, rb, c)!;
    expect(near - rb).toBeLessThan(0.05);
    const farA = funnelRadius(800, rb, c)!;
    const farB = funnelRadius(801, rb, c)!;
    expect(farB - farA).toBeGreaterThan(0.98);
    expect(farB - farA).toBeLessThan(1.01);
    const shift = 3 * c * rb;
    expect(800 - farA).toBeGreaterThan(shift);
    expect(800 - farA).toBeLessThan(shift + rb);
  });

  it("keeps a sun on today's clamped pinch and drops the clamp on a black hole", () => {
    const sun = simConfigFromLevel(passage);
    const star = sun.bodies.find((body) => body.kind === "star");
    expect(star).toBeTruthy();
    const g = sun.g;
    expect(funnelWeight(bodyCompactness(star!, g, sun.c))).toBe(0);
    const knee = 40;
    const bare = pinchTowardMasses(120, -40, sun, 0, knee);
    const clamped = clampPinch(bare.dx, bare.dy, 18, 14);
    const shown = pinchTowardMasses(120, -40, sun, 0, knee, PINCH_REACH, 18, 14);
    expect(bare.funnel).toBe(0);
    expect(shown.funnel).toBe(0);
    expect(shown.dx).toBe(clamped.dx);
    expect(shown.dy).toBe(clamped.dy);

    const bh = hole(44);
    const body = bh.bodies[0];
    expect(horizonRadius(body.mass, bh.g, bh.c)).toBeCloseTo(body.radius, 8);
    expect(bodyCompactness(body, bh.g, bh.c)).toBe(1);
    expect(funnelWeight(1)).toBe(1);
    const step = 12;
    const at = 220;
    const pull = pinchTowardMasses(at, 0, bh, 0, knee, PINCH_REACH, step, step);
    expect(pull.funnel).toBe(1);
    expect(Math.hypot(pull.dx, pull.dy)).toBeGreaterThan(step * PINCH_CELL);
    expect(at + pull.dx).toBeCloseTo(funnelRadius(at, body.radius, 1)!, 6);
    expect(pull.dy).toBe(0);

    const inside = pinchTowardMasses(body.radius * 2, 0, bh, 0, knee, PINCH_REACH, step, step);
    expect(body.radius * 2 + inside.dx).toBeCloseTo(body.radius, 6);
  });

  it("blends two compact bodies by their potential shares", () => {
    const left = hole(10, -100, 0, "a");
    const rightBody = hole(10, 100, 0, "b").bodies[0];
    const config: SimConfig = { ...left, bodies: [...left.bodies, rightBody] };
    const mid = pinchTowardMasses(0, 0, config, 0, 20, PINCH_REACH, 8, 8);
    expect(mid.funnel).toBe(1);
    expect(mid.dx).toBeCloseTo(0, 6);
    expect(mid.dy).toBeCloseTo(0, 6);

    const nearer = pinchTowardMasses(50, 0, config, 0, 20, PINCH_REACH, 8, 8);
    expect(nearer.dx).toBeGreaterThan(5);
    const pure = funnelRadius(50, 10, 1)!;
    const pureX = 100 - pure;
    expect(50 + nearer.dx).toBeLessThan(pureX);
    expect(50 + nearer.dx).toBeGreaterThan(50);
  });

  it("samples contour labels on the true radii and skips crowded ones", () => {
    const rb = 22;
    const config = hole(rb, 400, 300);
    const aim = contourAim(theme.gravity.labelAngle);
    expect(aim.y).toBeGreaterThan(0);
    const expectR = (s: number) => {
      const rate = rateAtDisplayS(s, gamma);
      return rb / (1 - rate * rate);
    };
    for (const band of TIME_BANDS) {
      const found = contourRadius(
        config,
        0,
        400,
        300,
        aim.x,
        aim.y,
        rateAtDisplayS(band.sHigh, gamma),
        rb,
        rb * 80,
      );
      expect(found).toBeCloseTo(expectR(band.sHigh), 1);
    }
    const chips = placeContourLabels(
      config,
      0,
      (x, y) => ({ x, y }),
      1200,
      900,
      gamma,
      theme.gravity.labelAngle,
      theme.gravity.labelGapPx,
    );
    expect(chips.map((chip) => chip.text)).toEqual(["×0.96", "×0.90", "×0.81", "×0.55"]);
    const pose = { x: 400, y: 300 };
    expect(chips[0].r).toBeCloseTo(expectR(0.9), 1);
    const screen = (chip: (typeof chips)[number]) => ({
      x: pose.x + aim.x * chip.r,
      y: pose.y + aim.y * chip.r,
    });
    for (let i = 1; i < chips.length; i++) {
      const a = screen(chips[i - 1]);
      const b = screen(chips[i]);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(theme.gravity.labelGapPx);
    }
    expect(properTimeRate(pose.x + chips[0].r * aim.x, pose.y + chips[0].r * aim.y, 0, 0, config, 0)).toBeCloseTo(
      rateAtDisplayS(0.9, gamma),
      3,
    );
  });
});
