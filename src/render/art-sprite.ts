import * as THREE from "three";
import type { Body, Nebula } from "../sim/physics";
import type { Theme } from "./theme";
import { bakedSvgUrl, rasterSvg, type SvgBakeOptions } from "./svg-bake";

/**
 * Claude's files in design/assets, not a shader rewrite of them.
 * Each picture is the SVG rasterized in the browser (filters included),
 * stored as sRGB, clamped, with no mipmaps so the art stays crisp.
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

const UP_RIGHT = { x: 1, y: 1 };
const DOWN_LEFT = { x: -1, y: -1 };

export function artForBody(body: Body, theme: Theme): ArtFit | null {
  const assets = theme.assets;
  if (body.kind === "blackhole") return fit(assets.blackHole, 320, 320, 22, "none", null);
  if (body.look === "comet") {
    return {
      ...fit(assets.comet, 520, 240, 5, "tail", null),
      ox: 60 - 260,
      oy: 120 - 100,
      hide: ["cmHarvest"],
    };
  }
  if (body.look === "gas-giant") return fit(assets.gasGiant, 160, 160, 44, "light", UP_RIGHT);
  if (body.look === "moon-icy") return fit(assets.moonIcy, 48, 48, 12, "light", UP_RIGHT);
  if (body.look === "moon-volcanic") return fit(assets.moonVolcanic, 48, 48, 13, "light", UP_RIGHT);
  if (body.look === "dwarf") return fit(assets.dwarf, 40, 40, 10, "light", UP_RIGHT);
  if (body.look === "moon" || body.kind === "moon") return fit(assets.moon, 60, 60, 14, "light", UP_RIGHT);
  if (body.kind === "target") return fit(assets.planetX, 240, 240, 30, "light", DOWN_LEFT);
  if (body.kind === "home") return fit(assets.planetStart, 120, 120, 34, "light", UP_RIGHT);
  if (body.look === "binary-hot") {
    return {
      ...fit(assets.binaryStar, 400, 400, 30, "none", null),
      bake: { tag: "hot", prep: keepBinary("bnPrimary") },
    };
  }
  if (body.look === "binary-cool") {
    return {
      ...fit(assets.binaryStar, 400, 400, 20, "none", null),
      bake: { tag: "cool", prep: keepBinary("bnSecondary") },
    };
  }
  if (body.look === "white-dwarf") return fit(assets.whiteDwarf, 240, 240, 16, "none", null);
  if (body.look === "red-giant") return fit(assets.redGiant, 600, 600, 120, "none", null);
  if (body.look === "pulsar") return fit(assets.pulsar, 480, 480, 8, "beam", null);
  if (body.look === "magnetar") return fit(assets.magnetar, 320, 320, 9, "none", null);
  if (body.look === "neutron") return fit(assets.neutronStar, 120, 120, 8, "neutron", null);
  if (body.kind === "star") return fit(assets.star, 400, 400, 46, "none", null);
  return null;
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

function keepBinary(which: "bnPrimary" | "bnSecondary"): (doc: Document) => void {
  return (doc) => {
    const root = doc.getElementById("binaryStar");
    if (!root) return;
    for (const child of [...root.children]) {
      if (child.id !== which) child.remove();
    }
    root.querySelectorAll("animateMotion").forEach((node) => node.remove());
  };
}

export function rasterPixels(viewW: number, viewH: number): { width: number; height: number } {
  const longest = Math.max(viewW, viewH);
  const scale = Math.min(2, 1024 / longest);
  return {
    width: Math.max(64, Math.round(viewW * scale)),
    height: Math.max(64, Math.round(viewH * scale)),
  };
}

/** sRGB, clamped, no mipmaps. The browser's SVG raster is the picture. */
export async function loadArtTexture(fit: ArtFit): Promise<THREE.CanvasTexture> {
  const blob = await bakedSvgUrl(fit.url, fit.hide ?? [], fit.bake);
  const size = rasterPixels(fit.viewW, fit.viewH);
  const canvas = await rasterSvg(blob, size.width, size.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
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

/** Put the SVG's body centre on (x, y). `radius` is the sim crash radius, or rx for a cloud. */
export function poseArt(mesh: THREE.Mesh, fit: ArtFit, x: number, y: number, radius: number, rot: number, ry?: number): void {
  const sx = radius / fit.svgRadius;
  const sy = ry !== undefined && fit.svgRy ? ry / fit.svgRy : sx;
  mesh.scale.set(sx, sy, 1);
  mesh.rotation.z = rot;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = fit.ox * sx;
  const ly = fit.oy * sy;
  mesh.position.set(x - (c * lx - s * ly), y - (s * lx + c * ly), 0);
}
