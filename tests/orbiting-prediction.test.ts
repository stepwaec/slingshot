import { describe, expect, it } from "vitest";
import { createGame, launch, setPlan, setSlow, tick } from "../src/game/state";
import { simConfigFromLevel } from "../src/level/passage";
import { relay, relayFull } from "../src/level/relay";
import {
  SIM_SPEEDS,
  bodyPose,
  flyPlan,
  horizonSteps,
  makeState,
  predictPlan,
  stepsPerFrame,
  type BurnNode,
  type Horizon,
  type PathSample,
  type Prediction,
  type SimConfig,
  type SimState,
} from "../src/sim/physics";

function assertSameFlight(actual: Prediction, expected: Prediction, label: string): void {
  expect(actual.status, label).toBe(expected.status);
  expect(actual.steps, label).toBe(expected.steps);
  expect(actual.crashedBodyId, label).toBe(expected.crashedBodyId);
  expect(actual.lostReason, label).toBe(expected.lostReason);
  expect(actual.orbit, label).toEqual(expected.orbit);
  expect(actual.path, label).toHaveLength(expected.path.length);
  for (let i = 0; i < expected.path.length; i++) {
    const got = actual.path[i];
    const want = expected.path[i];
    if (got.x !== want.x || got.y !== want.y || got.step !== want.step) {
      throw new Error(
        `${label} diverged at sample ${i} (step ${want.step}): (${got.x}, ${got.y}) vs (${want.x}, ${want.y})`,
      );
    }
  }
}

function play(nodes: readonly BurnNode[], speed: (typeof SIM_SPEEDS)[number], slow = false): PathSample[] {
  const game = createGame(relay);
  setPlan(game, nodes);
  game.speed = speed;
  setSlow(game, slow);
  launch(game);
  const samples: PathSample[] = [];
  let guard = 0;
  while (game.mode === "flying" && guard++ < relay.maxSteps * 3) {
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) samples.push(game.frameSamples[i]);
  }
  return samples;
}

describe("orbiting bodies", () => {
  const config = simConfigFromLevel(relay);
  const open: SimConfig = { ...config, horizon: undefined };

  function start(): SimState {
    return makeState(relay.ship.x, relay.ship.y, relay.ship.vx, relay.ship.vy, open);
  }

  it("places the planet and its moon on the analytic orbit at t = 0", () => {
    const bodies = relay.bodies;
    for (const body of bodies) {
      const pose = bodyPose(body, 0, bodies);
      expect(pose.x).toBeCloseTo(body.x, 8);
      expect(pose.y).toBeCloseTo(body.y, 8);
    }
    const planet = bodies.find((body) => body.id === "x");
    const moon = bodies.find((body) => body.id === "moon");
    if (!planet?.orbit || !moon?.orbit) throw new Error("missing orbit");
    const later = bodyPose(planet, 10, bodies);
    expect(later.x).not.toBeCloseTo(planet.x, 1);
    const moonLater = bodyPose(moon, 3, bodies);
    const planetThen = bodyPose(planet, 3, bodies);
    const angle = moon.orbit.phase + moon.orbit.omega * 3;
    expect(moonLater.x).toBeCloseTo(planetThen.x + moon.orbit.radius * Math.cos(angle), 8);
    expect(moonLater.y).toBeCloseTo(planetThen.y + moon.orbit.radius * Math.sin(angle), 8);
  });

  it("matches the flight bit for bit with a moon, a moving planet, and three burns", () => {
    const state = start();
    expect(relayFull.length).toBe(3);
    const predicted = predictPlan(state, open, relayFull);
    const flown = flyPlan(state, open, relayFull, 1);
    expect(predicted.path.some((sample) => sample.step >= relayFull[2].step)).toBe(true);
    assertSameFlight(predicted, flown, "predictPlan");

    for (const speed of SIM_SPEEDS) {
      assertSameFlight(flyPlan(state, open, relayFull, stepsPerFrame(speed)), flown, `fly ${speed}x`);
      const played = play(relayFull, speed);
      expect(played).toHaveLength(flown.path.length);
      for (let i = 0; i < flown.path.length; i++) {
        if (played[i].x !== flown.path[i].x || played[i].y !== flown.path[i].y || played[i].step !== flown.path[i].step) {
          throw new Error(`game ${speed}x diverged at sample ${i}`);
        }
      }
    }

    const slow = play(relayFull, 4, true);
    expect(slow).toHaveLength(flown.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      if (slow[i].x !== flown.path[i].x || slow[i].y !== flown.path[i].y) {
        throw new Error(`slow motion diverged at sample ${i}`);
      }
    }
  });

  it("stops the predicted line at the horizon and still matches that prefix", () => {
    const state = start();
    const horizon: Horizon = { seconds: 2, oneOrbit: false, shorten: 0, ref: 1 };
    const limited = predictPlan(state, { ...open, horizon }, relayFull);
    const flown = flyPlan(state, open, relayFull, 1);
    expect(limited.path.length).toBeGreaterThan(10);
    expect(limited.path.length).toBeLessThan(flown.path.length);
    expect(limited.status).toBe("flying");
    for (let i = 0; i < limited.path.length; i++) {
      expect(limited.path[i].x).toBe(flown.path[i].x);
      expect(limited.path[i].y).toBe(flown.path[i].y);
      expect(limited.path[i].step).toBe(flown.path[i].step);
    }
  });

  it("shortens the horizon near a large mass and caps it at about one orbit", () => {
    const star = {
      id: "star",
      name: "the star",
      kind: "star" as const,
      x: 0,
      y: 0,
      mass: 8_000_000,
      radius: 20,
    };
    const base: SimConfig = {
      g: 1,
      dt: 1 / 60,
      bodies: [star],
      bounds: relay.bounds,
      maxSteps: 20_000,
      targetId: star.id,
      periapsisMargin: 4,
      horizon: { seconds: 40, oneOrbit: false, shorten: 1, ref: 2 },
    };
    const far = makeState(8_000, 0, 0, 1, base);
    const near = makeState(120, 0, 0, 1, base);
    expect(horizonSteps(near, base)).toBeLessThan(horizonSteps(far, base) / 2);

    const radius = 200;
    const mu = base.g * star.mass;
    const speed = Math.sqrt(mu / radius);
    const circular: SimConfig = {
      ...base,
      horizon: { seconds: 10_000, oneOrbit: true, shorten: 0, ref: 1 },
    };
    const orbiting = makeState(radius, 0, 0, speed, circular);
    const period = 2 * Math.PI * Math.sqrt((radius * radius * radius) / mu);
    const steps = horizonSteps(orbiting, circular);
    expect(steps * circular.dt).toBeLessThanOrEqual(period + 1e-9);
    expect(steps * circular.dt).toBeGreaterThan(period - circular.dt);
  });
});
