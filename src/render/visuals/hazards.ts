import * as THREE from "three";
import { jetAngle, shellRadius, type QuasarJet, type Supernova } from "../../sim/events";
import { bodyPose, type Body } from "../../sim/physics";
import { isEditing } from "../../game/state";
import { artForBody, artMesh, loadArtTexture, poseArt, rasterPixels, type ArtFit } from "../art-sprite";
import {
  blastCall,
  blastChip,
  countdownFraction,
  jetHalfWidth,
  jetLeaveDelay,
  makeFilaments,
  novaFlash,
  oldShellRadius,
  pointInSweep,
  progenitorScale,
  progenitorShrink,
  safeChip,
  shockChip,
  spareChip,
  supernovaChip,
  sweepChip,
  type FilamentSpec,
} from "../hazard-look";
import { formatClock, hashId } from "../event-look";
import { silenceNightRim } from "../surface-art";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Supernova, quasar and their planning telegraphs.
 * design/style.md §16 and threejs-notes.md §19.
 * Every hazard frame is a function of sim time (`shownTime`), except shell
 * drift, dash crawl and jet knots, which are cosmetic.
 */
export const createHazards: VisualFactory = (theme, level) => new HazardsVisual(theme, level);

const TAU = Math.PI * 2;

const ringFrag = /* glsl */ `
varying vec2 vLocal;
uniform float uOuter;
uniform float uRadius;
uniform float uHalf;
uniform float uZoom;
uniform float uDash;
uniform float uGap;
uniform float uOffset;
uniform float uStart;
uniform float uSpan;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float world = length(vLocal) * uOuter;
  float fw = max(fwidth(world), 1e-4);
  float band = 1.0 - smoothstep(uHalf - fw, uHalf + fw, abs(world - uRadius));
  if (uSpan >= 0.0) {
    float ang = atan(vLocal.y, vLocal.x);
    float from = mod(uStart - ang + 6.28318530718, 6.28318530718);
    float fwA = max(fwidth(from), 0.01);
    float cap = uRadius > 1.0 ? uHalf / uRadius : 0.0;
    band *= 1.0 - smoothstep(uSpan + cap, uSpan + cap + fwA, from);
  }
  float on = 1.0;
  if (uDash > 0.0) {
    float along = atan(vLocal.y, vLocal.x) * uRadius * uZoom;
    float period = uDash + uGap;
    float x = mod(along - uOffset + period * 8.0, period);
    float aa = max(fwidth(along), 0.5);
    on = 1.0 - smoothstep(uDash - aa, uDash + aa, x);
  }
  float a = band * on * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const flashFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uWhite;
uniform vec3 uMid;
uniform vec3 uCool;
uniform vec3 uEdge;
uniform float uAlpha;
void main() {
  float t = length(vLocal);
  if (t > 1.0) discard;
  vec3 c = uWhite;
  float a = 1.0;
  if (t < 0.25) {
    float u = t / 0.25;
    c = mix(uWhite, uMid, u);
    a = mix(1.0, 0.95, u);
  } else if (t < 0.6) {
    float u = (t - 0.25) / 0.35;
    c = mix(uMid, uCool, u);
    a = mix(0.95, 0.35, u);
  } else {
    float u = (t - 0.6) / 0.4;
    c = mix(uCool, uEdge, u);
    a = mix(0.35, 0.0, u);
  }
  a *= uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * a, a);
}
`;

const hazeFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uAlpha;
void main() {
  float t = length(vLocal);
  if (t > 1.0) discard;
  vec3 c = t < 0.6 ? mix(uInner, uOuter, t / 0.6) : uOuter;
  float a = t < 0.6 ? mix(0.35, 0.12, t / 0.6) : mix(0.12, 0.0, (t - 0.6) / 0.4);
  a *= uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(c, a);
}
`;

const filamentVert = /* glsl */ `
attribute vec3 aColor;
attribute float aRest;
varying vec2 vLocal;
varying vec3 vColor;
varying float vRest;
void main() {
  vLocal = position.xy * 2.0;
  vColor = aColor;
  vRest = aRest;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const filamentFrag = /* glsl */ `
varying vec2 vLocal;
varying vec3 vColor;
varying float vRest;
uniform float uFade;
void main() {
  float x = abs(vLocal.x);
  float y = abs(vLocal.y);
  float cap = length(vec2(max(x - 0.72, 0.0), y));
  float d = x > 0.72 ? cap : y;
  float fw = max(fwidth(d), 0.02);
  float a = (1.0 - smoothstep(0.5, 0.5 + fw, d)) * mix(1.0, vRest, uFade);
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

const jetFrag = /* glsl */ `
varying vec2 vLocal;
uniform float uStart;
uniform float uReach;
uniform float uTan;
uniform float uHalfMax;
uniform float uCore;
uniform float uBody;
uniform float uCoreReach;
uniform float uZoom;
uniform float uNow;
uniform float uPeriod;
uniform vec3 uWhite;
uniform vec3 uIce;
uniform vec3 uBlue;
uniform vec3 uViolet;
uniform vec3 uTail;
void main() {
  float along = vLocal.x * 0.5 + 0.5;
  float d = mix(uStart, uReach, along);
  float coneHalf = max(d * uTan, 1e-3);
  float lateral = vLocal.y * uHalfMax;
  float n = abs(lateral) / coneHalf;
  float fw = max(fwidth(n), 0.01);
  float sheath = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, n);
  if (sheath < 0.02) discard;
  vec3 alongC = uWhite;
  float alongA = 1.0;
  if (along < 0.15) {
    float u = along / 0.15;
    alongC = mix(uWhite, uIce, u);
    alongA = mix(1.0, 0.95, u);
  } else if (along < 0.5) {
    float u = (along - 0.15) / 0.35;
    alongC = mix(uIce, uBlue, u);
    alongA = mix(0.95, 0.85, u);
  } else if (along < 0.8) {
    float u = (along - 0.5) / 0.3;
    alongC = mix(uBlue, uViolet, u);
    alongA = mix(0.85, 0.5, u);
  } else {
    float u = (along - 0.8) / 0.2;
    alongC = mix(uViolet, uTail, u);
    alongA = mix(0.5, 0.0, u);
  }
  vec3 c = mix(alongC, uViolet, smoothstep(uBody, 1.0, n));
  float a = alongA * sheath;
  if (n < uBody) {
    c = mix(uBlue, alongC, 0.45);
    a = max(a, 0.85 * sheath);
  }
  float coreHalf = (uCore * 0.5) / max(uZoom, 0.05);
  if (d < uReach * uCoreReach && abs(lateral) < coreHalf) {
    c = uWhite;
    a = max(a, 0.75);
  }
  float phaseBase = uPeriod > 0.0 ? uNow / uPeriod : 0.0;
  float knotRx = 6.0 / max(uZoom, 0.05);
  float knotRy = 2.6 / max(uZoom, 0.05);
  for (int i = 0; i < 3; i++) {
    float phase = fract(phaseBase + float(i) / 3.0);
    float kd = mix(uStart, uReach, phase);
    vec2 q = vec2((d - kd) / knotRx, lateral / knotRy);
    float blob = exp(-dot(q, q) * 1.6) * (1.0 - phase) * 0.85;
    c = mix(c, uWhite, blob);
    a = max(a, blob);
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(c, a);
}
`;

const lineFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uDash;
uniform float uGap;
uniform float uOffset;
uniform float uLength;
uniform float uZoom;
void main() {
  float y = abs(vLocal.y);
  float fw = max(fwidth(y), 0.02);
  float band = 1.0 - smoothstep(0.5 - fw, 0.5 + fw, y);
  float on = 1.0;
  if (uDash > 0.0) {
    float along = (vLocal.x + 0.5) * uLength * uZoom;
    float period = uDash + uGap;
    float x = mod(along - uOffset + period * 8.0, period);
    float aa = max(fwidth(along), 0.5);
    on = 1.0 - smoothstep(uDash - aa, uDash + aa, x);
  }
  float a = band * on * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const lineVert = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const beamFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float along = abs(vLocal.y);
  float across = abs(vLocal.x);
  float edge = mix(1.0, 0.28, along);
  float fw = max(fwidth(across), 0.02);
  float a = (1.0 - smoothstep(edge, edge + fw, across)) * (1.0 - smoothstep(0.9, 1.0, along)) * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const dotFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uWhite;
uniform vec3 uMid;
uniform vec3 uEdge;
void main() {
  float t = length(vLocal);
  if (t > 1.0) discard;
  vec3 c = t < 0.4 ? mix(uWhite, uMid, t / 0.4) : mix(uMid, uEdge, (t - 0.4) / 0.6);
  float a = t < 0.4 ? 1.0 : mix(1.0, 0.0, (t - 0.4) / 0.6);
  if (a < 0.02) discard;
  gl_FragColor = vec4(c, a);
}
`;

interface RingMesh {
  mesh: THREE.Mesh;
  outer: { value: number };
  radius: { value: number };
  half: { value: number };
  zoom: { value: number };
  dash: { value: number };
  gap: { value: number };
  offset: { value: number };
  start: { value: number };
  span: { value: number };
  alpha: { value: number };
}

interface LineMesh {
  mesh: THREE.Mesh;
  length: { value: number };
  zoom: { value: number };
  offset: { value: number };
  alpha: { value: number };
}

interface NovaView {
  body: Body;
  nova: Supernova;
  star: THREE.Mesh;
  fit: ArtFit;
  shells: RingMesh[];
  flash: THREE.Mesh;
  flashAlpha: { value: number };
  haze: THREE.Mesh;
  shock: RingMesh;
  blast: RingMesh;
  track: RingMesh;
  arc: RingMesh;
  forecast: RingMesh[];
  det: THREE.InstancedMesh;
  rem: THREE.InstancedMesh;
  detFade: { value: number };
  remFade: { value: number };
  detSpec: FilamentSpec[];
  remSpec: FilamentSpec[];
  beams: THREE.Mesh;
  core: THREE.Mesh;
  hit: RingMesh;
}

interface QuasarView {
  body: Body;
  jet: QuasarJet;
  glow: THREE.Mesh;
  glowFit: ArtFit;
  core: THREE.Mesh;
  coreFit: ArtFit;
  jets: THREE.Mesh[];
  jetTan: { value: number }[];
  jetHalf: { value: number }[];
  jetZoom: { value: number }[];
  jetNow: { value: number }[];
  edges: LineMesh[];
  arcs: RingMesh[];
}

class HazardsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly bodies: readonly Body[];
  private readonly g: number;
  private readonly novas: NovaView[] = [];
  private readonly quasars: QuasarView[] = [];
  private readonly chips: Chip[] = [];
  private readonly dummy = new THREE.Object3D();
  private bakeGen = 0;

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "hazards";
    this.bodies = level.bodies;
    this.g = level.g;
    for (const body of level.bodies) {
      if (body.supernova) this.novas.push(this.buildNova(body, body.supernova));
      if (body.quasar) this.quasars.push(this.buildQuasar(body, body.quasar));
    }
    for (let i = 0; i < 16; i += 1) {
      const chip = new Chip(24);
      this.chips.push(chip);
      this.object.add(chip.mesh);
    }
    this.bakeOnce();
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const time = shownTime(game);
    const seconds = frame.now / 1000;
    const zoom = Math.max(0.05, game.camera.zoom);
    const editing = isEditing(game);
    let chip = 0;
    for (const view of this.novas) chip = this.updateNova(view, frame, time, seconds, zoom, editing, chip);
    for (const view of this.quasars) chip = this.updateQuasar(view, game, time, seconds, zoom, frame.dpr, editing, chip);
    for (let i = chip; i < this.chips.length; i += 1) this.chips[i].hide();
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private updateNova(
    view: NovaView,
    frame: VisualFrame,
    time: number,
    seconds: number,
    zoom: number,
    editing: boolean,
    chip: number,
  ): number {
    const { body, nova } = view;
    const spec = this.theme.nova;
    const pose = bodyPose(body, time, this.bodies, this.g);
    const before = time < nova.at;
    const age = time - nova.at;
    const breathe = progenitorScale(seconds, spec.breathePeriod);
    const shrink = progenitorShrink(time, nova.at, spec.shrinkLead, spec.shrinkTo);
    view.star.visible = shrink > 0.001;
    if (view.star.visible) {
      poseArt(view.star, view.fit, pose.x, pose.y, body.radius * breathe * shrink, 0);
    }
    for (let i = 0; i < view.shells.length; i += 1) {
      const radius = oldShellRadius(body.radius, spec.shellRadii[i], seconds, spec);
      placeRing(view.shells[i], pose.x, pose.y, radius, spec.shellWidth, zoom, before);
    }
    const flash = novaFlash(age, nova.blast, spec);
    view.flash.visible = flash.alpha > 0.01 && flash.radius > 1;
    view.flashAlpha.value = flash.alpha;
    if (view.flash.visible) {
      view.flash.position.set(pose.x, pose.y, 0);
      view.flash.scale.set(flash.radius, flash.radius, 1);
    }
    const shockR = shellRadius(nova, time);
    const remnant = age >= spec.flashEnd;
    placeRing(view.shock, pose.x, pose.y, shockR, remnant ? spec.shockWidthRem : spec.shockWidthDet, zoom, shockR > 1);
    view.haze.visible = shockR > 1;
    if (view.haze.visible) {
      const haze = shockR * spec.hazeScale;
      view.haze.position.set(pose.x, pose.y, 0);
      view.haze.scale.set(haze, haze, 1);
    }
    const showDet = shockR > 1 && !remnant;
    const showRem = shockR > 1 && remnant;
    this.poseFilaments(view.det, view.detSpec, pose.x, pose.y, shockR, zoom, showDet);
    this.poseFilaments(view.rem, view.remSpec, pose.x, pose.y, shockR, zoom, showRem);
    const faded = Math.max(0, Math.min(1, age / Math.max(spec.filamentFade, 1e-3)));
    view.detFade.value = faded;
    view.remFade.value = faded;
    const pulsar = time >= nova.at;
    view.core.visible = pulsar;
    view.beams.visible = pulsar;
    if (pulsar) {
      view.core.position.set(pose.x, pose.y, 0);
      view.core.scale.set(spec.pulsarR, spec.pulsarR, 1);
      view.beams.position.set(pose.x, pose.y, 0);
      const spin = spec.pulsarPeriod > 0 ? ((seconds % spec.pulsarPeriod) / spec.pulsarPeriod) * TAU : 0;
      view.beams.rotation.z = spin;
      view.beams.scale.set(5, spec.pulsarBeam, 1);
    }
    const arcR = spec.sampleStar > 0 ? body.radius * (spec.arcSample / spec.sampleStar) : body.radius * 1.4;
    placeRing(view.blast, pose.x, pose.y, nova.blast, spec.blastWidth, zoom, editing && before);
    view.blast.dash.value = spec.blastDash;
    view.blast.gap.value = spec.blastGap;
    view.blast.offset.value = -seconds * spec.blastCrawl;
    view.blast.alpha.value = spec.blastAlpha;
    placeRing(view.track, pose.x, pose.y, arcR, spec.arcWidth, zoom, editing && before);
    const fraction = countdownFraction(time, nova.at);
    view.arc.start.value = Math.PI / 2;
    view.arc.span.value = fraction * TAU;
    placeRing(view.arc, pose.x, pose.y, arcR, spec.arcWidth, zoom, editing && before && fraction > 0.001);
    const forecastR = [shellRadius(nova, time + spec.forecastA), shellRadius(nova, time + spec.forecastB)];
    const forecastA = [spec.forecastAlphaA, spec.forecastAlphaB];
    for (let i = 0; i < view.forecast.length; i += 1) {
      placeRing(view.forecast[i], pose.x, pose.y, forecastR[i], spec.forecastWidth, zoom, editing && !before && forecastR[i] > 1);
      view.forecast[i].alpha.value = forecastA[i];
    }
    if (!editing) {
      view.hit.mesh.visible = false;
      return chip;
    }
    const rows: { text: string; color: string }[] = [];
    if (before) {
      rows.push({ text: supernovaChip(nova.at - time), color: this.theme.colors.eventWarn });
      rows.push({ text: blastChip(nova.blast), color: this.theme.colors.novaBlast });
      const call = blastCall(frame.game.prediction.path, pose.x, pose.y, nova.blast, nova.at, frame.game.level.dt);
      view.hit.mesh.visible = call?.kind === "hit";
      if (call?.kind === "hit") {
        placeRing(view.hit, call.x, call.y, Math.max(8 / zoom, 10), 1.2, zoom, true);
        const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.cos((TAU * seconds) / 0.8));
        view.hit.alpha.value = pulse;
        rows.push({ text: `collision ${formatClock(call.time)}`, color: this.theme.colors.novaBlast });
      } else if (call?.kind === "clear") {
        chip = this.stack(chip, call.x, call.y, zoom, frame.dpr, [
          { text: spareChip(call.leave, call.spare), color: this.theme.colors.eventNext },
        ]);
      }
    } else {
      view.hit.mesh.visible = false;
      rows.push({ text: shockChip(spec.forecastA), color: this.theme.colors.eventWarn });
      rows.push({ text: shockChip(spec.forecastB), color: this.theme.colors.eventWarn });
    }
    return this.stack(chip, pose.x + arcR, pose.y + arcR, zoom, frame.dpr, rows);
  }

  private updateQuasar(
    view: QuasarView,
    game: VisualFrame["game"],
    time: number,
    seconds: number,
    zoom: number,
    dpr: number,
    editing: boolean,
    chip: number,
  ): number {
    const { body, jet } = view;
    const spec = this.theme.quasar;
    const pose = bodyPose(body, time, this.bodies, this.g);
    const shadow = body.radius;
    const angle = jetAngle(jet, time);
    const rx = shadow * spec.diskRx;
    const ry = shadow * spec.diskRy;
    poseArt(view.glow, view.glowFit, pose.x, pose.y, shadow, 0);
    poseArt(view.core, view.coreFit, pose.x, pose.y, shadow, 0);
    const start = shadow * spec.jetStart;
    const reach = jet.reach;
    const length = Math.max(1, reach - start);
    const halfMax = Math.max(1, jetHalfWidth(reach, jet.cone));
    for (let side = 0; side < 2; side += 1) {
      const mesh = view.jets[side];
      const dir = angle + (side === 0 ? 0 : Math.PI);
      const mid = start + length / 2;
      mesh.position.set(pose.x + Math.cos(dir) * mid, pose.y + Math.sin(dir) * mid, 0);
      mesh.rotation.z = dir;
      mesh.scale.set(length / 2, halfMax, 1);
      view.jetTan[side].value = Math.tan(jet.cone);
      view.jetHalf[side].value = halfMax;
      view.jetZoom[side].value = zoom;
      view.jetNow[side].value = seconds;
    }
    const swung = (jet.period ?? 0) > 0 && (jet.sweep ?? 0) !== 0;
    const half = swung ? (jet.sweep ?? 0) + jet.cone : jet.cone;
    const bases = [jet.angle, jet.angle + Math.PI];
    for (let i = 0; i < 4; i += 1) {
      const base = bases[i >> 1];
      const dir = base + (i % 2 === 0 ? half : -half);
      const x0 = pose.x + Math.cos(dir) * shadow;
      const y0 = pose.y + Math.sin(dir) * shadow;
      const x1 = pose.x + Math.cos(dir) * reach;
      const y1 = pose.y + Math.sin(dir) * reach;
      placeLine(view.edges[i], x0, y0, x1, y1, spec.sweepWidth, zoom, editing);
      view.edges[i].offset.value = -seconds * 10;
    }
    for (let i = 0; i < 2; i += 1) {
      const show = editing && swung;
      view.arcs[i].start.value = bases[i] + half;
      view.arcs[i].span.value = half * 2;
      placeRing(view.arcs[i], pose.x, pose.y, reach, spec.sweepWidth, zoom, show);
    }
    if (!editing) return chip;
    const rows: { text: string; color: string }[] = [
      { text: "jet: lethal along its length", color: this.theme.colors.novaBlast },
    ];
    if (swung && jet.period) {
      rows.push({ text: sweepChip(jet.sweep ?? 0, jet.period), color: this.theme.colors.eventWarn });
      const delay = safeDelay(game, pose.x, pose.y, jet, time);
      if (delay !== null && Number.isFinite(delay)) {
        rows.push({ text: safeChip(delay), color: this.theme.colors.eventNext });
      }
    }
    return this.stack(chip, pose.x + rx, pose.y - ry, zoom, dpr, rows);
  }

  private poseFilaments(
    mesh: THREE.InstancedMesh,
    specs: readonly FilamentSpec[],
    x: number,
    y: number,
    radius: number,
    zoom: number,
    visible: boolean,
  ): void {
    mesh.visible = visible && radius > 1;
    if (!mesh.visible) return;
    for (let i = 0; i < specs.length; i += 1) {
      const fil = specs[i];
      const r = radius * (1 + fil.jitter);
      const len = Math.max(0.4, fil.lengthPx / zoom);
      const wid = Math.max(0.2, fil.widthPx / zoom);
      this.dummy.position.set(x + Math.cos(fil.angle) * r, y + Math.sin(fil.angle) * r, 0);
      this.dummy.scale.set(len, wid, 1);
      this.dummy.rotation.z = fil.angle;
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private stack(
    index: number,
    x: number,
    y: number,
    zoom: number,
    dpr: number,
    rows: readonly { text: string; color: string }[],
  ): number {
    const spec = this.theme.event;
    let cursor = y;
    for (let i = 0; i < rows.length && index < this.chips.length; i += 1) {
      const row = rows[i];
      this.chips[index].show(row.text, row.color, this.theme.colors.eventPanel, x, cursor, zoom, Math.max(1, dpr), spec);
      cursor -= (spec.chipHeight + 4) / zoom;
      index += 1;
    }
    return index;
  }

  private buildNova(body: Body, nova: Supernova): NovaView {
    const colors = this.theme.colors;
    const spec = this.theme.nova;
    const fit = artForBody({ ...body, look: "red-giant" }, this.theme);
    if (!fit) throw new Error("red giant art missing");
    fit.bake = { tag: "nova-progenitor", prep: prepProgenitor };
    const star = artMesh(fit, `${body.id}-progenitor`);
    star.renderOrder = 1;
    this.object.add(star);
    const shells = spec.shellRadii.map((radius, i) => {
      const ring = makeRing(colors.novaShell, 0, spec.shellAlphas[i]);
      ring.span.value = -1;
      this.object.add(ring.mesh);
      ring.mesh.name = `${body.id}-shell-${radius}`;
      return ring;
    });
    const flashAlpha = { value: 0 };
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(flashFrag, {
        uWhite: { value: srgbVec(colors.novaFlash) },
        uMid: { value: srgbVec(colors.novaFlashMid) },
        uCool: { value: srgbVec(colors.novaFlashCool) },
        uEdge: { value: srgbVec(colors.novaFlashEdge) },
        uAlpha: flashAlpha,
      }),
    );
    (flash.material as THREE.ShaderMaterial).blending = THREE.AdditiveBlending;
    flash.frustumCulled = false;
    flash.renderOrder = 8;
    flash.name = `${body.id}-flash`;
    this.object.add(flash);
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(hazeFrag, {
        uInner: { value: srgbVec(colors.novaHaze) },
        uOuter: { value: srgbVec(colors.novaHazeEdge) },
        uAlpha: { value: 1 },
      }),
    );
    haze.frustumCulled = false;
    haze.renderOrder = 3;
    haze.name = `${body.id}-haze`;
    this.object.add(haze);
    const shock = makeRing(colors.novaShock, 5, 0.95);
    shock.span.value = -1;
    shock.mesh.name = `${body.id}-shock`;
    this.object.add(shock.mesh);
    const blast = makeRing(colors.novaBlast, 6, spec.blastAlpha);
    blast.span.value = -1;
    blast.mesh.name = `${body.id}-blast`;
    this.object.add(blast.mesh);
    const track = makeRing("#FFFFFF", 6, spec.arcTrack);
    track.span.value = -1;
    track.mesh.name = `${body.id}-countdown-track`;
    this.object.add(track.mesh);
    const arc = makeRing(colors.eventWarn, 7, 1);
    arc.mesh.name = `${body.id}-countdown`;
    this.object.add(arc.mesh);
    const forecast = [spec.forecastAlphaA, spec.forecastAlphaB].map((alpha, i) => {
      const ring = makeRing(colors.eventWarn, 6, alpha);
      ring.span.value = -1;
      ring.dash.value = spec.forecastDash;
      ring.gap.value = spec.forecastGap;
      ring.mesh.name = `${body.id}-forecast-${i}`;
      this.object.add(ring.mesh);
      return ring;
    });
    const seed = hashId(body.id);
    const detSpec = makeFilaments(seed, spec.filamentDet, true, spec);
    const remSpec = makeFilaments(seed, spec.filamentRem, false, spec);
    const detFade = { value: 0 };
    const remFade = { value: 0 };
    const det = filamentMesh(`${body.id}-ejecta`, detSpec, colors, detFade, 4);
    const rem = filamentMesh(`${body.id}-remnant`, remSpec, colors, remFade, 4);
    this.object.add(det, rem);
    const beams = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(beamFrag, {
        uColor: { value: srgbVec(colors.novaBeam) },
        uAlpha: { value: 0.6 },
      }),
    );
    beams.frustumCulled = false;
    beams.renderOrder = 7;
    beams.name = `${body.id}-pulsar`;
    this.object.add(beams);
    const core = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(dotFrag, {
        uWhite: { value: srgbVec(colors.novaPulsar) },
        uMid: { value: srgbVec(colors.novaPulsarMid) },
        uEdge: { value: srgbVec(colors.novaPulsarEdge) },
      }),
    );
    core.frustumCulled = false;
    core.renderOrder = 7;
    core.name = `${body.id}-neutron`;
    this.object.add(core);
    const hit = makeRing(colors.novaBlast, 9, 1);
    hit.span.value = -1;
    hit.mesh.name = `${body.id}-blast-hit`;
    this.object.add(hit.mesh);
    return {
      body,
      nova,
      star,
      fit,
      shells,
      flash,
      flashAlpha,
      haze,
      shock,
      blast,
      track,
      arc,
      forecast,
      det,
      rem,
      detFade,
      remFade,
      detSpec,
      remSpec,
      beams,
      core,
      hit,
    };
  }

  private buildQuasar(body: Body, jet: QuasarJet): QuasarView {
    const colors = this.theme.colors;
    const spec = this.theme.quasar;
    const glowFit = quasarFit(this.theme, "quasar-glow", prepQuasarGlow);
    const glow = artMesh(glowFit, `${body.id}-glow`);
    glow.renderOrder = 0;
    const coreFit = quasarFit(this.theme, "quasar-core", prepQuasarCore);
    const core = artMesh(coreFit, `${body.id}-core`);
    core.renderOrder = 4;
    this.object.add(glow);
    const jetTan: { value: number }[] = [];
    const jetHalf: { value: number }[] = [];
    const jetZoom: { value: number }[] = [];
    const jetNow: { value: number }[] = [];
    const jets = [0, 1].map((side) => {
      const tan = { value: Math.tan(jet.cone) };
      const half = { value: 1 };
      const zoomU = { value: 1 };
      const now = { value: 0 };
      jetTan.push(tan);
      jetHalf.push(half);
      jetZoom.push(zoomU);
      jetNow.push(now);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        shader(jetFrag, {
          uStart: { value: body.radius * spec.jetStart },
          uReach: { value: jet.reach },
          uTan: tan,
          uHalfMax: half,
          uCore: { value: spec.coreWidth },
          uBody: { value: spec.bodyFraction },
          uCoreReach: { value: spec.coreReach },
          uZoom: zoomU,
          uNow: now,
          uPeriod: { value: spec.knotPeriod },
          uWhite: { value: srgbVec(colors.quasarJetWhite) },
          uIce: { value: srgbVec(colors.quasarJetIce) },
          uBlue: { value: srgbVec(colors.quasarJetBlue) },
          uViolet: { value: srgbVec(colors.quasarJetViolet) },
          uTail: { value: srgbVec(colors.quasarJetTail) },
        }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.name = `${body.id}-jet-${side}`;
      this.object.add(mesh);
      return mesh;
    });
    this.object.add(core);
    const edges = [0, 1, 2, 3].map((i) => {
      const line = makeLine(colors.eventWarn, 6, spec.sweepAlpha, spec.sweepDash, spec.sweepGap);
      line.mesh.name = `${body.id}-sweep-${i}`;
      this.object.add(line.mesh);
      return line;
    });
    const arcs = [0, 1].map((i) => {
      const ring = makeRing(colors.eventWarn, 6, spec.sweepAlpha);
      ring.dash.value = spec.sweepDash;
      ring.gap.value = spec.sweepGap;
      ring.mesh.name = `${body.id}-reach-${i}`;
      this.object.add(ring.mesh);
      return ring;
    });
    return { body, jet, glow, glowFit, core, coreFit, jets, jetTan, jetHalf, jetZoom, jetNow, edges, arcs };
  }

  /** One raster per picture. Zoom and motion after that are transforms and uniforms. */
  private bakeOnce(): void {
    const gen = ++this.bakeGen;
    const pixels = (fit: ArtFit) => rasterPixels(fit.viewW, fit.viewH, 2, 1);
    for (const view of this.novas) void this.paint(view.star, view.fit, pixels(view.fit), gen);
    for (const view of this.quasars) {
      void this.paint(view.glow, view.glowFit, pixels(view.glowFit), gen);
      void this.paint(view.core, view.coreFit, pixels(view.coreFit), gen);
    }
  }

  private async paint(mesh: THREE.Mesh, fit: ArtFit, pixels: { width: number; height: number }, gen: number): Promise<void> {
    const texture = await loadArtTexture(fit, pixels, 1);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    if (gen !== this.bakeGen) {
      texture.dispose();
      return;
    }
    const material = mesh.material as THREE.MeshBasicMaterial;
    const previous = material.map;
    material.map = texture;
    material.opacity = 1;
    material.needsUpdate = true;
    previous?.dispose();
  }
}

/** Shadow r 9 sits at the sample's core (230, 165), which is the view centre. */
function quasarFit(theme: Theme, tag: string, prep: (doc: Document) => void): ArtFit {
  return {
    url: theme.assets.quasar,
    viewW: 460,
    viewH: 330,
    svgRadius: 9,
    ox: 0,
    oy: 0,
    light: null,
    spin: "none",
    bake: { tag, prep },
  };
}

function prepProgenitor(doc: Document): void {
  const root = doc.getElementById("redGiant");
  if (root) silenceNightRim(doc, root);
}

/** Glow only. Jets stay a shader so the sheath matches `quasarDamage`. */
function prepQuasarGlow(doc: Document): void {
  const root = doc.getElementById("quasar");
  if (!root) return;
  for (const child of [...root.children]) {
    const glow = child.localName === "circle" && child.getAttribute("r") === "90";
    if (!glow) child.remove();
  }
  silenceNightRim(doc, root);
}

/** Disk, shadow and rim. The lethal chip and the sample jets are not part of the body. */
function prepQuasarCore(doc: Document): void {
  const root = doc.getElementById("quasar");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.localName === "circle" && child.getAttribute("r") === "90") child.remove();
    else if (child.querySelector("path, text")) child.remove();
  }
  silenceNightRim(doc, root);
}

function shownTime(game: VisualFrame["game"]): number {
  if (isEditing(game) && game.mode === "planning") {
    return game.cursorStep === null ? 0 : game.cursorStep * game.level.dt;
  }
  return game.ship.t;
}

function safeDelay(game: VisualFrame["game"], x: number, y: number, jet: QuasarJet, time: number): number | null {
  const path = game.prediction.path;
  let best: { dx: number; dy: number } | null = null;
  let bestDt = Infinity;
  for (let i = 0; i < path.length; i += 1) {
    const sample = path[i];
    const dx = sample.x - x;
    const dy = sample.y - y;
    if (!pointInSweep(dx, dy, jet)) continue;
    const dt = Math.abs(sample.step * game.level.dt - time);
    if (dt < bestDt) {
      bestDt = dt;
      best = { dx, dy };
    }
  }
  if (!best) return null;
  return jetLeaveDelay(best.dx, best.dy, jet, time);
}

function makeRing(color: string, order: number, alpha: number): RingMesh {
  const outer = { value: 1 };
  const radius = { value: 1 };
  const half = { value: 1 };
  const zoom = { value: 1 };
  const dash = { value: 0 };
  const gap = { value: 1 };
  const offset = { value: 0 };
  const start = { value: Math.PI / 2 };
  const span = { value: -1 };
  const alphaU = { value: alpha };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    shader(ringFrag, {
      uOuter: outer,
      uRadius: radius,
      uHalf: half,
      uZoom: zoom,
      uDash: dash,
      uGap: gap,
      uOffset: offset,
      uStart: start,
      uSpan: span,
      uColor: { value: srgbVec(color) },
      uAlpha: alphaU,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return { mesh, outer, radius, half, zoom, dash, gap, offset, start, span, alpha: alphaU };
}

function placeRing(ring: RingMesh, x: number, y: number, radius: number, widthPx: number, zoom: number, visible: boolean): void {
  ring.mesh.visible = visible && radius > 0.5 && zoom > 0;
  if (!ring.mesh.visible) return;
  const half = (widthPx * 0.5) / zoom;
  const outer = radius + half + 4 / zoom;
  ring.outer.value = outer;
  ring.radius.value = radius;
  ring.half.value = half;
  ring.zoom.value = zoom;
  ring.mesh.position.set(x, y, 0);
  ring.mesh.scale.set(outer, outer, 1);
}

function makeLine(color: string, order: number, alpha: number, dash: number, gap: number): LineMesh {
  const length = { value: 1 };
  const zoom = { value: 1 };
  const offset = { value: 0 };
  const alphaU = { value: alpha };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    shader(lineFrag, {
      uColor: { value: srgbVec(color) },
      uAlpha: alphaU,
      uDash: { value: dash },
      uGap: { value: gap },
      uOffset: offset,
      uLength: length,
      uZoom: zoom,
    }),
  );
  (mesh.material as THREE.ShaderMaterial).vertexShader = lineVert;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return { mesh, length, zoom, offset, alpha: alphaU };
}

function placeLine(line: LineMesh, x0: number, y0: number, x1: number, y1: number, widthPx: number, zoom: number, visible: boolean): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  line.mesh.visible = visible && length > 1 && zoom > 0;
  if (!line.mesh.visible) return;
  line.length.value = length;
  line.zoom.value = zoom;
  line.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  line.mesh.rotation.z = Math.atan2(dy, dx);
  line.mesh.scale.set(length, widthPx / zoom, 1);
}

function filamentMesh(
  name: string,
  specs: readonly FilamentSpec[],
  colors: Theme["colors"],
  fade: { value: number },
  order: number,
): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const rgb = [colors.novaFilamentH, colors.novaFilamentO, colors.novaFilamentS, colors.novaFilamentN].map((hex) => srgbVec(hex));
  const color = new Float32Array(Math.max(1, specs.length) * 3);
  const rest = new Float32Array(Math.max(1, specs.length));
  for (let i = 0; i < specs.length; i += 1) {
    const c = rgb[specs[i].color] ?? rgb[0];
    color[i * 3] = c.x;
    color[i * 3 + 1] = c.y;
    color[i * 3 + 2] = c.z;
    rest[i] = specs[i].restAlpha;
  }
  geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 3));
  geometry.setAttribute("aRest", new THREE.InstancedBufferAttribute(rest, 1));
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: { uFade: fade },
      vertexShader: filamentVert,
      fragmentShader: filamentFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
    Math.max(1, specs.length),
  );
  mesh.count = Math.max(1, specs.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.name = name;
  return mesh;
}

class Chip {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private key = "";

  constructor(order: number) {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
    this.mesh.name = "hazard-chip";
  }

  show(
    text: string,
    color: string,
    fill: string,
    x: number,
    y: number,
    zoom: number,
    dpr: number,
    spec: Theme["event"],
  ): void {
    if (!(zoom > 0)) {
      this.mesh.visible = false;
      return;
    }
    const key = `${text}|${color}|${dpr}`;
    if (key !== this.key) {
      this.key = key;
      this.paint(text, color, fill, dpr, spec);
    }
    const image = this.material.map?.image as { width: number; height: number } | undefined;
    const cssW = image ? image.width / Math.max(1, dpr) : 80;
    const cssH = spec.chipHeight;
    const w = cssW / zoom;
    const h = cssH / zoom;
    this.mesh.scale.set(w, h, 1);
    this.mesh.position.set(x + w / 2, y - h / 2, 0);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  private paint(text: string, color: string, fill: string, dpr: number, spec: Theme["event"]): void {
    const font = `${spec.chipFont * dpr}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    measure.font = font;
    const textW = measure.measureText(text).width;
    const cssW = Math.ceil(textW / dpr + spec.chipPad * 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(cssW * dpr));
    canvas.height = Math.max(1, Math.ceil(spec.chipHeight * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const inset = dpr * 0.5;
    ctx.beginPath();
    ctx.roundRect(inset, inset, canvas.width - dpr, canvas.height - dpr, spec.chipRadius * dpr);
    ctx.fillStyle = hexAlpha(fill, spec.chipFill);
    ctx.fill();
    ctx.strokeStyle = hexAlpha(color, spec.chipStroke);
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, spec.chipPad * dpr, 12 * dpr);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.material.map?.dispose();
    this.material.map = texture;
    this.material.needsUpdate = true;
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
