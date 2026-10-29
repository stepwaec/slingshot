import { describe, expect, it } from "vitest";
import {
  GAP_DEADBAND,
  MARGIN_DEADBAND,
  RATE_DEADBAND,
  createClockLatches,
  formatClockRate,
  formatSig,
  openTrend,
  readClocks,
  roundSig,
  stepTrend,
} from "../src/hud/readout";

describe("clock readout", () => {
  it("rounds to three significant figures, and no finer than a centisecond", () => {
    expect(formatSig(1)).toBe("1.00");
    expect(formatSig(1.004)).toBe("1.00");
    expect(formatSig(1.006)).toBe("1.01");
    expect(formatSig(9.996)).toBe("10.0");
    expect(formatSig(26.44)).toBe("26.4");
    expect(formatSig(26.46)).toBe("26.5");
    expect(formatSig(180.4)).toBe("180");
    expect(formatSig(240)).toBe("240");
    expect(formatSig(0.004)).toBe("0");
    expect(formatSig(0.016)).toBe("0.02");
    expect(formatSig(-1.256)).toBe("-1.26");
    expect(formatSig(0)).toBe("0");
    expect(roundSig(1000).decimals).toBe(0);
    expect(formatClockRate(1)).toBe("1 ship s = 1.00 outside s");
    expect(formatClockRate(1 / 26.44)).toBe("1 ship s = 26.4 outside s");
    expect(formatClockRate(0)).toBe("time stopped");
  });

  it("holds the arrow through noise and flips only after a real reversal", () => {
    const steady = openTrend(1);
    for (let i = 0; i < 30; i++) {
      const wobble = 1 + (i % 2 === 0 ? 0.01 : -0.01);
      expect(stepTrend(steady, wobble, GAP_DEADBAND)).toBe("steady");
    }

    const gap = openTrend(0);
    expect(stepTrend(gap, 0.04, GAP_DEADBAND)).toBe("steady");
    expect(stepTrend(gap, 0.06, GAP_DEADBAND)).toBe("rising");
    expect(stepTrend(gap, 0.1, GAP_DEADBAND)).toBe("rising");
    expect(stepTrend(gap, 0.06, GAP_DEADBAND)).toBe("rising");
    expect(stepTrend(gap, 0.04, GAP_DEADBAND)).toBe("falling");

    const margin = openTrend(20);
    expect(stepTrend(margin, 19.96, MARGIN_DEADBAND)).toBe("steady");
    expect(stepTrend(margin, 19.9, MARGIN_DEADBAND)).toBe("falling");
    expect(stepTrend(margin, 19.94, MARGIN_DEADBAND)).toBe("falling");
    expect(stepTrend(margin, 20, MARGIN_DEADBAND)).toBe("rising");

    const rate = openTrend(1);
    expect(stepTrend(rate, 1 + RATE_DEADBAND, RATE_DEADBAND)).toBe("steady");
    expect(stepTrend(rate, 1 + RATE_DEADBAND + 0.001, RATE_DEADBAND)).toBe("rising");
  });

  it("formats the three clock lines with arrows", () => {
    const latches = createClockLatches(1, 0, 240);
    const first = readClocks(latches, 1, 0, 240);
    expect(first.rate).toBe("1 ship s = 1.00 outside s →");
    expect(first.gap).toBe("Gap 0 s →");
    expect(first.margin).toBe("Margin 240 s →");
    expect(first.rateTrend).toBe("steady");

    const later = readClocks(latches, 0.2, 4, 10);
    expect(later.rateTrend).toBe("rising");
    expect(later.gapTrend).toBe("rising");
    expect(later.marginTrend).toBe("falling");
    expect(later.rate.endsWith("↑")).toBe(true);
    expect(later.gap).toBe("Gap +4.00 s ↑");
    expect(later.margin).toBe("Margin 10.0 s ↓");
    expect(later.rate).toBe("1 ship s = 5.00 outside s ↑");
  });
});
