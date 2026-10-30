import type { Belt, BeltTier } from "../sim/belts";
import { BELT_TIERS } from "../sim/belts";
import { HAZARD_KINDS, type HazardKind } from "../sim/events";
import {
  ELEVATOR_SAMPLE_R,
  ENGINE_SAMPLE_R,
  MEGA_SLOTS,
  RING_SAMPLE_R,
  SHKADOV_SAMPLE_R,
  elevatorFrame,
  jetSpan,
  ringHalfWidth,
  ringRadius,
  type MegaSlot,
  type WormholePair,
} from "../sim/mega";
import { SOL_LOOKS, solArt, type SolLook } from "../render/sol-art";
import {
  BODY_LOOKS,
  type Body,
  type BodyKind,
  type BodyLook,
} from "../sim/physics";
import { ENGINE_PLUMES, shipBuild, type EngineLook, type ShipBuild } from "../render/ship-art";
import { BODY_KINDS, NEBULA_LOOKS, type Level } from "./schema";

/**
 * Showcase chart. Built at load from the registries the game already
 * keeps (body looks and kinds, nebula looks, belt tiers, hazard kinds,
 * megastructure slots, engine plumes, ship-build flags). A new entry in
 * one of those lists is placed here without a hand-written level file.
 *
 * Bodies are static and spaced. Damaging rates on the exhibits are 0,
 * and the Shkadov mirror does not accelerate the frame, so the gaps can
 * be flown. Rings, tethers and belt rocks stay solid.
 */

export const OBSERVATORY_ID = "observatory";

export interface ShipExhibit {
  id: string;
  name: string;
  x: number;
  y: number;
  clearance: number;
  build: ShipBuild;
}

export interface FramePoint {
  x: number;
  y: number;
  reach: number;
}

export const observatoryShips: ShipExhibit[] = [];

const clearance = new Map<string, number>();

const LOOK_KIND: Partial<Record<BodyLook, BodyKind>> = {
  "gas-giant": "planet",
  moon: "moon",
  "moon-icy": "moon",
  "moon-volcanic": "moon",
  dwarf: "planet",
  comet: "planet",
};

const LOOK_NAME: Partial<Record<BodyLook, string>> = {
  sun: "Sun",
  "binary-hot": "Binary hot",
  "binary-cool": "Binary cool",
  "white-dwarf": "White dwarf",
  "red-giant": "Red giant",
  "gas-giant": "Gas giant",
  moon: "Moon",
  "moon-icy": "Icy",
  "moon-volcanic": "Volcanic",
  dwarf: "Dwarf",
  neutron: "Neutron star",
  pulsar: "Pulsar",
  magnetar: "Magnetar",
  comet: "Comet",
};

const KIND_NAME: Partial<Record<BodyKind, string>> = {
  home: "Home",
  star: "Star",
  target: "Planet X",
  moon: "Moon",
  blackhole: "Black hole",
  planet: "Planet",
  rogue: "Rogue planet",
};

interface Slot {
  reach: number;
  place: (x: number, y: number) => void;
}

function titleCase(id: string): string {
  return id
    .split("-")
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

function kindForLook(look: BodyLook): BodyKind {
  return LOOK_KIND[look] ?? "star";
}

function blankBuild(engine: EngineLook): ShipBuild {
  return shipBuild([], { engine, shield: false, scoop: false, sensors: false, cryo: false });
}

/** Boolean flags on a ship build, excluding the engine picture. */
export function shipModuleKeys(sample: ShipBuild = blankBuild("chemical")): (keyof ShipBuild)[] {
  return (Object.keys(sample) as (keyof ShipBuild)[]).filter((key) => key !== "engine" && typeof sample[key] === "boolean");
}

function withModule(engine: EngineLook, module: keyof ShipBuild | null): ShipBuild {
  const build = blankBuild(engine);
  if (module === null || module === "engine") return build;
  return { ...build, [module]: true } as ShipBuild;
}

function body(partial: Body, reach: number): Body {
  clearance.set(partial.id, reach);
  return partial;
}

interface ExhibitSpec {
  radius: number;
  mass: number;
  reach: number;
  extra?: Partial<Body>;
}

/** Known pictures. A look that is not listed still gets a body, from `defaultLook`. */
const LOOK_SPEC: Partial<Record<BodyLook, ExhibitSpec>> = {
  sun: {
    radius: 22,
    mass: 1400,
    reach: 130,
    extra: { flare: { angle: 0.4, period: 22, start: 0, duration: 8 } },
  },
  "binary-hot": { radius: 18, mass: 1200, reach: 140 },
  "binary-cool": { radius: 14, mass: 900, reach: 140 },
  "white-dwarf": { radius: 12, mass: 1600, reach: 110 },
  "red-giant": { radius: 48, mass: 1100, reach: 170, extra: { atmosphereRadius: 78 } },
  "gas-giant": { radius: 36, mass: 800, reach: 110, extra: { magnet: { b1Reach: 90, tilt: 0.3 } } },
  moon: { radius: 14, mass: 250, reach: 70 },
  "moon-icy": { radius: 12, mass: 200, reach: 60 },
  "moon-volcanic": { radius: 13, mass: 220, reach: 60 },
  dwarf: { radius: 10, mass: 180, reach: 50 },
  neutron: {
    radius: 8,
    mass: 1800,
    reach: 80,
    extra: { magnet: { b1Reach: 52, tilt: 0.5 }, beam: { reach: 36, period: 6, damage: 0 } },
  },
  pulsar: {
    radius: 8,
    mass: 1800,
    reach: 170,
    extra: {
      magnet: { b1Reach: 70, tilt: 0, averaged: true },
      beam: { reach: 150, period: 4, base: 4, tip: 16, damage: 0 },
    },
  },
  magnetar: { radius: 9, mass: 2000, reach: 170, extra: { magnet: { b1Reach: 84, tilt: 0.35 } } },
  comet: { radius: 4, mass: 80, reach: 200, extra: { harvest: 6, harvestRadius: 36 } },
};

/**
 * Sol looks use the size ladder in sol-art. Voyager is drawn and does not
 * collide. Ringed bodies reserve the ring ellipse so the next cell stays clear.
 */
const SOL_KIND: Record<SolLook, BodyKind> = {
  "sol-sun": "star",
  mercury: "planet",
  venus: "planet",
  earth: "planet",
  luna: "moon",
  mars: "planet",
  jupiter: "planet",
  saturn: "planet",
  titan: "moon",
  uranus: "planet",
  neptune: "planet",
  pluto: "planet",
  charon: "moon",
  eris: "planet",
  arrokoth: "planet",
  voyager: "planet",
};

const SOL_NAME: Record<SolLook, string> = {
  "sol-sun": "The Sun",
  mercury: "Mercury",
  venus: "Venus",
  earth: "Earth",
  luna: "The Moon",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  titan: "Titan",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
  charon: "Charon",
  eris: "Eris",
  arrokoth: "Arrokoth",
  voyager: "Voyager",
};

for (const look of SOL_LOOKS) {
  const art = solArt(look);
  LOOK_KIND[look] = SOL_KIND[look];
  LOOK_NAME[look] = SOL_NAME[look];
  const ringReach = art.rings ? art.radius * 2.4 + 28 : art.radius + 48;
  LOOK_SPEC[look] = {
    radius: art.radius,
    mass: look === "voyager" ? 0 : look === "sol-sun" ? 1400 : 480,
    reach: look === "sol-sun" ? 210 : ringReach,
    extra: look === "voyager" ? { solid: false } : undefined,
  };
}

const defaultLook: ExhibitSpec = { radius: 20, mass: 700, reach: 140 };

function lookBody(look: BodyLook): { body: Body; reach: number } {
  const kind = kindForLook(look);
  const name = LOOK_NAME[look] ?? titleCase(look);
  const spec = LOOK_SPEC[look] ?? defaultLook;
  const made = body(
    {
      id: `look-${look}`,
      name,
      kind,
      look,
      x: 0,
      y: 0,
      mass: spec.mass,
      radius: spec.radius,
      ...(spec.extra ?? {}),
    },
    spec.reach,
  );
  return { body: made, reach: spec.reach };
}

function kindBody(kind: BodyKind): { body: Body; reach: number } {
  const name = KIND_NAME[kind] ?? titleCase(kind);
  const spec = kindSpec(kind);
  const made = body(
    {
      id: kind === "planet" ? "kind-planet" : `kind-${kind}`,
      name,
      kind,
      x: 0,
      y: 0,
      mass: spec.mass,
      radius: spec.radius,
      ...(spec.extra ?? {}),
    },
    spec.reach,
  );
  return { body: made, reach: spec.reach };
}

const KIND_SPEC: Partial<Record<BodyKind, ExhibitSpec>> = {
  home: { radius: 34, mass: 400, reach: 90 },
  target: { radius: 22, mass: 700, reach: 130, extra: { captureRadius: 78 } },
  blackhole: { radius: 14, mass: 900, reach: 140 },
  planet: { radius: 20, mass: 500, reach: 70 },
  rogue: { radius: 24, mass: 450, reach: 120, extra: { drift: { vx: 0.55, vy: 0.12 } } },
  moon: { radius: 14, mass: 200, reach: 70 },
  star: { radius: 22, mass: 1000, reach: 130 },
};

const defaultKind: ExhibitSpec = { radius: 16, mass: 300, reach: 80 };

function kindSpec(kind: BodyKind): ExhibitSpec {
  return KIND_SPEC[kind] ?? defaultKind;
}

function hazardBody(kind: HazardKind): { body: Body; reach: number } {
  switch (kind) {
    case "supernova":
      return {
        reach: 160,
        body: body(
          {
            id: "hazard-supernova",
            name: "Supernova",
            kind: "star",
            look: "sun",
            x: 0,
            y: 0,
            mass: 900,
            radius: 20,
            supernova: { at: 1_000_000, blast: 64, speed: 30, damage: 0 },
          },
          160,
        ),
      };
    case "quasar":
      return {
        reach: 200,
        body: body(
          {
            id: "hazard-quasar",
            name: "Quasar",
            kind: "blackhole",
            x: 0,
            y: 0,
            mass: 800,
            radius: 14,
            quasar: { angle: 0.7, cone: 0.18, reach: 170, damage: 0 },
          },
          200,
        ),
      };
    default: {
      const _never: never = kind;
      throw new Error(`Observatory has no placement for hazard ${String(_never)}`);
    }
  }
}

function megaSlot(slot: MegaSlot, bodies: Body[], wormholes: WormholePair[]): Slot {
  switch (slot) {
    case "engine": {
      const host = body(
        {
          id: "mega-engine",
          name: "Stellar engine",
          kind: "star",
          look: "sun",
          x: 0,
          y: 0,
          mass: 500,
          radius: ENGINE_SAMPLE_R,
          engine: { angle: Math.PI / 2, burn: 0, scoop: 0, push: 0 },
        },
        jetSpan(ENGINE_SAMPLE_R).outer + 40,
      );
      bodies.push(host);
      return { reach: jetSpan(ENGINE_SAMPLE_R).outer + 40, place: (x, y) => placeBody(host, x, y) };
    }
    case "dyson": {
      const host = body(
        {
          id: "mega-dyson",
          name: "Dyson swarm",
          kind: "star",
          look: "sun",
          x: 0,
          y: 0,
          mass: 500,
          radius: ENGINE_SAMPLE_R,
          dyson: { coverage: 0.28, nick: 0 },
        },
        200,
      );
      bodies.push(host);
      return { reach: 200, place: (x, y) => placeBody(host, x, y) };
    }
    case "shkadov": {
      const host = body(
        {
          id: "mega-shkadov",
          name: "Shkadov thruster",
          kind: "star",
          look: "sun",
          x: 0,
          y: 0,
          mass: 400,
          radius: SHKADOV_SAMPLE_R,
          shkadov: { angle: 0, accel: 0 },
        },
        300,
      );
      bodies.push(host);
      return { reach: 300, place: (x, y) => placeBody(host, x, y) };
    }
    case "ring": {
      const host = body(
        {
          id: "mega-ring",
          name: "Ringworld",
          kind: "star",
          look: "sun",
          x: 0,
          y: 0,
          mass: 200,
          radius: RING_SAMPLE_R,
          ring: {
            angle: 0.2,
            mass: 12,
            gaps: [
              { start: 2.09, end: 4.19 },
              { start: -1.05, end: 1.05 },
            ],
          },
        },
        ringRadius(RING_SAMPLE_R) + ringHalfWidth(RING_SAMPLE_R) + 36,
      );
      bodies.push(host);
      return {
        reach: ringRadius(RING_SAMPLE_R) + ringHalfWidth(RING_SAMPLE_R) + 36,
        place: (x, y) => placeBody(host, x, y),
      };
    }
    case "elevator": {
      const host = body(
        {
          id: "mega-elevator",
          name: "Space elevator",
          kind: "planet",
          x: 0,
          y: 0,
          mass: 350,
          radius: ELEVATOR_SAMPLE_R,
          elevator: { phase: Math.PI / 2, omega: 0.04 },
        },
        elevatorFrame(ELEVATOR_SAMPLE_R).outer + 30,
      );
      bodies.push(host);
      return {
        reach: elevatorFrame(ELEVATOR_SAMPLE_R).outer + 30,
        place: (x, y) => placeBody(host, x, y),
      };
    }
    case "wormhole": {
      const pair: WormholePair = {
        id: "mega-wormhole",
        a: { x: 0, y: 0, radius: 28 },
        b: { x: 0, y: 0, radius: 22 },
        angle: -1.2,
        clockOffset: 6,
      };
      wormholes.push(pair);
      const reach = 210;
      clearance.set("mega-wormhole-a", pair.a.radius + 18);
      clearance.set("mega-wormhole-b", pair.b.radius + 18);
      return {
        reach,
        place: (x, y) => {
          pair.a.x = x;
          pair.a.y = y + 100;
          pair.b.x = x;
          pair.b.y = y - 120;
        },
      };
    }
    default: {
      const _never: never = slot;
      throw new Error(`Observatory has no placement for ${String(_never)}`);
    }
  }
}

function placeBody(target: Body, x: number, y: number): void {
  target.x = x;
  target.y = y;
}

function circleClear(home: Body, radius: number, bodies: readonly Body[], belts: readonly Belt[]): boolean {
  for (let k = 0; k < 24; k++) {
    const angle = (k / 24) * Math.PI * 2;
    const x = home.x + Math.cos(angle) * radius;
    const y = home.y + Math.sin(angle) * radius;
    for (const other of bodies) {
      if (other.id === home.id) continue;
      if (Math.hypot(x - other.x, y - other.y) < other.radius + 40) return false;
      if (other.ring && Math.hypot(x - other.x, y - other.y) < ringRadius(other.radius) + ringHalfWidth(other.radius) + 24) {
        return false;
      }
      if (other.elevator && Math.hypot(x - other.x, y - other.y) < elevatorFrame(other.radius).outer + 24) return false;
      if (other.engine && Math.hypot(x - other.x, y - other.y) < jetSpan(other.radius).outer + 24) return false;
    }
    for (const belt of belts) {
      const center = bodies.find((item) => item.id === belt.centerId);
      if (!center) continue;
      if (Math.hypot(x - center.x, y - center.y) < belt.radius + belt.width / 2 + 16) return false;
    }
  }
  return radius > home.radius + 24;
}

function parkOrbit(
  home: Body,
  bodies: readonly Body[],
  belts: readonly Belt[],
  g: number,
): { x: number; y: number; vx: number; vy: number; radius: number } {
  for (const radius of [120, 100, 150]) {
    if (!circleClear(home, radius, bodies, belts)) continue;
    const speed = Math.sqrt((g * home.mass) / radius);
    return { x: home.x + radius, y: home.y, vx: 0, vy: speed, radius };
  }
  const radius = home.radius + 80;
  const speed = Math.sqrt((g * home.mass) / radius);
  return { x: home.x + radius, y: home.y, vx: 0, vy: speed, radius };
}

function pack(slots: readonly Slot[]): void {
  const gap = 72;
  const minStep = 300;
  const rowWidth = 3360;
  let cursor = 0;
  let y = 0;
  let rowH = 0;
  for (const slot of slots) {
    const step = Math.max(minStep, slot.reach * 2 + gap);
    if (cursor > 0 && cursor + step > rowWidth) {
      y -= rowH;
      cursor = 0;
      rowH = 0;
    }
    slot.place(cursor + step / 2, y - step / 2);
    cursor += step;
    rowH = Math.max(rowH, step);
  }
}

function build(): Level {
  observatoryShips.length = 0;
  clearance.clear();
  const bodies: Body[] = [];
  const slots: Slot[] = [];

  const kindsFromLooks = new Set<BodyKind>();
  for (const look of BODY_LOOKS) {
    const made = lookBody(look);
    kindsFromLooks.add(made.body.kind);
    bodies.push(made.body);
    slots.push({ reach: made.reach, place: (x, y) => placeBody(made.body, x, y) });
  }
  for (const kind of BODY_KINDS) {
    if (kind !== "planet" && kindsFromLooks.has(kind)) continue;
    const made = kindBody(kind);
    bodies.push(made.body);
    slots.push({ reach: made.reach, place: (x, y) => placeBody(made.body, x, y) });
  }
  for (const kind of HAZARD_KINDS) {
    const made = hazardBody(kind);
    bodies.push(made.body);
    slots.push({ reach: made.reach, place: (x, y) => placeBody(made.body, x, y) });
  }

  const wormholes: WormholePair[] = [];
  for (const slot of MEGA_SLOTS) slots.push(megaSlot(slot, bodies, wormholes));

  const nebulae: NonNullable<Level["nebulae"]>[number][] = [];
  for (const look of NEBULA_LOOKS) {
    const cloud = {
      id: `nebula-${look}`,
      x: 0,
      y: 0,
      rx: look === "dark" ? 130 : 160,
      ry: look === "dark" ? 90 : 110,
      angle: look === "reflection" ? 0.4 : 0.15,
      scoop: look === "dark" ? 0 : 3,
      look,
    };
    nebulae.push(cloud);
    const reach = Math.max(cloud.rx, cloud.ry) + 24;
    clearance.set(cloud.id, reach);
    const name = look === "dark" ? "Dark cloud" : look === "emission" ? "Emission" : look === "reflection" ? "Reflection" : titleCase(look);
    cloudName.set(cloud.id, name);
    slots.push({
      reach,
      place: (x, y) => {
        cloud.x = x;
        cloud.y = y;
      },
    });
  }

  const belts: Belt[] = [];
  const tiers = Object.keys(BELT_TIERS) as BeltTier[];
  for (const tier of tiers) {
    const wide = tier === "kuiper" || tier === "dense";
    const radius = tier === "kuiper" ? 128 : 96;
    const width = wide ? 64 : 40;
    const host = body(
      {
        id: `belt-${tier}`,
        name: tier === "kuiper" ? "Kuiper" : titleCase(tier),
        kind: "star",
        look: "sun",
        x: 0,
        y: 0,
        mass: 180,
        radius: 12,
      },
      radius + width / 2 + 28,
    );
    bodies.push(host);
    belts.push({
      id: `field-${tier}`,
      centerId: host.id,
      radius,
      width,
      tier,
      seed: tier === "sparse" ? 11 : tier === "medium" ? 29 : tier === "dense" ? 47 : 71,
    });
    slots.push({
      reach: radius + width / 2 + 28,
      place: (x, y) => placeBody(host, x, y),
    });
  }

  const engines = Object.keys(ENGINE_PLUMES) as EngineLook[];
  for (const engine of engines) {
    const exhibit: ShipExhibit = {
      id: `ship-${engine}`,
      name: titleCase(engine),
      x: 0,
      y: 0,
      clearance: 64,
      build: withModule(engine, null),
    };
    observatoryShips.push(exhibit);
    slots.push({
      reach: 64,
      place: (x, y) => {
        exhibit.x = x;
        exhibit.y = y;
      },
    });
  }
  for (const module of shipModuleKeys()) {
    const exhibit: ShipExhibit = {
      id: `ship-${module}`,
      name: module === "plating" ? "Plating" : module === "cryo" ? "Cryo" : titleCase(module),
      x: 0,
      y: 0,
      clearance: 64,
      build: withModule("chemical", module),
    };
    observatoryShips.push(exhibit);
    slots.push({
      reach: 64,
      place: (x, y) => {
        exhibit.x = x;
        exhibit.y = y;
      },
    });
  }

  pack(slots);

  const home = bodies.find((item) => item.kind === "home");
  const target = bodies.find((item) => item.kind === "target");
  if (!home || !target) throw new Error("Observatory is missing Home or Planet X");
  const parked = parkOrbit(home, bodies, belts, 1);
  let minX = parked.x;
  let maxX = parked.x;
  let minY = parked.y;
  let maxY = parked.y;
  for (const item of bodies) {
    minX = Math.min(minX, item.x);
    maxX = Math.max(maxX, item.x);
    minY = Math.min(minY, item.y);
    maxY = Math.max(maxY, item.y);
  }

  return {
    id: OBSERVATORY_ID,
    name: "Observatory",
    g: 1,
    dt: 1 / 60,
    bodies,
    targetId: target.id,
    ship: { x: parked.x, y: parked.y, vx: parked.vx, vy: parked.vy },
    orbit: { bodyId: home.id, radius: parked.radius },
    fuel: 240,
    fuelPerDv: 1,
    bounds: {
      minX: minX - 4000,
      maxX: maxX + 4000,
      minY: minY - 4000,
      maxY: maxY + 4000,
    },
    maxSteps: 12000,
    dvPerPixel: 0.25,
    periapsisMargin: 6,
    maxPlannedBurns: 4,
    c: 1_000_000,
    horizon: { seconds: 18, oneOrbit: false, shorten: 0, ref: 6 },
    physics: { dosePerD1: 0.04, doseLimit: 8000 },
    nebulae,
    belts,
    wormholes,
    mission: {
      deadline: 800,
      crewLimit: 800,
      fuelStarMin: 0,
      crewWeight: 1,
      fuelWeight: 1,
    },
  };
}

const cloudName = new Map<string, string>();

export interface Placard {
  id: string;
  name: string;
  x: number;
  y: number;
  clearance: number;
  /** Body id when the label should follow a moving pose. */
  bodyId?: string;
}

export function observatoryPlacards(level: Level = observatory): Placard[] {
  const cards: Placard[] = [];
  for (const item of level.bodies) {
    cards.push({
      id: item.id,
      name: item.name,
      x: item.x,
      y: item.y,
      clearance: clearance.get(item.id) ?? item.radius + 28,
      bodyId: item.id,
    });
  }
  for (const cloud of level.nebulae ?? []) {
    cards.push({
      id: cloud.id,
      name: cloudName.get(cloud.id) ?? titleCase(cloud.look),
      x: cloud.x,
      y: cloud.y,
      clearance: clearance.get(cloud.id) ?? Math.max(cloud.rx, cloud.ry),
    });
  }
  for (const hole of level.wormholes ?? []) {
    cards.push({
      id: `${hole.id}-a`,
      name: "Mouth A",
      x: hole.a.x,
      y: hole.a.y,
      clearance: hole.a.radius + 16,
    });
    cards.push({
      id: `${hole.id}-b`,
      name: "Mouth B",
      x: hole.b.x,
      y: hole.b.y,
      clearance: hole.b.radius + 16,
    });
  }
  for (const ship of observatoryShips) {
    cards.push({
      id: ship.id,
      name: ship.name,
      x: ship.x,
      y: ship.y,
      clearance: ship.clearance,
    });
  }
  return cards;
}

export function observatoryFramePoints(): FramePoint[] {
  const points: FramePoint[] = [];
  for (const card of observatoryPlacards()) {
    points.push({ x: card.x, y: card.y, reach: card.clearance + 36 });
  }
  return points;
}

export const observatory: Level = build();
