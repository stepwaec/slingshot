import * as THREE from "three";
import { jetAngle, shellRadius } from "../../sim/events";
import { bodyPose } from "../../sim/physics";
import { isEditing } from "../../game/state";
import type { Body } from "../../sim/physics";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Placeholder drawings. `design/` has no supernova or quasar asset.
 * The blast ring is the lethal sphere. The shock ring is the remnant front.
 * The quasar is a bar along the jet. All three follow sim time.
 */
export const createHazards: VisualFactory = (_theme, level) => new HazardsVisual(level);

const ringFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float ring = 1.0 - smoothstep(0.012, 0.012 + fw, abs(r - 0.96));
  if (ring < 0.02) discard;
  gl_FragColor = vec4(uColor, ring * uAlpha);
}
`;

const barFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
void main() {
  float edge = 1.0 - smoothstep(0.85, 1.0, abs(vLocal.y));
  float fade = 1.0 - smoothstep(0.15, 1.0, abs(vLocal.x));
  float a = edge * fade * 0.55;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

class HazardsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly bodies: readonly Body[];
  private readonly g: number;
  private readonly blasts: { body: Body; mesh: THREE.Mesh }[] = [];
  private readonly shocks: { body: Body; mesh: THREE.Mesh }[] = [];
  private readonly jets: { body: Body; mesh: THREE.Mesh }[] = [];

  constructor(level: Parameters<VisualFactory>[1]) {
    this.object.name = "hazards";
    this.bodies = level.bodies;
    this.g = level.g;
    for (const body of level.bodies) {
      if (body.supernova) {
        this.blasts.push({ body, mesh: ring(body.supernova.blast, "#FF5A5F", 0.7) });
        this.shocks.push({ body, mesh: ring(1, "#FF5A1F", 0.85) });
      }
      if (body.quasar) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), shader(barFrag, { uColor: { value: srgbVec("#E541C9") } }));
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        mesh.name = `${body.id}-jet`;
        this.jets.push({ body, mesh });
      }
    }
    for (const item of [...this.blasts, ...this.shocks, ...this.jets]) this.object.add(item.mesh);
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = shownTime(game);
    for (const blast of this.blasts) {
      const pose = bodyPose(blast.body, time, this.bodies, this.g);
      blast.mesh.position.set(pose.x, pose.y, 0);
      blast.mesh.visible = true;
    }
    for (const shock of this.shocks) {
      const nova = shock.body.supernova;
      const radius = nova ? shellRadius(nova, time) : 0;
      const pose = bodyPose(shock.body, time, this.bodies, this.g);
      shock.mesh.visible = radius > 1;
      shock.mesh.position.set(pose.x, pose.y, 0);
      shock.mesh.scale.set(radius, radius, 1);
    }
    for (const jet of this.jets) {
      const spec = jet.body.quasar;
      if (!spec) continue;
      const pose = bodyPose(jet.body, time, this.bodies, this.g);
      const angle = jetAngle(spec, time);
      jet.mesh.position.set(pose.x, pose.y, 0);
      jet.mesh.rotation.z = angle;
      jet.mesh.scale.set(spec.reach, Math.max(6, 2 * spec.reach * Math.sin(spec.cone)), 1);
      jet.mesh.visible = true;
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function shownTime(game: VisualFrame["game"]): number {
  if (isEditing(game) && game.mode === "planning") {
    return game.cursorStep === null ? 0 : game.cursorStep * game.level.dt;
  }
  return game.ship.t;
}

function ring(radius: number, color: string, alpha: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    shader(ringFrag, { uColor: { value: srgbVec(color) }, uAlpha: { value: alpha } }),
  );
  mesh.scale.set(radius, radius, 1);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}
