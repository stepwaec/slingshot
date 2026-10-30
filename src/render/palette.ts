/** Palette tokens from design/style.md. Hex strings are sRGB. */

export const palette = {
  bg: "#050710",
  vignette: "#0B1024",
  starsFar: "#6E7FA6",
  starsMid: "#AAB8DD",
  starsNear: "#FFFFFF",
  starCore: "#FFF8E1",
  starBody: "#FFC857",
  starCorona: "#FF8C2E",
  starGlow: "#FF5A1F",
  planetStartHighlight: "#9CCBFF",
  planetStartBase: "#3D8BFF",
  planetStartShadow: "#142B5E",
  planetXHighlight: "#B5FFF0",
  planetXBase: "#3DE0C2",
  planetXShadow: "#0E4A40",
  shipHull: "#F2F5FF",
  shipOutline: "#0A0D1A",
  shipCockpit: "#5EA0FF",
  thrustCore: "#FFE08A",
  thrustOuter: "#FF6A2A",
  trail: "#5EA0FF",
  path: "#DCE4FF",
  arrow: "#FFFFFF",
  text: "#ECF0FA",
  textMuted: "#8B95B5",
  fuelFull: "#3DE0C2",
  fuelLow: "#FFC857",
  fuelCritical: "#FF5A5F",
  resultWin: "#3DE0C2",
  resultCrash: "#FF5A5F",
  resultLost: "#B48CFF",
  node: "#FFC857",
  /** design/style.md §13 and the megastructure SVG headers. */
  engineJet0: "#FFF6D6",
  engineJet1: "#FFD27A",
  engineJet2: "#FF9A4A",
  engineJet3: "#FF5A8A",
  engineJet4: "#E0408A",
  engineCore: "#FFFFFF",
  engineCoreEnd: "#FFF6D6",
  engineKnot: "#FFE7A0",
  mirrorBright: "#F4F8FF",
  mirrorMid: "#AFC2EE",
  mirrorDeep: "#5A6E9E",
  mirrorOutline: "#1A2240",
  shkadovBright: "#FFFFFF",
  shkadovMid: "#E6F2FF",
  shkadovDeep: "#8FA3D0",
  nozzleBar: "#DCE4F6",
  nozzleField: "#5EA0FF",
  swarmCollector: "#5E8FFF",
  swarmGlint: "#FFE7A0",
  swarmHeat: "#A8303A",
  swarmHeatEdge: "#8A2A3A",
  scoopMark: "#FFB45A",
  driftArrow: "#8B95B5",
  strut: "#5A6E9E",
  reflectedGlow: "#FFE7A0",
  /** design/style.md §14. Collisions and consumption. */
  eventFlash: "#FFFFFF",
  eventFlashMid: "#FFF6D6",
  eventFlashEdge: "#FFE7A0",
  eventShock: "#FFE7A0",
  eventGlow: "#FFE7A0",
  eventGlowMid: "#FF8A3A",
  eventGlowEdge: "#FF6A2A",
  eventEjectaHot: "#FFB45A",
  eventEjectaRock: "#C8A684",
  eventEjectaRockMid: "#9A7A5E",
  eventEjectaRockDark: "#8E8478",
  eventAblation: "#FFF6D6",
  eventAblationHot: "#FFB45A",
  eventAblationPink: "#FF5A8A",
  eventAblationTail: "#E0408A",
  eventRipple: "#FFF1C2",
  eventWarn: "#FF9F43",
  eventNext: "#FFC857",
  eventBand: "#C9B79E",
  eventPanel: "#0A0D1A",
  /** debris-field.svg S and C lit faces. */
  debrisLightS: "#C8A684",
  debrisDarkS: "#5A4636",
  debrisLightC: "#8E8478",
  debrisDarkC: "#3A332D",
} as const;

/** Linear blend in sRGB, matching the arrow.power ramp in design/canvas-notes.md §9. */
export function lerpHex(a: string, b: string, t: number): string {
  const A = Number.parseInt(a.slice(1), 16);
  const B = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((A >> shift) & 255) + (((B >> shift) & 255) - ((A >> shift) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`.toUpperCase();
}

/** arrow.power: mint → amber → critical, linear in sRGB. 62% is #FFAE59. */
export function powerHex(power: number): string {
  const p = Math.min(1, Math.max(0, power));
  if (p < 0.5) return lerpHex(palette.planetXBase, palette.fuelLow, p * 2);
  return lerpHex(palette.fuelLow, palette.fuelCritical, (p - 0.5) * 2);
}

/** sRGB hex as 0–1 channels. Custom shaders write these straight out (no extra encode). */
export function srgb01(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
