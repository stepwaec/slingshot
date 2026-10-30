# Slingshot: roadmap

Repository: [stepwaec/slingshot](https://github.com/stepwaec/slingshot). Game design, physics rules and architecture are in [DESIGN.md](DESIGN.md).

Last updated: 2026-10-30 (Europe/Zurich).

Status values: **Done** (merged, with PR link), **In progress**, **On hold**, **Planned**. Every planned package is scoped with Stephan before it is built.

Note on numbering: Brainstormer's first draft called the flight loop "WP2" and relativity "WP3". By the time they were scoped, WP2 (maneuver nodes) and WP3 (Three.js visuals) were already merged, so they were renamed WP4 and WP5.

## Work packages

| Package | Status | Scope |
| --- | --- | --- |
| WP1: prototype (gravity-assist flight) | Done, merged 2026-10-28 in [PR #1](https://github.com/stepwaec/slingshot/pull/1) | Browser prototype in TypeScript, Vite and HTML Canvas, no engine. Dark starfield with pan and zoom. Fixed bodies: start planet, target Planet X and one star or planet in between for a slingshot. Newtonian gravity on a fixed, deterministic time step shared by prediction and flight. Ship starts in orbit around the start planet with a fixed fuel budget. Drag from the ship to set a launch burn, with a live dotted prediction and fuel cost. Launch, trail, Reset, sim speed 1x/2x/4x. Outcomes: crash, "Lost in space" (out of bounds or timeout), and a win that requires capture into a stable orbit around Planet X (bound, periapsis above the surface, apoapsis inside the capture radius). Tests: prediction matches flight; the slingshot route uses less fuel than the direct route. |
| Claude design: visual style v1 | Closed without merge: [PR #2](https://github.com/stepwaec/slingshot/pull/2). Its files were merged through PR #4. | Claude's `design/` folder: `style.md` (palette tokens, typography, glow rules, motion, HUD layout), `assets.md`, `canvas-notes.md` (written for Canvas 2D), SVG assets (ship, thrust, planets, star, starfield, trail, predicted path, drag arrow) and 1440x900 mockups of the planning, flight, win, crash and lost screens. No code. Stephan found the designs not realistic enough yet; realistic visuals are to be swapped in later. |
| WP2: maneuver nodes (multi-burn planning) | Done, merged 2026-10-28 in [PR #3](https://github.com/stepwaec/slingshot/pull/3) | The plan becomes a list of burn nodes along the predicted path (like Kerbal Space Program). Click the dotted path to add a node, drag the handle to aim the burn, drag the marker to move it, delete it with a button or the Delete key. Capture is just another node. Prediction applies each node at its exact sim step and caches the state at each node, so editing node k only recomputes from k onward. Fuel adds up across all burns. |
| WP3: Three.js visual pass | Done, merged 2026-10-28 in [PR #4](https://github.com/stepwaec/slingshot/pull/4) | Replaces the Canvas 2D view with an orthographic Three.js scene and an HTML/CSS HUD, and brings in Claude's design pack. Simulation, plan state and node logic unchanged; a test locks the camera projection to the previous screen mapping. Each visual is a swappable factory in `src/render/visuals/index.ts`, with colours, sizes and asset paths in `src/render/theme.ts`. 60 fps on a real GPU was not formally confirmed. |
| WP4: flight loop (horizon, pause, moving bodies) | Done, merged 2026-10-29 in [PR #5](https://github.com/stepwaec/slingshot/pull/5) | Planets and moons on deterministic analytic orbits keyed by sim time (nested orbits work). Limited prediction horizon that shortens near big masses. At most 2 burns queued at once. Tactical pause with three configurable rules (unlimited, a few free per level, or a score cost per pause) plus slow motion. New level Relay that can only be won by pausing and adding a capture burn mid-flight (fuel budget 50, reference plan 48.87). Stable orbit around Planet X still required. 18 tests, including bit-for-bit prediction and pause-equals-uninterrupted. |
| WP5: relativity and scoring | Done, merged 2026-10-29 in [PR #6](https://github.com/stepwaec/slingshot/pull/6) | Lowered, per-level speed of light. Ship time (proper time) vs outside time from speed and gravity, `dτ/dt = sqrt(1 - 2Φ/c² - v²/c²)`, clamped at 0, inside the pure physics step. Black hole horizon at `r_s = 2GM/c²`. HUD clock panel with both clocks, rate gauge, gap and deadline bar. Path tinted by clock rate in planning. Scoring: stable orbit required, outside-time deadline is a hard fail, crew-time and fuel bonuses, pause cost subtracted, three stars (deadline, crew time, fuel) weighted per level. Relativistic sky effects in flight view only. New level Rescue shows the deep-dive dilemma. 26 tests. |
| WP6: gravity map view | Done, merged 2026-10-29 in [PR #7](https://github.com/stepwaec/slingshot/pull/7) | Planning and pause view toggle (G key or Gravity button) cycling off, a flat heatmap coloured by well depth, and a tilted 3D sheet (warped grid sinking by the real potential, log-scaled so black holes stay readable, planned path drawn on the sheet). C key or Clock rate button adds rest-frame clock-rate contours. Depth reads the same physics potential; tests prove grid depth equals the potential and that toggling never changes the sim or prediction. On a test machine without a GPU the map dropped from 23 to 16 fps; real-hardware speed is unproven. 30 tests. |
| WP6b: gravity grid (curvature grid) | Done, merged 2026-10-29 in [PR #8](https://github.com/stepwaec/slingshot/pull/8) | Replaces the flat heatmap with the classic curvature diagram: an evenly spaced grid whose lines bend and bunch toward masses by the real potential, more tightly near deep wells, kept finite at black holes, moving with the bodies. Tilted sheet and clock-rate lines kept. G cycles off, grid and sheet. Visual only; 31 tests. |
| WP7: burn animation, burn delete and plume | Done, merged 2026-10-29 in [PR #9](https://github.com/stepwaec/slingshot/pull/9) | Wind-up starting 0.5 s of sim time before each burn (engine glow and flicker, pulsing node marker) and a thrust tail after it, timings in `theme.burn`. Delete an unfired planned burn: click its dot, then press Delete or Backspace or the small x; prediction recomputes and fuel comes back; fired burns cannot be deleted. Plume starts at the nozzle and shows only behind the hull; wider and turbulent; blue-white core fading to violet with glow. Purely visual; tests prove flights and fuel are identical with or without the animation, and deleting a burn equals never placing it. 39 tests. |
| WP7b: plume duration and trail | Done, merged 2026-10-29 in [PR #10](https://github.com/stepwaec/slingshot/pull/10) | Plume lasts longer for bigger burns: `min(tailMax, tailBase + tailPerDv * abs(dv))` with 1.15 s base, 0.16 s per unit delta-v, 4.2 s cap. The flown trail behind the ship becomes a narrower version of the plume (blue-white to violet glow) that fades after a while. Predicted line, physics, fuel and determinism unchanged. 41 tests. |
| WP7c: levels as JSON and physics knobs | Done, merged 2026-10-29 in [PR #12](https://github.com/stepwaec/slingshot/pull/12) | Passage, Relay and Rescue are JSON files in `src/levels/` with a typed schema and a validating loader. The old TypeScript level definitions are gone, and those three levels play bit-for-bit identically. Optional per-level `physics` block; every knob defaults to the previous behaviour: `c` (speed of light), `gravityScale` (G multiplier), falloff shaping `eps` and `p` near 2 (force `GM / (r²+ε²)^(p/2)`, potential kept consistent with the force), `dilationStrength`, and `dilationCap` with smooth saturation so the rate never drops below `1/cap`. `tidalStrength` and `dragStrength` are in the schema and type only. HUD rounds the clock rate, the time gap and the deadline margin, with rising, falling or steady arrows and hysteresis. Tests: each active knob changes the flight as intended and prediction still matches flight; the cap is continuous, monotonic and never exceeded; the loader rejects invalid JSON; default flights match the pre-move trajectories, clocks and scores. |
| WP8: stellar variety | Done, 2026-10-29 in [PR #18](https://github.com/stepwaec/slingshot/pull/18) | Binary stars (Pair): two stars on rails around a shared centre, each drawn, and planets lit from both. White dwarf: small bright disc, wide glow, diffraction spikes, hard crash radius. Red giant (Ember): deep-red disc plus a soft drag atmosphere; `dragStrength` slows the ship only inside `atmosphereRadius`, in the same `step` the prediction uses. Gas giant (Chain) with four moons on a 1:2:3:4 resonance. Three JSON levels, each with a reference solution that captures Planet X. 62 tests. |
| Visual restyle v2 | Done, 2026-10-29 in [PR #23](https://github.com/stepwaec/slingshot/pull/23) | Claude's v2 look on every level: a plasma sun, planet surfaces with clouds and a day/night terminator, a tinted starfield with nebulae, an asteroid field, wreck debris, and rings on gas giants. Moons keep the WP8 looks and gain surfaces. The nozzle plume stays. The flown trail stays gone. Visual only; prediction still matches flight. |
| Ship systems package (after WP8; number not assigned yet) | Done, 2026-10-29 in [PR #25](https://github.com/stepwaec/slingshot/pull/25) | Hull bar. Collisions empty the hull. Close passes and tidal stress (white dwarfs, neutron stars, black holes, scaled by `tidalStrength`) drain it, and 0 hull fails the mission. A red zone marks that stress on the gravity grid while G is on. Solar recharge refills fuel near stars, scaled by distance, and only when the solar upgrade is fit. Upgrade screen spends points on hull, tanks, solar and engines; each adds mass, which scales burn delta-v. Placeholder bars until Claude's art. |
| WP9: compact objects plus magnetism layer | Done, 2026-10-29 in [PR #27](https://github.com/stepwaec/slingshot/pull/27) | Quiet neutron star (Needle), pulsar (Pulse) and magnetar (Quake) use the WP9 SVGs. Pulsar beams spin on sim time and damage the hull; the prediction matches that flight. Magnetars scramble the drawn path by a deterministic dipole spread that never changes the trajectory. Rescue's black hole gains a tilted disk, Doppler shift, an Einstein ring and lensed arcs. Magnetism map: M or the Magnetism button, separate from G, colours safe through lethal for magnetars, neutron stars and gas giants. The toggle does not change the sim. |
| WP10: environment and resources | Done, 2026-10-29 in [PR #31](https://github.com/stepwaec/slingshot/pull/31) | Comets (Ice, Drift) ride Kepler ellipses in `bodyPose`, fast at periapsis, and the ship harvests ice inside the coma. Nebulae (Veil, Drift) scoop fuel; a dark cloud hides the bodies under it. The solar recharge indicator, gold path dots and the `+fuel` line all read the same rate the tank integrates. Prediction matches the flight, including the moving comet and the scooped fuel. |
| Design fidelity | Done, merged 2026-10-29 in [PR #32](https://github.com/stepwaec/slingshot/pull/32) | Bodies are drawn from Claude's SVG files in `design/assets` (the art from PRs #17, #19, #22 and #26), rasterized in sRGB with no mipmaps, instead of procedural stand-ins. The sun is `star.svg`. Chemical and ion plumes are longer, still blue-white at the nozzle fading to violet, and the drawn length still follows burn size. Physics and prediction are unchanged. `design/IMPLEMENTING.md` was not on main yet. |
| Art motion | Done, merged 2026-10-29 in [PR #33](https://github.com/stepwaec/slingshot/pull/33) | Sun prominences and the flare follow the timelines in `star.svg` instead of sitting at the rest frame. The comet tail is its own sprite: it points away from the star and shortens with `clamp(Rperi / d, 0.35, 1)`. Pulse's painted beams end on the level's damage reach. Planet sprites still turn their lit side toward the brightest star. Visual only. |
| Implementation review | Done, merged 2026-10-29 in [PR #35](https://github.com/stepwaec/slingshot/pull/35) | Follows `design/IMPLEMENTING.md` through the visual items in `design/IMPLEMENTATION-REVIEW.md`. The sun's haze breathes and its flame and wisp rings turn. The ship frame is centred on the ship, and the longer plume still starts at the engine throat. SVG rasters bake at DPR × zoom bucket with mipmaps. The comet's dust tail mirrors with its orbit. Nebulae draw behind bodies. Prediction is unchanged. |
| Plume, burn nodes and gravity-grid ink | In progress, opened 2026-10-30 in [PR #49](https://github.com/stepwaec/slingshot/pull/49) | Claude's [PR #36](https://github.com/stepwaec/slingshot/pull/36) in the game. The chemical plume is longer for a bigger burn (capped at 110 design units, 44 plus 12 per unit of delta-v), blue-white into violet, with no halo, and it stays on screen for the existing tail. The burn is still one sim step. Nodes are blue-violet rings (selected, placing, over budget, wind-up, ignition, fired). The gravity grid and sheet keep their warp and take the new ink: depth-tinted lines, dark glass, and a dashed tidal ring. Physics and body sprites are unchanged. |
| Lighter prediction line | In progress | Visual tweak: a lighter prediction line. |
| Remaining visual review | In progress, opened 2026-10-29 in [PR #38](https://github.com/stepwaec/slingshot/pull/38) | Home, Planet X and gas giants scroll their strips under a separate light layer. The comet's ion wind, knot and coma move. The magnetar's dashes, grain and starquake run. The red giant's drag edge crawls. The recharge HUD and the shipyard follow their SVG headers. The recharge cutoff, Kepler speeds and every other physics note stay unchanged. |
| WP11: hazards plus radiation | Done, merged 2026-10-29 in [PR #42](https://github.com/stepwaec/slingshot/pull/42) and [PR #43](https://github.com/stepwaec/slingshot/pull/43). | Radiation: stars, flares, magnetic belts, pulsar beams, black-hole disks and cosmic background feed one dose field. Crew dose integrates in the sim step (the limit fails the mission), shielding halves it and adds mass, a planet's disc shadows a star and its flare, and a Radiation button draws the halftone map. Levels Shade and Wander. Rogue planets drift in a straight line. This pass adds seeded asteroid belts (sparse, medium, dense) and the Kuiper belt: rocks with r ≥ 7 crash (Kuiper r ≥ 5), dense dust can drain hull, shielding halves that, and the edges show in planning. Levels Weave and Frost. |
| WP12: dramatic events | Done, 2026-10-29 in [PR #46](https://github.com/stepwaec/slingshot/pull/46) | Supernova countdowns (get out before the star explodes), shockwaves from supernova remnants, quasars. Flash: the sun detonates at a sim time, the blast is lethal, and the remnant shell crosses the ship once. A quasar jet burns hull on sim time. There is no art for either in `design/`, so the rings and the jet bar are placeholders. |
| WP13: three-body chaos | Planned | Multi-sun systems (Trisolaran style) where three-body chaos means planning uses widening probability cones instead of exact lines. |
| WP14: world builder | Planned | Build and share levels, using the JSON level format from WP7c. |
| WP15: galaxy map | Planned | A galaxy-scale mission map where galaxies move relative to each other; each level stays one solar system. |
| Orbit capture | Planned | Scheduled after the remaining megastructures (ringworld, space elevator, wormhole pair) and the #36 visuals ([PR #36](https://github.com/stepwaec/slingshot/pull/36)), before WP12-follow-ups/late game. A level counts as complete only when the ship reaches a stable orbit around the target, and that orbit must come from a capture burn made inside the target zone. Flybys and crashes don't count. Feedback: an "orbit stable" state, and a hint when the ship is in the zone but too fast. The prediction shows the resulting orbit. Deterministic, coordinated with LU2 moving (Kepler on-rails) targets. Scoring may reward an efficient capture burn. Acceptance: tests for capture vs flyby vs crash, and prediction matches flight. |
| Sol campaign | Planned | Scheduled after LU2 (moving bodies, done in [PR #45](https://github.com/stepwaec/slingshot/pull/45)) and Orbit capture. It depends on both. The campaign opens in our solar system with the real Sun and planets, all moving from level 1, then ventures out to the existing star levels. Draft missions: (1) Moon orbit, a tutorial for burning and capturing into orbit; (2) Mars transfer, the first launch window, lead a moving target; (3) Venus slingshot inward to Mercury, with solar heat; (4) Jupiter assist with a radiation belt; (5) Saturn's rings and a Titan capture; (6) Kuiper belt and heliopause as the jump to the star levels. Build missions 1, 2 and 4 first. Realism vs fun: real planet order, relative sizes and Kepler orbits, but compressed distances and sped-up time so a transfer takes about a minute; time-warp on long cruise stretches; slightly boosted gravity early on; start near a launch window with a "next window" hint if missed. Easter eggs: a Voyager probe, a monolith near Jupiter, a dimming-sun teaser (Project Hail Mary). Cruise time-warp is the planning preview slider and the 8×, 16× and 32× speeds: more fixed steps per frame, never a larger `dt`, with the preview growing for the long transfers. The James Webb Space Telescope is a prop at the Sun-Earth L2 point, on the Sun-Earth line just beyond Earth, co-rotating with Earth: small, no collision like Voyager, with a small halo-orbit wobble around L2, shown in the gallery/Observatory too. A later mission, JWST maintenance: fly to L2 and match a halo orbit or rendezvous with Webb. L2 is unstable, so it is a station-keeping challenge. The Sol bodies are in the Observatory ([PR #73](https://github.com/stepwaec/slingshot/pull/73)). Mission 1 (Moon orbit) must match `design/mockups/sol-moon.svg` and comes after Orbit capture. It is not built yet. |
| Astrophage | Planned | Scheduled after the Sol campaign. Project Hail Mary nod. First version: (a) Astrophage fuel harvested with the gas scoop near infected stars, very energy-dense, powers a late-game "spin drive" engine; (b) Petrova line: a faint glowing streak of Astrophage between a star and its planet that the player can follow to find fuel; (c) Tau Ceti level: the one uninfected star; the mission is to find out why and bring the answer home. Parked later ideas: spreading infection that dims stars; curing stars with Taumoeba. Easter-egg references stay as hints only. |
| Retire legacy levels | Planned | Remove the current levels only after the Observatory/Gallery showcase level and Sol campaign missions 1, 2 and 4 (Moon, Mars, Jupiter) are merged, so the game always has playable levels. Before deleting, preserve any mechanic or object that only exists in an old level by moving it into the Observatory or a later campaign mission, and list those carry-overs in the roadmap. Update tests and the level select. Git history keeps the old levels. |
| Late game: easter eggs and megastructures (after WP13) | In progress, opened 2026-10-30 in [PR #55](https://github.com/stepwaec/slingshot/pull/55) | Stellar engine, Dyson swarm and Shkadov thruster from the PR #40 designs, in the game in [PR #48](https://github.com/stepwaec/slingshot/pull/48). Ringworld, the space elevator and the wormhole pair are in [PR #55](https://github.com/stepwaec/slingshot/pull/55). Torch is the stellar-engine level: the jet core burns hull, the margins refill fuel, and the stream pushes the ship. A Dyson swarm multiplies that star's solar recharge by 1 − coverage and nicks hull on a collector shell. A Shkadov mirror is solid, and every body drifts toward it. Ringworld, the space elevator and the wormhole pair share one geometry module with the drawing. Hoop crosses two gaps in a solid ring (the ring's own pull cancels at the centre and points outward inside). Cable starts on the counterweight and leaves at ω × r; the tether itself crashes. Fold enters a wormhole mouth and comes out of the other with its speed kept and its heading turned; the exit adds its clock offset to outside time, and the trip back subtracts it. Easter eggs are still undecided. |
| Observatory | In progress, opened 2026-10-30 in [PR #69](https://github.com/stepwaec/slingshot/pull/69) | A showcase chart, separate from the campaign, listed in the level menu under Showcase. Built at load from the body and visual registries (looks, kinds, nebula looks, belt tiers, hazard kinds, megastructure slots, engine plumes, ship-build flags), so a newly registered type is placed on its own. A test fails if one is missing. Every star, planet, compact object, nebula, comet, asteroid and Kuiper field, rogue planet, hazard, megastructure and ship build sits in its own cell with a name label. Gravity, magnetism and radiation overlays work. The chart pans and zooms. It can be flown: bodies are static except the rogue's slow drift, cells are spaced, and the damaging rates on the exhibits are off so the gaps stay safe. Rings, tethers and belt rocks stay solid. The ship starts on a slow circle around Home. Physics and the existing levels are unchanged. |
| Cryosleep | Planned | Late ship upgrade, scheduled after the Sol campaign. (1) Crew lifespan: the crew ages in ship time until the lifespan runs out; crew death loses the mission; a lifespan meter is in the HUD. (2) Aging stops completely during cryosleep. (3) Planning: in the trajectory planner the player marks a start and an end point on the predicted path; the crew sleeps between them; that stretch is a tinted section of the trajectory line. (4) Cryosleep is an unlockable upgrade using the existing cryo module from the ship designs. (5) Deterministic, consistent with the two clocks (ship time and outside time) and time dilation. Optional extras: a groggy wake-up penalty, and an autopilot wake on danger. A long sleep coast uses the same preview slider and warp as the Sol campaign cruise. |
| Prediction length | In progress, opened 2026-10-30 in [PR #68](https://github.com/stepwaec/slingshot/pull/68) | Planning slider for how far the predicted line runs. It sets a fixed extension past the latest burn, or past the ship when the plan has no burns. The default is today's look-ahead. The maximum grows with the level bounds, so an interstellar chart can preview much further than a small system. Integration stays on the flight `dt`. A step cap bounds the work, and a path longer than the stroke buffer is drawn with a stride. This is the planning half of the time warp the Sol campaign uses on cruise stretches, and of the long coasts Cryosleep will mark. |
| Faster sim speeds | In progress, opened 2026-10-30 in [PR #68](https://github.com/stepwaec/slingshot/pull/68) | 8×, 16× and 32× above the existing 4×. A level may set `maxSpeed` in its JSON; omitted levels allow 32×. Higher speed is more fixed substeps per frame, never a bigger `dt`, so 1× and 32× fly the same plan bit for bit. Keys are 1, 2, 4, 8, comma and period, shown on the flight buttons. R, G, M and D stay where they are. Same warp the Sol campaign cruise and Cryosleep coasts use. |
| Map layers rework | Done, step A in [PR #63](https://github.com/stepwaec/slingshot/pull/63) | Two steps, shipped as separate PRs. (A) One gravity layer: the bending grid drawn over a time-dilation heat map coloured by rest-frame clock rate (how fast time runs). The tilted sheet and the separate clock-rate control (the Clock rate button and the C key) are removed, so Gravity is on or off. Prediction and physics stay on the same field. (B) Done. A styled Layers menu replaces the separate top-bar buttons. Each layer has a switch, a small legend and a key hint: Gravity (G), Magnetism (M), Radiation (D; R stays reset). Only layers that apply to the current level can be switched on. The others stay in the menu, disabled, with a short reason. The menu can take a later layer without a new button. |
| Tidal stress layer | Planned | Scheduled after the two priority bug fixes and Map layers PR B. Replaces the dashed tidal-warning ring with a gradual tidal-stress heat map as its own layer in the Layers menu: clear far away, hot near dense bodies, no hard line. Hull damage becomes gradual, growing with tidal stress instead of a threshold at the ring. Deterministic; prediction matches flight. Acceptance: tests for damage rate vs distance, and prediction matches flight. |

## Living universe

Physics stays game-like but true to its real shape, and prediction always matches the flight.

| Package | Status | Scope |
| --- | --- | --- |
| LU1: lively surfaces | Done, merged 2026-10-29 in [PR #41](https://github.com/stepwaec/slingshot/pull/41) | Subtle animation on every body: star granulation and flares, gas giant bands drifting, cloud layers moving, planets rotating. Visual only. Home, Planet X and gas giants already scroll from the visual review. This pass adds the moons and the dwarf on the same strips, turns the sun's granulation under a fixed limb, and plays the red giant's flare on the sun's 22 s timeline. |
| LU2: moving bodies | Done, 2026-10-29 in [PR #45](https://github.com/stepwaec/slingshot/pull/45) | Planets orbit stars or black holes, and moons orbit planets, on deterministic on-rails Kepler orbits where position is a function of time. Prediction uses the bodies' future positions, with ghost markers for the target's future position. Reuse the elliptical comet orbits. Start with one or two levels. Lead puts Planet X on a Kepler circle around its sun. The marker is Claude's ghost-marker design ([PR #51](https://github.com/stepwaec/slingshot/pull/51)), in the game in [PR #64](https://github.com/stepwaec/slingshot/pull/64). |
| LU3: scripted collisions and consumption | Done, 2026-10-29 in [PR #47](https://github.com/stepwaec/slingshot/pull/47). Event art designed in [PR #50](https://github.com/stepwaec/slingshot/pull/50) and drawn in [PR #57](https://github.com/stepwaec/slingshot/pull/57). | Timed, deterministic events: a comet hits a planet, a planet spirals into a star and burns up, a star is pulled into a black hole's accretion disk. Debris and changing gravity become gameplay (escape windows, narrowing gaps). Ash is the showcase: Planet X spirals into its sun and the ship must be in orbit before it is gone. An impact script removes the impactor at a set time. The burn-up, impact flash and debris field are the event drawings. Tidal disruption and accretion are still proposed scripts. |
| LU4: level design that uses motion | Planned | Launch windows, catching up with a moving target, and moon slingshots. |

**Showcase level:** the target planet spirals into its star, and the player must arrive and settle into a stable orbit before it burns up. It uses LU2 and LU3.

## Full object list

**In the game today**
- Spaceship with fuel and up to two queued burns.
- Start planet (Home) and Planet X (must be reached and orbited).
- Stars and planets that bend the path for slingshots.
- Moons; planets and moons move on orbits (WP4).
- A black hole with a horizon in the Rescue level (WP5), drawn with a tilted accretion disk, Doppler shift and lensed arcs (WP9).
- Binary stars, a white dwarf, and a red giant with a drag atmosphere (WP8, levels Pair and Ember).
- A gas giant with a chain of four moons (WP8, level Chain). Needle adds a gas giant with a magnetic field.
- A quiet neutron star (Needle), a pulsar whose beams damage on a rhythm (Pulse), and a magnetar whose field fuzzes the predicted path (Quake). The magnetism map toggles with M.
- Comets on elliptical orbits, with ice harvest (Ice, Drift). Nebulae that scoop fuel; a dark cloud hides what is inside (Veil, Drift).
- Radiation (Shade, Wander): starlight, solar flares, gas-giant and magnetar belts, pulsar beams, black-hole disks and a cosmic background. The dose meter names the dominant source. A planet disc blocks a star and its flare. Shielding halves crew dose and adds mass. The Radiation button toggles a halftone map.
- A rogue planet (Wander) that drifts in a straight line, has gravity, and gives no recharge.
- Asteroid belts (Weave) and a Kuiper belt (Frost). Seeded rocks. The large ones are solid. Dense dust can drain the hull, and shielding halves that.
- Planet X on a Kepler orbit around its sun (Lead). Ghost markers show where a moving body will be at each burn, under the cursor, and at arrival.
- A supernova with a lethal blast and a remnant shock, and a quasar jet (Flash). The drawings are placeholders.
- Planet X spiralling into its sun (Ash). The ship has to be in orbit before the planet is consumed. The fall shows a dayside glow and an ablation tail, then a plunge flash on the sun.
- Observatory, from the level menu and not a campaign mission: one of every object above, including the ringworld, space elevator and wormhole pair, each with a name label. Gravity, magnetism and radiation overlays. Pannable, zoomable and flyable.
- A stellar engine (Torch), a Dyson swarm and a Shkadov thruster. The jet core burns, the margins refill, a collector nicks hull, and the mirror is solid.
- A ringworld (Hoop): a solid band with transit gaps. Inside, the ring's pull cancels at the centre.
- A space elevator (Cable): a solid tether, and a counterweight that throws the ship off at ω × r.
- A wormhole pair (Fold): entering a mouth moves the ship to the other one and shifts outside time by the exit's clock offset.

**Planned, by package**
- Asteroid belts in sparse, medium and dense tiers, and a Kuiper belt (Weave, Frost). Rocks are seeded. Large ones crash the ship. Dense dust can drain hull, and shielding halves that.
- Stray asteroids that are not part of a belt are still open.
- WP13: multi-sun (three-body) systems.
- WP15: star clusters, galaxies and galaxy clusters as the zooming mission map; supermassive black holes as the anchor of a galaxy-level map.
- Other ideas mentioned, not assigned: gas clouds to scoop (original design doc), pickups such as fuel caches and derelict probes, in-flight surprises such as a sensor glitch.

Inspiration list: [Wikipedia, Lists of astronomical objects](https://en.wikipedia.org/wiki/Lists_of_astronomical_objects).

## Ship systems and the upgrade tree

The ship systems package (after WP8) adds hull health, damage (collisions, close passes, tidal stress), solar recharge and a basic upgrade screen. Upgrades are bought with stars or points earned in levels, and new upgrades are added as each later package brings its hazards.

**Key rule:** every upgrade has a trade-off, mainly mass. A heavier ship needs more fuel, so players cannot max everything and must pick a build per mission.

Every upgrade is visible on the modular ship: hull plating or structural strength, shielding, engines (chemical, ion and pulse, each with its own nozzle and plume), larger fuel tanks, solar panels, a gas scoop, sensors, and a cryosleep module.

| Upgrade | What it does | Trade-off |
| --- | --- | --- |
| Hull strength | Resists tidal stress and impacts. | Mass. |
| Shielding | Halves crew dose. Magnetic and impact protection (for example for dense asteroid belts) are still open. | Mass. |
| Engines | Chemical, then ion (efficient but weak), then pulse (powerful but thirsty). | Ion: low thrust. Pulse: high fuel use. Mass otherwise. |
| Fuel tanks | More capacity. | Heavier. |
| Solar panels | Faster recharge near stars. | Mass. |
| Gas scoop | Harvests fuel from nebulae and gas giants. | Mass. |
| Sensors | Longer planning horizon, less fuzziness near magnetars. | Mass. |
| Cryosleep (time systems) | Slows crew ageing, which helps the ship-time score. | Mass. |

*Uncertain:* the exact trade-off per upgrade beyond "mainly mass" was not specified.

## Megastructures and exotic objects

Confirmed by Stephan on 2026-10-29 for the late game. The six structures below are in the game. Easter eggs are still undecided:

- **Stellar engine:** a star turned into a rocket, with a fuel-rich jet to scoop from.
- **Dyson swarm:** a cloud of solar collectors to weave through; dims the star, so solar recharge drops.
- **Ringworld:** a giant ring around a star that you can fly through.
- **Shkadov thruster:** a huge mirror slowly pushing a star, so the whole system drifts.
- **Space elevator or orbital ring:** a free launch boost from a planet.
- **Wormholes:** shortcuts whose exit lands you somewhere with a different clock.

## Easter eggs

Rare and optional, so they feel like real discoveries; placed after WP13.

- **Dyson sphere:** a star partly wrapped in a shell; it dims the star (less solar recharge) and has gaps to slingshot through.
- **Alien probes:** other ships flying their own slingshot routes; following one may reveal a shortcut.
- **Derelict ships:** wrecks to salvage for rare upgrades.
- **Ringworld or space station:** a refuel stop, or a secret level behind it.
- **Signal beacons:** decode a pattern of pulses to unlock lore or a bonus mission.
- **Wormhole:** a rare portal across the map with its own time-dilation twist.
- **Sci-fi nods:** a monolith, a Voyager-style golden record, a Trisolaran fleet.

### Pop-culture references

- **Star Trek:** a "Kobayashi Maru" level you can only win with a trick; a Dyson sphere nod (there is one in The Next Generation); a "Make it so" achievement; a warp-bubble ship with a saucer-like silhouette.
- **Star Wars:** a "Never tell me the odds" achievement for an asteroid belt; a Kessel Run level finished in under 12 parsecs; a twin-sun desert planet in the binary star levels.
- **The Hitchhiker's Guide to the Galaxy:** a planet at coordinates 42; a towel as a hidden collectible; "Don't panic" on the crash screen.
- **Interstellar:** a water planet near a black hole where 1 hour costs 7 years.
- **2001: A Space Odyssey:** a black monolith orbiting a gas giant (Jupiter).
- **The Three-Body Problem:** a Trisolaran fleet in the three-sun levels.
- **The Expanse:** a ring gate as the wormhole design.
- **Project Hail Mary (Andy Weir):** must-have. A friendly alien ship named after Rocky's "fist my bump"; a Tau Ceti system level; "Astrophage" as a star-dimming hazard or a high-energy fuel pickup; an achievement "Amaze! Amaze! Amaze!"; a relativistic long-haul mission where crew time versus outside time matters.

**Copyright note:** keep these as playful hints only: names, quotes and silhouettes. No logos, actual ship designs or characters, to avoid copyright trouble if the game is ever published.

## Backlog ideas

Kept in mind, not scheduled:

- Matrioshka brain (nested shells around a star, glowing with waste heat).
- Jump gates (a fixed network of portals).
- Alcubierre warp bubble (a short faster-than-light dash with odd time effects).
- Mass drivers (launch rails that fling you at a set speed and angle).
- Gravity tugs (alien ships that drag asteroids or bend your path).
- Generation ships (slow arks drifting between stars).
- Von Neumann probes (self-copying machines that multiply over time).
- Ruins (shattered planets or broken Dyson shells).
- Mining colonies on asteroids (refuel stop or trading post).
- Beacons and buoys (lore and hints).
- Cosmic strings (thin lines of extreme gravity that bend space sharply).
- White holes (push you away; theoretical, never observed).
- Negative-gravity fields (exotic matter areas that push instead of pull).

Other gameplay ideas raised by Brainstormer and not yet scheduled: realistic visuals pass (textured lit planets, bloom, real starfields, lensing black holes, a 3D ship); menus and settings; saved plan snapshots and a parallax layer (original design doc); in-flight surprises and pickups; multi-stop missions; ghost runs; a daily challenge with a leaderboard; a campaign from a calm solar system to black holes and three-sun chaos; levels where the player places planets; a black hole "waiting room" to skip outside time.

## Open decisions

- **Game name:** not chosen. Dilation leads; Proper Time is the other favourite (see DESIGN.md). Availability checks not done.
- **WP8 object designs:** landed with the v2 pack in PR #17. Pair, Ember and Chain use them.
- **Ship systems package number:** the package landed after WP8 without a WP number.
- **Upgrade currency and costs:** "stars or points" is not decided in detail.
- **Gravity map performance:** 60 fps on a real GPU not yet confirmed (the no-GPU test machine showed 23 to 16 fps with the map on).
- **Realistic visuals:** when to do the realism pass, and whether Claude's next update covers it.
- **Gravity map cost in flight:** Brainstormer suggested it could be free in planning but cost energy in flight, or be unlocked by a tutorial; not decided.
- **Easter eggs and megastructures:** the stellar engine, Dyson swarm and Shkadov thruster are in the game in [PR #48](https://github.com/stepwaec/slingshot/pull/48). Ringworld (Hoop), the space elevator (Cable) and the wormhole pair (Fold) are in [PR #55](https://github.com/stepwaec/slingshot/pull/55). Easter eggs are still undecided.

## Design requests for Claude

Stephan points Claude at this section for the next visual pack.

**WP8:** fully designed in [PR #17](https://github.com/stepwaec/slingshot/pull/17).

**WP9:** fully designed in [PR #19](https://github.com/stepwaec/slingshot/pull/19) (pulsar, magnetar, magnetism heatmap, quiet neutron star) and in the game in [PR #27](https://github.com/stepwaec/slingshot/pull/27). Nothing from that pack is still open.

**WP10:** fully designed in [PR #22](https://github.com/stepwaec/slingshot/pull/22) (comet, solar recharge indicator) and in the game in [PR #31](https://github.com/stepwaec/slingshot/pull/31). Nothing from that pack is still open.

**Ship systems:** fully designed in [PR #26](https://github.com/stepwaec/slingshot/pull/26). That pack includes the hull bar, the tidal-stress warning, and the upgrade screen, and the modular spacecraft redesign: a base hull with visible hull plating, shielding, chemical, ion and pulse engines, larger fuel tanks, solar panels, a gas scoop, sensors, a cryosleep module, and damage states that match the hull bar.

**WP11:** designed in [PR #34](https://github.com/stepwaec/slingshot/pull/34) (sparse, medium and dense asteroid belts, Kuiper belt, rogue planet, radiation heatmap, dose meter). The radiation slice is in the game in [PR #42](https://github.com/stepwaec/slingshot/pull/42). The belt fields (seeded rocks, crash radii, Kuiper belt, dust damage) are in [PR #43](https://github.com/stepwaec/slingshot/pull/43). A lone stray asteroid, outside a belt, is still open.

**Burn plume, burn node and gravity grid styling:** done in [PR #36](https://github.com/stepwaec/slingshot/pull/36). The plume is blue-to-violet, with no trailing halo. The game draws that pack in [PR #49](https://github.com/stepwaec/slingshot/pull/49): plume length follows burn size, nodes are the blue-violet rings, and the gravity grid uses the depth ink. Physics and the body sprites are unchanged.

**Late game, wormholes and living surfaces:** done in [PR #40](https://github.com/stepwaec/slingshot/pull/40). That pack is the stellar engine, Dyson swarm, ringworld, Shkadov thruster, space elevator and wormhole (`design/assets/mega/`, `design/mockups/late-game.svg`), plus living surfaces: `design/assets/star-surface-motion.svg` and `style.md` §13, which gives granulation, flares, band drift, clouds and rotation per body type.

The stellar engine, Dyson swarm and Shkadov thruster from that pack are in the game in [PR #48](https://github.com/stepwaec/slingshot/pull/48). Ringworld, the space elevator and the wormhole pair are in [PR #55](https://github.com/stepwaec/slingshot/pull/55) as Hoop, Cable and Fold. The Dyson header draws the star at opacity 0.72 and also says recharge ×0.4. The game uses one level `coverage` for both, so the drawn star and the recharge factor are both `1 − coverage`. Burn rate, scoop rate, jet push, collector nick and drift acceleration are level knobs; the headers describe the roles and do not number them.

The ring's transit gaps are holes in the solid band. Its gravity stays that of a uniform ring, so the pull still cancels at the centre; the gap does not remove mass. The field is softened by the band's half-width so a ship can cross a gap without a singularity. The elevator's angle is `phase + ωt` on sim time, because the tether is a hazard. The planet's painted surface still scrolls on `frame.now`. Cable's planning chip prints `|ω × r|` (16.2 for that level). The sample SVG's "free Δv 2.4" is the header's placeholder, not a second number. A wormhole puts the ship at the other mouth's centre, keeps the speed, and turns the heading by the pair's angle (the opposite turn on the way back). Arriving at the exit adds `clockOffset` to outside time; arriving at the entrance subtracts it. Orbits keep using `step × dt`. Fold's chip prints "exit clock +18 s". The sample "+3.2 h" is the same chip for an offset of 3.2 hours. Ring city lights are a stable pattern along the arc, not the SVG's painted dots, because the band is a continuous strip scaled from the sample.

**Collisions and consumption** (LU3): designed in [PR #50](https://github.com/stepwaec/slingshot/pull/50) and implemented in [PR #57](https://github.com/stepwaec/slingshot/pull/57). Ash's burn-up, the impact flash, the shock, the ejecta, the crater glow and the debris field replace the orange ring. Planning shows the telegraphs. Tidal disruption and a star falling into an accretion disk stay proposed scripts (`disrupt`, `accrete`). PR #47 did not add them, and this pass does not change gravity.

**Ghost markers** (LU2): designed in [PR #51](https://github.com/stepwaec/slingshot/pull/51) and implemented in [PR #64](https://github.com/stepwaec/slingshot/pull/64). Planning and pause draw where a moving body will be: the ring and inner ring, the burn badge, the cursor, the arrival capture radius, the collision and gone states, dotted tie lines, time chips, and the target's future track with a tick every 10 s. The markers read `bodyPose`. They do not write the sim.

**Map layers rework:** (A) is in the game with a stand-in palette made of existing tokens, because `design/` has no header for a combined gravity and clock-rate field. (B) the Layers menu is done.

**Target zone:** designed in [PR #62](https://github.com/stepwaec/slingshot/pull/62) and drawn in [PR #66](https://github.com/stepwaec/slingshot/pull/66). Planet X's capture radius is a solid mint ring with a glow band that pulses over 4 s. It holds steady and brighter while the ship is inside the zone, flashes once when the flight is won, then rests on the ice colour. The dashed crawling ring and the zone fill baked into the planet sprite are gone. The stable-orbit hook is `targetZonePhase` in `src/render/target-zone.ts`, which reads `ship.status === "won"`. The Orbit capture work package can replace that rule there. Physics and prediction are unchanged. The exit arc, the Δv hint, the planning entry tick, the capture-orbit stroke and the flyby cross wait for that package. The dotted capture ellipse on the predicted path stays.

**Open requests**, in priority order:

1. **A lone stray asteroid**, outside a belt. The WP11 note above still stands: `design/` has the belt fields and the rogue planet, not a stray rock.
2. **Supernova and quasar art.** The countdown, the remnant shock, and the quasar jet are in the game as placeholders. `design/` has no asset for them.
3. **Sol bodies.** Real Sol bodies for the Sol campaign: Sun, Mercury, Venus, Earth with the Moon, Mars, Jupiter, Saturn with rings, Titan, Uranus, Neptune, Kuiper objects, plus Voyager. Designed in [PR #67](https://github.com/stepwaec/slingshot/pull/67) and implemented in [PR #73](https://github.com/stepwaec/slingshot/pull/73). The Observatory places each look from the object library. Mission 1 (Moon orbit) must match `design/mockups/sol-moon.svg` and comes after Orbit capture. The capture rules are not part of this pass.
4. **Astrophage.** Infected stars, the Petrova line, Astrophage fuel pickups, the spin drive engine and its plume, the Tau Ceti system.
5. **Cryosleep.** A lifespan HUD meter, the sleep segment on the trajectory line, and cryo-pod states.
6. **Gravity and time heat map.** One layer, in planning and pause: the bending gravity grid (the existing depth ink) drawn over a field coloured by rest-frame clock rate, velocity zero, the same rate the sim already stores. Colour says how fast time runs: cool and clear where a clock runs at full rate, warm where it slows, hottest where it stops. Crisp, no grey, and the warm colours must stay true over the navy sky. The grid lines stay readable on top of the field. The game is shipping a stand-in ramp from existing tokens: `path` #DCE4FF at full rate (alpha 0), `planetStartBase` #3D8BFF while the clock is only a little slow (alpha 0.10 at dτ/dt 0.82, 0.50 at 0.55), then `fuelLow` #FFC857 at 0.4 (alpha 0.74), `starCorona` #FF8C2E at 0.2 (alpha 0.80) and `starGlow` #FF5A1F where time has stopped (alpha 0.84). The gold is already opaque so it does not turn olive over the navy. The field is sampled at rate^2.4 so a mild slowdown still reads at game scale; the stored rate is unchanged. Replace that stand-in.
7. **Layers menu.** Done. A styled panel that replaces the separate Gravity, Magnetism and Radiation buttons. Each layer has a switch, a small legend and a key hint: Gravity (G), Magnetism (M), Radiation (D). R stays reset. C was the clock-rate toggle and is free again; do not give it to radiation. Only layers that apply to the current level can be switched on. The others are shown disabled, with a short reason (for example no magnetic body, or this level has no radiation). The panel should accept a later layer without a new top-bar button.
8. **Preview slider and warp speeds.** The planning preview slider and the 8×, 16× and 32× flight buttons are in the game as a stand-in from the existing HUD tokens (panel, border, accent, mono). Design the slider for the planning dock and the speed group for flight, including the key hints (1, 2, 4, 8, comma, period). R, G, M and D stay on reset, gravity, magnetism and radiation.
9. **JWST.** A gold hexagonal mirror and a sunshield.
10. **Tidal stress heat map.** A palette distinct from the gravity/time heat map.

**Guidelines:** a realistic and vibrant style matching v1.5 and v2; SVG files under `design/assets/`; easter eggs only as hints, never logos or characters.

**Rules:** [design/IMPLEMENTING.md](../design/IMPLEMENTING.md) and [design/IMPLEMENTATION-REVIEW.md](../design/IMPLEMENTATION-REVIEW.md) are rules every design implementation must follow.

**For the implementing agents (Cursor, Grok):** before building any design pack, read [design/IMPLEMENTING.md](../design/IMPLEMENTING.md). It sets the order of precedence (the asset header is canon), the fidelity rules (exact tokens, crisp edges, no grey, hazards on sim time) and the realism rules for the engine (field laws, determinism, seeded placement). Claude reviewed `main` against the designs, including PR #32, in [design/IMPLEMENTATION-REVIEW.md](../design/IMPLEMENTATION-REVIEW.md), which lists each gap with its file, line and fix. Top fixes, in priority order:

1. Ship sprites are anchored on the frame middle instead of the ship centre (`ship.ts:77`): translate the frame by −16.
2. Since PR #32, every SVG body is a frozen picture, so the sun's flames, the turning planets, the gas-giant bands and the comet flow no longer move. Bake each animated layer separately and replay its header timing (layer ids are in the review).
3. The SVG rasters soften above zoom 1 and alias when zoomed out: bake by DPR × zoom bucket, or use mips.
4. The pulsar's drawn beams (228) are longer than its damage reach (180): draw the beams as their own quad scaled to `beam.reach`.
5. The comet's tails don't scale with distance, and its dust tail isn't mirrored to trail the motion.
6. Solar recharge cutoff and luminosity are in the sim (`rateMax · L · min(1, (85/d)²)`, off below 8 %), landed in [PR #37](https://github.com/stepwaec/slingshot/pull/37). The HUD glyph, shimmer and ghost are still open.
7. Relay's moon, Pair's binary and Chain's moons now follow Kepler, with a loader lint. Done in [PR #37](https://github.com/stepwaec/slingshot/pull/37).
8. The shipyard cards lack thumbnails, tiers, mass and cost: follow `upgrade-screen.svg`.
9. Nebulae draw above the bodies: give them a negative renderOrder.

## How this document is maintained

Engineering Manager keeps ROADMAP.md and DESIGN.md current in the repo. When a package lands, it updates the status and PR link in the table, moves scope changes into the right section, and tells Stephan what changed. New ideas from Stephan or Brainstormer go into the backlog or the relevant package after Stephan confirms them.
