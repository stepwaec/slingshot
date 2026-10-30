import type { PauseRule, SimConfig } from "../sim/physics";
import { observatory } from "./observatory";
import type { Level, LevelPhysics } from "./schema";
import { shipLoadout } from "../game/upgrades";
import { placeBelts } from "../sim/belts";
import { ASTRO_CAPACITY, ASTRO_DV, ASTRO_HARVEST_RATE, flattenKnots } from "../sim/astrophage";

/**
 * Shipped levels. The Sol campaign is not built yet, so this list is empty.
 * New missions will be assembled from the body library. The Observatory is
 * the showcase and is not part of this list.
 */

export const LEVELS: readonly Level[] = [];

/** Showcase chart. The playable chart until Sol missions exist. */
export { observatory };

export function burnLimit(level: Level): number {
  return level.maxPlannedBurns ?? 2;
}

export function pauseRuleOf(level: Level): PauseRule {
  return level.pause ?? { kind: "unlimited" };
}

/**
 * Sim config for a level. Physics knobs that the file omits stay off the
 * config object, and the integrator treats that as today's behaviour.
 * `physics.c`, when set, replaces the level `c`.
 * Upgrades fold into mass, hull, tank size, engines and solar recharge.
 * With no upgrades the fuel numbers match the level file.
 */
export function simConfigFromLevel(level: Level, upgrades: readonly string[] = []): SimConfig {
  const physics: LevelPhysics | undefined = level.physics;
  const load = shipLoadout(upgrades);
  const config: SimConfig = {
    g: level.g,
    dt: level.dt,
    bodies: level.bodies,
    bounds: level.bounds,
    maxSteps: level.maxSteps,
    targetId: level.targetId,
    periapsisMargin: level.periapsisMargin,
    c: physics?.c ?? level.c,
    horizon: level.horizon,
    fuelPerDv: level.fuelPerDv * load.mass,
    fuelStart: level.fuel * load.fuelFactor,
    fuelMax: level.fuel * load.fuelFactor,
  };
  if (load.mass !== 1) config.shipMass = load.mass;
  if (load.engine !== 1) config.engineScale = load.engine;
  if (load.hullMax !== 100) config.hullMax = load.hullMax;
  if (load.solar > 0) config.solarStrength = load.solar;
  if (physics?.gravityScale !== undefined) config.gravityScale = physics.gravityScale;
  if (physics?.eps !== undefined) config.eps = physics.eps;
  if (physics?.p !== undefined) config.p = physics.p;
  if (physics?.dilationStrength !== undefined) config.dilationStrength = physics.dilationStrength;
  if (physics?.dilationCap !== undefined) config.dilationCap = physics.dilationCap;
  if (physics?.tidalStrength !== undefined) config.tidalStrength = physics.tidalStrength;
  if (physics?.dragStrength !== undefined) config.dragStrength = physics.dragStrength;
  if (physics?.dosePerD1 !== undefined) config.dosePerD1 = physics.dosePerD1;
  if (physics?.doseLimit !== undefined) config.doseLimit = physics.doseLimit;
  if (load.shield < 1) config.shield = load.shield;
  if (level.nebulae && level.nebulae.length > 0) config.nebulae = level.nebulae;
  if (level.belts && level.belts.length > 0) {
    config.belts = level.belts;
    config.beltRocks = placeBelts(level.belts);
  }
  if (level.wormholes && level.wormholes.length > 0) config.wormholes = level.wormholes;
  if (level.fit?.engine) config.engine = level.fit.engine;
  if (level.fit?.scoop) config.scoop = true;
  if (level.fit?.engine === "spin") {
    const capacity = level.astro?.capacity ?? ASTRO_CAPACITY;
    const start = level.astro?.start ?? 0;
    config.astroCapacity = capacity;
    config.astroStart = start > capacity ? capacity : start;
    config.astroRate = level.astro?.rate ?? ASTRO_HARVEST_RATE;
    config.astroDv = level.astro?.dv ?? ASTRO_DV;
  }
  if (level.petrova && level.petrova.length > 0) {
    config.petrova = level.petrova;
    config.knotFuel = flattenKnots(level.petrova).map((knot) => knot.fuel);
  }
  return config;
}

export type { Level, LevelPhysics, MissionProfile } from "./schema";
export { LevelError, loadLevelData, loadLevelJson } from "./schema";
