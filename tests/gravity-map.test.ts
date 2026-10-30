import { describe, expect, it } from "vitest";
import { bindInput, type InputElements } from "../src/game/input";
import { applyGravityKey, createGame, cycleGravity, gravityLabel, launch, setPlan, tick } from "../src/game/state";
import { passage, rescue, simConfigFromLevel } from "../src/level/catalog";
import { safePlan, slingshotPlan } from "../src/level/solutions";
import { clockHeatAlpha, clockHeatRgb, palette, srgb01 } from "../src/render/palette";
import { theme } from "../src/render/theme";
import {
  potentialDepth,
  properTimeRate,
  type SimConfig,
} from "../src/sim/physics";
import {
  clampPinch,
  gridX,
  gridY,
  pinchTowardMasses,
  sampleGravityGrid,
  scaleWellDepth,
  wellHeight,
  PINCH_CELL,
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
            const pinch = pinchTowardMasses(x, y, item.config, time, grid.knee);
            const shown = clampPinch(pinch.dx, pinch.dy, grid.stepX, grid.stepY);
            expect(Number.isFinite(grid.pinchX[i])).toBe(true);
            expect(Number.isFinite(grid.pinchY[i])).toBe(true);
            expect(grid.pinchX[i]).toBe(x + shown.dx);
            expect(grid.pinchY[i]).toBe(y + shown.dy);
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

  it("pinches toward the masses, harder in a deeper well, and stays finite on a singularity", () => {
    const knee = 40;
    const body = {
      id: "mass",
      name: "mass",
      kind: "star" as const,
      x: 0,
      y: 0,
      mass: 400,
      radius: 6,
    };
    const light: SimConfig = { ...empty, bodies: [{ ...body, mass: 80 }] };
    const heavy: SimConfig = { ...empty, bodies: [body] };
    const at = (config: SimConfig, x: number, y: number) => pinchTowardMasses(x, y, config, 0, knee);

    const right = at(heavy, 90, 0);
    expect(right.dx).toBeLessThan(0);
    expect(right.dy).toBe(0);
    const diagonal = at(heavy, 30, 40);
    const towardX = -30;
    const towardY = -40;
    const dot = diagonal.dx * towardX + diagonal.dy * towardY;
    const towardLen = Math.hypot(towardX, towardY);
    const pinchLen = Math.hypot(diagonal.dx, diagonal.dy);
    expect(dot / (towardLen * pinchLen)).toBeGreaterThan(0.98);

    const shallow = at(light, 90, 0);
    expect(Math.hypot(right.dx, right.dy)).toBeGreaterThan(Math.hypot(shallow.dx, shallow.dy));

    const onMass = at(heavy, 0, 0);
    expect(onMass.dx).toBe(0);
    expect(onMass.dy).toBe(0);
    const beside = at(heavy, 1e-4, 0);
    expect(Number.isFinite(beside.dx)).toBe(true);
    expect(Number.isFinite(beside.dy)).toBe(true);
    expect(Math.hypot(beside.dx, beside.dy)).toBeLessThan(1);

    const inner = at(heavy, 36, 0);
    const outer = at(heavy, 72, 0);
    const restGap = 72 - 36;
    const shownGap = 72 + outer.dx - (36 + inner.dx);
    expect(shownGap).toBeLessThan(restGap);
    expect(shownGap).toBeGreaterThan(0);
  });

  it("keeps neighbouring vertices in order so cells cannot fold or spike", () => {
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
        {
          id: "star",
          name: "star",
          kind: "star",
          x: 36,
          y: -12,
          mass: 400000,
          radius: 20,
        },
      ],
    };
    const cases = [
      sampleGravityGrid(simConfigFromLevel(passage), 0, { minX: -200, maxX: 900, minY: -200, maxY: 800 }, 48, 36),
      sampleGravityGrid(simConfigFromLevel(rescue), 0, { minX: -400, maxX: 500, minY: -300, maxY: 300 }, 48, 36),
      sampleGravityGrid(hole, 0, { minX: -80, maxX: 80, minY: -80, maxY: 80 }, 41, 41),
    ];
    for (const grid of cases) {
      const limitX = Math.abs(grid.stepX) * PINCH_CELL + 1e-9;
      const limitY = Math.abs(grid.stepY) * PINCH_CELL + 1e-9;
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
          const i = row * grid.cols + col;
          const x = gridX(grid, col);
          const y = gridY(grid, row);
          expect(Math.abs(grid.pinchX[i] - x)).toBeLessThanOrEqual(limitX);
          expect(Math.abs(grid.pinchY[i] - y)).toBeLessThanOrEqual(limitY);
          if (col + 1 < grid.cols) expect(grid.pinchX[i + 1]).toBeGreaterThan(grid.pinchX[i]);
          if (row + 1 < grid.rows) expect(grid.pinchY[i + grid.cols]).toBeGreaterThan(grid.pinchY[i]);
        }
      }
    }
  });
});

describe("gravity layer toggle", () => {
  it("toggles off and on from the button and the G key", () => {
    const game = createGame(passage);
    expect(game.gravity).toBe("off");
    expect(gravityLabel(game.gravity)).toBe("Gravity");

    expect(cycleGravity(game)).toBe("on");
    expect(gravityLabel(game.gravity)).toBe("Gravity");
    expect(cycleGravity(game)).toBe("off");
    expect(gravityLabel(game.gravity)).toBe("Gravity");

    const press = { repeat: false, metaKey: false, ctrlKey: false, altKey: false };
    expect(applyGravityKey(game, { key: "g", ...press })).toBe(true);
    expect(game.gravity).toBe("on");
    expect(gravityLabel(game.gravity)).toBe("Gravity");
    expect(applyGravityKey(game, { key: "G", ...press })).toBe(true);
    expect(game.gravity).toBe("off");
    expect(gravityLabel(game.gravity)).toBe("Gravity");
    expect(applyGravityKey(game, { key: "g", repeat: true, metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(game.gravity).toBe("off");
    expect(applyGravityKey(game, { key: "g", repeat: false, metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
    expect(applyGravityKey(game, { key: "g", ...press })).toBe(true);
    expect(game.gravity).toBe("on");
    expect(gravityLabel(game.gravity)).toBe("Gravity");
    expect(applyGravityKey(game, { key: "c", ...press })).toBe(false);
    expect(game.gravity).toBe("on");
  });

  it("wires the gravity button and the G key to that same cycle", () => {
    const game = createGame(passage);
    const gravityClicks: Array<() => void> = [];
    const keys: Array<(event: { key: string; repeat: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; preventDefault: () => void }) => void> = [];
    const quietButton = () => ({ addEventListener() {} });
    const canvas = {
      addEventListener() {},
      classList: { add() {}, remove() {} },
    };
    const previous = {
      window: globalThis.window,
      HTMLInputElement: globalThis.HTMLInputElement,
      HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
      HTMLSelectElement: globalThis.HTMLSelectElement,
    };
    globalThis.HTMLInputElement = class HTMLInputElement {} as unknown as typeof globalThis.HTMLInputElement;
    globalThis.HTMLTextAreaElement = class HTMLTextAreaElement {} as unknown as typeof globalThis.HTMLTextAreaElement;
    globalThis.HTMLSelectElement = class HTMLSelectElement {} as unknown as typeof globalThis.HTMLSelectElement;
    globalThis.window = {
      addEventListener(type: string, fn: (event: { key: string; repeat: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; preventDefault: () => void }) => void) {
        if (type === "keydown") keys.push(fn);
      },
    } as unknown as Window & typeof globalThis;
    try {
      bindInput(
        game,
        {
          canvas,
          launchButton: quietButton(),
          deleteButton: quietButton(),
          nodeRemove: quietButton(),
          resetButtons: [],
          clearButtons: [],
          speedButtons: [],
          pauseButton: quietButton(),
          resumeButton: quietButton(),
          slowButton: quietButton(),
          gravityButton: {
            addEventListener(type: string, fn: () => void) {
              if (type === "click") gravityClicks.push(fn);
            },
          },
          magnetismButton: quietButton(),
          radiationButton: quietButton(),
        } as unknown as InputElements,
        () => ({ width: 800, height: 600 }),
      );
      const quiet = { repeat: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {} };
      for (const view of ["on", "off"] as const) {
        gravityClicks[0]();
        expect(game.gravity).toBe(view);
        expect(gravityLabel(game.gravity)).toBe("Gravity");
      }
      for (const view of ["on", "off"] as const) {
        keys[0]({ key: "g", ...quiet });
        expect(game.gravity).toBe(view);
        expect(gravityLabel(game.gravity)).toBe("Gravity");
      }
      keys[0]({ key: "c", ...quiet });
      expect(game.gravity).toBe("off");
    } finally {
      globalThis.window = previous.window;
      globalThis.HTMLInputElement = previous.HTMLInputElement;
      globalThis.HTMLTextAreaElement = previous.HTMLTextAreaElement;
      globalThis.HTMLSelectElement = previous.HTMLSelectElement;
    }
  });

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

    expect(cycleGravity(game)).toBe("on");
    expect(cycleGravity(game)).toBe("off");
    expect(game.gravity).toBe("off");

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

  it("flies the Passage slingshot reference to the same points with the layer on", () => {
    const quiet = flyReference(false);
    const layered = flyReference(true);
    expect(layered.length).toBe(quiet.length);
    expect(layered.length).toBeGreaterThan(1000);
    for (let i = 0; i < quiet.length; i++) {
      const got = layered[i];
      const want = quiet[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
        throw new Error(`sample ${i} (step ${want.step}) moved: (${got.x}, ${got.y}) vs (${want.x}, ${want.y})`);
      }
    }
  });
});

describe("clock-rate heat", () => {
  it("paints a stopped clock hot and a full-rate clock clear", () => {
    expect(clockHeatRgb(1)).toEqual(srgb01(palette.path));
    expect(clockHeatRgb(0.82)).toEqual(srgb01(palette.planetStartBase));
    expect(clockHeatRgb(0.55)).toEqual(srgb01(palette.planetStartBase));
    expect(clockHeatRgb(0.4)).toEqual(srgb01(palette.fuelLow));
    expect(clockHeatRgb(0.2)).toEqual(srgb01(palette.starCorona));
    expect(clockHeatRgb(0)).toEqual(srgb01(palette.starGlow));
    const alpha = theme.gravity.heatAlpha;
    expect(clockHeatAlpha(1, alpha)).toBe(0);
    expect(clockHeatAlpha(0, alpha)).toBeCloseTo(0.84);
    expect(clockHeatAlpha(0.4, alpha)).toBeGreaterThan(0.7);
    expect(clockHeatAlpha(0.82, alpha)).toBeLessThan(0.15);
    expect(clockHeatAlpha(0.4, alpha)).toBeGreaterThan(clockHeatAlpha(0.9, alpha));
  });
});

function flyReference(toggle: boolean): Array<{ x: number; y: number; step: number; rate: number }> {
  const game = createGame(passage);
  setPlan(game, slingshotPlan);
  const predicted = game.prediction.path.map((sample) => ({
    x: sample.x,
    y: sample.y,
    step: sample.step,
    rate: sample.rate,
  }));
  launch(game);
  const flown: Array<{ x: number; y: number; step: number; rate: number }> = [];
  let guard = 0;
  while (game.mode === "flying" && guard++ < passage.maxSteps) {
    if (toggle) cycleGravity(game);
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) {
      const sample = game.frameSamples[i];
      flown.push({ x: sample.x, y: sample.y, step: sample.step, rate: sample.rate });
    }
  }
  expect(flown).toEqual(predicted);
  return flown;
}

function run(toggle: boolean) {
  const game = createGame(passage);
  setPlan(game, slingshotPlan);
  const forecast = game.prediction;
  launch(game);
  for (let i = 0; i < 40; i++) {
    if (toggle) cycleGravity(game);
    tick(game);
  }
  expect(game.prediction).toBe(forecast);
  return game.ship;
}
