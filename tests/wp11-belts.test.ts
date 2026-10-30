import { describe, expect, it } from "vitest";
import { frost, simConfigFromLevel, weave, type Level } from "../src/level/catalog";
import { frostPlan, weavePlan } from "../src/level/solutions";
import {
  BELT_TIERS,
  beltDrift,
  beltSeparation,
  placeBelts,
  type Belt,
} from "../src/sim/belts";
import {
  advancePlan,
  flyPlan,
  makeState,
  predictPlan,
  step,
  type Body,
  type BurnNode,
  type SimConfig,
} from "../src/sim/physics";

function expectFlightMatches(level: Level, nodes: readonly BurnNode[]): void {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const predicted = predictPlan(state, config, nodes);
  const flown = flyPlan(state, config, nodes, 1);
  expect(flown.status).toBe("won");
  expect(predicted.status).toBe("won");
  expect(predicted.final.hull).toBeGreaterThan(0);
  expect(flown.path.length).toBe(predicted.path.length);
  for (let i = 0; i < flown.path.length; i++) {
    expect(flown.path[i].x).toBe(predicted.path[i].x);
    expect(flown.path[i].y).toBe(predicted.path[i].y);
    expect(flown.path[i].step).toBe(predicted.path[i].step);
  }
  const replay = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const cursor = { index: 0 };
  let guard = 0;
  while (replay.status === "flying" && guard++ < config.maxSteps + 2) advancePlan(replay, config, nodes, cursor);
  expect(replay.x).toBe(predicted.final.x);
  expect(replay.hull).toBe(predicted.final.hull);
  expect(replay.status).toBe("won");
}

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
    const config = simConfigFromLevel(weave);
    const rock = config.beltRocks?.find((item) => item.solid);
    const sun = weave.bodies.find((body) => body.id === "sun");
    if (!rock || !sun) throw new Error("weave belt");
    const hit = makeState(
      sun.x + Math.cos(rock.angle) * rock.distance,
      sun.y + Math.sin(rock.angle) * rock.distance,
      0,
      0,
      config,
    );
    step(hit, config);
    expect(hit.status).toBe("crashed");
    expect(hit.crashedBodyId?.startsWith("belt:")).toBe(true);

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

  it("matches prediction to flight on Weave and Frost", () => {
    expectFlightMatches(weave, weavePlan);
    expectFlightMatches(frost, frostPlan);
  });

  it("places each belt list once", () => {
    const belts = frost.belts;
    if (!belts) throw new Error("frost");
    const first = placeBelts(belts);
    const started = performance.now();
    const second = placeBelts(belts);
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(100);
    expect(performance.now() - started).toBeLessThan(1);
  });
});
