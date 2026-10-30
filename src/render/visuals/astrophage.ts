import * as THREE from "three";
import { isEditing, type Game } from "../../game/state";
import { bodyPose, type Body } from "../../sim/physics";
import {
  curvePoint,
  curveTangent,
  petrovaCurve,
  eatenMix,
  gauss,
  hashSeed,
  lineFade,
  lineWidth,
  mulberry32,
  tauDisk,
  type Curve,
  type PetrovaLine,
} from "../../sim/astrophage";
import { screenToWorld, worldToScreen } from "../camera";
import { palette, srgb01 } from "../palette";
import { rasterMarkup } from "../svg-bake";
import { shader, srgbVec } from "./materials";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Infected stars, Petrova lines, knots, the harvest stream and the Tau Ceti
 * disk. The map ticks live in `astro-map.ts` (they are screen pixels).
 * Nothing here writes the sim. Cells and motes run on frame.now.
 */
export const createAstrophage: VisualFactory = (theme, level) => new AstrophageVisual(theme, level);

const CELL_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="-60 -60 120 120">
  <filter id="aiCells" filterUnits="userSpaceOnUse" x="-60" y="-60" width="120" height="120" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="1" seed="11" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.10  0 0 0 0 0.024  0 0 0 0 0.063  0 0 0 1 0" result="c"/>
    <feComponentTransfer in="c" result="c2"><feFuncA type="linear" slope="22" intercept="-14.2"/></feComponentTransfer>
    <feComposite in="c2" in2="SourceGraphic" operator="in"/>
  </filter>
  <circle r="45" fill="#ffffff" filter="url(#aiCells)"/>
</svg>`;

const ribbonVert = /* glsl */ `
attribute float aSide;
attribute float aT;
varying float vSide;
varying float vT;
void main() {
  vSide = aSide;
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ribbonFrag = /* glsl */ `
precision highp float;
varying float vSide;
varying float vT;
uniform float uTime;
uniform float uEaten;
uniform float uFade;
uniform vec3 uCrimson;
uniform vec3 uPink;
uniform vec3 uPale;
uniform vec3 uGreen;
void main() {
  float edge = abs(vSide);
  if (edge > 1.0) discard;
  float breathe = 0.82 + 0.18 * sin(uTime * 1.4 + vT * 6.0);
  float outer = smoothstep(1.0, 0.72, edge);
  float mid = smoothstep(0.55, 0.28, edge);
  float core = smoothstep(0.22, 0.05, edge);
  vec3 glow = uCrimson * (0.20 * outer + 0.32 * mid) + uPink * (0.60 * core);
  float alpha = (0.20 * outer + 0.32 * mid + 0.60 * core) * breathe;
  float strand = 0.0;
  float freqs[4];
  freqs[0] = 5.5; freqs[1] = 6.5; freqs[2] = 7.5; freqs[3] = 9.0;
  float widths[4];
  widths[0] = 0.07; widths[1] = 0.05; widths[2] = 0.035; widths[3] = 0.03;
  float phases[4];
  phases[0] = 0.0; phases[1] = 1.3; phases[2] = 2.4; phases[3] = 4.1;
  for (int i = 0; i < 4; i++) {
    float off = 0.55 * sin(6.28318 * freqs[i] * vT + phases[i] + uTime * 0.35);
    float d = abs(vSide - off);
    float line = smoothstep(widths[i], widths[i] * 0.35, d);
    float crawl = fract(vT * 8.0 - uTime * (0.35 + float(i) * 0.08));
    float dash = smoothstep(0.15, 0.28, crawl) * (1.0 - smoothstep(0.62, 0.78, crawl));
    strand = max(strand, line * (0.45 + 0.55 * dash));
  }
  vec3 strandColor = mix(uCrimson, uPale, 0.35);
  vec3 color = glow + strandColor * strand;
  alpha = max(alpha * 0.55, strand * 0.9);
  float eaten = uEaten < 0.0 ? 0.0 : clamp((vT - (uEaten - 0.08)) / 0.16, 0.0, 1.0);
  color = mix(color, uGreen, eaten);
  float fade = uFade;
  if (vT < 0.12) fade *= mix(0.15, 1.0, vT / 0.12);
  else if (vT > 0.85) fade *= mix(1.0, 0.6, (vT - 0.85) / 0.15);
  if (uEaten >= 0.0 && vT > uEaten) {
    float end = uEaten + 0.22;
    fade *= vT >= end ? 0.0 : 1.0 - (vT - uEaten) / 0.22;
  }
  alpha *= fade;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

const pointVert = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
attribute float aKind;
varying vec3 vColor;
varying float vPhase;
varying float vKind;
void main() {
  vColor = aColor;
  vPhase = aPhase;
  vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
}
`;

const pointFrag = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vPhase;
varying float vKind;
uniform float uTime;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  float r = length(p);
  if (r > 0.5) discard;
  float twinkle = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * (2.2 + vPhase) + vPhase * 6.28));
  float alpha = twinkle;
  if (vKind > 1.5) {
    float cycle = fract(uTime * (0.4 + vPhase * 0.3) + vPhase);
    float pop = cycle < 0.4 ? smoothstep(0.0, 0.18, cycle) * (1.0 - smoothstep(0.18, 0.4, cycle)) : 0.0;
    if (pop < 0.04) discard;
    float arm = min(abs(p.x), abs(p.y));
    if (arm > 0.08 && r > 0.22) discard;
    alpha = pop;
  }
  gl_FragColor = vec4(vColor, alpha * smoothstep(0.5, 0.2, r));
}
`;

const ringFrag = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRepeat;
uniform float uTime;
void main() {
  float r = length(vLocal);
  float fw = fwidth(r);
  float band = 1.0 - smoothstep(0.0, fw * 1.5, abs(r - 1.0));
  if (band <= 0.0) discard;
  float turn = atan(vLocal.y, vLocal.x) / 6.2831853 + 0.5;
  float phase = fract(turn * uRepeat - uTime);
  if (phase > 0.375) discard;
  gl_FragColor = vec4(uColor, uAlpha * band);
}
`;

const bandFrag = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uInner;
uniform float uOuter;
void main() {
  float rx = abs(vLocal.x);
  float ry = abs(vLocal.y) / 0.42;
  float r = length(vec2(rx, ry));
  float span = uOuter - uInner;
  float u = (r - uInner) / span;
  float a = smoothstep(0.0, 0.35, u) * (1.0 - smoothstep(0.72, 1.0, u));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, 0.09 * a);
}
`;

interface LineDraw {
  line: PetrovaLine;
  ribbon: THREE.Mesh;
  points: THREE.Points;
  ribbonPos: Float32Array;
  pointPos: Float32Array;
}

interface KnotDraw {
  index: number;
  line: number;
  knot: number;
  points: THREE.Points;
  positions: Float32Array;
  base: { x: number; y: number; r: number; color: number }[];
  ring: THREE.Mesh;
  ringRepeat: THREE.IUniform<number>;
}

interface StarDraw {
  body: Body;
  cells: THREE.Mesh;
  motes: THREE.Points;
}

class AstrophageVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly lines: LineDraw[] = [];
  private readonly knots: KnotDraw[] = [];
  private readonly stars: StarDraw[] = [];
  private readonly diskBack: THREE.Points | null = null;
  private readonly diskFront: THREE.Points | null = null;
  private readonly diskBand: THREE.Mesh | null = null;
  private readonly diskStar: Body | null = null;
  private readonly harvest: THREE.Points;
  private readonly harvestPos: Float32Array;
  private cellTexture: THREE.Texture | null = null;
  private cellGen = 0;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "astrophage";
    const segments = 64;
    for (let i = 0; i < (level.petrova?.length ?? 0); i++) {
      const line = level.petrova![i]!;
      this.lines.push(this.makeLine(line, segments));
      for (let k = 0; k < line.knots.length; k++) this.knots.push(this.makeKnot(i, k));
    }
    for (const body of level.bodies) {
      if (body.astrophage) this.stars.push(this.makeStar(body));
      if (body.look === "tau-ceti" && !this.diskStar) {
        const built = this.makeDisk(body);
        this.diskBack = built.back;
        this.diskFront = built.front;
        this.diskBand = built.band;
        this.diskStar = body;
      }
    }
    const harvestCount = theme.astro.harvestMotes;
    this.harvestPos = new Float32Array(harvestCount * 3);
    const colors = new Float32Array(harvestCount * 3);
    const sizes = new Float32Array(harvestCount);
    const phases = new Float32Array(harvestCount);
    const kinds = new Float32Array(harvestCount);
    const rgb = [srgb01(palette.astroCrimson), srgb01(palette.astroPink), srgb01(palette.astroPale), [1, 1, 1]];
    for (let i = 0; i < harvestCount; i++) {
      const c = rgb[i % rgb.length]!;
      colors[i * 3] = c[0]!;
      colors[i * 3 + 1] = c[1]!;
      colors[i * 3 + 2] = c[2]!;
      sizes[i] = 2.8;
      phases[i] = (i * 0.37) % 1;
      kinds[i] = 0;
    }
    const geometry = pointGeometry(this.harvestPos, colors, sizes, phases, kinds);
    this.harvest = new THREE.Points(geometry, pointMaterial());
    this.harvest.frustumCulled = false;
    this.harvest.renderOrder = 11;
    this.harvest.visible = false;
    this.object.add(this.harvest);
    void this.bakeCells();
  }

  update(frame: VisualFrame): void {
    const seconds = frame.now / 1000;
    const { game } = frame;
    const time = game.mode === "planning" ? 0 : game.ship.t;
    const bodies = game.level.bodies;
    const g = game.level.g;
    const editing = isEditing(game);
    const pose = game.mode === "planning" ? game.initial : game.ship;
    const px = pixelsPerWorld(game, frame.width, frame.height);
    (this.harvest.material as THREE.ShaderMaterial).uniforms.uTime.value = seconds;

    for (const star of this.stars) {
      const at = bodyPose(star.body, time, bodies, g);
      const radius = star.body.radius;
      const span = radius * (this.theme.astro.cellView / this.theme.astro.cellClip);
      star.cells.position.set(at.x, at.y, 0);
      star.cells.scale.set(span, span, 1);
      star.cells.rotation.z = (seconds / this.theme.astro.cellPeriod) * Math.PI * 2;
      star.motes.position.set(at.x, at.y, 0);
      star.motes.rotation.z = -(seconds / this.theme.astro.motePeriod) * Math.PI * 2;
      const moteMat = star.motes.material as THREE.ShaderMaterial;
      moteMat.uniforms.uTime.value = seconds;
      const attr = star.motes.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const base = attr.array as Float32Array;
      if (!star.motes.userData.base) star.motes.userData.base = base.slice();
      const saved = star.motes.userData.base as Float32Array;
      for (let i = 0; i < saved.length; i++) base[i] = saved[i] * px;
      attr.needsUpdate = true;
    }

    const knotState = pose.knots;
    for (const draw of this.lines) {
      const from = bodies.find((body) => body.id === draw.line.from);
      const to = bodies.find((body) => body.id === draw.line.to);
      if (!from || !to) {
        draw.ribbon.visible = false;
        draw.points.visible = false;
        continue;
      }
      const a = bodyPose(from, time, bodies, g);
      const b = bodyPose(to, time, bodies, g);
      const curve = petrovaCurve(a.x, a.y, from.radius, b.x, b.y, to.radius, draw.line.bulge);
      poseRibbon(draw, curve);
      const fade = lineFade(0.5, draw.line.eaten);
      draw.ribbon.visible = fade > 0 || draw.line.eaten === undefined;
      const mat = draw.ribbon.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = seconds;
      mat.uniforms.uEaten.value = draw.line.eaten ?? -1;
      poseLinePoints(draw, curve, a, b, to.radius, seconds, px, draw.line.eaten);
      draw.points.visible = true;
    }

    for (const knot of this.knots) {
      const line = this.lines[knot.line];
      if (!line) continue;
      const from = bodies.find((body) => body.id === line.line.from);
      const to = bodies.find((body) => body.id === line.line.to);
      const spec = line.line.knots[knot.knot];
      if (!from || !to || !spec) continue;
      const a = bodyPose(from, time, bodies, g);
      const b = bodyPose(to, time, bodies, g);
      const curve = petrovaCurve(a.x, a.y, from.radius, b.x, b.y, to.radius, line.line.bulge);
      const at = curvePoint(curve, spec.t);
      const initial = spec.fuel > 0 ? spec.fuel : 1;
      const left = knotState[knot.index] ?? initial;
      const share = Math.max(0, Math.min(1, left / initial));
      const shown = Math.max(0, Math.round(knot.base.length * share));
      for (let i = 0; i < knot.base.length; i++) {
        const mote = knot.base[i]!;
        const o = i * 3;
        knot.positions[o] = i < shown ? at.x + mote.x : 0;
        knot.positions[o + 1] = i < shown ? at.y + mote.y : 0;
        knot.positions[o + 2] = 0;
      }
      knot.points.geometry.setDrawRange(0, shown);
      const knotSizes = knot.points.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const knotArr = knotSizes.array as Float32Array;
      for (let i = 0; i < knot.base.length; i++) knotArr[i] = knot.base[i]!.r * 2 * px;
      knotSizes.needsUpdate = true;
      knot.points.geometry.attributes.position.needsUpdate = true;
      (knot.points.material as THREE.ShaderMaterial).uniforms.uTime.value = seconds;
      knot.points.visible = shown > 0;
      knot.ring.visible = editing;
      knot.ring.position.set(at.x, at.y, 0);
      knot.ring.scale.set(spec.radius, spec.radius, 1);
      const circum = Math.PI * 2 * spec.radius * px;
      knot.ringRepeat.value = Math.max(4, circum / 8);
      (knot.ring.material as THREE.ShaderMaterial).uniforms.uTime.value = seconds;
    }

    if (this.diskStar && this.diskBack && this.diskFront && this.diskBand) {
      const at = bodyPose(this.diskStar, time, bodies, g);
      const scale = this.diskStar.radius / this.theme.astro.diskStar;
      this.diskBack.position.set(at.x, at.y, 0);
      this.diskFront.position.set(at.x, at.y, 0);
      this.diskBand.position.set(at.x, at.y, 0);
      this.diskBack.scale.setScalar(scale);
      this.diskFront.scale.setScalar(scale);
      this.diskBand.scale.set(this.theme.astro.diskOuter * scale, this.theme.astro.diskOuter * scale, 1);
      const size = this.diskBack.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const saved = this.diskBack.userData.base as Float32Array | undefined;
      if (saved) {
        const arr = size.array as Float32Array;
        for (let i = 0; i < saved.length; i++) arr[i] = saved[i] * px * scale;
        size.needsUpdate = true;
      }
      const frontSize = this.diskFront.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const frontSaved = this.diskFront.userData.base as Float32Array | undefined;
      if (frontSaved) {
        const arr = frontSize.array as Float32Array;
        for (let i = 0; i < frontSaved.length; i++) arr[i] = frontSaved[i] * px * scale;
        frontSize.needsUpdate = true;
      }
    }

    this.poseHarvest(game, frame, seconds, px);
  }

  dispose(): void {
    this.cellTexture?.dispose();
    disposeObject(this.object);
  }

  private poseHarvest(game: Game, frame: VisualFrame, seconds: number, px: number): void {
    const pose = game.mode === "planning" ? game.initial : game.ship;
    const harvesting = game.level.fit?.engine === "spin" && game.level.fit.scoop === true && pose.astroRate > 0;
    this.harvest.visible = harvesting && game.mode !== "planning";
    if (!this.harvest.visible) return;
    const bodies = game.level.bodies;
    const g = game.level.g;
    const time = pose.t;
    let target: { x: number; y: number } | null = null;
    const lines = game.level.petrova ?? [];
    let index = 0;
    for (let i = 0; i < lines.length && !target; i++) {
      const line = lines[i]!;
      const from = bodies.find((body) => body.id === line.from);
      const to = bodies.find((body) => body.id === line.to);
      if (!from || !to) {
        index += line.knots.length;
        continue;
      }
      const a = bodyPose(from, time, bodies, g);
      const b = bodyPose(to, time, bodies, g);
      const curve = petrovaCurve(a.x, a.y, from.radius, b.x, b.y, to.radius, line.bulge);
      for (let k = 0; k < line.knots.length; k++) {
        const knot = line.knots[k]!;
        const at = curvePoint(curve, knot.t);
        if (Math.hypot(pose.x - at.x, pose.y - at.y) <= knot.radius) {
          target = at;
          break;
        }
        index += 1;
      }
    }
    if (!target) {
      this.harvest.visible = false;
      return;
    }
    const mouths = scoopMouths(game, frame.width, frame.height);
    const count = this.theme.astro.harvestMotes;
    for (let i = 0; i < count; i++) {
      const trip = this.theme.astro.harvestTripMin + ((i * 0.17) % 1) * (this.theme.astro.harvestTripMax - this.theme.astro.harvestTripMin);
      const u = fract((seconds + i * 0.13) / trip);
      const mouth = mouths[i % 2]!;
      const bend = (i % 2 === 0 ? 18 : -18) * Math.sin(Math.PI * u);
      const mx = (target.x + mouth.x) / 2 + bend;
      const my = (target.y + mouth.y) / 2 - Math.abs(bend);
      const s = 1 - u;
      const o = i * 3;
      this.harvestPos[o] = s * s * target.x + 2 * s * u * mx + u * u * mouth.x;
      this.harvestPos[o + 1] = s * s * target.y + 2 * s * u * my + u * u * mouth.y;
      this.harvestPos[o + 2] = 0;
      const size = this.harvest.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      (size.array as Float32Array)[i] = (1.4 - u) * px;
    }
    this.harvest.geometry.attributes.position.needsUpdate = true;
    this.harvest.geometry.attributes.aSize.needsUpdate = true;
  }

  private makeLine(line: PetrovaLine, segments: number): LineDraw {
    const count = (segments + 1) * 2;
    const ribbonPos = new Float32Array(count * 3);
    const side = new Float32Array(count);
    const ts = new Float32Array(count);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      ts[i * 2] = t;
      ts[i * 2 + 1] = t;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(ribbonPos, 3));
    geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    geometry.setAttribute("aT", new THREE.BufferAttribute(ts, 1));
    const ribbon = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uEaten: { value: line.eaten ?? -1 },
          uFade: { value: 1 },
          uCrimson: { value: srgbVec(palette.astroCrimson) },
          uPink: { value: srgbVec(palette.astroPink) },
          uPale: { value: srgbVec(palette.astroPale) },
          uGreen: { value: srgbVec(palette.astroTaumoeba) },
        },
        vertexShader: ribbonVert,
        fragmentShader: ribbonFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 8;
    ribbon.name = `petrova-${line.from}-${line.to}`;
    const n = this.theme.astro.ribbonMotes + this.theme.astro.glints + this.theme.astro.sparkles + this.theme.astro.breeding;
    const pointPos = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const phases = new Float32Array(n);
    const kinds = new Float32Array(n);
    const points = new THREE.Points(pointGeometry(pointPos, colors, sizes, phases, kinds), pointMaterial());
    points.frustumCulled = false;
    points.renderOrder = 9;
    this.object.add(ribbon, points);
    return { line, ribbon, points, ribbonPos, pointPos };
  }

  private makeKnot(line: number, knot: number): KnotDraw {
    const spec = this.lines[line]!.line.knots[knot]!;
    const rng = mulberry32(hashSeed(`${line}:${knot}:${spec.t}`));
    const count = this.theme.astro.knotMotes;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const kinds = new Float32Array(count);
    const base: KnotDraw["base"] = [];
    const paletteColors = [palette.astroCrimson, palette.astroCrimson, palette.astroPale, palette.astroPink];
    for (let i = 0; i < count; i++) {
      const along = gauss(rng) * this.theme.astro.knotSpreadAlong;
      const across = gauss(rng) * this.theme.astro.knotSpreadAcross;
      const color = paletteColors[i % paletteColors.length]!;
      const rgb = srgb01(color);
      base.push({ x: along, y: across, r: 0.6 + rng() * 0.9, color: i });
      colors[i * 3] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
      sizes[i] = (0.6 + rng() * 0.9) * 2;
      phases[i] = rng();
      kinds[i] = 0;
    }
    const points = new THREE.Points(pointGeometry(positions, colors, sizes, phases, kinds), pointMaterial());
    points.frustumCulled = false;
    points.renderOrder = 10;
    const ringRepeat = { value: 12 };
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(ringFrag, {
        uColor: { value: srgbVec(palette.astroCrimson) },
        uAlpha: { value: 0.7 },
        uRepeat: ringRepeat,
        uTime: { value: 0 },
      }),
    );
    ring.frustumCulled = false;
    ring.renderOrder = 10;
    this.object.add(points, ring);
    let index = knot;
    for (let i = 0; i < line; i++) index += this.lines[i]!.line.knots.length;
    return { index, line, knot, points, positions, base, ring, ringRepeat };
  }

  private makeStar(body: Body): StarDraw {
    const cells = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: this.theme.astro.cellAlpha,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        color: "#ffffff",
      }),
    );
    cells.frustumCulled = false;
    cells.renderOrder = 7;
    cells.name = `${body.id}-cells`;
    const count = this.theme.astro.moteCount;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const kinds = new Float32Array(count);
    const rng = mulberry32(hashSeed(body.id + ":motes"));
    const radius = body.radius + this.theme.astro.moteRadius;
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const r = radius + gauss(rng) * this.theme.astro.moteSpread;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.sin(angle) * r;
      const pale = i % 3 === 2;
      const rgb = srgb01(pale ? palette.astroPale : palette.astroCrimson);
      colors[i * 3] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
      sizes[i] = (this.theme.astro.moteMin + rng() * (this.theme.astro.moteMax - this.theme.astro.moteMin)) * 2;
      phases[i] = rng();
    }
    const motes = new THREE.Points(pointGeometry(positions, colors, sizes, phases, kinds), pointMaterial());
    motes.frustumCulled = false;
    motes.renderOrder = 7;
    motes.userData.base = sizes.slice();
    this.object.add(cells, motes);
    return { body, cells, motes };
  }

  private makeDisk(body: Body): { back: THREE.Points; front: THREE.Points; band: THREE.Mesh } {
    const specks = tauDisk(this.theme.astro.diskSeed);
    const back = specks.filter((speck) => speck.back);
    const front = specks.filter((speck) => !speck.back);
    const backPoints = speckPoints(back);
    const frontPoints = speckPoints(front);
    backPoints.renderOrder = -2;
    frontPoints.renderOrder = 12;
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(bandFrag, {
        uColor: { value: srgbVec("#9AA6D6") },
        uInner: { value: this.theme.astro.diskInner / this.theme.astro.diskOuter },
        uOuter: { value: 1 },
      }),
    );
    band.frustumCulled = false;
    band.renderOrder = -2;
    band.name = `${body.id}-disk`;
    this.object.add(backPoints, band, frontPoints);
    return { back: backPoints, front: frontPoints, band };
  }

  private async bakeCells(): Promise<void> {
    const gen = ++this.cellGen;
    try {
      const canvas = await rasterMarkup(CELL_SVG, 256, 256);
      if (gen !== this.cellGen) return;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      this.cellTexture = texture;
      for (const star of this.stars) {
        const mat = star.cells.material as THREE.MeshBasicMaterial;
        mat.map = texture;
        mat.needsUpdate = true;
      }
    } catch {
      this.cellGen = 0;
    }
  }
}

function poseRibbon(draw: LineDraw, curve: Curve): void {
  const segments = draw.ribbonPos.length / 6 - 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curvePoint(curve, t);
    const tangent = curveTangent(curve, t);
    const width = lineWidth(t) * 2.2;
    const nx = -tangent.y * width;
    const ny = tangent.x * width;
    const o = i * 6;
    draw.ribbonPos[o] = p.x - nx;
    draw.ribbonPos[o + 1] = p.y - ny;
    draw.ribbonPos[o + 3] = p.x + nx;
    draw.ribbonPos[o + 4] = p.y + ny;
  }
  draw.ribbon.geometry.attributes.position.needsUpdate = true;
}

function poseLinePoints(
  draw: LineDraw,
  curve: Curve,
  star: { x: number; y: number },
  planet: { x: number; y: number },
  planetR: number,
  seconds: number,
  px: number,
  eaten?: number,
): void {
  const astro = draw.points.userData as { ready?: boolean };
  const geometry = draw.points.geometry;
  const colors = geometry.getAttribute("aColor") as THREE.BufferAttribute;
  const sizes = geometry.getAttribute("aSize") as THREE.BufferAttribute;
  const phases = geometry.getAttribute("aPhase") as THREE.BufferAttribute;
  const kinds = geometry.getAttribute("aKind") as THREE.BufferAttribute;
  const themeCounts = {
    motes: 140,
    glints: 22,
    sparkles: 52,
    breeding: 110,
  };
  if (!astro.ready) {
    const rng = mulberry32(hashSeed(draw.line.from + draw.line.to));
    const total = themeCounts.motes + themeCounts.glints + themeCounts.sparkles + themeCounts.breeding;
    const lanes = new Float32Array(total);
    const seeds = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      lanes[i] = gauss(rng);
      seeds[i] = rng();
      (phases.array as Float32Array)[i] = rng();
    }
    draw.points.userData.lanes = lanes;
    draw.points.userData.seeds = seeds;
    draw.points.userData.ready = true;
  }
  const lanes = draw.points.userData.lanes as Float32Array;
  const seeds = draw.points.userData.seeds as Float32Array;
  let cursor = 0;
  const place = (t: number, across: number, kind: number, color: string, size: number) => {
    const p = curvePoint(curve, t);
    const tangent = curveTangent(curve, t);
    const w = lineWidth(t);
    const o = cursor * 3;
    draw.pointPos[o] = p.x + -tangent.y * across * w;
    draw.pointPos[o + 1] = p.y + tangent.x * across * w;
    const rgb = srgb01(color);
    const c = colors.array as Float32Array;
    c[o] = rgb[0];
    c[o + 1] = rgb[1];
    c[o + 2] = rgb[2];
    (sizes.array as Float32Array)[cursor] = size * px;
    (kinds.array as Float32Array)[cursor] = kind;
    cursor += 1;
  };
  for (let i = 0; i < themeCounts.motes; i++) {
    const t = seeds[i] ?? 0;
    const mix = eatenMix(t, eaten);
    place(t, (lanes[i] ?? 0) * 0.75, 0, mix > 0.5 ? palette.astroTaumoeba : i % 3 === 0 ? palette.astroPale : palette.astroCrimson, 0.35 + (seeds[i] ?? 0) * 0.6);
  }
  for (let i = 0; i < themeCounts.glints; i++) {
    const n = themeCounts.motes + i;
    const period = 3.5 + (seeds[n] ?? 0) * 4;
    const t = fract(seconds / period + (seeds[n] ?? 0));
    if (lineFade(t, eaten) <= 0) {
      place(0, 0, 0, palette.astroSpark, 0);
      continue;
    }
    place(t, ((lanes[n] ?? 0) - 0.5) * 0.4, 1, palette.astroSpark, 2.1);
  }
  for (let i = 0; i < themeCounts.sparkles; i++) {
    const n = themeCounts.motes + themeCounts.glints + i;
    const t = seeds[n] ?? 0;
    place(t, (lanes[n] ?? 0) * 0.8, 2, eatenMix(t, eaten) > 0.5 ? palette.astroTaumoebaPale : palette.astroSpark, 3.2);
  }
  for (let i = 0; i < themeCounts.breeding; i++) {
    const n = themeCounts.motes + themeCounts.glints + themeCounts.sparkles + i;
    const angle = (seeds[n] ?? 0) * Math.PI * 2;
    const r = planetR + 5 + Math.abs((lanes[n] ?? 0) * 4);
    const o = cursor * 3;
    draw.pointPos[o] = planet.x + Math.cos(angle) * r;
    draw.pointPos[o + 1] = planet.y + Math.sin(angle) * r;
    const green = eaten !== undefined;
    const rgb = srgb01(green ? (i % 2 === 0 ? palette.astroTaumoeba : palette.astroTaumoebaPale) : palette.astroCrimson);
    const c = colors.array as Float32Array;
    c[o] = rgb[0];
    c[o + 1] = rgb[1];
    c[o + 2] = rgb[2];
    (sizes.array as Float32Array)[cursor] = (0.4 + (seeds[n] ?? 0) * 0.5) * px;
    (kinds.array as Float32Array)[cursor] = 0;
    cursor += 1;
  }
  void star;
  geometry.attributes.position.needsUpdate = true;
  colors.needsUpdate = true;
  sizes.needsUpdate = true;
  kinds.needsUpdate = true;
  (draw.points.material as THREE.ShaderMaterial).uniforms.uTime.value = seconds;
}

function speckPoints(specks: { x: number; y: number; r: number; color: string; alpha: number }[]): THREE.Points {
  const positions = new Float32Array(specks.length * 3);
  const colors = new Float32Array(specks.length * 3);
  const sizes = new Float32Array(specks.length);
  const phases = new Float32Array(specks.length);
  const kinds = new Float32Array(specks.length);
  for (let i = 0; i < specks.length; i++) {
    const speck = specks[i]!;
    positions[i * 3] = speck.x;
    positions[i * 3 + 1] = speck.y;
    const rgb = srgb01(speck.color);
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
    sizes[i] = speck.r * 2;
    phases[i] = speck.alpha;
  }
  const points = new THREE.Points(pointGeometry(positions, colors, sizes, phases, kinds), pointMaterial());
  points.frustumCulled = false;
  points.userData.base = sizes.slice();
  return points;
}

function pointGeometry(
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  phases: Float32Array,
  kinds: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
  return geometry;
}

function pointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function pixelsPerWorld(game: Game, width: number, height: number): number {
  const origin = worldToScreen(game.camera, width, height, 0, 0);
  const unit = worldToScreen(game.camera, width, height, 1, 0);
  return Math.max(0.01, Math.hypot(unit.x - origin.x, unit.y - origin.y));
}

function scoopMouths(game: Game, width: number, height: number): { x: number; y: number }[] {
  const pose = game.mode === "planning" ? game.initial : game.ship;
  const screen = worldToScreen(game.camera, width, height, pose.x, pose.y);
  const angle = Math.atan2(pose.vy, pose.vx) - Math.PI / 2;
  const spec = 22;
  const zoom = game.camera.zoom;
  const k = Math.max(12, spec * zoom) / 48.6;
  return [7.5, -7.5].map((x) => {
    const lx = x * k;
    const ly = -13.5 * k;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const sx = screen.x + lx * c - ly * s;
    const sy = screen.y - (lx * s + ly * c);
    return screenToWorld(game.camera, width, height, sx, sy);
  });
}

function fract(value: number): number {
  return value - Math.floor(value);
}
