import * as THREE from "three";
import { observatoryPlacards, observatoryShips, OBSERVATORY_ID } from "../../level/observatory";
import { bodyPose, type Body } from "../../sim/physics";
import { palette } from "../palette";
import { ENGINE_PLUME_IDS, visibleParts, type EngineLook, type PartKey } from "../ship-art";
import { bakedSvgUrl, rasterSvg } from "../svg-bake";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Name labels, and the static ship builds, for the Observatory chart.
 * Other levels get an empty group. Labels stay 11 px on screen.
 * design/style.md: uppercase, weight 500, colour `--text`.
 */
export const createPlacards: VisualFactory = (theme, level) => new PlacardVisual(theme, level);

const LABEL_PX = 16;

interface Tag {
  sprite: THREE.Sprite;
  x: number;
  y: number;
  clearance: number;
  aspect: number;
  bodyId?: string;
  /** World distance to the nearest other label. Caps width so names do not collide. */
  gap: number;
}

class PlacardVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly bodies: readonly Body[];
  private readonly tags: Tag[] = [];
  private readonly g: number;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "placards";
    this.bodies = level.bodies;
    this.g = level.g;
    if (level.id !== OBSERVATORY_ID || typeof document === "undefined") return;
    const cards = observatoryPlacards(level);
    for (const card of cards) {
      const made = makeLabel(card.name);
      if (!made) continue;
      made.sprite.name = `label-${card.id}`;
      made.sprite.renderOrder = 24;
      this.object.add(made.sprite);
      this.tags.push({
        sprite: made.sprite,
        x: card.x,
        y: card.y,
        clearance: card.clearance,
        aspect: made.aspect,
        bodyId: card.bodyId,
        gap: nearestGap(cards, card.id, card.x, card.y),
      });
    }
    this.object.add(new ExhibitShips(theme).object);
  }

  update(frame: VisualFrame): void {
    if (this.tags.length === 0) return;
    const zoom = frame.game.camera.zoom > 0 ? frame.game.camera.zoom : 1;
    const time = frame.game.mode === "planning" ? 0 : frame.game.ship.t;
    const worldH = LABEL_PX / zoom;
    for (const tag of this.tags) {
      let x = tag.x;
      let y = tag.y;
      if (tag.bodyId) {
        const body = this.bodies.find((item) => item.id === tag.bodyId);
        if (body) {
          const pose = bodyPose(body, time, this.bodies, this.g);
          x = pose.x;
          y = pose.y;
        }
      }
      tag.sprite.position.set(x, y - tag.clearance, 0);
      const naturalW = worldH * tag.aspect;
      const capW = tag.gap * 0.78;
      const w = Math.min(naturalW, capW);
      tag.sprite.scale.set(w, w / tag.aspect, 1);
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function nearestGap(cards: { id: string; x: number; y: number }[], id: string, x: number, y: number): number {
  let best = 480;
  for (const other of cards) {
    if (other.id === id) continue;
    const distance = Math.hypot(other.x - x, other.y - y);
    if (distance > 8 && distance < best) best = distance;
  }
  return best;
}

function makeLabel(text: string): { sprite: THREE.Sprite; aspect: number } | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const label = text.toUpperCase();
  ctx.font = "500 22px ui-sans-serif, sans-serif";
  const measured = Math.ceil(ctx.measureText(label).width) + 20;
  canvas.width = Math.max(48, measured);
  canvas.height = 32;
  ctx.font = "500 22px ui-sans-serif, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.strokeStyle = palette.vignette;
  ctx.strokeText(label, canvas.width / 2, 17);
  ctx.fillStyle = palette.text;
  ctx.fillText(label, canvas.width / 2, 17);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.center.set(0.5, 1);
  sprite.frustumCulled = false;
  return { sprite, aspect: canvas.width / canvas.height };
}

class ExhibitShips {
  readonly object = new THREE.Group();

  constructor(theme: Theme) {
    this.object.name = "exhibit-ships";
    const frame = new THREE.PlaneGeometry(theme.ship.frameWidth, theme.ship.frameHeight);
    frame.translate(0, theme.ship.frameShift, 0);
    const scale = 84 / theme.ship.frameHeight;
    const meshes: { key: PartKey; engine?: EngineLook; mesh: THREE.Mesh }[] = [];
    for (const exhibit of observatoryShips) {
      const group = new THREE.Group();
      group.name = exhibit.id;
      group.position.set(exhibit.x, exhibit.y, 0);
      group.scale.set(scale, scale, 1);
      const shown = new Set(visibleParts(exhibit.build, "none"));
      const add = (key: PartKey, order: number, engine?: EngineLook): void => {
        const mesh = partMesh(frame, order);
        mesh.name = engine ? `${exhibit.id}-${engine}` : `${exhibit.id}-${key}`;
        mesh.visible = engine ? shown.has("engine") && exhibit.build.engine === engine : shown.has(key);
        group.add(mesh);
        meshes.push({ key, engine, mesh });
      };
      add("solar", 2);
      add("tanks", 2);
      add("platingBack", 2);
      add("engine", 6, "chemical");
      add("engine", 6, "ion");
      add("engine", 6, "pulse");
      add("engine", 6, "spin");
      add("hull", 6);
      add("platingFront", 7);
      add("cryo", 7);
      add("scoop", 7);
      add("sensors", 7);
      add("shield", 7);
      this.object.add(group);
    }
    void paintShips(theme, meshes);
  }
}

function partMesh(geometry: THREE.PlaneGeometry, order: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

async function paintShips(
  theme: Theme,
  meshes: { key: PartKey; engine?: EngineLook; mesh: THREE.Mesh }[],
): Promise<void> {
  const assets = theme.assets;
  const load = async (url: string, hide: readonly string[] = []): Promise<THREE.CanvasTexture> => {
    const blob = await bakedSvgUrl(url, hide);
    const canvas = await rasterSvg(blob, 192, 320);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  try {
    const [hull, solar, tanks, platingBack, platingFront, cryo, scoop, sensors, shield, chemical, ion, pulse, spin] = await Promise.all([
      load(assets.hull),
      load(assets.solar),
      load(assets.tanks),
      load(assets.plating, ["shipModPlatingFront"]),
      load(assets.plating, ["shipModPlatingBack"]),
      load(assets.cryo),
      load(assets.scoop),
      load(assets.sensors),
      load(assets.shield),
      load(assets.engineChemical, ENGINE_PLUME_IDS.chemical),
      load(assets.engineIon, ENGINE_PLUME_IDS.ion),
      load(assets.enginePulse, ENGINE_PLUME_IDS.pulse),
      load(assets.engineSpin),
    ]);
    const byKey = new Map<PartKey, THREE.Texture>([
      ["hull", hull],
      ["solar", solar],
      ["tanks", tanks],
      ["platingBack", platingBack],
      ["platingFront", platingFront],
      ["cryo", cryo],
      ["scoop", scoop],
      ["sensors", sensors],
      ["shield", shield],
    ]);
    const byEngine = new Map<EngineLook, THREE.Texture>([
      ["chemical", chemical],
      ["ion", ion],
      ["pulse", pulse],
      ["spin", spin],
    ]);
    for (const item of meshes) {
      const texture = item.engine ? byEngine.get(item.engine) : byKey.get(item.key);
      if (!texture) continue;
      const mat = item.mesh.material as THREE.MeshBasicMaterial;
      mat.map = texture;
      mat.opacity = 1;
      mat.needsUpdate = true;
    }
  } catch {
    // The chart still has the labels if a sprite fails to bake.
  }
}
