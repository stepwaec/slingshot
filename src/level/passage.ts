import type { Body, Bounds, SimConfig } from "../sim/physics";

/**
 * Passage.
 *
 * Home is at the origin. The ship starts in a counterclockwise circular orbit
 * on Home's right-hand side, so its motion already points toward the star.
 * Planet X sits off to the right. A modest prograde burn falls past the star
 * and reaches X's sphere; a second burn there captures the ship into orbit.
 * Staying clear of the star costs much more fuel. The budget covers the
 * slingshot plus its capture burn, and it does not cover the direct route.
 *
 * Reference costs (fuel per unit delta-v is 1):
 * - Slingshot launch 22.00 + capture 17.48 = 39.48, inside the budget of 60.
 * - Direct launch 76.00 + capture 19.63 = 95.63, over the budget.
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
  /** Captured periapsis must clear the surface by this much. */
  periapsisMargin: number;
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
  fuel: 60,
  fuelPerDv: 1,
  bounds: { minX: -4000, maxX: 4000, minY: -4000, maxY: 4000 },
  maxSteps: 4500,
  dvPerPixel: 0.2,
  periapsisMargin: 8,
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

/**
 * Capture burn at X's sphere for the slingshot approach.
 * Puts the ship at apoapsis of an ellipse inside the capture radius.
 */
export const slingshotCapture: LaunchSolution = {
  name: "slingshot-capture",
  dvx: 1.991544505686151,
  dvy: 17.366199018107896,
};

/** Capture burn for the direct approach. The launch plus this burn exceeds the budget. */
export const directCapture: LaunchSolution = {
  name: "direct-capture",
  dvx: -15.335415053137007,
  dvy: -12.259747984032177,
};

export function simConfigFromLevel(level: Level): SimConfig {
  return {
    g: level.g,
    dt: level.dt,
    bodies: level.bodies,
    bounds: level.bounds,
    maxSteps: level.maxSteps,
    targetId: level.targetId,
    periapsisMargin: level.periapsisMargin,
  };
}
