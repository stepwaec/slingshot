import type { Belt } from "../sim/belts";
import type { Body, Bounds, Horizon, PauseRule, SimSpeed } from "../sim/physics";
import type { LevelPhysics, MissionProfile, Objective } from "../level/schema";

/**
 * The persistent system. Missions do not copy its bodies or its physics.
 * A region names which of these bodies a mission integrates.
 */
export interface World {
  id: string;
  name: string;
  g: number;
  dt: number;
  c: number;
  physics?: LevelPhysics;
  bodies: readonly Body[];
  belts?: readonly Belt[];
  /** Whole system. A mission uses a tighter region. */
  bounds: Bounds;
}

/**
 * A named slice of a world. `bodyIds` are the bodies that define it.
 * Orbit centres are added at compile time when a named body needs them.
 */
export interface Region {
  id: string;
  worldId: string;
  name: string;
  /** Camera frame, and the lost-in-space box when a mission does not override it. */
  bounds: Bounds;
  bodyIds: readonly string[];
  /**
   * Belts to include. Omitted means every belt whose centre is in the region.
   * An empty list includes none.
   */
  beltIds?: readonly string[];
}

/**
 * A mission is a start state in a region: bounds, objectives, and scoring.
 * Compiling it produces the `Level` the sim already runs.
 */
export interface Mission {
  id: string;
  name: string;
  worldId: string;
  regionId: string;
  /** Replaces the region bounds for the camera and for leaving the region. */
  bounds?: Bounds;
  ship: { x: number; y: number; vx: number; vy: number };
  orbit: { bodyId: string; radius: number };
  fuel: number;
  fuelPerDv: number;
  maxSteps: number;
  dvPerPixel: number;
  periapsisMargin: number;
  scoring: MissionProfile;
  objectives: readonly Objective[];
  /**
   * Single-target body when `objectives` is empty.
   * When there are legs, this is the last leg's body, so a win draws that orbit.
   */
  targetId: string;
  horizon?: Horizon;
  pause?: PauseRule;
  maxSpeed?: SimSpeed;
  maxPlannedBurns?: number;
}
