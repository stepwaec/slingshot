import type { Body, BodyLook } from "../../sim/physics";

/**
 * Per-star values from design/shader-specs.md §2.
 * The sun column is variant J (`star.svg`). The Sol sun adds spots and
 * drops the flare (`sol/sun.svg`).
 */
export interface StarParams {
  R: number;
  core: string;
  mid: string;
  edge: string;
  deep: string;
  deepAmt: number;
  deepFreq: number;
  deepFlow: number;
  dark: string;
  darkAmt: number;
  darkFreq: number;
  darkFlow: number;
  fil: string;
  filAmt: number;
  filFreq: number;
  filGain: number;
  boil: number;
  limbDark: number;
  limbA: string;
  limbB: string;
  rimA: number;
  wobble: number;
  faculae: number;
  spots: number;
  pen: string;
  umb: string;
  spotSpin: number;
  haze0: string;
  haze1: string;
  haze2: string;
  hazeR: number;
  hazeA: number;
  fl0: string;
  fl1: string;
  fl2: string;
  flR: number;
  flAmp: number;
  flFreq: number;
  flSpin: number;
  flA: number;
  wi0: string;
  wi1: string;
  wi2: string;
  wiR: number;
  wiAmp: number;
  wiFreq: number;
  wiSpin: number;
  wiA: number;
  noiseGain: number;
  breathe: number;
  breatheT: number;
  prom: number;
  proOut: string;
  proIn: string;
  proW: number;
  flare: number;
  smooth: number;
}

export const STAR_KINDS = [
  "sun",
  "sol-sun",
  "red-dwarf",
  "blue-giant",
  "binary-hot",
  "binary-cool",
  "white-dwarf",
  "red-giant",
] as const;

export type StarKind = (typeof STAR_KINDS)[number];

const SUN: StarParams = {
  R: 46,
  core: "#FFB43A",
  mid: "#FF8F1F",
  edge: "#FF7A14",
  deep: "#A03308",
  deepAmt: 0.28,
  deepFreq: 1.6,
  deepFlow: 0.0143,
  dark: "#802105",
  darkAmt: 0.55,
  darkFreq: 2.3,
  darkFlow: -0.0222,
  fil: "#FFE7A0",
  filAmt: 0.8,
  filFreq: 2.75,
  filGain: 0.66,
  boil: 9,
  limbDark: 0.18,
  limbA: "#FFD27A",
  limbB: "#FFF1C2",
  rimA: 1,
  wobble: 0.05,
  faculae: 0.6,
  spots: 0,
  pen: "#B8401E",
  umb: "#4A1006",
  spotSpin: 0.0349,
  haze0: "#FF7A2A",
  haze1: "#E8461A",
  haze2: "#6A1408",
  hazeR: 4.35,
  hazeA: 1,
  fl0: "#FFE7A0",
  fl1: "#FFB347",
  fl2: "#FF6A1A",
  flR: 1.348,
  flAmp: 0.217,
  flFreq: 6.5,
  flSpin: 200,
  flA: 1,
  wi0: "#FFB347",
  wi1: "#FF6A1A",
  wi2: "#E8461A",
  wiR: 1.7,
  wiAmp: 0.37,
  wiFreq: 3.9,
  wiSpin: -300,
  wiA: 1,
  noiseGain: 1.6,
  breathe: 0.03,
  breatheT: 6,
  prom: 1,
  proOut: "#FF8C2E",
  proIn: "#FFF1C2",
  proW: 2.8,
  flare: 1,
  smooth: 0,
};

export const STAR_PARAMS: Record<StarKind, StarParams> = {
  sun: SUN,
  "sol-sun": { ...SUN, spots: 1, flare: 0 },
  "red-dwarf": {
    ...SUN,
    R: 40,
    core: "#FF8A4A",
    mid: "#F0502A",
    edge: "#D63A1E",
    deep: "#7A1A08",
    deepAmt: 0.3,
    deepFreq: 1,
    deepFlow: 0.01,
    dark: "#4A0A06",
    darkFreq: 1.3,
    darkFlow: -0.015,
    fil: "#FFB27A",
    filAmt: 0.68,
    filFreq: 2,
    boil: 11,
    limbA: "#FF9A62",
    limbB: "#FFD9B0",
    haze0: "#F0502A",
    haze1: "#C8301C",
    haze2: "#4E0C16",
    hazeR: 4.5,
    fl0: "#FFB27A",
    fl1: "#FF6A3A",
    fl2: "#E0432F",
    flR: 1.35,
    flAmp: 0.175,
    flFreq: 4.3,
    flSpin: 260,
    wi0: "#FF6A3A",
    wi1: "#E0432F",
    wi2: "#A8240E",
    wiAmp: 0.3,
    wiFreq: 3.4,
    wiSpin: -390,
    proOut: "#E0432F",
    proIn: "#FFD9B0",
    proW: 2.4,
  },
  "blue-giant": {
    ...SUN,
    R: 54,
    core: "#EAF1FF",
    mid: "#A6C0FF",
    edge: "#7FA3FF",
    deep: "#3A6AF0",
    deepAmt: 0.25,
    deepFreq: 2.5,
    dark: "#2F5BD8",
    darkAmt: 0.45,
    darkFreq: 4.3,
    fil: "#F4F8FF",
    filAmt: 0.85,
    filFreq: 5.4,
    boil: 7,
    limbA: "#CFE0FF",
    limbB: "#F4F8FF",
    noiseGain: 1.25,
    haze0: "#5E9BFF",
    haze1: "#3A6AF0",
    haze2: "#15287A",
    hazeR: 4.44,
    hazeA: 0.92,
    fl0: "#F4F8FF",
    fl1: "#A9C8FF",
    fl2: "#4F8DFF",
    flAmp: 0.22,
    flFreq: 7.3,
    flSpin: 180,
    wi0: "#7FB2FF",
    wi1: "#4F8DFF",
    wi2: "#3A6AF0",
    wiFreq: 6,
    wiSpin: -270,
    proOut: "#5EA0FF",
    proIn: "#F4F8FF",
    proW: 3.2,
  },
  "binary-hot": {
    ...SUN,
    R: 30,
    core: "#FFE7A0",
    mid: "#FFC24A",
    edge: "#FF9A2A",
    dark: "#A0460E",
    deepFreq: 1.05,
    darkFreq: 1.5,
    fil: "#FFFDF0",
    filFreq: 1.8,
    limbA: "#FFE7A0",
    limbB: "#FFFDF0",
    haze0: "#FFB45A",
    haze1: "#FF8C3A",
    haze2: "#6A2A10",
    hazeR: 4,
    hazeA: 0.8,
    fl0: "#FFF6D6",
    fl1: "#FFD27A",
    fl2: "#FFA040",
    wi0: "#FFD27A",
    wi1: "#FFA040",
    wi2: "#FF8C3A",
    proOut: "#FFB45A",
    proIn: "#FFFDF0",
    proW: 2,
  },
  "binary-cool": {
    ...SUN,
    R: 20,
    core: "#FF9A3A",
    mid: "#FF7426",
    edge: "#E85A1A",
    dark: "#6A1606",
    deepFreq: 0.7,
    darkFreq: 1,
    fil: "#FFC27A",
    filFreq: 1.2,
    limbA: "#FFB27A",
    limbB: "#FFD8B0",
    haze0: "#FF8C3A",
    haze1: "#E8501A",
    haze2: "#5A1608",
    hazeR: 4,
    hazeA: 0.7,
    fl0: "#FFC890",
    fl1: "#FF9A4A",
    fl2: "#E8501A",
    wi0: "#FF9A4A",
    wi1: "#E8501A",
    wi2: "#A8240E",
    proOut: "#FF6A2A",
    proIn: "#FFD8B0",
    proW: 1.5,
    flare: 0,
  },
  "white-dwarf": {
    ...SUN,
    R: 16,
    core: "#FFFFFF",
    mid: "#F2F5FC",
    edge: "#9FC2FF",
    limbA: "#7FB8FF",
    limbB: "#FFFFFF",
    rimA: 0.9,
    wobble: 0,
    haze0: "#7FB8FF",
    haze1: "#B8CCFF",
    hazeA: 0.55,
    breathe: 0.05,
    breatheT: 4,
    prom: 0,
    flare: 0,
    smooth: 1,
  },
  "red-giant": {
    ...SUN,
    R: 120,
    core: "#FF8A42",
    mid: "#F0602C",
    edge: "#C8401E",
    deep: "#8A2A0C",
    deepAmt: 0.3,
    deepFreq: 2,
    deepFlow: 0.006,
    dark: "#5A1406",
    darkFreq: 3.1,
    darkFlow: -0.009,
    fil: "#FFB27A",
    filAmt: 0.62,
    filFreq: 3.85,
    boil: 14,
    limbA: "#FF9A62",
    limbB: "#FFC8A0",
    rimA: 0.6,
    wobble: 0.03,
    haze0: "#FF6A3A",
    haze1: "#C83C1E",
    haze2: "#4A0E08",
    hazeR: 2.43,
    hazeA: 0.9,
    fl0: "#FFB27A",
    fl1: "#FF8A4A",
    fl2: "#D8461E",
    flAmp: 0.11,
    flFreq: 12,
    flA: 0.55,
    wi0: "#FF8A4A",
    wi1: "#D8461E",
    wi2: "#8A1E10",
    wiAmp: 0.18,
    wiFreq: 9,
    wiA: 0.7,
    breatheT: 9,
    proOut: "#FF8A4A",
    proIn: "#FFE0C8",
    proW: 3,
    flare: 0,
  },
};

const SHADER_LOOKS = new Set<string>(STAR_KINDS);

/** Looks that stay on the SVG path until a later family. */
const SPRITE_LOOKS = new Set<BodyLook>(["tau-ceti", "neutron", "pulsar", "magnetar"]);

export function starKind(body: Body): StarKind | null {
  const look = body.look;
  if (look && SPRITE_LOOKS.has(look)) return null;
  if (look === "sun" || (body.kind === "star" && look === undefined)) return "sun";
  if (look && SHADER_LOOKS.has(look)) return look as StarKind;
  return null;
}
