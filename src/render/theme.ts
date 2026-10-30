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
import moonUrl from "../../design/assets/bodies/moon.svg?url";
import moonIcyUrl from "../../design/assets/bodies/moon-icy.svg?url";
import moonVolcanicUrl from "../../design/assets/bodies/moon-volcanic.svg?url";
import dwarfUrl from "../../design/assets/bodies/dwarf.svg?url";
import moonChainUrl from "../../design/assets/bodies/moon-chain.svg?url";
import hullBaseUrl from "../../design/assets/ship/hull-base.svg?url";
import platingUrl from "../../design/assets/ship/module-plating.svg?url";
import solarUrl from "../../design/assets/ship/module-solar.svg?url";
import tanksUrl from "../../design/assets/ship/module-tanks.svg?url";
import cryoUrl from "../../design/assets/ship/module-cryo.svg?url";
import scoopUrl from "../../design/assets/ship/module-scoop.svg?url";
import sensorsUrl from "../../design/assets/ship/module-sensors.svg?url";
import shieldUrl from "../../design/assets/ship/module-shield.svg?url";
import engineChemicalUrl from "../../design/assets/ship/engine-chemical.svg?url";
import engineIonUrl from "../../design/assets/ship/engine-ion.svg?url";
import enginePulseUrl from "../../design/assets/ship/engine-pulse.svg?url";
import damage75Url from "../../design/assets/ship/damage-75.svg?url";
import damage45Url from "../../design/assets/ship/damage-45.svg?url";
import damage15Url from "../../design/assets/ship/damage-15.svg?url";
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
import rogueUrl from "../../design/assets/bodies/rogue-planet.svg?url";
import radiationUrl from "../../design/assets/overlays/radiation-map.svg?url";
import beltSparseUrl from "../../design/assets/space/belt-sparse.svg?url";
import beltMediumUrl from "../../design/assets/space/belt-medium.svg?url";
import beltDenseUrl from "../../design/assets/space/belt-dense.svg?url";
import kuiperUrl from "../../design/assets/space/kuiper-belt.svg?url";
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
    moon: moonUrl,
    moonIcy: moonIcyUrl,
    moonVolcanic: moonVolcanicUrl,
    dwarf: dwarfUrl,
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
    rogue: rogueUrl,
    radiation: radiationUrl,
    beltSparse: beltSparseUrl,
    beltMedium: beltMediumUrl,
    beltDense: beltDenseUrl,
    kuiper: kuiperUrl,
    starfield: starfieldUrl,
    predictedPath: predictedPathUrl,
    dragArrow: dragArrowUrl,
    hull: hullBaseUrl,
    plating: platingUrl,
    solar: solarUrl,
    tanks: tanksUrl,
    cryo: cryoUrl,
    scoop: scoopUrl,
    sensors: sensorsUrl,
    shield: shieldUrl,
    engineChemical: engineChemicalUrl,
    engineIon: engineIonUrl,
    enginePulse: enginePulseUrl,
    damage75: damage75Url,
    damage45: damage45Url,
    damage15: damage15Url,
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
    /** Nose-to-tail length in the shared 96×160 frame. 22 px at zoom 1. */
    hullUnits: 48.6,
    frameWidth: 96,
    frameHeight: 160,
    headingLerp: 0.18,
    /**
     * PlaneGeometry(96, 160) is centred on the frame middle (48, 80).
     * The ship centre is (48, 64). Shift the geometry so the sim position
     * is the ship centre. design/assets/ship/hull-base.svg header.
     */
    frameShift: -16,
    /** Chemical throat, engine-chemical.svg local y 28.2, nose +Y. */
    nozzle: -28.2,
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
  /**
   * Cosmetic timings from the megastructure headers.
   * Lengths the sim uses live in `src/sim/mega.ts`, scaled by star radius.
   */
  mega: {
    /** stellar-engine.svg: three ragged shapes, one every 0.5 s. */
    jetRagPeriod: 0.5,
    jetRagShapes: 3,
    /** Knots cross the jet every 4 s. The SVG staggers them by 1.3 s and 2.6 s. */
    knotPeriod: 4,
    knotDelays: [0, 1.3, 2.6],
    knotAlong0: 34,
    knotAlong1: 300,
    /** dyson-swarm.svg: 10 dash cycles in 26 / 40 / 60 s. Inner shell is faster. */
    shellPeriods: [26, 40, 60],
    shellDash: [3, 2.6, 3.2],
    shellGap: [7, 8, 9],
    shellGlint: 1.2,
    heatPeakAlpha: 0.16,
    /** shkadov-thruster.svg: 11 rays across ±35°, centre ray 2.2 px, edge rays 0.95 px. */
    rayCount: 11,
    rayHalfDeg: 35,
    rayWidth0: 2.2,
    rayWidth1: 0.95,
    rayAlpha: 0.8,
    glowAlpha: 0.35,
    glowWidth: 5,
    glowRadius: 78,
    strutCount: 9,
    strutLength: 6,
    /** ringworld.svg: floor strips drift 60 px per 120 s. Five shadow squares orbit in 40 s. */
    ringScrollPeriod: 120,
    ringScrollPx: 60,
    ringShadowPeriod: 40,
    ringShadowCount: 5,
    /** space-elevator.svg: climbers ride up in 12 s and down in 9 s. */
    climberUp: 12,
    climberDown: 9,
    /** wormhole.svg: the sky turns 360° in 120 s. */
    wormholePeriod: 120,
    wormholeArcCount: 7,
  },
} as const;

export type Theme = typeof theme;
