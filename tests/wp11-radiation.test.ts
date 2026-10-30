import { describe, expect, it } from "vitest";
import { createGame, toggleRadiation } from "../src/game/state";
import { shipLoadout } from "../src/game/upgrades";
import { observatory, simConfigFromLevel } from "../src/level/catalog";
import { stage as passage } from "./support/stage";
import { slingshotPlan } from "./support/plans";
import {
  DOSE_COSMIC,
  DOSE_DISK,
  DOSE_FLARE_K,
  DOSE_FLARE_R,
  DOSE_PULSAR,
  DOSE_STAR_K,
  DOSE_STAR_R0,
  acceleration,
  bodyPose,
  doseAt,
  flyPlan,
  makeState,
  predictPlan,
  solarRechargeRate,
  starLuminosity,
  step,
  type Body,
  type SimConfig,
} from "../src/sim/physics";

function isolated(body: Body, extra: Partial<SimConfig> = {}): SimConfig {
  return {
    ...simConfigFromLevel(observatory),
    bodies: [body],
    belts: undefined,
    beltRocks: undefined,
    nebulae: undefined,
    wormholes: undefined,
    petrova: undefined,
    knotFuel: undefined,
    ...extra,
  };
}

describe("WP11 radiation", () => {
  const star: Body = {
    id: "sun",
    name: "sun",
    kind: "star",
    look: "sun",
    x: 0,
    y: 0,
    mass: 1000,
    radius: 20,
    flare: { angle: 0, period: 22, start: 0, duration: 6 },
  };

  it("scales a star as L/r² and adds a flare only inside the cone and the window", () => {
    const distance = 170;
    const starTerm = DOSE_STAR_K * starLuminosity(star) * (DOSE_STAR_R0 / distance) ** 2;
    const flareTerm = DOSE_FLARE_K * (DOSE_FLARE_R / distance) ** 1.1;
    const lit = doseAt(distance, 0, 1, [star]);
    expect(lit.source).toBe("flare");
    expect(lit.d).toBeCloseTo(DOSE_COSMIC + starTerm + flareTerm, 8);

    const quiet = doseAt(distance, 0, 10, [star]);
    expect(quiet.source).toBe("star");
    expect(quiet.d).toBeCloseTo(DOSE_COSMIC + starTerm, 8);

    const angle = (30 * Math.PI) / 180;
    const aside = doseAt(distance * Math.cos(angle), distance * Math.sin(angle), 1, [star]);
    expect(aside.source).toBe("star");
    expect(aside.d).toBeCloseTo(DOSE_COSMIC + starTerm, 6);

    const dwarf: Body = { ...star, look: "white-dwarf", flare: undefined };
    const dim = doseAt(distance, 0, 0, [dwarf]);
    expect(dim.d).toBeCloseTo(DOSE_COSMIC + starTerm * 0.2, 8);
  });

  it("drops the star and the flare behind a planet, and keeps the belt annulus", () => {
    const planet: Body = { id: "p", name: "p", kind: "planet", x: 100, y: 0, mass: 10, radius: 20 };
    const hidden = doseAt(140, 0, 1, [star, planet]);
    expect(hidden.source).toBe("shadow");
    expect(hidden.d).toBe(DOSE_COSMIC);
    const open = doseAt(140, 40, 1, [star, planet]);
    expect(open.source).not.toBe("shadow");
    expect(open.d).toBeGreaterThan(hidden.d);

    const giant: Body = {
      id: "g",
      name: "g",
      kind: "planet",
      look: "gas-giant",
      x: 0,
      y: 0,
      mass: 1,
      radius: 40,
    };
    const peak = 2.1 * giant.radius;
    const span = (peak - 3.2 * giant.radius) / (0.5 * giant.radius);
    const outer = 4 * Math.exp(-span * span);
    const belt = doseAt(peak, 0, 0, [giant]);
    expect(belt.source).toBe("belt");
    expect(belt.d).toBeCloseTo(DOSE_COSMIC + 12 + outer, 8);
  });

  it("adds the pulsar beam and a black-hole disk ring", () => {
    const pulsar: Body = {
      id: "pulse",
      name: "pulse",
      kind: "star",
      look: "pulsar",
      x: 0,
      y: 0,
      mass: 1,
      radius: 8,
      beam: { reach: 200, period: 4, damage: 5, base: 40, tip: 40 },
      magnet: { b1Reach: 80, tilt: 0 },
    };
    const hit = doseAt(0, 40, 0, [pulsar]);
    expect(hit.d).toBeGreaterThanOrEqual(DOSE_COSMIC + DOSE_PULSAR);
    expect(hit.source).toBe("pulsar");

    const hole: Body = { id: "hole", name: "hole", kind: "blackhole", x: 0, y: 0, mass: 1, radius: 20 };
    const ring = doseAt(2.4 * hole.radius, 0, 0, [hole]);
    expect(ring.source).toBe("disk");
    expect(ring.d).toBeCloseTo(DOSE_COSMIC + DOSE_DISK, 8);
  });

  it("moves a rogue in a straight line, pulls from there, and crashes on that disc", () => {
    const rogue = observatory.bodies.find((body) => body.kind === "rogue");
    if (!rogue?.drift) throw new Error("observatory rogue");
    const time = 80;
    const pose = bodyPose(rogue, time, [rogue], observatory.g);
    expect(pose.x).toBe(rogue.x + rogue.drift.vx * time);
    expect(pose.y).toBe(rogue.y + rogue.drift.vy * time);
    expect(pose.vx).toBe(rogue.drift.vx);
    expect(solarRechargeRate(pose.x, pose.y, time, [rogue], 12, 1)).toBe(0);

    const config = isolated(rogue, { dosePerD1: 0, doseLimit: 0, maxSteps: 6_000 });
    const early = acceleration(pose.x + rogue.radius + 8, pose.y, config, 0);
    const later = acceleration(pose.x + rogue.radius + 8, pose.y, config, time);
    expect(Math.hypot(later.ax, later.ay)).toBeGreaterThan(Math.hypot(early.ax, early.ay) * 5);

    const waiting = makeState(pose.x, pose.y, 0, 0, config);
    let guard = 0;
    while (waiting.status === "flying" && guard++ < 6_000) step(waiting, config);
    expect(waiting.status).toBe("crashed");
    expect(waiting.crashedBodyId).toBe(rogue.id);
    expect(waiting.t).toBeGreaterThan(1);
    expect(waiting.t).toBeLessThan(time);
  });

  it("halves dose with shielding and makes the same burn push less", () => {
    expect(shipLoadout(["shield"]).shield).toBe(0.5);
    expect(shipLoadout(["shield"]).mass).toBeCloseTo(1.3);
    const home = observatory.bodies.find((body) => body.kind === "home");
    if (!home) throw new Error("observatory home");
    const open = isolated(home, { maxSteps: 400 });
    const shielded = simConfigFromLevel(observatory, ["shield"]);
    const clad = isolated(home, {
      maxSteps: 400,
      shield: shielded.shield,
      shipMass: shielded.shipMass,
      fuelPerDv: shielded.fuelPerDv,
      fuelStart: shielded.fuelStart,
      fuelMax: shielded.fuelMax,
    });
    expect(clad.shield).toBe(0.5);
    expect(clad.shipMass).toBeCloseTo(1.3);
    expect(clad.fuelPerDv).toBeCloseTo(observatory.fuelPerDv * 1.3);
    const start = makeState(home.x + 120, home.y, 0, 2, open);
    const coastOpen = predictPlan(start, open, []);
    const coastClad = predictPlan(start, clad, []);
    expect(coastClad.path[200].x).toBe(coastOpen.path[200].x);
    expect(coastOpen.final.dose).toBeGreaterThan(0);
    expect(coastClad.final.dose).toBeCloseTo(coastOpen.final.dose * 0.5, 8);
    const launch = [{ step: 0, dvx: 1, dvy: 0 }];
    const burnedOpen = predictPlan(start, open, launch);
    const burnedClad = predictPlan(start, clad, launch);
    expect(burnedClad.path[80].x).not.toBe(burnedOpen.path[80].x);
  });

  it("fails the mission when the crew dose reaches the limit", () => {
    const home = observatory.bodies.find((body) => body.kind === "home");
    if (!home) throw new Error("observatory home");
    const config = isolated(home, { dosePerD1: 10, doseLimit: 0.01, maxSteps: 600 });
    const state = makeState(home.x + 500, home.y + 500, 0, 0, config);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.status).toBe("lost");
    expect(flown.lostReason).toBe("dose");
    const predicted = predictPlan(state, config, []);
    expect(predicted.status).toBe("lost");
    expect(predicted.lostReason).toBe("dose");
    expect(predicted.final.dose).toBe(config.doseLimit);
    expect(predicted.path.length).toBe(flown.path.length);
    expect(predicted.path[0].x).toBe(flown.path[0].x);
  });

  it("leaves stock flights at zero dose, and the radiation toggle does not touch the plan", () => {
    const config = simConfigFromLevel(passage);
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, config);
    const predicted = predictPlan(state, config, slingshotPlan);
    expect(predicted.final.dose).toBe(0);
    expect(predicted.final.doseRate).toBe(0);
    expect(predicted.status).toBe("won");

    const game = createGame();
    const before = game.prediction;
    toggleRadiation(game);
    expect(game.radiation).toBe(true);
    expect(game.prediction).toBe(before);
    expect(before.final.dose).toBeGreaterThan(0);
  });

  it("matches prediction to flight near the Observatory rogue", () => {
    const rogue = observatory.bodies.find((body) => body.kind === "rogue");
    if (!rogue) throw new Error("observatory rogue");
    const config = isolated(rogue, { maxSteps: 80 });
    const state = makeState(rogue.x + 180, rogue.y + 40, 1, 0, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.status).toBe(predicted.status);
    expect(predicted.final.dose).toBeGreaterThan(0);
    expect(flown.path.length).toBe(predicted.path.length);
    for (let i = 0; i < flown.path.length; i++) {
      expect(flown.path[i].x).toBe(predicted.path[i].x);
      expect(flown.path[i].y).toBe(predicted.path[i].y);
      expect(flown.path[i].step).toBe(predicted.path[i].step);
    }
  });
});
