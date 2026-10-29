import {
  bodyPose,
  gravityConstant,
  isCompactBody,
  STRESS_WARN,
  type SimConfig,
  type Vec2,
} from "../sim/physics";

/**
 * Visual rules for the ship-systems art (design/threejs-notes.md §13).
 * These read hull and stress. They do not change the simulation.
 */

export type EngineLook = "chemical" | "ion" | "pulse";
export type DamageBand = "none" | "75" | "45" | "15";
export type HullTone = "ok" | "warn" | "critical";
export type StressLevel = 0 | 1 | 2 | 3;

export type PartKey =
  | "solar"
  | "tanks"
  | "platingBack"
  | "engine"
  | "hull"
  | "platingFront"
  | "cryo"
  | "scoop"
  | "sensors"
  | "shield"
  | "damage";

export interface ShipBuild {
  solar: boolean;
  tanks: boolean;
  plating: boolean;
  shield: boolean;
  scoop: boolean;
  sensors: boolean;
  cryo: boolean;
  engine: EngineLook;
}

export interface PlumeLook {
  length: number;
  halfWidth: number;
  turbulence: number;
  core: string;
  edge: string;
  /** Multiplier on sim time inside the plume shader. Ion shimmers slowly. */
  timeScale: number;
  /** Chemical and ion stay lit. Pulse is a flash, not a continuous plume. */
  continuous: boolean;
  /**
   * Noseward edge of the plume, in SVG local y (positive is aft).
   * The ship group origin is the ship centre, and nose is +Y, so the
   * mesh starts at `-root`. design/assets/ship/engine-*.svg.
   */
  root: number;
}

/** Plume ids stripped out of the nozzle sprite. The shader draws the plume. */
export const ENGINE_PLUME_IDS: Record<EngineLook, readonly string[]> = {
  chemical: ["sxEcPlume", "sxEcGlow"],
  ion: ["sxEiPlume", "sxEiGlow"],
  pulse: ["sxEpPlume"],
};

/**
 * Sizes are design units in the 96×160 frame (nose +Y).
 * No separate bloom halo: one plume shape, blue-white into violet.
 */
export const ENGINE_PLUMES: Record<EngineLook, PlumeLook> = {
  chemical: {
    length: 96,
    halfWidth: 8,
    turbulence: 0.42,
    core: "#F7FBFF",
    edge: "#A06BFF",
    timeScale: 1,
    continuous: true,
    root: 28.2,
  },
  ion: {
    length: 128,
    halfWidth: 10.5,
    turbulence: 0.04,
    core: "#F2F9FF",
    edge: "#A06BFF",
    timeScale: 0.16,
    continuous: true,
    root: 25.5,
  },
  pulse: {
    length: 36,
    halfWidth: 11,
    turbulence: 0,
    core: "#FFFFFF",
    edge: "#A06BFF",
    timeScale: 1,
    continuous: false,
    root: 36,
  },
};

/** Pulse flash period, in sim seconds. */
export const PULSE_PERIOD = 0.6;

const HULL_SEGMENTS = 10;

export function hullRatio(hull: number, hullMax: number): number {
  const max = hullMax > 0 ? hullMax : 1;
  return Math.max(0, Math.min(1, hull / max));
}

/** One overlay: none at 80–100%, then 75, 45, and 15. */
export function damageBand(hull: number, hullMax: number): DamageBand {
  const ratio = hullRatio(hull, hullMax);
  if (ratio >= 0.8) return "none";
  if (ratio >= 0.5) return "75";
  if (ratio >= 0.25) return "45";
  return "15";
}

/** Bar colour. Separate from the damage overlay thresholds. */
export function hullTone(hull: number, hullMax: number): HullTone {
  const ratio = hullRatio(hull, hullMax);
  if (ratio >= 0.6) return "ok";
  if (ratio >= 0.3) return "warn";
  return "critical";
}

/** How many of the 10 hull segments are lit. Empty only at 0. */
export function hullSegmentsLit(hull: number, hullMax: number): number {
  const ratio = hullRatio(hull, hullMax);
  if (ratio <= 0) return 0;
  return Math.max(1, Math.round(ratio * HULL_SEGMENTS));
}

/**
 * Chip levels from the same stress number the sim stores.
 * Level 3 is the existing red-zone threshold (`STRESS_WARN`), where the hull
 * is coming apart quickly. The chip stays hidden at 0.
 */
export function stressLevel(stress: number): StressLevel {
  if (!(stress > 0)) return 0;
  if (stress >= STRESS_WARN) return 3;
  if (stress >= STRESS_WARN / 2) return 2;
  return 1;
}

/** Zoom steps of 25%, used only to decide when to rebake sprites. */
export function zoomBucket(zoom: number): number {
  const stepped = Math.round(Math.max(0, zoom) * 4) / 4;
  return Math.max(0.25, stepped);
}

export function shipBuild(
  upgrades: readonly string[],
  look: { engine: EngineLook; shield: boolean; scoop: boolean; sensors: boolean; cryo: boolean },
): ShipBuild {
  const owned = new Set(upgrades);
  return {
    solar: owned.has("solar"),
    tanks: owned.has("tanks"),
    plating: owned.has("hull"),
    shield: look.shield,
    scoop: look.scoop,
    sensors: look.sensors,
    cryo: look.cryo,
    engine: look.engine,
  };
}

/** Draw order from §13. Plume is inserted by the view between back modules and the hull. */
export function visibleParts(build: ShipBuild, band: DamageBand): PartKey[] {
  const parts: PartKey[] = [];
  if (build.solar) parts.push("solar");
  if (build.tanks) parts.push("tanks");
  if (build.plating) parts.push("platingBack");
  parts.push("engine", "hull");
  if (build.plating) parts.push("platingFront");
  if (build.cryo) parts.push("cryo");
  if (build.scoop) parts.push("scoop");
  if (build.sensors) parts.push("sensors");
  if (build.shield) parts.push("shield");
  if (band !== "none") parts.push("damage");
  return parts;
}

/** True when a star is close enough that solar panels would be charging. */
export function chargingNearStar(x: number, y: number, config: SimConfig, time: number): boolean {
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star" || !(body.radius > 0)) continue;
    const pose = body.orbit ? bodyPose(body, time, bodies) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const r = Math.hypot(x - pose.x, y - pose.y);
    if (r > 1e-6 && r <= body.radius * 12) return true;
  }
  return false;
}

/** Direction from the ship toward the compact body with the strongest GM/r³. */
export function tidalAxis(x: number, y: number, config: SimConfig, time: number): Vec2 | null {
  const g = gravityConstant(config);
  let best = 0;
  let dx = 0;
  let dy = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!isCompactBody(body) || !(body.mass > 0)) continue;
    const pose = body.orbit ? bodyPose(body, time, bodies) : { x: body.x, y: body.y, vx: 0, vy: 0 };
    const ox = x - pose.x;
    const oy = y - pose.y;
    const r2 = ox * ox + oy * oy;
    const r = Math.sqrt(r2);
    if (!(r > body.radius)) continue;
    const pull = (g * body.mass) / (r2 * r);
    if (pull > best) {
      best = pull;
      dx = ox;
      dy = oy;
    }
  }
  if (!(best > 0)) return null;
  return { x: dx, y: dy };
}
