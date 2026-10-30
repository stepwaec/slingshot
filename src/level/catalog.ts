import type { Body, PauseRule, SimConfig } from "../sim/physics";
import passageData from "../levels/passage.json";
import relayData from "../levels/relay.json";
import rescueData from "../levels/rescue.json";
import pairData from "../levels/pair.json";
import emberData from "../levels/ember.json";
import chainData from "../levels/chain.json";
import pulseData from "../levels/pulse.json";
import quakeData from "../levels/quake.json";
import needleData from "../levels/needle.json";
import iceData from "../levels/ice.json";
import veilData from "../levels/veil.json";
import driftData from "../levels/drift.json";
import shadeData from "../levels/shade.json";
import wanderData from "../levels/wander.json";
import weaveData from "../levels/weave.json";
import frostData from "../levels/frost.json";
import leadData from "../levels/lead.json";
import flashData from "../levels/flash.json";
import ashData from "../levels/ash.json";
import torchData from "../levels/torch.json";
import hoopData from "../levels/hoop.json";
import cableData from "../levels/cable.json";
import foldData from "../levels/fold.json";
import { observatory } from "./observatory";
import { loadLevelData, type Level, type LevelPhysics } from "./schema";
import { shipLoadout } from "../game/upgrades";
import { placeBelts } from "../sim/belts";

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
export const pulse: Level = loadLevelData(pulseData, "src/levels/pulse.json");
export const quake: Level = loadLevelData(quakeData, "src/levels/quake.json");
export const needle: Level = loadLevelData(needleData, "src/levels/needle.json");
export const ice: Level = loadLevelData(iceData, "src/levels/ice.json");
export const veil: Level = loadLevelData(veilData, "src/levels/veil.json");
export const drift: Level = loadLevelData(driftData, "src/levels/drift.json");
export const shade: Level = loadLevelData(shadeData, "src/levels/shade.json");
export const wander: Level = loadLevelData(wanderData, "src/levels/wander.json");
export const weave: Level = loadLevelData(weaveData, "src/levels/weave.json");
export const frost: Level = loadLevelData(frostData, "src/levels/frost.json");
export const lead: Level = loadLevelData(leadData, "src/levels/lead.json");
export const flash: Level = loadLevelData(flashData, "src/levels/flash.json");
export const ash: Level = loadLevelData(ashData, "src/levels/ash.json");
export const torch: Level = loadLevelData(torchData, "src/levels/torch.json");
export const hoop: Level = loadLevelData(hoopData, "src/levels/hoop.json");
export const cable: Level = loadLevelData(cableData, "src/levels/cable.json");
export const fold: Level = loadLevelData(foldData, "src/levels/fold.json");

export const LEVELS: readonly Level[] = [passage, relay, rescue, pair, ember, chain, pulse, quake, needle, ice, veil, drift, shade, wander, weave, frost, lead, flash, ash, torch, hoop, cable, fold, observatory];

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
  return config;
}

export { observatory } from "./observatory";
export type { Level, LevelPhysics, MissionProfile } from "./schema";
export { LevelError, loadLevelData, loadLevelJson } from "./schema";
