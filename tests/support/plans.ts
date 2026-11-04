import type { BurnNode } from "../../src/sim/physics";

/**
 * Reference burns for the library stage used by tests. Not a shipped level.
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
