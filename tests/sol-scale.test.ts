import { describe, expect, it } from "vitest";
import { STAR_PARAMS } from "../src/render/shaders/star-params";
import { moonMission } from "../src/world/moon-mission";
import { solWorld } from "../src/world/sol";
import {
  MIN_BODY_PX,
  MOON_EARTH_FRACTION,
  SUN_EARTH_DIAMETERS,
  isSolChart,
  solDrawnRadius,
  solGameVisualRadius,
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

  it("keeps crash radii, and draws the Sun at 5 Earth diameters and the Moon at 0.27", () => {
    expect(sun.radius).toBe(46);
    expect(earth.radius).toBe(34);
    expect(moon.radius).toBe(18);
    expect(SUN_EARTH_DIAMETERS).toBe(5);
    expect(solGameVisualRadius(sun, earth.radius)).toBe(5 * earth.radius);
    expect(solGameVisualRadius(moon, earth.radius)).toBeCloseTo(MOON_EARTH_FRACTION * earth.radius, 8);
    expect(solGameVisualRadius(earth, earth.radius)).toBe(earth.radius);
    expect(isSolChart(solWorld.bodies)).toBe(true);
    expect(isSolChart(moonMission.bodies)).toBe(true);
  });

  it("keeps Mercury outside the bright wind and Earth outside the corona", () => {
    const drawn = solGameVisualRadius(sun, earth.radius);
    const mercury = body("mercury");
    const look = STAR_PARAMS["sol-sun"];
    expect(moonMission.orbit.radius).toBeGreaterThan(earth.radius + moonMission.periapsisMargin);
    expect(earth.orbit?.radius).toBeGreaterThan(sun.radius);
    expect((mercury.orbit?.radius ?? 0) - mercury.radius).toBeGreaterThan(drawn * look.wiR);
    expect(earth.orbit?.radius).toBeGreaterThan(drawn * look.hazeR);
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
