import { describe, expect, it } from "vitest";
import { frost } from "../src/level/catalog";
import { shaderFamily } from "../src/render/shaders/families";
import { artLightLocked, impostorSide, lightDirection, planetSide, ringOctaves } from "../src/render/shaders/impostor";
import { GIANT_FRAGMENT } from "../src/render/shaders/giant-shader";
import { PLANET_FRAGMENT } from "../src/render/shaders/planet-shader";
import { STAR_FRAGMENT } from "../src/render/shaders/star-shader";
import { STAR_PARAMS, starKind } from "../src/render/shaders/star-params";

describe("shader impostors", () => {
  it("draws Frost's sun as variant J and its rocky bodies with the planet shader", () => {
    expect(artLightLocked("?lit=art")).toBe(true);
    expect(artLightLocked("")).toBe(false);
    const sun = frost.bodies.find((body) => body.id === "sun");
    const home = frost.bodies.find((body) => body.id === "home");
    if (!sun || !home) throw new Error("frost");
    expect(starKind(sun)).toBe("sun");
    expect(shaderFamily(sun)).toBe("star");
    expect(shaderFamily(home)).toBe("planet");
    expect(STAR_PARAMS.sun.core).toBe("#FFB43A");
    expect(STAR_PARAMS.sun.limbDark).toBe(0.18);
    expect(STAR_PARAMS.sun.hazeR).toBe(4.35);
    expect(STAR_PARAMS.sun.hazeA).toBe(1);
    expect(STAR_PARAMS["sol-sun"].hazeA).toBe(1);
    expect(STAR_PARAMS["red-dwarf"].hazeA).toBe(1);
    expect(STAR_PARAMS.sun.flare).toBe(1);
    expect(STAR_PARAMS["sol-sun"].spots).toBe(1);
    expect(STAR_PARAMS["sol-sun"].flare).toBe(0);
    expect(STAR_PARAMS["white-dwarf"].smooth).toBe(1);
    expect(STAR_PARAMS["red-giant"].R).toBe(120);
    expect(STAR_PARAMS["binary-cool"].proW).toBe(1.5);
    const family = Object.fromEntries(frost.bodies.map((body) => [body.id, shaderFamily(body)]));
    expect(family).toEqual({ home: "planet", sun: "star", dwarf: "planet", x: "planet" });
  });

  it("composites layers with straight alpha and premultiplies only the final pixel", () => {
    for (const source of [STAR_FRAGMENT, PLANET_FRAGMENT, GIANT_FRAGMENT]) {
      expect(source.replace(/\s+/g, "")).toContain("d.rgb*d.a");
      expect(source).toContain("gl_FragColor");
    }
  });

  it("sizes a planet quad to the rim, and a star quad to twice the haze", () => {
    expect(planetSide(34, 1.08)).toBeCloseTo(2 * 1.08 * 34 * 1.06);
    expect(planetSide(21.6, 1.12)).toBeCloseTo(2 * 1.12 * 21.6 * 1.06);
    expect(impostorSide(46, 4.35)).toBeCloseTo(2 * 4.35 * 46 * 1.06);
    expect(impostorSide(16, 4.35, 1)).toBeCloseTo(2 * 6.25 * 16 * 1.06);
  });

  it("aims the light uniform at the brightest star", () => {
    const home = frost.bodies.find((body) => body.id === "home");
    const sun = frost.bodies.find((body) => body.id === "sun");
    if (!home || !sun) throw new Error("frost");
    const dir = lightDirection(home.x, home.y, 0, frost.bodies, frost.g);
    expect(Math.atan2(dir.y, dir.x)).toBeCloseTo(Math.atan2(sun.y - home.y, sun.x - home.x));
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1);
  });

  it("uses three octaves up close to the screen and when a body is tiny", () => {
    expect(ringOctaves(100, 1440, 900, false)).toBe(5);
    expect(ringOctaves(800, 1440, 900, false)).toBe(3);
    expect(ringOctaves(100, 1440, 900, true)).toBe(3);
  });
});
