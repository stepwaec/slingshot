import { describe, expect, it } from "vitest";
import { observatory, simConfigFromLevel } from "../src/level/catalog";
import { shipOnCircle } from "../src/world/orbit";
import { moonMission } from "../src/world/moon-mission";
import { solWorld } from "../src/world/sol";
import {
  tidalGlyphAxes,
  tidalPathChip,
  tidalRingPaint,
  tidalStrokeAlpha,
} from "../src/render/tidal-look";
import {
  advancePlan,
  cloneState,
  bodyPose,
  flyPlan,
  makeState,
  predictPlan,
  STRESS_WARN,
  TIDAL_VISIBLE,
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
  it("falls as 1/r³ above the visible line and is zero below it", () => {
    const config = dwarfConfig();
    const body = config.bodies[0];
    const radius = tidalDangerRadius(body, 1);
    expect(radius).toBeGreaterThan(body.radius);
    const at = (distance: number) => tidalDamageRate(tidalStressAt(distance, 0, config, 0));
    const raw = (distance: number) => tidalStressAt(distance, 0, config, 0);
    expect(raw(radius)).toBeCloseTo(TIDAL_VISIBLE, 4);
    const insideLine = radius * 0.99;
    expect(raw(insideLine)).toBeGreaterThan(TIDAL_VISIBLE);
    expect(at(insideLine)).toBeCloseTo(raw(insideLine), 8);
    expect(at(radius * 1.2)).toBe(0);
    expect(raw(radius * 1.2)).toBeGreaterThan(0);
    expect(raw(radius * 1.2)).toBeLessThan(TIDAL_VISIBLE);
    expect(at(radius * 0.8)).toBeCloseTo(TIDAL_VISIBLE / 0.8 ** 3, 4);
    expect(at(radius * 0.5) / at(radius * 0.8)).toBeCloseTo((0.8 / 0.5) ** 3, 5);
    const eps = radius * 1e-4;
    expect(at(radius + eps)).toBe(0);
    expect(at(radius - eps)).toBeGreaterThan(TIDAL_VISIBLE);
    expect(at(body.radius)).toBe(0);
  });

  it("matches the flight hull exactly, including the tidal cost", () => {
    const config = { ...dwarfConfig(), maxSteps: 80 };
    const radius = tidalDangerRadius(config.bodies[0], 1);
    const distance = radius * 0.97;
    const speed = Math.sqrt(config.bodies[0].mass / distance);
    const start = makeState(distance, 0, 0, speed, config);
    const nodes: { step: number; dvx: number; dvy: number }[] = [];
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
    const radius = tidalDangerRadius(config.bodies[0], 1);
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
    expect(tidalRingPaint((TIDAL_VISIBLE + STRESS_WARN) / 2).hex).toBe("#FF9F43");
    expect(tidalRingPaint(STRESS_WARN).hex).toBe("#FF5A5F");
    expect(tidalRingPaint(STRESS_WARN).fill).toBeCloseTo(0.22);
  });

  it("chips the longest level-3 stretch with its time and hull cost", () => {
    const config = dwarfConfig();
    const radius = tidalDangerRadius(config.bodies[0], 1);
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
    expect(tidalDangerRadius(config.bodies[0], 1)).toBeGreaterThan(16);
  });

  it("stays under the line for ordinary Sol planets and crosses it near the Sun and a black hole", () => {
    const config = {
      g: solWorld.g,
      dt: solWorld.dt,
      c: solWorld.c,
      bodies: solWorld.bodies,
      bounds: solWorld.bounds,
      maxSteps: 200,
      targetId: "earth",
      periapsisMargin: 4,
    };
    const ship = shipOnCircle(solWorld.bodies, "earth", 52, Math.PI, solWorld.g);
    expect(tidalStressAt(ship.x, ship.y, config, 0)).toBeLessThan(TIDAL_VISIBLE);
    expect(tidalDamageRate(tidalStressAt(ship.x, ship.y, config, 0))).toBe(0);
    for (const id of ["mercury", "venus", "mars", "luna"] as const) {
      const body = solWorld.bodies.find((item) => item.id === id);
      if (!body) throw new Error(id);
      const pose = bodyPose(body, 0, solWorld.bodies, solWorld.g);
      const distance = Math.max(body.radius * 2.5, body.radius + 30);
      const stress = tidalStressAt(pose.x + distance, pose.y, config, 0);
      expect(stress, id).toBeLessThan(TIDAL_VISIBLE);
      expect(tidalDamageRate(stress), id).toBe(0);
    }
    const jupiter = solWorld.bodies.find((item) => item.id === "jupiter");
    if (!jupiter) throw new Error("jupiter");
    const jupiterPose = bodyPose(jupiter, 0, solWorld.bodies, solWorld.g);
    const cloudTop = tidalStressAt(jupiterPose.x + jupiter.radius + 2, jupiterPose.y, config, 0);
    expect(cloudTop).toBeLessThan(TIDAL_VISIBLE);
    const sun = solWorld.bodies.find((item) => item.id === "sun");
    if (!sun) throw new Error("sun");
    const sunNear = tidalStressAt(sun.x + sun.radius * 1.4, sun.y, config, 0);
    expect(sunNear).toBeGreaterThan(TIDAL_VISIBLE);
    expect(tidalDamageRate(sunNear)).toBe(sunNear);

    const hole = observatory.bodies.find((body) => body.kind === "blackhole");
    if (!hole) throw new Error("black hole");
    const observatoryConfig = simConfigFromLevel(observatory);
    expect(tidalDangerRadius(hole, observatory.g)).toBeGreaterThan(hole.radius);
    expect(tidalStressAt(hole.x + hole.radius + 0.2, hole.y, observatoryConfig, 0)).toBeGreaterThanOrEqual(TIDAL_VISIBLE);
    for (const look of ["neutron", "pulsar", "magnetar"] as const) {
      const body = observatory.bodies.find((item) => item.look === look);
      if (!body) throw new Error(look);
      expect(tidalDangerRadius(body, observatory.g), look).toBeGreaterThan(body.radius + 4);
    }

    const mission = simConfigFromLevel(moonMission);
    const start = makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, mission);
    const short = { ...mission, maxSteps: 180 };
    const predicted = predictPlan(start, short, []);
    const flown = flyPlan(start, short, [], 1);
    expect(flown.status).toBe(predicted.status);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
    }
  });
});