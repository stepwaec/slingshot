import * as THREE from "three";
import { beamAxis, bodyPose, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Quiet neutron stars, pulsars and magnetars, drawn from the WP9 SVGs.
 * Beams rotate with sim time, the same clock `beamDamageRate` uses.
 * Magnetar dashes, grain and the starquake ring are cosmetic.
 */
export const createCompact: VisualFactory = (theme, level) => new CompactVisual(theme, level);

const bodyFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uCore;
uniform vec3 uBody;
uniform vec3 uLimb;
uniform vec3 uGlow;
uniform float uBodyR;
uniform float uGlowR;
void over(inout vec3 dst, inout float da, vec3 src, float sa) {
  dst = src * sa + dst * (1.0 - sa);
  da = sa + da * (1.0 - sa);
}
void main() {
  float r = length(vLocal);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (r < uGlowR) {
    float t = r / uGlowR;
    float ga = t < 0.25 ? mix(0.55, 0.28, t / 0.25) : mix(0.28, 0.0, (t - 0.25) / 0.75);
    over(col, a, uGlow, ga);
  }
  if (r < uBodyR) {
    float t = r / uBodyR;
    vec3 bc = t < 0.5 ? mix(uCore, uBody, t / 0.5) : mix(uBody, uLimb, (t - 0.5) / 0.5);
    over(col, a, bc, 1.0);
    float limb = 1.0 - smoothstep(uBodyR * 0.86, uBodyR, r);
    over(col, a, uLimb, (1.0 - limb) * 0.85);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

const beamFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uCore;
uniform vec3 uBeam;
uniform vec3 uGlow;
uniform float uReach;
uniform float uBase;
uniform float uTip;
void over(inout vec3 dst, inout float da, vec3 src, float sa) {
  dst = src * sa + dst * (1.0 - sa);
  da = sa + da * (1.0 - sa);
}
void main() {
  float along = abs(vLocal.x);
  float perp = abs(vLocal.y);
  if (along > 1.0 || along < 0.02) discard;
  float full = (uBase + (uTip - uBase) * along) / uReach;
  float halfW = full * 0.5;
  float trail = vLocal.y * sign(vLocal.x);
  vec3 col = vec3(0.0);
  float a = 0.0;
  float fan = halfW * 4.5;
  if (trail > 0.0 && perp < fan) {
    float k = perp / fan;
    float fade = pow(1.0 - k, 1.6) * (1.0 - along);
    over(col, a, uBeam, 0.22 * fade);
  }
  if (perp < halfW) {
    float edge = 1.0 - smoothstep(halfW * 0.45, halfW, perp);
    float fade = 1.0 - along;
    over(col, a, uBeam, 0.55 * edge * fade);
    over(col, a, uCore, 0.85 * (1.0 - smoothstep(0.0, halfW * 0.25, perp)) * fade);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

const fieldFrag = /* glsl */ `
varying vec2 vLocal;
uniform float uTilt;
uniform float uNow;
uniform vec3 uInner;
uniform vec3 uOuter;
uniform vec3 uDash;
uniform vec3 uGrain;
void main() {
  vec2 p = vLocal * 150.0;
  float r = length(p);
  if (r > 148.0) discard;
  vec2 m = vec2(sin(uTilt), cos(uTilt));
  vec2 n = p / max(r, 0.001);
  float s = abs(n.x * m.y - n.y * m.x);
  float L = r / max(s * s, 0.0008);
  float line = 0.0;
  float band = 0.0;
  line = max(line, (1.0 - smoothstep(0.6, 2.2, abs(L - 20.0))) * (0.55 + 0.45 * sin(uNow * 1.2 + 20.0)));
  line = max(line, (1.0 - smoothstep(0.6, 2.2, abs(L - 30.0))) * (0.55 + 0.45 * sin(uNow * 1.5 + 30.0)));
  line = max(line, (1.0 - smoothstep(0.6, 2.2, abs(L - 44.0))) * (0.55 + 0.45 * sin(uNow * 1.8 + 44.0)));
  float outer = 0.0;
  outer = max(outer, (1.0 - smoothstep(0.6, 2.2, abs(L - 62.0))) * (0.55 + 0.45 * sin(uNow * 2.1 + 62.0)));
  outer = max(outer, (1.0 - smoothstep(0.6, 2.2, abs(L - 86.0))) * (0.55 + 0.45 * sin(uNow * 2.4 + 86.0)));
  outer = max(outer, (1.0 - smoothstep(0.6, 2.2, abs(L - 116.0))) * (0.55 + 0.45 * sin(uNow * 2.7 + 116.0)));
  line = max(line, outer);
  band = outer;
  vec3 col = mix(uInner, uOuter, band);
  float a = line * mix(0.75, 0.25, clamp((r - 20.0) / 100.0, 0.0, 1.0));
  float dash = step(fract(r / 18.0 - uNow * 0.45), 0.28);
  if (line > 0.2) {
    col = mix(col, uDash, dash);
    a = max(a, dash * line * 0.9);
  }
  if (r > 24.0 && r < 120.0) {
    float h = fract(sin(dot(floor(p * 0.35), vec2(127.1, 311.7))) * 43758.5453);
    if (h > 0.972) {
      col = uGrain;
      a = max(a, 0.26);
    }
  }
  float cycle = mod(uNow, 18.0);
  if (cycle < 1.2) {
    float quake = mix(9.0, 150.0, cycle / 1.2);
    float ring = 1.0 - smoothstep(1.2, 2.4, abs(r - quake));
    col = mix(col, uDash, ring);
    a = max(a, ring * (1.0 - cycle / 1.2));
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

interface CompactView {
  body: Body;
  glow: THREE.Mesh;
  beam: THREE.Mesh | null;
  field: THREE.Mesh | null;
  glowScale: number;
}

function paintFor(body: Body): { core: string; body: string; limb: string; glow: string; beam: string; asset: keyof Theme["assets"] } {
  if (body.look === "pulsar") {
    return { core: "#FFFFFF", body: "#DCF6FF", limb: "#A8ECFF", glow: "#4FC3F7", beam: "#7FDBFF", asset: "pulsar" };
  }
  if (body.look === "magnetar") {
    return { core: "#FFFFFF", body: "#FFE0FA", limb: "#FF7AE6", glow: "#D946EF", beam: "#FF7AE6", asset: "magnetar" };
  }
  return { core: "#FFFFFF", body: "#DCE4FF", limb: "#C9A8FF", glow: "#B48CFF", beam: "#C9A8FF", asset: "neutronStar" };
}

class CompactVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly views: CompactView[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "compact";
    let order = 4;
    for (const body of level.bodies) {
      if (body.look !== "neutron" && body.look !== "pulsar" && body.look !== "magnetar") continue;
      const paint = paintFor(body);
      const glowR = body.look === "pulsar" ? 36 : body.look === "magnetar" ? 48 : 40;
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(bodyFrag, {
          uCore: { value: srgbVec(paint.core) },
          uBody: { value: srgbVec(paint.body) },
          uLimb: { value: srgbVec(paint.limb) },
          uGlow: { value: srgbVec(paint.glow) },
          uBodyR: { value: body.radius / glowR },
          uGlowR: { value: 1 },
        }),
      );
      glow.scale.set(glowR, glowR, 1);
      glow.renderOrder = order++;
      glow.name = body.id;
      glow.userData.asset = theme.assets[paint.asset];
      this.object.add(glow);

      let beam: THREE.Mesh | null = null;
      const spec = body.beam;
      if (spec && spec.reach > body.radius) {
        beam = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(beamFrag, {
            uCore: { value: srgbVec(paint.core) },
            uBeam: { value: srgbVec(paint.beam) },
            uGlow: { value: srgbVec(paint.glow) },
            uReach: { value: spec.reach },
            uBase: { value: spec.base ?? (body.look === "neutron" ? 3 : 4) },
            uTip: { value: spec.tip ?? (body.look === "neutron" ? 8 : 18) },
          }),
        );
        beam.scale.set(spec.reach, spec.reach, 1);
        beam.renderOrder = order++;
        beam.name = `${body.id}-beam`;
        this.object.add(beam);
      }

      let field: THREE.Mesh | null = null;
      if (body.look === "magnetar") {
        field = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(fieldFrag, {
            uTilt: { value: body.magnet?.tilt ?? 0 },
            uNow: { value: 0 },
            uInner: { value: srgbVec("#FF7AE6") },
            uOuter: { value: srgbVec("#C77DFF") },
            uDash: { value: srgbVec("#FFFFFF") },
            uGrain: { value: srgbVec("#FF9BEF") },
          }),
        );
        field.scale.set(150, 150, 1);
        field.renderOrder = order++;
        field.name = `${body.id}-field`;
        field.userData.asset = theme.assets.magnetar;
        this.object.add(field);
      }

      this.views.push({ body, glow, beam, field, glowScale: glowR });
    }
  }

  update(frame: VisualFrame): void {
    if (this.views.length === 0) return;
    const time = (frame.game.mode === "planning" ? 0 : frame.game.ship.step) * frame.game.level.dt;
    const bodies = frame.game.level.bodies;
    const now = frame.now / 1000;
    for (const view of this.views) {
      const pose = bodyPose(view.body, time, bodies);
      view.glow.position.set(pose.x, pose.y, 0);
      view.glow.scale.set(view.glowScale, view.glowScale, 1);
      if (view.beam) {
        const axis = beamAxis(view.body, time);
        view.beam.position.set(pose.x, pose.y, 0);
        if (axis) view.beam.rotation.z = Math.atan2(axis.y, axis.x);
      }
      if (view.field) {
        view.field.position.set(pose.x, pose.y, 0);
        const material = view.field.material as THREE.ShaderMaterial;
        material.uniforms.uNow.value = now;
        material.uniforms.uTilt.value = view.body.magnet?.tilt ?? 0;
      }
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
