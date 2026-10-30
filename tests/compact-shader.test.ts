import { describe, expect, it } from "vitest";
import { frost } from "../src/level/catalog";
import { shaderFamily, usesShader } from "../src/render/shaders/families";
import { COMPACT_FRAGMENT } from "../src/render/shaders/compact-shader";
import { compactExtent, compactKey, compactMotion } from "../src/render/shaders/compact-params";
import { STAR_PARAMS, starKind } from "../src/render/shaders/star-params";
import type { Body } from "../src/sim/physics";
import { createBodyShader } from "../src/render/shaders/families";

function body(partial: Pick<Body, "kind"> & Partial<Body>): Body {
  return { id: "b", name: "b", x: 0, y: 0, mass: 1, radius: 8, ...partial };
}

describe("compact object shader", () => {
  it("draws the four compact objects and leaves the white dwarf on the star shader", () => {
    expect(compactKey(body({ kind: "star", look: "neutron" }))).toBe("neutron");
    expect(compactKey(body({ kind: "star", look: "pulsar" }))).toBe("pulsar");
    expect(compactKey(body({ kind: "star", look: "magnetar" }))).toBe("magnetar");
    expect(compactKey(body({ kind: "blackhole" }))).toBe("hole");
    expect(shaderFamily(body({ kind: "star", look: "white-dwarf" }))).toBe("star");
    expect(starKind(body({ kind: "star", look: "white-dwarf" }))).toBe("white-dwarf");
    expect(STAR_PARAMS["white-dwarf"].smooth).toBe(1);
    expect(shaderFamily(body({ kind: "star", look: "sun" }))).toBe("star");
    expect(frost.bodies.some((item) => compactKey(item) !== null)).toBe(false);
    const neutron = body({ kind: "star", look: "neutron" });
    const sun = body({ kind: "star", look: "sun" });
    expect(usesShader(neutron, false)).toBe(true);
    expect(usesShader(sun, false)).toBe(false);
    expect(usesShader(sun, true)).toBe(true);
  });

  it("runs pulsar beams on the level reach and the magnetic axis", () => {
    const pulsar = body({
      kind: "star",
      look: "pulsar",
      radius: 8,
      beam: { reach: 180, period: 4, damage: 24 },
      magnet: { b1Reach: 80, tilt: Math.PI / 6, averaged: true },
    });
    expect(compactMotion(pulsar).reach).toBeCloseTo(180 / 8);
    expect(compactMotion(pulsar).period).toBe(4);
    expect(compactMotion(pulsar).phase).toBeCloseTo(30);
    expect(compactExtent(pulsar)).toBeCloseTo(180 / 8);
    const material = createBodyShader(pulsar);
    if (!material) throw new Error("pulsar");
    expect(material.uniforms.uKind?.value).toBe(1);
    expect(material.uniforms.uReach?.value).toBeCloseTo(22.5);
    expect(COMPACT_FRAGMENT).toContain("uSimTime");
    expect(COMPACT_FRAGMENT).not.toContain("360.*uTime/uPeriod");
  });

  it("sizes the magnetar out to the starquake and the black hole out to its glow", () => {
    const magnetar = body({ kind: "star", look: "magnetar", radius: 9, magnet: { b1Reach: 80, tilt: 0.35 } });
    const hole = body({ kind: "blackhole", radius: 22 });
    expect(compactExtent(magnetar)).toBeCloseTo(16.67);
    expect(compactExtent(hole)).toBe(3);
    expect(compactMotion(magnetar).tilt).toBeCloseTo((0.35 * 180) / Math.PI);
    expect(compactMotion(hole).diskSpin).toBe(24);
    expect(createBodyShader(hole)?.uniforms.uKind?.value).toBe(3);
  });
});
