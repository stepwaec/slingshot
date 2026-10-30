import { describe, expect, it } from "vitest";
import { ash } from "../src/level/catalog";
import {
  consumeHeat,
  craterAlpha,
  debrisPieces,
  easeOutCubic,
  ejectaGrains,
  fadeOut,
  formatClock,
  growRadius,
  starBrighten,
} from "../src/render/event-look";
import { theme } from "../src/render/theme";
import { bodyPose } from "../src/sim/physics";

describe("LU3 event look", () => {
  const spec = theme.event;

  it("keeps the header sizes", () => {
    expect(spec.flashR0).toBe(4);
    expect(spec.flashR1).toBe(34);
    expect(spec.flashGrow).toBe(0.6);
    expect(spec.shockR1).toBe(80);
    expect(spec.ejectaCount).toBe(20);
    expect(spec.tailLength).toBe(90);
    expect(spec.plungeGrow).toBe(0.55);
    expect(spec.rippleDur).toBe(1.8);
    expect(spec.brightAlpha).toBe(0.22);
    expect(spec.chunkCount).toBe(22);
    expect(spec.dustCount).toBe(48);
    expect(spec.gapClose).toBe(22);
    expect(theme.colors.eventWarn).toBe("#FF9F43");
    expect(theme.colors.eventNext).toBe("#FFC857");
    expect(theme.colors.eventAblationTail).toBe("#E0408A");
    expect(theme.colors.eventRipple).toBe("#FFF1C2");
  });

  it("formats the countdown chips", () => {
    expect(formatClock(102)).toBe("1:42");
    expect(formatClock(78)).toBe("1:18");
    expect(formatClock(32)).toBe("0:32");
    expect(formatClock(0)).toBe("0:00");
  });

  it("grows the flash and fades it on the header clocks", () => {
    expect(growRadius(0, spec.flashR0, spec.flashR1, spec.flashGrow)).toBe(4);
    expect(growRadius(spec.flashGrow, spec.flashR0, spec.flashR1, spec.flashGrow)).toBe(34);
    expect(growRadius(0.3, spec.flashR0, spec.flashR1, spec.flashGrow)).toBeCloseTo(19, 5);
    expect(fadeOut(0, spec.flashFade)).toBe(1);
    expect(fadeOut(spec.flashFade, spec.flashFade)).toBe(0);
    expect(craterAlpha(0, spec.craterMid, spec.craterMidAlpha, spec.craterDur)).toBe(1);
    expect(craterAlpha(2, spec.craterMid, spec.craterMidAlpha, spec.craterDur)).toBeCloseTo(0.6, 5);
    expect(craterAlpha(3.6, spec.craterMid, spec.craterMidAlpha, spec.craterDur)).toBe(0);
    expect(starBrighten(0, spec.brightAlpha, spec.brightRise, spec.brightDur)).toBe(0);
    expect(starBrighten(spec.brightRise, spec.brightAlpha, spec.brightRise, spec.brightDur)).toBeCloseTo(0.22, 5);
    expect(starBrighten(spec.brightDur, spec.brightAlpha, spec.brightRise, spec.brightDur)).toBe(0);
  });

  it("matches Ash's fall to the burn-up heat", () => {
    const planet = ash.bodies.find((body) => body.id === "x");
    const sun = ash.bodies.find((body) => body.id === "sun");
    if (!planet?.script || planet.script.kind !== "consume" || !planet.orbit || !sun) throw new Error("ash");
    const script = planet.script;
    const at = (t: number) => {
      const pose = bodyPose(planet, t, ash.bodies, ash.g);
      const center = bodyPose(sun, t, ash.bodies, ash.g);
      return Math.hypot(pose.x - center.x, pose.y - center.y);
    };
    expect(consumeHeat(at(script.start), planet.orbit.radius, script.radius)).toBeCloseTo(0, 5);
    const mid = script.start + (script.end - script.start) * 0.5;
    expect(consumeHeat(at(mid), planet.orbit.radius, script.radius)).toBeCloseTo(0.5, 4);
    expect(consumeHeat(at(script.end), planet.orbit.radius, script.radius)).toBeCloseTo(1, 4);
  });

  it("seeds the same ejecta and debris twice", () => {
    const range = {
      count: spec.ejectaCount,
      coneDeg: spec.ejectaCone,
      dist0: spec.ejectaDist0,
      dist1: spec.ejectaDist1,
      r0: spec.ejectaR0,
      r1: spec.ejectaR1,
    };
    const a = ejectaGrains(0x51, range);
    const b = ejectaGrains(0x51, range);
    expect(a).toEqual(b);
    expect(a).toHaveLength(20);
    expect(a.filter((grain) => grain.hot)).toHaveLength(7);
    for (const grain of a) {
      expect(Math.abs(grain.angle)).toBeLessThanOrEqual((35 * Math.PI) / 180 + 1e-9);
      expect(grain.dist).toBeGreaterThanOrEqual(40);
      expect(grain.dist).toBeLessThanOrEqual(120);
      expect(grain.radius).toBeGreaterThanOrEqual(1);
      expect(grain.radius).toBeLessThanOrEqual(2.2);
    }
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    const debris = debrisPieces(3, {
      chunks: spec.chunkCount,
      dust: spec.dustCount,
      dustHot: spec.dustHot,
      r0: spec.chunkR0,
      r1: spec.chunkR1,
      drift0: spec.driftPx0,
      drift1: spec.driftPx1,
      period0: spec.driftPeriod0,
      period1: spec.driftPeriod1,
    });
    expect(debris.filter((piece) => !piece.dust)).toHaveLength(22);
    expect(debris.filter((piece) => piece.dust)).toHaveLength(48);
    expect(debrisPieces(3, {
      chunks: spec.chunkCount,
      dust: spec.dustCount,
      dustHot: spec.dustHot,
      r0: spec.chunkR0,
      r1: spec.chunkR1,
      drift0: spec.driftPx0,
      drift1: spec.driftPx1,
      period0: spec.driftPeriod0,
      period1: spec.driftPeriod1,
    })).toEqual(debris);
  });
});
