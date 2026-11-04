import { ghostSteps } from "../game/ghosts";
import { formatClock } from "./event-look";

/**
 * Pure choices for the LU2 ghost markers.
 * design/assets/ghost-markers.svg, style.md §15, threejs-notes.md §18.
 * Nothing here reads or writes the simulation.
 */

export type GhostKind = "burn" | "cursor" | "arrival" | "collision" | "gone" | "other";

/** Which palette token paints a stroke or a fill. */
export type GhostInk = "body" | "cursor" | "target" | "collision" | "gone";

export interface GhostSlot {
  step: number;
  bodyIndex: number;
  /** 1-based node index when this step is a burn. */
  burnNumber: number | null;
  cursor: boolean;
  arrival: boolean;
}

export interface GhostDraw {
  kind: GhostKind;
  ink: GhostInk;
  fillInk: GhostInk | "none";
  width: number;
  alpha: number;
  fill: number;
  inner: boolean;
  dash: number;
  gap: number;
  /** 0 none, 1 the collision cross, 2 the gone slash. */
  mark: 0 | 1 | 2;
  markWidth: number;
  markReach: number;
  badge: boolean;
  capture: boolean;
}

export interface GhostMetrics {
  ringWidth: number;
  alphaBurn: number;
  alphaOther: number;
  alphaCursor: number;
  alphaArrival: number;
  alphaCollision: number;
  alphaGone: number;
  widthCursor: number;
  widthArrival: number;
  widthCollision: number;
  fillBurn: number;
  fillOther: number;
  fillCursor: number;
  fillArrival: number;
  fillCollision: number;
  goneDash: number;
  goneGap: number;
  crossReach: number;
  slashReach: number;
}

/**
 * One ghost per moving body at each burn, one cursor ghost (the target),
 * and one arrival ghost. `ghostSteps` still decides which steps exist.
 */
export function planGhosts(
  nodes: readonly { step: number }[],
  cursorStep: number | null,
  drawnStep: number,
  movingCount: number,
  targetIndex: number,
  captureStep: number | null,
): GhostSlot[] {
  const steps = ghostSteps(nodes, cursorStep, drawnStep);
  const nodeIndex = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    if (!nodeIndex.has(nodes[i].step)) nodeIndex.set(nodes[i].step, i);
  }
  const slots: GhostSlot[] = [];
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    const node = nodeIndex.get(step);
    const isCursor = cursorStep === step;
    if (node !== undefined) {
      for (let b = 0; b < movingCount; b++) {
        slots.push({
          step,
          bodyIndex: b,
          burnNumber: node + 1,
          cursor: isCursor && b === targetIndex,
          arrival: captureStep === step && b === targetIndex,
        });
      }
    } else if (isCursor && targetIndex >= 0 && targetIndex < movingCount) {
      slots.push({
        step,
        bodyIndex: targetIndex,
        burnNumber: null,
        cursor: true,
        arrival: captureStep === step,
      });
    }
  }
  if (
    captureStep !== null &&
    captureStep !== drawnStep &&
    targetIndex >= 0 &&
    targetIndex < movingCount &&
    !slots.some((slot) => slot.arrival)
  ) {
    const node = nodeIndex.get(captureStep);
    slots.push({
      step: captureStep,
      bodyIndex: targetIndex,
      burnNumber: node === undefined ? null : node + 1,
      cursor: cursorStep === captureStep,
      arrival: true,
    });
  }
  return slots;
}

/**
 * Ghosts the burn list does not already carry.
 * Closest approach of each marked body, every moving body at the end of the
 * preview, and every moving body at the scrubber when one is set.
 * `movingIds` is the same order as `planGhosts`.
 */
export function previewGhosts(
  slots: readonly GhostSlot[],
  approaches: readonly { bodyId: string; step: number }[],
  movingIds: readonly string[],
  cursorStep: number | null,
  previewStep: number | null,
  drawnStep: number,
): GhostSlot[] {
  const extra: GhostSlot[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < slots.length; i++) taken.add(`${slots[i].step}:${slots[i].bodyIndex}`);
  const indexOf = (id: string): number => {
    for (let i = 0; i < movingIds.length; i++) if (movingIds[i] === id) return i;
    return -1;
  };
  const push = (step: number, bodyIndex: number): void => {
    if (bodyIndex < 0 || step === drawnStep) return;
    const id = `${step}:${bodyIndex}`;
    if (taken.has(id)) return;
    taken.add(id);
    extra.push({ step, bodyIndex, burnNumber: null, cursor: false, arrival: false });
  };
  const eachMoving = (step: number | null): void => {
    if (step === null) return;
    for (let i = 0; i < movingIds.length; i++) push(step, i);
  };
  for (let i = 0; i < approaches.length; i++) push(approaches[i].step, indexOf(approaches[i].bodyId));
  eachMoving(previewStep);
  eachMoving(cursorStep);
  return extra;
}

/** §18 order: gone, collision, arrival, cursor, then a burn or another body. */
export function pickGhostKind(input: {
  present: boolean;
  colliding: boolean;
  arrival: boolean;
  cursor: boolean;
  target: boolean;
}): GhostKind {
  if (!input.present) return "gone";
  if (input.colliding) return "collision";
  if (input.arrival) return "arrival";
  if (input.cursor && input.target) return "cursor";
  if (!input.target) return "other";
  return "burn";
}

export function ghostDraw(kind: GhostKind, spec: GhostMetrics): GhostDraw {
  if (kind === "cursor") {
    return {
      kind,
      ink: "cursor",
      fillInk: "body",
      width: spec.widthCursor,
      alpha: spec.alphaCursor,
      fill: spec.fillCursor,
      inner: true,
      dash: 0,
      gap: 1,
      mark: 0,
      markWidth: 0,
      markReach: 0,
      badge: false,
      capture: false,
    };
  }
  if (kind === "arrival") {
    return {
      kind,
      ink: "target",
      fillInk: "target",
      width: spec.widthArrival,
      alpha: spec.alphaArrival,
      fill: spec.fillArrival,
      inner: true,
      dash: 0,
      gap: 1,
      mark: 0,
      markWidth: 0,
      markReach: 0,
      badge: false,
      capture: true,
    };
  }
  if (kind === "collision") {
    return {
      kind,
      ink: "collision",
      fillInk: "collision",
      width: spec.widthCollision,
      alpha: spec.alphaCollision,
      fill: spec.fillCollision,
      inner: false,
      dash: 0,
      gap: 1,
      mark: 1,
      markWidth: spec.widthCollision,
      markReach: spec.crossReach,
      badge: false,
      capture: false,
    };
  }
  if (kind === "gone") {
    return {
      kind,
      ink: "gone",
      fillInk: "none",
      width: spec.ringWidth,
      alpha: spec.alphaGone,
      fill: 0,
      inner: false,
      dash: spec.goneDash,
      gap: spec.goneGap,
      mark: 2,
      markWidth: spec.ringWidth,
      markReach: spec.slashReach,
      badge: false,
      capture: false,
    };
  }
  if (kind === "other") {
    return {
      kind,
      ink: "body",
      fillInk: "body",
      width: spec.ringWidth,
      alpha: spec.alphaOther,
      fill: spec.fillOther,
      inner: true,
      dash: 0,
      gap: 1,
      mark: 0,
      markWidth: 0,
      markReach: 0,
      badge: false,
      capture: false,
    };
  }
  return {
    kind,
    ink: "body",
    fillInk: "body",
    width: spec.ringWidth,
    alpha: spec.alphaBurn,
    fill: spec.fillBurn,
    inner: true,
    dash: 0,
    gap: 1,
    mark: 0,
    markWidth: 0,
    markReach: 0,
    badge: true,
    capture: false,
  };
}

/** Time from now, in the chip's words. Other bodies have no label. */
export function ghostChip(kind: GhostKind, secondsFromNow: number): string | null {
  const clock = formatClock(Math.max(0, secondsFromNow));
  if (kind === "burn" || kind === "cursor") return `+${clock}`;
  if (kind === "arrival") return `arrive ${clock}`;
  if (kind === "collision") return `collision ${clock}`;
  if (kind === "gone") return `gone at ${clock}`;
  return null;
}

/** Burn nodes strictly after the drawn step and at or before this ghost. */
export function burnsAhead(
  nodes: readonly { step: number }[],
  drawnStep: number,
  step: number,
): number {
  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    const nodeStep = nodes[i].step;
    if (nodeStep > drawnStep && nodeStep <= step) count += 1;
  }
  return count;
}

/**
 * 1 until the ghost is more than `limit` burns ahead.
 * After that the ring alpha lands on `far` (header: fade to α 0.3).
 */
export function aheadFade(ahead: number, limit: number, far: number, ringAlpha: number): number {
  if (ahead <= limit) return 1;
  if (!(ringAlpha > 0)) return far;
  return far / ringAlpha;
}

/** 1 at the start of the 0.8 s cycle, down to 0.45 and back. Cosmetic time. */
export function collisionPulse(seconds: number, period: number, high: number, low: number): number {
  if (!(period > 0)) return high;
  const phase = (seconds % period) / period;
  const mid = (high + low) / 2;
  const amp = (high - low) / 2;
  return mid + amp * Math.cos(phase * Math.PI * 2);
}

export function shipInside(sx: number, sy: number, bx: number, by: number, radius: number): boolean {
  return Math.hypot(sx - bx, sy - by) <= radius + 1e-6;
}

export function pointAtStep(
  path: readonly { step: number; x: number; y: number }[],
  step: number,
): { x: number; y: number } | null {
  let lo = 0;
  let hi = path.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const found = path[mid].step;
    if (found === step) return path[mid];
    if (found < step) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** Path sample, then any fallback pose that carries the same step (origin or final). */
export function shipAtStep(
  path: readonly { step: number; x: number; y: number }[],
  step: number,
  fallback: readonly { step: number; x: number; y: number }[],
): { x: number; y: number } | null {
  const hit = pointAtStep(path, step);
  if (hit) return hit;
  for (let i = 0; i < fallback.length; i++) {
    if (fallback[i].step === step) return fallback[i];
  }
  return null;
}

/**
 * One ghost of each moon, at that moon's closest approach.
 * Planets keep a ghost at every burn, scrub, and preview end.
 */
export function retainMoonGhosts(
  slots: readonly GhostSlot[],
  approaches: readonly { bodyId: string; step: number }[],
  moving: readonly { id: string; kind: string }[],
): GhostSlot[] {
  const only = new Map<number, number>();
  for (let i = 0; i < approaches.length; i++) {
    const mark = approaches[i];
    for (let b = 0; b < moving.length; b++) {
      if (moving[b].id === mark.bodyId && moving[b].kind === "moon") only.set(b, mark.step);
    }
  }
  if (only.size === 0) return slots.slice();
  const out: GhostSlot[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const step = only.get(slot.bodyIndex);
    if (step === undefined) {
      out.push(slot);
      continue;
    }
    if (slot.step !== step || seen.has(slot.bodyIndex)) continue;
    seen.add(slot.bodyIndex);
    out.push(slot);
  }
  return out;
}

/** Higher ranks stay when two time chips occupy the same screen box. Earlier steps win a tie. */
export function labelRank(kind: GhostKind, step: number): number {
  const base =
    kind === "collision" ? 50 : kind === "arrival" ? 40 : kind === "cursor" ? 30 : kind === "gone" ? 20 : kind === "burn" ? 10 : 0;
  return base - step * 1e-6;
}

/** Centre and size of a time chip, in world units. Width is a generous measure of the monospace chip. */
export interface LabelChip {
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
}

export function chipBox(
  x: number,
  y: number,
  radius: number,
  text: string,
  zoom: number,
  rank: number,
  metrics: { chipHeight: number; chipOffsetX: number; chipOffsetY: number; chipFont: number; chipPad: number },
): LabelChip {
  const z = zoom > 0 ? zoom : 1;
  const cssW = text.length * metrics.chipFont * 0.64 + metrics.chipPad * 2 + 4;
  const w = cssW / z;
  const h = metrics.chipHeight / z;
  return {
    x: x + radius + metrics.chipOffsetX / z + w / 2,
    y: y - metrics.chipOffsetY / z,
    w,
    h,
    rank,
  };
}

function chipsOverlap(a: LabelChip, b: LabelChip): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

/**
 * Which chips to draw. A lower-rank chip that collides with a kept one is
 * dropped, so two +time labels never sit on top of each other.
 */
export function keptLabels(chips: readonly LabelChip[]): boolean[] {
  const order: number[] = [];
  for (let i = 0; i < chips.length; i++) order.push(i);
  order.sort((a, b) => chips[b].rank - chips[a].rank || a - b);
  const keep = new Array<boolean>(chips.length).fill(false);
  const kept: number[] = [];
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    const chip = chips[i];
    if (!(chip.w > 0) || !(chip.h > 0)) continue;
    let hit = false;
    for (let k = 0; k < kept.length; k++) {
      if (chipsOverlap(chip, chips[kept[k]])) {
        hit = true;
        break;
      }
    }
    if (hit) continue;
    keep[i] = true;
    kept.push(i);
  }
  return keep;
}

/** Sim times strictly between the ends, one tick per `every` seconds. */
export function trackTicks(t0: number, t1: number, every: number): number[] {
  const out: number[] = [];
  if (!(every > 0) || !(t1 > t0)) return out;
  const first = Math.floor(t0 / every) + 1;
  const last = Math.ceil(t1 / every) - 1;
  for (let i = first; i <= last; i++) {
    const t = i * every;
    if (t > t0 && t < t1) out.push(t);
  }
  return out;
}

/** How many samples the future track needs. Inclusive ends are added by the caller. */
export function trackSamples(t0: number, t1: number, dt: number, cap: number): number {
  if (!(t1 > t0)) return 0;
  const steps = dt > 0 ? (t1 - t0) / dt : 0;
  const n = Math.ceil(steps / 8);
  if (n < 2) return 2;
  if (n > cap) return cap;
  return n;
}
