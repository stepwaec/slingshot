import { describe, expect, it } from "vitest";
import { LEVELS, WORLD_CHARTS, observatory, simConfigFromLevel } from "../src/level/catalog";
import { objectiveText } from "../src/hud/objective";
import { advancePlan, bodyPose, flyPlan, makeState, orbitAbout, predictPlan, type BurnNode } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";

/** Departure, lunar insertion, leave after one lap, Earth capture. */
const plan: BurnNode[] = [
  { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
  { step: 1209, dvx: 9.207295198561756, dvy: 8.181441674484159 },
  { step: 2911, dvx: 4.169690499008103, dvy: -2.7592899707137617 },
  { step: 4679, dvx: 3.6546281923744104, dvy: 15.317513431665407 },
];

function body(id: string) {
  const found = moonMission.bodies.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("Mission 1, Moon and back", () => {
  const config = simConfigFromLevel(moonMission);
  const state = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);

  it("starts in a low Earth orbit, outside the Moon", () => {
    const start = state();
    const earth = body("earth");
    const moon = body("luna");
    const earthPose = bodyPose(earth, 0, moonMission.bodies, moonMission.g);
    const moonPose = bodyPose(moon, 0, moonMission.bodies, moonMission.g);
    const earthOrbit = orbitAbout(start, earth, moonMission.g, 0, moonMission.bodies);
    expect(earthOrbit?.bound).toBe(true);
    expect(earthOrbit!.periapsis).toBeGreaterThan(earth.radius + moonMission.periapsisMargin);
    expect(earthOrbit!.apoapsis).toBeLessThanOrEqual((earth.captureRadius ?? 0) + 1e-3);
    const earthDist = Math.hypot(start.x - earthPose.x, start.y - earthPose.y);
    const moonDist = Math.hypot(start.x - moonPose.x, start.y - moonPose.y);
    expect(earthDist).toBeLessThan(earth.captureRadius ?? 0);
    expect(moonDist).toBeGreaterThan(moon.captureRadius ?? 0);
    expect(moonMission.bodies.find((item) => item.id === "sun")).toBe(body("sun"));
    expect(moonMission.objectives?.map((item) => item.kind)).toEqual(["capture", "capture"]);
  });

  it("flies the published plan, and the prediction matches", () => {
    const predicted = predictPlan(state(), config, plan);
    const flown = flyPlan(state(), config, plan, 1);
    expect(predicted.status).toBe("won");
    expect(predicted.final.leg).toBe(1);
    expect(predicted.outsideTime).toBeLessThan(moonMission.mission.deadline);
    expect(flown.status).toBe(predicted.status);
    expect(flown.lostReason).toBe(predicted.lostReason);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.path.length).toBeGreaterThan(2000);
    for (let i = 0; i < predicted.path.length; i++) {
      const got = flown.path[i];
      const want = predicted.path[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step) {
        throw new Error(`diverged at sample ${i} (step ${want.step})`);
      }
    }
  });

  it("does not finish the Moon leg on the insertion burn", () => {
    const early = state();
    const cursor = { index: 0 };
    while (early.status === "flying" && early.step < plan[1].step + 30) {
      advancePlan(early, config, plan, cursor);
    }
    expect(early.leg).toBe(0);
    expect(early.status).toBe("flying");
    expect(early.lapBurn).toBe(1);
    expect(Math.abs(early.lap)).toBeLessThan(Math.PI * 2);
  });

  it("does not win a lunar flyby", () => {
    const flyby = predictPlan(state(), config, [{ step: 0, dvx: 1.2155, dvy: -6.8937 }]);
    expect(flyby.status).toBe("lost");
    expect(flyby.lostReason).toBe("flyby");
    expect(flyby.final.leg).toBe(0);
  });

  it("is the campaign mission and leaves the Observatory alone", () => {
    expect(LEVELS.map((level) => level.id)).toEqual(["sol-moon"]);
    expect(LEVELS[0]).toBe(moonMission);
    expect(observatory.id).not.toBe(moonMission.id);
    expect(WORLD_CHARTS.map((level) => level.id)).toEqual(["sol"]);
    expect(moonMission.bodies[0]).toBe(WORLD_CHARTS[0].bodies[0]);
  });

  it("reads the objective line", () => {
    const legs = moonMission.objectives;
    expect(objectiveText(undefined, 0, "flying", false)).toBeNull();
    expect(objectiveText(legs, 0, "flying", false)).toBe("1/2  One lap around the Moon");
    expect(objectiveText(legs, 1, "flying", false)).toBe("2/2  Return to Earth orbit");
    expect(objectiveText(legs, 0, "flying", true)).toBe("Plan completes both legs");
    expect(objectiveText(legs, 1, "won", false)).toBe("Mission complete");
  });
});
