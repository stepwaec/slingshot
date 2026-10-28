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
  /** Entering this radius around the target is a win. Larger than `radius`. */
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
}

export type FlightStatus = "flying" | "won" | "crashed" | "lost";

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
  lostReason: "bounds" | "timeout" | null;
}

export interface Prediction {
  /** Position after each fixed step, not including the pre-step pose. */
  path: Vec2[];
  status: FlightStatus;
  crashedBodyId: string | null;
  lostReason: "bounds" | "timeout" | null;
  steps: number;
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

/**
 * One velocity-Verlet step of size `config.dt`, then win / crash / lost checks.
 * Terminal states are not advanced further.
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

  let bestT = Infinity;
  let bestKind: "won" | "crashed" | null = null;
  let bestBody: string | null = null;

  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const crashT = circleEntry(x0, y0, x1, y1, body.x, body.y, body.radius);
    if (crashT !== null && crashT < bestT) {
      bestT = crashT;
      bestKind = "crashed";
      bestBody = body.id;
    }
    if (body.id === config.targetId && body.captureRadius !== undefined) {
      const winT = circleEntry(x0, y0, x1, y1, body.x, body.y, body.captureRadius);
      if (winT !== null && winT < bestT) {
        bestT = winT;
        bestKind = "won";
        bestBody = body.id;
      }
    }
  }

  if (bestKind !== null) {
    state.x = x0 + (x1 - x0) * bestT;
    state.y = y0 + (y1 - y0) * bestT;
    const impact = acceleration(state.x, state.y, config);
    state.ax = impact.ax;
    state.ay = impact.ay;
    state.status = bestKind;
    state.crashedBodyId = bestKind === "crashed" ? bestBody : null;
    return;
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

/** Fly until win, crash, or lost. Uses the same frame stepper as live flight. */
export function flyUntilDone(from: SimState, config: SimConfig, stepsThisFrame: number): Prediction {
  const state = cloneState(from);
  const path: Vec2[] = [];
  const frame: Vec2[] = [];
  while (state.status === "flying") {
    advanceFrame(state, config, stepsThisFrame, frame);
    for (let i = 0; i < frame.length; i++) path.push(frame[i]);
  }
  return {
    path,
    status: state.status,
    crashedBodyId: state.crashedBodyId,
    lostReason: state.lostReason,
    steps: state.step,
  };
}

/**
 * Planning prediction. Identical integrator to flight; always one fixed step
 * per internal frame so the sampled path is the full step-by-step trajectory.
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
