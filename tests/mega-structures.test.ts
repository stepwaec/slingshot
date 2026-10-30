import { describe, expect, it } from "vitest";
import { observatory } from "../src/level/catalog";
import { LevelError, loadLevelJson } from "../src/level/schema";
import {
  clockChip,
  dysonShellHit,
  frameAcceleration,
  jetContact,
  launchChip,
  launchSpeed,
  mirrorContains,
  ringContains,
  ringRadius,
  tangentialVelocity,
} from "../src/sim/mega";
import {
  SOLAR_RREF,
  bodyPose,
  acceleration,
  cloneState,
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

  it("pulls outward inside a ring, cancels at the centre, and is solid except at a gap", () => {
    const ring = { angle: 0, mass: 800, gaps: [{ start: -0.3, end: 0.3 }] };
    const star: Body = {
      id: "sun",
      name: "sun",
      kind: "star",
      x: 0,
      y: 0,
      mass: 0,
      radius: 23,
      ring,
    };
    const config = bare({ bodies: [star] });
    const centre = acceleration(0, 0, config);
    expect(centre.ax).toBeCloseTo(0, 8);
    expect(centre.ay).toBeCloseTo(0, 8);
    const inside = acceleration(ringRadius(23) / 2, 0, config);
    expect(inside.ax).toBeGreaterThan(0);
    expect(inside.ay).toBeCloseTo(0, 6);
    const outside = acceleration(ringRadius(23) * 2, 0, config);
    expect(outside.ax).toBeLessThan(0);
    const heavy = acceleration(ringRadius(23) / 2, 0, bare({ bodies: [{ ...star, ring: { ...ring, mass: 1600 } }] }));
    expect(heavy.ax / inside.ax).toBeCloseTo(2, 6);

    const reach = ringRadius(23);
    expect(ringContains(reach, 0, 23, 0, ring.gaps)).toBe(false);
    expect(ringContains(0, reach, 23, 0, ring.gaps)).toBe(true);
    expect(ringContains(0, 0, 23, 0, ring.gaps)).toBe(false);

    const hit = makeState(0, reach, 0, 0, config);
    step(hit, config);
    expect(hit.status).toBe("crashed");
    expect(hit.crashedBodyId).toBe("sun:ring");

    const gap = makeState(reach, 0, 0, 0, config);
    step(gap, config);
    expect(gap.status).toBe("flying");

    const crossing = makeState(0, reach - 8, 0, 2400, config);
    step(crossing, config);
    expect(crossing.status).toBe("crashed");

    const through = makeState(reach - 8, 0, 2400, 0, config);
    step(through, config);
    expect(through.status).toBe("flying");
    expect(through.x).toBeGreaterThan(reach);

    const predicted = predictPlan(makeState(reach - 30, 4, 80, 0, bare({ bodies: [star], maxSteps: 40 })), bare({ bodies: [star], maxSteps: 40 }), []);
    const flown = flyPlan(makeState(reach - 30, 4, 80, 0, bare({ bodies: [star], maxSteps: 40 })), bare({ bodies: [star], maxSteps: 40 }), [], 1);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.status).toBe(predicted.status);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
    }
  });

  it("crashes on the tether and throws the ship off the counterweight at ω × r", () => {
    const planet: Body = {
      id: "home",
      name: "home",
      kind: "home",
      x: 0,
      y: 0,
      mass: 0,
      radius: 34,
      elevator: { phase: 0, omega: 0.05 },
    };
    const config = bare({ bodies: [planet] });
    const speed = launchSpeed(34, 0.05);
    expect(speed).toBeCloseTo(0.05 * 270, 8);
    expect(launchChip(speed)).toBe("free Δv 13.5");
    const tang = tangentialVelocity(0.05, 0, 270);
    expect(tang.vx).toBeCloseTo(0, 8);
    expect(tang.vy).toBeCloseTo(13.5, 8);

    const cable = makeState(150, 0, 0, 0, config);
    step(cable, config);
    expect(cable.status).toBe("crashed");
    expect(cable.crashedBodyId).toBe("home:tether");

    const beside = makeState(150, 4, 0, 0, config);
    step(beside, config);
    expect(beside.status).toBe("flying");

    const docked = makeState(270, 0, 0, 0, config);
    step(docked, config);
    expect(docked.status).toBe("flying");
    expect(docked.vx).toBeCloseTo(0, 6);
    expect(docked.vy).toBeCloseTo(13.5, 6);
    const again = cloneState(docked);
    step(again, config);
    expect(again.vy).toBeCloseTo(13.5, 6);

    const approach = bare({ bodies: [planet], maxSteps: 30 });
    const predicted = predictPlan(makeState(262, 0, 20, 0, approach), approach, []);
    const flown = flyPlan(makeState(262, 0, 20, 0, approach), approach, [], 1);
    expect(flown.outsideTime).toBe(predicted.outsideTime);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
    }
    expect(flown.path[flown.path.length - 1].y).toBeGreaterThan(1);
  });

  it("moves the ship through a wormhole and shifts outside time", () => {
    expect(clockChip(3.2 * 3600)).toBe("exit clock +3.2 h");
    expect(clockChip(-90)).toBe("exit clock -90 s");
    const config = bare({
      wormholes: [
        {
          id: "fold",
          a: { x: 0, y: 0, radius: 12 },
          b: { x: 200, y: 40, radius: 10 },
          angle: Math.PI / 2,
          clockOffset: 15,
        },
      ],
      maxSteps: 8,
    });
    const start = makeState(-30, 0, 200, 0, config);
    const flown = flyPlan(start, config, [], 1);
    const predicted = predictPlan(makeState(-30, 0, 200, 0, config), config, []);
    expect(flown.outsideTime).toBe(predicted.outsideTime);
    expect(flown.outsideTime).toBeCloseTo(flown.steps * config.dt + 15, 8);
    expect(flown.path.length).toBe(predicted.path.length);
    let jumped = false;
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
      if (flown.path[i].x === 200 && flown.path[i].y === 40) jumped = true;
    }
    expect(jumped).toBe(true);

    const back = bare({
      wormholes: [
        {
          id: "fold",
          a: { x: 0, y: 0, radius: 12 },
          b: { x: 200, y: 0, radius: 10 },
          angle: Math.PI / 2,
          clockOffset: 15,
        },
      ],
    });
    const returning = makeState(200, 0, 0, -80, back);
    step(returning, back);
    expect(returning.x).toBe(0);
    expect(returning.y).toBe(0);
    expect(returning.vx).toBeCloseTo(-80, 8);
    expect(returning.vy).toBeCloseTo(0, 8);
    expect(returning.t).toBeCloseTo(back.dt - 15, 8);
  });

  it("rejects a ring gap that is not an object", () => {
    const text = JSON.stringify({
      id: "bad",
      name: "Bad",
      g: 1,
      dt: 1 / 60,
      bodies: [
        { id: "h", name: "h", kind: "home", x: 0, y: 0, mass: 1, radius: 2, ring: { angle: 0, mass: 1, gaps: [1] } },
        { id: "x", name: "x", kind: "target", x: 10, y: 0, mass: 1, radius: 2, captureRadius: 6 },
      ],
      targetId: "x",
      ship: { x: 4, y: 0, vx: 0, vy: 1 },
      orbit: { bodyId: "h", radius: 4 },
      fuel: 10,
      fuelPerDv: 1,
      bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
      maxSteps: 10,
      dvPerPixel: 0.2,
      periapsisMargin: 1,
      c: 1000,
      mission: { deadline: 10, crewLimit: 10, fuelStarMin: 0, crewWeight: 1, fuelWeight: 1 },
    });
    expect(() => loadLevelJson(text, "bad.json")).toThrow(LevelError);
    expect(() => loadLevelJson(text, "bad.json")).toThrow(/gaps\[0\] must be an object/);
  });

  it("matches prediction to a flight among the Observatory megastructures", () => {
    const hosts = observatory.bodies.filter((body) => body.engine || body.ring || body.elevator || body.dyson || body.shkadov);
    expect(hosts.length).toBeGreaterThanOrEqual(4);
    expect(observatory.wormholes?.length).toBeGreaterThan(0);
    const config = bare({ bodies: hosts, wormholes: observatory.wormholes, maxSteps: 90 });
    const start = makeState(-400, 1_200, 3, 0, config);
    const nodes = [{ step: 10, dvx: 0.2, dvy: -0.1 }];
    const predicted = predictPlan(start, config, nodes);
    const flown = flyPlan(start, config, nodes, 1);
    expect(flown.status).toBe(predicted.status);
    expect(flown.outsideTime).toBe(predicted.outsideTime);
    expect(flown.path.length).toBe(predicted.path.length);
    expect(flown.path.length).toBeGreaterThan(10);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
  });
});
