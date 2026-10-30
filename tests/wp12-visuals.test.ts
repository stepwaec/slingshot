import { describe, expect, it } from "vitest";
import { flash, simConfigFromLevel } from "../src/level/catalog";
import { flashPlan } from "../src/level/solutions";
import { bodyPose, flyPlan, makeState, predictPlan } from "../src/sim/physics";
import { theme } from "../src/render/theme";
import {
  blastCall,
  countdownFraction,
  jetHalfWidth,
  jetLeaveDelay,
  novaFlash,
  progenitorScale,
  progenitorShrink,
} from "../src/render/hazard-look";
import type { QuasarJet } from "../src/sim/events";

describe("WP12 hazard drawings", () => {
  const spec = theme.nova;

  it("breathes on the progenitor header keyframes and rests at 1", () => {
    expect(progenitorScale(0, spec.breathePeriod)).toBeCloseTo(1, 6);
    expect(progenitorScale(0.2 * spec.breathePeriod, spec.breathePeriod)).toBeCloseTo(0.41 / 0.38, 6);
    expect(progenitorScale(0.45 * spec.breathePeriod, spec.breathePeriod)).toBeCloseTo(0.37 / 0.38, 6);
    expect(progenitorScale(0.8 * spec.breathePeriod, spec.breathePeriod)).toBeCloseTo(0.43 / 0.38, 6);
    expect(progenitorScale(spec.breathePeriod, spec.breathePeriod)).toBeCloseTo(1, 6);
  });

  it("shrinks through the last half second and is gone at detonation", () => {
    expect(progenitorShrink(10, 28, spec.shrinkLead, spec.shrinkTo)).toBe(1);
    expect(progenitorShrink(27.5, 28, spec.shrinkLead, spec.shrinkTo)).toBeCloseTo(1, 5);
    expect(progenitorShrink(27.75, 28, spec.shrinkLead, spec.shrinkTo)).toBeCloseTo((1 + spec.shrinkTo) / 2, 5);
    expect(progenitorShrink(28, 28, spec.shrinkLead, spec.shrinkTo)).toBe(0);
  });

  it("peaks the flash at 1.2 × blast and fades it out by 2.6 s", () => {
    const start = novaFlash(0, 100, spec);
    expect(start.alpha).toBe(0);
    expect(start.radius).toBeCloseTo(1.2 * 100 * (10 / 260), 5);
    const peak = novaFlash(spec.flashGrow, 100, spec);
    expect(peak.radius).toBeCloseTo(120, 5);
    expect(peak.alpha).toBeGreaterThan(0.5);
    expect(novaFlash(spec.flashEnd, 100, spec).alpha).toBe(0);
    expect(novaFlash(1, 100, spec).alpha).toBeCloseTo(spec.flashMidAlpha, 5);
  });

  it("empties the countdown clockwise as the detonation approaches", () => {
    expect(countdownFraction(0, 28)).toBe(1);
    expect(countdownFraction(14, 28)).toBeCloseTo(0.5, 6);
    expect(countdownFraction(28, 28)).toBe(0);
  });

  it("sets the jet sheath to the cone quasarDamage tests", () => {
    expect(jetHalfWidth(280, 0.16)).toBeCloseTo(280 * Math.tan(0.16), 6);
    expect(jetHalfWidth(0, 0.16)).toBe(0);
  });

  it("reports a safe window only while a swept jet can leave the point", () => {
    const jet: QuasarJet = { angle: 0, cone: 0.2, reach: 100, damage: 10, period: 10, sweep: 0.5 };
    const delay = jetLeaveDelay(50, 0, jet, 0);
    expect(delay).not.toBeNull();
    expect(delay as number).toBeGreaterThan(0);
    expect(jetLeaveDelay(0, 90, jet, 0)).toBeNull();
  });

  it("marks a path still inside the blast, and a path that has left", () => {
    const hit = blastCall(
      [
        { x: 10, y: 0, step: 0 },
        { x: 10, y: 0, step: 60 },
      ],
      0,
      0,
      40,
      1,
      1 / 60,
    );
    expect(hit?.kind).toBe("hit");
    const clear = blastCall(
      [
        { x: 10, y: 0, step: 0 },
        { x: 80, y: 0, step: 60 },
      ],
      0,
      0,
      40,
      2,
      1 / 60,
    );
    expect(clear?.kind).toBe("clear");
    if (clear?.kind === "clear") expect(clear.spare).toBeGreaterThan(0);
  });

  it("keeps Flash's flight on the old prediction with the stray asteroid in the scene", () => {
    const rock = flash.bodies.find((body) => body.look === "asteroid");
    expect(rock?.mass).toBe(0);
    expect(rock?.radius).toBe(15);
    const config = simConfigFromLevel(flash);
    const state = makeState(flash.ship.x, flash.ship.y, flash.ship.vx, flash.ship.vy, config);
    const predicted = predictPlan(state, config, flashPlan);
    const flown = flyPlan(state, config, flashPlan, 1);
    expect(predicted.status).toBe("won");
    expect(predicted.final.hull).toBe(70);
    expect(flown.path.length).toBe(predicted.path.length);
    let nearest = Infinity;
    for (const sample of flown.path) {
      if (!rock) break;
      const pose = bodyPose(rock, sample.step * flash.dt, flash.bodies, flash.g);
      nearest = Math.min(nearest, Math.hypot(sample.x - pose.x, sample.y - pose.y));
    }
    expect(nearest).toBeGreaterThan(80);
  });
});
