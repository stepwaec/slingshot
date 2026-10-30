import { describe, expect, it } from "vitest";
import { simConfigFromLevel } from "../src/level/catalog";
import { stage as passage } from "./support/stage";
import { sampleGravityGrid } from "../src/render/gravityField";
import {
  acceleration,
  flyPlan,
  makeState,
  potentialDepth,
  predictPlan,
  properTimeRate,
  rateFrom,
  type Body,
  type BurnNode,
  type SimConfig,
  type SimState,
} from "../src/sim/physics";

const bounds = { minX: -1e7, maxX: 1e7, minY: -1e7, maxY: 1e7 };

function star(mass = 8_000): Body {
  return { id: "star", name: "star", kind: "star", x: 0, y: 0, mass, radius: 6 };
}

function config(extra: Partial<SimConfig> = {}, mass = 8_000): SimConfig {
  return {
    g: 1,
    dt: 1 / 60,
    c: 1_000_000,
    bodies: [star(mass)],
    bounds,
    maxSteps: 300,
    targetId: "star",
    periapsisMargin: 1,
    ...extra,
  };
}

function launchState(cfg: SimConfig, x = -180, y = 50, vx = 22, vy = 0): SimState {
  return makeState(x, y, vx, vy, cfg);
}

function expectPredictionMatchesFlight(cfg: SimConfig, state: SimState, nodes: readonly BurnNode[] = []): void {
  const predicted = predictPlan(state, cfg, nodes);
  const flown = flyPlan(state, cfg, nodes, 1);
  expect(flown.status).toBe(predicted.status);
  expect(flown.steps).toBe(predicted.steps);
  expect(flown.outsideTime).toBe(predicted.outsideTime);
  expect(flown.shipTime).toBe(predicted.shipTime);
  expect(flown.path.length).toBe(predicted.path.length);
  for (let i = 0; i < flown.path.length; i++) {
    const got = flown.path[i];
    const want = predicted.path[i];
    if (got.x !== want.x || got.y !== want.y || got.step !== want.step || got.rate !== want.rate) {
      throw new Error(
        `prediction diverged at sample ${i} (step ${want.step}): flight (${got.x}, ${got.y}, rate ${got.rate}) vs (${want.x}, ${want.y}, rate ${want.rate})`,
      );
    }
  }
}

function finalY(cfg: SimConfig): number {
  const flown = flyPlan(launchState(cfg), cfg, [], 1);
  return flown.path[flown.path.length - 1].y;
}

describe("physics knobs", () => {
  it("keeps explicit defaults bit-identical to an omitted block", () => {
    const plain = config();
    const explicit = config({
      gravityScale: 1,
      eps: 0,
      p: 2,
      dilationStrength: 1,
      dilationCap: Number.POSITIVE_INFINITY,
      tidalStrength: 0,
      dragStrength: 0,
    });
    const point = { x: 80, y: -30 };
    const a = acceleration(point.x, point.y, plain);
    const b = acceleration(point.x, point.y, explicit);
    expect(b.ax).toBe(a.ax);
    expect(b.ay).toBe(a.ay);
    expect(potentialDepth(point.x, point.y, explicit)).toBe(potentialDepth(point.x, point.y, plain));
    expect(properTimeRate(point.x, point.y, 12, -4, explicit)).toBe(properTimeRate(point.x, point.y, 12, -4, plain));
    const state = launchState(plain);
    const left = flyPlan(state, plain, [], 1);
    const right = flyPlan(state, explicit, [], 1);
    expect(right.shipTime).toBe(left.shipTime);
    expect(right.path.length).toBe(left.path.length);
    expect(right.path[right.path.length - 1].x).toBe(left.path[left.path.length - 1].x);
    expect(right.path[right.path.length - 1].y).toBe(left.path[left.path.length - 1].y);
  });

  it("bends more when gravityScale is higher, and prediction matches the flight", () => {
    const mild = config({ gravityScale: 1 });
    const heavy = config({ gravityScale: 2 });
    const at = acceleration(100, 0, mild);
    const harder = acceleration(100, 0, heavy);
    expect(harder.ax / at.ax).toBeCloseTo(2, 12);
    expect(finalY(heavy)).toBeLessThan(finalY(mild));
    expectPredictionMatchesFlight(heavy, launchState(heavy));
  });

  it("softens a close pass when eps is larger, and prediction matches the flight", () => {
    const point = config({ eps: 0 }, 20_000);
    const soft = config({ eps: 40 }, 20_000);
    const r = 25;
    const sharp = Math.hypot(acceleration(r, 0, point).ax, acceleration(r, 0, point).ay);
    const dull = Math.hypot(acceleration(r, 0, soft).ax, acceleration(r, 0, soft).ay);
    expect(dull).toBeLessThan(sharp);
    const state = launchState(soft, -120, 20, 18, 0);
    expect(finalY(soft)).toBeGreaterThan(finalY(point));
    expectPredictionMatchesFlight(soft, state);
  });

  it("falls off faster for a larger p, with a potential that matches the force", () => {
    const newton = config({ p: 2 });
    const steep = config({ p: 3 });
    const r = 80;
    const newtonA = Math.hypot(acceleration(r, 0, newton).ax, acceleration(r, 0, newton).ay);
    const steepA = Math.hypot(acceleration(r, 0, steep).ax, acceleration(r, 0, steep).ay);
    expect(steepA).toBeLessThan(newtonA);
    expect(finalY(steep)).toBeGreaterThan(finalY(newton));
    expectPredictionMatchesFlight(steep, launchState(steep));

    const samples: Array<{ eps: number; p: number; r: number }> = [
      { eps: 0, p: 2, r: 40 },
      { eps: 0, p: 2.5, r: 40 },
      { eps: 12, p: 2, r: 30 },
      { eps: 12, p: 2.8, r: 8 },
      { eps: 12, p: 2.8, r: 40 },
      { eps: 4, p: 3, r: 0.5 },
    ];
    for (const sample of samples) {
      const cfg = config({ eps: sample.eps, p: sample.p }, 1);
      const dr = 1e-4;
      const ahead = potentialDepth(sample.r + dr, 0, cfg);
      const behind = potentialDepth(sample.r - dr, 0, cfg);
      const slope = (ahead - behind) / (2 * dr);
      const a = acceleration(sample.r, 0, cfg);
      expect(slope, `p=${sample.p} eps=${sample.eps} r=${sample.r}`).toBeCloseTo(a.ax, 4);
    }

    const center = config({ eps: 10, p: 3 }, 1);
    expect(potentialDepth(0, 0, center)).toBeCloseTo(1 / 100, 8);
    const offAxis = config({ eps: 6, p: 2.4 }, 1);
    const h = 1e-3;
    const x = 14;
    const y = -9;
    const gx = (potentialDepth(x + h, y, offAxis) - potentialDepth(x - h, y, offAxis)) / (2 * h);
    const gy = (potentialDepth(x, y + h, offAxis) - potentialDepth(x, y - h, offAxis)) / (2 * h);
    const grad = acceleration(x, y, offAxis);
    expect(gx).toBeCloseTo(grad.ax, 4);
    expect(gy).toBeCloseTo(grad.ay, 4);
  });

  it("lowers c without moving the ship, and prediction matches the flight", () => {
    const mass = 50_000;
    const far = config({ c: 1_000_000 }, mass);
    const near = config({ c: 40 }, mass);
    const state = launchState(far, -80, 30, 10, 2);
    const wide = flyPlan(state, far, [], 1);
    const tight = flyPlan(state, near, [], 1);
    expect(tight.path.length).toBe(wide.path.length);
    for (let i = 0; i < wide.path.length; i++) {
      expect(tight.path[i].x).toBe(wide.path[i].x);
      expect(tight.path[i].y).toBe(wide.path[i].y);
    }
    expect(tight.shipTime).toBeLessThan(wide.shipTime);
    expectPredictionMatchesFlight(near, state);
  });

  it("scales dilation with dilationStrength, and prediction matches the flight", () => {
    const mass = 50_000;
    const calm = config({ c: 40, dilationStrength: 1 }, mass);
    const deep = config({ c: 40, dilationStrength: 2 }, mass);
    const state = launchState(calm, -80, 30, 10, 2);
    const once = flyPlan(state, calm, [], 1);
    const twice = flyPlan(state, deep, [], 1);
    expect(twice.path[twice.path.length - 1].x).toBe(once.path[once.path.length - 1].x);
    expect(twice.shipTime).toBeLessThan(once.shipTime);
    const mild = config({ c: 40, dilationStrength: 2 }, 5_000);
    const phi = potentialDepth(200, 0, mild);
    const speed = 5;
    const c = 40;
    const expected = Math.sqrt(1 - 2 * ((2 * phi) / (c * c) + (speed * speed) / (c * c)));
    expect(expected).toBeGreaterThan(0);
    expect(properTimeRate(200, 0, speed, 0, mild)).toBeCloseTo(expected, 12);
    expectPredictionMatchesFlight(deep, state);
  });

  it("bounds the rate with dilationCap, and prediction matches the flight", () => {
    const cap = 10;
    const floor = 1 / cap;
    const flightC = 40;
    const horizon = 40;
    const flightMass = (horizon * flightC * flightC) / 2;
    const plain: SimConfig = {
      ...config({ c: flightC }),
      maxSteps: 2000,
      bodies: [{ id: "hole", name: "hole", kind: "blackhole", x: 0, y: 0, mass: flightMass, radius: 8 }],
    };
    const capped: SimConfig = { ...plain, dilationCap: cap };
    const start = makeState(100, 0, -6, 0, plain);
    const open = flyPlan(start, plain, [], 1);
    const held = flyPlan(start, capped, [], 1);
    expect(held.path.length).toBe(open.path.length);
    let uncappedHitFloor = false;
    let capLiftedARate = false;
    for (let i = 0; i < open.path.length; i++) {
      expect(held.path[i].x).toBe(open.path[i].x);
      expect(held.path[i].y).toBe(open.path[i].y);
      expect(held.path[i].rate).toBeGreaterThanOrEqual(floor - 1e-12);
      if (open.path[i].rate === 0) uncappedHitFloor = true;
      if (held.path[i].rate > open.path[i].rate + 1e-9) capLiftedARate = true;
    }
    expect(uncappedHitFloor).toBe(true);
    expect(capLiftedARate).toBe(true);
    expect(held.shipTime).toBeGreaterThan(open.shipTime);
    expectPredictionMatchesFlight(capped, start);

    const c = 40;
    const radius = 30;
    const mass = (radius * c * c) / 2;
    const hole: SimConfig = {
      ...config({ c, dilationCap: cap }),
      bodies: [{ id: "hole", name: "hole", kind: "blackhole", x: 0, y: 0, mass, radius }],
    };
    expect(properTimeRate(radius, 0, 0, 0, hole)).toBeGreaterThanOrEqual(floor);
    expect(properTimeRate(radius * 0.25, 0, c * 0.99, 0, hole)).toBeGreaterThanOrEqual(floor);
    const sunk = rateFrom(Number.POSITIVE_INFINITY, c, 0, c, 1, cap);
    expect(sunk).toBeGreaterThanOrEqual(floor);
    expect(sunk).toBeCloseTo(floor, 6);

    const knee = 4 * floor * floor;
    const phiKnee = ((1 - knee) * c * c) / 2;
    const db = 1e-6;
    const phiAt = (bare: number) => ((1 - bare) * c * c) / 2;
    const rate = (phi: number) => rateFrom(phi, 0, 0, c, 1, cap);
    const slopeAbove = (rate(phiAt(knee + db)) - rate(phiKnee)) / db;
    const slopeBelow = (rate(phiKnee) - rate(phiAt(knee - db))) / db;
    expect(rate(phiKnee)).toBeCloseTo(Math.sqrt(knee), 10);
    expect(slopeAbove).toBeCloseTo(slopeBelow, 3);
    expect(slopeAbove).toBeCloseTo(0.5 / Math.sqrt(knee), 3);

    const steps = 4000;
    let previous = properTimeRate(radius * 6, 0, 0, 0, hole);
    for (let i = 1; i <= steps; i++) {
      const r = radius * 6 + (radius * 0.2 - radius * 6) * (i / steps);
      const next = properTimeRate(r, 0, 0, 0, hole);
      expect(next).toBeGreaterThanOrEqual(floor - 1e-12);
      expect(next).toBeLessThanOrEqual(previous + 1e-12);
      expect(Math.abs(next - previous)).toBeLessThan(0.01);
      expect(Number.isFinite(next)).toBe(true);
      previous = next;
    }
    previous = rateFrom(0, 0, 0, c, 1, cap);
    for (let i = 1; i <= steps; i++) {
      const v = (2 * c * i) / steps;
      const next = rateFrom(0, v, 0, c, 1, cap);
      expect(next).toBeGreaterThanOrEqual(floor - 1e-12);
      expect(next).toBeLessThanOrEqual(previous + 1e-12);
      expect(Math.abs(next - previous)).toBeLessThan(0.01);
      previous = next;
    }
    expect(rateFrom(0, 2 * c, 0, c, 1, cap)).toBeGreaterThan(floor);
    expect(rateFrom(0, 2 * c, 0, c, 1, cap)).toBeLessThan(0.2);

    const grid = sampleGravityGrid(capped, 0, { minX: -80, maxX: 80, minY: -40, maxY: 40 }, 5, 3);
    for (let i = 0; i < grid.rate.length; i++) {
      const x = grid.minX + grid.stepX * (i % grid.cols);
      const y = grid.minY + grid.stepY * Math.floor(i / grid.cols);
      expect(grid.rate[i]).toBe(properTimeRate(x, y, 0, 0, capped, 0));
      expect(grid.depth[i]).toBe(potentialDepth(x, y, capped, 0));
    }
  });

  it("stores tidal and drag without changing the flight", () => {
    const level: typeof passage = {
      ...passage,
      physics: { tidalStrength: 3, dragStrength: 4 },
    };
    const tuned = simConfigFromLevel(level);
    expect(tuned.tidalStrength).toBe(3);
    expect(tuned.dragStrength).toBe(4);
    const plain = { ...simConfigFromLevel(passage), maxSteps: 200 };
    const state = makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, plain);
    const nodes = [{ step: 0, dvx: 1, dvy: 0.5 }];
    const left = flyPlan(state, plain, nodes, 1);
    const right = flyPlan(state, { ...plain, tidalStrength: 3, dragStrength: 4 }, nodes, 1);
    const tunedFlight = flyPlan(
      makeState(passage.ship.x, passage.ship.y, passage.ship.vx, passage.ship.vy, tuned),
      { ...tuned, maxSteps: 200 },
      nodes,
      1,
    );
    expect(tunedFlight.path.length).toBeGreaterThan(10);
    expect(right.shipTime).toBe(tunedFlight.shipTime);
    expect(right.path[10].x).toBe(tunedFlight.path[10].x);
    expect(left.path[10].x).toBe(right.path[10].x);
    expect(left.path[10].rate).toBe(right.path[10].rate);
    expectPredictionMatchesFlight({ ...tuned, maxSteps: 200 }, state, nodes);
  });
});
