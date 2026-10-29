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

/** Pair: leave Home, bend past the wider binary, capture at Planet X. */
export const pairPlan: readonly BurnNode[] = [
  { step: 0, dvx: -1.3891854213354424, dvy: 7.878462024097664 },
  { step: 3920, dvx: -9.921212153557207, dvy: 10.654908009352727 },
];

/** Ember: skim the red giant's drag atmosphere, swing the white dwarf, capture. */
export const emberPlan: readonly BurnNode[] = [
  { step: 0, dvx: 24, dvy: 0 },
  { step: 1630, dvx: 21.32815548843824, dvy: 13.260529791369175 },
];

/** Chain: pass the gas giant's Kepler moons and capture at Planet X. */
export const chainPlan: readonly BurnNode[] = [
  { step: 0, dvx: 2.083778132003165, dvy: 11.817693036146496 },
  { step: 3945, dvx: -3.1810953850914494, dvy: 7.349952105356905 },
];

/** Pulse: leave Home, cross the pulsar's beams, capture at Planet X. */
export const pulsePlan: readonly BurnNode[] = [
  { step: 0, dvx: 8.660254037844387, dvy: 4.999999999999999 },
  { step: 4115, dvx: 4.866939482433775, dvy: 4.26668569885533 },
];

/** Quake: swing past the magnetar, through the fuzzy field, and capture. */
export const quakePlan: readonly BurnNode[] = [
  { step: 0, dvx: 8.660254037844387, dvy: 4.999999999999999 },
  { step: 2405, dvx: -6.630515982354261, dvy: 3.836439778773629 },
];

/** Needle: bend past the neutron star, with the gas giant's field off to the side. */
export const needlePlan: readonly BurnNode[] = [
  { step: 0, dvx: -11.817693036146496, dvy: -2.0837781320031654 },
  { step: 5029, dvx: -11.074885332370972, dvy: 5.022153209325186 },
];

/** Ice: cross the comet's coma, harvest, and capture at Planet X. */
export const icePlan: readonly BurnNode[] = [
  { step: 0, dvx: 4.000000000000001, dvy: 6.928203230275509 },
  { step: 5386, dvx: -3.28234668258312, dvy: 6.9915419648240285 },
];

/** Veil: fly through the emission nebula, scoop fuel, and capture. */
export const veilPlan: readonly BurnNode[] = [
  { step: 0, dvx: 24.248711305964274, dvy: -14.000000000000012 },
  { step: 1320, dvx: -10.442264332687, dvy: 1.2012000023548266 },
];

/** Drift: the dark cloud and the comet both feed the tank on the way to Planet X. */
export const driftPlan: readonly BurnNode[] = [
  { step: 0, dvx: -2.070552360820167, dvy: 7.7274066103125465 },
  { step: 6569, dvx: -11.486484390049283, dvy: 1.1946888427665865 },
];

/** Shade: cross the flare's shadow and capture, under the dose limit. */
export const shadePlan: readonly BurnNode[] = [
  { step: 0, dvx: 8.090169943749475, dvy: 5.877852522924732 },
  { step: 4033, dvx: -9.806446279988112, dvy: 12.258069153910647 },
];

/** Wander: pass the drifting rogue and capture at Planet X. */
export const wanderPlan: readonly BurnNode[] = [
  { step: 0, dvx: 9.781476007338057, dvy: 2.079116908177593 },
  { step: 4403, dvx: -5.819954789359722, dvy: -4.06238700271758 },
];
