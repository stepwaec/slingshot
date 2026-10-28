import * as THREE from "three";
import type { Vec2 } from "../../sim/physics";
import { projectToScreen } from "../camera";
import { srgb01 } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Flight trail: a screen-pixel ribbon, brightest at the ship, fading over the
 * last `theme.trail.samples` points. Swap the factory to change the mesh;
 * keep reading `game.trail` and do not trim it in the sim.
 */
export const createTrail: VisualFactory = (theme) => new TrailVisual(theme);

const colorVert = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const colorFrag = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

class TrailVisual implements Visual {
  readonly space = "screen" as const;
  readonly object: THREE.Mesh;
  private readonly theme: Theme;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly compactX: Float32Array;
  private readonly compactY: Float32Array;
  private readonly compactA: Float32Array;
  private readonly scratch: Vec2 = { x: 0, y: 0 };

  constructor(theme: Theme) {
    this.theme = theme;
    const segs = theme.trail.samples - 1;
    this.positions = new Float32Array(segs * 6 * 3);
    this.colors = new Float32Array(segs * 6 * 4);
    this.compactX = new Float32Array(theme.trail.samples);
    this.compactY = new Float32Array(theme.trail.samples);
    this.compactA = new Float32Array(theme.trail.samples);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.object = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: colorVert,
        fragmentShader: colorFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.object.frustumCulled = false;
    this.object.renderOrder = 1;
    this.object.name = "trail";
    this.object.userData.asset = theme.assets.trail;
  }

  update(frame: VisualFrame): void {
    const trail = frame.game.trail;
    const show = frame.game.mode !== "planning";
    if (!show || trail.length < 2) {
      this.object.visible = false;
      return;
    }
    const cap = this.theme.trail.samples;
    const width = this.theme.trail.widthPx / 2;
    const { width: viewW, height: viewH } = frame;
    const start = Math.max(0, trail.length - cap);
    const count = trail.length - start;
    let kept = 0;
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < count; i++) {
      projectToScreen(trail[start + i].x, trail[start + i].y, viewW, viewH, this.scratch);
      const x = this.scratch.x;
      const y = viewH - this.scratch.y;
      const last = i === count - 1;
      if (kept > 0 && !last && (x - prevX) * (x - prevX) + (y - prevY) * (y - prevY) < 1) continue;
      this.compactX[kept] = x;
      this.compactY[kept] = y;
      this.compactA[kept] = 1 - (count - 1 - i) / cap;
      kept += 1;
      prevX = x;
      prevY = y;
    }
    const rgb = srgb01(this.theme.colors.trail);
    let vert = 0;
    const maxSegs = cap - 1;
    for (let i = 0; i < kept - 1 && i < maxSegs; i++) {
      const x0 = this.compactX[i];
      const y0 = this.compactY[i];
      const x1 = this.compactX[i + 1];
      const y1 = this.compactY[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * width;
      const ny = (dx / len) * width;
      const a0 = this.compactA[i];
      const a1 = this.compactA[i + 1];
      vert = push(this.positions, this.colors, vert, rgb, x0 + nx, y0 + ny, a0);
      vert = push(this.positions, this.colors, vert, rgb, x0 - nx, y0 - ny, a0);
      vert = push(this.positions, this.colors, vert, rgb, x1 - nx, y1 - ny, a1);
      vert = push(this.positions, this.colors, vert, rgb, x0 + nx, y0 + ny, a0);
      vert = push(this.positions, this.colors, vert, rgb, x1 - nx, y1 - ny, a1);
      vert = push(this.positions, this.colors, vert, rgb, x1 + nx, y1 + ny, a1);
    }
    const geometry = this.object.geometry;
    geometry.setDrawRange(0, vert);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    this.object.visible = vert > 0;
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function push(
  positions: Float32Array,
  colors: Float32Array,
  vert: number,
  rgb: [number, number, number],
  x: number,
  y: number,
  alpha: number,
): number {
  const p = vert * 3;
  const c = vert * 4;
  positions[p] = x;
  positions[p + 1] = y;
  positions[p + 2] = 0;
  colors[c] = rgb[0];
  colors[c + 1] = rgb[1];
  colors[c + 2] = rgb[2];
  colors[c + 3] = alpha;
  return vert + 1;
}
