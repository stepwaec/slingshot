import { describe, expect, it } from "vitest";
import { directLaunch, passage, simConfigFromLevel, slingshotLaunch } from "../src/level/passage";
import {
  closestApproach,
  fuelCost,
  makeState,
  predict,
  tryApplyImpulse,
} from "../src/sim/physics";

function fly(dvx: number, dvy: number) {
  const config = simConfigFromLevel(passage);
  const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
  const impulse = tryApplyImpulse(state, dvx, dvy, passage.fuel, passage.fuelPerDv);
  if (!impulse.ok) throw new Error(`burn rejected, cost ${impulse.cost}`);
  const predicted = predict(state, config);
  const star = passage.bodies.find((body) => body.kind === "star");
  if (!star) throw new Error("missing star");
  return {
    cost: impulse.cost,
    status: predicted.status,
    minStar: closestApproach(predicted.path, star.x, star.y),
    star,
  };
}

describe("Passage fuel", () => {
  it("wins with a slingshot that costs less than half the direct route", () => {
    const sling = fly(slingshotLaunch.dvx, slingshotLaunch.dvy);
    const direct = fly(directLaunch.dvx, directLaunch.dvy);

    expect(sling.status).toBe("won");
    expect(direct.status).toBe("won");
    expect(sling.cost).toBe(fuelCost(slingshotLaunch.dvx, slingshotLaunch.dvy, passage.fuelPerDv));
    expect(direct.cost).toBe(fuelCost(directLaunch.dvx, directLaunch.dvy, passage.fuelPerDv));
    expect(sling.cost).toBeLessThanOrEqual(passage.fuel);
    expect(direct.cost).toBeLessThanOrEqual(passage.fuel);
    expect(sling.cost).toBeLessThan(direct.cost * 0.5);

    expect(sling.minStar).toBeGreaterThan(sling.star.radius);
    expect(sling.minStar).toBeLessThan(sling.star.radius * 2.5);
    expect(direct.minStar).toBeGreaterThan(400);
  });

  it("refuses a burn larger than the remaining fuel", () => {
    const config = simConfigFromLevel(passage);
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
    const vx = state.vx;
    const vy = state.vy;
    const result = tryApplyImpulse(state, passage.fuel + 5, 0, passage.fuel, passage.fuelPerDv);
    expect(result.ok).toBe(false);
    expect(state.vx).toBe(vx);
    expect(state.vy).toBe(vy);
  });

  it("predicts a full flight quickly enough to follow a drag", () => {
    const config = simConfigFromLevel(passage);
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
    const impulse = tryApplyImpulse(state, slingshotLaunch.dvx, slingshotLaunch.dvy, passage.fuel, passage.fuelPerDv);
    expect(impulse.ok).toBe(true);
    const runs = 12;
    const started = performance.now();
    for (let i = 0; i < runs; i++) predict(state, config);
    const averageMs = (performance.now() - started) / runs;
    expect(averageMs).toBeLessThan(16);
  });
});
