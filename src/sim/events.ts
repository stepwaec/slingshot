/**
 * Supernovae and quasars. The numbers live on the level.
 * Drawings are `design/assets` and `src/render/visuals/hazards.ts`.
 * Both are functions of sim time only.
 *
 * A supernova detonates at `at`. Inside `blast` at that instant the ship is
 * lost. Afterwards a shell expands at `speed` and removes `damage` hull when
 * the front crosses the ship, once.
 * A quasar jet is a cone and the opposite cone. `period` and `sweep` precess
 * it. Hull damage is per second inside the jet and does not push the ship.
 */

export interface Supernova {
  /** Sim seconds when the star detonates. */
  at: number;
  /** Lethal radius at the detonation instant. */
  blast: number;
  /** Shock front speed, world units per second. */
  speed: number;
  /** Hull removed when the front crosses the ship. */
  damage: number;
}

export interface QuasarJet {
  /** Axis at t = 0, radians. */
  angle: number;
  /** Half-angle of each jet, radians. */
  cone: number;
  /** Length of each jet. */
  reach: number;
  /** Hull per second inside a jet. */
  damage: number;
  /** Precession period. Omitted or 0 holds the axis still. */
  period?: number;
  /** Precession amplitude, radians. */
  sweep?: number;
}

/** Axis at `time`. t = 0 is the rest angle. */
export function jetAngle(jet: QuasarJet, time: number): number {
  const period = jet.period ?? 0;
  const sweep = jet.sweep ?? 0;
  if (!(period > 0) || sweep === 0) return jet.angle;
  return jet.angle + sweep * Math.sin((Math.PI * 2 * time) / period);
}

/** Hull per second from one quasar. Zero outside both cones. */
export function quasarDamage(dx: number, dy: number, jet: QuasarJet, time: number): number {
  const dist = Math.hypot(dx, dy);
  if (!(dist > 1e-6) || dist > jet.reach || !(jet.damage > 0)) return 0;
  let delta = Math.abs(wrap(Math.atan2(dy, dx) - jetAngle(jet, time)));
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta < jet.cone ? jet.damage : 0;
}

/** Shell radius. 0 before detonation. */
export function shellRadius(nova: Supernova, time: number): number {
  if (!(time >= nova.at) || !(nova.speed > 0)) return 0;
  return nova.speed * (time - nova.at);
}

/**
 * True on the single step that contains the detonation, when the ship's
 * distance at that instant is inside `blast`.
 */
export function blastHits(d0: number, d1: number, nova: Supernova, t0: number, t1: number): boolean {
  if (!(nova.blast > 0) || !(t1 > t0) || t1 < nova.at || t0 > nova.at) return false;
  const u = (nova.at - t0) / (t1 - t0);
  const distance = d0 + (d1 - d0) * u;
  return distance <= nova.blast;
}

/**
 * True on the single step when the expanding front passes the ship.
 * A front that is already outside the ship does not hit again.
 */
export function shockCrosses(d0: number, d1: number, nova: Supernova, t0: number, t1: number): boolean {
  if (!(nova.speed > 0) || !(nova.damage > 0) || !(t1 > t0) || !(t1 > nova.at)) return false;
  const r0 = shellRadius(nova, t0);
  const r1 = shellRadius(nova, t1);
  if (!(r0 < d0)) return false;
  const denom = r1 - r0 - (d1 - d0);
  if (denom === 0) return false;
  const u = (d0 - r0) / denom;
  if (!(u > 0) || u > 1) return false;
  const time = t0 + (t1 - t0) * u;
  return time >= nova.at;
}

function wrap(angle: number): number {
  const turn = Math.PI * 2;
  let value = angle % turn;
  if (value > Math.PI) value -= turn;
  if (value < -Math.PI) value += turn;
  return value;
}
