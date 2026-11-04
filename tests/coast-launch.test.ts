import { describe, expect, it } from "vitest";
import { canLaunch, createGame, launch, tick } from "../src/game/state";
import type { PathSample } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";

describe("coast launch", () => {
  it("enables Launch with no boosts and flies the coast sample for sample", () => {
    const game = createGame(moonMission);
    expect(game.mode).toBe("planning");
    expect(game.nodes).toHaveLength(0);
    expect(canLaunch(game)).toBe(true);

    const coast = game.prediction.path;
    expect(coast.length).toBeGreaterThan(1);
    launch(game);
    expect(game.mode).toBe("flying");

    const flown: PathSample[] = [];
    let guard = 0;
    while (flown.length < coast.length && game.mode === "flying" && guard++ < moonMission.maxSteps) {
      tick(game);
      for (let i = 0; i < game.frameSamples.length; i++) flown.push(game.frameSamples[i]);
    }

    expect(flown.length).toBeGreaterThanOrEqual(coast.length);
    for (let i = 0; i < coast.length; i++) {
      const got = flown[i];
      const want = coast[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
        throw new Error(
          `coast diverged at sample ${i} (step ${want.step}): (${got.x}, ${got.y}) vs (${want.x}, ${want.y})`,
        );
      }
    }
  });
});
