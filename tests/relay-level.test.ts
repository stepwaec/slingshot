import { describe, expect, it } from "vitest";
import {
  addNode,
  createGame,
  launch,
  pause,
  queuedBurns,
  resume,
  setNodeBurn,
  setPlan,
  stepInHorizon,
  tick,
} from "../src/game/state";
import { burnLimit, simConfigFromLevel } from "../src/level/passage";
import { relay, relayCapture, relayCorrection, relayFull, relayOpening, relayPauseAt } from "../src/level/relay";
import {
  assessPlan,
  flyPlan,
  horizonSteps,
  isCapturedOrbit,
  makeState,
  type PathSample,
} from "../src/sim/physics";

describe("Relay", () => {
  it("cannot be won from burns planned before launch, and can be won by adding the capture in flight", () => {
    const config = simConfigFromLevel(relay);
    const state = makeState(relay.ship.x, relay.ship.y, relay.ship.vx, relay.ship.vy, config);
    const openHorizon = horizonSteps(state, config);
    expect(relayCorrection.step).toBeLessThanOrEqual(openHorizon);
    expect(relayCapture.step).toBeGreaterThan(openHorizon);
    expect(burnLimit(relay)).toBe(2);
    expect(relayOpening).toHaveLength(2);
    expect(assessPlan(relayFull, relay.fuel, relay.fuelPerDv).affordable).toBe(true);

    const opening = flyPlan(state, config, relayOpening, 1);
    const full = flyPlan(state, { ...config, horizon: undefined }, relayFull, 1);
    expect(opening.status).not.toBe("won");
    expect(full.status).toBe("won");
    expect(full.orbit).not.toBeNull();

    const game = createGame(relay);
    setPlan(game, relayOpening);
    addNode(game, relayCapture.step);
    expect(game.nodes.map((node) => node.step)).not.toContain(relayCapture.step);

    addNode(game, Math.min(120, openHorizon));
    expect(queuedBurns(game)).toBe(2);
    expect(game.nodes).toHaveLength(2);

    const played: PathSample[] = [];
    launch(game);
    let guard = 0;
    while (game.mode === "flying" && game.ship.step < relayPauseAt && guard++ < relay.maxSteps) {
      tick(game);
      for (let i = 0; i < game.frameSamples.length; i++) played.push(game.frameSamples[i]);
    }
    expect(game.mode).toBe("flying");
    expect(game.ship.step).toBe(relayPauseAt);
    expect(game.ship.step).toBeLessThan(relayCapture.step);
    expect(queuedBurns(game)).toBe(0);

    expect(pause(game)).toBe(true);
    expect(stepInHorizon(game, relayCapture.step)).toBe(true);
    addNode(game, relayCapture.step);
    const added = game.nodes.findIndex((node) => node.step === relayCapture.step);
    expect(added).toBeGreaterThanOrEqual(0);
    setNodeBurn(game, added, relayCapture.dvx, relayCapture.dvy);
    expect(game.nodes).toEqual(relayFull.map((node) => ({ ...node })));

    resume(game);
    guard = 0;
    while (game.mode === "flying" && guard++ < relay.maxSteps) {
      tick(game);
      for (let i = 0; i < game.frameSamples.length; i++) played.push(game.frameSamples[i]);
    }
    expect(game.mode).toBe("finished");
    expect(game.ship.status).toBe("won");
    expect(isCapturedOrbit(game.ship, config)).toBe(true);
    expect(full.path).toHaveLength(played.length);
    for (let i = 0; i < full.path.length; i++) {
      expect(played[i].x).toBe(full.path[i].x);
      expect(played[i].y).toBe(full.path[i].y);
      expect(played[i].step).toBe(full.path[i].step);
    }
  });
});
