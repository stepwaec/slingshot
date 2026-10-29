import { describe, expect, it } from "vitest";
import { createGame, setMagnetism, setPlan } from "../src/game/state";
import { needle, pulse, quake, rescue, simConfigFromLevel, type Level } from "../src/level/catalog";
import { deepPlan, needlePlan, pulsePlan, quakePlan } from "../src/level/solutions";
import {
  advancePlan,
  beamDamageRate,
  fieldRatio,
  flyPlan,
  MAG_B1,
  makeState,
  magneticMoment,
  predictPlan,
  spreadAlong,
  type Body,
  type BurnNode,
  type PathSample,
  type SimConfig,
} from "../src/sim/physics";

function expectFlightMatchesPrediction(level: Level, nodes: readonly BurnNode[]): void {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const predicted = predictPlan(state, config, nodes);
  const flown = flyPlan(state, config, nodes, 1);
  expect(flown.status).toBe(predicted.status);
  expect(flown.status).toBe("won");
  expect(flown.steps).toBe(predicted.steps);
  expect(flown.path.length).toBe(predicted.path.length);
  expect(predicted.final.hull).toBeGreaterThan(0);
  for (let i = 0; i < flown.path.length; i++) {
    const got = flown.path[i];
    const want = predicted.path[i];
    if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
      throw new Error(`${level.id} diverged at sample ${i}`);
    }
  }
  const again = replay(level, nodes);
  expect(again.hull).toBe(predicted.final.hull);
  expect(again.x).toBe(predicted.final.x);
  expect(again.y).toBe(predicted.final.y);
  expect(again.status).toBe(predicted.final.status);
}

function replay(level: Level, nodes: readonly BurnNode[]) {
  const config = simConfigFromLevel(level);
  const state = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const cursor = { index: 0 };
  let guard = 0;
  while (state.status === "flying" && guard++ < config.maxSteps + nodes.length + 2) {
    advancePlan(state, config, nodes, cursor);
  }
  return state;
}

function magnet(reach: number, tilt = 0, averaged = false): Body {
  return {
    id: "m",
    name: "magnet",
    kind: "star",
    x: 0,
    y: 0,
    mass: 1,
    radius: 8,
    magnet: { b1Reach: reach, tilt, averaged },
  };
}

describe("WP9 compact objects", () => {
  it("matches the dipole on the axis, the equator, and a cancelling pair", () => {
    const body = magnet(100, 0);
    expect(fieldRatio(0, 100, 0, [body])).toBeCloseTo(MAG_B1, 5);
    expect(fieldRatio(100, 0, 0, [body])).toBeCloseTo(0.5, 5);
    const equatorial = 100 / Math.cbrt(2);
    expect(fieldRatio(equatorial, 0, 0, [body])).toBeCloseTo(1, 4);
    const k = magneticMoment(100);
    expect(k).toBe((100 * 100 * 100) / 2);

    const opposite = magnet(100, Math.PI);
    expect(fieldRatio(0, 40, 0, [body, opposite])).toBeCloseTo(0, 6);

    const pulsar = magnet(80, 0, true);
    const round = 0.894 * 80;
    expect(fieldRatio(round, 0, 0, [pulsar])).toBeCloseTo(1, 3);
    expect(fieldRatio(0, round, 0, [pulsar])).toBeCloseTo(1, 3);

    const giant = needle.bodies.find((item) => item.look === "gas-giant");
    expect(giant?.magnet?.b1Reach).toBe(120);
    const lethalEquator = 120 / Math.cbrt(30);
    expect(lethalEquator).toBeLessThan(giant?.radius ?? 0);
  });

  it("damages inside a pulsar beam and leaves the ship beside it", () => {
    const bodies: Body[] = [
      {
        id: "pulsar",
        name: "pulsar",
        kind: "star",
        look: "pulsar",
        x: 0,
        y: 0,
        mass: 0,
        radius: 8,
        beam: { reach: 100, period: 4, damage: 60 },
      },
    ];
    expect(beamDamageRate(0, 40, 0, bodies)).toBe(60);
    expect(beamDamageRate(40, 0, 0, bodies)).toBe(0);
    const config: SimConfig = {
      g: 1,
      dt: 1 / 60,
      c: 1_000_000,
      bodies,
      bounds: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
      maxSteps: 5,
      targetId: "none",
      periapsisMargin: 1,
      fuelStart: 10,
      fuelMax: 10,
    };
    const state = makeState(0, 40, 0, 0, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(predicted.final.hull).toBeLessThan(100);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
    }
    expect(replayHull(config)).toBe(predicted.final.hull);
  });

  it("grows the fuzzy spread inside a magnetar field and keeps it afterwards", () => {
    const body = magnet(100, 0);
    const samples: PathSample[] = [];
    for (let i = 0; i <= 40; i++) samples.push({ x: 0, y: 40 + i * 8, step: i, rate: 1 });
    const spread = spreadAlong(samples, 1 / 60, [body]);
    expect(spread[0].sigma).toBe(0);
    let grew = false;
    for (let i = 1; i < spread.length; i++) {
      expect(spread[i].sigma).toBeGreaterThanOrEqual(spread[i - 1].sigma);
      if (spread[i].sigma > spread[i - 1].sigma) grew = true;
    }
    expect(grew).toBe(true);
    const again = spreadAlong(samples, 1 / 60, [body]);
    expect(again[again.length - 1].sigma).toBe(spread[spread.length - 1].sigma);
    const far = spread[spread.length - 1].sigma;
    expect(far).toBeGreaterThan(0.6);
    expect(fieldRatio(0, 400, 0, [body])).toBeLessThan(1);
  });

  it("Pulse's reference solution wins through the beams, matching the flight", () => {
    expect(pulse.bodies.some((body) => body.look === "pulsar" && (body.beam?.damage ?? 0) > 0)).toBe(true);
    expectFlightMatchesPrediction(pulse, pulsePlan);
    const flown = replay(pulse, pulsePlan);
    expect(flown.hull).toBeLessThan(100);
  });

  it("Quake's reference solution wins, and the field spreads the drawn path", () => {
    expect(quake.bodies.some((body) => body.look === "magnetar")).toBe(true);
    expectFlightMatchesPrediction(quake, quakePlan);
    const config = simConfigFromLevel(quake);
    const predicted = predictPlan(
      makeState(quake.ship.x, quake.ship.y, quake.ship.vx, quake.ship.vy, config),
      config,
      quakePlan,
    );
    const spread = spreadAlong(predicted.path, quake.dt, quake.bodies);
    expect(spread[spread.length - 1].sigma).toBeGreaterThan(0.6);
    const game = createGame(quake);
    setPlan(game, quakePlan);
    const path = game.prediction.path;
    const hull = game.prediction.final.hull;
    const x = game.prediction.final.x;
    setMagnetism(game, true);
    setMagnetism(game, false);
    expect(game.prediction.path).toBe(path);
    expect(game.prediction.final.hull).toBe(hull);
    expect(game.prediction.final.x).toBe(x);
    expect(game.magnetism).toBe(false);
  });

  it("Needle's neutron star and the Rescue black hole match flight", () => {
    const neutron = needle.bodies.find((body) => body.look === "neutron");
    expect(neutron?.beam?.damage ?? 0).toBe(0);
    expect(neutron?.beam?.reach).toBe(36);
    expect(needle.bodies.some((body) => body.look === "gas-giant" && body.magnet)).toBe(true);
    expectFlightMatchesPrediction(needle, needlePlan);
    expectFlightMatchesPrediction(rescue, deepPlan);
    expect(rescue.bodies.some((body) => body.kind === "blackhole")).toBe(true);
  });
});

function replayHull(config: SimConfig): number {
  const state = makeState(0, 40, 0, 0, config);
  const cursor = { index: 0 };
  let guard = 0;
  while (state.status === "flying" && guard++ < config.maxSteps + 2) advancePlan(state, config, [], cursor);
  return state.hull;
}
