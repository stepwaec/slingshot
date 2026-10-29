import * as THREE from "three";
import type { Vec2 } from "../../sim/physics";
import { sampleBurnAnim, windupFlicker, type BurnSample } from "../burn-anim";
import { projectToScreen } from "../camera";
import { srgbVec, shader } from "./materials";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * v1 ship: the ship.svg polygons, flat, screen-pixel sized, plus the burn
 * wind-up and thrust tail. Those read sim time and the plan; they never
 * step the simulation. Swap this factory for a glTF. Load
 * `theme.assets.ship` and parent it on `object`; keep the heading lerp.
 * The crash burst can move with the ship or become its own factory later.
 */
export const createShip: VisualFactory = (theme) => new ShipVisual(theme);

class ShipVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly ship = new THREE.Group();
  private readonly thrust = new THREE.Group();
  private readonly burst: THREE.Group;
  private readonly outerAttr: THREE.BufferAttribute;
  private readonly coreAttr: THREE.BufferAttribute;
  private readonly outerMat: THREE.MeshBasicMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Mesh;
  private readonly glowAlpha: THREE.IUniform<number>;
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private angle = 0;
  private angleReady = false;
  private lastMode: VisualFrame["game"]["mode"] | null = null;
  private burstFrames = 0;

  constructor(theme: Theme) {
    this.theme = theme;
    this.object.name = "ship";
    this.object.userData.asset = theme.assets.ship;
    const spec = theme.ship;
    const hullMat = new THREE.MeshBasicMaterial({
      color: theme.colors.shipHull,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const lineMat = new THREE.LineBasicMaterial({ color: theme.colors.shipOutline, depthTest: false, toneMapped: false });
    this.ship.name = "hull";
    for (const pts of [spec.finL, spec.finR, spec.hull]) {
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapeFromSvg(pts)), hullMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      const line = outlineFromSvg(pts, lineMat);
      line.renderOrder = 9;
      this.ship.add(mesh, line);
    }
    const cockpit = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: theme.colors.shipCockpit, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    cockpit.scale.set(spec.cockpit.w, spec.cockpit.h, 1);
    cockpit.position.set(spec.cockpit.x, spec.cockpit.y, 0);
    cockpit.frustumCulled = false;
    cockpit.renderOrder = 9;
    this.ship.add(cockpit);

    this.thrust.name = "thrust";
    this.thrust.userData.asset = theme.assets.shipThrust;
    const outerGeo = new THREE.BufferGeometry();
    const coreGeo = new THREE.BufferGeometry();
    outerGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([
          -theme.thrust.outerHalfWidth, theme.thrust.base, 0,
          theme.thrust.outerHalfWidth, theme.thrust.base, 0,
          0, theme.thrust.base - theme.thrust.outerLength, 0,
        ]),
        3,
      ),
    );
    coreGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([
          -theme.thrust.coreHalfWidth, theme.thrust.base, 0,
          theme.thrust.coreHalfWidth, theme.thrust.base, 0,
          0, theme.thrust.base - theme.thrust.coreLength, 0,
        ]),
        3,
      ),
    );
    this.outerAttr = outerGeo.getAttribute("position") as THREE.BufferAttribute;
    this.coreAttr = coreGeo.getAttribute("position") as THREE.BufferAttribute;
    this.outerMat = flameMaterial(theme.colors.thrustOuter, theme.thrust.outerAlpha);
    this.coreMat = flameMaterial(theme.colors.thrustCore, 1);
    const outer = new THREE.Mesh(outerGeo, this.outerMat);
    const core = new THREE.Mesh(coreGeo, this.coreMat);
    outer.renderOrder = 7;
    core.renderOrder = 7;
    const glowAlpha = { value: 0 };
    this.glowAlpha = glowAlpha;
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      shader(glowFrag, {
        uColor: { value: srgbVec(theme.colors.thrustOuter) },
        uAlpha: glowAlpha,
      }),
    );
    this.glow.name = "burn-windup";
    this.glow.position.set(0, theme.thrust.base, 0);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    this.glow.visible = false;
    const glowMat = this.glow.material as THREE.ShaderMaterial;
    glowMat.blending = THREE.AdditiveBlending;
    this.thrust.add(this.glow, outer, core);
    this.thrust.visible = false;

    this.burst = buildBurst(theme);
    this.object.add(this.thrust, this.ship, this.burst);
  }

  update(frame: VisualFrame): void {
    const { game, width, height } = frame;
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

    const showBurn = !crashed && (game.mode === "flying" || game.mode === "paused");
    if (!showBurn) {
      this.thrust.visible = false;
    } else {
      const burn = this.theme.burn;
      this.poseThrust(
        sampleBurnAnim(game.ship.step, game.level.dt, game.nodes, burn.windup, burn.tail),
        k,
      );
    }

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

  /** Wind-up glow and thrust tail. Length and flicker come from sim time. */
  private poseThrust(anim: BurnSample, scale: number): void {
    const burn = this.theme.burn;
    const windup = anim.windup;
    const thrust = anim.thrust;
    const flicker = windupFlicker(anim.time, windup, burn.flickerHz);
    const show = thrust > 0 || windup > 0;
    this.thrust.visible = show;
    this.glow.visible = windup > 0;
    if (!show) return;
    this.thrust.position.copy(this.ship.position);
    this.thrust.rotation.z = this.angle;
    this.thrust.scale.set(scale, scale, 1);
    const wobble = 0.94 + 0.06 * Math.sin(anim.time * burn.flickerHz * Math.PI * 2);
    const lengthScale =
      thrust > 0 ? (0.7 + 0.3 * thrust) * wobble : (0.22 + 0.38 * windup) * (0.72 + 0.28 * flicker);
    const alpha = thrust > 0 ? thrust : windup * flicker * 0.8;
    this.outerAttr.setY(2, this.theme.thrust.base - this.theme.thrust.outerLength * lengthScale);
    this.coreAttr.setY(2, this.theme.thrust.base - this.theme.thrust.coreLength * lengthScale);
    this.outerAttr.needsUpdate = true;
    this.coreAttr.needsUpdate = true;
    this.outerMat.opacity = this.theme.thrust.outerAlpha * alpha;
    this.coreMat.opacity = alpha;
    if (!this.glow.visible) return;
    const span = 4 + 10 * windup * flicker;
    this.glow.scale.set(span, span, 1);
    this.glowAlpha.value = 0.35 + 0.65 * windup * flicker;
  }
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

function flameMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  return material;
}

function shapeFromSvg(pts: readonly number[]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0] - 12, 12 - pts[1]);
  for (let i = 2; i < pts.length; i += 2) shape.lineTo(pts[i] - 12, 12 - pts[i + 1]);
  shape.closePath();
  return shape;
}

function outlineFromSvg(pts: readonly number[], material: THREE.LineBasicMaterial): THREE.LineLoop {
  const data: number[] = [];
  for (let i = 0; i < pts.length; i += 2) data.push(pts[i] - 12, 12 - pts[i + 1], 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
  const line = new THREE.LineLoop(geometry, material);
  line.frustumCulled = false;
  return line;
}

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
