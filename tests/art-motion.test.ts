import { describe, expect, it } from "vitest";
import {
  atmosphereBreathe,
  brightestOffset,
  comaBreathe,
  cometDustMirror,
  cometTailStretch,
  dragDashOffset,
  ellipsePeriapsis,
  flareOpacity,
  haloBreathe,
  keyedValue,
  knotOpacity,
  knotPoint,
  prominenceWindow,
  pulsarBeamScale,
  PULSAR_SVG_REACH,
  starquake,
  stripScroll,
  stripWindow,
  sunBreathe,
  sunFlameAngle,
  sunGrainAngle,
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
    expect(sunGrainAngle(0)).toBeCloseTo(0, 5);
    expect(sunGrainAngle(45)).toBeCloseTo(Math.PI, 5);
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

describe("surface strips", () => {
  it("rests at t = 0 and walks one period", () => {
    expect(stripScroll(0, 90, 214)).toBe(0);
    expect(stripScroll(45, 90, 214)).toBeCloseTo(107, 5);
    expect(stripScroll(90, 90, 214)).toBeCloseTo(0, 5);
    const rest = stripWindow(34, -292, -34, 0, 0, 428, 68, 0);
    expect(rest.offsetX).toBeCloseTo(258 / 428, 5);
    expect(rest.repeatX).toBeCloseTo(68 / 428, 5);
    expect(rest.offsetY).toBeCloseTo(0, 5);
    expect(rest.repeatY).toBeCloseTo(1, 5);
  });
});

describe("cosmetic cycles", () => {
  it("rests the halo, coma and atmosphere at t = 0", () => {
    expect(haloBreathe(0)).toBeCloseTo(1, 5);
    expect(haloBreathe(0.6)).toBeCloseTo(1.04, 5);
    expect(comaBreathe(0)).toBeCloseTo(1, 5);
    expect(comaBreathe(2.5)).toBeCloseTo(1.04, 5);
    expect(atmosphereBreathe(0)).toBeCloseTo(1, 5);
    expect(dragDashOffset(0)).toBe(0);
    expect(dragDashOffset(2)).toBeCloseTo(0, 5);
  });

  it("holds the starquake on the surface until late in the cycle", () => {
    expect(starquake(0).radius).toBe(9);
    expect(starquake(0).stroke).toBe(0);
    const late = starquake(18 * 0.88);
    expect(late.radius).toBeGreaterThan(9);
    expect(late.stroke).toBeGreaterThan(0);
  });

  it("sends the comet knot out along the tail and brings it back", () => {
    expect(knotOpacity(0)).toBe(0);
    expect(knotPoint(0).x).toBe(40);
    expect(knotPoint(9).x).toBeCloseTo(40, 4);
    expect(knotPoint(4.5).x).toBeCloseTo(220, 4);
    expect(keyedValue(0.08 * 9, 9, [0, 0.08, 0.5, 1], [0, 0.8, 0.5, 0])).toBeCloseTo(0.8, 4);
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
