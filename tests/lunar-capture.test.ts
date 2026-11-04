import { describe, expect, it } from "vitest";
import { simConfigFromLevel } from "../src/level/catalog";
import { bodyPose, flyPlan, makeState, predictPlan, type BurnNode } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";

/** Departure, lunar insertion, leave after one lap, Earth capture. */
const reference: BurnNode[] = [
  { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
  { step: 1209, dvx: 9.207295198561756, dvy: 8.181441674484159 },
  { step: 2911, dvx: 4.169690499008103, dvy: -2.7592899707137617 },
  { step: 4679, dvx: 3.6546281923744104, dvy: 15.317513431665407 },
];

/**
 * Same departure. The insertion is a circularising burn a little early, on
 * time, or late, and not exactly the published vector. Without the skim each
 * of these hits the Moon.
 */
const rough: BurnNode[][] = [
  [
    { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
    { step: 1200, dvx: 8.230609534573455, dvy: 8.780912646795962 },
  ],
  [
    { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
    { step: 1220, dvx: 8.030828834745385, dvy: 8.124356236610337 },
  ],
  [
    { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
    { step: 1260, dvx: 6.560147279915878, dvy: 1.000512700977585 },
  ],
];

describe("a rough lunar arrival can still make a lap", () => {
  const config = simConfigFromLevel(moonMission);
  const start = () => makeState(moonMission.ship.x, moonMission.ship.y, moonMission.ship.vx, moonMission.ship.vy, config);
  const moon = moonMission.bodies.find((body) => body.id === "luna");
  if (!moon) throw new Error("moon");

  it("keeps the published plan a win, and the prediction matches the flight", () => {
    const predicted = predictPlan(start(), config, reference);
    const flown = flyPlan(start(), config, reference, 1);
    expect(predicted.status).toBe("won");
    expect(flown.status).toBe("won");
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      const got = flown.path[i];
      const want = predicted.path[i];
      if (got.x !== want.x || got.y !== want.y || got.step !== want.step) {
        throw new Error(`diverged at sample ${i} (step ${want.step})`);
      }
    }
    let nearest = Infinity;
    for (let i = 0; i < predicted.path.length; i++) {
      const sample = predicted.path[i];
      if (sample.step < 1210 || sample.step > 2900) continue;
      const pose = bodyPose(moon, sample.step * moonMission.dt, moonMission.bodies, moonMission.g);
      nearest = Math.min(nearest, Math.hypot(sample.x - pose.x, sample.y - pose.y));
    }
    expect(nearest).toBeGreaterThan(32);
  });

  it("captures a full lap from an early, a middle, and a late circularising burn", () => {
    for (const plan of rough) {
      const predicted = predictPlan(start(), config, plan);
      const flown = flyPlan(start(), config, plan, 1);
      expect(predicted.final.leg, `step ${plan[1].step}`).toBeGreaterThanOrEqual(1);
      expect(predicted.status, `step ${plan[1].step}`).not.toBe("crashed");
      expect(flown.path.length).toBeGreaterThanOrEqual(predicted.path.length);
      for (let i = 0; i < predicted.path.length; i++) {
        const got = flown.path[i];
        const want = predicted.path[i];
        if (got.x !== want.x || got.y !== want.y || got.step !== want.step) {
          throw new Error(`plan step ${plan[1].step} diverged at sample ${i}`);
        }
      }
    }
  });
});
