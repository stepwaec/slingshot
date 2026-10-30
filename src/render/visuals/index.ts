import type { VisualFactory } from "../visual";
import { createAstroMap } from "./astro-map";
import { createAstrophage } from "./astrophage";
import { createBelts } from "./belts";
import { createFates } from "./fates";
import { createGallery } from "./gallery";
import { createImpostors } from "./impostors";
import { createMega } from "./mega";
import { createHazards } from "./hazards";
import { createGhosts } from "./ghosts";
import { createClouds } from "./clouds";
import { createComet } from "./comet";
import { createGravity } from "./gravity";
import { createMagnetism } from "./magnetism";
import { createNodes } from "./nodes";
import { createPath } from "./path";
import { createPlacards } from "./placards";
import { createPlanets } from "./planets";
import { createRadiation } from "./radiation";
import { createRecharge } from "./recharge";
import { createRogue } from "./rogue";
import { createStray } from "./stray";
import { createTidal } from "./tidal";
import { createRelativity } from "./relativity";
import { createShip } from "./ship";
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
  radiation: createRadiation,
  astroMap: createAstroMap,
  tidal: createTidal,
  scenery: createScenery,
  belts: createBelts,
  impostors: createImpostors,
  gallery: createGallery,
  astrophage: createAstrophage,
  mega: createMega,
  fates: createFates,
  planets: createPlanets,
  rogue: createRogue,
  stray: createStray,
  comet: createComet,
  clouds: createClouds,
  ghosts: createGhosts,
  hazards: createHazards,
  placards: createPlacards,
  path: createPath,
  recharge: createRecharge,
  ship: createShip,
  nodes: createNodes,
} as const satisfies Record<string, VisualFactory>;

export type VisualName = keyof typeof visualFactories;
