# Slingshot — visual style v1

Calm, cinematic space for a Canvas 2D prototype. This file is the look; `canvas-notes.md` is how to draw it at 60 fps; §7 below is the asset index (one row per asset: file, viewBox, anchor, colours, size on the mockup). Assets live in `design/assets`, mockups (1440×900) in `design/mockups`.

## 1. Mood

**Observatory at night, not arcade.** The screen is mostly nothing: a near-black field, a thin dust of stars, and three bodies. The player sits in the dark planning one quiet throw. Everything is slow and weightless; nothing shouts. The drama comes from the physics (a predicted path that stops just short), not from the pixels.

**What glows:** exactly two things. The central star is the only warm light in the scene — core to corona to a faint orange haze that reaches out and fades. Planet X is the only cool light — a soft mint halo and a dashed capture ring that breathes. Everything else is flat colour plus one gradient: the start planet is lit by the star but does not emit; the ship is matte off-white with a hard outline; trails, paths and UI are crisp and unblurred.

**What we avoid:** neon, lens flares, scanlines, chromatic aberration, text shadows, more than two glowing objects, saturated gradients on UI, decorative animation. If a thing is not the star or the target, it does not bloom. Colour is used sparingly so that when a result overlay lands in mint, red or violet, it is the loudest thing on screen.

## 2. Palette

All values are exact; use these tokens, never ad-hoc hex.

### Background
| Token | Hex | Used for | Note |
|---|---|---|---|
| `bg.base` | `#050710` | Canvas clear colour; darkest UI colour; text on `ui.accent` | Not pure black — keeps the starfield from looking like dead pixels |
| `bg.vignette` | `#0B1024` | Centre of a very soft radial vignette, fading to `bg.base` at r≈900 | Only lift is at the centre; edges stay base |

### Starfield (static, three depth layers)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `stars.far` | `#6E7FA6` | r 0.6 px, α 0.35, ~420 dots at 1440×900 | Reads as dust, not stars |
| `stars.mid` | `#AAB8DD` | r 0.9 px, α 0.60, ~160 dots | The "real" starfield |
| `stars.near` | `#FFFFFF` | r 1.3 px, α 0.90, ~45 dots | 3–4 get a tiny 4-point sparkle; no twinkle animation |

### Central star
| Token | Hex | Used for | Note |
|---|---|---|---|
| `star.core` | `#FFF8E1` | Centre of the body gradient | Almost white, slightly warm |
| `star.body` | `#FFC857` | Body (r 46 on the mockup) | Same hex as `fuel.low` on purpose: one amber |
| `star.corona` | `#FF8C2E` | Corona ring, visible to ~r 130 | Fades, never a hard edge |
| `star.glow` | `#FF5A1F` | Outermost glow, reaches α 0 at ~r 200 | The only warm haze in the game |

### Start planet (cool blue, calm)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `planet.start.base` | `#3D8BFF` | Body | Lit side faces the star |
| `planet.start.highlight` | `#9CCBFF` | Gradient highlight, offset toward the star; also the 1 px limb line at α 0.16 (r − 0.5) | No glow; the limb line keeps the dark side legible on `bg.base` |
| `planet.start.shadow` | `#142B5E` | Terminator / far side | Deep enough to sink into the field |

### Planet X (the target)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `planet.x.base` | `#3DE0C2` | Body; also the halo (radial gradient α 0.35 → 0 at ×1.8 r, drawn live) | The only cool glow on screen |
| `planet.x.highlight` | `#B5FFF0` | Gradient highlight; also the 1 px limb line at α 0.18 (r − 0.5) | |
| `planet.x.shadow` | `#0E4A40` | Far side | |
| `planet.x.ring` | `#3DE0C2` | Capture-radius ring: dashed `[6, 6]`, stroke 1.5 px, α 0.55 at rest (pulses 0.35 ↔ 0.70, radius ±2 px, 2.4 s) | Same hex as base; the dash and the pulse make it read as a boundary, not a halo. The dashes crawl slowly (`lineDashOffset` −12 px/s) *and* the ring pulses; on a win both stop and the ring locks at α 1.0 |

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
| `ui.shadow` | `rgba(5,7,16,0.50)` | Result card drop shadow: blur 16 px (σ 8), offset y 8 | `bg.base` at α 0.5 — pure black appears nowhere, not even as a shadow. The only `shadowBlur` in the game, drawn once (see §4) |

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
| `ui.textMuted` `#8B95B5` | `#050710` | 6.8 : 1 | AA body, AAA large |
| `ui.textDim` `#4B5470` | `#050710` | 2.7 : 1 | Fails — decorative only (intended) |
| `ui.accent` `#5EA0FF` | `#050710` | 7.6 : 1 | AAA |
| `#050710` | `ui.accent` `#5EA0FF` | 7.6 : 1 | AAA (button label) |
| `result.win` `#3DE0C2` | `#050710` | 12.1 : 1 | AAA |
| `result.crash` `#FF5A5F` | `#050710` | 6.6 : 1 | AA body, AAA at 40 px |
| `result.lost` `#B48CFF` | `#050710` | 7.8 : 1 | AAA |

The result card is `ui.panel` at α 0.92 over the scrim, which composites to ≈ `#0A0D1A`; ratios on that drop by ~0.3 and every verdict above still holds.

### Gradient stops (canon, as defined in the asset SVGs)
The body gradients are built only from the tokens above; these are the exact stops the asset SVGs define, and `canvas-notes.md` §3–4 and the mockups reproduce them unchanged.

| Gradient (asset) | Radius | Stops (offset → token, alpha) |
|---|---|---|
| Star glow (`star.svg`) | 200 | 0.00 `star.glow` α 0.50 · 0.23 α 0.45 · 0.65 α 0.12 · 1.00 α 0 |
| Star corona (`star.svg`, σ 3 blur in the SVG only) | 130 | 0.00 `star.corona` α 0.90 · 0.35 α 0.70 · 0.62 α 0.22 · 1.00 α 0 |
| Star body (`star.svg`) | 46 | 0.00 `star.core` · 0.55 `star.body` · 1.00 `star.corona` |
| Start planet body (`planet-start.svg`) | centre offset (+0.36 r, −0.36 r) per axis in the SVG ≈ 0.51 r toward the star (Canvas uses 0.5 r along the star vector, `canvas-notes.md` §4), radius 1.25 r | 0.00 `planet.start.highlight` · 0.42 `planet.start.base` · 1.00 `planet.start.shadow` |
| Planet X body (`planet-x.svg`) | centre offset (−0.36 r, +0.36 r) per axis in the SVG ≈ 0.51 r toward the star (Canvas uses 0.5 r along the star vector, `canvas-notes.md` §4), radius 1.25 r | 0.00 `planet.x.highlight` · 0.42 `planet.x.base` · 1.00 `planet.x.shadow` |
| Planet X halo (`planet-x.svg`) | 1.8 r | 0.00 `planet.x.base` α 0.35 · 0.556 α 0.35 · 0.78 α 0.10 · 1.00 α 0 |

The only hex in `design/` that is not a token in the tables above is the computed ramp value `#FFAE59` (`arrow.power` at 62 %, see the Trail/path/arrow table).

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

1. **Glow belongs to exactly two things: the star and planet X.** Two glowing bodies give the eye a warm anchor and a cool goal; a third would flatten the hierarchy. Everything else is flat fill plus, at most, one radial gradient.
2. **Star:** radial gradient `star.core → star.body → star.corona → star.glow (α 0)`, rendered once to an offscreen canvas and blitted every frame. The corona "breathes" by scaling that cached sprite ±3 % over 6 s. Never `shadowBlur`.
3. **Planet X:** soft outer halo = a **live** radial-gradient fill at ×1.8 r (`planet.x.base` α 0.35 to the planet's edge, 0.10 at 0.78, 0 at the rim): one `createRadialGradient` + one `arc` fill per frame, no blur, ~0.05 ms, and it scales cleanly with zoom because nothing is rasterised. Not a cached sprite. The dashed capture ring is a live stroke too (cheap; see §5 for its pulse and dash crawl).
4. **Planets (both):** body = radial gradient with its centre offset toward the star, so the light side faces the light source. No blur, no rim light.
5. **Ship:** no glow, ever. The 1 px `ship.outline` does the job of separating it from bright backgrounds. Thrust flash: two additive triangles (`globalCompositeOperation = "lighter"`), `thrust.outer` under `thrust.core`, alive for one frame per thrust tick, **drawn with no blur in Canvas** — `ship-thrust.svg` (and `flight.svg`, which instances it) keeps a small presentation blur (σ 1.2 outer / 0.4 core) on the two triangles, but that is for the SVG asset only (see §7 and `canvas-notes.md` §6).
6. **Trail:** per-segment alpha, no blur. **Predicted path:** dots, no blur. Both must stay sharp so the player can read them against the star's haze.
7. **UI:** no text shadows. Panels are `ui.panel` with a `ui.border` hairline and 10 px radius; the translucency over the starfield is all the depth we need.
8. **Exactly one `shadowBlur` in the game, and it never repeats:** the result card's drop shadow, `ui.shadow` `rgba(5,7,16,0.5)`, blur 16 px (σ 8), offset y 8. It is rendered once into the offscreen card (520×232 plus a 64 px margin, so 3σ + offset = 32 px never clips) when a result fires; every frame after that is one blit. Never on anything that moves, never on the HUD, never in play.

**Glow budget (per frame):**
- 1 cached star sprite (gradient + breathe scale) — blit
- 0 blits for the planet X halo — 1 live radial-gradient fill
- 2 live planet-body gradients + 2 × 1 px limb lines (α 0.16 start / 0.18 X)
- 1 dashed ring stroke — live
- 0 `shadowBlur` in play; 1 on the result card, drawn once (`ui.shadow`)
- 0 blur on ship, trail, path, arrow, HUD

## 5. Motion feel

Slow, eased, weightless. Nothing snaps; nothing bounces.

| What | Duration | Easing | Note |
|---|---|---|---|
| Button hover | 120 ms | ease-out | fill lightens ~8 %; no scale |
| Button press | 80 ms | ease-in | fill darkens; no scale |
| Result overlay in | 320 ms | ease-out cubic | fade 0→1 with a 12 px rise |
| Capture ring pulse | 2.4 s loop | sine | α 0.35 ↔ 0.70, radius ±2 px |
| Capture ring dash crawl | continuous | linear | `[6, 6]` dashes drift along the ring at −12 px/s via `lineDashOffset` (one dash period per second); runs together with the pulse |
| Star breathe | 6 s loop | sine | cached sprite scale ±3 % |
| Ship heading | per frame | lerp 0.18 | eases toward velocity heading |
| Fuel bar drain | 140 ms | ease-out | width tween + colour step at 30 % / 10 % |
| Thrust flash | 1 frame | — | on per tick, then gone |

**Pulses / breathes / drifts:** the star corona (breathe) and planet X's capture ring (α/radius pulse plus the dash crawl); on the win overlay the ring is frozen at full α with the crawl stopped. That is the complete list.

**Never animates:** the starfield (static, no parallax, no twinkle), the vignette, the HUD text, panel borders, the predicted path (it re-computes on drag but does not "flow"), the trail (it fades by age, it does not shimmer). Speed buttons 1x/2x/4x change simulation steps per frame, never the frame rate or any easing above.

## 6. Layout & HUD

Scene and HUD positions for a 1440×900 frame, origin top-left. Same in every mode; everything not listed is empty space.

| Element | Position / size | Spec |
|---|---|---|
| Background | full frame | `bg.base`, radial vignette `bg.vignette` → `bg.base` at r≈900, then starfield |
| Central star | c (760, 470), r 46 | corona to ~r 130, glow to r 200 |
| Start planet | c (250, 690), r 34 | 1 px limb line α 0.16; ship sits on its upper-right limb while planning |
| Planet X | c (1190, 210), r 30 | halo to r 54 (×1.8), 1 px limb line α 0.18, capture ring r 78 dashed `[6, 6]` |
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

One row per file in `design/assets`. Every SVG is hand-authored, self-contained (no scripts, no external refs, no raster) and uses only the tokens above. "Anchor" is the point the game positions and rotates; "Mockup" is the size at which it appears in the 1440×900 mockups (zoom 1).

| Asset | File | viewBox | Anchor / centre | Colours | Mockup |
|---|---|---|---|---|---|
| Ship | `ship.svg` | `0 0 24 24` | (12, 12), nose up (−y); hull spans y 2 → 21 | `ship.hull` `#F2F5FF`, `ship.outline` `#0A0D1A` 1 px, `ship.cockpit` `#5EA0FF` | 22 px long (scale 22/19 ≈ 1.158 via `<g id="ship">` + `<use>`); min 12 px at any zoom |
| Ship + thrust | `ship-thrust.svg` | `0 0 32 48` | ship at (16, 14) (same geometry, translated 4, 2); flame from y 19.5 to 41, behind the hull | ship colours + `thrust.outer` `#FF6A2A` α 0.90 (10×21.5), `thrust.core` `#FFE08A` (5.2×14); presentation blur σ 1.2 / 0.4 in the SVG only — Canvas draws the triangles with no blur (§4) | same 22 px ship, flame ≈ ship length; 1 frame per thrust tick |
| Start planet | `planet-start.svg` | `0 0 120 120` | (60, 60), r 34; body gradient centre offset (+0.36 r, −0.36 r) per axis in the SVG ≈ 0.51 r toward the star (Canvas uses 0.5 r along the star vector, `canvas-notes.md` §4), radius 1.25 r (upper-right) | `planet.start.highlight` `#9CCBFF` (0.00), `.base` `#3D8BFF` (0.42), `.shadow` `#142B5E` (1.00); limb line `#9CCBFF` α 0.16 | 1 : 1 at (250, 690) |
| Planet X | `planet-x.svg` | `0 0 240 240` | (120, 120), r 30; halo r 54; ring r 78; body gradient centre offset (−0.36 r, +0.36 r) per axis in the SVG ≈ 0.51 r toward the star (Canvas uses 0.5 r along the star vector, `canvas-notes.md` §4), radius 1.25 r (lower-left) | `planet.x.highlight` `#B5FFF0`, `.base` `#3DE0C2`, `.shadow` `#0E4A40`; limb line `#B5FFF0` α 0.18; halo + ring `#3DE0C2` | 1 : 1 at (1190, 210) |
| Star | `star.svg` | `0 0 400 400` | (200, 200); body r 46, corona r 130, glow r 200 (α 0) | `star.core` `#FFF8E1`, `star.body` `#FFC857`, `star.corona` `#FF8C2E`, `star.glow` `#FF5A1F` | 1 : 1 at (760, 470); cached sprite, breathes ±3 % |
| Starfield | `starfield.svg` | `0 0 1440 900` | top-left (0, 0), full frame, static | `stars.far` `#6E7FA6` r 0.6 α 0.35 ×420 · `stars.mid` `#AAB8DD` r 0.9 α 0.60 ×160 · `stars.near` `#FFFFFF` r 1.3 α 0.90 ×45 (625 dots) | full frame, 1 : 1; part of the cached background |
| Flight trail | `trail.svg` | `0 0 600 200` | tail (30, 150) → head (570, 62) with the ship at the head | `trail` `#5EA0FF`, 2 px, round caps, 24 sample segments α 0.04 → 1.0, each standing for 10 game samples (a full 240-sample buffer under `canvas-notes.md` §7's rule); the mockups' trails use the same rule at their real sample counts, so their tails stay ≥ 0.6 | sample only; the mockups draw the real flown path |
| Predicted path | `predicted-path.svg` | `0 0 600 200` | start ship (30, 150) → end ring (570, 62) | `path` `#DCE4FF`: dots r 1.5 every 10 px, α 0.7 (first 80 %) / 0.35 (last 20 %); end ring r 6, stroke 1.5, α 0.5 | sample only; the planning mockup draws the real look-ahead |
| Drag arrow | `drag-arrow.svg` | `0 0 300 120` | origin = ship centre (36, 92), launch direction −18°; shaft starts 16 px out; 62 % = 150 of the 242-unit full extent | ghost `#FFFFFF` α 0.16 1 px dash `[1, 5]`; shaft `arrow` `#FFFFFF` α 0.9 2 px; head + tick `arrow.power` at 62 % = `#FFAE59`; label `ui.textMuted` `#8B95B5` 12 px mono | ~140–150 px long from the ship, up-right, tick + "62 %" |

Mockups (`design/mockups`, all `0 0 1440 900`): `planning.svg`, `flight.svg`, `result-win.svg`, `result-crash.svg`, `result-lost.svg`. They are assembled from the assets above: the `<defs>` of `star.svg`, `planet-start.svg`, `planet-x.svg` and the ship geometry of `ship.svg` (and, in `flight.svg`, the triangles and filters of `ship-thrust.svg`) are copied verbatim, and the starfield groups of `starfield.svg` are inlined byte-identically, so all five show the same sky and bodies; only the scene content (path, arrow, trail, thrust, burst, ship pose) and the HUD values differ. Colours: every hex in `design/` is a §2 token except the documented ramp value `#FFAE59`. The result cards' drop shadow is `ui.shadow` (`#050710` at α 0.5, `feGaussianBlur stdDeviation="8"`, 8 px offset) — the same colour, σ and offset `canvas-notes.md` §11 passes as `shadowColor = "rgba(5,7,16,0.5)"`, `shadowBlur = 16`, `shadowOffsetY = 8`.
