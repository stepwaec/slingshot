import { describe, expect, it } from "vitest";
import { createGame, setPlan } from "../src/game/state";
import { ghostSteps, movingBodies } from "../src/game/ghosts";
import { lead, simConfigFromLevel } from "../src/level/catalog";
import { leadPlan } from "../src/level/solutions";
import { bodyPose, flyPlan, keplerMeanMotion, makeState, predictPlan } from "../src/sim/physics";

describe("LU2 moving bodies", () => {
  const target = lead.bodies.find((body) => body.id === "x");
  const sun = lead.bodies.find((body) => body.id === "sun");
  if (!target?.orbit || !sun) throw new Error("Lead is missing Planet X");

  it("keeps Planet X on the Kepler circle for any sim time", () => {
    const orbit = target.orbit;
    if (!orbit) throw new Error("orbit");
    expect(orbit.omega).toBeCloseTo(keplerMeanMotion(lead.g, sun.mass, orbit.radius), 12);
    for (const time of [0, 4.25, 18, 60.5]) {
      const pose = bodyPose(target, time, lead.bodies, lead.g);
      const angle = orbit.phase + orbit.omega * time;
      expect(pose.x).toBe(sun.x + orbit.radius * Math.cos(angle));
      expect(pose.y).toBe(sun.y + orbit.radius * Math.sin(angle));
      expect(pose.vx).toBe(-orbit.radius * orbit.omega * Math.sin(angle));
      expect(pose.vy).toBe(orbit.radius * orbit.omega * Math.cos(angle));
    }
  });

  it("matches the prediction to the flight while Planet X moves", () => {
    const config = simConfigFromLevel(lead);
    const state = makeState(lead.ship.x, lead.ship.y, lead.ship.vx, lead.ship.vy, config);
    const predicted = predictPlan(state, config, leadPlan);
    const flown = flyPlan(state, config, leadPlan, 1);
    expect(predicted.status).toBe("won");
    expect(flown.status).toBe("won");
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
    const atCapture = bodyPose(target, 230 * lead.dt, lead.bodies, lead.g);
    const atLaunch = bodyPose(target, 0, lead.bodies, lead.g);
    expect(atCapture.x).not.toBe(atLaunch.x);
  });

  it("lists node and cursor steps for ghosts without touching the prediction", () => {
    expect(movingBodies(lead.bodies).map((body) => body.id)).toEqual(["x"]);
    expect(ghostSteps(leadPlan, 400, 0)).toEqual([230, 400]);
    expect(ghostSteps(leadPlan, 230, 0)).toEqual([230]);
    expect(ghostSteps(leadPlan, null, 0)).toEqual([230]);
    const game = createGame(lead);
    setPlan(game, leadPlan);
    const prediction = game.prediction;
    const pathX = prediction.path[10]?.x;
    game.cursorStep = 400;
    expect(game.prediction).toBe(prediction);
    expect(game.prediction.path[10]?.x).toBe(pathX);
    expect(game.prediction.status).toBe("won");
  });
});
