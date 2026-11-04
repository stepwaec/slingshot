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
 * Capture rings only. Body discs are shader impostors or gallery sprites.
 * The ring is the v3 target zone: a solid stroke and a mint band, sized from
 * `captureRadius`. It does not dash. See `target-zone.ts`.
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
  private readonly rings: RingView[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "planets";
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
        this.rings.push({ body, mesh: ring, wave, color, waveColor, wonAt: -1 });
      }
    }
  }

  update(frame: VisualFrame): void {
    const zoom = frame.game.camera.zoom;
    const time = simTime(frame.game);
    const bodies = frame.game.level.bodies;
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
    disposeObject(this.object);
  }
}

function simTime(game: Game): number {
  const step = game.mode === "planning" ? 0 : game.ship.step;
  return step * game.level.dt;
}

