import { describe, expect, it } from "vitest";
import { observatory, simConfigFromLevel } from "../src/level/catalog";
import { frameLevel } from "../src/render/camera";
import type { Belt } from "../src/sim/belts";
import {
  flyPlan,
  keplerMeanMotion,
  makeState,
  predictPlan,
  stepsPerFrame,
  type Body,
} from "../src/sim/physics";
import { compileMission, WorldError } from "../src/world/compile";
import type { Mission, Region, World } from "../src/world/types";

const sun: Body = {
  id: "sun",
  name: "Sun",
  kind: "star",
  look: "sol-sun",
  x: 0,
  y: 0,
  mass: 5000,
  radius: 20,
};
const planet: Body = {
  id: "planet",
  name: "Planet",
  kind: "planet",
  look: "earth",
  x: 0,
  y: 0,
  mass: 800,
  radius: 16,
  orbit: { centerId: "sun", radius: 400, phase: 0, omega: keplerMeanMotion(1, 5000, 400) },
};
const moon: Body = {
  id: "moon",
  name: "Moon",
  kind: "moon",
  look: "luna",
  x: 0,
  y: 0,
  mass: 8,
  radius: 6,
  orbit: { centerId: "planet", radius: 70, phase: 1, omega: keplerMeanMotion(1, 800, 70) },
};
const belt: Belt = { id: "rocks", centerId: "sun", radius: 250, width: 40, tier: "sparse", seed: 3 };
const moonBelt: Belt = { id: "shards", centerId: "planet", radius: 70, width: 12, tier: "sparse", seed: 9 };
const physics = { gravityScale: 1 as const };

const world: World = {
  id: "fixture",
  name: "Fixture",
  g: 1,
  dt: 1 / 60,
  c: 5000,
  physics,
  bodies: [sun, planet, moon],
  belts: [belt, moonBelt],
  bounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
};

const innerBounds = { minX: 200, maxX: 700, minY: -250, maxY: 250 };

const inner: Region = {
  id: "inner",
  worldId: "fixture",
  name: "Inner",
  bounds: innerBounds,
  bodyIds: ["moon"],
};

const starRegion: Region = {
  id: "star",
  worldId: "fixture",
  name: "Star",
  bounds: { minX: -80, maxX: 80, minY: -80, maxY: 80 },
  bodyIds: ["sun"],
  beltIds: [],
};

function mission(over: Partial<Mission> & Pick<Mission, "id" | "regionId" | "targetId" | "orbit">): Mission {
  return {
    name: over.id,
    worldId: "fixture",
    ship: { x: 430, y: 40, vx: 0, vy: 40 },
    fuel: 40,
    fuelPerDv: 1,
    maxSteps: 500,
    dvPerPixel: 0.5,
    periapsisMargin: 4,
    scoring: { deadline: 30, crewLimit: 30, fuelStarMin: 10, crewWeight: 1, fuelWeight: 1 },
    objectives: [],
    ...over,
  };
}

const moonMission = mission({
  id: "visit-moon",
  regionId: "inner",
  targetId: "moon",
  orbit: { bodyId: "planet", radius: 40 },
  objectives: [{ id: "moon", bodyId: "moon", kind: "capture", label: "Capture the Moon" }],
});

const starMission = mission({
  id: "visit-star",
  regionId: "star",
  targetId: "sun",
  orbit: { bodyId: "sun", radius: 40 },
  ship: { x: 30, y: 0, vx: 0, vy: 8 },
});

describe("world, region, and mission", () => {
  const regions = [inner, starRegion];
  const around = compileMission([world], regions, moonMission);
  const star = compileMission([world], regions, starMission);

  it("shares the world's bodies and physics across missions", () => {
    expect(around.bodies.map((body) => body.id)).toEqual(["sun", "planet", "moon"]);
    expect(around.bodies[0]).toBe(sun);
    expect(around.bodies[1]).toBe(planet);
    expect(around.bodies[2]).toBe(moon);
    expect(star.bodies[0]).toBe(sun);
    expect(around.g).toBe(world.g);
    expect(around.dt).toBe(world.dt);
    expect(around.c).toBe(world.c);
    expect(star.g).toBe(world.g);
    expect(around.physics).toBe(physics);
    expect(star.physics).toBe(physics);
  });

  it("uses the region bounds when the mission does not set them", () => {
    expect(around.bounds).toEqual(innerBounds);
    expect(around.frame).toEqual(innerBounds);
    const camera = { x: 0, y: 0, zoom: 1 };
    frameLevel(camera, 1000, 800, around);
    expect(camera.x).toBe(450);
    expect(camera.y).toBe(0);
    expect(camera.zoom).toBeCloseTo(1.44);
  });

  it("includes an orbit centre the region did not name", () => {
    expect(inner.bodyIds).toEqual(["moon"]);
    expect(around.bodies.some((body) => body.id === "planet")).toBe(true);
    expect(around.bodies.some((body) => body.id === "sun")).toBe(true);
  });

  it("includes a belt only when its centre is in the region", () => {
    expect(around.belts?.map((item) => item.id)).toEqual(["rocks", "shards"]);
    expect(around.belts?.[0]).toBe(belt);
    expect(star.belts).toBeUndefined();
  });

  it("keeps the objectives on the compiled mission", () => {
    expect(around.objectives).toEqual(moonMission.objectives);
    expect(star.objectives).toBeUndefined();
  });

  it("rejects a region that names a missing body", () => {
    const broken: Region = { ...inner, id: "broken", bodyIds: ["missing"] };
    expect(() => compileMission([world], [broken], { ...moonMission, regionId: "broken" })).toThrow(WorldError);
  });

  it("rejects a belt whose centre is outside the region", () => {
    const broken: Region = { ...starRegion, id: "belted", beltIds: ["shards"] };
    expect(() => compileMission([world], [broken], { ...starMission, regionId: "belted" })).toThrow(/shards/);
  });

  it("predicts the same coast the flight flies", () => {
    const config = simConfigFromLevel(around);
    const state = makeState(around.ship.x, around.ship.y, around.ship.vx, around.ship.vy, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.status).toBe(predicted.status);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.path.length).toBeGreaterThan(10);
    for (let i = 0; i < predicted.path.length; i++) {
      const got = flown.path[i];
      const want = predicted.path[i];
      expect(got.x, `sample ${i}`).toBe(want.x);
      expect(got.y, `sample ${i}`).toBe(want.y);
      expect(got.step, `sample ${i}`).toBe(want.step);
    }
    const faster = flyPlan(state, config, [], stepsPerFrame(4));
    expect(faster.status).toBe(predicted.status);
    expect(faster.steps).toBe(predicted.steps);
    expect(faster.path.length).toBe(predicted.path.length);
  });

  it("leaves the Observatory as its own chart", () => {
    expect(observatory.id).toBe("observatory");
    expect(observatory.frame).toBeUndefined();
    expect(observatory.objectives).toBeUndefined();
    expect(around.id).not.toBe(observatory.id);
    expect(observatory.bodies.length).toBeGreaterThan(around.bodies.length);
  });
});
