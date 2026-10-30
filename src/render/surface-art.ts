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
  /** SMIL translate x at the rest frame. The strip then moves by `distance`. */
  fromX?: number;
  /** SVG `rotate` on the strip, in degrees. The mesh uses the opposite sign so world +y stays up. */
  rollDeg?: number;
  /** Scroll under a night-side mask that follows the live star, instead of a baked day texture. */
  night?: boolean;
}

export type SurfaceKind = "ocean" | "planetx" | "giant" | "moon" | "moon-icy" | "moon-volcanic" | "dwarf";

export function surfaceKind(body: Body): SurfaceKind | null {
  if (body.kind === "home") return "ocean";
  if (body.kind === "target") return "planetx";
  if (body.look === "gas-giant") return "giant";
  if (body.look === "moon-icy") return "moon-icy";
  if (body.look === "moon-volcanic") return "moon-volcanic";
  if (body.look === "dwarf") return "dwarf";
  if (body.look === "moon" || body.kind === "moon") return "moon";
  return null;
}

export function stripsFor(kind: SurfaceKind): StripSpec[] {
  if (kind === "ocean") return OCEAN;
  if (kind === "planetx") return PLANET_X;
  if (kind === "giant") return GIANT;
  if (kind === "moon") return MOON;
  if (kind === "moon-icy") return MOON_ICY;
  if (kind === "moon-volcanic") return MOON_VOLCANIC;
  return DWARF;
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

/** Barren moon: one regolith strip, 88 px / 180 s. design/assets/bodies/moon.svg. */
const MOON: StripSpec[] = [named("mnSurfaceAnim", "mn-surface", 176, 28, 0, 0, -132, -14, 14, 180, 88, 1, 2)];

/** Icy moon: one stitched strip, 75 px / 150 s. design/assets/bodies/moon-icy.svg. */
const MOON_ICY: StripSpec[] = [named("miSurfaceAnim", "mi-surface", 150, 24, 0, 0, -107, -12, 12, 150, 75, 1, 2)];

/** Volcanic moon: surface and the hot-spot deck share the 82 px / 120 s scroll. */
const MOON_VOLCANIC: StripSpec[] = [
  named("mvSurfaceAnim", "mv-surface", 164, 26, 0, 0, -119, -13, 13, 120, 82, 1, 2),
  named("mvHotAnim", "mv-hot", 164, 26, 0, 0, -119, -13, 13, 120, 82, 0.75, 3),
];

/** Dwarf planet: 63 px / 160 s. design/assets/bodies/dwarf.svg. */
const DWARF: StripSpec[] = [named("dwSurfaceAnim", "dw-surface", 126, 20, 0, 0, -93, -10, 10, 160, 63, 1, 2)];

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

/**
 * True for a circle that is the capture zone baked into planet-x.svg.
 * That zone is drawn live from `captureRadius` (see `target-zone.ts`).
 * A dashed stroke, the `#pxZone` fill, or a bare stroked ring all count,
 * so a leftover dotted outline cannot survive the light-layer bake.
 */
export function isBakedCaptureZone(attrs: {
  fill?: string | null;
  stroke?: string | null;
  dash?: string | null;
}): boolean {
  const fill = attrs.fill ?? "";
  if (fill.includes("pxZone")) return true;
  if (attrs.dash) return true;
  const bare = fill === "" || fill === "none";
  return Boolean(attrs.stroke) && bare;
}

/** Shade, haze, rim and glint. Strips, the flat base, the halo and the target zone go. */
export function keepLight(doc: Document, rootId: string): void {
  const root = doc.getElementById(rootId);
  if (!root) return;
  root.querySelector("[clip-path]")?.remove();
  for (const child of [...root.querySelectorAll("circle")]) {
    if (
      isBakedCaptureZone({
        fill: child.getAttribute("fill"),
        stroke: child.getAttribute("stroke"),
        dash: child.getAttribute("stroke-dasharray"),
      })
    ) {
      child.remove();
    }
  }
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
