import { describe, expect, it } from "vitest";
import { chain, ember, pair, simConfigFromLevel, type Level } from "../src/level/catalog";
import { chainPlan, emberPlan, pairPlan } from "../src/level/solutions";
import {
  flyPlan,
  makeState,
  predictPlan,
  type BurnNode,
  type PathSample,
  type SimConfig,
} from "../src/sim/physics";

function expectFlightMatchesPrediction(level: Level, nodes: readonly BurnNode[]): PathSample[] {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const predicted = predictPlan(state, config, nodes);
  const flown = flyPlan(state, config, nodes, 1);
  expect(flown.status).toBe(predicted.status);
  expect(flown.steps).toBe(predicted.steps);
  expect(flown.outsideTime).toBe(predicted.outsideTime);
  expect(flown.shipTime).toBe(predicted.shipTime);
  expect(flown.path.length).toBe(predicted.path.length);
  for (let i = 0; i < flown.path.length; i++) {
    const got = flown.path[i];
    const want = predicted.path[i];
    if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
      throw new Error(
        `${level.id} diverged at sample ${i} (step ${want.step}): (${got.x}, ${got.y}) vs (${want.x}, ${want.y})`,
      );
    }
  }
  return flown.path;
}

describe("WP8 levels", () => {
  it("Pair's reference solution wins, and the prediction matches the flight", () => {
    const config = simConfigFromLevel(pair);
    const state = makeState(pair.ship.x, pair.ship.y, pair.ship.vx, pair.ship.vy, config);
    expect(flyPlan(state, config, pairPlan, 1).status).toBe("won");
    expectFlightMatchesPrediction(pair, pairPlan);
    expect(pair.bodies.filter((body) => body.kind === "star")).toHaveLength(2);
  });

  it("Ember's reference solution wins through the drag atmosphere", () => {
    const giant = ember.bodies.find((body) => body.look === "red-giant");
    expect(giant?.atmosphereRadius).toBeGreaterThan(giant?.radius ?? 0);
    expect(ember.physics?.dragStrength).toBeGreaterThan(0);
    const config = simConfigFromLevel(ember);
    const state = makeState(ember.ship.x, ember.ship.y, ember.ship.vx, ember.ship.vy, config);
    const flown = flyPlan(state, config, emberPlan, 1);
    expect(flown.status).toBe("won");
    let skimmed = false;
    for (const sample of flown.path) {
      const distance = Math.hypot(sample.x - (giant?.x ?? 0), sample.y - (giant?.y ?? 0));
      if (distance > (giant?.radius ?? 0) && distance < (giant?.atmosphereRadius ?? 0)) skimmed = true;
    }
    expect(skimmed).toBe(true);
    expectFlightMatchesPrediction(ember, emberPlan);
  });

  it("Chain's reference solution wins", () => {
    const moons = chain.bodies.filter((body) => body.kind === "moon");
    expect(moons.length).toBeGreaterThanOrEqual(3);
    expect(moons.length).toBeLessThanOrEqual(5);
    expect(chain.bodies.some((body) => body.look === "gas-giant")).toBe(true);
    const config = simConfigFromLevel(chain);
    const state = makeState(chain.ship.x, chain.ship.y, chain.ship.vx, chain.ship.vy, config);
    expect(flyPlan(state, config, chainPlan, 1).status).toBe("won");
    expectFlightMatchesPrediction(chain, chainPlan);
  });

  it("drag slows the ship and the prediction matches that flight", () => {
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      c: 1_000_000,
      dragStrength: 0.8,
      bodies: [
        {
          id: "giant",
          name: "giant",
          kind: "star",
          look: "red-giant",
          x: 0,
          y: 0,
          mass: 0,
          radius: 30,
          atmosphereRadius: 80,
        },
      ],
      bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
      maxSteps: 240,
      targetId: "giant",
      periapsisMargin: 1,
    };
    const start = makeState(-120, 0, 40, 0, config);
    const dragged = flyPlan(start, config, [], 1);
    const free = flyPlan(start, { ...config, dragStrength: 0 }, [], 1);
    expect(dragged.path[100].x).toBeLessThan(free.path[100].x);
    const predicted = predictPlan(start, config, []);
    expect(predicted.path.length).toBe(dragged.path.length);
    for (let i = 0; i < dragged.path.length; i++) {
      expect(predicted.path[i].x).toBe(dragged.path[i].x);
      expect(predicted.path[i].y).toBe(dragged.path[i].y);
      expect(predicted.path[i].rate).toBe(dragged.path[i].rate);
    }
    expect(predicted.shipTime).toBe(dragged.shipTime);
    const outside = makeState(-120, 200, 40, 0, config);
    const missed = flyPlan(outside, config, [], 1);
    const missedFree = flyPlan(outside, { ...config, dragStrength: 0 }, [], 1);
    expect(missed.path[missed.path.length - 1].x).toBe(missedFree.path[missedFree.path.length - 1].x);
  });
});