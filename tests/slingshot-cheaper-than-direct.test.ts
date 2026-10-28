import { describe, expect, it } from "vitest";
import {
  directCapture,
  directLaunch,
  passage,
  simConfigFromLevel,
  slingshotCapture,
  slingshotLaunch,
  type LaunchSolution,
} from "../src/level/passage";
import {
  closestApproach,
  flyMission,
  fuelCost,
  makeState,
  predict,
  tryApplyImpulse,
  type Vec2,
} from "../src/sim/physics";

const FUEL_POOL = 200;

function route(launch: LaunchSolution, capture: LaunchSolution) {
  const config = simConfigFromLevel(passage);
  const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
  const launchImpulse = tryApplyImpulse(state, launch.dvx, launch.dvy, FUEL_POOL, passage.fuelPerDv);
  if (!launchImpulse.ok) throw new Error(`launch rejected, cost ${launchImpulse.cost}`);
  const captureDv: Vec2 = { x: capture.dvx, y: capture.dvy };
  const predicted = flyMission(state, config, 1, captureDv, launchImpulse.fuel, passage.fuelPerDv);
  const star = passage.bodies.find((body) => body.kind === "star");
  if (!star) throw new Error("missing star");
  const launchFuel = launchImpulse.cost;
  const captureFuel = fuelCost(capture.dvx, capture.dvy, passage.fuelPerDv);
  return {
    status: predicted.status,
    lostReason: predicted.lostReason,
    minStar: closestApproach(predicted.path, star.x, star.y),
    star,
    launchFuel,
    captureFuel,
    totalFuel: launchFuel + captureFuel,
    orbit: predicted.orbit,
  };
}

describe("Passage fuel", () => {
  it("captures with a slingshot that costs less than half the direct route", () => {
    const sling = route(slingshotLaunch, slingshotCapture);
    const direct = route(directLaunch, directCapture);

    expect(sling.status).toBe("won");
    expect(direct.status).toBe("won");
    expect(sling.orbit).not.toBeNull();
    expect(direct.orbit).not.toBeNull();

    // Budget 60. Slingshot launch 22 + capture 17.48 = 39.48. Direct 76 + 19.63 = 95.63.
    expect(sling.totalFuel).toBeLessThanOrEqual(passage.fuel);
    expect(direct.totalFuel).toBeGreaterThan(passage.fuel);
    expect(sling.totalFuel).toBeLessThan(direct.totalFuel * 0.5);
    expect(sling.totalFuel).toBeCloseTo(39.48, 1);
    expect(direct.totalFuel).toBeCloseTo(95.63, 1);

    expect(sling.minStar).toBeGreaterThan(sling.star.radius);
    expect(sling.minStar).toBeLessThan(sling.star.radius * 2.5);
    expect(direct.minStar).toBeGreaterThan(400);
  });

  it("does not win a fast flyby that skips the capture burn", () => {
    const config = simConfigFromLevel(passage);
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
    const launchImpulse = tryApplyImpulse(state, slingshotLaunch.dvx, slingshotLaunch.dvy, FUEL_POOL, passage.fuelPerDv);
    if (!launchImpulse.ok) throw new Error("launch");
    const flyby = flyMission(state, config, 1, { x: 0, y: 0 }, launchImpulse.fuel, passage.fuelPerDv);
    expect(flyby.status).not.toBe("won");
    expect(flyby.status).toBe("lost");
    expect(flyby.lostReason).toBe("flyby");
  });

  it("rejects a launch larger than the budget, including the direct route", () => {
    const config = simConfigFromLevel(passage);
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
    const vx = state.vx;
    const vy = state.vy;
    const tooBig = tryApplyImpulse(state, passage.fuel + 5, 0, passage.fuel, passage.fuelPerDv);
    expect(tooBig.ok).toBe(false);
    expect(state.vx).toBe(vx);
    expect(state.vy).toBe(vy);

    const direct = tryApplyImpulse(state, directLaunch.dvx, directLaunch.dvy, passage.fuel, passage.fuelPerDv);
    expect(direct.ok).toBe(false);
    expect(fuelCost(directLaunch.dvx, directLaunch.dvy, passage.fuelPerDv)).toBeGreaterThan(passage.fuel);
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
