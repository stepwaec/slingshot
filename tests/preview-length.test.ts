import { describe, expect, it } from "vitest";
import { createGame, setPlan, setPreviewSeconds } from "../src/game/state";
import { simConfigFromLevel, type Level } from "../src/level/catalog";
import { stage } from "./support/stage";
import {
  PREDICTION_STEP_CAP,
  extensionSteps,
  flyPlan,
  horizonSteps,
  makeState,
  planHorizonEnd,
  predictPlan,
  previewRange,
  type BurnNode,
  type SimConfig,
  type SimState,
} from "../src/sim/physics";

const chart: Level = {
  ...stage,
  horizon: { seconds: 8, oneOrbit: false, shorten: 0, ref: 1 },
};

function chartStart() {
  const config = simConfigFromLevel(chart);
  const state = makeState(chart.ship.x, chart.ship.y, chart.ship.vx, chart.ship.vy, config);
  return { config, state };
}

function endStep(path: readonly { step: number }[]): number {
  return path[path.length - 1].step;
}

describe("prediction length", () => {
  it("keeps today's look-ahead when the slider is untouched and there are no nodes", () => {
    const { config, state } = chartStart();
    const steps = horizonSteps(state, config);
    const range = previewRange(state, config);
    expect(extensionSteps(state, config, null)).toBe(steps);
    expect(extensionSteps(state, config, range.defaultSeconds)).toBe(steps);
    expect(range.maxSeconds).toBeGreaterThan(range.defaultSeconds);

    const coast = predictPlan(state, config, [], undefined, steps);
    expect(coast.status).toBe("flying");
    expect(endStep(coast.path)).toBe(state.step + steps);

    const game = createGame(chart);
    expect(game.previewSeconds).toBeNull();
    expect(endStep(game.prediction.path)).toBe(game.initial.step + steps);
  });

  it("extends a fixed time past the latest burn, and a long preview still matches the flight", () => {
    const openSpace: Level = {
      ...stage,
      bodies: [{ id: "x", name: "Planet X", kind: "target", x: 80_000, y: 0, mass: 1, radius: 8, captureRadius: 20 }],
      ship: { x: 0, y: 0, vx: 12, vy: 0 },
      bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
      maxSteps: 8_000,
      horizon: { seconds: 8, oneOrbit: false, shorten: 0, ref: 1 },
    };
    const config = simConfigFromLevel(openSpace);
    const state = makeState(openSpace.ship.x, openSpace.ship.y, openSpace.ship.vx, openSpace.ship.vy, config);
    const open: SimConfig = { ...config, horizon: undefined };
    const early: BurnNode = { step: 180, dvx: 0, dvy: 0 };
    const later: BurnNode = { step: 640, dvx: 0, dvy: 0 };
    const extension = extensionSteps(state, config, 40);
    expect(extension).toBeGreaterThan(horizonSteps(state, config));

    const one = predictPlan(state, config, [early], undefined, extension);
    const two = predictPlan(state, config, [early, later], undefined, extension);
    expect(one.status).toBe("flying");
    expect(two.status).toBe("flying");
    expect(endStep(one.path)).toBe(planHorizonEnd(state, config, [early], extension));
    expect(endStep(two.path)).toBe(later.step + extension);
    expect(endStep(two.path) - endStep(one.path)).toBe(later.step - early.step);

    const flown = flyPlan(state, open, [early, later], 1);
    expect(two.path.length).toBeLessThan(flown.path.length);
    expect(two.path.length).toBeGreaterThan(later.step);
    for (let i = 0; i < two.path.length; i++) {
      const got = two.path[i];
      const want = flown.path[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
        throw new Error(`long preview diverged at sample ${i} (step ${want.step})`);
      }
    }

    const game = createGame(openSpace);
    setPlan(game, [early, later]);
    setPreviewSeconds(game, 40);
    expect(game.previewSeconds).toBe(40);
    expect(endStep(game.prediction.path)).toBe(later.step + extension);
  });

  it("stops at the step cap and still matches the flight up to that step", () => {
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      bodies: [],
      bounds: { minX: -1e8, maxX: 1e8, minY: -1e8, maxY: 1e8 },
      maxSteps: PREDICTION_STEP_CAP + 200,
      targetId: "none",
      periapsisMargin: 1,
      c: 1_000_000,
    };
    const state: SimState = makeState(0, 0, 4, 0, config);
    const nodes: BurnNode[] = [{ step: 250, dvx: 0, dvy: 0.2 }];
    const predicted = predictPlan(state, config, nodes, undefined, 1_000_000);
    const flown = flyPlan(state, config, nodes, 1);

    expect(predicted.status).toBe("flying");
    expect(endStep(predicted.path) - state.step).toBe(PREDICTION_STEP_CAP);
    expect(predicted.path.length).toBeLessThanOrEqual(PREDICTION_STEP_CAP);
    expect(predicted.path.length).toBeLessThan(flown.path.length);
    expect(endStep(predicted.path)).toBeGreaterThan(nodes[0].step);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(predicted.path[i].x).toBe(flown.path[i].x);
      expect(predicted.path[i].y).toBe(flown.path[i].y);
      expect(predicted.path[i].step).toBe(flown.path[i].step);
      expect(predicted.path[i].rate).toBe(flown.path[i].rate);
    }
  });

  it("lets a wider level preview further than a small one", () => {
    const { config, state } = chartStart();
    const horizon = { seconds: 4, oneOrbit: false, shorten: 0, ref: 1 };
    const shared: SimConfig = { ...config, horizon, maxSteps: 1_000_000 };
    const small = previewRange(state, { ...shared, bounds: { minX: 0, maxX: 800, minY: 0, maxY: 0 } });
    const wide = previewRange(state, { ...shared, bounds: { minX: 0, maxX: 80_000, minY: 0, maxY: 0 } });
    expect(small.maxSeconds).toBeCloseTo(800 / 40, 6);
    expect(wide.maxSeconds).toBeGreaterThan(small.maxSeconds * 10);
    expect(wide.maxSeconds).toBeCloseTo(PREDICTION_STEP_CAP * shared.dt, 6);
  });
});
