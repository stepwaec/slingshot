import { describe, expect, it } from "vitest";
import { createGame, setPlan, toggleRadiation } from "../src/game/state";
import { shipLoadout } from "../src/game/upgrades";
import { passage, shade, simConfigFromLevel, wander, type Level } from "../src/level/catalog";
import { shadePlan, slingshotPlan, wanderPlan } from "../src/level/solutions";
import {
  DOSE_COSMIC,
  DOSE_DISK,
  DOSE_FLARE_K,
  DOSE_FLARE_R,
  DOSE_PULSAR,
  DOSE_STAR_K,
  DOSE_STAR_R0,
  acceleration,
  advancePlan,
  bodyPose,
  doseAt,
  flyPlan,
  makeState,
  predictPlan,
  solarRechargeRate,
  starLuminosity,
  step,
  type Body,
  type BurnNode,
} from "../src/sim/physics";

function expectFlightMatches(level: Level, nodes: readonly BurnNode[]): void {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const predicted = predictPlan(state, config, nodes);
  const flown = flyPlan(state, config, nodes, 1);
  expect(flown.status).toBe("won");
  expect(predicted.status).toBe("won");
  expect(predicted.final.dose).toBeGreaterThan(0);
  expect(predicted.final.dose).toBeLessThan(level.physics?.doseLimit ?? 0);
  expect(flown.path.length).toBe(predicted.path.length);
  for (let i = 0; i < flown.path.length; i++) {
    expect(flown.path[i].x).toBe(predicted.path[i].x);
    expect(flown.path[i].y).toBe(predicted.path[i].y);
    expect(flown.path[i].step).toBe(predicted.path[i].step);
  }
  const replay = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const cursor = { index: 0 };
  let guard = 0;
  while (replay.status === "flying" && guard++ < config.maxSteps + 2) advancePlan(replay, config, nodes, cursor);
  expect(replay.dose).toBe(predicted.final.dose);
  expect(replay.tank).toBe(predicted.final.tank);
  expect(replay.x).toBe(predicted.final.x);
  expect(replay.status).toBe("won");
}

describe("WP11 radiation", () => {
  const star: Body = {
    id: "sun",
    name: "sun",
    kind: "star",
    look: "sun",
    x: 0,
    y: 0,
    mass: 1000,
    radius: 20,
    flare: { angle: 0, period: 22, start: 0, duration: 6 },
  };

  it("scales a star as L/r² and adds a flare only inside the cone and the window", () => {
    const distance = 170;
    const starTerm = DOSE_STAR_K * starLuminosity(star) * (DOSE_STAR_R0 / distance) ** 2;
    const flareTerm = DOSE_FLARE_K * (DOSE_FLARE_R / distance) ** 1.1;
    const lit = doseAt(distance, 0, 1, [star]);
    expect(lit.source).toBe("flare");
    expect(lit.d).toBeCloseTo(DOSE_COSMIC + starTerm + flareTerm, 8);

    const quiet = doseAt(distance, 0, 10, [star]);
    expect(quiet.source).toBe("star");
    expect(quiet.d).toBeCloseTo(DOSE_COSMIC + starTerm, 8);

    const angle = (30 * Math.PI) / 180;
    const aside = doseAt(distance * Math.cos(angle), distance * Math.sin(angle), 1, [star]);
    expect(aside.source).toBe("star");
    expect(aside.d).toBeCloseTo(DOSE_COSMIC + starTerm, 6);

    const dwarf: Body = { ...star, look: "white-dwarf", flare: undefined };
    const dim = doseAt(distance, 0, 0, [dwarf]);
    expect(dim.d).toBeCloseTo(DOSE_COSMIC + starTerm * 0.2, 8);
  });

  it("drops the star and the flare behind a planet, and keeps the belt annulus", () => {
    const planet: Body = { id: "p", name: "p", kind: "planet", x: 100, y: 0, mass: 10, radius: 20 };
    const hidden = doseAt(140, 0, 1, [star, planet]);
    expect(hidden.source).toBe("shadow");
    expect(hidden.d).toBe(DOSE_COSMIC);
    const open = doseAt(140, 40, 1, [star, planet]);
    expect(open.source).not.toBe("shadow");
    expect(open.d).toBeGreaterThan(hidden.d);

    const giant: Body = {
      id: "g",
      name: "g",
      kind: "planet",
      look: "gas-giant",
      x: 0,
      y: 0,
      mass: 1,
      radius: 40,
    };
    const peak = 2.1 * giant.radius;
    const span = (peak - 3.2 * giant.radius) / (0.5 * giant.radius);
    const outer = 4 * Math.exp(-span * span);
    const belt = doseAt(peak, 0, 0, [giant]);
    expect(belt.source).toBe("belt");
    expect(belt.d).toBeCloseTo(DOSE_COSMIC + 12 + outer, 8);
  });

  it("adds the pulsar beam and a black-hole disk ring", () => {
    const pulsar: Body = {
      id: "pulse",
      name: "pulse",
      kind: "star",
      look: "pulsar",
      x: 0,
      y: 0,
      mass: 1,
      radius: 8,
      beam: { reach: 200, period: 4, damage: 5, base: 40, tip: 40 },
      magnet: { b1Reach: 80, tilt: 0 },
    };
    const hit = doseAt(0, 40, 0, [pulsar]);
    expect(hit.d).toBeGreaterThanOrEqual(DOSE_COSMIC + DOSE_PULSAR);
    expect(hit.source).toBe("pulsar");

    const hole: Body = { id: "hole", name: "hole", kind: "blackhole", x: 0, y: 0, mass: 1, radius: 20 };
    const ring = doseAt(2.4 * hole.radius, 0, 0, [hole]);
    expect(ring.source).toBe("disk");
    expect(ring.d).toBeCloseTo(DOSE_COSMIC + DOSE_DISK, 8);
  });

  it("moves a rogue in a straight line, pulls from there, and crashes on that disc", () => {
    const rogue = wander.bodies.find((body) => body.id === "rogue");
    if (!rogue?.drift) throw new Error("wander rogue");
    const time = 20;
    const pose = bodyPose(rogue, time, wander.bodies, wander.g);
    expect(pose.x).toBe(rogue.x + rogue.drift.vx * time);
    expect(pose.y).toBe(rogue.y + rogue.drift.vy * time);
    expect(pose.vx).toBe(rogue.drift.vx);
    expect(solarRechargeRate(pose.x, pose.y, time, [rogue], 12, 1)).toBe(0);

    const config = {
      ...simConfigFromLevel(wander),
      bodies: [rogue],
      dosePerD1: 0,
      doseLimit: 0,
      maxSteps: 4000,
    };
    const early = acceleration(pose.x + rogue.radius + 8, pose.y, config, 0);
    const later = acceleration(pose.x + rogue.radius + 8, pose.y, config, time);
    expect(Math.hypot(later.ax, later.ay)).toBeGreaterThan(Math.hypot(early.ax, early.ay) * 5);

    const waiting = makeState(pose.x, pose.y, 0, 0, config);
    let guard = 0;
    while (waiting.status === "flying" && guard++ < 2000) step(waiting, config);
    expect(waiting.status).toBe("crashed");
    expect(waiting.crashedBodyId).toBe("rogue");
    expect(waiting.t).toBeGreaterThan(1);
    expect(waiting.t).toBeLessThan(time);
  });

  it("halves dose with shielding and makes the same burn push less", () => {
    expect(shipLoadout(["shield"]).shield).toBe(0.5);
    expect(shipLoadout(["shield"]).mass).toBeCloseTo(1.3);
    const open = { ...simConfigFromLevel(shade), maxSteps: 400 };
    const clad = { ...simConfigFromLevel(shade, ["shield"]), maxSteps: 400 };
    expect(clad.shield).toBe(0.5);
    expect(clad.shipMass).toBeCloseTo(1.3);
    expect(clad.fuelPerDv).toBeCloseTo(shade.fuelPerDv * 1.3);
    const start = makeState(shade.ship.x, shade.ship.y, shade.ship.vx, shade.ship.vy, open);
    const coastOpen = predictPlan(start, open, []);
    const coastClad = predictPlan(start, clad, []);
    expect(coastClad.path[200].x).toBe(coastOpen.path[200].x);
    expect(coastClad.final.dose).toBeCloseTo(coastOpen.final.dose * 0.5, 8);
    const launch = [shadePlan[0]];
    const burnedOpen = predictPlan(start, open, launch);
    const burnedClad = predictPlan(start, clad, launch);
    expect(burnedClad.path[80].x).not.toBe(burnedOpen.path[80].x);
  });

  it("fails the mission when the crew dose reaches the limit", () => {
    const config = { ...simConfigFromLevel(shade), dosePerD1: 10, doseLimit: 0.01, maxSteps: 600 };
    const state = makeState(shade.ship.x, shade.ship.y, shade.ship.vx, shade.ship.vy, config);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.status).toBe("lost");
    expect(flown.lostReason).toBe("dose");
    const predicted = predictPlan(state, config, []);
    expect(predicted.status).toBe("lost");
    expect(predicted.lostReason).toBe("dose");
    expect(predicted.final.dose).toBe(config.doseLimit);
    expect(predicted.path.length).toBe(flown.path.length);
    expect(predicted.path[0].x).toBe(flown.path[0].x);
  });

  it("leaves stock flights at zero dose, and the radiation toggle does not touch the plan", () => {
    const config = simConfigFromLevel(passage);
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
    const predicted = predictPlan(state, config, slingshotPlan);
    expect(predicted.final.dose).toBe(0);
    expect(predicted.final.doseRate).toBe(0);
    expect(predicted.status).toBe("won");

    const game = createGame(shade);
    setPlan(game, shadePlan);
    const before = game.prediction;
    toggleRadiation(game);
    expect(game.radiation).toBe(true);
    expect(game.prediction).toBe(before);
    expect(before.final.dose).toBeGreaterThan(0);
  });

  it("matches prediction to flight on Shade and Wander", () => {
    expectFlightMatches(shade, shadePlan);
    expectFlightMatches(wander, wanderPlan);
  });
});
