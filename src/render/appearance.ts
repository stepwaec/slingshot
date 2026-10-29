import type { EngineLook } from "./ship-art";

/**
 * Cosmetic ship choices. The simulation never reads this module.
 * Hull plating, tanks, solar and the engine upgrade still live on `game.upgrades`.
 * Shield, scoop, sensors, cryosleep and the engine picture only change the sprite.
 */
export type LookModule = "shield" | "scoop" | "sensors" | "cryo";

export interface ShipLook {
  engine: EngineLook;
  shield: boolean;
  scoop: boolean;
  sensors: boolean;
  cryo: boolean;
}

export const shipLook: ShipLook = {
  engine: "chemical",
  shield: false,
  scoop: false,
  sensors: false,
  cryo: false,
};

export function setEngineLook(engine: EngineLook): void {
  shipLook.engine = engine;
}

export function toggleLook(module: LookModule): void {
  shipLook[module] = !shipLook[module];
}

export function resetShipLook(): void {
  shipLook.engine = "chemical";
  shipLook.shield = false;
  shipLook.scoop = false;
  shipLook.sensors = false;
  shipLook.cryo = false;
}
