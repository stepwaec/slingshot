import * as THREE from "three";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * v1 star: one radial-gradient quad, the GPU stand-in for a cached sprite.
 * Swap this factory for a textured star plus bloom. Radii come from the theme
 * (star.svg's 46 / 130 / 200 in a 400-unit sprite).
 */
export const createStar: VisualFactory = (theme, level) => new StarVisual(theme, level);

const fragment = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uGlow;
uniform vec3 uCorona;
uniform vec3 uCore;
uniform vec3 uBody;
uniform vec3 uEdge;
uniform float uGlowR;
uniform float uCoronaR;
uniform float uBodyR;

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
    float ga = t < 0.23 ? mix(0.50, 0.45, t / 0.23)
      : t < 0.65 ? mix(0.45, 0.12, (t - 0.23) / 0.42)
      : mix(0.12, 0.0, (t - 0.65) / 0.35);
    over(col, a, uGlow, ga);
  }
  if (r < uCoronaR) {
    float t = r / uCoronaR;
    float ca = t < 0.35 ? mix(0.90, 0.70, t / 0.35)
      : t < 0.62 ? mix(0.70, 0.22, (t - 0.35) / 0.27)
      : mix(0.22, 0.0, (t - 0.62) / 0.38);
    over(col, a, uCorona, ca);
  }
  if (r < uBodyR) {
    float t = r / uBodyR;
    vec3 bc = t < 0.55 ? mix(uCore, uBody, t / 0.55) : mix(uBody, uEdge, (t - 0.55) / 0.45);
    over(col, a, bc, 1.0);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

class StarVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private bodyRadius = 46;
  private readonly theme: Theme;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "star";
    this.object.userData.asset = theme.assets.star;
    const body = level.bodies.find((item) => item.kind === "star");
    if (!body) return;
    this.bodyRadius = body.radius;
    const star = theme.star;
    const colors = theme.colors;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(star.span, star.span),
      shader(fragment, {
        uGlow: { value: srgbVec(colors.starGlow) },
        uCorona: { value: srgbVec(colors.starCorona) },
        uCore: { value: srgbVec(colors.starCore) },
        uBody: { value: srgbVec(colors.starBody) },
        uEdge: { value: srgbVec(colors.starCorona) },
        uGlowR: { value: star.glowRadius },
        uCoronaR: { value: star.coronaRadius },
        uBodyR: { value: star.bodyRadius },
      }),
    );
    this.mesh.position.set(body.x, body.y, 0);
    this.mesh.renderOrder = 0;
    this.mesh.name = "star-sprite";
    this.object.add(this.mesh);
  }

  update(frame: VisualFrame): void {
    if (!this.mesh) return;
    const star = this.theme.star;
    const breathe = 1 + star.breathe * Math.sin((frame.now / star.periodMs) * Math.PI * 2);
    this.mesh.scale.setScalar((this.bodyRadius / star.bodyRadius) * breathe);
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
