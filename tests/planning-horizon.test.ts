import { describe, expect, it } from "vitest";
import { createGame, setPlan, stepInHorizon } from "../src/game/state";
import { relay, simConfigFromLevel } from "../src/level/catalog";
import { horizonSteps, makeState, predictPlan, type BurnNode } from "../src/sim/physics";

function relayStart() {
  const config = simConfigFromLevel(relay);
  const state = makeState(relay.ship.x, relay.ship.y, relay.ship.vx, relay.ship.vy, config);
  return { config, state };
}

function endStep(path: readonly { step: number }[]): number {
  return path[path.length - 1].step;
}

describe("planning horizon", () => {
  it("keeps today's horizon when the plan has no nodes", () => {
    const { config, state } = relayStart();
    const extension = horizonSteps(state, config);
    const coast = predictPlan(state, config, []);

    // Relay at the pad, today: 8 s shortened by Home, dt = 1/60.
    expect(extension).toBe(357);
    expect(coast.status).toBe("flying");
    expect(coast.steps).toBe(state.step + extension);
    expect(endStep(coast.path)).toBe(state.step + extension);

    const game = createGame(relay);
    expect(endStep(game.prediction.path)).toBe(game.initial.step + extension);
    expect(stepInHorizon(game, game.initial.step + extension)).toBe(true);
    expect(stepInHorizon(game, game.initial.step + extension + 1)).toBe(false);
  });

  it("moves the horizon end to the last burn plus a fixed extension", () => {
    const { config, state } = relayStart();
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

    const game = createGame(relay);
    setPlan(game, [early, later]);
    expect(endStep(game.prediction.path)).toBe(later.step + extension);
    expect(stepInHorizon(game, later.step + extension)).toBe(true);
    expect(stepInHorizon(game, later.step + extension + 1)).toBe(false);
  });
});
