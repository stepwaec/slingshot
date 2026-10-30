/**
 * Megastructure geometry shared by the sim and the renderer.
 * Lengths are the sample sizes in the SVG headers, scaled by
 * `body.radius / sample radius`. The sample star is r 25.3 for the
 * stellar engine and the Dyson swarm (`stellar-engine.svg`, `dyson-swarm.svg`),
 * r 23 for the Shkadov thruster and the ringworld (`shkadov-thruster.svg`,
 * `ringworld.svg`), and the home planet is r 34 for the space elevator
 * (`space-elevator.svg`). Wormhole mouths use the radii in the level.
 *
 * Hull per second, fuel per second, drift strength, ring mass, elevator
 * spin and the wormhole clock are level knobs. The headers describe the
 * roles and do not number them.
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

/** ringworld.svg placeholder star. The sim ring is a circle of this sample radius. */
export const RING_SAMPLE_R = 23;
/** Ellipse rx 210. In the top-down sim this is the circle's radius. */
export const RING_RX = 210;
/** Ellipse ry 62. Tilt factor ry/rx, header "tilt cos 0.295". Drawing only. */
export const RING_RY = 62;
/** Band height 13. Full radial width of the solid annulus. */
export const RING_BAND = 13;
/**
 * Samples of a uniform ring. Even, so the field cancels at the centre.
 * The transit gap is a hole in the band, not a missing piece of mass.
 */
export const RING_SAMPLES = 64;
/** Shadow-square orbit, sample units. ringworld.svg inner ellipse. */
export const RING_SHADOW_RX = 95;
export const RING_SHADOW_RY = 28;

/** space-elevator.svg home planet. */
export const ELEVATOR_SAMPLE_R = 34;
/** Tether from the surface (r 34) to the counterweight (r 270). */
export const ELEVATOR_INNER = 34;
export const ELEVATOR_OUTER = 270;
/** Station disc at r 150. Drawing only; the tether is the solid part. */
export const ELEVATOR_STATION = 150;
export const ELEVATOR_STATION_R = 6;
export const ELEVATOR_STATION_RING = 10;
/** Counterweight rock. Contact here throws the ship at ω × r. */
export const ELEVATOR_ROCK_R = 9;
/** Half of the 1.2 px tether stroke. The 3 px glow is not solid. */
export const ELEVATOR_TETHER_HALF = 0.6;
/** Climber travel, sample units. space-elevator.svg paths M34 0 L262 0. */
export const ELEVATOR_CLIMB_0 = 34;
export const ELEVATOR_CLIMB_1 = 262;

/** wormhole.svg: stars drawn at r = R u^0.45, halo out to 1.35 R. */
export const WORMHOLE_STAR_EXP = 0.45;
export const WORMHOLE_HALO = 1.35;
/** Second Einstein ring sits this many sample pixels outside the mouth. */
export const WORMHOLE_RING_PAD = 2.2;

/**
 * A solid ring of radius `RING_RX`, scaled by the body's radius.
 * `angle` turns the gap frame. `mass` is the uniform ring's mass.
 * `gaps` are transit holes in radians, measured in that frame.
 * A gap may wrap past 0. The open middle is empty.
 */
export interface RingGap {
  start: number;
  end: number;
}

export interface Ringworld {
  angle: number;
  mass: number;
  gaps: readonly RingGap[];
}

/**
 * Tether co-rotating with the planet. `phase` is the angle at t = 0.
 * `omega` is radians per second of sim time. Release speed is ω × r
 * at the counterweight, tangential, plus the planet's own velocity.
 */
export interface SpaceElevator {
  phase: number;
  omega: number;
}

/** One mouth. `radius` is the disc the ship enters. */
export interface WormholeMouth {
  x: number;
  y: number;
  radius: number;
}

/**
 * Structures the megastructure view draws. A new entry has to be placed
 * by the Observatory builder; the showcase test fails until it is.
 */
export const MEGA_SLOTS = ["engine", "dyson", "shkadov", "ring", "elevator", "wormhole"] as const;
export type MegaSlot = (typeof MEGA_SLOTS)[number];

/**
 * Entering either mouth moves the ship to the other.
 * `angle` turns the heading on the way from `a` to `b` (the opposite turn
 * on the way back). `clockOffset` is added to outside time on arrival at
 * `b`, and subtracted on arrival at `a`.
 */
export interface WormholePair {
  id: string;
  a: WormholeMouth;
  b: WormholeMouth;
  angle: number;
  clockOffset: number;
}

export function ringScale(radius: number): number {
  return radius / RING_SAMPLE_R;
}

export function ringRadius(radius: number): number {
  return RING_RX * ringScale(radius);
}

export function ringHalfWidth(radius: number): number {
  return (RING_BAND * ringScale(radius)) / 2;
}

/** Sample `index` of the uniform ring, relative to the body. `index` is in `0 .. RING_SAMPLES`. */
export function ringSample(radius: number, index: number): { x: number; y: number } {
  const theta = (Math.PI * 2 * index) / RING_SAMPLES;
  const reach = ringRadius(radius);
  return { x: Math.cos(theta) * reach, y: Math.sin(theta) * reach };
}

function gapContains(local: number, gaps: readonly RingGap[]): boolean {
  const angle = wrapAngle(local);
  for (let i = 0; i < gaps.length; i++) {
    const start = wrapAngle(gaps[i].start);
    const end = wrapAngle(gaps[i].end);
    if (start === end) continue;
    if (start < end) {
      if (angle >= start && angle <= end) return true;
    } else if (angle >= start || angle <= end) return true;
  }
  return false;
}

/** True on the solid band. The open middle and the transit gaps are false. */
export function ringContains(dx: number, dy: number, radius: number, angle: number, gaps: readonly RingGap[]): boolean {
  const reach = ringRadius(radius);
  const half = ringHalfWidth(radius);
  const r = Math.hypot(dx, dy);
  if (Math.abs(r - reach) > half) return false;
  if (!(r > 1e-8)) return false;
  return !gapContains(Math.atan2(dy, dx) - angle, gaps);
}

/**
 * Earliest fraction in [0, 1] when a segment enters the solid band.
 * The segment is already in the body's frame.
 */
export function ringSegmentEntry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  angle: number,
  gaps: readonly RingGap[],
): number | null {
  if (ringContains(x0, y0, radius, angle, gaps)) return 0;
  const reach = ringRadius(radius);
  const half = ringHalfWidth(radius);
  const dx = x1 - x0;
  const dy = y1 - y0;
  let best: number | null = null;
  const consider = (t: number) => {
    if (t < -1e-9 || t > 1) return;
    const u = t < 0 ? 0 : t;
    const probe = u + 1e-5 < 1 ? u + 1e-5 : 1;
    if (!ringContains(x0 + dx * probe, y0 + dy * probe, radius, angle, gaps)) return;
    if (best === null || u < best) best = u;
  };
  const a = dx * dx + dy * dy;
  if (a > 0) {
    const b = 2 * (x0 * dx + y0 * dy);
    for (const edge of [reach - half, reach + half]) {
      if (!(edge > 0)) continue;
      const c = x0 * x0 + y0 * y0 - edge * edge;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      consider((-b - root) / (2 * a));
      consider((-b + root) / (2 * a));
    }
  }
  for (let i = 0; i < gaps.length; i++) {
    for (const edge of [gaps[i].start, gaps[i].end]) {
      const world = angle + edge;
      const rx = Math.cos(world);
      const ry = Math.sin(world);
      const cross0 = x0 * ry - y0 * rx;
      const crossD = dx * ry - dy * rx;
      if (Math.abs(crossD) < 1e-12) continue;
      const t = -cross0 / crossD;
      if (t < -1e-9 || t > 1) continue;
      const u = t < 0 ? 0 : t;
      const x = x0 + dx * u;
      const y = y0 + dy * u;
      if (x * rx + y * ry <= 0) continue;
      const r = Math.hypot(x, y);
      if (r < reach - half || r > reach + half) continue;
      consider(t);
    }
  }
  return best;
}

/**
 * Solid parametric arcs in the ring frame, split into the far half
 * (`θ` in `[0, π]`, +y) and the near half. Drawing uses the same gaps as flight.
 */
export function ringSolidArcs(gaps: readonly RingGap[]): { start: number; end: number; far: boolean }[] {
  const cuts: { start: number; end: number }[] = [];
  for (let i = 0; i < gaps.length; i++) {
    const start = wrapAngle(gaps[i].start);
    const end = wrapAngle(gaps[i].end);
    if (start === end) continue;
    if (start < end) cuts.push({ start, end });
    else {
      cuts.push({ start, end: Math.PI * 2 });
      if (end > 0) cuts.push({ start: 0, end });
    }
  }
  cuts.sort((p, q) => p.start - q.start);
  const merged: { start: number; end: number }[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const last = merged[merged.length - 1];
    if (!last || cut.start > last.end) merged.push({ start: cut.start, end: cut.end });
    else if (cut.end > last.end) last.end = cut.end;
  }
  const solid: { start: number; end: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].start > cursor) solid.push({ start: cursor, end: merged[i].start });
    cursor = Math.max(cursor, merged[i].end);
  }
  if (cursor < Math.PI * 2) solid.push({ start: cursor, end: Math.PI * 2 });
  const halves: { start: number; end: number; far: boolean }[] = [];
  for (let i = 0; i < solid.length; i++) {
    const arc = solid[i];
    if (!(arc.end - arc.start > 1e-4)) continue;
    if (arc.start < Math.PI && arc.end > Math.PI) {
      halves.push({ start: arc.start, end: Math.PI, far: true });
      if (arc.end - Math.PI > 1e-4) halves.push({ start: Math.PI, end: arc.end, far: false });
    } else {
      halves.push({ start: arc.start, end: arc.end, far: arc.start < Math.PI });
    }
  }
  return halves;
}

export function elevatorScale(radius: number): number {
  return radius / ELEVATOR_SAMPLE_R;
}

export interface ElevatorFrame {
  scale: number;
  inner: number;
  outer: number;
  station: number;
  stationR: number;
  stationRing: number;
  rock: number;
  half: number;
}

export function elevatorFrame(radius: number): ElevatorFrame {
  const scale = elevatorScale(radius);
  return {
    scale,
    inner: ELEVATOR_INNER * scale,
    outer: ELEVATOR_OUTER * scale,
    station: ELEVATOR_STATION * scale,
    stationR: ELEVATOR_STATION_R * scale,
    stationRing: ELEVATOR_STATION_RING * scale,
    rock: ELEVATOR_ROCK_R * scale,
    half: ELEVATOR_TETHER_HALF * scale,
  };
}

export function elevatorAngle(elevator: SpaceElevator, time: number): number {
  return elevator.phase + elevator.omega * time;
}

/** |ω × r| at the counterweight. The planning chip prints this. */
export function launchSpeed(radius: number, omega: number): number {
  return Math.abs(omega) * elevatorFrame(radius).outer;
}

/**
 * Tangential velocity ω × r at the counterweight.
 * Positive `omega` is counterclockwise. `radius` here is the counterweight's
 * distance from the planet, already in world units.
 */
export function tangentialVelocity(omega: number, angle: number, radius: number): { vx: number; vy: number } {
  return { vx: -omega * radius * Math.sin(angle), vy: omega * radius * Math.cos(angle) };
}

/** True on the tether line. The counterweight disc is false: that throws, it does not crash. */
export function tetherContains(x: number, y: number, inner: number, outer: number, half: number, rock: number): boolean {
  if (Math.hypot(x - outer, y) <= rock) return false;
  const px = x < inner ? inner : x > outer ? outer : x;
  return Math.hypot(x - px, y) <= half;
}

/**
 * Earliest fraction in [0, 1] when a segment enters the tether.
 * Coordinates are in the elevator frame: the tether lies on +x from
 * `inner` to `outer`.
 */
export function tetherSegmentEntry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  inner: number,
  outer: number,
  half: number,
  rock: number,
): number | null {
  if (tetherContains(x0, y0, inner, outer, half, rock)) return 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let best: number | null = null;
  const consider = (t: number) => {
    if (t < -1e-9 || t > 1) return;
    const u = t < 0 ? 0 : t;
    const probe = u + 1e-5 < 1 ? u + 1e-5 : 1;
    if (!tetherContains(x0 + dx * probe, y0 + dy * probe, inner, outer, half, rock)) return;
    if (best === null || u < best) best = u;
  };
  if (Math.abs(dy) > 1e-12) {
    for (const yLine of [half, -half]) {
      const t = (yLine - y0) / dy;
      const x = x0 + dx * t;
      if (x >= inner && x <= outer) consider(t);
    }
  }
  if (Math.abs(dx) > 1e-12) {
    for (const xLine of [inner, outer]) {
      const t = (xLine - x0) / dx;
      const y = y0 + dy * t;
      if (Math.abs(y) <= half) consider(t);
    }
  }
  const a = dx * dx + dy * dy;
  if (a > 0) {
    for (const cap of [
      { cx: inner, cy: 0, radius: half },
      { cx: outer, cy: 0, radius: rock },
    ]) {
      const fx = x0 - cap.cx;
      const fy = y0 - cap.cy;
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - cap.radius * cap.radius;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      consider((-b - root) / (2 * a));
      consider((-b + root) / (2 * a));
    }
  }
  return best;
}

export function rotateVelocity(vx: number, vy: number, angle: number): { vx: number; vy: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { vx: vx * c - vy * s, vy: vx * s + vy * c };
}

export function mouthName(id: string, which: "a" | "b"): string {
  return `${id}:${which}`;
}

/** Planning chip. Offsets of an hour or more print in hours, matching the sample "+3.2 h". */
export function clockChip(seconds: number): string {
  const sign = seconds < 0 ? "-" : "+";
  const abs = Math.abs(seconds);
  if (abs >= 3600) {
    const hours = abs / 3600;
    const text = hours >= 10 ? hours.toFixed(0) : hours.toFixed(1);
    return `exit clock ${sign}${text} h`;
  }
  const text = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  return `exit clock ${sign}${text} s`;
}

/** Planning chip for the free launch. `speed` is |ω × r|. */
export function launchChip(speed: number): string {
  return `free Δv ${speed.toFixed(1)}`;
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
export function structureReach(body: {
  radius: number;
  engine?: StellarEngine;
  dyson?: DysonSwarm;
  shkadov?: ShkadovThruster;
  ring?: Ringworld;
  elevator?: SpaceElevator;
}): number {
  let reach = 0;
  if (body.engine) reach = Math.max(reach, jetSpan(body.radius).outer, ENGINE_MIRROR_OUTER * engineScale(body.radius));
  if (body.dyson) reach = Math.max(reach, SWARM_HEAT_OUTER * engineScale(body.radius));
  if (body.shkadov) {
    const scale = shkadovScale(body.radius);
    reach = Math.max(reach, (RAY_START + RAY_LENGTH) * scale, MIRROR_OUTER * scale);
  }
  if (body.ring) reach = Math.max(reach, ringRadius(body.radius) + ringHalfWidth(body.radius));
  if (body.elevator) {
    const frame = elevatorFrame(body.radius);
    reach = Math.max(reach, frame.outer + frame.rock + 80 * frame.scale);
  }
  return reach;
}
