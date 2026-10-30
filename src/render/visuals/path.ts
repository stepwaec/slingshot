import * as THREE from "three";
import { shipLoadout } from "../../game/upgrades";
import { hasMagneticBody, solarRechargeRate, spreadAlong, type SpreadPoint, type Vec2 } from "../../sim/physics";
import { projectToScreen } from "../camera";
import { srgb01 } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Predicted path: a thin screen-space stroke through the predicted samples,
 * bright at the ship and transparent at the end, plus a tick every 10 s of
 * flight. Gold recharge stays a marker on that stroke. The closed capture
 * ellipse stays dotted. Samples come from the game prediction; nothing here
 * writes the sim.
 */
export const createPath: VisualFactory = (theme) => new PathVisual(theme);

const dotVert = /* glsl */ `
attribute vec4 aColor;
attribute vec2 aUv;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = aColor;
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const dotFrag = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
uniform float uSpan;
uniform float uRadius;
uniform float uSoft;
void main() {
  float d = length(vUv - vec2(0.5)) * uSpan;
  float edge = max(uSoft, 0.05);
  float alpha = 1.0 - smoothstep(uRadius - edge, uRadius + edge, d);
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
}
`;

const strokeVert = /* glsl */ `
attribute vec4 aColor;
attribute float aAcross;
varying vec4 vColor;
varying float vAcross;
void main() {
  vColor = aColor;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const strokeFrag = /* glsl */ `
varying vec4 vColor;
varying float vAcross;
uniform float uCore;
uniform float uSoft;
void main() {
  float dist = abs(vAcross) * (uCore + uSoft);
  float edge = max(uSoft, 0.05);
  float alpha = 1.0 - smoothstep(max(uCore - edge, 0.0), uCore + edge, dist);
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
}
`;

interface Ribbon {
  mesh: THREE.Mesh;
  pos: Float32Array;
  col: Float32Array;
  across: Float32Array;
  maxSegs: number;
}

interface Dots {
  mesh: THREE.Mesh;
  centers: Float32Array;
  colors: Float32Array;
  quadPos: Float32Array;
  quadCol: Float32Array;
}

interface Sample {
  x: number;
  y: number;
  step: number;
  rate: number;
  sigma: number;
  charge: number;
}

class PathVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly path: Dots;
  private readonly line: Ribbon;
  private readonly ticks: Ribbon;
  private readonly orbit: Dots;
  private readonly endRing: THREE.Mesh;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pArc: Float32Array;
  private readonly pStep: Float32Array;
  private readonly pRate: Float32Array;
  private readonly pSigma: Float32Array;
  private readonly pCharge: Float32Array;
  private readonly pWhich: Uint8Array;
  private readonly keep: Int32Array;
  private readonly offX: Float32Array;
  private readonly offY: Float32Array;
  private readonly which: Uint8Array;
  private readonly dotRate: Float32Array;
  private readonly dotSigma: Float32Array;
  private readonly dotCharge: Float32Array;
  private solar = 0;
  private dt = 1 / 60;
  private g = 1;
  private bodies: Parameters<typeof solarRechargeRate>[3] = [];
  private readonly ghost: Dots;
  private readonly envelope: THREE.Mesh;
  private readonly envelopePos: Float32Array;
  private spread: SpreadPoint[] = [];
  private useSpread = false;
  private fuzzy = false;
  private ghostSet = -1;
  private readonly cursor: Sample = { x: 0, y: 0, step: 0, rate: 1, sigma: 0, charge: 0 };
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private chain: readonly { x: number; y: number; step?: number; rate?: number }[] = [];
  private chainPrefix: { x: number; y: number; step: number; rate: number } | null = null;
  private chainClose = false;
  private pathPred: VisualFrame["game"]["prediction"] | null = null;
  private pathCamX = Number.NaN;
  private pathCamY = Number.NaN;
  private pathZoom = Number.NaN;
  private pathW = 0;
  private pathH = 0;

  constructor(theme: Theme) {
    this.theme = theme;
    const max = theme.path.maxDots;
    this.which = new Uint8Array(max);
    this.dotRate = new Float32Array(max);
    this.dotSigma = new Float32Array(max);
    this.dotCharge = new Float32Array(max);
    this.object.name = "path";
    this.object.userData.asset = theme.assets.predictedPath;
    const samples = theme.path.maxSamples;
    this.px = new Float32Array(samples);
    this.py = new Float32Array(samples);
    this.pArc = new Float32Array(samples);
    this.pStep = new Float32Array(samples);
    this.pRate = new Float32Array(samples);
    this.pSigma = new Float32Array(samples);
    this.pCharge = new Float32Array(samples);
    this.pWhich = new Uint8Array(samples);
    this.keep = new Int32Array(samples);
    this.offX = new Float32Array(samples);
    this.offY = new Float32Array(samples);
    this.path = makeDots(theme, 5);
    this.path.mesh.name = "path-gold";
    this.line = makeRibbon(samples - 1, theme.path.lineHalfPx, theme.path.lineSoftPx, 2);
    this.line.mesh.name = "predicted-path";
    this.ticks = makeRibbon(256, theme.path.tickHalfWidth, theme.path.tickSoftPx, 6);
    this.ticks.mesh.name = "path-ticks";
    this.orbit = makeDots(theme, 2);
    this.orbit.mesh.name = "orbit";
    this.endRing = new THREE.Mesh(
      new THREE.RingGeometry(theme.path.endRingInner, theme.path.endRingOuter, 48),
      new THREE.MeshBasicMaterial({
        color: theme.colors.path,
        transparent: true,
        opacity: theme.path.endRingAlpha,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.endRing.frustumCulled = false;
    this.endRing.renderOrder = 3;
    this.endRing.visible = false;
    this.ghost = makeDots(theme, 4);
    this.ghost.mesh.name = "path-ghost";
    this.envelopePos = new Float32Array(max * 18);
    const envelopeGeom = new THREE.BufferGeometry();
    envelopeGeom.setAttribute("position", new THREE.BufferAttribute(this.envelopePos, 3));
    envelopeGeom.setDrawRange(0, 0);
    this.envelope = new THREE.Mesh(
      envelopeGeom,
      new THREE.MeshBasicMaterial({
        color: theme.colors.path,
        transparent: true,
        opacity: 0.14,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.envelope.frustumCulled = false;
    this.envelope.renderOrder = 1;
    this.envelope.visible = false;
    this.object.add(
      this.envelope,
      this.line.mesh,
      this.ticks.mesh,
      this.path.mesh,
      this.orbit.mesh,
      this.ghost.mesh,
      this.endRing,
    );
  }

  update(frame: VisualFrame): void {
    const { game, width, height } = frame;
    const planning = game.mode === "planning" || game.mode === "paused";
    if (!planning) {
      this.path.mesh.visible = false;
      this.line.mesh.visible = false;
      this.ticks.mesh.visible = false;
      this.orbit.mesh.visible = false;
      this.ghost.mesh.visible = false;
      this.envelope.visible = false;
      this.endRing.visible = false;
      this.pathPred = null;
      this.fuzzy = false;
      return;
    }
    const camera = game.camera;
    if (
      game.prediction === this.pathPred &&
      camera.x === this.pathCamX &&
      camera.y === this.pathCamY &&
      camera.zoom === this.pathZoom &&
      width === this.pathW &&
      height === this.pathH
    ) {
      const bucket = Math.floor(frame.now / 300);
      if (this.fuzzy && bucket !== this.ghostSet) {
        this.ghostSet = bucket;
        this.drawFuzzy(width, height, frame.now);
      }
      return;
    }
    this.pathPred = game.prediction;
    this.pathCamX = camera.x;
    this.pathCamY = camera.y;
    this.pathZoom = camera.zoom;
    this.pathW = width;
    this.pathH = height;
    this.solar = shipLoadout(game.upgrades).solar;
    this.dt = game.level.dt;
    this.g = game.level.g;
    this.bodies = game.level.bodies;

    let splitStep = game.initial.step;
    const snaps = game.prediction.snapshots;
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].reached) splitStep = snaps[i].step;
    }
    const origin = game.mode === "paused" ? game.ship : game.initial;
    this.chain = game.prediction.path;
    this.spread = hasMagneticBody(game.level.bodies)
      ? spreadAlong(game.prediction.path, game.level.dt, game.level.bodies)
      : [];
    const endSigma = this.spread.length === 0 ? 0 : this.spread[this.spread.length - 1].sigma;
    this.fuzzy = endSigma >= 0.6;
    this.chainPrefix = { x: origin.x, y: origin.y, step: origin.step, rate: origin.rate };
    this.chainClose = false;
    this.useSpread = true;
    const count = this.project(width, height, splitStep);
    const head = srgb01(this.theme.colors.path);
    const tailColor = tailHex(game, this.theme);
    const tail = srgb01(tailColor);
    this.drawStroke(count, head, tail);
    this.drawTicks(count, head, tail);
    this.drawGold(count, head, tail);
    if (count > 0) {
      const last = count - 1;
      this.endRing.position.set(this.px[last], this.py[last], 0);
      this.endRing.visible = true;
      const ringColor = this.pWhich[count - 1] === 0 ? this.theme.colors.path : tailColor;
      (this.endRing.material as THREE.MeshBasicMaterial).color.set(ringColor);
      const grown = this.fuzzy ? (6 + endSigma) / this.theme.path.endRingOuter : 1;
      this.endRing.scale.setScalar(grown);
    } else {
      this.endRing.visible = false;
    }
    this.drawFuzzy(width, height, frame.now);

    const orbit = game.prediction.orbit;
    if (orbit && orbit.length > 2) {
      this.chain = orbit;
      this.chainPrefix = null;
      this.chainClose = true;
      this.useSpread = false;
      const n = this.sample(width, height, this.orbit.centers, -1);
      const mint = srgb01(this.theme.colors.resultWin);
      for (let i = 0; i < n; i++) this.which[i] = 1;
      this.paint(this.orbit.colors, n, mint, mint, false);
      for (let i = 0; i < n; i++) this.orbit.colors[i * 4 + 3] = this.theme.path.orbitAlpha;
      commitDots(this.orbit, n, this.theme.path.dotSpanPx);
    } else {
      this.orbit.mesh.visible = false;
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }

  /**
   * Project the predicted samples onto the stroke. The buffer holds
   * `maxSamples` points; a longer preview (the step cap is above that) is
   * drawn with a stride. Integration is unchanged: every stored sample is
   * still one flight step of `dt`.
   */
  private project(width: number, height: number, splitStep: number): number {
    const total = this.chain.length + (this.chainPrefix ? 1 : 0);
    const max = this.px.length;
    if (total === 0) return 0;
    const stride = Math.max(1, Math.ceil(total / max));
    let count = 0;
    let prevX = 0;
    let prevY = 0;
    let arc = 0;
    for (let i = 0; i < total && count < max; i += stride) {
      const index = i + stride >= total ? total - 1 : i;
      this.read(index);
      projectToScreen(this.cursor.x, this.cursor.y, width, height, this.scratch);
      const x = this.scratch.x;
      const y = height - this.scratch.y;
      if (count > 0) arc += Math.hypot(x - prevX, y - prevY);
      this.px[count] = x;
      this.py[count] = y;
      this.pArc[count] = arc;
      this.pStep[count] = this.cursor.step;
      this.pRate[count] = this.cursor.rate;
      this.pSigma[count] = this.cursor.sigma;
      this.pCharge[count] = this.cursor.charge;
      this.pWhich[count] = this.cursor.step <= splitStep ? 0 : 1;
      count += 1;
      prevX = x;
      prevY = y;
      if (index === total - 1) break;
    }
    return count;
  }

  private drawStroke(
    count: number,
    head: [number, number, number],
    tail: [number, number, number],
  ): void {
    const n = this.compact(count);
    if (n < 2) {
      finishRibbon(this.line, 0);
      return;
    }
    const extent = this.theme.path.lineHalfPx + this.theme.path.lineSoftPx;
    this.miters(n, extent);
    let segs = 0;
    for (let i = 0; i < n - 1 && segs < this.line.maxSegs; i++) {
      const a = this.keep[i];
      const b = this.keep[i + 1];
      const ca = this.tone(a, count, head, tail, true);
      const cb = this.tone(b, count, head, tail, true);
      segs = pushQuad(
        this.line,
        segs,
        this.px[a] + this.offX[i],
        this.py[a] + this.offY[i],
        this.px[a] - this.offX[i],
        this.py[a] - this.offY[i],
        this.px[b] + this.offX[i + 1],
        this.py[b] + this.offY[i + 1],
        this.px[b] - this.offX[i + 1],
        this.py[b] - this.offY[i + 1],
        ca,
        cb,
      );
    }
    finishRibbon(this.line, segs);
  }

  private drawTicks(
    count: number,
    head: [number, number, number],
    tail: [number, number, number],
  ): void {
    if (count < 2) {
      finishRibbon(this.ticks, 0);
      return;
    }
    const every = this.theme.path.tickSeconds;
    const origin = this.pStep[0];
    const end = this.pStep[count - 1];
    const span = (end - origin) * this.dt;
    const extent = this.theme.path.tickHalfWidth + this.theme.path.tickSoftPx;
    const half = this.theme.path.tickHalfLength;
    let segs = 0;
    for (let elapsed = every; elapsed < span - 1e-3 && segs < this.ticks.maxSegs; elapsed += every) {
      const target = origin + elapsed / this.dt;
      let i = 1;
      while (i < count && this.pStep[i] < target) i += 1;
      if (i >= count) break;
      const s0 = this.pStep[i - 1];
      const s1 = this.pStep[i];
      const u = s1 === s0 ? 0 : (target - s0) / (s1 - s0);
      const x = this.px[i - 1] + (this.px[i] - this.px[i - 1]) * u;
      const y = this.py[i - 1] + (this.py[i] - this.py[i - 1]) * u;
      const tx = this.px[i] - this.px[i - 1];
      const ty = this.py[i] - this.py[i - 1];
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      const wx = (tx / len) * extent;
      const wy = (ty / len) * extent;
      const x0 = x - nx * half;
      const y0 = y - ny * half;
      const x1 = x + nx * half;
      const y1 = y + ny * half;
      const arc = this.pArc[i - 1] + (this.pArc[i] - this.pArc[i - 1]) * u;
      const along = this.pArc[count - 1] > 0 ? arc / this.pArc[count - 1] : 0;
      const tone = this.tone(i, count, head, tail, true);
      const alpha = this.theme.path.tickAlpha * (1 - 0.22 * along * along);
      const color: Rgba = [tone[0], tone[1], tone[2], alpha];
      segs = pushQuad(
        this.ticks,
        segs,
        x0 + wx,
        y0 + wy,
        x0 - wx,
        y0 - wy,
        x1 + wx,
        y1 + wy,
        x1 - wx,
        y1 - wy,
        color,
        color,
      );
    }
    finishRibbon(this.ticks, segs);
  }

  private drawGold(
    count: number,
    head: [number, number, number],
    tail: [number, number, number],
  ): void {
    const max = this.theme.path.maxDots;
    if (!(this.solar > 0) || count < 2) {
      commitDots(this.path, 0, this.theme.path.dotSpanPx);
      return;
    }
    const spacing = this.theme.path.spacingPx;
    const total = this.pArc[count - 1];
    const goldRgb = srgb01("#FFD86E");
    let dots = 0;
    for (let mark = 0; mark <= total && dots < max; mark += spacing) {
      const i = this.atArc(count, mark);
      const span = this.pArc[i] - this.pArc[i - 1] || 1;
      const u = Math.min(1, Math.max(0, (mark - this.pArc[i - 1]) / span));
      const charge = this.pCharge[i - 1] + (this.pCharge[i] - this.pCharge[i - 1]) * u;
      const gold = Math.min(1, Math.sqrt(Math.max(0, 1.6 * charge)));
      if (gold <= 0) continue;
      const tone = this.tone(i, count, head, tail, true);
      const rgb = mixRgb([tone[0], tone[1], tone[2]], goldRgb, gold);
      const o = dots * 2;
      this.path.centers[o] = this.px[i - 1] + (this.px[i] - this.px[i - 1]) * u;
      this.path.centers[o + 1] = this.py[i - 1] + (this.py[i] - this.py[i - 1]) * u;
      const c = dots * 4;
      this.path.colors[c] = rgb[0];
      this.path.colors[c + 1] = rgb[1];
      this.path.colors[c + 2] = rgb[2];
      this.path.colors[c + 3] = 1;
      this.dotCharge[dots] = charge;
      dots += 1;
    }
    commitDots(this.path, dots, this.theme.path.dotSpanPx, this.dotCharge);
  }

  /** Drop samples that land on the same pixel so the stroke normal stays defined. */
  private compact(count: number): number {
    if (count === 0) return 0;
    let n = 0;
    this.keep[n] = 0;
    n += 1;
    for (let i = 1; i < count; i++) {
      const prev = this.keep[n - 1];
      const dx = this.px[i] - this.px[prev];
      const dy = this.py[i] - this.py[prev];
      if (dx * dx + dy * dy < 0.04) {
        if (i === count - 1) this.keep[n - 1] = i;
        continue;
      }
      this.keep[n] = i;
      n += 1;
    }
    return n;
  }

  private miters(n: number, extent: number): void {
    for (let i = 0; i < n; i++) {
      const curr = this.keep[i];
      const prev = this.keep[Math.max(0, i - 1)];
      const next = this.keep[Math.min(n - 1, i + 1)];
      const useOut = i === 0;
      const useIn = i === n - 1;
      const ax = this.px[curr] - this.px[prev];
      const ay = this.py[curr] - this.py[prev];
      const bx = this.px[next] - this.px[curr];
      const by = this.py[next] - this.py[curr];
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      const nax = -ay / la;
      const nay = ax / la;
      const nbx = -by / lb;
      const nby = bx / lb;
      let mx = useOut ? nbx : useIn ? nax : nax + nbx;
      let my = useOut ? nby : useIn ? nay : nay + nby;
      let ml = Math.hypot(mx, my);
      if (ml < 0.2) {
        mx = nbx;
        my = nby;
        ml = 1;
      } else {
        mx /= ml;
        my /= ml;
      }
      const refX = useIn ? nax : nbx;
      const refY = useIn ? nay : nby;
      const dot = mx * refX + my * refY;
      const miter = useOut || useIn ? 1 : Math.min(2.4, 1 / Math.max(0.35, Math.abs(dot)));
      this.offX[i] = mx * extent * miter;
      this.offY[i] = my * extent * miter;
    }
  }

  private atArc(count: number, arc: number): number {
    let lo = 1;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pArc[mid] < arc) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Colour at a projected sample. Alpha fades along the arc and tints by clock rate. */
  private tone(
    index: number,
    count: number,
    head: [number, number, number],
    tail: [number, number, number],
    byRate: boolean,
  ): Rgba {
    const total = count > 1 ? this.pArc[count - 1] : 0;
    const along = total > 0 ? this.pArc[index] / total : 0;
    const rate = this.pRate[index];
    const slow = 1 - Math.min(1, Math.max(0, rate));
    const glow = slow * slow;
    const base = this.pWhich[index] === 0 ? head : tail;
    const hot = srgb01(this.theme.colors.starCorona);
    const tinted = byRate ? mixRgb(base, hot, glow) : base;
    const sigma = this.pSigma[index];
    let alpha = this.theme.path.headAlpha * (1 - along * along);
    if (sigma >= 0.6) alpha *= Math.max(0.18, 0.7 - sigma / 40) / 0.7;
    if (byRate && sigma < 0.6 && glow > 0) {
      const lifted = alpha + glow * this.theme.path.glowLift;
      alpha = Math.max(alpha, Math.min(this.theme.path.alphaCap, lifted));
    }
    return [tinted[0], tinted[1], tinted[2], alpha];
  }

  private sample(width: number, height: number, centers: Float32Array, splitStep: number): number {
    const total = this.chain.length + (this.chainPrefix ? 1 : 0) + (this.chainClose ? 1 : 0);
    const max = this.theme.path.maxDots;
    const spacing = this.theme.path.spacingPx;
    if (total === 0) return 0;
    this.read(0);
    projectToScreen(this.cursor.x, this.cursor.y, width, height, this.scratch);
    let prevX = this.scratch.x;
    let prevY = this.scratch.y;
    centers[0] = prevX;
    centers[1] = height - prevY;
    this.which[0] = this.cursor.step <= splitStep ? 0 : 1;
    this.dotRate[0] = this.cursor.rate;
    this.dotSigma[0] = this.cursor.sigma;
    this.dotCharge[0] = this.cursor.charge;
    let prevRate = this.cursor.rate;
    let prevSigma = this.cursor.sigma;
    let prevCharge = this.cursor.charge;
    let count = 1;
    let carry = 0;
    for (let i = 1; i < total && count < max; i++) {
      this.read(i);
      const step = this.cursor.step;
      const curRate = this.cursor.rate;
      const curSigma = this.cursor.sigma;
      const curCharge = this.cursor.charge;
      projectToScreen(this.cursor.x, this.cursor.y, width, height, this.scratch);
      const curX = this.scratch.x;
      const curY = this.scratch.y;
      const seg = Math.hypot(curX - prevX, curY - prevY);
      let t = spacing - carry;
      while (t <= seg && count < max) {
        const u = seg > 0 ? t / seg : 0;
        const x = prevX + (curX - prevX) * u;
        const y = prevY + (curY - prevY) * u;
        const o = count * 2;
        centers[o] = x;
        centers[o + 1] = height - y;
        this.which[count] = step <= splitStep ? 0 : 1;
        this.dotRate[count] = prevRate + (curRate - prevRate) * u;
        this.dotSigma[count] = prevSigma + (curSigma - prevSigma) * u;
        this.dotCharge[count] = prevCharge + (curCharge - prevCharge) * u;
        count += 1;
        t += spacing;
      }
      carry = (carry + seg) % spacing;
      prevX = curX;
      prevY = curY;
      prevRate = curRate;
      prevSigma = curSigma;
      prevCharge = curCharge;
    }
    return count;
  }

  private read(index: number): void {
    if (this.chainPrefix && index === 0) {
      this.cursor.x = this.chainPrefix.x;
      this.cursor.y = this.chainPrefix.y;
    this.cursor.step = this.chainPrefix.step;
    this.cursor.rate = this.chainPrefix.rate;
    this.cursor.sigma = 0;
    this.cursor.charge = this.chargeAt(this.cursor.x, this.cursor.y, this.cursor.step);
    return;
  }
  const i = index - (this.chainPrefix ? 1 : 0);
  const point = i < this.chain.length ? this.chain[i] : this.chain[0];
  this.cursor.x = point.x;
  this.cursor.y = point.y;
  this.cursor.step = point.step ?? i;
  this.cursor.rate = point.rate ?? 1;
  this.cursor.sigma = this.useSpread ? (this.spread[i]?.sigma ?? 0) : 0;
  this.cursor.charge = this.useSpread ? this.chargeAt(point.x, point.y, this.cursor.step) : 0;
}

  private paint(
    colors: Float32Array,
    count: number,
    head: [number, number, number],
    tail: [number, number, number],
    byRate: boolean,
  ): void {
    const split = Math.floor(count * this.theme.path.dimAfter);
    const hot = srgb01(this.theme.colors.starCorona);
    for (let i = 0; i < count; i++) {
      const rate = this.dotRate[i];
      const slow = 1 - Math.min(1, Math.max(0, rate));
      const glow = slow * slow;
      const base = this.which[i] === 0 ? head : tail;
      const tinted = byRate ? mixRgb(base, hot, glow) : base;
      const sigma = this.dotSigma[i];
      const charge = this.dotCharge[i];
      const gold = Math.min(1, Math.sqrt(Math.max(0, 1.6 * charge)));
      const rgb = gold > 0 ? mixRgb(tinted, srgb01("#FFD86E"), gold) : tinted;
      const o = i * 4;
      colors[o] = rgb[0];
      colors[o + 1] = rgb[1];
      colors[o + 2] = rgb[2];
      const faded = sigma >= 0.6 ? Math.max(0.18, 0.7 - sigma / 40) : i < split ? this.theme.path.sureAlpha : this.theme.path.dimAlpha;
      const lift = byRate && sigma < 0.6 ? glow * this.theme.path.glowLift : 0;
      colors[o + 3] = gold > 0 ? 1 : Math.min(this.theme.path.alphaCap, faded + lift);
    }
  }

  private chargeAt(x: number, y: number, step: number): number {
    if (!(this.solar > 0)) return 0;
    const rate = solarRechargeRate(x, y, step * this.dt, this.bodies, this.solar, this.g);
    return Math.min(1, rate / this.solar);
  }

  private drawFuzzy(width: number, height: number, now: number): void {
    if (!this.fuzzy || this.spread.length < 2) {
      this.envelope.visible = false;
      this.ghost.mesh.visible = false;
      return;
    }
    const zoom = Math.max(this.pathZoom, 0.18);
    const limit = this.envelopePos.length / 3;
    const stride = Math.max(1, Math.ceil(this.spread.length / 120));
    let verts = 0;
    let ghosts = 0;
    const set = Math.floor(now / 300) % 2;
    this.ghostSet = Math.floor(now / 300);
    const ghostRgb = srgb01("#E9DCFF");
    let prev: { x: number; y: number; sigma: number } | null = null;
    for (let i = 0; i < this.spread.length; i += stride) {
      const point = this.spread[i];
      if (point.sigma < 0.6) {
        prev = null;
        continue;
      }
      projectToScreen(point.x, point.y, width, height, this.scratch);
      const sx = this.scratch.x;
      const sy = height - this.scratch.y;
      if (ghosts < this.theme.path.maxDots) {
        const h = Math.sin(i * 12.9898 + set * 78.233) * 43758.5453;
        const f = h - Math.floor(h);
        const ang = f * Math.PI * 2;
        const rad = (0.25 + 0.7 * Math.abs(Math.sin(h * 1.7))) * point.sigma * zoom;
        this.ghost.centers[ghosts * 2] = sx + Math.cos(ang) * rad;
        this.ghost.centers[ghosts * 2 + 1] = sy + Math.sin(ang) * rad;
        this.ghost.colors[ghosts * 4] = ghostRgb[0];
        this.ghost.colors[ghosts * 4 + 1] = ghostRgb[1];
        this.ghost.colors[ghosts * 4 + 2] = ghostRgb[2];
        this.ghost.colors[ghosts * 4 + 3] = ghosts % 2 === 0 ? 0.45 : 0.1;
        ghosts += 1;
      }
      if (prev && verts + 6 <= limit) {
        const dx = sx - prev.x;
        const dy = sy - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * prev.sigma * zoom;
        const ny = (dx / len) * prev.sigma * zoom;
        const mx = (-dy / len) * point.sigma * zoom;
        const my = (dx / len) * point.sigma * zoom;
        this.envelopePos.set(
          [
            prev.x + nx, prev.y + ny, 0,
            prev.x - nx, prev.y - ny, 0,
            sx + mx, sy + my, 0,
            prev.x - nx, prev.y - ny, 0,
            sx - mx, sy - my, 0,
            sx + mx, sy + my, 0,
          ],
          verts * 3,
        );
        verts += 6;
      }
      prev = { x: sx, y: sy, sigma: point.sigma };
    }
    const geometry = this.envelope.geometry;
    geometry.setDrawRange(0, verts);
    geometry.attributes.position.needsUpdate = true;
    this.envelope.visible = verts > 0;
    commitDots(this.ghost, ghosts, 3.2);
  }
}

type Rgba = [number, number, number, number];

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function tailHex(game: VisualFrame["game"], theme: Theme): string {
  const forecast = game.prediction;
  const hasBurn = game.nodes.some((node) => Math.hypot(node.dvx, node.dvy) >= 0.05);
  if (forecast.status === "won") return theme.colors.resultWin;
  if (forecast.status === "crashed") return theme.colors.resultCrash;
  if (hasBurn && forecast.status === "lost" && forecast.lostReason === "flyby") return theme.colors.trail;
  return theme.colors.path;
}

function makeDots(theme: Theme, order: number): Dots {
  const max = theme.path.maxDots;
  const centers = new Float32Array(max * 2);
  const colors = new Float32Array(max * 4);
  const quadPos = new Float32Array(max * 6 * 3);
  const quadCol = new Float32Array(max * 6 * 4);
  const uvs = new Float32Array(max * 6 * 2);
  const cornerUv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  for (let i = 0; i < max; i++) uvs.set(cornerUv, i * 12);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(quadPos, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(quadCol, 4));
  geometry.setAttribute("aUv", new THREE.BufferAttribute(uvs, 2));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: {
        uSpan: { value: theme.path.dotSpanPx },
        uRadius: { value: theme.path.dotRadiusPx },
        uSoft: { value: theme.path.dotSoftPx },
      },
      vertexShader: dotVert,
      fragmentShader: dotFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return { mesh, centers, colors, quadPos, quadCol };
}

function makeRibbon(maxSegs: number, core: number, soft: number, order: number): Ribbon {
  const verts = Math.max(1, maxSegs) * 6;
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 4);
  const across = new Float32Array(verts);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(col, 4));
  geometry.setAttribute("aAcross", new THREE.BufferAttribute(across, 1));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: core },
        uSoft: { value: soft },
      },
      vertexShader: strokeVert,
      fragmentShader: strokeFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.visible = false;
  return { mesh, pos, col, across, maxSegs: Math.max(1, maxSegs) };
}

/** One quad. Corners are start-left, start-right, end-left, end-right. */
function pushQuad(
  ribbon: Ribbon,
  cursor: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  c0: Rgba,
  c1: Rgba,
): number {
  if (cursor >= ribbon.maxSegs) return cursor;
  const v = cursor * 6;
  const xy = [ax, ay, bx, by, cx, cy, bx, by, dx, dy, cx, cy];
  const across = [1, -1, 1, -1, -1, 1];
  const colors = [c0, c0, c1, c0, c1, c1];
  for (let k = 0; k < 6; k++) {
    const p = (v + k) * 3;
    ribbon.pos[p] = xy[k * 2];
    ribbon.pos[p + 1] = xy[k * 2 + 1];
    ribbon.pos[p + 2] = 0;
    ribbon.across[v + k] = across[k];
    const c = (v + k) * 4;
    const color = colors[k];
    ribbon.col[c] = color[0];
    ribbon.col[c + 1] = color[1];
    ribbon.col[c + 2] = color[2];
    ribbon.col[c + 3] = color[3];
  }
  return cursor + 1;
}

function finishRibbon(ribbon: Ribbon, segs: number): void {
  const geometry = ribbon.mesh.geometry;
  geometry.setDrawRange(0, segs * 6);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.aColor.needsUpdate = true;
  geometry.attributes.aAcross.needsUpdate = true;
  ribbon.mesh.visible = segs > 0;
}

function commitDots(dots: Dots, count: number, span: number, charge?: Float32Array): void {
  const pos = dots.quadPos;
  const col = dots.quadCol;
  for (let i = 0; i < count; i++) {
    const x = dots.centers[i * 2];
    const y = dots.centers[i * 2 + 1];
    const grown = charge ? 1 + 0.85 * Math.min(1, 1.4 * charge[i]) : 1;
    const r = (span / 2) * grown;
    const cr = dots.colors[i * 4];
    const cg = dots.colors[i * 4 + 1];
    const cb = dots.colors[i * 4 + 2];
    const ca = dots.colors[i * 4 + 3];
    const v = i * 18;
    pos[v] = x - r;
    pos[v + 1] = y - r;
    pos[v + 3] = x + r;
    pos[v + 4] = y - r;
    pos[v + 6] = x + r;
    pos[v + 7] = y + r;
    pos[v + 9] = x - r;
    pos[v + 10] = y - r;
    pos[v + 12] = x + r;
    pos[v + 13] = y + r;
    pos[v + 15] = x - r;
    pos[v + 16] = y + r;
    const c = i * 24;
    for (let k = 0; k < 24; k += 4) {
      col[c + k] = cr;
      col[c + k + 1] = cg;
      col[c + k + 2] = cb;
      col[c + k + 3] = ca;
    }
  }
  const geometry = dots.mesh.geometry;
  geometry.setDrawRange(0, count * 6);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.aColor.needsUpdate = true;
  dots.mesh.visible = count > 0;
}
