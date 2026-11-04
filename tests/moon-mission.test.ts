import { describe, expect, it } from "vitest";
import { LEVELS, WORLD_CHARTS, observatory, simConfigFromLevel } from "../src/level/catalog";
import { objectiveText } from "../src/hud/objective";
import { bodyPose, flyPlan, makeState, orbitAbout, predictPlan, type BurnNode } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";

/** Departure, lunar capture, leave the Moon, Earth capture. */
const plan: BurnNode[] = [
  { step: 0, dvx: 0, dvy: -4.6 },
  { step: 1247, dvx: 4.149142077933419, dvy: 2.2711384972551034 },
  { step: 1278, dvx: -0.8651049861158008, dvy: -0.5015908322503313 },
  { step: 2337, dvx: 1.3119158945943816, dvy: 4.959317243430171 },
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

  it("does not win a lunar flyby", () => {
    const flyby = predictPlan(state(), config, [plan[0]]);
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
    expect(objectiveText(legs, 0, "flying", false)).toBe("1/2  Capture the Moon");
    expect(objectiveText(legs, 1, "flying", false)).toBe("2/2  Return to Earth orbit");
    expect(objectiveText(legs, 0, "flying", true)).toBe("Plan completes both legs");
    expect(objectiveText(legs, 1, "won", false)).toBe("Mission complete");
  });
});
