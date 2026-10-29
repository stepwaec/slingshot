import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { passage, relay, rescue, simConfigFromLevel, type Level } from "../src/level/catalog";
import { deepPlan, directPlan, relayFull, safePlan, slingshotPlan } from "../src/level/solutions";
import { advancePlan, assessPlan, makeState, type BurnNode } from "../src/sim/physics";
import { scoreMission, type MissionScore } from "../src/sim/score";

interface FixtureScore {
  arrived: boolean;
  outsideTime: number;
  shipTime: number;
  fuelLeft: number;
  pauseSpent: number;
  gap: number;
  hardFail: string | null;
  points: number;
  stars: { deadline: boolean; crew: boolean; fuel: boolean };
}

interface FixtureRun {
  id: string;
  status: string;
  lostReason: string | null;
  crashedBodyId: string | null;
  steps: number;
  final: { x: number; y: number; vx: number; vy: number; t: number; tau: number; rate: number };
  fuelLeft: number;
  score: FixtureScore;
  samples: number[][];
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/level-trajectories.json", import.meta.url), "utf8"),
) as FixtureRun[];

const runs: Record<string, { level: Level; nodes: readonly BurnNode[] }> = {
  "passage-slingshot": { level: passage, nodes: slingshotPlan },
  "passage-direct": { level: passage, nodes: directPlan },
  "relay-full": { level: relay, nodes: relayFull },
  "rescue-safe": { level: rescue, nodes: safePlan },
  "rescue-deep": { level: rescue, nodes: deepPlan },
};

function trace(level: Level, nodes: readonly BurnNode[]) {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const cursor = { index: 0 };
  const samples: number[][] = [];
  let guard = 0;
  while (state.status === "flying" && guard++ <= config.maxSteps + nodes.length + 2) {
    advancePlan(state, config, nodes, cursor);
    samples.push([state.step, state.x, state.y, state.vx, state.vy, state.t, state.tau, state.rate]);
  }
  const fuel = assessPlan(nodes, level.fuel, level.fuelPerDv);
  const mission = level.mission;
  const score = scoreMission({
    arrived: state.status === "won",
    outsideTime: state.t,
    shipTime: state.tau,
    fuelLeft: fuel.left,
    pauseSpent: 0,
    deadline: mission.deadline,
    crewLimit: mission.crewLimit,
    fuelStarMin: mission.fuelStarMin,
    crewWeight: mission.crewWeight,
    fuelWeight: mission.fuelWeight,
  });
  return { state, fuelLeft: fuel.left, score, samples };
}

function expectSameScore(actual: MissionScore, expected: FixtureScore, id: string): void {
  expect(actual.arrived, id).toBe(expected.arrived);
  expect(actual.outsideTime, id).toBe(expected.outsideTime);
  expect(actual.shipTime, id).toBe(expected.shipTime);
  expect(actual.fuelLeft, id).toBe(expected.fuelLeft);
  expect(actual.pauseSpent, id).toBe(expected.pauseSpent);
  expect(actual.gap, id).toBe(expected.gap);
  expect(actual.hardFail, id).toBe(expected.hardFail);
  expect(actual.points, id).toBe(expected.points);
  expect(actual.stars, id).toEqual(expected.stars);
}

function expectSameTrace(level: Level, run: FixtureRun): void {
  const spec = runs[run.id];
  const traced = trace(level, spec.nodes);
  expect(traced.state.status, run.id).toBe(run.status);
  expect(traced.state.lostReason, run.id).toBe(run.lostReason);
  expect(traced.state.crashedBodyId, run.id).toBe(run.crashedBodyId);
  expect(traced.state.step, run.id).toBe(run.steps);
  expect(traced.state.x, run.id).toBe(run.final.x);
  expect(traced.state.y, run.id).toBe(run.final.y);
  expect(traced.state.vx, run.id).toBe(run.final.vx);
  expect(traced.state.vy, run.id).toBe(run.final.vy);
  expect(traced.state.t, run.id).toBe(run.final.t);
  expect(traced.state.tau, run.id).toBe(run.final.tau);
  expect(traced.state.rate, run.id).toBe(run.final.rate);
  expect(traced.fuelLeft, run.id).toBe(run.fuelLeft);
  expectSameScore(traced.score, run.score, run.id);
  expect(traced.samples.length, run.id).toBe(run.samples.length);
  for (let i = 0; i < run.samples.length; i++) {
    const got = traced.samples[i];
    const want = run.samples[i];
    for (let k = 0; k < want.length; k++) {
      if (got[k] !== want[k]) {
        throw new Error(
          `${run.id} sample ${i} field ${k}: ${got[k]} !== ${want[k]} (step ${want[0]})`,
        );
      }
    }
  }
}

describe("shipped levels match the pre-move flights", () => {
  it("replays Passage, Relay, and Rescue bit for bit", () => {
    expect(fixture.map((run) => run.id)).toEqual([
      "passage-slingshot",
      "passage-direct",
      "relay-full",
      "rescue-safe",
      "rescue-deep",
    ]);
    for (const run of fixture) expectSameTrace(runs[run.id].level, run);
  });

  it("explicit default knobs stay bit-identical", () => {
    const defaults = {
      gravityScale: 1,
      eps: 0,
      p: 2,
      dilationStrength: 1,
      tidalStrength: 0,
      dragStrength: 0,
    };
    const tuned: Record<string, Level> = {
      "passage-slingshot": { ...passage, physics: defaults },
      "passage-direct": { ...passage, physics: defaults },
      "relay-full": { ...relay, physics: defaults },
      "rescue-safe": { ...rescue, physics: defaults },
      "rescue-deep": { ...rescue, physics: defaults },
    };
    for (const run of fixture) expectSameTrace(tuned[run.id], run);
  });
});
