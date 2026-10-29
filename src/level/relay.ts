import type { Body, BurnNode } from "../sim/physics";
import type { Level } from "./passage";

/**
 * Relay.
 *
 * Planet X circles a point far from Home, with a moon on its own rail.
 * The predicted line only reaches a few seconds ahead and shortens as gravity
 * gets stronger, and only two burns can be queued. The launch and a mid-course
 * correction fit in that window. The capture burn does not: it sits on the
 * later encounter, so it has to be added after a pause once a slot is free
 * and the horizon has caught up.
 *
 * Numbers below are the reference solution the tests fly.
 */

const G = 1;
const HOME_MASS = 9_000;
const ORBIT_RADIUS = 42;
const ORBIT_SPEED = Math.sqrt((G * HOME_MASS) / ORBIT_RADIUS);

const PLANET_CX = 880;
const PLANET_CY = 30;
const PLANET_RADIUS = 130;
const PLANET_PHASE = 0.9;
const PLANET_OMEGA = 0.055;

const MOON_RADIUS = 44;
const MOON_PHASE = 0.2;
const MOON_OMEGA = 1.1;

const home: Body = {
  id: "home",
  name: "Home",
  kind: "home",
  x: 0,
  y: 0,
  mass: HOME_MASS,
  radius: 18,
};

const star: Body = {
  id: "star",
  name: "the star",
  kind: "star",
  x: -180,
  y: 520,
  mass: 40_000,
  radius: 34,
};

const planetX: Body = {
  id: "x",
  name: "Planet X",
  kind: "target",
  x: PLANET_CX + PLANET_RADIUS * Math.cos(PLANET_PHASE),
  y: PLANET_CY + PLANET_RADIUS * Math.sin(PLANET_PHASE),
  mass: 2_200,
  radius: 20,
  captureRadius: 58,
  orbit: {
    cx: PLANET_CX,
    cy: PLANET_CY,
    radius: PLANET_RADIUS,
    phase: PLANET_PHASE,
    omega: PLANET_OMEGA,
  },
};

const moon: Body = {
  id: "moon",
  name: "the moon",
  kind: "moon",
  x: planetX.x + MOON_RADIUS * Math.cos(MOON_PHASE),
  y: planetX.y + MOON_RADIUS * Math.sin(MOON_PHASE),
  mass: 25,
  radius: 7,
  orbit: {
    centerId: planetX.id,
    radius: MOON_RADIUS,
    phase: MOON_PHASE,
    omega: MOON_OMEGA,
  },
};

export const relay: Level = {
  id: "relay",
  name: "Relay",
  g: G,
  dt: 1 / 60,
  bodies: [home, star, planetX, moon],
  targetId: planetX.id,
  ship: {
    x: ORBIT_RADIUS,
    y: 0,
    vx: 0,
    vy: ORBIT_SPEED,
  },
  orbit: { bodyId: home.id, radius: ORBIT_RADIUS },
  fuel: 50,
  fuelPerDv: 1,
  bounds: { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 },
  maxSteps: 4200,
  dvPerPixel: 0.18,
  periapsisMargin: 6,
  maxPlannedBurns: 2,
  horizon: { seconds: 8, oneOrbit: false, shorten: 0.4, ref: 6 },
  pause: { kind: "free", count: 3 },
  c: 1_000_000,
  mission: {
    deadline: 200,
    crewLimit: 160,
    fuelStarMin: 0,
    crewWeight: 1,
    fuelWeight: 1,
  },
};

/** Departure burn, placed on the pad. */
export const relayLaunch: BurnNode = {
  step: 0,
  dvx: 26.828532423450717,
  dvy: -17.442185872299767,
};

/** Correction inside the opening horizon. A retrograde nudge that meets Planet X. */
export const relayCorrection: BurnNode = { step: 80, dvx: -2, dvy: 0 };

/**
 * Capture burn. Its step is past the horizon you can see at launch, so it is
 * added on a pause after the correction has fired.
 */
export const relayCapture: BurnNode = {
  step: 2605,
  dvx: -9.587376978776915,
  dvy: -11.37215518768442,
};

/** The two burns that fit in the plan before launch. They do not capture. */
export const relayOpening: readonly BurnNode[] = [relayLaunch, relayCorrection];

/** Opening burns plus the capture node added mid-flight. */
export const relayFull: readonly BurnNode[] = [relayLaunch, relayCorrection, relayCapture];

/**
 * Pause here on the opening plan. The correction has fired, a burn slot is
 * free, and the horizon now includes the capture step.
 */
export const relayPauseAt = 2300;
