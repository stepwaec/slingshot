import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import { isEditing } from "../../game/state";
import { hashId } from "../event-look";
import { artMesh, loadArtTexture, poseArt, rasterPixels, type ArtFit } from "../art-sprite";
import { silenceNightRim } from "../surface-art";
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
/** saS2's farthest vertex is 11.35; the sample draws it at scale 1.5. */
const ROCK_RADIUS = 11.35 * 1.5;

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
  fit: ArtFit;
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
  private bakeGen = 0;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "stray";
    this.bodies = level.bodies;
    this.g = level.g;
    for (const body of level.bodies) {
      if (body.look !== "asteroid") continue;
      this.views.push(this.build(body));
    }
    this.bakeOnce();
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
      poseArt(view.rock, view.fit, pose.x, pose.y, view.body.radius, face + tumble);
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

  private build(body: Body): StrayView {
    const spec = this.theme.stray;
    const fit = strayFit(this.theme);
    const rock = artMesh(fit, `${body.id}-rock`);
    rock.renderOrder = 2;
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
    return { body, rock, fit, dust, specks, arrow, head, arrowLength, arrowZoom, arrowOffset, period, chip };
  }

  /** One raster. Later frames only move, turn and scale the mesh. */
  private bakeOnce(): void {
    if (this.views.length === 0) return;
    const gen = ++this.bakeGen;
    for (const view of this.views) {
      void this.paint(view.rock, view.fit, rasterPixels(view.fit.viewW, view.fit.viewH, 2, 1), gen);
    }
  }

  private async paint(mesh: THREE.Mesh, fit: ArtFit, pixels: { width: number; height: number }, gen: number): Promise<void> {
    const texture = await loadArtTexture(fit, pixels, 1);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    if (gen !== this.bakeGen) {
      texture.dispose();
      return;
    }
    const material = mesh.material as THREE.MeshBasicMaterial;
    const previous = material.map;
    material.map = texture;
    material.opacity = 1;
    material.needsUpdate = true;
    previous?.dispose();
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

function strayFit(theme: Theme): ArtFit {
  return {
    url: theme.assets.strayAsteroid,
    viewW: 48,
    viewH: 48,
    svgRadius: ROCK_RADIUS,
    ox: 0,
    oy: 0,
    light: { x: -1, y: 0 },
    spin: "light",
    bake: { tag: "stray-rock", prep: prepStrayRock },
  };
}

/** Keep the S-type rock. Drop the sample dust, arrow and chip. Clear a night-limb rim if one is masked. */
function prepStrayRock(doc: Document): void {
  const svg = doc.documentElement;
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "48");
  svg.setAttribute("height", "48");
  const root = doc.getElementById("strayAsteroid");
  if (!root) return;
  for (const child of [...root.children]) {
    if (!child.querySelector("use")) child.remove();
  }
  const use = root.querySelector("use");
  use?.setAttribute("transform", "translate(24 24) scale(1.5)");
  root.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
  silenceNightRim(doc, root);
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
