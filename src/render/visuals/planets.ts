import * as THREE from "three";
import type { Game } from "../../game/state";
import { bodyPose, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * v1 planets: one lit disc each, plus Planet X's halo and capture ring.
 * A black hole is a dark disc with a photon ring. Its radius is the horizon.
 * Swap this factory for textured meshes. Keep them in world space and light
 * them from the star's position so a later material can use the same vector.
 */
export const createPlanets: VisualFactory = (theme, level) => new PlanetsVisual(theme, level);

const planetFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec2 uLight;
uniform vec3 uHighlight;
uniform vec3 uBase;
uniform vec3 uShadow;
uniform float uRadiusPx;
uniform float uLimbAlpha;
uniform float uLightOffset;
uniform float uGradRadius;
uniform vec2 uLight2;
uniform float uWeight2;
uniform float uBands;

void main() {
  float d = length(vLocal);
  float fw = fwidth(d);
  float inside = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, d);
  if (inside <= 0.0) discard;
  vec2 center = uLight * uLightOffset;
  float gr = clamp(length(vLocal - center) / uGradRadius, 0.0, 1.0);
  vec3 col = gr < 0.42 ? mix(uHighlight, uBase, gr / 0.42) : mix(uBase, uShadow, (gr - 0.42) / 0.58);
  if (uWeight2 > 0.001) {
    vec2 center2 = uLight2 * uLightOffset;
    float gr2 = clamp(length(vLocal - center2) / uGradRadius, 0.0, 1.0);
    vec3 lit2 = gr2 < 0.42 ? mix(uHighlight, uBase, gr2 / 0.42) : mix(uBase, uShadow, (gr2 - 0.42) / 0.58);
    col = mix(col, lit2, clamp(uWeight2, 0.0, 1.0) * 0.55);
  }
  if (uBands > 0.5) {
    float stripe = sin(vLocal.y * 16.0);
    col *= 0.78 + 0.22 * stripe;
  }
  float limbCenter = 1.0 - 0.5 / max(uRadiusPx, 1.0);
  float limbHalf = 0.5 / max(uRadiusPx, 1.0);
  float limb = 1.0 - smoothstep(limbHalf, limbHalf + fw, abs(d - limbCenter));
  col = mix(col, uHighlight, limb * uLimbAlpha);
  gl_FragColor = vec4(col, inside);
}
`;

const haloFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
void main() {
  float t = length(vLocal);
  if (t >= 1.0) discard;
  float alpha = t < 0.5556 ? 0.35
    : t < 0.78 ? mix(0.35, 0.10, (t - 0.5556) / (0.78 - 0.5556))
    : mix(0.10, 0.0, (t - 0.78) / 0.22);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const ringFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uQuad;
uniform float uRingWorld;
uniform float uZoom;
uniform float uAlpha;
uniform float uDash;
uniform float uPulsePx;
uniform float uPeriod;
void main() {
  float distPx = length(vLocal) * uQuad * uZoom;
  float ringPx = uRingWorld * uZoom + uPulsePx;
  float fw = fwidth(distPx);
  float band = 1.0 - smoothstep(0.75, 0.75 + fw, abs(distPx - ringPx));
  if (band <= 0.0) discard;
  float arc = atan(vLocal.y, vLocal.x) * ringPx;
  float u = fract((arc - uDash) / uPeriod);
  if (u > 0.5) discard;
  gl_FragColor = vec4(uColor, uAlpha * band);
}
`;

const holeFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uRing;
uniform float uHorizon;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float hole = 1.0 - smoothstep(uHorizon - fw, uHorizon + fw, r);
  float ringR = uHorizon * 1.22;
  float ring = 1.0 - smoothstep(0.012, 0.012 + fw * 2.0, abs(r - ringR));
  if (hole <= 0.0 && ring <= 0.0) discard;
  vec3 col = mix(vec3(0.01, 0.012, 0.02), uRing, ring);
  float alpha = max(hole, ring * 0.85);
  gl_FragColor = vec4(col, alpha);
}
`;

interface HoleView {
  body: Body;
  mesh: THREE.Mesh;
}

interface PlanetView {
  body: Body;
  mesh: THREE.Mesh;
  halo: THREE.Mesh | null;
  radiusPx: THREE.IUniform;
  light: THREE.Vector2;
  light2: THREE.Vector2;
  weight2: THREE.IUniform;
}

interface RingView {
  body: Body;
  mesh: THREE.Mesh;
  uniforms: {
    uQuad: THREE.IUniform;
    uAlpha: THREE.IUniform;
    uDash: THREE.IUniform;
    uPulsePx: THREE.IUniform;
  };
}

class PlanetsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly planets: PlanetView[] = [];
  private readonly holes: HoleView[] = [];
  private readonly rings: RingView[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "planets";
    const star = brightestStar(level.bodies);
    let order = 1;
    for (const body of level.bodies) {
      if (body.kind === "star") continue;
      if (body.kind === "blackhole") {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(holeFrag, {
            uRing: { value: srgbVec(theme.colors.starCorona) },
            uHorizon: { value: 1 / 2.4 },
          }),
        );
        const span = body.radius * 2.4;
        mesh.position.set(body.x, body.y, 0);
        mesh.scale.set(span, span, 1);
        mesh.renderOrder = order++;
        mesh.name = body.id;
        this.object.add(mesh);
        this.holes.push({ body, mesh });
        continue;
      }
      const target = body.kind === "target";
      const paint = planetPaint(body, theme);
      this.object.userData.asset = paint.asset;
      let halo: THREE.Mesh | null = null;
      if (target) {
        halo = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(haloFrag, { uColor: { value: srgbVec(theme.colors.planetXBase) } }),
        );
        halo.position.set(body.x, body.y, 0);
        halo.scale.set(body.radius * theme.planet.haloScale, body.radius * theme.planet.haloScale, 1);
        halo.renderOrder = order++;
        halo.name = `${body.id}-halo`;
        this.object.add(halo);
      }
      const radiusPx = { value: body.radius };
      const light = lightDir(body, star);
      const light2 = new THREE.Vector2(1, 0);
      const weight2 = { value: 0 };
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(planetFrag, {
          uLight: { value: light },
          uLight2: { value: light2 },
          uWeight2: weight2,
          uBands: { value: paint.bands ? 1 : 0 },
          uHighlight: { value: srgbVec(paint.highlight) },
          uBase: { value: srgbVec(paint.base) },
          uShadow: { value: srgbVec(paint.shadow) },
          uRadiusPx: radiusPx,
          uLimbAlpha: { value: target ? theme.planet.limbAlphaTarget : theme.planet.limbAlphaHome },
          uLightOffset: { value: theme.planet.lightOffset },
          uGradRadius: { value: theme.planet.gradientRadius },
        }),
      );
      mesh.position.set(body.x, body.y, 0);
      mesh.scale.set(body.radius, body.radius, 1);
      mesh.renderOrder = order++;
      mesh.name = body.id;
      this.object.add(mesh);
      this.planets.push({ body, mesh, halo, radiusPx, light, light2, weight2 });

      if (body.captureRadius !== undefined) {
        const uniforms = {
          uColor: { value: srgbVec(theme.colors.planetXBase) },
          uQuad: { value: body.captureRadius },
          uRingWorld: { value: body.captureRadius },
          uZoom: { value: 1 },
          uAlpha: { value: theme.planet.ringAlphaMin },
          uDash: { value: 0 },
          uPulsePx: { value: 0 },
          uPeriod: { value: theme.planet.ringDashPeriodPx },
        };
        const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shader(ringFrag, uniforms));
        ring.position.set(body.x, body.y, 0);
        ring.renderOrder = order++;
        ring.name = `${body.id}-ring`;
        this.object.add(ring);
        this.rings.push({
          body,
          mesh: ring,
          uniforms: {
            uQuad: uniforms.uQuad,
            uAlpha: uniforms.uAlpha,
            uDash: uniforms.uDash,
            uPulsePx: uniforms.uPulsePx,
          },
        });
      }
    }
  }

  update(frame: VisualFrame): void {
    const zoom = frame.game.camera.zoom;
    const spec = this.theme.planet;
    const time = simTime(frame.game);
    const bodies = frame.game.level.bodies;
    for (const hole of this.holes) {
      const pose = bodyPose(hole.body, time, bodies);
      hole.mesh.position.set(pose.x, pose.y, 0);
    }
    for (const planet of this.planets) {
      planet.radiusPx.value = planet.body.radius * zoom;
      const pose = bodyPose(planet.body, time, bodies);
      planet.mesh.position.set(pose.x, pose.y, 0);
      if (planet.halo) planet.halo.position.set(pose.x, pose.y, 0);
      const lights = starLights(pose.x, pose.y, bodies, time);
      if (lights.primary) planet.light.copy(lights.primary);
      if (lights.secondary) {
        planet.light2.copy(lights.secondary);
        planet.weight2.value = lights.weight2;
      } else planet.weight2.value = 0;
    }
    const pulse = Math.sin((frame.now / spec.ringPulseMs) * Math.PI * 2) * 0.5 + 0.5;
    const locked = frame.game.mode === "finished" && frame.game.ship.status === "won";
    for (const ring of this.rings) {
      const pose = bodyPose(ring.body, time, bodies);
      ring.mesh.position.set(pose.x, pose.y, 0);
      const capture = ring.body.captureRadius ?? ring.body.radius;
      const pad = (8 + 4) / Math.max(zoom, 0.18);
      const reach = capture + pad;
      ring.mesh.scale.set(reach, reach, 1);
      ring.uniforms.uQuad.value = reach;
      const material = ring.mesh.material as THREE.ShaderMaterial;
      material.uniforms.uZoom.value = zoom;
      material.uniforms.uRingWorld.value = capture;
      if (locked) {
        ring.uniforms.uAlpha.value = spec.ringLockedAlpha;
        ring.uniforms.uDash.value = 0;
        ring.uniforms.uPulsePx.value = 0;
      } else {
        ring.uniforms.uAlpha.value = spec.ringAlphaMin + pulse * (spec.ringAlphaMax - spec.ringAlphaMin);
        ring.uniforms.uDash.value = -((frame.now / 1000) * spec.ringCrawlPxPerSec);
        ring.uniforms.uPulsePx.value = (pulse * 2 - 1) * spec.ringPulsePx;
      }
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function simTime(game: Game): number {
  const step = game.mode === "planning" ? 0 : game.ship.step;
  return step * game.level.dt;
}

function brightestStar(bodies: readonly Body[]): Body | undefined {
  let best: Body | undefined;
  let bestMass = -1;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star" || body.mass <= bestMass) continue;
    best = body;
    bestMass = body.mass;
  }
  return best;
}

function lightDir(body: Body, star: Body | undefined): THREE.Vector2 {
  if (!star) return new THREE.Vector2(1, 0);
  const dx = star.x - body.x;
  const dy = star.y - body.y;
  const d = Math.hypot(dx, dy) || 1;
  return new THREE.Vector2(dx / d, dy / d);
}

/** Up to two star directions, weighted by mass / distance². One star leaves the second weight at 0. */
function starLights(
  x: number,
  y: number,
  bodies: readonly Body[],
  time: number,
): { primary: THREE.Vector2 | null; secondary: THREE.Vector2 | null; weight2: number } {
  let firstW = 0;
  let secondW = 0;
  let primary: THREE.Vector2 | null = null;
  let secondary: THREE.Vector2 | null = null;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star") continue;
    const pose = bodyPose(body, time, bodies);
    const dx = pose.x - x;
    const dy = pose.y - y;
    const r2 = dx * dx + dy * dy;
    if (!(r2 > 1e-8)) continue;
    const weight = body.mass / r2;
    const dir = new THREE.Vector2(dx / Math.sqrt(r2), dy / Math.sqrt(r2));
    if (weight > firstW) {
      secondW = firstW;
      secondary = primary;
      firstW = weight;
      primary = dir;
    } else if (weight > secondW) {
      secondW = weight;
      secondary = dir;
    }
  }
  return { primary, secondary, weight2: firstW > 0 ? secondW / firstW : 0 };
}

function planetPaint(body: Body, theme: Theme): { highlight: string; base: string; shadow: string; bands: boolean; asset: string } {
  const colors = theme.colors;
  if (body.kind === "target") {
    return {
      highlight: colors.planetXHighlight,
      base: colors.planetXBase,
      shadow: colors.planetXShadow,
      bands: false,
      asset: theme.assets.planetX,
    };
  }
  if (body.look === "gas-giant") {
    return { highlight: "#FFF3DE", base: "#EBA75E", shadow: "#7C3C1E", bands: true, asset: theme.assets.gasGiant };
  }
  if (body.look === "moon-icy") {
    return { highlight: "#FFFFFF", base: "#DCE4FF", shadow: "#4E78A8", bands: false, asset: theme.assets.moonChain };
  }
  if (body.look === "moon-volcanic") {
    return { highlight: "#F6EBA8", base: "#E0892E", shadow: "#8C6A2A", bands: false, asset: theme.assets.moonChain };
  }
  if (body.look === "dwarf") {
    return { highlight: "#FFF6E6", base: "#CDA273", shadow: "#6A402A", bands: false, asset: theme.assets.moonChain };
  }
  if (body.look === "moon") {
    return { highlight: "#F4F2FC", base: "#A6A2B6", shadow: "#4B4866", bands: false, asset: theme.assets.moonChain };
  }
  return {
    highlight: colors.planetStartHighlight,
    base: colors.planetStartBase,
    shadow: colors.planetStartShadow,
    bands: false,
    asset: theme.assets.planetStart,
  };
}
