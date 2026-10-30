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
   * Chemical plume. design/assets/ship/plume-states.svg header.
   * Length is design units: L = min(lengthMax, lengthBase + lengthPerDv * |Δv|).
   * There is no bloom halo. The burn itself stays one sim step.
   */
  plume: {
    lengthBase: 44,
    lengthPerDv: 12,
    lengthMax: 110,
    widthBase: 6.5,
    widthPerLength: 1 / 40,
    /** t where the bell starts, and the bell exponent. */
    shoulder: 0.25,
    bell: 1.4,
    rag: 0.12,
    ragCycles: [5, 8, 11],
    /** Three shapes in this many seconds. Phases are cosmetic (frame time). */
    ragPeriod: 0.33,
    coreLength: 0.42,
    coreWidth: 0.38,
    /** Tail-off soft edge, as a fraction of L. */
    tailSoft: 0.15,
    /** Ignition, sim seconds. The plume grows to L and the flash ring plays. */
    ignite: 0.12,
    flashRadius0: 4,
    flashRadius1: 13,
    flashWidth: 1.2,
    /** Wind-up lick, design units. */
    lickLength: 16,
    lickWidth: 4.2,
    glowRy: 1.2,
    glowRx0: 1.5,
    glowRx1: 4.6,
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
    /**
     * Quad the dot is drawn into. Must cover 2 × (dotRadiusPx + dotSoftPx).
     * design/assets/predicted-path.svg header: round dots r 1.5 every 10 px.
     */
    dotSpanPx: 5,
    /**
     * Screen-px radius at the middle of the antialiased edge.
     * design/assets/predicted-path.svg header and style.md `path`: r 1.5.
     * The previous discs faded out near 2.85 px and read as a chalk stroke.
     */
    dotRadiusPx: 1.5,
    /** Half-width of the one-pixel edge, in screen px. */
    dotSoftPx: 0.4,
    /** design/style.md `path`: α 0.7 for the first 80 %, 0.35 for the last 20 %. */
    sureAlpha: 0.7,
    dimAlpha: 0.35,
    dimAfter: 0.8,
    /**
     * Extra alpha where the clock slows. Kept small so a deep well does not
     * push the dots back up to a solid stroke. The colour mix toward
     * `starCorona` is unchanged.
     */
    glowLift: 0.12,
    /** Ceiling for that lift. Gold recharge dots stay at α 1 (style.md solar path). */
    alphaCap: 0.82,
    /**
     * Thin solid planning stroke, in screen px. The dotted header
     * (r 1.5 every 10 px) is replaced by this line: bright at the ship,
     * transparent at the end. The centreline is still the predicted samples.
     */
    lineHalfPx: 0.8,
    lineSoftPx: 0.45,
    /** α at the ship. Falls as (1 − u²) along the screen arc, 0 at the end. */
    headAlpha: 0.92,
    /** Flight-time marks. Sim seconds from the ship, not a screen spacing. */
    tickSeconds: 10,
    /** Short cross-bar. Long enough to read at the framed chart, still a tick. */
    tickHalfLength: 4.8,
    tickHalfWidth: 0.5,
    tickSoftPx: 0.35,
    tickAlpha: 0.72,
    /** Room for every predicted sample. Current levels stay under 9000 steps. */
    maxSamples: 12000,
    endRingInner: 5.25,
    endRingOuter: 6.75,
    endRingAlpha: 0.5,
    orbitAlpha: 0.7,
  },
  /**
   * Burn node, screen pixels. design/assets/burn-node.svg header.
   * The arrow geometry is the existing drag arrow.
   */
  nodes: {
    markerRadius: 5,
    ringWidth: 2,
    coreRadius: 1.7,
    selectedRadius: 6.5,
    selectedOuter: 9.5,
    selectedOuterWidth: 1,
    selectedOuterAlpha: 0.55,
    handleRadius: 4,
    ghostAlpha: 0.3,
    ghostDash: 3,
    ghostGap: 3,
    windupRadius: 9,
    windupWidth: 2,
    /** Ignition flash, sim seconds, then the node is the fired ring. */
    ignite: 0.4,
    igniteRadius0: 6,
    igniteRadius1: 18,
    igniteWidth: 1.5,
    firedAlpha: 0.45,
    firedWidth: 1.5,
    firedDash: 2,
    firedGap: 2,
    /** Delete button centre, screen pixels from the node. */
    deleteX: 13,
    deleteY: 11,
    deleteRadius: 6,
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
    /** Deepest well, as a fraction of the system's longer side. H in the sheet header. */
    amplitude: 0.22,
    /** Sheet glass alpha. design/assets/overlays/gravity-sheet.svg. */
    sheetAlpha: 0.55,
    /**
     * Grid ink. design/assets/overlays/gravity-grid.svg and gravity-sheet.svg.
     * The warp stays the sampled potential. These numbers only colour it.
     */
    inkGamma: 2.2,
    inkRamp: 1.05,
    inkAlpha: 0.16,
    inkAlphaDepth: 0.62,
    inkMajorAlpha: 0.1,
    inkMajorEvery: 4,
    inkMinorPx: 0.75,
    inkMajorPx: 1,
    inkEdgePx: 70,
    inkBodyGapPx: 3,
    sheetLineAlpha: 0.18,
    sheetLineDepth: 0.7,
    sheetLinePx: 0.7,
    sheetDepthExp: 1.3,
    sheetFadeCells: 5,
    tidalAlpha: 0.8,
    tidalPx: 1,
    tidalDash: 4,
    tidalGap: 4,
    tidalCrawl: 8,
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
  /**
   * Scripted collisions. Numbers are the headers in design/assets/events/.
   * Distances are world units (SVG units at zoom 1). Strokes are CSS pixels.
   */
  event: {
    /** impact.svg: flash r 4 → 34 over 0.6 s, gone by 0.9 s. */
    flashR0: 4,
    flashR1: 34,
    flashGrow: 0.6,
    flashFade: 0.9,
    /** Shock ring r 6 → 80 over 1.3 s, 1.6 px. */
    shockR0: 6,
    shockR1: 80,
    shockDur: 1.3,
    shockWidth: 1.6,
    /** Rim flash 2 px, α 0.7, decaying over 1.8 s. */
    rimWidth: 2,
    rimAlpha: 0.7,
    rimDur: 1.8,
    /** 20 grains, ±35°, 40–120 px, 2.7 s, radii 1–2.2. */
    ejectaCount: 20,
    ejectaCone: 35,
    ejectaDist0: 40,
    ejectaDist1: 120,
    ejectaDur: 2.7,
    ejectaR0: 1,
    ejectaR1: 2.2,
    /** Crater r 9. α 1 → 0.6 at 2 s → 0 at 3.6 s. */
    craterR: 9,
    craterDur: 3.6,
    craterMid: 2,
    craterMidAlpha: 0.6,
    /** burn-up.svg: glow circle r 9.5 on a planet of r 8. Tail 90, flicker 0.4 s. */
    glowScale: 9.5 / 8,
    /** Hotspot sits 0.35 of the bbox below centre; gradient radius is 0.6 of the bbox. */
    glowHot: (0.85 - 0.5) * 2 * (8 / 9.5),
    glowGrad: 1.2,
    tailLength: 90,
    tailFlicker: 0.4,
    /** Plunge flash r 5 → 26 over 0.55 s. The sample fades it by 0.8 s. */
    plungeR0: 5,
    plungeR1: 26,
    plungeGrow: 0.55,
    plungeFade: 0.8,
    /** Ripple r 4 → 70 over 1.8 s, 1.4 px, α 0.9, clipped to the star. */
    rippleR0: 4,
    rippleR1: 70,
    rippleDur: 1.8,
    rippleWidth: 1.4,
    rippleAlpha: 0.9,
    /** Star brightening #FFE7A0 α 0.22, up in 0.24 s, gone at 1.6 s. */
    brightAlpha: 0.22,
    brightRise: 0.24,
    brightDur: 1.6,
    /** Decaying spiral, dash 4 5, α 0.55, 1 px. */
    spiralAlpha: 0.55,
    spiralDash: 4,
    spiralGap: 5,
    spiralWidth: 1,
    /** event-telegraphs.svg. */
    courseWidth: 1.4,
    courseDash: 5,
    courseGap: 5,
    courseCrawl: 13,
    reticleR0: 9,
    reticleR1: 12,
    reticlePeriod: 1.2,
    reticleWidth: 1.4,
    reticleTick0: 6,
    reticleTick1: 14,
    /** Chip: 16 px, radius 5, 10.5 px mono, pad 6, fill α 0.88, stroke α 0.7. */
    chipHeight: 16,
    chipPad: 6,
    chipFont: 10.5,
    chipRadius: 5,
    chipFill: 0.88,
    chipStroke: 0.7,
    /** debris-field.svg. */
    chunkCount: 22,
    chunkR0: 2.5,
    chunkR1: 7.5,
    dustCount: 48,
    dustHot: 0.15,
    bandAlpha: 0.05,
    bandWidth: 70,
    hazardAlpha: 0.75,
    hazardDash: 5,
    hazardGap: 5,
    hazardCrawl: 10,
    hazardWidth: 1,
    solidRadius: 4,
    driftPx0: 4,
    driftPx1: 10,
    driftPeriod0: 14,
    driftPeriod1: 22,
    /** Longest chunk drift. The "gap narrows" chip counts down to this. */
    gapClose: 22,
    /** event-telegraphs.svg sample: "debris from 0:42 for 1:30". */
    debrisForecast: 90,
    nextAlpha: 0.7,
    nextDash: 3,
    nextGap: 5,
    nextWidth: 1,
    /** showcase mockup arrival ring: body 1.2 px dash 4 4 α 0.75; capture 1 px dash 6 6 α 0.35. */
    arrivalWidth: 1.2,
    arrivalDash: 4,
    arrivalGap: 4,
    arrivalAlpha: 0.75,
    captureWidth: 1,
    captureDash: 6,
    captureGap: 6,
    captureAlpha: 0.35,
  },
  /**
   * design/assets/bodies/supernova-progenitor.svg and events/supernova-*.svg.
   * style.md §16. The sample star is drawn at scale 0.38 of photosphere r 120,
   * so shell radii are measured against 45.6 px.
   */
  nova: {
    /** Header keyTimes 0 .2 .45 .8 1 over 5.5 s. Scales are the sample's, divided by 0.38 in code. */
    breathePeriod: 5.5,
    /** Last 0.5 s: sample scale 0.38 → 0.30, then the star is gone. */
    shrinkLead: 0.5,
    shrinkTo: 0.3 / 0.38,
    /** Sample shell radii 120, 150, 182 and +14 px / 12 s, against the drawn star. */
    sampleStar: 0.38 * 120,
    shellRadii: [120, 150, 182],
    shellAlphas: [0.32, 0.22, 0.14],
    shellDrift: 14,
    shellPeriod: 12,
    shellWidth: 1.2,
    /** Lethal ring: #FF5A5F α 0.85, 1.2 px, dash 5 5, crawl 10 px/s. */
    blastAlpha: 0.85,
    blastDash: 5,
    blastGap: 5,
    blastCrawl: 10,
    blastWidth: 1.2,
    /** Countdown arc r 62 in the sample, 3 px, track #FFFFFF α 0.12. */
    arcSample: 62,
    arcWidth: 3,
    arcTrack: 0.12,
    /** Flash peaks at 1.2 × blast by +0.85 s. Sample radii 10 → 260 → 300. Alpha 1 → 0.6 → 0 by +2.6 s. */
    flashPeak: 1.2,
    flashGrow: 0.85,
    flashEnd: 2.6,
    flashR0: 10,
    flashRPeak: 260,
    flashREnd: 300,
    flashRise: 0.16,
    flashMid: 1,
    flashMidAlpha: 0.6,
    /** Shock ring 2 px while the flash plays, then 1.4 px. Sits on shellRadius. */
    shockWidthDet: 2,
    shockWidthRem: 1.4,
    filamentDet: 46,
    filamentRem: 240,
    filamentJitter: 0.12,
    filamentFade: 40,
    filamentLenDet0: 6,
    filamentLenDet1: 16,
    filamentLenRem0: 4,
    filamentLenRem1: 12,
    filamentWidthDet: 1.4,
    filamentWidthRem0: 0.7,
    filamentWidthRem1: 1.6,
    remnantAlpha0: 0.35,
    remnantAlpha1: 0.85,
    /** threejs-notes.md §19: haze at 0.8 × the shock. */
    hazeScale: 0.8,
    /** Neutron-star dot r 3. Beams to r 30, one turn per 2 s. */
    pulsarR: 3,
    pulsarBeam: 30,
    pulsarPeriod: 2,
    /** Forecast rings +20 s and +40 s, dash 4 6, α 0.7 and 0.5. */
    forecastA: 20,
    forecastB: 40,
    forecastDash: 4,
    forecastGap: 6,
    forecastAlphaA: 0.7,
    forecastAlphaB: 0.5,
    forecastWidth: 1,
  },
  /**
   * design/assets/bodies/quasar.svg. Shadow r 9 in the sample.
   * Glow r 90 (10×). Disk rx 44, ry 13. Jets from 1.5× the shadow.
   */
  quasar: {
    glowScale: 90 / 9,
    diskRx: 44 / 9,
    diskRy: 13 / 9,
    jetStart: 1.5,
    /** Blue body is 0.45 of the lethal half-width. Core is 2.5 px out to 0.6 reach. */
    bodyFraction: 0.45,
    coreWidth: 2.5,
    coreReach: 0.6,
    knotPeriod: 2.4,
    knotCount: 3,
    knotRx: 6,
    knotRy: 2.6,
    knotAlpha: 0.85,
    rimWidth: 1.2,
    /** Planning sweep: event.warn α 0.7, dash 5 5. */
    sweepAlpha: 0.7,
    sweepDash: 5,
    sweepGap: 5,
    sweepWidth: 1,
  },
  /** design/assets/bodies/stray-asteroid.svg. Rock r 15, trail 140 px, tumble 55–90 s. */
  stray: {
    sampleRadius: 15,
    trail: 140,
    specks: 40,
    tumbleMin: 55,
    tumbleMax: 90,
    arrowDash: 4,
    arrowGap: 5,
    arrowWidth: 1.2,
    arrowAlpha: 0.85,
  },
} as const;

export type Theme = typeof theme;
