import * as THREE from "three";
import type { Game } from "../../game/state";
import { bodyPose, type Body } from "../../sim/physics";
import { projectToScreen, syncTopDown } from "../camera";
import { createBodyShader, shaderFamily } from "../shaders/families";
import {
  artLightLocked,
  impostorSide,
  lightDirection,
  LOD_RADIUS_PX,
  planetSide,
  ringOctaves,
  screenRadius,
  shaderRendering,
  cosmeticSeconds,
  simSeconds,
} from "../shaders/impostor";
import { giantArtLight } from "../shaders/giant-params";
import { planetArtLight } from "../shaders/planet-params";
import { theme, type Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * One impostor quad per body (design/shader-specs.md §1).
 * A quad stays hidden until its family registers a shader. The SVG gallery
 * draws the rest, and draws everything when `rendering.shaders` is off.
 */
export const createImpostors: VisualFactory = (theme, level) => new ImpostorVisual(theme, level);

interface Slot {
  body: Body;
  mesh: THREE.Mesh;
  /** World-unit side of the quad. 2 r until a family sets a larger extent. */
  side: number;
  designR: number;
  baseProm: number;
  baseFaculae: number;
  baseProW: number;
}

class ImpostorVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly scratch = { x: 0, y: 0 };

  constructor(_theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "shader-bodies";
    const on = shaderRendering();
    for (const body of level.bodies) {
      const material = on && shaderFamily(body) ? createBodyShader(body) : null;
      const designR = numberUniform(material, "uDesignR", body.radius);
      const hazeR = numberUniform(material, "uHazeR", 1);
      const smooth = numberUniform(material, "uSmooth", 0);
      const extent = numberUniform(material, "uExtent", 0);
      const side = !material
        ? Math.max(body.radius, 0) * 2
        : extent > 0
          ? planetSide(body.radius, extent)
          : impostorSide(body.radius, hazeR, smooth);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material ?? hiddenMaterial());
      mesh.name = `${body.id}-impostor`;
      mesh.frustumCulled = false;
      const family = shaderFamily(body);
      mesh.renderOrder = family === "planet" || family === "giant" ? 4 : -1;
      mesh.visible = material !== null;
      mesh.scale.set(side, side, 1);
      this.object.add(mesh);
      this.slots.push({
        body,
        mesh,
        side,
        designR: designR > 0 ? designR : Math.max(body.radius, 1),
        baseProm: numberUniform(material, "uProm", 0),
        baseFaculae: numberUniform(material, "uFaculae", 0),
        baseProW: numberUniform(material, "uProW", 0),
      });
    }
  }

  update(frame: VisualFrame): void {
    const on = shaderRendering();
    this.object.visible = on;
    if (!on) return;
    const game = frame.game;
    const time = chartTime(game);
    const seconds = cosmeticSeconds(frame.now);
    const sim = simSeconds(game.mode === "planning" ? 0 : game.ship.step, game.level.dt);
    const zoom = game.camera.zoom > 0 ? game.camera.zoom : 1;
    const dpr = frame.dpr > 0 ? frame.dpr : 1;
    syncTopDown(game.camera, frame.width, frame.height);
    const bodies = game.level.bodies;
    for (const slot of this.slots) {
      if (!slot.mesh.visible) continue;
      const material = slot.mesh.material as THREE.ShaderMaterial;
      const pose = bodyPose(slot.body, time, bodies, game.level.g);
      slot.mesh.position.set(pose.x, pose.y, 0);
      projectToScreen(pose.x, pose.y, frame.width, frame.height, this.scratch);
      const uniforms = material.uniforms;
      const center = uniforms.uCenter?.value as THREE.Vector2 | undefined;
      center?.set(this.scratch.x * dpr, (frame.height - this.scratch.y) * dpr);
      const radiusPx = screenRadius(slot.body.radius, zoom);
      const uR = radiusPx * dpr;
      if (uniforms.uR) uniforms.uR.value = uR;
      if (uniforms.uTime) uniforms.uTime.value = seconds;
      if (uniforms.uSimTime) uniforms.uSimTime.value = sim;
      if (uniforms.uZoom) uniforms.uZoom.value = zoom;
      if (uniforms.uDPR) uniforms.uDPR.value = dpr;
      const light2 = uniforms.uLightDir?.value;
      const light3 = uniforms.uLight?.value;
      if (light2 instanceof THREE.Vector2 || light3 instanceof THREE.Vector3) {
        const art =
          light3 instanceof THREE.Vector3 && artLightLocked()
            ? (planetArtLight(slot.body) ?? giantArtLight(slot.body))
            : null;
        if (art && light3 instanceof THREE.Vector3) {
          light3.set(art[0], art[1], art[2]);
        } else {
          const dir = lightDirection(pose.x, pose.y, time, bodies, game.level.g);
          if (light2 instanceof THREE.Vector2) light2.copy(dir);
          if (light3 instanceof THREE.Vector3) {
            const span = Math.hypot(theme.planetShader.lightXY, theme.planetShader.lightXY);
            light3.set(dir.x * span, dir.y * span, theme.planetShader.lightZ);
          }
        }
      }
      const near = radiusPx < LOD_RADIUS_PX;
      const octaves = near ? 3 : 5;
      if (uniforms.uOctaves) uniforms.uOctaves.value = octaves;
      if (uniforms.uRingOct) {
        uniforms.uRingOct.value = ringOctaves(slot.side * zoom, frame.width, frame.height, near);
      }
      if (uniforms.uProm) uniforms.uProm.value = near ? 0 : slot.baseProm;
      if (uniforms.uFaculae) uniforms.uFaculae.value = near ? 0 : slot.baseFaculae;
      if (uniforms.uProW && slot.designR > 0) uniforms.uProW.value = slot.baseProW * (uR / slot.designR);
      if (uniforms.uCoverage) uniforms.uCoverage.value = slot.body.dyson?.coverage ?? 0;
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function chartTime(game: Game): number {
  return (game.mode === "planning" ? 0 : game.ship.step) * game.level.dt;
}

function numberUniform(material: THREE.ShaderMaterial | null, name: string, fallback: number): number {
  const value = material?.uniforms[name]?.value;
  return typeof value === "number" ? value : fallback;
}

let hidden: THREE.Material | null = null;

function hiddenMaterial(): THREE.Material {
  if (!hidden) {
    hidden = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  }
  return hidden;
}
