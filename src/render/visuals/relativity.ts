import * as THREE from "three";
import { srgb01 } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Flight-only aberration and colour shift.
 *
 * Planning and pause leave this hidden, so the chart stays clean.
 * Stars bunch toward the ship's velocity (relativistic aberration) and
 * shift blue ahead of the ship, red behind it. A deep gravitational well
 * blueshifts the whole sky. Swap this factory to drop the effect.
 */
export const createRelativity: VisualFactory = (theme) => new RelativityVisual(theme);

const STAR_COUNT = 72;

const washFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec2 uApex;
uniform float uStrength;
uniform vec3 uAhead;
uniform vec3 uAft;
void main() {
  vec2 dir = normalize(vLocal + vec2(0.0001));
  float ahead = dot(dir, uApex);
  vec3 col = mix(uAft, uAhead, clamp(ahead * 0.5 + 0.5, 0.0, 1.0));
  float edge = smoothstep(0.02, 0.48, length(vLocal));
  float alpha = uStrength * edge * (0.15 + 0.55 * abs(ahead));
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

class RelativityVisual implements Visual {
  readonly space = "background" as const;
  readonly object = new THREE.Group();
  private readonly wash: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly angles: Float32Array;
  private readonly apex: THREE.Vector2;
  private width = 1;
  private height = 1;

  constructor(theme: Theme) {
    this.object.name = "relativity";
    this.object.visible = false;
    const ahead = srgbVec(theme.colors.planetStartHighlight);
    const aft = srgbVec(theme.colors.starGlow);
    this.apex = new THREE.Vector2(1, 0);
    this.wash = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      shader(washFrag, {
        uApex: { value: this.apex },
        uStrength: { value: 0 },
        uAhead: { value: ahead },
        uAft: { value: aft },
      }),
    );
    this.wash.frustumCulled = false;
    this.wash.renderOrder = 1;
    this.wash.name = "relativity-wash";

    this.positions = new Float32Array(STAR_COUNT * 3);
    this.colors = new Float32Array(STAR_COUNT * 3);
    this.angles = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) this.angles[i] = (i / STAR_COUNT) * Math.PI * 2 + (i % 5) * 0.017;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 2.4,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        toneMapped: false,
        sizeAttenuation: false,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 2;
    this.stars.name = "relativity-stars";
    this.object.add(this.wash, this.stars);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.wash.scale.set(width, height, 1);
    this.wash.position.set(width / 2, height / 2, 0);
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    if (game.mode !== "flying") {
      this.object.visible = false;
      return;
    }
    const ship = game.ship;
    const c = game.level.c;
    const speed = Math.hypot(ship.vx, ship.vy);
    const beta = Math.min(0.9, c > 0 ? speed / c : 0);
    const slow = 1 - Math.min(1, Math.max(0, ship.rate));
    const strength = Math.min(1, beta * 3.2 + slow * 1.35);
    if (strength < 0.045) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    const width = frame.width || this.width;
    const height = frame.height || this.height;
    const heading = speed > 1e-6 ? Math.atan2(ship.vy, ship.vx) : 0;
    this.apex.set(Math.cos(heading), Math.sin(heading));
    const material = this.wash.material as THREE.ShaderMaterial;
    material.uniforms.uStrength.value = strength * 0.28;

    const gamma = Math.sqrt(Math.max(0, 1 - beta * beta));
    const stationary = Math.sqrt(Math.min(1, ship.rate * ship.rate + beta * beta));
    const grav = stationary > 0.04 ? Math.min(3, 1 / stationary) : 3;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.46;
    const cool = srgb01("#9CCBFF");
    const hot = srgb01("#FF5A1F");
    for (let i = 0; i < STAR_COUNT; i++) {
      const alpha = this.angles[i] - heading;
      const cos = Math.cos(alpha);
      const sin = Math.sin(alpha);
      const den = 1 + beta * cos;
      const cosP = (cos + beta) / den;
      const sinP = (sin * gamma) / den;
      const aberrated = Math.atan2(sinP, cosP) + heading;
      const o = i * 3;
      this.positions[o] = cx + Math.cos(aberrated) * radius;
      this.positions[o + 1] = cy + Math.sin(aberrated) * radius;
      this.positions[o + 2] = 0;
      const doppler = gamma / Math.max(1e-3, 1 - beta * cos);
      const shift = doppler * grav;
      const t = Math.max(-1, Math.min(1, (shift - 1) / 1.4));
      const blue = t > 0 ? t : 0;
      const red = t < 0 ? -t : 0;
      this.colors[o] = clamp01(hot[0] * red + cool[0] * (1 - red) * (1 - blue * 0.35));
      this.colors[o + 1] = clamp01(cool[1] * (1 - red) * (0.55 + 0.45 * blue));
      this.colors[o + 2] = clamp01(cool[2] * (0.45 + 0.55 * blue) * (1 - red));
    }
    const geometry = this.stars.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
