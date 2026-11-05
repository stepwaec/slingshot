import { describe, expect, it } from "vitest";
import {
  addNode,
  createGame,
  currentPreviewSeconds,
  deleteNode,
  dismissGuide,
  launch,
  openBodyGuide,
  pause,
  resume,
  setNodeBurn,
  setPlan,
  setPreviewSeconds,
  tick,
} from "../src/game/state";
import { extendTip, planningPointerHit, settlePlanningClick } from "../src/game/input";
import { simConfigFromLevel } from "../src/level/catalog";
import { worldToScreen } from "../src/render/camera";
import { shownPoint } from "../src/render/path-frame";
import { MOON_REACH_HINT } from "../src/sim/guidance";
import {
  bodyPose,
  extensionSteps,
  flyPlan,
  makeState,
  planHorizonEnd,
  predictPlan,
  previewRange,
  step,
  type PathSample,
} from "../src/sim/physics";
import { LOST_TIMEOUT_SECONDS, moonMission } from "../src/world/moon-mission";

const WIDTH = 1280;
const HEIGHT = 720;

/** Published Mission 1 departure. Alone, it meets the Moon. */
const departure = [{ step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 }];

function endStep(path: readonly { step: number }[]): number {
  return path[path.length - 1].step;
}

function matches(label: string, flown: readonly PathSample[], predicted: readonly PathSample[]): void {
  expect(predicted.length, label).toBeGreaterThan(10);
  expect(flown.length, label).toBeGreaterThanOrEqual(predicted.length);
  for (let i = 0; i < predicted.length; i++) {
    const got = flown[i];
    const want = predicted[i];
    if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
      throw new Error(`${label} diverged at sample ${i} (step ${want.step})`);
    }
  }
}

function screenOf(game: ReturnType<typeof createGame>, x: number, y: number): { x: number; y: number } {
  game.camera.x = x;
  game.camera.y = y;
  game.camera.zoom = 1;
  return worldToScreen(game.camera, WIDTH, HEIGHT, x, y);
}

describe("planning past the fade tip", () => {
  const config = simConfigFromLevel(moonMission);

  it("lets Mission 1 extend past today's horizon, out to the flight timeout", () => {
    const state = makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    const range = previewRange(state, config);
    expect(range.defaultSeconds).toBeCloseTo(140, 5);
    expect(range.maxSeconds).toBeCloseTo(LOST_TIMEOUT_SECONDS, 5);
    expect(range.maxSeconds).toBeGreaterThan(range.defaultSeconds * 2);
  });

  it("grows the coast from the current end and still matches a fresh prediction", () => {
    const game = createGame(moonMission);
    const state = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    const before = endStep(game.prediction.path);
    const past = before + 80;
    expect(past).toBeGreaterThan(planHorizonEnd(game.initial, config, [], extensionSteps(game.initial, config, null)));
    addNode(game, past);
    expect(game.nodes.some((node) => node.step === past)).toBe(false);

    const base = currentPreviewSeconds(game);
    extendTip(game, 4 * 30, base);
    const after = endStep(game.prediction.path);
    expect(after).toBeGreaterThan(before);
    expect(game.previewSeconds).toBeGreaterThan(base);

    const direct = predictPlan(state(), config, [], undefined, extensionSteps(game.initial, config, game.previewSeconds));
    matches("extended coast", direct.path, game.prediction.path);

    const withBurn = createGame(moonMission);
    setPlan(withBurn, [{ step: 40, dvx: 0.25, dvy: -0.1 }]);
    const burnBase = currentPreviewSeconds(withBurn);
    setPreviewSeconds(withBurn, burnBase + 12);
    const burned = predictPlan(
      state(),
      config,
      withBurn.nodes,
      undefined,
      extensionSteps(withBurn.initial, config, withBurn.previewSeconds),
    );
    matches("extension after a burn", burned.path, withBurn.prediction.path);

    addNode(game, past);
    expect(game.nodes.map((node) => node.step)).toEqual([past]);
    setNodeBurn(game, 0, 0.4, -0.2);
    const flown = flyPlan(state(), config, game.nodes, 1);
    matches("burn on the extension", flown.path, game.prediction.path);
  });

  it("hits the fade tip and, in a pause, places a burn on the extended stretch", () => {
    const game = createGame(moonMission);
    const last = game.prediction.path[game.prediction.path.length - 1];
    const shown = shownPoint(game, last.x, last.y, last.step);
    const tip = screenOf(game, shown.x, shown.y);
    expect(planningPointerHit(game, WIDTH, HEIGHT, tip.x, tip.y).type).toBe("tip");

    launch(game);
    let guard = 0;
    while (game.mode === "flying" && game.ship.step < 180 && guard++ < moonMission.maxSteps) tick(game);
    expect(pause(game)).toBe(true);
    const oldEnd = endStep(game.prediction.path);
    const base = currentPreviewSeconds(game);
    extendTip(game, 4 * 20, base);
    expect(endStep(game.prediction.path)).toBeGreaterThan(oldEnd);

    const placed = oldEnd + 90;
    addNode(game, placed);
    const index = game.nodes.findIndex((node) => node.step === placed);
    expect(index).toBeGreaterThanOrEqual(0);
    setNodeBurn(game, index, 0.15, 0.05);

    const future = game.prediction.path.filter((sample) => sample.step > game.ship.step);
    expect(future.length).toBeGreaterThan(10);
    resume(game);
    const flown: PathSample[] = [];
    guard = 0;
    while (flown.length < future.length && game.mode === "flying" && guard++ < moonMission.maxSteps) {
      tick(game);
      for (let i = 0; i < game.frameSamples.length; i++) flown.push(game.frameSamples[i]);
    }
    matches("paused extension", flown, future);
  });
});

describe("lost-in-space grace", () => {
  it("flies past the old 12_000-step timeout and then times out at the new limit", () => {
    expect(LOST_TIMEOUT_SECONDS).toBe(400);
    expect(moonMission.maxSteps).toBe(24_000);
    expect(moonMission.dt * moonMission.maxSteps).toBeCloseTo(LOST_TIMEOUT_SECONDS, 6);

    const config = simConfigFromLevel(moonMission);
    const state = makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    let guard = 0;
    while (state.status === "flying" && state.step < 12_000 && guard++ < 12_002) step(state, config);
    expect(state.status).toBe("flying");
    expect(state.step).toBe(12_000);

    while (state.status === "flying" && guard++ < moonMission.maxSteps + 2) step(state, config);
    expect(state.status).toBe("lost");
    expect(state.lostReason).toBe("timeout");
    expect(state.step).toBe(moonMission.maxSteps);
  });
});

describe("click the Moon", () => {
  it("opens the flyby and capture chips when the path already reaches the Moon", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    expect(game.guide?.options.map((option) => option.intent)).toEqual(["flyby", "capture"]);
    dismissGuide(game);
    expect(game.guide).toBeNull();

    const moon = moonMission.bodies.find((body) => body.id === "luna");
    if (!moon) throw new Error("moon");
    const pose = bodyPose(moon, 0, moonMission.bodies, moonMission.g);
    const screen = screenOf(game, pose.x, pose.y);
    const hit = planningPointerHit(game, WIDTH, HEIGHT, screen.x, screen.y);
    expect(hit.type).toBe("body");
    if (hit.type !== "body") return;
    expect(hit.id).toBe("luna");
    settlePlanningClick(game, hit);
    expect(game.guideHint).toBeNull();
    expect(game.guide?.options.map((option) => option.intent)).toEqual(["flyby", "capture"]);
    expect(game.nodes).toEqual(departure);
  });

  it("hints when the path never reaches the Moon, and leaves the plan alone", () => {
    const game = createGame(moonMission);
    const before = game.nodes.map((node) => ({ ...node }));
    openBodyGuide(game, "luna");
    expect(game.guide).toBeNull();
    expect(game.guideHint).toBe(MOON_REACH_HINT);
    expect(game.nodes).toEqual(before);

    const earth = moonMission.bodies.find((body) => body.id === "earth");
    if (!earth) throw new Error("earth");
    const pose = bodyPose(earth, 0, moonMission.bodies, moonMission.g);
    const screen = screenOf(game, pose.x, pose.y);
    expect(planningPointerHit(game, WIDTH, HEIGHT, screen.x, screen.y).type).not.toBe("body");
    openBodyGuide(game, "earth");
    expect(game.guideHint).toBe(MOON_REACH_HINT);
  });

  it("keeps a fired burn locked after a pause that accepts the clicked offer", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    launch(game);
    let guard = 0;
    while (game.mode === "flying" && game.ship.step < 400 && guard++ < moonMission.maxSteps) tick(game);
    expect(pause(game)).toBe(true);
    const fired = { ...game.nodes[0] };
    openBodyGuide(game, "luna");
    expect(game.guide?.options.map((option) => option.intent)).toContain("capture");
    setNodeBurn(game, 0, 2, 2);
    deleteNode(game, 0);
    expect(game.nodes[0]).toEqual(fired);
  });
});
