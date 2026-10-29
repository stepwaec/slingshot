/**
 * Motion taken from the SVG timelines. Cosmetic only: nothing here is read
 * by the sim. Prominence curves are the star.svg spline written as
 * `sin²`, which peaks halfway through each cycle. The flare is the 22 s
 * wedge in that file.
 */

export const SUN_PROMINENCES = [
  { id: "starProm1", angle: 147.5, begin: 0, dur: 12 },
  { id: "starProm2", angle: 243.6, begin: 5, dur: 16 },
  { id: "starProm3", angle: 314.8, begin: 9, dur: 14 },
] as const;

/** design/assets/star.svg: #starBreathe scale 1 → 1.03 → 1 → 0.97 → 1 over 6 s. t = 0 is rest. */
export const SUN_BREATHE_PERIOD = 6;
export const SUN_BREATHE_AMP = 0.03;
/** #starWispRing rotates 0 → −360° over 300 s. */
export const SUN_WISP_PERIOD = 300;
/** #starFlameRing rotates 0 → +360° over 200 s. */
export const SUN_FLAME_PERIOD = 200;
/**
 * Granulation turn. star.svg bakes the disc still; LU1 scrolls the cells
 * once per 90 s, inside the 60–180 s surface range in style.md.
 */
export const SUN_GRAIN_PERIOD = 90;

export function sunBreathe(seconds: number): number {
  return 1 + SUN_BREATHE_AMP * Math.sin((Math.PI * 2 * seconds) / SUN_BREATHE_PERIOD);
}

export function sunWispAngle(seconds: number): number {
  return -((Math.PI * 2 * seconds) / SUN_WISP_PERIOD);
}

export function sunFlameAngle(seconds: number): number {
  return (Math.PI * 2 * seconds) / SUN_FLAME_PERIOD;
}

export function sunGrainAngle(seconds: number): number {
  return (Math.PI * 2 * seconds) / SUN_GRAIN_PERIOD;
}

/** Wrapped 0..1 phase. */
export function cyclePhase(seconds: number, dur: number): number {
  const span = dur > 0 ? dur : 1;
  return (((seconds % span) + span) % span) / span;
}

/** A strip's SMIL translate, in SVG pixels, at `seconds`. */
export function stripScroll(seconds: number, dur: number, distance: number): number {
  return cyclePhase(seconds, dur) * distance;
}

/**
 * Where a scrolling strip's texture window sits.
 * `left` is the strip x under the disc's left limb. Y is image-space after
 * the canvas flip: v = 0 is the south edge of the texture.
 */
export function stripWindow(
  svgRadius: number,
  tx: number,
  ty: number,
  originX: number,
  originY: number,
  viewW: number,
  viewH: number,
  scroll: number,
): { offsetX: number; repeatX: number; offsetY: number; repeatY: number } {
  const left = -svgRadius - tx - scroll;
  const south = svgRadius - ty;
  const north = -svgRadius - ty;
  const vSouth = 1 - (south - originY) / viewH;
  const vNorth = 1 - (north - originY) / viewH;
  return {
    offsetX: (left - originX) / viewW,
    repeatX: (2 * svgRadius) / viewW,
    offsetY: vSouth,
    repeatY: vNorth - vSouth,
  };
}

/** design/assets/planet-x.svg halo: 1 → 1.04 → 1 → 0.96 → 1 over 2.4 s. */
export function haloBreathe(seconds: number): number {
  return 1 + 0.04 * Math.sin((Math.PI * 2 * seconds) / 2.4);
}

/** design/assets/bodies/comet.svg coma: 1 → 1.04 → 1 over 5 s. */
export function comaBreathe(seconds: number): number {
  return 1 + 0.04 * Math.sin(Math.PI * cyclePhase(seconds, 5));
}

/** design/assets/bodies/red-giant.svg atmosphere: ±2 % over 10 s. */
export function atmosphereBreathe(seconds: number): number {
  return 1 + 0.02 * Math.sin((Math.PI * 2 * seconds) / 10);
}

/** Drag-ring dash offset, SVG px. -8 px/s, period 16 (dash 10 6). */
export function dragDashOffset(seconds: number): number {
  const period = 16;
  return (((-8 * seconds) % period) + period) % period;
}

/** Linear sample between SVG keyTimes. t = 0 returns the first value. */
export function keyedValue(
  seconds: number,
  dur: number,
  times: readonly number[],
  values: readonly number[],
): number {
  const u = cyclePhase(seconds, dur);
  let i = 0;
  while (i < times.length - 1 && u >= (times[i + 1] ?? 1)) i += 1;
  const t0 = times[i] ?? 0;
  const t1 = times[i + 1] ?? 1;
  const f = t1 > t0 ? (u - t0) / (t1 - t0) : 0;
  const a = values[i] ?? 0;
  const b = values[Math.min(values.length - 1, i + 1)] ?? a;
  return a * (1 - f) + b * f;
}

/**
 * Magnetar starquake, design/assets/bodies/magnetar.svg.
 * Radius stays 9 until 0.85 of the 18 s cycle, then runs out to 150.
 */
export function starquake(seconds: number): { radius: number; stroke: number; flash: number } {
  const times = [0, 0.85, 0.9167, 1];
  return {
    radius: keyedValue(seconds, 18, times, [9, 9, 150, 150]),
    stroke: keyedValue(seconds, 18, times, [0, 0.9, 0, 0]),
    flash: keyedValue(seconds, 18, [0, 0.85, 0.86, 0.9, 1], [0, 0, 0.8, 0, 0]),
  };
}

/** Knot alpha along the 9 s trip. design/assets/bodies/comet.svg. */
export function knotOpacity(seconds: number): number {
  return keyedValue(seconds, 9, [0, 0.08, 0.5, 1], [0, 0.8, 0.5, 0]);
}

/** Knot centre in comet-local SVG pixels, y down. x 40 → 400, y 0 → -6. */
export function knotPoint(seconds: number): { x: number; y: number } {
  const u = cyclePhase(seconds, 9);
  return { x: 40 + (400 - 40) * u, y: -6 * u };
}

/** SVG beam tip, in the pulsar viewBox. Pulse's damage reach replaces this. */
export const PULSAR_SVG_REACH = 228;

export function prominenceWindow(seconds: number, begin: number, dur: number): { scale: number; opacity: number } {
  const span = dur > 0 ? dur : 1;
  const wrapped = ((seconds - begin) % span + span) % span;
  const bell = Math.sin(Math.PI * (wrapped / span));
  const opacity = bell * bell;
  return { scale: 0.6 + 0.4 * opacity, opacity };
}

/** 0 except a peak of 1 at 13.9 s of each 22 s cycle. */
export function flareOpacity(seconds: number): number {
  const u = ((seconds % 22) + 22) % 22 / 22;
  const rise = 0.5909;
  const peak = 0.6318;
  const fall = 0.6727;
  if (u < rise || u >= fall) return 0;
  if (u < peak) return (u - rise) / (peak - rise);
  return (fall - u) / (fall - peak);
}

/**
 * Tail stretch from `comet.svg`: `s = clamp(Rperi / d, 0.35, 1)`,
 * then the group scale is `(s, 0.6 + 0.4 s)`. The head is not scaled.
 */
export function cometTailStretch(distance: number, periapsis: number): { along: number; across: number } {
  const dist = distance > 1e-6 ? distance : 1e-6;
  const peri = periapsis > 0 ? periapsis : dist;
  const along = Math.min(1, Math.max(0.35, peri / dist));
  return { along, across: 0.6 + 0.4 * along };
}

/**
 * Dust strands curve to SVG +y, which lags a counterclockwise pass.
 * Flip local y when the comet goes the other way (`comet.svg` header).
 * `r` is star → comet, `v` is the comet's velocity relative to that star.
 */
export function cometDustMirror(rx: number, ry: number, vx: number, vy: number): number {
  const spin = rx * vy - ry * vx;
  return spin < 0 ? -1 : 1;
}

export function ellipsePeriapsis(a: number | undefined, e: number | undefined, radius: number | undefined): number {
  if (a !== undefined && e !== undefined) return a * (1 - e);
  return radius !== undefined && radius > 0 ? radius : 1;
}

/**
 * Body keeps `radius / svgRadius`. Beams are squashed along their axis so
 * the tip at `PULSAR_SVG_REACH` lands on `reach`.
 */
export function pulsarBeamScale(radius: number, svgRadius: number, reach: number): { sx: number; sy: number } {
  const sx = svgRadius > 0 ? radius / svgRadius : 1;
  const sy = reach > 0 ? reach / PULSAR_SVG_REACH : sx;
  return { sx, sy };
}

/** Mass over distance squared. The same rule the planet sprites already use. */
export function brightestOffset(
  samples: readonly { x: number; y: number; mass: number }[],
  x: number,
  y: number,
): { x: number; y: number } | null {
  let best = 0;
  let aim: { x: number; y: number } | null = null;
  for (const sample of samples) {
    const dx = sample.x - x;
    const dy = sample.y - y;
    const d2 = dx * dx + dy * dy;
    if (!(d2 > 1) || !(sample.mass > 0)) continue;
    const weight = sample.mass / d2;
    if (weight > best) {
      best = weight;
      aim = { x: dx, y: dy };
    }
  }
  return aim;
}
