import { horizonRadius, type Body, type BurnNode } from "../sim/physics";
import type { Level } from "./passage";

/**
 * Rescue.
 *
 * A black hole sits between Home and Planet X. Outside time is the rescue
 * window: miss it and the mission fails even in orbit. A dive near the hole
 * saves fuel and crew time, because proper time slows there, and it spends
 * more outside time than the wide arc.
 *
 * The hole's radius is its horizon, r_s = 2GM/c². c is a lowered game constant.
 * Pausing spends score, and that cost comes off the mission points.
 *
 * The two reference plans are what Safe arc and Deep dive load.
 */

const G = 1;
export const RESCUE_C = 42;
const HORIZON = 44;

const holeMass = (HORIZON * RESCUE_C * RESCUE_C) / (2 * G);

export const rescueHole: Body = {
  id: "hole",
  name: "the black hole",
  kind: "blackhole",
  x: 0,
  y: 0,
  mass: holeMass,
  radius: horizonRadius(holeMass, G, RESCUE_C),
};

const home: Body = {
  id: "home",
  name: "Home",
  kind: "home",
  x: -240,
  y: 180,
  mass: 0,
  radius: 16,
};

const planetX: Body = {
  id: "x",
  name: "Planet X",
  kind: "target",
  x: 360,
  y: -40,
  mass: 1400,
  radius: 18,
  captureRadius: 64,
};

export const rescue: Level = {
  id: "rescue",
  name: "Rescue",
  g: G,
  dt: 1 / 60,
  bodies: [home, rescueHole, planetX],
  targetId: planetX.id,
  ship: { x: -200, y: 170, vx: 0, vy: 0 },
  orbit: { bodyId: home.id, radius: 36 },
  fuel: 50,
  fuelPerDv: 1,
  bounds: { minX: -4000, maxX: 4000, minY: -4000, maxY: 4000 },
  maxSteps: 7000,
  dvPerPixel: 0.25,
  periapsisMargin: 6,
  maxPlannedBurns: 4,
  c: RESCUE_C,
  // The safe arc arrives at 25.88 s outside. The dive arrives at 27.00 s.
  // 26.4 s is the rescue window: the dive is late, the arc is not.
  mission: {
    deadline: 26.4,
    crewLimit: 15.5,
    fuelStarMin: 11,
    crewWeight: 1,
    fuelWeight: 2,
  },
  pause: { kind: "score", cost: 8, budget: 24 },
};

/** Wide arc. Faster on the outside clock, thirstier, and harder on the crew. */
export const safePlan: readonly BurnNode[] = [
  { step: 0, dvx: 20.795629443572977, dvy: 2.9226351201613743 },
  { step: 1553, dvx: -18.431546435218667, dvy: 8.77322462946973 },
];

/** Dive past the hole. More fuel left, less ship time, more outside time. */
export const deepPlan: readonly BurnNode[] = [
  { step: 0, dvx: 7.866738461734151, dvy: -19.470860945902537 },
  { step: 1620, dvx: -14.384249949606534, dvy: -4.538432715721418 },
];
