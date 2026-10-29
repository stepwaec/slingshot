import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import { placeBelts, type Belt, type BeltMaterial, type BeltRock } from "../../sim/belts";
import { isEditing } from "../../game/state";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Gameplay belts. Rocks come from `placeBelts`, the same list the sim crashes
 * into. Each rock is lit from −x in the atlas and turned so that side faces
 * the star. Dust is a second instanced mesh of discs. Edges show in planning
 * and pause only.
 */
export const createBelts: VisualFactory = (theme, level) => new BeltsVisual(theme, level);

const CELL = 64;
const MATERIALS: BeltMaterial[] = ["S", "C", "M", "K"];

const PAINT: Record<BeltMaterial, { rim: string; light: string; base: string; dark: string; night: string; accent: string; accentA: number }> = {
  S: { rim: "#F0DCC0", light: "#C8A684", base: "#9A7A5E", dark: "#5A4636", night: "#120E14", accent: "#C0562A", accentA: 0.45 },
  C: { rim: "#D8CCBE", light: "#8E8478", base: "#62584E", dark: "#3A332D", night: "#0C0B12", accent: "#2A2420", accentA: 0.5 },
  M: { rim: "#EEF2FA", light: "#B6BFD2", base: "#8690A8", dark: "#4E566C", night: "#0A0D18", accent: "#DCE4F6", accentA: 0.35 },
  K: { rim: "#FFE6D8", light: "#C88870", base: "#9A5A46", dark: "#5A2E26", night: "#120A10", accent: "#DCEBF5", accentA: 0.75 },
};

const DUST: Record<BeltMaterial, string> = {
  S: "#C8A684",
  C: "#8E8478",
  M: "#B6BFD2",
  K: "#C88870",
};

const ringFrag = /* glsl */ `
varying vec2 vLocal;
uniform float uOuter;
uniform float uRadius;
uniform float uSoft;
uniform float uPx;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uDash;
void main() {
  vec2 p = vLocal * uOuter;
  float r = length(p);
  float band = 1.0 - smoothstep(uSoft, uSoft + uPx, abs(r - uRadius));
  float along = (atan(p.y, p.x) + 3.14159265) * uRadius / max(uPx, 0.001);
  float dash = uDash > 0.5 ? (mod(along, 11.0) < 5.0 ? 1.0 : 0.0) : 1.0;
  float a = band * dash * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const rockVert = /* glsl */ `
attribute vec4 aAtlas;
varying vec2 vUv;
void main() {
  vUv = mix(aAtlas.xy, aAtlas.zw, uv);
  vec4 world = instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * world;
}
`;

const rockFragAtlas = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uAtlas;
void main() {
  vec4 color = texture2D(uAtlas, vUv);
  if (color.a < 0.15) discard;
  gl_FragColor = color;
}
`;

const dustVert = /* glsl */ `
varying vec3 vColor;
varying vec2 vLocal;
void main() {
  vColor = instanceColor;
  vLocal = position.xy * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const dustFrag = /* glsl */ `
varying vec3 vColor;
varying vec2 vLocal;
void main() {
  if (length(vLocal) > 1.0) discard;
  gl_FragColor = vec4(vColor, 0.75);
}
`;

interface RingView {
  mesh: THREE.Mesh;
  belt: Belt;
  radius: number;
  editingOnly: boolean;
}

class BeltsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly rocks: BeltRock[];
  private readonly bodies: readonly Body[];
  private readonly rockMesh: THREE.InstancedMesh | null;
  private readonly dustMesh: THREE.InstancedMesh | null;
  private readonly rockIndex: number[] = [];
  private readonly dustIndex: number[] = [];
  private readonly rings: RingView[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly g: number;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "belts";
    this.bodies = level.bodies;
    this.g = level.g;
    const belts = level.belts ?? [];
    this.rocks = belts.length > 0 ? placeBelts(belts) : [];
    const asset = belts.some((belt) => belt.tier === "kuiper")
      ? theme.assets.kuiper
      : belts.some((belt) => belt.tier === "dense")
        ? theme.assets.beltDense
        : belts.some((belt) => belt.tier === "medium")
          ? theme.assets.beltMedium
          : theme.assets.beltSparse;
    this.object.userData.asset = asset;

    const rocky = this.rocks.filter((rock) => rock.role !== "dust");
    const dust = this.rocks.filter((rock) => rock.role === "dust");
    this.rockMesh = rocky.length > 0 ? this.makeRocks(rocky) : null;
    this.dustMesh = dust.length > 0 ? this.makeDust(dust) : null;
    if (this.rockMesh) this.object.add(this.rockMesh);
    if (this.dustMesh) this.object.add(this.dustMesh);

    for (const belt of belts) {
      const outer = belt.radius + belt.width;
      this.rings.push(this.ring(belt, belt.radius + belt.width * 0.9, outer, "#C9BBA8", 0.4, 1, true));
      this.rings.push(this.ring(belt, belt.radius - belt.width * 0.9, outer, "#C9BBA8", 0.4, 1, true));
      if (belt.tier === "medium" || belt.tier === "dense" || belt.tier === "kuiper") {
        const color = belt.tier === "kuiper" ? "#BFD8E8" : "#C9B79E";
        const alpha = belt.tier === "dense" ? 0.07 : 0.035;
        this.rings.push(this.ring(belt, belt.radius, outer, color, alpha, belt.width * 0.8, false));
        this.rings.push(this.ring(belt, belt.radius, outer, color, alpha, belt.width * 0.4, false));
      }
    }
  }

  update(frame: VisualFrame): void {
    const time = (frame.game.mode === "planning" ? 0 : frame.game.ship.step) * frame.game.level.dt;
    const editing = isEditing(frame.game);
    const px = 1 / Math.max(0.05, frame.game.camera.zoom);
    this.pose(this.rockMesh, this.rockIndex, time, false);
    this.pose(this.dustMesh, this.dustIndex, time, true);
    for (const ring of this.rings) {
      const center = this.center(ring.belt.centerId, time);
      ring.mesh.visible = center !== null && (!ring.editingOnly || editing);
      if (!center) continue;
      ring.mesh.position.set(center.x, center.y, 0);
      const material = ring.mesh.material as THREE.ShaderMaterial;
      material.uniforms.uPx.value = px;
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private pose(mesh: THREE.InstancedMesh | null, indexes: number[], time: number, dust: boolean): void {
    if (!mesh) return;
    for (let i = 0; i < indexes.length; i++) {
      const rock = this.rocks[indexes[i]];
      const center = this.center(rock.centerId, time);
      if (!center) continue;
      const angle = rock.angle + drift(rock, time);
      const x = center.x + Math.cos(angle) * rock.distance;
      const y = center.y + Math.sin(angle) * rock.distance;
      this.dummy.position.set(x, y, 0);
      this.dummy.scale.set(rock.radius * 2, rock.radius * 2, 1);
      const face = Math.atan2(center.y - y, center.x - x) - Math.PI;
      this.dummy.rotation.z = dust ? 0 : face;
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private center(id: string, time: number): { x: number; y: number } | null {
    const body = this.bodies.find((item) => item.id === id);
    if (!body) return null;
    const pose = bodyPose(body, time, this.bodies, this.g);
    return { x: pose.x, y: pose.y };
  }

  private makeRocks(rocks: BeltRock[]): THREE.InstancedMesh {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const atlas = new Float32Array(rocks.length * 4);
    const cols = 6;
    const rows = MATERIALS.length;
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      const col = rock.shape;
      const row = Math.max(0, MATERIALS.indexOf(rock.material));
      atlas[i * 4] = col / cols;
      atlas[i * 4 + 1] = 1 - (row + 1) / rows;
      atlas[i * 4 + 2] = (col + 1) / cols;
      atlas[i * 4 + 3] = 1 - row / rows;
      this.rockIndex.push(this.rocks.indexOf(rock));
    }
    geometry.setAttribute("aAtlas", new THREE.InstancedBufferAttribute(atlas, 4));
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: rockVert,
        fragmentShader: rockFragAtlas,
        uniforms: { uAtlas: { value: bakeAtlas() } },
        transparent: true,
        depthTest: false,
        toneMapped: false,
      }),
      rocks.length,
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    mesh.name = "belt-rocks";
    return mesh;
  }

  private makeDust(rocks: BeltRock[]): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        transparent: true,
        depthTest: false,
        toneMapped: false,
      }),
      rocks.length,
    );
    const color = new THREE.Color();
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      const frost = rock.material === "K" && i % 5 < 3;
      color.set(frost ? "#DCEBF5" : DUST[rock.material]);
      mesh.setColorAt(i, color);
      this.dustIndex.push(this.rocks.indexOf(rock));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    mesh.name = "belt-dust";
    return mesh;
  }

  private ring(belt: Belt, radius: number, outer: number, color: string, alpha: number, soft: number, dashed: boolean): RingView {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(ringFrag, {
        uOuter: { value: outer + 8 },
        uRadius: { value: Math.max(1, radius) },
        uSoft: { value: Math.max(0.6, soft) },
        uPx: { value: 1 },
        uColor: { value: srgbVec(color) },
        uAlpha: { value: alpha },
        uDash: { value: dashed ? 1 : 0 },
      }),
    );
    mesh.scale.set(outer + 8, outer + 8, 1);
    mesh.renderOrder = dashed ? 1 : -1;
    mesh.name = `${belt.id}-ring`;
    mesh.frustumCulled = false;
    this.object.add(mesh);
    return { mesh, belt, radius, editingOnly: dashed };
  }
}

function drift(rock: BeltRock, time: number): number {
  const kuiper = rock.tier === "kuiper";
  const amp = ((kuiper ? 0.3 : 0.5) * Math.PI) / 180;
  const period = kuiper ? 90 : 60;
  const phase = ((time % period) / period) * Math.PI * 2;
  return -amp * 0.5 * (1 - Math.cos(phase));
}

let atlasTexture: THREE.CanvasTexture | null = null;

/** Six silhouettes per material, lit from −x. Built once. */
function bakeAtlas(): THREE.CanvasTexture {
  if (atlasTexture) return atlasTexture;
  const canvas = document.createElement("canvas");
  canvas.width = CELL * 6;
  canvas.height = CELL * MATERIALS.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    atlasTexture = new THREE.CanvasTexture(canvas);
    return atlasTexture;
  }
  const rnd = mulberry(0x5eed);
  for (let row = 0; row < MATERIALS.length; row++) {
    const paint = PAINT[MATERIALS[row]];
    for (let col = 0; col < 6; col++) {
      drawRock(ctx, col * CELL, row * CELL, paint, rnd);
    }
  }
  atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture.generateMipmaps = true;
  atlasTexture.needsUpdate = true;
  return atlasTexture;
}

function drawRock(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  paint: (typeof PAINT)[BeltMaterial],
  rnd: () => number,
): void {
  const n = 7 + Math.floor(rnd() * 5);
  const points: { x: number; y: number }[] = [];
  const aspect = 1 + rnd() * 0.35;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const radius = 0.62 * (0.8 + rnd() * 0.4);
    points.push({ x: Math.cos(angle) * radius * aspect, y: Math.sin(angle) * radius });
  }
  const to = (p: { x: number; y: number }, shift = 0) => ({
    x: ox + CELL / 2 + (p.x + shift) * (CELL * 0.46),
    y: oy + CELL / 2 + p.y * (CELL * 0.46),
  });
  const path = (shift: number) => {
    ctx.beginPath();
    const first = to(points[0], shift);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const p = to(points[i], shift);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  };
  path(0);
  ctx.fillStyle = paint.rim;
  ctx.fill();
  path(0.09);
  const gradient = ctx.createLinearGradient(ox, oy, ox + CELL, oy);
  gradient.addColorStop(0, paint.light);
  gradient.addColorStop(0.45, paint.base);
  gradient.addColorStop(1, paint.dark);
  ctx.fillStyle = gradient;
  ctx.fill();
  const spots = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < spots; i++) {
    const p = to({ x: (rnd() - 0.55) * 0.7, y: (rnd() - 0.5) * 0.7 });
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 2 + rnd() * 4, 1.5 + rnd() * 3, rnd(), 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(paint.accent, paint.accentA);
    ctx.fill();
  }
  const crater = to({ x: -0.15, y: 0.05 });
  ctx.beginPath();
  ctx.arc(crater.x, crater.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = hexAlpha(paint.rim, 0.7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(crater.x - 2, crater.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = paint.dark;
  ctx.fill();
  path(0);
  ctx.strokeStyle = hexAlpha(paint.night, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
