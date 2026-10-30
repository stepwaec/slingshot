/**
 * Pure timings for the WP12 drawings.
 * Headers: design/assets/bodies/supernova-progenitor.svg, events/supernova-*.svg,
 * bodies/quasar.svg, events/quasar-sweep.svg. Colours live in the palette.
 * These functions do not read or write the simulation.
 */

import type { QuasarJet } from "../sim/events";
import { jetAngle } from "../sim/events";
import { formatClock } from "./event-look";
import type { Theme } from "./theme";

/** supernova-progenitor.svg: scale 0.38 → 0.41 → 0.37 → 0.43 → 0.38. */
const BREATHE_KEYS = [0, 0.2, 0.45, 0.8, 1];
const BREATHE_SCALES = [0.38, 0.41, 0.37, 0.43, 0.38];
const BREATHE_REST = 0.38;

export interface FlashLook {
  radius: number;
  alpha: number;
}

export interface FilamentSpec {
  angle: number;
  /** Fractional radial offset, within ±jitter. */
  jitter: number;
  lengthPx: number;
  widthPx: number;
  /** 0 hydrogen, 1 oxygen, 2 sulfur, 3 the magenta. */
  color: number;
  restAlpha: number;
}

/** Uneven breathing as a multiplier on the rest scale. 1 at t = 0. */
export function progenitorScale(seconds: number, period: number): number {
  const u = period > 0 ? (((seconds % period) + period) % period) / period : 0;
  let i = 0;
  while (i < BREATHE_KEYS.length - 1 && u > BREATHE_KEYS[i + 1]) i += 1;
  const span = BREATHE_KEYS[i + 1] - BREATHE_KEYS[i];
  const t = span > 0 ? (u - BREATHE_KEYS[i]) / span : 0;
  const scale = BREATHE_SCALES[i] + (BREATHE_SCALES[i + 1] - BREATHE_SCALES[i]) * t;
  return scale / BREATHE_REST;
}

/**
 * Shrink through the last `lead` seconds. 0 at and after `at` (the star is gone).
 * The end of the shrink is the header's 0.30 / 0.38.
 */
export function progenitorShrink(time: number, at: number, lead: number, end: number): number {
  if (time >= at) return 0;
  if (!(lead > 0) || time <= at - lead) return 1;
  const u = (time - (at - lead)) / lead;
  return 1 + (end - 1) * u;
}

/** Sample shell radius, in world units, including the outward drift on `frame.now`. */
export function oldShellRadius(bodyRadius: number, sampleRadius: number, seconds: number, spec: Theme["nova"]): number {
  const drawn = spec.sampleStar > 0 ? bodyRadius / spec.sampleStar : bodyRadius;
  const drift = spec.shellDrift * drawn;
  const u = spec.shellPeriod > 0 ? (((seconds % spec.shellPeriod) + spec.shellPeriod) % spec.shellPeriod) / spec.shellPeriod : 0;
  return sampleRadius * drawn + drift * u;
}

/** Countdown arc, 1 at t = 0 and empty at `at`. Clockwise from 12 o'clock. */
export function countdownFraction(time: number, at: number): number {
  if (!(at > 0) || time >= at) return 0;
  if (time <= 0) return 1;
  return 1 - time / at;
}

/** Detonation flash. Radius peaks at `flashPeak × blast`. Alpha is 0 outside the window. */
export function novaFlash(age: number, blast: number, spec: Theme["nova"]): FlashLook {
  if (age < 0 || age >= spec.flashEnd || !(blast > 0)) return { radius: 0, alpha: 0 };
  const peak = spec.flashPeak * blast;
  const r0 = spec.flashRPeak > 0 ? peak * (spec.flashR0 / spec.flashRPeak) : 0;
  const rEnd = spec.flashRPeak > 0 ? peak * (spec.flashREnd / spec.flashRPeak) : peak;
  const radius =
    age <= spec.flashGrow
      ? r0 + (peak - r0) * (age / Math.max(spec.flashGrow, 1e-6))
      : peak + (rEnd - peak) * ((age - spec.flashGrow) / Math.max(spec.flashEnd - spec.flashGrow, 1e-6));
  let alpha: number;
  if (age <= spec.flashRise) alpha = spec.flashRise > 0 ? age / spec.flashRise : 1;
  else if (age <= spec.flashMid) {
    alpha = 1 + (spec.flashMidAlpha - 1) * ((age - spec.flashRise) / Math.max(spec.flashMid - spec.flashRise, 1e-6));
  } else {
    alpha = spec.flashMidAlpha * (1 - (age - spec.flashMid) / Math.max(spec.flashEnd - spec.flashMid, 1e-6));
  }
  return { radius, alpha };
}

/** Filament alpha fades from 1 to its remnant value over `filamentFade` seconds. */
export function filamentAlpha(age: number, rest: number, fade: number): number {
  if (age <= 0) return 1;
  if (!(fade > 0) || age >= fade) return rest;
  return 1 + (rest - 1) * (age / fade);
}

/** Lethal half-width at distance d. The sheath edge is `quasarDamage`'s cone. */
export function jetHalfWidth(distance: number, cone: number): number {
  return distance * Math.tan(cone);
}

function wrap(angle: number): number {
  const turn = Math.PI * 2;
  let value = angle % turn;
  if (value > Math.PI) value -= turn;
  if (value < -Math.PI) value += turn;
  return value;
}

/** True when a point is inside either jet at `time`. Matches `quasarDamage`'s cone test. */
export function pointInJet(dx: number, dy: number, jet: QuasarJet, time: number): boolean {
  const dist = Math.hypot(dx, dy);
  if (!(dist > 1e-6) || dist > jet.reach) return false;
  let delta = Math.abs(wrap(Math.atan2(dy, dx) - jetAngle(jet, time)));
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta < jet.cone;
}

/** True when a point lies in the angles the jet can reach. */
export function pointInSweep(dx: number, dy: number, jet: QuasarJet): boolean {
  const dist = Math.hypot(dx, dy);
  if (!(dist > 1e-6) || dist > jet.reach) return false;
  let delta = Math.abs(wrap(Math.atan2(dy, dx) - jet.angle));
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta < (jet.sweep ?? 0) + jet.cone;
}

/**
 * Seconds from `time` until the jet no longer covers the point.
 * Null when the point is outside the swept zone for the whole period.
 */
export function jetLeaveDelay(dx: number, dy: number, jet: QuasarJet, time: number): number | null {
  if (!pointInSweep(dx, dy, jet)) return null;
  const period = jet.period ?? 0;
  if (!(period > 0) || (jet.sweep ?? 0) === 0) return pointInJet(dx, dy, jet, time) ? Number.POSITIVE_INFINITY : null;
  const steps = 96;
  const dt = period / steps;
  let covering = pointInJet(dx, dy, jet, time);
  if (!covering) {
    for (let i = 1; i <= steps; i += 1) {
      if (pointInJet(dx, dy, jet, time + i * dt)) {
        covering = true;
        continue;
      }
      if (covering) return i * dt;
    }
    return null;
  }
  for (let i = 1; i <= steps; i += 1) {
    if (!pointInJet(dx, dy, jet, time + i * dt)) return i * dt;
  }
  return period;
}

export interface PathSampleLike {
  x: number;
  y: number;
  step: number;
}

export type BlastCall =
  | { kind: "clear"; leave: number; spare: number; x: number; y: number }
  | { kind: "hit"; time: number; x: number; y: number }
  | null;

/**
 * Where the predicted path stands against the lethal disc at `at`.
 * A hit marks the sample at detonation. A clear path reports when it left.
 */
export function blastCall(
  path: readonly PathSampleLike[],
  starX: number,
  starY: number,
  blast: number,
  at: number,
  dt: number,
): BlastCall {
  if (!(blast > 0) || path.length === 0) return null;
  let inside = false;
  let leave = 0;
  let leaveX = starX;
  let leaveY = starY;
  let hit: { time: number; x: number; y: number } | null = null;
  for (let i = 0; i < path.length; i += 1) {
    const sample = path[i];
    const time = sample.step * dt;
    const dist = Math.hypot(sample.x - starX, sample.y - starY);
    const now = dist <= blast;
    if (now && time <= at) {
      inside = true;
      leave = time;
      leaveX = sample.x;
      leaveY = sample.y;
    } else if (inside && !now && time <= at) {
      const prev = path[i - 1];
      const t0 = prev.step * dt;
      const d0 = Math.hypot(prev.x - starX, prev.y - starY);
      const span = dist - d0;
      const u = span === 0 ? 1 : (blast - d0) / span;
      const clamped = Math.min(1, Math.max(0, u));
      leave = t0 + (time - t0) * clamped;
      leaveX = prev.x + (sample.x - prev.x) * clamped;
      leaveY = prev.y + (sample.y - prev.y) * clamped;
      inside = false;
    }
    if (hit === null && time >= at) {
      if (dist <= blast) hit = { time: at, x: sample.x, y: sample.y };
      break;
    }
  }
  if (hit) return { kind: "hit", ...hit };
  if (!(leave > 0) && !inside) return null;
  const spare = at - leave;
  if (!(spare > 0)) return null;
  return { kind: "clear", leave, spare, x: leaveX, y: leaveY };
}

export function supernovaChip(remaining: number): string {
  return `supernova in ${formatClock(remaining)}`;
}

export function blastChip(radius: number): string {
  return `lethal blast r ${Math.round(radius)}`;
}

export function spareChip(leave: number, spare: number): string {
  return `path leaves the blast zone at ${formatClock(leave)} · ${formatClock(spare)} to spare`;
}

export function shockChip(ahead: number): string {
  return `shock +${formatClock(ahead)}`;
}

export function sweepChip(sweep: number, period: number): string {
  const degrees = Math.round((Math.abs(sweep) * 180) / Math.PI);
  return `jet sweeps ±${degrees}° · every ${Math.round(period)} s`;
}

export function safeChip(seconds: number): string {
  return `safe window ${formatClock(seconds)}`;
}

/** mulberry32. Filaments are seeded from the body id, not Math.random. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 5 : 3 : 2 : 1 hydrogen, oxygen, sulfur, magenta. */
const REMNANT_COLORS = [0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3];

export function makeFilaments(seed: number, count: number, detonation: boolean, spec: Theme["nova"]): FilamentSpec[] {
  const rnd = mulberry(seed + (detonation ? 1 : 2));
  const out: FilamentSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const color = detonation ? [0, 2, 1][i % 3] : REMNANT_COLORS[i % REMNANT_COLORS.length];
    const len0 = detonation ? spec.filamentLenDet0 : spec.filamentLenRem0;
    const len1 = detonation ? spec.filamentLenDet1 : spec.filamentLenRem1;
    const width = detonation
      ? spec.filamentWidthDet
      : spec.filamentWidthRem0 + (spec.filamentWidthRem1 - spec.filamentWidthRem0) * rnd();
    out.push({
      angle: rnd() * Math.PI * 2,
      jitter: (rnd() * 2 - 1) * spec.filamentJitter,
      lengthPx: len0 + (len1 - len0) * rnd(),
      widthPx: width,
      color,
      restAlpha: spec.remnantAlpha0 + (spec.remnantAlpha1 - spec.remnantAlpha0) * rnd(),
    });
  }
  return out;
}
