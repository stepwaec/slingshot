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
 * The body the ship is with at the sprite clock stays anchored there, so a
 * loop around Earth sits on the Earth that is drawn. A later body, such as
 * the Moon, keeps one anchor for its whole stretch: that body's position in
 * the home frame at closest approach. The lunar loop then sits where the
 * Moon will be relative to the Earth on screen, and it meets the Earth-frame
 * path instead of hooking back to the Moon's sprite. Anchoring the Moon at
 * its inertial position would leave a gap the size of Earth's motion around
 * the Sun. Anchoring each sample at its own time would put the cycloid back.
 *
 * Nothing here writes the sim. The samples keep their inertial coordinates.
 */

export interface DrawnPoint {
  x: number;
  y: number;
  /** Body the sample was drawn against. Empty when nothing pulls. */
  bodyId: string;
}

/** A later body, the step where the ship is nearest it, and where that body is drawn. */
export interface ApproachMark {
  bodyId: string;
  step: number;
  x: number;
  y: number;
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

interface Layout {
  now: number;
  points: DrawnPoint[];
  approaches: ApproachMark[];
  homeId: string;
}

const cache = new WeakMap<object, Layout>();

/** Drawn positions for a path. Cached on the sample array and the anchor time. */
export function showPath(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
): DrawnPoint[] {
  return layoutPath(samples, bodies, g, dt, now).points;
}

/** Closest approach of each body the path visits after the one it starts with. */
export function pathApproaches(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
): ApproachMark[] {
  return layoutPath(samples, bodies, g, dt, now).approaches;
}

/** Body the samples are with at the sprite clock. Empty when nothing pulls. */
export function pathHome(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
): string {
  return layoutPath(samples, bodies, g, dt, now).homeId;
}

/**
 * Where `body` is drawn at `time` when the view is anchored on `home` at `now`.
 * The home body stays on the sprite. No home leaves the inertial pose.
 */
export function viewBody(
  body: Body,
  time: number,
  home: Body | null,
  now: number,
  bodies: readonly Body[],
  g: number,
): Vec2 {
  if (home && home.id === body.id) {
    const at = bodyPose(home, now, bodies, g);
    return { x: at.x, y: at.y };
  }
  const pose = bodyPose(body, time, bodies, g);
  if (!home) return { x: pose.x, y: pose.y };
  const homeNow = bodyPose(home, now, bodies, g);
  const homeThen = time === now ? homeNow : bodyPose(home, time, bodies, g);
  return { x: homeNow.x + (pose.x - homeThen.x), y: homeNow.y + (pose.y - homeThen.y) };
}

function layoutPath(
  samples: readonly { x: number; y: number; step: number }[],
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
): Layout {
  const hit = cache.get(samples);
  if (hit && hit.now === now) return hit;
  const refs = refsFor(bodies, g, now);
  const raw: RawSample[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    raw[i] = measureSample(samples[i].x, samples[i].y, samples[i].step, bodies, g, dt, now, refs);
  }
  const home = homeIndex(raw, now, dt);
  const homeId = home < 0 ? "" : raw[home].innerId;
  const runs = anchorRuns(raw, refs, bodies, g, dt, now, homeId);
  const points: DrawnPoint[] = new Array(raw.length);
  const approaches: ApproachMark[] = [];
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.id !== homeId && run.id !== "") {
      approaches.push({ bodyId: run.id, step: run.step, x: run.anchorX, y: run.anchorY });
    }
  }
  for (let i = 0; i < raw.length; i++) points[i] = placeSample(raw[i], i, runs, refs, homeId);
  const laid = { now, points, approaches, homeId };
  cache.set(samples, laid);
  return laid;
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

interface RawSample {
  step: number;
  x: number;
  y: number;
  innerId: string;
  innerDist: number;
  /** 1 deep in the sphere. Below 1 the point blends toward `hostId`. */
  weight: number;
  ox: number;
  oy: number;
  hostId: string;
  hx: number;
  hy: number;
}

interface Run {
  id: string;
  start: number;
  end: number;
  fromStep: number;
  toStep: number;
  step: number;
  anchorX: number;
  anchorY: number;
}

function measureSample(
  x: number,
  y: number,
  step: number,
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
  refs: readonly Ref[],
): RawSample {
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
    if (!strongest) {
      return { step, x, y, innerId: "", innerDist: Infinity, weight: 1, ox: 0, oy: 0, hostId: "", hx: 0, hy: 0 };
    }
    return {
      step,
      x,
      y,
      innerId: strongest.ref.body.id,
      innerDist: strongest.dist,
      weight: 1,
      ox: x - strongest.then.x,
      oy: y - strongest.then.y,
      hostId: "",
      hx: 0,
      hy: 0,
    };
  }
  const parentId = inner.ref.body.orbit?.centerId;
  const parent = parentId ? byId.get(parentId) : undefined;
  const host = hostOf(inner, secondSphere, parent, nextPull, strongest);
  const weight = shellWeight(inner.dist, inner.ref.radius);
  if (!host || weight >= 1) {
    return {
      step,
      x,
      y,
      innerId: inner.ref.body.id,
      innerDist: inner.dist,
      weight: 1,
      ox: x - inner.then.x,
      oy: y - inner.then.y,
      hostId: "",
      hx: 0,
      hy: 0,
    };
  }
  return {
    step,
    x,
    y,
    innerId: inner.ref.body.id,
    innerDist: inner.dist,
    weight,
    ox: x - inner.then.x,
    oy: y - inner.then.y,
    hostId: host.ref.body.id,
    hx: x - host.then.x,
    hy: y - host.then.y,
  };
}

/** Sample nearest the sprite clock. The first wins a tie. */
function homeIndex(raw: readonly RawSample[], now: number, dt: number): number {
  let best = -1;
  let bestAbs = Infinity;
  for (let i = 0; i < raw.length; i++) {
    const dist = Math.abs(raw[i].step * dt - now);
    if (dist < bestAbs) {
      bestAbs = dist;
      best = i;
    }
  }
  return best;
}

function anchorRuns(
  raw: readonly RawSample[],
  refs: readonly Ref[],
  bodies: readonly Body[],
  g: number,
  dt: number,
  now: number,
  homeId: string,
): Run[] {
  const runs: Run[] = [];
  const home = refById(refs, homeId);
  let i = 0;
  while (i < raw.length) {
    const id = raw[i].innerId;
    let end = i + 1;
    while (end < raw.length && raw[end].innerId === id) end += 1;
    let nearest = i;
    for (let k = i + 1; k < end; k++) {
      if (raw[k].innerDist < raw[nearest].innerDist) nearest = k;
    }
    const ref = refById(refs, id);
    const step = raw[nearest].step;
    let anchorX = 0;
    let anchorY = 0;
    if (ref && (id === homeId || !ref.body.orbit)) {
      anchorX = ref.now.x;
      anchorY = ref.now.y;
    } else if (ref) {
      const placed = viewBody(ref.body, step * dt, home ? home.body : null, now, bodies, g);
      anchorX = placed.x;
      anchorY = placed.y;
    }
    runs.push({
      id,
      start: i,
      end,
      fromStep: raw[i].step,
      toStep: raw[end - 1].step,
      step,
      anchorX,
      anchorY,
    });
    i = end;
  }
  return runs;
}

function placeSample(
  sample: RawSample,
  index: number,
  runs: readonly Run[],
  refs: readonly Ref[],
  homeId: string,
): DrawnPoint {
  if (sample.innerId === "") return { x: sample.x, y: sample.y, bodyId: "" };
  const run = runAt(runs, index);
  const ax = run.anchorX + sample.ox;
  const ay = run.anchorY + sample.oy;
  if (sample.weight >= 1 || sample.hostId === "") return { x: ax, y: ay, bodyId: sample.innerId };
  const host = hostAnchor(sample.hostId, sample.step, index, runs, refs, homeId);
  const bx = host.x + sample.hx;
  const by = host.y + sample.hy;
  const weight = sample.weight;
  return {
    x: bx + (ax - bx) * weight,
    y: by + (ay - by) * weight,
    bodyId: weight >= 0.5 ? sample.innerId : sample.hostId,
  };
}

/** Sprite pose, unless a later run of the host covers this sample. */
function hostAnchor(
  hostId: string,
  step: number,
  index: number,
  runs: readonly Run[],
  refs: readonly Ref[],
  homeId: string,
): { x: number; y: number } {
  if (hostId !== homeId) {
    const cover = coveringRun(runs, hostId, index, step);
    if (cover) return { x: cover.anchorX, y: cover.anchorY };
  }
  const ref = refById(refs, hostId);
  return ref ? { x: ref.now.x, y: ref.now.y } : { x: 0, y: 0 };
}

function coveringRun(runs: readonly Run[], id: string, index: number, step: number): Run | null {
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.id !== id) continue;
    if (index >= run.start && index < run.end) return run;
    if (step >= run.fromStep && step <= run.toStep) return run;
  }
  return null;
}

function runAt(runs: readonly Run[], index: number): Run {
  for (let i = 0; i < runs.length; i++) {
    if (index >= runs[i].start && index < runs[i].end) return runs[i];
  }
  return runs[runs.length - 1];
}

function refById(refs: readonly Ref[], id: string): Ref | null {
  for (let i = 0; i < refs.length; i++) {
    if (refs[i].body.id === id) return refs[i];
  }
  return null;
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

