import type * as THREE from "three";
import type { Body } from "../../sim/physics";
import { createStarMaterial } from "./star-shader";
import { starKind } from "./star-params";

/**
 * Which shader family draws this body. Null keeps the SVG sprite.
 * Stars are R2.1. Later packages register here, and the sprite path stays
 * for everything still null (design/shader-specs.md §1).
 */
export type ShaderFamily = "star";

export function shaderFamily(body: Body): ShaderFamily | null {
  return starKind(body) ? "star" : null;
}

export function createBodyShader(body: Body): THREE.ShaderMaterial | null {
  const kind = starKind(body);
  return kind ? createStarMaterial(kind) : null;
}
