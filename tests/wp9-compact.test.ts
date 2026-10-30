import { describe, expect, it } from "vitest";
import { createGame, setMagnetism } from "../src/game/state";
import { observatory } from "../src/level/catalog";
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
  type PathSample,
  type SimConfig,
} from "../src/sim/physics";

function flightConfig(bodies: Body[]): SimConfig {
  return {
    g: observatory.g,
    dt: observatory.dt,
    c: observatory.c,
    bodies,
    bounds: observatory.bounds,
    maxSteps: 60,
    targetId: bodies[0]?.id ?? "none",
    periapsisMargin: 1,
    fuelStart: 20,
    fuelMax: 20,
    fuelPerDv: 1,
  };
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

    const giant = observatory.bodies.find((item) => item.look === "gas-giant");
    const reach = giant?.magnet?.b1Reach ?? 0;
    expect(reach).toBeGreaterThan(0);
    const lethalEquator = reach / Math.cbrt(30);
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

  it("reads the Observatory pulsar and matches a flight beside it", () => {
    const pulsar = observatory.bodies.find((body) => body.look === "pulsar");
    if (!pulsar?.beam) throw new Error("observatory pulsar");
    expect(pulsar.beam.damage ?? 0).toBe(0);
    expect(pulsar.magnet?.averaged).toBe(true);
    const config = flightConfig([pulsar]);
    const state = makeState(pulsar.x, pulsar.y + 50, 1, 0, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.status).toBe(predicted.status);
    expect(predicted.final.hull).toBe(100);
    expect(flown.path.length).toBe(predicted.path.length);
  });

  it("spreads a path in the Observatory magnetar field without changing the prediction", () => {
    const magnetar = observatory.bodies.find((body) => body.look === "magnetar");
    if (!magnetar?.magnet) throw new Error("observatory magnetar");
    const samples: PathSample[] = [];
    for (let i = 0; i <= 40; i++) {
      samples.push({ x: magnetar.x, y: magnetar.y + magnetar.magnet.b1Reach * 0.4 + i * 6, step: i, rate: 1 });
    }
    const spread = spreadAlong(samples, observatory.dt, [magnetar]);
    expect(spread[spread.length - 1].sigma).toBeGreaterThan(spread[0].sigma);
    const game = createGame();
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

  it("keeps the Observatory neutron star dark and the black hole on the chart", () => {
    const neutron = observatory.bodies.find((body) => body.look === "neutron");
    const hole = observatory.bodies.find((body) => body.kind === "blackhole");
    if (!neutron || !hole) throw new Error("observatory compact");
    expect(neutron.beam?.damage ?? 0).toBe(0);
    expect(neutron.beam?.reach).toBe(36);
    expect(observatory.bodies.some((body) => body.look === "gas-giant" && body.magnet)).toBe(true);
    const config = flightConfig([neutron, hole]);
    const state = makeState(neutron.x + 90, neutron.y + 40, 1, 0, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.status).toBe(predicted.status);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
    }
  });
});

function replayHull(config: SimConfig): number {
  const state = makeState(0, 40, 0, 0, config);
  const cursor = { index: 0 };
  let guard = 0;
  while (state.status === "flying" && guard++ < config.maxSteps + 2) advancePlan(state, config, [], cursor);
  return state.hull;
}
