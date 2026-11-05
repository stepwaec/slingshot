import { describe, expect, it } from "vitest";
import {
  acceptGuide,
  buildMoveRail,
  createGame,
  deleteNode,
  dismissGuide,
  launch,
  moveNodeAlong,
  pause,
  refreshGuide,
  resume,
  selectGuide,
  setNodeBurn,
  setPlan,
  tick,
} from "../src/game/state";
import { simConfigFromLevel } from "../src/level/catalog";
import { syncTopDown } from "../src/render/camera";
import { showPath } from "../src/render/path-frame";
import { theme } from "../src/render/theme";
import { createGuide } from "../src/render/visuals/guide";
import { bodyPose, flyPlan, makeState, type BurnNode, type PathSample } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";
import { slingshotPlan } from "./support/plans";
import { stage } from "./support/stage";

/** Published Mission 1 departure. Alone, it hits the Moon. */
const departure: BurnNode[] = [{ step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 }];

const reference: BurnNode[] = [
  { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
  { step: 1209, dvx: 9.207295198561756, dvy: 8.181441674484159 },
  { step: 2911, dvx: 4.169690499008103, dvy: -2.7592899707137617 },
  { step: 4679, dvx: 3.6546281923744104, dvy: 15.317513431665407 },
];

/** Every predicted sample matches the flight. The flight may run past the preview. */
function matchesFlight(label: string, flown: readonly PathSample[], predicted: readonly PathSample[]): void {
  expect(predicted.length, label).toBeGreaterThan(10);
  expect(flown.length, label).toBeGreaterThanOrEqual(predicted.length);
  for (let i = 0; i < predicted.length; i++) {
    const a = flown[i];
    const b = predicted[i];
    if (a.x !== b.x || a.y !== b.y || a.step !== b.step || a.rate !== b.rate) {
      throw new Error(`${label} diverged at sample ${i} (step ${b.step})`);
    }
  }
}

describe("Moon trajectory guidance", () => {
  const config = simConfigFromLevel(moonMission);
  const moon = moonMission.bodies.find((body) => body.id === "luna");
  if (!moon) throw new Error("moon");

  it("offers both ghosts and does not apply them", () => {
    const game = createGame(moonMission);
    refreshGuide(game);
    expect(game.guide).toBeNull();

    setPlan(game, departure);
    expect(game.nodes).toEqual(departure);
    expect(game.prediction.status).toBe("crashed");
    expect(game.prediction.crashedBodyId).toBe("luna");
    const guide = game.guide;
    if (!guide) throw new Error("expected an offer");
    expect(guide.bodyId).toBe("luna");
    expect(guide.selected).toBeNull();
    expect(guide.options.map((option) => option.intent)).toEqual(["flyby", "capture"]);
    expect(guide.options.every((option) => option.burns.length === 1)).toBe(true);
    expect(guide.options.every((option) => option.burns[0].step > 0)).toBe(true);
  });

  it("draws the capture ghost on the Moon's framed path", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    const capture = game.guide?.options.find((option) => option.intent === "capture");
    if (!capture) throw new Error("capture");
    const drawn = showPath(capture.path, moonMission.bodies, moonMission.g, moonMission.dt, 0);
    expect(drawn.length).toBe(capture.path.length);
    const early = drawn.find((_, index) => capture.path[index].step < 40);
    expect(early?.bodyId).toBe("");
    let lunar = 0;
    for (let i = 0; i < drawn.length; i++) {
      if (drawn[i].bodyId !== "luna") continue;
      const pose = bodyPose(moon, capture.path[i].step * moonMission.dt, moonMission.bodies, moonMission.g);
      const distance = Math.hypot(capture.path[i].x - pose.x, capture.path[i].y - pose.y);
      if (distance < (moon.captureRadius ?? 0)) lunar += 1;
    }
    expect(lunar).toBeGreaterThan(20);
  });

  it("accepts a capture burn the player can edit, and the flight matches", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    expect(acceptGuide(game)).toBe(false);
    selectGuide(game, "capture");
    expect(acceptGuide(game)).toBe(true);
    expect(game.guide).toBeNull();
    expect(game.nodes).toHaveLength(2);
    expect(game.nodes[0]).toEqual(departure[0]);
    const burn = game.nodes[1];
    expect(burn.step).toBeGreaterThan(1000);
    expect(Math.hypot(burn.dvx, burn.dvy)).toBeGreaterThan(1);

    const start = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    const flown = flyPlan(start(), config, game.nodes, 1);
    matchesFlight("capture", flown.path, game.prediction.path);
    expect(game.prediction.final.leg).toBeGreaterThanOrEqual(1);

    let skimmed = false;
    for (let i = 0; i < game.prediction.path.length; i++) {
      const sample = game.prediction.path[i];
      if (sample.step < burn.step) continue;
      const pose = bodyPose(moon, sample.step * moonMission.dt, moonMission.bodies, moonMission.g);
      const distance = Math.hypot(sample.x - pose.x, sample.y - pose.y);
      if (distance < 31 && distance > moon.radius) skimmed = true;
    }
    expect(skimmed).toBe(true);

    const index = 1;
    const nextDv = burn.dvx + 0.25;
    setNodeBurn(game, index, nextDv, burn.dvy - 0.1);
    expect(game.mode).toBe("planning");
    expect(game.cursor.index).toBe(0);
    expect(game.nodes[index].dvx).toBeCloseTo(nextDv, 8);
    const moved = flyPlan(start(), config, game.nodes, 1);
    matchesFlight("edited capture", moved.path, game.prediction.path);

    const rail = buildMoveRail(game, index);
    expect(rail.length).toBeGreaterThan(30);
    const hop = rail[Math.min(20, rail.length - 1)];
    moveNodeAlong(game, index, rail, hop);
    expect(game.nodes[index].step).toBe(hop.step);
    const slid = flyPlan(start(), config, game.nodes, 1);
    matchesFlight("moved capture", slid.path, game.prediction.path);

    deleteNode(game, index);
    expect(game.nodes).toEqual(departure);
    expect(game.guide?.options.map((option) => option.intent)).toEqual(["flyby", "capture"]);
  });

  it("accepts a flyby that misses the surface and does not capture", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    selectGuide(game, "flyby");
    expect(acceptGuide(game)).toBe(true);
    expect(game.nodes).toHaveLength(2);
    expect(game.nodes[0]).toEqual(departure[0]);
    const start = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    const flown = flyPlan(start(), config, game.nodes, 1);
    matchesFlight("flyby", flown.path, game.prediction.path);
    expect(game.prediction.status).not.toBe("crashed");
    expect(game.prediction.final.leg).toBe(0);
    expect(game.prediction.lostReason).toBe("flyby");
    let nearest = Infinity;
    for (let i = 0; i < game.prediction.path.length; i++) {
      const sample = game.prediction.path[i];
      const pose = bodyPose(moon, sample.step * moonMission.dt, moonMission.bodies, moonMission.g);
      nearest = Math.min(nearest, Math.hypot(sample.x - pose.x, sample.y - pose.y));
    }
    expect(nearest).toBeGreaterThan(moon.radius + moonMission.periapsisMargin);
    expect(nearest).toBeLessThan(moon.captureRadius ?? 0);
  });

  it("dismisses without changing the plan, until the plan changes", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    const before = game.nodes.map((node) => ({ ...node }));
    dismissGuide(game);
    expect(game.guide).toBeNull();
    expect(game.nodes).toEqual(before);
    refreshGuide(game);
    expect(game.guide).toBeNull();
    deleteNode(game, 0);
    expect(game.guide).toBeNull();
    setPlan(game, departure);
    expect(game.guide?.options.length).toBe(2);
  });

  it("locks the fired departure and still matches after a pause", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    launch(game);
    let guard = 0;
    while (game.mode === "flying" && game.ship.step < 600 && guard++ < moonMission.maxSteps) tick(game);
    expect(pause(game)).toBe(true);
    const fired = { ...game.nodes[0] };
    expect(game.guide?.options.map((option) => option.intent)).toEqual(["flyby", "capture"]);
    selectGuide(game, "capture");
    expect(acceptGuide(game)).toBe(true);
    expect(game.nodes[0]).toEqual(fired);
    setNodeBurn(game, 0, 3, 3);
    expect(game.nodes[0]).toEqual(fired);
    deleteNode(game, 0);
    expect(game.nodes[0]).toEqual(fired);

    const pauseStep = game.ship.step;
    const future = game.prediction.path.filter((sample) => sample.step > pauseStep);
    expect(future.length).toBeGreaterThan(10);
    resume(game);
    const flown: PathSample[] = [];
    guard = 0;
    while (flown.length < future.length && game.mode === "flying" && guard++ < moonMission.maxSteps) {
      tick(game);
      for (let i = 0; i < game.frameSamples.length; i++) flown.push(game.frameSamples[i]);
    }
    matchesFlight("pause capture", flown, future);
  });

  it("stays quiet once the Moon capture is already in the plan, and on charts without the Moon", () => {
    const solved = createGame(moonMission);
    setPlan(solved, reference);
    expect(solved.prediction.status).toBe("won");
    expect(solved.guide).toBeNull();

    const other = createGame(stage);
    setPlan(other, slingshotPlan);
    expect(other.guide).toBeNull();
  });

  it("still helps a departure aimed a little off the published burn", () => {
    const angle = 0.03;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dvx = departure[0].dvx;
    const dvy = departure[0].dvy;
    const game = createGame(moonMission);
    setPlan(game, [{ step: 0, dvx: c * dvx - s * dvy, dvy: s * dvx + c * dvy }]);
    expect(game.prediction.crashedBodyId).toBe("luna");
    expect(game.guide?.options.map((option) => option.intent)).toContain("capture");
    selectGuide(game, "capture");
    expect(acceptGuide(game)).toBe(true);
    const start = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    const flown = flyPlan(start(), config, game.nodes, 1);
    matchesFlight("offset capture", flown.path, game.prediction.path);
    expect(game.prediction.final.leg).toBeGreaterThanOrEqual(1);
  });

  it("strokes the ghost only while the offer is up", () => {
    const game = createGame(moonMission);
    setPlan(game, departure);
    selectGuide(game, "flyby");
    syncTopDown(game.camera, 800, 600);
    const visual = createGuide(theme, moonMission);
    visual.update({ game, width: 800, height: 600, now: 0, dpr: 1 });
    const flyby = visual.object.getObjectByName("guide-flyby");
    const capture = visual.object.getObjectByName("guide-capture");
    expect(flyby?.visible).toBe(true);
    expect(capture?.visible).toBe(true);
    dismissGuide(game);
    visual.update({ game, width: 800, height: 600, now: 0, dpr: 1 });
    expect(flyby?.visible).toBe(false);
    expect(capture?.visible).toBe(false);
    visual.dispose();
  });
});
