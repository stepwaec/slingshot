import * as THREE from "three";
import type { Nebula } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Level nebulae, drawn over the bodies so a dark cloud hides what is inside.
 * The ship and the predicted path are later in the draw order and stay visible.
 * Scooping is in the sim; this only paints the cloud.
 */
export const createClouds: VisualFactory = (theme, level) => new CloudVisual(theme, level);

const fragment = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uAlpha;
uniform float uDark;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float edge = smoothstep(0.72, 1.0, r);
  float body = (1.0 - smoothstep(0.2, 1.0, r)) * uAlpha;
  float rim = uDark > 0.5 ? (1.0 - smoothstep(0.02, 0.12, abs(r - 0.86))) * 0.45 : 0.0;
  vec3 col = mix(uColor, uRim, rim + edge * uDark);
  float a = max(body, rim);
  if (uDark > 0.5) a = max(a, (1.0 - smoothstep(0.15, 0.95, r)) * 0.82);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

const LOOKS = {
  emission: { color: "#B48CFF", rim: "#FF8FB8", alpha: 0.22, dark: 0, asset: "nebulaEmission" },
  reflection: { color: "#7FB8FF", rim: "#E6F4FF", alpha: 0.2, dark: 0, asset: "nebulaReflection" },
  dark: { color: "#070B14", rim: "#C4A574", alpha: 0.3, dark: 1, asset: "nebulaDark" },
} as const;

class CloudVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "clouds";
    const clouds = level.nebulae ?? [];
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i];
      const look = LOOKS[cloud.look];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(fragment, {
          uColor: { value: srgbVec(look.color) },
          uRim: { value: srgbVec(look.rim) },
          uAlpha: { value: look.alpha },
          uDark: { value: look.dark },
        }),
      );
      mesh.scale.set(cloud.rx, cloud.ry, 1);
      mesh.position.set(cloud.x, cloud.y, 0);
      mesh.rotation.z = cloud.angle;
      mesh.renderOrder = 6;
      mesh.name = cloud.id;
      mesh.userData.asset = theme.assets[look.asset];
      this.object.add(mesh);
    }
  }

  update(_frame: VisualFrame): void {}

  dispose(): void {
    disposeObject(this.object);
  }
}

export type { Nebula };
