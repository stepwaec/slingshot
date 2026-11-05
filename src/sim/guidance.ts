import {
  advancePlan,
  bodyPose,
  burnScale,
  cloneState,
  gravityConstant,
  planHorizonEnd,
  predictPlan,
  type Body,
  type BurnNode,
  type FlightStatus,
  type PathSample,
  type SimConfig,
  type SimState,
} from "./physics";

/**
 * Optional Moon guidance.
 *
 * The offer is a ghost. Accept inserts ordinary boost burns; nothing here
 * pushes the ship. The same `predictPlan` / `step` pair flies the result,
 * so skim, drag and the rest stay in the prediction.
 *
 * Capture is one circularising burn where the inbound pass crosses
 * `CAPTURE_ALTITUDE`. On the Mission 1 departure that is the last step
 * before impact: altitudes 32 and 36 complete a lunar lap, and 40 does not.
 * Flyby is one tangential burn at the capture-sphere entry that moves
 * periapsis to `FLYBY_ALTITUDE`, checked against the real closest approach.
 * The coast in from Earth stays the player's.
 */

/** Inbound radius where a circular burn still finishes a lunar lap. */
const CAPTURE_ALTITUDE = 34;
/** Clean flyby periapsis: above the surface, inside the capture sphere. */
const FLYBY_ALTITUDE = 44;
/** How far the flown periapsis may sit from `FLYBY_ALTITUDE`. */
const FLYBY_TOLERANCE = 4;
/** Real-approach corrections after the osculating guess. */
const FLYBY_POLISH = 3;

export type GuideIntent = "flyby" | "capture";

export interface GuideOption {
  intent: GuideIntent;
  /** Burns to merge into the plan. Same shape as a maneuver node. */
  burns: BurnNode[];
  /** Inertial samples of the plan with those burns. Drawn with the framed path. */
  path: PathSample[];
}

export interface GuidePlan {
  bodyId: string;
  bodyName: string;
  options: GuideOption[];
}

interface Room {
  burnLimit: number;
  extension: number;
}

interface ForecastLike {
  path: readonly PathSample[];
  status: FlightStatus;
  lostReason: string | null;
  final: { leg: number };
}

interface Pass {
  entry: SimState | null;
  low: SimState | null;
  closest: SimState | null;
  closestR: number;
}

interface Rel {
  r: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  vt: number;
  vr: number;
  mu: number;
}

/** Moon only. Other moons wait. */
function moonBody(config: SimConfig): Body | null {
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.id === "luna" && body.kind === "moon" && body.captureRadius) return body;
  }
  return null;
}

function distanceTo(state: { x: number; y: number }, body: Body, config: SimConfig, step: number): number {
  const g = gravityConstant(config);
  const pose = bodyPose(body, step * config.dt, config.bodies, g);
  return Math.hypot(state.x - pose.x, state.y - pose.y);
}

function relTo(state: SimState, body: Body, config: SimConfig): Rel | null {
  const g = gravityConstant(config);
  const pose = bodyPose(body, state.step * config.dt, config.bodies, g);
  const rx = state.x - pose.x;
  const ry = state.y - pose.y;
  const r = Math.hypot(rx, ry);
  if (!(r > 1e-8) || !(body.mass > 0)) return null;
  const vx = state.vx - pose.vx;
  const vy = state.vy - pose.vy;
  const h = rx * vy - ry * vx;
  const tx = h >= 0 ? -ry / r : ry / r;
  const ty = h >= 0 ? rx / r : -rx / r;
  return {
    r,
    vx,
    vy,
    tx,
    ty,
    vt: vx * tx + vy * ty,
    vr: (vx * rx + vy * ry) / r,
    mu: g * body.mass,
  };
}

function safeRadius(body: Body, config: SimConfig): number {
  return body.radius + config.periapsisMargin;
}

function futureCount(nodes: readonly BurnNode[], fromStep: number): number {
  let count = 0;
  for (let i = 0; i < nodes.length; i++) if (nodes[i].step >= fromStep) count += 1;
  return count;
}

/** Insert `burns`, or replace a node that already sits on that step. */
export function mergeGuideBurns(nodes: readonly BurnNode[], burns: readonly BurnNode[]): BurnNode[] {
  const next = nodes.map((node) => ({ step: node.step, dvx: node.dvx, dvy: node.dvy }));
  for (let i = 0; i < burns.length; i++) {
    const burn = burns[i];
    const at = next.findIndex((node) => node.step === burn.step);
    const copy = { step: burn.step, dvx: burn.dvx, dvy: burn.dvy };
    if (at >= 0) next[at] = copy;
    else next.push(copy);
  }
  next.sort((a, b) => a.step - b.step);
  return next;
}

function fits(nodes: readonly BurnNode[], fromStep: number, limit: number): boolean {
  return futureCount(nodes, fromStep) <= limit;
}

function burnsAreFuture(burns: readonly BurnNode[], fromStep: number): boolean {
  for (let i = 0; i < burns.length; i++) {
    const burn = burns[i];
    if (burn.step < fromStep) return false;
    if (!Number.isFinite(burn.dvx) || !Number.isFinite(burn.dvy)) return false;
  }
  return burns.length > 0;
}

/**
 * The pass already finishes the Moon capture, so another burn would stack
 * on a solved arrival.
 */
function captureSettled(from: SimState, predicted: ForecastLike): boolean {
  if (predicted.final.leg > from.leg) return true;
  return predicted.status === "won";
}

function pathEnters(
  path: readonly PathSample[],
  fromStep: number,
  body: Body,
  config: SimConfig,
): { distance: number; atStart: boolean } | null {
  const limit = body.captureRadius ?? 0;
  let best = Infinity;
  let bestStep = -1;
  let firstStep = -1;
  for (let i = 0; i < path.length; i++) {
    const sample = path[i];
    if (sample.step < fromStep) continue;
    if (firstStep < 0) firstStep = sample.step;
    const distance = distanceTo(sample, body, config, sample.step);
    if (distance < best) {
      best = distance;
      bestStep = sample.step;
    }
  }
  if (!(best <= limit + 1e-3) || bestStep < 0) return null;
  return { distance: best, atStart: bestStep === firstStep };
}

function closestDistance(path: readonly PathSample[], body: Body, config: SimConfig, fromStep: number): number {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const sample = path[i];
    if (sample.step < fromStep) continue;
    const distance = distanceTo(sample, body, config, sample.step);
    if (distance < best) best = distance;
  }
  return best;
}

function leavingNow(from: SimState, body: Body, config: SimConfig, approach: { distance: number; atStart: boolean }): boolean {
  if (!approach.atStart || !(approach.distance > CAPTURE_ALTITUDE + 4)) return false;
  const rel = relTo(from, body, config);
  return rel !== null && rel.vr > 0.25;
}

/**
 * Walk the current plan once. `entry` is the capture sphere. `low` is the
 * inbound crossing of the circularise altitude, before that step burns.
 */
function surveyPass(from: SimState, config: SimConfig, nodes: readonly BurnNode[], body: Body, extension: number): Pass {
  const state = cloneState(from);
  const cursor = { index: 0 };
  const end = planHorizonEnd(from, config, nodes, extension);
  const capture = body.captureRadius ?? 0;
  const safe = safeRadius(body, config);
  let prev = Infinity;
  let entry: SimState | null = null;
  let low: SimState | null = null;
  let closest: SimState | null = null;
  let closestR = Infinity;
  let inside = false;

  while (state.status === "flying" && state.step <= end) {
    const r = distanceTo(state, body, config, state.step);
    if (r < closestR) {
      closestR = r;
      closest = cloneState(state);
    }
    if (!entry && prev > capture && r <= capture) entry = cloneState(state);
    if (!low && prev > CAPTURE_ALTITUDE && r <= CAPTURE_ALTITUDE && r > safe) low = cloneState(state);
    if (r <= capture) inside = true;
    if (inside && entry && r > closestR + 1.5 && r > prev) break;
    prev = r;
    if (state.step >= end) break;
    advancePlan(state, config, nodes, cursor);
  }

  return { entry, low, closest, closestR };
}

function circularise(state: SimState, body: Body, config: SimConfig): BurnNode | null {
  const rel = relTo(state, body, config);
  if (!rel) return null;
  const scale = burnScale(config);
  if (!(scale > 0)) return null;
  const speed = Math.sqrt(rel.mu / rel.r);
  return {
    step: state.step,
    dvx: (rel.tx * speed - rel.vx) / scale,
    dvy: (rel.ty * speed - rel.vy) / scale,
  };
}

function inCaptureBand(r: number, body: Body, config: SimConfig): boolean {
  return r > safeRadius(body, config) && r <= CAPTURE_ALTITUDE + 4;
}

function captures(from: SimState, predicted: ForecastLike): boolean {
  if (predicted.status === "crashed") return false;
  return predicted.final.leg > from.leg || predicted.status === "won";
}

function leftSphere(path: readonly PathSample[], body: Body, config: SimConfig, afterStep: number): boolean {
  const capture = body.captureRadius ?? 0;
  let inside = false;
  for (let i = 0; i < path.length; i++) {
    const sample = path[i];
    if (sample.step < afterStep) continue;
    const distance = distanceTo(sample, body, config, sample.step);
    if (distance <= capture) inside = true;
    else if (inside) return true;
  }
  return false;
}

function cleanFlyby(from: SimState, predicted: ForecastLike, near: number, body: Body, config: SimConfig): boolean {
  if (predicted.status === "crashed" || predicted.status === "won") return false;
  if (predicted.final.leg > from.leg) return false;
  const safe = safeRadius(body, config);
  const capture = body.captureRadius ?? 0;
  if (!(near > safe) || !(near <= capture)) return false;
  if (predicted.lostReason === "flyby") return true;
  return leftSphere(predicted.path, body, config, from.step);
}

function alreadyCleanFlyby(from: SimState, predicted: ForecastLike, body: Body, config: SimConfig): boolean {
  const near = closestDistance(predicted.path, body, config, from.step);
  return cleanFlyby(from, predicted, near, body, config) && predicted.lostReason === "flyby";
}

function osculatingPeriapsis(vr: number, vt: number, r: number, mu: number): number {
  const h = r * vt;
  const energy = (vr * vr + vt * vt) / 2 - mu / r;
  const e2 = 1 + (2 * energy * h * h) / (mu * mu);
  const eccentricity = Math.sqrt(Math.max(0, e2));
  if (energy < -1e-9) return (-mu / (2 * energy)) * (1 - Math.min(eccentricity, 0.999999));
  const denom = mu * (1 + eccentricity);
  if (!(denom > 0)) return Infinity;
  return (h * h) / denom;
}

/** Tangential delta-v whose osculating periapsis is `target`. */
function tangentialAim(rel: Rel, target: number): number {
  let lo = -Math.max(6, Math.abs(rel.vt));
  let hi = Math.max(8, Math.sqrt(rel.mu / rel.r));
  for (let expand = 0; expand < 4; expand++) {
    const low = osculatingPeriapsis(rel.vr, rel.vt + lo, rel.r, rel.mu);
    const high = osculatingPeriapsis(rel.vr, rel.vt + hi, rel.r, rel.mu);
    if (low <= target && high >= target) break;
    lo -= 4;
    hi += 4;
  }
  let best = 0;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const peri = osculatingPeriapsis(rel.vr, rel.vt + mid, rel.r, rel.mu);
    if (peri < target) lo = mid;
    else hi = mid;
    best = mid;
  }
  if (best < -30) return -30;
  if (best > 30) return 30;
  return best;
}

function flybyAnchor(pass: Pass, from: SimState, body: Body, config: SimConfig): SimState | null {
  const safe = safeRadius(body, config);
  const capture = body.captureRadius ?? 0;
  if (pass.entry && pass.entry.step >= from.step) {
    const r = distanceTo(pass.entry, body, config, pass.entry.step);
    if (r > safe + 4) return pass.entry;
  }
  const here = distanceTo(from, body, config, from.step);
  if (here > safe + 4 && here <= capture + 1e-3) return from;
  return null;
}

function buildCapture(
  from: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  body: Body,
  pass: Pass,
  room: Room,
): GuideOption | null {
  let at: SimState | null = null;
  if (pass.low && pass.low.step >= from.step) {
    const r = distanceTo(pass.low, body, config, pass.low.step);
    if (inCaptureBand(r, body, config)) at = pass.low;
  }
  if (!at && pass.closest && pass.closest.step >= from.step && inCaptureBand(pass.closestR, body, config)) {
    at = pass.closest;
  }
  if (!at) return null;
  const burn = circularise(at, body, config);
  if (!burn || !burnsAreFuture([burn], from.step)) return null;
  const merged = mergeGuideBurns(nodes, [burn]);
  if (!fits(merged, from.step, room.burnLimit)) return null;
  const predicted = predictPlan(from, config, merged, undefined, room.extension);
  if (!captures(from, predicted)) return null;
  return { intent: "capture", burns: [burn], path: predicted.path };
}

function buildFlyby(
  from: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  body: Body,
  pass: Pass,
  predicted: ForecastLike,
  room: Room,
): GuideOption | null {
  if (alreadyCleanFlyby(from, predicted, body, config)) return null;
  const anchor = flybyAnchor(pass, from, body, config);
  if (!anchor) return null;
  const rel = relTo(anchor, body, config);
  if (!rel) return null;
  const safe = safeRadius(body, config);
  let target = FLYBY_ALTITUDE;
  const ceiling = rel.r - 2;
  if (target > ceiling) target = ceiling;
  if (!(target > safe)) return null;
  const scale = burnScale(config);
  if (!(scale > 0)) return null;

  let delta = tangentialAim(rel, target);
  let gain = 0.18;
  let previousError = Infinity;
  let best: GuideOption | null = null;
  let bestError = Infinity;

  for (let i = 0; i < FLYBY_POLISH; i++) {
    const burn = { step: anchor.step, dvx: (rel.tx * delta) / scale, dvy: (rel.ty * delta) / scale };
    if (!burnsAreFuture([burn], from.step)) return best;
    const merged = mergeGuideBurns(nodes, [burn]);
    if (!fits(merged, from.step, room.burnLimit)) return best;
    const forecast = predictPlan(from, config, merged, undefined, room.extension);
    const near = closestDistance(forecast.path, body, config, anchor.step);
    const error = target - near;
    if (cleanFlyby(from, forecast, near, body, config) && Math.abs(error) < bestError) {
      bestError = Math.abs(error);
      best = { intent: "flyby", burns: [burn], path: forecast.path };
      if (bestError <= FLYBY_TOLERANCE) return best;
    }
    if (Math.abs(error) > Math.abs(previousError) + 1) gain *= -0.5;
    previousError = error;
    delta += error * gain;
    if (delta < -30) delta = -30;
    if (delta > 30) delta = 30;
  }
  return best;
}

/**
 * Ghost burns for a Moon pass that is still ahead and not already captured.
 * `predicted` is the plan as drawn. This does not write it.
 */
export function guideOffer(
  from: SimState,
  config: SimConfig,
  nodes: readonly BurnNode[],
  predicted: ForecastLike,
  room: Room,
): GuidePlan | null {
  const moon = moonBody(config);
  if (!moon) return null;
  const approach = pathEnters(predicted.path, from.step, moon, config);
  if (!approach) return null;
  if (captureSettled(from, predicted)) return null;
  if (leavingNow(from, moon, config, approach)) return null;

  const pass = surveyPass(from, config, nodes, moon, room.extension);
  const options: GuideOption[] = [];
  const flyby = buildFlyby(from, config, nodes, moon, pass, predicted, room);
  if (flyby) options.push(flyby);
  const capture = buildCapture(from, config, nodes, moon, pass, room);
  if (capture) options.push(capture);
  if (options.length === 0) return null;
  return { bodyId: moon.id, bodyName: moon.name, options };
}
