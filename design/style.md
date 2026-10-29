# Slingshot — visual style v1.3

Calm, cinematic space for a Canvas 2D prototype. This file is the look; `canvas-notes.md` is how to draw it at 60 fps; §7 below is the asset index (one row per asset: file, viewBox, anchor, colours, size on the mockup); §8 is the v1.3 **body library** (18 bodies, their tokens, the lighting / rotation rules and the crash radii). Assets live in `design/assets` (the library in `design/assets/bodies`), mockups (1440×900) in `design/mockups`, the animated previews in `design/preview/planets.html` (the original three bodies) and `design/preview/bodies.html` (all 18).

v1.1 was the **realism pass**: richer bodies (limb-darkened star with streamers and granulation; planets with surface noise, a day/night terminator and an atmosphere rim) and a richer sky (tinted stars of varying magnitude, halos on the brightest, a faint Milky Way, a vignette that reaches true black).

v1.2 is the **planet pass**: the two planets become an **ocean world** (start) and a **cold mineral world** (X), and they **rotate** — one seamless texture strip (land + clouds, basins + wisps) scrolls slowly west→east through a circular clip under a cached lighting overlay that never moves. Terminator, limb line, atmosphere rim, halo and capture ring keep their v1.1 numbers; the ring's pulse and dash crawl and a new halo breathe are now in the SVG too. Star, ship, trail, path, arrow, HUD, overlays, starfield, copy, typography and every v1 duration are untouched.

v1.3 is the **body library**: twelve planets and six stars / compact objects built on the same construction (§8) so levels can be composed from different worlds — rocky deserts, ice, lava, toxic and cracked worlds, two gas giants (one ringed), a barren moon, a dwarf planet, an orbiting double planet, a red dwarf, a blue giant, a white dwarf, a neutron star and a black hole — plus **solar flares** on all three main-sequence stars (three slow prominence loops and one brief spike each, the yellow sun's added to `star.svg` in place). Everything v1.2 defined keeps its numbers; the two original planets are two of the twelve.

## 1. Mood

**Observatory at night, not arcade.** The screen is mostly nothing: a near-black field, a thin dust of stars, and three bodies. The player sits in the dark planning one quiet throw. Everything is slow and weightless; nothing shouts. The drama comes from the physics (a predicted path that stops just short), not from the pixels.

**What glows:** exactly two things. The central star is the only warm light in the scene — core to corona to a faint orange haze that reaches out and fades. Planet X is the only cool light — a soft mint halo and a dashed capture ring that breathes. Everything else is flat colour plus one gradient: the start planet is lit by the star but does not emit; the ship is matte off-white with a hard outline; trails, paths and UI are crisp and unblurred.

**Realism inside the glow budget.** v1.1 makes the bodies and the sky look photographed rather than drawn — a limb-darkened stellar disc with faint streamers, planets with a real terminator and a thin atmosphere rim, stars that differ in size, brightness and colour, a band of dust behind the star — without adding a single glowing object or a single per-frame blur. All of it is detail *inside* the shapes we already had: the silhouettes, radii, glow envelopes and the two-glow rule are unchanged, and every new pixel is rendered once into a cached sprite or the cached background. Realistic but calm: nothing twinkles, flickers or lens-flares; the sky is still a quiet dust, only a slightly more convincing one.

**Worlds that turn (v1.2).** The one thing v1.2 allows to move on its own is the surface of the two planets: continents, clouds, basins and wisps drift across the disc once every 64–120 s — slow enough that you notice it only when you look, which is the point. The light does not move with them: the day side, the terminator, the rim and the ocean glint stay fixed toward the star, so the planets read as lit spheres turning under a lamp, not as spinning stickers. It is still cached pixels — a strip rendered once and slid under a cached overlay — and still a circle silhouette; there is no sphere mapping at r ≤ 40 px, only a "limb squash" that fades the texture toward the edge.

**A library of worlds (v1.3).** The same recipe now describes eighteen bodies (§8). They differ in palette, texture and a few rules — a hard terminator and no rim on airless bodies, a softer and wider one on the gas giants, an emissive surface on the lava world — but not in kind: still noise under a fixed light inside a circle, still cached pixels, still slow. The stars now *do* something: three prominence loops rise and fade over 12–16 s and once every 22 s a thin flare pops for under two seconds, calm enough that a player notices them the way one notices weather. Kurzgesagt's colour harmony and bold silhouettes were the reference for how saturated hues can sit on deep navy and still read quietly; nothing of theirs is reproduced.

**What we avoid:** neon, lens flares, scanlines, chromatic aberration, text shadows, more than two glowing objects, saturated gradients on UI, decorative animation. If a thing is not the star or the target, it does not bloom. Colour is used sparingly so that when a result overlay lands in mint, red or violet, it is the loudest thing on screen.

## 2. Palette

All values are exact; use these tokens, never ad-hoc hex.

### Background
| Token | Hex | Used for | Note |
|---|---|---|---|
| `bg.base` | `#050710` | Canvas clear colour over most of the field; darkest UI colour; text on `ui.accent` | Not pure black — keeps the starfield from looking like dead pixels |
| `bg.vignette` | `#0B1024` | Centre of a very soft radial vignette (r 900 from the centre): 0.00 `bg.vignette` · 0.55 `bg.base` · 1.00 `bg.edge` | Only lift is at the centre |
| `bg.edge` | `#000000` | True black at the vignette edge (r ≥ 900); the corners (r ≈ 849) are near-black | v1.1. The frame now goes vignette → base → black. The only place pure black appears; it sits under the faintest stars so the field reads as depth, not as a flat fill |

### Starfield (static; three depth layers keep their radius / alpha roles, the colour is per star)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `stars.far` | `#6E7FA6` | far layer: r 0.6 px, α 0.35, ~420 dots at 1440×900; also the 380 Milky-Way dots (r 0.5, α 0.28) | Too faint to show colour — stays one hex |
| `stars.cool` | `#B8CCFF` | ~25 % of mid + near stars (B/A-type blue-white) | v1.1 tint; replaces `stars.mid`/`stars.near` hexes |
| `stars.neutral` | `#E9EEF8` | ~50 % of mid + near stars (F/G-type white); every sparkle host | v1.1 tint |
| `stars.warm` | `#FFD9B0` | ~25 % of mid + near stars (K/M-type amber) | v1.1 tint |
| `milkyway.dust` | `#AAB8DD` | The faint band behind the star, peak α ≤ 0.08 (measured 0.054 in the asset), plus the extra far dots inside it | v1.1. Dust, not detail — never an outlined shape |

The three layers, as the asset and `canvas-notes.md` §2 build them:

| Layer | Colour | Radius | Alpha | Count | Extras |
|---|---|---|---|---|---|
| far | `stars.far` | 0.6 px | 0.35 | ~420 | unchanged from v1 |
| mid | tint | 0.8–1.0 px | 0.55–0.65 | ~160 | tinted 25 / 50 / 25 % |
| near | tint | 1.2–1.5 px | 0.85–0.95 | ~45 | tinted; the 12 largest get a halo (r 4.5, own tint α 0.18 → 0, under the dot); 4 get the 4-point sparkle (`#FFFFFF`, 0.6 px, α 0.5, 5 px arms) and are forced to maximum magnitude, neutral |
| Milky Way | `milkyway.dust` + `stars.far` | — / 0.5 px | ≤ 0.08 / 0.28 | 2 gradient ellipses (SVG) or 3 (Canvas) + 380 dots | band at −28° through (720, 450), lower-left → upper-right behind the star; dots spread Gaussian σ 90 px about the axis |

**Magnitude rule** (mid and near): one seeded draw `u` per star gives both radius and alpha, `r = rMin + (rMax − rMin)·u³`, `α = aMin + (aMax − aMin)·u³` — many faint, few bright, and the bright ones are also the big ones. **Tint rule:** a second draw `t`: `< 0.25` cool, `< 0.75` neutral, else warm. Positions keep the v1 seed (`0x514E47`), magnitude/tint use `0x514E48`, Milky-Way dots `0x4D57`; exclusion zones around the bodies stay (star r 140, planets r 60 / 80 minimum; the asset keeps 70 / 100). No twinkle, no parallax: the sky is a cached bitmap.

### Central star
| Token | Hex | Used for | Note |
|---|---|---|---|
| `star.core` | `#FFF8E1` | Centre of the body gradient | Almost white, slightly warm |
| `star.body` | `#FFC857` | Body (r 46 on the mockup), flat from 0.45 to 0.78 of the radius | Same hex as `fuel.low` on purpose: one amber |
| `star.corona` | `#FF8C2E` | Corona (to ~r 130), the 10 streamers + 2 helmet lobes, the chromosphere ring at r 47, and the 0.90 stop of the body | Fades, never a hard edge |
| `star.glow` | `#FF5A1F` | Outermost glow, reaches α 0 at ~r 200 | The only warm haze in the game |
| `star.limb` | `#FF5A1F` | Limb-darkened edge of the disc (the 1.00 stop of the body gradient) | v1.1. Same hex as `star.glow`: the disc darkens into the colour of its own haze, so the edge reads as a sphere, not a sticker |

The disc is **limb-darkened** (core → body → body → corona → limb), ringed by a thin **chromosphere** (r 47, 3 px, `star.corona` α 0.60) and textured with faint **granulation** (desaturated fractal noise, multiply, α 0.16, contrast ×2). The corona is no longer uniform: ten thin **streamers** (base 10–18 px at r 48, tips at r 110–175, α 0.10–0.16) and two wider, fainter **helmet lobes** (base 40, tip r 150, α 0.06) at seeded angles (`0x5747`, none closer than 20°). Everything is part of one cached sprite that breathes ±3 % over 6 s; nothing rotates or flickers.

### Start planet (ocean world — cool blue, calm)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `planet.start.base` | `#3D8BFF` | Body disc; the transparent 0.40 stop of the shade lets it (and the surface noise) show on the day side | Lit side faces the star (upper-right) |
| `planet.start.highlight` | `#9CCBFF` | 0.00 stop of the terminator shade (α 0.90), offset 0.36 r toward the star; also the 1 px limb line at α 0.16 (r − 0.5) | No glow; the limb line keeps the dark side legible on `bg.base` |
| `planet.start.shadow` | `#142B5E` | Night side: the shade's 0.70 (α 0.55) → 0.86 (α 0.92) → 1.00 (α 1.0) stops — the 0.70–0.86 span **is** the terminator | Deep enough to sink into the field |
| `planet.start.atmo` | `#7FB8FF` | Atmosphere rim: a thin ring just outside the disc (peak α 0.55 at 0.87 of 1.12 r), masked α × 1.0 lit → 0.35 dark along the star vector (the brief's "~2×"); over the shaded body the composite rim reads ≈ 1.5× brighter on the lit side (measured, `assets.md`) | v1.1. Scatter, not glow: it never leaves the 1.12 r envelope and never animates |
| `planet.start.ocean` | `#3D8BFF` | The ocean = the base disc and the fill of the surface strip; also the limb-squash overlay (base α 0 at 0.88 r → α 0.45 at r) | v1.2. Same hex as `planet.start.base` — one token, two roles |
| `planet.start.land` | `#8FB07A` | Continents: fractal noise (baseFrequency 0.030, 4 octaves, seed 7, stitched over one 214 × 68 tile) soft-thresholded at p68 of the field → ≈ 32 % of the tile (33.5 % measured; the t = 0 window shows ≈ 38 %); the coastline ramp is ≈ 1 px | v1.2. Muted green-grey, deliberately not "grass": it has to sit quietly under the blue shade |
| `planet.start.cloud` | `#F2F5FF` | Cloud strip: second noise field (0.055, 4 octaves, seed 19), thresholded at p60 → ≈ 40 % cover (39.6 % measured), edges softened σ 0.8, drawn at group α 0.5 (peak ≈ 0.5, inside the brief's 0.45–0.6); drifts at its own period (64 s vs 90 s) so clouds move over the land | v1.2. Same hex as `ship.hull`; light soft wisps, never grey blotches |
| `planet.start.ice` | `#E9EEF8` | Polar caps: bands over the top and bottom 12 % of the disc (8.16 px of 68), α 1 at the pole → 0.9 at 60 % of the band → 0 at its inner edge | v1.2. Same hex as `stars.neutral`; faint by design — they are part of the strip and scroll with it, but as full-width bands they look fixed |
| `planet.specular` | `#FFFFFF` | Ocean glint, start planet only: ellipse 0.22 r × 0.12 r (7.5 × 4.1 px) at the sub-star point 0.45 r along L = (10.82, −10.82), radial α 0.35 → 0.18 at 50 % → 0; part of the fixed lighting overlay | v1.2. The only white on a body; planet X has no liquid and no glint |

### Planet X (the target — cold mineral/ice world)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `planet.x.base` | `#3DE0C2` | Body disc (transparent 0.40 stop of the shade); also the halo (radial gradient α 0.35 → 0 at ×1.8 r, drawn live) | The only cool glow on screen |
| `planet.x.highlight` | `#B5FFF0` | 0.00 stop of the terminator shade (α 0.90), offset 0.36 r toward the star (lower-left); also the 1 px limb line at α 0.18 (r − 0.5) | |
| `planet.x.shadow` | `#0E4A40` | Night side: shade stops 0.70 (α 0.55) → 0.86 (α 0.92) → 1.00 (α 1.0); the 0.70–0.86 span is the terminator | |
| `planet.x.atmo` | `#8FFFE6` | Atmosphere rim at 1.12 r (peak α 0.55 at 0.87, 0.30 at 0.92), lit-side boost 1.0 → 0.35 | v1.1. Sits under the halo's falloff; the halo is still the only thing that reads as "glow" |
| `planet.x.ring` | `#3DE0C2` | Capture-radius ring: dashed `[6, 6]`, stroke 1.5 px, α 0.55 at rest (pulses 0.35 ↔ 0.70, radius ±2 px, 2.4 s) | Same hex as base; the dash and the pulse make it read as a boundary, not a halo. The dashes crawl slowly (`lineDashOffset` −12 px/s) *and* the ring pulses; on a win both stop and the ring locks at α 1.0. v1.2 puts both motions in the SVG (SMIL) and adds a halo breathe ±4 % on the same 2.4 s sine |
| `planet.x.mineral` | `#0E4A40` | Dark mineral basins: fractal noise (0.035, 4 octaves, seed 11, stitched over one 188 × 60 tile) soft-thresholded at p72 → ≈ 28 % of the tile (27.3 % measured), drawn at α 0.60; plus thin veins — a second, ridged noise (turbulence 0.040, 2 octaves, seed 11) bright where the field < 0.07 → ≈ 5 % cover, α 0.35 | v1.2. Same hex as `planet.x.shadow`: the basins are "deeper mint", not a second colour |
| `planet.x.wisp` | `#B5FFF0` | High-altitude wisps strip: ridged noise (turbulence 0.050, 2 octaves, seed 23) bright where the field < 0.115 → ≈ 15 % cover (15.8 % measured; ≈ 4 % above half alpha), α 0.35, no blur; its own period (80 s vs 120 s) | v1.2. Same hex as `planet.x.highlight`; thin and sparse — filaments, not clouds |
| `planet.x.ice` | `#B5FFF0` | Polar caps over the top and bottom 18 % of the disc (10.8 px of 60), α 1 → 0.9 at 60 % → 0 | v1.2. Larger than the start planet's (12 %): a cold world; the big lit south cap is what the lower-left light catches first |

**Start planet — an ocean world.** `planet.start.ocean` base; continents from thresholded fractal noise (≈ 32 % land, soft ≈ 1 px coastlines) with a faint **highlands** overlay inside the larger continents (same field, higher threshold 0.643, `planet.start.shadow` at α 0.22); faint polar caps (12 %); a separate **cloud** layer (≈ 40 % cover, σ 0.8 edges, α 0.5) that drifts faster than the land; the v1.1 terminator and atmosphere rim; and a small **specular glint** at the sub-star point. The surface strip turns once in **90 s**, the clouds in **64 s**.

**Planet X — a cold mineral/ice world.** `planet.x.base` mint; darker **basins** (≈ 28 %, α 0.60) and thin **veins** (≈ 5 %, α 0.35) in `planet.x.mineral`; sparse bright **wisps** (≈ 15 %, α 0.35); larger polar caps (18 %); the v1.1 terminator and rim; halo and capture ring exactly as before. **No specular** — there is no liquid. The surface is calmer than the start planet's (muted basins, faint veins) so that the halo and the ring, not the texture, keep it "the special one". Surface **120 s**, wisps **80 s**.

**Shared construction (both planets, the SVG is canon — `canvas-notes.md` §4 reproduces it).** The texture is a strip of period **P = round(2π r)** — 214 px (start) / 188 px (X) — i.e. one full rotation, built as **one** 2P × 2r rect (428 / 376 px wide) whose filter stitches the noise to exactly P over a P-wide subregion and repeats it with `feTile` — one rect, no geometry join inside the clip (two abutting rects show an anti-aliased hairline at every fractional translate) — and scrolled **west→east** (the texture moves left→right: translate 0 → +P over one period) through a circular clip of radius r. Above the clip group, in this order, all **fixed to the star direction and never rotating**: a **limb squash** (radial, base colour α 0 at 0.88 r → α 0.45 at r: the texture fades to 55 % in the outer 12 % of the radius — the only "spherical" cue, no true mapping at r ≤ 40 px) → glint (start only) → terminator shade → 1 px limb line → atmosphere rim (planet X: halo first, ring last). Static renders and all five mockups show t = 0. Draw order: [halo] → base → clip { surface strip, cloud/wisp strip } → squash → [glint] → shade → limb → rim → [ring].

### Ship
| Token | Hex | Used for | Note |
|---|---|---|---|
| `ship.hull` | `#F2F5FF` | Triangle hull | Matte; no glow |
| `ship.outline` | `#0A0D1A` | 1 px outline | Keeps the hull legible over the star and planets |
| `ship.cockpit` | `#5EA0FF` | Tiny accent dot/slit | Same blue as `ui.accent` and `trail` — "this is the player" |
| `thrust.core` | `#FFE08A` | Inner thrust triangle | Lives one frame per thrust tick |
| `thrust.outer` | `#FF6A2A` | Outer thrust triangle | Additive (`lighter`) compositing |

### Trail, path, arrow
| Token | Hex | Used for | Note |
|---|---|---|---|
| `trail` | `#5EA0FF` | Flight trail, solid 2 px stroke; α fades to 0 over the last ~240 samples | Solid = "what happened" |
| `path` | `#DCE4FF` | Predicted path, dotted (round dots r 1.5 px every 10 px of arc length): α 0.7 for the first 80 % of the dots, α 0.35 for the last 20 %; ends with a ring r 6, stroke 1.5 px, α 0.5 | Dotted = "what might happen"; the dim tail is uncertainty, the ring is "where the plan runs out"; never the same colour or stroke as the trail |
| `arrow` | `#FFFFFF` | Drag arrow shaft and head | |
| `arrow.power` | `#3DE0C2` → `#FFC857` → `#FF5A5F` | Tints the arrow head and the power tick, low (0 %) → mid (50 %) → max (100 %), linear in sRGB | Borrows the fuel ramp so one ramp means "how much" everywhere. The 62 % sample in `drag-arrow.svg` is `#FFAE59` (mid → max at t 0.24) — a ramp value, not a new token |

### UI
| Token | Value | Used for | Note |
|---|---|---|---|
| `ui.text` | `#ECF0FA` | Primary text, mode label, inactive segment text | |
| `ui.textMuted` | `#8B95B5` | Wordmark, labels, telemetry, subtitles | Still passes AA |
| `ui.textDim` | `#4B5470` | Decorative/disabled only | Fails body-text contrast on purpose; never for copy the player must read |
| `ui.panel` | `rgba(10,13,26,0.72)` | Translucent panel/button fill | Result card uses it at α 0.92 |
| `ui.border` | `rgba(255,255,255,0.10)` | 1 px hairline on panels and secondary buttons | |
| `ui.accent` | `#5EA0FF` | Primary button fill, active segment | Text on it is `bg.base` `#050710` |
| `ui.shadow` | `rgba(5,7,16,0.50)` | Result card drop shadow: blur 16 px (σ 8), offset y 8 | `bg.base` at α 0.5, not black — pure black is reserved for `bg.edge`. The only `shadowBlur` in the game, drawn once (see §4) |

### Fuel
| Token | Hex | Used for | Note |
|---|---|---|---|
| `fuel.full` | `#3DE0C2` | Fuel bar ≥ 30 % | |
| `fuel.low` | `#FFC857` | Fuel bar 10–30 % | |
| `fuel.critical` | `#FF5A5F` | Fuel bar < 10 % | |

### Results
| Token | Hex | Used for | Note |
|---|---|---|---|
| `result.win` | `#3DE0C2` | "Planet X reached" title + accent bar | Same mint as the target: you reached *that* |
| `result.crash` | `#FF5A5F` | "Crashed" title + accent bar | |
| `result.lost` | `#B48CFF` | "Lost in space" title + accent bar | Violet is used nowhere else — cold and quiet |

### Contrast (WCAG 2.x, computed from relative luminance)
| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `ui.text` `#ECF0FA` | `#050710` | 17.6 : 1 | AAA |
| `ui.text` `#ECF0FA` | `bg.edge` `#000000` | 18.4 : 1 | AAA (v1.1: the HUD corners sit on near-black; contrast only goes up) |
| `ui.textMuted` `#8B95B5` | `#050710` | 6.8 : 1 | AA body, AAA large |
| `ui.textMuted` `#8B95B5` | `bg.edge` `#000000` | 7.1 : 1 | AAA (just) — wordmark and telemetry live in the corners, on the darkest part of the vignette |
| `ui.textDim` `#4B5470` | `#050710` | 2.7 : 1 | Fails — decorative only (intended) |
| `ui.accent` `#5EA0FF` | `#050710` | 7.6 : 1 | AAA |
| `#050710` | `ui.accent` `#5EA0FF` | 7.6 : 1 | AAA (button label) |
| `result.win` `#3DE0C2` | `#050710` | 12.1 : 1 | AAA |
| `result.crash` `#FF5A5F` | `#050710` | 6.6 : 1 | AA body, AAA at 40 px |
| `result.lost` `#B48CFF` | `#050710` | 7.8 : 1 | AAA |

The result card is `ui.panel` at α 0.92 over the scrim, which composites to ≈ `#0A0D1A`; ratios on that drop by ~0.3 and every verdict above still holds. Nothing else changes with the black edge: the vignette is `bg.base` or lighter everywhere a result card or a button sits.

### Gradient stops (canon, as defined in the asset SVGs)
The body gradients are built only from the tokens above; these are the exact stops the asset SVGs define (each file's header comment lists them), and `canvas-notes.md` §3–4 and the mockups reproduce them unchanged. Radial gradients are measured from each layer's own radius; "userSpace" means the SVG positions the centre in px relative to the body centre, as the Canvas code does.

| Gradient (asset) | Radius / centre | Stops (offset → token, alpha) |
|---|---|---|
| Star glow (`star.svg`) | 200 | 0.00 `star.glow` α 0.50 · 0.23 α 0.45 · 0.65 α 0.12 · 1.00 α 0 |
| Star corona (`star.svg`, σ 3 blur in the SVG only) | 130 | 0.00 `star.corona` α 0.90 · 0.35 α 0.70 · 0.62 α 0.22 · 1.00 α 0 |
| Star streamers (`star.svg`, σ 6 blur in the SVG; Canvas: linear gradient along the wedge) | 10 wedges, base w 10–18 at r 48, tip at r T 110–175; + 2 lobes base 40, tip r 150 at 122° / 292° | `star.corona` α a (0.10–0.16; lobes 0.06) at the base → 0 at the tip. Seed `0x5747`; the ten (A°, w, T, α) values are tabulated in `canvas-notes.md` §3 |
| Star chromosphere (`star.svg`, σ 1.5 blur in the SVG; Canvas: three 1 px rings α 0.60 / 0.35 / 0.15 at r 46 / 47 / 48) | ring r 47, stroke 3 | `star.corona` α 0.60 |
| Star body (`star.svg`) | 46 | 0.00 `star.core` · 0.45 `star.body` · 0.78 `star.body` · 0.90 `star.corona` · 1.00 `star.limb` |
| Star granulation (`star.svg`) | clipped to r 46 | fractalNoise baseFrequency 0.11, 2 octaves, seed 3, saturate 0, contrast ×2 about 0.5, α 0.16, multiply |
| Start planet surface strip (`planet-start.svg`, filter `#psLand`) | one rect 428 × 68 (2P; P = round(2π · 34) = 214; noise over a 214 × 68 subregion, `feTile`d across the rect), scrolled 0 → +214 over 90 s through clip r 34; start phase: tile x 44 at the disc's left edge | fill `planet.start.ocean`; land: fractalNoise baseFrequency 0.030, 4 octaves, seed 7, `stitchTiles="stitch"`, alpha → linear slope 24, intercept −12.772 (threshold 0.553 = p68 → ≈ 32 % land), `planet.start.land`; highlands: same field, slope 6, intercept −3.358 (threshold 0.643), × 0.22, `planet.start.shadow`; merged over the ocean. Polar caps: bands y 0–8.16 and 59.84–68 (12 %), `planet.start.ice` α 1 · 0.6 α 0.9 · 1 α 0 toward the inner edge |
| Start planet cloud strip (`planet-start.svg`, `#psCloud`) | same 428 × 68 rect, scrolled 0 → +214 over 64 s, group α 0.5; start phase: tile x 0 at the left edge | fractalNoise 0.055, 4 octaves, seed 19, stitched, `feTile` over the filter region −4..432 × −4..72 (two periods; the blur sees periodic neighbours), colour `planet.start.cloud`, alpha → slope 14, intercept −6.85 (threshold 0.525 = p60 → ≈ 40 %), `feGaussianBlur` 0.8, composited `in` the tile |
| Start planet limb squash (`planet-start.svg`) | from the centre, radius r = 34 | 0.88 `planet.start.ocean` α 0 · 1.00 α 0.45 (texture fades to 55 % in the outer 12 % of r) |
| Start planet glint (`planet-start.svg`) | ellipse rx 7.5 (0.22 r) × ry 4.1 (0.12 r) at 0.45 r · L = (+10.82, −10.82), `rotate(−45)` — the long axis lies along L | 0.00 `planet.specular` α 0.35 · 0.50 α 0.18 · 1.00 α 0 |
| Start planet shade (`planet-start.svg`) | userSpace centre 0.36 r · L = (+8.66, −8.66), radius 1.25 r = 42.5 | 0.00 `planet.start.highlight` α 0.90 · 0.40 `planet.start.base` α 0 · 0.70 `planet.start.shadow` α 0.55 · 0.86 α 0.92 · 1.00 α 1.0 (v1.1, unchanged) |
| Start planet rim (`planet-start.svg`) | from the centre, radius 1.12 r = 38.08; × alpha mask linear along L from (+26.93, −26.93) α 1.0 to (−26.93, +26.93) α 0.35 | 0.00 `planet.start.atmo` α 0 · 0.80 α 0 · 0.87 α 0.55 · 0.92 α 0.30 · 1.00 α 0 (v1.1, unchanged) |
| Planet X surface strip (`planet-x.svg`, `#pxSurface`) | one rect 376 × 60 (2P; P = round(2π · 30) = 188; each noise field over a 188 × 60 subregion, `feTile`d), scrolled 0 → +188 over 120 s through clip r 30; start phase: tile x 40 at the left edge | fill `planet.x.base`; basins: fractalNoise 0.035, 4 octaves, seed 11, stitched, alpha → slope 12, intercept −6.508 (threshold 0.584 = p72 → ≈ 28 %), × 0.60, `planet.x.mineral`; veins: turbulence 0.040, 2 octaves, seed 11, stitched, alpha → slope −14.29, intercept 1 (bright where the field < 0.07 → ≈ 5 %), × 0.35, `planet.x.mineral`; merged over the base. Polar caps: bands y 0–10.8 and 49.2–60 (18 %), `planet.x.ice` α 1 · 0.6 α 0.9 · 1 α 0 |
| Planet X wisp strip (`planet-x.svg`, `#pxWisp`) | same 376 × 60 rect, scrolled 0 → +188 over 80 s; start phase: tile x 0 at the left edge | turbulence 0.050, 2 octaves, seed 23, stitched, colour `planet.x.wisp`, alpha → slope −8.7, intercept 1 (bright where the field < 0.115 → ≈ 15 %), × 0.35; no blur |
| Planet X limb squash (`planet-x.svg`) | from the centre, radius r = 30 | 0.88 `planet.x.base` α 0 · 1.00 α 0.45 |
| Planet X shade (`planet-x.svg`) | userSpace centre 0.36 r · L = (−7.64, +7.64), radius 1.25 r = 37.5 | 0.00 `planet.x.highlight` α 0.90 · 0.40 `planet.x.base` α 0 · 0.70 `planet.x.shadow` α 0.55 · 0.86 α 0.92 · 1.00 α 1.0 (v1.1, unchanged) |
| Planet X rim (`planet-x.svg`) | from the centre, radius 1.12 r = 33.6; × alpha mask linear along L from (−23.76, +23.76) α 1.0 to (+23.76, −23.76) α 0.35 | 0.00 `planet.x.atmo` α 0 · 0.80 α 0 · 0.87 α 0.55 · 0.92 α 0.30 · 1.00 α 0 (v1.1, unchanged) |
| Planet X halo (`planet-x.svg`) | 1.8 r = 54, scaled 1 → 1.04 → 1 → 0.96 → 1 over 2.4 s (sine, in phase with the ring) | 0.00 `planet.x.base` α 0.35 · 0.556 α 0.35 · 0.78 α 0.10 · 1.00 α 0 |
| Planet X capture ring (`planet-x.svg`) | r 78 → 80 → 78 → 76 → 78 over 2.4 s (sine); dash `6 6`, stroke 1.5, `stroke-dashoffset` 0 → −12 over 1 s (−12 px/s) | `planet.x.ring` α 0.55 → 0.70 → 0.55 → 0.35 → 0.55 over 2.4 s (sine, `keySplines 0.42 0 0.58 1`); t = 0 = the v1 static state (α 0.55, r 78) |
| Vignette (mockups, `canvas-notes.md` §1) | centre (720, 450), r 900, over a `bg.edge` fill | 0.00 `bg.vignette` · 0.55 `bg.base` · 1.00 `bg.edge` |
| Milky Way (`starfield.svg`) | ellipses at −28° through (720, 450): rx 1100 × ry 150, and rx 900 × ry 70 offset 25 px; masked by fractalNoise 0.0025, 3 octaves, seed 5 (contrast 1.5 n − 0.2 — gentle, so the band stays one continuous lane with mottling, not detached patches) | `milkyway.dust` α 0.06 · 0.55 α 0.03 · 1.00 α 0, and α 0.05 → 0; peak after masking 0.054 (budget ≤ 0.08). Canvas: three unmasked ellipses α 0.05 / 0.04 / 0.03 |
| Star halos (`starfield.svg`) | r 4.5 on the 12 largest near stars | own tint α 0.18 → 0 |

The only hex in `design/` that is not a token in the tables above or in the §8 body-library tables is the computed ramp value `#FFAE59` (`arrow.power` at 62 %, see the Trail/path/arrow table); the rim masks use `#FFFFFF` only as a luminance for alpha, and the glint's `#FFFFFF` is `planet.specular`. The soft thresholds in the strips are `feComponentTransfer` / `feFuncA type="linear"` with slope s and intercept 0.5 − s · T, T being the threshold on the turbulence alpha channel; the thresholds were set from measured percentiles of each stitched field so the coverages above hold over the whole tile.

## 3. Typography

No licensed font is needed: the shipping stack is the operating system's own UI face, and the fallback web font (Inter) is SIL Open Font License.

| Role | Stack |
|---|---|
| UI | `-apple-system, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif` |
| Mono / telemetry | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` — `font-variant-numeric: tabular-nums` (Canvas: pad numbers to a fixed width) |

| Element | Size | Weight | Case / tracking | Colour |
|---|---|---|---|---|
| Wordmark "SLINGSHOT" | 13 px | 500 | uppercase, 0.18 em | `ui.textMuted` |
| Mode label | 11 px | 500 | uppercase, 0.14 em | `ui.text` |
| HUD labels ("FUEL") | 11 px | 500 | uppercase, 0.14 em | `ui.textMuted` |
| Body / labels | 13 px | 400 | sentence case, 0 | `ui.text` |
| Buttons | 14 px | 600 | sentence case, 0 | `#050710` on accent, `ui.text` on panel |
| Telemetry | 12 px mono | 400 | as-is, 0 | `ui.textMuted` |
| Result title | 40 px | 600 | sentence case, 0 | result colour |
| Result subtitle | 16 px | 400 | sentence case, 0 | `ui.textMuted` |

Rules: letter-spacing lives on uppercase microcopy only (wordmark, mode label, HUD labels); titles, buttons and body are never tracked. Numbers in the HUD are mono so "61 %" and "100 %" do not jitter. Text is drawn with `textBaseline = "alphabetic"` at integer pixel positions, no shadow, no stroke.

Self-hosting Inter later: drop `Inter-Variable.woff2` (OFL, copy the licence file alongside) into `/public/fonts`, declare one `@font-face { font-family: Inter; font-display: swap; }`, and leave the stack unchanged — Inter is already third in line, so it simply wins on machines without a native UI font. Load it before the first `ctx.fillText` (`document.fonts.load`) so the Canvas does not paint the fallback and then reflow.

## 4. Glow & blur rules

Glow is a budget, not a style. Canvas `shadowBlur` is the single most expensive thing in the 2D API; every blur on a moving object costs a full-size readback per frame. So:

1. **Glow belongs to exactly two things: the star and planet X.** Two glowing bodies give the eye a warm anchor and a cool goal; a third would flatten the hierarchy. Everything else is flat fill plus, at most, one gradient — or, in v1.1, a cached sprite that *contains* its gradients. The atmosphere rims, the star halos in the sky and the Milky Way are not glow: none of them extends past 1.12 r / r 4.5 / α 0.08, none of them animates. v1.3 (§8): the rule is **per scene** — the scene's star (any of the six; a compact object's glow, beams and accretion disk count as the star's) plus planet X. The lava world's faint static halo (1.4 r, `lava.atmo` α 0.18) is the one documented planetary exception; no other library body blooms, and the gas giant's ring, the double planet's companion and the airless bodies have no rim at all.
2. **Star:** one cached 400×400 sprite, blitted every frame and breathing ±3 % over 6 s. v1.1 made the sprite richer — glow → corona → ten gradient streamers and two lobes → chromosphere rings → limb-darkened body → granulation — but it is still one `drawImage`. The SVG's blurs (corona σ 3, streamers σ 6, chromosphere σ 1.5) are presentation only; Canvas replaces them with gradient falloff, a linear gradient along each wedge and three 1 px rings. Never `shadowBlur`.
3. **Planet X:** soft outer halo = a **live** radial-gradient fill at ×1.8 r (`planet.x.base` α 0.35 to the planet's edge, 0.10 at 0.78, 0 at the rim): one `createRadialGradient` + one `arc` fill per frame, no blur, ~0.05 ms, and it scales cleanly with zoom because nothing is rasterised. Not part of the sprite (it would be clipped at 1.12 r). The dashed capture ring is a live stroke too (cheap; see §5 for its pulse and dash crawl).
4. **Planets (both), v1.2: cached strips + a cached lighting overlay.** The surface is a **texture strip** of period P = round(2π r) (214 / 188 px at zoom 1), two tiles wide, rendered once: base colour → thresholded noise layers (land + highlands / basins + veins) → polar-cap bands; a second strip holds the clouds / wisps. Per frame each planet is **one circular clip, two strip `drawImage` with a time-based x offset (surface, then cloud/wisp), and one `drawImage` of the lighting overlay** — a (2 · 1.12 r + 4) px square (81 / 72 px at zoom 1) holding the limb squash (base α 0 at 0.88 r → 0.45 at r), the glint (start only), the terminator shade (centre 0.36 r toward the star, radius 1.25 r, transparent at 0.40, night side from 0.70), the 1 px limb line and the atmosphere rim (1.12 r, `planet.*.atmo`, lit mask 1.0 → 0.35). That is 3 `drawImage` + 1 clip per planet per frame (the brief's "2 drawImage + clip" counts one strip; the cloud/wisp strip is the third), ≈ 0.08 ms each, and **still 0 `shadowBlur`, 0 per-frame noise, 0 per-frame blur**: the rotation is nothing but a changing source offset, wrapped modulo P so it never seams. Strips and overlay are rebuilt only when the zoom bucket changes (buckets at 1.25^k, 25 % apart, flipping ±11.8 % about each centre — `canvas-notes.md` §12). The lighting overlay never rotates.
5. **Ship:** no glow, ever. The 1 px `ship.outline` does the job of separating it from bright backgrounds. Thrust flash: two additive triangles (`globalCompositeOperation = "lighter"`), `thrust.outer` under `thrust.core`, alive for one frame per thrust tick, **drawn with no blur in Canvas** — `ship-thrust.svg` (and `flight.svg`, which instances it) keeps a small presentation blur (σ 1.2 outer / 0.4 core) on the two triangles, but that is for the SVG asset only (see §7 and `canvas-notes.md` §6).
6. **Trail:** per-segment alpha, no blur. **Predicted path:** dots, no blur. Both must stay sharp so the player can read them against the star's haze.
7. **UI:** no text shadows. Panels are `ui.panel` with a `ui.border` hairline and 10 px radius; the translucency over the starfield is all the depth we need.
8. **Background, v1.1: richer, still cached.** Vignette to black, three Milky-Way gradients, ~1005 dots, 12 halo gradients and 4 sparkles are drawn once into the background canvas (≈ 2.5 ms) and blitted as the per-frame clear. The SVG asset's turbulence mask on the band is replaced by three unmasked gradients in Canvas.
9. **Exactly one `shadowBlur` in the game, and it never repeats:** the result card's drop shadow, `ui.shadow` `rgba(5,7,16,0.5)`, blur 16 px (σ 8), offset y 8. It is rendered once into the offscreen card (520×232 plus a 64 px margin, so 3σ + offset = 32 px never clips) when a result fires; every frame after that is one blit. Never on anything that moves, never on the HUD, never in play.

**Glow budget (per frame):**
- 1 cached star sprite (gradients + streamers + chromosphere + limb darkening + granulation, breathe scale) — blit
- 0 blits for the planet X halo — 1 live radial-gradient fill (breathing ±4 % over 2.4 s)
- 2 planets × (1 clip + 2 cached strip blits with a scrolling offset + 1 cached lighting-overlay blit) — 6 blits, replacing v1.1's two sprite blits; the strips carry land / clouds / basins / wisps / caps, the overlays carry squash / glint / terminator / limb / rim
- 1 dashed ring stroke — live
- 1 cached background (vignette to black + Milky Way + tinted starfield + halos) — blit
- 0 `shadowBlur` in play; 1 on the result card, drawn once (`ui.shadow`)
- 0 blur, noise or blend modes on ship, trail, path, arrow, HUD — and none anywhere per frame
- v1.3, per library star (`canvas-notes.md` §3b): 1 envelope blit (breathing) + ≤ 3 pre-blurred loop blits + 1 live gradient triangle + 1 body blit — no runtime blur
- v1.3, per compact object (§3c): white dwarf 2 blits, neutron star 3 (one rotated), black hole 6 (3 static cells, the disk ring drawn twice under half clips, 1 Doppler overlay)
- v1.3, per library planet (§4b): as the v1.2 planets — 1 clip + 2–4 strip blits + 1 overlay; the ringed giant adds 2 static ring blits, the double planet is two planets

## 5. Motion feel

Slow, eased, weightless. Nothing snaps; nothing bounces.

| What | Duration | Easing | Note |
|---|---|---|---|
| Button hover | 120 ms | ease-out | fill lightens ~8 %; no scale |
| Button press | 80 ms | ease-in | fill darkens; no scale |
| Result overlay in | 320 ms | ease-out cubic | fade 0→1 with a 12 px rise |
| Capture ring pulse | 2.4 s loop | sine | α 0.35 ↔ 0.70, radius ±2 px |
| Capture ring dash crawl | continuous | linear | `[6, 6]` dashes drift along the ring at −12 px/s via `lineDashOffset` (one dash period per second); runs together with the pulse |
| Planet X halo breathe | 2.4 s loop | sine | halo radius scale 1 → 1.04 → 1 → 0.96 → 1 (±4 %), in phase with the ring pulse; t = 0 is the rest size. v1.2 |
| Start planet surface | 90 s per rotation | linear, continuous | the 214 px strip (land, highlands, caps) scrolls west→east — the texture moves left→right — at 214 / 90 ≈ 2.4 px/s at zoom 1; a feature crosses the disc in ≈ 29 s. v1.2 |
| Start planet clouds | 64 s per rotation | linear, continuous | the cloud strip at 214 / 64 ≈ 3.3 px/s, so clouds drift over the land at ≈ 1.0 px/s and lap it every ≈ 222 s. v1.2 |
| Planet X surface | 120 s per rotation | linear, continuous | the 188 px strip (basins, veins, caps) at 188 / 120 ≈ 1.6 px/s; a feature crosses the disc in ≈ 38 s. v1.2 |
| Planet X wisps | 80 s per rotation | linear, continuous | the wisp strip at 188 / 80 ≈ 2.35 px/s, lapping the surface every 240 s. v1.2 |
| Star breathe | 6 s loop | sine | cached envelope sprite scale ±3 % (glow, corona, streamers, lobes); v1.3: the body, chromosphere, loops and flare do **not** breathe, so the crash disc never moves; no rotation, no flicker |
| Prominence loops (v1.3, every star) | 12 / 16 / 14 s loops, begin 0 / 5 / 9 s | sine (ease-in-out both ways) | three cached pre-blurred arcs on the limb, each scaled 0.6 → 1.0 → 0.6 about its base point with α 0 → 0.55 → 0; peaks at 6 + 12n / 13 + 16n / 16 + 14n s, never together; invisible at t = 0 |
| Flare (v1.3, every star) | 22 s cycle | triangle | one thin core → body wedge from the limb to 1.7 r, α 0 → 0.7 → 0 between 13.0 and 14.8 s (peak 13.9 s), then nothing — a quiet pop |
| White dwarf glow breathe | 4 s loop | sine | glow sprite ±5 %; the disc does not move |
| Neutron star beams | 6 s per turn | linear | the magnetosphere (two beam cones + haze) rotates clockwise, 30° at t = 0 |
| Black hole disk | 24 s per turn | linear | the ring texture rotates clockwise inside the squash; shadow, photon ring, arcs, Einstein ring static |
| Lava vein pulse | 5 s loop | sine | the vein strip's α 1.0 → 0.7 → 1.0 (full at t = 0); crust, halo and lighting static |
| Gas giant bands | 150 / 110 / 180 s (banded), 160 / 120 s (ringed) | linear, continuous | band groups drift in counter-flow (+ − + / + −) at 1.5–2.5 px/s; the ring never moves |
| Double planet orbit | 40 s per revolution | uniform | the pair circles its barycentre clockwise on a tilted ellipse (ry = 0.36 rx), the companion passing in front at the bottom and behind at the top; both also rotate (80 s / 60 s) |
| Library planet surfaces | 95–180 s per rotation | linear, continuous | rocky 110, ice 140, lava 95, toxic 120 (clouds 75), cracked 100, moon 180, dwarf 160 s — the same strip scroll as the v1.2 planets, 0.4–1.7 px/s at zoom 1 |
| Ship heading | per frame | lerp 0.18 | eases toward velocity heading |
| Fuel bar drain | 140 ms | ease-out | width tween + colour step at 30 % / 10 % |
| Thrust flash | 1 frame | — | on per tick, then gone |

**Pulses / breathes / drifts:** the star corona (breathe), planet X's capture ring (α/radius pulse plus the dash crawl) and halo (breathe), and the four planet strips (two per planet, each at its own period); on the win overlay the ring is frozen at full α with the crawl stopped (the surfaces keep turning — they are weather, not state). That is the complete list. v1.3 adds, body by body (§8): the stars' loops and flares and the white dwarf's glow breathe (the only new scale animations), the neutron star's beams and the black hole's disk texture (the only rotations — of emissive texture, never of lighting), the lava world's vein pulse (the only new opacity pulse), the gas giants' band drift and the library planets' strips (scrolls), and the double planet's orbit (the only body that moves). All of them are wall-clock, all loop seamlessly, none is faster than the 6 s beam sweep, and none of them touches a crash radius.

**Lighting never rotates.** On both planets the day side, the terminator, the limb squash, the atmosphere rim and the ocean glint are fixed to the star direction L; only the texture under them moves. The polar caps are part of the strip and scroll with it, but as full-width bands they look fixed — which is the intended reading. Rotation is wall-clock time (`dt`-based phase), the same at 1x, 2x and 4x; the two strips of a planet run at different periods on purpose (clouds 64 s over land 90 s; wisps 80 s over basins 120 s), and all four periods are long enough that nothing reads as "spinning" — in a 20 s flight the start planet turns 80°.

**Never animates:** the starfield (static, no parallax, no twinkle — including the tinted stars, their halos and the Milky Way), the vignette, the planets' lighting (terminator, rims, glint, squash), the star's interior (no rotation, no flicker), the HUD text, panel borders, the predicted path (it re-computes on drag but does not "flow"), the trail (it fades by age, it does not shimmer). Speed buttons 1x/2x/4x change simulation steps per frame, never the frame rate, the rotation periods or any easing above.

## 6. Layout & HUD

Scene and HUD positions for a 1440×900 frame, origin top-left. Same in every mode; everything not listed is empty space.

| Element | Position / size | Spec |
|---|---|---|
| Background | full frame | `bg.edge` fill, radial vignette from (720, 450) r 900: `bg.vignette` → `bg.base` at 0.55 → `bg.edge` at the rim; then the Milky Way (−28° through the centre) and the starfield |
| Central star | c (760, 470), r 46 | chromosphere r 47, streamers to r 110–175, corona to ~r 130, glow to r 200 |
| Start planet | c (250, 690), r 34 | ocean world, lit from the upper-right; surface strip 214 px / 90 s, clouds 64 s; glint at (+10.82, −10.82); 1 px limb line α 0.16; atmosphere rim to r 38.08 (1.12 r); ship sits on its upper-right limb while planning |
| Planet X | c (1190, 210), r 30 | mineral world, lit from the lower-left; surface strip 188 px / 120 s, wisps 80 s; halo to r 54 (×1.8, breathing ±4 %), 1 px limb line α 0.18, rim to r 33.6, capture ring r 78 (76–80 with the pulse) dashed `[6, 6]` |
| Ship | 22 px long | planning: on start limb; flight: ≈ (900, 380), thrust on |
| Predicted path | planning only | dotted, bends around the star's right/lower side toward X; may stop short — last 20 % of dots at α 0.35, r 6 end ring |
| Drag arrow | planning only | from the ship, ~140 px, up-right, tick + label "62 %" |
| Trail | flight only | solid, fading, from start planet around the star |
| Wordmark | baseline (40, 50) | "SLINGSHOT" 13 px uppercase `ui.textMuted`, weight 500; mode label under it at baseline (40, 70), 11 px uppercase `ui.text`, weight 500 |
| Fuel | x 1180–1400 | "FUEL" 11 px uppercase muted, weight 500, left at x 1180 baseline 48 · "100 %"/"61 %" 12 px mono `ui.text`, right-aligned at x 1400 baseline 48 · bar 220×8 at (1180, 56), rounded, track `rgba(255,255,255,0.08)`, fill `fuel.*` |
| Planning action | centred on (720, 820) | "Launch" 160×44 (x 640–800, y 798–842), radius 10, `ui.accent` fill, `#050710` 14 px semibold text at baseline 825 |
| Flight actions | centred on y = 820 | [1x][2x][4x] 56×36 each at x 580 / 636 / 692, y 802–838 (active `ui.accent`/`#050710`; inactive `ui.panel`/`ui.text`), then 16 px gap, "Reset" 96×36 at x 764–860 `ui.panel` + `ui.border`; labels 14 px semibold at baseline 825 |
| Telemetry | baseline (40, 864) | 12 px mono `ui.textMuted`, "v 1.84  ·  dX 412" (planning: "v —  ·  dX 1030") |
| Result overlay | card 520×232 centred at (720, 450) | scrim `rgba(5,7,16,0.62)` over the flight scene **and the HUD** (both dimmed, in all three results); card `ui.panel` α 0.92, `ui.border`, radius 16, drop shadow `ui.shadow` blur 16 (σ 8) / offset y 8; 4 px accent bar on top in the result colour; title 40 px weight 600; subtitle 16 px muted; "Fly again" 140×40 primary |

## 7. Asset index

One row per file in `design/assets`. Every SVG is hand-authored, self-contained (no scripts, no external refs, no raster) and uses only the tokens above. "Anchor" is the point the game positions and rotates; "Mockup" is the size at which it appears in the 1440×900 mockups (zoom 1). The three body assets are structured as `<defs>` (ids prefixed `star*`, `ps*`, `px*`) plus **one group** — `<g id="star" transform="translate(200 200)">`, `<g id="planetStart" transform="translate(60 60)">`, `<g id="planetX" transform="translate(120 120)">` — with all geometry relative to (0, 0), so a mockup copies the group verbatim and only changes the translate. The sixteen v1.3 library files in `design/assets/bodies/` follow the same structure (one group, prefixed ids, header comment, SMIL inside) and are indexed in §8 and in `assets.md`.

| Asset | File | viewBox | Anchor / centre | Colours | Mockup |
|---|---|---|---|---|---|
| Ship | `ship.svg` | `0 0 24 24` | (12, 12), nose up (−y); hull spans y 2 → 21 | `ship.hull` `#F2F5FF`, `ship.outline` `#0A0D1A` 1 px, `ship.cockpit` `#5EA0FF` | 22 px long (scale 22/19 ≈ 1.158 via `<g id="ship">` + `<use>`); min 12 px at any zoom |
| Ship + thrust | `ship-thrust.svg` | `0 0 32 48` | ship at (16, 14) (same geometry, translated 4, 2); flame from y 19.5 to 41, behind the hull | ship colours + `thrust.outer` `#FF6A2A` α 0.90 (10×21.5), `thrust.core` `#FFE08A` (5.2×14); presentation blur σ 1.2 / 0.4 in the SVG only — Canvas draws the triangles with no blur (§4) | same 22 px ship, flame ≈ ship length; 1 frame per thrust tick |
| Start planet (ocean world, animated) | `planet-start.svg` | `0 0 120 120` | `#planetStart` at (60, 60), r 34, lit from the upper-right (L = (+0.7071, −0.7071)); strip tile 214 × 68 (P = 214) scrolled through clip `#psClip`; glint at (+10.82, −10.82); shade centre (+8.66, −8.66), radius 42.5; rim r 38.08 | `planet.start.ocean` `#3D8BFF` base + strip fill; `planet.start.land` `#8FB07A` (fractalNoise 0.030 / 4 oct / seed 7, p68 → 32 %) with highlands `#142B5E` × 0.22 (threshold 0.643); caps `planet.start.ice` `#E9EEF8` 12 %; clouds `planet.start.cloud` `#F2F5FF` (0.055 / 4 oct / seed 19, p60 → 40 %, blur 0.8, group α 0.5); squash `#3D8BFF` α 0 → 0.45; glint `planet.specular` `#FFFFFF` α 0.35; shade `planet.start.highlight` `#9CCBFF` α 0.90 → base α 0 (0.40) → `planet.start.shadow` `#142B5E` α 0.55 / 0.92 / 1.0 (0.70 / 0.86 / 1.00); limb line `#9CCBFF` α 0.16; rim `planet.start.atmo` `#7FB8FF` α 0.55 peak, lit 1.0 → dark 0.35 | 1 : 1 at (250, 690), t = 0; SMIL: surface 90 s, clouds 64 s. Canvas: 2 cached strips (428 × 68) + cached 81 px lighting overlay, 3 blits + 1 clip per frame |
| Planet X (mineral world, animated) | `planet-x.svg` | `0 0 240 240` | `#planetX` at (120, 120), r 30, lit from the lower-left (L = (−0.7071, +0.7071)); strip tile 188 × 60 (P = 188) through clip `#pxClip`; shade centre (−7.64, +7.64), radius 37.5; rim r 33.6; halo r 54; ring r 78 | halo `#3DE0C2` α 0.35 → 0 (breathes ±4 %); `planet.x.base` `#3DE0C2` base + strip fill; basins `planet.x.mineral` `#0E4A40` × 0.60 (fractalNoise 0.035 / 4 oct / seed 11, p72 → 28 %) + veins × 0.35 (turbulence 0.040 / 2 oct / seed 11, < 0.07 → 5 %); caps `planet.x.ice` `#B5FFF0` 18 %; wisps `planet.x.wisp` `#B5FFF0` × 0.35 (turbulence 0.050 / 2 oct / seed 23, < 0.115 → 15 %); squash `#3DE0C2` α 0 → 0.45; shade `planet.x.highlight` `#B5FFF0` α 0.90 → base α 0 → `planet.x.shadow` `#0E4A40` α 0.55 / 0.92 / 1.0; limb line `#B5FFF0` α 0.18; rim `planet.x.atmo` `#8FFFE6`; ring `planet.x.ring` `#3DE0C2` 1.5 px dash 6 6 α 0.55 → 0.70 → 0.55 → 0.35, r 78 ± 2, crawl −12 px/s | 1 : 1 at (1190, 210), t = 0; SMIL: surface 120 s, wisps 80 s, ring 1 s / 2.4 s, halo 2.4 s. Canvas: live breathing halo + 2 cached strips (376 × 60) + cached 72 px overlay + live ring |
| Star | `star.svg` | `0 0 400 400` | `#star` at (200, 200); body r 46, chromosphere r 47, streamers r 48 → 110–175, corona r 130, glow r 200 (α 0) | `star.glow` `#FF5A1F`, `star.corona` `#FF8C2E` (corona, 10 streamers α 0.10–0.16 + 2 lobes α 0.06 at seeded angles `0x5747`, chromosphere α 0.60), body `star.core` `#FFF8E1` → `star.body` `#FFC857` (0.45–0.78) → `#FF8C2E` (0.90) → `star.limb` `#FF5A1F`; granulation noise (0.11, seed 3, ×2, multiply α 0.16); SVG blurs σ 3 / 6 / 1.5 are presentation only | 1 : 1 at (760, 470); cached sprite, breathes ±3 % |
| Starfield | `starfield.svg` | `0 0 1440 900` | top-left (0, 0), full frame, static; one group `#starfield` = `#milkyway` → `#far` → `#mid` → `#near` (`#nearHalos` first) → `#sparkles` | Milky Way `milkyway.dust` `#AAB8DD` (2 ellipses at −28°, turbulence-masked, peak α 0.054) + 380 dots `stars.far` r 0.5 α 0.28 · far `stars.far` `#6E7FA6` r 0.6 α 0.35 ×420 · mid r 0.8–1.0 α 0.55–0.65 ×160 · near r 1.2–1.5 α 0.85–0.95 ×45, both tinted `stars.cool` `#B8CCFF` / `stars.neutral` `#E9EEF8` / `stars.warm` `#FFD9B0` (mid 38 / 85 / 37, near 9 / 27 / 9) · 12 halos r 4.5 α 0.18 → 0 · 4 sparkles `#FFFFFF` (1005 dots) | full frame, 1 : 1; part of the cached background. Seeds: positions `0x514E47`, magnitude/tint `0x514E48`, Milky Way `0x4D57` |
| Flight trail | `trail.svg` | `0 0 600 200` | tail (30, 150) → head (570, 62) with the ship at the head | `trail` `#5EA0FF`, 2 px, round caps, 24 sample segments α 0.04 → 1.0, each standing for 10 game samples (a full 240-sample buffer under `canvas-notes.md` §7's rule); the mockups' trails use the same rule at their real sample counts, so their tails stay ≥ 0.6 | sample only; the mockups draw the real flown path |
| Predicted path | `predicted-path.svg` | `0 0 600 200` | start ship (30, 150) → end ring (570, 62) | `path` `#DCE4FF`: dots r 1.5 every 10 px, α 0.7 (first 80 %) / 0.35 (last 20 %); end ring r 6, stroke 1.5, α 0.5 | sample only; the planning mockup draws the real look-ahead |
| Drag arrow | `drag-arrow.svg` | `0 0 300 120` | origin = ship centre (36, 92), launch direction −18°; shaft starts 16 px out; 62 % = 150 of the 242-unit full extent | ghost `#FFFFFF` α 0.16 1 px dash `[1, 5]`; shaft `arrow` `#FFFFFF` α 0.9 2 px; head + tick `arrow.power` at 62 % = `#FFAE59`; label `ui.textMuted` `#8B95B5` 12 px mono | ~140–150 px long from the ship, up-right, tick + "62 %" |

Mockups (`design/mockups`, all `0 0 1440 900`): `planning.svg`, `flight.svg`, `result-win.svg`, `result-crash.svg`, `result-lost.svg`. They are assembled from the assets above: the `<defs>` of `star.svg`, `planet-start.svg`, `planet-x.svg` and the ship geometry of `ship.svg` (and, in `flight.svg`, the triangles and filters of `ship-thrust.svg`) are copied verbatim, the three body groups `#star` / `#planetStart` / `#planetX` are inlined with only their `translate` changed to (760 470) / (250 690) / (1190 210) (one exception: `result-win.svg` also sets the capture ring to `stroke-opacity="1"`, the win rule), and the `#starfield` group of `starfield.svg` is inlined byte-identically over the v1.1 vignette (`bg.edge` rect + the r 900 gradient), so all five show the same sky and bodies; only the scene content (path, arrow, trail, thrust, burst, ship pose) and the HUD values differ. Colours: every hex in `design/` is a §2 token except the documented ramp value `#FFAE59`. The result cards' drop shadow is `ui.shadow` (`#050710` at α 0.5, `feGaussianBlur stdDeviation="8"`, 8 px offset) — the same colour, σ and offset `canvas-notes.md` §11 passes as `shadowColor = "rgba(5,7,16,0.5)"`, `shadowBlur = 16`, `shadowOffsetY = 8`.

v1.3 adds two level compositions built the same way from library bodies, both PLANNING mode with the planning HUD (fuel 100 %, "Launch", telemetry) over the same vignette and `#starfield`: **`scene-variant.svg` / `.png`** — red dwarf at (700, 480) r 40 with its flares, ringed gas giant at (1000, 640) r 44 as the slingshot body, barren moon at (420, 300) r 14, start = rocky desert at (230, 700) r 30, planet X at (1210, 190) r 30 with its ring; the predicted path runs from the rocky world around the gas giant's far side toward X. **`scene-blackhole.svg` / `.png`** — black hole at (720, 460) with its disk tilted, ice world start at (230, 690) r 28, barren moon at (900, 250) r 14, planet X at (1200, 200) r 30; the path whips around the black hole's lower-right at a closest approach of 2.2 r (49 px = 2.21 r, outside the disk's inner edge and, on that side, outside the drawn disk) toward X. In both, every body group is the asset's `<defs>` + group spliced **verbatim** with only its `translate` changed, except the lighting of three bodies: lit side = toward the scene's star, so the ringed giant's terminator + lit-side rim (wrapper `rotate(−106.9)`, back-ring shadow wedge mirrored 230° → 310° in ring space) and the moons' terminators (`rotate(77.7)` in scene-variant, `rotate(175.6)` in scene-blackhole) sit in scene-local wrapper groups that point L at the star; their strips and the asset files are untouched. The rocky start, the ice start and planet X keep their asset lighting, which already faces the star. The Canvas build does the same per body (`canvas-notes.md` §4). In scene-variant the red dwarf's `rdProm2` (begin −7 s) and flare (begin −13.9 s) are phased so the static PNG shows them. Telemetry reads "v —  ·  dX 1068" / "dX 1052"; the drag arrow is at 62 % as in `planning.svg`.

Preview: `design/preview/planets.html` shows `planet-start.svg`, `planet-x.svg` and the v1.2 `star.svg` inline (verbatim markup, no scripts) on `bg.base` — the planets at 3× and at 1×, the star at 1 : 1 in both rows (its 3× would be 1200 px) —, labelled with the v1.2 rotation periods (start 90 s / 64 s, X 120 s / 80 s, ring pulse 2.4 s) — open it from `file://` to see the SMIL animation that the static mockups freeze at t = 0. planets.html and the five v1 mockups keep the **v1.2 star markup** (no `starBreathe`, loops or flare): it is pixel-identical to the current `star.svg` at t = 0 (loops and flare at α 0, breathe scale 1), so neither was re-inlined; if planets.html is ever re-inlined, remove its own 6 s CSS breathe, or the star breathes twice.

Gallery: `design/preview/bodies.html` inlines all 18 bodies (the sixteen `bodies/*.svg`, `planet-x.svg` and `star.svg`, verbatim, no scripts) on `bg.base`, one row per family — rocky worlds (3×), gas worlds (banded 3×, ringed 2.5×), small bodies (moon, dwarf and double 3×, planet X 2×), stars & compact objects (sun / red dwarf / blue giant 1.5×, white dwarf 2×, neutron star 3×, black hole 2×) — each tile labelled with the name, radius, rotation periods and what the body is for (the stars and compact objects also state their crash radius), plus a final "relative sizes" strip that re-uses every group through `<use>` inside one 1× SVG (2810 px wide; a ≥ 2890 px window shows it without scrolling; the stars are spaced so their glows meet only in their faint outer tails) so all 18 share a single timeline. Every prominence loop and flare is at α 0 at t = 0, so the first frame shows plain stars; the first loop is visible within about 2 s and the flare first pops at 13.9 s.

## 8. Body library (v1.3)

v1.3 turns the two planets and the one star into a **library of 18 bodies** — 12 planets and 6 stars / compact objects — so levels can be composed from different worlds. Every file follows the v1.1/v1.2 construction and lives in `design/assets/bodies/<name>.svg` (the ocean world is `bodies/ocean.svg`, a byte-for-byte copy of `planet-start.svg` with ids `ps*` → `oc*` and `#planetStart` → `#ocean`; planet X stays `planet-x.svg` and is not duplicated; the yellow sun stays `star.svg` and gains its flares in place). Each asset = `<defs>` with ids prefixed by the body's short code + **one** top-level group `<g id="<camelCaseName>" transform="translate(cx cy)">` with geometry relative to (0, 0), a header comment listing every parameter, and its SMIL animation inside. All 18 are inlined into one gallery page, `design/preview/bodies.html`, so the prefixes are unique across the whole set (`rk ic lv tx cr oc gb gr mn dw db rd bg wd ns bh` + `star* px*`; `ps*` only in `planet-start.svg`, which the gallery shows as `ocean.svg`), and the two new level mockups (`design/mockups/scene-variant.svg`, `scene-blackhole.svg`) compose them exactly as §7's mockups compose the original three.

**Direction (client decision): stay realistic.** Noise surfaces, a day/night terminator, an atmosphere rim, scrolling strips, lighting fixed to the star, cached sprites — all of §2 and §4 still apply. **Kurzgesagt** (the YouTube channel) is *inspiration only*, for three things: colour harmony (saturated but harmonious hues on deep navy), bold silhouettes that read at small sizes (strong rim light, clear shapes), and the framing of stars and flares (prominence loops drawn as clean arcs). Nothing of theirs is copied — no artwork, characters, logos or specific illustrations; every body here is drawn from scratch from the noise rules below. Everything stays calm and cheap: rotations take 40–180 s, the fastest things on screen are a 6 s beam sweep on an 8 px star and a 1.8 s flare once every 22 s, and nothing flickers.

### The set

r is the radius at zoom 1. **`crashRadius`** is the contact radius the game tests against: for every body it is the solid disc **r** — halos, coronas, glows, atmosphere rims, beams, the capture ring, the gas giant's ring and the black hole's accretion disk are never solid (the brief's rule for the compact objects: the black hole's gravity is *star-class* but it crashes only at its event horizon, r 22; the neutron star at r 8; the white dwarf at r 16). The double planet has two crash discs (18 and 11) that move with the orbit. "What it is for" is the gallery caption.

| Key | Name | File · group id · ids | r | crashRadius | Rotation | Family · what it is for |
|---|---|---|---|---|---|---|
| `rocky` | Rocky desert | `bodies/rocky.svg` · `#rocky` · `rk*` | 30 | 30 | surface 110 s | rocky · a warm, dry start world (scene-variant start) |
| `ocean` | Ocean world | `bodies/ocean.svg` · `#ocean` · `oc*` (= `planet-start.svg`) | 34 | 34 | surface 90 s, clouds 64 s | rocky · the original start planet |
| `ice` | Ice world | `bodies/ice.svg` · `#ice` · `ic*` | 28 | 28 | surface 140 s | rocky · a cold start world (scene-blackhole start) |
| `lava` | Lava world | `bodies/lava.svg` · `#lava` · `lv*` | 26 | 26 | surface 95 s, vein pulse 5 s | rocky · a hazard world that glows |
| `toxic` | Toxic cloud world | `bodies/toxic.svg` · `#toxic` · `tx*` | 32 | 32 | surface 120 s, clouds 75 s | rocky · a thick-atmosphere slingshot body |
| `cracked` | Cracked world | `bodies/cracked.svg` · `#cracked` · `cr*` | 27 | 27 | surface 100 s | rocky · a tidally stressed world near a heavy body |
| `gasBanded` | Banded gas giant | `bodies/gas-banded.svg` · `#gasBanded` · `gb*` | 44 | 44 | bands 150 / 110 / 180 s (counter-flow) | gas · the big slingshot mass |
| `gasRinged` | Ringed gas giant | `bodies/gas-ringed.svg` · `#gasRinged` · `gr*` | 44 | 44 | bands 160 / 120 s; ring static | gas · the big slingshot mass, with a ring to fly through |
| `moon` | Barren moon | `bodies/moon.svg` · `#moon` · `mn*` | 14 | 14 | surface 180 s | small · a small mass to nudge a path |
| `dwarf` | Dwarf planet | `bodies/dwarf.svg` · `#dwarf` · `dw*` | 10 | 10 | surface 160 s | small · the smallest planet, a precision target |
| `double` | Double planet | `bodies/double.svg` · `#double` · `db*` (`dbB*` big, `dbS*` small, `dbSF*`/`dbSB*` front/back copies) | 18 + 11 | 18 and 11 (moving) | orbit 40 s; surfaces 80 s / 60 s | small · a moving obstacle pair |
| `planetX` | Planet X | `planet-x.svg` · `#planetX` · `px*` | 30 | 30 | surface 120 s, wisps 80 s | target · unchanged, §2 |
| `sunYellow` | Yellow sun | `star.svg` · `#star` · `star*` | 46 | 46 | breathe 6 s; loops 12 / 16 / 14 s; flare 22 s | star · the default star |
| `redDwarf` | Red dwarf | `bodies/red-dwarf.svg` · `#redDwarf` · `rd*` | 40 | 40 | same | star · a dim, calm star (scene-variant) |
| `blueGiant` | Blue giant | `bodies/blue-giant.svg` · `#blueGiant` · `bg*` | 54 | 54 | same | star · a hot, wide-glow star |
| `whiteDwarf` | White dwarf | `bodies/white-dwarf.svg` · `#whiteDwarf` · `wd*` | 16 | 16 | glow breathe 4 s | compact · small, hot, dangerous |
| `neutronStar` | Neutron star | `bodies/neutron-star.svg` · `#neutronStar` · `ns*` | 8 | 8 | beams 6 s | compact · a tiny heavy mass with sweeping beams |
| `blackHole` | Black hole | `bodies/black-hole.svg` · `#blackHole` · `bh*` | 22 (event horizon) | 22 | disk 24 s | compact · star-class gravity, horizon-size crash (scene-blackhole) |

### Rules that stay, and the three terminators

- **Silhouettes stay circles** (plus the ring ellipse and the double pair). Every planet is the v1.2 construction: base disc → clip { one 2P × 2r strip per layer, P = round(2π r), noise stitched over one P-wide subregion and `feTile`d, scrolled 0 → +P (texture moves **left→right**) } → limb squash (base α 0 at 0.88 r → 0.45 at r) → terminator shade → 1 px limb line → [atmosphere rim at 1.12 r]. Each layer's thresholds come from measured percentiles of the actual Chrome `feTurbulence` field, so the coverages below hold over the whole tile.
- **Lighting never rotates, and in the library it always comes from the upper-right:** L = (+0.7071, −0.7071) for every planet (planet X keeps its lower-left L; in a level the game computes L from the body toward the scene's star, `canvas-notes.md` §4; the scene mockups do the same by wrapping only a body's lighting-overlay layers in `rotate(angle(L_scene) − angle(L_library))`). Stars and compact objects are emissive — no terminator, no rim.
- **Three terminator recipes** (radial gradient centred at +0.36 r·L):
  | Recipe | Radius | Stops | Bodies |
  |---|---|---|---|
  | soft (v1.1) | 1.25 r | 0.00 highlight α 0.90 · 0.40 base α 0 · 0.70 shadow α 0.55 · 0.86 α 0.92 · 1.00 α 1.0 | ocean, ice, rocky, cracked, double.big, planet X. **Documented exceptions:** toxic highlight α **0.70** (0.90 washed the pale deck into a lime spot), lava highlight α **0.55** (the surface is emissive; a 0.9 wash hid the veins) |
  | gas (soft, wide) | 1.25 r | 0.00 highlight α 0.55 · 0.40 base α 0 · **0.64** shadow α 0.30 · 0.86 α 0.90 · 1.00 α 1.0 | gasBanded, gasRinged — the shadow starts earlier and lower, so the terminator is wider and softer |
  | airless (hard) | **1.5 r** | 0.00 highlight α 0.55 · 0.40 base α 0 · 0.62 dark α 0.30 · **0.70 `bg.base` α 0.84** · 1.00 `bg.base` α 0.92 | moon, dwarf, double.small. The 0.62 → 0.70 step is the hard terminator (≈ 1.2–1.7 px at 1×). The radius is 1.5 r, not the brief's 1.25 r: with the step at 0.62–0.70 the larger radius lands the terminator where v1.1's 0.78 mid-stop lands (≈ 0.62 r past the centre), so the night stays a crescent instead of swallowing the disc. The night side is `bg.base` because these bodies have no shadow token; a 1 px limb line (highlight, α 0.14) keeps the dark silhouette readable — it is not an atmosphere |
- **Atmosphere rim** (1.12 r, `atmo`, 0.80 α 0 · 0.87 peak · 0.92 peak × 0.545 · 1.00 α 0, lit mask 1.0 → 0.35): peak α **0.55** (ocean, ice, toxic, cracked, gas giants, double.big, planet X), **0.40** rocky ("thin"), **0.35** lava; **none** on airless bodies. Limb line α 0.16 / 0.18 (0.14 airless).
- **Glow budget, per scene:** the scene's star (whichever of the six) and planet X. The one planetary exception is the lava world's faint static halo (r 1.4 r, `lava.atmo` α 0.18 → 0, "the only non-X halo"); the compact objects' glows count as the star's. No other library body has a halo, specular or bloom.
- **Motion:** strips scroll at their periods; gas bands drift in counter-flow; the lava veins pulse; the double pair orbits; the three stars breathe ±3 % / 6 s (corona layers only — the body, chromosphere, loops and flare do not breathe, so the crash radius never moves), raise three prominence loops and fire one flare per 22 s; the white dwarf's glow breathes ±5 % / 4 s; the neutron star's beams sweep 360° / 6 s; the black hole's disk texture turns 360° / 24 s. Nothing twinkles. Every asset renders correctly at t = 0 (static) and loops seamlessly; the static mockups show t = 0 (prominences and flares are invisible at t = 0 by construction).

### Rocky worlds

Six worlds on the v1.2 recipe. `ocean` uses the `planet.start.*` tokens of §2 unchanged. New tokens:

| Token | Hex | Used for | Note |
|---|---|---|---|
| `rocky.base` | `#C98B5A` | Rocky desert disc and strip fill; limb squash | Also `double.small.base` |
| `rocky.dark` | `#7A4E33` | Dark dune bands (× 0.40), crater pits (× 0.8) and shadowed crater walls (× 0.6); shade night side 0.70 / 0.86 / 1.00 | Also `double.small.dark` |
| `rocky.highlight` | `#F0C9A0` | Light dune bands (× 0.40), lit crater walls (× 0.6), shade 0.00 stop α 0.90, limb line α 0.16 | Borrowed by `double.small` (lit tint, crater rims, limb) |
| `rocky.atmo` | `#E8B07A` | Rim at 1.12 r, **thin**: peak α 0.40 (0.92 stop α 0.22), lit mask 1.0 → 0.35 | The brief's "α 0.4" |
| `ice.base` | `#CFE6F5` | Ice world disc, strip fill, squash | |
| `ice.dark` | `#7FA6C9` | Darker ice plates (× 0.45) and the crack veins (α 1, ≈ 15 %) | |
| `ice.highlight` | `#FFFFFF` | Bright plates (× 0.35), polar caps (30 %), lit crack edges (× 0.6), shade 0.00 stop α 0.90, limb α 0.18 | |
| `ice.atmo` | `#BFE3FF` | Rim peak α 0.55 / 0.30 | |
| `ice.shadow` | `#35567A` | Night side (shade 0.70 / 0.86 / 1.00) and the crack cores (× 0.6) | **New, beyond the brief:** `ice.dark` is too light to read as night at α 1.0 |
| `lava.crust` | `#3A2A2A` | Lava world disc, crust strip fill, squash, shade 0.40 stop | |
| `lava.crustLight` | `#5A4040` | Lighter crust plates (≈ 45 %, × 0.8); shade 0.00 stop at α **0.55** | The emissive-surface exception above |
| `lava.vein` | `#FF6A2A` | Vein network (≈ 18 %) and its baked bloom (σ 1.2, × 0.45); the vein strip pulses α 1.0 → 0.7 → 1.0 over 5 s | Same hex as `thrust.outer` |
| `lava.veinHot` | `#FFC857` | Vein cores (≈ 5 %) | Same hex as `star.body` / `fuel.low` |
| `lava.atmo` | `#FF8C2E` | Rim peak α **0.35** (0.92 stop α 0.19), limb line α 0.16, and the static halo r 1.4 r: 0.00 α 0.18 · 0.714 α 0.18 (disc edge) · 0.86 α 0.07 · 1.00 α 0 | Same hex as `star.corona`. The only non-X halo |
| `lava.shadow` | `#1E1414` | Night side (shade 0.70 / 0.86 / 1.00) | **New, beyond the brief:** the crust is the base, so the shadow must be darker than it |
| `toxic.base` | `#5E8F3A` | Toxic world disc, surface strip fill, squash, shade 0.40 stop | |
| `toxic.dark` | `#2F5A2A` | Dark lowlands (≈ 30 %, × 0.60), the cloud-deck shadow (× 0.5, offset (−1.5, +1.5) away from L, baked under the clouds), night side | |
| `toxic.cloud` | `#E6F2C8` | Cloud strip (≈ 55 % cover, group α 0.6, σ 0.8 edges, swirled by a periodic displacement map) | |
| `toxic.atmo` | `#C7E97A` | Rim peak α 0.55 / 0.30, limb α 0.18, **and** the shade 0.00 stop (α 0.70) | No separate highlight token — the atmo doubles as the lit-side tint |
| `cracked.base` | `#4F5B73` | Cracked world disc, strip fill, squash, shade 0.40 stop | |
| `cracked.dark` | `#2A3245` | Mottled basins (≈ 30 %, × 0.60), night side | |
| `cracked.crack` | `#FFC857` | Crack network (the 0.5 iso-contour of a noise field: ≈ 1.5 px lines, ≈ 10 % of the area) at × 0.80 plus a baked σ 1.5 glow at × 0.50; static, no pulse; shows on the night side at group α 0.35 | Same hex as `star.body`. "α 0.8, ≈ 10 %" in the brief |
| `cracked.atmo` | `#8FA3C9` | Rim peak α 0.55 / 0.30, limb α 0.18, and the shade 0.00 stop (α 0.90) | As toxic: the atmo doubles as the highlight |

Per-world construction (`canvas-notes.md` §4b has the same data as a table; every number is in the asset header):

| World | r · P · strip | Surface strip | Second strip / extras |
|---|---|---|---|
| rocky | 30 · 188 · 376 × 60, 110 s, start tile x 40 | **dunes:** fractalNoise `0.008 0.09` (anisotropic → horizontal wavy bands), 2 oct, seed 5 — light bands slope 8 / intercept −4.084 (threshold 0.573 = p75) × 0.40 `rocky.highlight`, dark bands slope −8 / 3.892 (below 0.424 = p25) × 0.40 `rocky.dark`; **craters:** fractalNoise 0.12, 2 oct, seed 31 — pits slope 40 / −23.5 (0.600 = p80 → ≈ 20 %, ≈ 1 px edge) × 0.8 `rocky.dark`; lit wall = pit − pit offset (+1.2, −1.2) `rocky.highlight` × 0.6; shadowed wall = pit − pit offset (−1.2, +1.2) `rocky.dark` × 0.6 | no caps, no clouds |
| ice | 28 · 176 · 352 × 56, 140 s, tile x 24 | **sheets:** fractalNoise 0.03, 4 oct, seed 41 — darker plates slope 5 / −2.25 (0.55 = p64) × 0.45 `ice.dark`, bright plates slope −5 / 2.75 (below 0.45 = p38) × 0.35 `ice.highlight`; **cracks:** turbulence 0.06, 2 oct, seed 43 — veins slope −40 / 4.4 (solid below 0.085, 0 at 0.110 = p15 → ≈ 15 %) `ice.dark` α 1; cores slope −40 / 2.36 (below 0.034, 0 at 0.059 = p5) × 0.6 `ice.shadow`; lit edge = vein − vein offset (+0.8, −0.8) `ice.highlight` × 0.6 | polar caps **30 %** (16.8 px bands, α 1 · 0.9 at 60 % · 0) |
| lava | 26 · 163 · 326 × 52, 95 s, tile x 20 | **crust:** fractalNoise 0.04, 4 oct, seed 53 — lighter plates slope 6 / −2.5 (0.5 = p49 → ≈ 45 %) × 0.8 `lava.crustLight` | **veins** (same animated group, group α pulse 1 → 0.7 → 1 / 5 s sine): turbulence 0.05, 2 oct, seed 59 — vein slope −12.3 / 1.4 (below 0.114 = p18 → ≈ 18 %) `lava.vein`; hot slope −25.5 / 1.4 (below 0.055 = p5) `lava.veinHot`; bloom = vein α blurred σ 1.2 × 0.45 `lava.vein` under the veins. Halo r 36.4 static. No caps |
| toxic | 32 · 201 · 402 × 64, 120 s, tile x 60 | fractalNoise 0.035, 4 oct, seed 29 — lowlands slope 12 / −6.088 (0.549 = p70 → ≈ 30 %) × 0.60 `toxic.dark` | **clouds** 75 s, tile x 0, group α 0.6: fractalNoise `0.016 0.070` (zonal decks), 4 oct, seed 37, displaced by fractalNoise 0.010 / 2 oct / seed 43 at scale 14 (periodic too), slope 8 / −3.30 (0.475 = p43 → ≈ 55 %), blur 0.8; deck shadow `toxic.dark` × 0.5 offset (−1.5, +1.5) under the clouds. No caps |
| cracked | 27 · 170 · 340 × 54, 100 s, tile x 30 | **mottling:** fractalNoise 0.040, 4 oct, seed 41 — slope 12 / −6.412 (0.576 = p70 → ≈ 30 %) × 0.60 `cracked.dark`; **cracks:** fractalNoise 0.035, 3 oct, seed 61, alpha → a 51-entry table that is 1 only at field 0.50 (a 0.48–0.52 band = the 0.5 contour, one connected branching network ≈ 1.5 px wide, ≈ 10 %) `cracked.crack`: glow = blur 1.5 × 0.50, lines × 0.80 | **night cracks:** the same crack strip again (glow + lines only), same phase, group α 0.35, masked along −L (0 at +0.5 r·L → 1 at −0.5 r·L) so it shows only beyond the terminator. No caps |
| ocean | 34 · 214 · 428 × 68, 90 s / clouds 64 s | = `planet-start.svg` (§2) | |

### Gas worlds

Both r 44, P = 276, each **band group** one 552 × 88 rect set (rects overdrawn to y −8 … 96 so the edge blur never thins the poles) with one filter: wavy edges = fractalNoise `0.012 0.08`, 2 octaves, stitched + tiled, contrast ×2, `feDisplacementMap` scale 6 (edges wave ±3 px, each edge independently — the brief's 0.02 gave blobby waves; 0.012 gives calmer ≈ 80 px ones), blur 0.6; zonal streaks = fractalNoise `0.010 0.28`, 2 octaves, saturate 0, contrast ×2, α 0.30, blend `overlay` (straight, applied after the displacement = zonal flow). Groups drift through one clip in **counter-flow**; 9 visible bands each. The gas terminator above; rim peak 0.55; no halo.

| Token | Hex | Used for | Note |
|---|---|---|---|
| `gasBanded.cream` | `#F2D9B8` | Pale zones (bands 3 and 7); the storm's paler eye (α 0.30) | |
| `gasBanded.tan` | `#E3B07C` | Base disc, squash, shade 0.40 stop; bands 2, 5 (equatorial zone) and 8 | The "base" of this world |
| `gasBanded.brown` | `#B9794B` | Belts: bands 1, 6 and 9 (both polar bands) | |
| `gasBanded.dark` | `#8C5A3C` | The dark northern belt (band 4) | |
| `gasBanded.storm` | `#D9623E` | Storm spot: ellipse 0.28 r × 0.16 r (rx 6.16, ry 3.52) at latitude −0.35 r (strip y 28.6) in band group B, drawn at strip x 98.6 **and** x + P (every discrete feature once per period); drifts right→left with its belt, on screen ≈ 35 s of every 110 s | |
| `gasBanded.atmo` | `#F5D7B0` | Rim 1.12 r peak α 0.55, limb α 0.16, shade 0.00 stop α 0.55 | |
| `gasBanded.shadow` | `#4A2E1E` | Night side / terminator (0.64 α 0.30 · 0.86 α 0.90 · 1.00 α 1) | **New, beyond the brief:** the band set has no tone dark enough for a night side |
| `gasRinged.cream` | `#D5EFEA` | Bands 3 and 7; shade 0.00 stop α 0.55 | |
| `gasRinged.light` | `#9FD3C7` | Base disc, squash, shade 0.40 stop; bands 2, 5 (equatorial) and 8 | The "base" |
| `gasRinged.mid` | `#6FA8A0` | Bands 1, 6 and 9 | |
| `gasRinged.dark` | `#3F7A74` | The dark northern belt (band 4) | |
| `gasRinged.atmo` | `#BFE8E0` | Rim peak α 0.55, limb α 0.16 | |
| `gasRinged.ring` | `#D8E6E3` | The ring, α 0.55 peak fading outward (gradient below) | |
| `gasRinged.shadow` | `#1C3A36` | Night side / terminator | **New, beyond the brief** |
| (`bg.base`) | `#050710` | The planet's shadow on the back ring, α 0.80 | A shadowed ring shows the sky through it |

| Giant | Band groups (strip y: 0 = N pole, 88 = S pole; disc y = strip y − 44) | Drift |
|---|---|---|
| gasBanded | C (back, full height): brown 0–9 · tan 9–18 · [B] · … · cream 57–69 · tan 69–79 · brown 79–88; B (middle): cream 18–31 (+ storm) · dark 31–40; A (front): tan 40–49 · brown 49–57. Overdraw: C brown −8..9, tan 9..54, cream 54..69, tan 69..79, brown 79..96; B cream 18..31, dark 31..46; A tan 40..49, brown 49..58. Wave seeds C/B/A 31 / 37 / 41, streak seeds 5 / 13 / 17 | C 0 → +276 / **180 s**, B 0 → −276 / **110 s** (right→left), A 0 → +276 / **150 s**; +P groups start with the disc's left edge at strip x 320, −P groups at x 44 |
| gasRinged | A (back, full height): mid 0–10 · light 10–19 · [B] · light 37–51 · [B] · cream 59–69 · light 69–78 · mid 78–88; B (front): cream 19–29 · dark 29–37 · mid 51–59. Overdraw: A mid −8..10, light 10..54, cream 54..69, light 69..78, mid 78..96; B cream 19..29, dark 29..37, mid 51..59. Wave seeds 43 / 47, streak seeds 21 / 29. No storm (calmer) | A 0 → +276 / **160 s**, B 0 → −276 / **120 s** |

**The ring** (`gas-ringed.svg`): drawn in "ring space" `rotate(−22) scale(1 0.28)` — tilt 22°, major axis rising toward the upper-right, opening ry = 0.28 rx — as a plain circle r 2.2 r = 96.8 filled with a radial gradient of `gasRinged.ring` (offsets = radius / 96.8): 0.600 α 0 · 0.6136 (= 1.35 r, inner edge) α 0.22 · 0.655 α 0.50 · 0.690 α **0.55** (peak) · 0.7159 α 0.50 ‖ gap 1 at 1.60 r (0.7159–0.7386) α 0.08 ‖ 0.7386 α 0.48 · 0.78 α 0.42 · 0.81 α 0.46 · 0.84 α 0.36 · 0.875 α 0.32 ‖ gap 2 at 1.95 r (0.875–0.8978) α 0.06 ‖ 0.8978 α 0.28 · 0.95 α 0.20 · 0.985 α 0.12 · 1.000 (2.2 r) α 0; the gaps are 0.05 r = 2.2 px wide. On screen: ellipse rx 96.8 × ry 27.1. The ring is drawn twice from one gradient: behind the planet through `#grBack` (everything except the front half-disc) and after the planet, rim and limb through `#grFront`, the lower half of the **r 1.12 r = 49.28** disc in ring orientation (the rim radius) — so where the front ring leaves the limb it stays in front of the atmosphere rim instead of dipping behind the halo, and nothing is composited twice. The half-plane line touches no ring material (inner edge 1.35 r); the arc crosses the front ring just outside the limb, where the complementary clips leave at most a sub-pixel 7.6 % seam inside the rim glow (a ring crossing the limb cannot be split without crossing ring material somewhere). **Planet shadow on the back ring:** in ring space a half-ellipse with semi-axes 117 (= r / tan 22°, along the shadow) × 44 (= r), rotated 230°, fill `bg.base` α **0.80** (the brief's 0.6 read as dimming, not shadow), blurred σ 1 × 3.5 in ring space (≈ 1 px on screen), alpha-masked by the ring's own gradient normalised to peak 1.0 — so it darkens ring material only (80 % on the densest ringlet, less in the gaps; measured (28, 30, 42) in shadow vs (115, 123, 126) on the mirror side). The ring never rotates.

### Small bodies

Airless rule (moon, dwarf, double.small): hard terminator (recipe above), no rim, no caps, no clouds, night side `bg.base`. **Craters** are hand-placed geometry on the strip, seeded with `mulberry32` and drawn twice (at x and x + P), because thresholded noise reads as worms, not pits: each crater = an outer circle R in the body's highlight (the rim wall, α 0.55 moon / 0.5 others) + a bowl circle 0.82 R centred (+0.18 R, −0.18 R) toward the star, filled with a linear gradient from its upper-right (dark α 0.95, the shadowed wall) through 0.55 α 0.72 to its lower-left (α 0.55) — the uncovered lower-left crescent is the sun-lit inner wall. Tables of (x, y, R) are in each header.

| Token | Hex | Used for | Note |
|---|---|---|---|
| `moon.base` | `#9A9AA6` | Moon disc, strip fill, squash | |
| `moon.crater` | `#5E5E6B` | Maria mottle (fractalNoise 0.05, 3 oct, seed 7, slope 3 / −1.3, × 0.14), pits (fractalNoise 0.30, 1 oct, seed 9, slope 30 / −19.3 → ≈ 7 % 1–2 px specks, × 0.50), crater bowls; shade 0.62 stop α 0.30 | 37 craters (seed `0x4D4F4F`, radii 4.2 → 0.9) = 15.2 % of the tile, + specks ≈ 22 % dark (brief ≈ 25 %) |
| `moon.highlight` | `#D8D8E0` | Crater rim walls α 0.55, shade 0.00 stop α 0.55, limb α 0.14 | |
| `dwarf.base` | `#B8A48E` | Dwarf disc, strip fill, squash | |
| `dwarf.dark` | `#6E6052` | Dark patches (fractalNoise 0.10, 3 oct, seed 13, slope 8 / −4.48 → ≈ 22 %, × 0.60), specks (0.28, 1 oct, seed 17, ≈ 7 %, × 0.50), the 8 pit bowls (seed `0x445741`, 3.9 %); shade 0.62 stop | |
| `dwarf.highlight` | `#E8DCC8` | Light patches (same field, slope −8 / 3.2, ≈ 15 %, × 0.45), pit rims α 0.5, shade 0.00 stop, limb α 0.14 | |
| `double.big.base` | `#5E9ED6` | Big ice-ocean world (r 18) disc, strip fill, squash | |
| `double.big.dark` | `#2C4F7A` | Deep water (fractalNoise 0.07, 3 oct, seed 29, slope 14 / −8.07 → ≈ 22 %, × 0.40); night side (soft recipe) | |
| `double.big.highlight` | `#DCEFFF` | Pack ice (fractalNoise 0.035, 4 oct, seed 21, slope 30 / −17.4 → ≈ 30 %, × 0.80), polar caps 22 % (7.92 px), shade 0.00 stop α 0.90, limb α 0.16 | |
| `double.big.atmo` | `#9CCBFF` | Rim peak α 0.55 / 0.30 | Same hex as `planet.start.highlight` |
| `double.small.base` | `#C98B5A` | Small rocky companion (r 11) disc, strip fill, squash | = `rocky.base` |
| `double.small.dark` | `#7A4E33` | Mottle (fractalNoise 0.12, 2 oct, seed 31, slope 14 / −7.84 → ≈ 25 %, × 0.55), specks (0.30, 1 oct, seed 37, ≈ 8 %, × 0.50), the 9 crater bowls (seed `0x534D4C`, 4.2 %); shade 0.62 stop | = `rocky.dark`; lit tint, crater rims and limb borrow `rocky.highlight` |
| (`bg.base`) | `#050710` | Night side of all three airless bodies (0.70 α 0.84 · 1.00 α 0.92 → a dark grey ≈ `#1A1B22` that still reads on the field) | |

**Double planet orbit** (`double.svg`, group at the pair's barycentre): period **40 s**, uniform, clockwise on screen (right → bottom/front → left → top/back). Masses ∝ r³ (5832 : 1331), centre separation 38 px → the small body orbits at A = 30.94 from the barycentre, the big one at 7.06, 180° apart; the plane is tilted so the screen ellipse has ry = 0.36 rx (30.94 × 11.14 and 7.06 × 2.54). θ(t) = 360° · t / 40 s; small at (A cos θ, B sin θ), big at (−A cos θ, −B sin θ). At θ = 90° (bottom) the small body passes **in front** of the big one, at θ = 270° (top) **behind** it (≈ 70 % of its disc hidden). The SVG builds the ellipse as an epicycle of three SMIL rotates (`rotate(θ) → translate(e₁) → rotate(−2θ) → translate(e₂) → rotate(θ)`, e₁ = (A + B)/2, e₂ = (A − B)/2) so no anisotropic scale ever touches the bodies — lighting, strokes and filters stay undistorted — and the small body is drawn **twice** (`#dbSmallBack` before the big body, `#dbSmallFront` after) with discrete opacity toggles at θ = 0° / 180°, where the limbs are 9 px apart, so the z-order swap is never visible. Both bodies also rotate (big 80 s, P 113; small 60 s, P 69). t = 0: small at (+30.94, 0), big at (−7.06, 0).

### Stars

All three stars share one construction — the v1.1 `star.svg` layers (glow → corona → streamers + 2 helmet lobes, all in the breathing group → chromosphere → body with limb darkening → granulation), scaled by k = r / 46 and re-coloured — **plus the v1.3 prominences and flare** (drawn between the chromosphere and the body, outside the breathing group). The sun keeps every v1.1 number and token (§2); the red dwarf and blue giant get new tokens:

| Token | Hex | Used for | Note |
|---|---|---|---|
| `redDwarf.core` | `#FFD9B0` | Body gradient centre; the flare at the limb | Same hex as `stars.warm` |
| `redDwarf.body` | `#FF7A4D` | Body 0.45–0.78; the flare tip | |
| `redDwarf.corona` | `#E0432F` | Corona (r 113, σ 2.6), 10 streamers (α × 0.7 = 0.07–0.11: the "calmer corona"), 2 lobes α 0.042, chromosphere (r 40.9, 2.6 px, α 0.60, σ 1.3), prominence loops; body 0.90 stop | |
| `redDwarf.glow` | `#8C1E2A` | Outer glow r 174 (0.00 α 0.50 · 0.23 α 0.45 · 0.65 α 0.12 · 1 α 0); the limb (body 1.00 stop) | Dark red: the dwarf is dim |
| `blueGiant.core` | `#FFFFFF` | Body centre; the flare at the limb | |
| `blueGiant.body` | `#B8CCFF` | Body 0.45–0.78; the flare tip | Same hex as `stars.cool` / `whiteDwarf.corona` |
| `blueGiant.corona` | `#5EA0FF` | Corona (r 153, σ 3.5), **14** streamers (α 0.10–0.16, seeded ≥ 14° apart — the 20° rule cannot place 14 wedges), 2 lobes α 0.06, chromosphere (r 55.2, 3.5 px), loops; body 0.90 stop | Same hex as `ui.accent` / `trail` |
| `blueGiant.glow` | `#2C4FBF` | Outer glow **r 240** (the full half viewBox — "wider glow"), same stops; the limb | |

| | Yellow sun | Red dwarf | Blue giant |
|---|---|---|---|
| r · k · viewBox | 46 · 1 · 400 | 40 · 0.8696 · 360 | 54 · 1.1739 · 480 |
| glow r · corona r | 200 · 130 | 174 · 113 | **240** · 153 |
| streamers | 10, seed `0x5747`, base r 48, w 10–18, T 110–175, α 0.10–0.16 | 10, seed `0x5244`, base r 41.7, w · k, T · k, **α × 0.7** | **14**, seed `0x4247`, base r 56.3, min **14°** apart |
| granulation | 0.11, 2 oct, seed 3, α 0.16 | **0.07**, seed 5, α **0.22** (larger, slower spots) | **0.16**, seed 9, α **0.12** (fine, faint) |
| prominences | seed `0x5750`, stroke 2.5, σ 1.5 | seed `0x5250`, stroke 2.2, σ 1.3 | seed `0x4250`, stroke 2.9, σ 1.8 |
| flare angle · path | 25.0° · M46 −1.5 L78.2 0 L46 1.5 | 117.9° · M40 −1.3 L68 0 L40 1.3 | 278.3° · M54 −1.75 L91.8 0 L54 1.75 |

**Prominences:** 3 loops per star at seeded angles ≥ 70° apart (`mulberry32(seed)`: angle A = 360u, span s = 18 + 10u °, peak k = 1.25 + 0.20u), each a cubic arc footed on the limb (feet s apart on the circle, peak at k · r), stroke 2.5 · k px, colour = the star's corona token, round caps, blurred σ 1.5 · k, drawn **before** the body so the feet are hidden by the disc at every scale. Each loop animates about its base point: scale 0.6 → 1.0 → 0.6 and α 0 → **0.55** → 0 over **12 / 16 / 14 s**, begin **0 / 5 / 9 s**, sine, indefinite — peaks at 6 + 12n, 13 + 16n, 16 + 14n s, never all three at once; before `begin` and at t = 0 a loop is invisible. **Flare:** one thin wedge from the limb (base 3 · k px, tip at 1.7 r), filled core → body along its length, no blur, at a seeded angle ≥ 30° from every loop; α 0 → **0.7** → 0 over 1.8 s inside a **22 s** cycle (invisible until 13 s, peak 13.9 s, gone 14.8 s) — a brief, quiet pop. The corona breathe (±3 % / 6 s) stays on the glow / corona / streamer layers only; the flares ride on top of it and the crash disc never moves. Angles, spans and paths per star: `canvas-notes.md` §3b.

### Compact objects

Emissive, no terminator, no granulation, no streamers, no prominences, no flares. Each is one or two cached sprites in Canvas (`canvas-notes.md` §3c).

| Token | Hex | Used for | Note |
|---|---|---|---|
| `whiteDwarf.core` | `#FFFFFF` | Body centre (0.00–0.55) and the bloom r 1.4 r = 22.4 (0.00 α 0.45 · 0.70 α 0.45 · 1 α 0 — soft over-exposure just outside the limb) | |
| `whiteDwarf.body` | `#E9EEF8` | Body 0.85 stop; the four diffraction spikes (1 px, "+" orientation, from r to 4 r = 64, α 0.30 → 0, static) | Same hex as `stars.neutral` |
| `whiteDwarf.corona` | `#B8CCFF` | Corona r 2.25 r = 36 (0.00 α 0.85 · 0.45 α 0.45 · 0.75 α 0.12 · 1 α 0, σ 3); body 1.00 stop; the hard 1 px limb at r 15.5, α 0.85 | Same hex as `stars.cool` |
| `whiteDwarf.glow` | `#7FB8FF` | Glow r **6 r** = 96 (0.00 α 0.55 · 0.10 α 0.42 · 0.30 α 0.16 · 0.60 α 0.04 · 1 α 0), breathes **±5 % / 4 s** | Same hex as `planet.start.atmo` |
| `neutronStar.core` | `#FFFFFF` | Body centre (0.00–0.50) | |
| `neutronStar.body` | `#DCE4FF` | Body 0.85 stop; limb 1 px at r 7.5 α 0.9; the beam base (α 0.35) | Same hex as `path` |
| `neutronStar.glow` | `#B48CFF` | Glow r **5 r** = 40 (0.00 α 0.60 · 0.18 α 0.42 · 0.45 α 0.14 · 1 α 0, static); body 1.00 stop; beam tips (α 0); the equatorial haze (rx 2.5 r × ry 0.6 r, α 0.12, σ 1) | **= `result.lost`** violet, as the brief asks |
| `blackHole.shadow` | `#000000` | The event-horizon disc r 22 | Same hex as `bg.edge` — the second place pure black appears |
| `blackHole.photon` | `#FFFFFF` | Photon ring: 1.5 px at r 24 (1.09 r), α 0.90, σ 1 | |
| `blackHole.diskHot` | `#FFF8E1` | Disk ramp inner edge (0.538 = r 30.8, α 0.90); the 40 bright streaks | = `star.core` |
| `blackHole.diskWarm` | `#FFC857` | Disk ramp 0.62 (α 0.85); lensed arcs inner stop (25.3, α 0.90) | = `star.body` |
| `blackHole.diskMid` | `#FF8C2E` | Disk ramp 0.78 (α 0.60); arcs 26.6 (α 0.75); the faint warm glow r 3 r = 66 (0.00 α 0.20 · 0.45 α 0.09 · 1 α 0) | = `star.corona` |
| `blackHole.diskOuter` | `#B48CFF` | Disk ramp 0.92 (α 0.28) → 1.00 (2.6 r, α 0.10); arcs outer stop (28.6, α 0.30) | = `result.lost` |
| `blackHole.einstein` | `#7FB8FF` | Einstein ring r 2.1 r = 46.2, 1 px, α 0.12, static | = `whiteDwarf.glow` |

**Neutron star** (r 8): the magnetosphere group rotates about the star, SMIL rotate 30° → 390° over **6 s**, linear, clockwise (t = 0: the magnetic axis tilted 30° from vertical, top pole toward the upper-right). Inside it, in its own frame: the equatorial haze ellipse (it turns with the beams — the belt is tied to the magnetic axis, which keeps every phase coherent) and two beam cones, base width 0.8 r = 6.4 at the surface (1 px inside the limb so the σ 0.6 blur never shows a gap), length 3.5 r = 28 (tip at 4.5 r), tip width 14, linear gradient body α 0.35 → glow α 0 along the axis. Tiny and low-alpha, so it stays calm.

**Black hole** (r 22, viewBox 320): draw order glow → top lensed arc → **back half** of the disk → shadow → photon ring → **front half** of the disk → bottom lensed arc → Einstein ring, the halves split along the disk's horizontal axis (front = lower half). The **accretion disk** is a flat ring, inner 1.4 r = 30.8, outer 2.6 r = 57.2, built in a circular frame and squashed with `scale(1 0.2115)` — ry/rx = 0.55 r / 2.6 r, so the outer ellipse is rx 57.2 × ry 12.1 (the brief's "rx 2.6 r, ry 0.55 r"); **note for Canvas:** the brief's `ctx.scale(1, 0.55)` must be read as `scale(1, 0.2115)` — at 0.55 the back half would hide the top arc entirely. Colour ramp (radial, userSpace r 57.2): 0.538 `diskHot` α 0.90 · 0.62 `diskWarm` α 0.85 · 0.78 `diskMid` α 0.60 · 0.92 `diskOuter` α 0.28 · 1.00 α 0.10 — a hard hot inner edge, a soft violet outer edge. Texture: radial **streaks** — 40 bright (`diskHot`, α 0.10–0.24) + 28 dark (`#000000`, α 0.10–0.22) tapered wedges, base width 0.5–1.1 px at r 30.8–38.8, tip 1.0–2.4 px, length 8–34 px (clamped at 57.2), σ 0.7, from `mulberry32(0xB1AC)` (angles i · 9° ± 3 / i · 12.86° + 6.4 ± 4), faded radially (1.0 at r 30.8 · 0.8 at 48.6 · 0.35 at 57.2), plus a dark mottle (fractalNoise 0.08, 2 oct, seed 5 → α 0.30 (R + G + B) − 0.25, black). The brief's "stretched turbulence 0.9 / 0.02" is realised as explicit wedges because an SVG filter cannot wrap a strip into a ring; Canvas bakes either into the one ring sprite. The textured ring **rotates** 360° / **24 s**, linear, clockwise, in its circular frame (the squash sits outside, so the motion is correctly elliptical and both halves share one phase). **Doppler beaming:** a static alpha mask over the disk and arcs, linear x −57.2 (1.0) → +57.2 (0.55) — the approaching left half is brighter. **Lensed arcs:** ring sectors r 1.15–1.3 r (25.3–28.6), top 190° → 350° over the shadow at group α 0.70, bottom 10° → 170° under it at α 0.50 (the secondary image is weaker — the asymmetric silhouette), warm ramp 25.3 `diskWarm` α 0.90 · 26.6 `diskMid` α 0.75 · 28.6 `diskOuter` α 0.30 (the white stop is dropped so they read warm against the white photon ring), each fading to 0 toward the horizontal axis (α 1 at |y| ≥ 20 → 0 at y = 0), σ 1. Static renders show t = 0 (streak phase 0). A multiply-grain filter on the semi-transparent ramp (the `star.svg` granulation technique) nearly erased the ramp during the pass and was replaced by the separate mottle overlay.

### Deviations from the brief, all deliberate and recorded in the asset headers

ice.shadow, lava.shadow, gasBanded.shadow and gasRinged.shadow are new tokens (the briefed sets had no night-side tone); toxic and cracked use their atmo as the lit-side highlight (no highlight token was briefed); toxic's highlight α is 0.70 and lava's 0.55 (not 0.90); the gas giants' wave frequency is 0.012 (not 0.02); the ring shadow is α 0.80 (not 0.6); the airless shade radius is 1.5 r (not 1.25 r); craters are seeded geometry (not thresholded noise); the moon's dark coverage is ≈ 22 % (not 25 %); the blue giant's streamers are ≥ 14° apart (not 20°); the black hole's streaks are explicit wedges (not a stretched turbulence) and its squash is 0.2115 (the brief's 0.55 is ry/r, not ry/rx); the lensed arcs drop the white stop, the top lensed arc is α 0.70 (not 0.6) and the bottom arc is α 0.50 (not 0.6); the Doppler side is the left (as briefed) although the clockwise spin makes the left tip recede — the brief's two words cannot both hold and "left approaching" was kept for the read. Everything else is the brief's number.
