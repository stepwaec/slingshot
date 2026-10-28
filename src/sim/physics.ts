/**
 * Deterministic Newtonian flight.
 *
 * Prediction and live flight both advance only through `step` / `advanceFrame`.
 * Sim speed changes how many fixed steps run per frame. It never changes `dt`.
 * This module does not touch the DOM.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type BodyKind = "home" | "star" | "target";

export interface Body {
  id: string;
  name: string;
  kind: BodyKind;
  x: number;
  y: number;
  mass: number;
  /** Surface radius. Touching it crashes the ship. */
  radius: number;
  /**
   * Sphere of influence around the target. Entering it pauses for one capture
   * burn. A captured orbit must keep its apoapsis inside this radius.
   */
  captureRadius?: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
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
}

export type FlightStatus = "flying" | "capture" | "won" | "crashed" | "lost";

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
  /** Set once the capture burn has been fired or skipped. */
  captureResolved: boolean;
}

export interface Prediction {
  /** Position after each fixed step, not including the pre-step pose. */
  path: Vec2[];
  status: FlightStatus;
  crashedBodyId: string | null;
  lostReason: LostReason | null;
  steps: number;
  /** Closed orbit around the target when the flight ends captured. */
  orbit: Vec2[] | null;
}

export const SIM_SPEEDS = [1, 2, 4] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

/** Fixed steps to run for one rendered frame at the given sim speed. */
export function stepsPerFrame(speed: SimSpeed): number {
  return speed;
}

export function cloneState(state: SimState): SimState {
  return { ...state };
}

export function acceleration(
  x: number,
  y: number,
  config: SimConfig,
): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  const g = config.g;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const dx = body.x - x;
    const dy = body.y - y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-12) continue;
    const invR = 1 / Math.sqrt(r2);
    const scale = g * body.mass * invR * invR * invR;
    ax += dx * scale;
    ay += dy * scale;
  }
  return { ax, ay };
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
    captureResolved: false,
  };
}

export function fuelCost(dvx: number, dvy: number, fuelPerDv: number): number {
  return fuelPerDv * Math.hypot(dvx, dvy);
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

export function clampDv(
  dvx: number,
  dvy: number,
  fuel: number,
  fuelPerDv: number,
): Vec2 {
  const mag = Math.hypot(dvx, dvy);
  const max = fuelPerDv > 0 ? fuel / fuelPerDv : 0;
  if (mag === 0 || mag <= max) return { x: dvx, y: dvy };
  const scale = max / mag;
  return { x: dvx * scale, y: dvy * scale };
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

export interface OrbitElements {
  bound: boolean;
  energy: number;
  periapsis: number;
  apoapsis: number;
  eccentricity: number;
}

/** Two-body elements of the ship relative to one fixed body. */
export function orbitAbout(state: SimState, body: Body, g: number): OrbitElements | null {
  const rx = state.x - body.x;
  const ry = state.y - body.y;
  const r = Math.hypot(rx, ry);
  if (r < 1e-8) return null;
  const mu = g * body.mass;
  if (mu <= 0) return null;
  const energy = (state.vx * state.vx + state.vy * state.vy) / 2 - mu / r;
  const h = rx * state.vy - ry * state.vx;
  const ex = (state.vy * h) / mu - rx / r;
  const ey = (-state.vx * h) / mu - ry / r;
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
  const elements = orbitAbout(state, body, config.g);
  if (!elements?.bound) return false;
  return (
    elements.energy < 0 &&
    elements.periapsis > body.radius + config.periapsisMargin &&
    elements.apoapsis <= body.captureRadius + 1e-3
  );
}

/** Points around the osculating ellipse, or null when the ship is not bound. */
export function sampleOrbit(state: SimState, body: Body, g: number, count = 120): Vec2[] | null {
  const elements = orbitAbout(state, body, g);
  if (!elements?.bound) return null;
  const rx = state.x - body.x;
  const ry = state.y - body.y;
  const r = Math.hypot(rx, ry);
  const mu = g * body.mass;
  const h = rx * state.vy - ry * state.vx;
  const ex = (state.vy * h) / mu - rx / r;
  const ey = (-state.vx * h) / mu - ry / r;
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
      x: body.x + radius * (cos * px + sin * tx),
      y: body.y + radius * (cos * py + sin * ty),
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
 * One velocity-Verlet step of size `config.dt`, then capture / crash / lost checks.
 * `capture` pauses on the target's sphere until `resolveCapture`. Terminal states
 * are not advanced. `dt` never depends on sim speed.
 */
export function step(state: SimState, config: SimConfig): void {
  if (state.status !== "flying") return;

  const dt = config.dt;
  const x0 = state.x;
  const y0 = state.y;
  const x1 = x0 + state.vx * dt + 0.5 * state.ax * dt * dt;
  const y1 = y0 + state.vy * dt + 0.5 * state.ay * dt * dt;
  const a1 = acceleration(x1, y1, config);

  state.vx += 0.5 * (state.ax + a1.ax) * dt;
  state.vy += 0.5 * (state.ay + a1.ay) * dt;
  state.ax = a1.ax;
  state.ay = a1.ay;
  state.x = x1;
  state.y = y1;
  state.step += 1;

  let crashT = Infinity;
  let crashBody: string | null = null;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const hit = circleEntry(x0, y0, x1, y1, body.x, body.y, body.radius);
    if (hit !== null && hit < crashT) {
      crashT = hit;
      crashBody = body.id;
    }
  }

  const target = targetBody(config);
  const captureRadius = target?.captureRadius;
  let captureT: number | null = null;
  if (target && captureRadius !== undefined && !state.captureResolved) {
    captureT = circleEntry(x0, y0, x1, y1, target.x, target.y, captureRadius);
  }

  if (crashBody !== null && (captureT === null || crashT <= captureT)) {
    const body = bodies.find((item) => item.id === crashBody);
    state.x = x0 + (x1 - x0) * crashT;
    state.y = y0 + (y1 - y0) * crashT;
    if (body) {
      const dx = state.x - body.x;
      const dy = state.y - body.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 1e-8) {
        state.x = body.x + (dx / distance) * body.radius;
        state.y = body.y + (dy / distance) * body.radius;
      }
    }
    const impact = acceleration(state.x, state.y, config);
    state.ax = impact.ax;
    state.ay = impact.ay;
    state.status = "crashed";
    state.crashedBodyId = crashBody;
    return;
  }

  if (target && captureRadius !== undefined && captureT !== null) {
    const entryX = x0 + (x1 - x0) * captureT;
    const entryY = y0 + (y1 - y0) * captureT;
    placeExactly(state, target, captureRadius, entryX, entryY);
    const impact = acceleration(state.x, state.y, config);
    state.ax = impact.ax;
    state.ay = impact.ay;
    state.status = "capture";
    return;
  }

  if (target && captureRadius !== undefined && state.captureResolved) {
    if (isCapturedOrbit(state, config)) {
      state.status = "won";
      return;
    }
    const outside = Math.hypot(state.x - target.x, state.y - target.y) > captureRadius + 1e-6;
    if (outside) {
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

function placeExactly(state: SimState, body: Body, radius: number, x: number, y: number): void {
  const dx = x - body.x;
  const dy = y - body.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-8) {
    state.x = body.x + radius;
    state.y = body.y;
    return;
  }
  state.x = body.x + (dx / distance) * radius;
  state.y = body.y + (dy / distance) * radius;
}

/**
 * Fire or skip the single capture burn. The ship must be paused in `capture`.
 * A zero burn is a skip. Winning orbits are recognized here, before the next step.
 */
export function resolveCapture(
  state: SimState,
  dvx: number,
  dvy: number,
  fuel: number,
  fuelPerDv: number,
  config: SimConfig,
): ImpulseResult {
  if (state.status !== "capture") return { ok: false, cost: fuelCost(dvx, dvy, fuelPerDv) };
  const applied = tryApplyImpulse(state, dvx, dvy, fuel, fuelPerDv);
  if (!applied.ok) return applied;
  state.captureResolved = true;
  state.status = isCapturedOrbit(state, config) ? "won" : "flying";
  return applied;
}

/** Advance one rendered frame. `stepsThisFrame` is 1, 2, or 4 — `dt` stays fixed. */
export function advanceFrame(
  state: SimState,
  config: SimConfig,
  stepsThisFrame: number,
  samples: Vec2[],
): void {
  samples.length = 0;
  for (let i = 0; i < stepsThisFrame; i++) {
    if (state.status !== "flying") return;
    step(state, config);
    samples.push({ x: state.x, y: state.y });
  }
}

function predictionFrom(state: SimState, config: SimConfig, path: Vec2[]): Prediction {
  const target = targetBody(config);
  const orbit = state.status === "won" && target ? sampleOrbit(state, target, config.g) : null;
  return {
    path,
    status: state.status,
    crashedBodyId: state.crashedBodyId,
    lostReason: state.lostReason,
    steps: state.step,
    orbit,
  };
}

/** Fly until the ship pauses for capture, wins, crashes, or is lost. */
export function flyUntilDone(from: SimState, config: SimConfig, stepsThisFrame: number): Prediction {
  const state = cloneState(from);
  const path: Vec2[] = [];
  const frame: Vec2[] = [];
  while (state.status === "flying") {
    advanceFrame(state, config, stepsThisFrame, frame);
    for (let i = 0; i < frame.length; i++) path.push(frame[i]);
  }
  return predictionFrom(state, config, path);
}

/**
 * Full flight including the capture burn. This is the predictor used once the
 * ship is paused in capture, and the same stepper live flight uses afterward.
 * `stepsThisFrame` is the sim-speed grouping. It does not change `dt`.
 */
export function flyMission(
  from: SimState,
  config: SimConfig,
  stepsThisFrame: number,
  captureDv: Vec2,
  fuel: number,
  fuelPerDv: number,
): Prediction {
  const state = cloneState(from);
  const path: Vec2[] = [];
  const frame: Vec2[] = [];
  let fuelLeft = fuel;
  while (state.status === "flying" || state.status === "capture") {
    if (state.status === "capture") {
      const resolved = resolveCapture(state, captureDv.x, captureDv.y, fuelLeft, fuelPerDv, config);
      if (!resolved.ok) break;
      fuelLeft = resolved.fuel;
      continue;
    }
    const pathLength = path.length;
    advanceFrame(state, config, stepsThisFrame, frame);
    for (let i = 0; i < frame.length; i++) path.push(frame[i]);
    if (path.length === pathLength && state.status === "flying") break;
  }
  return predictionFrom(state, config, path);
}

/**
 * Planning prediction. Identical integrator to flight; always one fixed step
 * per internal frame so the sampled path is the full step-by-step trajectory.
 * Without a capture burn, flight stops when the ship reaches Planet X's sphere.
 */
export function predict(from: SimState, config: SimConfig): Prediction {
  return flyUntilDone(from, config, 1);
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
