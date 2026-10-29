import { describe, expect, it } from "vitest";
import {
  brightestOffset,
  cometDustMirror,
  cometTailStretch,
  ellipsePeriapsis,
  flareOpacity,
  prominenceWindow,
  pulsarBeamScale,
  PULSAR_SVG_REACH,
  sunBreathe,
  sunFlameAngle,
  sunWispAngle,
} from "../src/render/art-motion";

describe("sun SVG timelines", () => {
  it("rests a prominence at the start and peaks halfway through", () => {
    const rest = prominenceWindow(0, 0, 12);
    expect(rest.opacity).toBeCloseTo(0, 5);
    expect(rest.scale).toBeCloseTo(0.6, 5);
    const peak = prominenceWindow(6, 0, 12);
    expect(peak.opacity).toBeCloseTo(1, 5);
    expect(peak.scale).toBeCloseTo(1, 5);
    const later = prominenceWindow(5 + 8, 5, 16);
    expect(later.opacity).toBeCloseTo(1, 5);
  });

  it("lights the flare only around 13.9 s of the 22 s cycle", () => {
    expect(flareOpacity(0)).toBe(0);
    expect(flareOpacity(12)).toBe(0);
    expect(flareOpacity(13.9)).toBeGreaterThan(0.98);
    expect(flareOpacity(16)).toBe(0);
    expect(flareOpacity(22 + 13.9)).toBeCloseTo(1, 2);
  });
});

describe("sun haze and rings", () => {
  it("rests at t = 0 and follows the 6 s / 200 s / 300 s headers", () => {
    expect(sunBreathe(0)).toBeCloseTo(1, 5);
    expect(sunBreathe(1.5)).toBeCloseTo(1.03, 5);
    expect(sunBreathe(4.5)).toBeCloseTo(0.97, 5);
    expect(sunWispAngle(0)).toBeCloseTo(0, 5);
    expect(sunWispAngle(150)).toBeCloseTo(-Math.PI, 5);
    expect(sunFlameAngle(0)).toBeCloseTo(0, 5);
    expect(sunFlameAngle(100)).toBeCloseTo(Math.PI, 5);
  });
});

describe("comet dust mirror", () => {
  it("keeps SVG +y for a counterclockwise pass and flips the other way", () => {
    expect(cometDustMirror(1, 0, 0, 1)).toBe(1);
    expect(cometDustMirror(1, 0, 0, -1)).toBe(-1);
    expect(cometDustMirror(0, 0, 0, 0)).toBe(1);
  });
});

describe("comet tail stretch", () => {
  it("is full at periapsis and shrinks toward 0.35 farther out", () => {
    const close = cometTailStretch(53.2, 53.2);
    expect(close.along).toBeCloseTo(1, 5);
    expect(close.across).toBeCloseTo(1, 5);
    const far = cometTailStretch(532, 53.2);
    expect(far.along).toBeCloseTo(0.35, 5);
    expect(far.across).toBeCloseTo(0.6 + 0.4 * 0.35, 5);
    expect(ellipsePeriapsis(190, 0.72, undefined)).toBeCloseTo(190 * 0.28, 5);
  });
});

describe("pulsar beam scale", () => {
  it("puts the painted tip on Pulse's damage reach", () => {
    const scale = pulsarBeamScale(8, 8, 180);
    expect(scale.sx).toBe(1);
    expect(PULSAR_SVG_REACH * scale.sy).toBeCloseTo(180, 8);
  });
});

describe("planet light", () => {
  it("faces the brightest star, by mass over distance squared", () => {
    const aim = brightestOffset(
      [
        { x: 100, y: 0, mass: 10 },
        { x: 0, y: 30, mass: 1000 },
      ],
      0,
      0,
    );
    expect(aim).toEqual({ x: 0, y: 30 });
  });
});
