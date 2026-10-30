/**
 * Chemical plume shape from design/assets/ship/plume-states.svg.
 * Visual only. The sim still applies the burn on one step.
 */

export interface PlumeSpec {
  lengthBase: number;
  lengthPerDv: number;
  lengthMax: number;
  widthBase: number;
  widthPerLength: number;
  shoulder: number;
  bell: number;
  rag: number;
  ragCycles: readonly number[];
  ragPeriod: number;
  coreLength: number;
  coreWidth: number;
  tailSoft: number;
  ignite: number;
  lickLength: number;
  lickWidth: number;
  glowRx0: number;
  glowRx1: number;
}

const RAG_PHASES = [0.4, 2.2, 4.1];

/** L = min(max, base + perDv * |Δv|). Small 0.5 → 50, medium 3 → 80, large ≥ 5.5 → 110. */
export function plumeLength(dv: number, spec: Pick<PlumeSpec, "lengthBase" | "lengthPerDv" | "lengthMax">): number {
  const mag = Number.isFinite(dv) ? Math.abs(dv) : 0;
  const base = spec.lengthBase > 0 ? spec.lengthBase : 0;
  const per = spec.lengthPerDv > 0 ? spec.lengthPerDv : 0;
  const cap = spec.lengthMax > 0 ? spec.lengthMax : 0;
  if (cap <= 0) return 0;
  return Math.min(cap, base + per * mag);
}

/** W = widthBase + L / 40, with widthPerLength standing in for 1/40. */
export function plumeWidth(length: number, spec: Pick<PlumeSpec, "widthBase" | "widthPerLength">): number {
  const L = length > 0 ? length : 0;
  const base = spec.widthBase > 0 ? spec.widthBase : 0;
  const per = spec.widthPerLength > 0 ? spec.widthPerLength : 0;
  return base + L * per;
}

/** Mean of the sines in the header. `time` is seconds; the period is one flicker cycle. */
export function plumeRag(t: number, time: number, cycles: readonly number[], period: number): number {
  if (cycles.length === 0) return 0;
  const speed = period > 0 ? (Math.PI * 2) / period : 0;
  let sum = 0;
  for (let i = 0; i < cycles.length; i++) {
    const cyclesAlong = cycles[i] > 0 ? cycles[i] : 0;
    const phase = RAG_PHASES[i] ?? 0;
    sum += Math.sin(t * cyclesAlong * Math.PI * 2 + phase + time * speed);
  }
  return sum / cycles.length;
}

/**
 * Half-width at t (0 nozzle, 1 tip).
 * w(t) = W * (0.55 + 0.45 min(1, t/0.25)) * (1 - max(0, (t-0.25)/0.75))^1.4 * (1 + 0.12 rag min(1, 6t))
 */
export function plumeHalfWidth(t: number, width: number, time: number, spec: PlumeSpec): number {
  if (!(width > 0) || !(t >= 0) || t > 1) return 0;
  const shoulder = spec.shoulder > 0 ? spec.shoulder : 0.25;
  const rise = 0.55 + 0.45 * Math.min(1, t / shoulder);
  const span = 1 - shoulder;
  const tail = span > 0 ? Math.max(0, (t - shoulder) / span) : 0;
  const bell = Math.pow(Math.max(0, 1 - tail), spec.bell > 0 ? spec.bell : 1);
  const flick = 1 + spec.rag * plumeRag(t, time, spec.ragCycles, spec.ragPeriod) * Math.min(1, 6 * t);
  return Math.max(0, width * rise * bell * flick);
}

export interface PlumeFrame {
  /** Design-unit length of the shape being drawn. */
  length: number;
  /** Max half-width W of that shape. */
  width: number;
  /** 0..1. The tip is at this fraction of `length` during ignition. */
  grow: number;
  /** 0 at the nozzle until tail-off. Then the root is already gone. */
  cutoff: number;
  /** Straight alpha of the whole shape. */
  fade: number;
  glow: boolean;
  /** Throat ellipse rx, design units. 0 hides it. */
  glowRx: number;
  /** 0..1 ignition flash. Negative hides it. */
  flash: number;
}

/**
 * What to draw at this sim offset from the burn.
 * Wind-up is a short lick. Ignition grows the real plume over `ignite` seconds.
 * Tail-off then runs the cutoff so it finishes when the existing tail ends.
 * A bigger |Δv| is longer on screen because that tail is longer, and the shape is longer too.
 */
export function plumeFrame(
  spec: PlumeSpec,
  phase: "idle" | "windup" | "burn" | "tail",
  offset: number,
  amount: number,
  dv: number,
  tail: number,
  flicker: number,
): PlumeFrame {
  const hidden: PlumeFrame = {
    length: 0,
    width: 0,
    grow: 0,
    cutoff: 0,
    fade: 0,
    glow: false,
    glowRx: 0,
    flash: -1,
  };
  if (phase === "idle") return hidden;
  if (phase === "windup") {
    const glowRx = spec.glowRx0 + (spec.glowRx1 - spec.glowRx0) * Math.min(1, Math.max(0, amount));
    return {
      length: spec.lickLength,
      width: spec.lickWidth,
      grow: 1,
      cutoff: 0,
      fade: Math.min(1, Math.max(0, flicker)),
      glow: true,
      glowRx,
      flash: -1,
    };
  }
  const length = plumeLength(dv, spec);
  const width = plumeWidth(length, spec);
  const ignite = spec.ignite > 0 ? spec.ignite : 0;
  const elapsed = offset > 0 ? offset : 0;
  if (elapsed < ignite) {
    return {
      length,
      width,
      grow: ignite > 0 ? elapsed / ignite : 1,
      cutoff: 0,
      fade: 1,
      glow: false,
      glowRx: 0,
      flash: ignite > 0 ? elapsed / ignite : 1,
    };
  }
  const rest = Math.max(0, tail - ignite);
  const cutoff = rest > 0 ? Math.min(1, (elapsed - ignite) / rest) : 1;
  return {
    length,
    width,
    grow: 1,
    cutoff,
    fade: 1 - cutoff,
    glow: false,
    glowRx: 0,
    flash: -1,
  };
}
