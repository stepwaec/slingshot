# Slingshot: roadmap

Repository: [stepwaec/slingshot](https://github.com/stepwaec/slingshot). Game design, physics rules and architecture are in [DESIGN.md](DESIGN.md).

Last updated: 2026-10-29 (Europe/Zurich).

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
| Remaining visual review | In progress, opened 2026-10-29 in [PR #38](https://github.com/stepwaec/slingshot/pull/38) | Home, Planet X and gas giants scroll their strips under a separate light layer. The comet's ion wind, knot and coma move. The magnetar's dashes, grain and starquake run. The red giant's drag edge crawls. The recharge HUD and the shipyard follow their SVG headers. The recharge cutoff, Kepler speeds and every other physics note stay unchanged. |
| WP11: hazards plus radiation | In progress, opened 2026-10-29 in [PR #42](https://github.com/stepwaec/slingshot/pull/42) | Radiation slice: stars, flares, magnetic belts, pulsar beams, black-hole disks and cosmic background feed one dose field. Crew dose integrates in the sim step (the limit fails the mission), shielding halves it and adds mass, a planet's disc shadows a star and its flare, and a Radiation button draws the halftone map in planning and pause. Levels Shade and Wander. Rogue planets drift in a straight line and still pull. Asteroid and Kuiper rock fields are still planned. |
| WP12: dramatic events | Planned | Supernova countdowns (get out before the star explodes), shockwaves from supernova remnants, quasars. |
| WP13: three-body chaos | Planned | Multi-sun systems (Trisolaran style) where three-body chaos means planning uses widening probability cones instead of exact lines. |
| WP14: world builder | Planned | Build and share levels, using the JSON level format from WP7c. |
| WP15: galaxy map | Planned | A galaxy-scale mission map where galaxies move relative to each other; each level stays one solar system. |
| Late game: easter eggs and megastructures (after WP13) | Planned, no package number | Rare, optional easter eggs and the megastructures and exotic objects listed below. Scope with Stephan later. |

## Living universe

Physics stays game-like but true to its real shape, and prediction always matches the flight.

| Package | Status | Scope |
| --- | --- | --- |
| LU1: lively surfaces | In progress, opened 2026-10-29 in [PR #41](https://github.com/stepwaec/slingshot/pull/41) | Subtle animation on every body: star granulation and flares, gas giant bands drifting, cloud layers moving, planets rotating. Visual only. Home, Planet X and gas giants already scroll from the visual review. This pass adds the moons and the dwarf on the same strips, turns the sun's granulation under a fixed limb, and plays the red giant's flare on the sun's 22 s timeline. |
| LU2: moving bodies | Planned | Planets orbit stars or black holes, and moons orbit planets, on deterministic on-rails Kepler orbits where position is a function of time. Prediction uses the bodies' future positions, with ghost markers for the target's future position. Reuse the elliptical comet orbits. Start with one or two levels. |
| LU3: scripted collisions and consumption | Planned | Timed, deterministic events: a comet hits a planet, a planet spirals into a star and burns up, a star is pulled into a black hole's accretion disk. Debris and changing gravity become gameplay (escape windows, narrowing gaps). |
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

**Planned, by package**
- WP11 remainder: asteroid belts and the Kuiper belt (density tiers: sparse, medium, dense) and stray asteroids. Radiation belts on gas giants are already in the dose field.
- WP12: supernovae, supernova remnant shockwaves, quasars.
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

Confirmed by Stephan on 2026-10-29 for the late game (no build yet, scope later):

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
- **Easter eggs and megastructures:** which package(s) they go in after WP13.

## Design requests for Claude

Stephan points Claude at this section for the next visual pack.

**WP8:** fully designed in [PR #17](https://github.com/stepwaec/slingshot/pull/17).

**WP9:** fully designed in [PR #19](https://github.com/stepwaec/slingshot/pull/19) (pulsar, magnetar, magnetism heatmap, quiet neutron star) and in the game in [PR #27](https://github.com/stepwaec/slingshot/pull/27). Nothing from that pack is still open.

**WP10:** fully designed in [PR #22](https://github.com/stepwaec/slingshot/pull/22) (comet, solar recharge indicator) and in the game in [PR #31](https://github.com/stepwaec/slingshot/pull/31). Nothing from that pack is still open.

**Ship systems:** fully designed in [PR #26](https://github.com/stepwaec/slingshot/pull/26). That pack includes the hull bar, the tidal-stress warning, and the upgrade screen, and the modular spacecraft redesign: a base hull with visible hull plating, shielding, chemical, ion and pulse engines, larger fuel tanks, solar panels, a gas scoop, sensors, a cryosleep module, and damage states that match the hull bar.

**WP11:** designed in [PR #34](https://github.com/stepwaec/slingshot/pull/34) (sparse, medium and dense asteroid belts, Kuiper belt, rogue planet, radiation heatmap, dose meter). The radiation slice (rogue planets, flares, dose, shielding, shadows, heatmap) is in the game in [PR #42](https://github.com/stepwaec/slingshot/pull/42). Asteroid and Kuiper rock fields are still open.

**Burn plume, burn node and gravity grid styling:** done in [PR #36](https://github.com/stepwaec/slingshot/pull/36). The plume is blue-to-violet, with no trailing halo.

**Open requests**, in priority order:

1. **Surface animation:** guidance per body type (granulation, flares, band drift, clouds, rotation).
2. **Collisions and consumption:** impact flash, debris, a planet's tidal-disruption stream, burning up in a star, accretion disk.
3. **Ghost markers** for a body's future position.
4. **Late game:** stellar engine, Dyson swarm, ringworld, Shkadov thruster, space elevator, wormhole.

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
