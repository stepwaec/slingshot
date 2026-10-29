/**
 * Clock HUD text. Pure: no DOM.
 *
 * Values use three significant figures, and never finer than a centisecond,
 * which is the resolution of a 1/60 step. Trend arrows latch with a deadband
 * so a one-step wobble does not flip them.
 */

export type Trend = "rising" | "falling" | "steady";

/** Outside-seconds per ship-second must move by this much to change the rate arrow. */
export const RATE_DEADBAND = 0.02;
/** Gap, in seconds, required to leave steady or to reverse. */
export const GAP_DEADBAND = 0.05;
/** Deadline margin, in seconds, required to leave steady or to reverse. */
export const MARGIN_DEADBAND = 0.05;

export interface TrendLatch {
  trend: Trend;
  /** Extreme raw value in the current direction. The steady anchor otherwise. */
  mark: number;
}

export interface ClockLatches {
  rate: TrendLatch;
  gap: TrendLatch;
  margin: TrendLatch;
}

export interface ClockTexts {
  rate: string;
  gap: string;
  margin: string;
  rateTrend: Trend;
  gapTrend: Trend;
  marginTrend: Trend;
}

export function trendArrow(trend: Trend): string {
  if (trend === "rising") return "↑";
  if (trend === "falling") return "↓";
  return "→";
}

export function openTrend(value: number): TrendLatch {
  return { trend: "steady", mark: value };
}

/**
 * Schmitt trigger. Inside the deadband the previous arrow stays, which is
 * what keeps a noisy digit from flickering.
 */
export function stepTrend(latch: TrendLatch, value: number, deadband: number): Trend {
  if (!Number.isFinite(value)) return latch.trend;
  const band = deadband > 0 && Number.isFinite(deadband) ? deadband : 0;
  if (latch.trend === "rising") {
    if (value > latch.mark) latch.mark = value;
    else if (latch.mark - value > band) {
      latch.trend = "falling";
      latch.mark = value;
    }
    return latch.trend;
  }
  if (latch.trend === "falling") {
    if (value < latch.mark) latch.mark = value;
    else if (value - latch.mark > band) {
      latch.trend = "rising";
      latch.mark = value;
    }
    return latch.trend;
  }
  if (value > latch.mark + band) {
    latch.trend = "rising";
    latch.mark = value;
  } else if (value < latch.mark - band) {
    latch.trend = "falling";
    latch.mark = value;
  }
  return latch.trend;
}

interface Rounded {
  value: number;
  decimals: number;
}

function exponent(magnitude: number): number {
  const guessed = Math.floor(Math.log10(magnitude));
  const floor = 10 ** guessed;
  if (magnitude < floor) return guessed - 1;
  if (magnitude >= floor * 10 * (1 - 1e-12)) return guessed + 1;
  return guessed;
}

/** Three significant figures, capped at centiseconds and at whole numbers above 100. */
export function roundSig(value: number, sig = 3): Rounded {
  if (!Number.isFinite(value) || value === 0) return { value: 0, decimals: 2 };
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  let decimals = decimalsFor(magnitude, sig);
  let rounded = Math.round(magnitude * 10 ** decimals) / 10 ** decimals;
  if (rounded === 0) return { value: 0, decimals: 2 };
  const bumped = decimalsFor(rounded, sig);
  if (bumped !== decimals) {
    decimals = bumped;
    rounded = Math.round(magnitude * 10 ** decimals) / 10 ** decimals;
  }
  return { value: sign * rounded, decimals };
}

function decimalsFor(magnitude: number, sig: number): number {
  let decimals = sig - 1 - exponent(magnitude);
  if (decimals < 0) decimals = 0;
  if (decimals > 2) decimals = 2;
  return decimals;
}

/** Rounded text. Zero is `0`. Negatives keep their sign. No forced plus. */
export function formatSig(value: number, sig = 3): string {
  const rounded = roundSig(value, sig);
  if (rounded.value === 0) return "0";
  const sign = rounded.value < 0 ? "-" : "";
  return sign + Math.abs(rounded.value).toFixed(rounded.decimals);
}

function withSign(value: number, forcePlus: boolean): string {
  const text = formatSig(value);
  if (forcePlus && roundSig(value).value > 0) return `+${text}`;
  return text;
}

/** `1 ship s = N outside s`, or `time stopped` when the rate has hit the floor. */
export function formatClockRate(rate: number): string {
  if (!(rate > 1e-4)) return "time stopped";
  return `1 ship s = ${formatSig(1 / rate)} outside s`;
}

function rateSignal(rate: number): number {
  if (!(rate > 1e-4) || !Number.isFinite(rate)) return 1 / 1e-4;
  return 1 / rate;
}

export function createClockLatches(rate: number, gap: number, margin: number): ClockLatches {
  return {
    rate: openTrend(rateSignal(rate)),
    gap: openTrend(gap),
    margin: openTrend(margin),
  };
}

/**
 * Advance the three arrows and format the three readouts.
 * `margin` is outside time still left before the deadline (negative when late).
 */
export function readClocks(latches: ClockLatches, rate: number, gap: number, margin: number): ClockTexts {
  const rateTrend = stepTrend(latches.rate, rateSignal(rate), RATE_DEADBAND);
  const gapTrend = stepTrend(latches.gap, gap, GAP_DEADBAND);
  const marginTrend = stepTrend(latches.margin, margin, MARGIN_DEADBAND);
  return {
    rate: `${formatClockRate(rate)} ${trendArrow(rateTrend)}`,
    gap: `Gap ${withSign(gap, true)} s ${trendArrow(gapTrend)}`,
    margin: `Margin ${withSign(margin, false)} s ${trendArrow(marginTrend)}`,
    rateTrend,
    gapTrend,
    marginTrend,
  };
}
