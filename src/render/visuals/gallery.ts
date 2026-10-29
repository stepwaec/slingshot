import * as THREE from "three";
import { artForBody, artForNebula, artMesh, loadArtTexture, poseArt, type ArtFit } from "../art-sprite";
import {
  brightestOffset,
  cometTailStretch,
  ellipsePeriapsis,
  flareOpacity,
  prominenceWindow,
  pulsarBeamScale,
  SUN_PROMINENCES,
} from "../art-motion";
import { beamAxis, bodyPose, type Body, type Nebula } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Claude's SVG assets. A sun is several layers so the prominences and flare
 * can follow star.svg. A comet's tail is its own sprite. A pulsar's beams
 * are scaled onto the level's damage reach. Planets still turn their baked
 * lit side toward the brightest star.
 */
export const createGallery: VisualFactory = (theme, level) => new GalleryVisual(theme, level);

type Role = "body" | "back" | "front" | "prom" | "flare" | "tail" | "beams";

interface Sprite {
  mesh: THREE.Mesh;
  fit: ArtFit;
  body: Body | null;
  cloud: Nebula | null;
  role: Role;
  prom?: (typeof SUN_PROMINENCES)[number];
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
      if (isSun(body)) {
        this.addSun(body);
        continue;
      }
      if (body.look === "comet") {
        this.addComet(body);
        continue;
      }
      if (body.look === "pulsar") {
        this.addPulsar(body);
        continue;
      }
      const fit = artForBody(body, theme);
      if (!fit) continue;
      this.add(fit, body.id, body, null, "body", 0);
    }
    for (const cloud of level.nebulae ?? []) {
      const fit = artForNebula(cloud, theme);
      this.add(fit, cloud.id, null, cloud, "body", 6);
    }
  }

  private addSun(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const back: ArtFit = {
      ...base,
      bake: { tag: "sun-back", prep: sunBack },
    };
    const front: ArtFit = {
      ...base,
      bake: { tag: "sun-front", prep: sunFront },
    };
    this.add(back, `${body.id}-back`, body, null, "back", 0, true);
    for (const prom of SUN_PROMINENCES) {
      const layer: ArtFit = {
        ...base,
        bake: { tag: prom.id, prep: sunProm(prom.id) },
      };
      this.add(layer, `${body.id}-${prom.id}`, body, null, "prom", 1, false, prom);
    }
    const flare: ArtFit = {
      ...base,
      bake: { tag: "sun-flare", prep: sunFlare },
    };
    this.add(flare, `${body.id}-flare`, body, null, "flare", 1);
    this.add(front, `${body.id}-front`, body, null, "front", 2);
  }

  private addComet(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const head: ArtFit = { ...base, spin: "tail", bake: { tag: "comet-head", prep: cometHead } };
    const tail: ArtFit = { ...base, spin: "tail", hide: [], bake: { tag: "comet-tail", prep: cometTail } };
    this.add(tail, `${body.id}-tail`, body, null, "tail", 0);
    this.add(head, body.id, body, null, "body", 1);
  }

  private addPulsar(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const beams: ArtFit = { ...base, spin: "beam", bake: { tag: "pulsar-beams", prep: pulsarBeams } };
    const star: ArtFit = { ...base, spin: "none", bake: { tag: "pulsar-body", prep: pulsarBody } };
    this.add(beams, `${body.id}-beams`, body, null, "beams", 0);
    this.add(star, body.id, body, null, "body", 1);
  }

  private add(
    fit: ArtFit,
    name: string,
    body: Body | null,
    cloud: Nebula | null,
    role: Role,
    order: number,
    sun = false,
    prom?: (typeof SUN_PROMINENCES)[number],
  ): void {
    const mesh = artMesh(fit, name);
    mesh.renderOrder = order;
    this.object.add(mesh);
    this.sprites.push({ mesh, fit, body, cloud, role, prom });
    void this.paint(mesh, fit, sun);
  }

  private async paint(mesh: THREE.Mesh, fit: ArtFit, sun: boolean): Promise<void> {
    const texture = await loadArtTexture(fit);
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.map = texture;
    material.opacity = 1;
    material.needsUpdate = true;
    if (sun) document.documentElement.dataset.starArt = "1";
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = (game.mode === "planning" ? 0 : game.ship.step) * game.level.dt;
    const bodies = game.level.bodies;
    const seconds = frame.now / 1000;
    for (const sprite of this.sprites) {
      if (sprite.cloud) {
        const cloud = sprite.cloud;
        poseArt(sprite.mesh, sprite.fit, cloud.x, cloud.y, cloud.rx, cloud.angle, cloud.ry);
        continue;
      }
      const body = sprite.body;
      if (!body) continue;
      const pose = bodyPose(body, time, bodies, game.level.g);
      const rot = rotation(sprite, pose.x, pose.y, time, bodies, frame.now, game.level.g);
      if (sprite.role === "prom" && sprite.prom) {
        poseProminence(sprite, pose.x, pose.y, body.radius, seconds);
        continue;
      }
      if (sprite.role === "flare") {
        const material = sprite.mesh.material as THREE.MeshBasicMaterial;
        const alpha = flareOpacity(seconds);
        material.opacity = alpha;
        sprite.mesh.visible = alpha > 0.01;
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, rot);
        continue;
      }
      if (sprite.role === "tail") {
        const aim = towardStar(pose.x, pose.y, time, bodies, game.level.g);
        const distance = aim ? Math.hypot(aim.x, aim.y) : 1;
        const peri = ellipsePeriapsis(body.orbit?.a, body.orbit?.e, body.orbit?.radius);
        const stretch = cometTailStretch(distance, peri);
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, rot, undefined, stretch.along, stretch.across);
        continue;
      }
      if (sprite.role === "beams") {
        const reach = body.beam?.reach ?? 0;
        const scale = pulsarBeamScale(body.radius, sprite.fit.svgRadius, reach);
        const base = body.radius / sprite.fit.svgRadius;
        const along = base > 0 ? scale.sy / base : 1;
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, rot, undefined, along, 1);
        continue;
      }
      poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, rot);
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function isSun(body: Body): boolean {
  return body.kind === "star" && (body.look === undefined || body.look === "sun");
}

function poseProminence(sprite: Sprite, x: number, y: number, radius: number, seconds: number): void {
  const prom = sprite.prom;
  if (!prom) return;
  const window = prominenceWindow(seconds, prom.begin, prom.dur);
  const material = sprite.mesh.material as THREE.MeshBasicMaterial;
  material.opacity = window.opacity;
  sprite.mesh.visible = window.opacity > 0.02;
  const fit = sprite.fit;
  const world = radius / fit.svgRadius;
  const rad = (prom.angle * Math.PI) / 180;
  const footX = 46 * Math.cos(rad);
  const footY = -46 * Math.sin(rad);
  const s = window.scale;
  sprite.mesh.scale.set(world * s, world * s, 1);
  sprite.mesh.rotation.z = 0;
  sprite.mesh.position.set(x + footX * world * (1 - s), y + footY * world * (1 - s), 0);
}

function rotation(sprite: Sprite, x: number, y: number, time: number, bodies: readonly Body[], now: number, g: number): number {
  const fit = sprite.fit;
  if (fit.spin === "light" && fit.light) {
    const aim = towardStar(x, y, time, bodies, g);
    if (!aim) return 0;
    const light = fit.light;
    return Math.atan2(aim.y, aim.x) - Math.atan2(light.y, light.x);
  }
  if (fit.spin === "tail") {
    const aim = towardStar(x, y, time, bodies, g);
    if (!aim) return 0;
    return Math.atan2(-aim.y, -aim.x);
  }
  if (fit.spin === "beam" && sprite.body) {
    const axis = beamAxis(sprite.body, time);
    if (!axis) return 0;
    return Math.atan2(axis.y, axis.x) - Math.PI / 2;
  }
  if (fit.spin === "neutron") return -((now / 1000) * Math.PI * 2) / 6;
  return 0;
}

function towardStar(x: number, y: number, time: number, bodies: readonly Body[], g: number): { x: number; y: number } | null {
  const samples = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star" && body.kind !== "blackhole") continue;
    const pose = bodyPose(body, time, bodies, g);
    samples.push({ x: pose.x, y: pose.y, mass: body.mass });
  }
  return brightestOffset(samples, x, y);
}

function sunBack(doc: Document): void {
  for (const id of ["starProminences", "starFlare", "starDisc"]) doc.getElementById(id)?.remove();
  removeDirectCircles(doc.getElementById("star"));
}

function sunFront(doc: Document): void {
  for (const id of ["starBreathe", "starProminences", "starFlare"]) doc.getElementById(id)?.remove();
}

function sunProm(id: string): (doc: Document) => void {
  return (doc) => {
    for (const drop of ["starBreathe", "starFlare", "starDisc"]) doc.getElementById(drop)?.remove();
    removeDirectCircles(doc.getElementById("star"));
    const proms = doc.getElementById("starProminences");
    if (proms) {
      for (const child of [...proms.children]) {
        if (!child.querySelector(`#${id}`)) child.remove();
      }
    }
    const node = doc.getElementById(id);
    if (!node) return;
    node.setAttribute("opacity", "1");
    node.setAttribute("transform", "scale(1)");
    node.querySelectorAll("animate, animateTransform").forEach((item) => item.remove());
  };
}

function removeDirectCircles(star: Element | null): void {
  if (!star) return;
  for (const child of [...star.children]) {
    if (child.localName === "circle") child.remove();
  }
}

function sunFlare(doc: Document): void {
  for (const id of ["starBreathe", "starProminences", "starDisc"]) doc.getElementById(id)?.remove();
  removeDirectCircles(doc.getElementById("star"));
  const flare = doc.getElementById("starFlare");
  if (!flare) return;
  flare.setAttribute("opacity", "1");
  flare.querySelectorAll("animate").forEach((node) => node.remove());
}

function cometHead(doc: Document): void {
  doc.getElementById("cmTails")?.remove();
  doc.getElementById("cmHarvest")?.remove();
}

function cometTail(doc: Document): void {
  const root = doc.getElementById("comet");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.id !== "cmTails") child.remove();
  }
}

function pulsarBody(doc: Document): void {
  doc.getElementById("puSweep")?.remove();
}

function pulsarBeams(doc: Document): void {
  const root = doc.getElementById("pulsar");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.id !== "puSweep") child.remove();
  }
  root.querySelectorAll("animateTransform").forEach((node) => node.remove());
}
