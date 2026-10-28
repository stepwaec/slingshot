import shipUrl from "../../design/assets/ship.svg?url";
import shipThrustUrl from "../../design/assets/ship-thrust.svg?url";
import planetStartUrl from "../../design/assets/planet-start.svg?url";
import planetXUrl from "../../design/assets/planet-x.svg?url";
import starUrl from "../../design/assets/star.svg?url";
import starfieldUrl from "../../design/assets/starfield.svg?url";
import trailUrl from "../../design/assets/trail.svg?url";
import predictedPathUrl from "../../design/assets/predicted-path.svg?url";
import dragArrowUrl from "../../design/assets/drag-arrow.svg?url";
import { palette } from "./palette";

/**
 * Everything a visual factory is allowed to read for look and assets.
 * Recolor or point a slot at a new file here. To change how a slot is
 * drawn (shader disc, texture, glTF), replace that one factory in
 * `visuals/index.ts`. The sim does not import this module.
 */
export const theme = {
  assets: {
    ship: shipUrl,
    shipThrust: shipThrustUrl,
    planetStart: planetStartUrl,
    planetX: planetXUrl,
    star: starUrl,
    starfield: starfieldUrl,
    trail: trailUrl,
    predictedPath: predictedPathUrl,
    dragArrow: dragArrowUrl,
  },
  colors: palette,
  starfield: {
    seed: 0x514e47,
    referenceWidth: 1440,
    referenceHeight: 900,
    vignetteRadius: 900,
    sparkles: 4,
    layers: [
      { color: palette.starsFar, radius: 0.6, alpha: 0.35, count: 420 },
      { color: palette.starsMid, radius: 0.9, alpha: 0.6, count: 160 },
      { color: palette.starsNear, radius: 1.3, alpha: 0.9, count: 45 },
    ],
  },
  star: {
    /** ± scale of the whole sprite. */
    breathe: 0.03,
    periodMs: 6000,
    /** star.svg sprite space: body 46, corona 130, glow 200, canvas 400. */
    span: 400,
    bodyRadius: 46,
    coronaRadius: 130,
    glowRadius: 200,
  },
  planet: {
    lightOffset: 0.5,
    gradientRadius: 1.25,
    haloScale: 1.8,
    limbAlphaHome: 0.16,
    limbAlphaTarget: 0.18,
    ringPulseMs: 2400,
    ringAlphaMin: 0.35,
    ringAlphaMax: 0.7,
    ringPulsePx: 2,
    ringDashPeriodPx: 12,
    ringCrawlPxPerSec: 12,
    ringLockedAlpha: 1,
  },
  ship: {
    lengthAtZoom1: 22,
    minPx: 12,
    hullUnits: 19,
    headingLerp: 0.18,
    /** Polygons from ship.svg, SVG y-down, nose at y = 2. */
    hull: [12, 2, 18.5, 21, 12, 16.5, 5.5, 21],
    finL: [8.2, 12.5, 4, 19.2, 7, 19.6],
    finR: [15.8, 12.5, 20, 19.2, 17, 19.6],
    cockpit: { x: 0, y: 2.5, w: 1.6, h: 4 },
  },
  thrust: {
    outerHalfWidth: 5,
    coreHalfWidth: 2.6,
    base: -5.5,
    outerLength: 21.5,
    coreLength: 14,
    outerAlpha: 0.9,
  },
  burst: { frames: 12 },
  trail: { samples: 240, widthPx: 2 },
  path: {
    spacingPx: 10,
    maxDots: 400,
    /** Quad the dot is drawn into; the visible radius stays ~1.5 px. */
    dotSpanPx: 5,
    sureAlpha: 0.7,
    dimAlpha: 0.35,
    dimAfter: 0.8,
    endRingInner: 5.25,
    endRingOuter: 6.75,
    endRingAlpha: 0.5,
    orbitAlpha: 0.7,
  },
  nodes: {
    markerRadius: 4,
    selectedRadius: 5.5,
    strokePad: 1.4,
    headLength: 16,
    headHalfWidth: 6,
    shaftWidth: 2,
    shaftAlpha: 0.9,
  },
} as const;

export type Theme = typeof theme;
