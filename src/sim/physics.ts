/**
 * Deterministic Newtonian flight.
 *
 * A plan is an ordered list of burn nodes. Each node is a sim step and an
 * impulsive delta-v applied at that step, before the step integrates. Step 0
 * is the launch instant. Prediction and live flight both advance only through
 * `advancePlan` / `advanceFrame`. Sim speed and slow motion change how many
 * fixed steps run per frame. They never change `dt`.
 *
 * Bodies with an `orbit` move on analytic circles keyed by sim time
 * (`step * dt`). The same pose is used by gravity, crashes, capture, and the
 * prediction. A body without an orbit stays at `x`, `y`.
 *
 * `predictPlan` caches the state at each node. Editing node k recomputes from
 * k onward and reuses the path before it. The planning line stops at
 * `planHorizonEnd`: a coast of `extension` steps after the latest burn, or
 * after the ship when there is no later burn. The slider sets that extension.
 * Omit it and the coast is today's look-ahead. The step cap bounds the work.
 * `dt` stays the flight step. Live flight does not stop early.
 *
 * Each step also advances two clocks. Outside time starts as coordinate time
 * (`step * dt`): Home and Planet X share that one frame. A wormhole exit adds
 * its clock offset on top of that, so the scoring clock and the ship both
 * jump together. Orbits keep using `step * dt`. Ship time is the
 * proper time along the trajectory. With the default knobs,
 * `dτ/dt = sqrt(1 - 2 Φ_depth / c² - v² / c²)`, clamped at 0.
 * A finite `dilationCap` replaces that hard floor with a smooth saturation.
 * `gravityScale`, `eps`, and `p` reshape the force. Φ is the integral of the
 * force, so dilation and the gravity map stay on the same field.
 * Prediction and flight both read these knobs off `SimConfig`.
 *
 * Magnetic bodies carry a dipole. `fieldAt` is the summed field, in the same
 * units the magnetism map and the fuzzy path use. Pulsar beams damage the hull
 * on sim time, so a predicted hit is the hit the flight takes. Neither the
 * map toggle nor the path spread changes the trajectory.
 * This module does not touch the DOM.
 */

import {
  ASTRO_CAPACITY,
  ASTRO_DV,
  ASTRO_HARVEST_RATE,
  curvePoint,
  harvestKnots,
  luminosityScale,
  petrovaCurve,
  spinCost,
  type KnotSite,
  type PetrovaLine,
} from "./astrophage";
import { beltDrift, pointInBelt, type Belt, type BeltRock } from "./belts";
import { blastHits, quasarDamage, shockCrosses, type QuasarJet, type Supernova } from "./events";
import {
  coverageFactor,
  dysonShellHit,
  elevatorAngle,
  elevatorFrame,
  frameAcceleration,
  jetContact,
  mirrorRadii,
  mirrorSegmentEntry,
  mouthName,
  RING_SAMPLES,
  ringHalfWidth,
  ringSample,
  ringSegmentEntry,
  rotateVelocity,
  tangentialVelocity,
  tetherSegmentEntry,
  type DysonSwarm,
  type Ringworld,
  type ShkadovThruster,
  type SpaceElevator,
  type StellarEngine,
  type WormholeMouth,
  type WormholePair,
} from "./mega";

export interface Vec2 {
  x: number;
  y: number;
}

export type BodyKind = "home" | "star" | "target" | "moon" | "blackhole" | "planet" | "rogue";

/**
 * Visual recipe for a body. Omitted looks use the kind's original disc.
 * Stars: `sun`, `binary-hot`, `binary-cool`, `white-dwarf`, `red-giant`.
 * Compact objects: `neutron`, `pulsar`, `magnetar`.
 * Planets and moons: `gas-giant`, `moon`, `moon-icy`, `moon-volcanic`, `dwarf`,
 * `rocky`, `ice`, `lava`, `toxic`, `cracked`.
 * A lone rock: `asteroid`. The look is visual; mass and radius still collide.
 * Sol campaign: `sol-sun` and the bodies in design/style.md §18.
 */
export const BODY_LOOKS = [
  "sun",
  "binary-hot",
  "binary-cool",
  "white-dwarf",
  "red-giant",
  "gas-giant",
  "moon",
  "moon-icy",
  "moon-volcanic",
  "dwarf",
  "rocky",
  "ice",
  "lava",
  "toxic",
  "cracked",
  "neutron",
  "pulsar",
  "magnetar",
  "comet",
  "asteroid",
  "tau-ceti",
  "tau-hot",
  "tau-cold",
  "tau-green",
  "sol-sun",
  "mercury",
  "venus",
  "earth",
  "luna",
  "mars",
  "jupiter",
  "saturn",
  "titan",
  "uranus",
  "neptune",
  "pluto",
  "charon",
  "eris",
  "arrokoth",
  "voyager",
] as const;

export type BodyLook = (typeof BODY_LOOKS)[number];

/**
 * Circular orbit, or a Kepler ellipse when `kind` is `"ellipse"`.
 * A circle at time t is the center plus
 * `radius * (cos(phase + omega t), sin(phase + omega t))`.
 * An ellipse solves `M = E − e sin E` and is fast at periapsis.
 * `centerId` orbits another body. Otherwise the center is fixed at `cx`, `cy`.
 */
export interface BodyOrbit {
  centerId?: string;
  cx?: number;
  cy?: number;
  /** Circle radius. For an ellipse this is the periapsis distance, unused by the solver. */
  radius: number;
  /** Radians at t = 0. On a circle, 0 sits on the center's +x side. On an ellipse this is the mean anomaly. */
  phase: number;
  /** Radians per second. Positive is counterclockwise. Unused by an ellipse. */
  omega: number;
  /** Omitted is the circular rail, bit for bit. */
  kind?: "ellipse";
  /** Semi-major axis of an ellipse. */
  a?: number;
  /** Eccentricity, from 0 up to but not including 1. */
  e?: number;
  /** Periapsis direction, radians from +x. */
  periapsisAngle?: number;
}

/** A fuel cloud. `scoop` is fuel per second at the centre. A dark cloud hides what is inside. */
export interface Nebula {
  id: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** Radians. 0 leaves `rx` along +x. */
  angle: number;
  scoop: number;
  look: "emission" | "reflection" | "dark";
}

/**
 * Dipole magnet. `b1Reach` is R1, the polar reach of the Fuzzy zone (|B| = B1).
 * `tilt` is the axis angle in radians, clockwise from +y. A pulsar sets
 * `averaged` so the map uses a circular, rotation-averaged magnitude.
 */
export interface Magnet {
  b1Reach: number;
  tilt: number;
  averaged?: boolean;
}

/**
 * Lighthouse beams in the plane of the system. They spin clockwise once per
 * `period` seconds of sim time, starting along the body's magnetic axis.
 * `base` and `tip` are the full width at the centre and at `reach`.
 * `damage` is hull per second inside a beam. Omitted or 0 draws the beam only.
 */
export interface Beam {
  reach: number;
  period: number;
  base?: number;
  tip?: number;
  damage?: number;
}

export interface Body {
  id: string;
  name: string;
  kind: BodyKind;
  /** Position at t = 0. Ignored while `orbit` is set, except as a fallback. */
  x: number;
  y: number;
  mass: number;
  /** Surface radius. Touching it crashes the ship. */
  radius: number;
  /**
   * Sphere of influence around the target. A captured orbit must keep its
   * apoapsis inside this radius. Entering and then leaving it unbound is a flyby.
   */
  captureRadius?: number;
  orbit?: BodyOrbit;
  /** Which sprite to draw. Omitted bodies keep the original look for their kind. */
  look?: BodyLook;
  /**
   * Soft atmosphere, world units from the centre. Drag from `dragStrength`
   * acts only inside this radius and outside the surface. Omitted means no drag.
   */
  atmosphereRadius?: number;
  /** Dipole field for the magnetism map and the fuzzy prediction. */
  magnet?: Magnet;
  /** Sweeping beams. Damage, when set, is applied in `step`. */
  beam?: Beam;
  /** Fuel per second harvested at the surface, falling off out to `harvestRadius`. */
  harvest?: number;
  /** Coma where ice can be harvested. Omitted or not past the surface harvests nothing. */
  harvestRadius?: number;
  /** Straight-line motion. Rogue planets use this and never an orbit. */
  drift?: { vx: number; vy: number };
  /**
   * Directed flare. `angle` is the cone axis in radians.
   * The cone is on while `(time % period)` is inside `[start, start + duration)`.
   */
  flare?: { angle: number; period: number; start: number; duration: number };
  /** Detonation and the remnant shock. Omitted stars never explode. */
  supernova?: Supernova;
  /** Bipolar jet. Omitted bodies have none. */
  quasar?: QuasarJet;
  /**
   * Scripted collision or consumption. The pose stays a function of sim time.
   * Omitted bodies keep their ordinary orbit or drift.
   */
  script?: BodyScript;
  /** Stellar engine. Omitted stars have no jet. */
  engine?: StellarEngine;
  /** Dyson swarm. Omitted stars are uncovered. */
  dyson?: DysonSwarm;
  /** Shkadov thruster. Omitted bodies do not drift the frame. */
  shkadov?: ShkadovThruster;
  /** Ringworld. Omitted bodies have no ring. The band is solid except at its gaps. */
  ring?: Ringworld;
  /** Space elevator. Omitted planets have no tether. */
  elevator?: SpaceElevator;
  /**
   * Astrophage infection. Omitted stars are clean: full luminosity, no cells.
   * `dims` multiplies this star's solar recharge and its radiation term.
   */
  astrophage?: { level: number; dims: number };
  /**
   * When false, the body is drawn and may move, but it never crashes the ship
   * and never blocks starlight. Omitted means solid. Voyager is never solid.
   */
  solid?: boolean;
}

/** Props such as Voyager are drawn at `radius` and do not collide. */
export function bodySolid(body: Body): boolean {
  if (body.look === "voyager" || body.solid === false) return false;
  return true;
}

/**
 * `consume` falls from the body's orbit into `centerId` and is gone at `end`.
 * `impact` removes the body at `at`. `into` names what it hits, for the impact drawing.
 */
export type BodyScript =
  | { kind: "consume"; centerId: string; start: number; end: number; radius: number }
  | { kind: "impact"; at: number; into?: string };

/** World position and velocity of one body at an instant. */
export interface Pose {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * How far `predictPlan` draws the coast. Live flight ignores this and runs
 * until the ship wins, crashes, or is lost.
 *
 * The look-ahead is `seconds`, optionally capped at one period of the
 * dominant body, then shortened by local gravity:
 * `factor = 1 / (1 + shorten * |a| / ref)`.
 */
export interface Horizon {
  seconds: number;
  oneOrbit: boolean;
  /** 0 leaves the horizon at its full length. */
  shorten: number;
  /** Acceleration (world units / s²) that sets the shorten scale. */
  ref: number;
}

export interface SimConfig {
  g: number;
  /** Fixed integration step. Never scaled by sim speed. */
  dt: number;
  bodies: readonly Body[];
  bounds: Bounds;
  maxSteps: number;
  targetId: string;
  /** Captured periapsis must clear the surface by this much. */
  periapsisMargin: number;
  /**
   * Lowered speed of light, in world units per second. Per level.
   * Time dilation uses this; it does not change the Newtonian motion.
   */
  c: number;
  /** When set, `predictPlan` stops at this look-ahead. Flight does not. */
  horizon?: Horizon;
  /**
   * Multiplier on `g`. Omitted or 1 keeps `g` as authored, bit for bit.
   * Motion, capture, and the horizon period all use `gravityConstant`.
   */
  gravityScale?: number;
  /** Softening length. Omitted or 0 is a point mass. */
  eps?: number;
  /**
   * Falloff exponent near 2. Omitted or 2 is inverse-square.
   * `|a| = G M / (r² + ε²)^(p/2)`.
   */
  p?: number;
  /** Scales `2Φ/c²` and `v²/c²`. Omitted or 1 is the standard dilation. */
  dilationStrength?: number;
  /**
   * Maximum slowdown. Omitted or non-finite: the rate may reach 0.
   * A finite value `>= 1` smoothly keeps `dτ/dt` above `1 / dilationCap`.
   */
  dilationCap?: number;
  /** Hull damage per second near a white dwarf, neutron star or black hole. Omitted or 0 deals none. */
  tidalStrength?: number;
  /**
   * Scales drag inside a body's `atmosphereRadius`. Omitted or 0 leaves
   * velocity untouched, so stock levels stay bit-identical. The force is
   * opposite the ship's velocity relative to the body, so it only slows
   * that relative motion. Prediction and flight both apply it in `step`.
   */
  dragStrength?: number;
  /** 1 is today's ship. Above 1, the same burn changes velocity less. */
  shipMass?: number;
  /** Multiplies burn delta-v before mass. Omitted or 1 is today's burn. */
  engineScale?: number;
  /** Starting hull. Omitted is 100. */
  hullMax?: number;
  /** Fuel per second at a star's surface. Omitted or 0 is no recharge. */
  solarStrength?: number;
  /** Tank the ship launches with. */
  fuelStart?: number;
  /** Tank ceiling after upgrades. */
  fuelMax?: number;
  /** Fuel spent per unit of commanded delta-v. Already includes ship mass. */
  fuelPerDv?: number;
  /** Fuel clouds. Omitted leaves scoop at 0, so stock levels stay bit-identical. */
  nebulae?: readonly Nebula[];
  /** mSv added per second per unit of dose rate D. Omitted or 0 leaves dose at 0. */
  dosePerD1?: number;
  /** Crew dose that fails the mission. Omitted means dose never fails a flight. */
  doseLimit?: number;
  /** Multiplier on crew dose and on belt dust damage. 1 is unshielded. Shielding uses 0.5. */
  shield?: number;
  /** Asteroid and Kuiper belts. Omitted leaves rock collision and dust damage off. */
  belts?: readonly Belt[];
  /** Rocks from `placeBelts`. Omitted with `belts`. */
  beltRocks?: readonly BeltRock[];
  /** Wormhole pairs. Omitted leaves transit off. */
  wormholes?: readonly WormholePair[];
  /**
   * Spin drive. Omitted keeps today's chemical tank. `"spin"` spends the
   * Astrophage tank instead of `tank` when a burn fires.
   */
  engine?: "chemical" | "ion" | "pulse" | "spin";
  /** Gas scoop fitted. Knots only refill the Astrophage tank when this is set. */
  scoop?: boolean;
  /** Astrophage tank size. Omitted is 1 when a spin drive is fitted. */
  astroCapacity?: number;
  /** Astrophage in the tank at launch. */
  astroStart?: number;
  /** Fraction of the tank per second inside a knot. Omitted is the design 0.024. */
  astroRate?: number;
  /** Δv a full tank can buy. Cost of a burn is `|dv| / astroDv`. */
  astroDv?: number;
  /** Petrova lines. Omitted levels have none. */
  petrova?: readonly PetrovaLine[];
  /** Starting fuel in each knot, same order as `flattenKnots`. */
  knotFuel?: readonly number[];
}

/** How many times a flight may freeze so the player can edit burns. */
export type PauseRule =
  | { kind: "unlimited" }
  | { kind: "free"; count: number }
  | { kind: "score"; cost: number; budget: number };

export interface PauseBudget {
  used: number;
  score: number;
}

export type FlightStatus = "flying" | "won" | "crashed" | "lost";

export type LostReason = "bounds" | "timeout" | "flyby" | "hull" | "dose" | "nova" | "burned";

/** What the dose meter names as the strongest source at a point. */
export type DoseSource = "star" | "flare" | "belt" | "pulsar" | "disk" | "cosmic" | "shadow";

export interface SimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  step: number;
  status: FlightStatus;
  crashedBodyId: string | null;
  lostReason: LostReason | null;
  /** True once the trajectory has touched the target's capture sphere. */
  enteredCapture: boolean;
  /** Outside time in seconds. Home and Planet X share this frame. */
  t: number;
  /** Ship proper time in seconds. */
  tau: number;
  /** dτ/dt at the current pose. 1 is flat space at rest. 0 is a horizon. */
  rate: number;
  /** Hull points left. 0 ends the flight. */
  hull: number;
  /** Hull the ship started with. */
  hullMax: number;
  /** Hull damage per second from tides and close passes, this step. */
  stress: number;
  /** Highest stress so far. Planning uses this for the warning. */
  peakStress: number;
  /** Fuel in the tank, after burns and solar recharge. */
  tank: number;
  /** Fuel added by solar recharge. */
  recharged: number;
  /** Accumulated crew dose in mSv. */
  dose: number;
  /** Crew dose rate in mSv per second, after shielding. */
  doseRate: number;
  doseSource: DoseSource;
  /**
   * Mouth or counterweight the ship is still inside after a transit or a throw.
   * Stops that contact from firing again until the ship has left it.
   */
  transit: string | null;
  /** Astrophage in the spin tank. 0 on a ship with no spin drive. */
  astro: number;
  /** Astrophage scooped this flight. Burns do not reduce it. The planning ghost reads it. */
  astroGained: number;
  /** Astrophage spent on spin burns. */
  astroSpent: number;
  /** Fraction of the tank per second being scooped this step. 0 when the scoop is idle. */
  astroRate: number;
  /** Fuel still in each Petrova knot. Empty when the level has no knots. */
  knots: number[];
}

/** One impulsive burn at an exact sim step. Nodes are ordered by `step`. */
export interface BurnNode {
  /** Applied when `state.step` equals this, before that step integrates. 0 is launch. */
  step: number;
  dvx: number;
  dvy: number;
}

export interface PathSample {
  x: number;
  y: number;
  /** Sim step that produced this position. */
  step: number;
  /** dτ/dt at this sample. The planning line tints by it. */
  rate: number;
}

export interface Prediction {
  /** Position after each fixed step, not including the pre-step pose. */
  path: PathSample[];
  status: FlightStatus;
  crashedBodyId: string | null;
  lostReason: LostReason | null;
  steps: number;
  /** Closed orbit around the target when the flight ends captured. */
  orbit: Vec2[] | null;
  /** Outside time at the end of this run. Same frame as `shipTime`. */
  outsideTime: number;
  /** Ship proper time at the end of this run. */
  shipTime: number;
}

/** Cached coast into one node. Reused when a later node is the one being edited. */
export interface NodeSnapshot {
  step: number;
  dvx: number;
  dvy: number;
  /** State at `step` before this burn. */
  before: SimState;
  /** State at `step` after this burn. May already be won. */
  after: SimState;
  /**
   * Samples after the previous node through this node's step, inclusive.
   * Empty for a node at the same step as the state it starts from (launch).
   */
  approach: PathSample[];
  /** False when the flight ended before this step. */
  reached: boolean;
}

export interface PlanForecast extends Prediction {
  snapshots: NodeSnapshot[];
  /** Samples after the last reached node until the flight ends. */
  tail: PathSample[];
  final: SimState;
}

export interface PlanReuse {
  snapshots: readonly NodeSnapshot[];
  /** First node index to recompute. Earlier snapshots are kept. */
  from: number;
  /**
   * "burn" — only this node's delta-v changed. Keep its approach and pre-burn state.
   * "coast" — the step changed, or nodes were inserted or deleted. Resimulate from the previous node.
   */
  kind: "burn" | "coast";
}

export const SIM_SPEEDS = [1, 2, 4, 8, 16, 32] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

/**
 * Keyboard shortcuts for `SIM_SPEEDS`. 1, 2, 4 and 8 are the multiplier.
 * Comma and period are 16× and 32×. R, G, M and D stay on reset, gravity,
 * magnetism and radiation.
 */
export const SPEED_KEY: Readonly<Record<string, SimSpeed>> = {
  "1": 1,
  "2": 2,
  "4": 4,
  "8": 8,
  ",": 16,
  ".": 32,
};

/** Fixed steps to run for one rendered frame at the given sim speed. `dt` is not scaled. */
export function stepsPerFrame(speed: SimSpeed): number {
  return speed;
}

/** Rendered frames per one fixed step while slow motion is on. */
export const SLOW_MOTION_FRAMES = 2;

/**
 * Steps to integrate this rendered frame. Slow motion emits one step every
 * `SLOW_MOTION_FRAMES` frames and leaves `dt` alone. `phase` is the number of
 * slow frames already accumulated toward the next step.
 */
export function frameStepCount(
  speed: SimSpeed,
  slow: boolean,
  phase: number,
): { steps: number; phase: number } {
  if (!slow) return { steps: stepsPerFrame(speed), phase: 0 };
  const next = phase + 1;
  if (next >= SLOW_MOTION_FRAMES) return { steps: 1, phase: 0 };
  return { steps: 0, phase: next };
}

export function canSpendPause(rule: PauseRule, budget: PauseBudget): boolean {
  if (rule.kind === "unlimited") return true;
  if (rule.kind === "free") return budget.used < rule.count;
  return budget.score + 1e-9 >= rule.cost;
}

/** The budget after one pause, or null when the rule refuses it. */
export function spendPause(rule: PauseRule, budget: PauseBudget): PauseBudget | null {
  if (!canSpendPause(rule, budget)) return null;
  if (rule.kind === "free") return { used: budget.used + 1, score: budget.score };
  if (rule.kind === "score") return { used: budget.used + 1, score: budget.score - rule.cost };
  return { used: budget.used, score: budget.score };
}

export function cloneState(state: SimState): SimState {
  return { ...state, knots: state.knots.slice() };
}

function findBody(bodies: readonly Body[], id: string): Body | undefined {
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === id) return bodies[i];
  }
  return undefined;
}

/**
 * Analytic pose at `time` seconds. Static bodies return their fixed point and
 * zero velocity. Nested orbits resolve the center at the same time.
 * `g` is only read by an ellipse. Circles ignore it, so a call without `g`
 * stays on today's rail.
 */
/** False after a scripted impact or after a body has been consumed. */
export function bodyPresent(body: Body, time: number): boolean {
  const script = body.script;
  if (!script) return true;
  if (script.kind === "consume") return time < script.end;
  return time < script.at;
}

export function bodyPose(body: Body, time: number, bodies: readonly Body[], g = 1): Pose {
  return withFrame(poseAt(body, time, bodies, g), bodies, time);
}

/**
 * Pose before the Shkadov frame drift. Orbit centres resolve through this, so
 * a moon is not drifted twice: the frame is added once, on the way out.
 */
function poseAt(body: Body, time: number, bodies: readonly Body[], g: number): Pose {
  if (body.script?.kind === "consume") return consumePose(body, time, bodies, g);
  if (body.script?.kind === "impact" && time >= body.script.at) {
    return poseAt({ ...body, script: undefined }, body.script.at, bodies, g);
  }
  if (body.drift && !body.orbit) {
    return {
      x: body.x + body.drift.vx * time,
      y: body.y + body.drift.vy * time,
      vx: body.drift.vx,
      vy: body.drift.vy,
    };
  }
  if (!body.orbit) return { x: body.x, y: body.y, vx: 0, vy: 0 };
  return poseFromOrbit(body, time, bodies, 0, g);
}

/** Constant acceleration toward the mirror, the same vector on every body. */
function withFrame(pose: Pose, bodies: readonly Body[], time: number): Pose {
  if (time === 0) return pose;
  const frame = frameAcceleration(bodies);
  if (!frame) return pose;
  return {
    x: pose.x + 0.5 * frame.ax * time * time,
    y: pose.y + 0.5 * frame.ay * time * time,
    vx: pose.vx + frame.ax * time,
    vy: pose.vy + frame.ay * time,
  };
}

/** Fall from the orbit into the center. After `end` the pose stays on the surface. */
function consumePose(body: Body, time: number, bodies: readonly Body[], g: number): Pose {
  const script = body.script;
  const orbit = body.orbit;
  if (!script || script.kind !== "consume" || !orbit) return { x: body.x, y: body.y, vx: 0, vy: 0 };
  if (time < script.start) return poseFromOrbit(body, time, bodies, 0, g);
  const end = script.end;
  const clamped = time > end ? end : time;
  const centerBody = findBody(bodies, script.centerId);
  const center = centerBody
    ? poseAt(centerBody, clamped, bodies, g)
    : { x: orbit.cx ?? 0, y: orbit.cy ?? 0, vx: 0, vy: 0 };
  const r0 = orbit.radius;
  const r1 = script.radius;
  const span = end - script.start;
  const u = span > 0 ? (clamped - script.start) / span : 1;
  const radius = r0 + (r1 - r0) * u;
  const k = span > 0 ? (r1 - r0) / span : 0;
  const mu = g * (centerBody?.mass ?? 0);
  const phase = orbit.phase;
  let theta = phase + orbit.omega * clamped;
  let omega = orbit.omega;
  if (mu > 0 && r0 > 0 && radius > 0) {
    const omega0 = Math.sqrt(mu / (r0 * r0 * r0));
    const extra = Math.abs(k) > 1e-12 ? (2 / k) * (1 / Math.sqrt(r0) - 1 / Math.sqrt(radius)) : 0;
    theta = phase + omega0 * script.start + Math.sqrt(mu) * extra;
    omega = Math.sqrt(mu / (radius * radius * radius));
  }
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const radial = clamped >= end ? 0 : k;
  return {
    x: center.x + radius * c,
    y: center.y + radius * s,
    vx: center.vx + radial * c - radius * omega * s,
    vy: center.vy + radial * s + radius * omega * c,
  };
}

/**
 * Newton steps on `M = E − e sin E`. Six steps are enough below e 0.8.
 * A fatter ellipse takes more, so the same anomaly still lands on the same point.
 */
function solveKepler(meanAnomaly: number, eccentricity: number): number {
  const turn = Math.PI * 2;
  let mean = meanAnomaly % turn;
  if (mean > Math.PI) mean -= turn;
  if (mean < -Math.PI) mean += turn;
  let eccentric = eccentricity < 0.8 ? mean : Math.PI * Math.sign(mean);
  const steps = eccentricity >= 0.8 ? 15 : 6;
  for (let i = 0; i < steps; i++) {
    const residual = eccentric - eccentricity * Math.sin(eccentric) - mean;
    const slope = 1 - eccentricity * Math.cos(eccentric);
    if (slope === 0) break;
    eccentric -= residual / slope;
  }
  return eccentric;
}

/** `ω = √(GM / r³)` for a circular orbit about a mass. */
export function keplerMeanMotion(g: number, mass: number, radius: number): number {
  if (!(g > 0) || !(mass > 0) || !(radius > 0)) return 0;
  return Math.sqrt((g * mass) / (radius * radius * radius));
}

function poseFromOrbit(body: Body, time: number, bodies: readonly Body[], depth: number, g: number): Pose {
  const orbit = body.orbit;
  if (!orbit || depth > 4) return { x: body.x, y: body.y, vx: 0, vy: 0 };
  let cx = orbit.cx ?? 0;
  let cy = orbit.cy ?? 0;
  let cvx = 0;
  let cvy = 0;
  let centerMass = 0;
  if (orbit.centerId) {
    const center = findBody(bodies, orbit.centerId);
    if (center) {
      const pose = center.orbit ? poseFromOrbit(center, time, bodies, depth + 1, g) : { x: center.x, y: center.y, vx: 0, vy: 0 };
      cx = pose.x;
      cy = pose.y;
      cvx = pose.vx;
      cvy = pose.vy;
      centerMass = center.mass;
    }
  }
  if (orbit.kind === "ellipse") {
    const a = orbit.a ?? orbit.radius;
    const eccentricity = orbit.e ?? 0;
    const mu = g * centerMass;
    // A stored mean motion wins, so a caller that omits `g` still matches the level.
    const meanMotion = orbit.omega !== 0 ? orbit.omega : mu > 0 && a > 0 ? Math.sqrt(mu / (a * a * a)) : 0;
    const eccentric = solveKepler(orbit.phase + meanMotion * time, eccentricity);
    const cosE = Math.cos(eccentric);
    const sinE = Math.sin(eccentric);
    const denom = 1 - eccentricity * cosE;
    const semiMinor = Math.sqrt(Math.max(0, 1 - eccentricity * eccentricity));
    const xLocal = a * (cosE - eccentricity);
    const yLocal = a * semiMinor * sinE;
    const vxLocal = denom !== 0 ? (-a * meanMotion * sinE) / denom : 0;
    const vyLocal = denom !== 0 ? (a * meanMotion * semiMinor * cosE) / denom : 0;
    const turn = orbit.periapsisAngle ?? 0;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return {
      x: cx + xLocal * cos - yLocal * sin,
      y: cy + xLocal * sin + yLocal * cos,
      vx: cvx + vxLocal * cos - vyLocal * sin,
      vy: cvy + vxLocal * sin + vyLocal * cos,
    };
  }
  const angle = orbit.phase + orbit.omega * time;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cx + orbit.radius * cos,
    y: cy + orbit.radius * sin,
    vx: cvx - orbit.radius * orbit.omega * sin,
    vy: cvy + orbit.radius * orbit.omega * cos,
  };
}

/**
 * G actually integrated. Omitted `gravityScale`, or a scale of exactly 1,
 * returns `config.g` so the stock arithmetic does not change.
 */
export function gravityConstant(config: SimConfig): number {
  const scale = config.gravityScale;
  if (scale === undefined || scale === 1) return config.g;
  return config.g * scale;
}

function bodyPoint(body: Body, time: number, bodies: readonly Body[], g: number): { x: number; y: number } {
  const pose = bodyPose(body, time, bodies, g);
  return { x: pose.x, y: pose.y };
}

/** Inverse-square acceleration. The operations match the pre-knob integrator. */
function newtonAcceleration(
  x: number,
  y: number,
  g: number,
  config: SimConfig,
  time: number,
): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!bodyPresent(body, time)) continue;
    const point = bodyPoint(body, time, bodies, g);
    const dx = point.x - x;
    const dy = point.y - y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-12) continue;
    const invR = 1 / Math.sqrt(r2);
    const scale = g * body.mass * invR * invR * invR;
    ax += dx * scale;
    ay += dy * scale;
  }
  return { ax, ay };
}

/**
 * |a| = G M / (r² + ε²)^(p/2), aimed along the separation.
 * At the exact centre the direction is undefined and the contribution is 0.
 */
function shapedAcceleration(
  x: number,
  y: number,
  g: number,
  eps: number,
  p: number,
  config: SimConfig,
  time: number,
): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  const bodies = config.bodies;
  const eps2 = eps * eps;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!bodyPresent(body, time)) continue;
    const point = bodyPoint(body, time, bodies, g);
    const dx = point.x - x;
    const dy = point.y - y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-12 && eps === 0) continue;
    const r = Math.sqrt(r2);
    if (!(r > 0)) continue;
    const scale = (g * body.mass) / (r * Math.pow(r2 + eps2, p / 2));
    ax += dx * scale;
    ay += dy * scale;
  }
  return { ax, ay };
}

export function acceleration(
  x: number,
  y: number,
  config: SimConfig,
  time = 0,
): { ax: number; ay: number } {
  const g = gravityConstant(config);
  const eps = config.eps ?? 0;
  const p = config.p ?? 2;
  const grav = eps === 0 && p === 2 ? newtonAcceleration(x, y, g, config, time) : shapedAcceleration(x, y, g, eps, p, config, time);
  const push = enginePush(x, y, config, time);
  const ring = ringForce(x, y, g, eps, p, config, time);
  if (!push && !ring) return grav;
  return {
    ax: grav.ax + (ring ? ring.ax : 0) + (push ? push.ax : 0),
    ay: grav.ay + (ring ? ring.ay : 0) + (push ? push.ay : 0),
  };
}

/** Acceleration along a stellar-engine plume. Null when the ship is outside every jet. */
function enginePush(x: number, y: number, config: SimConfig, time: number): { ax: number; ay: number } | null {
  const bodies = config.bodies;
  const g = gravityConstant(config);
  let ax = 0;
  let ay = 0;
  let any = false;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const engine = body.engine;
    if (!engine || !(engine.push > 0) || !bodyPresent(body, time)) continue;
    const pose = bodyPose(body, time, bodies, g);
    const contact = jetContact(x - pose.x, y - pose.y, body.radius, engine.angle);
    if (!contact?.plume) continue;
    any = true;
    ax += Math.cos(engine.angle) * engine.push;
    ay += Math.sin(engine.angle) * engine.push;
  }
  return any ? { ax, ay } : null;
}

/**
 * Pull of a uniform ring, softened by the band's half-width so a transit
 * gap stays finite. Samples are the same points the renderer spaces around
 * the circle. No ring mass returns null, and stock levels stay bit-identical.
 * At the centre the samples cancel. Inside the ring the pull is outward.
 */
function ringForce(
  x: number,
  y: number,
  g: number,
  eps: number,
  p: number,
  config: SimConfig,
  time: number,
): { ax: number; ay: number } | null {
  let ax = 0;
  let ay = 0;
  let any = false;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const ring = body.ring;
    if (!ring || !(ring.mass > 0) || !bodyPresent(body, time)) continue;
    any = true;
    const origin = bodyPoint(body, time, bodies, g);
    const soft = Math.hypot(eps, ringHalfWidth(body.radius));
    const soft2 = soft * soft;
    const share = ring.mass / RING_SAMPLES;
    for (let k = 0; k < RING_SAMPLES; k++) {
      const sample = ringSample(body.radius, k);
      const dx = origin.x + sample.x - x;
      const dy = origin.y + sample.y - y;
      const r2 = dx * dx + dy * dy;
      const r = Math.sqrt(r2);
      if (!(r > 0)) continue;
      const scale = (g * share) / (r * Math.pow(r2 + soft2, p / 2));
      ax += dx * scale;
      ay += dy * scale;
    }
  }
  return any ? { ax, ay } : null;
}

function ringDepth(x: number, y: number, g: number, eps: number, p: number, config: SimConfig, time: number): number {
  let depth = 0;
  let any = false;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const ring = body.ring;
    if (!ring || !(ring.mass > 0) || !bodyPresent(body, time)) continue;
    any = true;
    const origin = bodyPoint(body, time, bodies, g);
    const soft = Math.hypot(eps, ringHalfWidth(body.radius));
    const share = ring.mass / RING_SAMPLES;
    for (let k = 0; k < RING_SAMPLES; k++) {
      const sample = ringSample(body.radius, k);
      const dx = origin.x + sample.x - x;
      const dy = origin.y + sample.y - y;
      depth += g * share * depthPerMu(Math.hypot(dx, dy), soft, p);
    }
  }
  return any ? depth : 0;
}

/** Σ G M / r. Same operations as the pre-knob potential. */
function newtonPotential(x: number, y: number, g: number, config: SimConfig, time: number): number {
  let phi = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!bodyPresent(body, time)) continue;
    const point = bodyPoint(body, time, bodies, g);
    const dx = point.x - x;
    const dy = point.y - y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-12) return Number.POSITIVE_INFINITY;
    phi += (g * body.mass) / Math.sqrt(r2);
  }
  return phi;
}

/**
 * Φ / (G M) for one body, the integral from r to infinity of
 * (s² + ε²)^(-p/2). p = 2 and ε = 0 is 1/r, handled by `newtonPotential`.
 */
function depthPerMu(r: number, eps: number, p: number): number {
  if (!(r > 0)) return eps > 0 ? depthAtCenter(eps, p) : Number.POSITIVE_INFINITY;
  if (eps === 0) {
    if (p === 2) return 1 / r;
    return 1 / ((p - 1) * Math.pow(r, p - 1));
  }
  if (p === 2) return Math.atan2(eps, r) / eps;
  if (r <= eps) return depthAtCenter(eps, p) - integralZeroToR(r, eps, p);
  return hypergeometricDepth(r, eps, p);
}

/** ∫_0^∞ (u²+ε²)^(-p/2) du. */
function depthAtCenter(eps: number, p: number): number {
  if (p === 2) return Math.PI / (2 * eps);
  return Math.pow(eps, 1 - p) * 0.5 * Math.sqrt(Math.PI) * gamma((p - 1) / 2) / gamma(p / 2);
}

/** ∫_0^r (u²+ε²)^(-p/2) du for r ≤ ε, via the binomial series in (r/ε)². */
function integralZeroToR(r: number, eps: number, p: number): number {
  const alpha = -p / 2;
  const s = r / eps;
  const s2 = s * s;
  let binom = 1;
  let power = s;
  let sum = s;
  for (let k = 1; k < 80; k++) {
    binom *= (alpha - (k - 1)) / k;
    power *= s2;
    const term = (binom * power) / (2 * k + 1);
    sum += term;
    if (Math.abs(term) <= 1e-16 * Math.abs(sum)) break;
  }
  return Math.pow(eps, 1 - p) * sum;
}

/**
 * ∫_r^∞ (u²+ε²)^(-p/2) du for r > ε.
 * Equals 1 / ((p-1) ρ^(p-1)) · ₂F₁((p-1)/2, 1/2; (p+1)/2; ε²/ρ²).
 */
function hypergeometricDepth(r: number, eps: number, p: number): number {
  const r2 = r * r;
  const z = (eps * eps) / (r2 + eps * eps);
  const b = (p - 1) / 2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n < 80; n++) {
    term *= ((b + n - 1) / (b + n)) * ((n - 0.5) / n) * z;
    sum += term;
    if (Math.abs(term) <= 1e-16 * Math.abs(sum)) break;
  }
  const rho = Math.sqrt(r2 + eps * eps);
  return sum / ((p - 1) * Math.pow(rho, p - 1));
}

/** Lanczos Γ(z) for z > 0. Coefficients are the g = 7, n = 9 set. */
function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = 0.99999999999980993;
  const c = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  for (let i = 0; i < c.length; i++) x += c[i] / (z + i + 1);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function shapedPotential(x: number, y: number, g: number, eps: number, p: number, config: SimConfig, time: number): number {
  let phi = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!bodyPresent(body, time)) continue;
    const point = bodyPoint(body, time, bodies, g);
    const dx = point.x - x;
    const dy = point.y - y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-12 && eps === 0) return Number.POSITIVE_INFINITY;
    phi += g * body.mass * depthPerMu(Math.sqrt(r2), eps, p);
  }
  return phi;
}

/**
 * Positive gravitational potential depth.
 * Default (ε = 0, p = 2): Σ G M / r. A black hole's horizon is r_s = 2GM/c²,
 * so Φ_depth = c²/2 there. Other knobs use the integral of the shaped force.
 */
export function potentialDepth(x: number, y: number, config: SimConfig, time = 0): number {
  const g = gravityConstant(config);
  const eps = config.eps ?? 0;
  const p = config.p ?? 2;
  const base = eps === 0 && p === 2 ? newtonPotential(x, y, g, config, time) : shapedPotential(x, y, g, eps, p, config, time);
  const extra = ringDepth(x, y, g, eps, p, config, time);
  if (extra === 0) return base;
  return base + extra;
}

/** Schwarzschild radius 2GM/c². A black hole body uses this as its surface. */
export function horizonRadius(mass: number, g: number, c: number): number {
  if (!(c > 0)) return Number.POSITIVE_INFINITY;
  return (2 * g * mass) / (c * c);
}

/**
 * Weak-field combined time dilation.
 *
 * bare = 1 - strength · (2 Φ_depth / c² + v² / c²)
 * dτ/dt = sqrt(max(bare, 0)) when `dilationCap` is omitted.
 *
 * That default is the old hard clamp: 0 at a horizon or at v ≥ c, and never
 * above 1 when strength is 1. A finite cap saturates smoothly toward 1/cap
 * instead of hitting 0. `strength` defaults to 1, which keeps the subtraction
 * in the same order as the original formula.
 */
export function properTimeRate(
  x: number,
  y: number,
  vx: number,
  vy: number,
  config: SimConfig,
  time = 0,
): number {
  return rateFrom(
    potentialDepth(x, y, config, time),
    vx,
    vy,
    config.c,
    config.dilationStrength ?? 1,
    config.dilationCap ?? Number.POSITIVE_INFINITY,
  );
}

/**
 * dτ/dt from a depth and a velocity.
 * `strength` scales both dilation terms. `cap` is the max slowdown; a
 * non-finite cap (the default) is the hard floor at 0.
 */
export function rateFrom(
  phi: number,
  vx: number,
  vy: number,
  c: number,
  strength = 1,
  cap = Number.POSITIVE_INFINITY,
): number {
  if (!(c > 0) || !Number.isFinite(c)) return 0;
  const capped = cap >= 1 && Number.isFinite(cap);
  if (!Number.isFinite(phi)) return capped ? saturateBare(Number.NEGATIVE_INFINITY, cap) : 0;
  if (!(strength >= 0) || !Number.isFinite(strength)) return capped ? saturateBare(Number.NEGATIVE_INFINITY, cap) : 0;
  const depth = phi > 0 ? phi : 0;
  const c2 = c * c;
  const gravitational = (2 * depth) / c2;
  const kinetic = (vx * vx + vy * vy) / c2;
  // strength === 1 keeps `1 - a - b`, which is the original expression.
  const bare = strength === 1 ? 1 - gravitational - kinetic : 1 - strength * (gravitational + kinetic);
  if (!capped) {
    if (!(bare > 0)) return 0;
    return Math.sqrt(bare);
  }
  return saturateBare(bare, cap);
}

/**
 * Smooth floor on the dilation radicand.
 *
 * Let f = 1/cap and lo = f². The knee is min(1, 4 lo), so mild dilation
 * (radicand at or above the knee) stays on sqrt(bare) exactly. Below the
 * knee a hyperbola is tangent to y = bare at the knee and asymptotes to lo:
 *
 *   rad = lo + (knee - lo)² / ((knee - lo) + (knee - bare))
 *
 * The value and the first derivative match at the knee, so the rate never
 * jumps. It is strictly above 1/cap and strictly increasing in `bare`.
 */
function saturateBare(bare: number, cap: number): number {
  const floor = 1 / cap;
  const lo = floor * floor;
  const knee = lo * 4 < 1 ? lo * 4 : 1;
  if (bare >= knee) return Math.sqrt(bare);
  const span = knee - lo;
  const rad = lo + (span * span) / (span + (knee - bare));
  return Math.sqrt(rad);
}

function accrueClocks(state: SimState, rate: number, dt: number): void {
  state.t += dt;
  state.tau += rate * dt;
}

export function makeState(
  x: number,
  y: number,
  vx: number,
  vy: number,
  config: SimConfig,
): SimState {
  const a = acceleration(x, y, config);
  return {
    x,
    y,
    vx,
    vy,
    ax: a.ax,
    ay: a.ay,
    step: 0,
    status: "flying",
    crashedBodyId: null,
    lostReason: null,
    enteredCapture: false,
    t: 0,
    tau: 0,
    rate: properTimeRate(x, y, vx, vy, config, 0),
    hull: config.hullMax ?? 100,
    hullMax: config.hullMax ?? 100,
    stress: 0,
    peakStress: 0,
    tank: config.fuelStart ?? 0,
    recharged: 0,
    dose: 0,
    doseRate: 0,
    doseSource: "cosmic",
    transit: null,
    astro: config.astroStart ?? 0,
    astroGained: 0,
    astroSpent: 0,
    astroRate: 0,
    knots: config.knotFuel ? config.knotFuel.slice() : [],
  };
}

export function fuelCost(dvx: number, dvy: number, fuelPerDv: number): number {
  return fuelPerDv * Math.hypot(dvx, dvy);
}

export interface NodeCost {
  cost: number;
  /** Fuel still available before this node fires. */
  remainingBefore: number;
  /** This burn is larger than the fuel remaining when the ship reaches it. */
  exceeds: boolean;
}

export interface PlanFuel {
  costs: NodeCost[];
  total: number;
  /** Budget minus the sum of every node. Negative when the plan is over budget. */
  left: number;
  affordable: boolean;
}

/** Fuel for a whole plan. Costs accumulate in node order. */
export function assessPlan(nodes: readonly BurnNode[], fuel: number, fuelPerDv: number): PlanFuel {
  const costs: NodeCost[] = [];
  let spent = 0;
  let affordable = true;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const cost = fuelCost(node.dvx, node.dvy, fuelPerDv);
    const remainingBefore = fuel - spent;
    const exceeds = cost > remainingBefore + 1e-9;
    if (exceeds) affordable = false;
    costs.push({ cost, remainingBefore, exceeds });
    spent += cost;
  }
  return { costs, total: spent, left: fuel - spent, affordable };
}

export type ImpulseResult =
  | { ok: true; cost: number; fuel: number }
  | { ok: false; cost: number };

/**
 * Add a single impulsive delta-v. Cost is proportional to its magnitude.
 * Mutates `state` only when the burn fits in the remaining fuel.
 */
export function tryApplyImpulse(
  state: SimState,
  dvx: number,
  dvy: number,
  fuel: number,
  fuelPerDv: number,
): ImpulseResult {
  const cost = fuelCost(dvx, dvy, fuelPerDv);
  if (cost > fuel + 1e-9) return { ok: false, cost };
  state.vx += dvx;
  state.vy += dvy;
  return { ok: true, cost, fuel: fuel - cost };
}

/** First time t in [0, 1] when the segment enters the circle. */
function circleEntry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  radius: number,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  if (a === 0) return null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t >= -1e-9 && t <= 1) return Math.max(0, t);
  return null;
}

/** Earliest hit against a body that moves linearly between its poses at t0 and t1. */
function movingCircleEntry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  body: Body,
  t0: number,
  t1: number,
  bodies: readonly Body[],
  radius: number,
): number | null {
  const p0 = bodyPose(body, t0, bodies);
  const p1 = bodyPose(body, t1, bodies);
  return circleEntry(x0 - p0.x, y0 - p0.y, x1 - p1.x, y1 - p1.y, 0, 0, radius);
}

interface RelativePose {
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  cx: number;
  cy: number;
}

/** Ship position and velocity relative to a body. Static bodies keep the absolute velocity. */
function relativePose(state: SimState, body: Body, time: number, bodies?: readonly Body[]): RelativePose {
  if (!body.orbit && !body.drift) {
    return { rx: state.x - body.x, ry: state.y - body.y, vx: state.vx, vy: state.vy, cx: body.x, cy: body.y };
  }
  const pose = bodyPose(body, time, bodies ?? []);
  return {
    rx: state.x - pose.x,
    ry: state.y - pose.y,
    vx: state.vx - pose.vx,
    vy: state.vy - pose.vy,
    cx: pose.x,
    cy: pose.y,
  };
}

export interface OrbitElements {
  bound: boolean;
  energy: number;
  periapsis: number;
  apoapsis: number;
  eccentricity: number;
}

/**
 * Two-body elements relative to one body. A moving body uses the ship's
 * velocity minus the body's analytic velocity at `time`.
 */
export function orbitAbout(
  state: SimState,
  body: Body,
  g: number,
  time = 0,
  bodies?: readonly Body[],
): OrbitElements | null {
  const pose = relativePose(state, body, time, bodies);
  const rx = pose.rx;
  const ry = pose.ry;
  const r = Math.hypot(rx, ry);
  if (r < 1e-8) return null;
  const mu = g * body.mass;
  if (mu <= 0) return null;
  const energy = (pose.vx * pose.vx + pose.vy * pose.vy) / 2 - mu / r;
  const h = rx * pose.vy - ry * pose.vx;
  const ex = (pose.vy * h) / mu - rx / r;
  const ey = (-pose.vx * h) / mu - ry / r;
  const eccentricity = Math.hypot(ex, ey);
  if (energy >= -1e-9) {
    return { bound: false, energy, periapsis: Infinity, apoapsis: Infinity, eccentricity };
  }
  const semiMajor = -mu / (2 * energy);
  const ecc = Math.min(eccentricity, 0.999999);
  return {
    bound: true,
    energy,
    periapsis: semiMajor * (1 - ecc),
    apoapsis: semiMajor * (1 + ecc),
    eccentricity: ecc,
  };
}

/**
 * Bound to the target, periapsis above the surface plus margin, apoapsis inside
 * the capture radius. A burn at the sphere's edge can sit at apoapsis, so the
 * apoapsis check allows the radius itself.
 */
export function isCapturedOrbit(state: SimState, config: SimConfig): boolean {
  const body = targetBody(config);
  if (!body?.captureRadius) return false;
  const elements = orbitAbout(state, body, gravityConstant(config), state.step * config.dt, config.bodies);
  if (!elements?.bound) return false;
  return (
    elements.energy < 0 &&
    elements.periapsis > body.radius + config.periapsisMargin &&
    elements.apoapsis <= body.captureRadius + 1e-3
  );
}

/** Points around the osculating ellipse, or null when the ship is not bound. */
export function sampleOrbit(
  state: SimState,
  body: Body,
  g: number,
  count = 120,
  time = 0,
  bodies?: readonly Body[],
): Vec2[] | null {
  const elements = orbitAbout(state, body, g, time, bodies);
  if (!elements?.bound) return null;
  const rel = relativePose(state, body, time, bodies);
  const rx = rel.rx;
  const ry = rel.ry;
  const r = Math.hypot(rx, ry);
  const mu = g * body.mass;
  const h = rx * rel.vy - ry * rel.vx;
  const ex = (rel.vy * h) / mu - rx / r;
  const ey = (-rel.vx * h) / mu - ry / r;
  const ecc = elements.eccentricity;
  let px: number;
  let py: number;
  if (ecc > 1e-5) {
    const eLen = Math.hypot(ex, ey);
    px = ex / eLen;
    py = ey / eLen;
  } else {
    px = rx / r;
    py = ry / r;
  }
  const sign = h >= 0 ? 1 : -1;
  const tx = -py * sign;
  const ty = px * sign;
  const semiMajor = -mu / (2 * elements.energy);
  const parameter = semiMajor * (1 - ecc * ecc);
  const points: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const anomaly = (i / count) * Math.PI * 2;
    const radius = parameter / (1 + ecc * Math.cos(anomaly));
    const cos = Math.cos(anomaly);
    const sin = Math.sin(anomaly);
    points.push({
      x: rel.cx + radius * (cos * px + sin * tx),
      y: rel.cy + radius * (cos * py + sin * ty),
    });
  }
  return points;
}

function targetBody(config: SimConfig): Body | undefined {
  for (let i = 0; i < config.bodies.length; i++) {
    if (config.bodies[i].id === config.targetId) return config.bodies[i];
  }
  return undefined;
}

/**
 * Linear drag inside each body's atmosphere, opposite the velocity relative
 * to that body. Density is 1 at the surface and 0 at `atmosphereRadius`.
 * A zero `dragStrength`, or no atmosphere, returns without writing `state`.
 */
function applyDrag(state: SimState, config: SimConfig, time: number): void {
  const strength = config.dragStrength ?? 0;
  if (strength === 0) return;
  let ax = 0;
  let ay = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const atmo = body.atmosphereRadius ?? 0;
    if (!(atmo > body.radius)) continue;
    const pose = body.orbit ? bodyPose(body, time, bodies) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const dx = state.x - pose.x;
    const dy = state.y - pose.y;
    const r = Math.hypot(dx, dy);
    if (!(r > body.radius) || !(r < atmo)) continue;
    const depth = (atmo - r) / (atmo - body.radius);
    const density = depth * depth;
    ax -= strength * density * (state.vx - pose.vx);
    ay -= strength * density * (state.vy - pose.vy);
  }
  if (ax === 0 && ay === 0) return;
  state.vx += ax * config.dt;
  state.vy += ay * config.dt;
}

/**
 * Burn multiplier. 1 when the ship is stock, so `dv * 1` stays the authored delta-v.
 * Engines raise it. Mass lowers it.
 */
export function burnScale(config: SimConfig): number {
  const mass = config.shipMass ?? 1;
  const engine = config.engineScale ?? 1;
  if (mass === 1 && engine === 1) return 1;
  return engine / mass;
}

/** White dwarfs, neutron stars, pulsars, magnetars and black holes. Tides are strongest here. */
export function isCompactBody(body: Body): boolean {
  return (
    body.kind === "blackhole" ||
    body.look === "white-dwarf" ||
    body.look === "neutron" ||
    body.look === "pulsar" ||
    body.look === "magnetar"
  );
}

/** |B| / B1 at the edge of each magnetism zone, safe through lethal. */
export const MAG_ZONE_EDGES = [1, 2.5, 6, 15] as const;

/** B1, the field strength at R1 on a dipole's axis. Ratios use this unit. */
export const MAG_B1 = 1;

/**
 * Radius factor for a pulsar's rotation-averaged field. The circular Fuzzy
 * edge sits at `0.894 * R1`, which is the design's average of the dipole oval.
 */
const MAG_AVERAGED = 0.894;

/** `k` such that |B| = B1 at r = R1 on the dipole axis. */
export function magneticMoment(reach: number): number {
  return (MAG_B1 * reach * reach * reach) / 2;
}

function magnetOf(body: Body): Magnet | undefined {
  const magnet = body.magnet;
  if (!magnet || !(magnet.b1Reach > 0)) return undefined;
  return magnet;
}

/** True when the level has a body the magnetism map can draw. */
export function hasMagneticBody(bodies: readonly Body[]): boolean {
  for (let i = 0; i < bodies.length; i++) {
    if (magnetOf(bodies[i])) return true;
  }
  return false;
}

/**
 * Summed dipole field at a point. Averaged magnets (pulsars) contribute the
 * circular magnitude `k · 0.894³ · 2 / r³` along the outward radial, so the
 * zones stay round while the beams spin. Other magnets use the static dipole.
 */
export function fieldAt(x: number, y: number, time: number, bodies: readonly Body[]): Vec2 {
  let bx = 0;
  let by = 0;
  for (let i = 0; i < bodies.length; i++) {
    const magnet = magnetOf(bodies[i]);
    if (!magnet) continue;
    const body = bodies[i];
    const pose = body.orbit ? bodyPose(body, time, bodies) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const dx = x - pose.x;
    const dy = y - pose.y;
    const r = Math.max(Math.hypot(dx, dy), 1);
    const invR = 1 / r;
    const k = magneticMoment(magnet.b1Reach);
    const falloff = k / (r * r * r);
    if (magnet.averaged) {
      const mag = falloff * (MAG_AVERAGED * MAG_AVERAGED * MAG_AVERAGED) * 2;
      bx += dx * invR * mag;
      by += dy * invR * mag;
      continue;
    }
    const mx = Math.sin(magnet.tilt);
    const my = Math.cos(magnet.tilt);
    const nx = dx * invR;
    const ny = dy * invR;
    const cos = mx * nx + my * ny;
    bx += falloff * (3 * cos * nx - mx);
    by += falloff * (3 * cos * ny - my);
  }
  return { x: bx, y: by };
}

/** |B| / B1. The Fuzzy zone starts at 1. */
export function fieldRatio(x: number, y: number, time: number, bodies: readonly Body[]): number {
  const field = fieldAt(x, y, time, bodies);
  return Math.hypot(field.x, field.y) / MAG_B1;
}

/**
 * Beam axis at `time`. Angle is clockwise about the magnetic axis, which at
 * tilt 0 points along +y. The visual rotates by the same angle.
 */
export function beamAxis(body: Body, time: number): Vec2 | null {
  const beam = body.beam;
  if (!beam || !(beam.period > 0)) return null;
  const tilt = body.magnet?.tilt ?? 0;
  const angle = Math.PI / 2 - tilt - (2 * Math.PI * time) / beam.period;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Hull per second from every beam the ship is inside. */
export function beamDamageRate(x: number, y: number, time: number, bodies: readonly Body[]): number {
  let rate = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const beam = body.beam;
    const damage = beam?.damage ?? 0;
    if (!beam || !(damage > 0) || !(beam.reach > 0) || !(beam.period > 0)) continue;
    const axis = beamAxis(body, time);
    if (!axis) continue;
    const pose = body.orbit ? bodyPose(body, time, bodies) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const dx = x - pose.x;
    const dy = y - pose.y;
    const r = Math.hypot(dx, dy);
    if (!(r > 1e-6) || !(r <= beam.reach)) continue;
    const cross = Math.abs(dx * axis.y - dy * axis.x);
    const base = beam.base ?? 4;
    const tip = beam.tip ?? 18;
    const full = base + (tip - base) * (r / beam.reach);
    if (cross <= full * 0.5) rate += damage;
  }
  return rate;
}

export interface SpreadPoint {
  x: number;
  y: number;
  sigma: number;
}

/**
 * Instrument spread along a path. Inside the Fuzzy zone,
 * `σ += 6 · log2(|B| / B1) · distance / 100`. It never shrinks.
 * The same samples always produce the same σ. Drawing uses it; the sim does not.
 */
export function spreadAlong(
  samples: readonly { x: number; y: number; step: number }[],
  dt: number,
  bodies: readonly Body[],
): SpreadPoint[] {
  const out: SpreadPoint[] = [];
  if (samples.length === 0) return out;
  let sigma = 0;
  out.push({ x: samples[0].x, y: samples[0].y, sigma: 0 });
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const next = samples[i];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      const pieces = Math.max(1, Math.round(len / 10));
      const piece = len / pieces;
      for (let s = 1; s <= pieces; s++) {
        const t = s / pieces;
        const x = prev.x + dx * t;
        const y = prev.y + dy * t;
        const step = prev.step + (next.step - prev.step) * t;
        const ratio = fieldRatio(x, y, step * dt, bodies);
        if (ratio > 1) sigma += 6 * Math.log2(ratio) * (piece / 100);
      }
    }
    out.push({ x: next.x, y: next.y, sigma });
  }
  return out;
}

const SHIP_LENGTH = 6;
const CLOSE_FACTOR = 1.12;
const CLOSE_RATE = 18;
/** Hull damage per second that draws the red zone and the warning. */
export const STRESS_WARN = 4;

/** Hull per second from the gravity gradient across the ship. */
export function tidalStressAt(x: number, y: number, config: SimConfig, time: number): number {
  const strength = config.tidalStrength ?? 0;
  if (!(strength > 0)) return 0;
  const g = gravityConstant(config);
  let stress = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!isCompactBody(body) || !(body.mass > 0)) continue;
    const pose = body.orbit ? bodyPose(body, time, bodies) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const dx = x - pose.x;
    const dy = y - pose.y;
    const r2 = dx * dx + dy * dy;
    const r = Math.sqrt(r2);
    if (!(r > body.radius)) continue;
    const gradient = (2 * g * body.mass * SHIP_LENGTH) / (r2 * r);
    stress += strength * gradient;
  }
  return stress;
}

/** Radius where tidal stress reaches `STRESS_WARN`, or 0 when the knob is off. */
export function tidalDangerRadius(body: Body, g: number, tidalStrength: number): number {
  if (!isCompactBody(body) || !(tidalStrength > 0) || !(body.mass > 0) || !(g > 0)) return 0;
  const r3 = (tidalStrength * 2 * g * body.mass * SHIP_LENGTH) / STRESS_WARN;
  const r = Math.cbrt(r3);
  return r > body.radius ? r : 0;
}

function closePassRate(x: number, y: number, config: SimConfig, time: number): number {
  let rate = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (isCompactBody(body) || !bodySolid(body) || !(body.radius > 0)) continue;
    const pose = bodyPose(body, time, bodies);
    const r = Math.hypot(x - pose.x, y - pose.y);
    const outer = body.radius * CLOSE_FACTOR;
    if (!(r > body.radius) || !(r < outer)) continue;
    const depth = (outer - r) / (outer - body.radius);
    rate += CLOSE_RATE * depth * depth;
  }
  return rate;
}

/**
 * Relative luminance from `style.md` §8 WP10. The yellow sun is 1.
 * Red dwarf 0.4 and blue giant 2.5 are the design values; those looks are not in the game yet.
 * Compact objects and black holes give nothing.
 */
export function starLuminosity(body: Body): number {
  if (body.kind === "blackhole") return 0;
  switch (body.look) {
    case "white-dwarf":
      return 0.2;
    case "red-giant":
      return 1.5;
    case "neutron":
    case "pulsar":
    case "magnetar":
      return 0;
    default:
      return body.kind === "star" ? 1 : 0;
  }
}

/** World distance where a sun of luminance 1 is at full panel rate. `style.md` §8 WP10. */
export const SOLAR_RREF = 85;

/** Below this fraction of `rateMax` the panels count as off. */
export const SOLAR_CUTOFF = 0.08;

/**
 * Dose-rate constants from `radiation-map.svg`. D is in units of D1.
 * The header does not number a pulsar beam or an accretion disk. Those two
 * use D = 8 inside the beam, and a Gaussian of peak 6 at 2.4 radii on a
 * black-hole disk.
 */
export const DOSE_STAR_K = 2.2;
export const DOSE_STAR_R0 = 170;
export const DOSE_FLARE_K = 3.2;
export const DOSE_FLARE_R = 420;
export const DOSE_FLARE_CONE = (20 * Math.PI) / 180;
export const DOSE_COSMIC = 0.35;
export const DOSE_PULSAR = 8;
export const DOSE_DISK = 6;

export interface DoseReading {
  d: number;
  source: DoseSource;
}

function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  let value = angle % turn;
  if (value > Math.PI) value -= turn;
  if (value < -Math.PI) value += turn;
  return value;
}

/** True when a body's disc sits between the point and the star, blocking starlight and the flare. */
export function starShadowed(
  x: number,
  y: number,
  starX: number,
  starY: number,
  starId: string,
  bodies: readonly Body[],
  time: number,
  g = 1,
): boolean {
  const dx = starX - x;
  const dy = starY - y;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 1e-8)) return false;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.id === starId || !bodySolid(body) || !(body.radius > 0)) continue;
    const pose = bodyPose(body, time, bodies, g);
    const along = ((pose.x - x) * dx + (pose.y - y) * dy) / len2;
    if (!(along > 0.02) || !(along < 0.98)) continue;
    const px = x + along * dx;
    const py = y + along * dy;
    if (Math.hypot(pose.x - px, pose.y - py) < body.radius) return true;
  }
  return false;
}

function flareOn(flare: NonNullable<Body["flare"]>, time: number): boolean {
  if (!(flare.period > 0) || !(flare.duration > 0)) return false;
  let phase = time % flare.period;
  if (phase < 0) phase += flare.period;
  const end = flare.start + flare.duration;
  return phase >= flare.start && phase < end;
}

/**
 * Environmental dose rate in units of D1. Stars fall as L/r², a flare is a
 * 20° cone on sim time, belts are annuli, and a body in front of a star
 * removes that star and its flare. The map and the crew dose both read this.
 */
export function doseAt(x: number, y: number, time: number, bodies: readonly Body[], g = 1): DoseReading {
  let total = DOSE_COSMIC;
  let best = DOSE_COSMIC;
  let source: DoseSource = "cosmic";
  let blockedStar = false;
  const add = (value: number, name: DoseSource) => {
    if (!(value > 0)) return;
    total += value;
    if (value > best) {
      best = value;
      source = name;
    }
  };
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const pose = bodyPose(body, time, bodies, g);
    const distance = Math.max(1, Math.hypot(x - pose.x, y - pose.y));
    if (body.kind === "star") {
      const luminosity = starLuminosity(body) * luminosityScale(body.astrophage?.dims);
      const shadowed = starShadowed(x, y, pose.x, pose.y, body.id, bodies, time, g);
      if (shadowed) blockedStar = true;
      if (!shadowed && luminosity > 0) {
        const fall = (DOSE_STAR_R0 / distance) * (DOSE_STAR_R0 / distance);
        add(DOSE_STAR_K * luminosity * fall, "star");
        const flare = body.flare;
        if (flare && flareOn(flare, time)) {
          const delta = Math.abs(wrapAngle(Math.atan2(y - pose.y, x - pose.x) - flare.angle));
          if (delta < DOSE_FLARE_CONE) {
            const unit = delta / DOSE_FLARE_CONE;
            const reach = Math.pow(DOSE_FLARE_R / distance, 1.1);
            add(DOSE_FLARE_K * reach * (1 - unit * unit), "flare");
          }
        }
      }
    }
    if (body.look === "gas-giant" || body.look === "magnetar") {
      const radius = body.radius;
      const inner = (distance - 2.1 * radius) / (0.45 * radius);
      const outer = (distance - 3.2 * radius) / (0.5 * radius);
      add(12 * Math.exp(-inner * inner) + 4 * Math.exp(-outer * outer), "belt");
    }
    if (body.look === "pulsar" && (body.beam?.damage ?? 0) > 0) {
      if (beamDamageRate(x, y, time, bodies) > 0) add(DOSE_PULSAR, "pulsar");
    }
    if (body.kind === "blackhole") {
      const radius = body.radius;
      const ring = (distance - 2.4 * radius) / (0.4 * radius);
      add(DOSE_DISK * Math.exp(-ring * ring), "disk");
    }
  }
  if (blockedStar && source === "cosmic") source = "shadow";
  return { d: total, source };
}

function applyDose(state: SimState, config: SimConfig, time: number): void {
  if (state.status !== "flying") return;
  const per = config.dosePerD1 ?? 0;
  const limit = config.doseLimit ?? 0;
  if (!(per > 0) || !(limit > 0)) return;
  const reading = doseAt(state.x, state.y, time, config.bodies, gravityConstant(config));
  const shield = config.shield ?? 1;
  const rate = reading.d * per * shield;
  state.doseRate = rate;
  state.doseSource = reading.source;
  state.dose += rate * config.dt;
  if (state.dose >= limit) {
    state.dose = limit;
    state.status = "lost";
    state.lostReason = "dose";
  }
}

/**
 * Fuel per second from stars. The HUD, the gold path dots and the tank all
 * read this.
 * `rate = rateMax · L · min(1, (Rref / d)²)`, and the whole rate is 0 when
 * that is under 8 % of `rateMax`. Omitted solar strength, or 0, returns 0.
 */
export function solarRechargeRate(
  x: number,
  y: number,
  time: number,
  bodies: readonly Body[],
  solarStrength: number,
  g = 1,
): number {
  if (!(solarStrength > 0)) return 0;
  let rate = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star") continue;
    const luminosity = starLuminosity(body) * luminosityScale(body.astrophage?.dims);
    if (!(luminosity > 0)) continue;
    const pose = body.orbit ? bodyPose(body, time, bodies, g) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const distance = Math.hypot(x - pose.x, y - pose.y);
    if (!(distance > 1e-6)) continue;
    const falloff = Math.min(1, (SOLAR_RREF / distance) * (SOLAR_RREF / distance));
    const factor = coverageFactor(body.dyson?.coverage);
    const term = solarStrength * luminosity * falloff;
    rate += factor === 1 ? term : term * factor;
  }
  if (rate < SOLAR_CUTOFF * solarStrength) return 0;
  return rate;
}

function solarRate(x: number, y: number, config: SimConfig, time: number): number {
  return solarRechargeRate(x, y, time, config.bodies, config.solarStrength ?? 0, gravityConstant(config));
}

/** Distance from a cloud centre in ellipse radii. 1 sits on the rim. */
export function nebulaRadius(x: number, y: number, cloud: Nebula): number {
  const dx = x - cloud.x;
  const dy = y - cloud.y;
  const cos = Math.cos(cloud.angle);
  const sin = Math.sin(cloud.angle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.hypot(localX / cloud.rx, localY / cloud.ry);
}

/** Fuel per second scooped from nebulae. Dark, emission and reflection clouds all scoop. */
export function nebulaScoopRate(x: number, y: number, clouds: readonly Nebula[] | undefined): number {
  if (!clouds || clouds.length === 0) return 0;
  let rate = 0;
  for (let i = 0; i < clouds.length; i++) {
    const cloud = clouds[i];
    if (!(cloud.scoop > 0)) continue;
    const radius = nebulaRadius(x, y, cloud);
    if (!(radius < 1)) continue;
    const depth = 1 - radius;
    rate += cloud.scoop * depth * depth;
  }
  return rate;
}

/**
 * How fully a dark cloud hides this point. 1 is the centre, 0 is outside.
 * Emission and reflection clouds do not hide. The value is not applied to the trajectory.
 */
export function nebulaCover(x: number, y: number, clouds: readonly Nebula[] | undefined): number {
  if (!clouds) return 0;
  let cover = 0;
  for (let i = 0; i < clouds.length; i++) {
    const cloud = clouds[i];
    if (cloud.look !== "dark") continue;
    const radius = nebulaRadius(x, y, cloud);
    if (!(radius < 1)) continue;
    const hide = 1 - radius;
    if (hide > cover) cover = hide;
  }
  return cover;
}

/** Fuel per second from comet ice inside `harvestRadius`. */
export function iceHarvestRate(x: number, y: number, time: number, bodies: readonly Body[], g = 1): number {
  let rate = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const harvest = body.harvest ?? 0;
    const reach = body.harvestRadius ?? 0;
    if (!(harvest > 0) || !(reach > body.radius)) continue;
    const pose = body.orbit ? bodyPose(body, time, bodies, g) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const r = Math.hypot(x - pose.x, y - pose.y);
    if (!(r > body.radius) || !(r < reach)) continue;
    const depth = (reach - r) / (reach - body.radius);
    rate += harvest * depth * depth;
  }
  return rate;
}

/**
 * Supernova blast, remnant shock, and quasar jets. Motion is untouched.
 * A level with neither leaves the state alone.
 */
function applyDramatic(state: SimState, config: SimConfig, x0: number, y0: number, t0: number, t1: number): void {
  const bodies = config.bodies;
  const g = gravityConstant(config);
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const nova = body.supernova;
    const jet = body.quasar;
    if (!nova && !jet) continue;
    const p0 = bodyPose(body, t0, bodies, g);
    const p1 = bodyPose(body, t1, bodies, g);
    if (nova) {
      const d0 = Math.hypot(x0 - p0.x, y0 - p0.y);
      const d1 = Math.hypot(state.x - p1.x, state.y - p1.y);
      if (blastHits(d0, d1, nova, t0, t1)) {
        state.hull = 0;
        state.status = "lost";
        state.lostReason = "nova";
        return;
      }
      if (shockCrosses(d0, d1, nova, t0, t1)) {
        state.hull -= nova.damage;
        if (!(state.hull > 0)) {
          state.hull = 0;
          state.status = "lost";
          state.lostReason = "nova";
          return;
        }
      }
    }
    if (jet && jet.damage > 0) {
      const rate = quasarDamage(state.x - p1.x, state.y - p1.y, jet, t1);
      if (rate > 0) {
        state.hull -= rate * config.dt;
        if (!(state.hull > 0)) {
          state.hull = 0;
          state.status = "lost";
          state.lostReason = "hull";
          return;
        }
      }
    }
  }
}

/** Hull per second from belt dust, after shielding. 0 when the level has no dust rate. */
function beltDust(x: number, y: number, config: SimConfig, time: number): number {
  const belts = config.belts;
  if (!belts || belts.length === 0) return 0;
  const g = gravityConstant(config);
  const shield = config.shield ?? 1;
  let rate = 0;
  for (let i = 0; i < belts.length; i++) {
    const belt = belts[i];
    const dust = belt.dustDamage ?? 0;
    if (!(dust > 0)) continue;
    const center = findBody(config.bodies, belt.centerId);
    if (!center) continue;
    const pose = bodyPose(center, time, config.bodies, g);
    if (pointInBelt(x, y, pose.x, pose.y, belt)) rate += dust * shield;
  }
  return rate;
}

/** Hull per second in a jet core, and fuel per second in the margins. */
function engineRates(
  x: number,
  y: number,
  time: number,
  bodies: readonly Body[],
  g: number,
): { burn: number; scoop: number } {
  let burn = 0;
  let scoop = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const engine = body.engine;
    if (!engine || !bodyPresent(body, time)) continue;
    if (!(engine.burn > 0) && !(engine.scoop > 0)) continue;
    const pose = bodyPose(body, time, bodies, g);
    const contact = jetContact(x - pose.x, y - pose.y, body.radius, engine.angle);
    if (!contact) continue;
    if (contact.core && engine.burn > 0) burn += engine.burn;
    if (contact.margin && engine.scoop > 0) scoop += engine.scoop;
  }
  return { burn, scoop };
}

/** Hull per second from a Dyson collector band. The gaps between shells add nothing. */
function dysonNick(x: number, y: number, time: number, bodies: readonly Body[], g: number): number {
  let rate = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const swarm = body.dyson;
    if (!swarm || !(swarm.nick > 0) || !bodyPresent(body, time)) continue;
    const pose = bodyPose(body, time, bodies, g);
    if (dysonShellHit(x - pose.x, y - pose.y, body.radius)) rate += swarm.nick;
  }
  return rate;
}

/**
 * Hull damage, the stress reading, and solar recharge. Motion is untouched.
 * A stock ship (no tides, no solar, outside every close shell) only records
 * a zero stress. Hull at 0 is a loss, judged here so prediction and flight agree.
 */
function applyShipSystems(state: SimState, config: SimConfig, time: number): void {
  const stress = tidalStressAt(state.x, state.y, config, time);
  const pass = closePassRate(state.x, state.y, config, time);
  const beam = beamDamageRate(state.x, state.y, time, config.bodies);
  state.stress = stress;
  if (stress > state.peakStress) state.peakStress = stress;
  const g = gravityConstant(config);
  const engine = engineRates(state.x, state.y, time, config.bodies, g);
  const nick = dysonNick(state.x, state.y, time, config.bodies, g);
  const damage = (stress + pass + beam + beltDust(state.x, state.y, config, time) + engine.burn + nick) * config.dt;
  if (damage > 0) {
    state.hull -= damage;
    if (!(state.hull > 0)) {
      state.hull = 0;
      state.status = "lost";
      state.lostReason = "hull";
    }
  }
  applyDose(state, config, time);
  if (state.status !== "flying") return;
  const solar = solarRate(state.x, state.y, config, time);
  const scoop = nebulaScoopRate(state.x, state.y, config.nebulae);
  const ice = iceHarvestRate(state.x, state.y, time, config.bodies, g);
  const inflow = solar + scoop + ice + engine.scoop;
  if (inflow > 0) {
    const cap = config.fuelMax ?? state.tank;
    const room = cap - state.tank;
    if (room > 0) {
      const gain = Math.min(inflow * config.dt, room);
      state.tank += gain;
      state.recharged += gain;
    }
  }
  applyAstroHarvest(state, config, time);
}

/**
 * Scoop Astrophage from any knot the ship is inside. No-op without a spin
 * drive and a scoop, so stock levels never touch the tank.
 */
function applyAstroHarvest(state: SimState, config: SimConfig, time: number): void {
  state.astroRate = 0;
  const lines = config.petrova;
  if (!lines || lines.length === 0) return;
  if (config.engine !== "spin" || !config.scoop) return;
  const capacity = config.astroCapacity ?? ASTRO_CAPACITY;
  const rate = config.astroRate ?? ASTRO_HARVEST_RATE;
  if (!(capacity > 0) || !(rate > 0)) return;
  const g = gravityConstant(config);
  const sites: KnotSite[] = [];
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const from = findBody(config.bodies, line.from);
    const to = findBody(config.bodies, line.to);
    if (!from || !to) {
      index += line.knots.length;
      continue;
    }
    const start = bodyPose(from, time, config.bodies, g);
    const end = bodyPose(to, time, config.bodies, g);
    const curve = petrovaCurve(start.x, start.y, from.radius, end.x, end.y, to.radius, line.bulge);
    for (let k = 0; k < line.knots.length; k++) {
      const knot = line.knots[k];
      const point = curvePoint(curve, knot.t);
      sites.push({
        x: point.x,
        y: point.y,
        radius: knot.radius,
        remaining: state.knots[index] ?? 0,
      });
      index += 1;
    }
  }
  const result = harvestKnots(state.x, state.y, sites, state.astro, capacity, rate, config.dt);
  state.astro = result.tank;
  state.astroGained += result.gained;
  state.astroRate = result.rate;
  for (let i = 0; i < result.remaining.length; i++) state.knots[i] = result.remaining[i];
}

/**
 * One velocity-Verlet step of size `config.dt`, then crash / capture / lost checks.
 * Burns are not applied here — `advancePlan` applies them before calling `step`.
 * Terminal states are not advanced. `dt` never depends on sim speed.
 * Drag, when a level sets it, is applied at the end of the step so prediction
 * and flight share it.
 */
function elevatorLocal(x: number, y: number, pose: Pose, angle: number): { x: number; y: number } {
  const dx = x - pose.x;
  const dy = y - pose.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

function findMouth(holes: readonly WormholePair[] | undefined, id: string): WormholeMouth | null {
  if (!holes) return null;
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    if (mouthName(hole.id, "a") === id) return hole.a;
    if (mouthName(hole.id, "b") === id) return hole.b;
  }
  return null;
}

/** Drop the latch once the ship has left the mouth or the counterweight. */
function releaseTransit(state: SimState, config: SimConfig, time: number): void {
  const id = state.transit;
  if (!id) return;
  if (id.endsWith(":lift")) {
    const body = findBody(config.bodies, id.slice(0, -":lift".length));
    if (!body?.elevator) {
      state.transit = null;
      return;
    }
    const pose = bodyPose(body, time, config.bodies, gravityConstant(config));
    const angle = elevatorAngle(body.elevator, time);
    const frame = elevatorFrame(body.radius);
    const cx = pose.x + Math.cos(angle) * frame.outer;
    const cy = pose.y + Math.sin(angle) * frame.outer;
    if (Math.hypot(state.x - cx, state.y - cy) > frame.rock) state.transit = null;
    return;
  }
  const mouth = findMouth(config.wormholes, id);
  if (!mouth || Math.hypot(state.x - mouth.x, state.y - mouth.y) > mouth.radius) state.transit = null;
}

/**
 * Move the ship to the other mouth. Speed is kept, heading turns by the
 * pair's angle, and outside time shifts by the exit's clock offset.
 * Returns true when a transit happened. One transit per step.
 */
function transitWormhole(
  state: SimState,
  config: SimConfig,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  time: number,
): boolean {
  if (state.transit && !state.transit.endsWith(":lift")) return false;
  const holes = config.wormholes;
  if (!holes || holes.length === 0) return false;
  let best: number | null = null;
  let pair: WormholePair | null = null;
  let fromA = false;
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    const intoA = circleEntry(x0, y0, x1, y1, hole.a.x, hole.a.y, hole.a.radius);
    const intoB = circleEntry(x0, y0, x1, y1, hole.b.x, hole.b.y, hole.b.radius);
    if (intoA !== null && (best === null || intoA < best)) {
      best = intoA;
      pair = hole;
      fromA = true;
    }
    if (intoB !== null && (best === null || intoB < best)) {
      best = intoB;
      pair = hole;
      fromA = false;
    }
  }
  if (!pair) return false;
  const exit = fromA ? pair.b : pair.a;
  const spun = rotateVelocity(state.vx, state.vy, fromA ? pair.angle : -pair.angle);
  state.vx = spun.vx;
  state.vy = spun.vy;
  state.x = exit.x;
  state.y = exit.y;
  state.transit = mouthName(pair.id, fromA ? "b" : "a");
  const accel = acceleration(state.x, state.y, config, time);
  state.ax = accel.ax;
  state.ay = accel.ay;
  state.t += fromA ? pair.clockOffset : -pair.clockOffset;
  return true;
}

export function step(state: SimState, config: SimConfig): void {
  if (state.status !== "flying") return;

  const dt = config.dt;
  const t0 = state.step * dt;
  releaseTransit(state, config, t0);
  const t1 = t0 + dt;
  const rateThen = properTimeRate(state.x, state.y, state.vx, state.vy, config, t0);
  const x0 = state.x;
  const y0 = state.y;
  const x1 = x0 + state.vx * dt + 0.5 * state.ax * dt * dt;
  const y1 = y0 + state.vy * dt + 0.5 * state.ay * dt * dt;
  const a1 = acceleration(x1, y1, config, t1);

  state.vx += 0.5 * (state.ax + a1.ax) * dt;
  state.vy += 0.5 * (state.ay + a1.ay) * dt;
  state.ax = a1.ax;
  state.ay = a1.ay;
  state.x = x1;
  state.y = y1;
  state.step += 1;
  applyDrag(state, config, t1);

  let crashT = Infinity;
  let crashBody: string | null = null;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!bodySolid(body)) continue;
    if (!bodyPresent(body, t0) && !bodyPresent(body, t1)) continue;
    const moving = body.orbit !== undefined || body.drift !== undefined || body.script?.kind === "consume";
    const hit = moving
      ? movingCircleEntry(x0, y0, x1, y1, body, t0, t1, bodies, body.radius)
      : circleEntry(x0, y0, x1, y1, body.x, body.y, body.radius);
    if (hit !== null && hit < crashT) {
      crashT = hit;
      crashBody = body.id;
    }
  }

  const rocks = config.beltRocks;
  let rockSnap: { x: number; y: number; radius: number } | null = null;
  if (rocks) {
    const g = gravityConstant(config);
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      if (!rock.solid) continue;
      const center = findBody(bodies, rock.centerId);
      if (!center) continue;
      const c0 = bodyPose(center, t0, bodies, g);
      const c1 = bodyPose(center, t1, bodies, g);
      const a0 = rock.angle + beltDrift(rock.tier, t0);
      const a1 = rock.angle + beltDrift(rock.tier, t1);
      const p0x = c0.x + Math.cos(a0) * rock.distance;
      const p0y = c0.y + Math.sin(a0) * rock.distance;
      const p1x = c1.x + Math.cos(a1) * rock.distance;
      const p1y = c1.y + Math.sin(a1) * rock.distance;
      const hit = circleEntry(x0 - p0x, y0 - p0y, x1 - p1x, y1 - p1y, 0, 0, rock.radius);
      if (hit !== null && hit < crashT) {
        crashT = hit;
        crashBody = `${rock.beltId}:${i}`;
        rockSnap = {
          x: p0x + (p1x - p0x) * hit,
          y: p0y + (p1y - p0y) * hit,
          radius: rock.radius,
        };
      }
    }
  }

  const mirrorG = gravityConstant(config);
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body.shkadov) continue;
    if (!bodyPresent(body, t0) && !bodyPresent(body, t1)) continue;
    const p0 = bodyPose(body, t0, bodies, mirrorG);
    const p1 = bodyPose(body, t1, bodies, mirrorG);
    const radii = mirrorRadii(body.radius);
    const c = Math.cos(body.shkadov.angle);
    const s = Math.sin(body.shkadov.angle);
    const rx0 = x0 - p0.x;
    const ry0 = y0 - p0.y;
    const rx1 = x1 - p1.x;
    const ry1 = y1 - p1.y;
    const hit = mirrorSegmentEntry(rx0 * c + ry0 * s, -rx0 * s + ry0 * c, rx1 * c + ry1 * s, -rx1 * s + ry1 * c, radii.inner, radii.outer);
    if (hit !== null && hit < crashT) {
      crashT = hit;
      crashBody = `${body.id}:mirror`;
      rockSnap = null;
    }
  }

  let throwBody: Body | null = null;
  let throwT = Infinity;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body.ring && !body.elevator) continue;
    if (!bodyPresent(body, t0) && !bodyPresent(body, t1)) continue;
    const p0 = bodyPose(body, t0, bodies, mirrorG);
    const p1 = bodyPose(body, t1, bodies, mirrorG);
    if (body.ring) {
      const hit = ringSegmentEntry(x0 - p0.x, y0 - p0.y, x1 - p1.x, y1 - p1.y, body.radius, body.ring.angle, body.ring.gaps);
      if (hit !== null && hit < crashT) {
        crashT = hit;
        crashBody = `${body.id}:ring`;
        rockSnap = null;
      }
    }
    if (body.elevator) {
      const frame = elevatorFrame(body.radius);
      const l0 = elevatorLocal(x0, y0, p0, elevatorAngle(body.elevator, t0));
      const l1 = elevatorLocal(x1, y1, p1, elevatorAngle(body.elevator, t1));
      const cable = tetherSegmentEntry(l0.x, l0.y, l1.x, l1.y, frame.inner, frame.outer, frame.half, frame.rock);
      if (cable !== null && cable < crashT) {
        crashT = cable;
        crashBody = `${body.id}:tether`;
        rockSnap = null;
      }
      if (state.transit !== `${body.id}:lift`) {
        const dock = circleEntry(l0.x, l0.y, l1.x, l1.y, frame.outer, 0, frame.rock);
        if (dock !== null && dock < throwT) {
          throwT = dock;
          throwBody = body;
        }
      }
    }
  }
  if (throwBody && throwT < crashT) crashBody = null;
  else throwBody = null;

  if (crashBody !== null) {
    const body = rockSnap ? undefined : bodies.find((item) => item.id === crashBody);
    state.x = x0 + (x1 - x0) * crashT;
    state.y = y0 + (y1 - y0) * crashT;
    if (rockSnap) {
      const dx = state.x - rockSnap.x;
      const dy = state.y - rockSnap.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 1e-8) {
        state.x = rockSnap.x + (dx / distance) * rockSnap.radius;
        state.y = rockSnap.y + (dy / distance) * rockSnap.radius;
      }
    } else if (body) {
      let cx = body.x;
      let cy = body.y;
      if (body.orbit || body.drift) {
        const pose = bodyPose(body, t0 + crashT * dt, bodies);
        cx = pose.x;
        cy = pose.y;
      }
      const dx = state.x - cx;
      const dy = state.y - cy;
      const distance = Math.hypot(dx, dy);
      if (distance > 1e-8) {
        state.x = cx + (dx / distance) * body.radius;
        state.y = cy + (dy / distance) * body.radius;
      }
    }
    const impact = acceleration(state.x, state.y, config, t0 + crashT * dt);
    state.ax = impact.ax;
    state.ay = impact.ay;
    accrueClocks(state, rateThen, crashT * dt);
    state.rate = properTimeRate(state.x, state.y, state.vx, state.vy, config, t0 + crashT * dt);
    state.status = "crashed";
    state.crashedBodyId = crashBody;
    state.hull = 0;
    return;
  }

  if (throwBody?.elevator) {
    const time = t0 + throwT * dt;
    const pose = bodyPose(throwBody, time, bodies, mirrorG);
    const angle = elevatorAngle(throwBody.elevator, time);
    const frame = elevatorFrame(throwBody.radius);
    const tang = tangentialVelocity(throwBody.elevator.omega, angle, frame.outer);
    state.vx = pose.vx + tang.vx;
    state.vy = pose.vy + tang.vy;
    state.transit = `${throwBody.id}:lift`;
  }

  const jumped = transitWormhole(state, config, x0, y0, x1, y1, t1);

  accrueClocks(state, rateThen, dt);
  state.rate = properTimeRate(state.x, state.y, state.vx, state.vy, config, t1);
  applyDramatic(state, config, x0, y0, t0, t1);
  if (state.status !== "flying") return;
  applyShipSystems(state, config, t1);
  if (state.status !== "flying") return;

  const target = targetBody(config);
  const captureRadius = target?.captureRadius;
  if (target && captureRadius !== undefined) {
    if (!bodyPresent(target, t1)) {
      state.status = "lost";
      state.lostReason = "burned";
      return;
    }
    let tx = target.x;
    let ty = target.y;
    let crossed: boolean;
    if (target.orbit) {
      const p1 = bodyPose(target, t1, bodies);
      tx = p1.x;
      ty = p1.y;
      crossed = !jumped && movingCircleEntry(x0, y0, x1, y1, target, t0, t1, bodies, captureRadius) !== null;
    } else {
      crossed = !jumped && circleEntry(x0, y0, x1, y1, target.x, target.y, captureRadius) !== null;
    }
    const dist = Math.hypot(state.x - tx, state.y - ty);
    if (dist <= captureRadius + 1e-6 || crossed) state.enteredCapture = true;
    if (isCapturedOrbit(state, config)) {
      state.status = "won";
      return;
    }
    if (state.enteredCapture && dist > captureRadius + 1e-6) {
      state.status = "lost";
      state.lostReason = "flyby";
      return;
    }
  }

  const bounds = config.bounds;
  if (state.x < bounds.minX || state.x > bounds.maxX || state.y < bounds.minY || state.y > bounds.maxY) {
    state.status = "lost";
    state.lostReason = "bounds";
    return;
  }

  if (state.step >= config.maxSteps) {
    state.status = "lost";
    state.lostReason = "timeout";
  }
}

interface PlanHooks {
  onBurn?: (index: number, before: SimState, after: SimState) => void;
  onIntegrated?: (state: SimState) => void;
}

/**
 * Apply every node scheduled at the current step, then integrate one step.
 * A burn that leaves the ship in a captured orbit wins before the next step.
 * `dt` stays fixed. Frame grouping lives in `advanceFrame`.
 */
export function advancePlan(
  state: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  cursor: { index: number },
  hooks?: PlanHooks,
): void {
  if (state.status !== "flying") return;

  while (cursor.index < nodes.length && nodes[cursor.index].step < state.step) {
    cursor.index += 1;
  }

  while (cursor.index < nodes.length && nodes[cursor.index].step === state.step) {
    const index = cursor.index;
    const node = nodes[index];
    const before = hooks?.onBurn ? cloneState(state) : null;
    const scale = burnScale(config);
    if (config.engine === "spin") {
      const mag = Math.hypot(node.dvx, node.dvy);
      const cost = spinCost(mag, config.astroDv ?? ASTRO_DV);
      const have = state.astro;
      const paid = cost > have ? have : cost;
      const frac = cost > 1e-12 ? paid / cost : 1;
      state.vx += node.dvx * scale * frac;
      state.vy += node.dvy * scale * frac;
      state.astro = have - paid;
      state.astroSpent += paid;
    } else if (scale === 1) {
      state.vx += node.dvx;
      state.vy += node.dvy;
    } else {
      state.vx += node.dvx * scale;
      state.vy += node.dvy * scale;
    }
    if (config.engine !== "spin") {
      const perDv = config.fuelPerDv ?? 1;
      state.tank -= fuelCost(node.dvx, node.dvy, perDv);
      if (state.tank < 0) state.tank = 0;
    }
    cursor.index = index + 1;
    const more = cursor.index < nodes.length && nodes[cursor.index].step === state.step;
    if (!more && isCapturedOrbit(state, config)) state.status = "won";
    if (before && hooks?.onBurn) hooks.onBurn(index, before, cloneState(state));
    if (state.status !== "flying") return;
  }

  step(state, config);
  hooks?.onIntegrated?.(state);
}

/** Advance one rendered frame. `stepsThisFrame` is 1, 2, or 4 — `dt` stays fixed. */
export function advanceFrame(
  state: SimState,
  config: SimConfig,
  stepsThisFrame: number,
  samples: PathSample[],
  nodes: readonly BurnNode[],
  cursor: { index: number },
): void {
  samples.length = 0;
  for (let i = 0; i < stepsThisFrame; i++) {
    if (state.status !== "flying") return;
    const stepBefore = state.step;
    advancePlan(state, config, nodes, cursor);
    if (state.step !== stepBefore) samples.push({ x: state.x, y: state.y, step: state.step, rate: state.rate });
  }
}

function predictionFrom(state: SimState, config: SimConfig, path: PathSample[]): Prediction {
  const target = targetBody(config);
  const orbit =
    state.status === "won" && target
      ? sampleOrbit(state, target, gravityConstant(config), 120, state.step * config.dt, config.bodies)
      : null;
  return {
    path,
    status: state.status,
    crashedBodyId: state.crashedBodyId,
    lostReason: state.lostReason,
    steps: state.step,
    orbit,
    outsideTime: state.t,
    shipTime: state.tau,
  };
}

/** Fly a plan until it wins, crashes, or is lost. `stepsThisFrame` does not change `dt`. */
export function flyPlan(
  from: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  stepsThisFrame: number,
): Prediction {
  const state = cloneState(from);
  const cursor = { index: 0 };
  const path: PathSample[] = [];
  const frame: PathSample[] = [];
  let guard = 0;
  while (state.status === "flying" && guard++ <= config.maxSteps + nodes.length + 2) {
    advanceFrame(state, config, stepsThisFrame, frame, nodes, cursor);
    for (let i = 0; i < frame.length; i++) path.push(frame[i]);
  }
  return predictionFrom(state, config, path);
}

function reuseIsValid(nodes: readonly BurnNode[], reuse: PlanReuse): boolean {
  if (reuse.from < 0 || reuse.from > nodes.length) return false;
  for (let i = 0; i < reuse.from; i++) {
    const snap = reuse.snapshots[i];
    const node = nodes[i];
    if (!snap || snap.step !== node.step || snap.dvx !== node.dvx || snap.dvy !== node.dvy) return false;
  }
  if (reuse.kind === "burn") {
    if (reuse.from >= nodes.length) return false;
    const snap = reuse.snapshots[reuse.from];
    const node = nodes[reuse.from];
    if (!snap?.reached || snap.step !== node.step) return false;
  } else if (reuse.from > 0) {
    const prev = reuse.snapshots[reuse.from - 1];
    if (!prev) return false;
  }
  return true;
}

function unreachedSnapshot(node: BurnNode, state: SimState): NodeSnapshot {
  const frozen = cloneState(state);
  return {
    step: node.step,
    dvx: node.dvx,
    dvy: node.dvy,
    before: frozen,
    after: cloneState(frozen),
    approach: [],
    reached: false,
  };
}

function nodeAtStep(nodes: readonly BurnNode[], step: number): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].step === step) return true;
    if (nodes[i].step > step) return false;
  }
  return false;
}

/**
 * Steps of predicted coast from `state`. Without a horizon this is the room
 * left until `maxSteps`. With one, it is N seconds, optionally one orbit,
 * shortened where `|a|` is large. Live flight does not call this.
 */
export function horizonSteps(state: SimState, config: SimConfig): number {
  const room = Math.max(0, config.maxSteps - state.step);
  const horizon = config.horizon;
  if (!horizon) return room;
  if (room === 0) return 0;
  const ref = horizon.ref > 0 ? horizon.ref : 1;
  const shorten = horizon.shorten > 0 ? horizon.shorten : 0;
  const accel = Math.hypot(state.ax, state.ay);
  const factor = 1 / (1 + (shorten * accel) / ref);
  let seconds = horizon.seconds * factor;
  if (horizon.oneOrbit) {
    const period = dominantPeriod(state, config);
    if (period !== null && period > 0) seconds = Math.min(seconds, period);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  const steps = Math.floor(seconds / config.dt + 1e-12);
  return Math.max(1, Math.min(room, steps));
}

/**
 * Most steps a preview will integrate, measured from the plan origin.
 * The stroke buffer is smaller (`theme.path.maxSamples`); a longer path is
 * drawn with a stride. Every integrated step still uses `config.dt`.
 */
export const PREDICTION_STEP_CAP = 48_000;

/** World units of level diagonal per second of preview at the slider's maximum. */
const PREVIEW_EXTENT_PER_SECOND = 40;

/** Steps covered by `seconds` at `dt`. At least one. Does not apply the step cap. */
export function secondsToSteps(seconds: number, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.floor(seconds / dt + 1e-12));
}

/**
 * Coast length the slider asks for, in steps.
 * `null` is today's look-ahead (`horizonSteps`): the level horizon when one
 * is set, otherwise the room until `maxSteps`. A chosen number of seconds is
 * fixed and is not shortened again. Both are capped.
 */
export function extensionSteps(state: SimState, config: SimConfig, previewSeconds: number | null): number {
  const raw = previewSeconds == null ? horizonSteps(state, config) : secondsToSteps(previewSeconds, config.dt);
  return Math.max(1, Math.min(PREDICTION_STEP_CAP, raw));
}

export interface PreviewRange {
  /** Shortest slider value, in seconds. Never above the default. */
  minSeconds: number;
  /** Longest slider value, in seconds. Grows with the level diagonal until the flight and the step cap. */
  maxSeconds: number;
  /** Today's look-ahead, in seconds. The slider starts here. */
  defaultSeconds: number;
}

/** Slider limits for a plan that starts at `state`. */
export function previewRange(state: SimState, config: SimConfig): PreviewRange {
  const dt = config.dt > 0 ? config.dt : 1 / 60;
  const defaultSteps = Math.min(PREDICTION_STEP_CAP, Math.max(1, horizonSteps(state, config)));
  const defaultSeconds = defaultSteps * dt;
  const extent = Math.hypot(config.bounds.maxX - config.bounds.minX, config.bounds.maxY - config.bounds.minY);
  const extentSeconds = extent / PREVIEW_EXTENT_PER_SECOND;
  const flightSeconds = Math.max(0, config.maxSteps - state.step) * dt;
  const capSeconds = PREDICTION_STEP_CAP * dt;
  const maxSeconds = Math.max(defaultSeconds, Math.min(extentSeconds, flightSeconds, capSeconds));
  const minSeconds = Math.min(defaultSeconds, Math.max(dt, 2));
  return { minSeconds, maxSeconds, defaultSeconds };
}

/**
 * Last step the planning line draws.
 * `extension` is the coast after the latest burn, or after `from` when no
 * burn is later. A burn is one instant, so its step is the burn's end.
 * Omit `extension` to use today's look-ahead. The total from `from` never
 * exceeds `PREDICTION_STEP_CAP`, and the line never runs past `maxSteps`.
 */
export function planHorizonEnd(
  from: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  extension?: number,
): number {
  const coast = Math.max(0, Math.min(PREDICTION_STEP_CAP, extension ?? horizonSteps(from, config)));
  let burnEnd = from.step;
  for (let i = 0; i < nodes.length; i++) {
    const step = nodes[i].step;
    if (step > burnEnd) burnEnd = step;
  }
  return Math.min(burnEnd + coast, from.step + PREDICTION_STEP_CAP, config.maxSteps);
}

/** Orbital period of the body that pulls hardest on `state`, or a circular stand-in. */
function dominantPeriod(state: SimState, config: SimConfig): number | null {
  const time = state.step * config.dt;
  const bodies = config.bodies;
  let best = 0;
  let period: number | null = null;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const pose = body.orbit ? bodyPose(body, time, bodies) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const rx = pose.x - state.x;
    const ry = pose.y - state.y;
    const r2 = rx * rx + ry * ry;
    if (r2 < 1e-12 || body.mass <= 0) continue;
    const mu = gravityConstant(config) * body.mass;
    const accel = mu / r2;
    if (accel <= best) continue;
    best = accel;
    const r = Math.sqrt(r2);
    const vx = state.vx - pose.vx;
    const vy = state.vy - pose.vy;
    const energy = (vx * vx + vy * vy) / 2 - mu / r;
    const semi = energy < -1e-9 ? -mu / (2 * energy) : r;
    period = 2 * Math.PI * Math.sqrt((semi * semi * semi) / mu);
  }
  return period;
}

/**
 * Deterministic prediction of `nodes`, with the state at each node cached.
 * Pass `reuse` after an edit so nodes before the edit are not resimulated.
 * The returned path matches `flyPlan` step for step. The line stops at
 * `planHorizonEnd`. Samples up to that stop still match the flight.
 * `extension` is the slider's coast; omit it for today's look-ahead.
 */
export function predictPlan(
  from: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  reuse?: PlanReuse,
  extension?: number,
): PlanForecast {
  const active = reuse !== undefined && reuseIsValid(nodes, reuse) ? reuse : undefined;
  const kept: NodeSnapshot[] = [];
  let state: SimState;
  let startIndex: number;
  let approach: PathSample[];
  // False while `approach` still aliases a cached array. The first write copies it.
  let approachOwned: boolean;

  if (active?.kind === "burn") {
    for (let i = 0; i < active.from; i++) kept.push(active.snapshots[i]);
    const snap = active.snapshots[active.from];
    state = cloneState(snap.before);
    startIndex = active.from;
    approach = snap.approach;
    approachOwned = false;
  } else if (active && active.kind === "coast" && active.from > 0) {
    for (let i = 0; i < active.from; i++) kept.push(active.snapshots[i]);
    const previous = active.snapshots[active.from - 1];
    state = cloneState(previous.after);
    startIndex = active.from;
    approach = [];
    approachOwned = true;
  } else {
    state = cloneState(from);
    startIndex = 0;
    approach = [];
    approachOwned = true;
  }

  const fresh: Array<NodeSnapshot | undefined> = new Array(Math.max(0, nodes.length - startIndex));
  const cursor = { index: startIndex };
  if (state.status === "flying") {
    const hooks: PlanHooks = {
      onBurn: (index, before, after) => {
        const node = nodes[index];
        fresh[index - startIndex] = {
          step: node.step,
          dvx: node.dvx,
          dvy: node.dvy,
          before,
          after,
          approach,
          reached: true,
        };
        approach = [];
        approachOwned = true;
      },
      onIntegrated: (integrated) => {
        if (!approachOwned) {
          approach = approach.slice();
          approachOwned = true;
        }
        approach.push({ x: integrated.x, y: integrated.y, step: integrated.step, rate: integrated.rate });
      },
    };
    const end = planHorizonEnd(from, config, nodes, extension);
    let guard = 0;
    const guardLimit = config.maxSteps + nodes.length + 2;
    while (state.status === "flying" && state.step <= end && guard++ <= guardLimit) {
      if (state.step === end && !nodeAtStep(nodes, state.step)) break;
      advancePlan(state, config, nodes, cursor, hooks);
    }
  }

  const tail = approach;
  for (let i = startIndex; i < nodes.length; i++) {
    if (!fresh[i - startIndex]) fresh[i - startIndex] = unreachedSnapshot(nodes[i], state);
  }
  const snapshots = kept.concat(fresh as NodeSnapshot[]);
  const path: PathSample[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap.reached) continue;
    for (let j = 0; j < snap.approach.length; j++) path.push(snap.approach[j]);
  }
  for (let i = 0; i < tail.length; i++) path.push(tail[i]);

  const summary = predictionFrom(state, config, path);
  return {
    ...summary,
    snapshots,
    tail,
    final: cloneState(state),
  };
}

/** Minimum distance from sampled positions to a point. */
export function closestApproach(path: readonly Vec2[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const dx = path[i].x - x;
    const dy = path[i].y - y;
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}
