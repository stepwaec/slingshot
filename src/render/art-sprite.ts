import * as THREE from "three";
import type { Body, Nebula } from "../sim/physics";
import { zoomBucket } from "./ship-art";
import type { Theme } from "./theme";
import { solArt } from "./sol-art";
import { bakedSvgUrl, rasterSvg, type SvgBakeOptions } from "./svg-bake";

/**
 * Claude's files in design/assets, not a shader rewrite of them.
 * Each picture is the SVG rasterized in the browser (filters included),
 * stored as sRGB and clamped. Size is viewBox × DPR × zoom bucket, with a
 * mip chain so a zoomed-out body does not shimmer between buckets.
 * `svgRadius` is the crash radius in the SVG. The quad is the viewBox,
 * scaled so that radius matches the body.
 */
export interface ArtFit {
  url: string;
  viewW: number;
  viewH: number;
  svgRadius: number;
  /** Body centre relative to the view centre, in viewBox pixels, y up. */
  ox: number;
  oy: number;
  /** Lit direction baked into the SVG, in plane space. Null when the art is emissive. */
  light: { x: number; y: number } | null;
  /** How the sprite turns. `beam` and `neutron` keep a round body while the rays move. */
  spin: "none" | "light" | "tail" | "beam" | "neutron";
  /** For a cloud, `svgRadius` is the design rx and `svgRy` the design ry. */
  svgRy?: number;
  hide?: readonly string[];
  bake?: SvgBakeOptions;
}

export function artForBody(body: Body, theme: Theme): ArtFit | null {
  if (body.look === "voyager" || body.look === "arrokoth") {
    const art = solArt(body.look);
    const url = body.look === "voyager" ? theme.assets.solVoyager : theme.assets.solArrokoth;
    return fit(url, art.viewW, art.viewH, art.svgRadius, "none", null);
  }
  const assets = theme.assets;
  if (body.kind === "rogue") {
    return { ...fit(assets.rogue, 260, 200, 36, "none", null), ox: 100 - 130, oy: 0, hide: ["rpDrift"] };
  }
  if (body.look === "comet") {
    return {
      ...fit(assets.comet, 520, 240, 5, "tail", null),
      ox: 60 - 260,
      oy: 120 - 100,
      hide: ["cmHarvest"],
    };
  }
  if (body.look === "tau-hot") return tauPlanet(assets.tauCeti, "tce", 12);
  if (body.look === "tau-cold") return tauPlanet(assets.tauCeti, "tcf", 15);
  if (body.look === "tau-green") return tauPlanet(assets.tauCeti, "tca", 18);
  if (body.look === "tau-ceti") return fit(assets.star, 400, 400, 46, "none", null);
  return null;
}

/** One Tau Ceti world, centred, with its strip frozen at the rest frame. `tau-ceti.svg`. */
function tauPlanet(url: string, prefix: "tce" | "tca" | "tcf", radius: number): ArtFit {
  const span = radius * 8;
  return {
    url,
    viewW: span,
    viewH: span,
    svgRadius: radius,
    ox: 0,
    oy: 0,
    light: null,
    spin: "none",
    bake: { tag: prefix, prep: isolateTauPlanet(prefix, radius) },
  };
}

function isolateTauPlanet(prefix: string, radius: number): (doc: Document) => void {
  return (doc) => {
    const root = doc.getElementById("tauCeti");
    if (!root) return;
    const keep = [...root.children].find((child) => child.innerHTML.includes(`#${prefix}Clip`));
    for (const child of [...root.children]) {
      if (child !== keep) child.remove();
    }
    keep?.removeAttribute("transform");
    root.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
    const span = radius * 8;
    const svg = doc.documentElement;
    svg.setAttribute("viewBox", `${-span / 2} ${-span / 2} ${span} ${span}`);
    svg.setAttribute("width", String(span));
    svg.setAttribute("height", String(span));
  };
}

/** `tau-ceti.svg` #tcTint: hue +9, then R ×1.02, G ×1.06, B ×0.98. */
export function applyTauTint(doc: Document): void {
  const svg = doc.documentElement;
  const id = "tcRuntimeTint";
  if (!doc.getElementById(id)) {
    const ns = "http://www.w3.org/2000/svg";
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = doc.createElementNS(ns, "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    const filter = doc.createElementNS(ns, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.innerHTML =
      '<feColorMatrix type="hueRotate" values="9"/><feComponentTransfer><feFuncR type="linear" slope="1.02"/><feFuncG type="linear" slope="1.06"/><feFuncB type="linear" slope="0.98"/></feComponentTransfer>';
    defs.appendChild(filter);
  }
  const star = doc.getElementById("star") ?? svg;
  const prior = star.getAttribute("filter");
  star.setAttribute("filter", prior ? `${prior} url(#${id})` : `url(#${id})`);
}

export function artForNebula(cloud: Nebula, theme: Theme): ArtFit {
  if (cloud.look === "dark") {
    return { ...fit(theme.assets.nebulaDark, 480, 320, 150, "none", null), svgRy: 150 };
  }
  if (cloud.look === "reflection") {
    return { ...fit(theme.assets.nebulaReflection, 640, 400, 190, "none", null), svgRy: 190 };
  }
  return { ...fit(theme.assets.nebulaEmission, 640, 400, 250, "none", null), svgRy: 150 };
}

function fit(
  url: string,
  viewW: number,
  viewH: number,
  svgRadius: number,
  spin: ArtFit["spin"],
  light: ArtFit["light"],
): ArtFit {
  return { url, viewW, viewH, svgRadius, ox: 0, oy: 0, light, spin };
}

/** Longest side, in pixels. A zoomed-in sun is several full-viewBox layers. */
const RASTER_CAP = 2048;

/**
 * viewBox × DPR × zoom bucket (`IMPLEMENTING.md` §3). The 2048 cap is the
 * only departure: past that, a 2× display at high zoom would bake multi-
 * megapixel copies of every sun layer. Both axes share that scale, so a
 * wide surface strip is not stretched when the short side would have been
 * clamped on its own.
 */
export function rasterPixels(viewW: number, viewH: number, dpr = 1, zoom = 1): { width: number; height: number } {
  const bucket = zoomBucket(zoom);
  const raw = Math.min(2, Math.max(1, dpr)) * bucket;
  const longest = Math.max(viewW, viewH) * raw;
  const scale = longest > RASTER_CAP ? raw * (RASTER_CAP / longest) : raw;
  return {
    width: Math.max(1, Math.round(viewW * scale)),
    height: Math.max(1, Math.round(viewH * scale)),
  };
}

/** sRGB, clamped. Mipmaps only when the zoom bucket is below 1. */
export async function loadArtTexture(
  fit: ArtFit,
  pixels = rasterPixels(fit.viewW, fit.viewH),
  zoom = 1,
): Promise<THREE.CanvasTexture> {
  const blob = await bakedSvgUrl(fit.url, fit.hide ?? [], fit.bake);
  const canvas = await rasterSvg(blob, pixels.width, pixels.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  // The bake is already viewBox × DPR × zoom bucket. A mip chain on top of
  // that smears the terminator and the 1px rim. Zoomed-out buckets still
  // mip, so a body smaller than its bucket does not shimmer.
  const zoomedOut = zoom < 1;
  texture.generateMipmaps = zoomedOut;
  texture.minFilter = zoomedOut ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function artMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function artMesh(fit: ArtFit, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(fit.viewW, fit.viewH), artMaterial());
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  mesh.userData.asset = fit.url;
  return mesh;
}

/**
 * Put the SVG's body centre on (x, y). `radius` is the sim crash radius, or rx for a cloud.
 * `along` and `across` multiply that scale after the rotation's local axes: +x is along
 * for a comet tail, +y is along for a pulsar beam baked upward.
 */
export function poseArt(
  mesh: THREE.Mesh,
  fit: ArtFit,
  x: number,
  y: number,
  radius: number,
  rot: number,
  ry?: number,
  along = 1,
  across = 1,
): void {
  const base = radius / fit.svgRadius;
  const sx = base * (fit.spin === "beam" ? across : along);
  const sy = (ry !== undefined && fit.svgRy ? ry / fit.svgRy : base) * (fit.spin === "beam" ? along : across);
  mesh.scale.set(sx, sy, 1);
  mesh.rotation.z = rot;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = fit.ox * sx;
  const ly = fit.oy * sy;
  mesh.position.set(x - (c * lx - s * ly), y - (s * lx + c * ly), 0);
}
