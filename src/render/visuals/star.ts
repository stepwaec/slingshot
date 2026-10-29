import * as THREE from "three";
import { bodyPose, type Body, type BodyLook } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * One quad per star. Passage's sun keeps the original radial gradient.
 * Binary stars are a hot primary and a cool secondary. A white dwarf is a
 * small disc, a wide glow and four spikes. A red giant is the same disc in
 * deep red, with the drag atmosphere drawn behind it when the body sets one.
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
uniform float uSpikes;

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
  if (uSpikes > 0.5 && r < uGlowR) {
    float ang = abs(atan(vLocal.y, vLocal.x));
    float arm = min(min(ang, abs(ang - 1.5707963)), abs(ang - 3.14159265));
    float spike = (1.0 - smoothstep(0.015, 0.09, arm)) * (1.0 - smoothstep(uBodyR, uGlowR, r));
    over(col, a, uCore, spike * 0.9);
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

const atmosphereFragment = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uDisc;
void main() {
  float r = length(vLocal);
  if (r >= 1.0 || r < uDisc) discard;
  float t = (r - uDisc) / (1.0 - uDisc);
  float alpha = t < 0.35 ? mix(0.30, 0.16, t / 0.35)
    : t < 0.7 ? mix(0.16, 0.08, (t - 0.35) / 0.35)
    : mix(0.08, 0.0, (t - 0.7) / 0.3);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const atmosphereRingFragment = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uDash;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float band = 1.0 - smoothstep(0.012, 0.012 + fw, abs(r - 0.98));
  if (band <= 0.0) discard;
  float arc = atan(vLocal.y, vLocal.x) * 40.0;
  if (fract((arc - uDash) / 1.6) > 0.55) discard;
  gl_FragColor = vec4(uColor, 0.45 * band);
}
`;

interface StarRecipe {
  glow: string;
  corona: string;
  core: string;
  body: string;
  edge: string;
  glowR: number;
  coronaR: number;
  bodyR: number;
  spikes: number;
  asset: string;
}

interface StarView {
  body: Body;
  mesh: THREE.Mesh;
  bodyR: number;
  atmosphere: THREE.Mesh | null;
  ring: THREE.Mesh | null;
}

function recipeFor(look: BodyLook | undefined, theme: Theme): StarRecipe {
  const colors = theme.colors;
  const star = theme.star;
  const sun: StarRecipe = {
    glow: colors.starGlow,
    corona: colors.starCorona,
    core: colors.starCore,
    body: colors.starBody,
    edge: colors.starCorona,
    glowR: star.glowRadius,
    coronaR: star.coronaRadius,
    bodyR: star.bodyRadius,
    spikes: 0,
    asset: theme.assets.star,
  };
  if (look === "binary-hot") {
    return { ...sun, glow: "#FF9A2A", corona: "#FFC24A", core: "#FFF6D8", body: "#FFE7A0", edge: "#FF9A2A", asset: theme.assets.binaryStar };
  }
  if (look === "binary-cool") {
    return { ...sun, glow: "#E85A1A", corona: "#FF7426", core: "#FFD0A8", body: "#FF9A3A", edge: "#E85A1A", asset: theme.assets.binaryStar };
  }
  if (look === "white-dwarf") {
    return {
      glow: "#7FB8FF",
      corona: "#B8CCFF",
      core: "#FFFFFF",
      body: "#E9EEF8",
      edge: "#FFFFFF",
      glowR: 170,
      coronaR: 96,
      bodyR: 28,
      spikes: 1,
      asset: theme.assets.whiteDwarf,
    };
  }
  if (look === "red-giant") {
    return {
      glow: "#C8401E",
      corona: "#F0602C",
      core: "#FFD7B0",
      body: "#FF8A42",
      edge: "#C8401E",
      glowR: 175,
      coronaR: 120,
      bodyR: 78,
      spikes: 0,
      asset: theme.assets.redGiant,
    };
  }
  return sun;
}

class StarVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly stars: StarView[] = [];
  private readonly theme: Theme;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "star";
    let order = 0;
    for (const body of level.bodies) {
      if (body.kind !== "star") continue;
      const look = recipeFor(body.look, theme);
      const atmo = body.atmosphereRadius;
      let atmosphere: THREE.Mesh | null = null;
      let ring: THREE.Mesh | null = null;
      if (atmo !== undefined && atmo > body.radius) {
        atmosphere = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(atmosphereFragment, {
            uColor: { value: srgbVec("#FF8A4A") },
            uDisc: { value: body.radius / atmo },
          }),
        );
        atmosphere.scale.set(atmo, atmo, 1);
        atmosphere.renderOrder = order++;
        atmosphere.name = `${body.id}-atmosphere`;
        this.object.add(atmosphere);
        ring = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(atmosphereRingFragment, {
            uColor: { value: srgbVec("#FFB07A") },
            uDash: { value: 0 },
          }),
        );
        ring.scale.set(atmo, atmo, 1);
        ring.renderOrder = order++;
        ring.name = `${body.id}-atmosphere-ring`;
        this.object.add(ring);
      }
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(theme.star.span, theme.star.span),
        shader(fragment, {
          uGlow: { value: srgbVec(look.glow) },
          uCorona: { value: srgbVec(look.corona) },
          uCore: { value: srgbVec(look.core) },
          uBody: { value: srgbVec(look.body) },
          uEdge: { value: srgbVec(look.edge) },
          uGlowR: { value: look.glowR },
          uCoronaR: { value: look.coronaR },
          uBodyR: { value: look.bodyR },
          uSpikes: { value: look.spikes },
        }),
      );
      mesh.position.set(body.x, body.y, 0);
      mesh.scale.setScalar(body.radius / look.bodyR);
      mesh.renderOrder = order++;
      mesh.name = body.id;
      mesh.userData.asset = look.asset;
      this.object.add(mesh);
      this.stars.push({ body, mesh, bodyR: look.bodyR, atmosphere, ring });
    }
  }

  update(frame: VisualFrame): void {
    if (this.stars.length === 0) return;
    const time = (frame.game.mode === "planning" ? 0 : frame.game.ship.step) * frame.game.level.dt;
    const bodies = frame.game.level.bodies;
    const star = this.theme.star;
    const breathe = 1 + star.breathe * Math.sin((frame.now / star.periodMs) * Math.PI * 2);
    const dash = -((frame.now / 1000) * 8);
    for (const view of this.stars) {
      const pose = bodyPose(view.body, time, bodies);
      view.mesh.position.set(pose.x, pose.y, 0);
      view.mesh.scale.setScalar((view.body.radius / view.bodyR) * breathe);
      if (view.atmosphere) view.atmosphere.position.set(pose.x, pose.y, 0);
      if (view.ring) {
        view.ring.position.set(pose.x, pose.y, 0);
        const material = view.ring.material as THREE.ShaderMaterial;
        material.uniforms.uDash.value = dash;
      }
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
