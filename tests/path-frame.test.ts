import { describe, expect, it } from "vitest";
import { simConfigFromLevel } from "../src/level/catalog";
import { showPath } from "../src/render/path-frame";
import { bodyPose, flyPlan, makeState, predictPlan, type Body, type BurnNode } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";

/** Departure, lunar capture, leave the Moon, Earth capture. Same burns as the mission test. */
const plan: BurnNode[] = [
  { step: 0, dvx: 0, dvy: -6.15 },
  { step: 1890, dvx: 0.542338481131118, dvy: 3.880447072991457 },
  { step: 1920, dvx: -1.414213562373095, dvy: 1.4142135623730951 },
  { step: 8640, dvx: -13.83714503852748, dvy: -28.661266346109254 },
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
    // The drawn coast stays on the low Earth orbit and wraps the planet.
    expect(minDrawn).toBeGreaterThan(48);
    expect(maxDrawn).toBeLessThan(60);
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
    const shell = 62;
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
    const moonNow = bodyPose(body("luna"), 0, moonMission.bodies, moonMission.g);
    let nearest = Infinity;
    let nearestId = "";
    for (let i = 0; i < drawn.length; i++) {
      const dist = Math.hypot(drawn[i].x - moonNow.x, drawn[i].y - moonNow.y);
      if (dist < nearest) {
        nearest = dist;
        nearestId = drawn[i].bodyId;
      }
    }
    expect(nearest).toBeLessThan(body("luna").captureRadius ?? 0);
    expect(nearestId).toBe("luna");
  });
});
