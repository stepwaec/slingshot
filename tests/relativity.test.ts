import { describe, expect, it } from "vitest";
import { createGame, launch, missionResult, pause, resume, setPlan, tick } from "../src/game/state";
import { passage, relay, rescue, rescueHole, simConfigFromLevel, type Level } from "../src/level/catalog";
import { deepPlan, relayFull, safePlan, slingshotPlan } from "../src/level/solutions";
import { scoreMission, type MissionInput } from "../src/sim/score";
import {
  assessPlan,
  flyPlan,
  horizonRadius,
  makeState,
  potentialDepth,
  predictPlan,
  properTimeRate,
  step,
  type SimConfig,
} from "../src/sim/physics";

const empty: SimConfig = {
  g: 1,
  dt: 1 / 60,
  c: 100,
  bodies: [],
  bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
  maxSteps: 100,
  targetId: "none",
  periapsisMargin: 1,
};

describe("proper time rate", () => {
  it("matches the weak-field formula for speed, depth, and both", () => {
    const c = empty.c;
    const c2 = c * c;
    const v = 60;
    const speedOnly = Math.sqrt(1 - (v * v) / c2);
    expect(properTimeRate(0, 0, v, 0, empty, 0)).toBeCloseTo(speedOnly, 12);
    expect(properTimeRate(0, 0, 0, 0, empty, 0)).toBeCloseTo(1, 12);

    const mass = 5_000;
    const body = {
      id: "mass",
      name: "mass",
      kind: "star" as const,
      x: 0,
      y: 0,
      mass,
      radius: 8,
    };
    const weighed: SimConfig = { ...empty, bodies: [body] };
    const r = 80;
    const phi = (empty.g * mass) / r;
    expect(potentialDepth(r, 0, weighed, 0)).toBeCloseTo(phi, 12);
    const depthOnly = Math.sqrt(1 - (2 * phi) / c2);
    expect(properTimeRate(r, 0, 0, 0, weighed, 0)).toBeCloseTo(depthOnly, 12);
    const combined = Math.sqrt(1 - (2 * phi) / c2 - (v * v) / c2);
    expect(properTimeRate(r, 0, v, 0, weighed, 0)).toBeCloseTo(combined, 12);
    expect(properTimeRate(r, 0, 0, v, weighed, 0)).toBeCloseTo(combined, 12);
  });

  it("clamps at a horizon and at v >= c", () => {
    expect(properTimeRate(0, 0, empty.c, 0, empty, 0)).toBe(0);
    expect(properTimeRate(0, 0, 0, empty.c * 3, empty, 0)).toBe(0);
    const sunk: SimConfig = {
      ...empty,
      bodies: [
        {
          id: "mass",
          name: "mass",
          kind: "star",
          x: 0,
          y: 0,
          mass: 1e8,
          radius: 1,
        },
      ],
    };
    expect(properTimeRate(20, 0, 0, 0, sunk, 0)).toBe(0);

    const c = 40;
    const radius = 30;
    const mass = (radius * c * c) / 2;
    expect(horizonRadius(mass, 1, c)).toBeCloseTo(radius, 10);
    const hole: SimConfig = {
      ...empty,
      c,
      bodies: [
        {
          id: "hole",
          name: "the black hole",
          kind: "blackhole",
          x: 0,
          y: 0,
          mass,
          radius,
        },
      ],
    };
    expect(properTimeRate(radius, 0, 0, 0, hole, 0)).toBe(0);
    const outside = radius * 1.25;
    const phi = mass / outside;
    expect(properTimeRate(outside, 0, 0, 0, hole, 0)).toBeCloseTo(Math.sqrt(1 - (2 * phi) / (c * c)), 10);
    expect(rescueHole.radius).toBeCloseTo(horizonRadius(rescueHole.mass, rescue.g, rescue.c), 8);
  });

  it("reads an orbiting body's depth at the right time", () => {
    const config: SimConfig = {
      ...empty,
      bodies: [
        {
          id: "moon",
          name: "moon",
          kind: "moon",
          x: 100,
          y: 0,
          mass: 1_000,
          radius: 4,
          orbit: { cx: 0, cy: 0, radius: 100, phase: 0, omega: 1 },
        },
      ],
    };
    expect(potentialDepth(100, 0, config, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(potentialDepth(100, 0, config, Math.PI)).toBeCloseTo(1_000 / 200, 8);
    expect(properTimeRate(100, 0, 0, 0, config, 0)).toBe(0);
    expect(properTimeRate(100, 0, 0, 0, config, Math.PI)).toBeGreaterThan(0.9);
  });
});

describe("clocks", () => {
  it("integrates outside time and proper time deterministically", () => {
    const weighed: SimConfig = {
      ...empty,
      maxSteps: 80,
      bodies: [
        {
          id: "mass",
          name: "mass",
          kind: "star",
          x: 0,
          y: 40,
          mass: 8_000,
          radius: 6,
        },
      ],
    };
    const run = () => {
      const state = makeState(120, -30, 12, 5, weighed);
      let tau = 0;
      const steps = 50;
      for (let i = 0; i < steps; i++) {
        const rate = properTimeRate(state.x, state.y, state.vx, state.vy, weighed, state.step * weighed.dt);
        tau += rate * weighed.dt;
        step(state, weighed);
      }
      expect(state.status).toBe("flying");
      expect(state.t).toBeCloseTo(steps * weighed.dt, 12);
      expect(state.tau).toBeCloseTo(tau, 12);
      expect(state.tau).toBeLessThan(state.t);
      return state;
    };
    const first = run();
    const second = run();
    expect(second.t).toBe(first.t);
    expect(second.tau).toBe(first.tau);
    expect(second.rate).toBe(first.rate);
  });

  it("agrees between prediction and flight, including speed and the game loop", () => {
    const cases: Array<{ level: Level; nodes: typeof deepPlan }> = [
      { level: rescue, nodes: deepPlan },
      { level: rescue, nodes: safePlan },
      { level: relay, nodes: relayFull },
      { level: passage, nodes: slingshotPlan },
    ];
    for (const item of cases) {
      const config = { ...simConfigFromLevel(item.level), horizon: undefined };
      const state = makeState(item.level.ship.x, item.level.ship.y, item.level.ship.vx, item.level.ship.vy, config);
      const predicted = predictPlan(state, config, item.nodes);
      const flown = flyPlan(state, config, item.nodes, 1);
      expect(predicted.shipTime, item.level.id).toBe(flown.shipTime);
      expect(predicted.outsideTime, item.level.id).toBe(flown.outsideTime);
      expect(predicted.path, item.level.id).toHaveLength(flown.path.length);
      for (let i = 0; i < flown.path.length; i++) {
        expect(predicted.path[i].rate, `${item.level.id} rate ${i}`).toBe(flown.path[i].rate);
      }
      expect(flyPlan(state, config, item.nodes, 4).shipTime, item.level.id).toBe(flown.shipTime);
      expect(flyPlan(state, config, item.nodes, 4).outsideTime, item.level.id).toBe(flown.outsideTime);
    }

    const game = createGame(rescue);
    setPlan(game, safePlan);
    const forecast = game.prediction;
    launch(game);
    let guard = 0;
    while (game.mode === "flying" && guard++ < rescue.maxSteps) tick(game);
    expect(game.ship.status).toBe("won");
    expect(game.ship.t).toBe(forecast.outsideTime);
    expect(game.ship.tau).toBe(forecast.shipTime);
  });
});

describe("scoring", () => {
  const base: MissionInput = {
    arrived: true,
    outsideTime: 20,
    shipTime: 12,
    fuelLeft: 18,
    pauseSpent: 0,
    deadline: 30,
    crewLimit: 16,
    fuelStarMin: 10,
    crewWeight: 2,
    fuelWeight: 3,
  };

  it("requires arrival, fails the deadline hard, and awards three stars", () => {
    const won = scoreMission(base);
    expect(won.hardFail).toBeNull();
    expect(won.stars).toEqual({ deadline: true, crew: true, fuel: true });
    expect(won.points).toBeCloseTo(2 * (16 - 12) + 3 * 18, 8);
    expect(won.gap).toBeCloseTo(8, 8);

    const missedCrew = scoreMission({ ...base, shipTime: 16.5 });
    expect(missedCrew.stars).toEqual({ deadline: true, crew: false, fuel: true });
    expect(missedCrew.points).toBeCloseTo(3 * 18, 8);

    const missedFuel = scoreMission({ ...base, fuelLeft: 4 });
    expect(missedFuel.stars.fuel).toBe(false);
    expect(missedFuel.stars.deadline).toBe(true);
    expect(missedFuel.points).toBeCloseTo(2 * (16 - 12) + 3 * 4, 8);

    const late = scoreMission({ ...base, outsideTime: 30.1 });
    expect(late.hardFail).toBe("deadline");
    expect(late.points).toBe(0);
    expect(late.stars).toEqual({ deadline: false, crew: false, fuel: false });

    const onTime = scoreMission({ ...base, outsideTime: 30 });
    expect(onTime.hardFail).toBeNull();
    expect(onTime.stars.deadline).toBe(true);

    const lost = scoreMission({ ...base, arrived: false, shipTime: 1, fuelLeft: 40 });
    expect(lost.hardFail).toBe("arrival");
    expect(lost.points).toBe(0);
    expect(lost.stars.deadline).toBe(false);
  });

  it("subtracts the WP4 score-pause cost, and a late capture still fails", () => {
    const paused = scoreMission({ ...base, pauseSpent: 7 });
    expect(paused.hardFail).toBeNull();
    expect(paused.points).toBeCloseTo(2 * (16 - 12) + 3 * 18 - 7, 8);
    expect(scoreMission({ ...base, pauseSpent: 10_000 }).points).toBe(0);
    expect(scoreMission({ ...base, outsideTime: 40, pauseSpent: 0 }).hardFail).toBe("deadline");

    const level: Level = {
      ...passage,
      pause: { kind: "score", cost: 10, budget: 40 },
      mission: { ...passage.mission, deadline: 1, crewWeight: 0, fuelWeight: 1, fuelStarMin: 0, crewLimit: 10_000 },
    };
    const late = createGame(level);
    setPlan(late, slingshotPlan);
    launch(late);
    let guard = 0;
    while (late.mode === "flying" && guard++ < passage.maxSteps) tick(late);
    expect(late.ship.status).toBe("won");
    const failed = missionResult(late);
    expect(failed.hardFail).toBe("deadline");
    expect(failed.points).toBe(0);
    expect(failed.stars.deadline).toBe(false);

    const scored: Level = {
      ...passage,
      pause: { kind: "score", cost: 10, budget: 40 },
      mission: { ...passage.mission, crewWeight: 0, fuelWeight: 1, fuelStarMin: 0, crewLimit: 10_000 },
    };
    const quiet = createGame(scored);
    setPlan(quiet, slingshotPlan);
    launch(quiet);
    guard = 0;
    while (quiet.mode === "flying" && guard++ < passage.maxSteps) tick(quiet);
    const paid = createGame(scored);
    setPlan(paid, slingshotPlan);
    launch(paid);
    expect(pause(paid)).toBe(true);
    expect(paid.score).toBe(30);
    resume(paid);
    guard = 0;
    while (paid.mode === "flying" && guard++ < passage.maxSteps) tick(paid);
    expect(missionResult(paid).pauseSpent).toBe(10);
    expect(missionResult(paid).hardFail).toBeNull();
    expect(missionResult(paid).points).toBeCloseTo(missionResult(quiet).points - 10, 6);
    expect(missionResult(paid).shipTime).toBe(missionResult(quiet).shipTime);
  });
});

describe("rescue dilemma", () => {
  it("trades fuel and crew time for outside time", () => {
    const config = simConfigFromLevel(rescue);
    const state = makeState(rescue.ship.x, rescue.ship.y, rescue.ship.vx, rescue.ship.vy, config);
    const deep = flyPlan(state, config, deepPlan, 1);
    const safe = flyPlan(state, config, safePlan, 1);
    const deepFuel = assessPlan(deepPlan, rescue.fuel, rescue.fuelPerDv);
    const safeFuel = assessPlan(safePlan, rescue.fuel, rescue.fuelPerDv);

    expect(deep.status).toBe("won");
    expect(safe.status).toBe("won");
    expect(deepFuel.affordable).toBe(true);
    expect(safeFuel.affordable).toBe(true);
    expect(deepFuel.left).toBeGreaterThan(safeFuel.left);
    expect(deep.shipTime).toBeLessThan(safe.shipTime);
    expect(deep.outsideTime).toBeGreaterThan(safe.outsideTime);

    expect(safe.outsideTime).toBeLessThanOrEqual(rescue.mission.deadline);
    expect(deep.outsideTime).toBeGreaterThan(rescue.mission.deadline);
    expect(deep.shipTime).toBeLessThanOrEqual(rescue.mission.crewLimit);
    expect(safe.shipTime).toBeGreaterThan(rescue.mission.crewLimit);
    expect(deepFuel.left).toBeGreaterThanOrEqual(rescue.mission.fuelStarMin);
    expect(safeFuel.left).toBeLessThan(rescue.mission.fuelStarMin);

    const safeScore = scoreMission({
      arrived: true,
      outsideTime: safe.outsideTime,
      shipTime: safe.shipTime,
      fuelLeft: safeFuel.left,
      pauseSpent: 0,
      ...rescue.mission,
    });
    const deepScore = scoreMission({
      arrived: true,
      outsideTime: deep.outsideTime,
      shipTime: deep.shipTime,
      fuelLeft: deepFuel.left,
      pauseSpent: 0,
      ...rescue.mission,
    });
    expect(safeScore.hardFail).toBeNull();
    expect(safeScore.stars).toEqual({ deadline: true, crew: false, fuel: false });
    expect(deepScore.hardFail).toBe("deadline");
    expect(deepScore.points).toBe(0);
    expect(deepScore.stars).toEqual({ deadline: false, crew: false, fuel: false });
  });
});
