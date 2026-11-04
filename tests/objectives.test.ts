import { describe, expect, it } from "vitest";
import { simConfigFromLevel } from "../src/level/catalog";
import { compileMission } from "../src/world/compile";
import type { Mission, Region, World } from "../src/world/types";
import {
  advancePlan,
  flyPlan,
  makeState,
  predictPlan,
  step,
  type Body,
  type BurnNode,
  type SimConfig,
} from "../src/sim/physics";

const home: Body = {
  id: "home",
  name: "Home",
  kind: "planet",
  x: 0,
  y: 0,
  mass: 2000,
  radius: 20,
  captureRadius: 80,
};
const away: Body = {
  id: "away",
  name: "Away",
  kind: "planet",
  x: 520,
  y: 0,
  mass: 2000,
  radius: 20,
  captureRadius: 80,
};

function config(objectives?: SimConfig["objectives"], targetId = "home"): SimConfig {
  return {
    g: 1,
    dt: 1 / 60,
    bodies: [home, away],
    bounds: { minX: -400, maxX: 1000, minY: -400, maxY: 400 },
    maxSteps: 6000,
    targetId,
    periapsisMargin: 4,
    c: 100_000,
    fuelPerDv: 1,
    fuelStart: 200,
    fuelMax: 200,
    objectives,
  };
}

const circularSpeed = Math.sqrt(2000 / 40);

function inOrbit() {
  return makeState(40, 0, 0, circularSpeed, config());
}

describe("orbit capture and multi-leg objectives", () => {
  it("still wins a coasting stable orbit when the flight has no objectives", () => {
    const state = inOrbit();
    step(state, config());
    expect(state.status).toBe("won");
  });

  it("does not capture a stable orbit until a burn inside the zone", () => {
    const objectives = [{ id: "home", bodyId: "home", kind: "capture" as const }];
    const coast = inOrbit();
    const coastConfig = config(objectives);
    for (let i = 0; i < 90; i++) step(coast, coastConfig);
    expect(coast.status).toBe("flying");
    expect(coast.leg).toBe(0);

    const state = inOrbit();
    const nodes: BurnNode[] = [{ step: 30, dvx: 0.02, dvy: 0 }];
    const predicted = predictPlan(state, coastConfig, nodes);
    const flown = flyPlan(state, coastConfig, nodes, 1);
    expect(predicted.status).toBe("won");
    expect(predicted.final.leg).toBe(0);
    expect(flown.status).toBe(predicted.status);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
  });

  it("fails a capture flyby and completes a flyby leg on the same pass", () => {
    const pass = (kind: "capture" | "flyby") => {
      const state = makeState(-160, 36, 28, 0, config());
      const flight = config([{ id: "home", bodyId: "home", kind }]);
      const predicted = predictPlan(state, flight, []);
      const flown = flyPlan(state, flight, [], 1);
      expect(flown.status).toBe(predicted.status);
      expect(flown.lostReason).toBe(predicted.lostReason);
      expect(flown.steps).toBe(predicted.steps);
      expect(flown.path.length).toBe(predicted.path.length);
      for (let i = 0; i < predicted.path.length; i++) {
        if (flown.path[i].x !== predicted.path[i].x || flown.path[i].y !== predicted.path[i].y) {
          throw new Error(`diverged at ${i}`);
        }
      }
      return predicted;
    };
    const captured = pass("capture");
    expect(captured.status).toBe("lost");
    expect(captured.lostReason).toBe("flyby");
    const flew = pass("flyby");
    expect(flew.status).toBe("won");
  });

  it("keeps flying after the first leg and wins on the second", () => {
    const objectives = [
      { id: "home", bodyId: "home", kind: "capture" as const },
      { id: "away", bodyId: "away", kind: "flyby" as const },
    ];
    const flight = config(objectives, "away");
    const state = inOrbit();
    const nodes: BurnNode[] = [
      { step: 20, dvx: 0.02, dvy: 0 },
      { step: 40, dvx: 12, dvy: -8 },
    ];
    const predicted = predictPlan(state, flight, nodes);
    expect(predicted.final.leg).toBeGreaterThanOrEqual(1);
    const flown = flyPlan(state, flight, nodes, 1);
    expect(flown.status).toBe(predicted.status);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
    }
    expect(predicted.status).toBe("won");
    expect(predicted.final.leg).toBe(1);

    const early = makeState(40, 0, 0, circularSpeed, flight);
    const cursor = { index: 0 };
    for (let i = 0; i < 25; i++) advancePlan(early, flight, nodes, cursor);
    expect(early.leg).toBe(1);
    expect(early.status).toBe("flying");
  });

  it("does not complete a capture from a burn outside the zone", () => {
    const flight = config([{ id: "home", bodyId: "home", kind: "capture" }]);
    const state = makeState(220, 40, -1, 1, flight);
    const nodes: BurnNode[] = [{ step: 0, dvx: 0.4, dvy: -0.2 }];
    const predicted = predictPlan(state, flight, nodes);
    const flown = flyPlan(state, flight, nodes, 1);
    expect(predicted.final.leg).toBe(0);
    expect(predicted.status).not.toBe("won");
    expect(flown.status).toBe(predicted.status);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
  });

  it("compiles objectives onto the sim config", () => {
    const world: World = {
      id: "legs",
      name: "Legs",
      g: 1,
      dt: 1 / 60,
      c: 100_000,
      bodies: [home, away],
      bounds: { minX: -400, maxX: 1000, minY: -400, maxY: 400 },
    };
    const region: Region = {
      id: "both",
      worldId: "legs",
      name: "Both",
      bounds: world.bounds,
      bodyIds: ["home", "away"],
    };
    const mission: Mission = {
      id: "out-and-back",
      name: "Out and back",
      worldId: "legs",
      regionId: "both",
      ship: { x: 40, y: 0, vx: 0, vy: circularSpeed },
      orbit: { bodyId: "home", radius: 40 },
      fuel: 80,
      fuelPerDv: 1,
      maxSteps: 4000,
      dvPerPixel: 0.5,
      periapsisMargin: 4,
      scoring: { deadline: 80, crewLimit: 80, fuelStarMin: 10, crewWeight: 1, fuelWeight: 1 },
      objectives: [
        { id: "leave", bodyId: "home", kind: "capture", label: "Capture Home" },
        { id: "return", bodyId: "away", kind: "flyby", label: "Pass Away" },
      ],
      targetId: "away",
    };
    const level = compileMission([world], [region], mission);
    const sim = simConfigFromLevel(level);
    expect(sim.objectives?.map((item) => item.bodyId)).toEqual(["home", "away"]);
    expect(level.bodies[0]).toBe(home);
  });
});
