import * as THREE from "three";
import { shipLoadout } from "../../game/upgrades";
import { solarRechargeRate } from "../../sim/physics";
import { projectToScreen } from "../camera";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Gold pulse under the ship while the panels are charging.
 * The ring is its own visual, so the ship sprite stays untouched.
 * It reads `solarRechargeRate`, the same number the tank integrates.
 */
export const createRecharge: VisualFactory = (theme) => new RechargeVisual(theme);

const fragment = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float band = 1.0 - smoothstep(0.04, 0.04 + fw, abs(r - 0.72));
  if (band <= 0.0) discard;
  gl_FragColor = vec4(uColor, uAlpha * band);
}
`;

class RechargeVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly alpha: THREE.IUniform<number>;
  private readonly scratch = { x: 0, y: 0 };

  constructor(theme: Theme) {
    this.object.name = "recharge";
    this.object.userData.asset = theme.assets.solarRecharge;
    this.alpha = { value: 0 };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(fragment, { uColor: { value: srgbVec("#FFE08A") }, uAlpha: this.alpha }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.object.add(this.mesh);
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const solar = shipLoadout(game.upgrades).solar;
    const pose = game.mode === "planning" ? game.initial : game.ship;
    const rate = solarRechargeRate(pose.x, pose.y, pose.t, game.level.bodies, solar, game.level.g);
    const charging = game.mode === "flying" && solar > 0 && rate >= solar * 0.08;
    this.mesh.visible = charging;
    if (!charging) return;
    projectToScreen(pose.x, pose.y, frame.width, frame.height, this.scratch);
    const cycle = (frame.now / 1200) % 1;
    const radius = 9 + cycle * 9;
    this.mesh.position.set(this.scratch.x, frame.height - this.scratch.y, 0);
    this.mesh.scale.set(radius, radius, 1);
    this.alpha.value = 0.75 * (1 - cycle);
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
