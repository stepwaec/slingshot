import type { Belt } from "../sim/belts";
import { keplerMeanMotion, type Body, type BodyLook, type BodyOrbit } from "../sim/physics";
import { solArt, type SolLook } from "../render/sol-art";
import { compileMission } from "./compile";
import { shipOnCircle } from "./orbit";
import type { Mission, Region, World } from "./types";

/**
 * Sol, the first region of the open world.
 *
 * Distances are compressed, then opened by `DISTANCE_SCALE`. A coast to the
 * Moon or another planet should take long enough to feel like a trip.
 * Orbits up to Mars keep their real AU ratios against `SOL_AU`. Past Mars
 * the radius grows with the square root of the remaining AU, so Jupiter
 * through Neptune stay on one chart and the order does not change. Periods
 * follow Kepler from the parent's mass.
 * JWST is not here. It waits at the Sun–Earth L2 point.
 *
 * The Sun is heavy enough that planets stay on their rails, and light enough
 * that a ship in low Earth orbit is not stripped off by the solar tide.
 * Planet masses keep the real order of "who is heavy" without Jupiter
 * outweighing the Sun. Moon masses do not set their periods.
 */

/**
 * Half again the first chart. Kepler time grows faster than distance, so the
 * Moon and the inner planets take longer to reach without changing masses.
 */
export const DISTANCE_SCALE = 3 / 2;

/**
 * Mass of the Moon relative to Earth/81. The real ratio cannot hold a low
 * orbit against Earth's tide at this chart distance: a circular ship falls
 * out of the capture ring or into the surface inside a revolution.
 * 10 is the smallest factor in the survey where every tested phase at
 * radius 32 stays inside the ring for more than two revolutions.
 * The Moon's rail does not use this mass. Its period still follows Earth.
 */
export const MOON_MASS_FACTOR = 10;

/**
 * Extra stretch of the Earth–Moon distance on top of `DISTANCE_SCALE`.
 * 1 leaves the Moon where that scale put it. A further stretch was tried
 * and made the low orbit worse, so it stays at 1.
 */
export const MOON_DISTANCE_FACTOR = 1;

/** Earth–Sun distance in world units. */
export const SOL_AU = 820 * DISTANCE_SCALE;

/** Real AU at which compression starts. Mars sits on this hinge. */
const LINEAR_AU = 1.524;

const G = 1;

const SUN_MASS = 480_000;
const EARTH_MASS = 24_000;

/** design/mockups/sol-moon.svg: the Moon's target zone is r 72. */
const LUNA_CAPTURE = 72;
/** Low Earth orbit at 52 sits inside this, and the Moon sits outside it. */
const EARTH_CAPTURE = 96;

/**
 * Semi-major axis in world units for a real semi-major axis in AU.
 * Linear through Mars, then a square root.
 */
export function solRadius(au: number): number {
  if (au <= LINEAR_AU) return SOL_AU * au;
  return SOL_AU * (LINEAR_AU + Math.sqrt(au - LINEAR_AU) * 1.35);
}

function circle(centerId: string, radius: number, phase: number, centerMass: number): BodyOrbit {
  return { centerId, radius, phase, omega: keplerMeanMotion(G, centerMass, radius) };
}

function solBody(
  id: string,
  name: string,
  look: SolLook,
  kind: Body["kind"],
  mass: number,
  orbit?: BodyOrbit,
  captureRadius?: number,
): Body {
  const body: Body = {
    id,
    name,
    kind,
    look,
    x: 0,
    y: 0,
    mass,
    radius: solArt(look).radius,
  };
  if (orbit) body.orbit = orbit;
  if (captureRadius !== undefined) body.captureRadius = captureRadius;
  return body;
}

/**
 * A moon with no Sol face yet. Radii are the library headers in
 * design/style.md §8: `moon` 14, `moon-icy` 12, `moon-volcanic` 13.
 */
function libraryMoon(
  id: string,
  name: string,
  look: BodyLook,
  radius: number,
  mass: number,
  parentId: string,
  distance: number,
  phase: number,
  parentMass: number,
): Body {
  return {
    id,
    name,
    kind: "moon",
    look,
    x: 0,
    y: 0,
    mass,
    radius,
    orbit: circle(parentId, distance, phase, parentMass),
  };
}

const sun = solBody("sun", "Sun", "sol-sun", "star", SUN_MASS);

const mercury = solBody("mercury", "Mercury", "mercury", "planet", 1_200, circle("sun", solRadius(0.387), 0.6, SUN_MASS));
const venus = solBody("venus", "Venus", "venus", "planet", 20_000, circle("sun", solRadius(0.723), 2.2, SUN_MASS));
/**
 * Earth sits down-left of the Sun, so from Earth the Sun is up and to the
 * right, matching the light in design/mockups/sol-moon.svg.
 */
const EARTH_PHASE = (5 * Math.PI) / 4;

const earth = solBody(
  "earth",
  "Earth",
  "earth",
  "planet",
  EARTH_MASS,
  circle("sun", solRadius(1), EARTH_PHASE, SUN_MASS),
  EARTH_CAPTURE,
);
const mars = solBody("mars", "Mars", "mars", "planet", 2_500, circle("sun", solRadius(LINEAR_AU), 3.7, SUN_MASS));
const jupiter = solBody("jupiter", "Jupiter", "jupiter", "planet", 80_000, circle("sun", solRadius(5.203), 1.15, SUN_MASS));
const saturn = solBody("saturn", "Saturn", "saturn", "planet", 24_000, circle("sun", solRadius(9.537), 4.3, SUN_MASS));
const uranus = solBody("uranus", "Uranus", "uranus", "planet", 8_000, circle("sun", solRadius(19.191), 2.55, SUN_MASS));
const neptune = solBody("neptune", "Neptune", "neptune", "planet", 9_000, circle("sun", solRadius(30.07), 5.5, SUN_MASS));
const pluto = solBody("pluto", "Pluto", "pluto", "planet", 400, circle("sun", solRadius(39.48), 2.4, SUN_MASS));
const eris = solBody("eris", "Eris", "eris", "planet", 500, circle("sun", solRadius(67.8), 0.35, SUN_MASS));

const LUNA_DISTANCE = 168 * DISTANCE_SCALE * MOON_DISTANCE_FACTOR;
/**
 * Lead the Moon so a prograde burn from the far side of Earth (angle π)
 * meets it near angle 0 after one Hohmann half-period. The Sun still
 * perturbs that coast. Mission 1 searches around this phase.
 */
const LUNA_TRANSFER = Math.PI * Math.sqrt(((52 + LUNA_DISTANCE) / 2) ** 3 / EARTH_MASS);
const LUNA_PHASE = -keplerMeanMotion(G, EARTH_MASS, LUNA_DISTANCE) * LUNA_TRANSFER - 0.15;

const luna = solBody(
  "luna",
  "Moon",
  "luna",
  "moon",
  (EARTH_MASS / 81) * MOON_MASS_FACTOR,
  circle("earth", LUNA_DISTANCE, LUNA_PHASE, EARTH_MASS),
  LUNA_CAPTURE,
);

const io = libraryMoon("io", "Io", "moon-volcanic", 13, 40, "jupiter", 168 * DISTANCE_SCALE, 0.2, 80_000);
const europa = libraryMoon("europa", "Europa", "moon-icy", 12, 30, "jupiter", 230 * DISTANCE_SCALE, 1.4, 80_000);
const ganymede = libraryMoon("ganymede", "Ganymede", "moon", 14, 80, "jupiter", 310 * DISTANCE_SCALE, 2.6, 80_000);
const callisto = libraryMoon("callisto", "Callisto", "moon", 14, 50, "jupiter", 410 * DISTANCE_SCALE, 4.1, 80_000);

const enceladus = libraryMoon("enceladus", "Enceladus", "moon-icy", 12, 8, "saturn", 280 * DISTANCE_SCALE, 0.5, 24_000);
const rhea = libraryMoon("rhea", "Rhea", "moon", 14, 12, "saturn", 360 * DISTANCE_SCALE, 2.1, 24_000);
const titan = solBody("titan", "Titan", "titan", "moon", 200, circle("saturn", 480 * DISTANCE_SCALE, 3.4, 24_000));

const titania = libraryMoon("titania", "Titania", "moon", 14, 16, "uranus", 200 * DISTANCE_SCALE, 1.1, 8_000);
const triton = libraryMoon("triton", "Triton", "moon-icy", 12, 20, "neptune", 190 * DISTANCE_SCALE, 4.6, 9_000);
const charon = solBody("charon", "Charon", "charon", "moon", 60, circle("pluto", 46 * DISTANCE_SCALE, 0.8, 400));

const bodies: readonly Body[] = [
  sun,
  mercury,
  venus,
  earth,
  luna,
  mars,
  jupiter,
  io,
  europa,
  ganymede,
  callisto,
  saturn,
  enceladus,
  rhea,
  titan,
  uranus,
  titania,
  neptune,
  triton,
  pluto,
  charon,
  eris,
];

const marsOrbit = mars.orbit?.radius ?? 0;
const jupiterOrbit = jupiter.orbit?.radius ?? 0;
const neptuneOrbit = neptune.orbit?.radius ?? 0;

/** Sparse annulus between Mars and Jupiter. Seeded, so the rocks do not move between loads. */
const asteroids: Belt = {
  id: "asteroids",
  centerId: "sun",
  radius: (marsOrbit + jupiterOrbit) / 2,
  width: 420 * DISTANCE_SCALE,
  tier: "sparse",
  seed: 1103,
};

/**
 * Kuiper material past Neptune. A full annulus at this radius is tens of
 * thousands of rocks, so this pass draws a wide arc. The seed fixes the rocks.
 */
const kuiper: Belt = {
  id: "kuiper",
  centerId: "sun",
  radius: neptuneOrbit + 1100 * DISTANCE_SCALE,
  width: 640 * DISTANCE_SCALE,
  tier: "kuiper",
  seed: 1104,
  arcStart: 0.5,
  arcSpan: 0.42,
};

const systemBounds = { minX: -18_000, maxX: 18_000, minY: -18_000, maxY: 18_000 };

export const solWorld: World = {
  id: "sol",
  name: "Sol",
  g: G,
  dt: 1 / 60,
  c: 1_000_000,
  bodies,
  belts: [asteroids, kuiper],
  bounds: systemBounds,
};

/** Sun through Mars, plus the asteroid belt. The opening camera uses this box. */
export const solInner: Region = {
  id: "inner",
  worldId: "sol",
  name: "Inner Sol",
  bounds: { minX: -2400, maxX: 2400, minY: -2400, maxY: 2400 },
  bodyIds: ["mercury", "venus", "earth", "luna", "mars"],
  beltIds: ["asteroids"],
};

/** The whole system. Orbit centres are pulled in with the moons. */
export const solSystem: Region = {
  id: "system",
  worldId: "sol",
  name: "Sol",
  bounds: systemBounds,
  bodyIds: bodies.filter((body) => body.id !== "sun").map((body) => body.id),
  beltIds: ["asteroids", "kuiper"],
};

export const solRegions: readonly Region[] = [solInner, solSystem];

const chartShip = shipOnCircle(bodies, "earth", 52, Math.PI, G);

const chartMission: Mission = {
  id: "sol",
  name: "Sol",
  worldId: "sol",
  regionId: "system",
  frame: { minX: -2400, maxX: 2400, minY: -2400, maxY: 2400 },
  ship: chartShip,
  orbit: { bodyId: "earth", radius: 52 },
  fuel: 160,
  fuelPerDv: 1,
  maxSteps: 24_000,
  dvPerPixel: 0.45,
  periapsisMargin: 4,
  scoring: { deadline: 600, crewLimit: 600, fuelStarMin: 40, crewWeight: 1, fuelWeight: 1 },
  objectives: [],
  targetId: "luna",
  horizon: { seconds: 40, oneOrbit: false, shorten: 0, ref: 8 },
  maxPlannedBurns: 4,
};

/** Flyable chart of the Sol world. Not a campaign mission. */
export const solChart = compileMission([solWorld], solRegions, chartMission);
