import type { Belt, BeltTier } from "../sim/belts";
import {
  BODY_LOOKS,
  type Beam,
  type Body,
  type BodyKind,
  type BodyLook,
  type BodyOrbit,
  type Bounds,
  type Horizon,
  type Magnet,
  type Nebula,
  type PauseRule,
  keplerMeanMotion,
} from "../sim/physics";
import type { DysonSwarm, Ringworld, ShkadovThruster, SpaceElevator, StellarEngine, WormholePair } from "../sim/mega";

/**
 * How a level turns clocks and fuel into points.
 * A generation ship weights crew time. A rescue weights the outside deadline
 * and treats crew time and fuel as bonuses. `pause` on the level is separate:
 * a score-pause rule deducts from these points.
 */
export interface MissionProfile {
  /** Outside-time limit in seconds. Missing it is a hard fail. */
  deadline: number;
  /** Ship proper time at or under this earns the crew star. */
  crewLimit: number;
  /** Fuel remaining at or over this earns the fuel star. */
  fuelStarMin: number;
  /** Points per ship-second saved under `crewLimit`. */
  crewWeight: number;
  /** Points per unit of fuel left. */
  fuelWeight: number;
}

/**
 * Optional per-level physics. Omitted fields keep today's behaviour:
 *
 * - `c` — speed of light, world units per second. Defaults to the level `c`.
 *   It changes dilation only. The Newtonian motion does not read it.
 * - `gravityScale` — multiplies `g`. Default `1`.
 * - `eps` — softening length. Default `0` (point masses).
 * - `p` — falloff exponent near 2. Default `2` (inverse-square).
 *   Force magnitude is `G M / (r² + ε²)^(p/2)`. The potential is the integral
 *   of that force, so time dilation and the gravity map stay on the same field.
 * - `dilationStrength` — scales both `2Φ/c²` and `v²/c²`. Default `1`.
 * - `dilationCap` — maximum slowdown, for example `10` keeps `dτ/dt` at or
 *   above `1/10`. Omitted means no finite cap: the rate may reach 0, which is
 *   the hard clamp used today. A finite cap saturates smoothly.
 * - `tidalStrength` — hull damage per second from the gravity gradient near a
 *   white dwarf, neutron star or black hole. Omitted or 0 deals none.
 * - `dragStrength` — scales drag inside a body's `atmosphereRadius`. Omitted
 *   or 0 is no drag. The force only slows the ship relative to that body.
 *
 * A body may carry `magnet` and `beam`. See those objects on `Body`.
 */
export interface LevelPhysics {
  c?: number;
  gravityScale?: number;
  eps?: number;
  p?: number;
  dilationStrength?: number;
  dilationCap?: number;
  tidalStrength?: number;
  dragStrength?: number;
  /** mSv per second per unit of environmental dose rate. Omitted is 0. */
  dosePerD1?: number;
  /** Crew dose in mSv that fails the mission. */
  doseLimit?: number;
}

export interface Level {
  id: string;
  name: string;
  g: number;
  dt: number;
  bodies: readonly Body[];
  targetId: string;
  ship: { x: number; y: number; vx: number; vy: number };
  orbit: { bodyId: string; radius: number };
  fuel: number;
  /** Fuel spent per unit of delta-v. Cost = fuelPerDv * |dv|. */
  fuelPerDv: number;
  bounds: Bounds;
  maxSteps: number;
  /** Delta-v imparted per pixel of aim-drag. */
  dvPerPixel: number;
  /** Captured periapsis must clear the surface by this much. */
  periapsisMargin: number;
  /** Lowered speed of light, world units per second. */
  c: number;
  /** Deadline, crew-time star, and fuel star. Weights are per level. */
  mission: MissionProfile;
  /**
   * Future burns the player may queue at once. Omitted levels allow 2.
   * Passage keeps room for the extra nodes in the original lessons.
   */
  maxPlannedBurns?: number;
  /** Look-ahead of the predicted line. Omitted levels draw the whole flight. */
  horizon?: Horizon;
  /** How pausing works. Omitted levels pause for free, without a limit. */
  pause?: PauseRule;
  /** Knobs. Omitted, or with fields omitted, this is today's physics. */
  physics?: LevelPhysics;
  /** Fuel clouds. Omitted means the level has none. */
  nebulae?: readonly Nebula[];
  /** Asteroid or Kuiper belts. Omitted means the level has none. */
  belts?: readonly Belt[];
  /** Wormhole pairs. Omitted means the level has none. */
  wormholes?: readonly WormholePair[];
}

/** A level file failed to parse or failed the schema. `issues` names each field. */
export class LevelError extends Error {
  readonly source: string;
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    const detail = issues.length === 1 ? issues[0] : issues.map((issue) => `- ${issue}`).join("\n");
    super(issues.length === 1 ? `${source}: ${detail}` : `${source}:\n${detail}`);
    this.name = "LevelError";
    this.source = source;
    this.issues = issues;
  }
}

const LEVEL_KEYS = [
  "id",
  "name",
  "g",
  "dt",
  "bodies",
  "targetId",
  "ship",
  "orbit",
  "fuel",
  "fuelPerDv",
  "bounds",
  "maxSteps",
  "dvPerPixel",
  "periapsisMargin",
  "c",
  "mission",
  "maxPlannedBurns",
  "horizon",
  "pause",
  "physics",
  "nebulae",
  "belts",
  "wormholes",
] as const;

const BODY_KEYS = [
  "id",
  "name",
  "kind",
  "x",
  "y",
  "mass",
  "radius",
  "captureRadius",
  "orbit",
  "look",
  "atmosphereRadius",
  "magnet",
  "beam",
  "harvest",
  "harvestRadius",
  "drift",
  "flare",
  "supernova",
  "quasar",
  "script",
  "engine",
  "dyson",
  "shkadov",
  "ring",
  "elevator",
] as const;
const ENGINE_KEYS = ["angle", "burn", "scoop", "push"] as const;
const DYSON_KEYS = ["coverage", "nick"] as const;
const SHKADOV_KEYS = ["angle", "accel"] as const;
const RING_KEYS = ["angle", "mass", "gaps"] as const;
const RING_GAP_KEYS = ["start", "end"] as const;
const ELEVATOR_KEYS = ["phase", "omega"] as const;
const WORMHOLE_KEYS = ["id", "a", "b", "angle", "clockOffset"] as const;
const MOUTH_KEYS = ["x", "y", "radius"] as const;
const DRIFT_KEYS = ["vx", "vy"] as const;
const FLARE_KEYS = ["angle", "period", "start", "duration"] as const;
const SUPERNOVA_KEYS = ["at", "blast", "speed", "damage"] as const;
const QUASAR_KEYS = ["angle", "cone", "reach", "damage", "period", "sweep"] as const;
const SCRIPT_CONSUME_KEYS = ["kind", "centerId", "start", "end", "radius"] as const;
const SCRIPT_IMPACT_KEYS = ["kind", "at", "into"] as const;
const MAGNET_KEYS = ["b1Reach", "tilt", "averaged"] as const;
const BEAM_KEYS = ["reach", "period", "base", "tip", "damage"] as const;
const BODY_ORBIT_KEYS = ["centerId", "cx", "cy", "radius", "phase", "omega", "kind", "a", "e", "periapsisAngle"] as const;
const NEBULA_KEYS = ["id", "x", "y", "rx", "ry", "angle", "scoop", "look"] as const;
const NEBULA_LOOKS = ["emission", "reflection", "dark"] as const;
const BELT_KEYS = ["id", "centerId", "radius", "width", "tier", "seed", "arcStart", "arcSpan", "dustDamage"] as const;
const BELT_TIERS: readonly BeltTier[] = ["sparse", "medium", "dense", "kuiper"];
const SHIP_KEYS = ["x", "y", "vx", "vy"] as const;
const SHIP_ORBIT_KEYS = ["bodyId", "radius"] as const;
const BOUNDS_KEYS = ["minX", "maxX", "minY", "maxY"] as const;
const MISSION_KEYS = ["deadline", "crewLimit", "fuelStarMin", "crewWeight", "fuelWeight"] as const;
const HORIZON_KEYS = ["seconds", "oneOrbit", "shorten", "ref"] as const;
const PHYSICS_KEYS = [
  "c",
  "gravityScale",
  "eps",
  "p",
  "dilationStrength",
  "dilationCap",
  "tidalStrength",
  "dragStrength",
  "dosePerD1",
  "doseLimit",
] as const;

const BODY_KINDS: readonly BodyKind[] = ["home", "star", "target", "moon", "blackhole", "planet", "rogue"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    if (!allowed.includes(keys[i])) issues.push(`${path}.${keys[i]} is not a recognised field`);
  }
}

function readFinite(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
  opts: { min?: number; max?: number; integer?: boolean; exclusiveMin?: boolean },
): number | undefined {
  const full = `${path}.${key}`;
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    issues.push(`${full} is required`);
    return undefined;
  }
  const raw = value[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    issues.push(`${full} must be a finite number`);
    return undefined;
  }
  if (opts.integer && !Number.isInteger(raw)) {
    issues.push(`${full} must be an integer`);
    return undefined;
  }
  if (opts.min !== undefined && (opts.exclusiveMin ? !(raw > opts.min) : raw < opts.min)) {
    const relation = opts.exclusiveMin ? `greater than ${opts.min}` : `at least ${opts.min}`;
    issues.push(`${full} must be ${relation}`);
    return undefined;
  }
  if (opts.max !== undefined && raw > opts.max) {
    issues.push(`${full} must be at most ${opts.max}`);
    return undefined;
  }
  return raw;
}

function readOptionalFinite(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
  opts: { min?: number; max?: number; integer?: boolean; exclusiveMin?: boolean },
): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return readFinite(value, key, path, issues, opts);
}

function readString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): string | undefined {
  const full = `${path}.${key}`;
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    issues.push(`${full} is required`);
    return undefined;
  }
  const raw = value[key];
  if (typeof raw !== "string" || raw.length === 0) {
    issues.push(`${full} must be a non-empty string`);
    return undefined;
  }
  return raw;
}

function readBoolean(value: Record<string, unknown>, key: string, path: string, issues: string[]): boolean | undefined {
  const full = `${path}.${key}`;
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    issues.push(`${full} is required`);
    return undefined;
  }
  const raw = value[key];
  if (typeof raw !== "boolean") {
    issues.push(`${full} must be a boolean`);
    return undefined;
  }
  return raw;
}

function readBodyOrbit(value: unknown, path: string, issues: string[]): BodyOrbit | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, BODY_ORBIT_KEYS, path, issues);
  const ellipse = value.kind === "ellipse";
  if (Object.prototype.hasOwnProperty.call(value, "kind") && value.kind !== "ellipse") {
    issues.push(`${path}.kind must be "ellipse" when set`);
  }
  const phase = readFinite(value, "phase", path, issues, {});
  if (phase === undefined) return undefined;
  let orbit: BodyOrbit;
  if (ellipse) {
    const a = readFinite(value, "a", path, issues, { min: 0, exclusiveMin: true });
    const eccentricity = readFinite(value, "e", path, issues, { min: 0 });
    const periapsisAngle = readFinite(value, "periapsisAngle", path, issues, {});
    if (a === undefined || eccentricity === undefined || periapsisAngle === undefined) return undefined;
    if (!(eccentricity < 1)) issues.push(`${path}.e must be less than 1`);
    if (!Object.prototype.hasOwnProperty.call(value, "centerId")) {
      issues.push(`${path}.centerId is required for an ellipse`);
    }
    orbit = { kind: "ellipse", a, e: eccentricity, periapsisAngle, phase, radius: a * (1 - eccentricity), omega: 0 };
  } else {
    const radius = readFinite(value, "radius", path, issues, { min: 0, exclusiveMin: true });
    const omega = readFinite(value, "omega", path, issues, {});
    if (radius === undefined || omega === undefined) return undefined;
    orbit = { radius, phase, omega };
  }
  if (Object.prototype.hasOwnProperty.call(value, "centerId")) {
    const centerId = value.centerId;
    if (typeof centerId !== "string" || centerId.length === 0) issues.push(`${path}.centerId must be a non-empty string`);
    else orbit.centerId = centerId;
  }
  const cx = readOptionalFinite(value, "cx", path, issues, {});
  const cy = readOptionalFinite(value, "cy", path, issues, {});
  if (cx !== undefined) orbit.cx = cx;
  if (cy !== undefined) orbit.cy = cy;
  return orbit;
}

function centralMass(body: Body, bodies: readonly Body[]): number | undefined {
  const orbit = body.orbit;
  if (!orbit) return undefined;
  if (orbit.centerId) {
    const center = bodies.find((item) => item.id === orbit.centerId);
    return center && center.mass > 0 ? center.mass : undefined;
  }
  if (orbit.cx === undefined || orbit.cy === undefined) return undefined;
  const host = bodies.find(
    (item) => item.id !== body.id && item.mass > 0 && Math.hypot(item.x - (orbit.cx ?? 0), item.y - (orbit.cy ?? 0)) < 1e-3,
  );
  return host?.mass;
}

/** Store each ellipse's mean motion, and reject a circular moon that is not Kepler. */
function stampOrbits(bodies: Body[], g: number, issues: string[]): void {
  for (let i = 0; i < bodies.length; i++) {
    const orbit = bodies[i].orbit;
    if (!orbit) continue;
    if (orbit.kind === "ellipse") {
      const center = orbit.centerId ? bodies.find((item) => item.id === orbit.centerId) : undefined;
      orbit.omega = keplerMeanMotion(g, center?.mass ?? 0, orbit.a ?? orbit.radius);
      continue;
    }
    const mass = centralMass(bodies[i], bodies);
    if (mass === undefined) continue;
    const expected = keplerMeanMotion(g, mass, orbit.radius);
    if (!(expected > 0)) continue;
    if (Math.abs(orbit.omega / expected - 1) > 0.01) {
      issues.push(`level.bodies[${i}].orbit.omega must be within 1% of √(GM/r³) (${expected})`);
    }
  }
}

function readNebula(value: unknown, path: string, issues: string[]): Nebula | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, NEBULA_KEYS, path, issues);
  const id = readString(value, "id", path, issues);
  const x = readFinite(value, "x", path, issues, {});
  const y = readFinite(value, "y", path, issues, {});
  const rx = readFinite(value, "rx", path, issues, { min: 0, exclusiveMin: true });
  const ry = readFinite(value, "ry", path, issues, { min: 0, exclusiveMin: true });
  const angle = readFinite(value, "angle", path, issues, {});
  const scoop = readFinite(value, "scoop", path, issues, { min: 0 });
  const look = value.look;
  if (!NEBULA_LOOKS.includes(look as (typeof NEBULA_LOOKS)[number])) {
    issues.push(`${path}.look must be one of ${NEBULA_LOOKS.join(", ")}`);
  }
  if (id === undefined || x === undefined || y === undefined || rx === undefined || ry === undefined || angle === undefined || scoop === undefined) {
    return undefined;
  }
  if (typeof look !== "string" || !NEBULA_LOOKS.includes(look as (typeof NEBULA_LOOKS)[number])) return undefined;
  return { id, x, y, rx, ry, angle, scoop, look: look as Nebula["look"] };
}

function readDrift(value: unknown, path: string, issues: string[]): Body["drift"] | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, DRIFT_KEYS, path, issues);
  const vx = readFinite(value, "vx", path, issues, {});
  const vy = readFinite(value, "vy", path, issues, {});
  if (vx === undefined || vy === undefined) return undefined;
  return { vx, vy };
}

function readFlare(value: unknown, path: string, issues: string[]): Body["flare"] | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, FLARE_KEYS, path, issues);
  const angle = readFinite(value, "angle", path, issues, {});
  const period = readFinite(value, "period", path, issues, { min: 0, exclusiveMin: true });
  const start = readFinite(value, "start", path, issues, { min: 0 });
  const duration = readFinite(value, "duration", path, issues, { min: 0, exclusiveMin: true });
  if (angle === undefined || period === undefined || start === undefined || duration === undefined) return undefined;
  return { angle, period, start, duration };
}

function readMagnet(value: unknown, path: string, issues: string[]): Magnet | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, MAGNET_KEYS, path, issues);
  const b1Reach = readFinite(value, "b1Reach", path, issues, { min: 0, exclusiveMin: true });
  const tilt = readFinite(value, "tilt", path, issues, {});
  if (b1Reach === undefined || tilt === undefined) return undefined;
  const magnet: Magnet = { b1Reach, tilt };
  if (Object.prototype.hasOwnProperty.call(value, "averaged")) {
    const averaged = readBoolean(value, "averaged", path, issues);
    if (averaged !== undefined) magnet.averaged = averaged;
  }
  return magnet;
}

function readBeam(value: unknown, path: string, issues: string[]): Beam | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, BEAM_KEYS, path, issues);
  const reach = readFinite(value, "reach", path, issues, { min: 0, exclusiveMin: true });
  const period = readFinite(value, "period", path, issues, { min: 0, exclusiveMin: true });
  if (reach === undefined || period === undefined) return undefined;
  const beam: Beam = { reach, period };
  const base = readOptionalFinite(value, "base", path, issues, { min: 0, exclusiveMin: true });
  const tip = readOptionalFinite(value, "tip", path, issues, { min: 0, exclusiveMin: true });
  const damage = readOptionalFinite(value, "damage", path, issues, { min: 0 });
  if (base !== undefined) beam.base = base;
  if (tip !== undefined) beam.tip = tip;
  if (damage !== undefined) beam.damage = damage;
  return beam;
}

function readBody(value: unknown, path: string, issues: string[]): Body | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, BODY_KEYS, path, issues);
  const id = readString(value, "id", path, issues);
  const name = readString(value, "name", path, issues);
  const kindRaw = value.kind;
  if (!Object.prototype.hasOwnProperty.call(value, "kind")) issues.push(`${path}.kind is required`);
  else if (typeof kindRaw !== "string" || !BODY_KINDS.includes(kindRaw as BodyKind)) {
    issues.push(`${path}.kind must be one of ${BODY_KINDS.join(", ")}`);
  }
  const x = readFinite(value, "x", path, issues, {});
  const y = readFinite(value, "y", path, issues, {});
  const mass = readFinite(value, "mass", path, issues, { min: 0 });
  const radius = readFinite(value, "radius", path, issues, { min: 0, exclusiveMin: true });
  const captureRadius = readOptionalFinite(value, "captureRadius", path, issues, { min: 0, exclusiveMin: true });
  const atmosphereRadius = readOptionalFinite(value, "atmosphereRadius", path, issues, { min: 0, exclusiveMin: true });
  const harvest = readOptionalFinite(value, "harvest", path, issues, { min: 0 });
  const harvestRadius = readOptionalFinite(value, "harvestRadius", path, issues, { min: 0, exclusiveMin: true });
  let drift: Body["drift"];
  if (Object.prototype.hasOwnProperty.call(value, "drift")) drift = readDrift(value.drift, `${path}.drift`, issues);
  let flare: Body["flare"];
  if (Object.prototype.hasOwnProperty.call(value, "flare")) flare = readFlare(value.flare, `${path}.flare`, issues);
  let supernova: Body["supernova"];
  if (Object.prototype.hasOwnProperty.call(value, "supernova")) {
    supernova = readSupernova(value.supernova, `${path}.supernova`, issues);
  }
  let quasar: Body["quasar"];
  if (Object.prototype.hasOwnProperty.call(value, "quasar")) quasar = readQuasar(value.quasar, `${path}.quasar`, issues);
  let script: Body["script"];
  if (Object.prototype.hasOwnProperty.call(value, "script")) script = readScript(value.script, `${path}.script`, issues);
  let engine: StellarEngine | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "engine")) engine = readEngine(value.engine, `${path}.engine`, issues);
  let dyson: DysonSwarm | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "dyson")) dyson = readDyson(value.dyson, `${path}.dyson`, issues);
  let shkadov: ShkadovThruster | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "shkadov")) shkadov = readShkadov(value.shkadov, `${path}.shkadov`, issues);
  let ring: Ringworld | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "ring")) ring = readRing(value.ring, `${path}.ring`, issues);
  let elevator: SpaceElevator | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "elevator")) elevator = readElevator(value.elevator, `${path}.elevator`, issues);
  let look: BodyLook | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "look")) {
    const raw = value.look;
    if (typeof raw !== "string" || !BODY_LOOKS.includes(raw as BodyLook)) {
      issues.push(`${path}.look must be one of ${BODY_LOOKS.join(", ")}`);
    } else look = raw as BodyLook;
  }
  let orbit: BodyOrbit | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "orbit")) orbit = readBodyOrbit(value.orbit, `${path}.orbit`, issues);
  let magnet: Magnet | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "magnet")) magnet = readMagnet(value.magnet, `${path}.magnet`, issues);
  let beam: Beam | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "beam")) beam = readBeam(value.beam, `${path}.beam`, issues);
  if (atmosphereRadius !== undefined && radius !== undefined && !(atmosphereRadius > radius)) {
    issues.push(`${path}.atmosphereRadius must be greater than radius`);
  }
  if (id === undefined || name === undefined || x === undefined || y === undefined || mass === undefined || radius === undefined) {
    return undefined;
  }
  if (typeof kindRaw !== "string" || !BODY_KINDS.includes(kindRaw as BodyKind)) return undefined;
  const body: Body = { id, name, kind: kindRaw as BodyKind, x, y, mass, radius };
  if (captureRadius !== undefined) body.captureRadius = captureRadius;
  if (atmosphereRadius !== undefined) body.atmosphereRadius = atmosphereRadius;
  if (look) body.look = look;
  if (orbit) body.orbit = orbit;
  if (magnet) body.magnet = magnet;
  if (beam) body.beam = beam;
  if (harvest !== undefined) body.harvest = harvest;
  if (harvestRadius !== undefined) body.harvestRadius = harvestRadius;
  if (drift && orbit) issues.push(`${path} cannot set both drift and orbit`);
  if (kindRaw === "rogue" && orbit) issues.push(`${path} a rogue planet travels in a straight line, not an orbit`);
  if (drift) body.drift = drift;
  if (flare) body.flare = flare;
  if (supernova) body.supernova = supernova;
  if (quasar) body.quasar = quasar;
  if (script) body.script = script;
  if (engine) body.engine = engine;
  if (dyson) body.dyson = dyson;
  if (shkadov) body.shkadov = shkadov;
  if (ring) body.ring = ring;
  if (elevator) body.elevator = elevator;
  if (harvestRadius !== undefined && radius !== undefined && !(harvestRadius > radius)) {
    issues.push(`${path}.harvestRadius must be greater than radius`);
  }
  return body;
}

function readEngine(value: unknown, path: string, issues: string[]): StellarEngine | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, ENGINE_KEYS, path, issues);
  const angle = readFinite(value, "angle", path, issues, {});
  const burn = readFinite(value, "burn", path, issues, { min: 0 });
  const scoop = readFinite(value, "scoop", path, issues, { min: 0 });
  const push = readFinite(value, "push", path, issues, { min: 0 });
  if (angle === undefined || burn === undefined || scoop === undefined || push === undefined) return undefined;
  return { angle, burn, scoop, push };
}

function readDyson(value: unknown, path: string, issues: string[]): DysonSwarm | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, DYSON_KEYS, path, issues);
  const coverage = readFinite(value, "coverage", path, issues, { min: 0, max: 1, exclusiveMin: true });
  const nick = readFinite(value, "nick", path, issues, { min: 0 });
  if (coverage === undefined || nick === undefined) return undefined;
  return { coverage, nick };
}

function readRing(value: unknown, path: string, issues: string[]): Ringworld | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, RING_KEYS, path, issues);
  const angle = readFinite(value, "angle", path, issues, {});
  const mass = readFinite(value, "mass", path, issues, { min: 0 });
  if (!Object.prototype.hasOwnProperty.call(value, "gaps")) issues.push(`${path}.gaps is required`);
  else if (!Array.isArray(value.gaps)) issues.push(`${path}.gaps must be an array`);
  const gaps: { start: number; end: number }[] = [];
  if (Array.isArray(value.gaps)) {
    for (let i = 0; i < value.gaps.length; i++) {
      const gap = value.gaps[i];
      const gapPath = `${path}.gaps[${i}]`;
      if (!isObject(gap)) {
        issues.push(`${gapPath} must be an object`);
        continue;
      }
      rejectUnknown(gap, RING_GAP_KEYS, gapPath, issues);
      const start = readFinite(gap, "start", gapPath, issues, {});
      const end = readFinite(gap, "end", gapPath, issues, {});
      if (start === undefined || end === undefined) continue;
      gaps.push({ start, end });
    }
  }
  if (angle === undefined || mass === undefined) return undefined;
  if (!Array.isArray(value.gaps)) return undefined;
  return { angle, mass, gaps };
}

function readElevator(value: unknown, path: string, issues: string[]): SpaceElevator | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, ELEVATOR_KEYS, path, issues);
  const phase = readFinite(value, "phase", path, issues, {});
  const omega = readFinite(value, "omega", path, issues, {});
  if (phase === undefined || omega === undefined) return undefined;
  return { phase, omega };
}

function readMouth(value: unknown, path: string, issues: string[]): WormholePair["a"] | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, MOUTH_KEYS, path, issues);
  const x = readFinite(value, "x", path, issues, {});
  const y = readFinite(value, "y", path, issues, {});
  const radius = readFinite(value, "radius", path, issues, { min: 0, exclusiveMin: true });
  if (x === undefined || y === undefined || radius === undefined) return undefined;
  return { x, y, radius };
}

function readWormhole(value: unknown, path: string, issues: string[]): WormholePair | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, WORMHOLE_KEYS, path, issues);
  const id = readString(value, "id", path, issues);
  const a = readMouth(value.a, `${path}.a`, issues);
  const b = readMouth(value.b, `${path}.b`, issues);
  const angle = readFinite(value, "angle", path, issues, {});
  const clockOffset = readFinite(value, "clockOffset", path, issues, {});
  if (id === undefined || a === undefined || b === undefined || angle === undefined || clockOffset === undefined) return undefined;
  return { id, a, b, angle, clockOffset };
}

function readShkadov(value: unknown, path: string, issues: string[]): ShkadovThruster | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, SHKADOV_KEYS, path, issues);
  const angle = readFinite(value, "angle", path, issues, {});
  const accel = readFinite(value, "accel", path, issues, { min: 0 });
  if (angle === undefined || accel === undefined) return undefined;
  return { angle, accel };
}

function readSupernova(value: unknown, path: string, issues: string[]): Body["supernova"] | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, SUPERNOVA_KEYS, path, issues);
  const at = readFinite(value, "at", path, issues, { min: 0 });
  const blast = readFinite(value, "blast", path, issues, { min: 0 });
  const speed = readFinite(value, "speed", path, issues, { min: 0 });
  const damage = readFinite(value, "damage", path, issues, { min: 0 });
  if (at === undefined || blast === undefined || speed === undefined || damage === undefined) return undefined;
  return { at, blast, speed, damage };
}

function readQuasar(value: unknown, path: string, issues: string[]): Body["quasar"] | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, QUASAR_KEYS, path, issues);
  const angle = readFinite(value, "angle", path, issues, {});
  const cone = readFinite(value, "cone", path, issues, { min: 0, exclusiveMin: true });
  const reach = readFinite(value, "reach", path, issues, { min: 0, exclusiveMin: true });
  const damage = readFinite(value, "damage", path, issues, { min: 0 });
  const period = readOptionalFinite(value, "period", path, issues, { min: 0 });
  const sweep = readOptionalFinite(value, "sweep", path, issues, {});
  if (angle === undefined || cone === undefined || reach === undefined || damage === undefined) return undefined;
  const jet: NonNullable<Body["quasar"]> = { angle, cone, reach, damage };
  if (period !== undefined) jet.period = period;
  if (sweep !== undefined) jet.sweep = sweep;
  return jet;
}

function readScript(value: unknown, path: string, issues: string[]): Body["script"] | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  if (value.kind === "consume") {
    rejectUnknown(value, SCRIPT_CONSUME_KEYS, path, issues);
    const centerId = readString(value, "centerId", path, issues);
    const start = readFinite(value, "start", path, issues, { min: 0 });
    const end = readFinite(value, "end", path, issues, { min: 0, exclusiveMin: true });
    const radius = readFinite(value, "radius", path, issues, { min: 0, exclusiveMin: true });
    if (centerId === undefined || start === undefined || end === undefined || radius === undefined) return undefined;
    if (!(end > start)) issues.push(`${path}.end must be after start`);
    return { kind: "consume", centerId, start, end, radius };
  }
  if (value.kind === "impact") {
    rejectUnknown(value, SCRIPT_IMPACT_KEYS, path, issues);
    const at = readFinite(value, "at", path, issues, { min: 0 });
    const into = readOptionalString(value, "into", path, issues);
    if (at === undefined) return undefined;
    return into !== undefined ? { kind: "impact", at, into } : { kind: "impact", at };
  }
  issues.push(`${path}.kind must be "consume" or "impact"`);
  return undefined;
}

function readOptionalString(value: Record<string, unknown>, key: string, path: string, issues: string[]): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return readString(value, key, path, issues);
}

function readPhysics(value: unknown, path: string, issues: string[]): LevelPhysics | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, PHYSICS_KEYS, path, issues);
  const physics: LevelPhysics = {};
  const c = readOptionalFinite(value, "c", path, issues, { min: 0, exclusiveMin: true });
  const gravityScale = readOptionalFinite(value, "gravityScale", path, issues, { min: 0, exclusiveMin: true });
  const eps = readOptionalFinite(value, "eps", path, issues, { min: 0 });
  const p = readOptionalFinite(value, "p", path, issues, { min: 1, exclusiveMin: true });
  const dilationStrength = readOptionalFinite(value, "dilationStrength", path, issues, { min: 0 });
  const dilationCap = readOptionalFinite(value, "dilationCap", path, issues, { min: 1 });
  const tidalStrength = readOptionalFinite(value, "tidalStrength", path, issues, { min: 0 });
  const dragStrength = readOptionalFinite(value, "dragStrength", path, issues, { min: 0 });
  const dosePerD1 = readOptionalFinite(value, "dosePerD1", path, issues, { min: 0 });
  const doseLimit = readOptionalFinite(value, "doseLimit", path, issues, { min: 0 });
  if (c !== undefined) physics.c = c;
  if (gravityScale !== undefined) physics.gravityScale = gravityScale;
  if (eps !== undefined) physics.eps = eps;
  if (p !== undefined) physics.p = p;
  if (dilationStrength !== undefined) physics.dilationStrength = dilationStrength;
  if (dilationCap !== undefined) physics.dilationCap = dilationCap;
  if (tidalStrength !== undefined) physics.tidalStrength = tidalStrength;
  if (dragStrength !== undefined) physics.dragStrength = dragStrength;
  if (dosePerD1 !== undefined) physics.dosePerD1 = dosePerD1;
  if (doseLimit !== undefined) physics.doseLimit = doseLimit;
  return physics;
}

function readPause(value: unknown, path: string, issues: string[]): PauseRule | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  const kind = value.kind;
  if (kind === "unlimited") {
    rejectUnknown(value, ["kind"], path, issues);
    return { kind: "unlimited" };
  }
  if (kind === "free") {
    rejectUnknown(value, ["kind", "count"], path, issues);
    const count = readFinite(value, "count", path, issues, { min: 0, integer: true });
    if (count === undefined) return undefined;
    return { kind: "free", count };
  }
  if (kind === "score") {
    rejectUnknown(value, ["kind", "cost", "budget"], path, issues);
    const cost = readFinite(value, "cost", path, issues, { min: 0, exclusiveMin: true });
    const budget = readFinite(value, "budget", path, issues, { min: 0 });
    if (cost === undefined || budget === undefined) return undefined;
    return { kind: "score", cost, budget };
  }
  issues.push(`${path}.kind must be "unlimited", "free", or "score"`);
  return undefined;
}

/**
 * Validate a parsed level. Throws `LevelError` with one line per problem.
 * Numbers are copied through unchanged so a round-tripped file stays bit-exact.
 */
export function loadLevelData(data: unknown, source = "level"): Level {
  const issues: string[] = [];
  if (!isObject(data)) throw new LevelError(source, ["level must be a JSON object"]);
  rejectUnknown(data, LEVEL_KEYS, "level", issues);

  const id = readString(data, "id", "level", issues);
  const name = readString(data, "name", "level", issues);
  const g = readFinite(data, "g", "level", issues, { min: 0, exclusiveMin: true });
  const dt = readFinite(data, "dt", "level", issues, { min: 0, exclusiveMin: true });
  const targetId = readString(data, "targetId", "level", issues);

  const bodies: Body[] = [];
  if (!Object.prototype.hasOwnProperty.call(data, "bodies")) issues.push("level.bodies is required");
  else if (!Array.isArray(data.bodies) || data.bodies.length === 0) issues.push("level.bodies must be a non-empty array");
  else {
    const seen = new Set<string>();
    for (let i = 0; i < data.bodies.length; i++) {
      const body = readBody(data.bodies[i], `level.bodies[${i}]`, issues);
      if (!body) continue;
      if (seen.has(body.id)) issues.push(`level.bodies[${i}].id "${body.id}" is duplicated`);
      seen.add(body.id);
      bodies.push(body);
    }
  }

  let ship: Level["ship"] | undefined;
  if (!Object.prototype.hasOwnProperty.call(data, "ship")) issues.push("level.ship is required");
  else if (!isObject(data.ship)) issues.push("level.ship must be an object");
  else {
    rejectUnknown(data.ship, SHIP_KEYS, "level.ship", issues);
    const x = readFinite(data.ship, "x", "level.ship", issues, {});
    const y = readFinite(data.ship, "y", "level.ship", issues, {});
    const vx = readFinite(data.ship, "vx", "level.ship", issues, {});
    const vy = readFinite(data.ship, "vy", "level.ship", issues, {});
    if (x !== undefined && y !== undefined && vx !== undefined && vy !== undefined) ship = { x, y, vx, vy };
  }

  let orbit: Level["orbit"] | undefined;
  if (!Object.prototype.hasOwnProperty.call(data, "orbit")) issues.push("level.orbit is required");
  else if (!isObject(data.orbit)) issues.push("level.orbit must be an object");
  else {
    rejectUnknown(data.orbit, SHIP_ORBIT_KEYS, "level.orbit", issues);
    const bodyId = readString(data.orbit, "bodyId", "level.orbit", issues);
    const radius = readFinite(data.orbit, "radius", "level.orbit", issues, { min: 0, exclusiveMin: true });
    if (bodyId !== undefined && radius !== undefined) orbit = { bodyId, radius };
  }

  const fuel = readFinite(data, "fuel", "level", issues, { min: 0 });
  const fuelPerDv = readFinite(data, "fuelPerDv", "level", issues, { min: 0, exclusiveMin: true });

  let bounds: Bounds | undefined;
  if (!Object.prototype.hasOwnProperty.call(data, "bounds")) issues.push("level.bounds is required");
  else if (!isObject(data.bounds)) issues.push("level.bounds must be an object");
  else {
    rejectUnknown(data.bounds, BOUNDS_KEYS, "level.bounds", issues);
    const minX = readFinite(data.bounds, "minX", "level.bounds", issues, {});
    const maxX = readFinite(data.bounds, "maxX", "level.bounds", issues, {});
    const minY = readFinite(data.bounds, "minY", "level.bounds", issues, {});
    const maxY = readFinite(data.bounds, "maxY", "level.bounds", issues, {});
    if (minX !== undefined && maxX !== undefined && minY !== undefined && maxY !== undefined) {
      if (!(maxX > minX) || !(maxY > minY)) issues.push("level.bounds max must be greater than min");
      bounds = { minX, maxX, minY, maxY };
    }
  }

  const maxSteps = readFinite(data, "maxSteps", "level", issues, { min: 1, integer: true });
  const dvPerPixel = readFinite(data, "dvPerPixel", "level", issues, { min: 0, exclusiveMin: true });
  const periapsisMargin = readFinite(data, "periapsisMargin", "level", issues, { min: 0 });
  const c = readFinite(data, "c", "level", issues, { min: 0, exclusiveMin: true });

  let mission: MissionProfile | undefined;
  if (!Object.prototype.hasOwnProperty.call(data, "mission")) issues.push("level.mission is required");
  else if (!isObject(data.mission)) issues.push("level.mission must be an object");
  else {
    rejectUnknown(data.mission, MISSION_KEYS, "level.mission", issues);
    const deadline = readFinite(data.mission, "deadline", "level.mission", issues, { min: 0 });
    const crewLimit = readFinite(data.mission, "crewLimit", "level.mission", issues, { min: 0 });
    const fuelStarMin = readFinite(data.mission, "fuelStarMin", "level.mission", issues, { min: 0 });
    const crewWeight = readFinite(data.mission, "crewWeight", "level.mission", issues, { min: 0 });
    const fuelWeight = readFinite(data.mission, "fuelWeight", "level.mission", issues, { min: 0 });
    if (
      deadline !== undefined &&
      crewLimit !== undefined &&
      fuelStarMin !== undefined &&
      crewWeight !== undefined &&
      fuelWeight !== undefined
    ) {
      mission = { deadline, crewLimit, fuelStarMin, crewWeight, fuelWeight };
    }
  }

  const maxPlannedBurns = readOptionalFinite(data, "maxPlannedBurns", "level", issues, { min: 1, integer: true });

  let horizon: Horizon | undefined;
  if (Object.prototype.hasOwnProperty.call(data, "horizon")) {
    if (!isObject(data.horizon)) issues.push("level.horizon must be an object");
    else {
      rejectUnknown(data.horizon, HORIZON_KEYS, "level.horizon", issues);
      const seconds = readFinite(data.horizon, "seconds", "level.horizon", issues, { min: 0, exclusiveMin: true });
      const oneOrbit = readBoolean(data.horizon, "oneOrbit", "level.horizon", issues);
      const shorten = readFinite(data.horizon, "shorten", "level.horizon", issues, { min: 0 });
      const ref = readFinite(data.horizon, "ref", "level.horizon", issues, { min: 0, exclusiveMin: true });
      if (seconds !== undefined && oneOrbit !== undefined && shorten !== undefined && ref !== undefined) {
        horizon = { seconds, oneOrbit, shorten, ref };
      }
    }
  }

  let pause: PauseRule | undefined;
  if (Object.prototype.hasOwnProperty.call(data, "pause")) pause = readPause(data.pause, "level.pause", issues);

  let physics: LevelPhysics | undefined;
  if (Object.prototype.hasOwnProperty.call(data, "physics")) physics = readPhysics(data.physics, "level.physics", issues);

  const nebulae: Nebula[] = [];
  if (Object.prototype.hasOwnProperty.call(data, "nebulae")) {
    if (!Array.isArray(data.nebulae)) issues.push("level.nebulae must be an array");
    else {
      for (let i = 0; i < data.nebulae.length; i++) {
        const cloud = readNebula(data.nebulae[i], `level.nebulae[${i}]`, issues);
        if (cloud) nebulae.push(cloud);
      }
    }
  }

  if (targetId !== undefined && bodies.length > 0 && !bodies.some((body) => body.id === targetId)) {
    issues.push(`level.targetId "${targetId}" does not match a body`);
  }
  if (orbit && bodies.length > 0 && !bodies.some((body) => body.id === orbit.bodyId)) {
    issues.push(`level.orbit.bodyId "${orbit.bodyId}" does not match a body`);
  }
  for (let i = 0; i < bodies.length; i++) {
    const centerId = bodies[i].orbit?.centerId;
    if (centerId !== undefined && !bodies.some((body) => body.id === centerId)) {
      issues.push(`level.bodies[${i}].orbit.centerId "${centerId}" does not match a body`);
    }
    const script = bodies[i].script;
    if (script?.kind === "consume" && !bodies.some((body) => body.id === script.centerId)) {
      issues.push(`level.bodies[${i}].script.centerId "${script.centerId}" does not match a body`);
    }
    if (script?.kind === "impact" && script.into !== undefined && !bodies.some((body) => body.id === script.into)) {
      issues.push(`level.bodies[${i}].script.into "${script.into}" does not match a body`);
    }
  }
  const orbitScale = g !== undefined && physics?.gravityScale !== undefined ? g * physics.gravityScale : g;
  if (orbitScale !== undefined) stampOrbits(bodies, orbitScale, issues);

  const belts: Belt[] = [];
  if (Object.prototype.hasOwnProperty.call(data, "belts")) {
    if (!Array.isArray(data.belts)) issues.push("level.belts must be an array");
    else {
      const ids = new Set(bodies.map((body) => body.id));
      for (let i = 0; i < data.belts.length; i++) {
        const belt = readBelt(data.belts[i], `level.belts[${i}]`, issues, ids);
        if (belt) belts.push(belt);
      }
    }
  }

  const wormholes: WormholePair[] = [];
  if (Object.prototype.hasOwnProperty.call(data, "wormholes")) {
    if (!Array.isArray(data.wormholes)) issues.push("level.wormholes must be an array");
    else {
      const seen = new Set<string>();
      for (let i = 0; i < data.wormholes.length; i++) {
        const hole = readWormhole(data.wormholes[i], `level.wormholes[${i}]`, issues);
        if (!hole) continue;
        if (seen.has(hole.id)) issues.push(`level.wormholes[${i}].id "${hole.id}" is duplicated`);
        seen.add(hole.id);
        wormholes.push(hole);
      }
    }
  }

  if (
    issues.length > 0 ||
    id === undefined ||
    name === undefined ||
    g === undefined ||
    dt === undefined ||
    targetId === undefined ||
    ship === undefined ||
    orbit === undefined ||
    fuel === undefined ||
    fuelPerDv === undefined ||
    bounds === undefined ||
    maxSteps === undefined ||
    dvPerPixel === undefined ||
    periapsisMargin === undefined ||
    c === undefined ||
    mission === undefined
  ) {
    throw new LevelError(source, issues.length > 0 ? issues : ["level is incomplete"]);
  }
  const level: Level = {
    id,
    name,
    g,
    dt,
    bodies,
    targetId,
    ship,
    orbit,
    fuel,
    fuelPerDv,
    bounds,
    maxSteps,
    dvPerPixel,
    periapsisMargin,
    c,
    mission,
  };
  if (maxPlannedBurns !== undefined) level.maxPlannedBurns = maxPlannedBurns;
  if (horizon) level.horizon = horizon;
  if (pause) level.pause = pause;
  if (physics) level.physics = physics;
  if (nebulae.length > 0) level.nebulae = nebulae;
  if (belts.length > 0) level.belts = belts;
  if (wormholes.length > 0) level.wormholes = wormholes;
  return level;
}

function readBelt(value: unknown, path: string, issues: string[], bodyIds: ReadonlySet<string>): Belt | undefined {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknown(value, BELT_KEYS, path, issues);
  const id = readString(value, "id", path, issues);
  const centerId = readString(value, "centerId", path, issues);
  const radius = readFinite(value, "radius", path, issues, { min: 0, exclusiveMin: true });
  const width = readFinite(value, "width", path, issues, { min: 0, exclusiveMin: true });
  const seed = readFinite(value, "seed", path, issues, { min: 0, integer: true });
  const tierRaw = value.tier;
  if (!Object.prototype.hasOwnProperty.call(value, "tier")) issues.push(`${path}.tier is required`);
  else if (typeof tierRaw !== "string" || !BELT_TIERS.includes(tierRaw as BeltTier)) {
    issues.push(`${path}.tier must be one of ${BELT_TIERS.join(", ")}`);
  }
  const arcStart = readOptionalFinite(value, "arcStart", path, issues, {});
  const arcSpan = readOptionalFinite(value, "arcSpan", path, issues, { min: 0, exclusiveMin: true, max: Math.PI * 2 });
  const dustDamage = readOptionalFinite(value, "dustDamage", path, issues, { min: 0 });
  if (centerId !== undefined && bodyIds.size > 0 && !bodyIds.has(centerId)) {
    issues.push(`${path}.centerId "${centerId}" does not match a body`);
  }
  if (id === undefined || centerId === undefined || radius === undefined || width === undefined || seed === undefined) return undefined;
  if (typeof tierRaw !== "string" || !BELT_TIERS.includes(tierRaw as BeltTier)) return undefined;
  const belt: Belt = { id, centerId, radius, width, tier: tierRaw as BeltTier, seed };
  if (arcStart !== undefined) belt.arcStart = arcStart;
  if (arcSpan !== undefined) belt.arcSpan = arcSpan;
  if (dustDamage !== undefined) belt.dustDamage = dustDamage;
  return belt;
}

/** Parse JSON text, then validate it. Malformed JSON names the syntax error. */
export function loadLevelJson(text: string, source = "level"): Level {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LevelError(source, [`invalid JSON (${detail})`]);
  }
  return loadLevelData(data, source);
}
