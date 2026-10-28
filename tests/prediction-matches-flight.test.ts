import { describe, expect, it } from "vitest";
import { directLaunch, passage, simConfigFromLevel, slingshotLaunch } from "../src/level/passage";
import {
  SIM_SPEEDS,
  flyUntilDone,
  makeState,
  predict,
  stepsPerFrame,
  tryApplyImpulse,
} from "../src/sim/physics";

function launch(dvx: number, dvy: number) {
  const config = simConfigFromLevel(passage);
  const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
  const impulse = tryApplyImpulse(state, dvx, dvy, passage.fuel, passage.fuelPerDv);
  expect(impulse.ok).toBe(true);
  return { config, state };
}

const launches = [slingshotLaunch, directLaunch];

describe("prediction uses the flight integrator", () => {
  it.each(launches)("matches $name step-for-step at every sim speed", (solution) => {
    const { config, state } = launch(solution.dvx, solution.dvy);
    const predicted = predict(state, config);
    expect(predicted.path.length).toBeGreaterThan(50);

    for (const speed of SIM_SPEEDS) {
      const flown = flyUntilDone(state, config, stepsPerFrame(speed));
      expect(flown.status).toBe(predicted.status);
      expect(flown.steps).toBe(predicted.steps);
      expect(flown.crashedBodyId).toBe(predicted.crashedBodyId);
      expect(flown.lostReason).toBe(predicted.lostReason);
      expect(flown.path).toHaveLength(predicted.path.length);
      for (let i = 0; i < predicted.path.length; i++) {
        const a = flown.path[i];
        const b = predicted.path[i];
        if (a.x !== b.x || a.y !== b.y) {
          throw new Error(`speed ${speed}x diverged at step ${i}: (${a.x}, ${a.y}) vs (${b.x}, ${b.y})`);
        }
      }
    }
  });
});
