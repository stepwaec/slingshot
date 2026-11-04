import type { Level } from "../level/schema";
import type { Mission, Region, World } from "./types";

/** A world, region, or mission referred to a body or id that is not there. */
export class WorldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldError";
  }
}

/**
 * Build the level a mission plays. Bodies are the world's own objects,
 * not copies. Orbit centres are included even when the region did not name them.
 * The camera frame is the mission bounds, or the region bounds.
 */
export function compileMission(worlds: readonly World[], regions: readonly Region[], mission: Mission): Level {
  const world = findWorld(worlds, mission.worldId);
  const region = findRegion(regions, world.id, mission.regionId);
  const bodies = regionBodies(world, region);
  const ids = new Set(bodies.map((body) => body.id));
  const belts = regionBelts(world, region, ids);
  const bounds = mission.bounds ?? region.bounds;
  requireBody(bodies, mission.targetId, `target ${mission.targetId}`);
  requireBody(bodies, mission.orbit.bodyId, `starting orbit ${mission.orbit.bodyId}`);
  for (let i = 0; i < mission.objectives.length; i++) {
    const objective = mission.objectives[i];
    requireBody(bodies, objective.bodyId, `objective ${objective.id}`);
  }

  const level: Level = {
    id: mission.id,
    name: mission.name,
    g: world.g,
    dt: world.dt,
    c: world.c,
    bodies,
    targetId: mission.targetId,
    ship: mission.ship,
    orbit: mission.orbit,
    fuel: mission.fuel,
    fuelPerDv: mission.fuelPerDv,
    bounds,
    frame: bounds,
    maxSteps: mission.maxSteps,
    dvPerPixel: mission.dvPerPixel,
    periapsisMargin: mission.periapsisMargin,
    mission: mission.scoring,
  };
  if (world.physics) level.physics = world.physics;
  if (belts.length > 0) level.belts = belts;
  if (mission.objectives.length > 0) level.objectives = mission.objectives;
  if (mission.horizon) level.horizon = mission.horizon;
  if (mission.pause) level.pause = mission.pause;
  if (mission.maxSpeed !== undefined) level.maxSpeed = mission.maxSpeed;
  if (mission.maxPlannedBurns !== undefined) level.maxPlannedBurns = mission.maxPlannedBurns;
  return level;
}

function findWorld(worlds: readonly World[], id: string): World {
  for (let i = 0; i < worlds.length; i++) {
    if (worlds[i].id === id) return worlds[i];
  }
  throw new WorldError(`unknown world ${id}`);
}

function findRegion(regions: readonly Region[], worldId: string, id: string): Region {
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (region.id === id && region.worldId === worldId) return region;
  }
  throw new WorldError(`unknown region ${id} in ${worldId}`);
}

/** Region bodies plus every orbit centre, in the world's order. */
function regionBodies(world: World, region: Region): World["bodies"] {
  const byId = new Map(world.bodies.map((body) => [body.id, body]));
  const wanted = new Set<string>();
  const pending = region.bodyIds.slice();
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    if (wanted.has(id)) continue;
    const body = byId.get(id);
    if (!body) throw new WorldError(`region ${region.id} names unknown body ${id}`);
    wanted.add(id);
    const centerId = body.orbit?.centerId;
    if (centerId) pending.push(centerId);
  }
  return world.bodies.filter((body) => wanted.has(body.id));
}

function regionBelts(world: World, region: Region, ids: ReadonlySet<string>): NonNullable<World["belts"]> {
  const belts = world.belts ?? [];
  const chosen = region.beltIds
    ? belts.filter((belt) => region.beltIds?.includes(belt.id))
    : belts.filter((belt) => ids.has(belt.centerId));
  for (let i = 0; i < chosen.length; i++) {
    const belt = chosen[i];
    if (!ids.has(belt.centerId)) {
      throw new WorldError(`belt ${belt.id} is centred on ${belt.centerId}, which is not in region ${region.id}`);
    }
  }
  return chosen;
}

function requireBody(bodies: readonly { id: string }[], id: string, label: string): void {
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === id) return;
  }
  throw new WorldError(`${label} is not in the region`);
}
