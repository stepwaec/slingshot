import type * as THREE from "three";
import type { Body } from "../../sim/physics";
import { planetKey } from "./planet-params";
import { createPlanetMaterial } from "./planet-shader";

/**
 * Which shader family draws this body. Null keeps the SVG sprite.
 * R2.2 registers rocky planets and moons. Stars stay null until R2.1
 * lands on main. The sprite path stays for everything still null
 * (design/shader-specs.md §1).
 */
export type ShaderFamily = "star" | "planet";

export function shaderFamily(body: Body): ShaderFamily | null {
  return planetKey(body) ? "planet" : null;
}

export function createBodyShader(body: Body): THREE.ShaderMaterial | null {
  const key = planetKey(body);
  return key ? createPlanetMaterial(key) : null;
}
