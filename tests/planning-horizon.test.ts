import { describe, expect, it } from "vitest";
import { createGame, setPlan, stepInHorizon } from "../src/game/state";
import { simConfigFromLevel, type Level } from "../src/level/catalog";
import { stage } from "./support/stage";
import { horizonSteps, makeState, predictPlan, type BurnNode } from "../src/sim/physics";

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

describe("planning horizon", () => {
  it("keeps today's horizon when the plan has no nodes", () => {
    const { config, state } = chartStart();
    const extension = horizonSteps(state, config);
    const coast = predictPlan(state, config, []);

    expect(extension).toBe(Math.floor(chart.horizon!.seconds / chart.dt));
    expect(coast.status).toBe("flying");
    expect(coast.steps).toBe(state.step + extension);
    expect(endStep(coast.path)).toBe(state.step + extension);

    const game = createGame(chart);
    expect(endStep(game.prediction.path)).toBe(game.initial.step + extension);
    expect(stepInHorizon(game, game.initial.step + extension)).toBe(true);
    expect(stepInHorizon(game, game.initial.step + extension + 1)).toBe(false);
  });

  it("moves the horizon end to the last burn plus a fixed extension", () => {
    const { config, state } = chartStart();
    const extension = horizonSteps(state, config);
    const early: BurnNode = { step: 120, dvx: 0, dvy: 0 };
    const later: BurnNode = { step: 480, dvx: 0, dvy: 0 };

    const one = predictPlan(state, config, [early]);
    const two = predictPlan(state, config, [early, later]);

    expect(one.status).toBe("flying");
    expect(two.status).toBe("flying");
    expect(endStep(one.path)).toBe(early.step + extension);
    expect(endStep(two.path)).toBe(later.step + extension);
    expect(endStep(two.path) - endStep(one.path)).toBe(later.step - early.step);
    expect(two.path.some((sample) => sample.step > early.step)).toBe(true);
    expect(two.path.some((sample) => sample.step > later.step)).toBe(true);

    const game = createGame(chart);
    setPlan(game, [early, later]);
    expect(endStep(game.prediction.path)).toBe(later.step + extension);
    expect(stepInHorizon(game, later.step + extension)).toBe(true);
    expect(stepInHorizon(game, later.step + extension + 1)).toBe(false);
  });
});
