import * as THREE from "three";
import { ghostSteps, movingBodies } from "../../game/ghosts";
import { isEditing } from "../../game/state";
import { bodyPose } from "../../sim/physics";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Where a moving body will be. One dashed ring per body at each maneuver
 * node's sim time, and one brighter ring at the path sample under the cursor.
 * Planning and pause only. The rings read `bodyPose`; they do not write the sim.
 * Colour is `path` `#DCE4FF` from style.md, not a grey.
 */
export const createGhosts: VisualFactory = () => new GhostsVisual();

const fragment = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float ring = 1.0 - smoothstep(0.04, 0.04 + fw * 2.0, abs(r - 0.86));
  float ang = atan(vLocal.y, vLocal.x);
  float dash = step(0.45, fract((ang + 3.14159265) / 6.2831853 * 8.0));
  float dot = 1.0 - smoothstep(0.12, 0.12 + fw * 2.0, r);
  float a = max(ring * dash, dot) * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

class GhostsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly rings: { mesh: THREE.Mesh; alpha: THREE.IUniform<number> }[] = [];

  constructor() {
    this.object.name = "ghosts";
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const show = isEditing(game);
    const bodies = show ? movingBodies(game.level.bodies) : [];
    const drawn = game.mode === "planning" ? 0 : game.ship.step;
    const steps = show ? ghostSteps(game.nodes, game.cursorStep, drawn) : [];
    let count = 0;
    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      const time = step * game.level.dt;
      const cursor = step === game.cursorStep;
      for (let b = 0; b < bodies.length; b++) {
        const body = bodies[b];
        const pose = bodyPose(body, time, game.level.bodies, game.level.g);
        const ring = this.ensure(count);
        count += 1;
        ring.mesh.visible = true;
        ring.mesh.position.set(pose.x, pose.y, 0);
        const radius = Math.max(body.radius, 8);
        ring.mesh.scale.set(radius, radius, 1);
        ring.alpha.value = cursor ? 0.95 : 0.5;
      }
    }
    for (let i = count; i < this.rings.length; i++) this.rings[i].mesh.visible = false;
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private ensure(index: number): { mesh: THREE.Mesh; alpha: THREE.IUniform<number> } {
    const existing = this.rings[index];
    if (existing) return existing;
    const alpha = { value: 0.5 };
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      shader(fragment, { uColor: { value: srgbVec("#DCE4FF") }, uAlpha: alpha }),
    );
    mesh.name = `ghost-${index}`;
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    this.object.add(mesh);
    const ring = { mesh, alpha };
    this.rings.push(ring);
    return ring;
  }
}
