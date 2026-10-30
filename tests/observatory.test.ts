import { describe, expect, it } from "vitest";
import { LEVELS, observatory, simConfigFromLevel } from "../src/level/catalog";
import { observatoryPlacards, observatoryShips, shipModuleKeys } from "../src/level/observatory";
import { BODY_KINDS, NEBULA_LOOKS } from "../src/level/schema";
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
import { BODY_LOOKS, makeState, step, type BodyLook } from "../src/sim/physics";

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
    for (const kind of BODY_KINDS) {
      expect(observatory.bodies.some((body) => body.kind === kind), `missing kind ${kind}`).toBe(true);
    }
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

  it("spaces bodies so each picture has its own place", () => {
    const bodies = observatory.bodies;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        expect(distance, `${a.id} overlaps ${b.id}`).toBeGreaterThan(a.radius + b.radius + 36);
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

  it("can be flown: the opening coast stays clear, and the frame does not drift", () => {
    expect(observatory.bodies.every((body) => body.orbit === undefined)).toBe(true);
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
      const distance = Math.hypot(state.x - body.x, state.y - body.y);
      expect(distance, body.id).toBeGreaterThan(body.radius + 8);
    }
  });

  it("frames the whole chart clear of the HUD", () => {
    const width = 1280;
    const height = 800;
    const camera = { x: 0, y: 0, zoom: 1 };
    frameLevel(camera, width, height, observatory);
    expect(camera.zoom).toBeGreaterThan(0.12);
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
