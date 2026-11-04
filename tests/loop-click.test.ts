import { describe, expect, it } from "vitest";
import { createGame, nodePosition, setPlan } from "../src/game/state";
import { planningPointerHit } from "../src/game/input";
import { worldToScreen } from "../src/render/camera";
import { showPath, shownPoint } from "../src/render/path-frame";
import { moonMission } from "../src/world/moon-mission";

const WIDTH = 1280;
const HEIGHT = 720;

describe("stacked loop clicks", () => {
  it("picks the earliest pass, then the earliest pass after the last burn", () => {
    const game = createGame(moonMission);
    const frame = moonMission.frame ?? moonMission.bounds;
    game.camera.x = (frame.minX + frame.maxX) / 2;
    game.camera.y = (frame.minY + frame.maxY) / 2;
    game.camera.zoom = Math.min(WIDTH / (frame.maxX - frame.minX), HEIGHT / (frame.maxY - frame.minY)) * 0.9;

    const pair = stackedPair(game);
    expect(pair).not.toBeNull();
    if (!pair) return;
    const first = planningPointerHit(game, WIDTH, HEIGHT, pair.click.x, pair.click.y);
    expect(first.type).toBe("path");
    if (first.type !== "path") return;
    expect(first.step).toBeLessThanOrEqual(pair.early);
    expect(first.step).toBeLessThan(pair.late);

    const quarter = Math.round(3.8 / game.level.dt);
    const between = pair.early + quarter;
    setPlan(game, [{ step: between, dvx: 0, dvy: 0 }]);
    const placed = nodePosition(game, 0);
    if (!placed) throw new Error("burn has no position");
    const shown = shownPoint(game, placed.x, placed.y, between);
    const node = worldToScreen(game.camera, WIDTH, HEIGHT, shown.x, shown.y);
    expect(Math.hypot(node.x - pair.click.x, node.y - pair.click.y)).toBeGreaterThan(24);
    const next = planningPointerHit(game, WIDTH, HEIGHT, pair.click.x, pair.click.y);
    expect(next.type).toBe("path");
    if (next.type !== "path") return;
    expect(next.step).toBeGreaterThan(between);
    expect(next.step).toBeLessThanOrEqual(pair.late);
  });
});

/** Two body-frame samples on top of each other, a coast apart. */
function stackedPair(game: ReturnType<typeof createGame>): { click: { x: number; y: number }; early: number; late: number } | null {
  const path = game.prediction.path;
  const drawn = showPath(path, game.level.bodies, game.level.g, game.level.dt, 0);
  const gap = Math.round(30 / game.level.dt);
  for (let i = 0; i < path.length; i += 20) {
    const a = worldToScreen(game.camera, WIDTH, HEIGHT, drawn[i].x, drawn[i].y);
    for (let j = i + gap; j < path.length; j += 12) {
      const b = worldToScreen(game.camera, WIDTH, HEIGHT, drawn[j].x, drawn[j].y);
      if ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) > 3 * 3) continue;
      return { click: a, early: path[i].step, late: path[j].step };
    }
  }
  return null;
}
