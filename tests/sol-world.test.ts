import { describe, expect, it } from "vitest";
import { WORLD_CHARTS, observatory, simConfigFromLevel } from "../src/level/catalog";
import { placeBelts } from "../src/sim/belts";
import { bodyPose, flyPlan, keplerMeanMotion, makeState, predictPlan, type Body } from "../src/sim/physics";
import { compileMission } from "../src/world/compile";
import { shipOnCircle } from "../src/world/orbit";
import { solChart, solInner, solRadius, solRegions, solWorld } from "../src/world/sol";

const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;

function body(id: string): Body {
  const found = solWorld.bodies.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function sunDistance(id: string): number {
  const orbit = body(id).orbit;
  if (!orbit || orbit.centerId !== "sun") throw new Error(`${id} does not orbit the sun`);
  return orbit.radius;
}

describe("Sol world", () => {
  it("keeps the real order and Kepler mean motion", () => {
    expect(solRadius(1)).toBe(820 * 1.5);
    expect(body("luna").orbit?.radius).toBe(168 * 1.5);
    expect(solRadius(1)).toBeLessThan(solRadius(1.524));
    expect(solRadius(5)).toBeGreaterThan(solRadius(1.524));
    let previous = 0;
    for (const id of PLANETS) {
      const distance = sunDistance(id);
      expect(distance, id).toBeGreaterThan(previous);
      previous = distance;
    }
    expect(sunDistance("pluto")).toBeGreaterThan(sunDistance("neptune"));
    expect(sunDistance("eris")).toBeGreaterThan(sunDistance("pluto"));

    for (const item of solWorld.bodies) {
      const orbit = item.orbit;
      if (!orbit || orbit.kind === "ellipse") continue;
      const center = body(orbit.centerId ?? "");
      expect(orbit.omega, item.id).toBe(keplerMeanMotion(solWorld.g, center.mass, orbit.radius));
    }
  });

  it("puts moons on their planets", () => {
    expect(body("luna").orbit?.centerId).toBe("earth");
    expect(body("io").orbit?.centerId).toBe("jupiter");
    expect(body("europa").orbit?.centerId).toBe("jupiter");
    expect(body("ganymede").orbit?.centerId).toBe("jupiter");
    expect(body("callisto").orbit?.centerId).toBe("jupiter");
    expect(body("titan").orbit?.centerId).toBe("saturn");
    expect(body("triton").orbit?.centerId).toBe("neptune");
    expect(body("charon").orbit?.centerId).toBe("pluto");
    for (const item of solWorld.bodies) {
      if (!item.orbit) continue;
      const center = body(item.orbit.centerId ?? "");
      expect(item.orbit.radius, item.id).toBeGreaterThan(center.radius + item.radius);
    }
  });

  it("places the belts between and beyond the planets", () => {
    const belts = solWorld.belts ?? [];
    const asteroids = belts.find((belt) => belt.id === "asteroids");
    const kuiper = belts.find((belt) => belt.id === "kuiper");
    expect(asteroids).toBeTruthy();
    expect(kuiper).toBeTruthy();
    expect(asteroids!.radius - asteroids!.width / 2).toBeGreaterThan(sunDistance("mars"));
    expect(asteroids!.radius + asteroids!.width / 2).toBeLessThan(sunDistance("jupiter"));
    expect(kuiper!.radius - kuiper!.width / 2).toBeGreaterThan(sunDistance("neptune"));
    const once = placeBelts(belts);
    const twice = placeBelts(belts);
    expect(twice).toBe(once);
    expect(once.length).toBeGreaterThan(100);
    expect(once.length).toBeLessThan(12_000);
    expect(once.some((rock) => rock.beltId === "kuiper" && rock.material === "K")).toBe(true);
  });

  it("shares the world's bodies with the flyable chart", () => {
    expect(solChart.bodies[0]).toBe(solWorld.bodies[0]);
    expect(solChart.g).toBe(solWorld.g);
    expect(solChart.dt).toBe(solWorld.dt);
    expect(solChart.c).toBe(solWorld.c);
    expect(WORLD_CHARTS[0]).toBe(solChart);
    expect(solChart.id).not.toBe(observatory.id);
    expect(solChart.frame).toEqual(solInner.bounds);
  });

  it("flies the inner region with prediction matching the flight", () => {
    const ship = shipOnCircle(solWorld.bodies, "earth", 52, Math.PI, solWorld.g);
    const level = compileMission([solWorld], solRegions, {
      id: "inner-coast",
      name: "Inner coast",
      worldId: "sol",
      regionId: "inner",
      ship,
      orbit: { bodyId: "earth", radius: 52 },
      fuel: 40,
      fuelPerDv: 1,
      maxSteps: 1_200,
      dvPerPixel: 0.5,
      periapsisMargin: 4,
      scoring: { deadline: 30, crewLimit: 30, fuelStarMin: 10, crewWeight: 1, fuelWeight: 1 },
      objectives: [],
      targetId: "sun",
    });
    const config = simConfigFromLevel(level);
    const state = makeState(ship.x, ship.y, ship.vx, ship.vy, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(predicted.status).toBe("lost");
    expect(predicted.lostReason).toBe("timeout");
    expect(flown.status).toBe(predicted.status);
    expect(flown.lostReason).toBe(predicted.lostReason);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      const got = flown.path[i];
      const want = predicted.path[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step) {
        throw new Error(`diverged at sample ${i} (step ${want.step})`);
      }
    }
    const earth = body("earth");
    const end = flown.path[flown.path.length - 1];
    const earthPose = bodyPose(earth, end.step * level.dt, level.bodies, solWorld.g);
    const radius = Math.hypot(end.x - earthPose.x, end.y - earthPose.y);
    expect(radius).toBeGreaterThan(earth.radius + 8);
    expect(radius).toBeLessThan(90);
  });
});
