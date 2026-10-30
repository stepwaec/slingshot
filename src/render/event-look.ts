/**
 * Pure timings for the LU3 event drawings.
 * Headers: design/assets/events/*.svg. Colours live in the palette; sizes in theme.event.
 * These functions do not read or write the simulation.
 */

export interface EjectaGrain {
  /** Radians off the surface normal, inside ±cone. */
  angle: number;
  /** Travel, world units, before the ease-out finishes. */
  dist: number;
  radius: number;
  hot: boolean;
  /** 0, 1 or 2 indexes the three rock colours. Ignored when hot. */
  rock: number;
}

export interface DebrisPiece {
  /** Along-track offset, radians, once the field has spread. */
  along: number;
  /** Extra radius once the outward drift finishes. */
  outward: number;
  /** Seconds for that drift. Header: 14–22 s. */
  period: number;
  radius: number;
  hot: boolean;
  /** 0 is S (stony), 1 is C (carbon). */
  material: number;
  dust: boolean;
}

export interface EjectaRange {
  count: number;
  coneDeg: number;
  dist0: number;
  dist1: number;
  r0: number;
  r1: number;
}

export interface DebrisRange {
  chunks: number;
  dust: number;
  dustHot: number;
  r0: number;
  r1: number;
  drift0: number;
  drift1: number;
  period0: number;
  period1: number;
}

/** burn-up.svg: heat = 1 − (r − R_star) / (r0 − R_star). 0 far out, 1 at the star. */
export function consumeHeat(distance: number, r0: number, rStar: number): number {
  const span = r0 - rStar;
  if (!(Math.abs(span) > 1e-8)) return 1;
  const heat = 1 - (distance - rStar) / span;
  if (heat < 0) return 0;
  if (heat > 1) return 1;
  return heat;
}

/** m:ss, matching the event chips. 102 s is "1:42". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds - 1e-9));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** Linear radius growth. Holds the end radius after `dur`. */
export function growRadius(age: number, r0: number, r1: number, dur: number): number {
  if (age <= 0) return r0;
  if (!(dur > 0) || age >= dur) return r1;
  return r0 + (r1 - r0) * (age / dur);
}

/** 1 at age 0, 0 at `dur`. Outside the window, 0. */
export function fadeOut(age: number, dur: number): number {
  if (age < 0 || !(dur > 0) || age >= dur) return 0;
  return 1 - age / dur;
}

/**
 * Crater glow. impact.svg: α 1 → 0.6 at +2 s → 0 at +3.6 s.
 */
export function craterAlpha(age: number, mid: number, midAlpha: number, dur: number): number {
  if (age < 0 || age >= dur) return 0;
  if (age <= mid) return 1 - (1 - midAlpha) * (mid > 0 ? age / mid : 1);
  const span = dur - mid;
  if (!(span > 0)) return 0;
  return midAlpha * (1 - (age - mid) / span);
}

/** burn-up.svg brightening: rise to `peak` over `rise`, then gone at `dur`. */
export function starBrighten(age: number, peak: number, rise: number, dur: number): number {
  if (age < 0 || age >= dur) return 0;
  if (rise > 0 && age < rise) return peak * (age / rise);
  const span = dur - rise;
  if (!(span > 0)) return peak;
  return peak * (1 - (age - rise) / span);
}

/** SVG keySplines ease-out. 0 at the start, 1 at the end. */
export function easeOutCubic(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - u) ** 3;
}

/** Deterministic 0–1 hash. Same integer always returns the same fraction. */
export function unitHash(n: number): number {
  let x = Math.imul(n | 0, 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One third of the grains are hot (#FFB45A). The rest cycle the three rock colours. */
export function ejectaGrain(seed: number, index: number, range: EjectaRange): EjectaGrain {
  const cone = (range.coneDeg * Math.PI) / 180;
  const u = unitHash(seed + index * 17);
  const v = unitHash(seed + index * 17 + 1);
  const w = unitHash(seed + index * 17 + 2);
  return {
    angle: (u - 0.5) * 2 * cone,
    dist: range.dist0 + (range.dist1 - range.dist0) * v,
    radius: range.r0 + (range.r1 - range.r0) * w,
    hot: index % 3 === 0,
    rock: (index - Math.floor(index / 3)) % 3,
  };
}

export function ejectaGrains(seed: number, range: EjectaRange): EjectaGrain[] {
  const grains: EjectaGrain[] = [];
  for (let i = 0; i < range.count; i++) grains.push(ejectaGrain(seed, i, range));
  return grains;
}

/**
 * Seeded chunks and dust. Positions are offsets; the visual places them on the orbit.
 * Chunks with r ≥ 4 are labelled solid. They are not added to the sim.
 */
export function debrisPieces(seed: number, range: DebrisRange): DebrisPiece[] {
  const pieces: DebrisPiece[] = [];
  for (let i = 0; i < range.chunks; i++) {
    const u = unitHash(seed + i * 13);
    const v = unitHash(seed + i * 13 + 1);
    const w = unitHash(seed + i * 13 + 2);
    const p = unitHash(seed + i * 13 + 3);
    pieces.push({
      along: (u - 0.5) * 1.4,
      outward: range.drift0 + (range.drift1 - range.drift0) * v,
      period: range.period0 + (range.period1 - range.period0) * w,
      radius: range.r0 + (range.r1 - range.r0) * p,
      hot: false,
      material: i % 2,
      dust: false,
    });
  }
  for (let i = 0; i < range.dust; i++) {
    const u = unitHash(seed + 1000 + i * 11);
    const v = unitHash(seed + 1000 + i * 11 + 1);
    const w = unitHash(seed + 1000 + i * 11 + 2);
    const p = unitHash(seed + 1000 + i * 11 + 3);
    pieces.push({
      along: (u - 0.5) * 1.6,
      outward: (range.drift0 + (range.drift1 - range.drift0) * v) * 0.65,
      period: range.period0 + (range.period1 - range.period0) * w,
      radius: 0.6 + p * 0.7,
      hot: p < range.dustHot,
      material: 0,
      dust: true,
    });
  }
  return pieces;
}

/** How far a piece has drifted, 0–1, over its own period. */
export function driftOpen(age: number, period: number): number {
  if (age <= 0) return 0;
  if (!(period > 0) || age >= period) return 1;
  return age / period;
}
