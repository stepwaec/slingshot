import type * as THREE from "three";
import type { Body } from "../../sim/physics";

/**
 * Which shader family draws this body. Null keeps the SVG sprite.
 * R2.1 registers stars. Later packages register here, and the sprite path
 * stays for everything still null (design/shader-specs.md §1).
 */
export type ShaderFamily = "star";

export function shaderFamily(_body: Body): ShaderFamily | null {
  return null;
}

export function createBodyShader(body: Body): THREE.ShaderMaterial | null {
  void body;
  return null;
}
