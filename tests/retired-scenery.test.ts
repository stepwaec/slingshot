import { describe, expect, it } from "vitest";
import { visualFactories } from "../src/render/visuals/index";

describe("retired scenery", () => {
  it("drops the unauthored washes, the circle wrecks and the empty cloud slot", () => {
    const names = Object.keys(visualFactories);
    expect(names).not.toContain("scenery");
    expect(names).not.toContain("clouds");
    expect(names).toContain("gallery");
    expect(names).toContain("belts");
  });
});
