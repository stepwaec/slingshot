import type * as THREE from "three";
import type { Body } from "../../sim/physics";
import { giantKey } from "./giant-params";
import { createGiantMaterial } from "./giant-shader";
import { planetKey } from "./planet-params";
import { createPlanetMaterial } from "./planet-shader";
import { starKind } from "./star-params";
import { createStarMaterial } from "./star-shader";

/**
 * Which shader family draws this body. Null keeps the SVG sprite.
 * Stars are R2.1. Rocky planets and moons are R2.2. Gas giants and
 * rings are R2.3. The sprite path stays for everything still null
 * (design/shader-specs.md §1).
 */
export type ShaderFamily = "star" | "planet" | "giant";

export function shaderFamily(body: Body): ShaderFamily | null {
  if (starKind(body)) return "star";
  if (planetKey(body)) return "planet";
  if (giantKey(body)) return "giant";
  return null;
}

export function createBodyShader(body: Body): THREE.ShaderMaterial | null {
  const star = starKind(body);
  if (star) return createStarMaterial(star);
  const planet = planetKey(body);
  if (planet) return createPlanetMaterial(planet);
  const giant = giantKey(body);
  return giant ? createGiantMaterial(giant) : null;
}
