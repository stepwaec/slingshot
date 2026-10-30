/**
 * Asteroid and Kuiper belts. Placement is a pure function of the level seed,
 * so prediction and flight hit the same rocks. Counts, gaps and solidity
 * come from the belt SVG headers. `design/` is not edited.
 *
 * The slow drift is the header's rotation about the star: asteroid belts
 * swing 0 → −0.5° → 0 over 60 s, the Kuiper belt 0 → −0.3° → 0 over 90 s.
 * It is a cosine so t = 0 is the rest pose. Collision uses the same angle.
 */

export type BeltTier = "sparse" | "medium" | "dense" | "kuiper";
export type BeltMaterial = "S" | "C" | "M" | "K";
export type BeltRole = "large" | "small" | "dust";

export interface Belt {
  id: string;
  centerId: string;
  /** Band centre, world units from the star. */
  radius: number;
  /** Full width of the band. */
  width: number;
  tier: BeltTier;
  seed: number;
  /** Arc start, radians. Omitted is 0. */
  arcStart?: number;
  /** Arc length, radians. Omitted is a full circle. */
  arcSpan?: number;
  /** Hull per second inside the band. The dense tier is the one that uses it. */
  dustDamage?: number;
}

export interface BeltRock {
  beltId: string;
  centerId: string;
  tier: BeltTier;
  role: BeltRole;
  material: BeltMaterial;
  /** Silhouette 0–5 in the shared atlas. */
  shape: number;
  /** Angle about the star at t = 0, before drift. */
  angle: number;
  /** Distance from the star. */
  distance: number;
  radius: number;
  solid: boolean;
}

interface TierSpec {
  large: number;
  small: number;
  dust: number;
  gap: number;
  largeR: readonly [number, number];
  smallR: readonly [number, number];
  dustR: readonly [number, number];
  types: readonly BeltMaterial[];
  /** Crash radius. Kuiper's header uses 5; the asteroid headers use 7. */
  solid: number;
  /** Degrees, and the period in seconds, of the breathe about the star. */
  driftDeg: number;
  driftPeriod: number;
}

/** Per 100 px of arc. Headers of `belt-sparse.svg`, `belt-medium.svg`, `belt-dense.svg`, `kuiper-belt.svg`. */
export const BELT_TIERS: Record<BeltTier, TierSpec> = {
  sparse: {
    large: 1.3,
    small: 1.9,
    dust: 7,
    gap: 30,
    largeR: [7, 13],
    smallR: [2.5, 5.5],
    dustR: [0.7, 1.6],
    types: ["C", "S"],
    solid: 7,
    driftDeg: 0.5,
    driftPeriod: 60,
  },
  medium: {
    large: 2.6,
    small: 7.4,
    dust: 26,
    gap: 10,
    largeR: [7, 13],
    smallR: [2.5, 5.5],
    dustR: [0.7, 1.6],
    types: ["C", "M", "S"],
    solid: 7,
    driftDeg: 0.5,
    driftPeriod: 60,
  },
  dense: {
    large: 3.7,
    small: 20.4,
    dust: 96,
    gap: 0,
    largeR: [7, 13],
    smallR: [2.5, 5.5],
    dustR: [0.7, 1.6],
    types: ["C", "M", "S"],
    solid: 7,
    driftDeg: 0.5,
    driftPeriod: 60,
  },
  kuiper: {
    large: 3,
    small: 8.5,
    dust: 78,
    gap: 0,
    largeR: [5, 10],
    smallR: [2.2, 4.8],
    dustR: [0.7, 1.6],
    types: ["K"],
    solid: 5,
    driftDeg: 0.3,
    driftPeriod: 90,
  },
};

const SIGMA = { large: 0.35, small: 0.45, dust: 0.5 } as const;

/** Extra separation is the tier gap scaled by the new rock's radius over 10. */
export function beltSeparation(radius: number, other: number, gap: number): number {
  return 1.25 * (radius + other) + gap * (radius / 10);
}

/** Radians added to every rock's angle. 0 at t = 0. */
export function beltDrift(tier: BeltTier, time: number): number {
  const spec = BELT_TIERS[tier];
  const amp = (spec.driftDeg * Math.PI) / 180;
  const phase = ((time % spec.driftPeriod) / spec.driftPeriod) * Math.PI * 2;
  return -amp * 0.5 * (1 - Math.cos(phase));
}

export function rockOffset(rock: BeltRock, time: number): { x: number; y: number } {
  const angle = rock.angle + beltDrift(rock.tier, time);
  return { x: Math.cos(angle) * rock.distance, y: Math.sin(angle) * rock.distance };
}

/** True when the point sits in the band, including a partial arc. */
export function pointInBelt(x: number, y: number, cx: number, cy: number, belt: Belt): boolean {
  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.hypot(dx, dy);
  if (Math.abs(distance - belt.radius) > belt.width * 0.5) return false;
  const span = belt.arcSpan ?? Math.PI * 2;
  if (!(span < Math.PI * 2 - 1e-6)) return true;
  const turn = Math.PI * 2;
  let angle = Math.atan2(dy, dx) - (belt.arcStart ?? 0);
  angle = ((angle % turn) + turn) % turn;
  return angle <= span + 1e-9;
}

const placedRocks = new WeakMap<object, readonly BeltRock[]>();

/**
 * Rocks are a pure function of the belt list. `simConfigFromLevel` rebuilds
 * a config many times a frame, and placing Frost's Kuiper belt is the slow
 * part of that. The same array is returned for the same list.
 */
export function placeBelts(belts: readonly Belt[]): BeltRock[] {
  const cached = placedRocks.get(belts);
  if (cached) return cached as BeltRock[];
  const rocks: BeltRock[] = [];
  for (let i = 0; i < belts.length; i++) rocks.push(...placeBelt(belts[i]));
  placedRocks.set(belts, rocks);
  return rocks;
}

function placeBelt(belt: Belt): BeltRock[] {
  const spec = BELT_TIERS[belt.tier];
  const span = belt.arcSpan ?? Math.PI * 2;
  const start = belt.arcStart ?? 0;
  const arc = Math.abs(span) * belt.radius;
  const rnd = mulberry32(belt.seed >>> 0);
  const placed: BeltRock[] = [];
  const roles: BeltRole[] = ["large", "small", "dust"];
  for (let r = 0; r < roles.length; r++) {
    const role = roles[r];
    const per = role === "large" ? spec.large : role === "small" ? spec.small : spec.dust;
    const count = Math.max(0, Math.round((arc / 100) * per));
    const range = role === "large" ? spec.largeR : role === "small" ? spec.smallR : spec.dustR;
    const sigma = SIGMA[role] * belt.width;
    const tries = role === "dust" ? 8 : 40;
    for (let n = 0; n < count; n++) {
      const radius = range[0] + rnd() * (range[1] - range[0]);
      const material = spec.types[Math.floor(rnd() * spec.types.length) % spec.types.length] ?? spec.types[0];
      const shape = Math.floor(rnd() * 6) % 6;
      let rock: BeltRock | null = null;
      for (let attempt = 0; attempt < tries; attempt++) {
        const angle = start + rnd() * span;
        const distance = belt.radius + clippedGaussian(rnd) * sigma;
        if (overlaps(placed, angle, distance, radius, spec.gap)) continue;
        rock = {
          beltId: belt.id,
          centerId: belt.centerId,
          tier: belt.tier,
          role,
          material,
          shape,
          angle,
          distance,
          radius,
          solid: radius >= spec.solid,
        };
        break;
      }
      if (rock) placed.push(rock);
    }
  }
  return placed;
}

function overlaps(placed: readonly BeltRock[], angle: number, distance: number, radius: number, gap: number): boolean {
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  for (let i = 0; i < placed.length; i++) {
    const other = placed[i];
    const ox = Math.cos(other.angle) * other.distance;
    const oy = Math.sin(other.angle) * other.distance;
    const need = beltSeparation(radius, other.radius, gap);
    if (Math.hypot(x - ox, y - oy) < need) return true;
  }
  return false;
}

function clippedGaussian(rnd: () => number): number {
  for (let i = 0; i < 8; i++) {
    const value = gaussian(rnd);
    if (Math.abs(value) <= 2.2) return value;
  }
  return Math.max(-2.2, Math.min(2.2, gaussian(rnd)));
}

function gaussian(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
