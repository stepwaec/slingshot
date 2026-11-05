import { describe, expect, it } from "vitest";
import { simConfigFromLevel } from "../src/level/catalog";
import { STAR_PARAMS } from "../src/render/shaders/star-params";
import { solGameVisualRadius } from "../src/render/sol-scale";
import {
  bodyCrashRadius,
  bodyPose,
  flyPlan,
  makeState,
  predictPlan,
  step,
  type Body,
} from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";
import { solWorld } from "../src/world/sol";

function body(id: string): Body {
  const found = solWorld.bodies.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("the Sol Sun's drawn disc is lethal", () => {
  const sun = body("sun");
  const earth = body("earth");
  const disc = bodyCrashRadius(sun);
  const config = simConfigFromLevel(moonMission);

  it("uses one radius for the impostor and the crash", () => {
    expect(sun.radius).toBe(46);
    expect(disc).toBe(solGameVisualRadius(sun, earth.radius));
    expect(disc).toBeGreaterThan(sun.radius * 5);
    const corona = disc * STAR_PARAMS["sol-sun"].wiR;
    expect(corona).toBeGreaterThan(disc);
  });

  it("crashes inside the photosphere and coasts through the corona", () => {
    const inside = makeState(disc - 1, 0, 0, 0, config);
    step(inside, config);
    expect(inside.status).toBe("crashed");
    expect(inside.crashedBodyId).toBe("sun");
    expect(Math.hypot(inside.x, inside.y)).toBeCloseTo(disc, 6);

    const artHeader = makeState(sun.radius + 20, 0, 0, 0, config);
    expect(Math.hypot(artHeader.x, artHeader.y)).toBeLessThan(disc);
    expect(Math.hypot(artHeader.x, artHeader.y)).toBeGreaterThan(sun.radius);
    step(artHeader, config);
    expect(artHeader.status).toBe("crashed");
    expect(artHeader.crashedBodyId).toBe("sun");

    const corona = disc * Math.max(1, STAR_PARAMS["sol-sun"].wiR, STAR_PARAMS["sol-sun"].flR);
    const glow = (disc + corona) / 2;
    expect(glow).toBeGreaterThan(disc);
    expect(glow).toBeLessThan(corona);
    const throughGlow = makeState(glow, 0, 0, 0, config);
    step(throughGlow, config);
    expect(throughGlow.status).toBe("flying");
    expect(throughGlow.crashedBodyId).toBeNull();

    const clear = makeState(disc + 2, 0, 0, 0, config);
    step(clear, config);
    expect(clear.status).toBe("flying");
  });

  it("matches prediction and flight when a coast crosses the disc", () => {
    const start = makeState(disc + 40, 12, -80, 0, config);
    const predicted = predictPlan(start, config, []);
    const flown = flyPlan(start, config, [], 1);
    expect(predicted.status).toBe("crashed");
    expect(predicted.crashedBodyId).toBe("sun");
    expect(flown.status).toBe(predicted.status);
    expect(flown.crashedBodyId).toBe(predicted.crashedBodyId);
    expect(flown.steps).toBe(predicted.steps);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(predicted.steps).toBeGreaterThan(0);
    expect(predicted.steps).toBeLessThan(90);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
    const end = predicted.path[predicted.path.length - 1];
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(disc, 4);
  });

  it("still crashes Earth on Earth's own radius", () => {
    const pose = bodyPose(earth, 0, solWorld.bodies, solWorld.g);
    const hit = makeState(pose.x + earth.radius - 0.5, pose.y, 0, 0, config);
    step(hit, config);
    expect(hit.status).toBe("crashed");
    expect(hit.crashedBodyId).toBe("earth");
    expect(Math.hypot(hit.x - pose.x, hit.y - pose.y)).toBeCloseTo(earth.radius, 5);

    const low = makeState(pose.x + earth.radius + 2, pose.y, pose.vx, pose.vy, config);
    step(low, config);
    expect(low.status).toBe("flying");
    expect(low.crashedBodyId).toBeNull();
  });

  it("leaves a low Earth orbit outside the Sun", () => {
    const start = makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    const predicted = predictPlan(start, config, []);
    expect(predicted.crashedBodyId).toBeNull();
    expect(predicted.status).not.toBe("crashed");
    let nearest = Infinity;
    for (let i = 0; i < predicted.path.length; i++) {
      nearest = Math.min(nearest, Math.hypot(predicted.path[i].x, predicted.path[i].y));
    }
    expect(nearest).toBeGreaterThan(disc);

    const flown = makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
    for (let i = 0; i < 120; i++) step(flown, config);
    expect(flown.status).toBe("flying");
    expect(Math.hypot(flown.x, flown.y)).toBeGreaterThan(disc);
  });
});
