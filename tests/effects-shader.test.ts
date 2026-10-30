import { describe, expect, it } from "vitest";
import { observatory } from "../src/level/catalog";
import { placeBelts, rockOffset } from "../src/sim/belts";
import { BLOOM_FRAGMENT, BLOOM_KNEE, BLOOM_STRENGTH, BLOOM_THRESHOLD } from "../src/render/shaders/bloom";
import { syncField } from "../src/render/shaders/field-camera";
import { POINT_MIN_PX, POINTS_FRAGMENT, POINTS_VERTEX } from "../src/render/shaders/points-shader";
import { ROCK_FRAGMENT, ROCK_VERTEX, rockSeed, rockTypeIndex, tumblePeriod } from "../src/render/shaders/rock-shader";

describe("R2.5 effects shaders", () => {
  it("keeps the bloom pass inside the spec and the strength cap", () => {
    expect(BLOOM_THRESHOLD).toBe(0.85);
    expect(BLOOM_KNEE).toBe(0.15);
    expect(BLOOM_STRENGTH).toBe(0.45);
    expect(BLOOM_STRENGTH).toBeLessThanOrEqual(0.6);
    expect(BLOOM_FRAGMENT).toContain("0.2270");
    expect(BLOOM_FRAGMENT).toContain("1.3846");
    expect(BLOOM_FRAGMENT).toContain("3.2308");
    expect(BLOOM_FRAGMENT).toContain("sc + uStrength * b");
  });

  it("draws crisp discs, sparkles, twinkle and a minimum pixel size", () => {
    expect(POINT_MIN_PX).toBe(0.7);
    expect(POINTS_VERTEX).toContain("gl_PointSize");
    expect(POINTS_VERTEX).toContain("uMinPx");
    expect(POINTS_VERTEX).toContain("uTwinkle");
    expect(POINTS_VERTEX).toContain("3.2");
    expect(POINTS_FRAGMENT).toContain("gl_PointCoord");
    expect(POINTS_FRAGMENT).toContain("vShape < 0.5");
  });

  it("builds a lumpy lit rock and keeps the Observatory Kuiper belt on the icy palette", () => {
    expect(ROCK_VERTEX).toContain("uStar");
    expect(ROCK_VERTEX).toContain("uTime / aSpin");
    expect(ROCK_FRAGMENT).toContain("vec3(1.0, 0.58, 0.333)");
    expect(ROCK_FRAGMENT).toContain("0.941, 0.863, 0.753");
    expect(ROCK_FRAGMENT).toContain("vType > 2.5");
    const rocks = placeBelts((observatory.belts ?? []).filter((belt) => belt.tier === "kuiper"));
    expect(rocks.length).toBeGreaterThan(0);
    expect(rocks.every((rock) => rock.material === "K")).toBe(true);
    expect(rockTypeIndex("S")).toBe(0);
    expect(rockTypeIndex("C")).toBe(1);
    expect(rockTypeIndex("M")).toBe(2);
    expect(rockTypeIndex("K")).toBe(3);
    const solid = rocks.find((rock) => rock.solid);
    if (!solid) throw new Error("kuiper solid rock");
    const posed = rockOffset(solid, 0);
    expect(posed.x).toBeCloseTo(Math.cos(solid.angle) * solid.distance);
    expect(tumblePeriod(rockSeed(1, solid.shape, solid.distance))).not.toBe(0);
  });

  it("places a world point with y up in device pixels", () => {
    const uniforms = {
      uRes: { value: { set(x: number, y: number) { this.x = x; this.y = y; }, x: 0, y: 0 } },
      uOrigin: { value: { set(x: number, y: number) { this.x = x; this.y = y; }, x: 0, y: 0 } },
      uZoom: { value: 0 },
      uMinPx: { value: 0 },
    };
    syncField(uniforms, { x: 10, y: -4, zoom: 2 }, 800, 600, 1, 3);
    expect(uniforms.uZoom.value).toBe(2);
    expect(uniforms.uRes.value.x).toBe(800);
    expect(uniforms.uRes.value.y).toBe(600);
    expect(uniforms.uOrigin.value.x).toBeCloseTo(400 - 20);
    expect(uniforms.uOrigin.value.y).toBeCloseTo(300 + 8);
    expect(uniforms.uMinPx.value).toBeCloseTo(0.7);
  });
});
