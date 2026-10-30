import type { Body } from "../../sim/physics";

/**
 * Compact objects. design/shader-specs.md §5.
 * The white dwarf is not here: it is star.frag's smooth mode.
 * A pulsar's beams use the level beam, in body radii, on sim time.
 */
export const COMPACT_KEYS = ["neutron", "pulsar", "magnetar", "hole"] as const;

export type CompactKey = (typeof COMPACT_KEYS)[number];

export function compactKey(body: Body): CompactKey | null {
  if (body.kind === "blackhole") return "hole";
  switch (body.look) {
    case "neutron":
      return "neutron";
    case "pulsar":
      return "pulsar";
    case "magnetar":
      return "magnetar";
    default:
      return null;
  }
}

export function compactKindIndex(key: CompactKey): number {
  if (key === "neutron") return 0;
  if (key === "pulsar") return 1;
  if (key === "magnetar") return 2;
  return 3;
}

/** Degrees clockwise from up. The pulsar's phase is its magnetic axis. */
export function compactMotion(body: Body): { period: number; phase: number; reach: number; tilt: number; diskSpin: number } {
  const tiltDeg = ((body.magnet?.tilt ?? 0) * 180) / Math.PI;
  const period = body.beam && body.beam.period !== 0 ? body.beam.period : 4;
  const reach = body.beam && body.radius > 0 && body.beam.reach > 0 ? body.beam.reach / body.radius : 28.5;
  return { period, phase: tiltDeg, reach, tilt: tiltDeg, diskSpin: 24 };
}

/** Outer reach of the quad, in body radii. */
export function compactExtent(body: Body): number {
  const key = compactKey(body);
  if (key === "neutron") return 5;
  if (key === "pulsar") return Math.max(5.5, compactMotion(body).reach);
  if (key === "magnetar") return 16.67;
  return 3;
}
