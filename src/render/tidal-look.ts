import { formatClock } from "./event-look";
import { palette } from "./palette";
import { stressLevel, type StressLevel } from "./ship-art";
import { STRESS_WARN, tidalDamageRate, tidalStressAt, type SimConfig } from "../sim/physics";
import { theme } from "./theme";

/**
 * Glyph math for the tidal lattice. Numbers live in `theme.tidal`
 * (design/assets/overlays/tidal-stress.svg). These functions do not draw
 * and do not write the simulation.
 */

const spec = theme.tidal;
const LOG_E = Math.log2(1 + 2 / spec.show);
const LOG_A = Math.log2(1 + 1 / spec.show);

export interface TidalAxes {
  e: number;
  a: number;
  b: number;
}

export interface TidalPaint {
  hex: string;
  level: StressLevel;
  /** Fill alpha. Zero below level 3. */
  fill: number;
  stroke: number;
}

export interface TidalChip {
  text: string;
  x: number;
  y: number;
  seconds: number;
  hull: number;
}

function logArgument(stress: number): number {
  return Math.log2(1 + stress / (spec.show * STRESS_WARN));
}

/** Stretch of the ring. 0 when there is no stress. */
export function tidalEccentricity(stress: number): number {
  if (!(stress > 0)) return 0;
  const e = spec.eccentricityK * (logArgument(stress) / LOG_E);
  return e > spec.eccentricityCap ? spec.eccentricityCap : e;
}

/**
 * Stroke alpha. 0.32 at a vanishing field, 0.92 once S reaches STRESS_WARN.
 * The SVG rounds this to two decimals.
 */
export function tidalStrokeAlpha(stress: number): number {
  const raw = spec.alphaMin + spec.alphaSpan * (logArgument(stress) / LOG_A);
  return raw > spec.alphaMax ? spec.alphaMax : raw;
}

/** Semi-axes in screen pixels. g = 0.26 × 18. */
export function tidalGlyphAxes(stress: number): TidalAxes {
  const e = tidalEccentricity(stress);
  const g = spec.glyph * spec.cell;
  return {
    e,
    a: g * (1 + e),
    b: g / (1 + spec.squeeze * e),
  };
}

/** Colour from `stressLevel`, so the lattice and the HUD chip agree. */
export function tidalRingPaint(stress: number): TidalPaint {
  const level = stressLevel(stress);
  if (level >= 3) {
    return { hex: palette.tidalCritical, level, fill: spec.fillAlpha, stroke: tidalStrokeAlpha(stress) };
  }
  if (level === 2) {
    return { hex: palette.tidalWarn, level, fill: 0, stroke: tidalStrokeAlpha(stress) };
  }
  return { hex: palette.tidalLow, level, fill: 0, stroke: tidalStrokeAlpha(stress) };
}

/** Integer hull when it rounds away from zero, otherwise one decimal. */
export function formatHullCost(hull: number): string {
  const magnitude = Math.abs(hull);
  const rounded = Math.round(magnitude);
  if (rounded !== 0) return String(rounded);
  return (Math.round(magnitude * 10) / 10).toFixed(1);
}

export function tidalChipText(seconds: number, hull: number): string {
  return `path: tidal 3 for ${formatClock(seconds)} · −${formatHullCost(hull)} hull`;
}

interface Run {
  start: number;
  end: number;
  hull: number;
  peak: number;
  peakI: number;
}

function prefer(current: Run | null, next: Run): Run {
  if (!current) return next;
  const currentSteps = current.end - current.start;
  const nextSteps = next.end - next.start;
  if (nextSteps > currentSteps) return next;
  if (nextSteps < currentSteps) return current;
  if (next.hull > current.hull) return next;
  return current;
}

/**
 * Longest planned stretch with S ≥ STRESS_WARN. Duration is the steps
 * covered. Hull is the tidal damage integrated on those samples.
 * The chip sits on the sample where S peaks.
 */
export function tidalPathChip(
  path: readonly { x: number; y: number; step: number }[],
  config: SimConfig,
): TidalChip | null {
  const dt = config.dt;
  if (!(dt > 0) || path.length === 0) return null;
  let best: Run | null = null;
  let run: Run | null = null;
  for (let i = 0; i < path.length; i++) {
    const sample = path[i];
    const stress = tidalStressAt(sample.x, sample.y, config, sample.step * dt);
    if (stress >= STRESS_WARN) {
      if (!run || sample.step !== path[i - 1].step + 1) {
        if (run) best = prefer(best, run);
        run = { start: i, end: i, hull: 0, peak: -1, peakI: i };
      }
      run.end = i;
      run.hull += tidalDamageRate(stress) * dt;
      if (stress > run.peak) {
        run.peak = stress;
        run.peakI = i;
      }
    } else if (run) {
      best = prefer(best, run);
      run = null;
    }
  }
  if (run) best = prefer(best, run);
  if (!best) return null;
  const seconds = (path[best.end].step - path[best.start].step + 1) * dt;
  const at = path[best.peakI];
  return {
    text: tidalChipText(seconds, best.hull),
    x: at.x,
    y: at.y,
    seconds,
    hull: best.hull,
  };
}
