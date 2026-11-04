import { describe, expect, it } from "vitest";
import {
  addNode,
  createGame,
  deleteNode,
  launch,
  pause,
  resume,
  setNodeBurn,
  setPlan,
  tick,
} from "../src/game/state";
import { simConfigFromLevel } from "../src/level/catalog";
import { stage } from "./support/stage";
import { slingshotLaunch } from "./support/plans";
import { cloneState, flyPlan, makeState, type PathSample } from "../src/sim/physics";

const nodes = [
  { step: 0, dvx: slingshotLaunch.dvx, dvy: slingshotLaunch.dvy },
  { step: 400, dvx: 0.35, dvy: -0.2 },
  { step: 900, dvx: -0.25, dvy: 0.4 },
  { step: 1600, dvx: 0.15, dvy: 0.1 },
];

function flyTo(step: number): void {
  let guard = 0;
  while (game.mode === "flying" && game.ship.step < step && guard++ < stage.maxSteps) tick(game);
}

let game = createGame(stage);

function matchFlight(label: string, untilStep: number | null): void {
  const pauseStep = game.ship.step;
  const future = game.prediction.path.filter((sample) => sample.step > pauseStep && (untilStep === null || sample.step <= untilStep));
  expect(future.length, label).toBeGreaterThan(10);
  resume(game);
  const flown: PathSample[] = [];
  let guard = 0;
  while (flown.length < future.length && game.mode === "flying" && guard++ < stage.maxSteps) {
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) flown.push(game.frameSamples[i]);
  }
  expect(flown.length, label).toBeGreaterThanOrEqual(future.length);
  for (let i = 0; i < future.length; i++) {
    const got = flown[i];
    const want = future[i];
    if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
      throw new Error(
        `${label} diverged at sample ${i} (step ${want.step}): (${got.x}, ${got.y}) vs (${want.x}, ${want.y})`,
      );
    }
  }
}

describe("pause and replan", () => {
  it("locks past burns and matches the flight after several replans", () => {
    game = createGame(stage);
    setPlan(game, nodes);
    launch(game);

    flyTo(180);
    expect(pause(game)).toBe(true);
    expect(game.mode).toBe("paused");
    const fired = game.nodes[0];
    setNodeBurn(game, 0, 4, 4);
    expect(game.nodes[0].dvx).toBe(fired.dvx);
    expect(game.nodes[0].dvy).toBe(fired.dvy);
    deleteNode(game, 0);
    expect(game.nodes[0].step).toBe(0);
    addNode(game, 40);
    expect(game.nodes.some((node) => node.step === 40)).toBe(false);

    const future = game.nodes.findIndex((node) => node.step === 400);
    expect(future).toBeGreaterThan(0);
    setNodeBurn(game, future, 0.5, -0.15);
    addNode(game, 600);
    const added = game.nodes.findIndex((node) => node.step === 600);
    expect(added).toBeGreaterThan(future);
    setNodeBurn(game, added, 0.2, 0.25);
    const drop = game.nodes.findIndex((node) => node.step === 900);
    deleteNode(game, drop);
    expect(game.nodes.some((node) => node.step === 900)).toBe(false);
    matchFlight("first replan", 700);

    flyTo(700);
    expect(game.mode).toBe("flying");
    expect(pause(game)).toBe(true);
    const firedMid = game.nodes.findIndex((node) => node.step === 600);
    expect(firedMid).toBeLessThan(game.cursor.index);
    const firedDv = game.nodes[firedMid].dvx;
    setNodeBurn(game, firedMid, 3, 3);
    expect(game.nodes[firedMid].dvx).toBe(firedDv);
    addNode(game, 1100);
    const late = game.nodes.findIndex((node) => node.step === 1100);
    expect(late).toBeGreaterThanOrEqual(game.cursor.index);
    setNodeBurn(game, late, 0.1, -0.3);
    matchFlight("second replan", 1400);

    flyTo(1400);
    expect(pause(game)).toBe(true);
    const last = game.nodes.findIndex((node) => node.step === 1600);
    expect(last).toBeGreaterThanOrEqual(game.cursor.index);
    setNodeBurn(game, last, 0.55, 0.2);
    matchFlight("third replan", null);
  });

  it("keeps a recorded disturbance from changing the flight until a kind exists", () => {
    const config = simConfigFromLevel(stage);
    const origin = makeState(stage.ship.x, stage.ship.y, stage.ship.vx, stage.ship.vy, config);
    const marked = cloneState(origin);
    marked.disturbances.push({ step: 10 });
    expect(origin.disturbances).toHaveLength(0);
    const plain = flyPlan(origin, config, nodes, 1);
    const noted = flyPlan(marked, config, nodes, 1);
    expect(noted.path.length).toBe(plain.path.length);
    for (let i = 0; i < plain.path.length; i++) {
      expect(noted.path[i].x).toBe(plain.path[i].x);
      expect(noted.path[i].y).toBe(plain.path[i].y);
      expect(noted.path[i].step).toBe(plain.path[i].step);
      expect(noted.path[i].rate).toBe(plain.path[i].rate);
    }
  });
});
