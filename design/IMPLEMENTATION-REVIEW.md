# Implementation review: designs vs `src/`

This review compares Claude's design packs (v2 through ship systems and WP10) with the game code. It was written for the coding agents (Cursor, Grok) that implement the designs, and for Stephan.

- **Reviewed:** `main` at `ba2edd1` (2026-10-29), then updated for [PR #32](https://github.com/stepwaec/slingshot/pull/32) (`42981e0`, "Draw bodies from Claude's SVG assets"). Line numbers refer to `ba2edd1` unless marked #32.
- **Method:** each source file was read against the asset headers, `style.md` and `threejs-notes.md`. No code was changed and nothing was run in a browser, so on-screen pixel positions are calculated, not measured.
- **Spot checks:** the items marked ✔ were re-checked by hand against the code.
- **Rules:** follow `IMPLEMENTING.md`. When a fix lands, tick it here in the implementing pull request, or note why it was skipped.

## What PR #32 changed

PR #32 draws the sun, the stars, the home planet, Planet X, the moons, the gas giants, the comet, the compact objects and the nebulae by **rasterising each SVG once** into a texture. The old procedural shaders are skipped for those bodies. Black-hole art is claimed too, but its old disk code is still present behind a check.

Getting the approved art on screen is the right direction. It makes most of the "Bodies" findings below obsolete: the v1 sun, the planet surfaces and seams, the black hole, the white dwarf, the gas-giant ring and bands, the red giant, the pulsar, the magnetar and the neutron star. Those items are kept below for reference and marked *(obsolete after #32)*.

It also creates new gaps, now at the top of the priority list:

- **A. Every animation is frozen.** `loadArtTexture` (#32, `art-sprite.ts`) draws each SVG once, so its SMIL animation stops at t = 0. Lost as a result:
  - the sun's flame ring (+360° / 200 s), wisp ring (−360° / 300 s), breathing (±3 % / 6 s), prominences and flare
  - the planets' surface scroll and cloud drift, so the planets no longer turn
  - Planet X's breathing halo
  - the gas giants' counter-flowing bands
  - the comet's solar wind, knot, sparkles and coma breathing
  - the magnetar's flowing dashes, flicker and starquake
  - the red giant's crawling drag edge

  "Animated planets" was an explicit client request.

  **Fix: per-layer bakes.** Bake each animated layer as its own texture with `bakedSvgUrl(url, hide, { prep })`, keeping one layer per bake and removing all SMIL. Then replay each header timing in `update()`: rotation, scale, opacity, or UV scroll for surface strips. Layer ids:

  | Asset | Layer ids |
  |---|---|
  | `star.svg` | `#starBreathe` (haze), `#starWispRing`, `#starFlameRing` (ids added in this pull request), `#starProm1`–`3`, `#starFlare`, `#starDisc` plus the rim |
  | Other stars | `rdWispRing` and `rdFlameRing` in the red dwarf, the same pattern in the blue giant, red giant (`rgStar…`) and binary (`bnA…` / `bnB…`) |
  | `planet-x.svg` | `#pxSurfaceAnim`, `#pxWispAnim`, `#pxWispShadowAnim` |
  | `gas-banded.svg` | `#gbAnimA` / `B` / `C` |
  | `planet-start.svg` | the surface and cloud strips, by the ids in its header (`#psCloud`, `#psCloudShadow`) |

  Surfaces scroll under a static lighting overlay (`threejs-notes.md` §3); rings rotate; the haze scales.
- **B. Raster resolution.** `rasterPixels` caps textures at 2× the viewBox (1024 px longest side) with no mipmaps and no rebake on zoom. Above zoom 1 on a 2× display, bodies go soft. Below zoom 0.5 they alias and shimmer. Bake at `viewBox × DPR × zoom bucket` (rebaking in 25 % steps), or keep a mip chain for zoomed-out views (`IMPLEMENTING.md` §3).
- **C. Pulsar beams don't match their damage.** The whole pulsar sprite is scaled by body radius, so the drawn beams reach 228 units while `pulse.json`'s damage reach is 180. Draw the beams as their own quad, scaled to `beam.reach` and rotated by `beamAxis` on sim time. Keep the body sprite separate.
- **D. Comet.** The sprite turns away from the star correctly, but its tails never scale with distance (`clamp(Rperi/d, 0.35, 1)`). It is never mirrored either, so the dust tail leads the motion half the time. Bake the head and tails separately and apply the scale and mirror rules from the `comet.svg` header.
- **E. Nebulae draw over the bodies.** Nebula sprites use renderOrder 6, while body sprites use 0. Nebulae are background gas (`style.md` §9): give them a negative renderOrder.
- **F. Lighting.** Planets rotate as whole sprites so that their baked light faces the brightest source. That is acceptable for still pictures. Once surfaces scroll again (fix A), keep the lighting overlay separate from the strip, so only the light turns and the surface doesn't spin with it.

## Update after PRs #33–#37: surfaces still don't move

PRs #33 and #35 brought back the sun's turning rings and breathing haze, rebaked the rasters by zoom with mipmaps, and fixed the ship anchor, comet dust side and nebula order. Thank you. One gap from fix A is still open and is now the top visual item:

- **The sun's disc is a still raster** (`gallery.ts`, the `starDisc` layer), so the surface looks dead. **The planet surfaces** (Planet X, the home planet, moons) **and the gas-giant bands** don't move either: nothing scrolls `#pxSurfaceAnim`, `#pxWispAnim` or `#gbAnimA`–`C`.
- **Fix:** follow `style.md` §13 "Living surfaces" and `threejs-notes.md` §4.6. Use two counter-flowing plasma layers, three cross-fading cell layers, faculae, and a limb shimmer for stars; scroll the surface strips under fixed lighting for planets; flow the band groups for gas giants. The animated reference is `assets/star-surface-motion.svg`.

## Update after PR #47: collision visuals are placeholders

- **The scripted events draw only an orange ring** (`src/render/visuals/fates.ts`): a growing ring on a falling body, and a ring at an impact point for 3 s.
- **Fix:** replace it with the LU3 pack: `style.md` §14, `threejs-notes.md` §17 and `assets/events/`.
  - The impact gets its flash, shock, ejecta and afterglow, then the debris field.
  - `consume` gets the dayside glow and ablation tail growing with heat, the plunge flash, the ripple and the star brightening.
  - Planning gets the telegraphs.
  - The Ash level should match `mockups/showcase-burning-planet.svg`.

Landed in [PR #57](https://github.com/stepwaec/slingshot/pull/57), from the event art in design [PR #50](https://github.com/stepwaec/slingshot/pull/50):

- ✔ Impact draws the flash, shock, rim, ejecta and crater glow, then the debris field.
- ✔ `consume` draws the dayside glow and the ablation tail. Heat is `1 − (r − R_star) / (r0 − R_star)` from `burn-up.svg`. At `end`: plunge flash, ripple, star brightening.
- ✔ Planning draws the dashed course, the reticle and the countdown chips.
- ✔ Ash is compared with `mockups/showcase-burning-planet.svg`.
- Debris with r ≥ 4 is drawn and labelled. It is not a crash body, so the sim stays as PR #47 left it.
- `disrupt` and `accrete` are still proposed scripts. No level has them. Adding them would change gravity, so this pass does not.
- The star brightening is masked to the photosphere. The sample disc is `#FFE7A0` at α 0.22 and would turn olive on the navy sky.

## Update after PR #45: ghost markers are placeholders

- **The ghosts are one plain ring per moving body** at each node time, brighter under the cursor (`src/render/visuals/ghosts.ts`). Nothing ties a ghost to its path sample, the target's arrival isn't distinct, and collisions or bodies already gone don't show.
- **Fix:** follow `style.md` §15 and `threejs-notes.md` §18:
  - the ring and inner ring with their states (burn badge, cursor, arrival with capture radius, collision, gone)
  - dotted tie lines to the path sample at the same moment
  - time chips
  - the target's future track with a tick every 10 s

  The planning view should match `mockups/planning-ghosts.svg`.

Landed in [PR #64](https://github.com/stepwaec/slingshot/pull/64), from the ghost-marker art in design [PR #51](https://github.com/stepwaec/slingshot/pull/51):

- ✔ Ring and inner ring, with the burn badge, cursor, arrival capture radius, collision cross and gone slash.
- ✔ Dotted tie lines to the path sample at the same step, and the time chips.
- ✔ The target's future track, ticked every 10 s.
- `ghostSteps` and `movingBodies` are unchanged. The drawing reads `bodyPose` and does not write the sim.
- The mockup's faint full-orbit circle (α 0.12) is not in the header, so it is not drawn.
- "Other bodies" keep the body's radius (minimum 8 world units). The sample's quieter look is α 0.6.
- The cross ends at 0.64 r and the ticks are 8 px long, measured from `ghost-markers.svg`. The header does not number those two.
- Arrival wins over a burn when they share a step (§18). Lead's capture is the burn at step 230, so that ghost is the arrival marker. A burn that is not the capture keeps the badge.

## Update after PR #46: supernova and quasar are placeholders

- **The hazards are drawn as plain shapes** (`src/render/visuals/hazards.ts`): a red ring at `blast`, an orange ring at the shock radius, and a magenta bar along the jet. The star keeps its normal `look` until and after `at`, and the bar's width is `2 · reach · sin(cone)`, a box rather than the cone that `quasarDamage` tests.
- **Fix:** follow `style.md` §16 and `threejs-notes.md` §19:
  - the progenitor as the red-giant sprite with uneven breathing and old shells
  - the blue-white flash, then the ejecta and remnant filaments riding exactly on `shellRadius`
  - the quasar's disk, shadow and twin jets, with the violet sheath on the lethal cone
  - planning chips for the countdown, blast zone, shock forecast, jet sweep and safe window

  `src/levels/flash.json` should match `mockups/supernova-level.svg`. Give the sun `"look": "red-giant"`, or have the hazard visual override it.
- **Stray asteroid:** a body with `drift` and the WP11 rock look (`bodies/stray-asteroid.svg`). No level has one yet.
- **Realism, for Stephan to decide:** after `at` the sim leaves the star's mass and crash radius unchanged ("Motion is untouched" in `physics.ts`). A real core collapse blows off most of the mass and leaves a neutron star of about 1.4 solar masses and a few km across. Suggested change: from `at`, mass drops to a remnant fraction (a new optional `supernova.remnant`, default 0.15) and the crash radius to 8, with the prediction seeing the change. This alters gameplay, so it isn't in the art.

## Priority fixes

Do these first. They are the biggest visible or gameplay gaps after #32.

| # | Area | File | Problem | Fix |
|---|---|---|---|---|
| 1 | Ship | `src/render/visuals/ship.ts:77` ✔ | The part frame `PlaneGeometry(96, 160)` is centred on the frame middle (48, 80), but the ship centre is at (48, 64). The ship draws about 7 px ahead of its sim position, turns about a point near the fins, and leaves a gap between nozzle and plume. | `frame.translate(0, -16, 0)` straight after creating it. Then set each plume start from its engine header (chemical 28.2, ion 25.5). |
| 2 | All SVG bodies | `art-sprite.ts`, `gallery.ts` (#32) ✔ | Every body animation is frozen at t = 0 (gap A). | Per-layer bakes plus replaying the header timings (gap A). |
| 3 | All SVG bodies | `art-sprite.ts` `rasterPixels` (#32) ✔ | Textures soften above zoom 1 and alias when zoomed out (gap B). | Bake by DPR × zoom bucket, or use mips. |
| 4 | Pulsar | `art-sprite.ts`, `gallery.ts` (#32) ✔ | The drawn beam reach (228) doesn't match the damage reach (180) (gap C). | A separate beam quad scaled to `beam.reach`. |
| 5 | Comet | `gallery.ts` (#32) | The tails don't scale with distance and the dust side isn't mirrored (gap D). | Separate head and tail bakes; scale and mirror per the header. |
| 6 | Recharge | `src/render/visuals/path.ts:332-339` ✔, `src/sim/physics.ts:1342-1362` | Any dot with charge above 0 turns gold at alpha 1, out to 12 star radii. The design's 8 % cutoff and luminosity term are missing. | Set `t = rate / rateMax`, then `t = 0` below 0.08, with `rate = rateMax · L · min(1, (85/d)²)` and per-star L. |
| 7 | Recharge HUD | `src/main.ts:183-195`, `index.html:65` | Only a text line exists. The sun glyph, shimmer, sliver, planning ghost and end-ring label are missing. | Build them as the `solar-recharge.svg` header specifies (parts A–C). |
| 8 | Levels | `src/levels/relay.json:54` ✔ | The moon around Planet X has ω 1.1. Kepler for X's mass (2200) at r 44 gives 0.161, so it orbits 6.8× too fast. | Set ω to 0.1607. Add a level lint: ω within 1 % of √(GM/r³). |
| 9 | Shipyard | `src/hud/shipyard.ts:84-121`, `src/style.css:462-604` | The cards lack thumbnails, tier pips, mass, star cost and the locked state, and the screen is a small modal. | Rebuild the screen as the `upgrade-screen.svg` header specifies. |
| 10 | Nebulae | `gallery.ts:40` (#32) ✔ | Nebulae draw above the bodies (gap E). | Negative renderOrder. |

## Bodies (`star.ts`, `planets.ts`, `compact.ts`, `scenery.ts`, `clouds.ts`, `starfield.ts`)

*After #32, the sun, the stars, the home planet, Planet X, the moons, the gas giants, the black hole, the white dwarf, the red giant, the pulsar, the magnetar, the neutron star and the nebulae come from the SVGs. The items below about their shaders are obsolete, except where noted, and kept for reference. They still apply to any body look that `artForBody` doesn't claim (rocky, ocean, ice, lava, toxic, cracked). The scenery, starfield and Planet X halo items still apply.*

- **high · `planets.ts:43-61`.** The ocean's cast cloud shadow (`#06122E` α 0.45, offset 1.2 px away from the light) is missing.
  - Cloud values are off: the colour is `#ECF4FF` (design `#FFFFFF`), the edge slope 4.5 (design 26), and peak alpha 0.68 (design 0.78). Planet X gets white clouds instead of `#E6FFF9` wisps at 15 % cover.
  - The inner haze, shade bloom, `#08122E` shoulder, ocean glint and moon rims are missing.
  - The rim takes the surface colour instead of `#A8DBFF` (Planet X `#B5FFF0`).
  - **Fix:** add `uHaze`, `uRim` and `uBloom` per body, as in `threejs-notes.md` §3.
- **high · `planets.ts:119-165, 216-258`.** The black hole doesn't follow its design:
  - The photon ring is violet at 1.22 r. Design: `#FFC857` 2 px plus `#FFFFFF` 1 px at 1.09 r, and a `#FFF1C2` sub-ring.
  - The disk is about 2.5× too thick (1.35 r against the 0.2115 squash) and its ramp is inverted.
  - The lensed arcs sit at 1.63 r instead of 1.15–1.3 r, and the glow (`#FF8C2E`, r 3 r) is missing.
  - **Fix:** rebuild from the `black-hole.svg` header.
- **high · `planets.ts:276-287, 105-117, 530-532`.** Every banded giant gets a Saturn ring that isn't in the design. The bands are 18 sine stripes instead of the 9-band table with 3 counter-flowing groups (180 / 110 / 150 s), streaks and the storm spot.
- **med · `planets.ts:353, 365-366`.** Every planet turns once per 52 s and every cloud deck once per 31 s. Use each header's period instead (ocean 90 / 64 s, Planet X 120 / 80 s, moon 180 s and so on). Check the direction too: textures move west to east (unverified).
- **med · `star.ts:157-170`.** The white dwarf reuses the sun's ramps. Its spikes widen outward instead of tapering, and its disc has a plasma texture and rim wobble, where the design says perfectly round and smooth. Its breathing applies to the whole sprite instead of the glow only (±5 % / 4 s).
- **med · `star.ts:91-109, 219-229`.** The red giant's drag atmosphere fades too early: its stops should be about 0.60 and 0.96, not 0.35 and 0.70. The boundary ring differs:

  | Ring | Code | Design |
  |---|---|---|
  | Alpha | 0.45 | 0.30 |
  | Width | about 4.6 world units | 1.2 px |
  | Dash | 4.1 / 3.4 | 10 / 6 |
  | Crawl | 37 units/s | −8 px/s |

  Use px-space dashes like the capture ring.
- **med · `star.ts:65-72, 151-183`.** Every star shares the sun's plasma colour `#802105` at α 0.85. The design caps it at 0.55, with its own colour per look: hot `#A0460E`, cool `#6A1606`, red giant `#5A1406`. The body's middle stop sits at 0.42 instead of 0.65. Several cores aren't tokens. Move the v1.5 tokens into `palette.ts`.
- **med · `star.ts:61-62`.** The rim wobble's amplitude is 0.1 r; the design is ±1.75 %. The rim has a seam at ±π. The disc breathes, which moves the visible edge off the crash radius; only the outer layers should breathe.
- **med · `compact.ts:68-79`.** The pulsar's afterglow fan should be 8 × 5° sectors at α 0.22 (1 − k/8)^1.6. Its core line should be 1 px, and its glow r 44.
- **med · `compact.ts:103-125`.** The magnetar's field lines have no `fwidth`, so they alias and thin out. Its dashes are radial instead of flowing along the lines. Its grain should be two cross-faded seeds, and the starquake should end in `#FF7AE6`.
- **med · `compact.ts:187-196`.** The quiet neutron star only gets beams when the level defines them. It should always show its cosmetic cones (6.4 → 14 wide, length 28, on a 6 s cycle), with an antialiased body edge and two hairline limbs.
- **med · `scenery.ts:31-37, 74-75`.** The asteroid and wreck shading rotates with the rock, so the light spins. Rocks are circles. The colours (`0x9aa4b8`) aren't tokens and are linearised by `THREE.Color`, so they render too dark. Use the WP11 belt pipeline (`threejs-notes.md` §14).
- **med · `starfield.ts:78-105`.** The star tints, the u³ magnitude rule, the 12 halos, the Milky Way band and the vignette stops are off. The extra nebula washes are drawn twice, once in `starfield.ts` and once in `scenery.ts`, at α 0.28, above the 0.22 cap.
- **low · `clouds.ts:23-38`.** Several colours aren't tokens. Nebulae draw over the bodies; §9's order puts them behind.
- **low · `planets.ts:74-76`.** Planet X's halo stops are slightly off, and the halo doesn't breathe (±4 % / 2.4 s).
- **low · `planets.ts:493-514`.** Planet textures are a fixed 256 × 128 with no rebake on zoom. Size them as `round(2πr) × bucket × DPR`, rebaked at 25 % zoom steps.

**Done right:** sim time is used for positions and `frame.now` for cosmetics everywhere. The planet sphere mapping is correct, with the light computed live from the star and summed for binaries. Surfaces are baked once. The capture ring matches its spec. The WP8 star looks and the magnetar's geometry are right.

## Overlays and effects (`magnetism.ts`, `path.ts`, `recharge.ts`, `comet.ts`, `gravity.ts`, `relativity.ts`)

*After #32, the comet head and tail come from `comet.svg` (the procedural ones are skipped), so the `comet.ts` shader items are obsolete. The harvest-ring item still applies, and gap D replaces the rest.*

- **high · `comet.ts:53, 167-169`.** The tail starts about 62 · s px out from the nucleus, so it floats detached from the head. Translate the geometry by +1 on x, scale by 0.5 · length, and drop the position offset.
- **med · `comet.ts:15-41`.** The coma is too small (rx 26 instead of 50) and a single colour instead of the 4-stop ramp. The core is r 7.9 instead of 11. The nucleus is a pale ellipse instead of the dark, lit peanut. The jets are missing.
  - `smoothstep(0.2, -0.6, …)` has its edges reversed, which is undefined behaviour in GLSL.
- **med · `comet.ts:44-67`.** The tail is two soft blobs about 150 · s long. The design has 7 crisp ion rays to x 440 and 24 dust strands to x 296–392, with sparkles. Bake the strand texture (`threejs-notes.md` §12).
- **med-low · `comet.ts:59-61, 77-81`.** The solar-wind streak period and speed are off: use `fract(x_px/100 − t/2.5)`. The knot should be 24 × 10. The harvest ring sits at r 27.6 instead of 30, with the wrong alpha and dash.
- **med · `magnetism.ts:69-73`.** The dash mask also hits the outer half of the Scrambled edge. Dash only near the B1 threshold, measured around the strongest dipole.
- **med · `magnetism.ts:59, 68`.** Edges are about 2 px wide and split across the threshold. Draw them on the inner side only: 1 px, or 1.25 px for Lethal, in the inner zone's colour.
- **low-med · `magnetism.ts:74-75`.** The Lethal breathing ranges 0.62–0.865. It should be `0.725 + 0.175 · cos(2πt / 2.4)`.
- **med · `path.ts:130`.** The fuzzy envelope fill should be α 0.06, not 0.14, and needs dashed ±σ edges (2 4, α 0.35).
- **low-med · `path.ts:212-213, 377-393`.** The end ring scales its stroke and ignores zoom. Draw it with radius `6 + σ · zoom` and a constant 1.5 px stroke. Draw both ghost sets and swap their alphas (0.45 / 0.10) every 0.3 s.
- **low-med · `recharge.ts:23, 59-61`.** The ship pulse ring should grow from r 9 to 18 with a constant 1.2 px stroke, over the still disc (r 13, `#FFE08A` α 0.12).
- **med · `gravity.ts:124-131, 350`.** The tidal danger discs (`#FF5A5F` α 0.33) look almost identical to the Lethal magnetism zone and draw above it. Make them a 1 px dashed ring at a lower render order.
- **med · `relativity.ts:129-150`.** An unshifted star renders grey-mauve (`#9C7073`), and the redshift wash reads brown. Blend in sRGB from `#AAB8DD` toward `#9CCBFF` or `#FF8C2E`, and cap the wash at α 0.12.
- **low · `path.ts:333, 471`; `physics.ts:1277`; `nodes.ts:91`.**
  - The gold dot ramp should start from `#DCE4FF` with a growth factor of 0.867.
  - The 6 px fuzz factor should be a knob, so the Sensors upgrade can lower it.
  - Burn node markers use `#FFC857` right next to the gold path dots. Keep the two apart.

**Done right:** the magnetism zone thresholds, colours and flat fills are right. Dipoles sum as vectors, and the shader and the sim share the maths. M is visual only. The fuzzy σ accumulation and its seeded ghosts work. The comets ride Kepler ellipses and scale their tails correctly. The pulse ring timing is right.

## Ship and HUD (`ship.ts`, `shipyard.ts`, `main.ts`, `style.css`)

- **med · `ship.ts:581-583`.** The ion engine uses the chemical teardrop shape. The design is a straight, slightly flaring beam (12 → 13.2 wide) with a tapered core and a 2 s shimmer (it is 0.69 s today). Add a `uShape` uniform.
- **med · `ship.ts:124-141, 323-331`.** The pulse flash is a flat, hard disc fixed at −31. The design uses a radial gradient (`#FFFFFF` → `#E2D4FF` → `#A06BFF` → `#7A4AD8`), falls from y 36 to 46, and adds a plate glow at −34. The sim-time keying is correct.
- **med · `ship.ts:356-360, 617-649`.** The tidal chevrons are filled arrowheads that pulse by scaling. The design is open strokes (1.6 px) at 15–19 and 20–24 px that pulse by alpha (1 → 0.35) and are never scaled.
- **med · `ship.ts:290`.** Any hull drop above 0.05 per frame retriggers the white hit flash, so continuous tidal damage strobes the ship. Flash only on discrete hits.
- **med · `style.css:300-404`.** The status stack sits about 10–20 px above its spec:

  | Element | Code | Spec |
  |---|---|---|
  | Fuel label baseline | ≈ 38 | 48 |
  | Hull label baseline | ≈ 74 | 96 |
  | Stress chip | ≈ 101 | 122 |

  Adjust the `top` and `margin-top` values (calculated, not measured).
- **med · `style.css:397-447`.** The stress chip uses 600 10 px type (spec 500 11 px) and an inward bowtie icon (spec: a vertical double arrow with a dot). Its cells are 8 × 8 (spec 9 × 12), and its level-3 pulse is 0.5 s (spec 0.8 s). The border-not-fill rule is respected.
- **med · `ship.ts:107-122, 303-308`.** The wind-up glow is a soft circle up to 7 px across, which reads as a halo. The real throat glow (chemical `#E2D4FF` 3.6 × 0.7) and plate glow (ion `#BFE0FF` 13.2 × 1) are missing.
- **med · `ship.ts:221`; `svg-bake.ts:46`.** Baking freezes the SMIL in `damage-15`, so its venting, sparks and beacon never move. Bake the static marks and animate those three as small quads from `frame.now`.
- **med · `style.css:462-604`.** The shipyard layout needs:
  - the full-frame grid: cards 392 × 150 at x 600 and 1008, radius 12
  - the "SHIPYARD" mode label and the "STARS TO SPEND" label
  - Launch with the next level's name
  - the `#FF9F43` mass notes
  - a scrim at α 0.55
  - the live ship preview at about 5.8× on a dashed pad
- **low.**
  - The hull value reads "64%"; the spec is "64 %".
  - The critical hull percentage should pulse, and a lost segment should flash for 120 ms.
  - The chemical and ion plumes drop their middle and tail colour stops.
  - The solar glow should use `solarRechargeRate > 0` and light the frame only.
  - The scoop should pulse only while scooping.
  - Only the sensor tip light should blink.
  - The shield flash should last 0.2 s.
  - `theme.thrust.bloom` is dead config; remove it.

**Done right:** the part draw order matches, with plating baked in two halves. The ship is 22 px at zoom 1 (12 px minimum). Textures are baked at DPR × zoom bucket with a generation guard. The damage and hull thresholds are exact, and the hull bar has 10 segments. The stress chip has a border, not a fill. The pulse engine runs on sim time. There's no bloom halo, and the HUD type is right.

## Physics realism (`src/sim/physics.ts`, `src/levels/*.json`)

- **med · `src/levels/pair.json:30, 47`.** The binary turns at 43 % of its Kepler speed. Keep the masses and the 48 s period, and widen the separation to 156.2 (hot star at r 55.8, cool star at r 100.4). Then re-solve `pairPlan`.
- **med · `src/levels/chain.json:40-91`.** The moons keep a correct 1:2:3:4 resonance, but run at 0.835× Kepler. Scale the radii by 1.128 (to 76.7 / 121.8 / 159.6 / 193.3), or set the giant's mass to 38 313.
- **med · `physics.ts:1013`.** In Ember and Passage, the capture radius is larger than the target's Hill radius, so a "stable orbit" there wouldn't survive. Add a lint: capture radius ≤ 0.5 · D · (m / 3M)^(1/3).
- **med · `physics.ts:1086-1108`.** Drag is linear and applied as an explicit kick, so a large `dragStrength` can reverse the velocity. Use quadratic drag with the exact update `v_rel /= (1 + k ρ |v_rel| dt)`, which can never overshoot.
- **med · `physics.ts:769-771`.** The clock rate clamps to 0 well outside the horizon on fast radial falls. Use the product form `√(1 − 2Φ/c²) · √(1 − v²/c²)` behind a `dilationModel` knob, so existing fixtures stay valid.
- **med · `physics.ts:1471` and on (optional).** Gravity is Newtonian right down to the horizon, so stable orbits exist inside 3 r_s. A Paczyński–Wiita knob for black holes, `GM / (r − r_s)²`, reproduces the innermost stable orbit at 3 r_s. Keep it off by default.
- **med · `physics.ts:933-1759` (many `bodyPose` calls); `comet.ts:155`.** These calls omit `g`, so ellipse orbits fall back to G = 1 while gravity uses `gravityScale`. Store the mean motion on the orbit once.
- **med · `src/level/catalog.ts:74`.** Fuel per unit of delta-v grows with mass² because mass is counted twice. Drop `* load.mass` from `fuelPerDv`.
- **low · `physics.ts:1307, 1441`.** Any tidal stress drains the hull. The design drains it only at level 3: `damage = max(0, stress − STRESS_WARN)`.
- **low · `physics.ts:439`.** Kepler solving uses a fixed 6 iterations, which isn't enough above e 0.8. Iterate more only when e ≥ 0.8, and require `centerId` for ellipses.
- **low · `physics.ts:1143, 1184`.** The exact rotation-averaged dipole term is 1.5 k/r³, not 1.429. If you change it, `threejs-notes.md` §11 changes with it.
- **low · `physics.ts:554-576`.** The ε-softened force isn't Plummer. Use `GM r / (r² + ε²)^(3/2)` when p = 2.
- **low · `physics.ts:1480`.** Grazing passes at dt 1/60 end about 0.9° off. Opt-in deterministic substeps fix this. `Math.sin` and `Math.pow` aren't bit-identical across browsers, which matters for future leaderboards and ghost runs.

**Done right:** velocity Verlet keeps energy bounded, and prediction and flight share one path. Gravity, its potential, the horizon, the dipole field and the tidal formula are correct. The comets ride Kepler ellipses, and the binary barycentre is exact.
