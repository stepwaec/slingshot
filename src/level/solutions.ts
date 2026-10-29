import type { BurnNode } from "../sim/physics";

/**
 * Reference burns for the three shipped levels. These are solutions, not level
 * geometry — the systems themselves live in `src/levels/*.json`.
 */

export interface LaunchSolution {
  name: string;
  dvx: number;
  dvy: number;
}

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
 * Capture node for the slingshot approach, applied on the step the ship is
 * inside Planet X's sphere. It sets that point as apoapsis of an ellipse that
 * clears the surface and stays inside the capture radius.
 */
export const slingshotCapture: BurnNode = {
  step: 2089,
  dvx: 3.594076494194162,
  dvy: 16.52559927915481,
};

/** Capture node for the direct approach. The launch alone already exceeds the budget. */
export const directCapture: BurnNode = {
  step: 1216,
  dvx: -13.397801068244888,
  dvy: -13.725593551547226,
};

/** Launch node at t = 0 plus the capture node. Wins inside the fuel budget. */
export const slingshotPlan: readonly BurnNode[] = [
  { step: 0, dvx: slingshotLaunch.dvx, dvy: slingshotLaunch.dvy },
  slingshotCapture,
];

/** Launch node at t = 0 plus the capture node. Captures, and costs more than the budget. */
export const directPlan: readonly BurnNode[] = [
  { step: 0, dvx: directLaunch.dvx, dvy: directLaunch.dvy },
  directCapture,
];

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
