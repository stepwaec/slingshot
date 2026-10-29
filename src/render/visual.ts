import * as THREE from "three";
import type { Game } from "../game/state";
import type { Level } from "../level/catalog";
import type { Theme } from "./theme";

/** Where the view parents this element. Factories pick one and stay there. */
export type VisualSpace = "background" | "world" | "screen";

export interface VisualFrame {
  game: Game;
  width: number;
  height: number;
  now: number;
  dpr: number;
}

/**
 * One drawable element. A replacement (textured planet, glTF ship, bloom
 * star) implements this and is swapped in `visuals/index.ts`. It may read
 * `theme` and the level. It must not step the simulation.
 */
export interface Visual {
  readonly object: THREE.Object3D;
  readonly space: VisualSpace;
  resize?(width: number, height: number, dpr: number): void;
  update(frame: VisualFrame): void;
  dispose(): void;
}

export type VisualFactory = (theme: Theme, level: Level) => Visual;

export function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      for (const value of Object.values(item)) {
        if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
      }
      item.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}
