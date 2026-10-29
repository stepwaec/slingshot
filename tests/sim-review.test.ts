import { describe, expect, it } from "vitest";
import { chain, ice, pair, relay, simConfigFromLevel, type Level } from "../src/level/catalog";
import { chainPlan, icePlan, pairPlan, relayFull } from "../src/level/solutions";
import { LevelError, loadLevelData } from "../src/level/schema";
import {
  SOLAR_CUTOFF,
  SOLAR_RREF,
  advancePlan,
  bodyPose,
  flyPlan,
  keplerMeanMotion,
  makeState,
  predictPlan,
  solarRechargeRate,
  starLuminosity,
  type Body,
  type BurnNode,
  type SimConfig,
} from "../src/sim/physics";

function star(look: Body["look"], radius = 30): Body {
  return { id: "star", name: "star", kind: "star", look, x: 0, y: 0, mass: 0, radius };
}

function expectWins(level: Level, nodes: readonly BurnNode[]): void {
  const config: SimConfig = { ...simConfigFromLevel(level), horizon: undefined };
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const predicted = predictPlan(state, config, nodes);
  const flown = flyPlan(state, config, nodes, 1);
  expect(flown.status).toBe("won");
  expect(predicted.status).toBe("won");
  expect(flown.path.length).toBe(predicted.path.length);
  for (let i = 0; i < flown.path.length; i++) {
    expect(flown.path[i].x).toBe(predicted.path[i].x);
    expect(flown.path[i].y).toBe(predicted.path[i].y);
  }
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

    const config = simConfigFromLevel(ice);
    config.solarStrength = 10;
    const state = makeState(ice.ship.x, ice.ship.y, ice.ship.vx, ice.ship.vy, config);
    const predicted = predictPlan(state, config, icePlan);
    const flown = flyPlan(state, config, icePlan, 1);
    expect(flown.status).toBe(predicted.status);
    expect(predicted.final.recharged).toBeGreaterThanOrEqual(0);
    const step = makeState(0, 200, 0, 0, config);
    const before = step.tank;
    advancePlan(step, config, [], { index: 0 });
    const rate = solarRechargeRate(step.x, step.y, step.t, config.bodies, 10, config.g);
    expect(step.recharged).toBeCloseTo(Math.min(rate * config.dt, (config.fuelMax ?? before) - before), 8);
  });

  it("keeps Relay's moon on a Kepler period and rejects a fast moon", () => {
    const moon = relay.bodies.find((body) => body.id === "moon");
    const planet = relay.bodies.find((body) => body.id === "x");
    expect(moon?.orbit?.omega).toBeCloseTo(keplerMeanMotion(relay.g, planet?.mass ?? 0, moon?.orbit?.radius ?? 1), 12);
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
  });

  it("wins Relay, Pair and Chain after the Kepler edits, matching the flight", () => {
    expectWins(relay, relayFull);
    expectWins(pair, pairPlan);
    expectWins(chain, chainPlan);
    const hot = pair.bodies.find((body) => body.id === "hot");
    const cool = pair.bodies.find((body) => body.id === "cool");
    const separation = (hot?.orbit?.radius ?? 0) + (cool?.orbit?.radius ?? 0);
    const total = (hot?.mass ?? 0) + (cool?.mass ?? 0);
    expect(separation).toBeCloseTo(156.2, 6);
    expect(hot?.orbit?.omega).toBeCloseTo(keplerMeanMotion(pair.g, total, separation), 3);
    const comet = ice.bodies.find((body) => body.look === "comet");
    const sun = ice.bodies.find((body) => body.id === "sun");
    expect(comet?.orbit?.omega).toBeCloseTo(keplerMeanMotion(ice.g, sun?.mass ?? 0, comet?.orbit?.a ?? 1), 12);
    const pose = bodyPose(comet!, 4, ice.bodies);
    const posed = bodyPose(comet!, 4, ice.bodies, 99);
    expect(pose.x).toBe(posed.x);
    expect(pose.y).toBe(posed.y);
  });
});
