import { bodyPose, potentialDepth, rateFrom, type SimConfig } from "../sim/physics";

/**
 * Planning gravity field. Depth is `potentialDepth` from the sim — this
 * module does not restate Σ GM / r. The display scale is applied afterwards
 * so a horizon stays on the sheet:
 *
 *   knee   = deepest Φ sampled 3 radii out from any body
 *   scale  = tanh(log1p(Φ / knee) / softness)
 *   height = -scale * amplitude
 *
 * scale(0) = 0, scale is strictly increasing, and scale(∞) = 1.
 *
 * The flat view also pinches the grid in the plane. Each vertex moves toward
 * the masses along ∇Φ (samples of `potentialDepth`) by
 * `distance * PINCH_REACH * scale`, then `clampPinch` keeps that slide inside
 * the cell so neighbours cannot cross or fold into a spike.
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
}

/**
 * Slide `(x, y)` toward the masses. Direction is the gradient of
 * `potentialDepth`. Length is `nearest * reach * scale(Φ, knee)`, so a
 * deeper well pulls harder and a point sitting on a body does not move.
 */
export function pinchTowardMasses(
  x: number,
  y: number,
  config: SimConfig,
  time: number,
  knee: number,
  reach = PINCH_REACH,
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
  if (!(nearest > 1e-6) || !Number.isFinite(nearest)) return { dx: 0, dy: 0 };

  const depth = potentialDepth(x, y, config, time);
  const scale = scaleWellDepth(depth, knee);
  const step = nearest * (reach > 0 ? reach : 0) * scale;
  if (!(step > 0) || !Number.isFinite(step)) return { dx: 0, dy: 0 };

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
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { dx: 0, dy: 0 };
  return { dx, dy };
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
  return { dx: x, dy: y };
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
      const pinch = pinchTowardMasses(x, y, config, time, knee);
      const shown = clampPinch(pinch.dx, pinch.dy, grid.stepX, grid.stepY);
      grid.pinchX[i] = x + shown.dx;
      grid.pinchY[i] = y + shown.dy;
    }
  }
  return grid;
}

const CONTOUR_EDGES: readonly (readonly number[])[] = [
  [],
  [0, 3],
  [0, 1],
  [1, 3],
  [1, 2],
  [0, 3, 1, 2],
  [0, 2],
  [2, 3],
  [2, 3],
  [0, 2],
  [0, 1, 2, 3],
  [1, 2],
  [1, 3],
  [0, 1],
  [0, 3],
  [],
];

/**
 * Marching-squares segments where rest-frame dτ/dt crosses `level`.
 * Writes xyz triples and returns the vertex count. The rate values are the
 * ones already stored on the grid (`rateFrom`), not a second formula.
 */
export function writeClockContours(
  grid: GravityGrid,
  level: number,
  positions: Float32Array,
  z: number,
): number {
  const cols = grid.cols;
  const rows = grid.rows;
  let cursor = 0;
  const limit = positions.length - 5;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const i00 = row * cols + col;
      const r00 = grid.rate[i00];
      const r10 = grid.rate[i00 + 1];
      const r01 = grid.rate[i00 + cols];
      const r11 = grid.rate[i00 + cols + 1];
      let mask = 0;
      if (r00 >= level) mask |= 1;
      if (r10 >= level) mask |= 2;
      if (r11 >= level) mask |= 4;
      if (r01 >= level) mask |= 8;
      const edges = CONTOUR_EDGES[mask];
      if (edges.length === 0) continue;
      const i10 = i00 + 1;
      const i01 = i00 + cols;
      const i11 = i00 + cols + 1;
      const x00 = grid.pinchX[i00];
      const y00 = grid.pinchY[i00];
      const x10 = grid.pinchX[i10];
      const y10 = grid.pinchY[i10];
      const x11 = grid.pinchX[i11];
      const y11 = grid.pinchY[i11];
      const x01 = grid.pinchX[i01];
      const y01 = grid.pinchY[i01];
      for (let e = 0; e < edges.length; e++) {
        if (cursor > limit) return cursor / 3;
        const point = contourEdge(edges[e], x00, y00, x10, y10, x11, y11, x01, y01, r00, r10, r11, r01, level);
        positions[cursor] = point.x;
        positions[cursor + 1] = point.y;
        positions[cursor + 2] = z;
        cursor += 3;
      }
    }
  }
  return cursor / 3;
}

function contourEdge(
  edge: number,
  x00: number,
  y00: number,
  x10: number,
  y10: number,
  x11: number,
  y11: number,
  x01: number,
  y01: number,
  r00: number,
  r10: number,
  r11: number,
  r01: number,
  level: number,
): { x: number; y: number } {
  if (edge === 0) return blend(x00, y00, x10, y10, r00, r10, level);
  if (edge === 1) return blend(x10, y10, x11, y11, r10, r11, level);
  if (edge === 2) return blend(x01, y01, x11, y11, r01, r11, level);
  return blend(x00, y00, x01, y01, r00, r01, level);
}

function blend(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  va: number,
  vb: number,
  level: number,
): { x: number; y: number } {
  const d = vb - va;
  const t = d === 0 ? 0.5 : (level - va) / d;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}
