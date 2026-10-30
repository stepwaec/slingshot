import { SOL_LOOKS, solArt, type SolLook } from "../render/sol-art";
import { keplerMeanMotion, type BodyKind } from "../sim/physics";
import { loadLevelData, type Level } from "./schema";

/**
 * The Observatory is the object library on one chart. Every Sol look is placed
 * from `SOL_LOOKS`, so a new library body shows up here without a hand-written
 * scene. Distances are compressed (real order, not AU) so moons clear their
 * planets and Titan sits outside Saturn's rings. Periods are Kepler:
 * ω = √(GM/r³). Mission 1 is not this level.
 */

const G = 1;
const SUN_MASS = 60_000;

interface Placement {
  look: SolLook;
  id: string;
  name: string;
  kind: BodyKind;
  mass: number;
  /** Orbit radius, or Voyager's distance from the sun at t = 0. */
  distance: number;
  phase: number;
  /** Parent look. Omitted planets orbit the sun. Voyager drifts instead. */
  around?: SolLook;
  drift: boolean;
}

const PLACED: readonly Placement[] = [
  { look: "sol-sun", id: "sun", name: "the Sun", kind: "star", mass: SUN_MASS, distance: 0, phase: 0, drift: false },
  { look: "mercury", id: "mercury", name: "Mercury", kind: "planet", mass: 60, distance: 150, phase: 0.2, drift: false },
  { look: "venus", id: "venus", name: "Venus", kind: "planet", mass: 400, distance: 250, phase: 1.1, drift: false },
  { look: "earth", id: "earth", name: "Earth", kind: "planet", mass: 1500, distance: 420, phase: 2.4, drift: false },
  { look: "luna", id: "luna", name: "the Moon", kind: "moon", mass: 40, distance: 82, phase: 0.9, around: "earth", drift: false },
  { look: "mars", id: "mars", name: "Mars", kind: "planet", mass: 120, distance: 600, phase: 3.5, drift: false },
  { look: "jupiter", id: "jupiter", name: "Jupiter", kind: "planet", mass: 12_000, distance: 900, phase: 0.7, drift: false },
  { look: "saturn", id: "saturn", name: "Saturn", kind: "planet", mass: 7000, distance: 1450, phase: 4.0, drift: false },
  { look: "titan", id: "titan", name: "Titan", kind: "moon", mass: 90, distance: 360, phase: 2.2, around: "saturn", drift: false },
  { look: "uranus", id: "uranus", name: "Uranus", kind: "planet", mass: 1800, distance: 1980, phase: 1.6, drift: false },
  { look: "neptune", id: "neptune", name: "Neptune", kind: "planet", mass: 2000, distance: 2300, phase: 5.2, drift: false },
  { look: "pluto", id: "pluto", name: "Pluto", kind: "planet", mass: 180, distance: 2550, phase: 2.8, drift: false },
  { look: "charon", id: "charon", name: "Charon", kind: "moon", mass: 40, distance: 46, phase: 4.5, around: "pluto", drift: false },
  { look: "arrokoth", id: "arrokoth", name: "Arrokoth", kind: "planet", mass: 15, distance: 2750, phase: 0.5, drift: false },
  { look: "eris", id: "eris", name: "Eris", kind: "planet", mass: 160, distance: 2980, phase: 3.9, drift: false },
  { look: "voyager", id: "voyager", name: "Voyager", kind: "planet", mass: 0, distance: 2450, phase: 0.15, drift: true },
];

function placedByLook(look: SolLook): Placement {
  const found = PLACED.find((item) => item.look === look);
  if (!found) throw new Error(`Observatory is missing ${look}`);
  return found;
}

/** Level JSON for the Observatory, one body per Sol look. */
export function observatoryData(): Record<string, unknown> {
  const missing = SOL_LOOKS.filter((look) => !PLACED.some((item) => item.look === look));
  if (missing.length > 0) throw new Error(`Observatory library gap: ${missing.join(", ")}`);

  const at = new Map<string, { x: number; y: number; mass: number }>();
  const bodies: Record<string, unknown>[] = [];
  for (const item of PLACED) {
    const art = solArt(item.look);
    const parentId = item.around ? placedByLook(item.around).id : "sun";
    const parent = item.look === "sol-sun" ? { x: 0, y: 0, mass: SUN_MASS } : at.get(parentId);
    if (!parent) throw new Error(`Observatory parent ${parentId} is not placed yet`);
    const x = parent.x + item.distance * Math.cos(item.phase);
    const y = parent.y + item.distance * Math.sin(item.phase);
    at.set(item.id, { x, y, mass: item.mass });
    const body: Record<string, unknown> = {
      id: item.id,
      name: item.name,
      kind: item.kind,
      look: item.look,
      x,
      y,
      mass: item.mass,
      radius: art.radius,
    };
    if (item.look === "eris") body.captureRadius = 40;
    if (item.drift) {
      body.solid = false;
      const speed = 4;
      body.drift = { vx: -Math.sin(item.phase) * speed, vy: Math.cos(item.phase) * speed };
    } else if (item.look !== "sol-sun") {
      body.orbit = {
        centerId: parentId,
        radius: item.distance,
        phase: item.phase,
        omega: keplerMeanMotion(G, parent.mass, item.distance),
      };
    }
    bodies.push(body);
  }

  const shipR = 90;
  const shipSpeed = Math.sqrt((G * SUN_MASS) / shipR);
  return {
    id: "observatory",
    name: "Observatory",
    g: G,
    dt: 1 / 60,
    bodies,
    targetId: "eris",
    ship: { x: shipR, y: 0, vx: 0, vy: shipSpeed },
    orbit: { bodyId: "sun", radius: shipR },
    fuel: 200,
    fuelPerDv: 1,
    bounds: { minX: -8000, maxX: 8000, minY: -8000, maxY: 8000 },
    maxSteps: 12000,
    dvPerPixel: 0.25,
    periapsisMargin: 6,
    maxPlannedBurns: 4,
    c: 1_000_000,
    mission: { deadline: 800, crewLimit: 800, fuelStarMin: 0, crewWeight: 1, fuelWeight: 1 },
  };
}

export const observatory: Level = loadLevelData(observatoryData(), "src/level/observatory.ts");
