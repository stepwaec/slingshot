import type { VisualFactory } from "../visual";
import { createCompact } from "./compact";
import { createGravity } from "./gravity";
import { createMagnetism } from "./magnetism";
import { createNodes } from "./nodes";
import { createPath } from "./path";
import { createPlanets } from "./planets";
import { createRelativity } from "./relativity";
import { createShip } from "./ship";
import { createStar } from "./star";
import { createScenery } from "./scenery";
import { createStarfield } from "./starfield";

/**
 * One factory per element. Replace a single value to swap that visual
 * (a glTF ship, a textured planet, a bloom star) without touching the
 * others or the simulation. Each factory returns a `Visual`.
 *
 * Order is draw order within a space: background, then world, then screen.
 */
export const visualFactories = {
  starfield: createStarfield,
  relativity: createRelativity,
  gravity: createGravity,
  magnetism: createMagnetism,
  star: createStar,
  scenery: createScenery,
  planets: createPlanets,
  compact: createCompact,
  path: createPath,
  ship: createShip,
  nodes: createNodes,
} as const satisfies Record<string, VisualFactory>;

export type VisualName = keyof typeof visualFactories;
