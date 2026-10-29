import {
  BODY_LOOKS,
  type Body,
  type BodyKind,
  type BodyLook,
  type BodyOrbit,
  type Bounds,
  type Horizon,
  type PauseRule,
} from "../sim/physics";

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
] as const;
const BODY_ORBIT_KEYS = ["centerId", "cx", "cy", "radius", "phase", "omega"] as const;
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
] as const;

const BODY_KINDS: readonly BodyKind[] = ["home", "star", "target", "moon", "blackhole", "planet"];

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
  const radius = readFinite(value, "radius", path, issues, { min: 0, exclusiveMin: true });
  const phase = readFinite(value, "phase", path, issues, {});
  const omega = readFinite(value, "omega", path, issues, {});
  if (radius === undefined || phase === undefined || omega === undefined) return undefined;
  const orbit: BodyOrbit = { radius, phase, omega };
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
  let look: BodyLook | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "look")) {
    const raw = value.look;
    if (typeof raw !== "string" || !BODY_LOOKS.includes(raw as BodyLook)) {
      issues.push(`${path}.look must be one of ${BODY_LOOKS.join(", ")}`);
    } else look = raw as BodyLook;
  }
  let orbit: BodyOrbit | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "orbit")) orbit = readBodyOrbit(value.orbit, `${path}.orbit`, issues);
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
  return body;
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
  if (c !== undefined) physics.c = c;
  if (gravityScale !== undefined) physics.gravityScale = gravityScale;
  if (eps !== undefined) physics.eps = eps;
  if (p !== undefined) physics.p = p;
  if (dilationStrength !== undefined) physics.dilationStrength = dilationStrength;
  if (dilationCap !== undefined) physics.dilationCap = dilationCap;
  if (tidalStrength !== undefined) physics.tidalStrength = tidalStrength;
  if (dragStrength !== undefined) physics.dragStrength = dragStrength;
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
  return level;
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
