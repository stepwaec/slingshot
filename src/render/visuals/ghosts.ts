import * as THREE from "three";
import { movingBodies } from "../../game/ghosts";
import { isEditing } from "../../game/state";
import { bodyPose, bodyPresent, type Body } from "../../sim/physics";
import {
  aheadFade,
  burnsAhead,
  collisionPulse,
  ghostChip,
  ghostDraw,
  pickGhostKind,
  planGhosts,
  shipAtStep,
  shipInside,
  trackSamples,
  trackTicks,
  type GhostDraw,
  type GhostInk,
} from "../ghost-look";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";
import { shader, srgbVec } from "./materials";

/**
 * Where a moving body will be. Planning and pause only.
 * design/assets/ghost-markers.svg, style.md §15, threejs-notes.md §18.
 * Positions come from `bodyPose`. Nothing here writes the simulation.
 *
 * Strokes are CSS pixels of the top-down zoom. The mockup's faint full-orbit
 * circle (α 0.12) is not in the header, so it is not drawn. "Other bodies"
 * keep the body's radius; the sample makes them quieter with α 0.6, not a
 * second size.
 */
export const createGhosts: VisualFactory = (theme) => new GhostsVisual(theme);

const ORDER_TRACK = 0.5;
const ORDER_TIE = 18;
const ORDER_ANCHOR = 19;
const ORDER_MARKER = 20;
const ORDER_BADGE = 21;
const ORDER_CHIP = 22;

const markerFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform vec3 uFillColor;
uniform float uHalf;
uniform float uRadius;
uniform float uZoom;
uniform float uRingAlpha;
uniform float uFillAlpha;
uniform float uWidth;
uniform float uInner;
uniform float uInnerWidth;
uniform float uInnerAlpha;
uniform float uInnerRatio;
uniform float uDash;
uniform float uGap;
uniform float uOffset;
uniform float uMark;
uniform float uMarkWidth;
uniform float uMarkAlpha;
uniform float uMarkReach;
uniform float uCapture;
uniform float uCaptureR;
uniform float uCaptureWidth;
uniform float uCaptureDash;
uniform float uCaptureGap;
uniform float uCaptureOffset;
uniform float uCaptureAlpha;

vec4 over(vec4 under, vec3 rgb, float alpha) {
  float a = alpha + under.a * (1.0 - alpha);
  vec3 c = a > 0.001 ? (rgb * alpha + under.rgb * under.a * (1.0 - alpha)) / a : under.rgb;
  return vec4(c, a);
}

void main() {
  vec2 world = vLocal * uHalf;
  float px = length(world) * uZoom;
  float ringPx = uRadius * uZoom;
  float w = max(fwidth(px), 0.5);
  vec4 acc = vec4(0.0);
  if (uFillAlpha > 0.0) {
    float disc = 1.0 - smoothstep(ringPx - w, ringPx + w, px);
    acc = over(acc, uFillColor, disc * uFillAlpha);
  }
  float band = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + w, abs(px - ringPx));
  float on = 1.0;
  if (uDash > 0.0) {
    float arc = atan(world.y, world.x) * ringPx;
    float period = uDash + uGap;
    float x = mod(arc - uOffset + period * 8.0, period);
    float aa = max(fwidth(arc), 0.5);
    on = 1.0 - smoothstep(uDash - aa, uDash + aa, x);
  }
  acc = over(acc, uColor, band * on * uRingAlpha);
  if (uInner > 0.5) {
    float innerPx = ringPx * uInnerRatio;
    float ib = 1.0 - smoothstep(uInnerWidth * 0.5, uInnerWidth * 0.5 + w, abs(px - innerPx));
    acc = over(acc, uColor, ib * uInnerAlpha);
  }
  if (uMark > 0.5 && uMarkAlpha > 0.0) {
    vec2 p = world * uZoom;
    float inv = 0.70710678;
    float span = ringPx * uMarkReach;
    float halfW = uMarkWidth * 0.5;
    float slashD = abs(p.x - p.y) * inv;
    float slashT = abs(p.x + p.y) * inv;
    float slash = (1.0 - smoothstep(halfW, halfW + w, slashD)) * (1.0 - smoothstep(span, span + w, slashT));
    float mark = slash;
    if (uMark < 1.5) {
      float backD = abs(p.x + p.y) * inv;
      float backT = abs(p.x - p.y) * inv;
      float back = (1.0 - smoothstep(halfW, halfW + w, backD)) * (1.0 - smoothstep(span, span + w, backT));
      mark = max(slash, back);
    }
    acc = over(acc, uColor, mark * uMarkAlpha);
  }
  if (uCapture > 0.5 && uCaptureR > 0.0) {
    float cpx = uCaptureR * uZoom;
    float cb = 1.0 - smoothstep(uCaptureWidth * 0.5, uCaptureWidth * 0.5 + w, abs(px - cpx));
    float arc = atan(world.y, world.x) * cpx;
    float period = uCaptureDash + uCaptureGap;
    float x = mod(arc - uCaptureOffset + period * 8.0, period);
    float aa = max(fwidth(arc), 0.5);
    float con = 1.0 - smoothstep(uCaptureDash - aa, uCaptureDash + aa, x);
    acc = over(acc, uColor, cb * con * uCaptureAlpha);
  }
  if (acc.a < 0.01) discard;
  gl_FragColor = acc;
}
`;

const tieVert = /* glsl */ `
attribute float aAlong;
attribute float aAcross;
varying float vAlong;
varying float vAcross;
void main() {
  vAlong = aAlong;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const tieFrag = /* glsl */ `
varying float vAlong;
varying float vAcross;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uWidth;
uniform float uDash;
uniform float uGap;
void main() {
  float hw = uWidth * 0.5;
  float period = uDash + uGap;
  float x = mod(vAlong + period * 8.0, period);
  float inner = max(uDash - uWidth, 0.0);
  float rel = x - hw;
  float ax = rel < 0.0 ? rel : (rel > inner ? rel - inner : 0.0);
  float dist = length(vec2(ax, vAcross));
  float aa = max(fwidth(dist), 0.35);
  float on = 1.0 - smoothstep(hw - aa, hw + aa, dist);
  float a = on * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const anchorFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uRingAlpha;
uniform float uDotAlpha;
uniform float uZoom;
uniform float uHalf;
uniform float uRing;
uniform float uRingWidth;
uniform float uDot;
void main() {
  float px = length(vLocal) * uHalf * uZoom;
  float w = max(fwidth(px), 0.5);
  float ring = 1.0 - smoothstep(uRingWidth * 0.5, uRingWidth * 0.5 + w, abs(px - uRing));
  float dot = uDot > 0.0 ? (1.0 - smoothstep(uDot - w, uDot, px)) : 0.0;
  float a = max(ring * uRingAlpha, dot * uDotAlpha);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const dotVert = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const dotFrag = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float fw = fwidth(d);
  float a = (1.0 - smoothstep(1.0 - fw, 1.0, d)) * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const tickVert = /* glsl */ `
attribute vec2 aLocal;
varying vec2 vLocal;
void main() {
  vLocal = aLocal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const tickFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float fw = fwidth(vLocal.y);
  float a = (1.0 - smoothstep(1.0 - fw, 1.0, abs(vLocal.y))) * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

interface MarkerUniforms {
  uColor: THREE.IUniform<THREE.Vector3>;
  uFillColor: THREE.IUniform<THREE.Vector3>;
  uHalf: THREE.IUniform<number>;
  uRadius: THREE.IUniform<number>;
  uZoom: THREE.IUniform<number>;
  uRingAlpha: THREE.IUniform<number>;
  uFillAlpha: THREE.IUniform<number>;
  uWidth: THREE.IUniform<number>;
  uInner: THREE.IUniform<number>;
  uInnerWidth: THREE.IUniform<number>;
  uInnerAlpha: THREE.IUniform<number>;
  uInnerRatio: THREE.IUniform<number>;
  uDash: THREE.IUniform<number>;
  uGap: THREE.IUniform<number>;
  uOffset: THREE.IUniform<number>;
  uMark: THREE.IUniform<number>;
  uMarkWidth: THREE.IUniform<number>;
  uMarkAlpha: THREE.IUniform<number>;
  uMarkReach: THREE.IUniform<number>;
  uCapture: THREE.IUniform<number>;
  uCaptureR: THREE.IUniform<number>;
  uCaptureWidth: THREE.IUniform<number>;
  uCaptureDash: THREE.IUniform<number>;
  uCaptureGap: THREE.IUniform<number>;
  uCaptureOffset: THREE.IUniform<number>;
  uCaptureAlpha: THREE.IUniform<number>;
}

class Marker {
  readonly mesh: THREE.Mesh;
  readonly tie: THREE.Mesh;
  readonly anchor: THREE.Mesh;
  readonly badge: THREE.Mesh;
  readonly chip: THREE.Mesh;
  private readonly uniforms: MarkerUniforms;
  private readonly tieColor: THREE.IUniform<THREE.Vector3>;
  private readonly tieAlpha: THREE.IUniform<number>;
  private readonly tiePos: Float32Array;
  private readonly tieAlong: Float32Array;
  private readonly tieAcross: Float32Array;
  private readonly anchorColor: THREE.IUniform<THREE.Vector3>;
  private readonly anchorRingAlpha: THREE.IUniform<number>;
  private readonly anchorDotAlpha: THREE.IUniform<number>;
  private readonly anchorHalf: THREE.IUniform<number>;
  private readonly anchorZoom: THREE.IUniform<number>;
  private readonly anchorDot: THREE.IUniform<number>;
  private readonly badgeMaterial: THREE.MeshBasicMaterial;
  private readonly chipMaterial: THREE.MeshBasicMaterial;
  private badgeKey = "";
  private chipKey = "";
  private chipCssW = 48;

  constructor(theme: Theme) {
    const spec = theme.ghost;
    const color = new THREE.Vector3();
    const fill = new THREE.Vector3();
    this.uniforms = {
      uColor: { value: color },
      uFillColor: { value: fill },
      uHalf: { value: 1 },
      uRadius: { value: 1 },
      uZoom: { value: 1 },
      uRingAlpha: { value: 1 },
      uFillAlpha: { value: 0 },
      uWidth: { value: spec.ringWidth },
      uInner: { value: 1 },
      uInnerWidth: { value: spec.innerWidth },
      uInnerAlpha: { value: 0.5 },
      uInnerRatio: { value: spec.innerRatio },
      uDash: { value: 0 },
      uGap: { value: 1 },
      uOffset: { value: 0 },
      uMark: { value: 0 },
      uMarkWidth: { value: 1.2 },
      uMarkAlpha: { value: 0 },
      uMarkReach: { value: 1 },
      uCapture: { value: 0 },
      uCaptureR: { value: 0 },
      uCaptureWidth: { value: spec.captureWidth },
      uCaptureDash: { value: spec.captureDash },
      uCaptureGap: { value: spec.captureGap },
      uCaptureOffset: { value: 0 },
      uCaptureAlpha: { value: spec.captureAlpha },
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(markerFrag, this.uniforms as unknown as Record<string, THREE.IUniform>),
    );
    this.mesh.name = "ghost-marker";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = ORDER_MARKER;

    this.tiePos = new Float32Array(18);
    this.tieAlong = new Float32Array(6);
    this.tieAcross = new Float32Array(6);
    const tieGeo = new THREE.BufferGeometry();
    tieGeo.setAttribute("position", new THREE.BufferAttribute(this.tiePos, 3));
    tieGeo.setAttribute("aAlong", new THREE.BufferAttribute(this.tieAlong, 1));
    tieGeo.setAttribute("aAcross", new THREE.BufferAttribute(this.tieAcross, 1));
    this.tieColor = { value: new THREE.Vector3() };
    this.tieAlpha = { value: spec.tieAlpha };
    const tieMaterial = shader(tieFrag, {
      uColor: this.tieColor,
      uAlpha: this.tieAlpha,
      uWidth: { value: spec.tieWidth },
      uDash: { value: spec.tieDash },
      uGap: { value: spec.tieGap },
    });
    tieMaterial.vertexShader = tieVert;
    tieMaterial.side = THREE.DoubleSide;
    this.tie = new THREE.Mesh(tieGeo, tieMaterial);
    this.tie.name = "ghost-tie";
    this.tie.frustumCulled = false;
    this.tie.renderOrder = ORDER_TIE;

    this.anchorColor = { value: new THREE.Vector3() };
    this.anchorRingAlpha = { value: spec.tieAlpha };
    this.anchorDotAlpha = { value: 0 };
    this.anchorHalf = { value: 1 };
    this.anchorZoom = { value: 1 };
    this.anchorDot = { value: 0 };
    this.anchor = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(anchorFrag, {
        uColor: this.anchorColor,
        uRingAlpha: this.anchorRingAlpha,
        uDotAlpha: this.anchorDotAlpha,
        uZoom: this.anchorZoom,
        uHalf: this.anchorHalf,
        uRing: { value: spec.pathRing },
        uRingWidth: { value: spec.pathRingWidth },
        uDot: this.anchorDot,
      }),
    );
    this.anchor.name = "ghost-anchor";
    this.anchor.frustumCulled = false;
    this.anchor.renderOrder = ORDER_ANCHOR;

    this.badgeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.badge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.badgeMaterial);
    this.badge.name = "ghost-badge";
    this.badge.frustumCulled = false;
    this.badge.renderOrder = ORDER_BADGE;

    this.chipMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.chip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.chipMaterial);
    this.chip.name = "ghost-chip";
    this.chip.frustumCulled = false;
    this.chip.renderOrder = ORDER_CHIP;
  }

  hide(): void {
    this.mesh.visible = false;
    this.tie.visible = false;
    this.anchor.visible = false;
    this.badge.visible = false;
    this.chip.visible = false;
  }

  show(view: MarkerView): void {
    const spec = view.theme.ghost;
    const zoom = view.zoom;
    const draw = view.draw;
    const captureR = draw.capture ? view.captureRadius : 0;
    const reach = Math.max(view.radius, captureR);
    const pad = (Math.max(draw.width, spec.captureWidth, draw.markWidth) + 2) / zoom;
    const half = reach + pad;
    const u = this.uniforms;
    u.uColor.value.copy(view.ink);
    u.uFillColor.value.copy(view.fillInk);
    u.uHalf.value = half;
    u.uRadius.value = view.radius;
    u.uZoom.value = zoom;
    u.uRingAlpha.value = view.ringAlpha;
    u.uFillAlpha.value = view.fillAlpha;
    u.uWidth.value = draw.width;
    u.uInner.value = draw.inner ? 1 : 0;
    u.uInnerAlpha.value = view.ringAlpha * spec.innerAlpha;
    u.uDash.value = draw.dash;
    u.uGap.value = draw.gap;
    u.uMark.value = draw.mark;
    u.uMarkWidth.value = draw.markWidth;
    u.uMarkAlpha.value = view.markAlpha;
    u.uMarkReach.value = draw.markReach;
    u.uCapture.value = captureR > 0 ? 1 : 0;
    u.uCaptureR.value = captureR;
    u.uCaptureOffset.value = view.captureOffset;
    u.uCaptureAlpha.value = view.captureAlpha;
    this.mesh.position.set(view.x, view.y, 0);
    this.mesh.scale.set(half, half, 1);
    this.mesh.visible = true;

    this.placeTie(view, spec.tieWidth);
    this.placeAnchor(view);
    this.placeBadge(view);
    this.placeChip(view);
  }

  private placeTie(view: MarkerView, widthPx: number): void {
    const ship = view.ship;
    if (!ship || !(view.zoom > 0)) {
      this.tie.visible = false;
      return;
    }
    const dx = view.x - ship.x;
    const dy = view.y - ship.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) {
      this.tie.visible = false;
      return;
    }
    const zoom = view.zoom;
    const hw = (widthPx * 0.5) / zoom;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy * hw;
    const ny = ux * hw;
    const lenPx = len * zoom;
    const corners = [
      ship.x + nx, ship.y + ny, 0, -hw,
      ship.x - nx, ship.y - ny, 0, hw,
      view.x - nx, view.y - ny, lenPx, hw,
      ship.x + nx, ship.y + ny, 0, -hw,
      view.x - nx, view.y - ny, lenPx, hw,
      view.x + nx, view.y + ny, lenPx, -hw,
    ];
    for (let i = 0; i < 6; i++) {
      this.tiePos[i * 3] = corners[i * 4];
      this.tiePos[i * 3 + 1] = corners[i * 4 + 1];
      this.tiePos[i * 3 + 2] = 0;
      this.tieAlong[i] = corners[i * 4 + 2];
      this.tieAcross[i] = corners[i * 4 + 3];
    }
    const geometry = this.tie.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlong.needsUpdate = true;
    geometry.attributes.aAcross.needsUpdate = true;
    this.tieColor.value.copy(view.tieInk);
    this.tieAlpha.value = view.tieAlpha;
    this.tie.visible = true;
  }

  private placeAnchor(view: MarkerView): void {
    const ship = view.ship;
    const spec = view.theme.ghost;
    if (!ship || !(view.zoom > 0)) {
      this.anchor.visible = false;
      return;
    }
    const dot = view.cursorTie ? spec.pathDot : 0;
    const half = (Math.max(spec.pathRing, dot) + spec.pathRingWidth + 2) / view.zoom;
    this.anchorHalf.value = half;
    this.anchorZoom.value = view.zoom;
    this.anchorDot.value = dot;
    this.anchorColor.value.copy(view.tieInk);
    this.anchorRingAlpha.value = view.tieAlpha;
    this.anchorDotAlpha.value = view.cursorTie ? view.fade : 0;
    this.anchor.position.set(ship.x, ship.y, 0);
    this.anchor.scale.set(half, half, 1);
    this.anchor.visible = true;
  }

  private placeBadge(view: MarkerView): void {
    if (!view.draw.badge || view.burnNumber === null || !(view.zoom > 0)) {
      this.badge.visible = false;
      return;
    }
    const spec = view.theme.ghost;
    const text = String(view.burnNumber);
    const key = `${text}|${view.dpr}`;
    if (key !== this.badgeKey) {
      this.badgeKey = key;
      paintBadge(this.badgeMaterial, text, view.dpr, spec, view.theme.colors.nodeFill, view.theme.colors.nodeRing);
    }
    const css = spec.badgeRadius * 2 + spec.badgeWidth + 2;
    const zoom = view.zoom;
    this.badge.scale.set(css / zoom, css / zoom, 1);
    this.badge.position.set(
      view.x + spec.badgeOffset * view.radius,
      view.y + spec.badgeOffset * view.radius,
      0,
    );
    this.badgeMaterial.opacity = view.fade;
    this.badge.visible = true;
  }

  private placeChip(view: MarkerView): void {
    const text = view.label;
    if (!text || !(view.zoom > 0)) {
      this.chip.visible = false;
      return;
    }
    const spec = view.theme.ghost;
    const key = `${text}|${view.labelColor}|${view.dpr}`;
    if (key !== this.chipKey) {
      this.chipKey = key;
      this.chipCssW = paintChip(
        this.chipMaterial,
        text,
        view.labelColor,
        view.theme.colors.eventPanel,
        view.dpr,
        spec,
      );
    }
    const zoom = view.zoom;
    const w = this.chipCssW / zoom;
    const h = spec.chipHeight / zoom;
    this.chip.scale.set(w, h, 1);
    this.chip.position.set(
      view.x + view.radius + spec.chipOffsetX / zoom + w / 2,
      view.y - spec.chipOffsetY / zoom,
      0,
    );
    this.chipMaterial.opacity = view.fade;
    this.chip.visible = true;
  }
}

interface MarkerView {
  theme: Theme;
  draw: GhostDraw;
  x: number;
  y: number;
  radius: number;
  captureRadius: number;
  zoom: number;
  dpr: number;
  ink: THREE.Vector3;
  fillInk: THREE.Vector3;
  tieInk: THREE.Vector3;
  ringAlpha: number;
  fillAlpha: number;
  markAlpha: number;
  captureAlpha: number;
  captureOffset: number;
  tieAlpha: number;
  fade: number;
  cursorTie: boolean;
  ship: { x: number; y: number } | null;
  burnNumber: number | null;
  label: string | null;
  labelColor: string;
}

class FutureTrack {
  readonly dots: THREE.Mesh;
  readonly ticks: THREE.Mesh;
  private readonly dotPos: Float32Array;
  private readonly dotUv: Float32Array;
  private readonly tickPos: Float32Array;
  private readonly tickLocal: Float32Array;
  private readonly maxDots: number;
  private readonly maxTicks: number;

  constructor(theme: Theme, color: THREE.Vector3) {
    const spec = theme.ghost;
    this.maxDots = spec.maxDots;
    this.maxTicks = spec.maxTicks;
    this.dotPos = new Float32Array(this.maxDots * 18);
    this.dotUv = new Float32Array(this.maxDots * 12);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(this.dotPos, 3));
    dotGeo.setAttribute("aUv", new THREE.BufferAttribute(this.dotUv, 2));
    dotGeo.setDrawRange(0, 0);
    const dots = shader(dotFrag, { uColor: { value: color }, uAlpha: { value: spec.trackAlpha } });
    dots.vertexShader = dotVert;
    this.dots = new THREE.Mesh(dotGeo, dots);
    this.dots.name = "ghost-track";
    this.dots.frustumCulled = false;
    this.dots.renderOrder = ORDER_TRACK;
    this.dots.visible = false;

    this.tickPos = new Float32Array(this.maxTicks * 18);
    this.tickLocal = new Float32Array(this.maxTicks * 12);
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute("position", new THREE.BufferAttribute(this.tickPos, 3));
    tickGeo.setAttribute("aLocal", new THREE.BufferAttribute(this.tickLocal, 2));
    tickGeo.setDrawRange(0, 0);
    const ticks = shader(tickFrag, { uColor: { value: color }, uAlpha: { value: spec.tickAlpha } });
    ticks.vertexShader = tickVert;
    ticks.side = THREE.DoubleSide;
    this.ticks = new THREE.Mesh(tickGeo, ticks);
    this.ticks.name = "ghost-ticks";
    this.ticks.frustumCulled = false;
    this.ticks.renderOrder = ORDER_TRACK;
    this.ticks.visible = false;
  }

  hide(): void {
    this.dots.visible = false;
    this.ticks.visible = false;
  }

  drawDots(points: readonly { x: number; y: number }[], radius: number): void {
    const count = Math.min(points.length, this.maxDots);
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    const sign = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
    for (let i = 0; i < count; i++) {
      const p = points[i];
      for (let k = 0; k < 6; k++) {
        const o = i * 18 + k * 3;
        this.dotPos[o] = p.x + sign[k * 2] * radius;
        this.dotPos[o + 1] = p.y + sign[k * 2 + 1] * radius;
        this.dotPos[o + 2] = 0;
      }
      this.dotUv.set(uv, i * 12);
    }
    const geometry = this.dots.geometry;
    geometry.setDrawRange(0, count * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aUv.needsUpdate = true;
    this.dots.visible = count > 0;
  }

  drawTicks(ticks: readonly { x: number; y: number; tx: number; ty: number }[], halfLen: number, halfWidth: number): void {
    const count = Math.min(ticks.length, this.maxTicks);
    const local = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
    for (let i = 0; i < count; i++) {
      const tick = ticks[i];
      const nx = -tick.ty;
      const ny = tick.tx;
      for (let k = 0; k < 6; k++) {
        const lx = local[k * 2];
        const ly = local[k * 2 + 1];
        const o = i * 18 + k * 3;
        this.tickPos[o] = tick.x + tick.tx * lx * halfLen + nx * ly * halfWidth;
        this.tickPos[o + 1] = tick.y + tick.ty * lx * halfLen + ny * ly * halfWidth;
        this.tickPos[o + 2] = 0;
      }
      this.tickLocal.set(local, i * 12);
    }
    const geometry = this.ticks.geometry;
    geometry.setDrawRange(0, count * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aLocal.needsUpdate = true;
    this.ticks.visible = count > 0;
  }
}

class GhostsVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly markers: Marker[] = [];
  private readonly track: FutureTrack;
  private readonly ink: Record<GhostInk | "tie", THREE.Vector3>;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly dotScratch: { x: number; y: number }[] = [];
  private readonly tickScratch: { x: number; y: number; tx: number; ty: number }[] = [];

  constructor(theme: Theme) {
    this.theme = theme;
    this.object.name = "ghosts";
    const colors = theme.colors;
    this.ink = {
      body: srgbVec(colors.ghostBody),
      cursor: srgbVec(colors.ghostCursor),
      target: srgbVec(colors.ghostTarget),
      collision: srgbVec(colors.ghostCollision),
      gone: srgbVec(colors.ghostGone),
      tie: srgbVec(colors.ghostTie),
    };
    this.xs = new Float32Array(theme.ghost.maxSamples + 1);
    this.ys = new Float32Array(theme.ghost.maxSamples + 1);
    this.track = new FutureTrack(theme, this.ink.target);
    this.object.add(this.track.dots, this.track.ticks);
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const show = isEditing(game);
    if (!show) {
      this.hideAll();
      return;
    }
    const spec = this.theme.ghost;
    const zoom = game.camera.zoom > 0 ? game.camera.zoom : 1;
    const bodies = movingBodies(game.level.bodies);
    const drawn = game.mode === "planning" ? 0 : game.ship.step;
    const targetIndex = bodies.findIndex((body) => body.id === game.level.targetId);
    const won = game.prediction.status === "won";
    const capture = won ? game.prediction.steps : null;
    const slots = planGhosts(game.nodes, game.cursorStep, drawn, bodies.length, targetIndex, capture);
    const origin = game.mode === "paused" ? game.ship : game.initial;
    const fallback = [origin, game.prediction.final];
    const seconds = frame.now / 1000;
    const period = spec.captureDash + spec.captureGap;
    const captureOffset = -((seconds * spec.captureCrawl) % period);
    const pulse = collisionPulse(seconds, spec.collisionPeriod, spec.collisionHigh, spec.collisionLow);
    let count = 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const body = bodies[slot.bodyIndex];
      const time = slot.step * game.level.dt;
      const present = bodyPresent(body, time);
      const pose = bodyPose(body, time, game.level.bodies, game.level.g);
      const ship = shipAtStep(game.prediction.path, slot.step, fallback);
      const colliding = !!ship && shipInside(ship.x, ship.y, pose.x, pose.y, body.radius);
      const target = body.id === game.level.targetId;
      const kind = pickGhostKind({
        present,
        colliding,
        arrival: slot.arrival,
        cursor: slot.cursor,
        target,
      });
      const draw = ghostDraw(kind, spec);
      const fade = aheadFade(burnsAhead(game.nodes, drawn, slot.step), spec.farBurns, spec.farAlpha, draw.alpha);
      const ringPulse = kind === "collision" ? pulse : 1;
      const marker = this.ensure(count);
      count += 1;
      const label = ghostChip(kind, (slot.step - drawn) * game.level.dt);
      marker.show({
        theme: this.theme,
        draw,
        x: pose.x,
        y: pose.y,
        radius: Math.max(body.radius, spec.minRadius),
        captureRadius: body.captureRadius ?? 0,
        zoom,
        dpr: Math.max(1, frame.dpr),
        ink: this.ink[draw.ink],
        fillInk: draw.fillInk === "none" ? this.ink.body : this.ink[draw.fillInk],
        tieInk: kind === "cursor" ? this.ink.cursor : this.ink.tie,
        ringAlpha: draw.alpha * ringPulse * fade,
        fillAlpha: draw.fill * fade,
        markAlpha: draw.alpha * fade,
        captureAlpha: spec.captureAlpha * fade,
        captureOffset,
        tieAlpha: (kind === "cursor" ? spec.tieCursorAlpha : spec.tieAlpha) * fade,
        fade,
        cursorTie: kind === "cursor",
        ship,
        burnNumber: draw.badge ? slot.burnNumber : null,
        label,
        labelColor: hexOf(draw.ink, this.theme),
      });
    }
    for (let i = count; i < this.markers.length; i++) this.markers[i].hide();
    this.drawTrack(bodies, targetIndex, drawn, capture, game.level.dt, game.level.bodies, game.level.g, zoom);
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private hideAll(): void {
    for (let i = 0; i < this.markers.length; i++) this.markers[i].hide();
    this.track.hide();
  }

  private ensure(index: number): Marker {
    const existing = this.markers[index];
    if (existing) return existing;
    const marker = new Marker(this.theme);
    this.markers.push(marker);
    this.object.add(marker.tie, marker.anchor, marker.mesh, marker.badge, marker.chip);
    return marker;
  }

  private drawTrack(
    moving: readonly Body[],
    targetIndex: number,
    drawn: number,
    capture: number | null,
    dt: number,
    bodies: readonly Body[],
    g: number,
    zoom: number,
  ): void {
    const spec = this.theme.ghost;
    const target = targetIndex >= 0 ? moving[targetIndex] : undefined;
    if (!target || capture === null || capture <= drawn || !(zoom > 0)) {
      this.track.hide();
      return;
    }
    const t0 = drawn * dt;
    const t1 = capture * dt;
    const n = trackSamples(t0, t1, dt, spec.maxSamples);
    if (n < 2) {
      this.track.hide();
      return;
    }
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const pose = bodyPose(target, t, bodies, g);
      this.xs[i] = pose.x;
      this.ys[i] = pose.y;
    }
    let length = 0;
    for (let i = 0; i < n; i++) length += Math.hypot(this.xs[i + 1] - this.xs[i], this.ys[i + 1] - this.ys[i]);
    const spacing0 = (spec.trackDash + spec.trackGap) / zoom;
    const spacing = length > 0 && length / spacing0 > spec.maxDots ? length / spec.maxDots : spacing0;
    this.dotScratch.length = 0;
    if (length > 0 && spacing > 0) {
      let carried = 0;
      this.dotScratch.push({ x: this.xs[0], y: this.ys[0] });
      for (let i = 0; i < n && this.dotScratch.length < spec.maxDots; i++) {
        const ax = this.xs[i];
        const ay = this.ys[i];
        const bx = this.xs[i + 1];
        const by = this.ys[i + 1];
        const seg = Math.hypot(bx - ax, by - ay);
        if (seg < 1e-6) continue;
        let dist = spacing - carried;
        while (dist <= seg && this.dotScratch.length < spec.maxDots) {
          const u = dist / seg;
          this.dotScratch.push({ x: ax + (bx - ax) * u, y: ay + (by - ay) * u });
          dist += spacing;
        }
        carried = seg - (dist - spacing);
        if (carried < 0) carried = 0;
      }
    }
    this.track.drawDots(this.dotScratch, (spec.trackWidth * 0.5) / zoom);

    const times = trackTicks(t0, t1, spec.tickSeconds);
    this.tickScratch.length = 0;
    for (let i = 0; i < times.length && i < spec.maxTicks; i++) {
      const t = times[i];
      const pose = bodyPose(target, t, bodies, g);
      const next = bodyPose(target, Math.min(t1, t + dt), bodies, g);
      let tx = next.x - pose.x;
      let ty = next.y - pose.y;
      let len = Math.hypot(tx, ty);
      if (len < 1e-6) {
        tx = pose.vx;
        ty = pose.vy;
        len = Math.hypot(tx, ty);
      }
      if (len < 1e-6) continue;
      this.tickScratch.push({ x: pose.x, y: pose.y, tx: -ty / len, ty: tx / len });
    }
    this.track.drawTicks(this.tickScratch, (spec.tickLength * 0.5) / zoom, (spec.tickWidth * 0.5) / zoom);
  }
}

function hexOf(ink: GhostInk, theme: Theme): string {
  if (ink === "cursor") return theme.colors.ghostCursor;
  if (ink === "target") return theme.colors.ghostTarget;
  if (ink === "collision") return theme.colors.ghostCollision;
  if (ink === "gone") return theme.colors.ghostGone;
  return theme.colors.ghostBody;
}

function paintBadge(
  material: THREE.MeshBasicMaterial,
  text: string,
  dpr: number,
  spec: Theme["ghost"],
  fill: string,
  color: string,
): void {
  const css = spec.badgeRadius * 2 + spec.badgeWidth + 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(css * dpr));
  canvas.height = canvas.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.beginPath();
  ctx.arc(css / 2, css / 2, spec.badgeRadius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = spec.badgeWidth;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `${spec.badgeFont}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, css / 2, css / 2 + 0.5);
  swapTexture(material, canvas);
}

function paintChip(
  material: THREE.MeshBasicMaterial,
  text: string,
  color: string,
  fill: string,
  dpr: number,
  spec: Theme["ghost"],
): number {
  const font = `${spec.chipFont * dpr}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return 48;
  measure.font = font;
  const textW = measure.measureText(text).width;
  const cssW = Math.ceil(textW / dpr + spec.chipPad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(cssW * dpr));
  canvas.height = Math.max(1, Math.ceil(spec.chipHeight * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return cssW;
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
  swapTexture(material, canvas);
  return cssW;
}

function swapTexture(material: THREE.MeshBasicMaterial, canvas: HTMLCanvasElement): void {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  material.map?.dispose();
  material.map = texture;
  material.needsUpdate = true;
}

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
