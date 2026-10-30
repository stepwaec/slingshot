# Shader specs — Rendering v2

The numbers for the GPU-drawn bodies in Rendering v2 (`docs/ROADMAP.md`, R2.0–R2.5). Each family has a **reference shader** in `design/shaders/` and a live comparison in `design/preview/shaders.html`: the approved SVG on the left, the reference shader on the right, at 1.5×. The game's shaders must match the right-hand column. The values in this file and in the preview come from one table, so they cannot drift apart. Physics, gameplay and the prediction stay untouched.

Status: **R2.0 conventions and R2.1 stars** are specified. Rocky planets (R2.2), gas giants (R2.3), compact objects (R2.4) and effects (R2.5) follow as their own sections.

## 1. Conventions (R2.0)

- **One impostor quad per body**, centred on `bodyPose`, sized to the body's largest extent: for a star, 2 × `hazeR` × r. The fragment works in **body radii**: `uv = (fragCoord − centre) / (r · zoom · DPR)`, with y up.
- **Units** carried over from the SVGs:
  - A noise **frequency** is per body radius: shader frequency = the SVG `baseFrequency` × the body radius in px at zoom 1. For a ring, use the ring's radius. (The first calibration used the diameter and came out twice as fine.)
  - A **displacement** in radii = the SVG `feDisplacementMap` scale / (2 r).
  - **Gains:** SVG filters are higher-contrast than raw noise. `uNoiseGain` (default 1.6) scales the ring noise, and `uFilGain` (default 0.66) maps the turbulence onto the SVG veins.
  - **Angles:** an SVG angle runs clockwise (screen y down). Negate it in a y-up shader (the prominence table does).
- **Shared uniforms:**
  - `uTime`: `frame.now` in seconds. All cosmetic motion uses it: flows, boiling, ring spin, breathe, prominences, the flare.
  - `uSimTime`: sim seconds, for anything that is a hazard (pulsar beams, jets, scripted events).
  - `uLightDir`: unit vector from the body toward the brightest star, for lit bodies (R2.2+). Stars are emissive and ignore it.
  - `uZoom`, `uDPR`: pixel widths, so strokes stay px-crisp at any zoom.
- **Noise:** 3D simplex (Gustavson / Ashima), as in `star.frag`.
  - `fbm`: 5 octaves, lacunarity 2.02, gain 0.5, mapped to 0–1 with mean 0.5 (the SVG `fractalNoise`).
  - `turb`: the sum of |noise| over 5 octaves (the SVG `turbulence`).
  - A sphere surface samples the noise at the 3D point on the unit sphere, so features foreshorten toward the limb and a flow reads as rotation.
- **Colour:** write the sRGB hex values straight out (`srgb01`), with no tone mapping. Output is **premultiplied** alpha; blend `ONE, ONE_MINUS_SRC_ALPHA`. Ramps use the SVG stop offsets exactly.
- **Crisp edges:** one-pixel `smoothstep` widths from the pixel size (1 / (r · zoom · DPR)), never wider. The rules in `IMPLEMENTING.md` hold: no blur, no grey, no brown from low-alpha warm colours.
- **Level of detail:**
  - Below a body radius of 6 px: 3 octaves, and no prominences or faculae.
  - Above 25 % of the screen: bake the flame and wisp rings into 2–3 rotating frames (`threejs-notes.md` §9).
  - Budget: a star at most 1.5 ms at full detail, under 0.1 ms with baked rings.
- **Fallback:** a `rendering.shaders` flag. When it is false, draw the current SVG sprites. Every family ships behind it until its side-by-side passes.
- **Acceptance per sub-package:** a screenshot of the game next to `preview/shaders.html` at the same zoom and the same frozen time (`?t=`), plus an fps check in Safari and Chrome.

## 2. Stars (R2.1)

Reference shader: `design/shaders/star.frag`. Covers the sun (`star.svg`, variant J), the Sol sun (`sol/sun.svg`), the red dwarf, blue giant, binary pair, white dwarf and red giant. A binary is two quads, one per star; a red giant's drag atmosphere stays its own overlay.

**Layers, back to front:**
1. **Haze:** stops 0 α 0.6, 0.23 α 0.52, 0.33 α 0.3, 0.55 α 0.15, 0.8 α 0.06, 1 α 0, as fractions of `hazeR`.
2. **Wisp ring:** a radial ramp to `wiR`, displaced by noise on the ring and turning with `wiSpin`.
3. **Flame ring:** a ramp to `flR` with stops 0.74, 0.82, 0.91 and 1, displaced and turning the other way.

   Layers 1–3 breathe by ±`breathe` over `breatheT`. The disc never breathes, so the crash radius never moves.
4. **Prominences:** three loops footed on the limb, at −147.5°, −243.6° and −314.8°.
   - Heights 0.34, 0.38 and 0.47 radii; half-widths 0.20, 0.24 and 0.185.
   - Periods 12, 16 and 14 s, starting at 0, 5 and 9 s.
   - Each swells 0.6 → 1 → 0.6 and fades with sin².
   - Two-tone strokes: an outer stroke `proW` px and a core 0.36 of that.
5. **Disc,** a sphere:
   - the body ramp
   - deep plasma (`3.0 n − 1.55`) and dark plasma (`3.4 n − 1.6`), flowing at `deepFlow` and `darkFlow`
   - three boiling granulation seeds, each 0 → 0.9 → 0.9 → 0 over `boil` (keyTimes 0, 0.33, 0.55, 1), veins at `1.25 − 6.5 · turb · filGain`
   - faculae near the limb
   - spots
   - limb darkening, then the approved bright rim on top (0.80 α 0, 0.93 `limbA` α 0.55, 0.97 `limbB` α 0.9, 1 white α 0.95)
   - the edge wobbled by ±`wobble`
6. **Ragged rim:** a 1.6 px stroke in `limbB`.
7. **Flare:** a wedge at 25° from 1 to 1.87 radii, one flash per 22 s (off until 13 s, peak at 13.9 s, off at 14.8 s).

White-dwarf mode (`smooth` = 1) replaces layers 1–7 with:
- a smooth ramp
- a hard two-tone limb
- a glow to 6.25 radii, breathing ±5 % over 4 s
- four spikes to 4 radii
- a tight bloom to 1.4 radii

**Parameters:**

| Parameter | Uniform | Meaning | The sun (variant J) | The Sol sun | Red dwarf | Blue giant | Binary star A | Binary star B | White dwarf | Red giant |
|---|---|---|---|---|---|---|---|---|---|---|
| `R` | `uR (× zoom)` | body radius, px at zoom 1 = crash radius | 46 | 46 | 40 | 54 | 30 | 20 | 16 | 120 |
| `core` | `uCore` | photosphere ramp at r 0 | `#FFB43A` | `#FFB43A` | `#FF8A4A` | `#EAF1FF` | `#FFE7A0` | `#FF9A3A` | `#FFFFFF` | `#FF8A42` |
| `mid` | `uMid` | ramp at r 0.65 | `#FF8F1F` | `#FF8F1F` | `#F0502A` | `#A6C0FF` | `#FFC24A` | `#FF7426` | `#F2F5FC` | `#F0602C` |
| `edge` | `uEdge` | ramp at r 1 | `#FF7A14` | `#FF7A14` | `#D63A1E` | `#7FA3FF` | `#FF9A2A` | `#E85A1A` | `#9FC2FF` | `#C8401E` |
| `deep` | `uDeep` | deep plasma colour | `#A03308` | `#A03308` | `#7A1A08` | `#3A6AF0` | `#A03308` | `#A03308` | `#A03308` | `#8A2A0C` |
| `deepAmt` | `uDeepAmt` | its strength | 0.28 | 0.28 | 0.3 | 0.25 | 0.28 | 0.28 | 0.28 | 0.3 |
| `deepFreq` | `uDeepFreq` | its frequency (per radius) | 1.6 | 1.6 | 1 | 2.5 | 1.05 | 0.7 | 1.6 | 2 |
| `deepFlow` | `uDeepFlow` | its flow, rad/s about the vertical (west → east +) | 0.0143 | 0.0143 | 0.01 | 0.0143 | 0.0143 | 0.0143 | 0.0143 | 0.006 |
| `dark` | `uDark` | dark plasma colour | `#802105` | `#802105` | `#4A0A06` | `#2F5BD8` | `#A0460E` | `#6A1606` | `#802105` | `#5A1406` |
| `darkAmt` | `uDarkAmt` | its strength | 0.55 | 0.55 | 0.55 | 0.45 | 0.55 | 0.55 | 0.55 | 0.55 |
| `darkFreq` | `uDarkFreq` | its frequency | 2.3 | 2.3 | 1.3 | 4.3 | 1.5 | 1 | 2.3 | 3.1 |
| `darkFlow` | `uDarkFlow` | its flow (the other way) | -0.0222 | -0.0222 | -0.015 | -0.0222 | -0.0222 | -0.0222 | -0.0222 | -0.009 |
| `fil` | `uFil` | granulation veins colour | `#FFE7A0` | `#FFE7A0` | `#FFB27A` | `#F4F8FF` | `#FFFDF0` | `#FFC27A` | `#FFE7A0` | `#FFB27A` |
| `filAmt` | `uFilAmt` | their strength | 0.8 | 0.8 | 0.68 | 0.85 | 0.8 | 0.8 | 0.8 | 0.62 |
| `filFreq` | `uFilFreq` | their frequency | 2.75 | 2.75 | 2 | 5.4 | 1.8 | 1.2 | 2.75 | 3.85 |
| `filGain` | `uFilGain` | turbulence → SVG range | 0.66 | 0.66 | 0.66 | 0.66 | 0.66 | 0.66 | 0.66 | 0.66 |
| `boil` | `uBoil` | boil cycle, s (three seeds, a third apart) | 9 | 9 | 11 | 7 | 9 | 9 | 9 | 14 |
| `limbDark` | `uLimbDark` | I(μ) = 1 − k(1 − μ) | 0.18 | 0.18 | 0.18 | 0.18 | 0.18 | 0.18 | 0.18 | 0.18 |
| `limbA` | `uLimbA` | bright rim, 0.93 | `#FFD27A` | `#FFD27A` | `#FF9A62` | `#CFE0FF` | `#FFE7A0` | `#FFB27A` | `#7FB8FF` | `#FF9A62` |
| `limbB` | `uLimbB` | bright rim, 0.97 and the rim stroke | `#FFF1C2` | `#FFF1C2` | `#FFD9B0` | `#F4F8FF` | `#FFFDF0` | `#FFD8B0` | `#FFFFFF` | `#FFC8A0` |
| `rimA` | `uRimA` | rim strength | 1 | 1 | 1 | 1 | 1 | 1 | 0.9 | 0.6 |
| `wobble` | `uWobble` | ragged edge, ± radii | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 0 | 0.03 |
| `faculae` | `uFaculae` | limb faculae strength | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 |
| `spots` | `uSpots` | sunspots on (Sol sun) | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pen` | `uPen` | penumbra | `#B8401E` | `#B8401E` | `#B8401E` | `#B8401E` | `#B8401E` | `#B8401E` | `#B8401E` | `#B8401E` |
| `umb` | `uUmb` | umbra | `#4A1006` | `#4A1006` | `#4A1006` | `#4A1006` | `#4A1006` | `#4A1006` | `#4A1006` | `#4A1006` |
| `spotSpin` | `uSpotSpin` | spot rotation, rad/s | 0.0349 | 0.0349 | 0.0349 | 0.0349 | 0.0349 | 0.0349 | 0.0349 | 0.0349 |
| `haze0` | `uHaze0` | haze, inner | `#FF7A2A` | `#FF7A2A` | `#F0502A` | `#5E9BFF` | `#FFB45A` | `#FF8C3A` | `#7FB8FF` | `#FF6A3A` |
| `haze1` | `uHaze1` | haze, middle | `#E8461A` | `#E8461A` | `#C8301C` | `#3A6AF0` | `#FF8C3A` | `#E8501A` | `#B8CCFF` | `#C83C1E` |
| `haze2` | `uHaze2` | haze, outer | `#6A1408` | `#6A1408` | `#4E0C16` | `#15287A` | `#6A2A10` | `#5A1608` | `#6A1408` | `#4A0E08` |
| `hazeR` | `uHazeR` | haze radius, radii | 4.35 | 4.35 | 4.5 | 4.44 | 4 | 4 | 4.35 | 2.43 |
| `hazeA` | `uHazeA` | haze strength | 1.2 | 1.2 | 1.2 | 0.92 | 0.8 | 0.7 | 0.55 | 0.9 |
| `fl0` | `uFl0` | flame ring, inner | `#FFE7A0` | `#FFE7A0` | `#FFB27A` | `#F4F8FF` | `#FFF6D6` | `#FFC890` | `#FFE7A0` | `#FFB27A` |
| `fl1` | `uFl1` | flame ring, 0.82 | `#FFB347` | `#FFB347` | `#FF6A3A` | `#A9C8FF` | `#FFD27A` | `#FF9A4A` | `#FFB347` | `#FF8A4A` |
| `fl2` | `uFl2` | flame ring, outer | `#FF6A1A` | `#FF6A1A` | `#E0432F` | `#4F8DFF` | `#FFA040` | `#E8501A` | `#FF6A1A` | `#D8461E` |
| `flR` | `uFlR` | flame ring radius, radii | 1.348 | 1.348 | 1.35 | 1.348 | 1.348 | 1.348 | 1.348 | 1.348 |
| `flAmp` | `uFlAmp` | flame displacement, radii | 0.217 | 0.217 | 0.175 | 0.22 | 0.217 | 0.217 | 0.217 | 0.11 |
| `flFreq` | `uFlFreq` | flame noise, per radius of the ring | 6.5 | 6.5 | 4.3 | 7.3 | 6.5 | 6.5 | 6.5 | 12 |
| `flSpin` | `uFlSpin` | flame turn period, s (sign = direction) | 200 | 200 | 260 | 180 | 200 | 200 | 200 | 200 |
| `flA` | `uFlA` | flame strength | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0.55 |
| `wi0` | `uWi0` | wisp ring, inner | `#FFB347` | `#FFB347` | `#FF6A3A` | `#7FB2FF` | `#FFD27A` | `#FF9A4A` | `#FFB347` | `#FF8A4A` |
| `wi1` | `uWi1` | wisp ring, 0.8 | `#FF6A1A` | `#FF6A1A` | `#E0432F` | `#4F8DFF` | `#FFA040` | `#E8501A` | `#FF6A1A` | `#D8461E` |
| `wi2` | `uWi2` | wisp ring, outer | `#E8461A` | `#E8461A` | `#A8240E` | `#3A6AF0` | `#FF8C3A` | `#A8240E` | `#E8461A` | `#8A1E10` |
| `wiR` | `uWiR` | wisp ring radius | 1.7 | 1.7 | 1.7 | 1.7 | 1.7 | 1.7 | 1.7 | 1.7 |
| `wiAmp` | `uWiAmp` | wisp displacement | 0.37 | 0.37 | 0.3 | 0.37 | 0.37 | 0.37 | 0.37 | 0.18 |
| `wiFreq` | `uWiFreq` | wisp noise | 3.9 | 3.9 | 3.4 | 6 | 3.9 | 3.9 | 3.9 | 9 |
| `wiSpin` | `uWiSpin` | wisp turn period, s | -300 | -300 | -390 | -270 | -300 | -300 | -300 | -300 |
| `wiA` | `uWiA` | wisp strength | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0.7 |
| `noiseGain` | `uNoiseGain` | ring-noise contrast | 1.6 | 1.6 | 1.6 | 1.25 | 1.6 | 1.6 | 1.6 | 1.6 |
| `breathe` | `uBreathe` | atmosphere breathe ± | 0.03 | 0.03 | 0.03 | 0.03 | 0.03 | 0.03 | 0.05 | 0.03 |
| `breatheT` | `uBreatheT` | breathe period, s | 6 | 6 | 6 | 6 | 6 | 6 | 4 | 9 |
| `prom` | `uProm` | prominences on | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 |
| `proOut` | `uProOut` | prominence outer stroke | `#FF8C2E` | `#FF8C2E` | `#E0432F` | `#5EA0FF` | `#FFB45A` | `#FF6A2A` | `#FF8C2E` | `#FF8A4A` |
| `proIn` | `uProIn` | prominence core | `#FFF1C2` | `#FFF1C2` | `#FFD9B0` | `#F4F8FF` | `#FFFDF0` | `#FFD8B0` | `#FFF1C2` | `#FFE0C8` |
| `proW` | `uProW` | outer stroke, px at zoom 1 | 2.8 | 2.8 | 2.4 | 3.2 | 2 | 1.5 | 2.8 | 3 |
| `flare` | `uFlare` | flare on | 1 | 0 | 1 | 1 | 1 | 0 | 0 | 0 |
| `smooth` | `uSmooth` | white-dwarf mode | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |

