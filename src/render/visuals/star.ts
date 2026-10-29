import * as THREE from "three";
import { bodyPose, type Body, type BodyLook } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { artForBody } from "../art-sprite";
import { shader, srgbVec } from "./materials";

/**
 * One quad per star for looks that are still shaded here. The sun, binaries,
 * white dwarf and red giant are Claude's SVGs, drawn by the art gallery, so
 * this factory skips them. A red giant's drag atmosphere is in that SVG too.
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
uniform float uTime;
uniform sampler2D uPlasma;

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
  if (r < uBodyR * 1.08) {
    float ang = atan(vLocal.y, vLocal.x);
    // Irregular rim from the baked mask, not a repeating spoke pattern.
    float wob = texture2D(uPlasma, vec2(fract(ang / 6.2831853), 0.08)).r - 0.5;
    float limb = uBodyR * (1.0 + 0.1 * wob);
    if (r < limb) {
      float t = clamp(r / max(uBodyR, 1e-3), 0.0, 1.0);
      vec3 bc = t < 0.42 ? mix(uCore, uBody, t / 0.42) : mix(uBody, uEdge, (t - 0.42) / 0.58);
      float spin = uTime * 0.04;
      vec2 p = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * vLocal;
      vec2 uv = clamp(p / max(uBodyR, 1e-3) * 0.5 + 0.5, 0.0, 1.0);
      vec2 mask = texture2D(uPlasma, uv).rg;
      float cells = uSpikes > 0.5 ? mask.r * 0.15 : mask.r;
      bc = mix(bc, vec3(0.502, 0.129, 0.020), cells * 0.85);
      bc = mix(bc, uCore, clamp(mask.g, 0.0, 1.0));
      float edge = exp(-pow((limb - r) / (uBodyR * 0.045), 2.0));
      bc = mix(bc, uCore, edge * 0.4);
      over(col, a, bc, 1.0);
    }
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
  time: THREE.IUniform<number>;
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
  private readonly plasma: THREE.CanvasTexture;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.plasma = bakePlasma();
    this.object.name = "star";
    let order = 0;
    for (const body of level.bodies) {
      if (body.kind !== "star") continue;
      if (body.look === "neutron" || body.look === "pulsar" || body.look === "magnetar") continue;
      if (artForBody(body, theme)) continue;
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
          uTime: { value: 0 },
          uPlasma: { value: this.plasma },
        }),
      );
      const timeUniform = (mesh.material as THREE.ShaderMaterial).uniforms.uTime as THREE.IUniform<number>;
      mesh.position.set(body.x, body.y, 0);
      mesh.scale.setScalar(body.radius / look.bodyR);
      mesh.renderOrder = order++;
      mesh.name = body.id;
      mesh.userData.asset = look.asset;
      this.object.add(mesh);
      this.stars.push({ body, mesh, bodyR: look.bodyR, atmosphere, ring, time: timeUniform });
    }
  }

  update(frame: VisualFrame): void {
    if (this.stars.length === 0) return;
    const time = (frame.game.mode === "planning" ? 0 : frame.game.ship.step) * frame.game.level.dt;
    const bodies = frame.game.level.bodies;
    const star = this.theme.star;
    const breathe = 1 + star.breathe * Math.sin((frame.now / star.periodMs) * Math.PI * 2);
    const dash = -((frame.now / 1000) * 8);
    const plasma = frame.now * 0.001;
    for (const view of this.stars) {
      view.time.value = plasma;
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
    this.plasma.dispose();
    disposeObject(this.object);
  }
}

/** Cells in red, filaments in green. Baked once so the disc is not an angular rosette. */
function bakePlasma(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Could not bake the star");
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const rad = Math.hypot(u - 0.5, v - 0.5) * 2;
      const cells = fbm(u * 7.5, v * 7.5, 4);
      const fine = fbm(u * 16 + 4.2, v * 15 + 1.7, 11);
      const cell = cells > 0.52 ? (cells - 0.52) / 0.48 : 0;
      const ridge = 1 - Math.abs(fine * 2 - 1);
      const fil = ridge > 0.62 ? ((ridge - 0.62) / 0.38) * Math.max(0, 1.15 - 2.4 * rad) : 0;
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(Math.min(1, cell) * 255);
      img.data[i + 1] = Math.round(Math.min(1, fil) * 255);
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const n = (ix: number, iy: number) => {
    const s = Math.imul(ix + seed, 374761393) + Math.imul(iy, 668265263);
    return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  };
  const a = n(x0, y0);
  const b = n(x0 + 1, y0);
  const c = n(x0, y0 + 1);
  const d = n(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let a = 0.5;
  let s = 0;
  let n = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    s += a * noise(px, py, seed + i * 17);
    n += a;
    px = px * 2.02 + 3.1;
    py = py * 2.02 + 1.7;
    a *= 0.5;
  }
  return s / n;
}
