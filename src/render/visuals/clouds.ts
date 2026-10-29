import * as THREE from "three";
import { disposeObject, type Visual, type VisualFactory } from "../visual";

/**
 * Level nebulae are Claude's SVG clouds, drawn by the art gallery above the
 * bodies. This factory stays so the draw-order slot is still named.
 */
export const createClouds: VisualFactory = () => new CloudVisual();

class CloudVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();

  constructor() {
    this.object.name = "clouds";
  }

  update(): void {}

  dispose(): void {
    disposeObject(this.object);
  }
}
