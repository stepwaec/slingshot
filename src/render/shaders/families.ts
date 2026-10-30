import type * as THREE from "three";
import type { Body } from "../../sim/physics";
import { compactKey } from "./compact-params";
import { createCompactMaterial } from "./compact-shader";
import { giantKey } from "./giant-params";
import { createGiantMaterial } from "./giant-shader";
import { planetKey } from "./planet-params";
import { createPlanetMaterial } from "./planet-shader";
import { starKind } from "./star-params";
import { createStarMaterial } from "./star-shader";

/**
 * Which shader family draws this body. Null keeps the SVG sprite.
 * Stars are R2.1. Rocky planets and moons are R2.2. Gas giants and
 * rings are R2.3. Compact objects are R2.4. The white dwarf stays a
 * star. The sprite path stays for everything still null
 * (design/shader-specs.md §1).
 */
export type ShaderFamily = "star" | "planet" | "giant" | "compact";

export function shaderFamily(body: Body): ShaderFamily | null {
  if (starKind(body)) return "star";
  if (planetKey(body)) return "planet";
  if (giantKey(body)) return "giant";
  if (compactKey(body)) return "compact";
  return null;
}

export function createBodyShader(body: Body): THREE.ShaderMaterial | null {
  const star = starKind(body);
  if (star) return createStarMaterial(star);
  const planet = planetKey(body);
  if (planet) return createPlanetMaterial(planet);
  const giant = giantKey(body);
  if (giant) return createGiantMaterial(giant);
  const compact = compactKey(body);
  return compact ? createCompactMaterial(compact, body) : null;
}
