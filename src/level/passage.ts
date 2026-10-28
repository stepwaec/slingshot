import type { Body, Bounds, SimConfig } from "../sim/physics";

/**
 * Passage.
 *
 * Home is at the origin. The ship starts in a counterclockwise circular orbit
 * on Home's right-hand side, so its motion already points toward the star.
 * Planet X sits off to the right. A modest prograde burn falls past the star
 * and is bent into X. Staying clear of the star and still reaching X takes a
 * much larger burn. Both fits in the fuel budget; the slingshot uses less
 * than half as much.
 */
export interface Level {
  id: string;
  name: string;
  g: number;
  dt: number;
  bodies: readonly Body[];
  targetId: string;
  ship: { x: number; y: number; vx: number; vy: number };
  orbit: { bodyId: string; radius: number };
  fuel: number;
  /** Fuel spent per unit of delta-v. Cost = fuelPerDv * |dv|. */
  fuelPerDv: number;
  bounds: Bounds;
  maxSteps: number;
  /** Delta-v imparted per pixel of aim-drag. */
  dvPerPixel: number;
}

export interface LaunchSolution {
  name: string;
  dvx: number;
  dvy: number;
}

const G = 1;
const HOME_MASS = 90_000;
const ORBIT_RADIUS = 68;
const ORBIT_SPEED = Math.sqrt((G * HOME_MASS) / ORBIT_RADIUS);

const home: Body = {
  id: "home",
  name: "Home",
  kind: "home",
  x: 0,
  y: 0,
  mass: HOME_MASS,
  radius: 32,
};

const star: Body = {
  id: "star",
  name: "the star",
  kind: "star",
  x: 60,
  y: 560,
  mass: 700_000,
  radius: 46,
};

const planetX: Body = {
  id: "x",
  name: "Planet X",
  kind: "target",
  x: 690,
  y: 30,
  mass: 900,
  radius: 26,
  captureRadius: 72,
};

export const passage: Level = {
  id: "passage",
  name: "Passage",
  g: G,
  dt: 1 / 60,
  bodies: [home, star, planetX],
  targetId: planetX.id,
  ship: {
    x: ORBIT_RADIUS,
    y: 0,
    vx: 0,
    vy: ORBIT_SPEED,
  },
  orbit: { bodyId: home.id, radius: ORBIT_RADIUS },
  fuel: 80,
  fuelPerDv: 1,
  bounds: { minX: -4000, maxX: 4000, minY: -4000, maxY: 4000 },
  maxSteps: 4500,
  dvPerPixel: 0.2,
};

/** Close flyby of the star, then a bend into Planet X. */
export const slingshotLaunch: LaunchSolution = {
  name: "slingshot",
  dvx: -1.5346424223707573,
  dvy: 21.946409105716132,
};

/** High-energy burn that stays far from the star and still reaches Planet X. */
export const directLaunch: LaunchSolution = {
  name: "direct",
  dvx: 57.53281579523537,
  dvy: -49.65858542761278,
};

export function simConfigFromLevel(level: Level): SimConfig {
  return {
    g: level.g,
    dt: level.dt,
    bodies: level.bodies,
    bounds: level.bounds,
    maxSteps: level.maxSteps,
    targetId: level.targetId,
  };
}
