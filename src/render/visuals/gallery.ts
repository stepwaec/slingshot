import * as THREE from "three";
import { artForBody, artForNebula, artMesh, loadArtTexture, poseArt, type ArtFit } from "../art-sprite";
import { beamAxis, bodyPose, type Body, type Nebula } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Claude's SVG assets, one sprite each. The other factories skip a body
 * when `artForBody` claims it, so the procedural disc is not drawn on top.
 */
export const createGallery: VisualFactory = (theme, level) => new GalleryVisual(theme, level);

interface Sprite {
  mesh: THREE.Mesh;
  fit: ArtFit;
  body: Body | null;
  cloud: Nebula | null;
}

class GalleryVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly sprites: Sprite[] = [];
  private readonly theme: Theme;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "design-art";
    for (const body of level.bodies) {
      const fit = artForBody(body, theme);
      if (!fit) continue;
      const mesh = artMesh(fit, body.id);
      this.object.add(mesh);
      this.sprites.push({ mesh, fit, body, cloud: null });
      void this.paint(mesh, fit, body.kind === "star" && !body.look);
    }
    for (const cloud of level.nebulae ?? []) {
      const fit = artForNebula(cloud, theme);
      const mesh = artMesh(fit, cloud.id);
      mesh.renderOrder = 6;
      this.object.add(mesh);
      this.sprites.push({ mesh, fit, body: null, cloud });
      void this.paint(mesh, fit, false);
    }
  }

  private async paint(mesh: THREE.Mesh, fit: ArtFit, sun: boolean): Promise<void> {
    const texture = await loadArtTexture(fit);
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.map = texture;
    material.opacity = 1;
    material.needsUpdate = true;
    if (sun || fit.url === this.theme.assets.star) document.documentElement.dataset.starArt = "1";
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = (game.mode === "planning" ? 0 : game.ship.step) * game.level.dt;
    const bodies = game.level.bodies;
    for (const sprite of this.sprites) {
      if (sprite.body) {
        const pose = bodyPose(sprite.body, time, bodies, game.level.g);
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, sprite.body.radius, turn(sprite, pose.x, pose.y, time, bodies, frame.now, game.level.g));
        continue;
      }
      const cloud = sprite.cloud;
      if (!cloud) continue;
      poseArt(sprite.mesh, sprite.fit, cloud.x, cloud.y, cloud.rx, cloud.angle, cloud.ry);
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function turn(
  sprite: Sprite,
  x: number,
  y: number,
  time: number,
  bodies: readonly Body[],
  now: number,
  g: number,
): number {
  const fit = sprite.fit;
  if (fit.spin === "light" && fit.light) {
    const aim = towardStar(x, y, time, bodies, g);
    if (!aim) return 0;
    return Math.atan2(aim.y, aim.x) - Math.atan2(fit.light.y, fit.light.x);
  }
  if (fit.spin === "tail") {
    const aim = towardStar(x, y, time, bodies, g);
    if (!aim) return 0;
    return Math.atan2(-aim.y, -aim.x);
  }
  if (fit.spin === "beam" && sprite.body) {
    const axis = beamAxis(sprite.body, time);
    if (!axis) return 0;
    const rest = Math.PI / 2 - (25 * Math.PI) / 180;
    return Math.atan2(axis.y, axis.x) - rest;
  }
  if (fit.spin === "neutron") return -((now / 1000) * Math.PI * 2) / 6;
  return 0;
}

function towardStar(x: number, y: number, time: number, bodies: readonly Body[], g: number): { x: number; y: number } | null {
  let best = 0;
  let aim: { x: number; y: number } | null = null;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star" && body.kind !== "blackhole") continue;
    const pose = bodyPose(body, time, bodies, g);
    const dx = pose.x - x;
    const dy = pose.y - y;
    const d2 = dx * dx + dy * dy;
    if (!(d2 > 1)) continue;
    const weight = body.mass / d2;
    if (weight > best) {
      best = weight;
      aim = { x: dx, y: dy };
    }
  }
  return aim;
}
