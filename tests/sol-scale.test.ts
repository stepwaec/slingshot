import { describe, expect, it } from "vitest";
import { STAR_PARAMS } from "../src/render/shaders/star-params";
import { moonMission } from "../src/world/moon-mission";
import { solWorld } from "../src/world/sol";
import { bodyCrashRadius } from "../src/sim/physics";
import {
  MIN_BODY_PX,
  MOON_EARTH_FRACTION,
  SUN_EARTH_DIAMETERS,
  isSolChart,
  solDrawnRadius,
  solGameVisualRadius,
  solSunDiscRadius,
} from "../src/render/sol-scale";

function body(id: string) {
  const found = solWorld.bodies.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("Sol visual scale", () => {
  const sun = body("sun");
  const earth = body("earth");
  const moon = body("luna");

  it("draws the Sun at 8 Earth diameters and crashes on that same disc", () => {
    expect(sun.radius).toBe(46);
    expect(earth.radius).toBe(34);
    expect(moon.radius).toBe(18);
    expect(earth.crashRadius).toBeUndefined();
    expect(moon.crashRadius).toBeUndefined();
    expect(SUN_EARTH_DIAMETERS).toBe(8);
    const disc = solSunDiscRadius(earth.radius);
    expect(disc).toBe(8 * earth.radius);
    expect(sun.crashRadius).toBe(disc);
    expect(bodyCrashRadius(sun)).toBe(disc);
    expect(bodyCrashRadius(earth)).toBe(earth.radius);
    expect(solGameVisualRadius(sun, earth.radius)).toBe(disc);
    expect(solGameVisualRadius(moon, earth.radius)).toBeCloseTo(MOON_EARTH_FRACTION * earth.radius, 8);
    expect(solGameVisualRadius(earth, earth.radius)).toBe(earth.radius);
    expect(isSolChart(solWorld.bodies)).toBe(true);
    expect(isSolChart(moonMission.bodies)).toBe(true);
  });

  it("keeps every planet orbit and the Moon's path outside the Sun's disc and corona", () => {
    const drawn = solGameVisualRadius(sun, earth.radius);
    const look = STAR_PARAMS["sol-sun"];
    const corona = drawn * Math.max(1, look.wiR, look.flR);
    expect(corona).toBeGreaterThan(drawn);
    const planets = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
    for (const id of planets) {
      const planet = body(id);
      const orbit = planet.orbit?.radius ?? 0;
      expect(orbit, id).toBeGreaterThan(corona);
      expect(orbit - planet.radius, `${id} disc`).toBeGreaterThan(drawn);
    }
    const nearestMoon = (earth.orbit?.radius ?? 0) - (moon.orbit?.radius ?? 0) - moon.radius;
    expect(nearestMoon).toBeGreaterThan(corona);
    expect(moonMission.orbit.radius).toBeGreaterThan(earth.radius + moonMission.periapsisMargin);
    expect(earth.orbit?.radius).toBeGreaterThan(sun.radius);
    const mercury = body("mercury");
    const sunward = (mercury.orbit?.radius ?? 0) - mercury.radius;
    expect(sunward).toBeGreaterThan(drawn);
    expect(sunward).toBeLessThan(corona);
  });

  it("uses a pixel floor zoomed out and the game-scale radius zoomed in", () => {
    const far = 0.05;
    expect(earth.radius * far).toBeLessThan(MIN_BODY_PX);
    expect(solDrawnRadius(earth, true, far, earth.radius)).toBeCloseTo(MIN_BODY_PX / far, 8);
    expect(solDrawnRadius(moon, true, far, earth.radius)).toBeCloseTo(MIN_BODY_PX / far, 8);
    const near = 2.2;
    expect(earth.radius * near).toBeGreaterThan(MIN_BODY_PX);
    expect(solDrawnRadius(earth, true, near, earth.radius)).toBe(earth.radius);
    expect(solDrawnRadius(moon, true, near, earth.radius)).toBeCloseTo(0.27 * earth.radius, 8);
    expect(solDrawnRadius(sun, true, far, earth.radius)).toBe(SUN_EARTH_DIAMETERS * earth.radius);
    expect(solDrawnRadius(earth, false, far, earth.radius)).toBe(earth.radius);
  });
});
