import { describe, expect, it } from "vitest";
import {
  createGame,
  deleteNode,
  deleteSelected,
  launch,
  pause,
  planFuel,
  selectNode,
  setPlan,
  tick,
  type Game,
} from "../src/game/state";
import { stage as passage } from "./support/stage";
import { slingshotPlan } from "./support/plans";
import type { BurnNode, PlanFuel } from "../src/sim/physics";

const middle: BurnNode = { step: 400, dvx: 0.4, dvy: -0.2 };
const withMiddle: readonly BurnNode[] = [slingshotPlan[0], middle, slingshotPlan[1]];

function expectPlan(actual: Game, expected: Game, label: string): void {
  const got = actual.prediction;
  const want = expected.prediction;
  expect(got.status, label).toBe(want.status);
  expect(got.steps, label).toBe(want.steps);
  expect(got.crashedBodyId, label).toBe(want.crashedBodyId);
  expect(got.lostReason, label).toBe(want.lostReason);
  expect(got.path, label).toHaveLength(want.path.length);
  for (let i = 0; i < want.path.length; i++) {
    const a = got.path[i];
    const b = want.path[i];
    if (a.x !== b.x || a.y !== b.y || a.step !== b.step) {
      throw new Error(`${label} path diverged at sample ${i} (step ${b.step})`);
    }
  }
  if (want.orbit === null || got.orbit === null) {
    expect(got.orbit, label).toBe(want.orbit);
  } else {
    expect(got.orbit, label).toHaveLength(want.orbit.length);
    for (let i = 0; i < want.orbit.length; i++) {
      expect(got.orbit[i].x, label).toBe(want.orbit[i].x);
      expect(got.orbit[i].y, label).toBe(want.orbit[i].y);
    }
  }
  expectFuel(planFuel(actual), planFuel(expected), label);
}

function expectFuel(actual: PlanFuel, expected: PlanFuel, label: string): void {
  expect(actual.total, label).toBe(expected.total);
  expect(actual.left, label).toBe(expected.left);
  expect(actual.affordable, label).toBe(expected.affordable);
  expect(actual.costs, label).toHaveLength(expected.costs.length);
  for (let i = 0; i < expected.costs.length; i++) {
    expect(actual.costs[i].cost, label).toBe(expected.costs[i].cost);
    expect(actual.costs[i].remainingBefore, label).toBe(expected.costs[i].remainingBefore);
    expect(actual.costs[i].exceeds, label).toBe(expected.costs[i].exceeds);
  }
}

function pauseAt(game: Game, step: number): void {
  let guard = 0;
  while (game.mode === "flying" && game.ship.step < step && guard++ < passage.maxSteps) tick(game);
  expect(game.ship.step).toBe(step);
  expect(pause(game)).toBe(true);
}

describe("deleting a planned burn", () => {
  it("matches a plan that was built without that node", () => {
    const edited = createGame(passage);
    setPlan(edited, withMiddle);
    const before = planFuel(edited);
    selectNode(edited, 1);
    deleteSelected(edited);

    const clean = createGame(passage);
    setPlan(clean, slingshotPlan);

    expect(edited.nodes.map((node) => node.step)).toEqual(clean.nodes.map((node) => node.step));
    expectPlan(edited, clean, "planning");
    expect(planFuel(edited).total).toBeLessThan(before.total);
    expect(planFuel(edited).left).toBeGreaterThan(before.left);
    expect(edited.fuel).toBe(clean.fuel);
  });

  it("matches a paused flight whose plan never had the node, and refuses a fired burn", () => {
    const edited = createGame(passage);
    setPlan(edited, withMiddle);
    launch(edited);
    pauseAt(edited, 200);
    expect(edited.cursor.index).toBe(1);
    const spent = edited.fuel;
    const frozen = edited.prediction.path;
    expect(deleteNode(edited, 0)).toBeUndefined();
    expect(edited.nodes).toHaveLength(3);
    expect(edited.nodes[0].step).toBe(0);
    expect(edited.prediction.path).toBe(frozen);
    expect(edited.fuel).toBe(spent);

    const before = planFuel(edited);
    deleteNode(edited, 1);

    const clean = createGame(passage);
    setPlan(clean, slingshotPlan);
    launch(clean);
    pauseAt(clean, 200);

    expect(edited.ship.x).toBe(clean.ship.x);
    expect(edited.ship.y).toBe(clean.ship.y);
    expect(edited.ship.vx).toBe(clean.ship.vx);
    expect(edited.ship.vy).toBe(clean.ship.vy);
    expect(edited.ship.step).toBe(clean.ship.step);
    expect(edited.fuel).toBe(clean.fuel);
    expect(edited.fuel).toBe(spent);
    expect(edited.nodes.map((node) => `${node.step}:${node.dvx}:${node.dvy}`)).toEqual(
      clean.nodes.map((node) => `${node.step}:${node.dvx}:${node.dvy}`),
    );
    expectPlan(edited, clean, "paused");
    expect(planFuel(edited).left).toBeGreaterThan(before.left);
  });
});
