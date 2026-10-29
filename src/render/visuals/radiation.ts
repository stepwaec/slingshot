import * as THREE from "three";
import { bodyPose, doseAt } from "../../sim/physics";
import { isEditing } from "../../game/state";
import { screenToWorld } from "../camera";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Halftone dose map. Each dot samples `doseAt`, the same field the crew dose
 * integrates. The toggle does not write the sim. The grid is 12 px, as in
 * `radiation-map.svg`, and the dot radii are the header's 0.5 / 1 / 1.6 / 2.3 / 3.
 */
export const createRadiation: VisualFactory = (theme) => new RadiationVisual(theme);

const CELL = 12;
/** Header: dots stay off the star disc plus 50 px, and off every other disc. */
const STAR_PAD = 50;

function zone(d: number): { color: number; radius: number; alpha: number } {
  if (d >= 20) return { color: 0xfff4b8, radius: 3, alpha: 1 };
  if (d >= 8) return { color: 0xffe83a, radius: 2.3, alpha: 1 };
  if (d >= 3) return { color: 0xd4f03c, radius: 1.6, alpha: 1 };
  if (d >= 1) return { color: 0x9be15d, radius: 1, alpha: 1 };
  return { color: 0x9be15d, radius: 0.5, alpha: 0.25 };
}

const pointVertex = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
}
`;

const pointFragment = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  if (dot(p, p) > 0.25) discard;
  gl_FragColor = vColor;
}
`;

class RadiationVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly points: THREE.Points;
  private key = "";

  constructor(theme: Theme) {
    this.object.name = "radiation";
    this.object.userData.asset = theme.assets.radiation;
    const max = 140 * 90;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 4);
    this.sizes = new Float32Array(max);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 4));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        transparent: true,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.object.add(this.points);
  }

  update(frame: VisualFrame): void {
    const show = frame.game.radiation && isEditing(frame.game);
    this.object.visible = show;
    if (!show) return;
    const simTime = frame.game.mode === "planning" ? 0 : frame.game.ship.t;
    const key = `${frame.game.level.id}:${frame.game.camera.x}:${frame.game.camera.y}:${frame.game.camera.zoom}:${frame.width}:${frame.height}:${Math.floor(simTime * 4)}`;
    if (key === this.key) return;
    this.key = key;
    const bodies = frame.game.level.bodies;
    const g = frame.game.level.g;
    let count = 0;
    const max = this.positions.length / 3;
    for (let y = CELL / 2; y < frame.height && count < max; y += CELL) {
      for (let x = CELL / 2; x < frame.width && count < max; x += CELL) {
        const world = screenToWorld(frame.game.camera, frame.width, frame.height, x, y);
        let inside = false;
        for (let i = 0; i < bodies.length; i++) {
          const body = bodies[i];
          const pose = bodyPose(body, simTime, bodies, g);
          const pad = body.kind === "star" ? STAR_PAD : 0;
          if (Math.hypot(world.x - pose.x, world.y - pose.y) < body.radius + pad) inside = true;
        }
        if (inside) continue;
        const reading = doseAt(world.x, world.y, simTime, bodies, g);
        const paint = zone(reading.d);
        const o = count * 3;
        this.positions[o] = x;
        this.positions[o + 1] = frame.height - y;
        this.positions[o + 2] = 0;
        const c = count * 4;
        this.colors[c] = ((paint.color >> 16) & 255) / 255;
        this.colors[c + 1] = ((paint.color >> 8) & 255) / 255;
        this.colors[c + 2] = (paint.color & 255) / 255;
        this.colors[c + 3] = paint.alpha;
        this.sizes[count] = paint.radius * 2;
        count += 1;
      }
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, count);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
