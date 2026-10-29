import * as THREE from "three";
import { simConfigFromLevel } from "../../level/catalog";
import { sampleBurnAnim, tailFromBurn, windupFlicker, type BurnSample } from "../burn-anim";
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
      const built = anchorPlume(plume);
      built.mesh.visible = false;
      this.ship.add(built.mesh);
      this.plumes.set(look, built);
    }
    const glowAlpha = { value: 0 };
    this.glowAlpha = glowAlpha;
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      shader(glowFrag, {
        uColor: { value: srgbVec("#E2D4FF") },
        uAlpha: glowAlpha,
      }),
    );
    this.glow.name = "burn-windup";
    this.glow.position.set(0, theme.ship.nozzle, 0);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 4;
    this.glow.visible = false;
    (this.glow.material as THREE.ShaderMaterial).blending = THREE.AdditiveBlending;
    this.ship.add(this.glow);

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
      this.pulse.visible = false;
    } else {
      this.poseThrust(sampleBurnAnim(game.ship.step, game.level.dt, game.nodes, this.theme.burn.windup, tailFromBurn(this.theme.burn)), build.engine);
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

  private poseThrust(anim: BurnSample, look: EngineLook): void {
    const burn = this.theme.burn;
    const spec = ENGINE_PLUMES[look];
    const windup = anim.windup;
    const thrust = anim.thrust;
    const flicker = windupFlicker(anim.time, windup, burn.flickerHz);
    this.glow.visible = windup > 0;
    if (this.glow.visible) {
      const span = 6 + 10 * windup * flicker;
      this.glow.scale.set(span, span, 1);
      this.glowAlpha.value = 0.28 + 0.55 * windup * flicker;
    }
    if (spec.continuous) {
      this.pulse.visible = false;
      const plume = this.plumes.get(look);
      if (!plume) return;
      const show = thrust > 0 || windup > 0;
      plume.mesh.visible = show;
      if (!show) return;
      const wobble = 0.94 + 0.06 * Math.sin(anim.time * burn.flickerHz * Math.PI * 2 * spec.timeScale);
      const stretch = thrust > 0 ? anim.thrustStretch : 1;
      const extent = thrust > 0 ? thrust * stretch * wobble : (0.2 + 0.32 * windup) * (0.75 + 0.25 * flicker);
      const alpha = thrust > 0 ? 0.55 + 0.45 * thrust : windup * flicker * 0.7;
      posePlume(plume.uniforms, anim.time * spec.timeScale, extent, alpha);
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
  uCore: THREE.IUniform<THREE.Vector3>;
  uEdge: THREE.IUniform<THREE.Vector3>;
  uAlpha: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uExtent: THREE.IUniform<number>;
  uHalfWidth: THREE.IUniform<number>;
  uLength: THREE.IUniform<number>;
  uTurbulence: THREE.IUniform<number>;
}

function anchorPlume(plume: { length: number; halfWidth: number; turbulence: number; core: string; edge: string; root: number }): {
  mesh: THREE.Mesh;
  uniforms: PlumeUniforms;
} {
  const uniforms: PlumeUniforms = {
    uCore: { value: srgbVec(plume.core) },
    uEdge: { value: srgbVec(plume.edge) },
    uAlpha: { value: 0 },
    uTime: { value: 0 },
    uExtent: { value: 1 },
    uHalfWidth: { value: plume.halfWidth },
    uLength: { value: plume.length },
    uTurbulence: { value: plume.turbulence },
  };
  const material = shader(plumeFrag, uniforms as unknown as Record<string, THREE.IUniform>);
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(plume.halfWidth * 2, plume.length), material);
  mesh.position.set(0, -plume.root - plume.length / 2, 0);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = "plume";
  return { mesh, uniforms };
}

function posePlume(uniforms: PlumeUniforms, time: number, extent: number, alpha: number): void {
  uniforms.uTime.value = time;
  uniforms.uExtent.value = Math.min(1, Math.max(0, extent));
  uniforms.uAlpha.value = alpha;
}

const glowFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float d = length(vLocal);
  float alpha = smoothstep(1.0, 0.0, d);
  alpha *= alpha;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(uColor, alpha * uAlpha);
}
`;

const plumeFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uAlpha;
uniform float uTime;
uniform float uExtent;
uniform float uHalfWidth;
uniform float uLength;
uniform float uTurbulence;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  float along = (uLength * 0.5 - vLocal.y) / uLength;
  if (along < 0.0 || along > uExtent) discard;
  float t = along / max(uExtent, 0.001);
  float n = noise(vec2(vLocal.x * 0.35, along * 7.5 - uTime * 9.0));
  float n2 = noise(vec2(vLocal.x * 0.8 + 2.7, along * 13.0 + uTime * 14.0));
  float jag = (n - 0.5) * uTurbulence;
  float width = mix(0.55, 1.0, smoothstep(0.0, 0.25, t));
  width *= 1.0 - smoothstep(0.55, 1.0, t);
  width = max(width, 0.35 * (1.0 - t));
  width += jag * t;
  float radial = abs(vLocal.x) / max(uHalfWidth * width, 0.001);
  float body = 1.0 - smoothstep(0.55, 1.05, radial);
  if (body <= 0.0) discard;
  float core = pow(1.0 - smoothstep(0.0, 0.45, radial), 1.35);
  float fade = pow(1.0 - t, 0.75);
  float mottled = mix(1.0 - 0.35 * uTurbulence, 1.0, n) * mix(0.85, 1.0, n2);
  vec3 color = mix(uEdge, uCore, core);
  color = mix(color, uEdge, smoothstep(0.05, 0.9, t) * (1.0 - core * 0.75));
  float alpha = body * fade * mottled * uAlpha + core * fade * uAlpha * 0.35;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(color, alpha);
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
