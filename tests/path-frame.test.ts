import { describe, expect, it } from "vitest";
import { simConfigFromLevel } from "../src/level/catalog";
import { pathApproaches, showPath } from "../src/render/path-frame";
import { bodyPose, flyPlan, makeState, predictPlan, type Body, type BurnNode } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";

/** Departure, lunar insertion, leave after one lap, Earth capture. Same burns as the mission test. */
const plan: BurnNode[] = [
  { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
  { step: 1209, dvx: 9.207295198561756, dvy: 8.181441674484159 },
  { step: 2911, dvx: 4.169690499008103, dvy: -2.7592899707137617 },
  { step: 4679, dvx: 3.6546281923744104, dvy: 15.317513431665407 },
];

function body(id: string): Body {
  const found = moonMission.bodies.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("predicted path in world coordinates", () => {
  const config = simConfigFromLevel(moonMission);
  const start = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);

  it("draws a circular Earth orbit as a cycloid that travels with Earth", () => {
    const predicted = predictPlan(start(), config, []);
    const drawn = showPath(predicted.path, moonMission.bodies, moonMission.g, moonMission.dt, 0);
    expect(drawn.length).toBe(predicted.path.length);
    expect(drawn.length).toBeGreaterThan(1000);
    const earthNow = bodyPose(body("earth"), 0, moonMission.bodies, moonMission.g);
    let far = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < drawn.length; i++) {
      expect(drawn[i].x).toBe(predicted.path[i].x);
      expect(drawn[i].y).toBe(predicted.path[i].y);
      far = Math.max(far, Math.hypot(drawn[i].x - earthNow.x, drawn[i].y - earthNow.y));
      minX = Math.min(minX, drawn[i].x);
      maxX = Math.max(maxX, drawn[i].x);
    }
    // Earth moves around the Sun, so the coast is not a closed loop on today's Earth.
    expect(far).toBeGreaterThan(1000);
    expect(maxX - minX).toBeGreaterThan(1000);
  });

  it("draws a lunar sample on the Moon's position at that time", () => {
    const dt = moonMission.dt;
    const step = Math.round(30 / dt);
    const moonNow = bodyPose(body("luna"), 0, moonMission.bodies, moonMission.g);
    const moonThen = bodyPose(body("luna"), step * dt, moonMission.bodies, moonMission.g);
    const deep = { x: moonThen.x + 30, y: moonThen.y, step };
    const drawn = showPath([deep], moonMission.bodies, moonMission.g, dt, 0)[0];
    expect(drawn.x).toBe(deep.x);
    expect(drawn.y).toBe(deep.y);
    expect(Math.hypot(moonThen.x - moonNow.x, moonThen.y - moonNow.y)).toBeGreaterThan(30);
  });

  it("leaves a fixed body's samples where the sim put them", () => {
    const star: Body = { id: "star", name: "Star", kind: "star", x: 0, y: 0, mass: 100, radius: 10 };
    const samples = [
      { x: 40, y: 0, step: 30 },
      { x: 0, y: -40, step: 90 },
    ];
    const drawn = showPath(samples, [star], 1, 1 / 60, 0);
    expect(drawn[0]).toEqual({ x: 40, y: 0, bodyId: "" });
    expect(drawn[1]).toEqual({ x: 0, y: -40, bodyId: "" });
  });

  it("still matches the flight sample for sample", () => {
    const predicted = predictPlan(start(), config, plan);
    const flown = flyPlan(start(), config, plan, 1);
    expect(predicted.status).toBe("won");
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      const got = flown.path[i];
      const want = predicted.path[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step) {
        throw new Error(`diverged at sample ${i} (step ${want.step})`);
      }
    }
    const drawn = showPath(predicted.path, moonMission.bodies, moonMission.g, moonMission.dt, 0);
    for (let i = 0; i < drawn.length; i++) {
      expect(drawn[i].x).toBe(predicted.path[i].x);
      expect(drawn[i].y).toBe(predicted.path[i].y);
    }
    const marks = pathApproaches(predicted.path, moonMission.bodies, moonMission.g, moonMission.dt, 0);
    const mark = marks.find((item) => item.bodyId === "luna");
    expect(mark).toBeDefined();
    if (!mark) return;
    const index = predicted.path.findIndex((sample) => sample.step === mark.step);
    expect(index).toBeGreaterThan(0);
    const dt = moonMission.dt;
    const moonThen = bodyPose(body("luna"), mark.step * dt, moonMission.bodies, moonMission.g);
    const moonNow = bodyPose(body("luna"), 0, moonMission.bodies, moonMission.g);
    const ship = predicted.path[index];
    expect(drawn[index].x).toBe(ship.x);
    expect(drawn[index].y).toBe(ship.y);
    expect(mark.x).toBe(moonThen.x);
    expect(mark.y).toBe(moonThen.y);
    expect(Math.hypot(ship.x - mark.x, ship.y - mark.y)).toBeLessThan(body("luna").captureRadius ?? 0);
    expect(Math.hypot(mark.x - moonNow.x, mark.y - moonNow.y)).toBeGreaterThan(body("luna").captureRadius ?? 0);
  });
});
