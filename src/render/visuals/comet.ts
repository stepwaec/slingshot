import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { isEditing } from "../../game/state";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { artForBody } from "../art-sprite";
import { shader, srgbVec } from "./materials";

/**
 * Comet head and tails from `comet.svg`. The tail points away from the star.
 * The harvest ring shows in planning and pause. Motion of the nucleus is the
 * Kepler pose, so the drawing sits where the sim says the ice is.
 */
export const createComet: VisualFactory = (theme, level) => new CometVisual(theme, level);

const headFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uNucleus;
uniform vec3 uLit;
uniform vec3 uComa;
uniform vec3 uCore;
uniform float uTime;
void main() {
  vec2 p = vLocal;
  float breathe = 1.0 + 0.04 * sin(uTime * 1.2566);
  float coma = length(vec2(p.x / 0.72, p.y / 0.6) / breathe);
  float nucleus = length(vec2((p.x + 0.55) / 0.16, p.y / 0.11));
  float core = length(p + vec2(0.42, 0.0));
  vec3 col = uComa;
  float a = coma < 1.0 ? mix(0.55, 0.0, smoothstep(0.15, 1.0, coma)) : 0.0;
  if (core < 0.22) {
    col = mix(uCore, uComa, core / 0.22);
    a = max(a, 1.0 - core / 0.22);
  }
  if (nucleus < 1.0) {
    float lit = smoothstep(0.2, -0.6, p.x);
    col = mix(uNucleus, uLit, lit);
    a = 1.0;
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

const tailFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uIon;
uniform vec3 uDust;
uniform vec3 uKnot;
uniform float uTime;
uniform float uMirror;
void main() {
  vec2 p = vec2(vLocal.x, vLocal.y * uMirror);
  if (p.x < -0.05 || p.x > 1.0) discard;
  float along = clamp(p.x, 0.0, 1.0);
  float ion = abs(p.y) / (0.06 + along * 0.04);
  float dust = abs(p.y - along * 0.18) / (0.16 + along * 0.2);
  float ionA = (1.0 - smoothstep(0.35, 1.0, ion)) * (1.0 - along);
  float dustA = (1.0 - smoothstep(0.2, 1.0, dust)) * (1.0 - along * 0.85) * 0.55;
  float streak = step(fract(along * 8.0 - uTime * 0.4), 0.4);
  ionA *= 0.55 + 0.45 * streak;
  float knot = 1.0 - smoothstep(0.08, 0.16, length(vec2((along - mod(uTime, 9.0) / 9.0) / 0.12, p.y / 0.08)));
  vec3 col = mix(uDust, uIon, clamp(ionA, 0.0, 1.0));
  col = mix(col, uKnot, knot);
  float a = max(ionA * 0.85, dustA) + knot * 0.35;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

const ringFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uDash;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float band = 1.0 - smoothstep(0.012, 0.012 + fw, abs(r - 0.92));
  if (band <= 0.0) discard;
  float arc = atan(vLocal.y, vLocal.x) * 12.0;
  if (fract((arc - uDash) / 1.6) > 0.45) discard;
  gl_FragColor = vec4(uColor, 0.55 * band);
}
`;

interface CometView {
  body: Body;
  head: THREE.Mesh;
  tail: THREE.Mesh;
  ring: THREE.Mesh;
  time: THREE.IUniform<number>;
  dash: THREE.IUniform<number>;
  mirror: THREE.IUniform<number>;
}

class CometVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly views: CometView[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "comets";
    let order = 5;
    for (const body of level.bodies) {
      if (body.look !== "comet") continue;
      const time = { value: 0 };
      const head = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(headFrag, {
          uNucleus: { value: srgbVec("#4A362A") },
          uLit: { value: srgbVec("#F0E2CC") },
          uComa: { value: srgbVec("#5CEDBA") },
          uCore: { value: srgbVec("#F2FFFA") },
          uTime: time,
        }),
      );
      head.scale.set(36, 36, 1);
      head.renderOrder = order++;
      head.name = body.id;
      head.userData.asset = theme.assets.comet;
      const mirror = { value: 1 };
      const tail = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(tailFrag, {
          uIon: { value: srgbVec("#7FD8FF") },
          uDust: { value: srgbVec("#FFE0A0") },
          uKnot: { value: srgbVec("#BFEFFF") },
          uTime: time,
          uMirror: mirror,
        }),
      );
      tail.renderOrder = order++;
      tail.name = `${body.id}-tail`;
      const replaced = artForBody(body, theme) !== null;
      const dash = { value: 0 };
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(ringFrag, { uColor: { value: srgbVec("#7CF5C8") }, uDash: dash }),
      );
      const reach = body.harvestRadius ?? 30;
      ring.scale.set(reach, reach, 1);
      ring.renderOrder = order++;
      ring.name = `${body.id}-harvest`;
      if (!replaced) this.object.add(tail, head);
      this.object.add(ring);
      this.views.push({ body, head, tail, ring, time, dash, mirror });
    }
  }

  update(frame: VisualFrame): void {
    if (this.views.length === 0) return;
    const game = frame.game;
    const time = (game.mode === "planning" ? 0 : game.ship.step) * game.level.dt;
    const bodies = game.level.bodies;
    const showRing = isEditing(game);
    const now = frame.now / 1000;
    for (const view of this.views) {
      const pose = bodyPose(view.body, time, bodies, game.level.g);
      const star = nearestStar(pose.x, pose.y, bodies, time, game.level.g);
      const dx = pose.x - star.x;
      const dy = pose.y - star.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const away = Math.atan2(dy, dx);
      const peri = (view.body.orbit?.a ?? view.body.orbit?.radius ?? distance) * (1 - (view.body.orbit?.e ?? 0));
      const stretch = Math.min(1, Math.max(0.35, peri / distance));
      view.head.position.set(pose.x, pose.y, 0);
      view.head.rotation.z = away;
      view.tail.position.set(pose.x, pose.y, 0);
      view.tail.rotation.z = away;
      view.tail.scale.set(150 * stretch, 70 * (0.6 + 0.4 * stretch), 1);
      view.tail.position.x += Math.cos(away) * 70 * stretch;
      view.tail.position.y += Math.sin(away) * 70 * stretch;
      const spin = dx * (pose.vy - star.vy) - dy * (pose.vx - star.vx);
      view.mirror.value = spin < 0 ? -1 : 1;
      view.time.value = now;
      view.ring.position.set(pose.x, pose.y, 0);
      view.ring.visible = showRing && (view.body.harvestRadius ?? 0) > 0;
      view.dash.value = -now * 8;
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function nearestStar(x: number, y: number, bodies: readonly Body[], time: number, g: number): { x: number; y: number; vx: number; vy: number } {
  let best = { x, y: y - 1, vx: 0, vy: 0 };
  let bestD = Infinity;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star") continue;
    const pose = bodyPose(body, time, bodies, g);
    const d = Math.hypot(pose.x - x, pose.y - y);
    if (d < bestD) {
      bestD = d;
      best = pose;
    }
  }
  return best;
}
