/**
 * Burn wind-up and thrust-tail timing.
 *
 * Windows are measured in sim seconds (`step * dt`). Speed, slow motion, and
 * pause only change how fast `step` advances, so the same helper stays correct
 * for all three. It reads the plan and returns amounts. It does not write
 * sim state.
 */

export type BurnPhase = "idle" | "windup" | "burn" | "tail";

export interface BurnWindow {
  /** Sim seconds after the burn. Negative before it. */
  offset: number;
  phase: BurnPhase;
  /** 0 at a window edge, 1 at the burn instant. */
  amount: number;
}

export interface BurnCue extends BurnWindow {
  index: number;
  /** Sim seconds this burn's thrust stays lit. `min(max, base + perDv * |dv|)`. */
  tail: number;
}

export interface BurnSample {
  /** Sim seconds, `step * dt`. */
  time: number;
  /** Strongest wind-up among burns still ahead. */
  windup: number;
  /** Strongest burn or tail among burns at or behind the ship. */
  thrust: number;
  /**
   * Length of that thrust cue relative to the clamped maximum.
   * 1 is a burn at the cap; a small correction is shorter.
   */
  thrustStretch: number;
  cues: BurnCue[];
}

/** Tail length in sim seconds. `base + perDv * |dv|`, clamped to `max`. */
export interface ThrustTail {
  base: number;
  perDv: number;
  max: number;
}

export function tailFromBurn(burn: { tailBase: number; tailPerDv: number; tailMax: number }): ThrustTail {
  return { base: burn.tailBase, perDv: burn.tailPerDv, max: burn.tailMax };
}

/** Sim seconds for an integer step. `dt` is the fixed integration step. */
export function simSeconds(step: number, dt: number): number {
  return step * (dt > 0 ? dt : 0);
}

/**
 * How long the plume stays lit after a burn of this delta-v magnitude.
 * Larger `|dv|` never shortens it. Past `max` it stays at `max`.
 * The result is sim seconds, so pause and slow motion do not rescale it.
 */
export function thrustDuration(magnitude: number, tail: ThrustTail): number {
  const mag = Number.isFinite(magnitude) ? Math.abs(magnitude) : 0;
  const base = tail.base > 0 ? tail.base : 0;
  const per = tail.perDv > 0 ? tail.perDv : 0;
  const cap = tail.max > 0 ? tail.max : 0;
  if (cap <= 0) return 0;
  return Math.min(cap, base + per * mag);
}

/**
 * Where `step` sits relative to a burn at `burnStep`.
 * The wind-up is the half-open span (-windup, 0) and the tail is (0, tail),
 * both in sim seconds. The burn instant itself is `step === burnStep`.
 */
export function burnWindow(
  step: number,
  burnStep: number,
  dt: number,
  windup: number,
  tail: number,
): BurnWindow {
  if (!(dt > 0) || !Number.isFinite(step) || !Number.isFinite(burnStep)) {
    return { offset: 0, phase: "idle", amount: 0 };
  }
  const delta = step - burnStep;
  const offset = delta * dt;
  if (delta < 0) {
    const windupSteps = windup > 0 ? windup / dt : 0;
    const lead = -delta;
    if (windupSteps <= 0 || lead >= windupSteps) return { offset, phase: "idle", amount: 0 };
    return { offset, phase: "windup", amount: 1 - lead / windupSteps };
  }
  if (delta === 0) return { offset: 0, phase: "burn", amount: 1 };
  const tailSteps = tail > 0 ? tail / dt : 0;
  if (tailSteps <= 0 || delta >= tailSteps) return { offset, phase: "idle", amount: 0 };
  return { offset, phase: "tail", amount: 1 - delta / tailSteps };
}

/** Active windows for every node in the current plan. Each tail follows that node's `|dv|`. Pure. */
export function sampleBurnAnim(
  step: number,
  dt: number,
  nodes: readonly { step: number; dvx?: number; dvy?: number }[],
  windup: number,
  tail: ThrustTail,
): BurnSample {
  const time = simSeconds(step, dt);
  const cues: BurnCue[] = [];
  let windupAmount = 0;
  let thrustAmount = 0;
  let thrustStretch = 0;
  const cap = tail.max > 0 ? tail.max : 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const mag = Math.hypot(node.dvx ?? 0, node.dvy ?? 0);
    const tailSec = thrustDuration(mag, tail);
    const window = burnWindow(step, node.step, dt, windup, tailSec);
    if (window.phase === "idle") continue;
    cues.push({ index: i, tail: tailSec, ...window });
    if (window.phase === "windup") {
      windupAmount = Math.max(windupAmount, window.amount);
      continue;
    }
    const stretch = cap > 0 ? tailSec / cap : 0;
    if (window.amount > thrustAmount || (window.amount === thrustAmount && stretch > thrustStretch)) {
      thrustAmount = window.amount;
      thrustStretch = stretch;
    }
  }
  return { time, windup: windupAmount, thrust: thrustAmount, thrustStretch, cues };
}

/**
 * 1 at the bright crest, dimmer in the trough. Depth grows with the wind-up
 * amount. Phase comes from sim time, so a paused step holds the flicker.
 */
export function windupFlicker(simTime: number, amount: number, hz: number): number {
  const depth = Math.min(1, Math.max(0, amount));
  if (depth === 0 || !(hz > 0)) return 1;
  const wave = Math.sin(simTime * hz * Math.PI * 2);
  return 1 - depth * 0.65 * (0.5 - 0.5 * wave);
}

/** 0..1 marker pulse. Phase comes from sim time. */
export function markerPulse(simTime: number, hz: number): number {
  if (!(hz > 0)) return 0;
  return 0.5 + 0.5 * Math.sin(simTime * hz * Math.PI * 2);
}
