import { describe, expect, it } from "vitest";
import { ash, simConfigFromLevel } from "../src/level/catalog";
import { ashPlan } from "../src/level/solutions";
import {
  acceleration,
  bodyPose,
  bodyPresent,
  flyPlan,
  makeState,
  predictPlan,
  type Body,
  type SimConfig,
} from "../src/sim/physics";

describe("LU3 scripted collisions", () => {
  const planet = ash.bodies.find((body) => body.id === "x");
  const sun = ash.bodies.find((body) => body.id === "sun");
  if (!planet?.orbit || !planet.script || planet.script.kind !== "consume" || !sun) {
    throw new Error("Ash is missing the falling planet");
  }

  it("follows the Kepler rail until the fall, then spirals into the sun", () => {
    const orbit = planet.orbit;
    if (!orbit) throw new Error("orbit");
    const before = bodyPose(planet, 1, ash.bodies, ash.g);
    const angle = orbit.phase + orbit.omega * 1;
    expect(before.x).toBe(sun.x + orbit.radius * Math.cos(angle));
    expect(before.y).toBe(sun.y + orbit.radius * Math.sin(angle));

    const fall = planet.script?.kind === "consume" ? planet.script : undefined;
    if (!fall) throw new Error("consume");
    const atStart = bodyPose(planet, fall.start, ash.bodies, ash.g);
    const mid = bodyPose(planet, 40, ash.bodies, ash.g);
    const late = bodyPose(planet, 70, ash.bodies, ash.g);
    const startR = Math.hypot(atStart.x - sun.x, atStart.y - sun.y);
    const midR = Math.hypot(mid.x - sun.x, mid.y - sun.y);
    const lateR = Math.hypot(late.x - sun.x, late.y - sun.y);
    expect(startR).toBeCloseTo(orbit.radius, 6);
    expect(midR).toBeLessThan(startR);
    expect(lateR).toBeLessThan(midR);
    expect(lateR).toBeGreaterThan(sun.radius);
    expect(bodyPresent(planet, 70)).toBe(true);
    expect(bodyPresent(planet, fall.end)).toBe(false);
  });

  it("drops a consumed body's gravity and removes an impactor", () => {
    const fall = planet.script?.kind === "consume" ? planet.script : undefined;
    if (!fall) throw new Error("consume");
    const end = fall.end;
    const near = bodyPose(planet, end - 1, ash.bodies, ash.g);
    const before = acceleration(near.x + 30, near.y, simConfigFromLevel(ash), end - 1);
    const after = acceleration(near.x + 30, near.y, simConfigFromLevel(ash), end + 1);
    expect(Math.hypot(before.ax, before.ay)).toBeGreaterThan(Math.hypot(after.ax, after.ay));

    const host: Body = { id: "p", name: "p", kind: "planet", x: 0, y: 0, mass: 10, radius: 8 };
    const rock: Body = {
      id: "r",
      name: "r",
      kind: "planet",
      x: 40,
      y: 0,
      mass: 500,
      radius: 4,
      script: { kind: "impact", at: 2, into: "p" },
    };
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      bodies: [host, rock],
      bounds: { minX: -200, maxX: 200, minY: -200, maxY: 200 },
      maxSteps: 10,
      targetId: "p",
      periapsisMargin: 1,
      c: 1e6,
    };
    const pulled = acceleration(40, 12, config, 0);
    const gone = acceleration(40, 12, config, 3);
    expect(Math.hypot(pulled.ax, pulled.ay)).toBeGreaterThan(Math.hypot(gone.ax, gone.ay));
    expect(bodyPresent(rock, 3)).toBe(false);
  });

  it("matches the prediction to a capture made before the planet burns", () => {
    const config = simConfigFromLevel(ash);
    const state = makeState(ash.ship.x, ash.ship.y, ash.ship.vx, ash.ship.vy, config);
    const predicted = predictPlan(state, config, ashPlan);
    const flown = flyPlan(state, config, ashPlan, 1);
    expect(predicted.status).toBe("won");
    expect(flown.status).toBe("won");
    const fall = planet.script?.kind === "consume" ? planet.script : undefined;
    if (!fall) throw new Error("consume");
    expect(predicted.final.t).toBeLessThan(fall.end);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
    const later = bodyPose(planet, 50, ash.bodies, ash.g);
    const early = bodyPose(planet, 0, ash.bodies, ash.g);
    expect(Math.hypot(later.x - sun.x, later.y - sun.y)).toBeLessThan(Math.hypot(early.x - sun.x, early.y - sun.y));
  });

  it("burns the planet and loses the same way in prediction and flight", () => {
    const star: Body = { id: "sun", name: "sun", kind: "star", x: 0, y: 0, mass: 100, radius: 8 };
    const falling: Body = {
      id: "x",
      name: "x",
      kind: "target",
      x: 80,
      y: 0,
      mass: 10,
      radius: 5,
      captureRadius: 20,
      orbit: { centerId: "sun", radius: 80, phase: 0, omega: Math.sqrt(100 / 80 ** 3) },
      script: { kind: "consume", centerId: "sun", start: 0, end: 4, radius: 8 },
    };
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      bodies: [star, falling],
      bounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
      maxSteps: 2000,
      targetId: "x",
      periapsisMargin: 1,
      c: 1e6,
    };
    const state = makeState(400, 0, 0, 0, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(predicted.status).toBe("lost");
    expect(predicted.lostReason).toBe("burned");
    expect(flown.status).toBe("lost");
    expect(flown.lostReason).toBe("burned");
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.path.at(-1)?.x).toBe(predicted.path.at(-1)?.x);
  });
});
