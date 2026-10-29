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
 * k onward and reuses the path before it. A configured horizon stops the
 * predicted line early; the live flight does not.
 *
 * Each step also advances two clocks. Outside time is coordinate time
 * (`step * dt`): Home and Planet X share that one frame. Ship time is the
 * proper time along the trajectory. With the default knobs,
 * `dτ/dt = sqrt(1 - 2 Φ_depth / c² - v² / c²)`, clamped at 0.
 * A finite `dilationCap` replaces that hard floor with a smooth saturation.
 * `gravityScale`, `eps`, and `p` reshape the force. Φ is the integral of the
 * force, so dilation and the gravity map stay on the same field.
 * Prediction and flight both read these knobs off `SimConfig`.
 * This module does not touch the DOM.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type BodyKind = "home" | "star" | "target" | "moon" | "blackhole" | "planet";

/**
 * Visual recipe for a body. Omitted looks use the kind's original disc.
 * Stars: `sun`, `binary-hot`, `binary-cool`, `white-dwarf`, `red-giant`.
 * Planets and moons: `gas-giant`, `moon`, `moon-icy`, `moon-volcanic`, `dwarf`.
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
] as const;

export type BodyLook = (typeof BODY_LOOKS)[number];

/**
 * Circular orbit. Position at time t is the center plus
 * `radius * (cos(phase + omega t), sin(phase + omega t))`.
 * `centerId` orbits another body. Otherwise the center is fixed at `cx`, `cy`.
 */
export interface BodyOrbit {
  centerId?: string;
  cx?: number;
  cy?: number;
  radius: number;
  /** Radians at t = 0. 0 sits on the center's +x side. */
  phase: number;
  /** Radians per second. Positive is counterclockwise. */
  omega: number;
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
}

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
  /** Stored for a later package. The integrator does not read this. */
  tidalStrength?: number;
  /**
   * Scales drag inside a body's `atmosphereRadius`. Omitted or 0 leaves
   * velocity untouched, so stock levels stay bit-identical. The force is
   * opposite the ship's velocity relative to the body, so it only slows
   * that relative motion. Prediction and flight both apply it in `step`.
   */
  dragStrength?: number;
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

export type LostReason = "bounds" | "timeout" | "flyby";

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

export const SIM_SPEEDS = [1, 2, 4] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

/** Fixed steps to run for one rendered frame at the given sim speed. */
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
  return { ...state };
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
 */
export function bodyPose(body: Body, time: number, bodies: readonly Body[]): Pose {
  if (!body.orbit) return { x: body.x, y: body.y, vx: 0, vy: 0 };
  return poseFromOrbit(body, time, bodies, 0);
}

function poseFromOrbit(body: Body, time: number, bodies: readonly Body[], depth: number): Pose {
  const orbit = body.orbit;
  if (!orbit || depth > 4) return { x: body.x, y: body.y, vx: 0, vy: 0 };
  let cx = orbit.cx ?? 0;
  let cy = orbit.cy ?? 0;
  let cvx = 0;
  let cvy = 0;
  if (orbit.centerId) {
    const center = findBody(bodies, orbit.centerId);
    if (center) {
      const pose = center.orbit ? poseFromOrbit(center, time, bodies, depth + 1) : { x: center.x, y: center.y, vx: 0, vy: 0 };
      cx = pose.x;
      cy = pose.y;
      cvx = pose.vx;
      cvy = pose.vy;
    }
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

function bodyPoint(body: Body, time: number, bodies: readonly Body[]): { x: number; y: number } {
  if (!body.orbit) return { x: body.x, y: body.y };
  const pose = bodyPose(body, time, bodies);
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
    const point = bodyPoint(body, time, bodies);
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
    const point = bodyPoint(body, time, bodies);
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
  if (eps === 0 && p === 2) return newtonAcceleration(x, y, g, config, time);
  return shapedAcceleration(x, y, g, eps, p, config, time);
}

/** Σ G M / r. Same operations as the pre-knob potential. */
function newtonPotential(x: number, y: number, g: number, config: SimConfig, time: number): number {
  let phi = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const point = bodyPoint(body, time, bodies);
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
    const point = bodyPoint(body, time, bodies);
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
  if (eps === 0 && p === 2) return newtonPotential(x, y, g, config, time);
  return shapedPotential(x, y, g, eps, p, config, time);
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
  if (!body.orbit) {
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
 * One velocity-Verlet step of size `config.dt`, then crash / capture / lost checks.
 * Burns are not applied here — `advancePlan` applies them before calling `step`.
 * Terminal states are not advanced. `dt` never depends on sim speed.
 * Drag, when a level sets it, is applied at the end of the step so prediction
 * and flight share it.
 */
export function step(state: SimState, config: SimConfig): void {
  if (state.status !== "flying") return;

  const dt = config.dt;
  const t0 = state.step * dt;
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
    const hit = body.orbit
      ? movingCircleEntry(x0, y0, x1, y1, body, t0, t1, bodies, body.radius)
      : circleEntry(x0, y0, x1, y1, body.x, body.y, body.radius);
    if (hit !== null && hit < crashT) {
      crashT = hit;
      crashBody = body.id;
    }
  }

  if (crashBody !== null) {
    const body = bodies.find((item) => item.id === crashBody);
    state.x = x0 + (x1 - x0) * crashT;
    state.y = y0 + (y1 - y0) * crashT;
    if (body) {
      let cx = body.x;
      let cy = body.y;
      if (body.orbit) {
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
    return;
  }

  accrueClocks(state, rateThen, dt);
  state.rate = properTimeRate(state.x, state.y, state.vx, state.vy, config, t1);

  const target = targetBody(config);
  const captureRadius = target?.captureRadius;
  if (target && captureRadius !== undefined) {
    let tx = target.x;
    let ty = target.y;
    let crossed: boolean;
    if (target.orbit) {
      const p1 = bodyPose(target, t1, bodies);
      tx = p1.x;
      ty = p1.y;
      crossed = movingCircleEntry(x0, y0, x1, y1, target, t0, t1, bodies, captureRadius) !== null;
    } else {
      crossed = circleEntry(x0, y0, x1, y1, target.x, target.y, captureRadius) !== null;
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
    state.vx += node.dvx;
    state.vy += node.dvy;
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
 * The returned path matches `flyPlan` step for step. A horizon stops the line
 * at that look-ahead; samples up to the stop still match the flight.
 */
export function predictPlan(
  from: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  reuse?: PlanReuse,
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
    const end = config.horizon ? from.step + horizonSteps(from, config) : Number.POSITIVE_INFINITY;
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
