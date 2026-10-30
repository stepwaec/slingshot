import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { palette } from "../src/render/palette";
import { shaderFamily } from "../src/render/shaders/families";
import { GIANT_FRAGMENT } from "../src/render/shaders/giant-shader";
import { giantTexture } from "../src/render/shaders/giant-maps";
import { GIANTS, giantExtent, giantKey } from "../src/render/shaders/giant-params";
import { createBodyShader } from "../src/render/shaders/families";
import { observatory } from "../src/level/catalog";
import type { Body } from "../src/sim/physics";
import { stage } from "./support/stage";

function body(partial: Pick<Body, "kind"> & Partial<Body>): Body {
  return { id: "b", name: "b", x: 0, y: 0, mass: 1, radius: 10, ...partial };
}

describe("gas giant shader", () => {
  it("covers the Sol giants and the library, and leaves Frost without one", () => {
    expect(giantKey(body({ kind: "planet", look: "jupiter" }))).toBe("jupiter");
    expect(giantKey(body({ kind: "planet", look: "saturn" }))).toBe("saturn");
    expect(giantKey(body({ kind: "planet", look: "uranus" }))).toBe("uranus");
    expect(giantKey(body({ kind: "planet", look: "neptune" }))).toBe("neptune");
    expect(giantKey(body({ kind: "planet", look: "gas-giant" }))).toBe("banded");
    expect(giantKey(body({ kind: "planet", look: "gas-ringed" }))).toBe("ringed");
    expect(giantKey(body({ kind: "planet", look: "ice-ring" }))).toBe("ice");
    expect(giantKey(body({ kind: "planet", look: "earth" }))).toBeNull();
    expect(shaderFamily(body({ kind: "star", look: "sun" }))).toBe("star");
    expect(stage.bodies.some((item) => giantKey(item) !== null)).toBe(false);
    const jupiter = observatory.bodies.find((item) => item.look === "jupiter");
    const earth = observatory.bodies.find((item) => item.look === "earth");
    expect(giantKey(jupiter!)).toBe("jupiter");
    expect(giantKey(earth!)).toBeNull();
  });

  it("matches the spec: differential jets, Saturn's roll and hex, Uranus's cap, Jupiter's limb", () => {
    expect(GIANTS.jupiter.jet).toHaveLength(17);
    expect(GIANTS.jupiter.limbA).toBe(0.35);
    expect(GIANTS.jupiter.limb).toBe(palette.giantLimb);
    expect(GIANTS.jupiter.hasRings).toBe(0);
    expect(GIANTS.saturn.roll).toBe(14);
    expect(GIANTS.saturn.hex).toBe(1);
    expect(GIANTS.saturn.hexCol).toBe(palette.giantHex);
    expect(GIANTS.saturn.hasRings).toBe(1);
    expect(GIANTS.saturn.rho1).toBeCloseTo(2.36);
    expect(GIANTS.uranus.roll).toBe(62);
    expect(GIANTS.uranus.pole).toBe(1);
    expect(GIANTS.uranus.poleA).toBe(0.55);
    expect(GIANTS.neptune.jet[8]).toBeLessThan(0);
    expect(GIANTS.banded.jet[4]).toBeLessThan(0);
    expect(GIANTS.banded.jet[8]).toBeGreaterThan(0);
    expect(GIANTS.ice.sparkle).toBe(1);
    expect(GIANTS.ice.sparkleT).toBe(60);
    expect(GIANTS.ice.sparkleRho).toBeCloseTo(1.37);
    expect(GIANTS.jupiter.warm).toBe(palette.planetWarm);
    expect(giantExtent("saturn")).toBeCloseTo(2.36);
    expect(giantExtent("jupiter")).toBe(1.08);
  });

  it("drops the night-limb floor on the rim and shares each map", () => {
    expect(GIANT_FRAGMENT).toContain("mix(0.45, 0.0, clamp(-sm, 0.0, 1.0))");
    expect(GIANT_FRAGMENT).toContain("mix(0.45, 0.06, clamp(-sm, 0.0, 1.0))");
    const saturn = createBodyShader(body({ kind: "planet", look: "saturn" }));
    const again = createBodyShader(body({ kind: "planet", look: "saturn" }));
    const jupiter = createBodyShader(body({ kind: "planet", look: "jupiter" }));
    if (!saturn || !again || !jupiter) throw new Error("material");
    expect(saturn.uniforms.uRoll?.value).toBe(14);
    expect(saturn.uniforms.uHasRings?.value).toBe(1);
    expect(saturn.uniforms.uHex?.value).toBe(1);
    expect((saturn.uniforms.uJet?.value as Float32Array).length).toBe(17);
    expect(saturn.uniforms.uAlbedo?.value).toBe(again.uniforms.uAlbedo?.value);
    expect(saturn.uniforms.uRings?.value).toBe(again.uniforms.uRings?.value);
    expect(saturn.uniforms.uAlbedo?.value).toBe(giantTexture("saturn-bands"));
    expect(saturn.uniforms.uRings?.value).toBe(giantTexture("saturn-rings"));
    expect(giantTexture("saturn-bands").wrapS).toBe(THREE.RepeatWrapping);
    expect(giantTexture("saturn-bands").generateMipmaps).toBe(true);
    expect(giantTexture("saturn-rings").wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(giantTexture("saturn-rings").generateMipmaps).toBe(false);
    expect(jupiter.uniforms.uLimbA?.value).toBe(0.35);
    expect(jupiter.uniforms.uHasRings?.value).toBe(0);
    expect(saturn.uniforms.uExtent?.value).toBeCloseTo(2.36);
  });
});
