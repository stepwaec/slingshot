import { describe, expect, it } from "vitest";
import {
  canPause,
  createGame,
  launch,
  pause,
  resume,
  setPlan,
  setSlow,
  tick,
  type Game,
} from "../src/game/state";
import { passage, simConfigFromLevel, slingshotPlan, type Level } from "../src/level/passage";
import { relay, relayFull } from "../src/level/relay";
import { flyPlan, makeState, type BurnNode, type PathSample, type SimSpeed } from "../src/sim/physics";

function samplesOf(game: Game): PathSample[] {
  const samples: PathSample[] = [];
  let guard = 0;
  const limit = game.level.maxSteps * 4;
  while (game.mode === "flying" && guard++ < limit) {
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) samples.push(game.frameSamples[i]);
  }
  return samples;
}

function reference(level: Level, nodes: readonly BurnNode[]): PathSample[] {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  return flyPlan(state, { ...config, horizon: undefined }, nodes, 1).path;
}

function play(
  level: Level,
  nodes: readonly BurnNode[],
  speed: SimSpeed,
  slow: boolean,
  pauseAt: readonly number[],
): PathSample[] {
  const game = createGame(level);
  setPlan(game, nodes);
  game.speed = speed;
  setSlow(game, slow);
  launch(game);
  const want = new Set(pauseAt);
  const samples: PathSample[] = [];
  let guard = 0;
  while (game.mode === "flying" && guard++ < level.maxSteps * 4) {
    if (want.has(game.ship.step)) {
      const step = game.ship.step;
      const x = game.ship.x;
      expect(pause(game)).toBe(true);
      expect(game.mode).toBe("paused");
      expect(game.ship.step).toBe(step);
      expect(game.ship.x).toBe(x);
      resume(game);
      expect(game.mode).toBe("flying");
      expect(game.ship.step).toBe(step);
      want.delete(step);
    }
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) samples.push(game.frameSamples[i]);
  }
  expect(want.size).toBe(0);
  return samples;
}

function expectPath(actual: readonly PathSample[], expected: readonly PathSample[], label: string): void {
  expect(actual, label).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i].x !== expected[i].x || actual[i].y !== expected[i].y || actual[i].step !== expected[i].step) {
      throw new Error(`${label} diverged at sample ${i} (step ${expected[i].step})`);
    }
  }
}

describe("tactical pause", () => {
  it("matches an uninterrupted flight when paused at arbitrary steps, including slow motion", () => {
    const cases: Array<{ level: Level; nodes: readonly BurnNode[]; pauses: number[] }> = [
      { level: passage, nodes: slingshotPlan, pauses: [0, 1, 3, 17, 128, 400, 1000, 1800] },
      {
        level: { ...relay, pause: { kind: "unlimited" } },
        nodes: relayFull,
        pauses: [0, 2, 9, 80, 81, 400, 1200, 2000, 2500],
      },
    ];
    for (const item of cases) {
      const expected = reference(item.level, item.nodes);
      const onFrame = item.pauses.filter((step) => step % 4 === 0);
      expectPath(play(item.level, item.nodes, 1, false, item.pauses), expected, `${item.level.id} 1x`);
      expectPath(play(item.level, item.nodes, 4, false, onFrame), expected, `${item.level.id} 4x`);
      expectPath(play(item.level, item.nodes, 2, true, item.pauses), expected, `${item.level.id} slow`);
    }
  });

  it("enforces unlimited, free, and score pause rules", () => {
    const unlimited = createGame();
    setPlan(unlimited, slingshotPlan);
    launch(unlimited);
    for (let i = 0; i < 5; i++) {
      expect(canPause(unlimited)).toBe(true);
      expect(pause(unlimited)).toBe(true);
      expect(unlimited.score).toBe(0);
      resume(unlimited);
    }

    const freeLevel: Level = { ...passage, pause: { kind: "free", count: 2 } };
    const free = createGame(freeLevel);
    setPlan(free, [{ step: 0, dvx: 1, dvy: 0 }]);
    launch(free);
    expect(pause(free)).toBe(true);
    expect(free.pausesUsed).toBe(1);
    resume(free);
    tick(free);
    expect(pause(free)).toBe(true);
    expect(free.pausesUsed).toBe(2);
    resume(free);
    const step = free.ship.step;
    expect(canPause(free)).toBe(false);
    expect(pause(free)).toBe(false);
    expect(free.mode).toBe("flying");
    expect(free.ship.step).toBe(step);

    const scored: Level = { ...passage, pause: { kind: "score", cost: 10, budget: 25 } };
    const game = createGame(scored);
    setPlan(game, [{ step: 0, dvx: 1, dvy: 0 }]);
    launch(game);
    expect(game.score).toBe(25);
    expect(pause(game)).toBe(true);
    expect(game.score).toBe(15);
    resume(game);
    expect(pause(game)).toBe(true);
    expect(game.score).toBe(5);
    resume(game);
    expect(canPause(game)).toBe(false);
    expect(pause(game)).toBe(false);
    expect(game.mode).toBe("flying");
    expect(game.score).toBe(5);

    const quiet = samplesOf(game);
    const straight = createGame(scored);
    setPlan(straight, [{ step: 0, dvx: 1, dvy: 0 }]);
    launch(straight);
    expectPath(samplesOf(straight), quiet, "score pauses");
  });
});
