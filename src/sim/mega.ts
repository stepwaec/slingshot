/**
 * Megastructure geometry shared by the sim and the renderer.
 * Lengths are the sample sizes in the SVG headers, scaled by
 * `body.radius / sample radius`. The sample star is r 25.3 for the
 * stellar engine and the Dyson swarm (`stellar-engine.svg`, `dyson-swarm.svg`)
 * and r 23 for the Shkadov thruster (`shkadov-thruster.svg`).
 *
 * Hull per second, fuel per second and the drift strength are level knobs.
 * The headers describe the roles and do not number them.
 */

/** stellar-engine.svg and dyson-swarm.svg placeholder star. */
export const ENGINE_SAMPLE_R = 25.3;
/** shkadov-thruster.svg placeholder star. */
export const SHKADOV_SAMPLE_R = 23;

/** Jet along the axis, sample units. stellar-engine.svg: r 30 to 360. */
export const JET_INNER = 30;
export const JET_OUTER = 360;
/** Half-width `w = 4 + 16 t^0.8`. */
export const JET_HALF_BASE = 4;
export const JET_HALF_GAIN = 16;
export const JET_HALF_EXP = 0.8;
/** Core is `|offset| < 0.5 w`. Margins are `0.6 w` to `1.4 w`. */
export const JET_CORE = 0.5;
export const JET_MARGIN_IN = 0.6;
export const JET_MARGIN_OUT = 1.4;

/** Collector tiles on the arc behind the jet. */
export const ENGINE_MIRROR_INNER = 62;
export const ENGINE_MIRROR_OUTER = 76;
export const ENGINE_MIRROR_A0 = (110 * Math.PI) / 180;
export const ENGINE_MIRROR_A1 = (250 * Math.PI) / 180;
export const ENGINE_MIRROR_TILES = 26;

/**
 * Three tilted shells. `ry` is `ryOverRx * rx`. Band is 6 px wide in the sample.
 * dyson-swarm.svg.
 */
export const SWARM_SHELLS = [
  { rx: 78, ryOverRx: 0.42, rot: (-18 * Math.PI) / 180 },
  { rx: 104, ryOverRx: 0.55, rot: (22 * Math.PI) / 180 },
  { rx: 132, ryOverRx: 0.36, rot: (-4 * Math.PI) / 180 },
] as const;
export const SWARM_BAND = 6;
export const SWARM_HEAT_OUTER = 160;

/** Mirror annulus, sample units. Rays leave along +x; the mirror is the far side. */
export const MIRROR_INNER = 80;
export const MIRROR_OUTER = 86;
export const MIRROR_A0 = (115 * Math.PI) / 180;
export const MIRROR_A1 = (245 * Math.PI) / 180;
/** Escaping rays, sample units from the star. shkadov-thruster.svg. */
export const RAY_START = 30;
export const RAY_LENGTH = 230;

/**
 * Jet axis in radians from +x. The plume runs outward along this direction.
 * `burn` is hull per second in the core, `scoop` is fuel per second in the
 * margins, `push` is the acceleration along the jet inside the drawn plume.
 */
export interface StellarEngine {
  angle: number;
  burn: number;
  scoop: number;
  push: number;
}

/**
 * `coverage` is the fraction of the star's light the swarm takes.
 * Recharge and the drawn star both use `1 - coverage`.
 * `nick` is hull per second inside a collector band. A hit is not a crash.
 */
export interface DysonSwarm {
  coverage: number;
  nick: number;
}

/**
 * `angle` is the ray axis. The mirror sits opposite it.
 * `accel` is the constant acceleration of every body toward the mirror.
 */
export interface ShkadovThruster {
  angle: number;
  accel: number;
}

export function engineScale(radius: number): number {
  return radius / ENGINE_SAMPLE_R;
}

export function shkadovScale(radius: number): number {
  return radius / SHKADOV_SAMPLE_R;
}

export function jetSpan(radius: number): { inner: number; outer: number } {
  const scale = engineScale(radius);
  return { inner: JET_INNER * scale, outer: JET_OUTER * scale };
}

/** Smooth half-width of the plume. `t` is 0 at the inner end and 1 at the outer end. */
export function jetHalfWidth(radius: number, t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return (JET_HALF_BASE + JET_HALF_GAIN * Math.pow(clamped, JET_HALF_EXP)) * engineScale(radius);
}

export interface JetContact {
  t: number;
  halfWidth: number;
  /** `|offset| < 0.5 w`. Burns hull. */
  core: boolean;
  /** `0.6 w` to `1.4 w`. Refills fuel. */
  margin: boolean;
  /** Inside the drawn plume (`|offset| < w`), where the jet pushes. */
  plume: boolean;
}

/** Contact with one jet, or null when the point is outside its length. */
export function jetContact(dx: number, dy: number, radius: number, angle: number): JetContact | null {
  const span = jetSpan(radius);
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  const perp = -dx * Math.sin(angle) + dy * Math.cos(angle);
  if (along < span.inner || along > span.outer) return null;
  const length = span.outer - span.inner;
  const t = length > 0 ? (along - span.inner) / length : 0;
  const halfWidth = jetHalfWidth(radius, t);
  const offset = Math.abs(perp);
  return {
    t,
    halfWidth,
    core: offset < JET_CORE * halfWidth,
    margin: offset >= JET_MARGIN_IN * halfWidth && offset <= JET_MARGIN_OUT * halfWidth,
    plume: offset < halfWidth,
  };
}

/** True when the point sits in a collector band. The gaps between shells are false. */
export function dysonShellHit(dx: number, dy: number, radius: number): boolean {
  const scale = engineScale(radius);
  const half = (SWARM_BAND * scale) / 2;
  for (let i = 0; i < SWARM_SHELLS.length; i++) {
    const shell = SWARM_SHELLS[i];
    const rx = shell.rx * scale;
    const ry = shell.ryOverRx * rx;
    const cos = Math.cos(shell.rot);
    const sin = Math.sin(shell.rot);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const r = Math.hypot(lx, ly);
    if (!(r > 1e-8) || !(rx > 0) || !(ry > 0)) continue;
    const c = lx / r;
    const s = ly / r;
    const ellipse = 1 / Math.sqrt((c * c) / (rx * rx) + (s * s) / (ry * ry));
    if (Math.abs(r - ellipse) <= half) return true;
  }
  return false;
}

/**
 * Star opacity and the solar factor. The header draws the star at 0.72 and
 * also says recharge ×0.4. One `coverage` drives both, so they cannot disagree.
 */
export function coverageFactor(coverage: number | undefined): number {
  if (!(coverage !== undefined) || !(coverage > 0)) return 1;
  if (coverage >= 1) return 0;
  return 1 - coverage;
}

export function mirrorRadii(radius: number): { inner: number; outer: number } {
  const scale = shkadovScale(radius);
  return { inner: MIRROR_INNER * scale, outer: MIRROR_OUTER * scale };
}

function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  let value = angle % turn;
  if (value < 0) value += turn;
  return value;
}

/** Point relative to the star, in world space. The mirror is the arc opposite the rays. */
export function mirrorContains(dx: number, dy: number, radius: number, angle: number): boolean {
  const radii = mirrorRadii(radius);
  const r = Math.hypot(dx, dy);
  if (r < radii.inner || r > radii.outer) return false;
  const local = wrapAngle(Math.atan2(dy, dx) - angle);
  return local >= MIRROR_A0 && local <= MIRROR_A1;
}

function inMirror(x: number, y: number, inner: number, outer: number): boolean {
  const r = Math.hypot(x, y);
  if (r < inner || r > outer) return false;
  const local = wrapAngle(Math.atan2(y, x));
  return local >= MIRROR_A0 && local <= MIRROR_A1;
}

/**
 * Earliest fraction in [0, 1] when a segment enters the mirror.
 * The segment is already in the star's frame, with the ray axis along +x.
 */
export function mirrorSegmentEntry(x0: number, y0: number, x1: number, y1: number, inner: number, outer: number): number | null {
  if (inMirror(x0, y0, inner, outer)) return 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let best: number | null = null;
  const take = (t: number) => {
    if (t < -1e-9 || t > 1) return;
    const u = t < 0 ? 0 : t;
    if (!inMirror(x0 + dx * u, y0 + dy * u, inner, outer)) return;
    if (best === null || u < best) best = u;
  };
  const a = dx * dx + dy * dy;
  if (a > 0) {
    const b = 2 * (x0 * dx + y0 * dy);
    for (const radius of [inner, outer]) {
      const c = x0 * x0 + y0 * y0 - radius * radius;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      take((-b - root) / (2 * a));
      take((-b + root) / (2 * a));
    }
  }
  for (const edge of [MIRROR_A0, MIRROR_A1]) {
    const rx = Math.cos(edge);
    const ry = Math.sin(edge);
    const cross0 = x0 * ry - y0 * rx;
    const crossD = dx * ry - dy * rx;
    if (Math.abs(crossD) < 1e-12) continue;
    const t = -cross0 / crossD;
    if (t < -1e-9 || t > 1) continue;
    const u = t < 0 ? 0 : t;
    const x = x0 + dx * u;
    const y = y0 + dy * u;
    if (x * rx + y * ry < 0) continue;
    const r = Math.hypot(x, y);
    if (r < inner || r > outer) continue;
    if (best === null || u < best) best = u;
  }
  return best;
}

/**
 * Acceleration added to every body, toward the mirror (opposite the rays).
 * Null when the level has no Shkadov thruster, so stock poses stay as they were.
 */
export function frameAcceleration(
  bodies: readonly { shkadov?: ShkadovThruster }[],
): { ax: number; ay: number } | null {
  let ax = 0;
  let ay = 0;
  let any = false;
  for (let i = 0; i < bodies.length; i++) {
    const thruster = bodies[i].shkadov;
    if (!thruster || thruster.accel === 0) continue;
    any = true;
    ax -= Math.cos(thruster.angle) * thruster.accel;
    ay -= Math.sin(thruster.angle) * thruster.accel;
  }
  return any ? { ax, ay } : null;
}

/** How far framing should reach past a body's centre to keep its structure on screen. */
export function structureReach(body: { radius: number; engine?: StellarEngine; dyson?: DysonSwarm; shkadov?: ShkadovThruster }): number {
  let reach = 0;
  if (body.engine) reach = Math.max(reach, jetSpan(body.radius).outer, ENGINE_MIRROR_OUTER * engineScale(body.radius));
  if (body.dyson) reach = Math.max(reach, SWARM_HEAT_OUTER * engineScale(body.radius));
  if (body.shkadov) {
    const scale = shkadovScale(body.radius);
    reach = Math.max(reach, (RAY_START + RAY_LENGTH) * scale, MIRROR_OUTER * scale);
  }
  return reach;
}
