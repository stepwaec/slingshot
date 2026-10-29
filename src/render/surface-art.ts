import type { Body } from "../sim/physics";

/**
 * Scrolling strips from the planet headers. The light overlay is a separate
 * bake and is the only layer that turns toward the star.
 * Numbers are the SVG header's period, phase and drift.
 */

export interface StripSpec {
  id: string;
  viewW: number;
  viewH: number;
  originX: number;
  originY: number;
  /** Inner translate of the strip, SVG y down. */
  tx: number;
  ty: number;
  svgRadius: number;
  dur: number;
  /** Signed translate over one cycle, SVG px. */
  distance: number;
  opacity: number;
  order: number;
  prep: (doc: Document) => void;
}

export function surfaceKind(body: Body): "ocean" | "planetx" | "giant" | null {
  if (body.kind === "home") return "ocean";
  if (body.kind === "target") return "planetx";
  if (body.look === "gas-giant") return "giant";
  return null;
}

export function stripsFor(kind: "ocean" | "planetx" | "giant"): StripSpec[] {
  if (kind === "ocean") return OCEAN;
  if (kind === "planetx") return PLANET_X;
  return GIANT;
}

const OCEAN: StripSpec[] = [
  strip("ps-surface", 0, 428, 68, 0, 0, -292, -34, 34, 90, 214, 1, 2),
  strip("ps-shadow", 1, 428, 68, 0, 0, -248, -34, 34, 64, 214, 0.45, 3),
  strip("ps-clouds", 2, 428, 68, 0, 0, -248, -34, 34, 64, 214, 0.78, 4),
];

const PLANET_X: StripSpec[] = [
  named("pxSurfaceAnim", "px-surface", 376, 60, 0, 0, -258, -30, 30, 120, 188, 1, 2),
  named("pxWispShadowAnim", "px-wisp-shadow", 376, 60, 0, 0, -218, -30, 30, 80, 188, 0.32, 3),
  named("pxWispAnim", "px-wisps", 376, 60, 0, 0, -218, -30, 30, 80, 188, 0.7, 4),
];

const GIANT: StripSpec[] = [
  strip("gb-c", 0, 552, 104, 0, -8, -364, -44, 44, 180, 276, 1, 2),
  strip("gb-b", 1, 552, 104, 0, -8, -88, -44, 44, 110, -276, 1, 3),
  strip("gb-a", 2, 552, 104, 0, -8, -364, -44, 44, 150, 276, 1, 4),
];

function strip(
  id: string,
  index: number,
  viewW: number,
  viewH: number,
  originX: number,
  originY: number,
  tx: number,
  ty: number,
  svgRadius: number,
  dur: number,
  distance: number,
  opacity: number,
  order: number,
): StripSpec {
  return {
    id,
    viewW,
    viewH,
    originX,
    originY,
    tx,
    ty,
    svgRadius,
    dur,
    distance,
    opacity,
    order,
    prep: (doc) => liftIndexedStrip(doc, index, originX, originY, viewW, viewH),
  };
}

function named(
  animId: string,
  id: string,
  viewW: number,
  viewH: number,
  originX: number,
  originY: number,
  tx: number,
  ty: number,
  svgRadius: number,
  dur: number,
  distance: number,
  opacity: number,
  order: number,
): StripSpec {
  return {
    id,
    viewW,
    viewH,
    originX,
    originY,
    tx,
    ty,
    svgRadius,
    dur,
    distance,
    opacity,
    order,
    prep: (doc) => liftNamedStrip(doc, animId, originX, originY, viewW, viewH),
  };
}

function liftIndexedStrip(doc: Document, index: number, x: number, y: number, w: number, h: number): void {
  const clip = doc.querySelector("[clip-path]");
  const anim = clip?.children[index];
  if (!anim) return;
  lift(doc, anim, x, y, w, h);
}

function liftNamedStrip(doc: Document, id: string, x: number, y: number, w: number, h: number): void {
  const anim = doc.getElementById(id);
  if (!anim) return;
  lift(doc, anim, x, y, w, h);
}

function lift(doc: Document, anim: Element, x: number, y: number, w: number, h: number): void {
  const inner = [...anim.children].find((node) => node.localName.toLowerCase() !== "animatetransform");
  if (!inner) return;
  inner.removeAttribute("transform");
  const svg = doc.documentElement;
  svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  doc.getElementById("planetStart")?.remove();
  doc.getElementById("planetX")?.remove();
  doc.getElementById("gasBanded")?.remove();
  svg.append(inner);
}

/** Shade, haze, rim and glint. Strips, the flat base and gameplay rings go. */
export function keepLight(doc: Document, rootId: string): void {
  const root = doc.getElementById(rootId);
  if (!root) return;
  root.querySelector("[clip-path]")?.remove();
  for (const child of [...root.children]) {
    if (child.localName !== "circle") continue;
    const fill = child.getAttribute("fill") ?? "";
    if (fill.startsWith("#") || child.hasAttribute("stroke-dasharray") || child.getAttribute("r") === "54") {
      child.remove();
    }
  }
}

export function keepBase(doc: Document, rootId: string, fill: string): void {
  const root = doc.getElementById(rootId);
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.localName === "circle" && child.getAttribute("fill") === fill) continue;
    child.remove();
  }
}

export function keepHalo(doc: Document): void {
  const root = doc.getElementById("planetX");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.getAttribute("r") === "54") {
      child.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
      continue;
    }
    child.remove();
  }
}
