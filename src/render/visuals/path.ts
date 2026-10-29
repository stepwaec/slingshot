import * as THREE from "three";
import type { Vec2 } from "../../sim/physics";
import { projectToScreen } from "../camera";
import { srgb01 } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Predicted path: round dots in screen pixels, plus the closed capture ellipse.
 * Swap this factory to draw the same samples another way. Dot spacing and
 * colours come from the theme; the samples come from the game prediction.
 */
export const createPath: VisualFactory = (theme) => new PathVisual(theme);

const dotVert = /* glsl */ `
attribute vec4 aColor;
attribute vec2 aUv;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = aColor;
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const dotFrag = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
uniform float uSpan;
void main() {
  float d = length(vUv - vec2(0.5)) * uSpan;
  float alpha = 1.0 - smoothstep(2.15, 2.85, d);
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
}
`;

interface Dots {
  mesh: THREE.Mesh;
  centers: Float32Array;
  colors: Float32Array;
  quadPos: Float32Array;
  quadCol: Float32Array;
}

interface Sample {
  x: number;
  y: number;
  step: number;
  rate: number;
}

class PathVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly path: Dots;
  private readonly orbit: Dots;
  private readonly endRing: THREE.Mesh;
  private readonly which: Uint8Array;
  private readonly dotRate: Float32Array;
  private readonly cursor: Sample = { x: 0, y: 0, step: 0, rate: 1 };
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private chain: readonly { x: number; y: number; step?: number; rate?: number }[] = [];
  private chainPrefix: { x: number; y: number; step: number; rate: number } | null = null;
  private chainClose = false;
  private pathPred: VisualFrame["game"]["prediction"] | null = null;
  private pathCamX = Number.NaN;
  private pathCamY = Number.NaN;
  private pathZoom = Number.NaN;
  private pathW = 0;
  private pathH = 0;

  constructor(theme: Theme) {
    this.theme = theme;
    const max = theme.path.maxDots;
    this.which = new Uint8Array(max);
    this.dotRate = new Float32Array(max);
    this.object.name = "path";
    this.object.userData.asset = theme.assets.predictedPath;
    this.path = makeDots(theme, 2);
    this.path.mesh.name = "predicted-path";
    this.orbit = makeDots(theme, 2);
    this.orbit.mesh.name = "orbit";
    this.endRing = new THREE.Mesh(
      new THREE.RingGeometry(theme.path.endRingInner, theme.path.endRingOuter, 48),
      new THREE.MeshBasicMaterial({
        color: theme.colors.path,
        transparent: true,
        opacity: theme.path.endRingAlpha,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.endRing.frustumCulled = false;
    this.endRing.renderOrder = 3;
    this.endRing.visible = false;
    this.object.add(this.path.mesh, this.orbit.mesh, this.endRing);
  }

  update(frame: VisualFrame): void {
    const { game, width, height } = frame;
    const planning = game.mode === "planning" || game.mode === "paused";
    // The tilted sheet draws the plan on its surface. The screen-space dots
    // would sit on the flat projection instead.
    if (!planning || game.gravity === "sheet") {
      this.path.mesh.visible = false;
      this.orbit.mesh.visible = false;
      this.endRing.visible = false;
      this.pathPred = null;
      return;
    }
    const camera = game.camera;
    if (
      game.prediction === this.pathPred &&
      camera.x === this.pathCamX &&
      camera.y === this.pathCamY &&
      camera.zoom === this.pathZoom &&
      width === this.pathW &&
      height === this.pathH
    ) {
      return;
    }
    this.pathPred = game.prediction;
    this.pathCamX = camera.x;
    this.pathCamY = camera.y;
    this.pathZoom = camera.zoom;
    this.pathW = width;
    this.pathH = height;

    let splitStep = game.initial.step;
    const snaps = game.prediction.snapshots;
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].reached) splitStep = snaps[i].step;
    }
    const origin = game.mode === "paused" ? game.ship : game.initial;
    this.chain = game.prediction.path;
    this.chainPrefix = { x: origin.x, y: origin.y, step: origin.step, rate: origin.rate };
    this.chainClose = false;
    const count = this.sample(width, height, this.path.centers, splitStep);
    const head = srgb01(this.theme.colors.path);
    const tailColor = tailHex(game, this.theme);
    const tail = srgb01(tailColor);
    this.paint(this.path.colors, count, head, tail, true);
    commitDots(this.path, count, this.theme.path.dotSpanPx);
    if (count > 0) {
      const last = (count - 1) * 2;
      this.endRing.position.set(this.path.centers[last], this.path.centers[last + 1], 0);
      this.endRing.visible = true;
      const ringColor = this.which[count - 1] === 0 ? this.theme.colors.path : tailColor;
      (this.endRing.material as THREE.MeshBasicMaterial).color.set(ringColor);
    } else {
      this.endRing.visible = false;
    }

    const orbit = game.prediction.orbit;
    if (orbit && orbit.length > 2) {
      this.chain = orbit;
      this.chainPrefix = null;
      this.chainClose = true;
      const n = this.sample(width, height, this.orbit.centers, -1);
      const mint = srgb01(this.theme.colors.resultWin);
      for (let i = 0; i < n; i++) this.which[i] = 1;
      this.paint(this.orbit.colors, n, mint, mint, false);
      for (let i = 0; i < n; i++) this.orbit.colors[i * 4 + 3] = this.theme.path.orbitAlpha;
      commitDots(this.orbit, n, this.theme.path.dotSpanPx);
    } else {
      this.orbit.mesh.visible = false;
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private sample(width: number, height: number, centers: Float32Array, splitStep: number): number {
    const total = this.chain.length + (this.chainPrefix ? 1 : 0) + (this.chainClose ? 1 : 0);
    const max = this.theme.path.maxDots;
    const spacing = this.theme.path.spacingPx;
    if (total === 0) return 0;
    this.read(0);
    projectToScreen(this.cursor.x, this.cursor.y, width, height, this.scratch);
    let prevX = this.scratch.x;
    let prevY = this.scratch.y;
    centers[0] = prevX;
    centers[1] = height - prevY;
    this.which[0] = this.cursor.step <= splitStep ? 0 : 1;
    this.dotRate[0] = this.cursor.rate;
    let prevRate = this.cursor.rate;
    let count = 1;
    let carry = 0;
    for (let i = 1; i < total && count < max; i++) {
      this.read(i);
      const step = this.cursor.step;
      const curRate = this.cursor.rate;
      projectToScreen(this.cursor.x, this.cursor.y, width, height, this.scratch);
      const curX = this.scratch.x;
      const curY = this.scratch.y;
      const seg = Math.hypot(curX - prevX, curY - prevY);
      let t = spacing - carry;
      while (t <= seg && count < max) {
        const u = seg > 0 ? t / seg : 0;
        const x = prevX + (curX - prevX) * u;
        const y = prevY + (curY - prevY) * u;
        const o = count * 2;
        centers[o] = x;
        centers[o + 1] = height - y;
        this.which[count] = step <= splitStep ? 0 : 1;
        this.dotRate[count] = prevRate + (curRate - prevRate) * u;
        count += 1;
        t += spacing;
      }
      carry = (carry + seg) % spacing;
      prevX = curX;
      prevY = curY;
      prevRate = curRate;
    }
    return count;
  }

  private read(index: number): void {
    if (this.chainPrefix && index === 0) {
      this.cursor.x = this.chainPrefix.x;
      this.cursor.y = this.chainPrefix.y;
      this.cursor.step = this.chainPrefix.step;
      this.cursor.rate = this.chainPrefix.rate;
      return;
    }
    const i = index - (this.chainPrefix ? 1 : 0);
    const point = i < this.chain.length ? this.chain[i] : this.chain[0];
    this.cursor.x = point.x;
    this.cursor.y = point.y;
    this.cursor.step = point.step ?? i;
    this.cursor.rate = point.rate ?? 1;
  }

  private paint(
    colors: Float32Array,
    count: number,
    head: [number, number, number],
    tail: [number, number, number],
    byRate: boolean,
  ): void {
    const split = Math.floor(count * this.theme.path.dimAfter);
    const hot = srgb01(this.theme.colors.starCorona);
    for (let i = 0; i < count; i++) {
      const rate = this.dotRate[i];
      const slow = 1 - Math.min(1, Math.max(0, rate));
      const glow = slow * slow;
      const base = this.which[i] === 0 ? head : tail;
      const rgb = byRate ? mixRgb(base, hot, glow) : base;
      const o = i * 4;
      colors[o] = rgb[0];
      colors[o + 1] = rgb[1];
      colors[o + 2] = rgb[2];
      const alpha = i < split ? this.theme.path.sureAlpha : this.theme.path.dimAlpha;
      colors[o + 3] = Math.min(0.95, alpha + (byRate ? glow * 0.4 : 0));
    }
  }
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function tailHex(game: VisualFrame["game"], theme: Theme): string {
  const forecast = game.prediction;
  const hasBurn = game.nodes.some((node) => Math.hypot(node.dvx, node.dvy) >= 0.05);
  if (forecast.status === "won") return theme.colors.resultWin;
  if (forecast.status === "crashed") return theme.colors.resultCrash;
  if (hasBurn && forecast.status === "lost" && forecast.lostReason === "flyby") return theme.colors.trail;
  return theme.colors.path;
}

function makeDots(theme: Theme, order: number): Dots {
  const max = theme.path.maxDots;
  const centers = new Float32Array(max * 2);
  const colors = new Float32Array(max * 4);
  const quadPos = new Float32Array(max * 6 * 3);
  const quadCol = new Float32Array(max * 6 * 4);
  const uvs = new Float32Array(max * 6 * 2);
  const cornerUv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  for (let i = 0; i < max; i++) uvs.set(cornerUv, i * 12);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(quadPos, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(quadCol, 4));
  geometry.setAttribute("aUv", new THREE.BufferAttribute(uvs, 2));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: { uSpan: { value: theme.path.dotSpanPx } },
      vertexShader: dotVert,
      fragmentShader: dotFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return { mesh, centers, colors, quadPos, quadCol };
}

function commitDots(dots: Dots, count: number, span: number): void {
  const r = span / 2;
  const pos = dots.quadPos;
  const col = dots.quadCol;
  for (let i = 0; i < count; i++) {
    const x = dots.centers[i * 2];
    const y = dots.centers[i * 2 + 1];
    const cr = dots.colors[i * 4];
    const cg = dots.colors[i * 4 + 1];
    const cb = dots.colors[i * 4 + 2];
    const ca = dots.colors[i * 4 + 3];
    const v = i * 18;
    pos[v] = x - r;
    pos[v + 1] = y - r;
    pos[v + 3] = x + r;
    pos[v + 4] = y - r;
    pos[v + 6] = x + r;
    pos[v + 7] = y + r;
    pos[v + 9] = x - r;
    pos[v + 10] = y - r;
    pos[v + 12] = x + r;
    pos[v + 13] = y + r;
    pos[v + 15] = x - r;
    pos[v + 16] = y + r;
    const c = i * 24;
    for (let k = 0; k < 24; k += 4) {
      col[c + k] = cr;
      col[c + k + 1] = cg;
      col[c + k + 2] = cb;
      col[c + k + 3] = ca;
    }
  }
  const geometry = dots.mesh.geometry;
  geometry.setDrawRange(0, count * 6);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.aColor.needsUpdate = true;
  dots.mesh.visible = count > 0;
}
