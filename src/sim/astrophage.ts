/**
 * Astrophage geometry and harvest. Prediction and flight both call
 * `harvestKnots` from the same step, so a path that crosses a knot gains
 * the same fuel either way.
 *
 * Numbers are the design defaults in `design/assets/astro/*.svg` and
 * `design/assets/overlays/astrophage-map.svg`. A level may override the
 * harvest rate and the spin-drive Δv scale.
 */

export interface AstrophageSpec {
  /** Infection, 1–10. The gauge lights this many segments. */
  level: number;
  /** Fraction of the star's luminosity that is gone. 0.03 dims 3 %. */
  dims: number;
}

export interface PetrovaKnot {
  /** 0 at the star limb, 1 at the planet limb. */
  t: number;
  /** Share of the Astrophage tank. 0.4 is the "+40 %" chip. */
  fuel: number;
  /** Scoop reach, world units. */
  radius: number;
}

export interface PetrovaLine {
  from: string;
  to: string;
  /** How far the quadratic bows off the chord, world units. */
  bulge: number;
  /** Past this t the line is the eaten (green) variant. Omitted: a living line. */
  eaten?: number;
  knots: readonly PetrovaKnot[];
}

/** Tank size when a level omits `astro.capacity`. Knot fuel is a share of this. */
export const ASTRO_CAPACITY = 1;

/** "+2.4 %/s" in `astrophage-harvest.svg`, as a fraction of the tank per second. */
export const ASTRO_HARVEST_RATE = 0.024;

/** "Δv ×12" in `hud-astrophage.svg`. Tank units spent per unit of |Δv| are `1 / scale`. */
export const ASTRO_DV = 12;

/** `petrova-line.svg`: w(t) = 2.5 + 9 t^1.6. */
export function lineWidth(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return 2.5 + 9 * Math.pow(u, 1.6);
}

/**
 * Fade along the line. `petrova-line.svg`: 0.15 at the star, 1 from 0.12 to
 * 0.85, 0.6 at the planet. An eaten line is gone by eaten + 0.22.
 */
export function lineFade(t: number, eaten?: number): number {
  let fade = 1;
  if (t < 0.12) fade = 0.15 + (0.85 * t) / 0.12;
  else if (t > 0.85) fade = 1 + (0.6 - 1) * ((t - 0.85) / 0.15);
  if (eaten === undefined) return fade;
  const end = eaten + 0.22;
  if (t >= end) return 0;
  if (t > eaten) fade *= 1 - (t - eaten) / 0.22;
  return fade;
}

/** Colour blend into the eaten green, over ±0.08 of `eaten`. 0 is crimson. */
export function eatenMix(t: number, eaten?: number): number {
  if (eaten === undefined) return 0;
  const u = (t - (eaten - 0.08)) / 0.16;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u;
}

export interface Curve {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  ex: number;
  ey: number;
}

/**
 * Quadratic from the star limb + 8 to the planet limb − 4, bowed `bulge`
 * off the chord on the left-hand normal. `petrova-line.svg` header.
 */
export function petrovaCurve(
  starX: number,
  starY: number,
  starR: number,
  planetX: number,
  planetY: number,
  planetR: number,
  bulge: number,
): Curve {
  const dx = planetX - starX;
  const dy = planetY - starY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const sx = starX + ux * (starR + 8);
  const sy = starY + uy * (starR + 8);
  const ex = planetX - ux * (planetR + 4);
  const ey = planetY - uy * (planetR + 4);
  return {
    sx,
    sy,
    cx: (sx + ex) / 2 + nx * bulge,
    cy: (sy + ey) / 2 + ny * bulge,
    ex,
    ey,
  };
}

export function curvePoint(curve: Curve, t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * curve.sx + 2 * u * t * curve.cx + t * t * curve.ex,
    y: u * u * curve.sy + 2 * u * t * curve.cy + t * t * curve.ey,
  };
}

export function curveTangent(curve: Curve, t: number): { x: number; y: number } {
  const u = 1 - t;
  const dx = 2 * u * (curve.cx - curve.sx) + 2 * t * (curve.ex - curve.cx);
  const dy = 2 * u * (curve.cy - curve.sy) + 2 * t * (curve.ey - curve.cy);
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export interface KnotSite {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

export interface HarvestResult {
  tank: number;
  gained: number;
  /** Fraction of the tank per second actually stored this step. */
  rate: number;
  remaining: number[];
}

/**
 * Scoop inside a knot: add `ratePerSec` of the tank per second, and drain
 * the knot by the same amount. A full tank or an empty knot adds nothing.
 * Offers scale together when the tank cannot hold all of them.
 */
export function harvestKnots(
  x: number,
  y: number,
  sites: readonly KnotSite[],
  tank: number,
  capacity: number,
  ratePerSec: number,
  dt: number,
): HarvestResult {
  const remaining = sites.map((site) => site.remaining);
  const room = capacity - tank;
  if (!(room > 0) || !(ratePerSec > 0) || !(dt > 0)) {
    return { tank, gained: 0, rate: 0, remaining };
  }
  const offer = new Array<number>(sites.length).fill(0);
  let budget = 0;
  const slice = ratePerSec * dt;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    if (!(site.remaining > 0) || !(site.radius > 0)) continue;
    if (Math.hypot(x - site.x, y - site.y) > site.radius) continue;
    const give = site.remaining < slice ? site.remaining : slice;
    offer[i] = give;
    budget += give;
  }
  if (!(budget > 0)) return { tank, gained: 0, rate: 0, remaining };
  const take = room < budget ? room : budget;
  const scale = take / budget;
  let gained = 0;
  for (let i = 0; i < offer.length; i++) {
    if (!(offer[i] > 0)) continue;
    const paid = offer[i] * scale;
    remaining[i] = sites[i].remaining - paid;
    gained += paid;
  }
  return { tank: tank + gained, gained, rate: gained / dt, remaining };
}

/** Tank units a spin burn spends. `|dv| / scale`, so a full tank buys `scale` of Δv. */
export function spinCost(dv: number, dvScale: number): number {
  if (!(dv > 0) || !(dvScale > 0)) return 0;
  return dv / dvScale;
}

export interface FieldBody {
  x: number;
  y: number;
  radius: number;
  kind: "star" | "planet";
  /** Infected stars add the halo. Clean stars do not. */
  infected: boolean;
}

export interface FieldKnot {
  x: number;
  y: number;
  /** 1 is a full knot. A drained knot adds nothing. */
  share: number;
}

export interface FieldLine {
  curve: Curve;
  eaten?: number;
  starX: number;
  starY: number;
  planetX: number;
  planetY: number;
  planetR: number;
}

export interface FieldSample {
  /** Density A from `astrophage-map.svg`. */
  a: number;
  /** True when the nearest line sample is past its eaten point. */
  eaten: boolean;
  /** Migration direction, radians, world +x / +y. */
  angle: number;
}

const FIELD_STEPS = 48;

/**
 * Design-default density. The header: along a line
 * `A += 1.15 exp(-(d/w)^2) (0.55 + 0.6 t)`, `w = 6 + 26 t^1.4`;
 * an infected star `0.9 (1.4 r / d)^2.6`; a breeding world
 * `0.55 exp(-((d - r - 10)/9)^2)`; a knot `1.4 exp(-(d/22)^2)`.
 */
export function astroField(
  x: number,
  y: number,
  lines: readonly FieldLine[],
  bodies: readonly FieldBody[],
  knots: readonly FieldKnot[],
): FieldSample {
  let a = 0;
  let eaten = false;
  let best = Infinity;
  let flowX = 0;
  let flowY = 0;
  let haveFlow = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let near = Infinity;
    let nearT = 0;
    for (let s = 0; s <= FIELD_STEPS; s++) {
      const t = s / FIELD_STEPS;
      const p = curvePoint(line.curve, t);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < near) {
        near = d;
        nearT = t;
      }
    }
    const w = 6 + 26 * Math.pow(nearT, 1.4);
    const fade = lineFade(nearT, line.eaten);
    const gauss = Math.exp(-((near / w) * (near / w)));
    a += 1.15 * gauss * (0.55 + 0.6 * nearT) * (fade > 0 ? 1 : 0);
    const past = line.eaten !== undefined && nearT > line.eaten && fade > 0;
    if (near < best) {
      best = near;
      eaten = past;
      const tangent = curveTangent(line.curve, nearT);
      const radialX = x - line.starX;
      const radialY = y - line.starY;
      const radial = Math.hypot(radialX, radialY) || 1;
      const blend = gauss;
      flowX = tangent.x * blend + (radialX / radial) * (1 - blend);
      flowY = tangent.y * blend + (radialY / radial) * (1 - blend);
      haveFlow = true;
    }
    const planetD = Math.hypot(x - line.planetX, y - line.planetY);
    const ring = (planetD - line.planetR - 10) / 9;
    if (line.eaten === undefined) a += 0.55 * Math.exp(-(ring * ring));
  }
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body.infected || !(body.radius > 0)) continue;
    const d = Math.hypot(x - body.x, y - body.y);
    if (!(d > 1e-3)) continue;
    const fall = (1.4 * body.radius) / d;
    a += 0.9 * Math.pow(fall, 2.6);
    if (!haveFlow) {
      flowX = (x - body.x) / d;
      flowY = (y - body.y) / d;
      haveFlow = true;
    }
  }
  for (let i = 0; i < knots.length; i++) {
    const knot = knots[i];
    if (!(knot.share > 0)) continue;
    const d = Math.hypot(x - knot.x, y - knot.y) / 22;
    a += 1.4 * knot.share * Math.exp(-(d * d));
  }
  const angle = haveFlow ? Math.atan2(flowY, flowX) : 0;
  return { a, eaten, angle };
}

export interface TickStyle {
  length: number;
  width: number;
  /** sRGB hex. */
  color: string;
  alpha: number;
}

/**
 * Tick grammar from `astrophage-map.svg`. Null below Trace.
 * Eaten ticks use the green pair; Harvest density is the pale green.
 */
export function astroTick(a: number, eaten: boolean): TickStyle | null {
  let style: TickStyle | null = null;
  if (a >= 1) style = { length: 9, width: 1.6, color: eaten ? "#C8FFD9" : "#FFC2D2", alpha: 1 };
  else if (a >= 0.6) style = { length: 7.5, width: 1.4, color: eaten ? "#6EF0A0" : "#FF3D6E", alpha: 0.95 };
  else if (a >= 0.3) style = { length: 6, width: 1.1, color: eaten ? "#6EF0A0" : "#FF3D6E", alpha: 0.8 };
  else if (a >= 0.12) style = { length: 4, width: 0.9, color: eaten ? "#6EF0A0" : "#FF7A9C", alpha: 0.55 };
  return style;
}

/** Luminosity left after dimming. 1 when the star is clean. */
export function luminosityScale(dims: number | undefined): number {
  if (!(dims !== undefined) || !(dims > 0)) return 1;
  if (dims >= 1) return 0;
  return 1 - dims;
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: () => number): number {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

/** Marsaglia–Tsang, deterministic given `rng`. Used for the disk's beta(2, 2.6). */
function gamma(rng: () => number, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * Math.pow(rng() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 32; i++) {
    let x = 0;
    let v = 0;
    for (let k = 0; k < 16; k++) {
      const u1 = rng() || 1e-12;
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
      x = z;
      v = 1 + c * x;
      if (v > 0) break;
    }
    if (!(v > 0)) continue;
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u || 1e-12) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;
}

function beta(rng: () => number, a: number, b: number): number {
  const x = gamma(rng, a);
  const y = gamma(rng, b);
  const sum = x + y;
  return sum > 0 ? x / sum : 0.5;
}

export interface DiskSpeck {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
  back: boolean;
}

/**
 * Tau Ceti debris disk. `tau-ceti.svg`: radii 235–380, ry = 0.42 rx (the
 * 35° inclination), 2300 seeded specks, 5 % of them the larger rocks.
 * Local y < 0 is the back half.
 */
export function tauDisk(seed: number): DiskSpeck[] {
  const rng = mulberry32(seed);
  const colors = ["#C9D2EA", "#AAB8DD", "#E2E6F4", "#D9CBB8"];
  const specks: DiskSpeck[] = [];
  const count = 2300;
  for (let i = 0; i < count; i++) {
    const t = beta(rng, 2, 2.6);
    const radius = 235 + t * (380 - 235);
    const angle = rng() * Math.PI * 2;
    const rock = rng() < 0.05;
    const lx = radius * Math.cos(angle);
    const ly = radius * Math.sin(angle) * 0.42;
    specks.push({
      x: lx,
      y: ly,
      r: rock ? 0.9 + rng() * 0.7 : 0.35 + rng() * 0.45,
      color: rock ? "#E8DCCB" : colors[i % colors.length]!,
      alpha: 0.35 + rng() * 0.45,
      back: ly < 0,
    });
  }
  return specks;
}

/** Flat knot list, same order the sim stores in `state.knots`. */
export function flattenKnots(lines: readonly PetrovaLine[]): PetrovaKnot[] {
  const knots: PetrovaKnot[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let k = 0; k < line.knots.length; k++) knots.push(line.knots[k]);
  }
  return knots;
}
