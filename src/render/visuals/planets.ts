import * as THREE from "three";
import type { Game } from "../../game/state";
import { bodyPose, type Body } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { artForBody } from "../art-sprite";
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

const planetFrag = /* glsl */ `
varying vec2 vLocal;
uniform sampler2D uSurface;
uniform sampler2D uClouds;
uniform vec2 uLight;
uniform vec2 uLight2;
uniform float uWeight2;
uniform float uSpin;
uniform float uCloudSpin;
uniform float uCloudsOn;
uniform float uAirless;
uniform vec3 uWarm;
uniform vec3 uNight;

void main() {
  // The mesh is scaled to 1.1 radii and the geometry is the unit square,
  // so vLocal is −1…1. Multiply to put r = 1 on the real surface. Dividing
  // left the whole square inside the disc: flat sides, striped like a cylinder.
  vec2 q = vLocal * 1.1;
  float r2 = dot(q, q);
  float r = sqrt(r2);
  float fw = max(fwidth(r), 1e-4);
  float nz = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
  vec3 n = vec3(q, nz);
  float lon = atan(q.x, max(nz, 1e-4));
  vec2 uv = vec2(fract((lon + uSpin) / 6.2831853), clamp(0.5 + 0.5 * n.y, 0.0, 1.0));
  vec3 col = texture2D(uSurface, uv).rgb;
  if (uCloudsOn > 0.5) {
    vec2 cuv = vec2(fract((lon + uCloudSpin) / 6.2831853), uv.y);
    vec4 cl = texture2D(uClouds, cuv);
    col = mix(col, cl.rgb, cl.a * 0.82);
  }
  vec3 L = normalize(vec3(uLight, 0.62));
  float d = dot(n, L);
  if (uWeight2 > 0.001) {
    float d2 = dot(n, normalize(vec3(uLight2, 0.62)));
    d = mix(d, max(d, d2), clamp(uWeight2, 0.0, 1.0));
  }
  float lo = uAirless > 0.5 ? -0.02 : -0.06;
  float hi = uAirless > 0.5 ? 0.16 : 0.55;
  col *= 0.18 + 0.82 * smoothstep(lo, hi, d);
  col = mix(col, uWarm, (uAirless > 0.5 ? 0.08 : 0.22) * exp(-pow((d - 0.02) / 0.08, 2.0)));
  col = mix(col, uNight, smoothstep(0.04, -0.2, d));
  float lit = smoothstep(-0.35, 0.65, dot(normalize(q + vec2(1e-5)), uLight));
  float disc = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, r);
  float rim = exp(-pow((r - 1.0) / 0.035, 2.0)) * (uAirless > 0.5 ? 0.0 : 0.85) * lit;
  float a = max(disc, rim);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

const haloFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
void main() {
  float t = length(vLocal);
  if (t >= 1.0) discard;
  float alpha = t < 0.5556 ? 0.35
    : t < 0.78 ? mix(0.35, 0.10, (t - 0.5556) / (0.78 - 0.5556))
    : mix(0.10, 0.0, (t - 0.78) / 0.22);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

/** Solid capture ring plus the mint glow band. Both stay a fixed number of pixels. */
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

const saturnFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float band = smoothstep(0.46, 0.50, r) * (1.0 - smoothstep(0.90, 0.96, r));
  float gap = smoothstep(0.012, 0.012 + fw, abs(r - 0.68));
  float alpha = band * (0.35 + 0.65 * gap) * (0.55 + 0.45 * sin(r * 80.0));
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const diskFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uTime;
uniform float uHalf;
void main() {
  if (uHalf > 0.0 && vLocal.y < 0.0) discard;
  if (uHalf < 0.0 && vLocal.y > 0.0) discard;
  float r = length(vLocal);
  float band = smoothstep(0.28, 0.36, r) * (1.0 - smoothstep(0.92, 1.0, r));
  if (band <= 0.0) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float fil = 0.55 + 0.45 * sin(ang * 10.0 - uTime * 1.4 + r * 24.0);
  float approach = smoothstep(0.9, -0.9, vLocal.x);
  vec3 col = mix(uCool, uHot, smoothstep(0.36, 0.7, r));
  col *= mix(0.55, 1.15, approach);
  gl_FragColor = vec4(col, band * fil * 0.85);
}
`;

const holeFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uRing;
uniform vec3 uArc;
uniform float uHorizon;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float hole = 1.0 - smoothstep(uHorizon - fw, uHorizon + fw, r);
  float ringR = uHorizon * 1.22;
  float ring = 1.0 - smoothstep(0.012, 0.012 + fw * 2.0, abs(r - ringR));
  float einstein = 1.0 - smoothstep(0.008, 0.008 + fw * 2.0, abs(r - 0.875));
  float ang = atan(vLocal.y, vLocal.x);
  float wobble = 0.006 * sin(ang * 5.0);
  float arcR = 0.68 + wobble;
  float arcBand = 1.0 - smoothstep(0.018, 0.018 + fw * 2.0, abs(r - arcR));
  float upper = 1.0 - smoothstep(0.15, 0.55, abs(ang - 1.5707963));
  float lower = 1.0 - smoothstep(0.15, 0.55, abs(ang + 1.5707963));
  float arc = arcBand * max(upper, lower);
  if (hole <= 0.0 && ring <= 0.0 && einstein <= 0.0 && arc <= 0.0) discard;
  vec3 col = mix(vec3(0.01, 0.012, 0.02), uRing, max(ring, einstein * 0.65));
  col = mix(col, uArc, arc);
  float alpha = max(max(hole, ring * 0.9), max(einstein * 0.45, arc * 0.75));
  gl_FragColor = vec4(col, alpha);
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
    const star = brightestStar(level.bodies);
    let order = 1;
    for (const body of level.bodies) {
      if (body.kind === "star" || body.kind === "rogue" || body.look === "comet" || body.look === "asteroid") continue;
      if (body.kind === "blackhole") {
        if (artForBody(body, theme)) continue;
        const diskUniforms = {
          uHot: { value: srgbVec("#FFB15A") },
          uCool: { value: srgbVec("#FF6A2A") },
          uTime: { value: 0 },
          uHalf: { value: 1 },
        };
        const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shader(diskFrag, diskUniforms));
        back.scale.set(body.radius * 3.1, body.radius * 1.35, 1);
        back.position.set(body.x, body.y, 0);
        back.renderOrder = order++;
        back.name = `${body.id}-disk`;
        this.object.add(back);
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(holeFrag, {
            uRing: { value: srgbVec("#B48CFF") },
            uArc: { value: srgbVec("#FFB15A") },
            uHorizon: { value: 1 / 2.4 },
          }),
        );
        const span = body.radius * 2.4;
        mesh.position.set(body.x, body.y, 0);
        mesh.scale.set(span, span, 1);
        mesh.renderOrder = order++;
        mesh.name = body.id;
        mesh.userData.asset = theme.assets.blackHole;
        this.object.add(mesh);
        const front = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(diskFrag, {
            uHot: { value: srgbVec("#FFB15A") },
            uCool: { value: srgbVec("#FF6A2A") },
            uTime: diskUniforms.uTime,
            uHalf: { value: -1 },
          }),
        );
        front.scale.set(body.radius * 3.1, body.radius * 1.35, 1);
        front.position.set(body.x, body.y, 0);
        front.renderOrder = order++;
        front.name = `${body.id}-disk-front`;
        this.object.add(front);
        this.holes.push({ body, mesh, back, front, time: diskUniforms.uTime });
        continue;
      }
      const useArt = artForBody(body, theme) !== null;
      if (!useArt) {
      const target = body.kind === "target";
      const paint = planetPaint(body, theme);
      this.object.userData.asset = paint.asset;
      let halo: THREE.Mesh | null = null;
      if (target) {
        halo = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(haloFrag, { uColor: { value: srgbVec(theme.colors.planetXBase) } }),
        );
        halo.position.set(body.x, body.y, 0);
        halo.scale.set(body.radius * theme.planet.haloScale, body.radius * theme.planet.haloScale, 1);
        halo.renderOrder = order++;
        halo.name = `${body.id}-halo`;
        this.object.add(halo);
      }
      let belt: THREE.Mesh | null = null;
      if (paint.bands) {
        belt = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          shader(saturnFrag, { uColor: { value: srgbVec(paint.base) } }),
        );
        belt.scale.set(body.radius * 2.7, body.radius * 0.72, 1);
        belt.position.set(body.x, body.y, 0);
        belt.renderOrder = order++;
        belt.name = `${body.id}-belt`;
        this.object.add(belt);
      }
      const light = lightDir(body, star);
      const light2 = new THREE.Vector2(1, 0);
      const weight2 = { value: 0 };
      const spin = { value: 0 };
      const cloudSpin = { value: 0 };
      const baked = bakePlanet(body, paint);
      this.textures.push(baked.surface, baked.clouds);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(planetFrag, {
          uSurface: { value: baked.surface },
          uClouds: { value: baked.clouds },
          uLight: { value: light },
          uLight2: { value: light2 },
          uWeight2: weight2,
          uSpin: spin,
          uCloudSpin: cloudSpin,
          uCloudsOn: { value: baked.cloudsOn ? 1 : 0 },
          uAirless: { value: baked.airless ? 1 : 0 },
          uWarm: { value: srgbVec("#FF9455") },
          uNight: { value: srgbVec("#050B1E") },
        }),
      );
      mesh.position.set(body.x, body.y, 0);
      mesh.scale.set(body.radius * 1.1, body.radius * 1.1, 1);
      mesh.renderOrder = order++;
      mesh.name = body.id;
      this.object.add(mesh);
      this.planets.push({ body, mesh, halo, belt, light, light2, weight2, spin, cloudSpin, surface: baked.surface, clouds: baked.clouds });
      }

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

function brightestStar(bodies: readonly Body[]): Body | undefined {
  let best: Body | undefined;
  let bestMass = -1;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star" || body.mass <= bestMass) continue;
    best = body;
    bestMass = body.mass;
  }
  return best;
}

function lightDir(body: Body, star: Body | undefined): THREE.Vector2 {
  if (!star) return new THREE.Vector2(1, 0);
  const dx = star.x - body.x;
  const dy = star.y - body.y;
  const d = Math.hypot(dx, dy) || 1;
  return new THREE.Vector2(dx / d, dy / d);
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

function bakePlanet(body: Body, paint: { base: string; highlight: string; shadow: string; bands: boolean }): {
  surface: THREE.CanvasTexture;
  clouds: THREE.CanvasTexture;
  cloudsOn: boolean;
  airless: boolean;
} {
  const airless = body.kind === "moon" || body.look === "dwarf" || body.look === "moon" || body.look === "moon-icy" || body.look === "moon-volcanic";
  const cloudsOn = !airless && !paint.bands;
  const seed = hashString(body.id);
  const surface = canvasTexture(paintSurface(seed, paint, body.look === "moon-volcanic", body.look === "moon-icy", paint.bands));
  const clouds = canvasTexture(paintClouds(seed + 19, cloudsOn));
  return { surface, clouds, cloudsOn, airless };
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function paintSurface(
  seed: number,
  paint: { base: string; highlight: string; shadow: string },
  lava: boolean,
  ice: boolean,
  bands: boolean,
): HTMLCanvasElement {
  // Power of two. A 192×96 canvas with RepeatWrapping is an incomplete
  // texture on WebGL1, and Safari samples that as stretched stripes.
  const w = 256;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Could not bake a planet");
  const img = g.createImageData(w, h);
  const base = rgb(paint.base);
  const high = rgb(paint.highlight);
  const shadow = rgb(paint.shadow);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const n = fbm(u * 5.5, v * 3.2, seed);
      let color = base;
      if (bands) {
        const stripe = 0.5 + 0.5 * Math.sin((v * 18 + n * 1.4) * Math.PI * 2);
        color = mix(shadow, high, stripe);
      } else if (lava) {
        color = n > 0.62 ? high : n > 0.48 ? mix(base, high, (n - 0.48) / 0.14) : shadow;
      } else if (ice) {
        color = n > 0.58 ? high : mix(base, shadow, n);
      } else {
        color = n > 0.62 ? high : n > 0.5 ? mix(base, high, (n - 0.5) / 0.12) : mix(shadow, base, n / 0.5);
      }
      const i = (y * w + x) * 4;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

function paintClouds(seed: number, on: boolean): HTMLCanvasElement {
  const w = 256;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Could not bake clouds");
  const img = g.createImageData(w, h);
  if (on) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = fbm(x / w * 4.2, y / h * 2.4, seed);
        const a = n > 0.58 ? Math.min(1, (n - 0.58) / 0.22) : 0;
        const i = (y * w + x) * 4;
        img.data[i] = 236;
        img.data[i + 1] = 244;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 210);
      }
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const n = (ix: number, iy: number) => {
    const s = Math.imul(ix + seed, 374761393) + Math.imul(iy, 668265263);
    return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  };
  const a = n(x0, y0);
  const b = n(x0 + 1, y0);
  const c = n(x0, y0 + 1);
  const d = n(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let a = 0.5;
  let s = 0;
  let n = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    s += a * noise(px, py, seed + i * 17);
    n += a;
    px = px * 2.02 + 3.1;
    py = py * 2.02 + 1.7;
    a *= 0.5;
  }
  return s / n;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function planetPaint(body: Body, theme: Theme): { highlight: string; base: string; shadow: string; bands: boolean; asset: string } {
  const colors = theme.colors;
  if (body.kind === "target") {
    return {
      highlight: colors.planetXHighlight,
      base: colors.planetXBase,
      shadow: colors.planetXShadow,
      bands: false,
      asset: theme.assets.planetX,
    };
  }
  if (body.look === "gas-giant") {
    return { highlight: "#FFF3DE", base: "#EBA75E", shadow: "#7C3C1E", bands: true, asset: theme.assets.gasGiant };
  }
  if (body.look === "moon-icy") {
    return { highlight: "#FFFFFF", base: "#DCE4FF", shadow: "#4E78A8", bands: false, asset: theme.assets.moonChain };
  }
  if (body.look === "moon-volcanic") {
    return { highlight: "#F6EBA8", base: "#E0892E", shadow: "#8C6A2A", bands: false, asset: theme.assets.moonChain };
  }
  if (body.look === "dwarf") {
    return { highlight: "#FFF6E6", base: "#CDA273", shadow: "#6A402A", bands: false, asset: theme.assets.moonChain };
  }
  if (body.look === "moon") {
    return { highlight: "#F4F2FC", base: "#A6A2B6", shadow: "#4B4866", bands: false, asset: theme.assets.moonChain };
  }
  return {
    highlight: colors.planetStartHighlight,
    base: colors.planetStartBase,
    shadow: colors.planetStartShadow,
    bands: false,
    asset: theme.assets.planetStart,
  };
}
