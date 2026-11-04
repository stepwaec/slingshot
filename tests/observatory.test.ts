import { describe, expect, it } from "vitest";
import { LEVELS, observatory, simConfigFromLevel } from "../src/level/catalog";
import { observatoryPlacards, observatoryShips, shipModuleKeys } from "../src/level/observatory";
import { BODY_KINDS, NEBULA_LOOKS, type Level } from "../src/level/schema";
import { frameLevel } from "../src/render/camera";
import { ENGINE_PLUMES, type EngineLook } from "../src/render/ship-art";
import { BELT_TIERS, type BeltTier } from "../src/sim/belts";
import { HAZARD_KINDS, type HazardKind } from "../src/sim/events";
import {
  MEGA_SLOTS,
  elevatorFrame,
  frameAcceleration,
  jetSpan,
  ringHalfWidth,
  ringRadius,
  type MegaSlot,
} from "../src/sim/mega";
import { movingBodies } from "../src/game/ghosts";
import { SOL_LOOKS, solArt } from "../src/render/sol-art";
import { BODY_LOOKS, bodyPose, bodySolid, flyPlan, makeState, predictPlan, step, type BodyLook } from "../src/sim/physics";

describe("Observatory", () => {
  it("stays off the campaign list and is its own chart", () => {
    expect(observatory.id).toBe("observatory");
    expect(observatory.name).toBe("Observatory");
    expect(LEVELS.map((level) => level.id)).not.toContain(observatory.id);
  });

  it("includes every registered object type", () => {
    for (const look of BODY_LOOKS) {
      expect(hasLook(look), `missing look ${look}`).toBe(true);
    }
    for (const look of SOL_LOOKS) {
      const placed = observatory.bodies.find((body) => body.look === look);
      expect(placed, `missing Sol look ${look}`).toBeTruthy();
      expect(placed?.radius, look).toBe(solArt(look).radius);
    }
    const voyager = observatory.bodies.find((body) => body.look === "voyager");
    expect(bodySolid(voyager!)).toBe(false);
    for (const kind of BODY_KINDS) {
      expect(observatory.bodies.some((body) => body.kind === kind), `missing kind ${kind}`).toBe(true);
    }
    expect(observatory.bodies.some((body) => body.id === "kind-planet")).toBe(false);
    for (const look of NEBULA_LOOKS) {
      expect(observatory.nebulae?.some((cloud) => cloud.look === look), `missing nebula ${look}`).toBe(true);
    }
    for (const tier of Object.keys(BELT_TIERS) as BeltTier[]) {
      expect(observatory.belts?.some((belt) => belt.tier === tier), `missing belt ${tier}`).toBe(true);
    }
    for (const kind of HAZARD_KINDS) expect(hasHazard(kind), `missing hazard ${kind}`).toBe(true);
    for (const slot of MEGA_SLOTS) expect(hasMega(slot), `missing mega ${slot}`).toBe(true);
    for (const engine of Object.keys(ENGINE_PLUMES) as EngineLook[]) {
      expect(observatoryShips.some((ship) => ship.build.engine === engine), `missing engine ${engine}`).toBe(true);
    }
    for (const module of shipModuleKeys()) {
      expect(observatoryShips.some((ship) => ship.build[module] === true), `missing ship module ${module}`).toBe(true);
    }
  });

  it("labels every body, cloud, wormhole mouth and ship build", () => {
    const cards = observatoryPlacards();
    const ids = new Set(cards.map((card) => card.id));
    for (const body of observatory.bodies) {
      expect(ids.has(body.id), body.id).toBe(true);
      expect(body.name.trim().length).toBeGreaterThan(0);
    }
    for (const cloud of observatory.nebulae ?? []) expect(ids.has(cloud.id), cloud.id).toBe(true);
    for (const hole of observatory.wormholes ?? []) {
      expect(ids.has(`${hole.id}-a`)).toBe(true);
      expect(ids.has(`${hole.id}-b`)).toBe(true);
    }
    for (const ship of observatoryShips) expect(ids.has(ship.id), ship.id).toBe(true);
    const names = cards.map((card) => card.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("orbits the double planet and the moon chain, and the coast matches the flight", () => {
    const bodies = observatory.bodies;
    const g = observatory.g;
    const big = bodies.find((body) => body.id === "look-double-big");
    const small = bodies.find((body) => body.id === "look-double-small");
    const giant = bodies.find((body) => body.id === "look-moon-chain");
    const volcanic = bodies.find((body) => body.id === "chain-volcanic");
    const icy = bodies.find((body) => body.id === "chain-icy");
    if (!big?.orbit || !small?.orbit || !giant || !volcanic?.orbit || !icy?.orbit) throw new Error("pair");
    expect(big.radius).toBe(18);
    expect(small.radius).toBe(11);
    expect(big.orbit.radius).toBe(7.06);
    expect(small.orbit.radius).toBe(30.94);
    expect(big.mass / small.mass).toBeCloseTo(5832 / 1331, 5);
    const b0 = bodyPose(big, 0, bodies, g);
    const s0 = bodyPose(small, 0, bodies, g);
    expect(Math.hypot(b0.x - s0.x, s0.y - b0.y)).toBeCloseTo(38, 4);
    expect(s0.x - (small.orbit.cx ?? 0)).toBeCloseTo(30.94, 4);
    expect(b0.x - (big.orbit.cx ?? 0)).toBeCloseTo(-7.06, 4);
    const half = bodyPose(small, 20, bodies, g);
    expect(half.x - (small.orbit.cx ?? 0)).toBeCloseTo(-30.94, 3);
    expect(volcanic.orbit.radius).toBe(68);
    expect(icy.orbit.radius / volcanic.orbit.radius).toBeCloseTo(2 ** (2 / 3), 2);
    expect(icy.orbit.omega * 2).toBeCloseTo(volcanic.orbit.omega, 6);
    const v0 = bodyPose(volcanic, 0, bodies, g);
    expect(Math.hypot(v0.x - giant.x, v0.y - giant.y)).toBeCloseTo(68, 4);
    const vTurn = bodyPose(volcanic, 18, bodies, g);
    expect(vTurn.x).toBeCloseTo(v0.x, 3);
    expect(vTurn.y).toBeCloseTo(v0.y, 3);

    const coast: Level = {
      ...observatory,
      id: "pair-coast",
      bodies: [
        big,
        small,
        giant,
        volcanic,
        { id: "x", name: "Far", kind: "target", x: 1200, y: 0, mass: 10, radius: 8, captureRadius: 20 },
      ],
      targetId: "x",
      ship: { x: 400, y: 80, vx: 0, vy: 3 },
      orbit: { bodyId: "x", radius: 40 },
      belts: [],
      nebulae: [],
      wormholes: [],
      petrova: [],
      maxSteps: 120,
    };
    const config = simConfigFromLevel(coast);
    const state = makeState(coast.ship.x, coast.ship.y, coast.ship.vx, coast.ship.vy, config);
    const predicted = predictPlan(state, config, []);
    const flown = flyPlan(state, config, [], 1);
    expect(flown.path).toHaveLength(predicted.path.length);
    for (let i = 0; i < predicted.path.length; i++) {
      expect(flown.path[i]?.x).toBe(predicted.path[i]?.x);
      expect(flown.path[i]?.y).toBe(predicted.path[i]?.y);
    }
  });

  it("spaces bodies so each picture has its own place", () => {
    const bodies = observatory.bodies;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const bound =
          a.orbit?.centerId === b.id ||
          b.orbit?.centerId === a.id ||
          (a.orbit?.cx !== undefined && a.orbit.cx === b.orbit?.cx && a.orbit.cy === b.orbit?.cy);
        const pad = bound ? 0 : 36;
        expect(distance, `${a.id} overlaps ${b.id}`).toBeGreaterThan(a.radius + b.radius + pad);
      }
    }
    for (const host of bodies) {
      if (host.ring) {
        const limit = ringRadius(host.radius) + ringHalfWidth(host.radius);
        for (const other of bodies) {
          if (other.id === host.id) continue;
          expect(Math.hypot(other.x - host.x, other.y - host.y), other.id).toBeGreaterThan(limit + other.radius);
        }
      }
      if (host.elevator) {
        const limit = elevatorFrame(host.radius).outer;
        for (const other of bodies) {
          if (other.id === host.id) continue;
          expect(Math.hypot(other.x - host.x, other.y - host.y), other.id).toBeGreaterThan(limit + other.radius);
        }
      }
      if (host.engine) {
        const limit = jetSpan(host.radius).outer;
        for (const other of bodies) {
          if (other.id === host.id) continue;
          expect(Math.hypot(other.x - host.x, other.y - host.y), other.id).toBeGreaterThan(limit + other.radius);
        }
      }
    }
  });

  it("feeds the target-zone ring and the ghost markers", () => {
    const target = observatory.bodies.find((body) => body.id === observatory.targetId);
    expect(target?.captureRadius).toBeGreaterThan(target?.radius ?? 0);
    expect(movingBodies(observatory.bodies).length).toBeGreaterThan(0);
  });

  it("can be flown: the opening coast stays clear, and the frame does not drift", () => {
    const orbiting = observatory.bodies.filter((body) => body.orbit).map((body) => body.id).sort();
    expect(orbiting).toEqual(
      ["chain-barren", "chain-dwarf", "chain-icy", "chain-volcanic", "look-double-big", "look-double-small"].sort(),
    );
    expect(observatory.bodies.some((body) => body.kind === "rogue" && body.drift)).toBe(true);
    expect(frameAcceleration(observatory.bodies)).toBeNull();
    expect(observatory.bodies.some((body) => body.magnet)).toBe(true);
    expect(observatory.bodies.some((body) => body.flare)).toBe(true);
    expect(observatory.physics?.dosePerD1).toBeGreaterThan(0);
    expect(observatory.physics?.doseLimit).toBeGreaterThan(0);

    const config = simConfigFromLevel(observatory);
    expect(config.belts?.length).toBe(observatory.belts?.length);
    expect(config.beltRocks?.length).toBeGreaterThan(0);
    expect(config.nebulae?.length).toBe(observatory.nebulae?.length);
    expect(config.wormholes?.length).toBe(observatory.wormholes?.length);

    const state = makeState(observatory.ship.x, observatory.ship.y, observatory.ship.vx, observatory.ship.vy, config);
    for (let i = 0; i < 600; i++) step(state, config);
    expect(state.status).toBe("flying");
    for (const body of observatory.bodies) {
      const pose = bodyPose(body, state.t, observatory.bodies, observatory.g);
      const distance = Math.hypot(state.x - pose.x, state.y - pose.y);
      expect(distance, body.id).toBeGreaterThan(body.radius + 8);
    }
  });

  it("frames the whole chart clear of the HUD", () => {
    const width = 1280;
    const height = 800;
    const camera = { x: 0, y: 0, zoom: 1 };
    frameLevel(camera, width, height, observatory);
    // Ringed giants widen the chart. The HUD clearance below is the real bound.
    expect(camera.zoom).toBeGreaterThan(0.1);
    expect(camera.zoom).toBeLessThanOrEqual(6);
    const topHud = 88;
    const bottomHud = 168;
    for (const card of observatoryPlacards()) {
      const screenX = width / 2 + (card.x - camera.x) * camera.zoom;
      const labelTop = height / 2 - (card.y - card.clearance - camera.y) * camera.zoom;
      expect(screenX, card.id).toBeGreaterThan(24);
      expect(screenX, card.id).toBeLessThan(width - 24);
      expect(labelTop, card.id).toBeGreaterThan(topHud);
      expect(labelTop + 16, card.id).toBeLessThan(height - bottomHud);
    }
  });
});

function hasLook(look: BodyLook): boolean {
  return observatory.bodies.some((body) => body.look === look);
}

function hasHazard(kind: HazardKind): boolean {
  switch (kind) {
    case "supernova":
      return observatory.bodies.some((body) => body.supernova);
    case "quasar":
      return observatory.bodies.some((body) => body.quasar);
    default: {
      const missing: never = kind;
      throw new Error(`Observatory test has no check for ${String(missing)}`);
    }
  }
}

function hasMega(slot: MegaSlot): boolean {
  switch (slot) {
    case "engine":
      return observatory.bodies.some((body) => body.engine);
    case "dyson":
      return observatory.bodies.some((body) => body.dyson);
    case "shkadov":
      return observatory.bodies.some((body) => body.shkadov);
    case "ring":
      return observatory.bodies.some((body) => body.ring);
    case "elevator":
      return observatory.bodies.some((body) => body.elevator);
    case "wormhole":
      return (observatory.wormholes?.length ?? 0) > 0;
    default: {
      const missing: never = slot;
      throw new Error(`Observatory test has no check for ${String(missing)}`);
    }
  }
}
