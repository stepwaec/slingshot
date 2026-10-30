import { describe, expect, it } from "vitest";
import { passage, simConfigFromLevel } from "../src/level/catalog";
import { slingshotLaunch } from "../src/level/solutions";
import { createGame, launch, setPlan, tick } from "../src/game/state";
import {
  SIM_SPEEDS,
  flyPlan,
  horizonSteps,
  makeState,
  predictPlan,
  stepsPerFrame,
  type BurnNode,
  type Horizon,
  type PathSample,
  type Prediction,
} from "../src/sim/physics";

/** Three burns, all before the ship reaches Planet X. */
const nodes: BurnNode[] = [
  { step: 0, dvx: slingshotLaunch.dvx, dvy: slingshotLaunch.dvy },
  { step: 400, dvx: 0.6, dvy: -0.3 },
  { step: 900, dvx: -0.4, dvy: 0.55 },
];

function initial() {
  const config = simConfigFromLevel(passage);
  const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
  return { config, state };
}

function assertSameFlight(actual: Prediction, expected: Prediction, label: string): void {
  expect(actual.status, label).toBe(expected.status);
  expect(actual.steps, label).toBe(expected.steps);
  expect(actual.crashedBodyId, label).toBe(expected.crashedBodyId);
  expect(actual.lostReason, label).toBe(expected.lostReason);
  expect(actual.orbit, label).toEqual(expected.orbit);
  expect(actual.path, label).toHaveLength(expected.path.length);
  for (let i = 0; i < expected.path.length; i++) {
    const got = actual.path[i];
    const want = expected.path[i];
    if (got.x !== want.x || got.y !== want.y || got.step !== want.step) {
      throw new Error(
        `${label} diverged at sample ${i} (step ${want.step}): (${got.x}, ${got.y}) vs (${want.x}, ${want.y})`,
      );
    }
  }
}

function flyWithGame(plan: readonly BurnNode[], speed: (typeof SIM_SPEEDS)[number]): PathSample[] {
  const game = createGame();
  setPlan(game, plan);
  game.speed = speed;
  expect(launch(game)).toBeUndefined();
  expect(game.mode).toBe("flying");
  const samples: PathSample[] = [];
  let guard = 0;
  while (game.mode === "flying" && guard++ < passage.maxSteps) {
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) samples.push(game.frameSamples[i]);
  }
  return samples;
}

describe("prediction uses the flight integrator", () => {
  it("matches a 3-node plan step for step at 1x, 2x, and 4x", () => {
    const { config, state } = initial();
    const predicted = predictPlan(state, config, nodes);
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(predicted.path.length).toBeGreaterThan(nodes[2].step);
    expect(predicted.path.some((sample) => sample.step > nodes[0].step)).toBe(true);
    expect(predicted.path.some((sample) => sample.step > nodes[1].step)).toBe(true);
    expect(predicted.path.some((sample) => sample.step > nodes[2].step)).toBe(true);

    const reference = flyPlan(state, config, nodes, 1);
    assertSameFlight(reference, predicted, "predictPlan");

    for (const speed of SIM_SPEEDS) {
      const flown = flyPlan(state, config, nodes, stepsPerFrame(speed));
      assertSameFlight(flown, reference, `flyPlan ${speed}x`);
      const played = flyWithGame(nodes, speed);
      expect(played).toHaveLength(reference.path.length);
      for (let i = 0; i < reference.path.length; i++) {
        if (played[i].x !== reference.path[i].x || played[i].y !== reference.path[i].y || played[i].step !== reference.path[i].step) {
          throw new Error(`game ${speed}x diverged at sample ${i}`);
        }
      }
    }
  });

  it("matches the flight over the whole horizon past the last burn", () => {
    const { config, state } = initial();
    const horizon: Horizon = { seconds: 12, oneOrbit: false, shorten: 0, ref: 1 };
    const limited = { ...config, horizon };
    const extension = horizonSteps(state, limited);
    const predicted = predictPlan(state, limited, nodes);
    const flown = flyPlan(state, config, nodes, 1);
    const end = nodes[nodes.length - 1].step + extension;

    expect(predicted.status).toBe("flying");
    expect(predicted.path.length).toBeGreaterThan(nodes[2].step);
    expect(predicted.path[predicted.path.length - 1].step).toBe(end);
    expect(predicted.path.length).toBeLessThan(flown.path.length);
    expect(predicted.path.some((sample) => sample.step > nodes[0].step)).toBe(true);
    expect(predicted.path.some((sample) => sample.step > nodes[1].step)).toBe(true);
    expect(predicted.path.some((sample) => sample.step > nodes[2].step)).toBe(true);
    for (let i = 0; i < predicted.path.length; i++) {
      const got = predicted.path[i];
      const want = flown.path[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
        throw new Error(
          `horizon diverged at sample ${i} (step ${want.step}): (${got.x}, ${got.y}) vs (${want.x}, ${want.y})`,
        );
      }
    }
  });
});
