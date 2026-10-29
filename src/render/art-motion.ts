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
