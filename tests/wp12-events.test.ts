import { describe, expect, it } from "vitest";
import { observatory } from "../src/level/catalog";
import { blastHits, jetAngle, quasarDamage, shellRadius, shockCrosses, type Supernova } from "../src/sim/events";
import { flyPlan, makeState, predictPlan, type Body, type SimConfig } from "../src/sim/physics";

const nova: Supernova = { at: 10, blast: 40, speed: 50, damage: 30 };

describe("WP12 supernovae and quasars", () => {
  it("detonates inside the blast and crosses a ship with the shock once", () => {
    expect(shellRadius(nova, 9)).toBe(0);
    expect(shellRadius(nova, 12)).toBe(100);
    expect(blastHits(30, 30, nova, 9.9, 10.1)).toBe(true);
    expect(blastHits(80, 80, nova, 9.9, 10.1)).toBe(false);
    expect(blastHits(20, 20, nova, 11, 12)).toBe(false);

    const dt = 1;
    let hits = 0;
    for (let t = 0; t < 20; t += dt) {
      if (shockCrosses(80, 80, nova, t, t + dt)) hits += 1;
    }
    expect(hits).toBe(1);
    expect(shockCrosses(80, 80, nova, 10, 11)).toBe(false);
    expect(shockCrosses(80, 80, nova, 11, 12)).toBe(true);
  });

  it("damages only inside the quasar cones, and precesses on sim time", () => {
    const jet = { angle: 0, cone: 0.2, reach: 100, damage: 10, period: 10, sweep: 0.5 };
    expect(jetAngle(jet, 0)).toBe(0);
    expect(jetAngle(jet, 2.5)).toBeCloseTo(0.5, 8);
    expect(quasarDamage(50, 0, jet, 0)).toBe(10);
    expect(quasarDamage(-50, 0, jet, 0)).toBe(10);
    expect(quasarDamage(0, 50, jet, 0)).toBe(0);
    expect(quasarDamage(50, 0, jet, 2.5)).toBe(0);
  });

  it("matches the prediction to the flight, including the remnant shock", () => {
    const exhibit = observatory.bodies.find((body) => body.supernova);
    const rock = observatory.bodies.find((body) => body.look === "asteroid");
    if (!exhibit?.supernova || !rock) throw new Error("observatory hazard");
    expect(rock.mass).toBe(0);
    expect(rock.radius).toBe(15);
    const sun: Body = {
      ...exhibit,
      x: 0,
      y: 0,
      supernova: { ...exhibit.supernova, at: 1, blast: 40, speed: 30, damage: 20 },
    };
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      bodies: [sun, { ...rock, x: 300, y: 40 }],
      bounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
      maxSteps: 400,
      targetId: sun.id,
      periapsisMargin: 1,
      c: 1e6,
      fuelStart: 10,
      fuelMax: 10,
      fuelPerDv: 1,
    };
    const start = makeState(120, 0, 0, 0, config);
    const predicted = predictPlan(start, config, []);
    const flown = flyPlan(start, config, [], 1);
    expect(predicted.status).toBe(flown.status);
    expect(predicted.final.hull).toBeLessThan(100);
    expect(predicted.final.hull).toBeGreaterThan(0);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
  });

  it("loses a ship inside the blast the same way in prediction and flight", () => {
    const sun: Body = {
      id: "sun",
      name: "sun",
      kind: "star",
      x: 0,
      y: 0,
      mass: 1,
      radius: 10,
      supernova: { at: 1, blast: 50, speed: 20, damage: 10 },
    };
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      bodies: [sun],
      bounds: { minX: -500, maxX: 500, minY: -500, maxY: 500 },
      maxSteps: 200,
      targetId: "sun",
      periapsisMargin: 1,
      c: 1e6,
    };
    const start = makeState(20, 0, 0, 0, config);
    const predicted = predictPlan(start, config, []);
    const flown = flyPlan(start, config, [], 1);
    expect(predicted.status).toBe("lost");
    expect(predicted.lostReason).toBe("nova");
    expect(flown.status).toBe("lost");
    expect(flown.lostReason).toBe("nova");
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.path.at(-1)?.x).toBe(predicted.path.at(-1)?.x);
  });
});
