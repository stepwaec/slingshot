import { bodyPose, type Body, type Vec2 } from "../sim/physics";

/**
 * The predicted path is drawn where the sim put it.
 *
 * Samples are inertial. A ship in a circular Earth orbit is correct in that
 * frame, and Earth is moving around the Sun, so the drawn coast is a cycloid:
 * a loop that travels with the planet. Sprites stay at the current time.
 * Ghosts of the bodies, at the same steps, sit on this path.
 *
 * Nothing here writes the sim.
 */

export interface DrawnPoint {
  x: number;
  y: number;
  /** Unused. The stroke is not attached to a body. */
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
}

/** Clock the body sprites use. Planning holds t = 0. */
export function shownNow(mode: string, shipStep: number, dt: number): number {
  return (mode === "planning" ? 0 : shipStep) * dt;
}

export function shownPoint(_view: FrameView, x: number, y: number, _step: number): Vec2 {
  return { x, y };
}

export function shownPath(
  _view: FrameView,
  samples: readonly { x: number; y: number; step: number }[],
): DrawnPoint[] {
  return showPath(samples);
}

/** World position of each sample. Extra arguments are ignored; the stroke is not reframed. */
export function showPath(
  samples: readonly { x: number; y: number; step: number }[],
  _bodies?: readonly Body[],
  _g?: number,
  _dt?: number,
  _now?: number,
): DrawnPoint[] {
  const points: DrawnPoint[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    points[i] = { x: samples[i].x, y: samples[i].y, bodyId: "" };
  }
  return points;
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
