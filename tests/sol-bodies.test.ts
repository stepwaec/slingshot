import { describe, expect, it } from "vitest";
import { observatory, simConfigFromLevel } from "../src/level/catalog";
import { artForBody } from "../src/render/art-sprite";
import { SOL_LOOKS, solArt } from "../src/render/sol-art";
import { theme } from "../src/render/theme";
import {
  bodyPose,
  bodySolid,
  flyPlan,
  keplerMeanMotion,
  makeState,
  predictPlan,
  type Body,
  type BurnNode,
} from "../src/sim/physics";

function body(id: string): Body {
  const found = observatory.bodies.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

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

  it("keeps moon orbits on Kepler circles about their planets", () => {
    const pairs = [
      ["luna", "earth"],
      ["titan", "saturn"],
      ["charon", "pluto"],
    ] as const;
    for (const [moonId, parentId] of pairs) {
      const moon = body(moonId);
      const parent = body(parentId);
      const orbit = moon.orbit;
      expect(orbit?.centerId).toBe(parentId);
      expect(orbit?.omega).toBeCloseTo(keplerMeanMotion(observatory.g, parent.mass, orbit?.radius ?? 0), 10);
    }
    const luna = body("luna");
    const earth = body("earth");
    const t = 40;
    const pose = bodyPose(luna, t, observatory.bodies, observatory.g);
    const center = bodyPose(earth, t, observatory.bodies, observatory.g);
    const orbit = luna.orbit;
    const angle = (orbit?.phase ?? 0) + (orbit?.omega ?? 0) * t;
    expect(pose.x).toBeCloseTo(center.x + (orbit?.radius ?? 0) * Math.cos(angle), 8);
    expect(pose.y).toBeCloseTo(center.y + (orbit?.radius ?? 0) * Math.sin(angle), 8);
  });

  it("matches prediction to flight for a Sol orbit, and Voyager is not solid", () => {
    const config = { ...simConfigFromLevel(observatory), maxSteps: 180 };
    const state = makeState(observatory.ship.x, observatory.ship.y, observatory.ship.vx, observatory.ship.vy, config);
    const nodes: BurnNode[] = [{ step: 30, dvx: 0.4, dvy: -0.2 }];
    const predicted = predictPlan(state, config, nodes);
    const flown = flyPlan(state, config, nodes, 1);
    expect(flown.status).toBe(predicted.status);
    expect(flown.crashedBodyId).toBe(predicted.crashedBodyId);
    expect(flown.path).toHaveLength(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(flown.path[i]?.x).toBe(predicted.path[i]?.x);
      expect(flown.path[i]?.y).toBe(predicted.path[i]?.y);
      expect(flown.path[i]?.step).toBe(predicted.path[i]?.step);
    }

    const voyager = body("voyager");
    expect(bodySolid(voyager)).toBe(false);
    expect(voyager.solid).toBe(false);
    const pose = bodyPose(voyager, 0, observatory.bodies, observatory.g);
    const riding = makeState(pose.x, pose.y, voyager.drift?.vx ?? 0, voyager.drift?.vy ?? 0, config);
    const crossed = flyPlan(riding, { ...config, maxSteps: 90 }, [], 1);
    const crossedPlan = predictPlan(riding, { ...config, maxSteps: 90 }, []);
    expect(crossed.crashedBodyId).toBeNull();
    expect(crossed.status).not.toBe("crashed");
    expect(crossedPlan.path).toEqual(crossed.path);
  });
});
