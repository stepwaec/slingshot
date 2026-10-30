import { describe, expect, it } from "vitest";
import { createGame, setPlan } from "../src/game/state";
import { ghostSteps } from "../src/game/ghosts";
import { simConfigFromLevel, type Level } from "../src/level/catalog";
import { slingshotPlan } from "./support/plans";
import { stage } from "./support/stage";
import { bodyPose, flyPlan, keplerMeanMotion, makeState, predictPlan, type Body } from "../src/sim/physics";

const g = 1;
const sunMass = 8_000;
const radius = 320;
const omega = keplerMeanMotion(g, sunMass, radius);
const sun: Body = { id: "sun", name: "Sun", kind: "star", x: 0, y: 0, mass: sunMass, radius: 20 };
const target: Body = {
  id: "x",
  name: "Planet X",
  kind: "target",
  x: radius,
  y: 0,
  mass: 400,
  radius: 16,
  captureRadius: 48,
  orbit: { centerId: "sun", radius, phase: 0, omega },
};
const chart: Level = {
  ...stage,
  id: "kepler-stage",
  bodies: [sun, target],
  targetId: "x",
  ship: { x: -500, y: 80, vx: 4, vy: 0 },
  orbit: { bodyId: "sun", radius: 500 },
  maxSteps: 180,
};

describe("LU2 moving bodies", () => {
  it("keeps Planet X on the Kepler circle for any sim time", () => {
    const orbit = target.orbit;
    if (!orbit) throw new Error("orbit");
    expect(orbit.omega).toBeCloseTo(keplerMeanMotion(g, sun.mass, orbit.radius), 12);
    for (const time of [0, 4.25, 18, 60.5]) {
      const pose = bodyPose(target, time, chart.bodies, g);
      const angle = orbit.phase + orbit.omega * time;
      expect(pose.x).toBeCloseTo(sun.x + orbit.radius * Math.cos(angle), 8);
      expect(pose.y).toBeCloseTo(sun.y + orbit.radius * Math.sin(angle), 8);
      expect(pose.vx).toBeCloseTo(-orbit.radius * orbit.omega * Math.sin(angle), 8);
      expect(pose.vy).toBeCloseTo(orbit.radius * orbit.omega * Math.cos(angle), 8);
    }
  });

  it("matches the prediction to the flight while Planet X moves", () => {
    const config = simConfigFromLevel(chart);
    const state = makeState(chart.ship.x, chart.ship.y, chart.ship.vx, chart.ship.vy, config);
    const nodes = [{ step: 20, dvx: 0.2, dvy: 0.1 }];
    const predicted = predictPlan(state, config, nodes);
    const flown = flyPlan(state, config, nodes, 1);
    expect(predicted.status).toBe(flown.status);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.path.length).toBeGreaterThan(nodes[0].step);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
    const atCapture = bodyPose(target, 2, chart.bodies, g);
    const atLaunch = bodyPose(target, 0, chart.bodies, g);
    expect(atCapture.x).not.toBe(atLaunch.x);
  });

  it("lists node and cursor steps for ghosts without touching the prediction", () => {
    const nodes = [
      { step: 0, dvx: 1, dvy: 0 },
      { step: 230, dvx: -1, dvy: 0 },
    ];
    expect(ghostSteps(nodes, 400, 0)).toEqual([230, 400]);
    expect(ghostSteps(nodes, 230, 0)).toEqual([230]);
    expect(ghostSteps(nodes, null, 0)).toEqual([230]);
    const game = createGame(stage);
    setPlan(game, slingshotPlan);
    const prediction = game.prediction;
    const pathX = prediction.path[10]?.x;
    game.cursorStep = 400;
    expect(game.prediction).toBe(prediction);
    expect(game.prediction.path[10]?.x).toBe(pathX);
    expect(game.prediction.status).toBe("won");
  });
});
