/**
 * Ship upgrades that change mass, hull, fuel or thrust.
 * The shipyard draws them; shield, scoop, sensors, cryosleep and the
 * engine picture are cosmetic and do not pass through here.
 */

export const UPGRADE_POINTS = 4;

export const UPGRADES = [
  {
    id: "hull",
    name: "Hull",
    detail: "Hull 160. The ship is heavier, so burns push less.",
    cost: 2,
    mass: 0.25,
  },
  {
    id: "tanks",
    name: "Tanks",
    detail: "Fuel tank 140%. Extra mass.",
    cost: 2,
    mass: 0.25,
  },
  {
    id: "solar",
    name: "Solar",
    detail: "Refills fuel near stars. Extra mass.",
    cost: 2,
    mass: 0.2,
  },
  {
    id: "engines",
    name: "Engines",
    detail: "Burns push 15% harder, and the ship is heavier.",
    cost: 2,
    mass: 0.35,
  },
] as const;

export type UpgradeId = (typeof UPGRADES)[number]["id"];

export interface ShipLoadout {
  mass: number;
  engine: number;
  hullMax: number;
  fuelFactor: number;
  /** Fuel per second at a star's surface. 0 means no recharge. */
  solar: number;
}

export function isUpgradeId(value: string): value is UpgradeId {
  return UPGRADES.some((item) => item.id === value);
}

export function shipLoadout(ids: readonly string[]): ShipLoadout {
  const owned = new Set(ids);
  let mass = 1;
  for (const item of UPGRADES) {
    if (owned.has(item.id)) mass += item.mass;
  }
  return {
    mass,
    engine: owned.has("engines") ? 1.15 : 1,
    hullMax: owned.has("hull") ? 160 : 100,
    fuelFactor: owned.has("tanks") ? 1.4 : 1,
    solar: owned.has("solar") ? 12 : 0,
  };
}
