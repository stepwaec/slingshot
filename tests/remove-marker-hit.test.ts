import { describe, expect, it } from "vitest";
import { createGame, nodePosition, selectNode, setPlan } from "../src/game/state";
import {
  planningPointerHit,
  REMOVE_RADIUS,
  settlePlanningClick,
} from "../src/game/input";
import { worldToScreen } from "../src/render/camera";
import { theme } from "../src/render/theme";
import { slingshotPlan } from "./support/plans";
import { stage } from "./support/stage";

const WIDTH = 1440;
const HEIGHT = 900;
/** Node disc used by the planner. A path click just outside it must stay a path pick. */
const NODE_RADIUS = 12;

describe("delete marker hit priority", () => {
  it("picks the path beside the node and deletes only on the ×", () => {
    const game = createGame(stage);
    setPlan(game, slingshotPlan);
    selectNode(game, 0);
    const place = nodePosition(game, 0);
    if (!place) throw new Error("launch node has no position");
    const node = worldToScreen(game.camera, WIDTH, HEIGHT, place.x, place.y);
    const marker = { x: node.x + theme.nodes.deleteX, y: node.y + theme.nodes.deleteY };

    const beside = pathClickBesideNode(game, node);
    const pathHit = planningPointerHit(game, WIDTH, HEIGHT, beside.x, beside.y);
    expect(pathHit.type).toBe("path");
    if (pathHit.type !== "path") return;
    expect(Math.hypot(beside.x - node.x, beside.y - node.y)).toBeGreaterThan(NODE_RADIUS);
    expect(Math.hypot(beside.x - marker.x, beside.y - marker.y)).toBeGreaterThan(REMOVE_RADIUS);

    const edge = { x: marker.x + REMOVE_RADIUS + 2, y: marker.y };
    expect(Math.hypot(edge.x - node.x, edge.y - node.y)).toBeGreaterThan(NODE_RADIUS);
    expect(planningPointerHit(game, WIDTH, HEIGHT, edge.x, edge.y).type).not.toBe("remove");

    const onMarker = planningPointerHit(game, WIDTH, HEIGHT, marker.x, marker.y);
    expect(onMarker.type).toBe("remove");
    const before = game.nodes.length;
    const removed = game.nodes[0].step;
    settlePlanningClick(game, onMarker);
    expect(game.nodes).toHaveLength(before - 1);
    expect(game.nodes.map((item) => item.step)).not.toContain(removed);

    const again = createGame(stage);
    setPlan(again, slingshotPlan);
    selectNode(again, 0);
    settlePlanningClick(again, pathHit);
    expect(again.nodes.some((item) => item.step === pathHit.step)).toBe(true);
  });

  it("hides the × hit until a boost is selected", () => {
    const game = createGame(stage);
    setPlan(game, slingshotPlan);
    const place = nodePosition(game, 0);
    if (!place) throw new Error("launch node has no position");
    const node = worldToScreen(game.camera, WIDTH, HEIGHT, place.x, place.y);
    const marker = { x: node.x + theme.nodes.deleteX, y: node.y + theme.nodes.deleteY };
    expect(planningPointerHit(game, WIDTH, HEIGHT, marker.x, marker.y).type).not.toBe("remove");
    selectNode(game, 0);
    expect(planningPointerHit(game, WIDTH, HEIGHT, marker.x, marker.y).type).toBe("remove");
  });
});

/** A path sample just outside the node disc, in screen pixels. */
function pathClickBesideNode(game: ReturnType<typeof createGame>, node: { x: number; y: number }): { x: number; y: number } {
  const path = game.prediction.path;
  let best: { x: number; y: number; distance: number } | null = null;
  for (let i = 0; i < path.length; i++) {
    const screen = worldToScreen(game.camera, WIDTH, HEIGHT, path[i].x, path[i].y);
    const distance = Math.hypot(screen.x - node.x, screen.y - node.y);
    if (distance <= NODE_RADIUS + 0.5) continue;
    if (best === null || distance < best.distance) best = { x: screen.x, y: screen.y, distance };
  }
  if (!best) throw new Error("no path sample outside the node disc");
  return best;
}
