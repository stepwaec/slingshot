import * as THREE from "three";
import { bodyPose, bodyPresent, type Body } from "../../sim/physics";
import {
  ENGINE_MIRROR_A0,
  ENGINE_MIRROR_A1,
  ENGINE_MIRROR_INNER,
  ENGINE_MIRROR_OUTER,
  ENGINE_MIRROR_TILES,
  JET_HALF_BASE,
  JET_HALF_EXP,
  JET_HALF_GAIN,
  JET_INNER,
  JET_MARGIN_IN,
  JET_MARGIN_OUT,
  JET_OUTER,
  MIRROR_A0,
  MIRROR_A1,
  MIRROR_INNER,
  MIRROR_OUTER,
  RAY_LENGTH,
  RAY_START,
  SWARM_BAND,
  SWARM_HEAT_OUTER,
  SWARM_SHELLS,
  engineScale,
  shkadovScale,
} from "../../sim/mega";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { srgbVec } from "./materials";

/**
 * Stellar engine, Dyson swarm and Shkadov thruster.
 * Groups sit on the body's pose and scale by radius / the sample radius
 * in the SVG header. Hazard edges use the same spans as the sim.
 * Rag, dashes, glints and knots run on `frame.now`.
 */
export const createMega: VisualFactory = (theme, level) => new MegaVisual(theme, level);

const shellVert = /* glsl */ `
attribute float aArc;
attribute float aSide;
varying float vArc;
varying float vSide;
void main() {
  vArc = aArc;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const shellFrag = /* glsl */ `
precision highp float;
varying float vArc;
varying float vSide;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uDash;
uniform float uGap;
uniform float uOffset;
uniform float uSolid;
void main() {
  float period = uDash + uGap;
  float along = mod(vArc + uOffset, period);
  if (uSolid < 0.5 && along > uDash) discard;
  float fw = fwidth(vSide);
  float edge = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, abs(vSide));
  float alpha = edge * uAlpha;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const jetFrag = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform vec3 uCore;
uniform vec3 uCoreEnd;
uniform float uPhase;
void main() {
  float along = vLocal.x;
  float span = 330.0;
  float t = clamp((along - 30.0) / span, 0.0, 1.0);
  float w = 4.0 + 16.0 * pow(t, 0.8);
  float rag = 1.8 * sin(along * 0.09 + uPhase) + 0.85 * sin(along * 0.23 + uPhase * 1.7);
  float halfW = w + rag;
  float d = abs(vLocal.y);
  float fw = fwidth(d);
  float mask = 1.0 - smoothstep(halfW - fw, halfW + fw, d);
  if (mask < 0.02 || along < 30.0 || along > 360.0) discard;
  vec3 col = uC0;
  float alpha = 1.0;
  if (t < 0.15) {
    float u = t / 0.15;
    col = mix(uC0, uC1, u);
    alpha = mix(1.0, 0.95, u);
  } else if (t < 0.45) {
    float u = (t - 0.15) / 0.3;
    col = mix(uC1, uC2, u);
    alpha = mix(0.95, 0.8, u);
  } else if (t < 0.75) {
    float u = (t - 0.45) / 0.3;
    col = mix(uC2, uC3, u);
    alpha = mix(0.8, 0.45, u);
  } else {
    float u = (t - 0.75) / 0.25;
    col = mix(uC3, uC4, u);
    alpha = mix(0.45, 0.0, u);
  }
  if (along < 230.0) {
    float ct = clamp((along - 30.0) / 200.0, 0.0, 1.0);
    float core = 1.0 - smoothstep(1.6, 2.4, d);
    float coreA = mix(0.95, 0.0, ct) * core;
    vec3 coreCol = mix(uCore, uCoreEnd, ct);
    col = mix(col, coreCol, coreA);
    alpha = max(alpha, coreA);
  }
  gl_FragColor = vec4(col, mask * alpha);
}
`;

const heatFrag = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec3 uEdge;
uniform vec3 uPeak;
uniform float uPeakAlpha;
void main() {
  float r = length(vLocal);
  if (r > 1.0 || r < 0.55) discard;
  float alpha = 0.0;
  if (r < 0.75) alpha = uPeakAlpha * (r - 0.55) / 0.2;
  else alpha = uPeakAlpha * (1.0 - r) / 0.25;
  vec3 col = r < 0.75 ? mix(uEdge, uPeak, (r - 0.55) / 0.2) : mix(uPeak, uEdge, (r - 0.75) / 0.25);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const tileFrag = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uOutline;
void main() {
  float ax = abs(vLocal.x);
  float ay = abs(vLocal.y);
  if (ax > 4.5 || ay > 1.6) discard;
  float fw = fwidth(ax);
  float box = 1.0 - smoothstep(4.5 - fw, 4.5, ax);
  box *= 1.0 - smoothstep(1.6 - fw, 1.6, ay);
  float outline = step(4.1, ax) + step(1.2, ay);
  float u = clamp((vLocal.y + 1.6) / 3.2, 0.0, 1.0);
  vec3 fill = u < 0.5 ? mix(uA, uB, u / 0.5) : mix(uB, uC, (u - 0.5) / 0.5);
  vec3 col = mix(fill, uOutline, clamp(outline, 0.0, 1.0));
  gl_FragColor = vec4(col, box);
}
`;

const mirrorFrag = /* glsl */ `
precision highp float;
varying float vRad;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uOutline;
void main() {
  float u = clamp(vRad, 0.0, 1.0);
  vec3 col = u < 0.35 ? mix(uA, uB, u / 0.35) : mix(uB, uC, (u - 0.35) / 0.65);
  if (u < 0.12 || u > 0.9) col = uOutline;
  gl_FragColor = vec4(col, 1.0);
}
`;

const rayFrag = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uAlpha;
uniform float uLength;
void main() {
  float across = abs(vLocal.y) * 2.0;
  float fw = fwidth(across);
  float edge = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, across);
  float along = clamp(vLocal.x / uLength + 0.5, 0.0, 1.0);
  vec3 col = mix(uHot, uCool, along);
  float alpha = uAlpha * (1.0 - along) * edge;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const knotFrag = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float alpha = (1.0 - smoothstep(1.0 - fw, 1.0 + fw, r)) * uAlpha;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(mix(uCore, uEdge, r), alpha);
}
`;

const localVert = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const tileVert = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  vec4 local = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * local;
}
`;

const arcVert = /* glsl */ `
attribute float aRad;
varying float vRad;
void main() {
  vRad = aRad;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface StrokeUniforms {
  uColor: THREE.IUniform;
  uAlpha: THREE.IUniform;
  uDash: THREE.IUniform;
  uGap: THREE.IUniform;
  uOffset: THREE.IUniform;
  uSolid: THREE.IUniform;
}

class MegaVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly bodies: readonly Body[];
  private readonly g: number;
  private readonly engines: EngineDraw[] = [];
  private readonly swarms: SwarmDraw[] = [];
  private readonly thrusters: ThrusterDraw[] = [];

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.object.name = "mega";
    this.bodies = level.bodies;
    this.g = level.g;
    const colors = theme.colors;
    for (const body of level.bodies) {
      if (body.engine) this.engines.push(new EngineDraw(theme, colors, body));
      if (body.dyson) this.swarms.push(new SwarmDraw(theme, colors, body));
      if (body.shkadov) this.thrusters.push(new ThrusterDraw(theme, colors, body));
    }
    for (const draw of [...this.engines, ...this.swarms, ...this.thrusters]) this.object.add(draw.group);
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = (game.mode === "planning" ? 0 : game.ship.step) * game.level.dt;
    const now = frame.now / 1000;
    const planning = game.mode === "planning" || game.mode === "paused";
    for (const draw of this.engines) draw.update(time, now, planning, this.bodies, this.g);
    for (const draw of this.swarms) draw.update(time, now, this.bodies, this.g);
    for (const draw of this.thrusters) draw.update(time, now, planning, this.bodies, this.g);
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

class EngineDraw {
  readonly group = new THREE.Group();
  private readonly body: Body;
  private readonly jetPhase: THREE.IUniform;
  private readonly knots: { mesh: THREE.Mesh; alpha: THREE.IUniform; delay: number }[];
  private readonly margins: THREE.Object3D;
  private readonly label: THREE.Object3D | null;

  constructor(theme: Theme, colors: Theme["colors"], body: Body) {
    this.body = body;
    this.group.name = `${body.id}-engine`;
    const tiles = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(9, 3.2),
      material(tileFrag, tileVert, {
        uA: { value: srgbVec(colors.mirrorBright) },
        uB: { value: srgbVec(colors.mirrorMid) },
        uC: { value: srgbVec(colors.mirrorDeep) },
        uOutline: { value: srgbVec(colors.mirrorOutline) },
      }),
      ENGINE_MIRROR_TILES,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < ENGINE_MIRROR_TILES; i++) {
      const u = i / (ENGINE_MIRROR_TILES - 1);
      const angle = ENGINE_MIRROR_A0 + (ENGINE_MIRROR_A1 - ENGINE_MIRROR_A0) * u;
      const radius = i % 2 === 0 ? ENGINE_MIRROR_INNER : ENGINE_MIRROR_OUTER;
      dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      dummy.rotation.z = angle + Math.PI / 2;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);
    }
    tiles.renderOrder = 1;
    tiles.frustumCulled = false;
    this.group.add(tiles);

    const jet = new THREE.Mesh(
      jetGeometry(),
      material(jetFrag, localVert, {
        uC0: { value: srgbVec(colors.engineJet0) },
        uC1: { value: srgbVec(colors.engineJet1) },
        uC2: { value: srgbVec(colors.engineJet2) },
        uC3: { value: srgbVec(colors.engineJet3) },
        uC4: { value: srgbVec(colors.engineJet4) },
        uCore: { value: srgbVec(colors.engineCore) },
        uCoreEnd: { value: srgbVec(colors.engineCoreEnd) },
        uPhase: { value: 0 },
      }),
    );
    this.jetPhase = (jet.material as THREE.ShaderMaterial).uniforms.uPhase;
    jet.renderOrder = 1;
    jet.frustumCulled = false;
    this.group.add(jet);

    this.knots = theme.mega.knotDelays.map((delay) => {
      const alpha = { value: 1 };
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        material(knotFrag, localVert, {
          uCore: { value: srgbVec(colors.engineCore) },
          uEdge: { value: srgbVec(colors.engineKnot) },
          uAlpha: alpha,
        }),
      );
      mesh.scale.set(9, 4, 1);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, alpha, delay };
    });

    const upper = nozzlePoints(1);
    const lower = nozzlePoints(-1);
    this.group.add(strokeMesh(upper, 1.5, colors.nozzleBar, 1, 0, 1, 1));
    this.group.add(strokeMesh(lower, 1.5, colors.nozzleBar, 1, 0, 1, 1));
    this.group.add(strokeMesh(upper, 0.5, colors.nozzleField, 1, 2, 3, 0));
    this.group.add(strokeMesh(lower, 0.5, colors.nozzleField, 1, 2, 3, 0));

    this.margins = new THREE.Group();
    for (const sign of [1, -1]) {
      for (const factor of [JET_MARGIN_IN, JET_MARGIN_OUT]) {
        this.margins.add(strokeMesh(marginPoints(sign, factor), 0.6, colors.scoopMark, 0.6, 5, 5, 0));
      }
    }
    this.margins.renderOrder = 2;
    this.group.add(this.margins);
    this.label = labelMesh("scoop fuel here", colors.scoopMark);
    if (this.label) {
      this.label.position.set(200, -36, 0);
      this.label.renderOrder = 2;
      this.group.add(this.label);
    }
  }

  update(time: number, now: number, planning: boolean, bodies: readonly Body[], g: number): void {
    const pose = place(this.group, this.body, time, bodies, g, engineScale(this.body.radius));
    if (!pose) return;
    this.group.rotation.z = this.body.engine?.angle ?? 0;
    const shapes = 3;
    this.jetPhase.value = (Math.floor(now / 0.5) % shapes) * ((Math.PI * 2) / shapes);
    const span = 300 - 34;
    for (const knot of this.knots) {
      const u = ((now + knot.delay) % 4) / 4;
      const along = 34 + span * u;
      knot.mesh.position.set(along, 0, 0);
      knot.alpha.value = u < 0.6 ? 1 - (0.4 * u) / 0.6 : 0.6 * (1 - (u - 0.6) / 0.4);
    }
    this.margins.visible = planning;
    if (this.label) this.label.visible = planning;
  }
}

class SwarmDraw {
  readonly group = new THREE.Group();
  private readonly body: Body;
  private readonly shells: { offset: THREE.IUniform; period: number; cycle: number }[] = [];

  constructor(theme: Theme, colors: Theme["colors"], body: Body) {
    this.body = body;
    this.group.name = `${body.id}-swarm`;
    const heat = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      material(heatFrag, localVert, {
        uEdge: { value: srgbVec(colors.swarmHeatEdge) },
        uPeak: { value: srgbVec(colors.swarmHeat) },
        uPeakAlpha: { value: theme.mega.heatPeakAlpha },
      }),
    );
    heat.scale.set(SWARM_HEAT_OUTER, SWARM_HEAT_OUTER, 1);
    heat.renderOrder = -1.2;
    heat.frustumCulled = false;
    this.group.add(heat);
    for (let i = 0; i < SWARM_SHELLS.length; i++) {
      const shell = SWARM_SHELLS[i];
      const period = theme.mega.shellPeriods[i] ?? 26;
      const dash = theme.mega.shellDash[i] ?? 3;
      const gap = theme.mega.shellGap[i] ?? 7;
      const cycle = dash + gap;
      const half = SWARM_BAND / 2;
      for (const back of [true, false]) {
        const mesh = strokeMesh(ellipsePoints(shell.rx, shell.ryOverRx * shell.rx, shell.rot, back), half, colors.swarmCollector, 1, dash, gap, 0);
        mesh.renderOrder = back ? -0.5 : 1;
        this.group.add(mesh);
        const glint = strokeMesh(
          ellipsePoints(shell.rx, shell.ryOverRx * shell.rx, shell.rot, back),
          half,
          colors.swarmGlint,
          1,
          theme.mega.shellGlint,
          cycle * 3 - theme.mega.shellGlint,
          0,
        );
        glint.renderOrder = mesh.renderOrder;
        this.group.add(glint);
        const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms as unknown as StrokeUniforms;
        const glintUniforms = (glint.material as THREE.ShaderMaterial).uniforms as unknown as StrokeUniforms;
        this.shells.push({ offset: uniforms.uOffset, period, cycle });
        this.shells.push({ offset: glintUniforms.uOffset, period, cycle });
      }
    }
  }

  update(time: number, now: number, bodies: readonly Body[], g: number): void {
    place(this.group, this.body, time, bodies, g, engineScale(this.body.radius));
    for (const shell of this.shells) {
      const speed = (10 * shell.cycle) / shell.period;
      shell.offset.value = -now * speed;
    }
  }
}

class ThrusterDraw {
  readonly group = new THREE.Group();
  private readonly body: Body;
  private readonly arrow: THREE.Object3D;
  private readonly label: THREE.Object3D | null;

  constructor(theme: Theme, colors: Theme["colors"], body: Body) {
    this.body = body;
    this.group.name = `${body.id}-shkadov`;
    const count = theme.mega.rayCount;
    for (let i = 0; i < count; i++) {
      const u = (i / (count - 1)) * 2 - 1;
      const deg = u * theme.mega.rayHalfDeg;
      const width = theme.mega.rayWidth0 + (theme.mega.rayWidth1 - theme.mega.rayWidth0) * Math.abs(u);
      const ray = new THREE.Mesh(
        new THREE.PlaneGeometry(RAY_LENGTH, 1),
        material(rayFrag, localVert, {
          uHot: { value: srgbVec(colors.engineJet0) },
          uCool: { value: srgbVec(colors.engineKnot) },
          uAlpha: { value: theme.mega.rayAlpha },
          uLength: { value: RAY_LENGTH },
        }),
      );
      ray.scale.set(1, width, 1);
      ray.position.set(RAY_START + RAY_LENGTH / 2, 0, 0);
      const aim = new THREE.Group();
      aim.rotation.z = (deg * Math.PI) / 180;
      aim.add(ray);
      ray.renderOrder = -0.8;
      ray.frustumCulled = false;
      this.group.add(aim);
    }
    const glow = strokeMesh(arcPoints(theme.mega.glowRadius, MIRROR_A0, MIRROR_A1), theme.mega.glowWidth / 2, colors.reflectedGlow, theme.mega.glowAlpha, 0, 1, 1);
    glow.renderOrder = -0.4;
    this.group.add(glow);
    const mirror = new THREE.Mesh(
      annulusGeometry(MIRROR_INNER, MIRROR_OUTER, MIRROR_A0, MIRROR_A1, 48),
      material(mirrorFrag, arcVert, {
        uA: { value: srgbVec(colors.shkadovBright) },
        uB: { value: srgbVec(colors.shkadovMid) },
        uC: { value: srgbVec(colors.shkadovDeep) },
        uOutline: { value: srgbVec(colors.mirrorOutline) },
      }),
    );
    mirror.renderOrder = 1;
    mirror.frustumCulled = false;
    this.group.add(mirror);
    for (let i = 0; i < theme.mega.strutCount; i++) {
      const u = i / (theme.mega.strutCount - 1);
      const angle = MIRROR_A0 + (MIRROR_A1 - MIRROR_A0) * u;
      const inner = MIRROR_OUTER;
      const outer = MIRROR_OUTER + theme.mega.strutLength;
      const mesh = strokeMesh(
        [
          { x: Math.cos(angle) * inner, y: Math.sin(angle) * inner },
          { x: Math.cos(angle) * outer, y: Math.sin(angle) * outer },
        ],
        0.6,
        colors.strut,
        1,
        0,
        1,
        1,
      );
      mesh.renderOrder = 1;
      this.group.add(mesh);
    }
    this.arrow = new THREE.Group();
    const shaft = strokeMesh(
      [
        { x: -150, y: -130 },
        { x: -40, y: -130 },
      ],
      0.7,
      colors.driftArrow,
      1,
      4,
      5,
      0,
    );
    shaft.renderOrder = 2;
    this.arrow.add(shaft);
    const head = new THREE.Mesh(arrowHead(), new THREE.MeshBasicMaterial({
      color: colors.driftArrow,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }));
    head.renderOrder = 2;
    this.arrow.add(head);
    this.arrow.renderOrder = 2;
    this.group.add(this.arrow);
    this.label = labelMesh("the whole system drifts this way", colors.driftArrow);
    if (this.label) {
      this.label.position.set(-90, -148, 0);
      this.label.renderOrder = 2;
      this.group.add(this.label);
    }
  }

  update(time: number, _now: number, planning: boolean, bodies: readonly Body[], g: number): void {
    place(this.group, this.body, time, bodies, g, shkadovScale(this.body.radius));
    this.group.rotation.z = this.body.shkadov?.angle ?? 0;
    this.arrow.visible = planning;
    if (this.label) this.label.visible = planning;
  }
}

function place(group: THREE.Group, body: Body, time: number, bodies: readonly Body[], g: number, scale: number): boolean {
  if (!bodyPresent(body, time)) {
    group.visible = false;
    return false;
  }
  const pose = bodyPose(body, time, bodies, g);
  group.visible = true;
  group.position.set(pose.x, pose.y, 0);
  group.scale.set(scale, scale, 1);
  return true;
}

function jetGeometry(): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(JET_OUTER - JET_INNER, 56);
  geo.translate((JET_INNER + JET_OUTER) / 2, 0, 0);
  return geo;
}

function marginPoints(sign: number, factor: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const along = JET_INNER + (JET_OUTER - JET_INNER) * t;
    const width = (JET_HALF_BASE + JET_HALF_GAIN * Math.pow(t, JET_HALF_EXP)) * factor;
    points.push({ x: along, y: sign * width });
  }
  return points;
}

function nozzlePoints(sign: number): { x: number; y: number }[] {
  const a = { x: 22, y: 24 * sign };
  const b = { x: 38, y: 12 * sign };
  const c = { x: 40, y: 5 * sign };
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const u = 1 - t;
    points.push({
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    });
  }
  return points;
}

function ellipsePoints(rx: number, ry: number, rot: number, back: boolean): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const steps = 64;
  const start = back ? 0 : Math.PI;
  const end = back ? Math.PI : Math.PI * 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let i = 0; i <= steps; i++) {
    const theta = start + ((end - start) * i) / steps;
    const ex = rx * Math.cos(theta);
    const ey = ry * Math.sin(theta);
    points.push({ x: ex * cos - ey * sin, y: ex * sin + ey * cos });
  }
  return points;
}

function arcPoints(radius: number, a0: number, a1: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const angle = a0 + ((a1 - a0) * i) / steps;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

function annulusGeometry(inner: number, outer: number, a0: number, a1: number, steps: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const rad: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = a0 + ((a1 - a0) * i) / steps;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    positions.push(inner * c, inner * s, 0, outer * c, outer * s, 0);
    rad.push(0, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aRad", new THREE.Float32BufferAttribute(rad, 1));
  geo.setIndex(stripIndex((steps + 1) * 2));
  return geo;
}

function strokeMesh(
  points: { x: number; y: number }[],
  halfWidth: number,
  color: string,
  alpha: number,
  dash: number,
  gap: number,
  solid: number,
): THREE.Mesh {
  const geo = stripGeometry(points, halfWidth);
  const uniforms: StrokeUniforms = {
    uColor: { value: srgbVec(color) },
    uAlpha: { value: alpha },
    uDash: { value: dash },
    uGap: { value: gap },
    uOffset: { value: 0 },
    uSolid: { value: solid },
  };
  const mesh = new THREE.Mesh(geo, material(shellFrag, shellVert, { ...uniforms }));
  mesh.frustumCulled = false;
  return mesh;
}

function stripGeometry(points: { x: number; y: number }[], halfWidth: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const arc: number[] = [];
  const side: number[] = [];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    if (i > 0) length += Math.hypot(point.x - prev.x, point.y - prev.y);
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    const nx = -ty;
    const ny = tx;
    positions.push(point.x + nx * halfWidth, point.y + ny * halfWidth, 0);
    positions.push(point.x - nx * halfWidth, point.y - ny * halfWidth, 0);
    arc.push(length, length);
    side.push(1, -1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aArc", new THREE.Float32BufferAttribute(arc, 1));
  geo.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  geo.setIndex(stripIndex(points.length * 2));
  return geo;
}

function stripIndex(vertexCount: number): number[] {
  const index: number[] = [];
  for (let i = 0; i + 2 < vertexCount; i++) index.push(i, i + 1, i + 2);
  return index;
}

function arrowHead(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-158, -130, 0, -150, -125, 0, -150, -135, 0], 3));
  return geo;
}

function material(fragment: string, vertex: string, uniforms: { [key: string]: THREE.IUniform }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    precision: "highp",
  });
}

function labelMesh(text: string, color: string): THREE.Mesh | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = "500 28px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(96, 12), mat);
  mesh.frustumCulled = false;
  return mesh;
}
