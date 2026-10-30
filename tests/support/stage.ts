import type { Level } from "../../src/level/schema";

/**
 * A three-body scene for tests. It uses library roles (home, star, target)
 * and is not a shipped level. The numbers match the old Passage layout so
 * the reference burns in `plans.ts` still fly.
 */
export const stage: Level = {
  id: "library-stage",
  name: "Library stage",
  g: 1,
  dt: 1 / 60,
  bodies: [
    { id: "home", name: "Home", kind: "home", x: 0, y: 0, mass: 90000, radius: 32 },
    { id: "star", name: "the star", kind: "star", look: "sun", x: 60, y: 560, mass: 700000, radius: 46 },
    {
      id: "x",
      name: "Planet X",
      kind: "target",
      x: 690,
      y: 30,
      mass: 900,
      radius: 26,
      captureRadius: 72,
    },
  ],
  targetId: "x",
  ship: { x: 68, y: 0, vx: 0, vy: 36.38034375544994 },
  orbit: { bodyId: "home", radius: 68 },
  fuel: 60,
  fuelPerDv: 1,
  bounds: { minX: -4000, maxX: 4000, minY: -4000, maxY: 4000 },
  maxSteps: 4500,
  dvPerPixel: 0.2,
  periapsisMargin: 8,
  maxPlannedBurns: 8,
  c: 1000000,
  mission: {
    deadline: 240,
    crewLimit: 180,
    fuelStarMin: 12,
    crewWeight: 5,
    fuelWeight: 1,
  },
};
