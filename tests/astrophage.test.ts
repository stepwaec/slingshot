import { describe, expect, it } from "vitest";
import { dim, simConfigFromLevel, tauCeti } from "../src/level/catalog";
import { LevelError, loadLevelData } from "../src/level/schema";
import {
  DOSE_COSMIC,
  advancePlan,
  cloneState,
  doseAt,
  keplerMeanMotion,
  makeState,
  predictPlan,
  solarRechargeRate,
  starLuminosity,
  step,
  type Body,
  type BurnNode,
  type SimConfig,
} from "../src/sim/physics";
import { astroField, astroTick, harvestKnots, petrovaCurve, curvePoint } from "../src/sim/astrophage";

const dt = 1 / 60;

function bareStar(extra: Partial<Body> = {}): Body {
  return {
    id: "star",
    name: "star",
    kind: "star",
    look: "sun",
    x: 0,
    y: 0,
    mass: 0,
    radius: 46,
    ...extra,
  };
}

describe("Astrophage dimming", () => {
  it("multiplies solar recharge and the star's radiation term, and leaves a clean star alone", () => {
    const clean = bareStar();
    const infected = bareStar({ astrophage: { level: 6, dims: 0.03 } });
    const x = 120;
    const y = 0;
    const strength = 12;
    const cleanSolar = solarRechargeRate(x, y, 0, [clean], strength, 1);
    const dimSolar = solarRechargeRate(x, y, 0, [infected], strength, 1);
    expect(cleanSolar).toBeGreaterThan(0);
    expect(dimSolar).toBeCloseTo(cleanSolar * 0.97, 8);
    expect(solarRechargeRate(x, y, 0, [bareStar({ astrophage: { level: 1, dims: 0 } })], strength, 1)).toBe(cleanSolar);

    const cleanDose = doseAt(x, y, 0, [clean], 1);
    const dimDose = doseAt(x, y, 0, [infected], 1);
    expect(cleanDose.d - DOSE_COSMIC).toBeGreaterThan(0);
    expect(dimDose.d - DOSE_COSMIC).toBeCloseTo((cleanDose.d - DOSE_COSMIC) * 0.97, 8);
    expect(starLuminosity(clean)).toBe(starLuminosity(infected));
  });
});

describe("Astrophage harvest", () => {
  it("adds fuel and drains the knot only inside the radius with the scoop", () => {
    const full = harvestKnots(0, 0, [{ x: 0, y: 0, radius: 34, remaining: 0.4 }], 0.2, 1, 0.024, dt);
    expect(full.gained).toBeCloseTo(0.024 * dt, 12);
    expect(full.tank).toBeCloseTo(0.2 + 0.024 * dt, 12);
    expect(full.remaining[0]).toBeCloseTo(0.4 - 0.024 * dt, 12);
    expect(full.rate).toBeCloseTo(0.024, 12);

    const outside = harvestKnots(100, 0, [{ x: 0, y: 0, radius: 34, remaining: 0.4 }], 0.2, 1, 0.024, dt);
    expect(outside.gained).toBe(0);
    expect(outside.remaining[0]).toBe(0.4);

    const capped = harvestKnots(0, 0, [{ x: 0, y: 0, radius: 34, remaining: 0.4 }], 1, 1, 0.024, dt);
    expect(capped.gained).toBe(0);
    expect(capped.remaining[0]).toBe(0.4);
  });

  it("drains through the sim step and matches the prediction, including a burn paid from the tank", () => {
    const star = bareStar({ x: -220, y: 0, radius: 40 });
    const planet: Body = {
      id: "world",
      name: "world",
      kind: "target",
      x: 220,
      y: 0,
      mass: 0,
      radius: 30,
      captureRadius: 40,
    };
    const curve = petrovaCurve(star.x, star.y, star.radius, planet.x, planet.y, planet.radius, 0);
    const at = curvePoint(curve, 0.5);
    const config: SimConfig = {
      g: 1,
      dt,
      bodies: [star, planet],
      bounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
      maxSteps: 180,
      targetId: "world",
      periapsisMargin: 4,
      c: 1_000_000,
      fuelStart: 40,
      fuelMax: 40,
      fuelPerDv: 1,
      engine: "spin",
      scoop: true,
      astroCapacity: 1,
      astroStart: 0.5,
      astroRate: 0.024,
      astroDv: 12,
      petrova: [{ from: "star", to: "world", bulge: 0, knots: [{ t: 0.5, fuel: 0.4, radius: 34 }] }],
      knotFuel: [0.4],
    };
    const start = makeState(at.x, at.y, 0, 0, config);
    const before = start.astro;
    step(start, config);
    expect(start.astro).toBeCloseTo(before + 0.024 * dt, 12);
    expect(start.knots[0]).toBeCloseTo(0.4 - 0.024 * dt, 12);
    expect(start.astroGained).toBeCloseTo(0.024 * dt, 12);

    const origin = makeState(at.x, at.y, 0, 0, config);
    const nodes: BurnNode[] = [{ step: 30, dvx: 1.2, dvy: 0 }];
    const predicted = predictPlan(origin, config, nodes);
    const flown = cloneState(origin);
    const cursor = { index: 0 };
    while (flown.status === "flying") advancePlan(flown, config, nodes, cursor);
    expect(predicted.final.astro).toBe(flown.astro);
    expect(predicted.final.astroGained).toBe(flown.astroGained);
    expect(predicted.final.astroSpent).toBe(flown.astroSpent);
    expect(predicted.final.knots).toEqual(flown.knots);
    expect(predicted.final.x).toBe(flown.x);
    expect(predicted.final.y).toBe(flown.y);
    expect(predicted.final.vx).toBe(flown.vx);
    expect(predicted.final.vy).toBe(flown.vy);
    expect(predicted.final.tank).toBe(flown.tank);
    expect(flown.astroSpent).toBeCloseTo(1.2 / 12, 12);
    expect(flown.tank).toBe(40);
    expect(flown.astroGained).toBeGreaterThan(0.024 * dt);
  });
});

describe("Astrophage map field", () => {
  it("classifies density the way the overlay header does", () => {
    expect(astroTick(0.11, false)).toBeNull();
    expect(astroTick(0.12, false)?.color).toBe("#FF7A9C");
    expect(astroTick(0.3, false)?.length).toBe(6);
    expect(astroTick(0.6, false)?.length).toBe(7.5);
    expect(astroTick(1, false)?.color).toBe("#FFC2D2");
    expect(astroTick(1, true)?.color).toBe("#C8FFD9");
    expect(astroTick(0.4, true)?.color).toBe("#6EF0A0");

    const curve = petrovaCurve(0, 0, 40, 400, 0, 20, 0);
    const mid = curvePoint(curve, 0.5);
    const sample = astroField(
      mid.x,
      mid.y,
      [{ curve, starX: 0, starY: 0, planetX: 400, planetY: 0, planetR: 20 }],
      [],
      [],
    );
    const w = 6 + 26 * Math.pow(0.5, 1.4);
    expect(w).toBeGreaterThan(6);
    expect(sample.a).toBeGreaterThan(0.5);
  });
});

describe("Tau Ceti and Dim star", () => {
  it("loads a clean yellower star, three Kepler planets inside the disk, and an eaten line", () => {
    expect(tauCeti.bodies.find((body) => body.id === "cetus")).toMatchObject({
      look: "tau-ceti",
      radius: 40,
    });
    expect(tauCeti.bodies.find((body) => body.id === "cetus")?.astrophage).toBeUndefined();
    const star = tauCeti.bodies.find((body) => body.id === "cetus");
    expect(star).toBeTruthy();
    for (const id of ["cinder", "frost", "haven"]) {
      const body = tauCeti.bodies.find((item) => item.id === id);
      expect(body?.orbit?.radius).toBeLessThan(235);
      expect(body?.orbit?.omega).toBeCloseTo(keplerMeanMotion(tauCeti.g, star!.mass, body!.orbit!.radius), 8);
    }
    expect(tauCeti.bodies.find((body) => body.id === "haven")?.radius).toBe(18);
    expect(tauCeti.petrova?.[0]?.eaten).toBe(0.6);
    expect(tauCeti.fit).toEqual({ engine: "spin", scoop: true });
    const config = simConfigFromLevel(tauCeti);
    expect(config.engine).toBe("spin");
    expect(config.scoop).toBe(true);
    expect(config.knotFuel).toEqual([0.4]);
  });

  it("loads the infected star and rejects an infection level outside 1–10", () => {
    const star = dim.bodies.find((body) => body.id === "star");
    expect(star?.astrophage).toEqual({ level: 6, dims: 0.03 });
    expect(dim.petrova?.[0]?.knots[0]).toMatchObject({ fuel: 0.4, radius: 34 });
    const broken = {
      ...structuredClone(dim),
      bodies: dim.bodies.map((body) =>
        body.id === "star" ? { ...body, astrophage: { level: 11, dims: 0.03 } } : body,
      ),
    };
    expect(() => loadLevelData(broken, "bad")).toThrow(LevelError);
  });
});

describe("dim star path ghost", () => {
  it("harvests the knot when the coast starts inside it", () => {
    const config = simConfigFromLevel(dim);
    const star = dim.bodies.find((body) => body.id === "star")!;
    const planet = dim.bodies.find((body) => body.id === "world")!;
    const curve = petrovaCurve(star.x, star.y, star.radius, planet.x, planet.y, planet.radius, 26);
    const at = curvePoint(curve, 0.48);
    const start = makeState(at.x, at.y, 0, 0, config);
    const predicted = predictPlan(start, config, []);
    expect(predicted.final.astroGained).toBeGreaterThan(0.05);
  });
});
