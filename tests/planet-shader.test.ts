import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { observatory } from "../src/level/catalog";
import { palette } from "../src/render/palette";
import { createBodyShader, shaderFamily } from "../src/render/shaders/families";
import { planetTexture } from "../src/render/shaders/planet-maps";
import { PLANETS, planetKey } from "../src/render/shaders/planet-params";
import { PLANET_FRAGMENT } from "../src/render/shaders/planet-shader";
import { theme } from "../src/render/theme";
import type { Body, BodyLook } from "../src/sim/physics";

function body(partial: Pick<Body, "kind"> & Partial<Body>): Body {
  return { id: "b", name: "b", x: 0, y: 0, mass: 1, radius: 10, ...partial };
}

describe("rocky planet shader", () => {
  it("covers Frost, Sol and the library, and leaves gas giants and props on sprites", () => {
    expect(planetKey(body({ kind: "home" }))).toBe("ocean");
    expect(planetKey(body({ kind: "target" }))).toBe("planetx");
    expect(planetKey(body({ kind: "moon" }))).toBe("barren");
    expect(planetKey(body({ kind: "planet", look: "dwarf" }))).toBe("dwarf");
    expect(planetKey(body({ kind: "planet", look: "earth" }))).toBe("earth");
    expect(planetKey(body({ kind: "moon", look: "luna" }))).toBe("moon");
    expect(planetKey(body({ kind: "planet", look: "venus" }))).toBe("venus");
    expect(planetKey(body({ kind: "moon", look: "titan" }))).toBe("titan");
    expect(planetKey(body({ kind: "planet", look: "pluto" }))).toBe("pluto");
    expect(planetKey(body({ kind: "planet", look: "eris" }))).toBe("eris");
    expect(planetKey(body({ kind: "planet", look: "lava" }))).toBe("lava");
    for (const look of ["arrokoth", "voyager"] as const) {
      expect(shaderFamily(body({ kind: "planet", look })), look).toBeNull();
    }
    for (const look of ["jupiter", "saturn", "uranus", "neptune", "gas-giant"] as const) {
      expect(shaderFamily(body({ kind: "planet", look })), look).toBe("giant");
    }
    expect(shaderFamily(body({ kind: "star", look: "sun" }))).toBe("star");
    expect(shaderFamily(body({ kind: "star", look: "sol-sun" }))).toBe("star");
  });

  it("matches the spec table: retrograde Venus, night cities, day lava, airless Moon, Titan's ring", () => {
    expect(PLANETS.venus.spin).toBe(-96);
    expect(PLANETS.earth.glint).toBe(0.6);
    expect(PLANETS.earth.hasLights).toBe(1);
    expect(PLANETS.earth.glowDay).toBe(0);
    expect(PLANETS.lava.glowDay).toBe(1);
    expect(PLANETS.lava.hasLights).toBe(1);
    expect(PLANETS.cracked.glowDay).toBe(0);
    expect(PLANETS.cracked.hasLights).toBe(1);
    expect(PLANETS.moon.locked).toBe(1);
    expect(PLANETS.moon.airless).toBe(1);
    expect(PLANETS.pluto.locked).toBe(1);
    expect(PLANETS.pluto.airless).toBe(0);
    expect(PLANETS.charon.airless).toBe(1);
    expect(PLANETS.eris.airless).toBe(1);
    expect(PLANETS.earth.warm).toBe(palette.planetWarm);
    expect(PLANETS.mars.night0).toBe(palette.planetNight0);
    expect(PLANETS.ocean.hasClouds).toBe(1);
    expect(PLANETS.ocean.cloudSpin).toBe(64);
    expect(PLANETS.ocean.spin).toBe(90);
    expect(PLANETS.planetx.light[0]).toBeLessThan(0);
  });

  it("drops the night-limb floor on the rim and adds Titan's detached haze", () => {
    expect(PLANET_FRAGMENT).toContain("mix(0.45, 0.0, clamp(-s, 0.0, 1.0))");
    expect(PLANET_FRAGMENT).toContain("mix(0.45, 0.06, clamp(-s, 0.0, 1.0))");
    expect(PLANET_FRAGMENT).toContain("uDetached");
    const titan = createBodyShader(body({ kind: "moon", look: "titan" }));
    const earth = createBodyShader(body({ kind: "planet", look: "earth" }));
    if (!titan || !earth) throw new Error("material");
    expect(titan.uniforms.uDetached?.value).toBe(1);
    expect(titan.uniforms.uExtent?.value).toBe(theme.planetShader.titanExtent);
    expect(earth.uniforms.uDetached?.value).toBe(0);
    expect(earth.uniforms.uExtent?.value).toBe(theme.planetShader.rimExtent);
    expect(earth.uniforms.uSpin?.value).toBe(90);
    expect(earth.uniforms.uGlint?.value).toBe(0.6);
  });

  it("loads each map once and shares it", () => {
    const first = planetTexture("earth-albedo");
    const again = planetTexture("earth-albedo");
    const clouds = planetTexture("earth-clouds");
    expect(first).toBe(again);
    expect(first).not.toBe(clouds);
    expect(first.wrapS).toBe(THREE.RepeatWrapping);
    expect(first.flipY).toBe(true);
    expect(first.generateMipmaps).toBe(true);
    expect(first.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    const earth = createBodyShader(body({ kind: "planet", look: "earth" }));
    const other = createBodyShader(body({ kind: "planet", look: "earth" }));
    expect(earth?.uniforms.uAlbedo?.value).toBe(other?.uniforms.uAlbedo?.value);
    expect(earth?.uniforms.uAlbedo?.value).toBe(first);
    expect(earth?.uniforms.uClouds?.value).toBe(clouds);
    expect(planetTexture("moon-face")).toBe(createBodyShader(body({ kind: "moon", look: "luna" }))?.uniforms.uFace?.value);
  });

  it("places the new library looks in the Observatory as planets", () => {
    for (const look of ["rocky", "ice", "lava", "toxic", "cracked"] as const satisfies readonly BodyLook[]) {
      const placed = observatory.bodies.find((item) => item.look === look);
      expect(placed?.kind, look).toBe("planet");
      expect(shaderFamily(placed ?? body({ kind: "planet", look }))).toBe("planet");
    }
  });
});
