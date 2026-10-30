import * as THREE from "three";
import type { Game } from "../../game/state";
import { bodyPose, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { srgb01 } from "../palette";
import { markEmissive } from "../shaders/bloom";
import { targetZoneLook } from "../target-zone";
import { shader, srgbVec } from "./materials";

/**
 * v1 planets: one lit disc each, plus Planet X's halo.
 * The capture ring is the v3 target zone: a solid stroke and a mint band,
 * sized from `captureRadius`. It does not dash. See `target-zone.ts`.
 * A black hole is a dark disc with a photon ring. Its radius is the horizon.
 * Swap this factory for textured meshes. Keep them in world space and light
 * them from the star's position so a later material can use the same vector.
 */
export const createPlanets: VisualFactory = (theme, level) => new PlanetsVisual(theme, level);

const zoneFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform vec3 uBand;
uniform float uQuad;
uniform float uRingWorld;
uniform float uZoom;
uniform float uAlpha;
uniform float uWidthPx;
uniform float uBandAlpha;
uniform float uBandInPx;
uniform float uBandOutPx;
uniform float uDiscWorld;
void main() {
  float distPx = length(vLocal) * uQuad * uZoom;
  float ringPx = uRingWorld * uZoom;
  float fw = max(fwidth(distPx), 1e-3);
  float stroke = 1.0 - smoothstep(uWidthPx * 0.5, uWidthPx * 0.5 + fw, abs(distPx - ringPx));
  float inner = ringPx - uBandInPx;
  float outer = ringPx + uBandOutPx;
  float band = smoothstep(inner, ringPx, distPx) * (1.0 - smoothstep(ringPx, outer, distPx));
  float discPx = uDiscWorld * uZoom;
  band *= smoothstep(discPx, discPx + 3.0, distPx);
  float strokeA = stroke * uAlpha;
  float bandA = band * uBandAlpha * (1.0 - stroke);
  float a = strokeA + bandA;
  if (a < 0.004) discard;
  vec3 col = (uColor * strokeA + uBand * bandA) / a;
  gl_FragColor = vec4(col, a);
}
`;

/** One-shot capture wave. A solid stroke, no dash. */
const waveFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uQuad;
uniform float uRingWorld;
uniform float uZoom;
uniform float uAlpha;
uniform float uWidthPx;
void main() {
  float distPx = length(vLocal) * uQuad * uZoom;
  float ringPx = uRingWorld * uZoom;
  float fw = max(fwidth(distPx), 1e-3);
  float stroke = 1.0 - smoothstep(uWidthPx * 0.5, uWidthPx * 0.5 + fw, abs(distPx - ringPx));
  float a = stroke * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;


interface HoleView {
  body: Body;
  mesh: THREE.Mesh;
  back: THREE.Mesh;
  front: THREE.Mesh;
  time: THREE.IUniform<number>;
}

interface PlanetView {
  body: Body;
  mesh: THREE.Mesh;
  halo: THREE.Mesh | null;
  belt: THREE.Mesh | null;
  light: THREE.Vector2;
  light2: THREE.Vector2;
  weight2: THREE.IUniform;
  spin: THREE.IUniform<number>;
  cloudSpin: THREE.IUniform<number>;
  surface: THREE.CanvasTexture;
  clouds: THREE.CanvasTexture;
}

interface RingView {
  body: Body;
  mesh: THREE.Mesh;
  wave: THREE.Mesh;
  color: THREE.Vector3;
  waveColor: THREE.Vector3;
  /** frame.now when status became won. −1 until then, so the flash plays once. */
  wonAt: number;
}

class PlanetsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly planets: PlanetView[] = [];
  private readonly holes: HoleView[] = [];
  private readonly rings: RingView[] = [];
  private readonly textures: THREE.CanvasTexture[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "planets";
    let order = 1;
    for (const body of level.bodies) {
      if (body.kind === "star" || body.kind === "rogue" || body.kind === "blackhole" || body.look === "comet" || body.look === "asteroid") continue;
      if (body.captureRadius !== undefined) {
        const color = srgbVec(theme.colors.zoneRing);
        const waveColor = srgbVec(theme.colors.zoneRing);
        const uniforms = {
          uColor: { value: color },
          uBand: { value: srgbVec(theme.colors.zoneRing) },
          uQuad: { value: body.captureRadius },
          uRingWorld: { value: body.captureRadius },
          uZoom: { value: 1 },
          uAlpha: { value: theme.zone.idleAlpha0 },
          uWidthPx: { value: theme.zone.widthPx },
          uBandAlpha: { value: theme.zone.idleBand0 },
          uBandInPx: { value: theme.zone.bandInPx },
          uBandOutPx: { value: theme.zone.bandOutPx },
          uDiscWorld: { value: body.radius },
        };
        const waveUniforms = {
          uColor: { value: waveColor },
          uQuad: { value: body.captureRadius },
          uRingWorld: { value: body.captureRadius },
          uZoom: { value: 1 },
          uAlpha: { value: 0 },
          uWidthPx: { value: theme.zone.waveWidthPx },
        };
        const wave = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shader(waveFrag, waveUniforms));
        wave.position.set(body.x, body.y, 0);
        wave.renderOrder = 5.4;
        wave.name = `${body.id}-zone-wave`;
        wave.visible = false;
        markEmissive(wave);
        const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shader(zoneFrag, uniforms));
        ring.position.set(body.x, body.y, 0);
        ring.renderOrder = 5.5;
        ring.name = `${body.id}-ring`;
        markEmissive(ring);
        this.object.add(wave, ring);
        order += 1;
        this.rings.push({ body, mesh: ring, wave, color, waveColor, wonAt: -1 });
      }
    }
  }

  update(frame: VisualFrame): void {
    const zoom = frame.game.camera.zoom;
    const time = simTime(frame.game);
    const bodies = frame.game.level.bodies;
    const spin = (frame.now / 1000) * 0.12;
    const spinTime = frame.now / 1000;
    for (const hole of this.holes) {
      const pose = bodyPose(hole.body, time, bodies);
      hole.mesh.position.set(pose.x, pose.y, 0);
      hole.back.position.set(pose.x, pose.y, 0);
      hole.front.position.set(pose.x, pose.y, 0);
      hole.time.value = spinTime;
    }
    for (const planet of this.planets) {
      const pose = bodyPose(planet.body, time, bodies);
      planet.mesh.position.set(pose.x, pose.y, 0);
      planet.spin.value = spin + planet.body.radius * 0.01;
      planet.cloudSpin.value = spin * 1.7;
      if (planet.belt) planet.belt.position.set(pose.x, pose.y, 0);
      if (planet.halo) planet.halo.position.set(pose.x, pose.y, 0);
      planet.weight2.value = starLights(pose.x, pose.y, bodies, time, planet.light, planet.light2);
    }
    const zone = this.theme.zone;
    const colors = this.theme.colors;
    const ship = frame.game.ship;
    const now = frame.now / 1000;
    const scrim = frame.game.mode === "finished" && ship.status === "won";
    for (const ring of this.rings) {
      const pose = bodyPose(ring.body, time, bodies);
      ring.mesh.position.set(pose.x, pose.y, 0);
      ring.wave.position.set(pose.x, pose.y, 0);
      const capture = ring.body.captureRadius ?? ring.body.radius;
      const safeZoom = Math.max(zoom, 0.18);
      const reach = capture + zone.padPx / safeZoom;
      ring.mesh.scale.set(reach, reach, 1);
      ring.wave.scale.set(reach, reach, 1);
      if (ship.status === "won") {
        if (ring.wonAt < 0) ring.wonAt = frame.now;
      } else {
        ring.wonAt = -1;
      }
      const wonAge = ring.wonAt < 0 ? 0 : (frame.now - ring.wonAt) / 1000;
      const look = targetZoneLook(
        {
          status: ship.status,
          lostReason: ship.lostReason,
          enteredCapture: ship.enteredCapture,
          distance: Math.hypot(ship.x - pose.x, ship.y - pose.y),
          captureRadius: capture,
          wonAge,
          now,
          scrim,
        },
        zone,
        { ring: colors.zoneRing, stable: colors.zoneStable, flash: colors.zoneFlash },
      );
      const [r, g, b] = srgb01(look.color);
      ring.color.set(r, g, b);
      const material = ring.mesh.material as THREE.ShaderMaterial;
      material.uniforms.uZoom.value = zoom;
      material.uniforms.uQuad.value = reach;
      material.uniforms.uRingWorld.value = capture;
      material.uniforms.uAlpha.value = look.alpha;
      material.uniforms.uWidthPx.value = look.widthPx;
      material.uniforms.uBandAlpha.value = look.bandAlpha;
      material.uniforms.uDiscWorld.value = ring.body.radius;
      const waveMat = ring.wave.material as THREE.ShaderMaterial;
      const showWave = look.waveAlpha > 0.004;
      ring.wave.visible = showWave;
      if (showWave) {
        const [wr, wg, wb] = srgb01(colors.zoneRing);
        ring.waveColor.set(wr, wg, wb);
        waveMat.uniforms.uZoom.value = zoom;
        waveMat.uniforms.uQuad.value = reach;
        waveMat.uniforms.uRingWorld.value = capture + look.waveExtraPx / safeZoom;
        waveMat.uniforms.uAlpha.value = look.waveAlpha;
      }
    }
  }

  dispose(): void {
    for (const texture of this.textures) texture.dispose();
    disposeObject(this.object);
  }
}

function simTime(game: Game): number {
  const step = game.mode === "planning" ? 0 : game.ship.step;
  return step * game.level.dt;
}

const lightScratch = { x: 0, y: 0, w: 0 };

/** Up to two star directions, weighted by mass / distance². Writes into the planet's vectors. */
function starLights(
  x: number,
  y: number,
  bodies: readonly Body[],
  time: number,
  primary: THREE.Vector2,
  secondary: THREE.Vector2,
): number {
  let firstW = 0;
  let secondW = 0;
  let px = 1;
  let py = 0;
  let sx = 1;
  let sy = 0;
  let have = false;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star") continue;
    const pose = bodyPose(body, time, bodies);
    const dx = pose.x - x;
    const dy = pose.y - y;
    const r2 = dx * dx + dy * dy;
    if (!(r2 > 1e-8)) continue;
    const weight = body.mass / r2;
    const inv = 1 / Math.sqrt(r2);
    const lx = dx * inv;
    const ly = dy * inv;
    if (!have || weight > firstW) {
      secondW = firstW;
      sx = px;
      sy = py;
      firstW = weight;
      px = lx;
      py = ly;
      have = true;
    } else if (weight > secondW) {
      secondW = weight;
      sx = lx;
      sy = ly;
    }
  }
  if (have) {
    primary.set(px, py);
    secondary.set(sx, sy);
  }
  lightScratch.w = firstW > 0 ? secondW / firstW : 0;
  return lightScratch.w;
}

