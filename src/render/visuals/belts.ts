import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import { placeBelts, rockOffset, type Belt, type BeltMaterial, type BeltRock } from "../../sim/belts";
import { isEditing } from "../../game/state";
import { srgb01 } from "../palette";
import { syncField } from "../shaders/field-camera";
import { cosmeticSeconds } from "../shaders/impostor";
import { createPointCloud, type PointCloud } from "../shaders/points-shader";
import { createRockMesh, rockSeed, rockTypeIndex, tumblePeriod, writeRock, type RockMesh } from "../shaders/rock-shader";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Gameplay belts. Rocks come from `placeBelts`, the same list the sim crashes
 * into. Each rock is a procedural instance (design/shaders/rock.vert). Dust is
 * one point draw. Edges show in planning and pause only.
 */
export const createBelts: VisualFactory = (theme, level) => new BeltsVisual(theme, level);

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

interface RingView {
  mesh: THREE.Mesh;
  belt: Belt;
  radius: number;
  editingOnly: boolean;
}

/** One instanced rock draw and one point-dust draw for a belt. */
interface ShaderField {
  centerId: string;
  rocks: RockMesh | null;
  rockIndex: number[];
  dust: PointCloud | null;
  dustIndex: number[];
}

class BeltsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly rocks: BeltRock[];
  private readonly bodies: readonly Body[];
  private readonly rings: RingView[] = [];
  private readonly fields: ShaderField[] = [];
  private readonly g: number;

  constructor(_theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "belts";
    this.bodies = level.bodies;
    this.g = level.g;
    const belts = level.belts ?? [];
    this.rocks = belts.length > 0 ? placeBelts(belts) : [];
    for (const belt of belts) this.fields.push(this.makeField(belt));

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
    this.poseFields(frame, time);
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

  private makeField(belt: Belt): ShaderField {
    const rocks = this.rocks.filter((rock) => rock.beltId === belt.id && rock.role !== "dust");
    const dust = this.rocks.filter((rock) => rock.beltId === belt.id && rock.role === "dust");
    const field: ShaderField = {
      centerId: belt.centerId,
      rocks: rocks.length > 0 ? createRockMesh(rocks.length, `${belt.id}-rocks`) : null,
      rockIndex: [],
      dust: dust.length > 0 ? createPointCloud(dust.length, 0.25, 3, `${belt.id}-dust`) : null,
      dustIndex: [],
    };
    if (field.rocks) {
      for (let i = 0; i < rocks.length; i++) {
        const rock = rocks[i];
        const seed = rockSeed(i, rock.shape, rock.distance);
        writeRock(field.rocks, i, rock.radius, seed, rockTypeIndex(rock.material), tumblePeriod(seed));
        field.rockIndex.push(this.rocks.indexOf(rock));
      }
      const geometry = field.rocks.mesh.geometry;
      geometry.getAttribute("aSize").needsUpdate = true;
      geometry.getAttribute("aSeed").needsUpdate = true;
      geometry.getAttribute("aType").needsUpdate = true;
      geometry.getAttribute("aSpin").needsUpdate = true;
      this.object.add(field.rocks.mesh);
    }
    if (field.dust) {
      const colorAttr = field.dust.points.geometry.getAttribute("aColor") as THREE.BufferAttribute;
      const sizeAttr = field.dust.points.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const phaseAttr = field.dust.points.geometry.getAttribute("aPhase") as THREE.BufferAttribute;
      const shapeAttr = field.dust.points.geometry.getAttribute("aShape") as THREE.BufferAttribute;
      for (let i = 0; i < dust.length; i++) {
        const rock = dust[i];
        const frost = rock.material === "K" && i % 5 < 3;
        const [r, g, b] = srgb01(frost ? "#DCEBF5" : DUST[rock.material]);
        colorAttr.setXYZW(i, r, g, b, 0.75);
        sizeAttr.setX(i, rock.radius);
        phaseAttr.setX(i, (i * 0.61803398875) % 1);
        shapeAttr.setX(i, 0);
        field.dustIndex.push(this.rocks.indexOf(rock));
      }
      colorAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      phaseAttr.needsUpdate = true;
      shapeAttr.needsUpdate = true;
      this.object.add(field.dust.points);
    }
    return field;
  }

  private poseFields(frame: VisualFrame, time: number): void {
    const seconds = cosmeticSeconds(frame.now);
    for (const field of this.fields) {
      const center = this.center(field.centerId, time);
      const alive = center !== null;
      if (field.rocks) field.rocks.mesh.visible = alive;
      if (field.dust) field.dust.points.visible = alive;
      if (!center) continue;
      if (field.rocks) {
        syncField(field.rocks.material.uniforms, frame.game.camera, frame.width, frame.height, frame.dpr, seconds);
        (field.rocks.material.uniforms.uStar.value as THREE.Vector2).set(center.x, center.y);
        for (let i = 0; i < field.rockIndex.length; i++) {
          const rock = this.rocks[field.rockIndex[i]];
          const offset = rockOffset(rock, time);
          field.rocks.pos[i * 2] = center.x + offset.x;
          field.rocks.pos[i * 2 + 1] = center.y + offset.y;
        }
        field.rocks.posAttr.needsUpdate = true;
      }
      if (field.dust) {
        syncField(field.dust.material.uniforms, frame.game.camera, frame.width, frame.height, frame.dpr, seconds);
        for (let i = 0; i < field.dustIndex.length; i++) {
          const rock = this.rocks[field.dustIndex[i]];
          const offset = rockOffset(rock, time);
          field.dust.pos[i * 2] = center.x + offset.x;
          field.dust.pos[i * 2 + 1] = center.y + offset.y;
        }
        field.dust.posAttr.needsUpdate = true;
      }
    }
  }

  private center(id: string, time: number): { x: number; y: number } | null {
    const body = this.bodies.find((item) => item.id === id);
    if (!body) return null;
    const pose = bodyPose(body, time, this.bodies, this.g);
    return { x: pose.x, y: pose.y };
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

