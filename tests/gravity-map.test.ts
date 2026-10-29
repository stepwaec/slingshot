import { describe, expect, it } from "vitest";
import { createGame, cycleGravity, launch, setGravityClock, setPlan, tick } from "../src/game/state";
import { passage, simConfigFromLevel, slingshotPlan } from "../src/level/passage";
import { rescue, safePlan } from "../src/level/rescue";
import {
  potentialDepth,
  properTimeRate,
  type SimConfig,
} from "../src/sim/physics";
import {
  gridX,
  gridY,
  sampleGravityGrid,
  scaleWellDepth,
  wellHeight,
  WELL_SOFTNESS,
  type GridBounds,
} from "../src/render/gravityField";

const empty: SimConfig = {
  g: 1,
  dt: 1 / 60,
  c: 100,
  bodies: [],
  bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
  maxSteps: 100,
  targetId: "none",
  periapsisMargin: 1,
};

const patch: GridBounds = { minX: -80, maxX: 80, minY: -40, maxY: 40 };

describe("gravity grid", () => {
  it("stores the physics potential at every sample, before the display scale", () => {
    const cases: Array<{ config: SimConfig; time: number; bounds: GridBounds }> = [
      { config: simConfigFromLevel(passage), time: 0, bounds: { minX: -120, maxX: 820, minY: -80, maxY: 680 } },
      { config: simConfigFromLevel(rescue), time: 0, bounds: { minX: -280, maxX: 420, minY: -160, maxY: 240 } },
      {
        config: {
          ...empty,
          bodies: [
            {
              id: "moon",
              name: "moon",
              kind: "moon",
              x: 50,
              y: 0,
              mass: 2_000,
              radius: 6,
              orbit: { cx: 0, cy: 0, radius: 50, phase: 0, omega: 1 },
            },
          ],
        },
        time: 0,
        bounds: { minX: -80, maxX: 80, minY: -80, maxY: 80 },
      },
    ];

    for (const item of cases) {
      for (const time of [item.time, item.time + Math.PI]) {
        const grid = sampleGravityGrid(item.config, time, item.bounds, 7, 5);
        let moved = false;
        const other = sampleGravityGrid(item.config, time + 1.7, item.bounds, 7, 5);
        for (let row = 0; row < grid.rows; row++) {
          for (let col = 0; col < grid.cols; col++) {
            const x = gridX(grid, col);
            const y = gridY(grid, row);
            const i = row * grid.cols + col;
            expect(grid.depth[i], `${x},${y} @ ${time}`).toBe(potentialDepth(x, y, item.config, time));
            expect(grid.scale[i]).toBe(scaleWellDepth(grid.depth[i], grid.knee));
            expect(grid.rate[i]).toBe(properTimeRate(x, y, 0, 0, item.config, time));
            if (grid.depth[i] !== other.depth[i]) moved = true;
          }
        }
        if (item.config.bodies.some((body) => body.orbit)) expect(moved).toBe(true);
      }
    }
  });

  it("soft-clamps the log scale so a singularity stays finite and ordered", () => {
    const knee = 250;
    expect(scaleWellDepth(0, knee)).toBe(0);
    expect(scaleWellDepth(-4, knee)).toBe(0);
    expect(scaleWellDepth(Number.NaN, knee)).toBe(0);
    expect(scaleWellDepth(knee, knee)).toBe(Math.tanh(Math.log1p(1) / WELL_SOFTNESS));
    expect(scaleWellDepth(Number.POSITIVE_INFINITY, knee)).toBe(1);

    let previous = -1;
    for (const depth of [0, 1, knee, knee * 8, 1e12]) {
      const scale = scaleWellDepth(depth, knee);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThan(previous);
      expect(scale).toBeLessThanOrEqual(1);
      previous = scale;
    }

    const hole: SimConfig = {
      ...empty,
      c: 40,
      bodies: [
        {
          id: "hole",
          name: "the black hole",
          kind: "blackhole",
          x: 0,
          y: 0,
          mass: 1e6,
          radius: 8,
        },
      ],
    };
    const grid = sampleGravityGrid(hole, 0, patch, 9, 9);
    let deepest = 0;
    let shallow = 1;
    for (let i = 0; i < grid.scale.length; i++) {
      expect(Number.isFinite(grid.scale[i])).toBe(true);
      expect(grid.scale[i]).toBeGreaterThanOrEqual(0);
      expect(grid.scale[i]).toBeLessThanOrEqual(1);
      expect(grid.scale[i]).toBe(scaleWellDepth(grid.depth[i], grid.knee));
      deepest = Math.max(deepest, grid.scale[i]);
      shallow = Math.min(shallow, grid.scale[i]);
      expect(wellHeight(grid.scale[i], 100)).toBeCloseTo(-grid.scale[i] * 100, 12);
    }
    expect(deepest).toBeGreaterThan(0.85);
    expect(shallow).toBeLessThan(deepest);
    expect(wellHeight(0, 100)).toBe(0);
    expect(wellHeight(1, 80)).toBe(-80);
  });
});

describe("gravity map toggle", () => {
  it("cycles the view and leaves the sim and the prediction untouched", () => {
    const game = createGame(rescue);
    setPlan(game, safePlan);
    const prediction = game.prediction;
    const ship = game.ship;
    const initial = game.initial;
    const nodes = game.nodes;
    const pathX = prediction.path[10]?.x;
    const step = ship.step;
    const tau = ship.tau;
    const fuel = game.fuel;

    expect(cycleGravity(game)).toBe("heat");
    setGravityClock(game, true);
    expect(cycleGravity(game)).toBe("sheet");
    expect(cycleGravity(game)).toBe("off");
    expect(game.gravityClock).toBe(true);

    expect(game.prediction).toBe(prediction);
    expect(game.ship).toBe(ship);
    expect(game.initial).toBe(initial);
    expect(game.nodes).toBe(nodes);
    expect(game.prediction.path[10]?.x).toBe(pathX);
    expect(game.ship.step).toBe(step);
    expect(game.ship.tau).toBe(tau);
    expect(game.fuel).toBe(fuel);
    expect(game.mode).toBe("planning");
  });

  it("does not change a flown trajectory when the view cycles between steps", () => {
    const quiet = run(false);
    const cycling = run(true);
    expect(cycling.x).toBe(quiet.x);
    expect(cycling.y).toBe(quiet.y);
    expect(cycling.vx).toBe(quiet.vx);
    expect(cycling.vy).toBe(quiet.vy);
    expect(cycling.step).toBe(quiet.step);
    expect(cycling.t).toBe(quiet.t);
    expect(cycling.tau).toBe(quiet.tau);
    expect(cycling.rate).toBe(quiet.rate);
    expect(cycling.status).toBe(quiet.status);
  });
});

function run(toggle: boolean) {
  const game = createGame(passage);
  setPlan(game, slingshotPlan);
  const forecast = game.prediction;
  launch(game);
  for (let i = 0; i < 40; i++) {
    if (toggle) {
      cycleGravity(game);
      setGravityClock(game, i % 2 === 0);
    }
    tick(game);
  }
  expect(game.prediction).toBe(forecast);
  return game.ship;
}
