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
}

export interface BurnSample {
  /** Sim seconds, `step * dt`. */
  time: number;
  /** Strongest wind-up among burns still ahead. */
  windup: number;
  /** Strongest burn or tail among burns at or behind the ship. */
  thrust: number;
  cues: BurnCue[];
}

/** Sim seconds for an integer step. `dt` is the fixed integration step. */
export function simSeconds(step: number, dt: number): number {
  return step * (dt > 0 ? dt : 0);
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

/** Active windows for every node in the current plan. Pure. */
export function sampleBurnAnim(
  step: number,
  dt: number,
  nodes: readonly { step: number }[],
  windup: number,
  tail: number,
): BurnSample {
  const time = simSeconds(step, dt);
  const cues: BurnCue[] = [];
  let windupAmount = 0;
  let thrustAmount = 0;
  for (let i = 0; i < nodes.length; i++) {
    const window = burnWindow(step, nodes[i].step, dt, windup, tail);
    if (window.phase === "idle") continue;
    cues.push({ index: i, ...window });
    if (window.phase === "windup") windupAmount = Math.max(windupAmount, window.amount);
    else thrustAmount = Math.max(thrustAmount, window.amount);
  }
  return { time, windup: windupAmount, thrust: thrustAmount, cues };
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
