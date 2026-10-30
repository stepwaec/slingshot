import type { BodyLook } from "../sim/physics";
import { silenceNightRim, type StripSpec } from "./surface-art";

/**
 * Sol campaign bodies. Numbers are the SVG headers in design/assets/sol/
 * and the size ladder in design/style.md §18. Strips scroll on frame time.
 * Locked faces do not scroll. Ring rolls are art, not physics.
 */

export const SOL_LOOKS = [
  "sol-sun",
  "mercury",
  "venus",
  "earth",
  "luna",
  "mars",
  "jupiter",
  "saturn",
  "titan",
  "uranus",
  "neptune",
  "pluto",
  "charon",
  "eris",
  "arrokoth",
  "voyager",
] as const;

export type SolLook = (typeof SOL_LOOKS)[number];

export function isSolLook(look: BodyLook | undefined): look is SolLook {
  return look !== undefined && (SOL_LOOKS as readonly string[]).includes(look);
}

/** design/assets/sol/sun.svg prominences, same timing as star.svg. */
export const SOL_PROMINENCES = [
  { id: "solSunProm1", angle: 147.5, begin: 0, dur: 12 },
  { id: "solSunProm2", angle: 243.6, begin: 5, dur: 16 },
  { id: "solSunProm3", angle: 314.8, begin: 9, dur: 14 },
] as const;

export type SolMode = "sun" | "scroll" | "locked" | "prop";

export interface SolArt {
  look: SolLook;
  root: string;
  /** Theme asset key. Only props that still rasterize an SVG look this up. */
  asset: string;
  viewW: number;
  viewH: number;
  /** Painted disc radius in the SVG. Voyager's is the dish radius, for scale. */
  svgRadius: number;
  /** design/style.md §18 crash radius. Voyager is not solid; this scales the dish. */
  radius: number;
  mode: SolMode;
  /** Limb darkening, polar collar, hexagon, or the rings' shadow on the globe. */
  staticLayer: boolean;
  /** Haze and rim, masked to the lit side. Earth's sit above the city lights. */
  air: boolean;
  rings: boolean;
  /** Saturn only: the planet's shadow on the rings follows −L. */
  ringShadow: boolean;
  strips: readonly StripSpec[];
}

const UP = { x: 1, y: 1 } as const;

export function solArt(look: SolLook): SolArt {
  return SOL_ART[look];
}

export function solLight(): { x: number; y: number } {
  return UP;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function band(
  id: string,
  index: number,
  box: Box,
  tx: number,
  ty: number,
  svgRadius: number,
  dur: number,
  distance: number,
  opacity: number,
  order: number,
  extra?: Pick<StripSpec, "fromX" | "rollDeg" | "night">,
): StripSpec {
  return {
    id,
    viewW: box.w,
    viewH: box.h,
    originX: box.x,
    originY: box.y,
    tx,
    ty,
    svgRadius,
    dur,
    distance,
    opacity,
    order,
    fromX: extra?.fromX,
    rollDeg: extra?.rollDeg,
    night: extra?.night,
    prep: (doc) => liftSolStrip(doc, index, box),
  };
}

const MERCURY_BOX: Box = { x: -8, y: -8, w: 280, h: 58 };
const VENUS_BOX: Box = { x: -8, y: -8, w: 432, h: 82.2 };
const EARTH_BOX: Box = { x: -8, y: -8, w: 444, h: 84 };
const MARS_BOX: Box = { x: -8, y: -8, w: 328, h: 65.6 };
const JUPITER_BOX: Box = { x: -8, y: -8, w: 1448, h: 244 };
const SATURN_BOX: Box = { x: -8, y: -8, w: 1330, h: 225 };
const TITAN_BOX: Box = { x: -8, y: -8, w: 288, h: 59.2 };
const URANUS_BOX: Box = { x: -8, y: -8, w: 872, h: 152.2 };
const NEPTUNE_BOX: Box = { x: -8, y: -8, w: 858, h: 150 };
/** Spots have no backing rect. The window covers both copies and the r 46 disc. */
const SPOT_BOX: Box = { x: -8, y: -8, w: 620, h: 108 };

const SOL_ART: Record<SolLook, SolArt> = {
  "sol-sun": {
    look: "sol-sun",
    root: "solSun",
    asset: "solSun",
    viewW: 412,
    viewH: 412,
    svgRadius: 46,
    radius: 46,
    mode: "sun",
    staticLayer: false,
    air: false,
    rings: false,
    ringShadow: false,
    strips: [band("sol-spots", 0, SPOT_BOX, -433.5, -46, 46, 180, 289, 0.92, 6)],
  },
  mercury: {
    look: "mercury",
    root: "mercury",
    asset: "solMercury",
    viewW: 54,
    viewH: 54,
    svgRadius: 21,
    radius: 21,
    mode: "scroll",
    staticLayer: false,
    air: false,
    rings: false,
    ringShadow: false,
    strips: [band("mer-surface", 0, MERCURY_BOX, -198, -21, 21, 300, 132, 1, 2)],
  },
  venus: {
    look: "venus",
    root: "venus",
    asset: "solVenus",
    viewW: 82,
    viewH: 82,
    svgRadius: 33.1,
    radius: 33,
    mode: "scroll",
    staticLayer: false,
    air: true,
    rings: false,
    ringShadow: false,
    // Header P is 207. The SMIL runs 208 → 0, which is the retrograde cloud deck.
    strips: [band("ven-clouds", 0, VENUS_BOX, -312, -33.1, 33.1, 96, -208, 1, 2, { fromX: 208 })],
  },
  earth: {
    look: "earth",
    root: "earth",
    asset: "solEarth",
    viewW: 84,
    viewH: 84,
    svgRadius: 34,
    radius: 34,
    mode: "scroll",
    staticLayer: false,
    air: true,
    rings: false,
    ringShadow: false,
    strips: [
      band("eth-land", 0, EARTH_BOX, -329.9, -34, 34, 90, 214, 1, 2),
      // Cloud shadow offset (−0.9, +0.9), same 214 px period as the deck.
      band("eth-cloud-shadow", 1, EARTH_BOX, -329.9, -33.1, 34, 64, 214, 0.42, 3, { fromX: -0.9 }),
      band("eth-clouds", 2, EARTH_BOX, -329.9, -34, 34, 64, 214, 0.85, 4),
      band("eth-cities", 3, EARTH_BOX, -329.9, -34, 34, 90, 214, 1, 6, { night: true }),
    ],
  },
  luna: {
    look: "luna",
    root: "luna",
    asset: "solLuna",
    viewW: 48,
    viewH: 48,
    svgRadius: 18,
    radius: 18,
    mode: "locked",
    staticLayer: false,
    air: false,
    rings: false,
    ringShadow: false,
    strips: [],
  },
  mars: {
    look: "mars",
    root: "mars",
    asset: "solMars",
    viewW: 64,
    viewH: 64,
    svgRadius: 24.8,
    radius: 24.8,
    mode: "scroll",
    staticLayer: false,
    air: true,
    rings: false,
    ringShadow: false,
    strips: [band("mar-surface", 0, MARS_BOX, -251.3, -24.8, 24.8, 92, 156, 1, 2)],
  },
  jupiter: {
    look: "jupiter",
    root: "jupiter",
    asset: "solJupiter",
    viewW: 248,
    viewH: 248,
    svgRadius: 114,
    radius: 114,
    mode: "scroll",
    staticLayer: true,
    air: true,
    rings: false,
    ringShadow: false,
    strips: [band("jup-bands", 0, JUPITER_BOX, -1109.8, -114, 114, 240, 716, 1, 2)],
  },
  saturn: {
    look: "saturn",
    root: "saturn",
    asset: "solSaturn",
    viewW: 502,
    viewH: 233,
    svgRadius: 104.5,
    radius: 104.6,
    mode: "scroll",
    staticLayer: true,
    air: true,
    rings: true,
    ringShadow: true,
    strips: [band("sat-bands", 0, SATURN_BOX, -985.5, -104.5, 104.5, 260, 657, 1, 2, { rollDeg: -14 })],
  },
  titan: {
    look: "titan",
    root: "titan",
    asset: "solTitan",
    viewW: 59,
    viewH: 59,
    svgRadius: 21.6,
    radius: 21.6,
    mode: "scroll",
    staticLayer: false,
    air: true,
    rings: false,
    ringShadow: false,
    strips: [band("tit-haze", 0, TITAN_BOX, -204, -21.6, 21.6, 160, 136, 1, 2)],
  },
  uranus: {
    look: "uranus",
    root: "uranus",
    asset: "solUranus",
    viewW: 279,
    viewH: 279,
    svgRadius: 68.1,
    radius: 68.1,
    mode: "scroll",
    staticLayer: true,
    air: true,
    rings: true,
    ringShadow: false,
    strips: [band("ura-bands", 0, URANUS_BOX, -642, -68.1, 68.1, 140, 428, 1, 2, { rollDeg: -62 })],
  },
  neptune: {
    look: "neptune",
    root: "neptune",
    asset: "solNeptune",
    viewW: 152,
    viewH: 152,
    svgRadius: 67,
    radius: 67,
    mode: "scroll",
    staticLayer: false,
    air: true,
    rings: false,
    ringShadow: false,
    strips: [band("nep-bands", 0, NEPTUNE_BOX, -575.4, -67, 67, 120, 421, 1, 2)],
  },
  pluto: {
    look: "pluto",
    root: "pluto",
    asset: "solPluto",
    viewW: 41,
    viewH: 41,
    svgRadius: 14.7,
    radius: 14.7,
    mode: "locked",
    staticLayer: false,
    air: true,
    rings: false,
    ringShadow: false,
    strips: [],
  },
  charon: {
    look: "charon",
    root: "charon",
    asset: "solCharon",
    viewW: 31,
    viewH: 31,
    svgRadius: 10.5,
    radius: 10.5,
    mode: "locked",
    staticLayer: false,
    air: false,
    rings: false,
    ringShadow: false,
    strips: [],
  },
  eris: {
    look: "eris",
    root: "eris",
    asset: "solEris",
    viewW: 39,
    viewH: 39,
    svgRadius: 14.5,
    radius: 14.5,
    mode: "locked",
    staticLayer: false,
    air: false,
    rings: false,
    ringShadow: false,
    strips: [],
  },
  arrokoth: {
    look: "arrokoth",
    root: "arrokoth",
    asset: "solArrokoth",
    viewW: 28,
    viewH: 28,
    svgRadius: 6,
    radius: 6,
    mode: "prop",
    staticLayer: false,
    air: false,
    rings: false,
    ringShadow: false,
    strips: [],
  },
  voyager: {
    look: "voyager",
    root: "voyager",
    asset: "solVoyager",
    viewW: 72,
    viewH: 56,
    svgRadius: 11,
    radius: 11,
    mode: "prop",
    staticLayer: false,
    air: false,
    rings: false,
    ringShadow: false,
    strips: [],
  },
};

type SolPart = "base" | "shade" | "air" | "static" | "surface" | "ring-back" | "ring-front";

/** Keep one layer of a Sol body and drop its SMIL, so the game can replay the header. */
export function prepSol(doc: Document, rootId: string, part: SolPart): void {
  const root = doc.getElementById(rootId);
  if (!root) return;
  for (const child of [...root.children]) {
    const kind = classSolChild(child);
    const keep =
      (part === "base" && kind === "base") ||
      (part === "shade" && kind === "shade") ||
      (part === "air" && kind === "air") ||
      (part === "static" && kind === "static") ||
      (part === "surface" && kind !== "shade" && kind !== "air" && kind !== "ring-back" && kind !== "ring-front") ||
      (part === "ring-back" && kind === "ring-back") ||
      (part === "ring-front" && kind === "ring-front");
    if (!keep) child.remove();
  }
  if (part === "ring-back" || part === "ring-front") {
    for (const clip of [...root.querySelectorAll("[clip-path]")]) {
      if ((clip.getAttribute("clip-path") ?? "").includes("satSh")) clip.remove();
    }
  }
  root.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
  if (part === "air") silenceNightRim(doc, root);
}

/** Lift one scrolling strip out of its disc so a UV window can move it. */
export function liftSolStrip(doc: Document, index: number, box: Box): void {
  const anims = [...doc.querySelectorAll("animateTransform")].filter((node) => node.getAttribute("type") === "translate");
  const anim = anims[index];
  const holder = anim?.parentElement;
  if (!holder) return;
  const inner = [...holder.children].find((node) => node !== anim && node.localName === "g");
  if (!inner) return;
  inner.removeAttribute("transform");
  inner.removeAttribute("mask");
  const svg = doc.documentElement;
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  svg.setAttribute("width", String(box.w));
  svg.setAttribute("height", String(box.h));
  svg.append(inner);
  for (const child of [...svg.children]) {
    if (child.localName === "defs" || child === inner) continue;
    child.remove();
  }
}

function classSolChild(el: Element): "base" | "shade" | "air" | "static" | "strip" | "ring-back" | "ring-front" {
  if (hasTranslate(el)) return "strip";
  const clip = clipText(el);
  if (clip.includes("satRB") || clip.includes("uraBack")) return "ring-back";
  if (clip.includes("satRF") || clip.includes("uraFront")) return "ring-front";
  const fill = el.getAttribute("fill") ?? "";
  if (/Shade|Glint/.test(fill)) return "shade";
  if (/Haze|Rim|titBlue/.test(fill)) return "air";
  if ((el.localName === "circle" || el.localName === "ellipse") && fill.startsWith("#")) return "base";
  return "static";
}

function hasTranslate(el: Element): boolean {
  for (const node of el.querySelectorAll("animateTransform")) {
    if (node.getAttribute("type") === "translate") return true;
  }
  return false;
}

function clipText(el: Element): string {
  let text = el.getAttribute("clip-path") ?? "";
  for (const node of el.querySelectorAll("[clip-path]")) text += node.getAttribute("clip-path") ?? "";
  return text;
}

export type SolSunPart = "haze" | "wisp" | "flame" | "prom" | "flare" | "grain" | "limb" | "spots";

/** One living layer of sol/sun.svg. Spots are the scrolling strip under the flame ring. */
export function prepSolSun(doc: Document, part: SolSunPart, promId?: string): void {
  if (part === "spots") {
    liftSolStrip(doc, 0, SPOT_BOX);
    return;
  }
  dropSolSpots(doc);
  if (part === "haze") solHaze(doc);
  else if (part === "wisp") solRing(doc, "solSunWispRing");
  else if (part === "flame") solRing(doc, "solSunFlameRing");
  else if (part === "prom" && promId) solProm(doc, promId);
  else if (part === "flare") solFlare(doc);
  else if (part === "grain") solGrain(doc);
  else if (part === "limb") solLimb(doc);
}

function dropSolSpots(doc: Document): void {
  const root = doc.getElementById("solSun");
  if (!root) return;
  for (const child of [...root.children]) {
    if ((child.getAttribute("clip-path") ?? "").includes("solClip")) child.remove();
  }
}

function solHaze(doc: Document): void {
  for (const id of ["solSunWispRing", "solSunFlameRing", "solSunProminences", "solSunFlare", "solSunDisc"]) {
    doc.getElementById(id)?.remove();
  }
  removeDirectCircles(doc.getElementById("solSun"));
  stripMotion(doc.getElementById("solSunBreathe"));
}

function solRing(doc: Document, id: string): void {
  for (const drop of ["solSunProminences", "solSunFlare", "solSunDisc"]) doc.getElementById(drop)?.remove();
  removeDirectCircles(doc.getElementById("solSun"));
  const breathe = doc.getElementById("solSunBreathe");
  const keep = doc.getElementById(id);
  if (breathe) {
    for (const child of [...breathe.children]) {
      if (child !== keep) child.remove();
    }
  }
  stripMotion(keep);
}

function solFront(doc: Document): void {
  for (const id of ["solSunBreathe", "solSunProminences", "solSunFlare"]) doc.getElementById(id)?.remove();
}

function solGrain(doc: Document): void {
  solFront(doc);
  const disc = doc.getElementById("solSunDisc");
  if (!disc) return;
  for (const child of [...disc.children]) {
    if (child.getAttribute("filter") !== "url(#solSunSurf)") child.remove();
  }
  rimStroke(doc.getElementById("solSun"))?.remove();
}

function solLimb(doc: Document): void {
  solFront(doc);
  const disc = doc.getElementById("solSunDisc");
  if (!disc) return;
  for (const child of [...disc.children]) {
    if (child.getAttribute("filter") === "url(#solSunSurf)") child.remove();
  }
}

function solProm(doc: Document, id: string): void {
  for (const drop of ["solSunBreathe", "solSunFlare", "solSunDisc"]) doc.getElementById(drop)?.remove();
  removeDirectCircles(doc.getElementById("solSun"));
  const proms = doc.getElementById("solSunProminences");
  if (proms) {
    for (const child of [...proms.children]) {
      if (!child.querySelector(`#${id}`)) child.remove();
    }
  }
  const node = doc.getElementById(id);
  if (!node) return;
  node.setAttribute("opacity", "1");
  node.setAttribute("transform", "scale(1)");
  node.querySelectorAll("animate, animateTransform").forEach((item) => item.remove());
}

function solFlare(doc: Document): void {
  for (const id of ["solSunBreathe", "solSunProminences", "solSunDisc"]) doc.getElementById(id)?.remove();
  removeDirectCircles(doc.getElementById("solSun"));
  const flare = doc.getElementById("solSunFlare");
  if (!flare) return;
  flare.setAttribute("opacity", "1");
  flare.querySelectorAll("animate").forEach((node) => node.remove());
}

function removeDirectCircles(star: Element | null): void {
  if (!star) return;
  for (const child of [...star.children]) {
    if (child.localName === "circle") child.remove();
  }
}

function rimStroke(root: Element | null): Element | undefined {
  if (!root) return undefined;
  return [...root.children].find((child) => child.localName === "circle" && child.hasAttribute("stroke"));
}

function stripMotion(node: Element | null): void {
  node?.querySelectorAll("animate, animateTransform").forEach((item) => item.remove());
}
