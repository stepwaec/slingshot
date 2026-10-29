import * as THREE from "three";
import { bodyPose, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { isEditing } from "../../game/state";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Drift arrow for a rogue planet. The disc itself is `rogue-planet.svg`,
 * drawn by the gallery. The arrow is planning and pause only, along the
 * sim velocity. `rogue.drift` is `#8B95B5`.
 */
export const createRogue: VisualFactory = (theme, level) => new RogueVisual(theme, level);

class RogueVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly views: { body: Body; arrow: THREE.Mesh }[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "rogues";
    this.object.userData.asset = theme.assets.rogue;
    let order = 6;
    for (const body of level.bodies) {
      if (body.kind !== "rogue") continue;
      const arrow = new THREE.Mesh(
        new THREE.PlaneGeometry(body.radius * 1.6, 1.2),
        new THREE.MeshBasicMaterial({
          color: 0x8b95b5,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          toneMapped: false,
        }),
      );
      arrow.renderOrder = order++;
      arrow.name = `${body.id}-drift`;
      this.object.add(arrow);
      this.views.push({ body, arrow });
    }
  }

  update(frame: VisualFrame): void {
    const time = (frame.game.mode === "planning" ? 0 : frame.game.ship.step) * frame.game.level.dt;
    const show = isEditing(frame.game);
    for (const view of this.views) {
      const pose = bodyPose(view.body, time, frame.game.level.bodies, frame.game.level.g);
      const speed = Math.hypot(pose.vx, pose.vy);
      view.arrow.visible = show && speed > 1e-3;
      if (!(speed > 1e-3)) continue;
      const reach = view.body.radius * 1.8;
      view.arrow.position.set(pose.x + (pose.vx / speed) * reach, pose.y + (pose.vy / speed) * reach, 0);
      view.arrow.rotation.z = Math.atan2(pose.vy, pose.vx);
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
