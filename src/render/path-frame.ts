import { bodyPose, bodyPresent, type Body, type Pose, type Vec2 } from "../sim/physics";

/**
 * Where a predicted sample is drawn.
 *
 * The sim stores inertial positions. A ship in a circular Earth orbit is
 * correct in that frame, and so is Earth's motion around the Sun. Drawn
 * together, the two motions are a cycloid: about one cusp per Earth orbit
 * across the horizon, a scalloped loop around the Sun. This subtracts the
 * reference body's pose at the sample's own time and adds that body's pose
 * at the clock the sprites use, so a circular orbit closes on the body.
 *
 * The reference is the deepest sphere that contains the sample. The sphere
 * is the patched-conic sphere of influence, widened to the capture zone when
 * that zone is larger, so a stable capture stays with its body. Outside
 * every sphere the strongest pull wins. Crossing a sphere blends the two
 * frames across the outer shell, so the stroke does not jump.
 *
 * Nothing here writes the sim. The samples keep their inertial coordinates.
 */

export interface DrawnPoint {
  x: number;
  y: number;
  /** Body the sample was drawn against. Empty when nothing pulls. */
  bodyId: string;
}

/** Outer fraction of a sphere where the frame blends into its host. */
const SHELL = 0.72;

export interface FrameView {
  mode: string;
  ship: { step: number };
  level: { bodies: readonly Body[]; g: number; dt: number };
}

/** Clock the body sprites use. Planning holds t = 0. */
export function shownNow(mode: string, shipStep: number, dt: number): number {
  return (mode === "planning" ? 0 : shipStep) * dt;
}

export function shownPoint(view: FrameView, x: number, y: number, step: number): Vec2 {
  const drawn = shownPath(view, [{ x, y, step }]);
  return drawn[0];
}

export function shownPath(
  view: FrameView,
  samples: readonly { x: number; y: number; step: number }[],
): DrawnPoint[] {
  return showPath(samples, view.level.bodies, view.level.g, view.level.dt, shownNow(view.mode, view.ship.step, view.level.dt));
}

const cache = new WeakMap<object, { now: number; points: DrawnPoint[] }>();

/** Drawn positions for a path. Cached on the sample array and the anchor time. */
export function showPath(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
): DrawnPoint[] {
  const hit = cache.get(samples);
  if (hit && hit.now === now) return hit.points;
  const refs = refsFor(bodies, g, now);
  const points: DrawnPoint[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    points[i] = drawSample(sample.x, sample.y, sample.step, bodies, g, dt, now, refs);
  }
  cache.set(samples, { now, points });
  return points;
}

interface Ref {
  body: Body;
  radius: number;
  now: Pose;
}

interface Candidate {
  ref: Ref;
  then: Pose;
  dist: number;
  pull: number;
}

function refsFor(bodies: readonly Body[], g: number, now: number): Ref[] {
  const refs: Ref[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!(body.mass > 0)) continue;
    refs.push({
      body,
      radius: referenceRadius(body, bodies),
      now: bodyPose(body, now, bodies, g),
    });
  }
  return refs;
}

/**
 * Patched-conic sphere of influence about the parent, or the capture zone
 * when that is the larger sphere. No parent means no finite sphere.
 */
function referenceRadius(body: Body, bodies: readonly Body[]): number {
  const capture = body.captureRadius ?? 0;
  const orbit = body.orbit;
  const parentId = orbit?.centerId;
  if (!parentId) return capture;
  let parentMass = 0;
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === parentId) {
      parentMass = bodies[i].mass;
      break;
    }
  }
  const axis = orbit.a ?? orbit.radius;
  let soi = 0;
  if (parentMass > 0 && body.mass > 0 && axis > 0) soi = axis * (body.mass / parentMass) ** 0.4;
  return Math.max(soi, capture);
}

function drawSample(
  x: number,
  y: number,
  step: number,
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
  refs: readonly Ref[],
): DrawnPoint {
  const time = step * dt;
  let inner: Candidate | null = null;
  let secondSphere: Candidate | null = null;
  let strongest: Candidate | null = null;
  let nextPull: Candidate | null = null;
  const byId = new Map<string, Candidate>();
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!bodyPresent(ref.body, time)) continue;
    const then = time === now ? ref.now : bodyPose(ref.body, time, bodies, g);
    const dx = x - then.x;
    const dy = y - then.y;
    const dist2 = dx * dx + dy * dy;
    const dist = Math.sqrt(dist2);
    const pull = dist2 > 1e-18 ? (g * ref.body.mass) / dist2 : Number.POSITIVE_INFINITY;
    const cand: Candidate = { ref, then, dist, pull };
    byId.set(ref.body.id, cand);
    if (!strongest || pull > strongest.pull) {
      nextPull = strongest;
      strongest = cand;
    } else if (!nextPull || pull > nextPull.pull) {
      nextPull = cand;
    }
    if (!(ref.radius > 0) || dist > ref.radius) continue;
    if (!inner || ref.radius < inner.ref.radius || (ref.radius === inner.ref.radius && pull > inner.pull)) {
      secondSphere = inner;
      inner = cand;
    } else if (!secondSphere || ref.radius < secondSphere.ref.radius) {
      secondSphere = cand;
    }
  }
  if (!inner) {
    if (!strongest) return { x, y, bodyId: "" };
    const placed = place(strongest, x, y);
    return { x: placed.x, y: placed.y, bodyId: strongest.ref.body.id };
  }
  const parentId = inner.ref.body.orbit?.centerId;
  const parent = parentId ? byId.get(parentId) : undefined;
  const host = hostOf(inner, secondSphere, parent, nextPull, strongest);
  const weight = shellWeight(inner.dist, inner.ref.radius);
  const here = place(inner, x, y);
  if (!host || weight >= 1) return { x: here.x, y: here.y, bodyId: inner.ref.body.id };
  const there = place(host, x, y);
  return {
    x: there.x + (here.x - there.x) * weight,
    y: there.y + (here.y - there.y) * weight,
    bodyId: weight >= 0.5 ? inner.ref.body.id : host.ref.body.id,
  };
}

function hostOf(
  inner: Candidate,
  sphere: Candidate | null | undefined,
  parent: Candidate | undefined,
  nextPull: Candidate | null,
  strongest: Candidate | null,
): Candidate | null {
  if (sphere && sphere.ref.body.id !== inner.ref.body.id) return sphere;
  if (parent && parent.ref.body.id !== inner.ref.body.id) return parent;
  if (nextPull && nextPull.ref.body.id !== inner.ref.body.id) return nextPull;
  if (strongest && strongest.ref.body.id !== inner.ref.body.id) return strongest;
  return null;
}

/** 1 deep inside the sphere, 0 at the boundary. Smoothstep across the shell. */
function shellWeight(dist: number, radius: number): number {
  const inner = radius * SHELL;
  if (dist <= inner) return 1;
  if (dist >= radius) return 0;
  const t = (dist - inner) / (radius - inner);
  const s = t * t * (3 - 2 * t);
  return 1 - s;
}

function place(cand: Candidate, x: number, y: number): Vec2 {
  return {
    x: cand.ref.now.x + (x - cand.then.x),
    y: cand.ref.now.y + (y - cand.then.y),
  };
}
