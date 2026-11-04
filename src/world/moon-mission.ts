import { bodyPose } from "../sim/physics";
import { compileMission } from "./compile";
import { shipOnCircle } from "./orbit";
import { solWorld } from "./sol";
import type { Mission, Region } from "./types";

/**
 * Mission 1. Start in low Earth orbit, capture the Moon, return to a
 * stable Earth orbit. The Moon's phase leads a Hohmann coast from the
 * far side of Earth. The Sun is in the sim, so the published plan is a
 * searched neighbour of that coast, not the two-body ellipse.
 */

const LEO = 52;

export const earthMoonRegion: Region = {
  id: "earth-moon",
  worldId: "sol",
  name: "Earth and Moon",
  bounds: { minX: -1600, maxX: 1600, minY: -1600, maxY: 1600 },
  bodyIds: ["earth", "luna"],
  beltIds: [],
};

const ship = shipOnCircle(solWorld.bodies, "earth", LEO, Math.PI, solWorld.g);
const earth = solWorld.bodies.find((body) => body.id === "earth");
if (!earth) throw new Error("Sol is missing Earth");
const at = bodyPose(earth, 0, solWorld.bodies, solWorld.g);
const pad = 480;

const mission: Mission = {
  id: "sol-moon",
  name: "Moon and back",
  worldId: "sol",
  regionId: "earth-moon",
  frame: { minX: at.x - pad, maxX: at.x + pad, minY: at.y - pad, maxY: at.y + pad },
  ship,
  orbit: { bodyId: "earth", radius: LEO },
  fuel: 120,
  fuelPerDv: 1,
  maxSteps: 12_000,
  dvPerPixel: 0.1,
  periapsisMargin: 4,
  scoring: { deadline: 180, crewLimit: 180, fuelStarMin: 30, crewWeight: 2, fuelWeight: 1 },
  objectives: [
    { id: "luna", bodyId: "luna", kind: "capture", label: "One lap around the Moon", laps: 1 },
    { id: "earth", bodyId: "earth", kind: "capture", label: "Return to Earth orbit" },
  ],
  targetId: "earth",
  horizon: { seconds: 140, oneOrbit: false, shorten: 0, ref: 8 },
  maxPlannedBurns: 6,
};

export const moonMission = compileMission([solWorld], [earthMoonRegion], mission);
