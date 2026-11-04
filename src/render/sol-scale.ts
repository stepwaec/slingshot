import type { Body } from "../sim/physics";

/**
 * Draw-only sizes for the Sol chart and Mission 1.
 * `body.radius` stays the crash radius. Masses and orbits do not read this.
 *
 * The Sun's disc is 22 Earth diameters (the middle of the 20–30 range).
 * Earth's orbit is 820, so that photosphere (radius 748) stops short of Earth.
 * The Moon is 0.27 of Earth's diameter. Zoomed out, planets and moons keep
 * at least `MIN_BODY_PX` on screen. Zoomed in, the disc is the game-scale size.
 */
export const SUN_EARTH_DIAMETERS = 22;
export const MOON_EARTH_FRACTION = 0.27;
/** CSS pixels. A disc this wide stays visible when the chart is zoomed out. */
export const MIN_BODY_PX = 8;

export function isSolChart(bodies: readonly Body[]): boolean {
  return bodies.some((body) => body.id === "sun" && body.look === "sol-sun");
}

/** Game-scale visual radius in world units, before the zoom floor. */
export function solGameVisualRadius(body: Body, earthRadius: number): number {
  if (!(earthRadius > 0)) return body.radius;
  if (body.id === "sun") return SUN_EARTH_DIAMETERS * earthRadius;
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
