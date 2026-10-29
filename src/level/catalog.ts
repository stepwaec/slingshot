import type { Body, PauseRule, SimConfig } from "../sim/physics";
import passageData from "../levels/passage.json";
import relayData from "../levels/relay.json";
import rescueData from "../levels/rescue.json";
import pairData from "../levels/pair.json";
import emberData from "../levels/ember.json";
import chainData from "../levels/chain.json";
import { loadLevelData, type Level, type LevelPhysics } from "./schema";

/**
 * Shipped levels, loaded from `src/levels/*.json`.
 * The files are the level definitions. This module checks them at startup.
 */

export const passage: Level = loadLevelData(passageData, "src/levels/passage.json");
export const relay: Level = loadLevelData(relayData, "src/levels/relay.json");
export const rescue: Level = loadLevelData(rescueData, "src/levels/rescue.json");
export const pair: Level = loadLevelData(pairData, "src/levels/pair.json");
export const ember: Level = loadLevelData(emberData, "src/levels/ember.json");
export const chain: Level = loadLevelData(chainData, "src/levels/chain.json");

export const LEVELS: readonly Level[] = [passage, relay, rescue, pair, ember, chain];

function bodyById(level: Level, id: string): Body {
  const body = level.bodies.find((item) => item.id === id);
  if (!body) throw new Error(`Level ${level.id} is missing body "${id}"`);
  return body;
}

/** Rescue's black hole. Its radius is the horizon baked into the level file. */
export const rescueHole: Body = bodyById(rescue, "hole");

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
 */
export function simConfigFromLevel(level: Level): SimConfig {
  const physics: LevelPhysics | undefined = level.physics;
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
  };
  if (physics?.gravityScale !== undefined) config.gravityScale = physics.gravityScale;
  if (physics?.eps !== undefined) config.eps = physics.eps;
  if (physics?.p !== undefined) config.p = physics.p;
  if (physics?.dilationStrength !== undefined) config.dilationStrength = physics.dilationStrength;
  if (physics?.dilationCap !== undefined) config.dilationCap = physics.dilationCap;
  if (physics?.tidalStrength !== undefined) config.tidalStrength = physics.tidalStrength;
  if (physics?.dragStrength !== undefined) config.dragStrength = physics.dragStrength;
  return config;
}

export type { Level, LevelPhysics, MissionProfile } from "./schema";
export { LevelError, loadLevelData, loadLevelJson } from "./schema";
