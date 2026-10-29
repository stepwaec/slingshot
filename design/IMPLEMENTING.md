# Implementing Claude's designs

This guide is for the coding agents that turn the files in `design/` into the game (Cursor, Grok, and anyone else). Read it before you start on any design pack. It has two jobs: keep the game **true to the designs**, and keep the engine **realistic** within a 2D top-down game.

Companion files:
- `IMPLEMENTATION-REVIEW.md`: what earlier packs got right and wrong in `src/`, with file and line references and fixes.
- `style.md`: tokens and rules.
- `threejs-notes.md`: how each design maps onto the Three.js renderer.
- `assets.md`: an index of every file.

## 1. What is canon

When sources disagree, the higher one wins:

1. **The asset's header comment.** Every SVG starts with a comment listing every parameter: sizes, colours, alphas, periods, thresholds and draw order. The header is the specification.
2. **`style.md`**: tokens and the rules in §4.1 (realism, vibrancy, crispness) and the pack's own section.
3. **`threejs-notes.md`**: how to build it in this renderer.
4. **The mockup PNG** (2× render): how it should look in context.
5. Your own judgment, only for what none of the above covers. Write down what you decided in the pull request.

Never edit anything in `design/` to make an implementation match. If a design is wrong, impossible or too expensive, say so in your pull request and leave the design file alone. Stephan asks Claude for a fix.

## 2. Workflow for every design pack

1. **Read.** Read the design pull request description, then the header of every new or changed asset, then the matching `style.md` and `threejs-notes.md` sections.
2. **Open the references.** Open the preview pages (`preview/*.html`, which animate when opened from `file://`) and the mockup PNGs.
3. **Put the numbers in the theme.** Every number from a header goes into `src/render/theme.ts` and every colour into `src/render/palette.ts`, under the token name from `style.md`. Add a comment pointing at the source, such as `// design/assets/bodies/comet.svg header: coma rx 50`. Don't scatter magic numbers through shaders.
4. **Build it.** Then compare side by side: your build next to the mockup and preview, at the same zoom, at 1× and at 2× device pixel ratio.
5. **Add pull request evidence.** Include screenshots at 1× and 2× next to the mockup, the tokens you added, any deviation and why, and frame-time numbers for anything new.

## 3. Fidelity rules

**Colour**
- Use the hex values from `style.md` verbatim. Don't eyeball, approximate or "improve" them.
- Write sRGB straight out of the shaders (`srgbVec`), with `NoToneMapping`. Don't add tone mapping, colour grading or extra gamma.
- **No grey.** Low-alpha warm colours (gold, amber, orange) over the navy sky turn olive or brown. Never use a tinted translucent fill for a status. Use a crisp border on the panel fill, or a solid colour, as the designs do.
- No untinted textures on coloured bodies.

**Crispness**
- Draw edges with `fwidth()`-based antialiasing, one pixel wide at every zoom.
- Blur is only allowed where a header lists it (hazes, glows, nebula gas, a few named softnesses). Bodies, rings, rocks, HUD and overlays are crisp.
- Plumes have **no trailing halo or bloom shape** behind them.
- If you add `UnrealBloomPass`, use it on the world scene only, with threshold ≈ 0.85 and strength ≤ 0.6.
- Device pixel ratio is `min(devicePixelRatio, 2)`. Bake textures at `CSS size × DPR × zoom bucket` and rebake only when the bucket changes.

**Bake, don't recompute.** Noise textures, rock atlases, part sprites and field-line textures are baked once at load or on a zoom-bucket change. Per-frame work moves, rotates and fades baked sprites. Budgets are in `threejs-notes.md` §9.

**Drawing the SVG files directly** (as PR #32 does) is welcome. Follow these rules so the art keeps working:
- **Keep the motion.** A single raster freezes every SMIL animation. Bake each animated layer separately, using `bakedSvgUrl` with `hide` or `prep` to keep one layer and strip its SMIL. Replay the header's timing in `update()`: rotate the rings, scale the haze, fade the prominences, scroll the surface strips under a static lighting overlay.
- **Keep it sharp.** Raster at `viewBox × DPR × zoom bucket` and rebake when the bucket changes. Use mipmaps, or a lower-resolution bake, when zoomed out, so small bodies don't shimmer.
- **Draw hazards from level data.** Where a visual marks a gameplay zone, draw it as its own quad sized from the level data, never as part of the scaled picture. That covers pulsar beams (`beam.reach`), drag atmospheres (`atmosphereRadius`), harvest rings and capture rings. Then what is drawn is what hurts.
- **Apply the header's per-instance rules.** Examples: the comet's tail scale and mirror, rocks rotated toward their star, planets lit toward the brightest source.
- **Respect the draw order.** Nebulae and belts sit behind bodies; overlays sit under bodies.

**Living surfaces.** Bodies must never look like still pictures. Stars boil and flow, planets turn under fixed lighting, and gas giants flow in counter-moving bands. The values are in `style.md` §13 "Living surfaces", with an animated reference in `assets/star-surface-motion.svg`. This motion is cosmetic, so it runs on `frame.now`, slowly, never strobes, and never moves the rim, the radius or the lighting.

**Lighting**
- Bodies are lit **toward their star**, computed every frame from positions, and summed for binary stars.
- The lit side never rotates with a texture. Only the surface scrolls under fixed lighting.
- Exceptions are named in the headers. The ship is symmetric, so it may rotate. A comet and belt rocks rotate as a whole so that their built-in light keeps pointing at the star.

**Time**
- Anything that is a **hazard or affects the outcome** animates on **sim time** (`step × dt`). Examples: pulsar beams, pulse-engine flashes, flares, burn timing. Then what the player sees is where the danger is, and pause and slow motion freeze it.
- **Purely cosmetic** motion uses `frame.now`. Examples: flicker, shimmer, crawling dashes, breathing glows, sparkles.
- At t = 0 every animation is in its rest state, so screenshots and the first frame match the mockups.

**Draw order and layers.** Follow each header's draw order exactly. Typical stacking, back to front:
1. Sky.
2. Gravity grid.
3. Magnetism map, then radiation map.
4. Nebulae.
5. Belts.
6. Bodies.
7. Predicted path.
8. Ship (back modules → plume → hull → front modules → damage).
9. HUD.

**Readability at game scale.** Check every visual at its real size: the ship is 22 px, rocks are a few pixels and the HUD is 11–12 px type. If a detail vanishes, keep its colour accent rather than inventing a new effect. Ask before adding anything the design doesn't have.

**HUD**
- HUD elements are DOM in `index.html` and `src/style.css`, at the pinned positions in `style.md` §6 and §10.
- Labels are 11 px uppercase weight 500, values 12 px mono, and panels use `rgba(10, 13, 26, 0.72)` with a `rgba(255, 255, 255, 0.10)` border.
- The right-hand stack is fuel (baseline 48), hull (96) and dose (144), with status chips below.

## 4. Realism rules for the engine

The game compresses distances, but the laws keep their real shape.

**Determinism comes first.**
- Everything that changes the outcome lives in the pure sim step, shared by prediction and flight: forces, drag, fuel, recharge, dose, damage, fuzz and collisions.
- Visuals read the sim and never write to it.
- Keep a fixed `dt`, no `Math.random()` at run time (seed everything from the level), and identical code paths for prediction and flight.
- Tests: prediction equals flight bit for bit; every map toggle (G, C, M, R) and every animation leaves the sim unchanged.

**Use the right shape for each field:**

| Effect | Law | Notes |
|---|---|---|
| Gravity | `GM / (r² + ε²)^(p/2)`, p ≈ 2 | Keep the potential consistent with the force (WP7c). A symplectic integrator (leapfrog or velocity Verlet) keeps orbits from drifting. |
| Orbits | Analytic, keyed by sim time | Periods should follow Kepler (`ω = √(GM / a³)`) from the parent's mass. Binaries orbit the barycentre (`a₁m₁ = a₂m₂`). |
| Comets | Elliptical Kepler orbits | Solve `M = E − e sin E` with a few Newton steps. They are fast near the star. |
| Rogue planets | Constant-velocity straight line (plus gravity, if the level wants it to be pulled) | Never an orbit. |
| Tidal stress | `∝ 2GM·L / r³` across the ship's length L | Strongest source by `GM / r³`. It drives hull damage and the chevrons. |
| Magnetism | Dipole, `|B| = k √(1 + 3cos²θ) / r³`, with **vectors** summed | Pulsar fields are rotation-averaged. |
| Radiation dose | Star: `∝ L / r²`; flare: a directed cone; belts: annuli; background constant | **Line-of-sight shadowing** by bodies. The dose integrates in the sim step. |
| Solar recharge | `rateMax · L · min(1, (Rref / r)²)`, off below 8 % | Also shadowed by bodies, by the same line-of-sight test. |
| Drag (red giant, nebulae) | `∝ ρ v²` opposite the velocity, only inside the atmosphere radius | It can only slow the ship, never reverse it. |
| Relativity | `dτ/dt = √(1 − 2Φ/c² − v²/c²)` | The horizon is at `r_s = 2GM/c²`, as today. |

**Units and knobs.**
- One unit system everywhere: world units equal SVG units at zoom 1, and sim seconds.
- Every new strength or radius gets a per-level knob in the JSON `physics` block, with a default that reproduces the current behaviour.

**Collisions.** Solid discs use the header crash radii. Hazes, glows, beams, rings, dust and the coma are never solid unless a header says so (for example, belt rocks with r ≥ 7). Belt and Kuiper rocks are placed from a seed, so the same level always has the same rocks.

**Scale.** Compress distances, not relationships:
- Belts sit between planet orbits.
- The Kuiper belt sits beyond the outermost planet and is wide and sparse.
- Stars' luminosity scales recharge, dose and the planets' light together.

## 5. WP11 specifics (belts, Kuiper belt, rogue planet, radiation, dose)

- **Belts** (`assets/space/belt-sparse|medium|dense.svg`):
  - Draw them with one `InstancedMesh` of quads sampling a baked rock atlas: 6 silhouettes × 3 types, drawn lit from −x.
  - Rotate each instance to `angle(rock → star) − 180°`, so it's lit toward its star. Don't tumble the lighting.
  - Place rocks from the level seed, by the counts per 100 px of arc in each header.
  - The slow drift is a rotation of the whole belt about its star, so the lighting stays correct.
  - Show the edge arcs in planning and pause only.
  - Solid rocks are the r ≥ 7 ones. The dense tier may add a dust-damage rate as a level knob.
- **Kuiper belt** (`assets/space/kuiper-belt.svg`): the same pipeline with the K type (red tholin plus frost). It's wide, faint and mostly dust. Its dwarf planet is a small mass.
- **Rogue planet** (`assets/bodies/rogue-planet.svg`): an opaque dark disc that hides the stars behind it. Its thermal bands scroll west with no stellar lighting. It has a cold rim, a drift arrow in planning only, and gives no recharge.
- **Radiation map** (`assets/overlays/radiation-map.svg`):
  - Render it as one full-screen shader on a **12 px screen grid**, so the dots don't scale with zoom.
  - Each cell samples `dose(p)` from the sim's field function and draws a dot whose radius and colour are set by zone: 1 / 3 / 8 / 20 × D1.
  - Inside bodies it draws nothing; below Low it draws a faint speck.
  - The R key and a "Radiation" button toggle it, separately from G and M.
- **Dose meter** (`assets/hud-dose.svg`):
  - The third HUD block in the right-hand stack.
  - The bar is continuous, with a star mark at 25 % (the bonus) and a red mark at 100 % (the limit).
  - The rate line names the dominant source, such as belt, flare or shadow.
  - In planning, a ghost segment shows the predicted dose.

## 6. Definition of done

- [ ] Every number and colour comes from a header or `style.md`, and lives in `theme.ts` or `palette.ts` under the token name.
- [ ] Side-by-side screenshots at 1× and 2× next to the mockup are in the pull request.
- [ ] The draw order matches the header, and edges are crisp at zoom 0.5, 1 and 2.
- [ ] Hazards run on sim time, and cosmetics on `frame.now`.
- [ ] Prediction equals flight. Toggles and animations don't change the sim. New physics has tests for its law: falloff exponent, shadowing, never-reversing drag.
- [ ] Frame time is within the `threejs-notes.md` §9 budget, measured on real hardware where possible.
- [ ] Nothing in `design/` was edited, and every deviation is listed with its reason.
