import * as THREE from "three";
import type { Game } from "../../game/state";
import { bodyPose, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * v1 planets: one lit disc each, plus Planet X's halo and capture ring.
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

void main() {
  float d = length(vLocal);
  float fw = fwidth(d);
  float inside = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, d);
  if (inside <= 0.0) discard;
  vec2 center = uLight * uLightOffset;
  float gr = clamp(length(vLocal - center) / uGradRadius, 0.0, 1.0);
  vec3 col = gr < 0.42 ? mix(uHighlight, uBase, gr / 0.42) : mix(uBase, uShadow, (gr - 0.42) / 0.58);
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

interface PlanetView {
  body: Body;
  mesh: THREE.Mesh;
  halo: THREE.Mesh | null;
  radiusPx: THREE.IUniform;
  light: THREE.Vector2;
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
  private readonly rings: RingView[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "planets";
    const star = level.bodies.find((body) => body.kind === "star");
    let order = 1;
    for (const body of level.bodies) {
      if (body.kind === "star") continue;
      const target = body.kind === "target";
      this.object.userData.asset = target ? theme.assets.planetX : theme.assets.planetStart;
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
      const colors = theme.colors;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(planetFrag, {
          uLight: { value: light },
          uHighlight: { value: srgbVec(target ? colors.planetXHighlight : colors.planetStartHighlight) },
          uBase: { value: srgbVec(target ? colors.planetXBase : colors.planetStartBase) },
          uShadow: { value: srgbVec(target ? colors.planetXShadow : colors.planetStartShadow) },
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
      this.planets.push({ body, mesh, halo, radiusPx, light });

      if (body.captureRadius !== undefined) {
        const uniforms = {
          uColor: { value: srgbVec(colors.planetXBase) },
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
    const star = bodies.find((body) => body.kind === "star");
    const starPose = star ? bodyPose(star, time, bodies) : null;
    for (const planet of this.planets) {
      planet.radiusPx.value = planet.body.radius * zoom;
      const pose = bodyPose(planet.body, time, bodies);
      planet.mesh.position.set(pose.x, pose.y, 0);
      if (planet.halo) planet.halo.position.set(pose.x, pose.y, 0);
      if (starPose) {
        const dx = starPose.x - pose.x;
        const dy = starPose.y - pose.y;
        const d = Math.hypot(dx, dy) || 1;
        planet.light.set(dx / d, dy / d);
      }
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

function lightDir(body: Body, star: Body | undefined): THREE.Vector2 {
  if (!star) return new THREE.Vector2(1, 0);
  const dx = star.x - body.x;
  const dy = star.y - body.y;
  const d = Math.hypot(dx, dy) || 1;
  return new THREE.Vector2(dx / d, dy / d);
}
