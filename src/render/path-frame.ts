import { bodyPose, bodyPresent, type Body, type Vec2 } from "../sim/physics";

/**
 * The predicted path is drawn in two frames.
 *
 * Before the Moon dominates, samples stay where the sim put them. A circular
 * Earth orbit is a cycloid, because Earth is moving around the Sun. Sprites
 * stay at the current time.
 *
 * Once a moon's pull leads, that stretch is drawn in the moon's frame and
 * anchored on the moon's position at closest approach, which is where the
 * ghost sits. A capture then reads as a closed curve around that one ghost.
 * The handoff is a smooth weight, so the stroke does not jump.
 *
 * Nothing here writes the sim.
 */

export interface DrawnPoint {
  x: number;
  y: number;
  /** Moon the sample was drawn against. Empty while the sample stays in world space. */
  bodyId: string;
}

/** Where the ship is nearest a moving body, and that body in world space. */
export interface ApproachMark {
  bodyId: string;
  step: number;
  x: number;
  y: number;
}

export interface FrameView {
  mode: string;
  ship: { step: number };
  level: { bodies: readonly Body[]; g: number; dt: number };
  prediction?: { path: readonly { x: number; y: number; step: number }[] };
}

/**
 * Pull ratio where the moon frame begins, and where it is complete.
 * Below the low end the sample stays in world space. Above the high end it
 * sits fully on the closest-approach ghost. Between them the weight eases,
 * which is what keeps the stroke continuous at the handoff.
 */
const FRAME_LO = 0.75;
const FRAME_HI = 1.15;
/**
 * How fast the frame offset may change, in world units per sample.
 * The handoff can ask for a large shift all at once. Capping the step
 * turns that into a short curve instead of a kink. A settled lunar orbit
 * moves the offset at the Moon's own speed, which is under this cap,
 * so the ellipse stays exact.
 */
const FRAME_SLEW = 0.85;

function frameWeight(ratio: number): number {
  if (!(ratio > FRAME_LO)) return 0;
  if (ratio >= FRAME_HI) return 1;
  const t = (ratio - FRAME_LO) / (FRAME_HI - FRAME_LO);
  return t * t * (3 - 2 * t);
}

/** Clock the body sprites use. Planning holds t = 0. */
export function shownNow(mode: string, shipStep: number, dt: number): number {
  return (mode === "planning" ? 0 : shipStep) * dt;
}

/** A node sits on the drawn plan. The shift is the plan's, at that step. */
export function shownPoint(view: FrameView, x: number, y: number, step: number): Vec2 {
  const path = view.prediction?.path;
  const bodies = view.level.bodies;
  const g = view.level.g;
  const dt = view.level.dt;
  if (path && path.length > 0) {
    const framed = showPath(path, bodies, g, dt, shownNow(view.mode, view.ship.step, dt));
    const at = findStep(path, step);
    if (at >= 0) {
      return { x: x + framed[at].x - path[at].x, y: y + framed[at].y - path[at].y };
    }
  }
  const one = showPath([{ x, y, step }], bodies, g, dt, 0);
  return { x: one[0].x, y: one[0].y };
}

/** Draw these samples as their own path. A drag rail is not the plan. */
export function shownPath(
  view: FrameView,
  samples: readonly { x: number; y: number; step: number }[],
): DrawnPoint[] {
  return showPath(samples, view.level.bodies, view.level.g, view.level.dt, shownNow(view.mode, view.ship.step, view.level.dt));
}

const frameCache = new WeakMap<object, DrawnPoint[]>();

/** Drawn positions. Cached on the sample array. */
export function showPath(
  samples: readonly { x: number; y: number; step: number }[],
  bodies?: readonly Body[],
  g = 1,
  dt = 1 / 60,
  _now?: number,
): DrawnPoint[] {
  if (!bodies || bodies.length === 0) {
    const plain: DrawnPoint[] = new Array(samples.length);
    for (let i = 0; i < samples.length; i++) plain[i] = { x: samples[i].x, y: samples[i].y, bodyId: "" };
    return plain;
  }
  return framedSource(samples, bodies, g, dt);
}

interface MoonAnchor {
  id: string;
  x: number;
  y: number;
}

function framedSource(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
): DrawnPoint[] {
  const hit = frameCache.get(samples);
  if (hit) return hit;
  const anchors = moonAnchors(samples, bodies, g, dt);
  const points: DrawnPoint[] = new Array(samples.length);
  let ox = 0;
  let oy = 0;
  let moonId = "";
  for (let i = 0; i < samples.length; i++) {
    const target = targetOffset(samples[i], bodies, g, dt, anchors);
    if (i === 0) {
      ox = target.x;
      oy = target.y;
    } else {
      const dx = target.x - ox;
      const dy = target.y - oy;
      const dist = Math.hypot(dx, dy);
      if (dist > FRAME_SLEW) {
        ox += (dx / dist) * FRAME_SLEW;
        oy += (dy / dist) * FRAME_SLEW;
      } else {
        ox = target.x;
        oy = target.y;
      }
    }
    if (target.bodyId) moonId = target.bodyId;
    if (!(Math.hypot(ox, oy) > 1e-3)) {
      ox = 0;
      oy = 0;
    }
    points[i] = {
      x: samples[i].x + ox,
      y: samples[i].y + oy,
      bodyId: ox !== 0 || oy !== 0 ? moonId : "",
    };
  }
  frameCache.set(samples, points);
  return points;
}

function findStep(samples: readonly { step: number }[], step: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const found = samples[mid].step;
    if (found === step) return mid;
    if (found < step) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Closest-approach position of each moon, in world space. That is the ghost. */
function moonAnchors(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
): MoonAnchor[] {
  const marks = pathApproaches(samples, bodies, g, dt);
  const anchors: MoonAnchor[] = [];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    let moon = false;
    for (let b = 0; b < bodies.length; b++) {
      if (bodies[b].id === mark.bodyId && bodies[b].kind === "moon") moon = true;
    }
    if (moon) anchors.push({ id: mark.bodyId, x: mark.x, y: mark.y });
  }
  return anchors;
}

function targetOffset(
  sample: { x: number; y: number; step: number },
  bodies: readonly Body[],
  g: number,
  dt: number,
  anchors: readonly MoonAnchor[],
): { x: number; y: number; bodyId: string } {
  if (anchors.length === 0) return { x: 0, y: 0, bodyId: "" };
  const time = sample.step * dt;
  let moon: Body | null = null;
  let moonPull = 0;
  let moonX = 0;
  let moonY = 0;
  let other = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!(body.mass > 0) || !bodyPresent(body, time)) continue;
    const pose = bodyPose(body, time, bodies, g);
    const dx = sample.x - pose.x;
    const dy = sample.y - pose.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-18) continue;
    const pull = (g * body.mass) / r2;
    if (body.kind === "moon") {
      if (pull > moonPull) {
        if (moon) other = Math.max(other, moonPull);
        moon = body;
        moonPull = pull;
        moonX = pose.x;
        moonY = pose.y;
      } else if (pull > other) other = pull;
    } else if (pull > other) other = pull;
  }
  if (!moon || !(moonPull > 0)) return { x: 0, y: 0, bodyId: "" };
  let anchor: MoonAnchor | null = null;
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].id === moon.id) anchor = anchors[i];
  }
  if (!anchor) return { x: 0, y: 0, bodyId: "" };
  const ratio = other > 0 ? moonPull / other : Number.POSITIVE_INFINITY;
  const weight = frameWeight(ratio);
  if (!(weight > 0)) return { x: 0, y: 0, bodyId: "" };
  return {
    x: weight * (anchor.x - moonX),
    y: weight * (anchor.y - moonY),
    bodyId: moon.id,
  };
}

const approachCache = new WeakMap<object, ApproachMark[]>();

/** Closest approach of the ship to each moving body, in world coordinates. */
export function pathApproaches(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
  _now?: number,
): ApproachMark[] {
  const hit = approachCache.get(samples);
  if (hit) return hit;
  const marks: ApproachMark[] = [];
  for (let b = 0; b < bodies.length; b++) {
    const body = bodies[b];
    if (!body.orbit && !body.drift) continue;
    if (!(body.mass > 0) || samples.length === 0) continue;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const pose = bodyPose(body, samples[i].step * dt, bodies, g);
      const d = Math.hypot(samples[i].x - pose.x, samples[i].y - pose.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const step = samples[best].step;
    const pose = bodyPose(body, step * dt, bodies, g);
    marks.push({ bodyId: body.id, step, x: pose.x, y: pose.y });
  }
  approachCache.set(samples, marks);
  return marks;
}
