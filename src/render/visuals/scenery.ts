import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import type { Level } from "../../level/schema";
import { syncField } from "../shaders/field-camera";
import { cosmeticSeconds } from "../shaders/impostor";
import { createRockMesh, writeRock, type RockMesh } from "../shaders/rock-shader";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Nebulae, an asteroid field and wreck debris. Baked or instanced once.
 * Positions are decorative and never affect the flight.
 */
export const createScenery: VisualFactory = (theme, level) => new SceneryVisual(theme, level);

const nebulaFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float a = (1.0 - smoothstep(0.15, 1.0, r)) * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const rockFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uTime;
void main() {
  float ang = atan(vLocal.y, vLocal.x) + uTime;
  vec2 p = vec2(cos(ang), sin(ang)) * length(vLocal);
  float r = length(p);
  float fw = fwidth(r);
  float disc = 1.0 - smoothstep(0.72 - fw, 0.72 + fw, r);
  if (disc <= 0.0) discard;
  float shade = 0.55 + 0.45 * p.x;
  gl_FragColor = vec4(uColor * shade, disc);
}
`;

class SceneryVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly spin: THREE.IUniform<number>;
  private readonly asteroids: RockMesh | null = null;
  private readonly bodies: readonly Body[];
  private readonly g: number;

  constructor(theme: Theme, level: Level) {
    this.object.name = "scenery";
    const center = centroid(level.bodies);
    const seed = hash(level.id);
    const rnd = mulberry32(seed);
    const nebulae: Array<[number, number, string, number]> = [
      [center.x - 420, center.y + 180, "#3A2A78", 0.22],
      [center.x + 360, center.y - 260, "#1C4E72", 0.18],
      [center.x + 80, center.y + 420, "#6A3058", 0.14],
    ];
    const span = theme.scenery.nebulaSpan;
    for (let i = 0; i < nebulae.length; i++) {
      const [x, y, color, alpha] = nebulae[i];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(span, span * 0.62),
        shader(nebulaFrag, {
          uColor: { value: srgbVec(color) },
          uAlpha: { value: alpha },
        }),
      );
      mesh.position.set(x, y, 0);
      mesh.renderOrder = -2;
      mesh.name = `nebula-${i}`;
      this.object.add(mesh);
    }

    this.spin = { value: 0 };
    this.bodies = level.bodies;
    this.g = level.g;
    if (!level.belts || level.belts.length === 0) {
      this.asteroids = scenicRocks(theme.scenery.asteroidCount, center.x + 180, center.y + 40, 220, 6, 16, rnd);
      this.object.add(this.asteroids.mesh);
    }
    this.object.add(field(theme.scenery.wreckCount, center.x - 260, center.y - 120, 160, 0x6a5344, 10, 28, rnd, this.spin, 1));
  }

  update(frame: VisualFrame): void {
    this.spin.value = frame.now * 0.001;
    if (!this.asteroids) return;
    const time = (frame.game.mode === "planning" ? 0 : frame.game.ship.step) * frame.game.level.dt;
    syncField(this.asteroids.material.uniforms, frame.game.camera, frame.width, frame.height, frame.dpr, cosmeticSeconds(frame.now));
    const star = this.bodies.find((body) => body.kind === "star") ?? this.bodies[0];
    const pose = star ? bodyPose(star, time, this.bodies, this.g) : { x: 0, y: 0 };
    (this.asteroids.material.uniforms.uStar.value as THREE.Vector2).set(pose.x, pose.y);
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

/** Decorative field. One instanced draw, metallic palette, static positions. */
function scenicRocks(
  count: number,
  cx: number,
  cy: number,
  radius: number,
  minSize: number,
  maxSize: number,
  rnd: () => number,
): RockMesh {
  const built = createRockMesh(count, "scenic-rocks");
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = radius * (0.35 + rnd() * 0.65);
    const size = (minSize + rnd() * (maxSize - minSize)) * 0.45;
    const seed = rnd();
    built.pos[i * 2] = cx + Math.cos(ang) * dist;
    built.pos[i * 2 + 1] = cy + Math.sin(ang) * dist;
    const spin = seed >= 0.5 ? 18 + seed * 40 : -(18 + seed * 40);
    writeRock(built, i, size, seed, 2, spin);
  }
  built.posAttr.needsUpdate = true;
  const geometry = built.mesh.geometry;
  geometry.getAttribute("aSize").needsUpdate = true;
  geometry.getAttribute("aSeed").needsUpdate = true;
  geometry.getAttribute("aType").needsUpdate = true;
  geometry.getAttribute("aSpin").needsUpdate = true;
  return built;
}

function field(
  count: number,
  cx: number,
  cy: number,
  radius: number,
  color: number,
  minSize: number,
  maxSize: number,
  rnd: () => number,
  spin: THREE.IUniform<number>,
  order: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    shader(rockFrag, { uColor: { value: new THREE.Color(color) }, uTime: spin }),
    count,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = radius * (0.35 + rnd() * 0.65);
    dummy.position.set(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, 0);
    const size = minSize + rnd() * (maxSize - minSize);
    dummy.scale.set(size * (0.6 + rnd()), size, 1);
    dummy.rotation.z = rnd() * Math.PI;
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

function centroid(bodies: readonly Body[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < bodies.length; i++) {
    x += bodies[i].x;
    y += bodies[i].y;
  }
  const n = Math.max(1, bodies.length);
  return { x: x / n, y: y / n };
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
