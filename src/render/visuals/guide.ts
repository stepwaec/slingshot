import * as THREE from "three";
import { projectToScreen } from "../camera";
import { srgb01 } from "../palette";
import { showPath, shownNow } from "../path-frame";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import type { GuideIntent } from "../../sim/guidance";
import type { Vec2 } from "../../sim/physics";

/**
 * Faint alternative to the predicted path.
 * Samples are the guide forecast, framed with the same ghost-body path as
 * the plan. This only runs while the offer is on screen, and it does not
 * integrate.
 */
export const createGuide: VisualFactory = (theme) => new GuideVisual(theme);

const MAX_POINTS = 480;

const vert = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

const HALF_PX = 1.05;

class GuideVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly color: [number, number, number];
  private readonly flyby: Ribbon;
  private readonly capture: Ribbon;
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private source: object | null = null;
  private selected: GuideIntent | null = null;
  private camX = Number.NaN;
  private camY = Number.NaN;
  private zoom = Number.NaN;
  private width = 0;
  private height = 0;

  constructor(theme: Theme) {
    this.color = srgb01(theme.colors.path);
    this.object.name = "guide";
    this.flyby = makeRibbon("guide-flyby");
    this.capture = makeRibbon("guide-capture");
    this.object.add(this.flyby.mesh, this.capture.mesh);
  }

  update(frame: VisualFrame): void {
    const { game, width, height } = frame;
    const guide = game.guide;
    const editing = game.mode === "planning" || game.mode === "paused";
    if (!editing || !guide) {
      this.flyby.mesh.visible = false;
      this.capture.mesh.visible = false;
      this.source = null;
      return;
    }
    const camera = game.camera;
    if (
      guide === this.source &&
      guide.selected === this.selected &&
      camera.x === this.camX &&
      camera.y === this.camY &&
      camera.zoom === this.zoom &&
      width === this.width &&
      height === this.height
    ) {
      return;
    }
    this.source = guide;
    this.selected = guide.selected;
    this.camX = camera.x;
    this.camY = camera.y;
    this.zoom = camera.zoom;
    this.width = width;
    this.height = height;
    const now = shownNow(game.mode, game.ship.step, game.level.dt);
    this.draw(this.flyby, "flyby", frame, now);
    this.draw(this.capture, "capture", frame, now);
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private draw(ribbon: Ribbon, intent: GuideIntent, frame: VisualFrame, now: number): void {
    const guide = frame.game.guide;
    const option = guide?.options.find((item) => item.intent === intent);
    if (!option || option.path.length < 2) {
      ribbon.mesh.visible = false;
      return;
    }
    const framed = showPath(option.path, frame.game.level.bodies, frame.game.level.g, frame.game.level.dt, now);
    const selected = guide?.selected === intent;
    const alpha = selected ? 0.72 : guide?.selected ? 0.22 : 0.4;
    const count = project(framed, frame.width, frame.height, ribbon.xs, ribbon.ys, this.scratch);
    const segs = stroke(ribbon, count, this.color, alpha);
    ribbon.mesh.visible = segs > 0;
  }
}

interface Ribbon {
  mesh: THREE.Mesh;
  pos: Float32Array;
  col: Float32Array;
  xs: Float32Array;
  ys: Float32Array;
}

function makeRibbon(name: string): Ribbon {
  const verts = (MAX_POINTS - 1) * 6;
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(col, 4));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return { mesh, pos, col, xs: new Float32Array(MAX_POINTS), ys: new Float32Array(MAX_POINTS) };
}

function project(
  samples: readonly { x: number; y: number }[],
  width: number,
  height: number,
  xs: Float32Array,
  ys: Float32Array,
  scratch: Vec2,
): number {
  const total = samples.length;
  if (total < 2) return 0;
  const stride = Math.max(1, Math.ceil(total / MAX_POINTS));
  let count = 0;
  for (let i = 0; i < total && count < MAX_POINTS; i += stride) {
    const index = i + stride >= total ? total - 1 : i;
    projectToScreen(samples[index].x, samples[index].y, width, height, scratch);
    xs[count] = scratch.x;
    ys[count] = height - scratch.y;
    count += 1;
    if (index === total - 1) break;
  }
  return count;
}

function stroke(ribbon: Ribbon, count: number, color: [number, number, number], alpha: number): number {
  const geometry = ribbon.mesh.geometry;
  if (count < 2) {
    geometry.setDrawRange(0, 0);
    return 0;
  }
  let segs = 0;
  const maxSegs = MAX_POINTS - 1;
  for (let i = 0; i < count - 1 && segs < maxSegs; i++) {
    const u0 = i / (count - 1);
    const u1 = (i + 1) / (count - 1);
    const a0 = alpha * (1 - 0.45 * u0 * u0);
    const a1 = alpha * (1 - 0.45 * u1 * u1);
    segs = pushQuad(ribbon, segs, ribbon.xs[i], ribbon.ys[i], ribbon.xs[i + 1], ribbon.ys[i + 1], a0, a1, color);
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.aColor.needsUpdate = true;
  geometry.setDrawRange(0, segs * 6);
  return segs;
}

function pushQuad(
  ribbon: Ribbon,
  segs: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  a0: number,
  a1: number,
  color: [number, number, number],
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * HALF_PX;
  const oy = (dx / len) * HALF_PX;
  const base = segs * 6;
  const xs = [x0 + ox, x0 - ox, x1 + ox, x0 - ox, x1 - ox, x1 + ox];
  const ys = [y0 + oy, y0 - oy, y1 + oy, y0 - oy, y1 - oy, y1 + oy];
  const alphas = [a0, a0, a1, a0, a1, a1];
  for (let i = 0; i < 6; i++) {
    const v = (base + i) * 3;
    ribbon.pos[v] = xs[i];
    ribbon.pos[v + 1] = ys[i];
    ribbon.pos[v + 2] = 0;
    const c = (base + i) * 4;
    ribbon.col[c] = color[0];
    ribbon.col[c + 1] = color[1];
    ribbon.col[c + 2] = color[2];
    ribbon.col[c + 3] = alphas[i];
  }
  return segs + 1;
}
