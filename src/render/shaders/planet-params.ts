import type { Body } from "../../sim/physics";
import { palette } from "../palette";

/**
 * Per-body numbers from design/shader-specs.md §3, the same table the
 * preview runs. Shared lighting colours are palette tokens. Highlight,
 * haze and rim hexes are that body's row. `designR` is the SVG crash
 * radius; the game draws at the body's own radius.
 */
export const PLANET_KEYS = [

  "earth",
  "ocean",
  "mars",
  "moon",
  "planetx",
  "rocky",
  "ice",
  "lava",
  "toxic",
  "cracked",
  "dwarf",
  "barren",
  "icy",
  "volcanic",
  "mercury",
  "venus",
  "titan",
  "pluto",
  "charon",
  "eris",
] as const;

export type PlanetKey = (typeof PLANET_KEYS)[number];


export interface PlanetMaps {
  albedo?: string;
  clouds?: string;
  lights?: string;
  face?: string;
}

export interface PlanetParams {
  /** Art light, y up. The game replaces the in-plane part with the star. */
  light: readonly [number, number, number];
  locked: number;
  hasClouds: number;
  hasLights: number;
  glowDay: number;
  start: number;
  /** Seconds per turn. Negative is retrograde (Venus). */
  spin: number;
  cloudSpin: number;
  cloudA: number;
  shadowA: number;
  shadowOff: number;
  glint: number;
  lightsA: number;
  hi: string;
  hiA: number;
  warm: string;
  warmA: number;
  night0: string;
  night1: string;
  airless: number;
  haze0: string;
  haze1: string;
  hazeA0: number;
  hazeA1: number;
  rim0: string;
  rim1: string;
  designR: number;
  maps: PlanetMaps;
}

function row(
  light: readonly [number, number, number],
  p: Omit<PlanetParams, "light" | "warm" | "night0" | "night1"> & { warm?: string; night0?: string; night1?: string },
): PlanetParams {
  return {
    ...p,
    light,
    warm: palette.planetWarm,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
  };
}

export const PLANETS: Record<PlanetKey, PlanetParams> = {

  earth: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 1,
    hasLights: 1,
    glowDay: 0,
    start: 0.542,
    spin: 90,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0.6,
    lightsA: 1,
    hi: "#E6F2FF",
    hiA: 0.34,
    warmA: 0.24,
    airless: 0,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 34,
    maps: { albedo: "earth-albedo", clouds: "earth-clouds", lights: "earth-lights" },
  }),
  ocean: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 1,
    hasLights: 0,
    glowDay: 0,
    start: 0.364,
    spin: 90,
    cloudSpin: 64,
    cloudA: 0.78,
    shadowA: 0.45,
    shadowOff: 0.026,
    glint: 0.6,
    lightsA: 0,
    hi: "#E6F2FF",
    hiA: 0.38,
    warmA: 0.24,
    airless: 0,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.42,
    hazeA1: 0.65,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 34,
    maps: { albedo: "ocean-albedo", clouds: "ocean-clouds" },
  }),
  mars: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.611,
    spin: 92,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFE9D6",
    hiA: 0.24,
    warmA: 0.24,
    airless: 0,
    haze0: "#F5B996",
    haze1: "#FFD9C2",
    hazeA0: 0.28,
    hazeA1: 0.45,
    rim0: "#FFD2B8",
    rim1: "#F29C7A",
    designR: 24.8,
    maps: { albedo: "mars-albedo" },
  }),
  moon: row([0.587, 0.587, 0.556], {
    locked: 1,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: 90,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#F4F2FC",
    hiA: 0.22,
    warmA: 0.18,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 18,
    maps: { face: "moon-face" },
  }),
  planetx: row([-0.587, -0.587, 0.556], {
    locked: 0,
    hasClouds: 1,
    hasLights: 0,
    glowDay: 0,
    start: 0.3723,
    spin: 120,
    cloudSpin: 80,
    cloudA: 0.7,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#B5FFF0",
    hiA: 0.28,
    warmA: 0.24,
    airless: 0,
    haze0: "#8FFFE6",
    haze1: "#E6FFF9",
    hazeA0: 0.42,
    hazeA1: 0.65,
    rim0: "#B5FFF0",
    rim1: "#8FFFE6",
    designR: 30,
    maps: { albedo: "planet-x-albedo", clouds: "planet-x-clouds" },
  }),
  rocky: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.3723,
    spin: 110,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFF0DC",
    hiA: 0.2,
    warmA: 0.24,
    airless: 0,
    haze0: "#E8B07A",
    haze1: "#FFD9B0",
    hazeA0: 0.3,
    hazeA1: 0.48,
    rim0: "#FFD9B0",
    rim1: "#E8B07A",
    designR: 30,
    maps: { albedo: "rocky-albedo" },
  }),
  ice: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.2955,
    spin: 140,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFFFFF",
    hiA: 0.22,
    warmA: 0.24,
    airless: 0,
    haze0: "#8FD0FF",
    haze1: "#E6F6FF",
    hazeA0: 0.4,
    hazeA1: 0.62,
    rim0: "#BFE3FF",
    rim1: "#8FD0FF",
    designR: 28,
    maps: { albedo: "ice-albedo" },
  }),
  lava: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 1,
    glowDay: 1,
    start: 0.2822,
    spin: 95,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 1,
    hi: "#FFD9B0",
    hiA: 0.26,
    warmA: 0.24,
    airless: 0,
    haze0: "#FF8C2E",
    haze1: "#FFB347",
    hazeA0: 0.26,
    hazeA1: 0.42,
    rim0: "#FFB347",
    rim1: "#FF8C2E",
    designR: 26,
    maps: { albedo: "lava-albedo", lights: "lava-glow" },
  }),
  toxic: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 1,
    hasLights: 0,
    glowDay: 0,
    start: 0.4577,
    spin: 120,
    cloudSpin: 75,
    cloudA: 0.92,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#F4FFD6",
    hiA: 0.22,
    warmA: 0.24,
    airless: 0,
    haze0: "#C7E97A",
    haze1: "#E4F7B0",
    hazeA0: 0.4,
    hazeA1: 0.62,
    rim0: "#DDF59A",
    rim1: "#A8D850",
    designR: 32,
    maps: { albedo: "toxic-albedo", clouds: "toxic-clouds" },
  }),
  cracked: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 1,
    glowDay: 0,
    start: 0.3353,
    spin: 100,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 1,
    hi: "#D2DEF6",
    hiA: 0.3,
    warmA: 0.24,
    airless: 0,
    haze0: "#8FA3C9",
    haze1: "#B8CAEE",
    hazeA0: 0.3,
    hazeA1: 0.5,
    rim0: "#B8CAEE",
    rim1: "#8FA3C9",
    designR: 27,
    maps: { albedo: "cracked-albedo", lights: "cracked-glow" },
  }),
  dwarf: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.4762,
    spin: 160,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFF6E6",
    hiA: 0.18,
    warmA: 0.24,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 10,
    maps: { albedo: "dwarf-albedo" },
  }),
  barren: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: 180,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#F4F2FC",
    hiA: 0.24,
    warmA: 0.24,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 14,
    maps: { albedo: "moon-barren-albedo" },
  }),
  icy: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.4267,
    spin: 150,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFFFFF",
    hiA: 0.28,
    warmA: 0.24,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#BFE3FF",
    rim1: "#BFE3FF",
    designR: 12,
    maps: { albedo: "moon-icy-albedo" },
  }),
  volcanic: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.4512,
    spin: 120,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFF6D8",
    hiA: 0.3,
    warmA: 0.24,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#FFE08A",
    rim1: "#FFE08A",
    designR: 13,
    maps: { albedo: "moon-volcanic-albedo" },
  }),
  mercury: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: 300,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFF4E6",
    hiA: 0.24,
    warmA: 0.24,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 21,
    maps: { albedo: "mercury-albedo" },
  }),
  venus: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: -96,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFF8E6",
    hiA: 0.3,
    warmA: 0.24,
    airless: 0,
    haze0: "#FFF0C8",
    haze1: "#FFF8E6",
    hazeA0: 0.5,
    hazeA1: 0.75,
    rim0: "#FFF0CC",
    rim1: "#F5D9A0",
    designR: 33.1,
    maps: { albedo: "venus-albedo" },
  }),
  titan: row([0.587, 0.587, 0.556], {
    locked: 0,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: 160,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFE0B0",
    hiA: 0.22,
    warmA: 0.24,
    airless: 0,
    haze0: "#F2B868",
    haze1: "#FFD58E",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#FFD08A",
    rim1: "#E9A050",
    designR: 21.6,
    maps: { albedo: "titan-albedo" },
  }),
  pluto: row([0.587, 0.587, 0.556], {
    locked: 1,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: 90,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFF4E6",
    hiA: 0.22,
    warmA: 0.24,
    airless: 0,
    haze0: "#C9D8FF",
    haze1: "#E6EEFF",
    hazeA0: 0.18,
    hazeA1: 0.3,
    rim0: "#C9D8FF",
    rim1: "#9FB8F2",
    designR: 14.7,
    maps: { face: "pluto-face" },
  }),
  charon: row([0.587, 0.587, 0.556], {
    locked: 1,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: 90,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#F4F2FC",
    hiA: 0.22,
    warmA: 0.24,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 10.5,
    maps: { face: "charon-face" },
  }),
  eris: row([0.587, 0.587, 0.556], {
    locked: 1,
    hasClouds: 0,
    hasLights: 0,
    glowDay: 0,
    start: 0.5,
    spin: 90,
    cloudSpin: 64,
    cloudA: 0.85,
    shadowA: 0.42,
    shadowOff: 0.026,
    glint: 0,
    lightsA: 0,
    hi: "#FFFFFF",
    hiA: 0.3,
    warmA: 0.24,
    airless: 1,
    haze0: "#8FD0FF",
    haze1: "#BFE6FF",
    hazeA0: 0.45,
    hazeA1: 0.7,
    rim0: "#A8DBFF",
    rim1: "#7FC4FF",
    designR: 14.5,
    maps: { face: "eris-face" },
  }),
};


/**
 * Which rocky look draws this body. Null keeps the sprite (stars, gas
 * giants, the double planet, the captured moon, props).
 * A home with no look is the ocean world. A target with no look is Planet X.
 * A moon with no look is the barren moon.
 */
export function planetKey(body: Body): PlanetKey | null {
  switch (body.look) {
    case "earth":
      return "earth";
    case "luna":
      return "moon";
    case "mars":
      return "mars";
    case "mercury":
      return "mercury";
    case "venus":
      return "venus";
    case "titan":
      return "titan";
    case "pluto":
      return "pluto";
    case "charon":
      return "charon";
    case "eris":
      return "eris";
    case "dwarf":
      return "dwarf";
    case "moon":
      return "barren";
    case "moon-icy":
      return "icy";
    case "moon-volcanic":
      return "volcanic";
    case "rocky":
      return "rocky";
    case "ice":
      return "ice";
    case "lava":
      return "lava";
    case "toxic":
      return "toxic";
    case "cracked":
      return "cracked";
    default:
      break;
  }
  if (body.look !== undefined) return null;
  if (body.kind === "home") return "ocean";
  if (body.kind === "target") return "planetx";
  if (body.kind === "moon") return "barren";
  return null;
}

/** The preview's light. `?lit=art` freezes the game on it for a side-by-side. */
export function planetArtLight(body: Body): readonly [number, number, number] | null {
  const key = planetKey(body);
  return key ? PLANETS[key].light : null;
}
