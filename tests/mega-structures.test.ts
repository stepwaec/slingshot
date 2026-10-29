import { describe, expect, it } from "vitest";
import { simConfigFromLevel, torch } from "../src/level/catalog";
import { torchPlan } from "../src/level/solutions";
import { dysonShellHit, frameAcceleration, jetContact, mirrorContains } from "../src/sim/mega";
import {
  SOLAR_RREF,
  bodyPose,
  flyPlan,
  makeState,
  predictPlan,
  solarRechargeRate,
  step,
  type Body,
  type SimConfig,
} from "../src/sim/physics";

function bare(extra: Partial<SimConfig> = {}): SimConfig {
  return {
    g: 1,
    dt: 1 / 60,
    bodies: [],
    bounds: { minX: -8000, maxX: 8000, minY: -8000, maxY: 8000 },
    maxSteps: 4000,
    targetId: "x",
    periapsisMargin: 2,
    c: 1e6,
    ...extra,
  };
}

describe("megastructures", () => {
  const sun: Body = {
    id: "sun",
    name: "sun",
    kind: "star",
    look: "sun",
    x: 0,
    y: 0,
    mass: 0,
    radius: 25.3,
    engine: { angle: 0, burn: 60, scoop: 40, push: 5 },
  };

  it("burns the jet core, refills the margins, and pushes inside the plume", () => {
    const core = jetContact(120, 0, sun.radius, 0);
    expect(core?.core).toBe(true);
    expect(core?.margin).toBe(false);
    expect(core?.plume).toBe(true);

    const half = core?.halfWidth ?? 0;
    const margin = jetContact(120, half, sun.radius, 0);
    expect(margin?.core).toBe(false);
    expect(margin?.margin).toBe(true);
    const outside = jetContact(120, half * 2, sun.radius, 0);
    expect(outside?.core).toBe(false);
    expect(outside?.margin).toBe(false);
    expect(outside?.plume).toBe(false);
    expect(jetContact(10, 0, sun.radius, 0)).toBeNull();

    const config = bare({ bodies: [sun], fuelStart: 10, fuelMax: 100 });
    const burning = makeState(120, 0, 0, 0, config);
    step(burning, config);
    expect(burning.hull).toBeCloseTo(100 - 60 * config.dt, 8);
    expect(burning.vx).toBeCloseTo(5 * config.dt, 6);

    const scooping = makeState(120, half, 0, 0, config);
    step(scooping, config);
    expect(scooping.hull).toBe(100);
    expect(scooping.tank).toBeCloseTo(10 + 40 * config.dt, 8);

    const clear = makeState(120, half * 2, 0, 0, config);
    step(clear, config);
    expect(clear.hull).toBe(100);
    expect(clear.tank).toBe(10);
    expect(clear.vx).toBe(0);
  });

  it("matches prediction to a flight through the jet", () => {
    const config = bare({ bodies: [sun], fuelStart: 20, fuelMax: 100, maxSteps: 30 });
    const start = makeState(80, 2, 40, 0, config);
    const predicted = predictPlan(start, config, []);
    const flown = flyPlan(start, config, [], 1);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.status).toBe(predicted.status);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
    expect(flown.path.length).toBeGreaterThan(2);
  });

  it("dims solar recharge by one coverage and nicks a shell but not a gap", () => {
    const open: Body = { id: "s", name: "s", kind: "star", look: "sun", x: 0, y: 0, mass: 0, radius: 25.3 };
    const covered: Body = { ...open, dyson: { coverage: 0.6, nick: 24 } };
    expect(solarRechargeRate(0, SOLAR_RREF, 0, [open], 10)).toBe(10);
    expect(solarRechargeRate(0, SOLAR_RREF, 0, [covered], 10)).toBeCloseTo(4, 8);

    const rot = (-18 * Math.PI) / 180;
    const x = 78 * Math.cos(rot);
    const y = 78 * Math.sin(rot);
    expect(dysonShellHit(x, y, 25.3)).toBe(true);
    const r = Math.hypot(x, y);
    expect(dysonShellHit((x * (r + 8)) / r, (y * (r + 8)) / r, 25.3)).toBe(false);

    const config = bare({ bodies: [covered] });
    const nicked = makeState(x, y, 0, 0, config);
    step(nicked, config);
    expect(nicked.hull).toBeCloseTo(100 - 24 * config.dt, 8);
    expect(nicked.status).toBe("flying");

    const lane = makeState((x * (r + 8)) / r, (y * (r + 8)) / r, 0, 0, config);
    step(lane, config);
    expect(lane.hull).toBe(100);
  });

  it("crashes on the Shkadov mirror and drifts every body once", () => {
    const star: Body = {
      id: "s",
      name: "s",
      kind: "star",
      x: 0,
      y: 0,
      mass: 0,
      radius: 23,
      shkadov: { angle: 0, accel: 2 },
    };
    expect(mirrorContains(-83, 0, 23, 0)).toBe(true);
    expect(mirrorContains(83, 0, 23, 0)).toBe(false);
    expect(mirrorContains(-70, 0, 23, 0)).toBe(false);
    expect(mirrorContains(-90, 0, 23, 0)).toBe(false);

    const crashed = makeState(-83, 0, 0, 0, bare({ bodies: [star] }));
    step(crashed, bare({ bodies: [star] }));
    expect(crashed.status).toBe("crashed");
    expect(crashed.crashedBodyId).toBe("s:mirror");

    const open = makeState(83, 0, 0, 0, bare({ bodies: [star], maxSteps: 4 }));
    step(open, bare({ bodies: [star], maxSteps: 4 }));
    expect(open.status).toBe("flying");

    const moon: Body = {
      id: "m",
      name: "m",
      kind: "planet",
      x: 10,
      y: 0,
      mass: 1,
      radius: 2,
      orbit: { centerId: "s", radius: 10, phase: 0, omega: 0 },
    };
    const rock: Body = { id: "r", name: "r", kind: "planet", x: 30, y: 5, mass: 1, radius: 2 };
    const bodies = [star, moon, rock];
    expect(frameAcceleration(bodies)).toEqual({ ax: -2, ay: 0 });
    expect(bodyPose(star, 0, bodies).x).toBe(0);
    expect(bodyPose(star, 2, bodies).x).toBeCloseTo(-4, 8);
    expect(bodyPose(star, 2, bodies).vx).toBeCloseTo(-4, 8);
    const starAt = bodyPose(star, 2, bodies);
    const moonAt = bodyPose(moon, 2, bodies);
    expect(moonAt.x - starAt.x).toBeCloseTo(10, 8);
    expect(moonAt.y - starAt.y).toBeCloseTo(0, 8);
    expect(bodyPose(rock, 2, bodies).x).toBeCloseTo(26, 8);
    expect(bodyPose(rock, 2, bodies).y).toBeCloseTo(5, 8);
  });

  it("matches Torch prediction to the flight", () => {
    const config = simConfigFromLevel(torch);
    const start = makeState(torch.ship.x, torch.ship.y, torch.ship.vx, torch.ship.vy, config);
    const predicted = predictPlan(start, config, torchPlan);
    const flown = flyPlan(start, config, torchPlan, 1);
    expect(predicted.status).toBe("won");
    expect(flown.status).toBe("won");
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
  });
});
