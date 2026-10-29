import { describe, expect, it } from "vitest";
import { shipLoadout } from "../src/game/upgrades";
import {
  damageBand,
  ENGINE_PLUMES,
  hullSegmentsLit,
  hullTone,
  stressLevel,
  visibleParts,
  shipBuild,
} from "../src/render/ship-art";
import { STRESS_WARN } from "../src/sim/physics";

describe("ship art rules", () => {
  it("picks one damage overlay from the hull fraction", () => {
    expect(damageBand(100, 100)).toBe("none");
    expect(damageBand(80, 100)).toBe("none");
    expect(damageBand(79, 100)).toBe("75");
    expect(damageBand(50, 100)).toBe("75");
    expect(damageBand(49, 100)).toBe("45");
    expect(damageBand(25, 100)).toBe("45");
    expect(damageBand(24, 100)).toBe("15");
    expect(damageBand(0, 100)).toBe("15");
  });

  it("lights the 10-segment hull bar and colours it by threshold", () => {
    expect(hullSegmentsLit(100, 100)).toBe(10);
    expect(hullSegmentsLit(0, 100)).toBe(0);
    expect(hullSegmentsLit(50, 100)).toBe(5);
    expect(hullTone(100, 100)).toBe("ok");
    expect(hullTone(60, 100)).toBe("ok");
    expect(hullTone(59, 100)).toBe("warn");
    expect(hullTone(30, 100)).toBe("warn");
    expect(hullTone(29, 100)).toBe("critical");
  });

  it("hides the stress chip at zero and turns it red at the existing warning", () => {
    expect(stressLevel(0)).toBe(0);
    expect(stressLevel(0.1)).toBe(1);
    expect(stressLevel(STRESS_WARN / 2)).toBe(2);
    expect(stressLevel(STRESS_WARN)).toBe(3);
  });

  it("stacks fitted parts in draw order and keeps the plume on the shader", () => {
    const build = shipBuild(["hull", "solar", "tanks"], {
      engine: "ion",
      shield: true,
      scoop: false,
      sensors: true,
      cryo: false,
    });
    const parts = visibleParts(build, "45");
    expect(parts.indexOf("platingBack")).toBeLessThan(parts.indexOf("hull"));
    expect(parts.indexOf("hull")).toBeLessThan(parts.indexOf("platingFront"));
    expect(parts.indexOf("shield")).toBe(parts.length - 2);
    expect(parts.at(-1)).toBe("damage");
    expect(parts).toContain("solar");
    expect(parts).not.toContain("scoop");
    expect(ENGINE_PLUMES.chemical.continuous).toBe(true);
    expect(ENGINE_PLUMES.ion.continuous).toBe(true);
    expect(ENGINE_PLUMES.pulse.continuous).toBe(false);
    expect(ENGINE_PLUMES.ion.length).toBeGreaterThan(ENGINE_PLUMES.chemical.length);
  });

  it("does not let the cosmetic engine picture change mass or thrust", () => {
    const stock = shipLoadout([]);
    const fitted = shipLoadout(["engines"]);
    expect(stock.engine).toBe(1);
    expect(stock.mass).toBe(1);
    expect(fitted.engine).toBe(1.15);
    expect(fitted.mass).toBeCloseTo(1.35);
  });
});
