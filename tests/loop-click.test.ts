import { describe, expect, it } from "vitest";
import { createGame, type Game } from "../src/game/state";
import { planningPointerHit } from "../src/game/input";
import { worldToScreen } from "../src/render/camera";
import { moonMission } from "../src/world/moon-mission";

const WIDTH = 1280;
const HEIGHT = 720;

describe("stacked loop clicks", () => {
  it("picks the earliest pass, then the earliest pass after the last burn", () => {
    const game = createGame(moonMission);
    game.camera.x = 0;
    game.camera.y = 0;
    game.camera.zoom = 1;
    const early = 120;
    const late = 2400;
    plant(game, early, late);
    const click = worldToScreen(game.camera, WIDTH, HEIGHT, 40, -20);
    const first = planningPointerHit(game, WIDTH, HEIGHT, click.x, click.y);
    expect(first.type).toBe("path");
    if (first.type !== "path") return;
    expect(first.step).toBe(early);

    const between = 800;
    game.nodes = [{ step: between, dvx: 0, dvy: 0 }];
    plant(game, early, late);
    const next = planningPointerHit(game, WIDTH, HEIGHT, click.x, click.y);
    expect(next.type).toBe("path");
    if (next.type !== "path") return;
    expect(next.step).toBe(late);
    expect(next.step).toBeGreaterThan(between);
  });
});

/** Two world samples on the same pixel, a coast apart. A real Earth cycloid does not stack. */
function plant(game: Game, early: number, late: number): void {
  game.prediction = {
    ...game.prediction,
    path: [
      { x: 40, y: -20, step: early, rate: 1 },
      { x: 40, y: -20, step: late, rate: 1 },
    ],
    final: { ...game.prediction.final, status: "flying" },
  };
}
