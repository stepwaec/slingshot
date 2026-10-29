import * as THREE from "three";
import type { Vec2 } from "../../sim/physics";
import { projectToScreen } from "../camera";
import { srgbVec } from "./materials";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Flight trail: a narrow line in the plume colours, faded by age and length.
 * No halo. Reads `game.trail` only. The predicted path stays dotted.
 */
export const createTrail: VisualFactory = (theme) => new TrailVisual(theme);

const trailVert = /* glsl */ `
attribute float aAcross;
attribute float aFade;
varying float vAcross;
varying float vFade;
void main() {
  vAcross = aAcross;
  vFade = aFade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const trailFrag = /* glsl */ `
varying float vAcross;
varying float vFade;
uniform vec3 uCore;
uniform vec3 uEdge;

void main() {
  float radial = abs(vAcross);
  float mask = 1.0 - smoothstep(0.86, 1.0, radial);
  if (mask <= 0.0 || vFade <= 0.0) discard;
  float core = 1.0 - smoothstep(0.0, 0.72, radial);
  vec3 color = mix(uEdge, uCore, core);
  gl_FragColor = vec4(color, mask * vFade);
}
`;

class TrailVisual implements Visual {
  readonly space = "screen" as const;
  readonly object: THREE.Mesh;
  private readonly theme: Theme;
  private readonly positions: Float32Array;
  private readonly across: Float32Array;
  private readonly fades: Float32Array;
  private readonly compactX: Float32Array;
  private readonly compactY: Float32Array;
  private readonly compactFade: Float32Array;
  private readonly scratch: Vec2 = { x: 0, y: 0 };

  constructor(theme: Theme) {
    this.theme = theme;
    const segs = theme.trail.samples - 1;
    const verts = segs * 6;
    this.positions = new Float32Array(verts * 3);
    this.across = new Float32Array(verts);
    this.fades = new Float32Array(verts);
    this.compactX = new Float32Array(theme.trail.samples);
    this.compactY = new Float32Array(theme.trail.samples);
    this.compactFade = new Float32Array(theme.trail.samples);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aAcross", new THREE.BufferAttribute(this.across, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aFade", new THREE.BufferAttribute(this.fades, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.object = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uCore: { value: srgbVec(theme.trail.core) },
          uEdge: { value: srgbVec(theme.trail.edge) },
        },
        vertexShader: trailVert,
        fragmentShader: trailFrag,
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
    const spec = this.theme.trail;
    const dt = frame.game.level.dt;
    const simTime = frame.game.ship.step * dt;
    const cap = spec.samples;
    const newest = trail.length - 1;
    const oldest = Math.max(0, trail.length - cap);
    const { width: viewW, height: viewH } = frame;
    let kept = 0;
    let dist = 0;
    let prevX = 0;
    let prevY = 0;
    for (let i = newest; i >= oldest && kept < cap; i--) {
      projectToScreen(trail[i].x, trail[i].y, viewW, viewH, this.scratch);
      const x = this.scratch.x;
      const y = viewH - this.scratch.y;
      if (kept > 0) dist += Math.hypot(x - prevX, y - prevY);
      const age = (newest - i) * dt;
      const timeFade = spec.ageSec > 0 ? Math.max(0, 1 - age / spec.ageSec) : 1;
      const lengthFade = spec.lengthPx > 0 ? Math.max(0, 1 - dist / spec.lengthPx) : 1;
      const fade = Math.min(timeFade, lengthFade);
      if (fade <= 0 && kept > 1) break;
      this.compactX[kept] = x;
      this.compactY[kept] = y;
      this.compactFade[kept] = fade;
      kept += 1;
      prevX = x;
      prevY = y;
    }
    const half = spec.halfWidthPx;
    let vert = 0;
    const maxSegs = cap - 1;
    for (let i = kept - 1; i > 0 && kept - 1 - i < maxSegs; i--) {
      const x0 = this.compactX[i];
      const y0 = this.compactY[i];
      const x1 = this.compactX[i - 1];
      const y1 = this.compactY[i - 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const wobble = 1 + spec.turbulence * Math.sin(simTime * 6 + i * 0.8);
      const nx = (-dy / len) * half * wobble;
      const ny = (dx / len) * half * wobble;
      const a0 = this.compactFade[i];
      const a1 = this.compactFade[i - 1];
      vert = push(this.positions, this.across, this.fades, vert, x0 + nx, y0 + ny, 1, a0);
      vert = push(this.positions, this.across, this.fades, vert, x0 - nx, y0 - ny, -1, a0);
      vert = push(this.positions, this.across, this.fades, vert, x1 - nx, y1 - ny, -1, a1);
      vert = push(this.positions, this.across, this.fades, vert, x0 + nx, y0 + ny, 1, a0);
      vert = push(this.positions, this.across, this.fades, vert, x1 - nx, y1 - ny, -1, a1);
      vert = push(this.positions, this.across, this.fades, vert, x1 + nx, y1 + ny, 1, a1);
    }
    const geometry = this.object.geometry;
    geometry.setDrawRange(0, vert);
    geometry.attributes.position.needsUpdate = true;
    (geometry.attributes.aAcross as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aFade as THREE.BufferAttribute).needsUpdate = true;
    this.object.visible = vert > 0;
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function push(
  positions: Float32Array,
  across: Float32Array,
  fades: Float32Array,
  vert: number,
  x: number,
  y: number,
  side: number,
  fade: number,
): number {
  const p = vert * 3;
  positions[p] = x;
  positions[p + 1] = y;
  positions[p + 2] = 0;
  across[vert] = side;
  fades[vert] = fade;
  return vert + 1;
}
