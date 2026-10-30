import { describe, expect, it } from "vitest";
import { observatory, simConfigFromLevel } from "../src/level/catalog";
import {
  BELT_TIERS,
  beltDrift,
  beltSeparation,
  placeBelts,
  type Belt,
} from "../src/sim/belts";
import {
  flyPlan,
  makeState,
  predictPlan,
  step,
  type Body,
  type SimConfig,
} from "../src/sim/physics";

describe("WP11 belts", () => {
  it("places a seeded belt with the header counts, gaps and solidity", () => {
    const belt: Belt = { id: "belt", centerId: "sun", radius: 200, width: 40, tier: "sparse", seed: 3 };
    const once = placeBelts([belt]);
    const twice = placeBelts([belt]);
    expect(twice.map((rock) => rock.angle)).toEqual(once.map((rock) => rock.angle));
    const arc = Math.PI * 2 * 200;
    const spec = BELT_TIERS.sparse;
    expect(once.filter((rock) => rock.role === "large")).toHaveLength(Math.round((arc / 100) * spec.large));
    for (const rock of once) {
      if (rock.role === "large") expect(rock.solid).toBe(true);
      if (rock.role !== "large") expect(rock.solid).toBe(false);
      expect(rock.radius).toBeLessThan(spec.solid === 7 && rock.role !== "large" ? spec.solid : 100);
    }
    const kuiper = placeBelts([{ ...belt, id: "k", tier: "kuiper", seed: 9 }]);
    expect(kuiper.some((rock) => rock.solid && rock.radius < 7 && rock.radius >= 5)).toBe(true);
    expect(kuiper.filter((rock) => rock.role === "small").every((rock) => !rock.solid)).toBe(true);
    for (let i = 0; i < once.length; i++) {
      for (let j = i + 1; j < once.length; j++) {
        const a = once[i];
        const b = once[j];
        const dx = Math.cos(a.angle) * a.distance - Math.cos(b.angle) * b.distance;
        const dy = Math.sin(a.angle) * a.distance - Math.sin(b.angle) * b.distance;
        const need = beltSeparation(b.radius, a.radius, spec.gap);
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(need - 1e-6);
      }
    }
  });

  it("breathes the belt on sim time and rests at zero", () => {
    expect(beltDrift("sparse", 0)).toBeCloseTo(0, 12);
    expect(beltDrift("medium", 60)).toBeCloseTo(0, 8);
    expect(beltDrift("sparse", 30)).toBeCloseTo((-0.5 * Math.PI) / 180, 8);
    expect(beltDrift("kuiper", 45)).toBeCloseTo((-0.3 * Math.PI) / 180, 8);
  });

  it("crashes on a solid rock and leaves dust as a hull rate that shielding halves", () => {
    const belts = observatory.belts ?? [];
    const rocks = placeBelts(belts);
    const rock = rocks.find((item) => item.solid && item.distance > 40);
    const sun = observatory.bodies.find((body) => body.id === rock?.centerId);
    if (!rock || !sun) throw new Error("observatory belt");
    const config = {
      ...simConfigFromLevel(observatory),
      bodies: [sun],
      belts,
      beltRocks: rocks,
      nebulae: undefined,
      wormholes: undefined,
      petrova: undefined,
      knotFuel: undefined,
      maxSteps: 5,
    };
    const hit = makeState(
      sun.x + Math.cos(rock.angle) * rock.distance,
      sun.y + Math.sin(rock.angle) * rock.distance,
      0,
      0,
      config,
    );
    step(hit, config);
    expect(hit.status).toBe("crashed");
    expect(hit.crashedBodyId?.startsWith(`${rock.beltId}:`)).toBe(true);

    const star: Body = { id: "sun", name: "sun", kind: "star", x: 0, y: 0, mass: 1, radius: 8 };
    const belt: Belt = {
      id: "pack",
      centerId: "sun",
      radius: 80,
      width: 40,
      tier: "dense",
      seed: 2,
      dustDamage: 30,
    };
    const base: SimConfig = {
      g: 1,
      dt: 1 / 60,
      bodies: [star],
      bounds: { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 },
      maxSteps: 90,
      targetId: "sun",
      periapsisMargin: 1,
      c: 1e6,
      belts: [belt],
      beltRocks: [],
    };
    const open = predictPlan(makeState(80, 0, 0, 0, base), base, []);
    const clad = predictPlan(makeState(80, 0, 0, 0, base), { ...base, shield: 0.5 }, []);
    expect(open.final.hull).toBeCloseTo(55, 6);
    expect(clad.final.hull).toBeCloseTo(100 - (100 - open.final.hull) * 0.5, 6);
    expect(clad.path[40].x).toBe(open.path[40].x);
    const flown = flyPlan(makeState(80, 0, 0, 0, base), base, [], 1);
    expect(flown.path.length).toBe(open.path.length);
    expect(flown.path[20].x).toBe(open.path[20].x);
  });

  it("matches prediction to a flight through an Observatory belt", () => {
    const belts = observatory.belts ?? [];
    const host = observatory.bodies.find((body) => body.id === belts[0]?.centerId);
    if (!host) throw new Error("observatory belt");
    const config: SimConfig = {
      g: observatory.g,
      dt: observatory.dt,
      c: observatory.c,
      bodies: [host],
      belts,
      beltRocks: placeBelts(belts),
      bounds: observatory.bounds,
      maxSteps: 40,
      targetId: host.id,
      periapsisMargin: 1,
      fuelStart: 20,
      fuelMax: 20,
      fuelPerDv: 1,
    };
    const state = makeState(host.x + 400, host.y + 80, 2, 0, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.status).toBe(predicted.status);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.path.length).toBeGreaterThan(10);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
  });

  it("places each belt list once", () => {
    const belts = observatory.belts;
    if (!belts) throw new Error("observatory belts");
    const first = placeBelts(belts);
    const started = performance.now();
    const second = placeBelts(belts);
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(100);
    expect(performance.now() - started).toBeLessThan(1);
  });
});
