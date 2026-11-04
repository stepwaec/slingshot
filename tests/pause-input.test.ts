import { describe, expect, it } from "vitest";
import { createGame, launch, pause, resume, setPlan, tick, type Game } from "../src/game/state";
import { aimHandle, planningPointerHit, settlePlanningClick } from "../src/game/input";
import { worldToScreen } from "../src/render/camera";
import { paintNode } from "../src/render/node-style";
import { theme } from "../src/render/theme";
import { stage } from "./support/stage";
import { slingshotLaunch } from "./support/plans";
import type { PathSample } from "../src/sim/physics";

const WIDTH = 1280;
const HEIGHT = 720;

const nodes = [
  { step: 0, dvx: slingshotLaunch.dvx, dvy: slingshotLaunch.dvy },
  { step: 400, dvx: 0.35, dvy: -0.2 },
  { step: 900, dvx: -0.25, dvy: 0.4 },
];

function flyTo(game: Game, step: number): void {
  let guard = 0;
  while (game.mode === "flying" && game.ship.step < step && guard++ < stage.maxSteps) tick(game);
}

describe("pause controls at the pointer", () => {
  it("adds and resizes a future burn, and does not grab a burn that already fired", () => {
    const game = createGame(stage);
    setPlan(game, nodes);
    launch(game);
    flyTo(game, 180);
    // The Pause button and the P key both call this.
    expect(pause(game)).toBe(true);
    expect(game.mode).toBe("paused");
    expect(game.prediction.path[0].step).toBeGreaterThan(game.ship.step);

    const firedOffset = (game.ship.step - game.nodes[0].step) * game.level.dt;
    const locked = paintNode(
      {
        editing: true,
        selected: false,
        placing: false,
        exceeds: false,
        offset: firedOffset,
        windup: theme.burn.windup,
        ignite: theme.nodes.ignite,
      },
      0,
    );
    expect(locked.drawn).toBe(true);
    expect(locked.dashed).toBe(true);
    expect(locked.arrow).toBe(false);

    const kept = game.nodes[0].dvx;
    const ghost = game.prediction.snapshots[0];
    game.prediction.snapshots[0] = {
      ...ghost,
      reached: true,
      before: { ...game.ship, x: 80, y: 40 },
      after: { ...game.ship, x: 80, y: 40 },
    };
    game.camera.x = 80;
    game.camera.y = 40;
    game.camera.zoom = 1;
    const firedScreen = worldToScreen(game.camera, WIDTH, HEIGHT, 80, 40);
    const onFired = planningPointerHit(game, WIDTH, HEIGHT, firedScreen.x, firedScreen.y);
    expect(onFired.type === "node" && onFired.index === 0).toBe(false);
    expect(onFired.type === "handle" && onFired.index === 0).toBe(false);
    aimHandle(game, { width: WIDTH, height: HEIGHT }, 0, firedScreen.x + 30, firedScreen.y, false);
    expect(game.nodes[0].dvx).toBe(kept);
    expect(game.selected).not.toBe(0);
    game.prediction.snapshots[0] = ghost;

    const ahead = game.prediction.path.find((sample) => sample.step > game.ship.step + 90);
    if (!ahead) throw new Error("no future sample");
    game.camera.x = ahead.x;
    game.camera.y = ahead.y;
    game.camera.zoom = 2;
    const click = worldToScreen(game.camera, WIDTH, HEIGHT, ahead.x, ahead.y);
    const onPath = planningPointerHit(game, WIDTH, HEIGHT, click.x, click.y);
    expect(onPath.type).toBe("path");
    if (onPath.type !== "path") return;
    settlePlanningClick(game, onPath);
    const index = game.nodes.findIndex((node) => node.step === onPath.step);
    expect(index).toBeGreaterThanOrEqual(game.cursor.index);
    const before = game.nodes[index].dvx;
    aimHandle(game, { width: WIDTH, height: HEIGHT }, index, click.x + 48, click.y - 12, false);
    expect(game.nodes[index].dvx).not.toBe(before);

    const pauseStep = game.ship.step;
    const future = game.prediction.path.filter((sample) => sample.step > pauseStep && sample.step <= pauseStep + 200);
    expect(future.length).toBeGreaterThan(10);
    resume(game);
    const flown: PathSample[] = [];
    let guard = 0;
    while (flown.length < future.length && game.mode === "flying" && guard++ < stage.maxSteps) {
      tick(game);
      for (let i = 0; i < game.frameSamples.length; i++) flown.push(game.frameSamples[i]);
    }
    expect(flown.length).toBeGreaterThanOrEqual(future.length);
    for (let i = 0; i < future.length; i++) {
      expect(flown[i].x).toBe(future[i].x);
      expect(flown[i].y).toBe(future[i].y);
      expect(flown[i].step).toBe(future[i].step);
      expect(flown[i].rate).toBe(future[i].rate);
    }
  });
});
