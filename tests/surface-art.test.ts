import { describe, expect, it } from "vitest";
import type { Body } from "../src/sim/physics";
import { stripsFor, surfaceKind } from "../src/render/surface-art";

function body(kind: Body["kind"], look?: Body["look"]): Body {
  return { id: "b", kind, look, x: 0, y: 0, mass: 1, radius: 10 } as Body;
}

describe("lively surfaces", () => {
  it("scrolls every planet that has a strip, and leaves stars alone", () => {
    expect(surfaceKind(body("home"))).toBe("ocean");
    expect(surfaceKind(body("target"))).toBe("planetx");
    expect(surfaceKind(body("planet", "gas-giant"))).toBe("giant");
    expect(surfaceKind(body("moon", "moon"))).toBe("moon");
    expect(surfaceKind(body("moon", "moon-icy"))).toBe("moon-icy");
    expect(surfaceKind(body("moon", "moon-volcanic"))).toBe("moon-volcanic");
    expect(surfaceKind(body("moon", "dwarf"))).toBe("dwarf");
    expect(surfaceKind(body("star", "sun"))).toBeNull();
  });

  it("uses the header periods, with clouds faster than the ground and giant bands in both directions", () => {
    const ocean = stripsFor("ocean");
    expect(ocean[0]?.dur).toBe(90);
    expect(ocean[2]?.dur).toBe(64);
    expect(ocean[2]?.id).toBe("ps-clouds");
    const giant = stripsFor("giant");
    expect(giant.map((strip) => strip.distance)).toEqual([276, -276, 276]);
    expect(stripsFor("moon")[0]).toMatchObject({ dur: 180, distance: 88 });
    expect(stripsFor("moon-icy")[0]).toMatchObject({ dur: 150, distance: 75 });
    expect(stripsFor("moon-volcanic").map((strip) => strip.id)).toEqual(["mv-surface", "mv-hot"]);
    expect(stripsFor("dwarf")[0]).toMatchObject({ dur: 160, distance: 63 });
    expect(stripsFor("planetx")[2]?.id).toBe("px-wisps");
    expect(stripsFor("planetx")[2]?.dur).toBeLessThan(stripsFor("planetx")[0]?.dur ?? 0);
  });
});
