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
import { SIM_SPEEDS, flyMission, makeState, stepsPerFrame, tryApplyImpulse, type Vec2 } from "../src/sim/physics";

const FUEL_POOL = 200;

const routes: Array<{ launch: LaunchSolution; capture: LaunchSolution }> = [
  { launch: slingshotLaunch, capture: slingshotCapture },
  { launch: directLaunch, capture: directCapture },
];

function afterLaunch(launch: LaunchSolution) {
  const config = simConfigFromLevel(passage);
  const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
  const impulse = tryApplyImpulse(state, launch.dvx, launch.dvy, FUEL_POOL, passage.fuelPerDv);
  expect(impulse.ok).toBe(true);
  if (!impulse.ok) throw new Error("launch");
  return { config, state, fuelLeft: impulse.fuel, capture: { x: 0, y: 0 } as Vec2 };
}

describe("prediction uses the flight integrator", () => {
  it.each(routes)("matches $launch.name with its capture burn at every sim speed", ({ launch, capture }) => {
    const { config, state, fuelLeft } = afterLaunch(launch);
    const captureDv = { x: capture.dvx, y: capture.dvy };
    const predicted = flyMission(state, config, 1, captureDv, fuelLeft, passage.fuelPerDv);
    expect(predicted.status).toBe("won");
    expect(predicted.path.length).toBeGreaterThan(50);
    expect(predicted.orbit?.length).toBeGreaterThan(10);

    for (const speed of SIM_SPEEDS) {
      const flown = flyMission(state, config, stepsPerFrame(speed), captureDv, fuelLeft, passage.fuelPerDv);
      expect(flown.status).toBe(predicted.status);
      expect(flown.steps).toBe(predicted.steps);
      expect(flown.crashedBodyId).toBe(predicted.crashedBodyId);
      expect(flown.lostReason).toBe(predicted.lostReason);
      expect(flown.path).toHaveLength(predicted.path.length);
      expect(flown.orbit).toEqual(predicted.orbit);
      for (let i = 0; i < predicted.path.length; i++) {
        const actual = flown.path[i];
        const expected = predicted.path[i];
        if (actual.x !== expected.x || actual.y !== expected.y) {
          throw new Error(
            `speed ${speed}x diverged at step ${i}: (${actual.x}, ${actual.y}) vs (${expected.x}, ${expected.y})`,
          );
        }
      }
    }
  });
});
