import { describe, expect, it } from "vitest";
import { buyUpgrade, createGame, launch, setPlan, tick } from "../src/game/state";
import { simConfigFromLevel, type Level } from "../src/level/catalog";
import { stage as passage } from "./support/stage";
import { slingshotPlan } from "./support/plans";
import {
  advancePlan,
  flyPlan,
  makeState,
  predictPlan,
  tidalDangerRadius,
  type BurnNode,
  type SimConfig,
} from "../src/sim/physics";

function flyReference(level: Level, nodes: readonly BurnNode[]) {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const cursor = { index: 0 };
  let guard = 0;
  while (state.status === "flying" && guard++ < config.maxSteps + nodes.length + 2) {
    advancePlan(state, config, nodes, cursor);
  }
  expect(state.status, level.id).toBe("won");
  expect(state.hull, level.id).toBeGreaterThan(0);
}

describe("ship systems", () => {
  it("keeps the library-stage slingshot winnable", () => {
    flyReference(passage, slingshotPlan);
  });

  it("matches prediction through damage, recharge and upgrade mass", () => {
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      c: 1_000_000,
      tidalStrength: 0.015,
      solarStrength: 30,
      shipMass: 1.35,
      engineScale: 1.15,
      hullMax: 100,
      fuelStart: 80,
      fuelMax: 120,
      fuelPerDv: 1.35,
      bodies: [
        {
          id: "star",
          name: "star",
          kind: "star",
          look: "white-dwarf",
          x: 0,
          y: 0,
          mass: 80_000,
          radius: 16,
        },
        {
          id: "x",
          name: "Planet X",
          kind: "target",
          x: 400,
          y: 40,
          mass: 2000,
          radius: 18,
          captureRadius: 70,
        },
      ],
      bounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
      maxSteps: 900,
      targetId: "x",
      periapsisMargin: 6,
    };
    const nodes = [{ step: 0, dvx: 18, dvy: 6 }];
    const start = makeState(-180, 30, 0, 0, config);
    const predicted = predictPlan(start, config, nodes);
    const flown = makeState(-180, 30, 0, 0, config);
    const cursor = { index: 0 };
    let guard = 0;
    while (flown.status === "flying" && guard++ < config.maxSteps + 5) {
      advancePlan(flown, config, nodes, cursor);
    }
    expect(predicted.final.x).toBe(flown.x);
    expect(predicted.final.y).toBe(flown.y);
    expect(predicted.final.vx).toBe(flown.vx);
    expect(predicted.final.vy).toBe(flown.vy);
    expect(predicted.final.hull).toBe(flown.hull);
    expect(predicted.final.tank).toBe(flown.tank);
    expect(predicted.final.recharged).toBe(flown.recharged);
    expect(predicted.final.status).toBe(flown.status);
    expect(flown.recharged).toBeGreaterThan(0);
    expect(flown.hull).toBeLessThan(100);
    const heavy = flyPlan(start, config, nodes, 1);
    const light = flyPlan(start, { ...config, shipMass: 1, engineScale: 1, fuelPerDv: 1 }, nodes, 1);
    expect(heavy.path[80].x).not.toBe(light.path[80].x);
  });

  it("damages a close pass, zeroes the hull on a collision, and recharges only near a star", () => {
    const star = {
      id: "star",
      name: "star",
      kind: "star" as const,
      x: 0,
      y: 0,
      mass: 0,
      radius: 40,
    };
    const base: SimConfig = {
      g: 1,
      dt: 1 / 60,
      c: 1_000_000,
      solarStrength: 20,
      fuelStart: 10,
      fuelMax: 40,
      bodies: [star],
      bounds: { minX: -1e5, maxX: 1e5, minY: -1e5, maxY: 1e5 },
      maxSteps: 200,
      targetId: "star",
      periapsisMargin: 1,
    };
    const skim = makeState(-80, 42, 30, 0, base);
    const cursor = { index: 0 };
    let guard = 0;
    while (skim.status === "flying" && skim.x < 80 && guard++ < 400) advancePlan(skim, base, [], cursor);
    expect(skim.hull).toBeLessThan(100);
    expect(skim.hull).toBeGreaterThan(0);
    expect(skim.recharged).toBeGreaterThan(0);

    const far = makeState(-80, 800, 30, 0, base);
    const farCursor = { index: 0 };
    for (let i = 0; i < 30; i++) advancePlan(far, base, [], farCursor);
    expect(far.hull).toBe(100);
    expect(far.recharged).toBe(0);

    const hit = makeState(-80, 0, 40, 0, { ...base, solarStrength: 0 });
    const hitCursor = { index: 0 };
    let steps = 0;
    while (hit.status === "flying" && steps++ < 400) advancePlan(hit, { ...base, solarStrength: 0 }, [], hitCursor);
    expect(hit.status).toBe("crashed");
    expect(hit.hull).toBe(0);
  });

  it("fails the mission when the hull reaches zero", () => {
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      c: 1_000_000,
      tidalStrength: 2,
      hullMax: 5,
      bodies: [
        {
          id: "hole",
          name: "hole",
          kind: "blackhole",
          x: 0,
          y: 0,
          mass: 50_000,
          radius: 20,
        },
      ],
      bounds: { minX: -1e5, maxX: 1e5, minY: -1e5, maxY: 1e5 },
      maxSteps: 500,
      targetId: "hole",
      periapsisMargin: 1,
    };
    const state = makeState(80, 0, -5, 0, config);
    const cursor = { index: 0 };
    let guard = 0;
    while (state.status === "flying" && guard++ < 500) advancePlan(state, config, [], cursor);
    expect(state.status).toBe("lost");
    expect(state.lostReason).toBe("hull");
    expect(state.hull).toBe(0);
    expect(tidalDangerRadius(config.bodies[0], 1, 2)).toBeGreaterThan(20);
  });

  it("spends points on a heavier hull and the new mass is in the prediction", () => {
    const game = createGame(passage);
    setPlan(game, slingshotPlan);
    const before = game.prediction.final.x;
    expect(buyUpgrade(game, "hull")).toBe(true);
    expect(game.points).toBe(2);
    expect(game.ship.hullMax).toBe(160);
    expect(buyUpgrade(game, "hull")).toBe(false);
    expect(game.prediction.final.x).not.toBe(before);
    launch(game);
    let guard = 0;
    while (game.mode === "flying" && guard++ < passage.maxSteps) tick(game);
    const predicted = game.prediction;
    expect(game.ship.x).toBe(predicted.final.x);
    expect(game.ship.hull).toBe(predicted.final.hull);
    expect(game.fuel).toBe(game.ship.tank);
  });
});
