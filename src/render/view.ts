import * as THREE from "three";
import type { Game } from "../game/state";
import type { Level } from "../level/catalog";
import { bindSpaceTimeCamera, syncTopDown, topDownCamera } from "./camera";
import { SelectiveBloom } from "./shaders/bloom";
import { theme } from "./theme";
import type { Visual, VisualSpace } from "./visual";
import { visualFactories } from "./visuals/index";

/**
 * WebGL view.
 *
 * `world` holds world-space visuals on the sim's XY plane. `topDown` looks
 * straight down that plane. `rig` carries a parked perspective camera
 * (`spaceTime`). The chart stays orthographic. Screen-pixel visuals stay in
 * their own scene so stroke widths do not zoom.
 *
 * Visuals are created only through `visualFactories`.
 */
export class SpaceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new THREE.Group();
  readonly rig = new THREE.Group();
  readonly spaceTime: THREE.PerspectiveCamera;
  private readonly bgScene = new THREE.Scene();
  private readonly worldScene = new THREE.Scene();
  private readonly screenScene = new THREE.Scene();
  private readonly screenCamera: THREE.OrthographicCamera;
  private visuals: Visual[];
  private readonly parents: Record<VisualSpace, THREE.Object3D>;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private readonly bloom = new SelectiveBloom();

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(theme.colors.bg, 1);

    this.world.name = "world";
    this.rig.name = "camera-rig";
    this.spaceTime = new THREE.PerspectiveCamera(35, 1, 1, 50000);
    this.spaceTime.name = "space-time";
    this.spaceTime.position.set(0, -1400, 1100);
    this.spaceTime.up.set(0, 0, 1);
    this.spaceTime.lookAt(0, 0, 0);
    this.rig.add(this.spaceTime);
    bindSpaceTimeCamera(this.spaceTime);

    this.screenCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -50, 50);
    this.screenCamera.position.set(0, 0, 10);
    this.screenCamera.quaternion.identity();

    this.parents = {
      background: this.bgScene,
      world: this.world,
      screen: this.screenScene,
    };
    this.visuals = this.mount(game.level);
    this.worldScene.add(this.world);
    this.worldScene.add(this.rig);
  }

  /** Rebuild visuals after the level's bodies change. The renderer stays. */
  reload(level: Level): void {
    for (const visual of this.visuals) {
      visual.object.removeFromParent();
      visual.dispose();
    }
    this.visuals = this.mount(level);
    for (const visual of this.visuals) visual.resize?.(this.width, this.height, this.dpr);
  }

  private mount(level: Level): Visual[] {
    return (Object.keys(visualFactories) as (keyof typeof visualFactories)[]).map((name) => {
      const visual = visualFactories[name](theme, level);
      this.parents[visual.space].add(visual.object);
      return visual;
    });
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.screenCamera.left = 0;
    this.screenCamera.right = this.width;
    this.screenCamera.top = this.height;
    this.screenCamera.bottom = 0;
    this.screenCamera.zoom = 1;
    this.screenCamera.updateProjectionMatrix();
    for (const visual of this.visuals) visual.resize?.(this.width, this.height, this.dpr);
    this.spaceTime.aspect = this.width / Math.max(1, this.height);
    this.spaceTime.updateProjectionMatrix();
  }

  render(game: Game, now: number): void {
    const width = this.width;
    const height = this.height;
    syncTopDown(game.camera, width, height);
    const frame = { game, width, height, now, dpr: this.dpr };
    for (const visual of this.visuals) visual.update(frame);

    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.bgScene, this.screenCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.worldScene, topDownCamera);
    this.bloom.composite(this.renderer, this.worldScene, topDownCamera, this.screenScene, this.screenCamera);
    this.renderer.setRenderTarget(null);
    this.renderer.clearDepth();
    this.renderer.render(this.screenScene, this.screenCamera);
  }
}
