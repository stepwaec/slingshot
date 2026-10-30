import type { Body } from "../../sim/physics";
import { palette } from "../palette";
import { theme } from "../theme";

/**
 * Per-giant numbers from design/shader-specs.md §4, the same table the
 * preview runs. `roll` is the counter-clockwise body-frame roll (uRoll).
 * `jet` is extra turns per second at 17 latitude rows, north to south.
 */
export const GIANT_KEYS = [

  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "banded",
  "ringed",
  "ice",
] as const;

export type GiantKey = (typeof GIANT_KEYS)[number];


export interface GiantParams {
  light: readonly [number, number, number];
  designR: number;
  albedo: string;
  rings: string | null;
  start: number;
  spin: number;
  jet: readonly number[];
  roll: number;
  hi: string;
  hiA: number;
  warm: string;
  warmA: number;
  night0: string;
  night1: string;
  haze0: string;
  hazeA0: number;
  haze1: string;
  hazeA1: number;
  rim0: string;
  rim1: string;
  limb: string;
  limbA: number;
  hasRings: number;
  B: number;
  rho0: number;
  rho1: number;
  ringShadow: string;
  ringShadowA: number;
  planetShadowA: number;
  sparkle: number;
  sparkleT: number;
  sparkleRho: number;
  hex: number;
  hexCol: string;
  hexEdge: string;
  pole: number;
  poleCol: string;
  poleA: number;
}

export const GIANTS: Record<GiantKey, GiantParams> = {

  jupiter: {
    light: [0.587, 0.587, 0.556],
    designR: 114,
    albedo: "jupiter-bands",
    rings: null,
    start: 0.05,
    spin: 240,
    jet: [0, 0.000201, -0.000109, 0.000187, 0.001111, 0.001753, -0.000503, 0.001208, 0.001042, 0.001212, -0.000308, -0.00013, 0.00088, 0.000187, -0.000109, 0.000201, 0],
    roll: 0,
    hi: "#FFF3DE",
    hiA: 0.16,
    warm: palette.planetWarm,
    warmA: 0.22,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
    haze0: "#F5D7B0",
    hazeA0: 0.32,
    haze1: "#FFE6C4",
    hazeA1: 0.55,
    rim0: "#FFE3BC",
    rim1: "#F2B877",
    limb: palette.giantLimb,
    limbA: 0.35,
    hasRings: 0,
    B: 0.3,
    rho0: 1.2,
    rho1: 2.3,
    ringShadow: palette.planetNight1,
    ringShadowA: 0.55,
    planetShadowA: 0.82,
    sparkle: 0,
    sparkleT: 60,
    sparkleRho: 1.37,
    hex: 0,
    hexCol: palette.giantHex,
    hexEdge: palette.giantHexEdge,
    pole: 0,
    poleCol: palette.giantPole,
    poleA: 0.55,
  },
  saturn: {
    light: [0.587, 0.587, 0.556],
    designR: 104.5,
    albedo: "saturn-bands",
    rings: "saturn-rings",
    start: 0,
    spin: 260,
    jet: [0, 0.000167, -2.4e-05, -3.2e-05, 0.000346, 0.000898, 0.00123, 0.001482, 0.001731, 0.001482, 0.00123, 0.000898, 0.000346, -3.2e-05, -2.4e-05, 0.000167, 0],
    roll: 14,
    hi: "#FFF1C2",
    hiA: 0.18,
    warm: palette.planetWarm,
    warmA: 0.22,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
    haze0: "#F5D7B0",
    hazeA0: 0.26,
    haze1: "#FFE9C8",
    hazeA1: 0.5,
    rim0: "#FFE9C8",
    rim1: "#F5D7B0",
    limb: palette.giantLimb,
    limbA: 0,
    hasRings: 1,
    B: 0.36,
    rho0: 1.2,
    rho1: 2.36,
    ringShadow: palette.planetNight1,
    ringShadowA: 0.55,
    planetShadowA: 0.82,
    sparkle: 0,
    sparkleT: 60,
    sparkleRho: 1.37,
    hex: 1,
    hexCol: palette.giantHex,
    hexEdge: palette.giantHexEdge,
    pole: 0,
    poleCol: palette.giantPole,
    poleA: 0.55,
  },
  uranus: {
    light: [0.587, 0.587, 0.556],
    designR: 68.1,
    albedo: "uranus-bands",
    rings: "uranus-rings",
    start: 0,
    spin: 140,
    jet: [0.000857, 0.002236, 0.001541, 0.000894, 0.000327, -0.000272, -0.000962, -0.001629, -0.002286, -0.001629, -0.000962, -0.000272, 0.000327, 0.000894, 0.001541, 0.002236, 0.000857],
    roll: 62,
    hi: "#F0FFFE",
    hiA: 0.22,
    warm: palette.planetWarm,
    warmA: 0.22,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
    haze0: "#C8F4F4",
    hazeA0: 0.42,
    haze1: "#E8FFFE",
    hazeA1: 0.65,
    rim0: "#C8F6F6",
    rim1: "#8EE0E8",
    limb: palette.giantLimb,
    limbA: 0,
    hasRings: 1,
    B: 0.62,
    rho0: 1.6,
    rho1: 2.04,
    ringShadow: palette.planetNight1,
    ringShadowA: 0.55,
    planetShadowA: 0.82,
    sparkle: 0,
    sparkleT: 60,
    sparkleRho: 1.37,
    hex: 0,
    hexCol: palette.giantHex,
    hexEdge: palette.giantHexEdge,
    pole: 1,
    poleCol: palette.giantPole,
    poleA: 0.55,
  },
  neptune: {
    light: [0.587, 0.587, 0.556],
    designR: 67,
    albedo: "neptune-bands",
    rings: null,
    start: 0.8667,
    spin: 120,
    jet: [0.001, 0.002609, 0.001797, 0.001042, 0.000381, -0.000317, -0.001122, -0.001901, -0.002667, -0.001901, -0.001122, -0.000317, 0.000381, 0.001042, 0.001797, 0.002609, 0.001],
    roll: 0,
    hi: "#DCE8FF",
    hiA: 0.24,
    warm: palette.planetWarm,
    warmA: 0.22,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
    haze0: "#7FA8FF",
    hazeA0: 0.4,
    haze1: "#B8D0FF",
    hazeA1: 0.6,
    rim0: "#A8C4FF",
    rim1: "#5E8CFF",
    limb: palette.giantLimb,
    limbA: 0,
    hasRings: 0,
    B: 0.3,
    rho0: 1.2,
    rho1: 2.3,
    ringShadow: palette.planetNight1,
    ringShadowA: 0.55,
    planetShadowA: 0.82,
    sparkle: 0,
    sparkleT: 60,
    sparkleRho: 1.37,
    hex: 0,
    hexCol: palette.giantHex,
    hexEdge: palette.giantHexEdge,
    pole: 0,
    poleCol: palette.giantPole,
    poleA: 0.55,
  },
  banded: {
    light: [0.587, 0.587, 0.556],
    designR: 44,
    albedo: "gas-banded-bands",
    rings: null,
    start: 0.8188,
    spin: 180,
    jet: [0, 0, 0, 0, -0.014646, -0.014646, -0.014646, -0.014646, 0.001111, 0.001111, 0.001111, 0, 0, 0, 0, 0, 0],
    roll: 0,
    hi: "#FFF3DE",
    hiA: 0.2,
    warm: palette.planetWarm,
    warmA: 0.22,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
    haze0: "#F5D7B0",
    hazeA0: 0.38,
    haze1: "#FFE6C4",
    hazeA1: 0.6,
    rim0: "#FFE3BC",
    rim1: "#F2B877",
    limb: palette.giantLimb,
    limbA: 0,
    hasRings: 0,
    B: 0.3,
    rho0: 1.2,
    rho1: 2.3,
    ringShadow: palette.planetNight1,
    ringShadowA: 0.55,
    planetShadowA: 0.82,
    sparkle: 0,
    sparkleT: 60,
    sparkleRho: 1.37,
    hex: 0,
    hexCol: palette.giantHex,
    hexEdge: palette.giantHexEdge,
    pole: 0,
    poleCol: palette.giantPole,
    poleA: 0.55,
  },
  ringed: {
    light: [0.587, 0.587, 0.556],
    designR: 44,
    albedo: "gas-ringed-bands",
    rings: "gas-ringed-rings",
    start: 0.8188,
    spin: 160,
    jet: [0, 0, 0, 0, -0.014583, -0.014583, -0.014583, 0, 0, 0, -0.014583, -0.014583, -0.014583, 0, 0, 0, 0],
    roll: 22,
    hi: "#E8FFFA",
    hiA: 0.2,
    warm: palette.planetWarm,
    warmA: 0.22,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
    haze0: "#BFE8E0",
    hazeA0: 0.38,
    haze1: "#DDF7F1",
    hazeA1: 0.6,
    rim0: "#D3FBF2",
    rim1: "#8EDCCC",
    limb: palette.giantLimb,
    limbA: 0,
    hasRings: 1,
    B: 0.28,
    rho0: 1.3299200000000002,
    rho1: 2.2,
    ringShadow: palette.planetNight1,
    ringShadowA: 0.55,
    planetShadowA: 0.85,
    sparkle: 0,
    sparkleT: 60,
    sparkleRho: 1.37,
    hex: 0,
    hexCol: palette.giantHex,
    hexEdge: palette.giantHexEdge,
    pole: 0,
    poleCol: palette.giantPole,
    poleA: 0.55,
  },
  ice: {
    light: [0.587, 0.587, 0.556],
    designR: 44,
    albedo: "ring-saturn-bands",
    rings: "ring-saturn-rings",
    start: 0.8188,
    spin: 150,
    jet: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    roll: 22,
    hi: "#FFF1C2",
    hiA: 0.24,
    warm: palette.planetWarm,
    warmA: 0.22,
    night0: palette.planetNight0,
    night1: palette.planetNight1,
    haze0: "#F5D7B0",
    hazeA0: 0.26,
    haze1: "#FFE9C8",
    hazeA1: 0.5,
    rim0: "#FFE9C8",
    rim1: "#F5D7B0",
    limb: palette.giantLimb,
    limbA: 0,
    hasRings: 1,
    B: 0.31,
    rho0: 1.22,
    rho1: 2.2,
    ringShadow: palette.planetNight1,
    ringShadowA: 0.55,
    planetShadowA: 0.82,
    sparkle: 1,
    sparkleT: 60,
    sparkleRho: 1.37,
    hex: 0,
    hexCol: palette.giantHex,
    hexEdge: palette.giantHexEdge,
    pole: 0,
    poleCol: palette.giantPole,
    poleA: 0.55,
  },
};

/**
 * Which gas giant draws this body. Null keeps another family or the sprite.
 * `gas-giant` is the banded library world. Sol looks use their own columns.
 */
export function giantKey(body: Body): GiantKey | null {
  switch (body.look) {
    case "jupiter":
      return "jupiter";
    case "saturn":
      return "saturn";
    case "uranus":
      return "uranus";
    case "neptune":
      return "neptune";
    case "gas-giant":
      return "banded";
    case "gas-ringed":
      return "ringed";
    case "ice-ring":
      return "ice";
    default:
      return null;
  }
}

/** The preview's light. `?lit=art` freezes the game on it for a side-by-side. */
export function giantArtLight(body: Body): readonly [number, number, number] | null {
  const key = giantKey(body);
  return key ? GIANTS[key].light : null;
}

/** Quad reach in body radii: the ring's outer edge, or the 1.08 r rim. */
export function giantExtent(key: GiantKey): number {
  const look = GIANTS[key];
  const rim = theme.giantShader.rimExtent;
  return look.hasRings > 0.5 ? Math.max(look.rho1, rim) : rim;
}

