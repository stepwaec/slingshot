import type { Body } from "../sim/physics";

/**
 * Draw sizes for the Sol chart and Mission 1.
 *
 * The Sun's photosphere is `SUN_EARTH_DIAMETERS` Earth radii. That disc is
 * stored on the Sun as `crashRadius`, and both the impostor and the crash
 * test read it. `body.radius` stays the art header, which tides and close
 * passes still use. Masses and orbits do not read either number.
 *
 * The bright corona is the shader wind (`wiR` photosphere radii). It is not
 * a crash band: at this disc it reaches Mercury's sunward limb. Planet
 * orbits and the Moon's path stay outside the disc and that corona. The
 * faint haze continues past the wind and is not part of this edge.
 * The Moon is 0.27 of Earth's diameter. Zoomed out, planets and moons keep
 * at least `MIN_BODY_PX` on screen. Zoomed in, the disc is the game-scale size.
 */
export const SUN_EARTH_DIAMETERS = 8;
export const MOON_EARTH_FRACTION = 0.27;
/** CSS pixels. A disc this wide stays visible when the chart is zoomed out. */
export const MIN_BODY_PX = 8;

export function isSolChart(bodies: readonly Body[]): boolean {
  return bodies.some((body) => body.id === "sun" && body.look === "sol-sun");
}

/** Photosphere of the Sol Sun, in world units. The crash disc and the impostor. */
export function solSunDiscRadius(earthRadius: number): number {
  return SUN_EARTH_DIAMETERS * earthRadius;
}

/** Game-scale visual radius in world units, before the zoom floor. */
export function solGameVisualRadius(body: Body, earthRadius: number): number {
  if (body.id === "sun" && body.look === "sol-sun") {
    const disc = body.crashRadius;
    if (disc !== undefined && disc > 0) return disc;
  }
  if (!(earthRadius > 0)) return body.radius;
  if (body.id === "luna") return MOON_EARTH_FRACTION * earthRadius;
  return body.radius;
}

/**
 * Radius the impostor uses, in world units.
 * Stars keep the game-scale size. Planets and moons grow when `radius * zoom`
 * would fall under `MIN_BODY_PX`.
 */
export function solDrawnRadius(body: Body, sol: boolean, zoom: number, earthRadius: number): number {
  if (!sol) return body.radius;
  const game = solGameVisualRadius(body, earthRadius);
  if (body.kind === "star") return game;
  const z = zoom > 0 ? zoom : 1;
  return Math.max(game, MIN_BODY_PX / z);
}
