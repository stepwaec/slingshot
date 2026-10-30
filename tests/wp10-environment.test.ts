import { describe, expect, it } from "vitest";
import { observatory } from "../src/level/catalog";
import {
  advancePlan,
  bodyPose,
  flyPlan,
  iceHarvestRate,
  makeState,
  nebulaCover,
  nebulaRadius,
  nebulaScoopRate,
  predictPlan,
  solarRechargeRate,
  type Body,
  type SimConfig,
} from "../src/sim/physics";

function expectFlightMatches(config: SimConfig, x: number, y: number): void {
  const state = makeState(x, y, 0, 0, config);
  const predicted = predictPlan(state, config, []);
  const flown = flyPlan(state, config, [], 1);
  expect(flown.status).toBe(predicted.status);
  expect(flown.path.length).toBe(predicted.path.length);
  expect(predicted.final.recharged).toBeGreaterThan(0);
  expect(predicted.final.hull).toBeGreaterThan(0);
  for (let i = 0; i < flown.path.length; i++) {
    expect(flown.path[i].x).toBe(predicted.path[i].x);
    expect(flown.path[i].y).toBe(predicted.path[i].y);
    expect(flown.path[i].step).toBe(predicted.path[i].step);
  }
  const replay = makeState(x, y, 0, 0, config);
  const cursor = { index: 0 };
  let guard = 0;
  while (replay.status === "flying" && guard++ < config.maxSteps + 2) advancePlan(replay, config, [], cursor);
  expect(replay.recharged).toBe(predicted.final.recharged);
  expect(replay.x).toBe(predicted.final.x);
  expect(replay.tank).toBe(predicted.final.tank);
}

describe("WP10 environment", () => {
  it("keeps a circular rail on the old formula and matches an ellipse of zero eccentricity to it", () => {
    const circle: Body = {
      id: "moon",
      name: "moon",
      kind: "moon",
      x: 0,
      y: 0,
      mass: 1,
      radius: 4,
      orbit: { cx: 10, cy: -4, radius: 30, phase: 0.3, omega: 0.2 },
    };
    for (const time of [0, 1.7, 12]) {
      const pose = bodyPose(circle, time, [circle]);
      const angle = 0.3 + 0.2 * time;
      expect(pose.x).toBe(10 + 30 * Math.cos(angle));
      expect(pose.y).toBe(-4 + 30 * Math.sin(angle));
      expect(pose.vx).toBe(-30 * 0.2 * Math.sin(angle));
      expect(pose.vy).toBe(30 * 0.2 * Math.cos(angle));
    }

    const mass = 8000;
    const a = 40;
    const mean = Math.sqrt(mass / (a * a * a));
    const star: Body = { id: "sun", name: "sun", kind: "star", x: 0, y: 0, mass, radius: 10 };
    const round: Body = {
      id: "round",
      name: "round",
      kind: "planet",
      x: 0,
      y: 0,
      mass: 1,
      radius: 2,
      orbit: { kind: "ellipse", centerId: "sun", a, e: 0, periapsisAngle: 0, phase: 0, radius: a, omega: 0 },
    };
    const rail: Body = {
      ...round,
      id: "rail",
      orbit: { centerId: "sun", radius: a, phase: 0, omega: mean },
    };
    for (const time of [0, 3, 11.5]) {
      const ellipse = bodyPose(round, time, [star, round], 1);
      const circlePose = bodyPose(rail, time, [star, rail], 1);
      expect(ellipse.x).toBeCloseTo(circlePose.x, 8);
      expect(ellipse.y).toBeCloseTo(circlePose.y, 8);
      expect(ellipse.vx).toBeCloseTo(circlePose.vx, 6);
      expect(ellipse.vy).toBeCloseTo(circlePose.vy, 6);
    }
  });

  it("runs faster at periapsis than at apoapsis, and the pose repeats", () => {
    const star: Body = { id: "sun", name: "sun", kind: "star", x: 5, y: -2, mass: 20000, radius: 20 };
    const comet: Body = {
      id: "comet",
      name: "comet",
      kind: "planet",
      look: "comet",
      x: 0,
      y: 0,
      mass: 1,
      radius: 5,
      orbit: { kind: "ellipse", centerId: "sun", a: 180, e: 0.6, periapsisAngle: 0.4, phase: 0, radius: 72, omega: 0 },
    };
    const bodies = [star, comet];
    const start = bodyPose(comet, 0, bodies, 1);
    const periapsis = 180 * (1 - 0.6);
    expect(Math.hypot(start.x - star.x, start.y - star.y)).toBeCloseTo(periapsis, 6);
    const period = (Math.PI * 2) / Math.sqrt(20000 / 180 ** 3);
    const far = bodyPose(comet, period / 2, bodies, 1);
    expect(Math.hypot(far.x - star.x, far.y - star.y)).toBeCloseTo(180 * (1 + 0.6), 4);
    expect(Math.hypot(start.vx, start.vy)).toBeGreaterThan(Math.hypot(far.vx, far.vy));
    const again = bodyPose(comet, 0, bodies, 1);
    expect(again.x).toBe(start.x);
    expect(again.y).toBe(start.y);
    expect(again.vx).toBe(start.vx);
  });

  it("harvests the Observatory comet and the prediction matches the flight", () => {
    const comet = observatory.bodies.find((body) => body.look === "comet");
    if (!comet?.harvestRadius) throw new Error("observatory comet");
    expect(comet.harvest).toBeGreaterThan(0);
    expect(comet.harvestRadius).toBeGreaterThan(comet.radius);
    const x = comet.x + (comet.radius + comet.harvestRadius) / 2;
    const y = comet.y;
    const config: SimConfig = {
      g: observatory.g,
      dt: observatory.dt,
      c: observatory.c,
      bodies: [comet],
      bounds: observatory.bounds,
      maxSteps: 8,
      targetId: comet.id,
      periapsisMargin: 1,
      fuelStart: 10,
      fuelMax: 100,
      fuelPerDv: 1,
    };
    expect(iceHarvestRate(x, y, 0, config.bodies, config.g)).toBeGreaterThan(0);
    expectFlightMatches(config, x, y);
  });

  it("scoops the Observatory emission nebula and the dark cloud hides its centre", () => {
    const cloud = observatory.nebulae?.find((item) => item.look === "emission");
    const dark = observatory.nebulae?.find((item) => item.look === "dark");
    if (!cloud || !dark) throw new Error("observatory nebulae");
    expect(nebulaScoopRate(cloud.x, cloud.y, [cloud])).toBe(cloud.scoop);
    const rimX = cloud.x + cloud.rx * Math.cos(cloud.angle);
    const rimY = cloud.y + cloud.rx * Math.sin(cloud.angle);
    expect(nebulaRadius(rimX, rimY, cloud)).toBeCloseTo(1, 6);
    expect(nebulaCover(dark.x, dark.y, [dark])).toBe(1);
    expect(nebulaCover(dark.x + dark.rx * 3, dark.y, [dark])).toBe(0);

    const parked: SimConfig = {
      g: observatory.g,
      dt: observatory.dt,
      c: observatory.c,
      bodies: [],
      nebulae: [cloud],
      bounds: observatory.bounds,
      maxSteps: 4,
      targetId: "none",
      periapsisMargin: 1,
      fuelStart: 10,
      fuelMax: 100,
      fuelPerDv: 1,
    };
    expectFlightMatches(parked, cloud.x, cloud.y);
    const inside = makeState(cloud.x, cloud.y, 0, 0, parked);
    const before = inside.tank;
    advancePlan(inside, parked, [], { index: 0 });
    expect(inside.tank).toBeGreaterThan(before);
    expect(inside.recharged).toBeCloseTo(nebulaScoopRate(inside.x, inside.y, parked.nebulae) * parked.dt, 8);
  });

  it("uses one solar rate for the tank and the indicator", () => {
    const star: Body = { id: "sun", name: "sun", kind: "star", look: "sun", x: 0, y: 0, mass: 0, radius: 40 };
    const surface = solarRechargeRate(0, 40, 0, [star], 12, 1);
    expect(surface).toBe(12);
    expect(solarRechargeRate(0, 170, 0, [star], 12, 1)).toBeCloseTo(3, 8);
    expect(solarRechargeRate(0, 400, 0, [star], 12, 1)).toBe(0);
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      c: 1_000_000,
      bodies: [star],
      bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
      maxSteps: 2,
      targetId: "none",
      periapsisMargin: 1,
      solarStrength: 12,
      fuelStart: 10,
      fuelMax: 100,
    };
    const state = makeState(0, 80, 0, 0, config);
    advancePlan(state, config, [], { index: 0 });
    expect(state.recharged).toBeCloseTo(solarRechargeRate(0, 80, config.dt, [star], 12, 1) * config.dt, 8);
    expect(state.recharged).toBeCloseTo(12 * config.dt, 8);
  });
});
