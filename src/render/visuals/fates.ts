import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Placeholder for scripted collisions. `design/` has no impact flash or
 * tidal stream. A falling body grows an orange ring. An impact leaves a
 * ring at the meeting point for three seconds. Both follow sim time.
 */
export const createFates: VisualFactory = (_theme, level) => new FatesVisual(level);

const fragment = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float ring = 1.0 - smoothstep(0.04, 0.04 + fw, abs(r - 0.82));
  if (ring < 0.02) discard;
  gl_FragColor = vec4(uColor, ring * uAlpha);
}
`;

class FatesVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly bodies: readonly Body[];
  private readonly g: number;
  private readonly rings: { body: Body; mesh: THREE.Mesh; alpha: THREE.IUniform<number> }[] = [];

  constructor(level: Parameters<VisualFactory>[1]) {
    this.object.name = "fates";
    this.bodies = level.bodies;
    this.g = level.g;
    for (const body of level.bodies) {
      if (!body.script) continue;
      const alpha = { value: 0.8 };
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(1, 48),
        shader(fragment, { uColor: { value: srgbVec("#FF5A1F") }, uAlpha: alpha }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      mesh.name = `${body.id}-fate`;
      this.object.add(mesh);
      this.rings.push({ body, mesh, alpha });
    }
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = game.mode === "planning" ? (game.cursorStep === null ? 0 : game.cursorStep * game.level.dt) : game.ship.t;
    for (const ring of this.rings) {
      const script = ring.body.script;
      if (!script) continue;
      if (script.kind === "consume") {
        const falling = time >= script.start && time < script.end;
        const aftermath = time >= script.end && time < script.end + 3;
        ring.mesh.visible = falling || aftermath;
        if (!ring.mesh.visible) continue;
        const sample = Math.min(time, script.end);
        const pose = bodyPose(ring.body, sample, this.bodies, this.g);
        const u = (sample - script.start) / Math.max(1e-6, script.end - script.start);
        ring.alpha.value = aftermath ? 0.9 : 0.35 + 0.6 * u;
        const span = ring.body.radius * (aftermath ? 2.4 : 1.3 + u);
        ring.mesh.position.set(pose.x, pose.y, 0);
        ring.mesh.scale.set(span, span, 1);
        continue;
      }
      const flash = time >= script.at && time < script.at + 3;
      ring.mesh.visible = flash;
      if (!flash) continue;
      const pose = bodyPose(ring.body, script.at, this.bodies, this.g);
      ring.alpha.value = 0.85;
      ring.mesh.position.set(pose.x, pose.y, 0);
      ring.mesh.scale.set(ring.body.radius * 2.2, ring.body.radius * 2.2, 1);
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
