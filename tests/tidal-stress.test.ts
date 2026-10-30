import { describe, expect, it } from "vitest";
import { ember, simConfigFromLevel } from "../src/level/catalog";
import {
  tidalGlyphAxes,
  tidalPathChip,
  tidalRingPaint,
  tidalStrokeAlpha,
} from "../src/render/tidal-look";
import {
  advancePlan,
  cloneState,
  flyPlan,
  makeState,
  predictPlan,
  STRESS_WARN,
  tidalDamageRate,
  tidalDangerRadius,
  tidalStressAt,
  tidalTensorAt,
  type SimConfig,
} from "../src/sim/physics";

function axisDelta(a: number, b: number): number {
  const pi = Math.PI;
  let d = Math.abs(a - b) % pi;
  if (d > pi / 2) d = pi - d;
  return d;
}

function dwarfConfig(mass = 100_000): SimConfig {
  return {
    g: 1,
    dt: 1 / 60,
    c: 1_000_000,
    tidalStrength: 1,
    hullMax: 100,
    fuelStart: 80,
    bodies: [
      {
        id: "dwarf",
        name: "dwarf",
        kind: "star",
        look: "white-dwarf",
        x: 0,
        y: 0,
        mass,
        radius: 16,
      },
      {
        id: "x",
        name: "Planet X",
        kind: "target",
        x: 900,
        y: 0,
        mass: 0,
        radius: 18,
        captureRadius: 40,
      },
    ],
    bounds: { minX: -4000, maxX: 4000, minY: -4000, maxY: 4000 },
    maxSteps: 360,
    targetId: "x",
    periapsisMargin: 1,
  };
}

describe("tidal stress", () => {
  it("falls as 1/r³ and stays continuous across the level-3 ring", () => {
    const config = dwarfConfig();
    const body = config.bodies[0];
    const radius = tidalDangerRadius(body, 1, 1);
    expect(radius).toBeGreaterThan(body.radius);
    const at = (distance: number) => tidalDamageRate(tidalStressAt(distance, 0, config, 0));
    expect(at(radius)).toBeCloseTo(STRESS_WARN, 5);
    expect(at(radius * 2)).toBeCloseTo(STRESS_WARN / 8, 5);
    expect(at(radius * 3)).toBeCloseTo(STRESS_WARN / 27, 4);
    expect(at(radius * 1.7) / at(radius * 0.85)).toBeCloseTo((0.85 / 1.7) ** 3, 6);
    const eps = radius * 1e-3;
    expect(at(radius + eps)).toBeGreaterThan(0);
    expect(at(radius + eps)).toBeLessThan(STRESS_WARN);
    expect(at(radius - eps)).toBeGreaterThan(STRESS_WARN);
    expect(Math.abs(at(radius + eps) - at(radius - eps))).toBeLessThan(STRESS_WARN * 0.02);
    expect(at(body.radius)).toBe(0);
  });

  it("matches the flight hull exactly, including the tidal cost", () => {
    const config = dwarfConfig();
    const radius = tidalDangerRadius(config.bodies[0], 1, 1);
    const start = makeState(radius * 3.2, radius * 2.4, 36, -6, config);
    const nodes = [{ step: 30, dvx: 4, dvy: 1 }];
    const predicted = predictPlan(start, config, nodes);
    const flown = cloneState(start);
    const cursor = { index: 0 };
    let guard = 0;
    while (flown.status === "flying" && flown.step <= predicted.final.step && guard++ < config.maxSteps) {
      advancePlan(flown, config, nodes, cursor);
    }
    expect(predicted.final.hull).toBe(flown.hull);
    expect(flown.hull).toBeLessThan(start.hull);
    expect(flown.hull).toBeGreaterThan(0);

    let hull = start.hull;
    for (let i = 0; i < predicted.path.length; i++) {
      const sample = predicted.path[i];
      const stress = tidalStressAt(sample.x, sample.y, config, sample.step * config.dt);
      hull -= tidalDamageRate(stress) * config.dt;
    }
    expect(hull).toBe(predicted.final.hull);

    const again = flyPlan(cloneState(start), config, nodes, 4);
    const stepByStep = flyPlan(cloneState(start), config, nodes, 1);
    expect(again.steps).toBe(stepByStep.steps);
    expect(again.path[again.path.length - 1].x).toBe(stepByStep.path[stepByStep.path.length - 1].x);
  });

  it("points the stretch axis along one body and turns it between two", () => {
    const config = dwarfConfig();
    const radius = tidalDangerRadius(config.bodies[0], 1, 1);
    const alone = tidalTensorAt(radius, 0, config, 0);
    expect(alone.stress).toBe(tidalStressAt(radius, 0, config, 0));
    expect(alone.stretch).toBeCloseTo(alone.stress, 8);
    expect(axisDelta(alone.angle, 0)).toBeLessThan(1e-8);

    const pair: SimConfig = {
      ...config,
      bodies: [
        { ...config.bodies[0], id: "a", x: -140 },
        { ...config.bodies[0], id: "b", x: 140 },
        config.bodies[1],
      ],
    };
    const saddle = tidalTensorAt(20, 70, pair, 0);
    const leftOnly = tidalTensorAt(20, 70, { ...pair, bodies: [pair.bodies[0], pair.bodies[2]] }, 0);
    expect(saddle.stress).toBeGreaterThan(0);
    expect(axisDelta(saddle.angle, leftOnly.angle)).toBeGreaterThan(0.08);
  });

  it("colours rings from the HUD levels and sizes them from the header", () => {
    const trace = 0.06 * STRESS_WARN;
    const axes = tidalGlyphAxes(trace);
    expect(axes.a).toBeCloseTo(5.53, 2);
    expect(axes.b).toBeCloseTo(4.22, 2);
    expect(tidalStrokeAlpha(trace)).toBeCloseTo(0.465, 2);
    expect(tidalStrokeAlpha(STRESS_WARN)).toBeCloseTo(0.92, 5);
    expect(tidalRingPaint(trace).hex).toBe("#7FE0FF");
    expect(tidalRingPaint(trace).fill).toBe(0);
    expect(tidalRingPaint(STRESS_WARN / 2).hex).toBe("#FF9F43");
    expect(tidalRingPaint(STRESS_WARN).hex).toBe("#FF5A5F");
    expect(tidalRingPaint(STRESS_WARN).fill).toBeCloseTo(0.22);
  });

  it("chips the longest level-3 stretch with its time and hull cost", () => {
    const config = dwarfConfig();
    const radius = tidalDangerRadius(config.bodies[0], 1, 1);
    const inside = radius * 0.72;
    const outside = radius * 1.4;
    const stress = tidalStressAt(inside, 0, config, 0);
    expect(stress).toBeGreaterThan(STRESS_WARN);
    const path = [];
    for (let step = 1; step <= 40; step++) path.push({ x: outside, y: 0, step, rate: 1 });
    for (let step = 41; step <= 160; step++) path.push({ x: inside, y: 0, step, rate: 1 });
    for (let step = 161; step <= 180; step++) path.push({ x: outside, y: 0, step, rate: 1 });
    for (let step = 181; step <= 200; step++) path.push({ x: inside, y: 10, step, rate: 1 });
    const chip = tidalPathChip(path, config);
    expect(chip).not.toBeNull();
    const seconds = 120 * config.dt;
    const hull = stress * seconds;
    expect(chip?.seconds).toBeCloseTo(seconds, 8);
    expect(chip?.hull).toBeCloseTo(hull, 8);
    expect(chip?.x).toBe(inside);
    expect(chip?.text).toContain("path: tidal 3 for 0:02");
    expect(chip?.text).toContain("hull");
    expect(tidalPathChip(path.slice(0, 40), config)).toBeNull();

    const emberConfig = simConfigFromLevel(ember);
    expect(emberConfig.tidalStrength).toBe(1);
    expect(tidalDangerRadius(emberConfig.bodies[2], 1, 1)).toBeGreaterThan(16);
  });
});