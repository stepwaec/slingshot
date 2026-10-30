import * as THREE from "three";
import { isEditing } from "../../game/state";
import {
  consumeHeat,
  craterAlpha,
  debrisPieces,
  driftOpen,
  easeOutCubic,
  ejectaGrains,
  fadeOut,
  formatClock,
  growRadius,
  hashId,
  starBrighten,
  type DebrisPiece,
  type EjectaGrain,
} from "../event-look";
import type { Theme } from "../theme";
import { bodyPose, type Body } from "../../sim/physics";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Scripted collisions and consumption.
 * design/assets/events/, style.md §14, threejs-notes.md §17.
 * Reads body poses. Does not write the simulation.
 *
 * `disrupt` and `accrete` are still proposals. No level carries them, and
 * adding them would move mass, so this drawing covers `consume` and `impact`.
 * Debris chunks are drawn only: r ≥ 4 is labelled, not added as a crash body.
 * The star brightening is masked to the photosphere. The sample's #FFE7A0 disc
 * at α 0.22 would turn olive on the navy sky.
 */
export const createFates: VisualFactory = (theme, level) => new FatesVisual(theme, level);

const flashFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float disc = 1.0 - smoothstep(1.0 - fw, 1.0, r);
  vec3 color = mix(uCore, uMid, smoothstep(0.0, 0.35, r));
  color = mix(color, uEdge, smoothstep(0.35, 1.0, r));
  float a = mix(1.0, 0.9, smoothstep(0.0, 0.35, r));
  a = mix(a, 0.0, smoothstep(0.35, 1.0, r));
  a *= disc * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(color, a);
}
`;

const glowFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
uniform float uAlpha;
uniform float uHot;
uniform float uGrad;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float disc = 1.0 - smoothstep(1.0 - fw, 1.0, r);
  float d = clamp(length(vLocal - vec2(uHot, 0.0)) / uGrad, 0.0, 1.0);
  vec3 color = d < 0.5 ? mix(uCore, uMid, d / 0.5) : mix(uMid, uEdge, (d - 0.5) / 0.5);
  float a = d < 0.5 ? mix(0.95, 0.6, d / 0.5) : mix(0.6, 0.0, (d - 0.5) / 0.5);
  a *= disc * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(color, a);
}
`;

const tailFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uD;
uniform float uTip;
uniform float uBody;
void main() {
  if (length(vLocal) < uBody) discard;
  float s = uTip == 0.0 ? 0.0 : clamp(vLocal.x / uTip, 0.0, 1.0);
  vec3 color;
  float a;
  if (s < 0.25) {
    float k = s / 0.25;
    color = mix(uA, uB, k);
    a = mix(1.0, 0.9, k);
  } else if (s < 0.65) {
    float k = (s - 0.25) / 0.4;
    color = mix(uB, uC, k);
    a = mix(0.9, 0.45, k);
  } else {
    float k = (s - 0.65) / 0.35;
    color = mix(uC, uD, k);
    a = mix(0.45, 0.0, k);
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(color, a);
}
`;

const ringFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uOuter;
uniform float uRadius;
uniform float uZoom;
uniform float uWidth;
uniform float uDash;
uniform float uGap;
uniform float uOffset;
void main() {
  float px = length(vLocal) * uOuter * uZoom;
  float target = uRadius * uZoom;
  float w = fwidth(px);
  float band = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + w, abs(px - target));
  float on = 1.0;
  if (uDash > 0.0) {
    float arc = atan(vLocal.y, vLocal.x) * target;
    float period = uDash + uGap;
    float x = mod(arc - uOffset + period * 8.0, period);
    float aa = max(fwidth(arc), 0.5);
    on = 1.0 - smoothstep(uDash - aa, uDash + aa, x);
  }
  float a = band * on * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const rippleFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRadius;
uniform float uWidth;
uniform float uZoom;
uniform vec2 uStar;
uniform float uStarR;
void main() {
  vec2 world = vLocal * uRadius;
  if (length(world - uStar) > uStarR) discard;
  float px = length(world) * uZoom;
  float target = uRadius * uZoom;
  float w = fwidth(px);
  float band = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + w, abs(px - target));
  float a = band * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const discFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float a = (1.0 - smoothstep(1.0 - fw, 1.0, r)) * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const strokeVert = /* glsl */ `
attribute float aAlong;
varying float vAlong;
void main() {
  vAlong = aAlong;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const strokeFrag = /* glsl */ `
varying float vAlong;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uDash;
uniform float uGap;
uniform float uOffset;
void main() {
  float on = 1.0;
  if (uDash > 0.0) {
    float period = uDash + uGap;
    float x = mod(vAlong - uOffset + period * 8.0, period);
    float aa = max(fwidth(vAlong), 0.5);
    on = 1.0 - smoothstep(uDash - aa, uDash + aa, x);
  }
  float a = on * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const grainVert = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vLocal = position.xy;
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const grainFrag = /* glsl */ `
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
uniform float uLit;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float disc = 1.0 - smoothstep(1.0 - fw, 1.0, r);
  float shade = uLit > 0.5 ? clamp(0.42 + 0.58 * vLocal.x, 0.0, 1.0) : 1.0;
  float a = disc * vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor * shade, a);
}
`;

interface Pt {
  x: number;
  y: number;
}

class WorldStroke {
  readonly mesh: THREE.Mesh;
  readonly alpha: { value: number };
  readonly offset: { value: number };
  readonly dash: { value: number };
  readonly gap: { value: number };
  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly along: Float32Array;

  constructor(capacity: number, color: string, order: number) {
    this.capacity = capacity;
    const n = capacity * 6;
    this.positions = new Float32Array(n * 3);
    this.along = new Float32Array(n);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aAlong", new THREE.BufferAttribute(this.along, 1));
    geometry.setDrawRange(0, 0);
    this.alpha = { value: 1 };
    this.offset = { value: 0 };
    this.dash = { value: 0 };
    this.gap = { value: 1 };
    this.mesh = new THREE.Mesh(
      geometry,
      shader(strokeFrag, {
        uColor: { value: srgbVec(color) },
        uAlpha: this.alpha,
        uDash: this.dash,
        uGap: this.gap,
        uOffset: this.offset,
      }),
    );
    (this.mesh.material as THREE.ShaderMaterial).vertexShader = strokeVert;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
    this.mesh.name = "event-stroke";
  }

  draw(points: readonly Pt[], widthPx: number, zoom: number): void {
    const geometry = this.mesh.geometry;
    const segs = Math.min(Math.max(0, points.length - 1), this.capacity);
    if (segs < 1 || !(zoom > 0)) {
      this.mesh.visible = false;
      geometry.setDrawRange(0, 0);
      return;
    }
    const half = (widthPx * 0.5) / zoom;
    let dist = 0;
    let vert = 0;
    for (let i = 0; i < segs; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) continue;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy * half;
      const ny = ux * half;
      const ax = a.x - ux * half;
      const ay = a.y - uy * half;
      const bx = b.x + ux * half;
      const by = b.y + uy * half;
      const a0 = dist * zoom;
      const a1 = (dist + len) * zoom;
      const quad = [
        ax + nx, ay + ny, a0,
        ax - nx, ay - ny, a0,
        bx - nx, by - ny, a1,
        ax + nx, ay + ny, a0,
        bx - nx, by - ny, a1,
        bx + nx, by + ny, a1,
      ];
      for (let k = 0; k < 6; k++) {
        const o = vert * 3;
        this.positions[o] = quad[k * 3];
        this.positions[o + 1] = quad[k * 3 + 1];
        this.positions[o + 2] = 0;
        this.along[vert] = quad[k * 3 + 2];
        vert += 1;
      }
      dist += len;
    }
    geometry.setDrawRange(0, vert);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlong.needsUpdate = true;
    this.mesh.visible = vert > 0;
  }
}

class WorldRing {
  readonly mesh: THREE.Mesh;
  readonly alpha: { value: number };
  readonly outer: { value: number };
  readonly radius: { value: number };
  readonly zoom: { value: number };
  readonly width: { value: number };
  readonly dash: { value: number };
  readonly gap: { value: number };
  readonly offset: { value: number };

  constructor(color: string, order: number) {
    this.alpha = { value: 1 };
    this.outer = { value: 1 };
    this.radius = { value: 1 };
    this.zoom = { value: 1 };
    this.width = { value: 1.4 };
    this.dash = { value: 0 };
    this.gap = { value: 1 };
    this.offset = { value: 0 };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(ringFrag, {
        uColor: { value: srgbVec(color) },
        uAlpha: this.alpha,
        uOuter: this.outer,
        uRadius: this.radius,
        uZoom: this.zoom,
        uWidth: this.width,
        uDash: this.dash,
        uGap: this.gap,
        uOffset: this.offset,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
    this.mesh.name = "event-ring";
  }

  place(x: number, y: number, worldRadius: number, widthPx: number, zoom: number, alpha: number): void {
    if (!(worldRadius > 0) || !(zoom > 0) || alpha <= 0) {
      this.mesh.visible = false;
      return;
    }
    const pad = (widthPx + 2) / zoom;
    const outer = worldRadius + pad;
    this.outer.value = outer;
    this.radius.value = worldRadius;
    this.zoom.value = zoom;
    this.width.value = widthPx;
    this.alpha.value = alpha;
    this.mesh.position.set(x, y, 0);
    this.mesh.scale.set(outer, outer, 1);
    this.mesh.visible = true;
  }
}

class Chip {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private key = "";

  constructor(order: number) {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
    this.mesh.name = "event-chip";
  }

  show(text: string, color: string, fill: string, x: number, y: number, zoom: number, dpr: number, spec: Theme["event"]): void {
    if (!(zoom > 0)) {
      this.mesh.visible = false;
      return;
    }
    const key = `${text}|${color}|${dpr}`;
    if (key !== this.key) {
      this.key = key;
      this.paint(text, color, fill, dpr, spec);
    }
    const image = this.material.map?.image as { width: number; height: number } | undefined;
    const cssW = image ? image.width / Math.max(1, dpr) : 80;
    const cssH = spec.chipHeight;
    const w = cssW / zoom;
    const h = cssH / zoom;
    this.mesh.scale.set(w, h, 1);
    this.mesh.position.set(x + w / 2, y - h / 2, 0);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  private paint(text: string, color: string, fill: string, dpr: number, spec: Theme["event"]): void {
    const font = `${spec.chipFont * dpr}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    measure.font = font;
    const textW = measure.measureText(text).width;
    const cssW = Math.ceil(textW / dpr + spec.chipPad * 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(cssW * dpr));
    canvas.height = Math.max(1, Math.ceil(spec.chipHeight * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const inset = dpr * 0.5;
    ctx.beginPath();
    ctx.roundRect(inset, inset, canvas.width - dpr, canvas.height - dpr, spec.chipRadius * dpr);
    ctx.fillStyle = hexAlpha(fill, spec.chipFill);
    ctx.fill();
    ctx.strokeStyle = hexAlpha(color, spec.chipStroke);
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, spec.chipPad * dpr, 12 * dpr);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.material.map?.dispose();
    this.material.map = texture;
    this.material.needsUpdate = true;
  }
}

interface ConsumeView {
  body: Body;
  tail: THREE.Mesh;
  tip: { value: number };
  bodyR: { value: number };
  glow: THREE.Mesh;
  glowAlpha: { value: number };
  flash: THREE.Mesh;
  flashAlpha: { value: number };
  ripple: THREE.Mesh;
  rippleAlpha: { value: number };
  rippleRadius: { value: number };
  rippleStar: { value: THREE.Vector2 };
  rippleStarR: { value: number };
  rippleZoom: { value: number };
  bright: THREE.Mesh;
  brightAlpha: { value: number };
  spiral: WorldStroke;
  arrival: WorldRing;
  capture: WorldRing;
}

interface ImpactView {
  body: Body;
  grains: EjectaGrain[];
  pieces: DebrisPiece[];
  flash: THREE.Mesh;
  flashAlpha: { value: number };
  shock: WorldRing;
  rim: WorldRing;
  crater: THREE.Mesh;
  craterAlpha: { value: number };
  ejecta: THREE.InstancedMesh;
  ejectaAlpha: Float32Array;
  chunks: THREE.InstancedMesh;
  dust: THREE.InstancedMesh;
  course: WorldStroke;
  reticle: WorldRing;
  ticks: THREE.Mesh;
  hazard: WorldStroke;
  forecast: WorldStroke;
  band: WorldStroke;
}

class FatesVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly bodies: readonly Body[];
  private readonly g: number;
  private readonly consumes: ConsumeView[] = [];
  private readonly impacts: ImpactView[] = [];
  private readonly chips: Chip[] = [];
  private readonly pts: Pt[] = [];
  private readonly pos = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 0, 1);

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.bodies = level.bodies;
    this.g = level.g;
    this.object.name = "fates";
    for (const body of level.bodies) {
      if (body.script?.kind === "consume") this.consumes.push(this.makeConsume(body));
      if (body.script?.kind === "impact") this.impacts.push(this.makeImpact(body));
    }
    for (let i = 0; i < 8; i++) {
      const chip = new Chip(30);
      this.chips.push(chip);
      this.object.add(chip.mesh);
    }
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = shownTime(game);
    const zoom = game.camera.zoom > 0 ? game.camera.zoom : 1;
    const overlay = isEditing(game) && game.gravity !== "sheet";
    let chip = 0;
    for (const view of this.consumes) chip = this.updateConsume(view, frame, time, zoom, overlay, chip);
    for (const view of this.impacts) chip = this.updateImpact(view, frame, time, zoom, overlay, chip);
    for (let i = chip; i < this.chips.length; i++) this.chips[i].hide();
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private updateConsume(view: ConsumeView, frame: VisualFrame, time: number, zoom: number, overlay: boolean, chip: number): number {
    const script = view.body.script;
    const spec = this.theme.event;
    const colors = this.theme.colors;
    if (!script || script.kind !== "consume") return chip;
    const center = findBody(this.bodies, script.centerId);
    const pose = bodyPose(view.body, Math.min(time, script.end), this.bodies, this.g);
    const centerPose = center
      ? bodyPose(center, Math.min(time, script.end), this.bodies, this.g)
      : { x: view.body.orbit?.cx ?? 0, y: view.body.orbit?.cy ?? 0, vx: 0, vy: 0 };
    const live = time < script.end ? bodyPose(view.body, Math.max(time, 0), this.bodies, this.g) : pose;
    const startPose = bodyPose(view.body, script.start, this.bodies, this.g);
    const startCenter = center ? bodyPose(center, script.start, this.bodies, this.g) : centerPose;
    const r0 = Math.hypot(startPose.x - startCenter.x, startPose.y - startCenter.y);
    const dist = Math.hypot(pose.x - centerPose.x, pose.y - centerPose.y);
    const heat = time < script.start ? 0 : consumeHeat(dist, r0, script.radius);
    const falling = time >= script.start && time < script.end && heat > 0.02;
    this.placeTail(view, live, centerPose, heat, falling, frame.now / 1000);
    this.placeGlow(view, live, centerPose, heat, falling);

    const age = time - script.end;
    const starR = center?.radius ?? script.radius;
    const showPlunge = age >= 0 && age < spec.brightDur;
    const flashR = growRadius(age, spec.plungeR0, spec.plungeR1, spec.plungeGrow);
    view.flash.visible = showPlunge && fadeOut(age, spec.plungeFade) > 0;
    view.flashAlpha.value = fadeOut(age, spec.plungeFade);
    view.flash.position.set(pose.x, pose.y, 0);
    view.flash.scale.set(flashR, flashR, 1);

    const rippleR = growRadius(age, spec.rippleR0, spec.rippleR1, spec.rippleDur);
    const rippleA = spec.rippleAlpha * fadeOut(age, spec.rippleDur);
    view.ripple.visible = rippleA > 0 && rippleR > 0;
    view.rippleAlpha.value = rippleA;
    view.rippleRadius.value = rippleR;
    view.rippleZoom.value = zoom;
    view.rippleStar.value.set(centerPose.x - pose.x, centerPose.y - pose.y);
    view.rippleStarR.value = starR;
    view.ripple.position.set(pose.x, pose.y, 0);
    view.ripple.scale.set(rippleR, rippleR, 1);

    const bright = starBrighten(age, spec.brightAlpha, spec.brightRise, spec.brightDur);
    view.bright.visible = bright > 0;
    view.brightAlpha.value = bright;
    view.bright.position.set(centerPose.x, centerPose.y, 0);
    view.bright.scale.set(starR, starR, 1);

    if (!overlay || time >= script.end) {
      view.spiral.mesh.visible = false;
      view.arrival.mesh.visible = false;
      view.capture.mesh.visible = false;
    } else {
      this.sample(view.body, time, script.end, 160);
      view.spiral.alpha.value = spec.spiralAlpha;
      view.spiral.dash.value = spec.spiralDash;
      view.spiral.gap.value = spec.spiralGap;
      view.spiral.offset.value = 0;
      view.spiral.draw(this.pts, spec.spiralWidth, zoom);
      const anchor = this.pts.length > 0 ? this.pts[0] : live;
      chip = this.stack(chip, anchor.x, anchor.y, zoom, frame.dpr, [
        [`burns up in ${formatClock(script.end - time)}`, colors.eventWarn],
        ["orbit decaying", colors.eventNext],
      ]);
      const won = frame.game.prediction.final.status === "won" && frame.game.prediction.final.t < script.end;
      if (won) {
        const at = frame.game.prediction.final.t;
        const future = bodyPose(view.body, at, this.bodies, this.g);
        view.arrival.dash.value = spec.arrivalDash;
        view.arrival.gap.value = spec.arrivalGap;
        view.arrival.place(future.x, future.y, view.body.radius, spec.arrivalWidth, zoom, spec.arrivalAlpha);
        const capture = view.body.captureRadius ?? 0;
        view.capture.dash.value = spec.captureDash;
        view.capture.gap.value = spec.captureGap;
        view.capture.place(future.x, future.y, capture, spec.captureWidth, zoom, spec.captureAlpha);
        chip = this.stack(chip, future.x, future.y, zoom, frame.dpr, [
          [`arrive ${formatClock(at)} · margin ${formatClock(script.end - at)}`, colors.planetXBase],
        ]);
      } else {
        view.arrival.mesh.visible = false;
        view.capture.mesh.visible = false;
      }
    }
    return chip;
  }

  private updateImpact(view: ImpactView, frame: VisualFrame, time: number, zoom: number, overlay: boolean, chip: number): number {
    const script = view.body.script;
    const spec = this.theme.event;
    const colors = this.theme.colors;
    if (!script || script.kind !== "impact") return chip;
    const host = findBody(this.bodies, script.into);
    const imp = bodyPose(view.body, script.at, this.bodies, this.g);
    const hostPose = host ? bodyPose(host, script.at, this.bodies, this.g) : imp;
    let nx = imp.x - hostPose.x;
    let ny = imp.y - hostPose.y;
    const nlen = Math.hypot(nx, ny);
    if (nlen < 1e-6) {
      nx = 1;
      ny = 0;
    } else {
      nx /= nlen;
      ny /= nlen;
    }
    const point = host
      ? { x: hostPose.x + nx * host.radius, y: hostPose.y + ny * host.radius }
      : { x: imp.x, y: imp.y };
    const age = time - script.at;
    const flashR = growRadius(age, spec.flashR0, spec.flashR1, spec.flashGrow);
    const flashA = fadeOut(age, spec.flashFade);
    view.flash.visible = flashA > 0;
    view.flashAlpha.value = flashA;
    view.flash.position.set(point.x, point.y, 0);
    view.flash.scale.set(Math.max(flashR, 0.001), Math.max(flashR, 0.001), 1);

    const shockR = growRadius(age, spec.shockR0, spec.shockR1, spec.shockDur);
    view.shock.place(point.x, point.y, shockR, spec.shockWidth, zoom, fadeOut(age, spec.shockDur));
    if (host && age >= 0 && age < spec.rimDur) {
      view.rim.place(hostPose.x, hostPose.y, host.radius, spec.rimWidth, zoom, spec.rimAlpha * fadeOut(age, spec.rimDur));
    } else {
      view.rim.mesh.visible = false;
    }

    const craterA = craterAlpha(age, spec.craterMid, spec.craterMidAlpha, spec.craterDur);
    view.crater.visible = craterA > 0;
    view.craterAlpha.value = craterA;
    view.crater.position.set(point.x, point.y, 0);
    view.crater.scale.set(spec.craterR, spec.craterR, 1);

    this.placeEjecta(view, point, nx, ny, age);
    chip = this.placeDebris(view, host, point, nx, ny, script.at, frame, time, zoom, overlay, chip);

    const before = overlay && time < script.at;
    if (before) {
      this.sample(view.body, time, script.at, 80);
      view.course.alpha.value = 1;
      view.course.dash.value = spec.courseDash;
      view.course.gap.value = spec.courseGap;
      view.course.offset.value = (frame.now / 1000) * spec.courseCrawl;
      view.course.draw(this.pts, spec.courseWidth, zoom);
      const pulse = 0.5 - 0.5 * Math.cos((Math.PI * 2 * frame.now) / 1000 / spec.reticlePeriod);
      const reticle = (spec.reticleR0 + (spec.reticleR1 - spec.reticleR0) * pulse) / zoom;
      view.reticle.place(point.x, point.y, reticle, spec.reticleWidth, zoom, 1);
      view.ticks.visible = true;
      view.ticks.position.set(point.x, point.y, 0);
      view.ticks.scale.set(1 / zoom, 1 / zoom, 1);
      chip = this.stack(chip, point.x, point.y, zoom, frame.dpr, [
        [`impact in ${formatClock(script.at - time)}`, colors.eventWarn],
        [`debris from ${formatClock(script.at - time)} for ${formatClock(spec.debrisForecast)}`, colors.eventNext],
      ]);
    } else {
      view.course.mesh.visible = false;
      view.reticle.mesh.visible = false;
      view.ticks.visible = false;
    }
    return chip;
  }

  private placeTail(view: ConsumeView, pose: { x: number; y: number; vx: number; vy: number }, center: { x: number; y: number }, heat: number, show: boolean, seconds: number): void {
    if (!show) {
      view.tail.visible = false;
      return;
    }
    const flicker = 0.5 - 0.5 * Math.cos((Math.PI * 2 * seconds) / this.theme.event.tailFlicker);
    const pts = tailPoints(flicker, heat);
    const attr = view.tail.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < 5; i++) {
      arr[i * 3] = pts[i][0];
      arr[i * 3 + 1] = pts[i][1];
      arr[i * 3 + 2] = 0;
    }
    attr.needsUpdate = true;
    view.tip.value = pts[2][0];
    view.bodyR.value = view.body.radius;
    let heading = Math.atan2(pose.vy, pose.vx);
    if (Math.hypot(pose.vx, pose.vy) < 1e-4) heading = Math.atan2(pose.y - center.y, pose.x - center.x);
    view.tail.position.set(pose.x, pose.y, 0);
    view.tail.rotation.z = heading;
    view.tail.visible = true;
  }

  private placeGlow(view: ConsumeView, pose: { x: number; y: number }, center: { x: number; y: number }, heat: number, show: boolean): void {
    if (!show) {
      view.glow.visible = false;
      return;
    }
    const radius = view.body.radius * this.theme.event.glowScale;
    view.glowAlpha.value = heat;
    view.glow.position.set(pose.x, pose.y, 0);
    view.glow.scale.set(radius, radius, 1);
    view.glow.rotation.z = Math.atan2(center.y - pose.y, center.x - pose.x);
    view.glow.visible = true;
  }

  private placeEjecta(view: ImpactView, point: Pt, nx: number, ny: number, age: number): void {
    const spec = this.theme.event;
    const alive = age >= 0 && age < spec.ejectaDur;
    view.ejecta.visible = alive;
    if (!alive) return;
    const t = age / spec.ejectaDur;
    const travel = easeOutCubic(t);
    const fade = 1 - t;
    const normal = Math.atan2(ny, nx);
    for (let i = 0; i < view.grains.length; i++) {
      const grain = view.grains[i];
      const ang = normal + grain.angle;
      const dist = grain.dist * travel;
      view.ejectaAlpha[i] = fade * (grain.hot ? 1 - 0.35 * t : 1);
      this.pos.set(point.x + Math.cos(ang) * dist, point.y + Math.sin(ang) * dist, 0);
      this.quaternion.setFromAxisAngle(this.up, 0);
      this.scale.set(grain.radius, grain.radius, 1);
      this.matrix.compose(this.pos, this.quaternion, this.scale);
      view.ejecta.setMatrixAt(i, this.matrix);
    }
    view.ejecta.instanceMatrix.needsUpdate = true;
    const alphaAttr = view.ejecta.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    alphaAttr.needsUpdate = true;
  }

  private placeDebris(
    view: ImpactView,
    host: Body | undefined,
    point: Pt,
    nx: number,
    ny: number,
    at: number,
    frame: VisualFrame,
    time: number,
    zoom: number,
    overlay: boolean,
    chip: number,
  ): number {
    const spec = this.theme.event;
    const colors = this.theme.colors;
    const age = time - at;
    const centerBody = host?.orbit?.centerId ? findBody(this.bodies, host.orbit.centerId) : undefined;
    const centerAt = centerBody ? bodyPose(centerBody, at, this.bodies, this.g) : point;
    const centerNow = centerBody ? bodyPose(centerBody, Math.max(time, at), this.bodies, this.g) : centerAt;
    const hostAt = host ? bodyPose(host, at, this.bodies, this.g) : point;
    const baseAngle = Math.atan2(hostAt.y - centerAt.y, hostAt.x - centerAt.x);
    const baseRadius = centerBody ? Math.hypot(hostAt.x - centerAt.x, hostAt.y - centerAt.y) : 0;
    const normal = Math.atan2(ny, nx);
    const lightBody = this.bodies.find((body) => body.kind === "star") ?? centerBody ?? host;
    const light = lightBody ? bodyPose(lightBody, Math.max(time, 0), this.bodies, this.g) : centerNow;
    const origin = baseRadius > 0 ? centerNow : point;
    const place = (along: number, outward: number): Pt => {
      if (baseRadius > 0) {
        const ang = baseAngle + along;
        const rad = baseRadius + outward;
        return { x: origin.x + Math.cos(ang) * rad, y: origin.y + Math.sin(ang) * rad };
      }
      const ang = normal + along;
      const rad = 8 + outward;
      return { x: point.x + Math.cos(ang) * rad, y: point.y + Math.sin(ang) * rad };
    };
    const loop = (spread: number, into: Pt[]) => {
      into.length = 0;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps - 0.5;
        into.push(place(u * 1.2, 16 * spread));
      }
      for (let i = steps; i >= 0; i--) {
        const u = i / steps - 0.5;
        into.push(place(u * 1.2, -10 * spread));
      }
      if (into.length > 0) into.push(into[0]);
    };

    const show = age >= 0 && age < spec.debrisForecast;
    view.chunks.visible = show;
    view.dust.visible = show;
    view.band.mesh.visible = false;
    if (show) {
      let chunk = 0;
      let dust = 0;
      const spread = driftOpen(age, spec.gapClose);
      for (const piece of view.pieces) {
        const along = piece.along * (baseRadius > 0 ? spread : 1);
        const outward = piece.outward * driftOpen(age, piece.period);
        const atPiece = place(along, outward + (baseRadius > 0 ? 0 : Math.abs(piece.along) * 24 * spread));
        const rot = Math.atan2(light.y - atPiece.y, light.x - atPiece.x);
        this.pos.set(atPiece.x, atPiece.y, 0);
        this.quaternion.setFromAxisAngle(this.up, rot);
        this.scale.set(piece.radius, piece.radius, 1);
        this.matrix.compose(this.pos, this.quaternion, this.scale);
        if (piece.dust) {
          view.dust.setMatrixAt(dust, this.matrix);
          dust += 1;
        } else {
          view.chunks.setMatrixAt(chunk, this.matrix);
          chunk += 1;
        }
      }
      view.chunks.count = chunk;
      view.dust.count = dust;
      view.chunks.instanceMatrix.needsUpdate = true;
      view.dust.instanceMatrix.needsUpdate = true;
      loop(Math.max(spread, 0.15), this.pts);
      view.band.alpha.value = spec.bandAlpha;
      view.band.dash.value = 0;
      view.band.draw(this.pts, spec.bandWidth * zoom, zoom);
    }

    if (!overlay) {
      view.hazard.mesh.visible = false;
      view.forecast.mesh.visible = false;
      return chip;
    }
    const crawl = (frame.now / 1000) * spec.hazardCrawl;
    if (age < 0) {
      view.hazard.mesh.visible = false;
      loop(1, this.pts);
      view.forecast.alpha.value = spec.nextAlpha;
      view.forecast.dash.value = spec.nextDash;
      view.forecast.gap.value = spec.nextGap;
      view.forecast.offset.value = 0;
      view.forecast.draw(this.pts, spec.nextWidth, zoom);
      return chip;
    }
    view.forecast.mesh.visible = false;
    if (!show) {
      view.hazard.mesh.visible = false;
      return chip;
    }
    const spread = driftOpen(age, spec.gapClose);
    loop(Math.max(spread, 0.2), this.pts);
    view.hazard.alpha.value = spec.hazardAlpha;
    view.hazard.dash.value = spec.hazardDash;
    view.hazard.gap.value = spec.hazardGap;
    view.hazard.offset.value = -crawl;
    view.hazard.draw(this.pts, spec.hazardWidth, zoom);
    const rows: (readonly [string, string])[] = [[`debris · solid r ≥ ${spec.solidRadius}`, colors.eventWarn]];
    if (age < spec.gapClose) rows.push([`gap narrows · ${formatClock(spec.gapClose - age)}`, colors.eventNext]);
    return this.stack(chip, point.x, point.y, zoom, frame.dpr, rows);
  }

  private stack(start: number, x: number, y: number, zoom: number, dpr: number, rows: readonly (readonly [string, string])[]): number {
    let index = start;
    const spec = this.theme.event;
    for (let i = 0; i < rows.length && index < this.chips.length; i++) {
      const [text, color] = rows[i];
      const chip = this.chips[index];
      const ox = x + 28 / zoom;
      const oy = y + (36 - i * 22) / zoom;
      chip.show(text, color, this.theme.colors.eventPanel, ox, oy, zoom, Math.max(1, dpr), spec);
      index += 1;
    }
    return index;
  }

  private sample(body: Body, t0: number, t1: number, cap: number): void {
    this.pts.length = 0;
    const span = t1 - t0;
    if (!(span > 0)) return;
    const n = Math.min(cap, Math.max(8, Math.ceil(span / 0.5)));
    for (let i = 0; i <= n; i++) {
      const pose = bodyPose(body, t0 + (span * i) / n, this.bodies, this.g);
      this.pts.push({ x: pose.x, y: pose.y });
    }
  }

  private makeConsume(body: Body): ConsumeView {
    const colors = this.theme.colors;
    const spec = this.theme.event;
    const tail = new THREE.Mesh(tailGeometry(), this.tailMaterial());
    (tail.material as THREE.ShaderMaterial).side = THREE.DoubleSide;
    tail.name = `${body.id}-ablation`;
    tail.frustumCulled = false;
    tail.renderOrder = 7;
    tail.visible = false;
    const tip = { value: -spec.tailLength };
    const bodyR = { value: body.radius };
    (tail.material as THREE.ShaderMaterial).uniforms.uTip = tip;
    (tail.material as THREE.ShaderMaterial).uniforms.uBody = bodyR;
    const glowAlpha = { value: 0 };
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.glowMaterial(glowAlpha, spec.glowHot, spec.glowGrad));
    glow.name = `${body.id}-dayside`;
    glow.frustumCulled = false;
    glow.renderOrder = 8;
    glow.visible = false;
    const flashAlpha = { value: 0 };
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.flashMaterial(flashAlpha));
    flash.name = `${body.id}-plunge`;
    flash.frustumCulled = false;
    flash.renderOrder = 11;
    flash.visible = false;
    const rippleAlpha = { value: 0 };
    const rippleRadius = { value: 1 };
    const rippleStar = { value: new THREE.Vector2() };
    const rippleStarR = { value: 1 };
    const rippleZoom = { value: 1 };
    const ripple = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(rippleFrag, {
        uColor: { value: srgbVec(colors.eventRipple) },
        uAlpha: rippleAlpha,
        uRadius: rippleRadius,
        uWidth: { value: spec.rippleWidth },
        uZoom: rippleZoom,
        uStar: rippleStar,
        uStarR: rippleStarR,
      }),
    );
    ripple.name = `${body.id}-ripple`;
    ripple.frustumCulled = false;
    ripple.renderOrder = 10;
    ripple.visible = false;
    const brightAlpha = { value: 0 };
    const bright = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(discFrag, { uColor: { value: srgbVec(colors.eventShock) }, uAlpha: brightAlpha }),
    );
    bright.name = `${body.id}-brighten`;
    bright.frustumCulled = false;
    bright.renderOrder = 9;
    bright.visible = false;
    const spiral = new WorldStroke(180, colors.eventWarn, 12);
    const arrival = new WorldRing(colors.planetXBase, 13);
    const capture = new WorldRing(colors.planetXBase, 13);
    this.object.add(tail, glow, bright, ripple, flash, spiral.mesh, arrival.mesh, capture.mesh);
    return {
      body, tail, tip, bodyR, glow, glowAlpha, flash, flashAlpha, ripple, rippleAlpha, rippleRadius,
      rippleStar, rippleStarR, rippleZoom, bright, brightAlpha, spiral, arrival, capture,
    };
  }

  private makeImpact(body: Body): ImpactView {
    const colors = this.theme.colors;
    const spec = this.theme.event;
    const seed = hashId(body.id);
    const grains = ejectaGrains(seed, {
      count: spec.ejectaCount,
      coneDeg: spec.ejectaCone,
      dist0: spec.ejectaDist0,
      dist1: spec.ejectaDist1,
      r0: spec.ejectaR0,
      r1: spec.ejectaR1,
    });
    const pieces = debrisPieces(seed + 17, {
      chunks: spec.chunkCount,
      dust: spec.dustCount,
      dustHot: spec.dustHot,
      r0: spec.chunkR0,
      r1: spec.chunkR1,
      drift0: spec.driftPx0,
      drift1: spec.driftPx1,
      period0: spec.driftPeriod0,
      period1: spec.driftPeriod1,
    });
    const flashAlpha = { value: 0 };
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.flashMaterial(flashAlpha));
    flash.name = `${body.id}-impact-flash`;
    flash.frustumCulled = false;
    flash.renderOrder = 11;
    flash.visible = false;
    const shock = new WorldRing(colors.eventShock, 12);
    const rim = new WorldRing(colors.eventShock, 12);
    const craterAlphaU = { value: 0 };
    const crater = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.glowMaterial(craterAlphaU, 0, 1));
    crater.name = `${body.id}-crater`;
    crater.frustumCulled = false;
    crater.renderOrder = 8;
    crater.visible = false;
    const ejecta = makeGrains(grains.length, true);
    paintGrains(ejecta, grains.map((grain) => (grain.hot ? colors.eventEjectaHot : ROCK[grain.rock])));
    const ejectaAlpha = ejecta.geometry.getAttribute("aAlpha").array as Float32Array;
    const chunks = makeGrains(spec.chunkCount, true);
    const dust = makeGrains(spec.dustCount, false);
    const chunkColors: string[] = [];
    const dustColors: string[] = [];
    const dustAlpha: number[] = [];
    for (const piece of pieces) {
      if (piece.dust) {
        dustColors.push(piece.hot ? colors.eventEjectaHot : colors.eventEjectaRock);
        dustAlpha.push(0.55 + unitNoise(piece.along) * 0.35);
      } else {
        chunkColors.push(piece.material === 0 ? colors.debrisLightS : colors.debrisLightC);
      }
    }
    paintGrains(chunks, chunkColors);
    paintGrains(dust, dustColors, dustAlpha);
    chunks.name = `${body.id}-debris`;
    dust.name = `${body.id}-dust`;
    const course = new WorldStroke(100, colors.eventWarn, 12);
    const reticle = new WorldRing(colors.eventWarn, 14);
    const ticks = makeTicks(colors.eventWarn, spec.reticleTick1, spec.reticleTick0, spec.reticleWidth);
    ticks.name = `${body.id}-reticle`;
    const hazard = new WorldStroke(40, colors.eventWarn, 12);
    const forecast = new WorldStroke(40, colors.eventNext, 12);
    const band = new WorldStroke(40, colors.eventBand, 6);
    this.object.add(
      flash, shock.mesh, rim.mesh, crater, ejecta, chunks, dust,
      course.mesh, reticle.mesh, ticks, hazard.mesh, forecast.mesh, band.mesh,
    );
    return {
      body, grains, pieces, flash, flashAlpha, shock, rim, crater, craterAlpha: craterAlphaU,
      ejecta, ejectaAlpha, chunks, dust, course, reticle, ticks, hazard, forecast, band,
    };
  }

  private flashMaterial(alpha: { value: number }): THREE.ShaderMaterial {
    const colors = this.theme.colors;
    return shader(flashFrag, {
      uCore: { value: srgbVec(colors.eventFlash) },
      uMid: { value: srgbVec(colors.eventFlashMid) },
      uEdge: { value: srgbVec(colors.eventFlashEdge) },
      uAlpha: alpha,
    });
  }

  private glowMaterial(alpha: { value: number }, hot: number, grad: number): THREE.ShaderMaterial {
    const colors = this.theme.colors;
    return shader(glowFrag, {
      uCore: { value: srgbVec(colors.eventGlow) },
      uMid: { value: srgbVec(colors.eventGlowMid) },
      uEdge: { value: srgbVec(colors.eventGlowEdge) },
      uAlpha: alpha,
      uHot: { value: hot },
      uGrad: { value: grad },
    });
  }

  private tailMaterial(): THREE.ShaderMaterial {
    const colors = this.theme.colors;
    return shader(tailFrag, {
      uA: { value: srgbVec(colors.eventAblation) },
      uB: { value: srgbVec(colors.eventAblationHot) },
      uC: { value: srgbVec(colors.eventAblationPink) },
      uD: { value: srgbVec(colors.eventAblationTail) },
      uTip: { value: -1 },
      uBody: { value: 1 },
    });
  }
}

const ROCK = ["#C8A684", "#9A7A5E", "#8E8478"];

function tailGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(5 * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  return geometry;
}

/** burn-up.svg tail, then the 0.4 s flicker shape. Scaled by heat so the full tail is 90. */
function tailPoints(flicker: number, heat: number): number[][] {
  const shape = [
    [0, -5, 0, -5],
    [-70, -16, -74, -13],
    [-90, 0, -96, 2],
    [-70, 14, -68, 16],
    [0, 5, 0, 5],
  ];
  return shape.map(([ax, ay, bx, by]) => [(ax + (bx - ax) * flicker) * heat, (ay + (by - ay) * flicker) * heat]);
}

function makeGrains(count: number, lit: boolean): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  alphas.fill(1);
  geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: { uLit: { value: lit ? 1 : 0 } },
      vertexShader: grainVert,
      fragmentShader: grainFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
    count,
  );
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.renderOrder = lit ? 9 : 7;
  mesh.visible = false;
  return mesh;
}

function paintGrains(mesh: THREE.InstancedMesh, hexes: readonly string[], alphas?: readonly number[]): void {
  const color = mesh.geometry.getAttribute("aColor") as THREE.InstancedBufferAttribute;
  const alpha = mesh.geometry.getAttribute("aAlpha") as THREE.InstancedBufferAttribute;
  const arr = color.array as Float32Array;
  const a = alpha.array as Float32Array;
  for (let i = 0; i < hexes.length; i++) {
    const [r, g, b] = srgbChannels(hexes[i]);
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
    a[i] = alphas ? alphas[i] : 1;
  }
  color.needsUpdate = true;
  alpha.needsUpdate = true;
}

function makeTicks(color: string, outer: number, inner: number, width: number): THREE.Mesh {
  const positions: number[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * width * 0.5;
    const ny = (dx / len) * width * 0.5;
    positions.push(
      x0 + nx, y0 + ny, 0,
      x0 - nx, y0 - ny, 0,
      x1 - nx, y1 - ny, 0,
      x0 + nx, y0 + ny, 0,
      x1 - nx, y1 - ny, 0,
      x1 + nx, y1 + ny, 0,
    );
  };
  push(-outer, 0, -inner, 0);
  push(inner, 0, outer, 0);
  push(0, -outer, 0, -inner);
  push(0, inner, 0, outer);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(
    geometry,
    shader("void main() { gl_FragColor = vec4(uColor, 1.0); }", { uColor: { value: srgbVec(color) } }),
  );
  (mesh.material as THREE.ShaderMaterial).vertexShader = `
    void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;
  mesh.frustumCulled = false;
  mesh.renderOrder = 14;
  mesh.visible = false;
  return mesh;
}

function shownTime(game: VisualFrame["game"]): number {
  const dt = game.level.dt;
  if (game.mode === "planning") return (game.cursorStep ?? 0) * dt;
  return game.ship.step * dt;
}

function findBody(bodies: readonly Body[], id: string | undefined): Body | undefined {
  if (!id) return undefined;
  for (let i = 0; i < bodies.length; i++) if (bodies[i].id === id) return bodies[i];
  return undefined;
}

function srgbChannels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hexAlpha(hex: string, alpha: number): string {
  const [r, g, b] = srgbChannels(hex).map((channel) => Math.round(channel * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function unitNoise(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
