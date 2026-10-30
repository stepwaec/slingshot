import { describe, expect, it } from "vitest";
import { observatory } from "../src/level/catalog";
import { artForBody } from "../src/render/art-sprite";
import { SOL_LOOKS, solArt } from "../src/render/sol-art";
import { theme } from "../src/render/theme";
import { bodySolid, type Body } from "../src/sim/physics";

describe("Sol bodies", () => {
  it("places every library look in the Observatory at the size ladder", () => {
    for (const look of SOL_LOOKS) {
      const art = solArt(look);
      const placed = observatory.bodies.find((item) => item.look === look);
      expect(placed, look).toBeTruthy();
      expect(placed?.radius).toBe(art.radius);
      expect(artForBody(placed as Body, theme)?.url).toBe(theme.assets[art.asset]);
    }
  });

  it("scrolls strips on the header periods and keeps locked faces fixed", () => {
    expect(solArt("venus").strips[0]).toMatchObject({ dur: 96, distance: -208, fromX: 208 });
    expect(solArt("earth").strips.map((strip) => [strip.id, strip.dur, strip.night ?? false])).toEqual([
      ["eth-land", 90, false],
      ["eth-cloud-shadow", 64, false],
      ["eth-clouds", 64, false],
      ["eth-cities", 90, true],
    ]);
    expect(solArt("mercury").strips[0]).toMatchObject({ dur: 300, distance: 132 });
    expect(solArt("mars").strips[0]?.dur).toBe(92);
    expect(solArt("jupiter").strips[0]?.dur).toBe(240);
    expect(solArt("saturn").strips[0]).toMatchObject({ dur: 260, rollDeg: -14 });
    expect(solArt("uranus").strips[0]).toMatchObject({ dur: 140, rollDeg: -62 });
    expect(solArt("titan").strips[0]?.dur).toBe(160);
    expect(solArt("neptune").strips[0]?.dur).toBe(120);
    expect(solArt("sol-sun").strips[0]).toMatchObject({ dur: 180, distance: 289, opacity: 0.92 });
    expect(solArt("luna").strips).toEqual([]);
    expect(solArt("pluto").strips).toEqual([]);
    expect(solArt("charon").strips).toEqual([]);
    expect(solArt("saturn").ringShadow).toBe(true);
    expect(solArt("uranus").rings).toBe(true);
    expect(solArt("uranus").ringShadow).toBe(false);
  });

  it("draws Voyager as a prop that does not collide", () => {
    const voyager = observatory.bodies.find((item) => item.look === "voyager");
    expect(voyager?.solid).toBe(false);
    expect(bodySolid(voyager as Body)).toBe(false);
    expect(voyager?.orbit).toBeUndefined();
  });
});
