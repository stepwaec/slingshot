import { describe, expect, it } from "vitest";
import { createGame, launch, setPlan, setSlow, tick } from "../src/game/state";
import { simConfigFromLevel, type Level } from "../src/level/catalog";
import {
  SIM_SPEEDS,
  bodyPose,
  flyPlan,
  horizonSteps,
  keplerMeanMotion,
  makeState,
  predictPlan,
  stepsPerFrame,
  type Body,
  type BurnNode,
  type Horizon,
  type PathSample,
  type Prediction,
  type SimConfig,
  type SimState,
} from "../src/sim/physics";

const g = 1;
const starMass = 8_000;
const planetMass = 2_200;
const planetRadius = 400;
const moonRadius = 50;
const star: Body = { id: "sun", name: "Sun", kind: "star", x: 0, y: 0, mass: starMass, radius: 20 };
const planet: Body = {
  id: "x",
  name: "Planet X",
  kind: "target",
  x: planetRadius,
  y: 0,
  mass: planetMass,
  radius: 18,
  captureRadius: 80,
  orbit: { centerId: "sun", radius: planetRadius, phase: 0, omega: keplerMeanMotion(g, starMass, planetRadius) },
};
const moon: Body = {
  id: "moon",
  name: "Moon",
  kind: "moon",
  x: planetRadius + moonRadius,
  y: 0,
  mass: 20,
  radius: 6,
  orbit: { centerId: "x", radius: moonRadius, phase: 0, omega: keplerMeanMotion(g, planetMass, moonRadius) },
};

const chart: Level = {
  id: "orbit-stage",
  name: "Orbit stage",
  g,
  dt: 1 / 60,
  bodies: [star, planet, moon],
  targetId: "x",
  ship: { x: -800, y: 200, vx: 3, vy: 0 },
  orbit: { bodyId: "sun", radius: 800 },
  fuel: 80,
  fuelPerDv: 1,
  bounds: { minX: -4000, maxX: 4000, minY: -4000, maxY: 4000 },
  maxSteps: 180,
  dvPerPixel: 0.2,
  periapsisMargin: 4,
  maxPlannedBurns: 4,
  c: 1_000_000,
  mission: { deadline: 800, crewLimit: 800, fuelStarMin: 0, crewWeight: 1, fuelWeight: 1 },
};

const burns: readonly BurnNode[] = [
  { step: 0, dvx: 0.4, dvy: 0.1 },
  { step: 30, dvx: -0.2, dvy: 0.15 },
  { step: 70, dvx: 0.1, dvy: -0.2 },
];

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
  const game = createGame(chart);
  setPlan(game, nodes);
  game.speed = speed;
  setSlow(game, slow);
  launch(game);
  const samples: PathSample[] = [];
  let guard = 0;
  while (game.mode === "flying" && guard++ < chart.maxSteps * 3) {
    tick(game);
    for (let i = 0; i < game.frameSamples.length; i++) samples.push(game.frameSamples[i]);
  }
  return samples;
}

describe("orbiting bodies", () => {
  const config = simConfigFromLevel(chart);
  const open: SimConfig = { ...config, horizon: undefined };

  function start(): SimState {
    return makeState(chart.ship.x, chart.ship.y, chart.ship.vx, chart.ship.vy, open);
  }

  it("places the planet and its moon on the analytic orbit at t = 0", () => {
    const bodies = chart.bodies;
    for (const body of bodies) {
      const pose = bodyPose(body, 0, bodies);
      expect(pose.x).toBeCloseTo(body.x, 8);
      expect(pose.y).toBeCloseTo(body.y, 8);
    }
    const placedPlanet = bodies.find((body) => body.id === "x");
    const placedMoon = bodies.find((body) => body.id === "moon");
    if (!placedPlanet?.orbit || !placedMoon?.orbit) throw new Error("missing orbit");
    const later = bodyPose(placedPlanet, 10, bodies);
    expect(later.x).not.toBeCloseTo(placedPlanet.x, 1);
    const moonLater = bodyPose(placedMoon, 3, bodies);
    const planetThen = bodyPose(placedPlanet, 3, bodies);
    const angle = placedMoon.orbit.phase + placedMoon.orbit.omega * 3;
    expect(moonLater.x).toBeCloseTo(planetThen.x + placedMoon.orbit.radius * Math.cos(angle), 8);
    expect(moonLater.y).toBeCloseTo(planetThen.y + placedMoon.orbit.radius * Math.sin(angle), 8);
  });

  it("matches the flight bit for bit with a moon, a moving planet, and three burns", () => {
    const state = start();
    expect(burns.length).toBe(3);
    const predicted = predictPlan(state, open, burns);
    const flown = flyPlan(state, open, burns, 1);
    expect(predicted.path.some((sample) => sample.step >= burns[2].step)).toBe(true);
    assertSameFlight(predicted, flown, "predictPlan");

    for (const speed of SIM_SPEEDS) {
      assertSameFlight(flyPlan(state, open, burns, stepsPerFrame(speed)), flown, `fly ${speed}x`);
      const played = play(burns, speed);
      expect(played).toHaveLength(flown.path.length);
      for (let i = 0; i < flown.path.length; i++) {
        if (played[i].x !== flown.path[i].x || played[i].y !== flown.path[i].y || played[i].step !== flown.path[i].step) {
          throw new Error(`game ${speed}x diverged at sample ${i}`);
        }
      }
    }

    const slow = play(burns, 4, true);
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
    const limitedConfig = { ...open, horizon };
    const opening = burns.slice(0, 2);
    const limited = predictPlan(state, limitedConfig, opening);
    const flown = flyPlan(state, open, opening, 1);
    const end = opening[opening.length - 1].step + horizonSteps(state, limitedConfig);
    expect(limited.path.length).toBeGreaterThan(10);
    expect(limited.path[limited.path.length - 1].step).toBe(end);
    expect(limited.path.length).toBeLessThan(flown.path.length);
    expect(limited.status).toBe("flying");
    for (let i = 0; i < limited.path.length; i++) {
      expect(limited.path[i].x).toBe(flown.path[i].x);
      expect(limited.path[i].y).toBe(flown.path[i].y);
      expect(limited.path[i].step).toBe(flown.path[i].step);
    }
  });

  it("shortens the horizon near a large mass and caps it at about one orbit", () => {
    const heavy = {
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
      bodies: [heavy],
      bounds: chart.bounds,
      maxSteps: 20_000,
      targetId: heavy.id,
      periapsisMargin: 4,
      c: 1_000_000,
      horizon: { seconds: 40, oneOrbit: false, shorten: 1, ref: 2 },
    };
    const far = makeState(8_000, 0, 0, 1, base);
    const near = makeState(120, 0, 0, 1, base);
    expect(horizonSteps(near, base)).toBeLessThan(horizonSteps(far, base) / 2);

    const orbitRadius = 200;
    const mu = base.g * heavy.mass;
    const speed = Math.sqrt(mu / orbitRadius);
    const circular: SimConfig = {
      ...base,
      horizon: { seconds: 10_000, oneOrbit: true, shorten: 0, ref: 1 },
    };
    const orbiting = makeState(orbitRadius, 0, 0, speed, circular);
    const period = 2 * Math.PI * Math.sqrt((orbitRadius * orbitRadius * orbitRadius) / mu);
    const steps = horizonSteps(orbiting, circular);
    expect(steps * circular.dt).toBeLessThanOrEqual(period + 1e-9);
    expect(steps * circular.dt).toBeGreaterThan(period - circular.dt);
  });
});
