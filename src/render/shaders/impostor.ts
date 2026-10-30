import * as THREE from "three";
import { brightestOffset } from "../art-motion";
import { bodyPose, type Body } from "../../sim/physics";

/**
 * Rendering v2 conventions. design/shader-specs.md §1 and threejs-notes.md §25.
 * One impostor quad per body that has a shader family. Bodies without a
 * family still use their sprites. There is no sprite fallback for a family
 * that has a shader.
 */

/** Extra scale so a ±3 % breathe does not clip the haze. */
export const BREATHE_PAD = 1.06;

/** White-dwarf glow radius in body radii (star.frag). */
export const DWARF_GLOW_R = 6.25;

/** Below this on-screen radius, drop to 3 octaves and skip prominences and faculae. */
export const LOD_RADIUS_PX = 6;

/** Ring noise bakes down when the quad covers more than this fraction of the view. */
export const LOD_SCREEN_FRACTION = 0.25;

/** Frozen clock for side-by-side shots (`?t=13.9`). Otherwise `frame.now` in seconds. */
export function cosmeticSeconds(nowMs: number, search?: string): number {
  const query = search ?? (typeof location !== "undefined" ? location.search : "");
  const raw = new URLSearchParams(query).get("t");
  if (raw !== null && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return nowMs / 1000;
}

/** `?lit=art` holds the preview's light so a frozen shot matches the right-hand column. */
export function artLightLocked(search?: string): boolean {
  const query = search ?? (typeof location !== "undefined" ? location.search : "");
  return new URLSearchParams(query).get("lit") === "art";
}

/** Planet quad. `extent` is the fragment's outer radius. The pad keeps the rim off the edge. */
export function planetSide(radius: number, extent: number): number {
  return 2 * extent * Math.max(radius, 0) * BREATHE_PAD;
}

export function simSeconds(step: number, dt: number): number {
  return step * dt;
}

/**
 * Full quad side, in world units. A star's quad is `2 × hazeR × r`
 * (design/shader-specs.md §1), padded for the breathe. A white dwarf's glow
 * reaches 6.25 radii, which is wider than its haze.
 */
export function impostorSide(radius: number, hazeR: number, smooth = 0): number {
  const reach = Math.max(hazeR, smooth > 0.5 ? DWARF_GLOW_R : hazeR);
  return 2 * reach * Math.max(radius, 0) * BREATHE_PAD;
}

/** On-screen radius in CSS pixels. */
export function screenRadius(radius: number, zoom: number): number {
  return Math.max(radius, 0) * (zoom > 0 ? zoom : 1);
}

export function ringOctaves(sidePx: number, viewW: number, viewH: number, near: boolean): number {
  if (near) return 3;
  const area = sidePx * sidePx;
  const view = Math.max(1, viewW) * Math.max(1, viewH);
  return area / view > LOD_SCREEN_FRACTION ? 3 : 5;
}

/**
 * Unit vector from the body toward the brightest star. Stars are emissive
 * and ignore it; lit families (R2.2+) read `uLightDir`.
 */
export function lightDirection(
  x: number,
  y: number,
  time: number,
  bodies: readonly Body[],
  g: number,
): THREE.Vector2 {
  const samples = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star" && body.kind !== "blackhole") continue;
    const pose = bodyPose(body, time, bodies, g);
    samples.push({ x: pose.x, y: pose.y, mass: body.mass });
  }
  const aim = brightestOffset(samples, x, y);
  if (!aim) return new THREE.Vector2(1, 0);
  const len = Math.hypot(aim.x, aim.y);
  if (!(len > 1e-8)) return new THREE.Vector2(1, 0);
  return new THREE.Vector2(aim.x / len, aim.y / len);
}

const VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Premultiplied impostor. The fragment writes `rgb * a, a`. */
export function impostorMaterial(
  fragment: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    precision: "highp",
  });
  material.premultipliedAlpha = true;
  return material;
}
