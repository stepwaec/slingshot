import type * as THREE from "three";
import type { Body } from "../../sim/physics";
import { planetKey } from "./planet-params";
import { createPlanetMaterial } from "./planet-shader";
import { starKind } from "./star-params";
import { createStarMaterial } from "./star-shader";

/**
 * Which shader family draws this body. Null keeps the SVG sprite.
 * Stars are R2.1. Rocky planets and moons are R2.2. The sprite path stays
 * for everything still null (design/shader-specs.md §1).
 */
export type ShaderFamily = "star" | "planet";

export function shaderFamily(body: Body): ShaderFamily | null {
  if (starKind(body)) return "star";
  if (planetKey(body)) return "planet";
  return null;
}

export function createBodyShader(body: Body): THREE.ShaderMaterial | null {
  const star = starKind(body);
  if (star) return createStarMaterial(star);
  const planet = planetKey(body);
  return planet ? createPlanetMaterial(planet) : null;
}
