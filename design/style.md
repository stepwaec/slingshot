# Slingshot — visual style v1.1

Calm, cinematic space for a Canvas 2D prototype. This file is the look; `canvas-notes.md` is how to draw it at 60 fps; §7 below is the asset index (one row per asset: file, viewBox, anchor, colours, size on the mockup). Assets live in `design/assets`, mockups (1440×900) in `design/mockups`.

v1.1 is the **realism pass**: richer bodies (limb-darkened star with streamers and granulation; planets with surface noise, a day/night terminator and an atmosphere rim) and a richer sky (tinted stars of varying magnitude, halos on the brightest, a faint Milky Way, a vignette that reaches true black). Ship, trail, path, arrow, HUD, overlays, copy, typography and motion are exactly v1.

## 1. Mood

**Observatory at night, not arcade.** The screen is mostly nothing: a near-black field, a thin dust of stars, and three bodies. The player sits in the dark planning one quiet throw. Everything is slow and weightless; nothing shouts. The drama comes from the physics (a predicted path that stops just short), not from the pixels.

**What glows:** exactly two things. The central star is the only warm light in the scene — core to corona to a faint orange haze that reaches out and fades. Planet X is the only cool light — a soft mint halo and a dashed capture ring that breathes. Everything else is flat colour plus one gradient: the start planet is lit by the star but does not emit; the ship is matte off-white with a hard outline; trails, paths and UI are crisp and unblurred.

**Realism inside the glow budget.** v1.1 makes the bodies and the sky look photographed rather than drawn — a limb-darkened stellar disc with faint streamers, planets with a real terminator and a thin atmosphere rim, stars that differ in size, brightness and colour, a band of dust behind the star — without adding a single glowing object or a single per-frame blur. All of it is detail *inside* the shapes we already had: the silhouettes, radii, glow envelopes and the two-glow rule are unchanged, and every new pixel is rendered once into a cached sprite or the cached background. Realistic but calm: nothing twinkles, rotates, flickers or lens-flares; the sky is still a quiet dust, only a slightly more convincing one.

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

### Start planet (cool blue, calm)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `planet.start.base` | `#3D8BFF` | Body disc; the transparent 0.40 stop of the shade lets it (and the surface noise) show on the day side | Lit side faces the star (upper-right) |
| `planet.start.highlight` | `#9CCBFF` | 0.00 stop of the terminator shade (α 0.90), offset 0.36 r toward the star; also the 1 px limb line at α 0.16 (r − 0.5) | No glow; the limb line keeps the dark side legible on `bg.base` |
| `planet.start.shadow` | `#142B5E` | Night side: the shade's 0.70 (α 0.55) → 0.86 (α 0.92) → 1.00 (α 1.0) stops — the 0.70–0.86 span **is** the terminator | Deep enough to sink into the field |
| `planet.start.atmo` | `#7FB8FF` | Atmosphere rim: a thin ring just outside the disc (peak α 0.55 at 0.87 of 1.12 r), masked α × 1.0 lit → 0.35 dark along the star vector (the brief's "~2×"); over the shaded body the composite rim reads ≈ 1.5× brighter on the lit side (measured, `assets.md`) | v1.1. Scatter, not glow: it never leaves the 1.12 r envelope and never animates |

### Planet X (the target)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `planet.x.base` | `#3DE0C2` | Body disc (transparent 0.40 stop of the shade); also the halo (radial gradient α 0.35 → 0 at ×1.8 r, drawn live) | The only cool glow on screen |
| `planet.x.highlight` | `#B5FFF0` | 0.00 stop of the terminator shade (α 0.90), offset 0.36 r toward the star (lower-left); also the 1 px limb line at α 0.18 (r − 0.5) | |
| `planet.x.shadow` | `#0E4A40` | Night side: shade stops 0.70 (α 0.55) → 0.86 (α 0.92) → 1.00 (α 1.0); the 0.70–0.86 span is the terminator | |
| `planet.x.atmo` | `#8FFFE6` | Atmosphere rim at 1.12 r (peak α 0.55 at 0.87, 0.30 at 0.92), lit-side boost 1.0 → 0.35 | v1.1. Sits under the halo's falloff; the halo is still the only thing that reads as "glow" |
| `planet.x.ring` | `#3DE0C2` | Capture-radius ring: dashed `[6, 6]`, stroke 1.5 px, α 0.55 at rest (pulses 0.35 ↔ 0.70, radius ±2 px, 2.4 s) | Same hex as base; the dash and the pulse make it read as a boundary, not a halo. The dashes crawl slowly (`lineDashOffset` −12 px/s) *and* the ring pulses; on a win both stop and the ring locks at α 1.0 |

Both planets get **surface noise** under the shade: desaturated fractal noise (start: baseFrequency 0.045, seed 7; X: 0.055, seed 11; 3 octaves, contrast ×3) composited soft-light at α 0.22, clipped to the disc — a faint mottling that the terminator reveals on the day side and buries on the night side. Draw order for both: base → noise → shade → limb → rim (planet X: halo first, ring last).

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
| Planet surface noise (`planet-start.svg` / `planet-x.svg`) | clipped to the disc | fractalNoise baseFrequency 0.045 / 0.055, 3 octaves, seed 7 / 11, saturate 0, contrast ×3 about 0.5, α 0.22, soft-light |
| Start planet shade (`planet-start.svg`) | userSpace centre 0.36 r · L = (+8.66, −8.66), radius 1.25 r = 42.5 | 0.00 `planet.start.highlight` α 0.90 · 0.40 `planet.start.base` α 0 · 0.70 `planet.start.shadow` α 0.55 · 0.86 α 0.92 · 1.00 α 1.0 |
| Start planet rim (`planet-start.svg`) | from the centre, radius 1.12 r = 38.08; × alpha mask linear along L from (+26.93, −26.93) α 1.0 to (−26.93, +26.93) α 0.35 | 0.00 `planet.start.atmo` α 0 · 0.80 α 0 · 0.87 α 0.55 · 0.92 α 0.30 · 1.00 α 0 |
| Planet X shade (`planet-x.svg`) | userSpace centre 0.36 r · L = (−7.64, +7.64), radius 1.25 r = 37.5 | 0.00 `planet.x.highlight` α 0.90 · 0.40 `planet.x.base` α 0 · 0.70 `planet.x.shadow` α 0.55 · 0.86 α 0.92 · 1.00 α 1.0 |
| Planet X rim (`planet-x.svg`) | from the centre, radius 1.12 r = 33.6; × alpha mask linear along L from (−23.76, +23.76) α 1.0 to (+23.76, −23.76) α 0.35 | 0.00 `planet.x.atmo` α 0 · 0.80 α 0 · 0.87 α 0.55 · 0.92 α 0.30 · 1.00 α 0 |
| Planet X halo (`planet-x.svg`) | 1.8 r | 0.00 `planet.x.base` α 0.35 · 0.556 α 0.35 · 0.78 α 0.10 · 1.00 α 0 |
| Vignette (mockups, `canvas-notes.md` §1) | centre (720, 450), r 900, over a `bg.edge` fill | 0.00 `bg.vignette` · 0.55 `bg.base` · 1.00 `bg.edge` |
| Milky Way (`starfield.svg`) | ellipses at −28° through (720, 450): rx 1100 × ry 150, and rx 900 × ry 70 offset 25 px; masked by fractalNoise 0.0025, 3 octaves, seed 5 (contrast 1.5 n − 0.2 — gentle, so the band stays one continuous lane with mottling, not detached patches) | `milkyway.dust` α 0.06 · 0.55 α 0.03 · 1.00 α 0, and α 0.05 → 0; peak after masking 0.054 (budget ≤ 0.08). Canvas: three unmasked ellipses α 0.05 / 0.04 / 0.03 |
| Star halos (`starfield.svg`) | r 4.5 on the 12 largest near stars | own tint α 0.18 → 0 |

The only hex in `design/` that is not a token in the tables above is the computed ramp value `#FFAE59` (`arrow.power` at 62 %, see the Trail/path/arrow table); the rim masks use `#FFFFFF` only as a luminance for alpha.

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

1. **Glow belongs to exactly two things: the star and planet X.** Two glowing bodies give the eye a warm anchor and a cool goal; a third would flatten the hierarchy. Everything else is flat fill plus, at most, one gradient — or, in v1.1, a cached sprite that *contains* its gradients. The atmosphere rims, the star halos in the sky and the Milky Way are not glow: none of them extends past 1.12 r / r 4.5 / α 0.08, none of them animates.
2. **Star:** one cached 400×400 sprite, blitted every frame and breathing ±3 % over 6 s. v1.1 made the sprite richer — glow → corona → ten gradient streamers and two lobes → chromosphere rings → limb-darkened body → granulation — but it is still one `drawImage`. The SVG's blurs (corona σ 3, streamers σ 6, chromosphere σ 1.5) are presentation only; Canvas replaces them with gradient falloff, a linear gradient along each wedge and three 1 px rings. Never `shadowBlur`.
3. **Planet X:** soft outer halo = a **live** radial-gradient fill at ×1.8 r (`planet.x.base` α 0.35 to the planet's edge, 0.10 at 0.78, 0 at the rim): one `createRadialGradient` + one `arc` fill per frame, no blur, ~0.05 ms, and it scales cleanly with zoom because nothing is rasterised. Not part of the sprite (it would be clipped at 1.12 r). The dashed capture ring is a live stroke too (cheap; see §5 for its pulse and dash crawl).
4. **Planets (both), v1.1: cached sprites.** Base disc → surface noise (soft-light α 0.22) → terminator shade (radial, centre 0.36 r toward the star, radius 1.25 r, transparent at 0.40 so the noise shows, night side from 0.70) → 1 px limb line → atmosphere rim (1.12 r, `planet.*.atmo`, lit-side mask 1.0 → 0.35, ≈ 1.5× brighter in the composite). Each is rendered once into a (2 · 1.12 r + 4) px square at the canvas DPR (2× on retina) — 81 px start / 72 px X at zoom 1 — and blitted; re-rendered only when the zoom bucket changes (buckets at 1.25^k, 25 % apart, flipping ±11.8 % about each centre — `canvas-notes.md` §12). No blur, no per-frame noise, no rim light outside the sprite.
5. **Ship:** no glow, ever. The 1 px `ship.outline` does the job of separating it from bright backgrounds. Thrust flash: two additive triangles (`globalCompositeOperation = "lighter"`), `thrust.outer` under `thrust.core`, alive for one frame per thrust tick, **drawn with no blur in Canvas** — `ship-thrust.svg` (and `flight.svg`, which instances it) keeps a small presentation blur (σ 1.2 outer / 0.4 core) on the two triangles, but that is for the SVG asset only (see §7 and `canvas-notes.md` §6).
6. **Trail:** per-segment alpha, no blur. **Predicted path:** dots, no blur. Both must stay sharp so the player can read them against the star's haze.
7. **UI:** no text shadows. Panels are `ui.panel` with a `ui.border` hairline and 10 px radius; the translucency over the starfield is all the depth we need.
8. **Background, v1.1: richer, still cached.** Vignette to black, three Milky-Way gradients, ~1005 dots, 12 halo gradients and 4 sparkles are drawn once into the background canvas (≈ 2.5 ms) and blitted as the per-frame clear. The SVG asset's turbulence mask on the band is replaced by three unmasked gradients in Canvas.
9. **Exactly one `shadowBlur` in the game, and it never repeats:** the result card's drop shadow, `ui.shadow` `rgba(5,7,16,0.5)`, blur 16 px (σ 8), offset y 8. It is rendered once into the offscreen card (520×232 plus a 64 px margin, so 3σ + offset = 32 px never clips) when a result fires; every frame after that is one blit. Never on anything that moves, never on the HUD, never in play.

**Glow budget (per frame):**
- 1 cached star sprite (gradients + streamers + chromosphere + limb darkening + granulation, breathe scale) — blit
- 0 blits for the planet X halo — 1 live radial-gradient fill
- 2 cached planet sprites (noise + terminator + limb line + atmosphere rim baked in) — 2 blits, replacing v1's two live gradients
- 1 dashed ring stroke — live
- 1 cached background (vignette to black + Milky Way + tinted starfield + halos) — blit
- 0 `shadowBlur` in play; 1 on the result card, drawn once (`ui.shadow`)
- 0 blur, noise or blend modes on ship, trail, path, arrow, HUD — and none anywhere per frame

## 5. Motion feel

Slow, eased, weightless. Nothing snaps; nothing bounces.

| What | Duration | Easing | Note |
|---|---|---|---|
| Button hover | 120 ms | ease-out | fill lightens ~8 %; no scale |
| Button press | 80 ms | ease-in | fill darkens; no scale |
| Result overlay in | 320 ms | ease-out cubic | fade 0→1 with a 12 px rise |
| Capture ring pulse | 2.4 s loop | sine | α 0.35 ↔ 0.70, radius ±2 px |
| Capture ring dash crawl | continuous | linear | `[6, 6]` dashes drift along the ring at −12 px/s via `lineDashOffset` (one dash period per second); runs together with the pulse |
| Star breathe | 6 s loop | sine | cached sprite scale ±3 % (streamers and granulation breathe with it; no rotation, no flicker) |
| Ship heading | per frame | lerp 0.18 | eases toward velocity heading |
| Fuel bar drain | 140 ms | ease-out | width tween + colour step at 30 % / 10 % |
| Thrust flash | 1 frame | — | on per tick, then gone |

**Pulses / breathes / drifts:** the star corona (breathe) and planet X's capture ring (α/radius pulse plus the dash crawl); on the win overlay the ring is frozen at full α with the crawl stopped. That is the complete list.

**Never animates:** the starfield (static, no parallax, no twinkle — including the tinted stars, their halos and the Milky Way), the vignette, the planet surfaces and rims, the HUD text, panel borders, the predicted path (it re-computes on drag but does not "flow"), the trail (it fades by age, it does not shimmer). Speed buttons 1x/2x/4x change simulation steps per frame, never the frame rate or any easing above.

## 6. Layout & HUD

Scene and HUD positions for a 1440×900 frame, origin top-left. Same in every mode; everything not listed is empty space.

| Element | Position / size | Spec |
|---|---|---|
| Background | full frame | `bg.edge` fill, radial vignette from (720, 450) r 900: `bg.vignette` → `bg.base` at 0.55 → `bg.edge` at the rim; then the Milky Way (−28° through the centre) and the starfield |
| Central star | c (760, 470), r 46 | chromosphere r 47, streamers to r 110–175, corona to ~r 130, glow to r 200 |
| Start planet | c (250, 690), r 34 | lit from the upper-right; 1 px limb line α 0.16; atmosphere rim to r 38.08 (1.12 r); ship sits on its upper-right limb while planning |
| Planet X | c (1190, 210), r 30 | lit from the lower-left; halo to r 54 (×1.8), 1 px limb line α 0.18, rim to r 33.6, capture ring r 78 dashed `[6, 6]` |
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

One row per file in `design/assets`. Every SVG is hand-authored, self-contained (no scripts, no external refs, no raster) and uses only the tokens above. "Anchor" is the point the game positions and rotates; "Mockup" is the size at which it appears in the 1440×900 mockups (zoom 1). The three body assets are structured as `<defs>` (ids prefixed `star*`, `ps*`, `px*`) plus **one group** — `<g id="star" transform="translate(200 200)">`, `<g id="planetStart" transform="translate(60 60)">`, `<g id="planetX" transform="translate(120 120)">` — with all geometry relative to (0, 0), so a mockup copies the group verbatim and only changes the translate.

| Asset | File | viewBox | Anchor / centre | Colours | Mockup |
|---|---|---|---|---|---|
| Ship | `ship.svg` | `0 0 24 24` | (12, 12), nose up (−y); hull spans y 2 → 21 | `ship.hull` `#F2F5FF`, `ship.outline` `#0A0D1A` 1 px, `ship.cockpit` `#5EA0FF` | 22 px long (scale 22/19 ≈ 1.158 via `<g id="ship">` + `<use>`); min 12 px at any zoom |
| Ship + thrust | `ship-thrust.svg` | `0 0 32 48` | ship at (16, 14) (same geometry, translated 4, 2); flame from y 19.5 to 41, behind the hull | ship colours + `thrust.outer` `#FF6A2A` α 0.90 (10×21.5), `thrust.core` `#FFE08A` (5.2×14); presentation blur σ 1.2 / 0.4 in the SVG only — Canvas draws the triangles with no blur (§4) | same 22 px ship, flame ≈ ship length; 1 frame per thrust tick |
| Start planet | `planet-start.svg` | `0 0 120 120` | `#planetStart` at (60, 60), r 34, lit from the upper-right (L = (+0.7071, −0.7071)); shade centre (+8.66, −8.66), radius 42.5; rim r 38.08 | `planet.start.base` `#3D8BFF` disc + surface noise (0.045, seed 7, ×3, soft-light α 0.22); shade `planet.start.highlight` `#9CCBFF` α 0.90 → base α 0 (0.40) → `planet.start.shadow` `#142B5E` α 0.55 / 0.92 / 1.0 (0.70 / 0.86 / 1.00); limb line `#9CCBFF` α 0.16; rim `planet.start.atmo` `#7FB8FF` α 0.55 peak, lit 1.0 → dark 0.35 | 1 : 1 at (250, 690); Canvas: cached 81 px sprite |
| Planet X | `planet-x.svg` | `0 0 240 240` | `#planetX` at (120, 120), r 30, lit from the lower-left (L = (−0.7071, +0.7071)); shade centre (−7.64, +7.64), radius 37.5; rim r 33.6; halo r 54; ring r 78 | halo `#3DE0C2` α 0.35 → 0; `planet.x.base` `#3DE0C2` disc + surface noise (0.055, seed 11, ×3, soft-light α 0.22); shade `planet.x.highlight` `#B5FFF0` α 0.90 → base α 0 → `planet.x.shadow` `#0E4A40` α 0.55 / 0.92 / 1.0; limb line `#B5FFF0` α 0.18; rim `planet.x.atmo` `#8FFFE6`; ring `#3DE0C2` 1.5 px dash 6 6 α 0.55 | 1 : 1 at (1190, 210); Canvas: live halo + cached 72 px sprite + live ring |
| Star | `star.svg` | `0 0 400 400` | `#star` at (200, 200); body r 46, chromosphere r 47, streamers r 48 → 110–175, corona r 130, glow r 200 (α 0) | `star.glow` `#FF5A1F`, `star.corona` `#FF8C2E` (corona, 10 streamers α 0.10–0.16 + 2 lobes α 0.06 at seeded angles `0x5747`, chromosphere α 0.60), body `star.core` `#FFF8E1` → `star.body` `#FFC857` (0.45–0.78) → `#FF8C2E` (0.90) → `star.limb` `#FF5A1F`; granulation noise (0.11, seed 3, ×2, multiply α 0.16); SVG blurs σ 3 / 6 / 1.5 are presentation only | 1 : 1 at (760, 470); cached sprite, breathes ±3 % |
| Starfield | `starfield.svg` | `0 0 1440 900` | top-left (0, 0), full frame, static; one group `#starfield` = `#milkyway` → `#far` → `#mid` → `#near` (`#nearHalos` first) → `#sparkles` | Milky Way `milkyway.dust` `#AAB8DD` (2 ellipses at −28°, turbulence-masked, peak α 0.054) + 380 dots `stars.far` r 0.5 α 0.28 · far `stars.far` `#6E7FA6` r 0.6 α 0.35 ×420 · mid r 0.8–1.0 α 0.55–0.65 ×160 · near r 1.2–1.5 α 0.85–0.95 ×45, both tinted `stars.cool` `#B8CCFF` / `stars.neutral` `#E9EEF8` / `stars.warm` `#FFD9B0` (mid 38 / 85 / 37, near 9 / 27 / 9) · 12 halos r 4.5 α 0.18 → 0 · 4 sparkles `#FFFFFF` (1005 dots) | full frame, 1 : 1; part of the cached background. Seeds: positions `0x514E47`, magnitude/tint `0x514E48`, Milky Way `0x4D57` |
| Flight trail | `trail.svg` | `0 0 600 200` | tail (30, 150) → head (570, 62) with the ship at the head | `trail` `#5EA0FF`, 2 px, round caps, 24 sample segments α 0.04 → 1.0, each standing for 10 game samples (a full 240-sample buffer under `canvas-notes.md` §7's rule); the mockups' trails use the same rule at their real sample counts, so their tails stay ≥ 0.6 | sample only; the mockups draw the real flown path |
| Predicted path | `predicted-path.svg` | `0 0 600 200` | start ship (30, 150) → end ring (570, 62) | `path` `#DCE4FF`: dots r 1.5 every 10 px, α 0.7 (first 80 %) / 0.35 (last 20 %); end ring r 6, stroke 1.5, α 0.5 | sample only; the planning mockup draws the real look-ahead |
| Drag arrow | `drag-arrow.svg` | `0 0 300 120` | origin = ship centre (36, 92), launch direction −18°; shaft starts 16 px out; 62 % = 150 of the 242-unit full extent | ghost `#FFFFFF` α 0.16 1 px dash `[1, 5]`; shaft `arrow` `#FFFFFF` α 0.9 2 px; head + tick `arrow.power` at 62 % = `#FFAE59`; label `ui.textMuted` `#8B95B5` 12 px mono | ~140–150 px long from the ship, up-right, tick + "62 %" |

Mockups (`design/mockups`, all `0 0 1440 900`): `planning.svg`, `flight.svg`, `result-win.svg`, `result-crash.svg`, `result-lost.svg`. They are assembled from the assets above: the `<defs>` of `star.svg`, `planet-start.svg`, `planet-x.svg` and the ship geometry of `ship.svg` (and, in `flight.svg`, the triangles and filters of `ship-thrust.svg`) are copied verbatim, the three body groups `#star` / `#planetStart` / `#planetX` are inlined with only their `translate` changed to (760 470) / (250 690) / (1190 210) (one exception: `result-win.svg` also sets the capture ring to `stroke-opacity="1"`, the win rule), and the `#starfield` group of `starfield.svg` is inlined byte-identically over the v1.1 vignette (`bg.edge` rect + the r 900 gradient), so all five show the same sky and bodies; only the scene content (path, arrow, trail, thrust, burst, ship pose) and the HUD values differ. Colours: every hex in `design/` is a §2 token except the documented ramp value `#FFAE59`. The result cards' drop shadow is `ui.shadow` (`#050710` at α 0.5, `feGaussianBlur stdDeviation="8"`, 8 px offset) — the same colour, σ and offset `canvas-notes.md` §11 passes as `shadowColor = "rgba(5,7,16,0.5)"`, `shadowBlur = 16`, `shadowOffsetY = 8`.
