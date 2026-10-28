import { describe, expect, it } from "vitest";
import {
  directLaunch,
  directPlan,
  passage,
  simConfigFromLevel,
  slingshotCapture,
  slingshotLaunch,
  slingshotPlan,
} from "../src/level/passage";
import { canLaunch, clearPlan, createGame, launch, planFuel, reset, setPlan, tick } from "../src/game/state";
import {
  assessPlan,
  closestApproach,
  flyPlan,
  fuelCost,
  makeState,
  tryApplyImpulse,
} from "../src/sim/physics";

function initial() {
  const config = simConfigFromLevel(passage);
  return { config, state: makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config) };
}

describe("Passage plans", () => {
  it("wins with a slingshot inside the budget and prices the direct plan over it", () => {
    const { config, state } = initial();
    const sling = flyPlan(state, config, slingshotPlan, 1);
    const direct = flyPlan(state, config, directPlan, 1);
    const slingFuel = assessPlan(slingshotPlan, passage.fuel, passage.fuelPerDv);
    const directFuel = assessPlan(directPlan, passage.fuel, passage.fuelPerDv);
    const star = passage.bodies.find((body) => body.kind === "star");
    if (!star) throw new Error("missing star");

    expect(sling.status).toBe("won");
    expect(direct.status).toBe("won");
    expect(sling.orbit).not.toBeNull();
    expect(direct.orbit).not.toBeNull();
    expect(sling.path.some((sample) => sample.step > 0 && sample.step <= slingshotCapture.step)).toBe(true);

    expect(slingFuel.affordable).toBe(true);
    expect(slingFuel.total).toBeLessThanOrEqual(passage.fuel);
    expect(slingFuel.total).toBeCloseTo(38.91, 2);
    expect(slingFuel.costs[0].exceeds).toBe(false);
    expect(slingFuel.costs[1].exceeds).toBe(false);

    expect(directFuel.affordable).toBe(false);
    expect(directFuel.total).toBeGreaterThan(passage.fuel);
    expect(directFuel.total).toBeCloseTo(95.18, 2);
    expect(directFuel.costs[0].exceeds).toBe(true);
    expect(slingFuel.total).toBeLessThan(directFuel.total * 0.5);

    expect(closestApproach(sling.path, star.x, star.y)).toBeGreaterThan(star.radius);
    expect(closestApproach(sling.path, star.x, star.y)).toBeLessThan(star.radius * 2.5);
    expect(closestApproach(direct.path, star.x, star.y)).toBeGreaterThan(400);
  });

  it("does not win a launch with no capture node", () => {
    const { config, state } = initial();
    const flyby = flyPlan(state, config, [{ step: 0, dvx: slingshotLaunch.dvx, dvy: slingshotLaunch.dvy }], 1);
    expect(flyby.status).toBe("lost");
    expect(flyby.lostReason).toBe("flyby");
  });

  it("refuses to launch a plan that exceeds the remaining fuel", () => {
    const game = createGame();
    setPlan(game, directPlan);
    expect(planFuel(game).affordable).toBe(false);
    expect(canLaunch(game)).toBe(false);
    launch(game);
    expect(game.mode).toBe("planning");

    setPlan(game, [
      { step: 0, dvx: 30, dvy: 0 },
      { step: 80, dvx: 0, dvy: 40 },
    ]);
    const fuel = planFuel(game);
    expect(fuel.costs[0].exceeds).toBe(false);
    expect(fuel.costs[0].cost).toBeCloseTo(30, 6);
    expect(fuel.costs[1].exceeds).toBe(true);
    expect(fuel.left).toBeCloseTo(-10, 6);
    expect(canLaunch(game)).toBe(false);
    const vx = game.ship.vx;
    launch(game);
    expect(game.mode).toBe("planning");
    expect(game.ship.vx).toBe(vx);

    const { state } = initial();
    const tooBig = tryApplyImpulse(state, passage.fuel + 5, 0, passage.fuel, passage.fuelPerDv);
    expect(tooBig.ok).toBe(false);
    const direct = tryApplyImpulse(state, directLaunch.dvx, directLaunch.dvy, passage.fuel, passage.fuelPerDv);
    expect(direct.ok).toBe(false);
    expect(fuelCost(directLaunch.dvx, directLaunch.dvy, passage.fuelPerDv)).toBeGreaterThan(passage.fuel);
  });

  it("flies the slingshot, then reset keeps the nodes and clear removes them", () => {
    const game = createGame();
    setPlan(game, slingshotPlan);
    expect(canLaunch(game)).toBe(true);
    launch(game);
    let guard = 0;
    while (game.mode === "flying" && guard++ < passage.maxSteps) tick(game);
    expect(game.mode).toBe("finished");
    expect(game.ship.status).toBe("won");
    expect(passage.fuel - game.fuel).toBeCloseTo(38.91, 2);

    reset(game);
    expect(game.mode).toBe("planning");
    expect(game.nodes).toHaveLength(2);
    expect(game.nodes[0].step).toBe(0);
    expect(game.nodes[1].step).toBe(slingshotCapture.step);
    expect(game.fuel).toBe(passage.fuel);

    clearPlan(game);
    expect(game.mode).toBe("planning");
    expect(game.nodes).toHaveLength(0);
    expect(canLaunch(game)).toBe(false);
  });
});
