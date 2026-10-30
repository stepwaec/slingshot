import { describe, expect, it } from "vitest";
import { createGame, launch, setPlan, setSpeed, tick } from "../src/game/state";
import { passage, simConfigFromLevel } from "../src/level/catalog";
import { slingshotPlan } from "../src/level/solutions";
import { SIM_SPEEDS, SPEED_KEY, flyPlan, makeState, stepsPerFrame, type PathSample } from "../src/sim/physics";

function play(speed: 1 | 32): PathSample[] {
  const game = createGame(passage);
  setPlan(game, slingshotPlan);
  setSpeed(game, speed);
  expect(launch(game)).toBeUndefined();
  const samples: PathSample[] = [];
  let guard = 0;
  while (game.mode === "flying" && guard++ < passage.maxSteps) {
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) samples.push(game.frameSamples[i]);
  }
  return samples;
}

describe("sim speed", () => {
  it("flies the same plan bit-identically at 1x and 32x", () => {
    const config = simConfigFromLevel(passage);
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
    expect(stepsPerFrame(1)).toBe(1);
    expect(stepsPerFrame(32)).toBe(32);
    expect(config.dt).toBe(passage.dt);

    const slow = flyPlan(state, config, slingshotPlan, stepsPerFrame(1));
    const fast = flyPlan(state, config, slingshotPlan, stepsPerFrame(32));
    expect(fast.status).toBe(slow.status);
    expect(fast.steps).toBe(slow.steps);
    expect(fast.path).toHaveLength(slow.path.length);
    for (let i = 0; i < slow.path.length; i++) {
      const got = fast.path[i];
      const want = slow.path[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
        throw new Error(`32x diverged at sample ${i} (step ${want.step})`);
      }
    }

    const played = play(32);
    const once = play(1);
    expect(played).toHaveLength(once.length);
    for (let i = 0; i < once.length; i++) {
      expect(played[i].x).toBe(once[i].x);
      expect(played[i].y).toBe(once[i].y);
      expect(played[i].step).toBe(once[i].step);
    }
  });

  it("hides speeds above a level cap and keeps the new shortcuts off R, G, M and D", () => {
    expect(SIM_SPEEDS).toEqual([1, 2, 4, 8, 16, 32]);
    expect(SPEED_KEY["8"]).toBe(8);
    expect(SPEED_KEY[","]).toBe(16);
    expect(SPEED_KEY["."]).toBe(32);
    for (const key of ["r", "R", "g", "G", "m", "M", "d", "D"]) expect(SPEED_KEY[key]).toBeUndefined();

    const game = createGame({ ...passage, maxSpeed: 4 });
    setSpeed(game, 32);
    expect(game.speed).toBe(1);
    setSpeed(game, 8);
    expect(game.speed).toBe(1);
    setSpeed(game, 4);
    expect(game.speed).toBe(4);
  });
});
