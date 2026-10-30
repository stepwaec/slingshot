# Slingshot: game design

Working title: **Slingshot** (a final name is not chosen yet; see "Name shortlist").
Repository: [stepwaec/slingshot](https://github.com/stepwaec/slingshot)

This file holds the game vision, the core design and the technical decisions. The work packages and their status are in [ROADMAP.md](ROADMAP.md).

---

## 1. Original design document (10 points)

Stephan dictated this on a voice call with Brainstormer on 2026-10-28, and Brainstormer wrote it up as below. It is quoted as written, apart from the heading levels.

> **Game design document (working title: Slingshot)**
>
> **1. Core**
> - Single-player spaceship game.
> - The goal is to reach planet X with limited fuel.
> - Main tools are gravity slingshots, gravity wells and black holes.
>
> **2. Fail conditions**
> - You run out of fuel in the middle of a transfer.
> - You miss a gravity window.
>
> **3. Score**
> - Score is speed multiplied by fuel efficiency.
> - High scores unlock harder levels.
>
> **4. Resources**
> - Solar power recharges passively when you fly near stars.
> - Gas clouds are scooped up automatically when you pass through them with the right thrust.
> - Alternative propellants and engines unlock over time, such as ion drive and pulse drive.
>
> **5. Hazards**
> - Asteroid belts come in three density tiers.
> - Sparse belts carry a risk of reduced speed.
> - Dense belts need a shield.
> - Staying in a belt too long destroys the ship.
>
> **6. Physics**
> - Gravity is realistic.
> - Flying too close to a star or black hole gets you absorbed.
> - Black holes have visible event horizons.
>
> **7. View**
> - 2D gameplay with a parallax layer that gives a 3D feel.
> - Suns and planets are vibrant, and asteroid belts move.
>
> **8. Hybrid mode**
> - You plan the route on the ground with dotted trajectory lines.
> - During live flight you make fine corrections.
> - You can save snapshots of a plan.
>
> **9. Late game**
> - Systems with several suns, like the three suns in The Three-Body Problem (the Trisolaran system).
> - Three-body chaos means you plan with widening probability cones instead of exact lines.
>
> **10. Build**
> - @Engineering Manager builds the game when it's time to code.

Stephan's original dictated wording for reference: "1) Core: single-player spaceship game, reach planet X with limited fuel using gravity slingshots, wells, black holes. 2) Fail: out of fuel mid-transfer or missing gravity window. 3) Score: speed x efficiency; unlocks harder levels. 4) Resources: solar power near stars (passive), gas clouds scooped automatically with right thrust, alternative propellants/thrust unlocks (ion, pulse). 5) Hazards: asteroid belts, density tiers, sparse = reduced speed risk, dense = needs shield, too long = destroyed. 6) Physics: realistic gravity, too close to star or black hole = absorbed; black holes have visible event horizons. 7) View: 2D with parallax 3D, vibrant suns/planets, moving belts. 8) Hybrid mode: plan on ground with dotted trajectories, live-fly fine corrections; optional saved plan snapshots. 9) Late game: trisolarian/multi-sun systems; three-body chaos means planning uses widening probability cones, not exact lines. 10) @Engineering Manager builds when code time comes."

### How the design has changed since then

These later decisions replace or extend parts of the original document:

- **Win condition:** you must end in a **stable orbit around Planet X** (bound orbit, periapsis above the surface, apoapsis inside the capture radius). Touching or landing does not count. Stephan confirmed this on 2026-10-28 and again before WP4. The fuel budget should still make the slingshot route clearly beat the direct route.
- **Scoring:** "speed times efficiency" was replaced by two-clock scoring (see section 3).
- **Planning:** the plan is a list of burn nodes along the path (maneuver nodes, like Kerbal Space Program), with a limited prediction horizon, at most 2 queued burns and a tactical pause, so the game becomes "fly, pause, plan, fly" (WP2 and WP4).
- **Fail conditions in the game today:** crash into a body, "Lost in space" (out of bounds or timeout), and missing the outside-time deadline (hard fail, from WP5). Running out of fuel mid-transfer is implied by the fuel budget. *Uncertain:* whether a separate "missed gravity window" fail state exists in code was not checked.
- **Saved plan snapshots** (point 8) and the **parallax layer** (point 7) are not built yet and not assigned to a package.

---

## 2. Physics tuning philosophy

Agreed between Stephan and Brainstormer on 2026-10-29 and built in WP7c:

- **Feel real rather than be exactly real.** The physics may be game-like where that makes play better.
- **Keep the real formula shapes.** Use the real formulas, then tune them with knobs (a lowered speed of light, a gravity strength multiplier), so "faster" and "deeper" still mean slower clocks, just visibly so.
- **Smooth the extremes.** Real dilation goes to infinity near light speed and at event horizons. Cap it at a playable maximum (for example 10 times slower) with smooth saturation, so it never freezes the game.
- **Tune per level.** Each level's data has a physics block. Early levels barely show an effect; late levels can make it the main puzzle.
- **Snappy slingshots.** Optional gravity falloff shaping (a softening length and an exponent near 2) keeps the inverse-square shape at distance but feels snappier up close.
- **Forgiving damage and drag.** Gentler tidal damage and forgiving drag, via their own strength knobs.
- **Readable over precise.** The HUD shows rounded numbers and trends (colours, rising or falling arrows) instead of decimals.
- **Determinism is never bent.** The prediction must always match the flight exactly. Every knob gets a test showing it has the intended effect and that the prediction still matches the flight.

The WP7c knob list (each optional, defaulting to today's behaviour): speed of light `c`; gravity strength multiplier; gravity falloff shaping; time-dilation strength; time-dilation cap with smooth saturation (continuous, monotonic, never above the cap); tidal damage strength (wired up in the ship systems package); drag strength (wired up in WP8).

---

## 3. Relativity rules

From Brainstormer's discussion with Stephan and the merged WP5 ([PR #6](https://github.com/stepwaec/slingshot/pull/6)).

### Clocks
- **Outside time** is coordinate time (`step * dt`). Home and Planet X share this frame, so origin and destination share one clock.
- **Ship time** is proper time along the trajectory. On board, time feels normal; seen from outside, the ship clock runs slower the faster the ship goes and the deeper it sits in a gravity well.
- Both clocks advance inside the deterministic `step`, in prediction and flight alike. Each fixed step adds `dt` to outside time and `(dτ/dt) * dt` to ship time, using the rate at the start of the step.

### Formula (weak-field combined dilation, `properTimeRate`)

```
Φ_depth = Σ GM / r
dτ/dt   = sqrt(1 - 2 Φ_depth / c² - v² / c²)
```

- `c` is a per-level constant in world units per second (lowered so the effects show at flyable speeds). It does not change the Newtonian motion.
- The value under the root is clamped at 0, so the rate is 0 at a horizon or at `v ≥ c` and never becomes imaginary.
- A black hole's radius is its horizon, `r_s = 2GM/c²`.
- WP7c adds a time-dilation strength knob and a smooth cap on top of this (see section 2).

### HUD
- Two clocks side by side, a rate gauge (`1 ship s = N outside s`), the time gap, and a deadline bar in outside time that turns red in the last fifth of the window.
- In planning, the predicted path is tinted by clock rate (cool where time runs normally, glowing or orange where it slows), and the predicted arrival is shown.
- Relativistic visuals (aberration, colour shift) appear only in the flight view; planning and pause stay on the clean chart.
- The gravity layer (G, on or off) draws the bending grid over a field coloured by rest-frame clock rate. That rate is the same function with velocity zero. There is no separate clock-rate control.

### Scoring dilemma
- Arrival in a stable orbit around Planet X is required.
- **Outside time is the hard limit:** past the deadline, points and stars are zero, even if the ship is captured.
- **Ship time is the bonus:** `crew bonus = crewWeight * max(0, crewLimit - shipTime)`.
- **Fuel left adds points:** `fuel bonus = fuelWeight * fuelLeft`.
- Pause costs (under the score-cost pause rule) are subtracted.
- **Three stars:** deadline met, crew time at or under the crew limit, fuel left at or over the fuel minimum.
- Weighting is per level: a rescue mission weights the deadline, a generation ship weights crew time (Passage weights crew time; Rescue weights the deadline).
- The dilemma: a deep dive near a black hole saves fuel and crew time but burns outside time and can blow the deadline; a wide arc is safe on time but costs more fuel and crew time. The Rescue level demonstrates this.

### Ideas discussed but not scheduled
- Planets keep orbiting on outside time, so arriving later means Planet X has moved on (moving bodies exist since WP4).
- "Black hole waiting room": park near a horizon on purpose to skip outside time until a window opens.
- Blueshift ahead, redshift behind, stars bunching up in front at high speed (partly built in WP5 as aberration and colour shift).
- Cryosleep upgrade that slows crew ageing (see ROADMAP upgrade tree).

---

## 4. Engine and architecture decisions

- **Pure physics module.** All physics (gravity, burns, moving bodies, relativity clocks) lives in a pure, engine-independent, deterministic module with a fixed time step. Prediction and flight share the same step function (`advancePlan`), so the dotted prediction matches the flight bit for bit. Sim speed (1x/2x/4x, slow motion) only changes how many fixed steps run per frame. Visual layers only read sim state, never write it.
- **Language and tooling:** TypeScript, Vite, Vitest tests, CI workflow (from WP1).
- **WP1 rendering:** HTML Canvas, no engine.
- **Three.js for visuals** (from WP3, [PR #4](https://github.com/stepwaec/slingshot/pull/4)): chosen over PixiJS because of the warped space-time grid, the tilted camera and parallax. Orthographic scene for the chart. The perspective camera stays parked; the tilted gravity sheet that used it is retired.
- **HTML HUD and menus** as layers over the canvas, so no Phaser.
- **Godot** only if native mobile apps become the main goal (would mean a rewrite).
- **Swappable visuals:** each visual (ship, planet, star, starfield, trail, path, nodes) is a factory in `src/render/visuals/index.ts`; colours, sizes, asset paths and animation timings live in `src/render/theme.ts`. Stephan found Claude's v1 designs not realistic enough, so realistic art (textured lit planets, bloom, real starfields, lensing black holes, a 3D ship) is meant to drop in later without rework.
- **Levels as JSON** (WP7c, in progress): every level becomes a plain JSON file with a typed, validated schema and a loader, so a world builder and level sharing can come later without a rewrite. Existing levels (Passage, Relay, Rescue) must play bit-for-bit identically after the move.
- **Design assets from Claude** live in `design/` (style.md, assets.md, canvas-notes.md, SVG assets, mockups), merged via PR #4. A second Claude design update is expected; WP8 waits for it.
- **Merging:** since 2026-10-29 Stephan lets Engineering Manager merge Slingshot PRs after its own review, and Engineering Manager reports each merge to him. Deploys, deletions and other repos still need his approval.

---

## 5. Name shortlist

No decision yet. Stephan said on 2026-10-28 that the name does not have to be decided now, but Dilation is a good contender.

| Name | Note from the brainstorm |
| --- | --- |
| **Dilation** | Leading candidate. Short, mysterious, the core mechanic. |
| **Proper Time** | The physics term for the ship's own clock; double meaning, fits the scoring. Brainstormer's other favourite. |
| Event Horizon | Strong, but also a well-known film title. |
| Two Clocks | Simple, says the whole idea. |
| Orbital Debt | You borrow time and fuel from gravity. |
| Wells | Minimal, about gravity wells. |
| Lightlag | Time and distance in one word. |
| Periapsis | Closest point of an orbit, where slingshots happen. |
| Time Slingshot | Keeps the current name and adds the twist. |
| Slingshot | Current working title; generic and used by many games. |

Before choosing: check app stores and domain availability (offered by Brainstormer, not done yet).
