import * as THREE from "three";
import { isEditing, levelHasAstro } from "../../game/state";
import { bodyPose, type Body } from "../../sim/physics";
import {
  astroField,
  astroTick,
  curvePoint,
  petrovaCurve,
  type FieldBody,
  type FieldKnot,
  type FieldLine,
} from "../../sim/astrophage";
import { screenToWorld, worldToScreen } from "../camera";
import { palette, srgb01 } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Astrophage map. Planning and pause only. Ticks are a 14 px screen grid,
 * so they do not scale with zoom. The toggle does not write the sim.
 */
export const createAstroMap: VisualFactory = (theme) => new AstroMapVisual(theme);

const lineVert = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const lineFrag = /* glsl */ `
precision highp float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

class AstroMapVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly ticks: THREE.LineSegments;
  private readonly heads: THREE.Points;
  private readonly marks: THREE.Group;
  private key = "";

  constructor(theme: Theme) {
    this.theme = theme;
    this.object.name = "astro-map";
    this.object.userData.asset = theme.assets.astroMap;
    const max = 120 * 80;
    this.ticks = new THREE.LineSegments(lineGeometry(max * 2), lineMaterial());
    this.ticks.frustumCulled = false;
    this.heads = new THREE.Points(pointGeometry(max), pointMaterial());
    this.heads.frustumCulled = false;
    this.marks = new THREE.Group();
    this.object.add(this.ticks, this.heads, this.marks);
  }

  update(frame: VisualFrame): void {
    const show = frame.game.astrophage && isEditing(frame.game) && levelHasAstro(frame.game.level);
    this.object.visible = show;
    if (!show) return;
    const pose = frame.game.mode === "planning" ? frame.game.initial : frame.game.ship;
    const key = `${frame.game.level.id}:${frame.game.camera.x}:${frame.game.camera.y}:${frame.game.camera.zoom}:${frame.width}:${frame.height}:${pose.step}:${pose.knots.join(",")}`;
    if (key === this.key) return;
    this.key = key;
    this.rebuild(frame);
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private rebuild(frame: VisualFrame): void {
    const { game, width, height } = frame;
    const time = game.mode === "planning" ? 0 : game.ship.t;
    const bodies = game.level.bodies;
    const g = game.level.g;
    const pose = game.mode === "planning" ? game.initial : game.ship;
    const lines = fieldLines(game.level.petrova ?? [], bodies, time, g);
    const fieldBodies = bodies.map((body): FieldBody => ({
      x: bodyPose(body, time, bodies, g).x,
      y: bodyPose(body, time, bodies, g).y,
      radius: body.radius,
      kind: body.kind === "star" ? "star" : "planet",
      infected: Boolean(body.astrophage),
    }));
    const knots = fieldKnots(game.level.petrova ?? [], bodies, time, g, pose.knots);
    const cell = this.theme.astro.mapCell;
    const positions = this.ticks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = this.ticks.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const headPos = this.heads.geometry.getAttribute("position") as THREE.BufferAttribute;
    const headColor = this.heads.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const headSize = this.heads.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    let count = 0;
    const max = positions.count / 2;
    for (let y = cell / 2; y < height && count < max; y += cell) {
      for (let x = cell / 2; x < width && count < max; x += cell) {
        const world = screenToWorld(game.camera, width, height, x, y);
        if (insideBody(world.x, world.y, fieldBodies, game, width, height)) continue;
        const sample = astroField(world.x, world.y, lines, fieldBodies, knots);
        const tick = astroTick(sample.a, sample.eaten);
        if (!tick) continue;
        const dx = Math.cos(sample.angle) * tick.length;
        const dy = -Math.sin(sample.angle) * tick.length;
        const o = count * 2;
        const pos = positions.array as Float32Array;
        const col = colors.array as Float32Array;
        pos[o * 3] = x;
        pos[o * 3 + 1] = height - y;
        pos[o * 3 + 2] = 0;
        pos[(o + 1) * 3] = x + dx;
        pos[(o + 1) * 3 + 1] = height - y + dy;
        pos[(o + 1) * 3 + 2] = 0;
        const rgb = srgb01(tick.color);
        for (let v = 0; v < 2; v++) {
          const c = (o + v) * 4;
          col[c] = rgb[0];
          col[c + 1] = rgb[1];
          col[c + 2] = rgb[2];
          col[c + 3] = tick.alpha;
        }
        const hp = headPos.array as Float32Array;
        hp[count * 3] = x + dx;
        hp[count * 3 + 1] = height - y + dy;
        hp[count * 3 + 2] = 0;
        const hc = headColor.array as Float32Array;
        hc[count * 3] = rgb[0];
        hc[count * 3 + 1] = rgb[1];
        hc[count * 3 + 2] = rgb[2];
        (headSize.array as Float32Array)[count] = tick.width * 1.5;
        count += 1;
      }
    }
    this.ticks.geometry.setDrawRange(0, count * 2);
    this.heads.geometry.setDrawRange(0, count);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    headPos.needsUpdate = true;
    headColor.needsUpdate = true;
    headSize.needsUpdate = true;
    this.poseMarks(frame, fieldBodies);
  }

  private poseMarks(frame: VisualFrame, bodies: readonly FieldBody[]): void {
    const source = frame.game.level.bodies;
    while (this.marks.children.length < source.length) {
      const ring = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial());
      ring.frustumCulled = false;
      this.marks.add(ring);
    }
    for (let i = 0; i < this.marks.children.length; i++) {
      const mark = this.marks.children[i] as THREE.LineSegments;
      const body = source[i];
      const field = bodies[i];
      if (!body || !field || body.kind !== "star") {
        mark.visible = false;
        continue;
      }
      const screen = worldToScreen(frame.game.camera, frame.width, frame.height, field.x, field.y);
      const px = pixelsPerWorld(frame);
      const radius = field.radius * px + this.theme.astro.gaugeRadius;
      const infected = body.astrophage;
      const steps = 6;
      const arcs = infected ? 10 : 1;
      const positions: number[] = [];
      const colors: number[] = [];
      for (let s = 0; s < arcs; s++) {
        const span = (Math.PI * 2) / arcs;
        const gap = infected ? span * 0.16 : 0;
        const start = s * span - Math.PI / 2 + gap / 2;
        const end = (s + 1) * span - Math.PI / 2 - gap / 2;
        const lit = infected ? s < infected.level : true;
        const rgb = srgb01(infected ? (lit ? palette.astroCrimson : "#FFFFFF") : palette.astroClean);
        const alpha = infected ? (lit ? 0.95 : 0.14) : 0.85;
        for (let k = 0; k < steps; k++) {
          const a0 = start + ((end - start) * k) / steps;
          const a1 = start + ((end - start) * (k + 1)) / steps;
          positions.push(
            screen.x + Math.cos(a0) * radius,
            frame.height - screen.y + Math.sin(a0) * radius,
            0,
            screen.x + Math.cos(a1) * radius,
            frame.height - screen.y + Math.sin(a1) * radius,
            0,
          );
          for (let v = 0; v < 2; v++) colors.push(rgb[0], rgb[1], rgb[2], alpha);
        }
      }
      mark.geometry.dispose();
      mark.geometry = new THREE.BufferGeometry();
      mark.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      mark.geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(colors), 4));
      mark.visible = true;
    }
  }
}

function fieldLines(
  lines: readonly { from: string; to: string; bulge: number; eaten?: number; knots: readonly { t: number }[] }[],
  bodies: readonly Body[],
  time: number,
  g: number,
): FieldLine[] {
  const out: FieldLine[] = [];
  for (const line of lines) {
    const from = bodies.find((body) => body.id === line.from);
    const to = bodies.find((body) => body.id === line.to);
    if (!from || !to) continue;
    const a = bodyPose(from, time, bodies, g);
    const b = bodyPose(to, time, bodies, g);
    out.push({
      curve: petrovaCurve(a.x, a.y, from.radius, b.x, b.y, to.radius, line.bulge),
      eaten: line.eaten,
      starX: a.x,
      starY: a.y,
      planetX: b.x,
      planetY: b.y,
      planetR: to.radius,
    });
  }
  return out;
}

function fieldKnots(
  lines: readonly { from: string; to: string; bulge: number; knots: readonly { t: number; fuel: number }[] }[],
  bodies: readonly Body[],
  time: number,
  g: number,
  remaining: readonly number[],
): FieldKnot[] {
  const knots: FieldKnot[] = [];
  let index = 0;
  for (const line of lines) {
    const from = bodies.find((body) => body.id === line.from);
    const to = bodies.find((body) => body.id === line.to);
    if (!from || !to) {
      index += line.knots.length;
      continue;
    }
    const a = bodyPose(from, time, bodies, g);
    const b = bodyPose(to, time, bodies, g);
    const curve = petrovaCurve(a.x, a.y, from.radius, b.x, b.y, to.radius, line.bulge);
    for (const knot of line.knots) {
      const at = curvePoint(curve, knot.t);
      const left = remaining[index] ?? knot.fuel;
      knots.push({ x: at.x, y: at.y, share: knot.fuel > 0 ? left / knot.fuel : 0 });
      index += 1;
    }
  }
  return knots;
}

function insideBody(
  x: number,
  y: number,
  bodies: readonly FieldBody[],
  frameGame: VisualFrame["game"],
  width: number,
  height: number,
): boolean {
  const px = pixelsPerWorld({ game: frameGame, width, height });
  for (const body of bodies) {
    const pad = (body.kind === "star" ? 14 : 6) / px;
    if (Math.hypot(x - body.x, y - body.y) < body.radius + pad) return true;
  }
  return false;
}

function pixelsPerWorld(frame: { game: VisualFrame["game"]; width: number; height: number }): number {
  const origin = worldToScreen(frame.game.camera, frame.width, frame.height, 0, 0);
  const unit = worldToScreen(frame.game.camera, frame.width, frame.height, 1, 0);
  return Math.max(0.01, Math.hypot(unit.x - origin.x, unit.y - origin.y));
}

function lineGeometry(vertices: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(vertices * 4), 4));
  return geometry;
}

function pointGeometry(count: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1));
  return geometry;
}

function lineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: lineVert,
    fragmentShader: lineFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

const pointVert = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
}
`;

const pointFrag = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  if (dot(p, p) > 0.25) discard;
  gl_FragColor = vec4(vColor, 1.0);
}
`;

function pointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
