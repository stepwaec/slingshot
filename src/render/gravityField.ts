import { TIME_BANDS, rateAtDisplayS, type TimeBand } from "./palette";
import { theme } from "./theme";
import {
  bodyPose,
  bodyPresent,
  gravityConstant,
  horizonRadius,
  potentialDepth,
  properTimeRate,
  rateFrom,
  type Body,
  type SimConfig,
} from "../sim/physics";

/**
 * Planning gravity field. Depth is `potentialDepth` from the sim — this
 * module does not restate Σ GM / r. The display scale is applied afterwards
 * so a horizon stays finite:
 *
 *   knee   = deepest Φ sampled 3 radii out from any body
 *   scale  = tanh(log1p(Φ / knee) / softness)
 *   height = -scale * amplitude
 *
 * scale(0) = 0, scale is strictly increasing, and scale(∞) = 1.
 *
 * The flat view also pinches the grid in the plane. Mild wells (planets, the
 * sun) still slide along ∇Φ by `distance * PINCH_REACH * scale`, then
 * `clampPinch` keeps that slide inside the cell. A compact body replaces that
 * saturating pull with the funnel in design/assets/overlays/gravity-time.svg:
 * r′ = r_b + (r − r₀)·u/(1+u). The cell clamp stays off where that funnel applies.
 */

export const WELL_SOFTNESS = 1.5;
export const KNEE_RADII = 3;
/** Largest fraction of the distance to a mass a vertex may slide. */
export const PINCH_REACH = 0.55;
/**
 * Largest fraction of a grid cell a sample may leave its rest point.
 * Half a cell would let neighbours meet; staying under that keeps order.
 */
export const PINCH_CELL = 0.45;

export interface GridBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface GravityGrid {
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  stepX: number;
  stepY: number;
  /** Log reference, in the same units as `potentialDepth`. */
  knee: number;
  /** Raw Φ_depth, row-major. May be +∞ on a singularity. */
  depth: Float64Array;
  /** `scaleWellDepth(depth, knee)` before any height multiply. */
  scale: Float64Array;
  /** Rest-frame dτ/dt from `rateFrom`, including dilation strength and cap. */
  rate: Float64Array;
  /** Display x after the in-plane pinch. Finite where `depth` is not. */
  pinchX: Float64Array;
  /** Display y after the in-plane pinch. */
  pinchY: Float64Array;
}

export function scaleWellDepth(depth: number, knee: number, softness = WELL_SOFTNESS): number {
  if (!(depth > 0)) return 0;
  if (!Number.isFinite(depth)) return 1;
  const ref = knee > 1e-9 && Number.isFinite(knee) ? knee : 1;
  const soft = softness > 1e-6 && Number.isFinite(softness) ? softness : WELL_SOFTNESS;
  const scaled = Math.tanh(Math.log1p(depth / ref) / soft);
  return Number.isFinite(scaled) ? scaled : 1;
}

/** World-unit drop of the sheet. 0 stays on the chart plane; 1 is the floor. */
export function wellHeight(scale: number, amplitude: number): number {
  if (!(scale > 0) || !(amplitude > 0)) return 0;
  return -scale * amplitude;
}

/** Φ three radii outside each body. Sets the log slope for this instant. */
export function wellKnee(config: SimConfig, time: number): number {
  let knee = 0;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const pose = bodyPose(body, time, bodies);
    const reach = Math.max(body.radius, 1) * KNEE_RADII;
    const depth = potentialDepth(pose.x + reach, pose.y, config, time);
    if (Number.isFinite(depth) && depth > knee) knee = depth;
  }
  return knee > 0 ? knee : 1;
}

/** Longer side of the system at t = 0, including a margin around each body. */
export function fieldSpan(config: SimConfig): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const pose = bodyPose(body, 0, bodies);
    let reach = Math.max(body.captureRadius ?? 0, body.radius) * 4;
    if (body.orbit) reach += body.orbit.radius;
    minX = Math.min(minX, pose.x - reach);
    maxX = Math.max(maxX, pose.x + reach);
    minY = Math.min(minY, pose.y - reach);
    maxY = Math.max(maxY, pose.y + reach);
  }
  if (!Number.isFinite(minX)) return 1;
  return Math.max(1, maxX - minX, maxY - minY);
}

export function framedBounds(
  camera: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  pad: number,
): GridBounds {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const grow = 1 + (pad > 0 ? pad : 0);
  const halfW = (Math.max(1, width) / (2 * zoom)) * grow;
  const halfH = (Math.max(1, height) / (2 * zoom)) * grow;
  return {
    minX: camera.x - halfW,
    maxX: camera.x + halfW,
    minY: camera.y - halfH,
    maxY: camera.y + halfH,
  };
}

export function gridX(grid: GravityGrid, col: number): number {
  return grid.minX + grid.stepX * col;
}

export function gridY(grid: GravityGrid, row: number): number {
  return grid.minY + grid.stepY * row;
}

export interface Pinch {
  /** World-unit slide from the rest point. Finite. */
  dx: number;
  dy: number;
  /**
   * Compactness weight of the funnel, 0 on a mild well.
   * The cell clamp applies only when this is 0.
   */
  funnel: number;
}

/**
 * Slide `(x, y)` toward the masses. Mild wells keep today's pull: direction is
 * the gradient of `potentialDepth`, length is `nearest * reach * scale`.
 * A compact body blends that with the funnel. Pass the cell steps to clamp the
 * mild part first; the funnel itself is not clamped.
 */
export function pinchTowardMasses(
  x: number,
  y: number,
  config: SimConfig,
  time: number,
  knee: number,
  reach = PINCH_REACH,
  stepX?: number,
  stepY?: number,
): Pinch {
  const mild = mildPinch(x, y, config, time, knee, reach);
  const clamped =
    stepX !== undefined && stepY !== undefined ? clampPinch(mild.dx, mild.dy, stepX, stepY) : mild;
  return applyFunnel(x, y, config, time, clamped.dx, clamped.dy);
}

/** c = r_s / r_b, clamped to 1. A black hole is 1. */
export function bodyCompactness(body: Body, g: number, c: number): number {
  if (body.kind === "blackhole") return 1;
  if (!(body.radius > 0)) return 0;
  const rs = horizonRadius(body.mass, g, c);
  if (!(rs > 0)) return 0;
  if (!Number.isFinite(rs)) return 1;
  return Math.min(1, rs / body.radius);
}

/** smoothstep(0, funnelBlend, c), snapped to 0 below funnelFloor. */
export function funnelWeight(compactness: number): number {
  const blend = theme.gravity.funnelBlend;
  const w = smoothstep01(0, blend > 0 ? blend : 0.6, compactness);
  return w < theme.gravity.funnelFloor ? 0 : w;
}

/**
 * r′ = r_b + (r − r₀)·u/(1+u), u = ((r − r₀)/a)².
 * Null when r ≤ r₀: that sample sits under the disc.
 */
export function funnelRadius(r: number, radius: number, compactness: number): number | null {
  if (!(radius > 0) || !(r > 0)) return null;
  const c = compactness > 0 ? Math.min(1, compactness) : 0;
  const r0 = radius * (1 + theme.gravity.funnelR0 * c);
  const a = radius * (1 + theme.gravity.funnelA * c);
  if (!(r > r0) || !(a > 0)) return null;
  const u = ((r - r0) / a) * ((r - r0) / a);
  return radius + (r - r0) * (u / (1 + u));
}

export function smoothstep01(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (!(span > 0)) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

interface BodyPull {
  body: Body;
  poseX: number;
  poseY: number;
  dx: number;
  dy: number;
  r: number;
  phi: number;
  c: number;
  w: number;
}

function mildPinch(
  x: number,
  y: number,
  config: SimConfig,
  time: number,
  knee: number,
  reach: number,
): Pinch {
  const bodies = config.bodies;
  let nearest = Infinity;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!(body.mass > 0)) continue;
    const pose = bodyPose(body, time, bodies);
    const ox = pose.x - x;
    const oy = pose.y - y;
    const dist = Math.hypot(ox, oy);
    if (dist < nearest) {
      nearest = dist;
      nx = ox;
      ny = oy;
    }
  }
  if (!(nearest > 1e-6) || !Number.isFinite(nearest)) return { dx: 0, dy: 0, funnel: 0 };

  const depth = potentialDepth(x, y, config, time);
  const scale = scaleWellDepth(depth, knee);
  const step = nearest * (reach > 0 ? reach : 0) * scale;
  if (!(step > 0) || !Number.isFinite(step)) return { dx: 0, dy: 0, funnel: 0 };

  const eps = Math.min(nearest * 0.2, Math.max(nearest * 0.05, 1e-3));
  const gx = depthSlope(x, y, eps, 0, config, time);
  const gy = depthSlope(x, y, 0, eps, config, time);
  let dirX = gx;
  let dirY = gy;
  const glen = Math.hypot(gx, gy);
  if (!(glen > 1e-8) || !Number.isFinite(glen)) {
    dirX = nx / nearest;
    dirY = ny / nearest;
  } else {
    dirX = gx / glen;
    dirY = gy / glen;
  }
  const dx = dirX * step;
  const dy = dirY * step;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { dx: 0, dy: 0, funnel: 0 };
  return { dx, dy, funnel: 0 };
}

function rankedPulls(x: number, y: number, config: SimConfig, time: number): BodyPull[] {
  const g = gravityConstant(config);
  const bodies = config.bodies;
  const pulls: BodyPull[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!bodyPresent(body, time) || !(body.mass > 0)) continue;
    const pose = bodyPose(body, time, bodies, g);
    const dx = x - pose.x;
    const dy = y - pose.y;
    const r = Math.hypot(dx, dy);
    const phi = r < 1e-8 ? Number.POSITIVE_INFINITY : (g * body.mass) / r;
    const c = bodyCompactness(body, g, config.c);
    pulls.push({ body, poseX: pose.x, poseY: pose.y, dx, dy, r, phi, c, w: funnelWeight(c) });
  }
  pulls.sort((a, b) => comparePhi(a.phi, b.phi));
  return pulls;
}

function comparePhi(a: number, b: number): number {
  const aInf = !Number.isFinite(a);
  const bInf = !Number.isFinite(b);
  if (aInf && bInf) return 0;
  if (aInf) return -1;
  if (bInf) return 1;
  return b - a;
}

function phiShare(a: number, b: number): number {
  const aInf = !Number.isFinite(a);
  const bInf = !Number.isFinite(b);
  if (aInf && bInf) return 0.5;
  if (aInf) return 1;
  if (bInf) return 0;
  const sum = a + b;
  if (!(sum > 0)) return 0.5;
  return a / sum;
}

/** Display position of one body: mild pinch, or the funnel blended by w. */
function mappedPoint(p: BodyPull, mildX: number, mildY: number): { x: number; y: number } {
  const rb = p.body.radius;
  if (!(p.w > 0) || !(rb > 0) || !(p.r > 1e-8)) return { x: mildX, y: mildY };
  const r0 = rb * (1 + theme.gravity.funnelR0 * p.c);
  const a = rb * (1 + theme.gravity.funnelA * p.c);
  let fx: number;
  let fy: number;
  if (!(p.r > r0) || !(a > 0)) {
    const s = rb / p.r;
    fx = p.poseX + p.dx * s;
    fy = p.poseY + p.dy * s;
  } else {
    const prime = funnelRadius(p.r, rb, p.c);
    const rPrime = prime === null ? rb : prime;
    const s = rPrime / p.r;
    fx = p.poseX + p.dx * s;
    fy = p.poseY + p.dy * s;
  }
  const w = p.w;
  return { x: mildX * (1 - w) + fx * w, y: mildY * (1 - w) + fy * w };
}

function applyFunnel(x: number, y: number, config: SimConfig, time: number, mildDx: number, mildDy: number): Pinch {
  const pulls = rankedPulls(x, y, config, time);
  if (pulls.length === 0) return { dx: mildDx, dy: mildDy, funnel: 0 };
  const mildX = x + mildDx;
  const mildY = y + mildDy;
  const top = pulls[0];
  const second = pulls[1];
  if (!(top.w > 0)) return { dx: mildDx, dy: mildDy, funnel: 0 };
  if (second && top.w > 0 && second.w > 0) {
    const a = mappedPoint(top, mildX, mildY);
    const b = mappedPoint(second, mildX, mildY);
    const share = phiShare(top.phi, second.phi);
    const shownX = a.x * share + b.x * (1 - share);
    const shownY = a.y * share + b.y * (1 - share);
    const w = top.w * share + second.w * (1 - share);
    return { dx: shownX - x, dy: shownY - y, funnel: w };
  }
  const shown = mappedPoint(top, mildX, mildY);
  return { dx: shown.x - x, dy: shown.y - y, funnel: top.w };
}

export interface ContourChip {
  text: string;
  color: string;
  /** World position on the contour. */
  x: number;
  y: number;
  r: number;
  band: TimeBand;
}

/**
 * One chip per visible contour of each mass, at `angleDeg` on the screen
 * (y down). Outer to inner. A chip closer than `gapPx` to the previous one
 * on that body is dropped. `project` maps world to screen pixels.
 */
export function placeContourLabels(
  config: SimConfig,
  time: number,
  project: (x: number, y: number) => { x: number; y: number },
  width: number,
  height: number,
  gamma: number,
  angleDeg: number,
  gapPx: number,
): ContourChip[] {
  const aim = contourAim(angleDeg);
  const g = gravityConstant(config);
  const bodies = config.bodies;
  const order: Body[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!bodyPresent(body, time) || !(body.mass > 0) || !(body.radius > 0)) continue;
    order.push(body);
  }
  order.sort((a, b) => b.mass * g - a.mass * g);
  const chips: ContourChip[] = [];
  for (let i = 0; i < order.length; i++) {
    const body = order[i];
    const pose = bodyPose(body, time, bodies, g);
    let previous: { x: number; y: number } | null = null;
    for (let b = 0; b < TIME_BANDS.length; b++) {
      const band = TIME_BANDS[b];
      const target = rateAtDisplayS(band.sHigh, gamma);
      const rMax = Math.max(body.radius * 80, 1);
      const r = contourRadius(config, time, pose.x, pose.y, aim.x, aim.y, target, body.radius, rMax);
      if (r === null) continue;
      const x = pose.x + aim.x * r;
      const y = pose.y + aim.y * r;
      const screen = project(x, y);
      if (screen.x < 0 || screen.y < 0 || screen.x > width || screen.y > height) continue;
      if (previous) {
        const dist = Math.hypot(screen.x - previous.x, screen.y - previous.y);
        if (dist < gapPx) continue;
      }
      previous = screen;
      chips.push({ text: band.label, color: band.contour, x, y, r, band });
    }
  }
  return chips;
}

/** Screen angle (y down) as a world direction (y up). */
export function contourAim(angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad), y: -Math.sin(rad) };
}

/**
 * Distance from a body along `dir` where the rest-frame rate crosses `target`.
 * Null when the ray never crosses it between `rMin` and `rMax`.
 */
export function contourRadius(
  config: SimConfig,
  time: number,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  targetRate: number,
  rMin: number,
  rMax: number,
): number | null {
  const len = Math.hypot(dirX, dirY);
  if (!(len > 0) || !(rMax > rMin)) return null;
  const ux = dirX / len;
  const uy = dirY / len;
  const at = (r: number) => properTimeRate(originX + ux * r, originY + uy * r, 0, 0, config, time);
  if (!(at(rMin) < targetRate)) return null;
  if (!(at(rMax) > targetRate)) return null;
  let lo = rMin;
  let hi = rMax;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) * 0.5;
    if (at(mid) < targetRate) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/**
 * Keep a slide inside its cell. `stepX` and `stepY` are the rest spacing.
 * A vertex that moves at most `PINCH_CELL` of that spacing cannot pass
 * the neighbour on either side, so the quad cannot fold or spike across it.
 */
export function clampPinch(dx: number, dy: number, stepX: number, stepY: number): Pinch {
  const limitX = Math.abs(stepX) * PINCH_CELL;
  const limitY = Math.abs(stepY) * PINCH_CELL;
  let x = Number.isFinite(dx) ? dx : 0;
  let y = Number.isFinite(dy) ? dy : 0;
  if (limitX > 0) x = Math.max(-limitX, Math.min(limitX, x));
  if (limitY > 0) y = Math.max(-limitY, Math.min(limitY, y));
  return { dx: x, dy: y, funnel: 0 };
}

function depthSlope(
  x: number,
  y: number,
  ex: number,
  ey: number,
  config: SimConfig,
  time: number,
): number {
  const plus = finiteDepth(x + ex, y + ey, config, time);
  const minus = finiteDepth(x - ex, y - ey, config, time);
  if (plus === null && minus === null) return 0;
  if (plus === null) return 1;
  if (minus === null) return -1;
  return plus - minus;
}

function finiteDepth(x: number, y: number, config: SimConfig, time: number): number | null {
  const depth = potentialDepth(x, y, config, time);
  return Number.isFinite(depth) ? depth : null;
}

/**
 * Sample Φ on a regular grid. `depth` is the physics potential, untouched.
 * `scale` is the display transform. Pass `into` to reuse the buffers.
 */
export function sampleGravityGrid(
  config: SimConfig,
  time: number,
  bounds: GridBounds,
  cols: number,
  rows: number,
  into?: GravityGrid,
): GravityGrid {
  const count = cols * rows;
  const grid =
    into && into.cols === cols && into.rows === rows && into.depth.length === count
      ? into
      : {
          cols,
          rows,
          minX: 0,
          minY: 0,
          stepX: 0,
          stepY: 0,
          knee: 1,
          depth: new Float64Array(count),
          scale: new Float64Array(count),
          rate: new Float64Array(count),
          pinchX: new Float64Array(count),
          pinchY: new Float64Array(count),
        };
  if (grid.pinchX.length !== count) {
    grid.pinchX = new Float64Array(count);
    grid.pinchY = new Float64Array(count);
  }
  grid.cols = cols;
  grid.rows = rows;
  grid.minX = bounds.minX;
  grid.minY = bounds.minY;
  grid.stepX = cols > 1 ? (bounds.maxX - bounds.minX) / (cols - 1) : 0;
  grid.stepY = rows > 1 ? (bounds.maxY - bounds.minY) / (rows - 1) : 0;
  grid.knee = wellKnee(config, time);
  const knee = grid.knee;
  const c = config.c;
  for (let row = 0; row < rows; row++) {
    const y = grid.minY + grid.stepY * row;
    const rowOff = row * cols;
    for (let col = 0; col < cols; col++) {
      const x = grid.minX + grid.stepX * col;
      const depth = potentialDepth(x, y, config, time);
      const i = rowOff + col;
      grid.depth[i] = depth;
      grid.scale[i] = scaleWellDepth(depth, knee);
      grid.rate[i] = rateFrom(
        depth,
        0,
        0,
        c,
        config.dilationStrength ?? 1,
        config.dilationCap ?? Number.POSITIVE_INFINITY,
      );
      const pinch = pinchTowardMasses(x, y, config, time, knee, PINCH_REACH, grid.stepX, grid.stepY);
      grid.pinchX[i] = x + pinch.dx;
      grid.pinchY[i] = y + pinch.dy;
    }
  }
  return grid;
}

/**
 * Ink depth from design/assets/overlays/gravity-grid.svg.
 * d = log(1 + Φ/Φ0) / log(1 + Φmax/Φ0). The warp still uses `scaleWellDepth`.
 */
export function inkDepth(phi: number, phi0: number, phiMax: number): number {
  if (!Number.isFinite(phi) || !(phi > 0)) return phi === Number.POSITIVE_INFINITY ? 1 : 0;
  const ref = phi0 > 1e-9 && Number.isFinite(phi0) ? phi0 : 1;
  const max = phiMax > ref && Number.isFinite(phiMax) ? phiMax : ref;
  const denom = Math.log1p(max / ref);
  if (!(denom > 0)) return 0;
  const d = Math.log1p(phi / ref) / denom;
  return Math.min(1, Math.max(0, d));
}

/** Deepest finite sample. Singularities stay out of the denominator and draw as d = 1. */
export function deepestFinite(depth: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < depth.length; i++) {
    const value = depth[i];
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/** t = d^gamma. Colour is sampled at min(1, ramp * t). */
export function inkTone(d: number, gamma: number): number {
  const x = d > 0 ? Math.min(1, d) : 0;
  const g = gamma > 0 ? gamma : 1;
  return Math.pow(x, g);
}

export function rampStop(tone: number, scale: number): number {
  const t = tone > 0 ? tone : 0;
  const s = scale > 0 ? scale : 1;
  return Math.min(1, t * s);
}

/** (base + depth * t + major) * fade. */
export function inkAlpha(tone: number, major: boolean, fade: number, base: number, depth: number, majorBoost: number): number {
  const t = tone > 0 ? Math.min(1, tone) : 0;
  const edge = fade > 0 ? Math.min(1, fade) : 0;
  const extra = major ? majorBoost : 0;
  return Math.max(0, (base + depth * t + extra) * edge);
}

/** z = -H * d^exp. Flat space stays on the plane. A black hole stays at -H. */
export function sheetDrop(d: number, height: number, exponent: number): number {
  if (!(height > 0) || !(d > 0)) return 0;
  const x = Math.min(1, d);
  const exp = exponent > 0 ? exponent : 1;
  return -height * Math.pow(x, exp);
}

/** 0 on the screen edge, 1 once `inset` pixels in. */
export function screenEdgeFade(x: number, y: number, width: number, height: number, inset: number): number {
  if (!(inset > 0) || !(width > 0) || !(height > 0)) return 1;
  const edge = Math.min(x, y, width - x, height - y);
  return Math.max(0, Math.min(1, edge / inset));
}

/** 0 on the outer row, 1 after `cells` steps in. */
export function cellEdgeFade(col: number, row: number, cols: number, rows: number, cells: number): number {
  if (!(cells > 0)) return 1;
  const inset = Math.min(col, row, cols - 1 - col, rows - 1 - row);
  return Math.max(0, Math.min(1, inset / cells));
}

export interface Disc {
  x: number;
  y: number;
  r: number;
}

/**
 * Pieces of AB that sit outside every disc.
 * Lines stop at the disc instead of crossing it.
 */
export function clipSegment(ax: number, ay: number, bx: number, by: number, discs: readonly Disc[]): Array<[number, number, number, number]> {
  let pieces: Array<[number, number, number, number]> = [[ax, ay, bx, by]];
  for (let i = 0; i < discs.length; i++) {
    const disc = discs[i];
    if (!(disc.r > 0)) continue;
    const next: Array<[number, number, number, number]> = [];
    for (let p = 0; p < pieces.length; p++) {
      const piece = pieces[p];
      const clipped = clipDisc(piece[0], piece[1], piece[2], piece[3], disc);
      for (let c = 0; c < clipped.length; c++) next.push(clipped[c]);
    }
    pieces = next;
    if (pieces.length === 0) return pieces;
  }
  return pieces;
}

function clipDisc(ax: number, ay: number, bx: number, by: number, disc: Disc): Array<[number, number, number, number]> {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - disc.x;
  const fy = ay - disc.y;
  const a = dx * dx + dy * dy;
  const inside = (x: number, y: number) => {
    const ox = x - disc.x;
    const oy = y - disc.y;
    return ox * ox + oy * oy < disc.r * disc.r;
  };
  if (!(a > 1e-12)) return inside(ax, ay) ? [] : [[ax, ay, bx, by]];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - disc.r * disc.r;
  const det = b * b - 4 * a * c;
  if (det <= 0) return inside(ax, ay) ? [] : [[ax, ay, bx, by]];
  const root = Math.sqrt(det);
  let t0 = (-b - root) / (2 * a);
  let t1 = (-b + root) / (2 * a);
  if (t0 > t1) {
    const swap = t0;
    t0 = t1;
    t1 = swap;
  }
  if (t1 < 0 || t0 > 1) return inside(ax, ay) ? [] : [[ax, ay, bx, by]];
  const out: Array<[number, number, number, number]> = [];
  const point = (t: number): [number, number] => [ax + dx * t, ay + dy * t];
  if (!inside(ax, ay) && t0 > 1e-4) {
    const end = Math.min(1, t0);
    const [x, y] = point(end);
    out.push([ax, ay, x, y]);
  }
  if (!inside(bx, by) && t1 < 1 - 1e-4) {
    const start = Math.max(0, t1);
    const [x, y] = point(start);
    out.push([x, y, bx, by]);
  }
  return out;
}
