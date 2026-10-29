import * as THREE from "three";
import { bodyPose, hasMagneticBody, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { isEditing } from "../../game/state";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Danger heatmap for magnetic bodies. One quad sums up to eight dipoles, the
 * same formula as `fieldAt`. M shows it in planning and pause only.
 */
export const createMagnetism: VisualFactory = (theme, level) => new MagnetismVisual(theme, level);

const MAX = 8;

const fragment = /* glsl */ `
varying vec2 vLocal;
uniform vec2 uCenter;
uniform float uSpan;
uniform float uCount;
uniform vec2 uPos[8];
uniform float uK[8];
uniform float uTilt[8];
uniform float uAvg[8];
uniform float uR1[8];
uniform float uTime;
uniform float uZoom;
uniform vec3 uFuzzy;
uniform vec3 uScrambled;
uniform vec3 uDamaging;
uniform vec3 uLethal;

vec2 oneDipole(vec2 world, vec2 pos, float k, float tilt, float avg) {
  vec2 d = world - pos;
  float r = max(length(d), 1.0);
  vec2 n = d / r;
  float falloff = k / (r * r * r);
  if (avg > 0.5) {
    return n * falloff * pow(0.894, 3.0) * 2.0;
  }
  vec2 m = vec2(sin(tilt), cos(tilt));
  float c = dot(m, n);
  return falloff * (3.0 * c * n - m);
}

void main() {
  if (uCount < 0.5) discard;
  vec2 world = uCenter + vLocal * uSpan;
  vec2 b = vec2(0.0);
  if (uCount > 0.5) b += oneDipole(world, uPos[0], uK[0], uTilt[0], uAvg[0]);
  if (uCount > 1.5) b += oneDipole(world, uPos[1], uK[1], uTilt[1], uAvg[1]);
  if (uCount > 2.5) b += oneDipole(world, uPos[2], uK[2], uTilt[2], uAvg[2]);
  if (uCount > 3.5) b += oneDipole(world, uPos[3], uK[3], uTilt[3], uAvg[3]);
  if (uCount > 4.5) b += oneDipole(world, uPos[4], uK[4], uTilt[4], uAvg[4]);
  if (uCount > 5.5) b += oneDipole(world, uPos[5], uK[5], uTilt[5], uAvg[5]);
  if (uCount > 6.5) b += oneDipole(world, uPos[6], uK[6], uTilt[6], uAvg[6]);
  if (uCount > 7.5) b += oneDipole(world, uPos[7], uK[7], uTilt[7], uAvg[7]);
  float x = length(b);
  if (x < 1.0) discard;
  float z = step(1.0, x) + step(2.5, x) + step(6.0, x) + step(15.0, x);
  vec3 col = uFuzzy;
  float fill = 0.10;
  if (z > 3.5) { col = uLethal; fill = 0.32; }
  else if (z > 2.5) { col = uDamaging; fill = 0.22; }
  else if (z > 1.5) { col = uScrambled; fill = 0.15; }
  float lx = log2(max(x, 0.0001));
  float e = min(min(abs(lx - 0.0), abs(lx - 1.3219)), min(abs(lx - 2.585), abs(lx - 3.9069)));
  float edge = 1.0 - smoothstep(0.5, 1.5, e / max(fwidth(lx), 1e-4));
  vec2 strong = world - uPos[0];
  float ang = atan(strong.y, strong.x);
  float dash = fract(ang * uR1[0] * uZoom / 11.0 - uTime);
  float fuzzyEdge = edge * step(0.5, z) * (1.0 - step(1.5, z));
  if (fuzzyEdge > 0.0 && dash > 0.55) edge *= 1.0 - fuzzyEdge;
  float breathe = 0.55 + 0.35 * sin(uTime * 6.2831853 / 2.4);
  float edgeA = z > 3.5 ? mix(0.55, 0.90, breathe) : (z > 2.5 ? 0.80 : (z > 1.5 ? 0.70 : 0.60));
  vec3 outCol = mix(col, col, 0.0);
  float a = fill;
  if (edge > 0.05) {
    a = max(a, edge * edgeA);
  }
  gl_FragColor = vec4(outCol, a);
}
`;

class MagnetismVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly magnets: Body[] = [];
  private readonly mesh: THREE.Mesh | null = null;
  private readonly pos: THREE.Vector2[] = [];
  private readonly k: number[] = [];
  private readonly tilt: number[] = [];
  private readonly avg: number[] = [];
  private readonly r1: number[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "magnetism";
    this.object.userData.asset = theme.assets.magnetism;
    for (const body of level.bodies) {
      if (!body.magnet || !(body.magnet.b1Reach > 0)) continue;
      if (this.magnets.length >= MAX) break;
      this.magnets.push(body);
    }
    if (!hasMagneticBody(level.bodies) || this.magnets.length === 0) return;
    for (let i = 0; i < MAX; i++) {
      this.pos.push(new THREE.Vector2());
      this.k.push(0);
      this.tilt.push(0);
      this.avg.push(0);
      this.r1.push(1);
    }
    for (let i = 0; i < this.magnets.length; i++) {
      const magnet = this.magnets[i].magnet;
      if (!magnet) continue;
      const reach = magnet.b1Reach;
      this.k[i] = (reach * reach * reach) / 2;
      this.tilt[i] = magnet.tilt;
      this.avg[i] = magnet.averaged ? 1 : 0;
      this.r1[i] = reach;
    }
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(fragment, {
        uCenter: { value: new THREE.Vector2() },
        uSpan: { value: 1 },
        uCount: { value: this.magnets.length },
        uPos: { value: this.pos },
        uK: { value: this.k },
        uTilt: { value: this.tilt },
        uAvg: { value: this.avg },
        uR1: { value: this.r1 },
        uTime: { value: 0 },
        uZoom: { value: 1 },
        uFuzzy: { value: srgbVec("#7C5CFF") },
        uScrambled: { value: srgbVec("#B14DFF") },
        uDamaging: { value: srgbVec("#E541C9") },
        uLethal: { value: srgbVec("#FF3D7F") },
      }),
    );
    this.mesh.name = "magnetism-field";
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
  }

  update(frame: VisualFrame): void {
    const show = frame.game.magnetism && isEditing(frame.game) && this.mesh !== null;
    this.object.visible = show;
    if (!show || !this.mesh) return;
    const time = (frame.game.mode === "planning" ? 0 : frame.game.ship.step) * frame.game.level.dt;
    const bodies = frame.game.level.bodies;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.magnets.length; i++) {
      const body = this.magnets[i];
      const pose = bodyPose(body, time, bodies);
      this.pos[i].set(pose.x, pose.y);
      const reach = (body.magnet?.b1Reach ?? 0) * 1.1;
      minX = Math.min(minX, pose.x - reach);
      maxX = Math.max(maxX, pose.x + reach);
      minY = Math.min(minY, pose.y - reach);
      maxY = Math.max(maxY, pose.y + reach);
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const span = Math.max(maxX - minX, maxY - minY) * 0.5;
    this.mesh.position.set(cx, cy, 0);
    this.mesh.scale.set(span, span, 1);
    const material = this.mesh.material as THREE.ShaderMaterial;
    material.uniforms.uCenter.value.set(cx, cy);
    material.uniforms.uSpan.value = span;
    material.uniforms.uTime.value = frame.now / 1000;
    material.uniforms.uZoom.value = frame.game.camera.zoom;
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
