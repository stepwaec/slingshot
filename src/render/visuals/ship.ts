import * as THREE from "three";
import { simConfigFromLevel } from "../../level/catalog";
import { sampleBurnAnim, tailFromBurn, windupFlicker, type BurnCue, type BurnSample } from "../burn-anim";
import { plumeFrame, type PlumeFrame } from "../plume";
import { projectToScreen } from "../camera";
import { shipLook } from "../appearance";
import { srgbVec, shader } from "./materials";
import {
  chargingNearStar,
  damageBand,
  ENGINE_PLUME_IDS,
  ENGINE_PLUMES,
  PULSE_PERIOD,
  type EngineLook,
  type PartKey,
  shipBuild,
  stressLevel,
  tidalAxis,
  visibleParts,
  zoomBucket,
} from "../ship-art";
import { bakedSvgUrl, rasterSvg } from "../svg-bake";
import { tidalStressAt, type SimConfig, type Vec2 } from "../../sim/physics";
import { palette } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Modular ship from design/assets/ship, screen-pixel sized, heading lerp kept.
 * Parts, plumes, damage and chevrons only read sim state. They never step it.
 */
export const createShip: VisualFactory = (theme) => new ShipVisual(theme);

const PART_ORDER: readonly PartKey[] = [
  "solar",
  "tanks",
  "platingBack",
  "engine",
  "hull",
  "platingFront",
  "cryo",
  "scoop",
  "sensors",
  "shield",
  "damage",
];

class ShipVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly ship = new THREE.Group();
  private readonly parts = new Map<PartKey, THREE.Mesh>();
  private readonly engines = new Map<EngineLook, THREE.Mesh>();
  private readonly plumes = new Map<EngineLook, { mesh: THREE.Mesh; uniforms: PlumeUniforms }>();
  private readonly damageBands = new Map<"75" | "45" | "15", THREE.Mesh>();
  private readonly glow: THREE.Mesh;
  private readonly glowAlpha: THREE.IUniform<number>;
  private readonly flash: THREE.Mesh;
  private readonly flashRadius: THREE.IUniform<number>;
  private readonly flashAlpha: THREE.IUniform<number>;
  private readonly pulse: THREE.Mesh;
  private readonly solarGlow: THREE.Mesh;
  private readonly hitFlash: THREE.Mesh;
  private readonly chevrons: THREE.Group;
  private readonly burst: THREE.Group;
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private readonly scratchB: Vec2 = { x: 0, y: 0 };
  private angle = 0;
  private angleReady = false;
  private lastMode: VisualFrame["game"]["mode"] | null = null;
  private burstFrames = 0;
  private bakeKey = "";
  private bakeGen = 0;
  private hitUntil = 0;
  private lastHull = Number.POSITIVE_INFINITY;

  constructor(theme: Theme) {
    this.theme = theme;
    this.object.name = "ship";
    this.object.userData.asset = theme.assets.hull;
    const frame = new THREE.PlaneGeometry(theme.ship.frameWidth, theme.ship.frameHeight);
    frame.translate(0, theme.ship.frameShift, 0);

    const add = (key: PartKey, order: number): THREE.Mesh => {
      const mesh = spriteMesh(frame, order);
      mesh.name = key;
      mesh.visible = false;
      this.ship.add(mesh);
      this.parts.set(key, mesh);
      return mesh;
    };

    add("solar", 2);
    add("tanks", 2);
    add("platingBack", 2);
    this.solarGlow = spriteMesh(frame, 3);
    this.solarGlow.name = "solar-glow";
    const solarMat = this.solarGlow.material as THREE.MeshBasicMaterial;
    solarMat.color.set("#FFE08A");
    solarMat.blending = THREE.AdditiveBlending;
    solarMat.opacity = 0;
    this.solarGlow.visible = false;
    this.ship.add(this.solarGlow);

    for (const look of ["chemical", "ion"] as const) {
      const plume = ENGINE_PLUMES[look];
      const built = look === "chemical" ? anchorFlame(plume, theme) : anchorBeam(plume);
      built.mesh.visible = false;
      this.ship.add(built.mesh);
      this.plumes.set(look, built);
    }
    const glowAlpha = { value: 0 };
    this.glowAlpha = glowAlpha;
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      shader(glowFrag, {
        uColor: { value: srgbVec(palette.plumeGlow) },
        uAlpha: glowAlpha,
      }),
    );
    this.glow.name = "burn-windup";
    this.glow.position.set(0, theme.ship.nozzle, 0);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 3;
    this.glow.visible = false;
    this.ship.add(this.glow);
    const flashRadius = { value: theme.plume.flashRadius0 };
    const flashAlpha = { value: 0 };
    this.flashRadius = flashRadius;
    this.flashAlpha = flashAlpha;
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      shader(flashFrag, {
        uColor: { value: srgbVec(palette.plumeFlash) },
        uRadius: flashRadius,
        uAlpha: flashAlpha,
        uWidth: { value: theme.plume.flashWidth },
      }),
    );
    this.flash.name = "burn-flash";
    this.flash.position.set(0, theme.ship.nozzle, 0);
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 5;
    this.flash.visible = false;
    this.ship.add(this.flash);

    this.pulse = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({
        color: "#E2D4FF",
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.pulse.name = "pulse-flash";
    this.pulse.position.set(0, -ENGINE_PLUMES.pulse.root, 0);
    this.pulse.frustumCulled = false;
    this.pulse.renderOrder = 4;
    this.pulse.visible = false;
    this.ship.add(this.pulse);

    for (const look of ["chemical", "ion", "pulse"] as const) {
      const mesh = spriteMesh(frame, 6);
      mesh.name = `engine-${look}`;
      mesh.visible = false;
      this.ship.add(mesh);
      this.engines.set(look, mesh);
    }
    add("hull", 6);
    add("platingFront", 7);
    add("cryo", 7);
    add("scoop", 7);
    add("sensors", 7);
    add("shield", 7);
    for (const band of ["75", "45", "15"] as const) {
      const mesh = spriteMesh(frame, 8);
      mesh.name = `damage-${band}`;
      mesh.visible = false;
      this.ship.add(mesh);
      this.damageBands.set(band, mesh);
    }
    this.hitFlash = spriteMesh(frame, 9);
    this.hitFlash.name = "hit-flash";
    const flashMat = this.hitFlash.material as THREE.MeshBasicMaterial;
    flashMat.color.set("#FFFFFF");
    flashMat.blending = THREE.AdditiveBlending;
    flashMat.opacity = 0;
    this.hitFlash.visible = false;
    this.ship.add(this.hitFlash);

    this.chevrons = buildChevrons();
    this.burst = buildBurst(theme);
    this.object.add(this.ship, this.chevrons, this.burst);
  }

  update(frame: VisualFrame): void {
    const { game, width, height, now } = frame;
    const spec = this.theme.ship;
    if (game.mode !== this.lastMode) {
      const flightPause =
        (this.lastMode === "flying" && game.mode === "paused") ||
        (this.lastMode === "paused" && game.mode === "flying");
      if (!flightPause) this.angleReady = false;
      this.lastMode = game.mode;
    }
    const crashed = game.mode !== "planning" && game.ship.status === "crashed";
    const pose = game.mode === "planning" ? game.initial : game.ship;
    const build = shipBuild(game.upgrades, shipLook);
    const band = damageBand(pose.hull, pose.hullMax);
    const shown = new Set(visibleParts(build, band));
    this.ensureBake(frame);

    projectToScreen(pose.x, pose.y, width, height, this.scratch);
    const x = this.scratch.x;
    const y = height - this.scratch.y;
    const nose = noseVelocity(game);
    const speed = Math.hypot(nose.x, nose.y);
    if (speed > 1e-4) {
      const target = Math.atan2(nose.y, nose.x) - Math.PI / 2;
      this.angle = this.angleReady ? lerpAngle(this.angle, target, spec.headingLerp) : target;
      this.angleReady = true;
    }
    const k = Math.max(spec.minPx, spec.lengthAtZoom1 * game.camera.zoom) / spec.hullUnits;
    this.ship.visible = !crashed;
    this.ship.position.set(x, y, 0);
    this.ship.rotation.z = this.angle;
    this.ship.scale.set(k, k, 1);

    for (const key of PART_ORDER) {
      const mesh = this.parts.get(key);
      if (mesh) mesh.visible = shown.has(key);
    }
    for (const [look, mesh] of this.engines) mesh.visible = shown.has("engine") && look === build.engine;
    for (const plume of this.plumes.values()) plume.mesh.visible = false;
    for (const mesh of this.damageBands.values()) mesh.visible = false;
    const damageMesh = band === "none" ? undefined : this.damageBands.get(band);
    if (damageMesh && shown.has("damage")) {
      damageMesh.visible = true;
      const mat = damageMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = band === "15" ? 0.82 + 0.18 * Math.sin((now / 1000) * Math.PI * 2) : 1;
    }

    const config = simConfigFromLevel(game.level, game.upgrades);
    const time = pose.t;
    this.poseModules(build, shown, pose.x, pose.y, config, time, now);
    this.poseHit(pose.hull, now);

    const showBurn = !crashed && (game.mode === "flying" || game.mode === "paused");
    if (!showBurn) {
      this.glow.visible = false;
      this.flash.visible = false;
      this.pulse.visible = false;
    } else {
      this.poseThrust(
        sampleBurnAnim(game.ship.step, game.level.dt, game.nodes, this.theme.burn.windup, tailFromBurn(this.theme.burn)),
        build.engine,
        now,
      );
    }

    this.poseChevrons(game, config, width, height, now);
    this.burst.visible = crashed;
    if (!crashed) {
      this.burstFrames = 0;
      return;
    }
    this.burstFrames = Math.min(this.theme.burst.frames, this.burstFrames + 1);
    const grow = 0.65 + 0.35 * (this.burstFrames / this.theme.burst.frames);
    projectToScreen(game.ship.x, game.ship.y, width, height, this.scratch);
    this.burst.position.set(this.scratch.x, height - this.scratch.y, 0);
    this.burst.scale.setScalar(grow);
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private poseModules(
    build: ReturnType<typeof shipBuild>,
    shown: Set<PartKey>,
    x: number,
    y: number,
    config: SimConfig,
    time: number,
    now: number,
  ): void {
    const charging = build.solar && shown.has("solar") && chargingNearStar(x, y, config, time);
    this.solarGlow.visible = charging;
    (this.solarGlow.material as THREE.MeshBasicMaterial).opacity = charging ? 0.35 + 0.15 * Math.sin(now / 400) : 0;

    const scoop = this.parts.get("scoop");
    if (scoop) {
      const mat = scoop.material as THREE.MeshBasicMaterial;
      mat.opacity = shown.has("scoop") ? 0.82 + 0.18 * Math.sin(now / 700) : 1;
    }
    const sensors = this.parts.get("sensors");
    if (sensors) {
      const blink = Math.floor(now / 700) % 2 === 0;
      (sensors.material as THREE.MeshBasicMaterial).opacity = shown.has("sensors") && blink ? 1 : shown.has("sensors") ? 0.72 : 1;
    }
    const cryo = this.parts.get("cryo");
    if (cryo) {
      const breathe = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin((now / 4000) * Math.PI * 2));
      (cryo.material as THREE.MeshBasicMaterial).opacity = shown.has("cryo") ? breathe : 1;
    }
    const shield = this.parts.get("shield");
    if (shield) {
      const flashing = now < this.hitUntil;
      (shield.material as THREE.MeshBasicMaterial).opacity = shown.has("shield") ? (flashing ? 1 : 0.85) : 1;
    }
  }

  private poseHit(hull: number, now: number): void {
    if (hull < this.lastHull - 0.05) this.hitUntil = now + 80;
    this.lastHull = hull;
    const flashing = now < this.hitUntil;
    this.hitFlash.visible = flashing;
    (this.hitFlash.material as THREE.MeshBasicMaterial).opacity = flashing ? (this.hitUntil - now) / 80 : 0;
  }

  private poseThrust(anim: BurnSample, look: EngineLook, nowMs: number): void {
    const burn = this.theme.burn;
    const spec = ENGINE_PLUMES[look];
    const plumeSpec = this.theme.plume;
    const windup = anim.windup;
    const flicker = windupFlicker(anim.time, windup, burn.flickerHz);
    const cue = thrustCue(anim);
    const drawn = cue
      ? plumeFrame(plumeSpec, cue.phase, cue.offset, cue.amount, anim.thrustMag, cue.tail, flicker)
      : plumeFrame(plumeSpec, windup > 0 ? "windup" : "idle", anim.time, windup, 0, 0, flicker);
    if (look === "ion" && cue) {
      drawn.length = spec.length;
      drawn.width = spec.halfWidth;
    }
    this.glow.visible = drawn.glow;
    if (drawn.glow) {
      this.glow.position.y = -spec.root;
      this.glow.scale.set(Math.max(0.2, drawn.glowRx), plumeSpec.glowRy, 1);
      this.glowAlpha.value = 0.4 + 0.6 * Math.min(1, Math.max(0, flicker));
    }
    const flashing = drawn.flash >= 0 && spec.continuous;
    this.flash.visible = flashing;
    if (flashing) {
      this.flash.position.y = -spec.root;
      this.flashRadius.value = plumeSpec.flashRadius0 + (plumeSpec.flashRadius1 - plumeSpec.flashRadius0) * drawn.flash;
      this.flashAlpha.value = 1 - drawn.flash;
    }
    if (spec.continuous) {
      this.pulse.visible = false;
      const plume = this.plumes.get(look);
      if (!plume) return;
      const show = drawn.length > 0 && drawn.fade > 0.001 && drawn.grow > 0.001;
      plume.mesh.visible = show;
      if (!show) return;
      posePlume(plume.uniforms, nowMs / 1000, drawn);
      return;
    }
    const burning = anim.cues.some((cue) => cue.phase === "burn" || cue.phase === "tail");
    const phase = PULSE_PERIOD > 0 ? (anim.time % PULSE_PERIOD) / PULSE_PERIOD : 0;
    const flash = burning && phase < 0.55;
    this.pulse.visible = flash;
    if (!flash) return;
    const t = phase / 0.55;
    const radius = 5 + 12 * t;
    this.pulse.scale.set(radius, radius * 0.65, 1);
    (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
  }

  private poseChevrons(game: VisualFrame["game"], config: SimConfig, width: number, height: number, now: number): void {
    const spot = stressSpot(game, config);
    if (!spot) {
      this.chevrons.visible = false;
      return;
    }
    const axis = tidalAxis(spot.x, spot.y, config, spot.time);
    if (!axis) {
      this.chevrons.visible = false;
      return;
    }
    projectToScreen(spot.x, spot.y, width, height, this.scratch);
    projectToScreen(spot.x + axis.x, spot.y + axis.y, width, height, this.scratchB);
    const sx = this.scratchB.x - this.scratch.x;
    const sy = this.scratch.y - this.scratchB.y;
    const len = Math.hypot(sx, sy);
    if (!(len > 1e-3)) {
      this.chevrons.visible = false;
      return;
    }
    const level = stressLevel(spot.stress);
    const period = level >= 3 ? 500 : 800;
    const pulse = 0.75 + 0.25 * Math.sin((now / period) * Math.PI * 2);
    this.chevrons.visible = true;
    this.chevrons.position.set(this.scratch.x, height - this.scratch.y, 0);
    this.chevrons.rotation.z = Math.atan2(sy, sx);
    this.chevrons.scale.setScalar(pulse);
    const color = level >= 3 ? "#FF5A5F" : "#FF9F43";
    this.chevrons.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (mat?.color) mat.color.set(color);
    });
  }

  private ensureBake(frame: VisualFrame): void {
    const bucket = zoomBucket(frame.game.camera.zoom);
    const dpr = Math.min(Math.max(frame.dpr, 1), 2);
    const key = `${bucket}|${dpr}`;
    if (key === this.bakeKey) return;
    this.bakeKey = key;
    const gen = ++this.bakeGen;
    const spec = this.theme.ship;
    const px = (Math.max(spec.minPx, spec.lengthAtZoom1 * bucket) / spec.hullUnits) * dpr;
    const width = Math.max(16, Math.round(spec.frameWidth * px));
    const height = Math.max(16, Math.round(spec.frameHeight * px));
    void this.bake(gen, width, height);
  }

  private async bake(gen: number, width: number, height: number): Promise<void> {
    const assets = this.theme.assets;
    const load = async (url: string, hide: readonly string[] = []): Promise<THREE.CanvasTexture> => {
      const blob = await bakedSvgUrl(url, hide);
      const canvas = await rasterSvg(blob, width, height);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    };
    try {
      const [hull, solar, tanks, platingBack, platingFront, cryo, scoop, sensors, shield, chemical, ion, pulse, d75, d45, d15] =
        await Promise.all([
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
          load(assets.damage75),
          load(assets.damage45),
          load(assets.damage15),
        ]);
      if (gen !== this.bakeGen) {
        for (const texture of [hull, solar, tanks, platingBack, platingFront, cryo, scoop, sensors, shield, chemical, ion, pulse, d75, d45, d15]) {
          texture.dispose();
        }
        return;
      }
      this.assign(this.parts.get("hull"), hull);
      this.assign(this.hitFlash, hull);
      this.assign(this.parts.get("solar"), solar);
      this.assign(this.solarGlow, solar);
      this.assign(this.parts.get("tanks"), tanks);
      this.assign(this.parts.get("platingBack"), platingBack);
      this.assign(this.parts.get("platingFront"), platingFront);
      this.assign(this.parts.get("cryo"), cryo);
      this.assign(this.parts.get("scoop"), scoop);
      this.assign(this.parts.get("sensors"), sensors);
      this.assign(this.parts.get("shield"), shield);
      this.assign(this.engines.get("chemical"), chemical);
      this.assign(this.engines.get("ion"), ion);
      this.assign(this.engines.get("pulse"), pulse);
      this.assign(this.damageBands.get("75"), d75);
      this.assign(this.damageBands.get("45"), d45);
      this.assign(this.damageBands.get("15"), d15);
    } catch {
      if (gen === this.bakeGen) this.bakeKey = "";
    }
  }

  private assign(mesh: THREE.Mesh | undefined, texture: THREE.Texture): void {
    if (!mesh) {
      texture.dispose();
      return;
    }
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = texture;
    mat.needsUpdate = true;
  }
}

function stressSpot(
  game: VisualFrame["game"],
  config: SimConfig,
): { x: number; y: number; time: number; stress: number } | null {
  if (game.mode === "planning") {
    const origin = game.initial;
    const atStart = tidalStressAt(origin.x, origin.y, config, origin.t);
    if (atStart > 0) return { x: origin.x, y: origin.y, time: origin.t, stress: atStart };
    const path = game.prediction.path;
    for (let i = 0; i < path.length; i++) {
      const sample = path[i];
      if (!sample) continue;
      const time = sample.step * game.level.dt;
      const stress = tidalStressAt(sample.x, sample.y, config, time);
      if (stress > 0) return { x: sample.x, y: sample.y, time, stress };
    }
    return null;
  }
  const pose = game.ship;
  if (!(pose.stress > 0) || pose.status === "crashed") return null;
  return { x: pose.x, y: pose.y, time: pose.t, stress: pose.stress };
}

function spriteMesh(geometry: THREE.PlaneGeometry, order: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({
      transparent: true,
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

interface PlumeUniforms {
  uTime: THREE.IUniform<number>;
  uLength: THREE.IUniform<number>;
  uHalf: THREE.IUniform<number>;
  uGrow: THREE.IUniform<number>;
  uCutoff: THREE.IUniform<number>;
  uFade: THREE.IUniform<number>;
  uSpan: THREE.IUniform<number>;
}

function anchorFlame(plume: { root: number }, theme: Theme): { mesh: THREE.Mesh; uniforms: PlumeUniforms } {
  const spec = theme.plume;
  const span = spec.lengthMax + 6;
  const half = 14;
  const uniforms = {
    uTime: { value: 0 },
    uLength: { value: spec.lengthMax },
    uHalf: { value: plumeWidthOf(spec.lengthMax, spec.widthBase, spec.widthPerLength) },
    uGrow: { value: 1 },
    uCutoff: { value: 0 },
    uFade: { value: 0 },
    uSoft: { value: spec.tailSoft },
    uSpan: { value: span },
    uShoulder: { value: spec.shoulder },
    uBell: { value: spec.bell },
    uRag: { value: spec.rag },
    uRagPeriod: { value: spec.ragPeriod },
    uCyc0: { value: spec.ragCycles[0] ?? 5 },
    uCyc1: { value: spec.ragCycles[1] ?? 8 },
    uCyc2: { value: spec.ragCycles[2] ?? 11 },
    uCoreLen: { value: spec.coreLength },
    uCoreWid: { value: spec.coreWidth },
    uC0: { value: srgbVec(palette.plumeChem0) },
    uC1: { value: srgbVec(palette.plumeChem1) },
    uC2: { value: srgbVec(palette.plumeChem2) },
    uC3: { value: srgbVec(palette.plumeChem3) },
    uK0: { value: srgbVec(palette.plumeCore0) },
    uK1: { value: srgbVec(palette.plumeCore1) },
    uK2: { value: srgbVec(palette.plumeCore2) },
  };
  const material = shader(flameFrag, uniforms);
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, span), material);
  mesh.position.set(0, -plume.root - span / 2, 0);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = "plume";
  return { mesh, uniforms };
}

function anchorBeam(plume: { length: number; halfWidth: number; root: number }): { mesh: THREE.Mesh; uniforms: PlumeUniforms } {
  const uniforms = {
    uTime: { value: 0 },
    uLength: { value: plume.length },
    uHalf: { value: plume.halfWidth },
    uGrow: { value: 1 },
    uCutoff: { value: 0 },
    uFade: { value: 0 },
    uSoft: { value: 0.15 },
    uSpan: { value: plume.length },
    uC0: { value: srgbVec("#E6F4FF") },
    uC1: { value: srgbVec("#8FC2FF") },
    uC2: { value: srgbVec("#A06BFF") },
    uK0: { value: srgbVec("#F2F9FF") },
  };
  const material = shader(beamFrag, uniforms);
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(plume.halfWidth * 2.4, plume.length), material);
  mesh.position.set(0, -plume.root - plume.length / 2, 0);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = "plume";
  return { mesh, uniforms };
}

function plumeWidthOf(length: number, base: number, per: number): number {
  return base + length * per;
}

function posePlume(uniforms: PlumeUniforms, time: number, drawn: PlumeFrame): void {
  uniforms.uTime.value = time;
  uniforms.uLength.value = Math.max(0.001, drawn.length);
  uniforms.uHalf.value = drawn.width;
  uniforms.uGrow.value = drawn.grow;
  uniforms.uCutoff.value = drawn.cutoff;
  uniforms.uFade.value = drawn.fade;
}

function thrustCue(anim: BurnSample): BurnCue | undefined {
  let best: BurnCue | undefined;
  for (let i = 0; i < anim.cues.length; i++) {
    const cue = anim.cues[i];
    if (cue.phase === "windup") continue;
    if (!best || cue.amount > best.amount) best = cue;
  }
  return best;
}

const glowFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float d = length(vLocal);
  float aa = fwidth(d);
  float alpha = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, d)) * uAlpha;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const flashFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uRadius;
uniform float uAlpha;
uniform float uWidth;
void main() {
  float dist = abs(length(vLocal) - uRadius);
  float aa = fwidth(dist);
  float band = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + aa, dist);
  float alpha = band * uAlpha;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const flameFrag = /* glsl */ `
varying vec2 vLocal;
uniform float uTime;
uniform float uLength;
uniform float uHalf;
uniform float uGrow;
uniform float uCutoff;
uniform float uFade;
uniform float uSoft;
uniform float uSpan;
uniform float uShoulder;
uniform float uBell;
uniform float uRag;
uniform float uRagPeriod;
uniform float uCyc0;
uniform float uCyc1;
uniform float uCyc2;
uniform float uCoreLen;
uniform float uCoreWid;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uK0;
uniform vec3 uK1;
uniform vec3 uK2;

float rag(float t) {
  float speed = 6.2831853 / max(uRagPeriod, 0.001);
  float sum = sin(t * uCyc0 * 6.2831853 + 0.4 + uTime * speed);
  sum += sin(t * uCyc1 * 6.2831853 + 2.2 + uTime * speed);
  sum += sin(t * uCyc2 * 6.2831853 + 4.1 + uTime * speed);
  return sum / 3.0;
}

float halfWidth(float t) {
  float rise = 0.55 + 0.45 * min(1.0, t / max(uShoulder, 0.001));
  float tail = max(0.0, (t - uShoulder) / max(1.0 - uShoulder, 0.001));
  float bell = pow(max(0.0, 1.0 - tail), uBell);
  float flick = 1.0 + uRag * rag(t) * min(1.0, 6.0 * t);
  return max(0.0, uHalf * rise * bell * flick);
}

vec4 flameAt(float t) {
  if (t < 0.2) return vec4(mix(uC0, uC1, t / 0.2), mix(1.0, 0.92, t / 0.2));
  if (t < 0.5) return vec4(mix(uC1, uC2, (t - 0.2) / 0.3), mix(0.92, 0.6, (t - 0.2) / 0.3));
  if (t < 0.8) return vec4(mix(uC2, uC3, (t - 0.5) / 0.3), mix(0.6, 0.2, (t - 0.5) / 0.3));
  return vec4(uC3, mix(0.2, 0.0, (t - 0.8) / 0.2));
}

vec4 coreAt(float t) {
  if (t < 0.6) return vec4(mix(uK0, uK1, t / 0.6), mix(1.0, 0.85, t / 0.6));
  return vec4(mix(uK1, uK2, (t - 0.6) / 0.4), mix(0.85, 0.0, (t - 0.6) / 0.4));
}

void main() {
  float along = (uSpan * 0.5 - vLocal.y) / max(uLength, 0.001);
  if (along < 0.0 || along > uGrow || along > 1.0) discard;
  float gate = uCutoff <= 0.0 ? 1.0 : smoothstep(uCutoff, min(1.0, uCutoff + uSoft), along);
  float w = halfWidth(along);
  float aa = fwidth(vLocal.x);
  float body = 1.0 - smoothstep(w - aa, w + aa, abs(vLocal.x));
  float coreT = along / max(uCoreLen, 0.001);
  float coreW = coreT <= 1.0 ? halfWidth(coreT) * uCoreWid : 0.0;
  float core = 1.0 - smoothstep(coreW - aa, coreW + aa, abs(vLocal.x));
  vec4 flame = flameAt(along);
  flame.a *= body * gate * uFade;
  vec4 coreCol = coreAt(clamp(coreT, 0.0, 1.0));
  coreCol.a *= core * gate * uFade;
  float a = coreCol.a + flame.a * (1.0 - coreCol.a);
  if (a <= 0.01) discard;
  vec3 rgb = (coreCol.rgb * coreCol.a + flame.rgb * flame.a * (1.0 - coreCol.a)) / a;
  gl_FragColor = vec4(rgb, a);
}
`;

const beamFrag = /* glsl */ `
varying vec2 vLocal;
uniform float uLength;
uniform float uHalf;
uniform float uGrow;
uniform float uCutoff;
uniform float uFade;
uniform float uSoft;
uniform float uSpan;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uK0;
void main() {
  float along = (uSpan * 0.5 - vLocal.y) / max(uLength, 0.001);
  if (along < 0.0 || along > uGrow || along > 1.0) discard;
  float gate = uCutoff <= 0.0 ? 1.0 : smoothstep(uCutoff, min(1.0, uCutoff + uSoft), along);
  float w = uHalf * (1.0 - smoothstep(0.9, 1.0, along));
  float aa = fwidth(vLocal.x);
  float body = 1.0 - smoothstep(w - aa, w + aa, abs(vLocal.x));
  float core = along < 0.62 ? 1.0 - smoothstep(uHalf * 0.38 - aa, uHalf * 0.38 + aa, abs(vLocal.x)) : 0.0;
  vec3 col = along < 0.3 ? mix(uC0, uC1, along / 0.3) : mix(uC1, uC2, clamp((along - 0.3) / 0.7, 0.0, 1.0));
  float alpha = along < 0.3 ? mix(1.0, 0.75, along / 0.3) : mix(0.75, 0.0, clamp((along - 0.3) / 0.7, 0.0, 1.0));
  alpha *= body * gate * uFade;
  float coreA = core * 0.7 * gate * uFade;
  float a = coreA + alpha * (1.0 - coreA);
  if (a <= 0.01) discard;
  vec3 rgb = (uK0 * coreA + col * alpha * (1.0 - coreA)) / a;
  gl_FragColor = vec4(rgb, a);
}
`;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function noseVelocity(game: VisualFrame["game"]): Vec2 {
  const pose = game.mode === "planning" ? game.initial : game.ship;
  if (game.mode === "planning") {
    for (let i = 0; i < game.nodes.length; i++) {
      const node = game.nodes[i];
      if (node.step === pose.step) return { x: pose.vx + node.dvx, y: pose.vy + node.dvy };
    }
  }
  return { x: pose.vx, y: pose.vy };
}

function buildChevrons(): THREE.Group {
  const group = new THREE.Group();
  group.name = "tidal-chevrons";
  group.visible = false;
  const shape = new THREE.Shape();
  shape.moveTo(5, 0);
  shape.lineTo(-3, 3.2);
  shape.lineTo(-1.2, 0);
  shape.lineTo(-3, -3.2);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  for (const side of [1, -1]) {
    for (const dist of [15, 24]) {
      const mesh = new THREE.Mesh(
        geo.clone(),
        new THREE.MeshBasicMaterial({
          color: "#FF9F43",
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.set(side * dist, 0, 0);
      mesh.rotation.z = side === 1 ? 0 : Math.PI;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      group.add(mesh);
    }
  }
  return group;
}

function buildBurst(theme: Theme): THREE.Group {
  const group = new THREE.Group();
  group.name = "crash-burst";
  group.visible = false;
  const outer = circle(theme.colors.thrustOuter);
  outer.scale.set(7, 7, 1);
  (outer.material as THREE.MeshBasicMaterial).transparent = true;
  (outer.material as THREE.MeshBasicMaterial).opacity = 0.45;
  const core = circle(theme.colors.thrustCore);
  core.scale.set(3.5, 3.5, 1);
  group.add(outer);
  for (let i = 0; i < 6; i++) {
    const len = 8 + (i % 3) * 3;
    const spark = square(i % 2 === 0 ? theme.colors.thrustCore : theme.colors.thrustOuter);
    spark.scale.set(len, 1.5, 1);
    const ang = (i * Math.PI) / 3;
    const mid = 5 + len / 2;
    spark.position.set(Math.cos(ang) * mid, Math.sin(ang) * mid, 0);
    spark.rotation.z = ang;
    spark.renderOrder = 6;
    group.add(spark);
  }
  core.renderOrder = 6;
  outer.renderOrder = 6;
  group.add(core);
  return group;
}

function circle(color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

function square(color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  mesh.frustumCulled = false;
  return mesh;
}
