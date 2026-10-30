import { describe, expect, it } from "vitest";
import { LevelError, loadLevelData } from "../src/level/schema";
import {
  SOLAR_CUTOFF,
  SOLAR_RREF,
  advancePlan,
  bodyPose,
  keplerMeanMotion,
  makeState,
  solarRechargeRate,
  starLuminosity,
  type Body,
  type SimConfig,
} from "../src/sim/physics";

function star(look: Body["look"], radius = 30): Body {
  return { id: "star", name: "star", kind: "star", look, x: 0, y: 0, mass: 0, radius };
}

describe("approved sim review", () => {
  it("scales recharge by luminosity and switches off below 8%", () => {
    const sun = star("sun");
    const giant = star("red-giant");
    const dwarf = star("white-dwarf");
    const hole = { ...sun, id: "hole", kind: "blackhole" as const, look: undefined };
    expect(starLuminosity(sun)).toBe(1);
    expect(starLuminosity(giant)).toBe(1.5);
    expect(starLuminosity(dwarf)).toBe(0.2);
    expect(starLuminosity({ ...sun, look: "neutron" })).toBe(0);
    expect(starLuminosity(hole)).toBe(0);

    const full = solarRechargeRate(0, SOLAR_RREF, 0, [sun], 10);
    expect(full).toBe(10);
    expect(solarRechargeRate(0, SOLAR_RREF, 0, [giant], 10)).toBe(15);
    expect(solarRechargeRate(0, SOLAR_RREF, 0, [dwarf], 10)).toBe(2);
    expect(solarRechargeRate(0, 20, 0, [sun], 10)).toBe(10);
    const dim = (SOLAR_RREF / Math.sqrt(SOLAR_CUTOFF / 2));
    expect(solarRechargeRate(dim, 0, 0, [sun], 10)).toBe(0);
    expect(solarRechargeRate(0, SOLAR_RREF, 0, [hole], 10)).toBe(0);

    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      c: 1_000_000,
      bodies: [sun],
      bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
      maxSteps: 2,
      targetId: "star",
      periapsisMargin: 1,
      solarStrength: 10,
      fuelStart: 0,
      fuelMax: 100,
      fuelPerDv: 1,
    };
    const step = makeState(0, 200, 0, 0, config);
    const before = step.tank;
    advancePlan(step, config, [], { index: 0 });
    const rate = solarRechargeRate(step.x, step.y, step.t, config.bodies, 10, config.g);
    expect(step.recharged).toBeCloseTo(Math.min(rate * config.dt, (config.fuelMax ?? before) - before), 8);
    expect(step.recharged).toBeGreaterThan(0);
  });

  it("accepts a Kepler moon and rejects a fast one", () => {
    const copy = JSON.parse(JSON.stringify({
      id: "bad",
      name: "Bad",
      g: 1,
      dt: 1 / 60,
      bodies: [
        { id: "x", name: "X", kind: "target", x: 0, y: 0, mass: 2200, radius: 20, captureRadius: 50 },
        { id: "moon", name: "moon", kind: "moon", x: 44, y: 0, mass: 1, radius: 4, orbit: { centerId: "x", radius: 44, phase: 0, omega: 1.1 } },
      ],
      targetId: "x",
      ship: { x: 0, y: 80, vx: 0, vy: 0 },
      orbit: { bodyId: "x", radius: 40 },
      fuel: 10,
      fuelPerDv: 1,
      bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
      maxSteps: 10,
      dvPerPixel: 0.2,
      periapsisMargin: 2,
      c: 1000,
      mission: { deadline: 10, crewLimit: 10, fuelStarMin: 0, crewWeight: 1, fuelWeight: 1 },
    }));
    expect(() => loadLevelData(copy, "bad.json")).toThrow(LevelError);
    try {
      loadLevelData(copy, "bad.json");
    } catch (error) {
      expect((error as LevelError).issues.join("\n")).toMatch(/omega/);
    }
    const good = JSON.parse(JSON.stringify(copy)) as typeof copy;
    const planetMass = good.bodies[0].mass as number;
    const moonOrbit = good.bodies[1].orbit as { radius: number; omega: number };
    moonOrbit.omega = keplerMeanMotion(good.g, planetMass, moonOrbit.radius);
    expect(() => loadLevelData(good, "good.json")).not.toThrow();
  });

  it("keeps a stored ellipse mean motion when g changes", () => {
    const host = star("sun", 20);
    host.mass = 5_000;
    host.id = "sun";
    const a = 180;
    const omega = keplerMeanMotion(1, host.mass, a);
    const comet: Body = {
      id: "comet",
      name: "comet",
      kind: "planet",
      look: "comet",
      x: 0,
      y: 0,
      mass: 1,
      radius: 5,
      orbit: {
        kind: "ellipse",
        centerId: "sun",
        a,
        e: 0.6,
        periapsisAngle: 0.4,
        phase: 0.2,
        radius: a * (1 - 0.6),
        omega,
      },
    };
    const bodies = [host, comet];
    expect(omega).toBeCloseTo(Math.sqrt(host.mass / a ** 3), 12);
    const pose = bodyPose(comet, 4, bodies);
    const posed = bodyPose(comet, 4, bodies, 99);
    expect(pose.x).toBe(posed.x);
    expect(pose.y).toBe(posed.y);
  });
});
