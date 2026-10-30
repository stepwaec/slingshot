import { lerpHex } from "./palette";
import type { Theme } from "./theme";

/**
 * Planet X's target zone. Visual only: this file does not read or write the sim.
 *
 * STABLE-ORBIT HOOK
 * A stable orbit, today, is `ship.status === "won"`. The sim sets that from
 * `isCapturedOrbit` (bound, periapsis above the surface, apoapsis inside the
 * capture radius). The Orbit capture work package will replace that rule.
 * `targetZonePhase` is the only place the ring asks, so that package can
 * retune the rule here and leave the shader alone.
 *
 * Not drawn yet, on purpose, until that package lands: the exit arc, the Δv
 * hint, the planning entry tick, the dashed capture-orbit stroke, and the
 * flyby cross. The closed capture ellipse on the predicted path stays dotted
 * in `path.ts`. It is the plan, not this ring.
 *
 * design/style.md §17, design/assets/target-zone.svg, design/threejs-notes.md §20.
 */

export type ZonePhase = "idle" | "inside" | "flash" | "stable" | "flyby";

export type ZoneSpec = Theme["zone"];

export interface ZoneColors {
  ring: string;
  stable: string;
  flash: string;
}

export interface ZoneInput {
  /** Ship status. `"won"` is the existing capture. */
  status: "flying" | "won" | "crashed" | "lost";
  lostReason: string | null;
  /** True once the trajectory has touched the capture sphere. */
  enteredCapture: boolean;
  /** Distance from the ship to the target, world units. */
  distance: number;
  captureRadius: number;
  /** Seconds of frame time since status became `"won"`. Ignored otherwise. */
  wonAge: number;
  /** Cosmetic seconds. The idle pulse is at its dim rest at 0. */
  now: number;
  /** Result card is up. After the flash, the ring holds a steady alpha. */
  scrim: boolean;
}

export interface ZoneLook {
  phase: ZonePhase;
  /** Stroke colour, sRGB hex. */
  color: string;
  alpha: number;
  widthPx: number;
  /** Mint band fill-opacity. The band shape itself peaks at 1 on the ring. */
  bandAlpha: number;
  /** Extra screen pixels beyond the capture radius. 0 hides the wave. */
  waveExtraPx: number;
  waveAlpha: number;
}

/**
 * idle: outside the zone.
 * inside: entered the sphere and still in it, flight not over.
 * flash: the first 1.5 s after a win.
 * stable: the win, after the flash.
 * flyby: lost because the ship left the zone unbound.
 */
export function targetZonePhase(input: ZoneInput, spec: ZoneSpec): ZonePhase {
  if (input.status === "won") return input.wonAge < spec.flashEndSec ? "flash" : "stable";
  if (input.status === "lost" && input.lostReason === "flyby") return "flyby";
  if (
    input.status === "flying" &&
    input.enteredCapture &&
    input.distance <= input.captureRadius + 1e-3
  ) {
    return "inside";
  }
  return "idle";
}

/** 0 at t = 0, 1 at half a period, 0 at the period. */
function sine(now: number, period: number): number {
  if (!(period > 0)) return 0;
  return 0.5 - 0.5 * Math.cos((Math.PI * 2 * now) / period);
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function lerp(a: number, b: number, t: number): number {
  const u = clamp01(t);
  return a + (b - a) * u;
}

export function targetZoneLook(input: ZoneInput, spec: ZoneSpec, colors: ZoneColors): ZoneLook {
  const phase = targetZonePhase(input, spec);
  const idle = sine(input.now, spec.pulseSec);
  const look: ZoneLook = {
    phase,
    color: colors.ring,
    alpha: lerp(spec.idleAlpha0, spec.idleAlpha1, idle),
    widthPx: spec.widthPx,
    bandAlpha: lerp(spec.idleBand0, spec.idleBand1, idle),
    waveExtraPx: 0,
    waveAlpha: 0,
  };

  if (phase === "inside") {
    look.alpha = spec.insideAlpha;
    look.bandAlpha = spec.insideBand;
    return look;
  }

  if (phase === "flyby") {
    look.alpha = spec.flybyAlpha;
    look.bandAlpha = spec.flybyBand;
    return look;
  }

  if (phase === "flash") {
    const age = Math.max(0, input.wonAge);
    if (age <= spec.flashWhiteSec) {
      const t = age / spec.flashWhiteSec;
      look.color = lerpHex(colors.ring, colors.flash, clamp01(t));
      look.widthPx = lerp(spec.widthPx, spec.flashWidthPx, t);
    } else if (age <= spec.flashSettleSec) {
      const t = (age - spec.flashWhiteSec) / (spec.flashSettleSec - spec.flashWhiteSec);
      look.color = lerpHex(colors.flash, colors.stable, clamp01(t));
      look.widthPx = lerp(spec.flashWidthPx, spec.stableWidthPx, t);
    } else {
      look.color = colors.stable;
      look.widthPx = spec.stableWidthPx;
    }
    if (age <= spec.flashBandPeakSec) {
      look.bandAlpha = lerp(spec.insideBand, spec.flashBandPeak, age / spec.flashBandPeakSec);
    } else {
      const t = (age - spec.flashBandPeakSec) / (spec.flashEndSec - spec.flashBandPeakSec);
      look.bandAlpha = lerp(spec.flashBandPeak, spec.insideBand, t);
    }
    if (age <= spec.waveSec) {
      const t = age / spec.waveSec;
      const ease = 1 - (1 - t) ** 3;
      look.waveExtraPx = spec.wavePx * ease;
      look.waveAlpha = spec.waveAlpha * (1 - t);
    }
    return look;
  }

  if (phase === "stable") {
    const breathe = sine(input.now, spec.stablePulseSec);
    look.color = colors.stable;
    look.widthPx = spec.stableWidthPx;
    look.alpha = input.scrim ? spec.scrimAlpha : lerp(spec.stableAlpha0, spec.stableAlpha1, breathe);
    look.bandAlpha = lerp(spec.stableBand0, spec.stableBand1, breathe);
  }

  return look;
}
