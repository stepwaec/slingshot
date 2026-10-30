# Shader specs — Rendering v2

The numbers for the GPU-drawn bodies in Rendering v2 (`docs/ROADMAP.md`, R2.0–R2.5). Each family has a **reference shader** in `design/shaders/` and a live comparison in `design/preview/shaders.html`: the approved SVG on the left, the reference shader on the right, at 1.5×. The game's shaders must match the right-hand column. The values in this file and in the preview come from one table, so they cannot drift apart. Physics, gameplay and the prediction stay untouched.

Status: **R2.0 conventions, R2.1 stars and R2.2 rocky planets** are specified. Gas giants (R2.3), compact objects (R2.4) and effects (R2.5) follow as their own sections.

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

## 3. Rocky planets and moons (R2.2)

Reference shader: `design/shaders/planet.frag`. Maps: `design/shaders/maps/`. Covers Earth, the Moon, Mars, Mercury, Venus, Titan, Pluto, Charon and Eris, and the library worlds and moons: the home ocean world, Planet X, rocky, ice, lava, toxic, cracked, dwarf, and the barren, icy and volcanic moons. The double planet and the captured moon are not covered yet (two bodies, and a non-spherical rock); they keep their sprites. Gas giants are R2.3.

**Baked maps, not procedural noise.** The approved art already lives in each body's SVG surface strip, and real geography (Earth's continents) cannot come from noise. So each map is baked once from the SVG. The bots can bake any new body the same way:

1. **Take one period of the scrolling strip.**
   - In the SVG, find the strip group: `<g><animateTransform type="translate" from to dur/><g transform="translate(−X −r)">…</g></g>`.
   - The period is P = |to − from| (round(2πr)); the strip is P × 2r.
   - Features are drawn at x and x + P, so the window [0, P] is seamless.
2. **Render it to 1024 × 256 PNG** (stretched; power-of-two, so the spin can wrap with `REPEAT`), with a transparent background for clouds and lights.
3. **Separate the layers:**
   - one map for the surface (every non-cloud strip, composited)
   - one for the clouds (strips whose filter is a cloud or wisp; skip the cloud *shadow*, which the shader draws)
   - one for lights or glow (city lights, lava veins, glowing cracks)
4. **Read the parameters from the SVG:**
   - `start` = (X mod P) / P
   - `spin` = `dur`, negative when the strip runs right to left (Venus)
   - the lighting colours from the body's own `…Shade`, `…Haze` and `…Rim` gradients: the shade's first stop is the bloom, and the haze's 0.96 and 1.0 stops are the haze
   - no haze gradient means airless
5. **Locked bodies** (the Moon, Pluto, Charon, Eris): render the body group without its shade, haze and rim circles to a 512 × 512 face map.

**Mapping.**
- **Spinning bodies:** sphere normal n; longitude = atan(n.x, n.z); u = start + longitude / 2π − t / spin; v = (1 + n.y) / 2 (the maps are uploaded with `UNPACK_FLIP_Y`).
- **Locked bodies:** uv × 0.5 + 0.5 on the face map.
- **The result:** features foreshorten and turn round the limb, which the flat-scrolling SVG cannot do.

**Lighting** (the planet reference construction, `bodies/ocean.svg`):
- **The light direction.** `uLight` is the direction toward the star, in screen space with y up and z toward the viewer. The art's default is (0.587, 0.587, 0.556): the in-plane L at 0.83 plus z 0.56, fitted so the terminator falls where the SVG shade puts it.
- **Day side:**
  - a highlight bloom `hi` × `hiA` × max(d, 0)^10, where d = n · L
  - a warm band `warm` × `warmA` around d ≈ 0.06 (airless: 0.03 and narrower)
- **Night side:** `night0` at α 0.74 just past the terminator, then `night1` at α 0.97, then 1.
- **Lit-side mask:** the limb haze (0.78 α 0 → 0.96 `hazeA0` → 1.0 `hazeA1`) and the rim (outside the disc to 1.077 r, its peak overlapping the edge) are masked to the lit side by the SVG's linear mask (1 at the lit edge, 0.45 in the middle, 0.06 at the dark edge).
- **Extras:**
  - **Clouds:** they turn on `cloudSpin` and cast a `#06122E` shadow offset away from the light.
  - **Ocean glint:** Blinn-Phong (exponent 48), only on clear ocean blue.
  - **Lights:** they show at night only, except glows with `glowDay` = 1.

**Titan's detached haze:** one extra ring outside the disc, radial to 1.12 r: 0.88 `#8FB8FF` α 0 → 0.915 `#9CC4FF` α 0.75 → 0.95 `#7FA8F2` α 0.25 → 1 α 0, on the lit side only (`sol/titan.svg`).

**Budget:** 2–4 texture samples plus lighting per pixel, under 0.05 ms per body (`threejs-notes.md` §9). The maps total under 2 MB.

**Parameters** (defaults: `warm` `#FF9455` α 0.24, `night0` `#08122E`, `night1` `#050B1E`, `shadowA` 0.42, `shadowOff` 0.026):

| Parameter | Uniform | Meaning | Earth | The home ocean world | Mars | The Moon (locked) | Planet X | Rocky world | Ice world | Lava world (glow by day) | Toxic world | Cracked world (cracks glow at night) | Dwarf planet | Barren moon | Icy moon | Volcanic moon | Mercury | Venus (retrograde) | Titan | Pluto (locked) | Charon (locked) | Eris |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `R` | `uR (× zoom)` | body radius, px at zoom 1 = crash radius | 34 | 34 | 24.8 | 18 | 30 | 30 | 28 | 26 | 32 | 27 | 10 | 14 | 12 | 13 | 21 | 33.1 | 21.6 | 14.7 | 10.5 | 14.5 |
| `maps` | `uAlbedo / uClouds / uLights / uFace` | baked maps in `shaders/maps/` | `earth-albedo` `earth-clouds` `earth-lights` | `ocean-albedo` `ocean-clouds` | `mars-albedo` | `moon-face` | `planet-x-albedo` `planet-x-clouds` | `rocky-albedo` | `ice-albedo` | `lava-albedo` `lava-glow` | `toxic-albedo` `toxic-clouds` | `cracked-albedo` `cracked-glow` | `dwarf-albedo` | `moon-barren-albedo` | `moon-icy-albedo` | `moon-volcanic-albedo` | `mercury-albedo` | `venus-albedo` | `titan-albedo` | `pluto-face` | `charon-face` | `eris-face` |
| `light` | `uLight` | toward the star (the art's default; the game uses the real star) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (-0.587, -0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) | (0.587, 0.587, 0.556) |
| `locked` | `uLocked` | fixed face (no spin) | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| `start` | `uStart` | longitude fraction at the centre at t 0 | 0.542 | 0.364 | 0.611 | 0.5 | 0.3723 | 0.3723 | 0.2955 | 0.2822 | 0.4577 | 0.3353 | 0.4762 | 0.5 | 0.4267 | 0.4512 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |
| `spin` | `uSpin` | seconds per turn (− = retrograde) | 90 | 90 | 92 | 90 | 120 | 110 | 140 | 95 | 120 | 100 | 160 | 180 | 150 | 120 | 300 | -96 | 160 | 90 | 90 | 90 |
| `hasClouds` | `uHasClouds` | cloud map on | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `cloudSpin` | `uCloudSpin` | cloud seconds per turn | 64 | 64 | 64 | 64 | 80 | 64 | 64 | 64 | 75 | 64 | 64 | 64 | 64 | 64 | 64 | 64 | 64 | 64 | 64 | 64 |
| `cloudA` | `uCloudA` | cloud opacity | 0.85 | 0.78 | 0.85 | 0.85 | 0.7 | 0.85 | 0.85 | 0.85 | 0.92 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 |
| `shadowA` | `uShadowA` | cloud shadow opacity (#06122E) | 0.42 | 0.45 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 | 0.42 |
| `shadowOff` | `uShadowOff` | cloud shadow offset away from the light, radii | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 | 0.026 |
| `glint` | `uGlint` | ocean glint strength | 0.6 | 0.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `hasLights` | `uHasLights` | lights / glow map on | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `lightsA` | `uLightsA` | lights strength | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `glowDay` | `uGlowDay` | 1: glows by day too | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `hi` | `uHi` | highlight bloom colour | `#E6F2FF` | `#E6F2FF` | `#FFE9D6` | `#F4F2FC` | `#B5FFF0` | `#FFF0DC` | `#FFFFFF` | `#FFD9B0` | `#F4FFD6` | `#D2DEF6` | `#FFF6E6` | `#F4F2FC` | `#FFFFFF` | `#FFF6D8` | `#FFF4E6` | `#FFF8E6` | `#FFE0B0` | `#FFF4E6` | `#F4F2FC` | `#FFFFFF` |
| `hiA` | `uHiA` | its strength | 0.34 | 0.38 | 0.24 | 0.22 | 0.28 | 0.2 | 0.22 | 0.26 | 0.22 | 0.3 | 0.18 | 0.24 | 0.28 | 0.3 | 0.24 | 0.3 | 0.22 | 0.22 | 0.22 | 0.3 |
| `warm` | `uWarm` | terminator band colour | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` | `#FF9455` |
| `warmA` | `uWarmA` | its strength | 0.24 | 0.24 | 0.24 | 0.18 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 | 0.24 |
| `night0` | `uNight0` | night at the terminator (α 0.74) | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` | `#08122E` |
| `night1` | `uNight1` | deep night (α 0.97 → 1) | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` | `#050B1E` |
| `airless` | `uAirless` | hard terminator, no haze or rim | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 1 | 1 |
| `haze0` | `uHaze0` | limb haze at 0.96 | `#8FD0FF` | `#8FD0FF` | `#F5B996` | `#8FD0FF` | `#8FFFE6` | `#E8B07A` | `#8FD0FF` | `#FF8C2E` | `#C7E97A` | `#8FA3C9` | `#8FD0FF` | `#8FD0FF` | `#8FD0FF` | `#8FD0FF` | `#8FD0FF` | `#FFF0C8` | `#F2B868` | `#C9D8FF` | `#8FD0FF` | `#8FD0FF` |
| `hazeA0` | `uHazeA0` | its alpha | 0.45 | 0.42 | 0.28 | 0.45 | 0.42 | 0.3 | 0.4 | 0.26 | 0.4 | 0.3 | 0.45 | 0.45 | 0.45 | 0.45 | 0.45 | 0.5 | 0.45 | 0.18 | 0.45 | 0.45 |
| `haze1` | `uHaze1` | limb haze at 1.0 | `#BFE6FF` | `#BFE6FF` | `#FFD9C2` | `#BFE6FF` | `#E6FFF9` | `#FFD9B0` | `#E6F6FF` | `#FFB347` | `#E4F7B0` | `#B8CAEE` | `#BFE6FF` | `#BFE6FF` | `#BFE6FF` | `#BFE6FF` | `#BFE6FF` | `#FFF8E6` | `#FFD58E` | `#E6EEFF` | `#BFE6FF` | `#BFE6FF` |
| `hazeA1` | `uHazeA1` | its alpha | 0.7 | 0.65 | 0.45 | 0.7 | 0.65 | 0.48 | 0.62 | 0.42 | 0.62 | 0.5 | 0.7 | 0.7 | 0.7 | 0.7 | 0.7 | 0.75 | 0.7 | 0.3 | 0.7 | 0.7 |
| `rim0` | `uRim0` | rim peak (α 0.95 at r 1.0) | `#A8DBFF` | `#A8DBFF` | `#FFD2B8` | `#A8DBFF` | `#B5FFF0` | `#FFD9B0` | `#BFE3FF` | `#FFB347` | `#DDF59A` | `#B8CAEE` | `#A8DBFF` | `#A8DBFF` | `#BFE3FF` | `#FFE08A` | `#A8DBFF` | `#FFF0CC` | `#FFD08A` | `#C9D8FF` | `#A8DBFF` | `#A8DBFF` |
| `rim1` | `uRim1` | rim tail (α 0.4 at 1.028) | `#7FC4FF` | `#7FC4FF` | `#F29C7A` | `#7FC4FF` | `#8FFFE6` | `#E8B07A` | `#8FD0FF` | `#FF8C2E` | `#A8D850` | `#8FA3C9` | `#7FC4FF` | `#7FC4FF` | `#BFE3FF` | `#FFE08A` | `#7FC4FF` | `#F5D9A0` | `#E9A050` | `#9FB8F2` | `#7FC4FF` | `#7FC4FF` |

