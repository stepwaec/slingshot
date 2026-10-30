import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import { isEditing } from "../../game/state";
import { hashId } from "../event-look";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * A lone asteroid outside any belt. design/assets/bodies/stray-asteroid.svg.
 * The silhouette is the sample's S-type rock, lit toward the brightest mass.
 * Dust and the drift arrow do not touch the sim.
 */
export const createStray: VisualFactory = (theme, level) => new StrayVisual(theme, level);

const TAU = Math.PI * 2;
const SILHOUETTE = "M-1.42 8.23 L-10.97 2.90 L-10.83 -2.89 L-1.27 -8.16 L6.09 -7.15 L8.12 -0.81 L4.77 9.54 Z";

const dustVert = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
varying vec2 vLocal;
void main() {
  vAlpha = aAlpha;
  vLocal = position.xy * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const dustFrag = /* glsl */ `
varying float vAlpha;
varying vec2 vLocal;
uniform vec3 uColor;
void main() {
  if (length(vLocal) > 1.0) discard;
  gl_FragColor = vec4(uColor, vAlpha);
}
`;

const arrowFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uDash;
uniform float uGap;
uniform float uOffset;
uniform float uLength;
uniform float uZoom;
void main() {
  float y = abs(vLocal.y);
  float fw = max(fwidth(y), 0.02);
  float band = 1.0 - smoothstep(0.5 - fw, 0.5 + fw, y);
  float along = (vLocal.x + 0.5) * uLength * uZoom;
  float period = uDash + uGap;
  float x = mod(along - uOffset + period * 8.0, period);
  float aa = max(fwidth(along), 0.5);
  float on = 1.0 - smoothstep(uDash - aa, uDash + aa, x);
  float a = band * on * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const arrowVert = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface Speck {
  along: number;
  side: number;
  radius: number;
  alpha: number;
}

interface StrayView {
  body: Body;
  rock: THREE.Mesh;
  dust: THREE.InstancedMesh;
  specks: Speck[];
  arrow: THREE.Mesh;
  head: THREE.Mesh;
  arrowLength: { value: number };
  arrowZoom: { value: number };
  arrowOffset: { value: number };
  period: number;
  chip: Chip;
}

class StrayVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly bodies: readonly Body[];
  private readonly g: number;
  private readonly views: StrayView[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "stray";
    this.bodies = level.bodies;
    this.g = level.g;
    const texture = rockTexture();
    for (const body of level.bodies) {
      if (body.look !== "asteroid") continue;
      this.views.push(this.build(body, texture));
    }
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = (game.mode === "planning" ? 0 : game.ship.step) * game.level.dt;
    const seconds = frame.now / 1000;
    const zoom = Math.max(0.05, game.camera.zoom);
    const editing = isEditing(game);
    const spec = this.theme.stray;
    for (const view of this.views) {
      const pose = bodyPose(view.body, time, this.bodies, this.g);
      const star = brightest(pose.x, pose.y, time, this.bodies, this.g);
      const face = star ? Math.atan2(star.y - pose.y, star.x - pose.x) - Math.PI : 0;
      const tumble = view.period > 0 ? (seconds / view.period) * TAU : 0;
      view.rock.position.set(pose.x, pose.y, 0);
      view.rock.rotation.z = face + tumble;
      view.rock.scale.set(view.body.radius * 2, view.body.radius * 2, 1);
      const speed = Math.hypot(pose.vx, pose.vy);
      const dx = speed > 1e-4 ? pose.vx / speed : 1;
      const dy = speed > 1e-4 ? pose.vy / speed : 0;
      const trail = spec.trail * (view.body.radius / spec.sampleRadius);
      const px = view.body.radius / spec.sampleRadius;
      for (let i = 0; i < view.specks.length; i += 1) {
        const speck = view.specks[i];
        this.dummy.position.set(
          pose.x - dx * speck.along * trail + -dy * speck.side * px,
          pose.y - dy * speck.along * trail + dx * speck.side * px,
          0,
        );
        const size = speck.radius * px;
        this.dummy.scale.set(size, size, 1);
        this.dummy.rotation.z = 0;
        this.dummy.updateMatrix();
        view.dust.setMatrixAt(i, this.dummy.matrix);
      }
      view.dust.instanceMatrix.needsUpdate = true;
      const show = editing && speed > 1e-3;
      view.arrow.visible = show;
      view.head.visible = show;
      view.chip.mesh.visible = show;
      if (!show) continue;
      view.arrowLength.value = trail;
      view.arrowZoom.value = zoom;
      view.arrowOffset.value = -seconds * 12;
      view.arrow.position.set(pose.x + dx * trail * 0.5, pose.y + dy * trail * 0.5, 0);
      view.arrow.rotation.z = Math.atan2(dy, dx);
      view.arrow.scale.set(trail, spec.arrowWidth / zoom, 1);
      const hx = pose.x + dx * trail;
      const hy = pose.y + dy * trail;
      view.head.position.set(hx, hy, 0);
      view.head.rotation.z = Math.atan2(dy, dx);
      view.head.scale.set(10 / zoom, 8 / zoom, 1);
      view.chip.show(
        `stray asteroid · solid r ${Math.round(view.body.radius)}`,
        this.theme.colors.text,
        this.theme.colors.eventPanel,
        pose.x + 18 / zoom,
        pose.y + 22 / zoom,
        zoom,
        Math.max(1, frame.dpr),
        this.theme.event,
      );
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private build(body: Body, texture: THREE.CanvasTexture): StrayView {
    const spec = this.theme.stray;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const rock = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    rock.frustumCulled = false;
    rock.renderOrder = 2;
    rock.name = `${body.id}-rock`;
    const seed = hashId(body.id);
    const rnd = mulberry(seed);
    const specks: Speck[] = [];
    for (let i = 0; i < spec.specks; i += 1) {
      const along = 0.04 + rnd() * 0.96;
      specks.push({
        along,
        side: (rnd() * 2 - 1) * (2 + rnd() * 6) * (0.35 + along),
        radius: 0.5 + rnd() * 0.7,
        alpha: (1 - along) * (0.35 + rnd() * 0.5),
      });
    }
    const alpha = new Float32Array(specks.map((speck) => speck.alpha));
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alpha, 1));
    const dust = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: srgbVec(this.theme.colors.rockDust) } },
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
      specks.length,
    );
    dust.frustumCulled = false;
    dust.renderOrder = 1;
    dust.name = `${body.id}-dust`;
    const arrowLength = { value: 1 };
    const arrowZoom = { value: 1 };
    const arrowOffset = { value: 0 };
    const arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      shader(arrowFrag, {
        uColor: { value: srgbVec(this.theme.colors.driftArrow) },
        uAlpha: { value: spec.arrowAlpha },
        uDash: { value: spec.arrowDash },
        uGap: { value: spec.arrowGap },
        uOffset: arrowOffset,
        uLength: arrowLength,
        uZoom: arrowZoom,
      }),
    );
    (arrow.material as THREE.ShaderMaterial).vertexShader = arrowVert;
    arrow.frustumCulled = false;
    arrow.renderOrder = 6;
    arrow.name = `${body.id}-drift`;
    const head = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      shader(headFrag, { uColor: { value: srgbVec(this.theme.colors.driftArrow) }, uAlpha: { value: spec.arrowAlpha } }),
    );
    head.frustumCulled = false;
    head.renderOrder = 6;
    head.name = `${body.id}-drift-head`;
    const chip = new Chip(24);
    const span = spec.tumbleMax - spec.tumbleMin;
    const period = spec.tumbleMin + (seed % 1000) / 1000 * span;
    this.object.add(dust, rock, arrow, head, chip.mesh);
    return { body, rock, dust, specks, arrow, head, arrowLength, arrowZoom, arrowOffset, period, chip };
  }
}

const headFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float x = vLocal.x;
  float y = abs(vLocal.y);
  float edge = 0.5 - x;
  if (x < -0.2 || y > edge) discard;
  gl_FragColor = vec4(uColor, uAlpha);
}
`;

function brightest(
  x: number,
  y: number,
  time: number,
  bodies: readonly Body[],
  g: number,
): { x: number; y: number } | null {
  let best = 0;
  let found: { x: number; y: number } | null = null;
  for (const body of bodies) {
    if (body.kind !== "star" && body.kind !== "blackhole") continue;
    if (!(body.mass > 0)) continue;
    const pose = bodyPose(body, time, bodies, g);
    const d2 = (pose.x - x) ** 2 + (pose.y - y) ** 2;
    if (!(d2 > 1)) continue;
    const weight = body.mass / d2;
    if (weight > best) {
      best = weight;
      found = pose;
    }
  }
  return found;
}

let textureCache: THREE.CanvasTexture | null = null;

function rockTexture(): THREE.CanvasTexture {
  if (textureCache) return textureCache;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    textureCache = new THREE.CanvasTexture(canvas);
    return textureCache;
  }
  const path = new Path2D(SILHOUETTE);
  ctx.save();
  ctx.translate(64, 64);
  ctx.scale(50 / 12, 50 / 12);
  ctx.fillStyle = "#F0DCC0";
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  const face = ctx.createLinearGradient(-14, 0, 14, 0);
  face.addColorStop(0, "#C8A684");
  face.addColorStop(0.45, "#9A7A5E");
  face.addColorStop(1, "#5A4636");
  ctx.fillStyle = face;
  ctx.fillRect(-20, -20, 40, 40);
  ctx.fillStyle = "rgba(192, 86, 42, 0.45)";
  ctx.beginPath();
  ctx.ellipse(0.4, 5.1, 2, 1.2, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-0.2, -2.3, 2.8, 2.5, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-5.4, -4.6, 2.4, 1.8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(240, 220, 192, 0.7)";
  ctx.beginPath();
  ctx.arc(2.5, -0.4, 1.7, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#5A4636";
  ctx.beginPath();
  ctx.arc(1.9, -0.4, 1.4, 0, TAU);
  ctx.fill();
  const night = ctx.createLinearGradient(-14, 0, 14, 0);
  night.addColorStop(0.5, "rgba(18, 14, 20, 0)");
  night.addColorStop(0.6, "rgba(255, 148, 85, 0.18)");
  night.addColorStop(0.64, "rgba(18, 14, 20, 0.6)");
  night.addColorStop(1, "rgba(18, 14, 20, 0.88)");
  ctx.fillStyle = night;
  ctx.fillRect(-20, -20, 40, 40);
  ctx.restore();
  ctx.strokeStyle = "rgba(18, 14, 20, 0.55)";
  ctx.lineWidth = 0.5;
  ctx.stroke(path);
  ctx.restore();
  textureCache = new THREE.CanvasTexture(canvas);
  textureCache.colorSpace = THREE.SRGBColorSpace;
  textureCache.magFilter = THREE.LinearFilter;
  textureCache.minFilter = THREE.LinearMipmapLinearFilter;
  textureCache.generateMipmaps = true;
  textureCache.needsUpdate = true;
  return textureCache;
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
    this.mesh.name = "stray-chip";
  }

  show(
    text: string,
    color: string,
    fill: string,
    x: number,
    y: number,
    zoom: number,
    dpr: number,
    spec: Theme["event"],
  ): void {
    const key = `${text}|${color}|${dpr}`;
    if (key !== this.key) {
      this.key = key;
      this.paint(text, color, fill, dpr, spec);
    }
    const image = this.material.map?.image as { width: number; height: number } | undefined;
    const cssW = image ? image.width / Math.max(1, dpr) : 80;
    const w = cssW / zoom;
    const h = spec.chipHeight / zoom;
    this.mesh.scale.set(w, h, 1);
    this.mesh.position.set(x + w / 2, y - h / 2, 0);
    this.mesh.visible = true;
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
    ctx.strokeStyle = hexAlpha(color, 0.75);
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, spec.chipPad * dpr, 12 * dpr);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.generateMipmaps = false;
    map.needsUpdate = true;
    this.material.map?.dispose();
    this.material.map = map;
    this.material.needsUpdate = true;
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
