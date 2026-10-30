import { describe, expect, it } from "vitest";
import { simConfigFromLevel } from "../src/level/catalog";
import { stage as passage } from "./support/stage";
import { slingshotLaunch } from "./support/plans";
import { buildMoveRail, createGame, moveNodeAlong, setPlan } from "../src/game/state";
import { flyPlan, makeState, predictPlan, type BurnNode } from "../src/sim/physics";

const nodes: BurnNode[] = [
  { step: 0, dvx: slingshotLaunch.dvx, dvy: slingshotLaunch.dvy },
  { step: 400, dvx: 0.6, dvy: -0.3 },
  { step: 900, dvx: -0.4, dvy: 0.55 },
];

function initial() {
  const config = simConfigFromLevel(passage);
  return { config, state: makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config) };
}

describe("plan cache", () => {
  it("editing a later node does not change the path before it", () => {
    const { config, state } = initial();
    const original = predictPlan(state, config, nodes);
    const edited = nodes.map((node, index) =>
      index === 2 ? { ...node, dvx: node.dvx + 4, dvy: node.dvy - 3 } : { ...node },
    );
    const fresh = predictPlan(state, config, edited);
    const cut = nodes[2].step;
    const before = original.path.filter((sample) => sample.step <= cut);
    const after = fresh.path.filter((sample) => sample.step <= cut);
    expect(before.length).toBe(cut);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBe(before[i].x);
      expect(after[i].y).toBe(before[i].y);
      expect(after[i].step).toBe(before[i].step);
    }
    const changed = fresh.path.some(
      (sample, index) =>
        sample.step > cut &&
        (sample.x !== original.path[index]?.x || sample.y !== original.path[index]?.y),
    );
    expect(changed).toBe(true);

    const reused = predictPlan(state, config, edited, {
      snapshots: original.snapshots,
      from: 2,
      kind: "burn",
    });
    expect(reused.snapshots[0]).toBe(original.snapshots[0]);
    expect(reused.snapshots[1]).toBe(original.snapshots[1]);
    expect(reused.snapshots[2].approach).toBe(original.snapshots[2].approach);
    const reusedPrefix = reused.path.filter((sample) => sample.step <= cut);
    expect(reusedPrefix).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) expect(reusedPrefix[i]).toBe(before[i]);
    expect(flyPlan(state, config, edited, 1).path).toEqual(reused.path);
  });

  it("moving a later node keeps the cached path before it and still matches flight", () => {
    const game = createGame(passage);
    setPlan(game, nodes);
    const rail = buildMoveRail(game, 2);
    const target = rail.find((sample) => sample.step === 1100);
    expect(target).toBeDefined();
    if (!target) return;
    const first = game.prediction.snapshots[0];
    const second = game.prediction.snapshots[1];
    const cut = nodes[1].step;
    const prefix = game.prediction.path.filter((sample) => sample.step <= cut);
    moveNodeAlong(game, 2, rail, target);
    expect(game.nodes[2].step).toBe(1100);
    expect(game.prediction.snapshots[0]).toBe(first);
    expect(game.prediction.snapshots[1]).toBe(second);
    const kept = game.prediction.path.filter((sample) => sample.step <= cut);
    expect(kept).toHaveLength(prefix.length);
    for (let i = 0; i < prefix.length; i++) expect(kept[i]).toBe(prefix[i]);
    const { config, state } = initial();
    expect(flyPlan(state, config, game.nodes, 1).path).toEqual(game.prediction.path);
  });

  it("recomputes a dragged node quickly enough for 60fps", () => {
    const { config, state } = initial();
    const base = predictPlan(state, config, nodes);
    const runs = 8;
    const started = performance.now();
    for (let i = 0; i < runs; i++) {
      const edited = nodes.map((node, index) => (index === 2 ? { ...node, dvx: node.dvx + i * 0.15 } : node));
      predictPlan(state, config, edited, { snapshots: base.snapshots, from: 2, kind: "burn" });
    }
    const averageMs = (performance.now() - started) / runs;
    expect(averageMs).toBeLessThan(16);
  });
});
