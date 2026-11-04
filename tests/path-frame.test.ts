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

describe("predicted path in the dominant body's frame", () => {
  const config = simConfigFromLevel(moonMission);
  const start = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);

  it("draws a circular Earth orbit as a closed loop around Earth", () => {
    const predicted = predictPlan(start(), config, []);
    const inertial = predicted.path.map((sample) => ({ x: sample.x, y: sample.y, step: sample.step }));
    const drawn = showPath(predicted.path, moonMission.bodies, moonMission.g, moonMission.dt, 0);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(predicted.path[i].x).toBe(inertial[i].x);
      expect(predicted.path[i].y).toBe(inertial[i].y);
      expect(predicted.path[i].step).toBe(inertial[i].step);
    }
    const earthNow = bodyPose(body("earth"), 0, moonMission.bodies, moonMission.g);
    let maxDrawn = 0;
    let minDrawn = Infinity;
    let maxInertial = 0;
    const quadrant = [false, false, false, false];
    expect(drawn.length).toBe(predicted.path.length);
    expect(drawn.length).toBeGreaterThan(1000);
    for (let i = 0; i < drawn.length; i++) {
      const point = drawn[i];
      expect(point.bodyId).toBe("earth");
      const dx = point.x - earthNow.x;
      const dy = point.y - earthNow.y;
      const radius = Math.hypot(dx, dy);
      maxDrawn = Math.max(maxDrawn, radius);
      minDrawn = Math.min(minDrawn, radius);
      maxInertial = Math.max(maxInertial, Math.hypot(inertial[i].x - earthNow.x, inertial[i].y - earthNow.y));
      quadrant[(dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0)] = true;
    }
    // Inertial samples follow Earth around the Sun, so the coast leaves the drawn Earth.
    expect(maxInertial).toBeGreaterThan(1000);
    // The drawn coast stays near low Earth orbit and wraps the planet.
    // The heavier Moon lets that orbit breathe, so the band is wider than 52±4.
    expect(minDrawn).toBeGreaterThan(36);
    expect(maxDrawn).toBeLessThan(80);
    expect(quadrant).toEqual([true, true, true, true]);
  });

  it("draws a point on the lunar sphere around the Moon, and blends the handover", () => {
    const dt = moonMission.dt;
    const t = 30;
    const step = Math.round(t / dt);
    const moonNow = bodyPose(body("luna"), 0, moonMission.bodies, moonMission.g);
    const moonThen = bodyPose(body("luna"), step * dt, moonMission.bodies, moonMission.g);
    const earthNow = bodyPose(body("earth"), 0, moonMission.bodies, moonMission.g);
    const earthThen = bodyPose(body("earth"), step * dt, moonMission.bodies, moonMission.g);
    const offset = 30;
    const deep = { x: moonThen.x + offset, y: moonThen.y, step };
    const drawnDeep = showPath([deep], moonMission.bodies, moonMission.g, dt, 0)[0];
    expect(drawnDeep.bodyId).toBe("luna");
    expect(drawnDeep.x).toBeCloseTo(moonNow.x + offset, 6);
    expect(drawnDeep.y).toBeCloseTo(moonNow.y, 6);

    const sepX = earthThen.x - moonThen.x;
    const sepY = earthThen.y - moonThen.y;
    const sep = Math.hypot(sepX, sepY);
    const shell = 90;
    const crossing = { x: moonThen.x + (sepX / sep) * shell, y: moonThen.y + (sepY / sep) * shell, step };
    const moonFrame = { x: moonNow.x + (sepX / sep) * shell, y: moonNow.y + (sepY / sep) * shell };
    const earthFrame = {
      x: earthNow.x + (crossing.x - earthThen.x),
      y: earthNow.y + (crossing.y - earthThen.y),
    };
    const blended = showPath([crossing], moonMission.bodies, moonMission.g, dt, 0)[0];
    const spanX = moonFrame.x - earthFrame.x;
    const spanY = moonFrame.y - earthFrame.y;
    const along = (spanX * (blended.x - earthFrame.x) + spanY * (blended.y - earthFrame.y)) / (spanX * spanX + spanY * spanY);
    expect(along).toBeGreaterThan(0.15);
    expect(along).toBeLessThan(0.9);
    expect(Math.hypot(blended.x - earthFrame.x, blended.y - earthFrame.y)).toBeGreaterThan(1);
    expect(Math.hypot(blended.x - moonFrame.x, blended.y - moonFrame.y)).toBeGreaterThan(1);
  });

  it("leaves a fixed body's samples where the sim put them", () => {
    const star: Body = { id: "star", name: "Star", kind: "star", x: 0, y: 0, mass: 100, radius: 10 };
    const samples = [
      { x: 40, y: 0, step: 30 },
      { x: 0, y: -40, step: 90 },
    ];
    const drawn = showPath(samples, [star], 1, 1 / 60, 0);
    expect(drawn[0]).toEqual({ x: 40, y: 0, bodyId: "star" });
    expect(drawn[1]).toEqual({ x: 0, y: -40, bodyId: "star" });
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
    expect(drawn.some((point) => point.bodyId === "earth")).toBe(true);
    expect(drawn.some((point) => point.bodyId === "luna")).toBe(true);
    const marks = pathApproaches(predicted.path, moonMission.bodies, moonMission.g, moonMission.dt, 0);
    const mark = marks.find((item) => item.bodyId === "luna");
    expect(mark).toBeDefined();
    if (!mark) return;
    const index = predicted.path.findIndex((sample) => sample.step === mark.step);
    expect(index).toBeGreaterThan(0);
    const dt = moonMission.dt;
    const earthNow = bodyPose(body("earth"), 0, moonMission.bodies, moonMission.g);
    const earthThen = bodyPose(body("earth"), mark.step * dt, moonMission.bodies, moonMission.g);
    const moonThen = bodyPose(body("luna"), mark.step * dt, moonMission.bodies, moonMission.g);
    const moonNow = bodyPose(body("luna"), 0, moonMission.bodies, moonMission.g);
    const ship = predicted.path[index];
    // Closest approach is the Earth-frame point, so the stroke does not jump.
    expect(drawn[index].x).toBeCloseTo(earthNow.x + (ship.x - earthThen.x), 6);
    expect(drawn[index].y).toBeCloseTo(earthNow.y + (ship.y - earthThen.y), 6);
    expect(Math.hypot(drawn[index].x - mark.x, drawn[index].y - mark.y)).toBeLessThan(body("luna").captureRadius ?? 0);
    expect(mark.x).toBeCloseTo(earthNow.x + (moonThen.x - earthThen.x), 6);
    expect(mark.y).toBeCloseTo(earthNow.y + (moonThen.y - earthThen.y), 6);
    // The Moon moves along its orbit, so that meeting point is not the sprite.
    expect(Math.hypot(mark.x - moonNow.x, mark.y - moonNow.y)).toBeGreaterThan(body("luna").captureRadius ?? 0);
  });
});
