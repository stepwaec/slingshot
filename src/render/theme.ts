import shipUrl from "../../design/assets/ship.svg?url";
import shipThrustUrl from "../../design/assets/ship-thrust.svg?url";
import planetStartUrl from "../../design/assets/planet-start.svg?url";
import planetXUrl from "../../design/assets/planet-x.svg?url";
import starUrl from "../../design/assets/star.svg?url";
import starfieldUrl from "../../design/assets/starfield.svg?url";
import predictedPathUrl from "../../design/assets/predicted-path.svg?url";
import dragArrowUrl from "../../design/assets/drag-arrow.svg?url";
import binaryStarUrl from "../../design/assets/bodies/binary-star.svg?url";
import redGiantUrl from "../../design/assets/bodies/red-giant.svg?url";
import whiteDwarfUrl from "../../design/assets/bodies/white-dwarf.svg?url";
import gasBandedUrl from "../../design/assets/bodies/gas-banded.svg?url";
import moonChainUrl from "../../design/assets/bodies/moon-chain.svg?url";
import neutronStarUrl from "../../design/assets/bodies/neutron-star.svg?url";
import pulsarUrl from "../../design/assets/bodies/pulsar.svg?url";
import magnetarUrl from "../../design/assets/bodies/magnetar.svg?url";
import blackHoleUrl from "../../design/assets/bodies/black-hole.svg?url";
import magnetismUrl from "../../design/assets/overlays/magnetism-heatmap.svg?url";
import cometUrl from "../../design/assets/bodies/comet.svg?url";
import solarRechargeUrl from "../../design/assets/solar-recharge.svg?url";
import nebulaEmissionUrl from "../../design/assets/space/nebula-emission.svg?url";
import nebulaReflectionUrl from "../../design/assets/space/nebula-reflection.svg?url";
import nebulaDarkUrl from "../../design/assets/space/nebula-dark.svg?url";
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
    binaryStar: binaryStarUrl,
    redGiant: redGiantUrl,
    whiteDwarf: whiteDwarfUrl,
    gasGiant: gasBandedUrl,
    moonChain: moonChainUrl,
    neutronStar: neutronStarUrl,
    pulsar: pulsarUrl,
    magnetar: magnetarUrl,
    blackHole: blackHoleUrl,
    magnetism: magnetismUrl,
    comet: cometUrl,
    solarRecharge: solarRechargeUrl,
    nebulaEmission: nebulaEmissionUrl,
    nebulaReflection: nebulaReflectionUrl,
    nebulaDark: nebulaDarkUrl,
    starfield: starfieldUrl,
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
  /**
   * Exhaust plume, in the ship's local space (nose is +Y).
   * The hull tail tips sit at local y = -9, so `nozzle` is just aft of them
   * and the plume only extends further aft. Sizes are ship units; colours are sRGB.
   */
  thrust: {
    nozzle: -9.6,
    length: 40,
    /** Widest half-width. The shader keeps the root narrower than the tail tips. */
    halfWidth: 6.8,
    /** Soft halo drawn behind the plume, scaled from the same nozzle. */
    bloomScale: 1.45,
    /** 0..1 raggedness of the edge and the density. */
    turbulence: 0.42,
    core: "#F7FBFF",
    edge: "#A06BFF",
    bloom: "#7A4AD8",
  },
  /**
   * Burn animation, in seconds of sim time (`step * dt`).
   * Wind-up is the same for every node. The plume stays lit for
   * `min(tailMax, tailBase + tailPerDv * |dv|)` after the burn.
   * Speed, slow motion, and pause do not scale these.
   * The sim does not read this.
   */
  burn: {
    windup: 0.5,
    /** Shortest plume, used for a zero-size burn. */
    tailBase: 1.15,
    /** Extra sim seconds of plume per unit of delta-v. */
    tailPerDv: 0.16,
    /** Longest plume, for a departure or capture burn. */
    tailMax: 4.2,
    /** Flicker cycles per sim second while the engine spools up. */
    flickerHz: 9,
    /** Node-marker pulse cycles per sim second during the wind-up. */
    pulseHz: 3.5,
  },
  burst: { frames: 12 },
  path: {
    spacingPx: 10,
    maxDots: 400,
    /** Quad the dot is drawn into. The visible radius is ~2.4 px, still a dot at the 10 px spacing. */
    dotSpanPx: 8,
    sureAlpha: 0.95,
    dimAlpha: 0.62,
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
  /** Decorative sky around every level. Not part of the simulation. */
  scenery: {
    asteroidCount: 40,
    wreckCount: 12,
    nebulaSpan: 1100,
  },
  gravity: {
    /** Even samples across the framed chart. The flat view draws every `flatStride` line. */
    cols: 48,
    rows: 48,
    flatStride: 1,
    /** Extra framed world beyond the view, so the sheet edge stays off-screen. */
    viewPad: 0.08,
    /** Deepest well, as a fraction of the system's longer side. */
    amplitude: 0.22,
    sheetAlpha: 0.9,
    /** Rest-frame dτ/dt contours drawn over the flat grid. */
    clockLevels: [0.92, 0.75, 0.5, 0.25],
  },
} as const;

export type Theme = typeof theme;
