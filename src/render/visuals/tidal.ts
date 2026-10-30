import * as THREE from "three";
import { isEditing, type Game } from "../../game/state";
import { simConfigFromLevel } from "../../level/catalog";
import { screenToWorld, worldToScreen } from "../camera";
import { palette, srgb01 } from "../palette";
import {
  bodyPose,
  gravityConstant,
  isCompactBody,
  STRESS_WARN,
  tidalDangerRadius,
  tidalTensorAt,
  type Body,
  type SimConfig,
} from "../../sim/physics";
import { theme } from "../theme";
import { tidalGlyphAxes, tidalPathChip, tidalRingPaint, type TidalChip } from "../tidal-look";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Tidal stress lattice. WebGL instanced quads only: one ellipse per screen
 * cell, stretched on the summed tidal tensor. No SVG bake and no
 * `?sprites=1` branch. design/threejs-notes.md §26.
 */
export const createTidal: VisualFactory = () => new TidalVisual();

const MAX = 16384;
const PAD = 2.5;

const ringVert = /* glsl */ `
attribute vec2 aCenter;
attribute vec4 aGeom;
attribute vec3 aColor;
attribute vec2 aStyle;
varying vec2 vPx;
varying vec3 vColor;
varying vec2 vStyle;
varying vec2 vAxes;
void main() {
  vec2 halfExt = vec2(aGeom.x, aGeom.y) + vec2(${PAD.toFixed(1)});
  vec2 local = position.xy * halfExt;
  float c = aGeom.z;
  float s = aGeom.w;
  vec2 screen = aCenter + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vPx = local;
  vAxes = aGeom.xy;
  vColor = aColor;
  vStyle = aStyle;
  vec4 placed = instanceMatrix * vec4(screen, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * placed;
}
`;

const ringFrag = /* glsl */ `
varying vec2 vPx;
varying vec3 vColor;
varying vec2 vStyle;
varying vec2 vAxes;
void main() {
  vec2 axes = max(vAxes, vec2(0.001));
  float e = length(vPx / axes);
  float fw = max(fwidth(e), 0.0001);
  float distPx = (e - 1.0) / fw;
  float stroke = 1.0 - smoothstep(0.5, 1.5, abs(distPx));
  float fill = (1.0 - smoothstep(0.0, 1.0, distPx)) * vStyle.y;
  float alpha = max(fill, stroke * vStyle.x);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

function chartTime(game: Game): number {
  return game.mode === "planning" ? 0 : game.ship.t;
}

function paintPlate(
  text: string,
  cssW: number,
  cssH: number,
  radius: number,
  fill: number,
  stroke: number,
  fontPx: number,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const dpr = 2;
  canvas.width = Math.max(1, Math.ceil(cssW * dpr));
  canvas.height = Math.max(1, Math.ceil(cssH * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const inset = dpr * 0.5;
  ctx.beginPath();
  ctx.roundRect(inset, inset, canvas.width - dpr, canvas.height - dpr, radius * dpr);
  ctx.fillStyle = `rgba(10, 13, 26, ${fill})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 90, 95, ${stroke})`;
  ctx.lineWidth = dpr;
  ctx.stroke();
  ctx.fillStyle = palette.tidalCritical;
  ctx.font = `${fontPx * dpr}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 5 * dpr, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makePlate(cssW: number, cssH: number, map: THREE.Texture | null): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.visible = false;
  mesh.scale.set(cssW, cssH, 1);
  return mesh;
}

class TidalVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly rings: THREE.InstancedMesh;
  private readonly centers: Float32Array;
  private readonly geoms: Float32Array;
  private readonly colors: Float32Array;
  private readonly styles: Float32Array;
  private readonly boundary: THREE.Mesh[] = [];
  private readonly boundaryMap: THREE.Texture | null;
  private readonly pathChip: THREE.Mesh;
  private key = "";
  private chipKey = "";
  private forecast: Game["prediction"] | null = null;
  private chip: TidalChip | null = null;

  constructor() {
    this.object.name = "tidal-stress";
    const spec = theme.tidal;
    this.centers = new Float32Array(MAX * 2);
    this.geoms = new Float32Array(MAX * 4);
    this.colors = new Float32Array(MAX * 3);
    this.styles = new Float32Array(MAX * 2);
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.setAttribute("aCenter", new THREE.InstancedBufferAttribute(this.centers, 2));
    geometry.setAttribute("aGeom", new THREE.InstancedBufferAttribute(this.geoms, 4));
    geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(this.colors, 3));
    geometry.setAttribute("aStyle", new THREE.InstancedBufferAttribute(this.styles, 2));
    this.rings = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
      MAX,
    );
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 0;
    this.rings.name = "tidal-rings";
    const identity = new THREE.Matrix4();
    for (let i = 0; i < MAX; i++) this.rings.setMatrixAt(i, identity);
    this.rings.instanceMatrix.needsUpdate = true;
    this.object.add(this.rings);

    this.boundaryMap = paintPlate(
      "tidal 3 · hull",
      spec.boundaryWidth,
      spec.boundaryHeight,
      4,
      0.92,
      0.6,
      9.5,
    );
    this.pathChip = makePlate(48, spec.chipHeight, null);
    this.pathChip.name = "tidal-path-chip";
    this.pathChip.renderOrder = 8;
    this.object.add(this.pathChip);
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const show = game.tidal && isEditing(game);
    this.object.visible = show;
    if (!show || frame.width < 2 || frame.height < 2) {
      this.key = "";
      this.rings.count = 0;
      this.pathChip.visible = false;
      this.hideBoundary();
      return;
    }
    const time = chartTime(game);
    const config = simConfigFromLevel(game.level);
    const zoom = game.camera.zoom > 0 ? game.camera.zoom : 1;
    const key = `${game.level.id}:${game.camera.x}:${game.camera.y}:${zoom}:${frame.width}:${frame.height}:${Math.floor(time * 4)}`;
    if (key !== this.key) {
      this.key = key;
      this.sample(frame, config, time, zoom);
    }
    this.syncChip(frame, config);
  }

  private sample(frame: VisualFrame, config: SimConfig, time: number, zoom: number): void {
    const spec = theme.tidal;
    const cell = spec.cell;
    const floor = spec.show * STRESS_WARN;
    const bodies = config.bodies;
    const g = gravityConstant(config);
    const poses: { x: number; y: number; radius: number }[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (!(body.radius > 0)) continue;
      const pose = bodyPose(body, time, bodies, g);
      poses.push({ x: pose.x, y: pose.y, radius: body.radius });
    }
    const pad = spec.bodyPad / zoom;
    let count = 0;
    for (let y = cell / 2; y < frame.height && count < MAX; y += cell) {
      for (let x = cell / 2; x < frame.width && count < MAX; x += cell) {
        const world = screenToWorld(frame.game.camera, frame.width, frame.height, x, y);
        if (this.blocked(world.x, world.y, poses, pad)) continue;
        const field = tidalTensorAt(world.x, world.y, config, time);
        if (!(field.stress >= floor)) continue;
        const axes = tidalGlyphAxes(field.stress);
        const paint = tidalRingPaint(field.stress);
        const rgb = srgb01(paint.hex);
        const o2 = count * 2;
        const o4 = count * 4;
        const o3 = count * 3;
        this.centers[o2] = x;
        this.centers[o2 + 1] = frame.height - y;
        this.geoms[o4] = axes.a;
        this.geoms[o4 + 1] = axes.b;
        this.geoms[o4 + 2] = Math.cos(field.angle);
        this.geoms[o4 + 3] = Math.sin(field.angle);
        this.colors[o3] = rgb[0];
        this.colors[o3 + 1] = rgb[1];
        this.colors[o3 + 2] = rgb[2];
        this.styles[o2] = paint.stroke;
        this.styles[o2 + 1] = paint.fill;
        count += 1;
      }
    }
    this.rings.count = count;
    const geometry = this.rings.geometry;
    (geometry.getAttribute("aCenter") as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aGeom") as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aColor") as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aStyle") as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.placeBoundary(frame, config, time);
  }

  private blocked(
    x: number,
    y: number,
    poses: readonly { x: number; y: number; radius: number }[],
    pad: number,
  ): boolean {
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i];
      if (Math.hypot(x - pose.x, y - pose.y) < pose.radius + pad) return true;
    }
    return false;
  }

  private placeBoundary(frame: VisualFrame, config: SimConfig, time: number): void {
    const spec = theme.tidal;
    const strength = config.tidalStrength ?? 0;
    const g = gravityConstant(config);
    const ang = Math.atan2(1, 0.8);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    let n = 0;
    if (strength > 0 && this.boundaryMap) {
      for (let i = 0; i < config.bodies.length; i++) {
        const body: Body = config.bodies[i];
        if (!isCompactBody(body)) continue;
        const radius = tidalDangerRadius(body, g, strength);
        if (!(radius > 0)) continue;
        const pose = bodyPose(body, time, config.bodies, g);
        const screen = worldToScreen(
          frame.game.camera,
          frame.width,
          frame.height,
          pose.x + cos * radius,
          pose.y + sin * radius,
        );
        const mesh = this.boundaryMesh(n);
        const cssW = spec.boundaryWidth;
        mesh.position.set(screen.x + cssW / 2, frame.height - screen.y, 2);
        mesh.visible = true;
        n += 1;
      }
    }
    for (let i = n; i < this.boundary.length; i++) this.boundary[i].visible = false;
  }

  private boundaryMesh(index: number): THREE.Mesh {
    const existing = this.boundary[index];
    if (existing) return existing;
    const spec = theme.tidal;
    const mesh = makePlate(spec.boundaryWidth, spec.boundaryHeight, this.boundaryMap);
    mesh.name = "tidal-boundary-chip";
    this.object.add(mesh);
    this.boundary.push(mesh);
    return mesh;
  }

  private hideBoundary(): void {
    for (let i = 0; i < this.boundary.length; i++) this.boundary[i].visible = false;
  }

  private syncChip(frame: VisualFrame, config: SimConfig): void {
    const game = frame.game;
    if (game.prediction !== this.forecast) {
      this.forecast = game.prediction;
      this.chip = tidalPathChip(game.prediction.path, config);
      const text = this.chip?.text ?? "";
      if (text !== this.chipKey) {
        this.chipKey = text;
        this.repaintPath(text);
      }
    }
    const chip = this.chip;
    if (!chip) {
      this.pathChip.visible = false;
      return;
    }
    const screen = worldToScreen(frame.game.camera, frame.width, frame.height, chip.x, chip.y);
    const cssW = this.pathChip.scale.x;
    const cssH = this.pathChip.scale.y;
    const left = screen.x + 12;
    const top = screen.y - cssH - 8;
    this.pathChip.position.set(left + cssW / 2, frame.height - top - cssH / 2, 3);
    this.pathChip.visible = true;
  }

  private repaintPath(text: string): void {
    const material = this.pathChip.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    if (!text || typeof document === "undefined") {
      material.map = null;
      material.needsUpdate = true;
      this.pathChip.scale.set(1, theme.tidal.chipHeight, 1);
      return;
    }
    const font = theme.tidal.chipFont;
    const pad = theme.tidal.chipPad;
    const canvas = document.createElement("canvas");
    const measure = canvas.getContext("2d");
    if (measure) measure.font = `${font}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    const textPx = measure ? measure.measureText(text).width : text.length * font * 0.6;
    const width = Math.ceil(textPx + pad * 2);
    const map = paintPlate(
      text,
      width,
      theme.tidal.chipHeight,
      theme.tidal.chipRadius,
      theme.tidal.chipFill,
      theme.tidal.chipStroke,
      font,
    );
    material.map = map;
    material.needsUpdate = true;
    this.pathChip.scale.set(width, theme.tidal.chipHeight, 1);
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
