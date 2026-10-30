# Slingshot — visual style v1.5

Calm, cinematic space for Slingshot. This file is the look; `canvas-notes.md` is the pixel-exact drawing reference (how each SVG recipe looks and what it costs, written for Canvas 2D); `threejs-notes.md` maps it onto the game's Three.js renderer (WP3); `assets.md` indexes every file. Sections: §1 mood · §2 palette (background, sky, the sun, the two original planets, the shared lighting tokens, UI) · §3 typography · §4 glow and blur rules, with **§4.1 Realism, vibrancy and crispness rules** · §5 motion · §6 layout · §7 asset index · §8 the **body library** (31 bodies: 12 planets, 6 stars and compact objects, 4 moons, 3 ringed planets, the 3 WP8 objects: binary star, red giant, moon chain, the 2 WP9 compact objects: pulsar, magnetar, and the WP10 comet) plus the WP9 **magnetism map** and the WP10 **solar recharge indicator** · §9 the **space environment** (nebulae, asteroid field, wreck debris) · §10 **ship systems** (modular ship, damage states, hull HUD, tidal-stress warning, upgrade screen) · §11 **WP11** (asteroid belts, Kuiper belt, rogue planet, radiation map, dose meter) · §12 **ship and planning view** (burn plume, burn node, gravity grid and sheet) · §13 **late game** (stellar engine, Dyson swarm, ringworld, Shkadov thruster, space elevator, wormhole pair) and **living surfaces** · §14 **collisions and consumption** (impact, debris field, tidal disruption, burning up in a star, accretion, event telegraphs) · §15 **ghost markers** (where a moving body will be) · §16 **supernova, quasar and stray asteroid** (WP12) · §17 **target zone** (orbit capture) · §18 **Sol bodies** (the Sol campaign). Coding agents: read `IMPLEMENTING.md` first. Assets live in `design/assets` (bodies in `design/assets/bodies`, the environment in `design/assets/space`, map overlays in `design/assets/overlays`, the modular ship in `design/assets/ship`, late-game structures in `design/assets/mega`, scripted events in `design/assets/events`), mockups (1440×900, PNG = 2× render) in `design/mockups`, animated previews in `design/preview/planets.html`, `bodies.html` and `space.html`.

**History in one paragraph.** v1 set the layout, UI and the two-glow rule. v1.1 was the first realism pass (limb-darkened star, planets with a terminator and a rim, a tinted starfield with a Milky Way). v1.2 made the planets rotate: a seamless texture strip slides under a lighting overlay that never moves. v1.3 built the body library (12 planets, 6 stars and compact objects) and gave the stars prominences and a flare. v1.4 adds moons, ringed planets, nebulae and debris fields (§8, §9). **v1.5 (revised) is the realism, vibrancy and crispness pass**, agreed with the client on two approved reference assets — the ocean world "variant F" and the sun "variant J" — and applied to every body: vivid multi-zone surfaces with crisp edges, elongated clouds with cast shadows, a warm terminator band, a lit-side haze and rim, a fiery plasma sun with ragged flame rings and an irregular rim, and no untinted grey anywhere. The earlier v1.5 "crispness pass" numbers (halve blurs, ±12 % lightness, limb line at α 0.30) were rejected as indistinguishable from v1.2 and are **not** used; §4.1 holds the rules that replaced them.

## 1. Mood

**Observatory at night, not arcade.** The screen is mostly nothing: a near-black field, a thin dust of stars and a few bodies. The player sits in the dark planning one quiet throw. Everything is slow and weightless; nothing shouts. The drama comes from the physics (a predicted path that stops just short), not from the pixels.

**What glows:** exactly two things per scene. The scene's star is the only warm light — a fiery disc inside ragged flame rings and a red haze that fades out to r 200. Planet X is the only cool light — a soft mint halo and its target zone, a solid capture ring with a soft glow band that breathes (§17). Everything else is lit, not luminous: planets are lit by the star but do not emit; the ship is matte off-white with a hard outline; trails, paths and UI are crisp and unblurred. The lava world's faint static halo is the one documented planetary exception. Nebulae are background gas (§9), drawn into the background pass at α ≤ 0.22 — weather in the sky, not a glowing object.

**Realistic and vibrant (v1.5).** The client's words were "realistic and vibrant" and "still a bit blurry". The answer is detail with edges: oceans that are deep blue with turquoise shallows, land that splits into forest, desert and highland, clouds that are white and cast a navy shadow, a thin band of warm light at the terminator before the night goes navy, a bright rim only where the light grazes the atmosphere. The sun is fiery plasma — bright filaments over darker red-brown cells, a glowing limb, ragged flames and a rim that is not perfectly round — "but a bit less dark" than a photograph. Saturated hues sit on deep navy the way Kurzgesagt's colour harmony does; Kurzgesagt is inspiration for harmony and bold silhouettes only, and nothing of theirs is copied.

**Worlds that turn.** Surfaces drift across their discs once every 60–180 s; clouds drift a little faster; gas bands drift in counter-flow; moons orbit; ring particles circle in Keplerian sub-rings; rocks tumble. The light never moves with them: the day side, terminator, haze, rim and glint stay fixed toward the star, so bodies read as lit spheres turning under a lamp. Everything is cached pixels moved by wall-clock time.

**What we avoid:** neon, lens flares, scanlines, chromatic aberration, text shadows, more than two glowing objects, saturated gradients on UI, decorative animation, **untinted grey noise on a coloured body**, soft blur standing in for detail. If a thing is not the star or the target, it does not bloom. Colour is used carefully so that when a result overlay lands in mint, red or violet, it is still the loudest thing on screen.

## 2. Palette

All values are exact; use these tokens, never ad-hoc hex. §2 lists the background, the sky, the sun, the two original planets, the lighting tokens every body shares, and the UI. The other bodies' tokens are in §8 and the environment's in §9. Every hex used in `design/` is a token in §2, §8 or §9, except the computed ramp value `#FFAE59` (`arrow.power` at 62 %); masks use `#FFFFFF` / `#000000` only as luminance.

### Background
| Token | Hex | Used for | Note |
|---|---|---|---|
| `bg.base` | `#050710` | Canvas clear colour over most of the field; darkest UI colour; text on `ui.accent`; the planet shadow on a ring; dust lanes in the emission nebula | Not pure black — keeps the starfield from looking like dead pixels |
| `bg.vignette` | `#0B1024` | Centre of a very soft radial vignette (r 900 from the centre): 0.00 `bg.vignette` · 0.55 `bg.base` · 1.00 `bg.edge` | Only lift is at the centre |
| `bg.edge` | `#000000` | True black at the vignette edge (r ≥ 900); the black hole's shadow; the dark cloud's dust | The frame goes vignette → base → black |

### Starfield (static; three depth layers keep their radius / alpha roles, the colour is per star)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `stars.far` | `#6E7FA6` | far layer: r 0.6 px, α 0.35, ~420 dots at 1440×900; also the 380 Milky-Way dots (r 0.5, α 0.28) | Too faint to show colour |
| `stars.cool` | `#B8CCFF` | ~25 % of mid + near stars (B/A-type blue-white); embedded nebula stars | |
| `stars.neutral` | `#E9EEF8` | ~50 % of mid + near stars (F/G-type white); every sparkle host | |
| `stars.warm` | `#FFD9B0` | ~25 % of mid + near stars (K/M-type amber); also the dark cloud's lit rim, `rocky.rim`, the lava bloom and the red dwarf's limb | |
| `milkyway.dust` | `#AAB8DD` | The faint band behind the star, peak α ≤ 0.08 (measured 0.054); the asteroid belt's dust haze (`rock.haze`, α ≤ 0.05) | Dust, not detail |

| Layer | Colour | Radius | Alpha | Count | Extras |
|---|---|---|---|---|---|
| far | `stars.far` | 0.6 px | 0.35 | ~420 | unchanged from v1 |
| mid | tint | 0.8–1.0 px | 0.55–0.65 | ~160 | tinted 25 / 50 / 25 % |
| near | tint | 1.2–1.5 px | 0.85–0.95 | ~45 | the 12 largest get a halo (r 4.5, own tint α 0.18 → 0); 4 get the 4-point sparkle (`#FFFFFF`, 0.6 px, α 0.5, 5 px arms), forced to maximum magnitude, neutral |
| Milky Way | `milkyway.dust` + `stars.far` | — / 0.5 px | ≤ 0.08 / 0.28 | 2 gradient ellipses (SVG) or 3 (Canvas) + 380 dots | band at −28° through (720, 450); dots Gaussian σ 90 px about the axis |

**Magnitude rule** (mid and near): one seeded draw `u` gives radius and alpha, `r = rMin + (rMax − rMin)·u³`, `α = aMin + (aMax − aMin)·u³`. **Tint rule:** a second draw `t`: `< 0.25` cool, `< 0.75` neutral, else warm. Seeds: positions `0x514E47`, magnitude/tint `0x514E48`, Milky-Way dots `0x4D57`; exclusion zones star r 140, planets r 60 / 80 minimum (the asset keeps 70 / 100). No twinkle, no parallax: the sky is a cached bitmap.

### The sun (`star.svg`, the approved reference variant J)
The v1.1–v1.3 sun (glow, corona, streamers, helmet lobes, chromosphere, grey granulation) is replaced by the reference construction: a warm **haze**, two ragged **flame rings** that slowly counter-rotate, a fiery tinted **surface** (body gradient + dark red-brown cells + bright plasma filaments), a bright **limb**, a disc whose edge **wobbles**, a thin **ragged rim** stroke, two-tone crisp **prominences** and the **flare**. Every texture is tinted.

| Token | Hex | Used for | Note |
|---|---|---|---|
| `sun.haze` | `#FF7A2A` | Haze r 200: 0.00 α 0.60 · 0.23 α 0.52 | New (v1.5). The warm core of the haze |
| `sun.hazeRed` | `#E8461A` | Haze 0.33 α 0.30; wisp ring 1.00 stop; black-hole disk ramp 0.87 and lensed-arc tail | New |
| `sun.hazeDeep` | `#A8240E` | Haze 0.55 α 0.15; red-dwarf wisp edge | New |
| `sun.hazeEdge` | `#6A1408` | Haze 0.80 α 0.06 → 1.00 α 0 | New |
| `sun.filament` | `#FFE7A0` | Flame ring fill 0–0.74 (α 0.95); bright plasma filaments; black-hole filaments, ramp 0.6 and arc core | New. The hottest flame colour |
| `sun.flame` | `#FFB347` | Flame ring 0.82 (α 0.80); wisp ring fill 0–0.62 (α 0.55); `lava.rim` | New |
| `sun.flameEdge` | `#FF6A1A` | Flame ring 0.91 (α 0.38); wisp ring 0.80 (α 0.22) | New |
| `star.glow` | `#FF5A1F` | Flame ring 1.00 stop (α 0) | v1 token, now only the flames' outer edge |
| `sun.bodyCore` | `#FFB43A` | Body gradient 0.00 | New, replaces `star.core #FFF8E1` on the disc |
| `sun.body` | `#FF8F1F` | Body gradient 0.65 | New, replaces `star.body #FFC857` on the disc |
| `sun.bodyLimb` | `#FF7A14` | Body gradient 1.00 | New |
| `sun.plasmaDark` | `#802105` | Darker plasma cells (alpha capped 0.55 = "less dark"); black-hole dark plasma and dark stream arcs | New. Deep red-brown, never black |
| `sun.limb` | `#FFD27A` | Limb 0.80 (α 0) → 0.93 (α 0.55); the flare's tip (α 0.15) | New |
| `sun.limbHot` | `#FFF1C2` | Limb 0.97 (α 0.90); the ragged rim stroke (α 0.75); the prominence core (α 0.90); black-hole photon sub-ring; cracked-world crack core; `ringSaturn` bloom | New |
| `star.corona` | `#FF8C2E` | Prominence outer stroke (2.8 px, α 0.85); black-hole glow and ramp; lava halo / haze; cracked-world crack glow | v1 token, kept |
| (`#FFFFFF`) | `#FFFFFF` | Limb 1.00 (α 0.95); the flare's base | White |

`star.core #FFF8E1` (black-hole ramp inner edge) and `star.body #FFC857` (= `fuel.low`; black-hole ramp, lava vein cores, cracked crack line, hazard stripe) stay tokens but no longer colour the sun. `star.limb #FF5A1F` is retired as a separate name (= `star.glow`).

### Start planet = the ocean world (`planet-start.svg` = `bodies/ocean.svg`, the approved reference variant F)
The start planet **is** the reference. Its v1.2 tokens (`planet.start.base #3D8BFF`, `.highlight #9CCBFF`, `.shadow #142B5E`, `.atmo #7FB8FF`, `.land #8FB07A`, `.cloud #F2F5FF`, `.ice #E9EEF8`, `planet.specular #FFFFFF`) no longer colour it; the hexes that other assets still use keep their other names (§2 UI, §8).

| Token | Hex | Used for | Note |
|---|---|---|---|
| `ocean.deep` | `#1E5BD6` | Base disc and strip fill — deep ocean | Vivid, not pastel |
| `ocean.shallow` | `#36B9D8` | Coastal shallows, ramp n 0.490 → 0.595 (slope 9.5) | |
| `ocean.land` | `#5FA84A` | Land, n > 0.546 (slope 70: a ≈ 1 px coast) | |
| `ocean.forest` | `#3B7E3B` | Forest, n 0.58 → 0.636 (slope 18) | The darker land sub-zone |
| `ocean.desert` | `#D8B26E` | Desert, second field dn 0.564 → 0.636 (slope 14), composited **in** the land; also the asteroid ochre | The contrasting zone |
| `ocean.highland` | `#5B5A33` | Highlands, n 0.64 → 0.723 (slope 12) | |
| `ocean.ice` | `#F4F8FF` | Polar caps 12 % (8.16 px): α 1 at the pole · 0.95 at 78 % · 0; also `ice.cap`, the ring-debris caps, the blue-giant flame core and rim | |
| `cloud` | `#FFFFFF` | Clouds, group α 0.78 | White |

### Planet X (the target, v1.5: mint identity, reference techniques)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `planet.x.base` | `#3DE0C2` | Mint plains (n > 0.500, slope 60: crisp, ≈ 50 %); the halo (α 0.35 → 0 at 1.8 r) | The only cool glow on screen |
| `planet.x.deep` | `#17B39C` | Base disc and strip fill (teal lowland); the thin lineae (×0.85) | New (v1.5) |
| `planet.x.shadow` | `#0E4A40` | Dark basins (solid below n 0.345, 0 at 0.410) | No longer the night side (that is `night.*`) |
| `planet.x.highlight` | `#B5FFF0` | Ice fields (n 0.630 → 0.6925); shade bloom (α 0.28); rim peak (α 0.95) | Also `planet.x.ice` |
| `planet.x.frost` | `#44CFE8` | Cyan frost (field k 0.570 → 0.641) composited **in** the plains | New (v1.5) |
| `planet.x.cap` | `#E6FFF9` | Polar caps 18 % with a ragged, terrain-driven inner edge (v1.5.1); the wisps (α 0.70 group); the haze edge (α 0.65) | New (v1.5), replaces `planet.x.wisp` |
| `planet.x.atmo` | `#8FFFE6` | Haze (0.96 α 0.42); rim tail (0.955 α 0.40) | |
| `planet.x.ring` | `#3DE0C2` | The target zone (= `zone.ring`): a solid 1.5 px ring at the capture radius over a mint glow band, α 0.55 → 0.78 → 0.55 over 4 s; states in §17 | v3.0: replaces the v1.2 dashed, crawling ring |

Planet X keeps its lower-left lighting (L = (−0.7071, +0.7071)) because it sits up-right of the star in every scene; its wisp shadow is offset (+1, −1), away from that light.

### Shared lighting tokens (every planet and moon, from the planet reference)
| Token | Hex | Used for | Note |
|---|---|---|---|
| `terminator.warm` | `#FF9455` | The warm terminator band: 0.64 α 0 → **0.705 α 0.14–0.26** (atmosphere bodies) or 0.69 α 0 → 0.73 α 0.18 (airless); rock and moon terminators | New (v1.5). The lit air just before night |
| `night.navy` | `#08122E` | Night shoulder: 0.76 α 0.74 (airless 0.755 α 0.82) | New (v1.5). Replaces every per-body shadow token as the night side |
| `night.deep` | `#050B1E` | Night core: 0.84 α 0.97 → 1.00 α 1 (airless 0.80 α 0.97 → 1); eclipse and ring shadows on planets; rock and metal night | New (v1.5) |
| `cloud.shadow` | `#06122E` | Cast cloud / wisp shadow strips (α 0.32–0.45, blur 0.45, offset away from L) | New (v1.5) |
| `glint` | `#FFFBEE` | Specular glint, ocean worlds only (ocean, double.big) | New (v1.5), replaces `planet.specular` |
| `bloom.ocean` | `#E6F2FF` | Shade bloom 0.00 (α 0.18–0.38) on blue worlds (ocean, double.big, ring-debris, ring-shepherd) | New (v1.5) |
| `haze.ocean` / `haze.oceanEdge` | `#8FD0FF` / `#BFE6FF` | Inner haze 0.96 / 1.00 on the ocean world; `#8FD0FF` also on the ice world | New (v1.5) |
| `rim.ocean` / `rim.oceanOuter` | `#A8DBFF` / `#7FC4FF` | Outer rim 0.928 / 0.955 on blue worlds | New (v1.5) |

### Ship
| Token | Hex | Used for | Note |
|---|---|---|---|
| `ship.hull` | `#F2F5FF` | Triangle hull | Matte; no glow |
| `ship.outline` | `#0A0D1A` | 1 px outline | Keeps the hull legible over the star and planets |
| `ship.cockpit` | `#5EA0FF` | Tiny accent dot/slit | Same blue as `ui.accent` and `trail` |
| `thrust.core` | `#FFE08A` | Inner thrust triangle; `mv.rim` | Lives one frame per thrust tick |
| `thrust.outer` | `#FF6A2A` | Outer thrust triangle; `lava.vein`; `mv.hot` | Additive (`lighter`) compositing |

### Trail, path, arrow
| Token | Hex | Used for | Note |
|---|---|---|---|
| `trail` | `#5EA0FF` | Flight trail, solid 2 px stroke; α fades to 0 over the last ~240 samples | Solid = "what happened" |
| `path` | `#DCE4FF` | Predicted path, dotted (dots r 1.5 every 10 px): α 0.7 for the first 80 %, 0.35 for the last 20 %; end ring r 6, 1.5 px, α 0.5 | Dotted = "what might happen" |
| `arrow` | `#FFFFFF` | Drag arrow shaft and head | |
| `arrow.power` | `#3DE0C2` → `#FFC857` → `#FF5A5F` | Arrow head and power tick, 0 % → 50 % → 100 %, linear in sRGB | The 62 % sample is `#FFAE59` — a ramp value, not a token |

### UI
| Token | Value | Used for | Note |
|---|---|---|---|
| `ui.text` | `#ECF0FA` | Primary text, mode label, inactive segment text; orbit lines (α 0.08), shepherd rings (α 0.7) | |
| `ui.textMuted` | `#8B95B5` | Wordmark, labels, telemetry, subtitles | Still passes AA |
| `ui.textDim` | `#4B5470` | Decorative/disabled only | Fails body-text contrast on purpose |
| `ui.panel` | `rgba(10,13,26,0.72)` | Translucent panel/button fill | Result card uses it at α 0.92 |
| `ui.border` | `rgba(255,255,255,0.10)` | 1 px hairline on panels and secondary buttons | |
| `ui.accent` | `#5EA0FF` | Primary button fill, active segment | Text on it is `bg.base` `#050710` |
| `ui.shadow` | `rgba(5,7,16,0.50)` | Result card drop shadow: blur 16 px (σ 8), offset y 8 | The only `shadowBlur` in the game, drawn once (§4) |

The wreck debris reuses the UI hexes for metal under their own names (`metal.highlight #ECF0FA`, `metal.base #8B95B5`, `metal.dark #4B5470`, §9); the UI tokens themselves are unchanged.

### Fuel
| Token | Hex | Used for |
|---|---|---|
| `fuel.full` | `#3DE0C2` | Fuel bar ≥ 30 % |
| `fuel.low` | `#FFC857` | Fuel bar 10–30 % |
| `fuel.critical` | `#FF5A5F` | Fuel bar < 10 % |

### Results
| Token | Hex | Used for | Note |
|---|---|---|---|
| `result.win` | `#3DE0C2` | "Planet X reached" title + accent bar | Same mint as the target |
| `result.crash` | `#FF5A5F` | "Crashed" title + accent bar | |
| `result.lost` | `#B48CFF` | "Lost in space" title + accent bar | The violet also tints the neutron star, the black hole's outer disk and the emission nebula's outer gas, never UI |

### Contrast (WCAG 2.x, computed from relative luminance)
UI tokens and the background are unchanged in v1.5, so the table still holds.

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `ui.text` `#ECF0FA` | `#050710` | 17.6 : 1 | AAA |
| `ui.text` `#ECF0FA` | `bg.edge` `#000000` | 18.4 : 1 | AAA |
| `ui.textMuted` `#8B95B5` | `#050710` | 6.8 : 1 | AA body, AAA large |
| `ui.textMuted` `#8B95B5` | `bg.edge` `#000000` | 7.1 : 1 | AAA (just) |
| `ui.textDim` `#4B5470` | `#050710` | 2.7 : 1 | Fails — decorative only (intended) |
| `ui.accent` `#5EA0FF` | `#050710` | 7.6 : 1 | AAA |
| `#050710` | `ui.accent` `#5EA0FF` | 7.6 : 1 | AAA (button label) |
| `result.win` `#3DE0C2` | `#050710` | 12.1 : 1 | AAA |
| `result.crash` `#FF5A5F` | `#050710` | 6.6 : 1 | AA body, AAA at 40 px |
| `result.lost` `#B48CFF` | `#050710` | 7.8 : 1 | AAA |

The result card composites to ≈ `#0A0D1A`; ratios on it drop by ~0.3 and every verdict holds.

**Over a nebula (v1.4).** Where both colour layers of the emission nebula peak (violet α 0.16 + rose α 0.22 over `bg.base` ≈ `#4B2943`), `ui.text` is still 10.9 : 1 (AAA) but `ui.textMuted` drops to **4.2 : 1** (fails AA body text); over the reflection nebula's peak (≈ `#2A3852`) it is 4.0 : 1. Hence the §9 layout rule: nebula cores stay out of the HUD rectangles (wordmark / mode x < 320, y < 90 · fuel x > 1160, y < 80 · actions and telemetry y > 780). Outside the cores (each layer below half alpha) `ui.textMuted` stays ≥ 5.4 : 1.

### Retired tokens (v1.5)
No asset uses these any more; they are listed so nobody revives them by accident. `planet.start.base #3D8BFF` · `planet.start.land #8FB07A` · `planet.x.mineral` / `planet.x.wisp` (names; `#0E4A40` / `#B5FFF0` live on as `planet.x.shadow` / `.highlight`) · `planet.specular` (→ `glint`) · `star.limb` (→ `star.glow`) · the v1.3 per-body night tokens `ice.shadow #35567A` (still used, as `iceDebris.shadow`), `lava.shadow #1E1414` (kept: it is now the basalt and terminator colour), `gasBanded.shadow #4A2E1E`, `gasRinged.shadow #1C3A36` · `gasRinged.ring #D8E6E3` · the v1.3 grey-family moon set `#9A9AA6 / #5E5E6B / #D8D8E0` · dwarf `#B8A48E / #6E6052 / #E8DCC8` (`#E8DCC8` survives as `msB.bloom`) · rocky `#C98B5A / #7A4E33 / #F0C9A0` · double `#5E9ED6 / #2C4F7A / #DCEFFF` (`#5E9ED6` / `#DCEFFF` survive as `iceGiant.*`) · ice `#CFE6F5 / #7FA6C9` (survive as `iceDebris.*` and `mi.crack`) · red dwarf body `#FF7A4D` · lava `#3A2A2A` on lava (kept as `mv.spot` and the wreck scorch) and `#5A4040` · toxic `#5E8F3A / #2F5A2A / #E6F2C8` · cracked `#4F5B73 / #2A3245` (`#2A3245` survives as `metal.edge`).

### Gradient stops (canon, as defined in the asset SVGs)
Each file's header comment lists every stop; this table repeats the three reference-grade bodies. "userSpace" means the SVG positions the centre in px relative to the body centre, as the Canvas code does. Linear thresholds are `alpha = s·n + i` on the noise channel (threshold at alpha 0.5 → n = (0.5 − i)/s); `×c` caps the layer's alpha.

| Gradient / layer (asset) | Geometry | Stops / values |
|---|---|---|
| Sun haze (`star.svg`) | circle r 200, in `#starBreathe` (±3 % / 6 s) | 0 `#FF7A2A` α 0.60 · 0.23 α 0.52 · 0.33 `#E8461A` α 0.30 · 0.55 `#A8240E` α 0.15 · 0.80 `#6A1408` α 0.06 · 1 α 0 |
| Sun wisp ring | circle r 78 filled solid to the centre, rotates −360° / 300 s, in `#starBreathe` | 0 `#FFB347` α 0.55 · 0.62 α 0.55 · 0.80 `#FF6A1A` α 0.22 · 1 `#E8461A` α 0; filter: fractalNoise 0.05, 5 oct, seed 33, made opaque (alpha = 1) → displacement scale 34 → blur 0.8. Reaches ≈ r 95 |
| Sun flame ring | circle r 62 filled solid, rotates +360° / 200 s, in `#starBreathe` | 0 `#FFE7A0` α 0.95 · 0.74 α 0.95 · 0.82 `#FFB347` α 0.80 · 0.91 `#FF6A1A` α 0.38 · 1 `#FF5A1F` α 0; filter: fractalNoise 0.08, 4 oct, seed 21, opaque → displacement 20 → blur 0.4. Reaches ≈ r 72 |
| Sun body | circle r 46 | 0 `#FFB43A` · 0.65 `#FF8F1F` · 1 `#FF7A14` |
| Sun surface (`#starSurf`, clipped to the disc) | over the body | dark cells: fractalNoise 0.05, 5 oct, seed 4 → `#802105`, alpha = 3.4 R − 1.6, × 0.55; filaments: turbulence 0.06, 5 oct, seed 9 → `#FFE7A0`, alpha = 1.25 − 6.5 R, × 0.85 |
| Sun limb | circle r 46, userSpace | 0.80 `#FFD27A` α 0 · 0.93 α 0.55 · 0.97 `#FFF1C2` α 0.90 · 1 `#FFFFFF` α 0.95 |
| Sun edge wobble (`#starEdge`) | on the body + limb group | fractalNoise 0.11, 3 oct, seed 44, opaque → displacement 6.5, no blur |
| Sun ragged rim | circle r 46.2, stroke 1.6 | `#FFF1C2` α 0.75; fractalNoise 0.22, 2 oct, seed 57 → displacement 5 → blur 0.35 |
| Sun prominences | 3 loops, `rotate(A) translate(46 0)` | outer `#FF8C2E` 2.8 px α 0.85 + core `#FFF1C2` 1 px α 0.90, round caps, no blur. P1 147.5° `M-0.9 -9 C21 -7.2 21 7.2 -0.9 9` 12 s / begin 0 · P2 243.6° `M-1.3 -11 C23.5 -9 23.5 9 -1.3 11` 16 s / 5 s · P3 314.8° `M-0.8 -8.5 C29 -6.8 29 6.8 -0.8 8.5` 14 s / 9 s; scale 0.6 → 1 → 0.6 and opacity 0 → 1 → 0 (sine) |
| Sun flare | wedge `M46 -1.8 L86 0 L46 1.8 Z`, rotate 25° | linear `#FFFFFF` → `#FFD27A` α 0.15; opacity 0 → 1 → 0 at keyTimes 0.5909 / 0.6318 / 0.6727 of 22 s (13.0 / 13.9 / 14.8 s) |
| Ocean surface strip (`#psLand`) | one rect 428 × 68 (2P, P 214), fill `#1E5BD6`, scrolled 0 → +214 / 90 s | n = fractalNoise 0.030, 6 oct, seed 7; dn = fractalNoise 0.045, 3 oct, seed 23 (both stitched over 214 × 68, `feTile`d). shallow `#36B9D8` 9.5 n − 4.655 · land `#5FA84A` 70 n − 38.21 · forest `#3B7E3B` 18 n − 10.44 · desert `#D8B26E` 14 dn − 7.9 **in** land · highland `#5B5A33` 12 n − 7.68 · caps `#F4F8FF` 12 % |
| Ocean cloud shadow (`#psCloudShadow`) | same rect, translate (−0.85, 0.85) → (213.15, 0.85) / 64 s, group α 0.45 (down-left, away from the light; v1.5.1) | the cloud noise → `#06122E`, alpha 26 c − 13.93, blur 0.45 |
| Ocean clouds (`#psCloud`) | same rect, 0 → +214 / 64 s, group α 0.78 | c = fractalNoise `0.042 0.085`, 6 oct, seed 19 → `#FFFFFF`, alpha 26 c − 13.93 (≈ 30 % cover), blur 0.2 |
| Ocean glint | ellipse 6.4 × 3.6 at 0.45 r·L = (10.82, −10.82), `rotate(−45)` | `#FFFBEE` 0 α 0.60 · 0.45 α 0.25 · 1 α 0 |
| Ocean shade | userSpace centre 0.36 r·L = (8.66, −8.66), radius 1.25 r = 42.5 | 0 `#E6F2FF` α 0.38 · 0.32 α 0 · 0.64 `#FF9455` α 0 · 0.705 `#FF9455` α 0.24 · 0.76 `#08122E` α 0.74 · 0.84 `#050B1E` α 0.97 · 1 α 1 |
| Ocean haze | circle r 34, lit mask | 0.78 `#8FD0FF` α 0 · 0.96 α 0.42 · 1 `#BFE6FF` α 0.65 |
| Ocean rim | circle 1.077 r = 36.6, lit mask | 0.90 `#A8DBFF` α 0 · 0.928 α 0.95 · 0.955 `#7FC4FF` α 0.40 · 1 α 0 |
| Lit mask (every atmosphere body) | linear from +0.706 r·L to −0.706 r·L (ocean (24, −24) → (−24, 24)) | alpha 1.0 · 0.5 → 0.45 · 1.0 → 0.06 |
| Planet X halo | r 1.8 r = 54, breathes ±4 % / 2.4 s | `#3DE0C2` 0 α 0.35 · 0.556 α 0.35 · 0.62 α 0.22 · 0.78 α 0.08 · 1 α 0 |
| Planet X surface strip (`#pxSurface`) | rect 376 × 60 (P 188), fill `#17B39C`, 0 → +188 / 120 s | n = fractalNoise 0.035, 6 oct, seed 11; k = fractalNoise 0.05, 4 oct, seed 17; v = turbulence 0.06, 1 oct, seed 11. plains `#3DE0C2` 60 n − 30 · frost `#44CFE8` 14 k − 7.98 **in** plains · basins `#0E4A40` −15.3 n + 6.273 · ice `#B5FFF0` 16 n − 10.08 · lineae `#17B39C` −50 v + 1.5 × 0.85 · caps `#E6FFF9` 18 % |
| Planet X wisp shadow / wisps | rect 376 × 60; shadow (1, −1) → (189, −1) / 80 s α 0.32; wisps 0 → +188 / 80 s α 0.70 | c = fractalNoise `0.025 0.12`, 6 oct, seed 23, alpha 26 c − 15.99 (≈ 15 % cover); shadow `#06122E` blur 0.45; wisps `#E6FFF9` blur 0.2 |
| Planet X shade | centre (−7.64, 7.64), radius 37.5 | 0 `#B5FFF0` α 0.28 · 0.32 α 0 · 0.64 `#FF9455` α 0 · 0.705 α 0.22 · 0.76 `#08122E` α 0.74 · 0.84 `#050B1E` α 0.97 · 1 α 1 |
| Planet X haze / rim | haze r 30; rim r 32.3; lit mask (−21.2, 21.2) → (21.2, −21.2) | haze 0.78 `#8FFFE6` α 0 · 0.96 α 0.42 · 1 `#E6FFF9` α 0.65; rim 0.90 `#B5FFF0` α 0 · 0.928 α 0.95 · 0.955 `#8FFFE6` α 0.40 · 1 α 0 |
| Planet X target zone (v3.0) | ring r 78, solid 1.5 px; band circle r 87 | ring `#3DE0C2` α 0.55 → 0.78 → 0.55 / 4 s (sine); band radial 0.552 `#3DE0C2` α 0 · 0.897 α 1 · 1 α 0 at fill-opacity 0.14 → 0.24 → 0.14, in phase (§17) |
| Vignette | centre (720, 450), r 900, over `bg.edge` | 0 `bg.vignette` · 0.55 `bg.base` · 1 `bg.edge` |
| Milky Way (`starfield.svg`) | ellipses at −28°: rx 1100 × ry 150, rx 900 × ry 70 offset 25 px; fractalNoise mask 0.0025, 3 oct, seed 5 | `milkyway.dust` α 0.06 · 0.55 α 0.03 · 1 α 0, and α 0.05 → 0; peak after masking 0.054. Canvas: three unmasked ellipses α 0.05 / 0.04 / 0.03 |
| Star halos (`starfield.svg`) | r 4.5 on the 12 largest near stars | own tint α 0.18 → 0 |

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

1. **Glow belongs to exactly two things per scene: the scene's star and planet X.** The star is whichever of the six the level names (sun, red dwarf, blue giant, white dwarf, neutron star, black hole); a compact object's glow, beams and accretion disk count as the star's. The lava world's faint static halo (1.4 r, α 0.20) is the one planetary exception. Atmosphere haze and rims are not glow — they never leave 1.077 r and never animate. Nebulae are background-pass gas (§9), not glowing objects: no bloom, α ≤ 0.22 per colour layer, drawn into the background.
2. **Stars: cached sprites, no runtime blur.** The SVG's flame and wisp rings are displaced noise; Canvas bakes them **with their displacement** into 2–3 sprite frames per ring that are drawn rotating (flames +360° / 200 s, wisps −360° / 300 s on the sun) and cross-faded, inside the ±3 % / 6 s breathe of the haze sprite. The disc — body gradient, tinted plasma, limb, rim wobble and the ragged rim — is one static sprite. Prominences are three unblurred two-tone sprites and the flare one sprite, faded and scaled by the scene clock (`canvas-notes.md` §3, §3b).
3. **Planet X:** halo = a **live** radial-gradient fill at 1.8 r (0.35 to the disc edge, 0.22 at 0.62, 0.08 at 0.78, 0 at the rim), breathing ±4 % / 2.4 s: one gradient + one arc fill per frame. The target zone is a live solid stroke plus one live gradient fill for its band (§17).
4. **Planets and moons: cached strips + a cached lighting overlay.** The surface is a texture strip of period P = round(2π r), two tiles wide, built once per zoom bucket with every zone baked (thresholded noise tiles, tinted). Clouds / wisps are a second strip **with their cast shadow baked under them**. Per frame: one circular clip, 1–3 strip blits with a time-based x offset, and one blit of the overlay that holds the shade (highlight bloom → warm terminator band → night navy), the lit-side haze and the lit-side rim. Ringed planets add ring sprites before and after; systems add moon sprites. Still 0 `shadowBlur`, 0 per-frame noise, 0 per-frame blur.
5. **Ship:** no glow, ever. Thrust: two additive triangles, no blur in Canvas (the SVG asset keeps σ 1.2 / 0.4 as presentation only).
6. **Trail / predicted path:** per-segment alpha / dots, no blur.
7. **UI:** no text shadows. Panels are `ui.panel` with a `ui.border` hairline and 10 px radius.
8. **Background: cached.** Vignette, Milky Way, starfield and — when static — the nebula sprites and the asteroid dust are drawn once into the background canvas and blitted as the per-frame clear. Animated nebula layers are two large blits with a `globalAlpha` cross-fade (§9).
9. **Exactly one `shadowBlur` in the game, and it never repeats:** the result card's drop shadow, `ui.shadow` `rgba(5,7,16,0.5)`, blur 16 px (σ 8), offset y 8, rendered once into the offscreen card.

**Glow budget (per frame):**
- 1 star: haze sprite (breathing) + 2 flame-ring blits and 2 wisp-ring blits (rotating, cross-faded) + ≤ 3 prominence blits + ≤ 1 flare blit + 1 disc blit — or a compact object's stack (white dwarf 2, neutron star 3, black hole ≤ 5 blits)
- planet X: 1 live breathing halo fill + the planet blits + 1 dashed ring stroke
- every planet / moon: 1 clip + 1–3 strip blits + 1 overlay blit (+ 1 halo blit on lava; + 2 ring sprites on a ringed planet; + 1 rotated particle-ring sprite per sub-ring half)
- 1 cached background (vignette + Milky Way + starfield [+ static nebulae and dust]) — blit; animated nebula: + 2 blits
- 0 `shadowBlur` in play; 1 on the result card, drawn once
- 0 blur, noise or blend modes on anything per frame

### 4.1 Realism, vibrancy and crispness rules (v1.5 revised)

These replace the rejected v1.5 "crispness" numbers. They come from the two approved references — `planet-start.svg` (variant F) and `star.svg` (variant J) — and every body in the library is built to them. Their header comments and `<defs>` are the spec; when in doubt, copy the reference.

**Colour and texture**
1. **Vivid bases.** Each body's base is a saturated, clean hue (deep ocean `#1E5BD6`, not a pastel; rocky `#D2803F`, not tan). Night sides are always the shared navy (`night.navy #08122E` → `night.deep #050B1E`), never a darkened copy of the base, so every body sits on the same sky.
2. **Never untinted grey.** Every noise layer is drawn in a token colour through a colour matrix or a tinted fill. No `saturate 0`, no grey `overlay` or `multiply` passes on a coloured body. Grey-family bodies (moon, asteroids, metal) use tinted greys: lavender `#A6A2B6`, warm stone `#7E7468`, blue steel `#8B95B5`.
3. **Several zones, not one.** A surface has 3–6 zones from thresholded noise: a base, a darker sub-zone, a contrasting zone from a **second** field composited `in` the first (ocean desert in land, X frost in plains, toxic acid in uplands, volcanic lava in flows), and highlands or ice. Thin features (cracks, lineae, grooves, rivers of lava) are iso-contours (`|n − level| < w`) or turbulence ridges (`a = c − s·R`), always tinted.
4. **Plasma, not grain (stars).** A star's surface = vivid body gradient + darker cells (fractal noise, deep red-brown `#802105` or the star's own dark tint, alpha capped at 0.42–0.55 — "less dark" than a photograph) + bright filaments (turbulence ridges, alpha = 1.25 − 6.5 R, × 0.8–1.0). The black hole's disk uses the same recipe.

**Edges**
5. **Crisp thresholds.** 6 noise octaves for fine detail, and steep slopes: coasts ~70, zone edges 12–60 (≈ 1 px), cloud edges 22–26. The soft v1.2 slopes (5–24 everywhere) are gone.
6. **Blur budget.** No `feGaussianBlur` above **0.5** on any body or effect, except: glows and hazes (gradient falloff, no blur at all where possible), the sun's wisp ring (0.8, as the reference) and flame ring (0.4), a pre-baked lava bloom (0.8) and crack glow (0.9), a toxic cloud field smoothing (0.6, applied **before** the threshold so the edge stays crisp), the dark cloud's tail and inner glow (12 / 3, gas), nebula bodies (gas looks like gas) and the volume field inside the captured moon's lighting (2.4, not visible as blur). Typical values: clouds 0.2, cloud shadows 0.45, band edges 0.25, ring shadows 0.5–0.8 in ring space, rims 0.35, photon ring 0.3, lensed arcs 0.5.
7. **Clean disc edges.** No full-circle limb line and no "limb squash" ring: the planet disc ends hard, and the inner haze does the limb. Strokes that remain are on whole or half pixels (white dwarf limb r 15.5 / 1 px, Einstein ring r 46.5 / 1 px).
8. **Natural edges where nature has them.** Main-sequence stars: the disc and limb are displaced by fine opaque noise (scale 5–7, freq 0.11–0.13) so the rim wobbles, plus a ragged rim stroke (scale 4.2–5.5, freq 0.22–0.26). Flame rings are filled **solid to the centre** and displaced by **opaque** noise (alpha forced to 1 before `feDisplacementMap`, `color-interpolation-filters="sRGB"`), so they have ragged outer edges and no gaps. Photon ring and lensed arcs wobble ±0.7 px. Polar caps on the double planet and the debris-ring planet have ragged edges. White dwarf and neutron star stay perfectly round on purpose (their surfaces really are smooth).

**Lighting (planets and moons)**
9. **The shade.** One radial gradient centred at +0.36 r·L, radius 1.25 r, `L` toward the star (library: upper-right, L = (+0.7071, −0.7071)):
   - atmosphere bodies: 0 bloom (α 0.18–0.38) · 0.32 α 0 · 0.64 `terminator.warm` α 0 · **0.705 `terminator.warm` α 0.14–0.26** · 0.76 `night.navy` α 0.74 · 0.84 `night.deep` α 0.97 · 1.00 α 1;
   - airless bodies (hard terminator): 0 bloom (α 0.18–0.30) · 0.30 α 0 · 0.69 warm α 0 · 0.73 warm α 0.18 · 0.755 `night.navy` α 0.82 · 0.80 `night.deep` α 0.97 · 1.00 α 1;
   - lava (emissive night): 0 `#FFD9B0` α 0.26 · 0.32 α 0 · 0.64 `lava.shadow` α 0 · 0.705 α 0.45 · 0.76 `night.deep` α 0.80 · 0.84 α 0.97 · 1 α 1 — no warm band; the veins own the night.
10. **Haze and rim, lit side only.** Inner haze: circle r, 0.78 (rocky / lava 0.80) α 0 · 0.96 haze α 0.26–0.42 · 1.00 haze-edge α 0.42–0.65. Outer rim: circle **1.077 r**, 0.90 α 0 · **0.928 rim α 0.70–0.95** · 0.955 rim-outer α 0.28–0.40 · 1.00 α 0. Both multiplied by the lit mask: a linear gradient along L from +0.706 r·L (α 1.0) through the centre (α 0.45) to −0.706 r·L (α 0.06). Airless bodies have neither (the icy and volcanic moons keep a faint rim, peak 0.75 / 0.70).
11. **Clouds cast shadows.** Clouds / wisps are elongated noise (`baseFrequency` x < y, e.g. `0.042 0.085`), 6 octaves, slope ~26, blur ≤ 0.2, opacity 0.70–0.92, ~8–55 % cover, over a **shadow copy** of the same mask in `cloud.shadow #06122E` (or a body tint), offset ~1.2 px away from the light, blur 0.45, opacity 0.32–0.45.
12. **Glint on ocean worlds only** (ocean, double.big): `glint #FFFBEE`, α 0.5–0.6, ellipse ≈ 0.19 r × 0.11 r at 0.45 r·L.
13. **Shape-aware light on non-circular bodies.** The captured moon, the asteroids and the metal debris keep the light fixed while they tumble: the texture rotates, the light layer does not (static light circle, or a filter built from the silhouette offset along L).

**Motion and crispness at runtime**
14. Lighting never rotates; textures scroll or rotate under it. All motion is wall-clock (`tS`), slow (≥ 3 s cycles; most 20–300 s), seamless, and calm.
15. Render at `devicePixelRatio` (min 1, max 2); build every sprite at its size × DPR; rebuild rather than upscale a cached sprite beyond **1.25×** its built size; scaled blits use `imageSmoothingQuality = "high"` (`canvas-notes.md` §0, §12). Mockup PNGs are exported at 2× (2880 × 1800).

## 5. Motion feel

Slow, eased, weightless. Nothing snaps; nothing bounces.

| What | Duration | Easing | Note |
|---|---|---|---|
| Button hover | 120 ms | ease-out | fill lightens ~8 %; no scale |
| Button press | 80 ms | ease-in | fill darkens; no scale |
| Result overlay in | 320 ms | ease-out cubic | fade 0→1 with a 12 px rise |
| Target zone pulse (v3.0) | 4 s loop | sine | ring α 0.55 ↔ 0.78, band α 0.14 ↔ 0.24; no dash, no crawl, fixed radius (§17) |
| Planet X halo breathe | 2.4 s loop | sine | radius ±4 % |
| Star breathe | 6 s loop | sine | haze + flame + wisp rings scale ±3 %; the disc, rim, prominences and flare never breathe (the crash disc never moves) |
| Star flame / wisp rings | sun 200 / 300 s · red dwarf 260 / 390 s · blue giant 200 / 300 s per turn | linear | counter-rotating (flames +, wisps −); 0.1–0.2 °/s — reads as slow boiling, not spin |
| Prominence loops | 12 / 16 / 14 s loops, begin 0 / 5 / 9 s | sine | scale 0.6 → 1.0 → 0.6 about the base point, opacity 0 → **1** → 0 (the two-tone strokes carry their own α 0.85 / 0.90); peaks at 6 + 12n / 13 + 16n / 16 + 14n s; invisible at t = 0 |
| Flare | 22 s cycle | triangle | opacity 0 → **1** → 0 between 13.0 and 14.8 s (peak 13.9 s); the gradient carries its own α (tip 0.15) |
| White dwarf glow breathe | 4 s loop | sine | glow ±5 %; the disc does not move |
| Neutron star beams | 6 s per turn | linear | magnetosphere rotates clockwise, 30° at t = 0 |
| Black hole disk | 24 s per turn | linear | plasma ring rotates clockwise inside the squash |
| Lava emissive pulse | 5 s loop | sine | veins + lakes α 1.0 → 0.7 → 1.0 (full at t = 0) |
| Volcanic hot spots | 6 s loop each | sine | α 0.55 ↔ 1, begins 0 / −2 / −4 / −6 / −8 s — never in step |
| Planet surfaces | 60–180 s per rotation | linear, continuous | ocean 90 (clouds 64), X 120 (wisps 80), rocky 110, ice 140, lava 95, toxic 120 (clouds 75), cracked 100, moon 180, dwarf 160, double 80 / 60, icy moon 150, volcanic moon 120, debris-ring planet 120, system planet 110 s |
| Gas bands | 150 / 110 / 180 s (banded), 160 / 120 s (ringed), 150 / 110 s (Saturn), 110 s + clouds 80 s (ice giant) | linear | counter-flow groups |
| Orbits | double 40 s · system moons 30 / 52 s (tidally locked) · shepherd moons 36 / 40 s | uniform | z-order swaps happen out of sight |
| Ring particles / rocks | Saturn sub-rings 60 / 90 / 130 s · debris ring 45 / 70 s | uniform | prograde: the near side moves left → right; inner faster (Keplerian) |
| Captured moon tumble | 70 s per turn | linear | the albedo turns; the light does not |
| Asteroid tumble | dust 20–50 s · small 35–70 s · large 55–90 s | linear | random direction per rock |
| Asteroid belt drift | 60 s loop | sine | ±6 px along the belt axis |
| Wreck tumble | 30–200 s per piece | linear | bigger = slower |
| Wreck glints | 3.1–6.4 s loops | sine | α 0.2 ↔ 0.6, staggered |
| Nebula cross-fade | 40 s loop | eased | two noise layers α 1 ↔ 0.6 in opposition |
| Nebula breathe | 30 s loop | eased | scale 1 → 1.01 → 1 |
| Ship heading | per frame | lerp 0.18 | eases toward velocity heading |
| Fuel bar drain | 140 ms | ease-out | width tween + colour step at 30 % / 10 % |
| Thrust flash | 1 frame | — | on per tick, then gone |

**Lighting never rotates.** On every body the day side, terminator, haze, rim and glint are fixed to L; only textures move. Rotation is wall-clock time (`dt`-based phase), the same at 1x, 2x and 4x, and it keeps running under the result overlays (on a win only the capture ring locks). The fastest thing on screen is the neutron star's 6 s beam sweep on an 8 px body; the busiest is the asteroid field's dust tumbling at 20 s per turn.

**Never animates:** the starfield and Milky Way, the vignette, every body's lighting, the gas giants' rings, the HUD text, panel borders, the predicted path (it re-computes on drag but does not "flow"), the trail (it fades by age). Speed buttons 1x/2x/4x change simulation steps per frame, never the frame rate, the periods above or any easing.

## 6. Layout & HUD

Scene and HUD positions for a 1440×900 frame, origin top-left. Same in every mode; everything not listed is empty space.

| Element | Position / size | Spec |
|---|---|---|
| Background | full frame | `bg.edge` fill, radial vignette from (720, 450) r 900: `bg.vignette` → `bg.base` at 0.55 → `bg.edge` at the rim; then the Milky Way and the starfield; then (scene-nebula) the nebula and the asteroid dust |
| Central star | c (760, 470), r 46 | haze to r 200, flame ring r 62 (ragged to ≈ 72), wisp ring r 78 (ragged to ≈ 95), prominences to ≈ 1.5 r |
| Start planet | c (250, 690), r 34 | ocean world lit from the upper-right; strip 214 px / 90 s, clouds 64 s; glint at (+10.82, −10.82); haze to r, rim to r 36.6 (1.077 r); the ship sits on its upper-right limb while planning |
| Planet X | c (1190, 210), r 30 | mint world lit from the lower-left; strip 188 px / 120 s, wisps 80 s; halo to r 54 (breathing ±4 %), rim to r 32.3, target zone r 78, solid, glow band to r 87 (§17) |
| Ship | 22 px long | planning: on start limb; flight: ≈ (900, 380), thrust on |
| Predicted path | planning only | dotted, bends around the star's right/lower side toward X; last 20 % at α 0.35, r 6 end ring |
| Drag arrow | planning only | from the ship, ~140 px, up-right, tick + label "62 %" |
| Trail | flight only | solid, fading, from start planet around the star |
| Wordmark | baseline (40, 50) | "SLINGSHOT" 13 px uppercase `ui.textMuted`, weight 500; mode label at baseline (40, 70), 11 px uppercase `ui.text`, weight 500 |
| Fuel | x 1180–1400 | "FUEL" 11 px uppercase muted, weight 500, at x 1180 baseline 48 · percentage 12 px mono `ui.text`, right-aligned at x 1400 baseline 48 · bar 220×8 at (1180, 56), track `rgba(255,255,255,0.08)`, fill `fuel.*` |
| Planning action | centred on (720, 820) | "Launch" 160×44, radius 10, `ui.accent` fill, `#050710` 14 px semibold at baseline 825 |
| Flight actions | centred on y = 820 | [1x][2x][4x] 56×36 at x 580 / 636 / 692, 16 px gap, "Reset" 96×36 at x 764–860; labels 14 px semibold at baseline 825 |
| Telemetry | baseline (40, 864) | 12 px mono `ui.textMuted`, "v 1.84  ·  dX 412" (planning: "v —  ·  dX 1030") |
| Result overlay | card 520×232 centred at (720, 450) | scrim `rgba(5,7,16,0.62)` over the scene and the HUD; card `ui.panel` α 0.92, `ui.border`, radius 16, `ui.shadow` blur 16 / offset y 8; 4 px accent bar; title 40 px weight 600; subtitle 16 px muted; "Fly again" 140×40 primary |

## 7. Asset index

One row per top-level file in `design/assets`; the 23 library bodies in `design/assets/bodies/` are indexed in §8 and the 5 environment files in `design/assets/space/` in §9 (`assets.md` has a row for every file). Every body / environment SVG is `<defs>` with ids prefixed per file + **one** top-level group `<g id="…" transform="translate(cx cy)">` with geometry relative to (0, 0), a header comment listing every parameter, and SMIL inside, so a mockup or gallery copies the defs and the group verbatim and changes only the translate. Ids are unique across all 37 SVGs.

| Asset | File | viewBox | Anchor / centre | Colours | Mockup |
|---|---|---|---|---|---|
| Ship | `ship.svg` | `0 0 24 24` | (12, 12), nose up (−y) | `ship.hull` `#F2F5FF`, `ship.outline` `#0A0D1A` 1 px, `ship.cockpit` `#5EA0FF` | 22 px long (× 1.158); min 12 px |
| Ship + thrust | `ship-thrust.svg` | `0 0 32 48` | ship at (16, 14) | ship colours + `thrust.outer` `#FF6A2A` α 0.90, `thrust.core` `#FFE08A`; σ 1.2 / 0.4 presentation blur in the SVG only | 1 frame per thrust tick |
| Start planet (ocean world, the planet reference) | `planet-start.svg` | `0 0 120 120` | `#planetStart` at (60, 60), r 34, L upper-right; ids `ps*` | `ocean.*` (§2), clouds `#FFFFFF` over `cloud.shadow #06122E`, glint `#FFFBEE`, shade bloom `#E6F2FF` → `#FF9455` band → `#08122E` / `#050B1E`, haze `#8FD0FF` / `#BFE6FF`, rim `#A8DBFF` / `#7FC4FF` | 1 : 1 at (250, 690); surface 90 s, clouds 64 s |
| Planet X | `planet-x.svg` | `0 0 240 240` | `#planetX` at (120, 120), r 30, L lower-left; ids `px*` | `planet.x.*` (§2) + shared lighting tokens; ring `#3DE0C2` | 1 : 1 at (1190, 210); surface 120 s, wisps 80 s, ring 1 s / 2.4 s, halo 2.4 s |
| Star (sun, the star reference) | `star.svg` | `0 0 400 400` | `#star` at (200, 200), r 46; ids `star*` | `sun.*` (§2), prominences `#FF8C2E` + `#FFF1C2`, flare `#FFFFFF` → `#FFD27A` | 1 : 1 at (760, 470); breathe 6 s, flames 200 s, wisps 300 s |
| Starfield | `starfield.svg` | `0 0 1440 900` | top-left, full frame, static | `milkyway.dust`, `stars.*`, sparkles `#FFFFFF` | full frame; cached background |
| Flight trail | `trail.svg` | `0 0 600 200` | head (570, 62) | `trail` `#5EA0FF`, 2 px | sample only |
| Predicted path | `predicted-path.svg` | `0 0 600 200` | start (30, 150) → end ring (570, 62) | `path` `#DCE4FF` | sample only |
| Drag arrow | `drag-arrow.svg` | `0 0 300 120` | ship centre (36, 92) | `#FFFFFF`, `arrow.power` at 62 % = `#FFAE59`, label `ui.textMuted` | ~140–150 px from the ship |

**Mockups** (`design/mockups`, all `0 0 1440 900`; **PNG = 2× render**, 2880 × 1800, same filenames): `planning`, `flight`, `result-win`, `result-crash`, `result-lost` (the original scene: sun at (760, 470), ocean start at (250, 690), planet X at (1190, 210)), `scene-variant` (red dwarf, ringed gas giant, moon, rocky start), `scene-blackhole` (black hole, ice start, moon) and `scene-nebula` (v1.4: emission nebula behind the left half, an asteroid band crossing the middle, sun with flares, Saturn-ringed planet as the slingshot body, icy moon, ocean start, planet X; the path threads a gap in the belt ≥ 18 px from every large rock and swings around the ringed planet's far side, outside the ring). Every body group is spliced **verbatim** from the v1.5 assets with only its `translate` changed (plus scene-local lighting wrappers where a library body's upper-right light does not face the scene's star). Details per mockup: `assets.md`.

**Previews** (self-contained, no JavaScript, inline SVG verbatim, open from `file://` to see SMIL): `planets.html` (sun, ocean world, planet X at 3× and 1×), `bodies.html` (the 18 v1.3 library bodies, one row per family, plus a relative-sizes strip), `space.html` (v1.4: rows "Gas clouds", "Debris fields", "Moons", "Ringed planets" and a composition tile — nebula + asteroid field + ringed planet at 1×).

## 8. Body library (v1.3 set, v1.4 moons and rings, all built to the v1.5 rules)

**32 bodies**: 12 planets, 6 stars and compact objects (v1.3), 4 moons and 3 ringed planets (v1.4), 3 WP8 objects (v2): a binary star, a red giant and a gas giant with a resonant moon chain, 2 WP9 compact objects (v2.1): a pulsar and a magnetar, the WP10 comet (v2.2), and the WP11 rogue planet (v2.4). Each lives in `design/assets/bodies/<name>.svg` (the ocean world is `bodies/ocean.svg`, a copy of `planet-start.svg` with ids `ps*` → `oc*`; planet X stays `planet-x.svg`; the sun stays `star.svg`). Each = `<defs>` with ids prefixed by the body's short code + **one** top-level group with geometry relative to (0, 0), a header comment listing every parameter (the canon), and its SMIL inside. Prefixes, unique across all assets because galleries inline them together: `rk ic lv tx cr oc gb gr mn dw db rd bg wd ns bh mi mv mc ms rs dr sh bn rg mk pu mg cm rp sp qs sa` + `star* px*` (`ps*` only in `planet-start.svg`).

**Direction (client decision, unchanged): stay realistic**, now also **vibrant and crisp** (§4.1). Kurzgesagt is inspiration only, for colour harmony on deep navy and bold silhouettes; nothing of theirs is copied.

### The set

r is the radius at zoom 1. **`crashRadius`** is the contact radius: the solid disc for every body. Hazes, rims, halos, flames, wisps, glows, beams, the capture ring, ring material (bands, particles, rocks, shepherd rings) and the accretion disk are never solid. Moons inside a system (double, moon-system, shepherd moons) are crash discs at their **moving** centres.

| Key | Name | File · group · ids | r | crashRadius | Motion | Family · what it is for |
|---|---|---|---|---|---|---|
| `rocky` | Rocky desert | `rocky.svg` · `#rocky` · `rk*` | 30 | 30 | surface 110 s | rocky · a warm, dry start world |
| `ocean` | Ocean world | `ocean.svg` · `#ocean` · `oc*` (= `planet-start.svg`) | 34 | 34 | surface 90 s, clouds 64 s | rocky · the original start planet |
| `ice` | Ice world | `ice.svg` · `#ice` · `ic*` | 28 | 28 | surface 140 s | rocky · a cold start world |
| `lava` | Lava world | `lava.svg` · `#lava` · `lv*` | 26 | 26 | surface 95 s, emissive pulse 5 s | rocky · a hazard world that glows |
| `toxic` | Toxic cloud world | `toxic.svg` · `#toxic` · `tx*` | 32 | 32 | surface 120 s, clouds 75 s | rocky · a thick-atmosphere slingshot body |
| `cracked` | Cracked world | `cracked.svg` · `#cracked` · `cr*` | 27 | 27 | surface 100 s | rocky · a tidally stressed world near a heavy body |
| `gasBanded` | Banded gas giant | `gas-banded.svg` · `#gasBanded` · `gb*` | 44 | 44 | bands 180 / 110 / 150 s (counter-flow) | gas · the big slingshot mass |
| `gasRinged` | Ringed gas giant | `gas-ringed.svg` · `#gasRinged` · `gr*` | 44 | 44 | bands 160 / 120 s; ring static | gas · a slingshot mass with a ring to fly through |
| `moon` | Barren moon | `moon.svg` · `#moon` · `mn*` | 14 | 14 | surface 180 s | small · a small mass to nudge a path |
| `dwarf` | Dwarf planet | `dwarf.svg` · `#dwarf` · `dw*` | 10 | 10 | surface 160 s | small · the smallest planet, a precision target |
| `double` | Double planet | `double.svg` · `#double` · `db*` | 18 + 11 | 18 and 11, moving | orbit 40 s; surfaces 80 / 60 s | small · a moving obstacle pair |
| `planetX` | Planet X | `planet-x.svg` · `#planetX` · `px*` | 30 | 30 | surface 120 s, wisps 80 s | target · §2 |
| `sunYellow` | Yellow sun | `star.svg` · `#star` · `star*` | 46 | 46 | breathe 6 s; flames 200 s, wisps 300 s; loops 12 / 16 / 14 s; flare 22 s | star · the default star (§2) |
| `redDwarf` | Red dwarf | `red-dwarf.svg` · `#redDwarf` · `rd*` | 40 | 40 | breathe 6 s; flames 260 s, wisps 390 s; loops; flare | star · a dim, calm star |
| `blueGiant` | Blue giant | `blue-giant.svg` · `#blueGiant` · `bg*` | 54 | 54 | breathe 6 s; flames 200 s, wisps 300 s; loops; flare | star · a hot, wide-glow star |
| `whiteDwarf` | White dwarf | `white-dwarf.svg` · `#whiteDwarf` · `wd*` | 16 | 16 | glow breathe 4 s | compact · small, hot, dangerous |
| `neutronStar` | Neutron star (quiet) | `neutron-star.svg` · `#neutronStar` · `ns*` | 8 | 8 | beams 6 s | compact · a tiny heavy mass with short, faint beams (no beam damage) |
| `pulsar` | Pulsar (WP9) | `pulsar.svg` · `#pulsar` · `pu*` | 8 | 8 | sweep 4 s (a point is hit every 2 s) | compact · long lighthouse beams that damage on a rhythm |
| `magnetar` | Magnetar (WP9) | `magnetar.svg` · `#magnetar` · `mg*` | 9 | 9 | field flicker 1.7–3.4 s, static 5 s, starquake 18 s | compact · extreme field that scrambles the prediction |
| `blackHole` | Black hole | `black-hole.svg` · `#blackHole` · `bh*` | 22 (horizon) | 22 | disk 24 s | compact · star-class gravity, horizon-size crash |
| `comet` | Comet (WP10) | `comet.svg` · `#comet` · `cm*` | 5 (nucleus) | 5 | ion flow 2.2–3.1 s, knot 9 s, coma 5 s, dust sparkles 9–14 s | small · a moving body to ride or harvest ice from; tails always point away from the star |
| `roguePlanet` | Rogue planet (WP11) | `rogue-planet.svg` · `#roguePlanet` · `rp*` | 36 | 36 | thermal bands 90 s, hot spots 2.6–4.3 s | dark · a starless planet drifting in a straight line; a mass with no light and no recharge |
| `moonIcy` | Icy moon (v1.4) | `moon-icy.svg` · `#moonIcy` · `mi*` | 12 | 12 | surface 150 s | moon · a bright cracked-ice nudge body |
| `moonVolcanic` | Volcanic moon (v1.4) | `moon-volcanic.svg` · `#moonVolcanic` · `mv*` | 13 | 13 | surface 120 s; hot spots 6 s | moon · an Io-like sulphur moon |
| `moonCaptured` | Captured asteroid moon (v1.4) | `moon-captured.svg` · `#moonCaptured` · `mc*` | 9 (equal-area mean; outline 6.7–11.9) | 9 (circle; a polygon test is an optional refinement) | tumble 70 s | moon · the only non-circular body |
| `moonSystem` | Planet with moons (v1.4) | `moon-system.svg` · `#moonSystem` · `ms*` | planet 26, moons 5 / 7 | 26; 5 and 7 at the moving centres | planet 110 s; moon orbits 30 / 52 s | system · a planet whose moons cross the path |
| `ringSaturn` | Saturn-like ice ring (v1.4) | `ring-saturn.svg` · `#ringSaturn` · `rs*` | 44 (ring to 2.17 r) | 44 | bands 150 / 110 s; particles 60 / 90 / 130 s | ringed · the big ringed slingshot body |
| `ringDebris` | Rocky debris ring (v1.4) | `ring-debris.svg` · `#ringDebris` · `dr*` | 24 (ring 1.6–1.9 r) | 24 | surface 120 s; clumps 45 / 70 s | ringed · the remains of a destroyed moon |
| `ringShepherd` | Shepherded ring (v1.4) | `ring-shepherd.svg` · `#ringShepherd` · `sh*` | 26 (rings 1.75 / 2.2 r) | 26; shepherd moons 2.5 (moving) | bands 110 s, clouds 80 s; moons 36 / 40 s | ringed · an ice giant with two hairline rings |

### Shared construction

- **Silhouettes are circles**, except the captured moon (a smoothed 16-radius potato), plus ring ellipses and orbit pairs.
- **Strips** (every rotating surface): period P = round(2π r) = one rotation; **one** rect 2P × 2r per strip whose filter computes each noise field once over a P-wide subregion (`stitchTiles="stitch"`) and repeats it with `feTile` — never two abutting rects. Scrolled `translate 0 → +P` (texture moves left → right) through a circular clip. Discrete features (craters, calderas, storms) are drawn at x and x + P. Inner translates keep the visible window clear of the tile join.
- **v1.5.1 seamless strips** (planet X, ice, lava, icy moon): Chrome renders a stitched + `feTile` strip differently depending on how it is clipped / culled and on the ancestors' transforms, and at the period boundary drew a straight-edged block (planet X) or straight lineae and plate edges (lava, icy moon). These four now build each strip from a **field group** — four rects with an *unstitched* noise filter: copy A shows N(u), copy B shows N(u − P) through a 0 → 1 alpha ramp across the period, so the blend equals N(0) at both ends; the rects' fill alpha c(u) rescales the noise about 0.5 so the blend keeps full contrast — under a **pointwise zones filter** (colour matrices, component transfers, a 0.25–0.6 px smoothing blur against 8-bit speckle). The noise never starts on its lattice origin (per-asset offset X0 / Y0). The `planet-x.svg` header documents it in full; the other strip assets keep the stitched construction (follow-up).
- **Ragged polar caps** (v1.5.1, planet X and ice): cap α = 12 (capRamp + (n − 0.5) − τ), capRamp = 1 at the pole → 0 at a reach of 23 % / 36 % of the disc height (carried into the zones filter as the field group's alpha by a latitude mask), so the cap ends in an irregular terrain-driven coastline instead of a ruled line across the disc.
- **Lighting** follows §4.1 items 9–13: three shade recipes (atmosphere, airless, lava), lit-side haze + 1.077 r rim on atmosphere bodies, cast cloud shadows, glints on ocean worlds only. The library light is upper-right, L = (+0.7071, −0.7071); in a level L points at the scene's star (`canvas-notes.md` §4). Stars and compact objects are emissive.
- **No limb lines and no squash rings** on any v1.5 body.

### Rocky worlds

`ocean` uses the §2 `ocean.*` tokens. All six use the atmosphere shade (§4.1 item 9), except lava (emissive recipe).

| Token | Hex | Used for |
|---|---|---|
| `rocky.base` | `#D2803F` | Disc and strip fill (was `#C98B5A`) |
| `rocky.sand` | `#E8A85C` | Dune crests: du = fractalNoise `0.016 0.06`, 6 oct, seed 13, 30 du − 18 |
| `rocky.rust` | `#B04A22` | Iron plains: fractalNoise 0.05, 4 oct, seed 29, 18 ru − 10.08; also the asteroid rust |
| `rocky.dark` | `#6B3820` | Basalt maria (−50 n + 20.75, n = fractalNoise 0.032, 6 oct, seed 5) and crater floors (40 cr − 26.4 × 0.85, cr = fractalNoise 0.17, 1 oct, seed 31) |
| `rocky.pit` | `#4A2414` | Shadowed crater walls (pit − pit offset (−1, +1), × 0.75) |
| `rocky.highlight` | `#F7D8B0` | Pale plateaus (16 n − 10.56); lit crater walls (× 0.55) |
| `rocky.bloom` | `#FFF0DC` | Shade bloom α 0.20; also the double's companion bloom and the asteroid light |
| `rocky.atmo` | `#E8B07A` | Haze 0.96 (α 0.30); rim tail |
| `rocky.rim` | `#FFD9B0` | Haze edge (α 0.48), rim peak (α 0.75) — = `stars.warm` |
| `rocky.sandPale` | `#F0C47E` | Dune crests of the moon-system planet only (see "Open points") |
| `ice.base` | `#A8D6F7` | Disc and strip fill (was `#CFE6F5`) |
| `ice.glacier` | `#5E9BDB` | Blue lowlands, n = fractalNoise 0.034, 6 oct, seed 41: −40 n + 18.6 |
| `ice.melt` | `#3FC1DE` | Melt lakes in the glacier zone: m = fractalNoise 0.06, 4 oct, seed 47, 16 m − 9.12 |
| `ice.highlight` | `#FFFFFF` | Snowfields (30 n − 17.4); bloom α 0.22 |
| `ice.lineae` | `#4A8AD0` | Crack lines: v = \|2s − 1\|, s = fractalNoise 0.09, 1 oct, seed 43 (= turbulence 0.09), alpha −40 v + 1.8 (≈ 1 px, long Europa lines) |
| `ice.shadow` | `#2A4A70` | Crack cores: 0.55 × (1 − 70 v) (0 at v 0.0143; v1.5.1, was −40 v + 0.9 — junctions pooled into dark X blots) (was `#35567A`) |
| `ice.hazeEdge` | `#E6F6FF` | Haze edge α 0.62; lit crack edge (× 0.3) |
| `ice.cap` | `#F4F8FF` | Polar caps ≈ 30 %: solid to a ragged edge, 12 (capRamp + (n − 0.5) − 0.222), capRamp 1 → 0 over 36 % of H, mean edge 28 %, ±4 px (v1.5.1; was a 16.8 px band with a ruled 3.7 px fade) — = `ocean.ice` |
| `ice.atmo` | `#BFE3FF` | Rim peak α 0.95 (haze `#8FD0FF` = `haze.ocean`) |
| `lava.crust` | `#3A2622` | Disc and crust fill (was `#3A2A2A`) |
| `lava.crustLight` | `#664438` | Cooled plates: n = fractalNoise 0.04, 6 oct, seed 53, 18 n − 9 |
| `lava.shadow` | `#1E1414` | Basalt fields (−18 n + 7.2); the 0.705 shade stop (α 0.45) |
| `lava.ash` | `#8A6450` | Ash-dusted highlands (14 n − 8.68) |
| `lava.vein` | `#FF6A2A` | Main veins (v = \|2s − 1\|, s = fractalNoise 0.07, 1 oct, seed 59: −30 v + 1.9), fine glowing cracks along the plate edges (contour n = 0.5, half-width 0.013, × 0.6; v1.5.1, replaces turbulence 0.13 / seed 67), lava lakes in the basalt (m = fractalNoise 0.07, 4 oct, seed 61: 24 m − 16.32), pre-baked bloom (blur 0.8, × 0.5) — = `thrust.outer` |
| `lava.veinHot` | `#FFC857` | Vein cores (−50 v + 1.1) and lake centres (24 m − 17.28) — = `star.body` |
| `lava.atmo` | `#FF8C2E` | Halo r 1.4 r (0 α 0.20 · 0.714 α 0.20 · 0.78 α 0.10 · 0.88 α 0.035 · 1 α 0); haze 0.96 α 0.26 — = `star.corona` |
| `lava.rim` | `#FFB347` | Haze edge (α 0.42), rim peak (α 0.70) — = `sun.flame` |
| `lava.bloom` | `#FFD9B0` | Shade bloom α 0.26 — = `stars.warm` |
| `toxic.surface` | `#3F8A26` | Disc and strip fill |
| `toxic.lowland` | `#164A1E` | Lowlands α 0.9: n = fractalNoise 0.032, 6 oct, seed 29, slope −16 (0 at 0.47) |
| `toxic.acid` | `#C8DC3C` | Sulphur-lime pools α 0.85: d = fractalNoise 0.055, 3 oct, seed 31 > 0.56 (slope 14) **in** the uplands (n > 0.5) |
| `toxic.ridge` | `#5FA632` | Ridges α 0.6: n > 0.62, slope 12 |
| `toxic.deck` | `#BFD83C` | Lower cloud deck: fractalNoise `0.026 0.08`, 5 oct, seed 47, swirled (scale 10), field blur 0.2, 20 c − 9.93 (0.497 → 0.547), × 0.85, edge blur 0.2 |
| `toxic.cloud` | `#EEF7C2` | Upper deck: fractalNoise `0.03 0.085`, 6 oct, seed 37, swirled by fractalNoise 0.010 / 2 oct / seed 43 (scale 20), field blur 0.2 before the threshold (v1.5.1, was 0.6), 26 c − 14.27 (0.549 → 0.587, the reference's slope 26; was 22), edge blur 0.2; group α 0.92, ≈ 55 % total cover |
| `toxic.cloudShadow` | `#0B2410` | Upper-deck mask offset (−1.2, +1.2), blur 0.45 (the only softer copy, as the reference), × 0.45 |
| `toxic.highlight` | `#F4FFD6` | Shade bloom α 0.22 |
| `toxic.haze` / `.hazeEdge` | `#C7E97A` / `#E4F7B0` | Haze 0.96 α 0.40 / 1.00 α 0.62 |
| `toxic.rim` / `.rimOuter` | `#DDF59A` / `#A8D850` | Rim 0.928 α 0.95 / 0.955 α 0.40 |
| `cracked.crust` | `#44577F` | Disc and strip fill |
| `cracked.basin` | `#1E2742` | Basins α 0.85: n = fractalNoise 0.038, 6 oct, seed 41, slope −22 (0 at 0.45) |
| `cracked.plate` | `#5D72A2` | Plates α 0.55: d = fractalNoise 0.07, 3 oct, seed 53 > 0.56 (slope 18) |
| `cracked.frost` | `#A4B8DE` | Bright highlands α 0.55: n > 0.6 (slope 18) |
| `cracked.crackGlow` | `#FF8C2E` | Crack glow: the 0.5 iso-contour of k = fractalNoise 0.035, 4 oct, seed 61 (band 0.475–0.525), blur 0.9, × 1.2 — = `star.corona` |
| `cracked.crackLine` | `#FFC857` | Crack line (band 0.4875–0.5125, ≈ 1 px, × 0.95); fine branches (k2 = fractalNoise 0.075, 3 oct, seed 67, × 0.4, kept where k2.R > 0.52) — = `star.body` |
| `cracked.crackCore` | `#FFF1C2` | Hairline core (band 0.495–0.505, × 0.9) — = `sun.limbHot` |
| `cracked.highlight` | `#D2DEF6` | Shade bloom α 0.30 |
| `cracked.haze` / `.rim` | `#8FA3C9` / `#B8CAEE` | Haze 0.96 α 0.30 → edge `#B8CAEE` α 0.50; rim `#B8CAEE` α 0.95 → `#8FA3C9` α 0.40 |

| World | r · P · strip · period | Shade (bloom α · warm band α) | Haze / rim | Extras |
|---|---|---|---|---|
| rocky | 30 · 188 · 376 × 60 · 110 s | `#FFF0DC` 0.20 · 0.26 (dusty air) | 0.30 / 0.48 · rim 0.75 (≈ 0.7× the ocean's: thin air) | merge base, sand, rust, basalt, plateau, pits, dark wall, lit wall; no caps, no clouds |
| ocean | 34 · 214 · 428 × 68 · 90 / 64 s | `#E6F2FF` 0.38 · 0.24 | 0.42 / 0.65 · 0.95 | glint; caps 12 %; clouds + cast shadow (§2) |
| ice | 28 · 176 · 352 × 56 · 140 s | `#FFFFFF` 0.22 · 0.20 | 0.40 / 0.62 · 0.95 | ragged caps ≈ 30 %; lineae + narrow cores + lit edge; seamless strip (v1.5.1) |
| lava | 26 · 163 · 326 × 52 · 95 s | emissive recipe (§4.1) | 0.26 / 0.42 · 0.70 | seamless strips (v1.5.1); two locked strips: crust **below** the shade, emissive veins + lakes **above** it (glow on the night side), limb mask 0.80 r α 1 → r α 0.55, pulse 1 → 0.7 → 1 / 5 s; halo 1.4 r |
| toxic | 32 · 201 · 402 × 64 · 120 / 75 s | `#F4FFD6` 0.22 · 0.20 | 0.40 / 0.62 · 0.95 | two cloud decks + cast shadow; no caps |
| cracked | 27 · 170 · 340 × 54 · 100 s | `#D2DEF6` 0.30 · 0.14 | 0.30 / 0.50 · 0.95 | night cracks: the crack layers again at group α 0.6, masked along −L (0 at +0.5 r·L → 1 at −0.5 r·L); static glow, no pulse |

### Gas worlds

Both r 44, P 276, band groups of overdrawn rects (y −8 … 96) with one filter per group: wavy edges = fractalNoise `0.014 0.09`, 4 oct, contrast ×2, opaque map, displacement scale 9, blur 0.25 (crisp); zonal streaks = fractalNoise `0.008 0.32`, 3 oct, **tinted** light (> 0.61, slope 14, × 0.30) and dark (< 0.40, slope −14, × 0.32). Atmosphere shade with bloom α 0.20; haze 0.38 / 0.60; rim 0.95.

| Token | Hex | Used for |
|---|---|---|
| `gasBanded.cream` | `#F8DDB0` | Pale zones (bands 3, 7); storm eye α 0.45 |
| `gasBanded.tan` | `#EBA75E` | Base disc; bands 2, 5, 8 |
| `gasBanded.brown` | `#BE6830` | Belts: bands 1, 6, 9 |
| `gasBanded.dark` | `#7C3C1E` | The dark northern belt (band 4) |
| `gasBanded.storm` / `.stormRim` | `#E4512A` / `#8E3518` | Storm ellipse 6.16 × 3.52 at strip (98.6, 28.6) and (374.6, 28.6) in group B; collar 0.8 px α 0.7 |
| `gasBanded.streakLight` / `.streakDark` | `#FFF0D2` / `#6E331A` | Tinted zonal streaks; storm glint `#FFF0D2` α 0.6 |
| `gasBanded.highlight` | `#FFF3DE` | Shade bloom α 0.20 (warm band 0.24) |
| `gasBanded.haze` / `.hazeEdge` | `#F5D7B0` / `#FFE6C4` | Haze; `#F5D7B0` also the Saturn planet's haze |
| `gasBanded.rim` / `.rimOuter` | `#FFE3BC` / `#F2B877` | Rim |
| `gasRinged.light` | `#8FD9C9` | Base disc; bands |
| `gasRinged.mid` | `#58B0A3` | Bands |
| `gasRinged.cream` | `#DDF8F1` | Pale bands |
| `gasRinged.dark` | `#2A7A73` | Dark belt |
| `gasRinged.streakLight` / `.streakDark` | `#EFFFFA` / `#1F5F59` | Tinted streaks |
| `gasRinged.highlight` | `#E8FFFA` | Shade bloom α 0.20 (warm band 0.22) |
| `gasRinged.haze` / `.hazeEdge` | `#BFE8E0` / `#DDF7F1` | Haze |
| `gasRinged.rim` / `.rimOuter` | `#D3FBF2` / `#8EDCCC` | Rim |
| `gasRinged.ringBright` | `#F6EBCF` | B ring (1.45–1.60 r, α 0.62–0.86) |
| `gasRinged.ringMain` | `#D9C8A2` | A ring (1.65–1.95 r, α 0.56 → 0.36) |
| `gasRinged.ringDust` | `#A69A7E` | C ring, gaps and outer dust (α 0.03–0.30) |
| (`bg.base`) | `#050710` | Planet shadow on the back ring, α 0.85 |

| Giant | Band groups (strip y: 0 = N pole, 88 = S pole) | Drift |
|---|---|---|
| gasBanded | C (back): brown −8..9 · tan 9..54 · cream 54..69 · tan 69..79 · brown 79..96; B (middle): cream 18..31 (+ storm) · dark 31..46; A (front): tan 40..49 · brown 49..58. Wave seeds C/B/A 31 / 37 / 41, streak seeds 5 / 13 / 17 | C 0 → +276 / 180 s, B 0 → −276 / 110 s, A 0 → +276 / 150 s |
| gasRinged | A (back): mid −8..10 · light 10..54 · cream 54..69 · light 69..78 · mid 78..96; B (front): cream 19..29 · dark 29..37 · mid 51..59. Wave seeds 43 / 47, streak seeds 21 / 29 | A 0 → +276 / 160 s, B 0 → −276 / 120 s |

**The ring** (`gas-ringed.svg`, static): ring space `rotate(−22) scale(1 0.28)`, a circle r 2.2 r = 96.8 with a radial gradient of **hard-stepped** ringlets (two stops at each boundary): 1.350–1.400 r `ringDust` α 0.16 → 0.20 · 1.400–1.450 α 0.28 → 0.30 · 1.450–1.500 `ringBright` α 0.62 → 0.66 · 1.500–1.530 α 0.82 · 1.530–1.560 α 0.70 · 1.560–1.600 α 0.86 → 0.80 · gap 1.600–1.650 `ringDust` α 0.04 · 1.650–1.750 `ringMain` α 0.56 → 0.52 · 1.750–1.840 α 0.46 → 0.44 · Encke-like gap 1.840–1.855 `ringDust` α 0.06 · 1.855–1.950 `ringMain` α 0.42 → 0.36 · gap 1.950–2.000 α 0.03 · 2.000–2.200 `ringDust` α 0.22 → 0. Back ring through `#grBack` before the planet, front ring through `#grFront` (the lower half of the r 49.28 disc) after the planet, haze and rim. Planet shadow on the back ring: half-ellipse 117 × 44 rotated 230° in ring space, `bg.base` α 0.85, blur 0.5 × 1.5 in ring space, masked by the ring profile normalised to peak 0.86 so it darkens ring material only.

### Small bodies

Airless rule (moon, dwarf, double.small, and the v1.4 moons): hard terminator (§4.1 item 9, radius **1.25 r** — the v1.3 1.5 r is retired), no haze, no rim (icy and volcanic moons excepted), no clouds, no caps. Craters are hand-placed seeded geometry drawn at x and x + P: outer circle R in the crater-rim colour (α 0.7–0.75) + a bowl 0.82 R centred (+0.18 R, −0.18 R) toward the light, filled with a linear gradient pit α 0.95 (upper-right, the shadowed wall) → 0.55 α 0.75 → α 0.5 (lower-left, the lit wall). The v1.3 tables (moon 37 / `0x4D4F4F`, dwarf 8 / `0x445741`, double.small 9 / `0x534D4C`) are unchanged and listed in the headers.

| Token | Hex | Used for |
|---|---|---|
| `moon.base` | `#A6A2B6` | Disc and strip fill (lavender-tinted grey) |
| `moon.shelf` | `#7A7694` | Shelves α 0.5: n = fractalNoise 0.06, 6 oct, seed 7, slope −36 (0 at 0.50) |
| `moon.maria` | `#4B4866` | Maria α 0.9: n slope −40 (0 at 0.455) |
| `moon.highland` | `#DDD9EC` | Bright highlands α 0.5: h = fractalNoise 0.11, 4 oct, seed 11 > 0.58 (slope 28) in the uplands n > 0.49 |
| `moon.pit` | `#3C3955` | Specks α 0.6 (p = fractalNoise 0.30, 1 oct, seed 9 > 0.643, slope 30); crater bowls |
| `moon.craterRim` | `#EFECF8` | Crater rim walls α 0.75 |
| `moon.highlight` | `#F4F2FC` | Shade bloom α 0.24 |
| `dwarf.base` | `#CDA273` | Disc and strip fill (Pluto-like tholin) |
| `dwarf.shelf` | `#A8744C` | Shelves α 0.55: n = fractalNoise 0.09, 6 oct, seed 13, slope −36 (0 at 0.49) |
| `dwarf.dark` | `#6A402A` | Dark terrain α 0.85: slope −40 (0 at 0.445) |
| `dwarf.plains` | `#F6EBD6` | Nitrogen-ice plains α 0.9: h = fractalNoise 0.07, 3 oct, seed 19 > 0.56 in the uplands n > 0.47; crater rims α 0.7 |
| `dwarf.pit` | `#573522` | Specks α 0.5 (fractalNoise 0.28, 1 oct, seed 17); bowls |
| `dwarf.highlight` | `#FFF6E6` | Shade bloom α 0.18; also a Saturn ringlet tint |
| `double.big.ocean` | `#2F86E0` | Big world (r 18) disc and strip fill |
| `double.big.deep` | `#1B4FA8` | Deep water α 0.85: n = fractalNoise 0.05, 6 oct, seed 29, slope −18 (0 at 0.475) |
| `double.big.shallow` | `#4CC0E4` | Shallows ramp from n 0.535 (slope 10) |
| `double.big.ice` | `#EAF6FF` | Pack ice α 0.95: i = fractalNoise 0.05, 5 oct, seed 21 > 0.61 (slope 60) |
| `double.big.cap` | `#F2F8FF` | Polar caps 16 % (5.6 px), solid α 0.95, ragged edges (fractalNoise 0.09, 4 oct, seed 5 → displacement 6 → blur 0.2) |
| `double.big.haze` / `.hazeEdge` | `#9CCBFF` / `#CFE6FF` | Haze 0.42 / 0.65; `#9CCBFF` also the ice giant's haze |
| `double.big.rim` / `.rimOuter` | `#BFE3FF` / `#8CC4FF` | Rim (bloom `#E6F2FF` α 0.26 = `bloom.ocean`; glint `#FFFBEE` α 0.5, ellipse 3.4 × 1.9 at (5.73, −5.73)) |
| `double.small.base` | `#D08A4E` | Companion (r 11) disc and strip fill |
| `double.small.shelf` | `#B06A38` | Shelves α 0.5: n = fractalNoise 0.10, 6 oct, seed 31 |
| `double.small.dark` | `#6E3A1E` | Dark terrain α 0.85 |
| `double.small.bright` | `#F2C994` | Bright uplands α 0.7: h = fractalNoise 0.08, 3 oct, seed 37 > 0.565 |
| `double.small.pit` | `#5A2E16` | Specks α 0.5 (fractalNoise 0.30, 1 oct, seed 33); bowls |
| `double.small.craterRim` | `#F6D2A2` | Crater rims α 0.7 (bloom `rocky.bloom` α 0.24) |

**Double planet orbit** (unchanged since v1.3): period 40 s, clockwise on screen; masses ∝ r³, separation 38 → small orbits 30.94 × 11.14, big 7.06 × 2.54, opposite phase, ry = 0.36 rx; built as an epicycle of three SMIL rotates (`rotate(θ) translate(e₁) rotate(−2θ) translate(e₂) rotate(θ)`; small e₁ 21.04 / e₂ 9.9, big 4.8 / 2.26), small body drawn twice with discrete opacity toggles at θ 0 / 180° (front visible 0–20 s). Big strip P 113 / 80 s; small P 69 / 60 s.

### Stars

All three main-sequence stars are the sun reference (§2) scaled by k = r / 46 and recoloured, in this order: haze → wisp ring → flame ring (all three in the breathing group) → 3 two-tone prominences → flare → disc group (body + tinted plasma + limb, displaced by the edge wobble) → ragged rim.

| Token | Hex | Used for |
|---|---|---|
| `redDwarf.haze` | `#F0502A` | Haze 0 α 0.60 · 0.23 α 0.50; body gradient 0.65 |
| `redDwarf.hazeMid` | `#C8301C` | Haze 0.33 α 0.30 |
| `redDwarf.glow` | `#8C1E2A` | Haze 0.55 α 0.15 (v1.3 token, kept) |
| `redDwarf.hazeEdge` | `#4E0C16` | Haze 0.80 α 0.06 → 0 |
| `redDwarf.flameCore` | `#FFB27A` | Flame ring 0–0.74 α 0.92 |
| `redDwarf.flame` | `#FF6A3A` | Flame 0.82 α 0.78; wisp fill 0–0.62 α 0.50 |
| `redDwarf.corona` | `#E0432F` | Flame 0.91 α 0.36; wisp 0.80 α 0.22; prominence outer stroke 2.4 px α 0.85 (v1.3 token, kept) |
| `redDwarf.flameEdge` | `#B0281A` | Flame 1.00 α 0 (wisp edge `sun.hazeDeep #A8240E`) |
| `redDwarf.bodyCore` | `#FF8A4A` | Body 0.00 (replaces `redDwarf.body #FF7A4D`) |
| `redDwarf.bodyLimb` | `#D63A1E` | Body 1.00 |
| `redDwarf.plasmaDark` | `#4A0A06` | Larger darker cells: fractalNoise 0.032, 5 oct, seed 8, alpha 4 R − 1.6, × 0.55 |
| `redDwarf.filament` | `#FFB36B` | Filaments: turbulence 0.05, 5 oct, seed 13, alpha 1.25 − 6.5 R, × 0.8 |
| `redDwarf.limb` | `#FF9A6E` | Limb 0.80 α 0 → 0.93 α 0.55 |
| `redDwarf.core` | `#FFD9B0` | Limb 0.97 α 0.90; ragged rim 1.4 px α 0.75; prominence core 0.9 px α 0.90; flare tip α 0.15 (= `stars.warm`) |
| `redDwarf.limbHot` | `#FFEBDA` | Limb 1.00 α 0.95 |
| `blueGiant.haze` | `#5E9BFF` | Haze 0 α 0.55 · 0.23 α 0.48 |
| `blueGiant.hazeMid` | `#3A6AF0` | Haze 0.33 α 0.30; wisp edge |
| `blueGiant.glow` | `#2C4FBF` | Haze 0.55 α 0.14; flame 1.00 (v1.3 token, kept) |
| `blueGiant.hazeEdge` | `#15287A` | Haze 0.80 α 0.05 → 0 |
| `blueGiant.flameCore` | `#F4F8FF` | Flame 0–0.74 α 0.95; limb 0.97; rim 1.8 px; prominence core 1.15 px (= `ocean.ice`) |
| `blueGiant.flame` | `#A9C8FF` | Flame 0.80 α 0.85 |
| `blueGiant.flameEdge` | `#4F8DFF` | Flame 0.90 α 0.45; wisp 0.80 α 0.24 |
| `blueGiant.wisp` | `#7FB2FF` | Wisp fill 0–0.62 α 0.55 |
| `blueGiant.bodyCore` / `.body` / `.bodyLimb` | `#EAF1FF` / `#A6C0FF` / `#7FA3FF` | Body 0 / 0.65 / 1 |
| `blueGiant.plasmaDark` | `#2F5BD8` | Finer cells: fractalNoise 0.08, 5 oct, seed 6, alpha 3.4 R − 1.6, × 0.45 |
| (`#FFFFFF`) | `#FFFFFF` | Near-white filaments (turbulence 0.10, 5 oct, seed 15, × 0.9); limb 1.00; flare base |
| `blueGiant.limb` | `#CFE0FF` | Limb 0.80 α 0 → 0.93 α 0.55 |
| `blueGiant.corona` | `#5EA0FF` | Prominence outer stroke 3.2 px (v1.3 token, kept; = `ui.accent`) |
| `blueGiant.flareTip` | `#B8CCFF` | Flare tip α 0.15 (= `stars.cool`) |

| | Yellow sun | Red dwarf | Blue giant |
|---|---|---|---|
| r · k · viewBox · group | 46 · 1 · 400 · `#star` (200, 200) | 40 · 0.8696 · 360 · `#redDwarf` (180, 180) | 54 · 1.1739 · 480 · `#blueGiant` (240, 240) |
| haze r | 200 | 180 | **240** (the wider glow) |
| flame ring r · noise · displacement · spin | 62 (≈ 72 ragged) · 0.08 / 4 oct / seed 21 · 20 · +360° / 200 s | 53.9 · 0.08 / 4 / 25 · 14 (calmer) · 260 s | 72.8 · 0.10 / 5 / 27 · 24 · 200 s |
| wisp ring r · noise · displacement · spin | 78 (≈ 95 ragged) · 0.05 / 5 / 33 · 34 · −360° / 300 s | 67.8 · 0.05 / 5 / 37 · 24 · 390 s | 91.6 · 0.065 / 6 / 39 · 40 · 300 s |
| flame / wisp blur | 0.4 / 0.8 | 0.4 / 0.8 | 0.4 / 0.8 |
| edge wobble · rim | 0.11 / 3 oct / seed 44, scale 6.5 · r 46.2, 1.6 px, rag 0.22 / seed 57 / scale 5 | 0.11 / seed 46 / 5 · r 40.2, 1.4 px, rag 0.22 / 59 / 4.2 | 0.13 / seed 48 / 7 · r 54.2, 1.8 px, rag 0.26 / 61 / 5.5 |
| prominences (A°, path in `rotate(A) translate(r 0)`) | 147.5 / 243.6 / 314.8 (§2 table) | 338.8 `M-1.18 -10.13 C25.11 -8.1 25.11 8.1 -1.18 10.13` · 248 `M-0.68 -7.72 C26.06 -6.18 26.06 6.18 -0.68 7.72` · 167.2 `M-0.81 -8.4 C22.45 -6.72 22.45 6.72 -0.81 8.4` | 332.7 `M-1.06 -11.17 C26.44 -8.93 26.44 8.93 -1.06 11.17` · 243.5 `M-1.19 -11.81 C25.25 -9.45 25.25 9.45 -1.19 11.81` · 168.7 `M-1.64 -13.86 C31.21 -11.09 31.21 11.09 -1.64 13.86` |
| prominence strokes | `#FF8C2E` 2.8 + `#FFF1C2` 1.0 | `#E0432F` 2.4 + `#FFD9B0` 0.9 | `#5EA0FF` 3.2 + `#F4F8FF` 1.15 |
| flare (angle · wedge · gradient) | 25° · `M46 -1.8 L86 0 L46 1.8 Z` · `#FFFFFF` → `#FFD27A` α 0.15 | 117.9° · `M40 -1.55 L74.8 0 L40 1.55 Z` · `#FFFFFF` → `#FFD9B0` α 0.15 | 278.3° · `M54 -2.1 L101 0 L54 2.1 Z` · `#FFFFFF` → `#B8CCFF` α 0.15 |

Timings for all three: prominences 12 / 16 / 14 s, begin 0 / 5 / 9 s, scale 0.6 → 1 → 0.6 and opacity 0 → 1 → 0; flare 22 s cycle, peak 13.9 s; breathe ±3 % / 6 s on haze + flames + wisps only.

### Compact objects

Emissive, no terminator. Crisp: no blur above 0.5 except glow gradients.

| Token | Hex | Used for |
|---|---|---|
| `whiteDwarf.core` | `#FFFFFF` | Body 0–0.55; bloom r 22.4 (0 α 0.50 · 0.71 α 0.50 · 0.80 α 0.16 · 1 α 0); spike base α 0.55; inner limb r 14.6, 0.6 px, α 0.7 |
| `whiteDwarf.body` | `#E9EEF8` | Body 0.80 |
| `whiteDwarf.corona` | `#B8CCFF` | Corona r 36 (0 α 0.90 · 0.44 α 0.70 · 0.56 α 0.30 · 0.75 α 0.08 · 1 α 0, no blur); body 0.93; spikes mid α 0.25 → tip α 0 |
| `whiteDwarf.glow` | `#7FB8FF` | Glow r 96 (0 α 0.60 · 0.10 α 0.46 · 0.20 α 0.22 · 0.35 α 0.09 · 0.60 α 0.025 · 1 α 0), breathes ±5 % / 4 s; body 1.00; outer limb r 15.5, 1 px, α 0.9 |
| `neutronStar.core` | `#FFFFFF` | Body 0–0.50; core spikes α 0.55 |
| `neutronStar.body` | `#DCE4FF` | Body 0.80; limb r 7.5 1 px α 0.9; beam base α 0.38 (= `path`) |
| `neutronStar.beamMid` | `#C9A8FF` | Beam gradient 0.4 (α 0.20); body 0.93 — new (v1.5) |
| `neutronStar.glow` | `#B48CFF` | Glow r 40 (0 α 0.65 · 0.20 α 0.48 · 0.35 α 0.22 · 0.60 α 0.07 · 1 α 0); body 1.00; beam tip α 0; haze α 0.14 (blur 0.75); outer hairline r 8.3 0.6 px α 0.75 (= `result.lost`) |
| `blackHole.shadow` | `#000000` | Event-horizon disc r 22 |
| `blackHole.photon` | `#FFFFFF` | Photon ring core r 24, 1 px, α 0.95 |
| `blackHole.photonOuter` | `#FFC857` | Photon ring outer r 24, 2 px, α 0.6; disk ramp 0.68 (α 0.92); arc 26.4 (α 0.85) (= `star.body`) |
| `blackHole.photonSub` | `#FFF1C2` | Sub-ring r 22.9, 0.6 px, α 0.55 (= `sun.limbHot`) |
| `blackHole.diskHot` | `#FFF8E1` | Ramp 0.538 (inner edge, α 0.95) (= `star.core`) |
| `blackHole.diskFilament` | `#FFE7A0` | Ramp 0.6 (α 0.92); bright filaments; 5 bright stream arcs α 0.21–0.32; arc inner stop (α 0.95) (= `sun.filament`) |
| `blackHole.diskMid` | `#FF8C2E` | Ramp 0.78 (α 0.82); arc 27.5 (α 0.7); glow r 66 (0 α 0.22 · 0.35 α 0.08 · 0.60 α 0.03 · 1 α 0) |
| `blackHole.diskRed` | `#E8461A` | Ramp 0.87 (α 0.6); arc outer stop 28.6 (α 0.3) (= `sun.hazeRed`) |
| `blackHole.diskOuter` | `#B48CFF` | Ramp 0.94 (α 0.32) → 1.00 (α 0.12) |
| `blackHole.plasmaDark` | `#802105` | Dark plasma cells (fractalNoise 0.055, 5 oct, seed 12, 3.4 R − 1.5, × 0.42); 3 dark stream arcs α 0.24–0.32 (= `sun.plasmaDark`) |
| `blackHole.einstein` | `#7FB8FF` | Einstein ring r 46.5, 1 px, α 0.14 |

**White dwarf** (r 16): glow → corona → 4 tapered spikes (`M16 -0.8 L64 0 L16 0.8 Z` × 4, "+" orientation) → bloom → body → two-tone limb. No blur at all; the disc stays perfectly round.

**Neutron star** (r 8): static glow → magnetosphere group rotating 30° → 390° / 6 s (haze ellipse 20 × 4.8; two beam cones `(−3.2, −7) (3.2, −7) (7, −36) (−7, −36)` and mirror, blur 0.5; unblurred core spikes `M∓0.8 ±7 L0 ±34`) → body → limb + hairline.

**Black hole** (r 22, viewBox 320): glow → top lensed arc → back half of the disk → shadow → photon ring (in `#bhRag`: fractalNoise 0.25, 2 oct, seed 71, opaque → displacement 1.4 → blur 0.3, ±0.7 px wobble) → front half of the disk → bottom lensed arc → Einstein ring. Disk: ring 1.4–2.6 r (30.8–57.2) in a circular frame squashed `scale(1 0.2115)` (outer ellipse 57.2 × 12.1), the fiery ramp above with the plasma filter (`#bhPlasma`) and 8 dashed tangential stream circles (r 33.5 / 36 / 39.5 / 41 / 43 / 47 / 50.5 / 53.5, stroke 1.4–2.4), rotating 360° / 24 s clockwise; the squash turns the plasma into orbiting filaments. Doppler: static mask 1.0 (x −57.2) → 0.55 (x +57.2), left brighter. Lensed arcs: sectors 25.3–28.6, top 190° → 350° (group α 0.80), bottom 10° → 170° (α 0.55), vertical fade to 0 at y = 0, `#bhArcRag` displacement 1.4 + blur 0.5.

### Moons (v1.4)

Airless lighting (§4.1 item 9) on all four; the icy and volcanic moons add the faint lit-side rim the brief asks for (r 1.077 r, 0.90 α 0 · 0.928 peak · 0.955 · 1 α 0, lit mask 1 → 0.45 → 0.06). Thin lines are **iso-contours** of fractal noise (an `feFuncA` table peaked at a level with a set half-width) — Canvas bakes them as `|n − level| < w`.

| Token | Hex | Used for |
|---|---|---|
| `mi.base` | `#DCE4FF` | Icy moon disc and strip fill; shepherd moons |
| `mi.blueIce` | `#7FA6E0` | Blue ice: n = fractalNoise 0.11, 6 oct, seed 41 > 0.58 (slope 36), × 0.9 |
| `mi.highlight` | `#FFFFFF` | Frost (n < 0.40, slope −36); bloom α 0.28 |
| `mi.chaos` | `#C4987C` | Rust-tinted chaos terrain: the lineae field (fractalNoise 0.05, 4 oct, seed 53) > 0.67 (slope 30), × 0.78 — sits inside the 0.57 lineae (v1.5.1; was fractalNoise 0.06 / seed 43 > 0.63) |
| `mi.crack` | `#7FA6C9` | Crack halo: contour n = 0.5 (half-width 0.035) of fractalNoise 0.07, 5 oct, seed 47, × 0.7; shepherd-moon crater (= the retired v1.3 `ice.dark`) |
| `mi.crackDeep` | `#4E78A8` | Crack core: same contour, half-width 0.014, × 0.95; system moon A cracks |
| `mi.lineae` | `#A5684E` | Lineae: contours n = 0.44 and 0.57 (half-width 0.009) of fractalNoise 0.05, 4 oct, seed 53, × 0.85 |
| `mi.rim` | `#BFE3FF` | Rim peak α 0.75, then 0.30 |
| `mv.base` | `#E0C25A` | Volcanic moon disc and strip fill |
| `mv.frost` | `#F6EBA8` | SO₂ frost: n = fractalNoise 0.075, 6 oct, seed 61 > 0.58 (slope 30), × 0.85 |
| `mv.orange` | `#E0892E` | Red-orange sulphur: same field < 0.43, × 0.8 |
| `mv.dark` | `#8C6A2A` | Dark flows: fractalNoise 0.055, 6 oct, seed 67 > 0.60, × 0.9 |
| `mv.spot` | `#3A2A2A` | Lava fields (> 0.67, × 0.85), 1 px specks (fractalNoise 0.30, 2 oct, seed 71 > 0.68, × 0.75), vents r 1; also the wreck scorch |
| `mv.pole` | `#A0603A` | Polar bands 4 px, α 0.55 → 0 |
| `mv.plume` / `mv.plumeRing` | `#D9622B` / `#C9502A` | Plume deposits around 5 calderas (14, 9, R 3.4) (31, 21, 2.2) (43, 14, 2.8) (57, 20.5, 1.8) (68, 6.5, 2.4): 0 `#D9622B` α 0.15 · 0.55 α 0.22 · 0.8 `#C9502A` α 0.62 · 1 α 0 |
| `mv.hot` / `mv.hotCore` | `#FF6A2A` / `#FFC857` | Emissive hot spots r 1.5 above the shade: 0 `#FFC857` · 0.3 `#FF6A2A` α 0.95 · 1 α 0, pulsing 0.55 ↔ 1 / 6 s, begins 0 / −2 / −4 / −6 / −8 s |
| `mv.bloom` | `#FFF6D8` | Shade bloom α 0.30 |
| `mv.rim` | `#FFE08A` | Rim peak α 0.70, then 0.28 (= `thrust.core`) |
| `mc.base` | `#7E7468` | Captured moon albedo base (= `rock.base`) |
| `mc.warm` | `#A07E5A` | Warm regolith: fractalNoise 0.16, 6 oct, seed 83 > 0.56, × 0.85; system moon B |
| `mc.rust` | `#8A5A3C` | Iron-rich patches (ejecta field < 0.39), × 0.6 |
| `mc.dark` | `#3E3833` | Dark regolith (< 0.42, × 0.6), Phobos grooves (contours 0.46 / 0.56 of fractalNoise `0.035 0.2`, seed 97), specks, crater bowls (= `rock.dark`) |
| `mc.highlight` | `#C9BBA8` | Ejecta (fractalNoise 0.22, 6 oct, seed 89 > 0.62, × 0.7); crater rims; lit inner walls (= `rock.highlight`) |
| `mc.edge` | `#E6D8C4` | The 0.9 px lit edge facing the star, α 0.7 |
| `msB.bloom` | `#E8DCC8` | System moon B shade bloom α 0.3 |

| Moon | Geometry | Notes |
|---|---|---|
| Icy (`#moonIcy`, viewBox 48, r 12) | strip P 75, rect 150 × 24, 150 s, inner translate(−107 −12) | shade centre (3.05, −3.05), r 15, bloom `#FFFFFF` α 0.28; rim r 12.92 |
| Volcanic (`#moonVolcanic`, viewBox 48, r 13) | strip P 82, rect 164 × 26, 120 s, inner translate(−119 −13) | shade centre (3.31, −3.31), r 16.25; rim r 14; emissive hot-spot strip drawn after the shade with the same translate |
| Captured (`#moonCaptured`, viewBox 36, mean r 9) | 16 radii at 22.5° (raw 11.8 11 9.2 7.8 7.3 7.6 8.4 10.2 11.4 10.6 8.2 6.6 6.9 7.2 8 10.4, × 1.0108), closed Catmull-Rom spline; `#mcTumble` 0 → 360° / 70 s | albedo turns; 10 craters counter-rotate so their lit wall faces the star; lighting filter `#mcLight` on the fixed wrapper: lit mask = SourceAlpha offset (+2.6, −2.6) blurred 0.6; volume = offset (+1.6, −1.6) blurred 2.4, albedo × (0.6 + 0.45 V); warm band `#FF9455` α 0.2; night `#050B1E` α 0.97; lit edge `mc.edge` |
| System (`#moonSystem`, viewBox 360 × 260) | planet r 26 (rocky tokens, P 163, 110 s); moon A r 5 (icy, P 31, tidally locked 30 s), orbit 50 × 15, inclination −14°, start 60°; moon B r 7 (asteroid, P 44, 52 s), orbit 96 × 21.12, +8°, start 200° | epicycle orbits (A e₁ 32.5 / e₂ 17.5; B 58.56 / 37.44), front/back copies toggled at the ellipse ends; eclipse shadows (disc of the moon's r, offset (−3.5, +3.5), `#050B1E` 0.7 α 0.6 → 0) on the planet while a moon is in front; orbit lines 1 px `ui.text` α 0.08, dash 2 6; planet shade bloom `#FFF0DC` α 0.32 |

### Ringed planets (v1.4)

All three use the reference lighting scaled to their radius, and one ring-material group drawn twice: a **back pass** before the planet through a shadow mask (shadowed material keeps 15 %), a **front pass** after the planet clipped to the lower half of the planet disc in ring orientation. Shadows use the light the reference crescent implies: 54° from the view axis toward the upper-right, L = (0.572, −0.572, 0.588). The planet's shadow on the ring is a half-ellipse r / (n·L) × r in ring space; the ring's shadow on the planet is ray-traced bands in `night.deep`, clipped to the disc, under the terminator. "Tilt" here means the **opening angle** (ry = sin(tilt) · rx); the on-screen roll is given separately. Rings orbit prograde (near side left → right); rocks and moons ride a counter-rotation so their lit side stays upper-right.

| Token | Hex | Used for |
|---|---|---|
| `band.cream` / `band.tan` / `band.dull` | `#F2D9B8` / `#E3B07C` / `#C9A27A` | Saturn planet bands (brief tokens); `#F2D9B8` is also its base disc |
| `ringSaturn.gold` | `#D9954F` | Golden bands 22..27 and 60..64 |
| `ringSaturn.belt` | `#A86F3E` | Thin dark belts 18..21 and 66..69 (counter-flow group); dark streaks × 0.22 |
| `ringSaturn.ring` / `ringSaturn.ringPale` | `#F2E6D2` / `#D8C9AE` | B ring core and F ring (brief) / A ring outer (brief); `#F2E6D2` also the light streaks |
| `ringSaturn.ringB` / `.ringA` / `.ringC` | `#EAD7B4` / `#D9BF92` / `#B49A76` | B ring inner / A ring inner / C ring (warmer, so the ring reads ivory, not grey) |
| `ringSaturn.grainLight` / `.grainDark` | `#FFF6E6` / `#6E5A40` | 13 hard-edged ringlets over 1.49–2.07 r, α 0.06–0.14 / 0.10–0.22 |
| `ringSaturn.rim` | `#FFE9C8` | Haze edge α 0.5; rim peak α 0.95 (haze `#F5D7B0`; bloom `#FFF1C2` α 0.24) |
| `iceDebris.base` | `#CFE6F5` | Debris-ring planet base (the v1.3 ice palette) |
| `iceDebris.mid` | `#7FA6C9` | Mid plates (16 n − 7.68, × 0.55) |
| `iceDebris.deep` | `#4F84BF` | Deepest plates (16 n − 9.6) — new |
| `iceDebris.shadow` | `#35567A` | Crack cores (2.8 − 40 t, × 0.85) |
| `iceGiant.base` / `.dark` / `.bright` | `#7FB8FF` / `#5E9ED6` / `#DCEFFF` | Ice-giant bands (brief tokens); `#DCEFFF` also its haze edge and light streaks |
| `iceGiant.deep` | `#3D7FE0` | Main body colour and base disc — new |
| `iceGiant.belt` | `#2A5BB5` | Dark belts, polar hoods, storm oval, dark streaks — new |
| `iceGiant.storm` | `#1C3F8A` | Storm core — new |
| (`ui.text`) | `#ECF0FA` | Shepherd rings, 1 px α 0.7 |

| Ringed planet | Planet | Ring | Shadows |
|---|---|---|---|
| `ring-saturn` (viewBox 400 × 240, `#ringSaturn` at (200, 120)) | pale gas giant r 44, P 276; bands = a colour look-up table on a latitude field (one table entry per px → 1 px band edges, ±3 px turbulent borders): group A −8..7 `#C9A27A` · 7..13 `#E3B07C` · 13..22 `#F2D9B8` · 22..27 `#D9954F` · 27..33 `#E3B07C` · 33..55 `#F2D9B8` · 55..60 `#E3B07C` · 60..64 `#D9954F` · 64..71 `#F2D9B8` · 71..77 `#E3B07C` · 77..97 `#C9A27A`, 150 s; group B belts, 110 s counter-flow; waviness fractalNoise `0.008 0.045`, 5 oct, seeds 61 / 67, amplitude 0.12; streaks `0.006 0.16`, 4 oct, seed 71. Bloom α 0.24, haze 0.26 / 0.5 (lowered so the pale bands keep contrast) | opening 18° (ring space `rotate(−22) scale(1 0.31)`); 6 density strokes: C 1.37 r w 0.22 r `#B49A76` α 0.40 · B inner 1.53 / 0.10 `#EAD7B4` 0.68 · B core 1.65 / 0.14 `#F2E6D2` 0.86 · A inner 1.855 / 0.15 `#D9BF92` 0.66 · A outer 2.015 / 0.13 `#D8C9AE` 0.52 · F 2.16 / 0.012 `#F2E6D2` 0.60; Cassini 1.72–1.78 r, Encke 1.93–1.95 r; ringlet grain; 370 particles `#FFFFFF` r 0.4–0.75, α 0.3–0.6 in sub-rings 60 / 90 / 130 s (150 / 120 / 100 particles) | planet on ring: half-ellipse 91.1 × 44, rotated −148.3°, α 0.85, blur 0.8; ring on planet: 1.26–1.48 r α 0.25, 1.48–1.72 r α 0.62, 1.78–2.08 r α 0.45 |
| `ring-debris` (viewBox 320 × 200, `#ringDebris` at (160, 100)) | ice world r 24 (`iceDebris.*`), P 151, 120 s; plates fractalNoise 0.05, 6 oct, seed 41; cracks turbulence 0.05, 2 oct, seed 43 + lit wall hairline; natural-edge caps `#F4F8FF` ≈ 15 % (ramp + 1.1 × noise, slope 14). Bloom `#E6F2FF` 0.28, haze `#BFE3FF` → `#E6F2FF` 0.34 / 0.55, rim `#A8DBFF` / `#7FC4FF` | opening 25° (`rotate(−32) scale(1 0.42)`); dust band `#C9BBA8` 1.45 r 0 · 1.6 0.10 · 1.75 0.14 · 1.9 0.10 · 2.05 0; 108 rock polygons (7–10 vertices, r 0.8–2.2) in 21 clumps — inner 1.60–1.75 r, 45 s, 11 clumps; outer 1.75–1.90 r, 70 s, 10 clumps — + 70 dust specks per sub-ring; rock shading one gradient 0 `#C9BBA8` · 0.42 `#7E7468` · 0.56 `#7E7468` ‖ `#3E3833` | planet on ring: 58.2 × 24, −149.9°, blur 0.6; ring on planet: 1.6–1.9 r α 0.28 + dust 1.5–2.0 r α 0.10 |
| `ring-shepherd` (viewBox 320 × 200, `#ringShepherd` at (160, 100)) | ice giant r 26, P 163; look-up-table bands −8..5 `#2A5BB5` · 5..9 `#3D7FE0` · 9..11 `#7FB8FF` · 11..18 `#3D7FE0` · 18..20 `#2A5BB5` · 20..24 `#5E9ED6` · 24..28 `#7FB8FF` · 28..32 `#5E9ED6` · 32..34 `#2A5BB5` · 34..41 `#3D7FE0` · 41..43 `#7FB8FF` · 43..47 `#3D7FE0` · 47..61 `#2A5BB5`, 110 s (seed 81, amplitude 0.10; streaks seed 83); storm oval + core + white streak; cirrus clouds fractalNoise `0.035 0.16`, 6 oct, seed 87, threshold 0.66 (≈ 8 %), α 0.85, over a cloud shadow (0.8, 0.8) α 0.4, 80 s. Bloom 0.18, haze `#9CCBFF` → `#DCEFFF` 0.30 / 0.5 | opening 15° (`rotate(−24) scale(1 0.26)`); two 1 px rings `#ECF0FA` α 0.7 as screen-space ellipses r 45.5 (1.75 r) and 57.2 (2.2 r); shepherd moons r 2.5 (`#DCE4FF`, crater `#7FA6C9`, hard terminator) at r 54 / 36 s / start 35° and r 60.4 / 40 s / start 205° | planet on rings: 60.1 × 26, −146.9°, blur 0.6; ring on planet: two hairlines α 0.55 |

### WP8 additions (v2): binary star, red giant, moon chain

Built for WP8 (stellar variety) from approved constructions, so they match the reference look without new techniques. The game is top-down: orbits are coplanar circles about a fixed centre or a parent body (`orbit { cx, cy | centerId, radius, phase, omega }`), so these assets move bodies with `animateMotion` (no rotation; lit sides keep facing the star). How to build them in the game: `threejs-notes.md` §4 and §6.

**Binary star** (`bodies/binary-star.svg`, ids `bnA*` primary, `bnB*` secondary, `bn*` shared). Two copies of the sun reference (§2) scaled by r / 46. Masses 1.8 : 1, separation 120, so the primary circles at a1 = 42.9 and the secondary at a2 = 77.1 (a1·m1 = a2·m2), opposite phases, one shared period of 40 s. Crash radii 30 / 20.

| Token | Hex | Used for |
|---|---|---|
| `binary.hot.core` | `#FFE7A0` | Primary body gradient 0 (F-type, yellow-white) |
| `binary.hot.body` | `#FFC24A` | Primary body 0.65 |
| `binary.hot.edge` | `#FF9A2A` | Primary body 1.0 |
| `binary.hot.filament` | `#FFFDF0` | Primary plasma filaments |
| `binary.hot.plasma` | `#A0460E` | Primary dark plasma (alpha ≤ 0.55) |
| `binary.hot.flame` | `#FFF6D6` / `#FFD27A` / `#FFA040` | Primary flame ring stops 0–0.74 / 0.82 / 0.91 |
| `binary.hot.haze` | `#FFB45A` → `#FF8C3A` → `#C2541A` → `#7A2A0E` | Primary haze stops 0 / 0.33 / 0.55 / 0.80 |
| `binary.cool.core` | `#FF9A3A` | Secondary body gradient 0 (K-type, orange) |
| `binary.cool.body` | `#FF7426` | Secondary body 0.65 |
| `binary.cool.edge` | `#E85A1A` | Secondary body 1.0 |
| `binary.cool.filament` | `#FFC27A` | Secondary plasma filaments |
| `binary.cool.plasma` | `#6A1606` | Secondary dark plasma |
| `binary.cool.flame` | `#FFC890` / `#FF9A4A` / `#E8501A` / `#C8401A` | Secondary flame ring stops 0–0.74 / 0.82 / 0.91 / 1.0 |
| `binary.cool.wispEdge` | `#B83414` | Secondary wisp ring outer stop |
| `binary.cool.limb` | `#FFB27A` / `#FFD8B0` | Secondary limb and rim stroke |
| `binary.cool.haze` | `#FF6A2A` → `#D8401A` → `#98200C` → `#5A1006` | Secondary haze stops |

**Red giant** (`bodies/red-giant.svg`, ids `rg*`). The sun reference scaled to r 120 (k 2.6087) and recoloured deep red-orange. Convection cells about twice the sun's relative size (dark plasma 0.026, filaments 0.032, against the sun's 0.05 / 0.06), gentler filaments (alpha slope 0.62), diffuse flames (opacity 0.55, wisps 0.7), a softer rim (limb 0.35 / 0.55 / 0.6, stroke 1.2 at 0.5), rim wobble 4.5, breathe ±3 % over 9 s. Crash radius 120.

| Token | Hex | Used for |
|---|---|---|
| `redGiant.core` / `.body` / `.edge` | `#FF8A42` / `#F0602C` / `#C8401E` | Body gradient 0 / 0.65 / 1.0 |
| `redGiant.filament` | `#FFB27A` | Plasma filaments |
| `redGiant.plasma` | `#5A1406` | Dark plasma (alpha ≤ 0.55) |
| `redGiant.flame` | `#FFB27A` / `#FF8A4A` / `#D8461E` / `#A8301A` | Flame and wisp rings |
| `redGiant.limb` | `#FF9A62` / `#FFC8A0` / `#FFE0C8` | Limb gradient and rim stroke |
| `redGiant.haze` | `#FF6A3A` → `#C83C1E` → `#8A1E10` → `#4A0E08` | Haze to r 292 px |
| `redGiant.atmo` | `#FF8A4A` / `#FF7A3A` | **Drag atmosphere** to 1.6 r: `#FF8A4A` α 0.30 at the photosphere → 0.16 at 0.85, then `#FF7A3A` α 0.08 at 0.985 → 0; breathes ±2 % over 10 s |
| `redGiant.atmoEdge` | `#FFB07A` | Drag boundary ring at 1.6 r: 1.2 px, α 0.30, dash 10 6, crawling −8 px/s, so players can read where drag starts |

**Gas giant with a resonant moon chain** (`bodies/moon-chain.svg`, ids `mk*`). The banded gas giant (r 44) unchanged, with four library moons scaled down: volcanic r 6.5, icy r 6, barren r 7, dwarf r 4.5. Their orbits are in a 1:2:3:4 mean-motion resonance (neighbours 2:1, 3:2, 4:3), radii from Kepler's third law a_n = 68 n^(2/3) = 68 / 107.9 / 141.4 / 171.3, preview periods 18 / 36 / 54 / 72 s, start phases 0 / 95 / 205 / 300°. No new colours: each moon keeps its library tokens. Orbit guides `#ECF0FA` α 0.07, dash 2 6, preview only.

### WP9 additions (v2.1): pulsar, magnetar, magnetism map

Built for WP9 (compact objects plus magnetism layer) to the v1.5 rules: crisp bodies, emissive, no terminator, no blur above 0.5 except glow gradients. The quiet `neutron-star.svg` stays as it is (violet, short faint cones); the two new objects are kept apart by hue so players never mix them up: **cyan = pulsar (beams hurt)**, **magenta = magnetar (field scrambles)**, violet = quiet neutron star.

**Pulsar** (`bodies/pulsar.svg`, ids `pu*`, r 8, crash radius 8). A cyan-white body with two long, narrow lighthouse beams to r 228 (28.5 r) that sweep clockwise 360° per 4 s, so every point within reach is crossed every 2.0 s. Each beam trails an afterglow fan (8 sectors × 5°, α 0.22 · (1 − k/8)^1.6, radial fade) so the turning direction reads at a glance. In the game the reach and period are level data; the visual turns at the same angular speed, so what the player sees is what hurts.

| Token | Hex | Used for |
|---|---|---|
| `pulsar.core` | `#FFFFFF` | Body 0–0.5; beam base α 0.85; 1 px core line α 0.9 → 0 at 70 % |
| `pulsar.body` | `#DCF6FF` | Body 0.8 |
| `pulsar.beam` | `#7FDBFF` | Beam 30 % (α 0.40) → tip α 0; afterglow sectors; body 0.93 |
| `pulsar.glow` | `#4FC3F7` | Glow gradient around the body; body 1.0 |
| `pulsar.limb` | `#A8ECFF` | Hard thin limb |

**Magnetar** (`bodies/magnetar.svg`, ids `mg*`, r 9, crash radius 9). A white-pink body in a magenta-violet glow with its dipole field drawn as six glowing field lines `r = L sin²θ` (L = 20, 30, 44, 62, 86, 116; axis tilted 20° clockwise from vertical). The lines are static, the same dipole the magnetism map shows; white energy dashes flow pole to pole along them and each line flickers unevenly (1.7–3.4 s). A sparse pink grain from r 24 to r 120 reads as radio static (instruments scrambled). Every 18 s a starquake ring runs from the surface to r 150 in 1.2 s and the body flashes.

| Token | Hex | Used for |
|---|---|---|
| `magnetar.core` | `#FFFFFF` | Body 0–0.5; flowing field dashes; starquake ring start |
| `magnetar.body` | `#FFE0FA` | Body 0.8 |
| `magnetar.limb` | `#FF7AE6` | Limb; body 1.0; starquake ring end |
| `magnetar.field` | `#FF7AE6` / `#C77DFF` | Inner field lines (L 20–44) / outer (L 62–116); α 0.75 → 0.25, width 1.5 → 0.8 px |
| `magnetar.glow` | `#D946EF` | Glow and pole glows |
| `magnetar.interference` | `#FF9BEF` | Static grain (colour matrix of the noise, about 3 % cover, layer α 0.26) |

**Magnetism map** (`overlays/magnetism-heatmap.svg`, one body's overlay; mockup `mockups/magnetism-map.svg`). The danger heatmap from WP9: shown with the **M key** or the **Magnetism** button, independent of the gravity map (G), in planning and pause only. Draw order: gravity grid → magnetism map → bodies → predicted path → ship → HUD.

- **Field model.** One magnetic dipole per magnetic body, `|B| = k · √(1 + 3 cos²θ) / r³` (θ from the magnetic axis); fields add as vectors. The map draws contours of |B|, so each zone is an oval 1.26× (2^(1/3)) longer along the axis than across it.
- **Zones are stepped, never a blur.** Each zone is a flat tint between two contours with a crisp edge line. Thresholds are multiples of B1, the edge of the outermost zone; a zone reaches R1 · (B / B1)^(−1/3) along the axis.
- **Per body (design defaults; tune in level data).** Magnetar R1 210 (all four zones). Pulsar R1 80, rotation-averaged, so its zones are circles. Quiet neutron star R1 60. Gas giants R1 120 at a 10° tilt; their Lethal ring sits under the disc, so gas giants are never lethal. Rocky planets, stars, white dwarfs and black holes have no field.

| Zone | B / B1 | Reach (axis) | Token | Hex | Fill α | Edge |
|---|---|---|---|---|---|---|
| Safe | < 1 | — | — | — | none | — |
| Fuzzy | ≥ 1 | 1.000 R1 | `magmap.fuzzy` | `#7C5CFF` | 0.10 | 1 px α 0.60, dash 6 5, crawling 11 px/s |
| Scrambled | ≥ 2.5 | 0.737 R1 | `magmap.scrambled` | `#B14DFF` | 0.15 | 1 px α 0.70 |
| Damaging | ≥ 6 | 0.550 R1 | `magmap.damaging` | `#E541C9` | 0.22 | 1 px α 0.80 |
| Lethal | ≥ 15 | 0.405 R1 | `magmap.lethal` | `#FF3D7F` | 0.32 | 1.25 px, α 0.90 → 0.55 → 0.90 over 2.4 s |

The ramp is violet → magenta → hot pink, kept clear of the gravity map's blue → mint → amber → orange so both can be on at once.

**Fuzzy prediction (the same field).** Walking the predicted path in 10 px steps, the spread grows by σ += 6 px · log2(B / B1) per 100 px inside the Fuzzy zone (summed field) and never shrinks after leaving. While σ < 0.6 px the path is the normal dotted line. After that the centre dots fade (α 0.7 − σ / 40, floor 0.18), an envelope ±σ appears (`path` `#DCE4FF` fill α 0.06, dashed edges 2 4 at α 0.35), and two sets of ghost dots scatter inside it, swapping every 0.3 s like instrument flicker. The end ring grows to r 6 + σ. The telemetry line adds `path spread ±N px`. The Sensors upgrade can lower the 6 px factor.

| Token | Hex | Used for |
|---|---|---|
| `path.ghost` | `#E9DCFF` | Ghost dots r 1.1, α 0.45 / 0.10 alternating |

**HUD.** The map toggles sit at (40, 124): "Gravity off" (the game's panel button) and "Magnetism" (pressed: `accent` fill, `ink` text), 96 / 100 × 32, radius 10, 8 px apart. While M is on, a legend panel sits under them at (40, 172): label "MAGNETIC FIELD", the key hint "M", five 54 × 10 swatches (Safe outline only; zones at fill α 2.6 × zone fill + 0.2 with the zone edge on top) and 10 px labels Safe · Fuzzy · Scrambled · Damaging · Lethal.

### WP10 additions (v2.2): comet, solar recharge indicator

**Comet** (`bodies/comet.svg`, ids `cm*`, nucleus crash radius 5). Realistic anatomy, drawn crisp: a dark peanut-shaped nucleus lit from the star, a bright core, a **green coma** (real comae glow green from C2 gas), a straight **blue ion tail** pointing exactly away from the star, and a wider **golden dust tail** of fine strands curving behind the comet's motion. Solar-wind streaks flow out along the ion tail, a brighter "disconnection" knot drifts down it every 9 s, and a few sparkles drift along the dust strands.

- **Orientation.** The asset is drawn with the star to the left. The game rotates the whole group so its +x axis points away from the star. The lighting turns with it (lit side and jets always toward the star), so this is the one body that rotates as a whole.
- **Tail length.** The tails scale by `s = clamp(Rperi / d, 0.35, 1)` along the tail (and `0.6 + 0.4 s` across it), so they are longest at perihelion. The head never scales.
- **Dust side.** The dust tail curves to the asset's +y. Mirror the group's y when the comet circles the star the other way, so the dust always lags the motion.
- **Harvest ring.** A dashed ring at r 30 marks the coma, where ice can be harvested (planning and pause only).
- **Orbit.** Comets need eccentric orbits, which the level format does not have yet (orbits are circles). Suggested shape: `orbit { kind: "ellipse", centerId, a, e, periapsisAngle, phase }`, Kepler-timed so the comet speeds up near the star.

| Token | Hex | Used for |
|---|---|---|
| `comet.nucleus` | `#F0E2CC` → `#A88466` → `#4A362A` → `#2A1E18` | Nucleus, lit from the star; sunward rim `#FFF1DC` 0.6 px α 0.85 |
| `comet.core` | `#FFFFFF` / `#F2FFFA` / `#C8FFE9` | Core r 11 (1 · 0.85 · 0.25 · 0) |
| `comet.coma` | `#E6FFF4` / `#9DF7D6` / `#5CEDBA` / `#3FD6A8` | Coma rx 50 ry 42 (α 0.85 · 0.60 · 0.30 · 0.10 · 0.03 · 0), breathes ×1.04 / 5 s |
| `comet.jet` | `#E6FFF4` → `#7CF5C8` | Two sunward jets (α 0.75 → 0) |
| `comet.harvest` | `#7CF5C8` | Ice-harvest ring r 30, 1 px α 0.45, dash 4 4 crawling 8 px/s |
| `comet.ion` | `#E6FAFF` / `#7FD8FF` / `#3D9BFF` / `#2E62FF` | 7 ion rays (α 0.95 · 0.75 · 0.35 · 0 along the tail); base wedge `#8FE0FF` α 0.45 → 0 |
| `comet.ionFlow` | `#F2FCFF` / `#BFEFFF` | Solar-wind dashes (α 0.6 → 0 by 80 %) |
| `comet.ionKnot` | `#BFEFFF` → `#5EC8FF` | Disconnection knot 24 × 10, every 9 s |
| `comet.dust` | `#FFFBF0` / `#FFEBC0` / `#FFD890` / `#FFC266` | 24 dust strands (α 1 · 0.8 · 0.38 · 0.08 · 0); base fill `#FFF1D0` / `#FFE0A0` / `#FFCC7A` (α 0.50 · 0.24 · 0.07, gone by 74 %) |
| `comet.sparkle` | `#FFF4D6` | Dust sparkles r 0.9–1.1 |

The dust stops stay pale gold to cream: at low alpha, deeper oranges read brown over navy.

**Solar recharge indicator** (`solar-recharge.svg`, ids `rc*`; mockup `mockups/comet-recharge.svg`). The design for recharge near stars, which the roadmap builds in the ship systems package. The rate model is `rate = rateMax · L · min(1, (Rref / d)²)` with Rref 85 world px for the yellow sun and L the star's luminance (red dwarf 0.4, blue giant 2.5, red giant 1.5, white dwarf 0.2, compact objects and black holes 0). Below 8 % of `rateMax` the panels count as off. The Solar panels upgrade raises `rateMax`.

- **Predicted path.** Dots where the panels would charge turn solid gold and grow: colour `mix(#DCE4FF, #FFD86E, min(1, √(1.6 t)))`, radius `1.5 + 1.3 · min(1, 1.4 t)`, α 1, with t = rate / rateMax. No band or glow under them, because low-alpha gold over navy turns olive-grey. The total gain sits next to the end ring ("+5 % fuel").
- **Fuel block, flight.** A sun glyph at (label x + 44, baseline − 4): an empty `ui.textDim` ring when off; when charging, a `#FFD27A` disc with 8 rays, a 40 px white-gold shimmer sweeping the fill every 1.8 s, a 3 px pulsing sliver past the fill, and the rate ("+0.4 %/s") under the bar. On a close pass the rays lengthen and turn, and the shimmer speeds up to 0.9 s.
- **Fuel block, planning.** Glyph lit but still; a ghost segment shows the fuel this plan ends with, and "+5 % on this path" sits under the bar.
- **Ship, flight.** A gold ring pulses out from the ship every 1.2 s while charging.

| Token | Hex | Used for |
|---|---|---|
| `solar.glyph` | `#FFD27A` | Sun glyph disc and rays (= `sun.limb`) |
| `solar.charge` | `#FFE08A` | Rate text, gain labels, sliver, planning ghost (α 0.9), ship pulse (= `thrust.core`) |
| `solar.shimmer` | `#FFF6D6` | Fuel-bar shimmer (α 0 → 0.85 → 0) |
| `solar.path` | `#FFD86E` | Gold end of the path-dot ramp |

Recharge never uses `fuel.low #FFC857`, so a low, gold fuel bar still reads clearly as charging.

### Deviations and open points (recorded in the asset headers)

- **Kept from v1.3:** craters are seeded geometry; the black hole's Doppler side is the left (with a clockwise disk "left approaching" cannot strictly hold; kept for the read); the black hole's squash is 0.2115 (ry / rx); the blue giant keeps the v1.3 loop angles.
- **v1.5 numbers beyond the references:** the airless shade radius is 1.25 r (v1.3's 1.5 r retired); the double planet's caps shrank 22 % → 16 % (solid caps read larger) and it gained a glint (ocean world); the Saturn ring is brighter than briefed (α to 0.86, three warmer ring colours — at the briefed 0.25–0.6 it read grey on navy) and its particles are r 0.4–0.75 (not 0.9); the ring rolls (−22° / −32° / −24°) were chosen so the shadows are visible with the upper-right light; the asteroid field has 88 rocks (62 / 20 / 6, inside the briefed 60–90 total); the emission nebula's α ≤ 0.22 holds per colour layer and only its ≈ 1 px ionisation fronts reach α 0.5, and only near the embedded stars.
- **Open for the owners (not decided here):**
  1. Planet X keeps its lower-left light toward the star (the retune brief said upper-right; that would light X from the side away from the star in every mockup).
  2. ~~Cloud-shadow direction~~ — resolved in v1.5.1: `planet-start.svg` and `bodies/ocean.svg` now offset the cloud shadow (−0.85, +0.85), down-left away from the upper-right light, like planet X, toxic and ring-shepherd (the reference's (+1.2, +1.2) pointed down-right).
  3. `moon-system.svg`'s planet uses `rocky.sandPale #F0C47E` at slope 30 / −16.5, an earlier rocky tuning; `rocky.svg` now uses `rocky.sand #E8A85C`. Align the system planet with rocky or keep the paler sand as a deliberate variant.
  4. ~~Header drift~~ — resolved in v1.5.1: the `moon-icy.svg` and `nebula-emission.svg` headers now describe their markup (values above and in §9).

## 9. Space environment (v1.4)

Nebulae and debris give a level a place, not a mechanic. They are built to the same rules as the bodies (§4.1: crisp where solid, soft only where they are gas, every texture tinted, lighting from the upper-right for library art, cached, calm) and live in `design/assets/space/`. Each file is `<defs>` with prefixed ids + one top-level group translated to its centre, SMIL inside, header comment with every parameter. Canvas: `canvas-notes.md` §2b (nebulae) and §4e (debris fields).

### Files

| Key | Name | File · group · ids | viewBox | What it is |
|---|---|---|---|---|
| `nebulaEmission` | Emission nebula | `nebula-emission.svg` · `#nebulaEmission` at (320, 200) · `ne*` | 640 × 400 | Glowing hydrogen gas: violet outer gas, a rose H-alpha core, faint broken ionisation fronts where the young stars light the gas, dark dust lanes, 8 young stars |
| `nebulaReflection` | Reflection nebula | `nebula-reflection.svg` · `#nebulaReflection` at (320, 200) · `nr*` | 640 × 400 | Cool blue dust lit by a bright star at the left third, feathery streaks radiating from it, crisp filament edges |
| `nebulaDark` | Dark cloud | `nebula-dark.svg` · `#nebulaDark` at (240, 160) · `nd*` | 480 × 320 | Black dust that blocks the stars behind it, a crisp warm rim on the lit side, a soft wispy tail on the other |
| `asteroidField` | Asteroid field | `asteroid-field.svg` · `#asteroidField` at (360, 180) · `af*` | 720 × 360 | A diagonal belt of 88 tumbling rocks in three sizes, crisp lit rims, warm terminators, dust haze |
| `wreckDebris` | Wreck debris | `wreck-debris.svg` · `#wreckDebris` at (200, 130) · `wr*` | 400 × 260 | 20 tumbling metal fragments (hull panel, solar panel, truss, pipe, shards, flakes) with bevelled edges and twinkling glints |

### Tokens

| Token | Hex | Used for | Note |
|---|---|---|---|
| `neb.emission.edge` | `#B48CFF` | Emission outer gas: α = 0.16 · smoothstep(0.00, 0.40, d) | = `result.lost` hex |
| `neb.emission.core` | `#E0566F` | H-alpha core: α = 0.22 · smoothstep(0.28, 0.65, d); the soft fill under the fronts | New |
| `neb.emission.rim` | `#FF9DB0` | Ionisation fronts, α 0.5 on a ≈ 1–2 px band just inside the gas edge (D = smoothstep(0.24, 0.27, d), D out blur(D, 2.2), broken by noise), masked to pools of light around the stars at (−150, −22) r 150, (42, −38) r 170, (168, −82) r 80 over an α 0.12 floor (v1.5.1; was α 0.75 on every blob outline) | New |
| `neb.lane` | `#050710` | Dust lanes × 0.35 | = `bg.base` |
| `neb.reflection.dust` | `#5EA0FF` | Reflection dust: α = 0.16 · smoothstep(0.03, 0.45, d) | = `ui.accent` hex |
| `neb.reflection.lit` | `#B8CCFF` | Star-lit dense filaments: α = 0.14 · smoothstep(0.40, 0.75, d); the bright star's halo; embedded stars | = `stars.cool` |
| `neb.reflection.edge` | `#DCE4FF` | Crisp filament edges α 0.35 | = `path` hex |
| `neb.dark.dust` | `#000000` | Dark-cloud body α ≤ 0.85; its tail α 0.55 | = `bg.edge` |
| `neb.dark.rim` | `#FFD9B0` | Lit rim α 0.25; inner scattered glow α 0.07 | = `stars.warm` |
| (stars) | `#FFFFFF` / `#B8CCFF` / `#E9EEF8` | Embedded young stars, halos, diffraction spikes | `stars.*` hexes |
| `rock.base` | `#7E7468` | Asteroid faces (dust flat; textures A/B/C base); captured moon; debris-ring rocks | Warm stone, never neutral grey |
| `rock.dark` | `#3E3833` | Mottle (× 0.50 / 0.60 / 0.72 in textures A / B / C), crater bowls, the hard terminator stop (α 0.80) | |
| `rock.highlight` | `#C9BBA8` | Lit rim sliver, crater lit walls, specks (× 0.65), debris-ring dust | |
| `rock.rust` | `#B04A22` | Iron patches × 0.70 / 0.40 / 0.16 | = `rocky.rust` |
| `rock.ochre` | `#D8B26E` | Pale dusty highs × 0.42 | = `ocean.desert` |
| `rock.bloom` | `#FFF0DC` | Sunward limb light α 0.34 → 0.08 | = `rocky.bloom` |
| `rock.haze` | `#AAB8DD` | Belt dust haze α ≤ 0.05 | = `milkyway.dust` |
| `metal.base` | `#8B95B5` | Light brushed-metal face; streaks on dark metal (× 0.38) | Same hex as `ui.textMuted`; its own name here |
| `metal.dark` | `#4B5470` | Dark metal face; dark streaks on light metal (× 0.40) | Same hex as `ui.textDim` |
| `metal.highlight` | `#ECF0FA` | Lit bevel, light streaks (× 0.30), seam lips α 0.35, the broad light α 0.34 | Same hex as `ui.text` |
| `metal.edge` | `#2A3245` | Shadow bevel, seams, rivets, streaks on dark metal (× 0.45), hazard hatching | The retired `cracked.dark` hex |
| `metal.hazard` | `#FFC857` | Hazard stripe | = `star.body` / `fuel.low` |
| `metal.scorch` | `#3A2A2A` | Scorch and burn gradients | = `mv.spot` |
| `metal.puncture` | `#050710` | Puncture holes | = `bg.base` |
| `metal.solar` | `#5EA0FF` → `#142B5E` → `#0A0D1A` | Solar-cell gradient | `ui.accent` → the retired `planet.start.shadow` hex → `ship.outline` |
| `metal.glint` | `#FFFFFF` | 7 glints, α 0.2 ↔ 0.6 over 3.1–6.4 s | |
| (lighting) | `#FF9455` / `#050B1E` | Rock warm band and night; metal night | `terminator.warm` / `night.deep` |

### Construction

**Emission nebula.** A mask of 4 noise-displaced ellipses (scale 60, smoothed 1): (cx cy rx ry rot) (−95 −5 200 135 −12) · (75 25 175 120 18) · (150 −70 120 85 0) · (−175 65 125 80 0). Density n = 0.6 · big + 0.4 · fine (big fractalNoise 0.006, 4 oct, seed 5, shared; fine 0.012, 4 oct, seed 11 in layer A / 17 in layer B), d = clamp(2.2 n − 0.75) × mask. Each layer draws violet and rose at the alphas above. **Rims:** D = smoothstep(0.235, 0.27, d) anti-aliased by blur 0.5, rim = D out blur(D, 2.2), broken into segments by fractalNoise 0.02 / 3 oct / seed 3, `#FF9DB0` α 0.75. **Lanes:** turbulence `0.006 0.024`, 4 oct, seed 27, alpha = 1 − 5 R, × a radial lane mask, `#050710` × 0.35, in a 520 × 180 rect at (40, 12) rotated 20°. **Stars:** 8 young stars (−150 −22 r 1.6 white, 42 −38 1.5 cool, −62 30 1.1 white, 112 22 1.0 cool, −112 70 0.9 cool, 168 −82 1.1 white, 8 62 0.9 white, −30 −72 1.0 cool), halos r 4.5 (the two brightest r 7 with crisp spikes). **Motion:** layer A opacity 1 → 0.6 → 1, layer B 0.6 → 1 → 0.6, 40 s eased; the whole cloud breathes 1 → 1.01 → 1 over 30 s.

**Reflection nebula.** Bright star at (−110, 10) (the left third): halo r 26 (0 `#FFFFFF` α 0.85 · 0.08 `#B8CCFF` α 0.55 · 0.35 α 0.16 · 1 α 0), core r 2.2, 4 spikes 18 px (α 0.55) + 2 diagonals 8 px (α 0.3). 11 teardrop fan rects rotated about the star (−155° … +155°, lengths 160–380), each sampling its own stretch of noise so the streaks radiate: n = 0.55 big + 0.45 fine (big `0.004 0.02`, 5 oct, seed 7; fine `0.008 0.045`, 4 oct, seed 11 (A) / 19 (B)), d = clamp(2.6 n − 0.9) × mask. Filament edges: D = smoothstep(0.52, 0.58), blur 0.5, edge = D out blur(D, 2), `#DCE4FF` α 0.35. 5 small embedded stars. Motion as the emission nebula (the star does not breathe).

**Dark cloud.** 8 black radial-gradient ellipses (main mass, lobes, two globules) displaced by fractalNoise 0.012 / 4 oct / seed 31 (scale 64), smoothed 0.8, × a clumpy texture (fractalNoise 0.035 / 5 oct / seed 37, 0.15 + 1.8 R). Body `#000000` α = 0.85 · smoothstep(0.03, 0.75, m). Silhouette S = smoothstep(0.07, 0.10, m), blur 0.5. **Rim** = S out S offset (−1.6, +1.6): only edges whose upper-right neighbour is empty, `#FFD9B0` α 0.25. Inner glow = (S out S offset (−9, +9)) blur 3, inside S, α 0.07. **Tail** = S offset (−20, +20), blur 12, × texture, `#000000` α 0.55. Drawn **over** the starfield (it occludes stars). Breathes 1 % / 30 s.

**Asteroid field.** Belt axis at −18° through (0, 0); 88 rocks (62 dust r 1.5–3 · 20 small r 4–7 · 6 large r 9–14) placed by `mulberry32(0xA57E01D)`: uniform along the axis, Gaussian across it (σ 42 / 34 / 26), minimum spacing 1.45 (r₁ + r₂) + 3. Each rock: 7–11 vertices with ±0.3-step angular and ±0.18 r radial jitter, then an area-preserving potato elongation (aspect 1.0–1.3). Per rock, all crisp: the rotating silhouette carries the tumble; clipped to it, a lit-rim copy (`rock.highlight`) under the face copy shifted by a **static** (−s, +s) (s = 0.9 / 0.6 / 0.45 large / small / dust) → a sunward lit sliver at every angle; the face is flat `rock.base` (dust) or a tinted texture A (S-type, warm) / B (mixed) / C (C-type, dark) on a 48 px tile that rotates with the rock (rust fractalNoise 0.07, mottle 0.16, ochre on the mottle field, specks 0.70); craters (large 1–2, small > r 5.2 one at 50 %) with the bowl offset statically (+0.3 rc, −0.3 rc) toward the light; then a **static** light circle r 1.5 rmean (objectBoundingBox centre (0.924, 0.076), r 1.067): 0.25 `#FFF0DC` α 0.34 · 0.50 α 0.08 · 0.535 `#FF9455` α 0 · 0.575 α 0.20 · 0.597 `#3E3833` α 0.80 (the hard terminator) · 0.72 `#050B1E` α 0.86 · 1 α 0.92. Dust haze: ellipse 380 × 62 at −18°, `#AAB8DD` 0 α 0.05 · 0.55 α 0.035 · 1 α 0, streaked by fractalNoise `0.006 0.03` / seed 41. Tumble periods dust 20–50 s, small 35–70 s, large 55–90 s, random direction; the belt drifts ±6 px along its axis over 60 s.

**Wreck debris.** 20 pieces (`mulberry32(0x5EC7)` for the flakes): wrK1 hull panel (−80, −12) 150 s, R 36.1 · wrK2 solar panel (66, 38) 120 s, R 29.2 · wrK3 truss (124, −60) 200 s, R 43.9 · wrK4 bent pipe (−36, 78) 110 s, R 27.2 · 6 shards R 7.8–12.6 (58–90 s) · 10 flakes R 1.8–4 (34–58 s); full table in the header. Per piece: shadow bevel `#2A3245`, lit bevel `#ECF0FA` shifted statically (+s, −s), the face shifted (−s, +s) and clipped by the (+s, −s) copy too → a crisp lit sliver upper-right and a dark sliver lower-left (s 0.35–0.8); brushed-metal face patterns (64 px tile, fractalNoise `0.03 0.55`, 3 oct, seeds 13 / 19) that rotate with the piece, plus seams, rivets, hazard stripe, scorch, puncture and 24 solar cells; then a **static** broad light (centre (0.78, 0.22)): 0 `#ECF0FA` α 0.34 · 0.38 α 0 · 0.58 `#050B1E` α 0.30 · 1 α 0.66 — metal has no planet terminator. 7 glints ride their pieces, α 0.2 ↔ 0.6 over 3.1–6.4 s, staggered.

### Draw order

`starfield → nebulae → debris dust → bodies → rocks → trail / path → ship → HUD`, i.e. per frame:

1. **Background** (cached): `bg.edge` → vignette → Milky Way → starfield.
2. **Nebulae**: emission / reflection (two cross-fading layer sprites, or baked into the background when static), then the dark cloud **over** the stars it hides.
3. **Debris dust**: the asteroid belt's haze and the 62 dust rocks (batched; may be baked into the background if the drift is dropped).
4. **Bodies**: the star, planets, moons, ringed planets (back ring → planet → front ring), back to front.
5. **Rocks**: small and large asteroids, then wreck pieces (the near layer, in front of bodies they overlap).
6. Capture ring → predicted path / trail → drag arrow → thrust + ship → HUD → result overlay.

**Layout rule:** nebula cores (where both colour layers exceed half their peak alpha) stay out of the HUD rectangles (wordmark / mode x < 320, y < 90 · fuel x > 1160, y < 80 · actions and telemetry y > 780) so `ui.textMuted` keeps ≥ 5.4 : 1 (§2 contrast). Keep the predicted path ≥ 18 px from every large rock (scene-nebula).

### Optional gameplay hooks — **not in scope**

Documented so a later build knows where they would go; the prototype implements none of them, and no art depends on them.

| Hook | Outline | Effect it could have |
|---|---|---|
| Emission-nebula drag zone | ellipse rx 250 × ry 150 about the group centre (circle-equivalent r 195) | light drag on the ship inside it |
| Reflection-nebula drag zone | circle r 190 about (40, 10) | light drag |
| Dark-cloud drag zone | circle r 150 about the centre | light drag (and hidden stars) |
| Asteroid crash bodies | the 6 large rocks as circles of their mean radius: afR83 11.3 · afR84 9.6 · afR85 10.7 · afR86 12.1 · afR87 12.0 · afR88 9.8 | contact = crash; dust and small rocks stay visual |
| Wreck crash bodies | pieces with R ≥ 10 as circles of 0.6 R (wrK1–wrK8, wrK10) | contact = crash; flakes stay visual |
| Ring material | ring particles, debris-ring rocks, shepherd rings | none planned — they are never solid |

## 10. Ship systems (v2.3)

The design for the ship systems package: a modular ship whose upgrades are visible, damage states, the hull HUD, the tidal-stress warning and the upgrade screen. Files: `assets/ship/*.svg` (parts), `assets/hud-hull.svg`, `mockups/upgrade-screen.svg`, `mockups/flight-damaged.svg`, preview `preview/ship.html`. Renderer notes: `threejs-notes.md` §13.

### The modular ship

- **One frame for every part.** Each file in `assets/ship/` is a 96 × 160 viewBox with the ship centre at (48, 64), nose up. Parts stack exactly, so a build is just its parts drawn in order.
- **Draw order.** Back modules (solar, tanks, plating back) → engine plume → fins, engine nozzle and hull → front modules (plating front, cryo, scoop, sensors, shield) → one damage overlay.
- **Size.** The base hull is 48.6 units long and stays 22 px at zoom 1 (minimum 12 px), as today. Upgrades widen the silhouette (solar wings to ±29 units, about 26 px across) rather than lengthen it.
- **Identity kept.** White hull, navy outline, blue canopy and blue accents carry over from v1; the plume family stays blue-white to violet.
- **Lighting is symmetric.** A bright ridge and cooler edges, so the sprite can rotate with the heading without breaking "lighting never rotates" for bodies.
- **Readability rule.** Every upgrade must change the silhouette or add a coloured accent that reads at 22 px: wings, pods, intakes, arcs, antennas. Fine detail (panel lines, grids) is for the 2× and shipyard views.

| Token | Hex | Used for |
|---|---|---|
| `ship.hull` | `#B9C6E4` → `#E9EEF9` → `#FFFFFF` → `#E9EEF9` → `#B9C6E4` | Hull, fins, cryo band (stops 0 / 0.3 / 0.5 / 0.7 / 1, across the ship) |
| `ship.outline` | `#0A0D1A` | Outlines 0.6–1 unit; panel lines at α 0.32 |
| `ship.accent` | `#5EA0FF` | Fin tips, nose chevron, dish feed (= `ship.cockpit`) |
| `ship.canopy` | `#CFE8FF` → `#5EA0FF` → `#1E4FB8` | Canopy, highlight `#FFFFFF` α 0.75 |
| `ship.steel` | `#8496C4` / `#DCE4F6` | Engine mount, nozzles, struts, scoop funnels |
| `ship.throat` | `#1A2240` | Nozzle throat, scoop mouths |
| `ship.armor` | `#4E66A0` / `#7F98CF` | Hull plating shell; edge highlight `#AFC2EE` |
| `ship.shield` | `#7FDBFF` / `#9FE8FF` | Deflector crescent (α 0.22) and edge, emitters |
| `ship.tank` | `#B9C6E4` / `#FFFFFF` / `#A9B8DC` | Fuel pods; bands `#3DE0C2` (= `fuel.full`) |
| `ship.solar` | `#2E62D8` → `#1E3F9E` → `#15307E` | Solar cells; grid `#0A1A4A` α 0.7; frame `#FFD27A` (= `solar.glyph`) |
| `ship.scoop` | `#FFB45A` | Scoop rims |
| `ship.sensor` | `#DCE4FF` / `#5EF2FF` | Antenna and dish / blinking tip light |
| `ship.cryo` | `#BFF4FF` / `#7CF5FF` / `#1E6E8A` | Pod windows, breathing glow, window rims |
| `engine.ionPlate` | `#22305E` / `#7FB8FF` | Ion grid plate and grid bars |
| `plume.chem` | `#F7FBFF` → `#D6C8FF` → `#A06BFF` → `#7A4AD8` | Chemical plume (= `theme.thrust`); throat glow `#E2D4FF` |
| `plume.ion` | `#E6F4FF` → `#8FC2FF` → `#A06BFF` | Ion beam; core `#F2F9FF`, plate glow `#BFE0FF` |
| `plume.pulse` | `#FFFFFF` → `#E2D4FF` → `#A06BFF` → `#7A4AD8` | Pulse flash; plate glow `#C8B8FF` |

### Engines

| Engine | Nozzle | Plume | Read |
|---|---|---|---|
| Chemical | Bell, 6.4 → 10 wide | Teardrop to 42 units, flickering 0.33 s (the game's current plume) | the default, punchy |
| Ion | Gridded plate 14 × 3.8 | Long thin beam to 55 units, steady, slow 2 s shimmer | efficient, weak: burns last longer |
| Pulse | Pusher plate on struts | A flash every 0.6 s, growing and fading aft | powerful, thirsty |

The request's "no trailing halo" holds: the plumes have no separate bloom shape behind them.

### Damage states

One overlay at a time, chosen from the hull bar: none at 80–100 %, `damage-75` at 50–79 %, `damage-45` at 25–49 %, `damage-15` below 25 %. Each overlay includes the marks of the milder ones.

| Token | Hex | Used for |
|---|---|---|
| `damage.scorch` | `#1E1410` / `#3A2418` | Scorch marks (α 0.75 → 0.45 → 0) |
| `damage.dent` | `#AEBBDD` | Dented plate |
| `damage.crackGlow` | `#FF8A3A` | Glow under cracks (α 0.55–0.6) |
| `damage.breach` | `#FFB45A` → `#FF6A2A` → `#141A33` | Breached panel; missing plate `#141A33` |
| `damage.vent` | `#DCE4FF` | Venting puffs |
| `damage.spark` | `#FFD27A` | Sparks |
| `damage.beacon` | `#FF5A5F` | Red warning beacon (= `fuel.critical`) |

At game scale the breach glow, venting and beacon are what reads; the hull bar carries the exact number.

### Hull HUD and tidal stress

- **Hull block** under the fuel block (x 1180–1400): "HULL" label at baseline 96, percentage at x 1400, and a bar of **10 segments** at y 104 (20.2 × 8, gap 2, radius 2), so it never reads as the continuous fuel bar. A hit flashes the lost segment white for 120 ms.
- **Tidal-stress chip** at y 122 (220 × 26, radius 7), only while stress > 0: stretch icon, "TIDAL STRESS", three level cells. Level 3 means the hull is losing points; the chip turns red and pulses.
- **In-world chevrons**: two pairs 15–24 px from the ship, pointing outward along the stretch axis (the line to the mass causing it), pulsing every 0.8 s (0.5 s at level 3). Screen-space, never scaled.
- **Layout:** with the hull block shown, the top-right HUD rectangle grows to x > 1160, y < 152; the nebula-core rule (§9) applies to it.

| Token | Hex | Used for |
|---|---|---|
| `hull.ok` | `#9FC4FF` | Hull bar at ≥ 60 % |
| `hull.warn` | `#FFC857` | Hull bar at 30–59 % (= `fuel.low`) |
| `hull.critical` | `#FF5A5F` | Hull bar and percentage below 30 %, pulsing (= `fuel.critical`) |
| `stress.warn` | `#FF9F43` | Tidal chip and chevrons, levels 1–2; mass notes on the upgrade screen |
| `stress.critical` | `#FF5A5F` | Tidal chip and chevrons, level 3 |

The stress chip uses a 1 px coloured border on the panel fill, never a tinted fill: low-alpha amber over navy reads olive.

### Upgrade screen (shipyard)

`mockups/upgrade-screen.svg`, shown between levels:

- **Header:** wordmark and "SHIPYARD"; stars to spend at the top right (star glyph `#FFD27A`, count in 20 px mono).
- **Left:** the live ship at 5.8×, docked with its engine idle, on a blue pad (`#5EA0FF` α 0.28 → 0, dashed ring). Under it a stats panel: mass (with "+13 t vs base hull" in `stress.warn`), fuel range ("−11 % from mass") and solar recharge. Every upgrade costs mass, so mass and range lead.
- **Right:** eight cards, two columns, 392 × 150. Each card has a thumbnail (the module in full colour over a blueprint of the base hull: fill `#0B1024`, outline `#5EA0FF` α 0.6), name, effect, tier pips (3), mass, star cost and one action: "Fitted" (accent with a check), "Upgrade to 2" or "Fit" (panel button), locked ("Need 1 more star", padlock, muted), or for engines a Chemical | Ion | Pulse segmented control. Fitted cards get an accent border.
- **Bottom:** "Back" and "Launch" (primary), with the next level named.

## 11. WP11 (v2.4): asteroid belts, Kuiper belt, rogue planet, radiation map, dose meter

Files: `assets/space/belt-sparse.svg`, `belt-medium.svg`, `belt-dense.svg`, `kuiper-belt.svg`, `assets/bodies/rogue-planet.svg`, `assets/overlays/radiation-map.svg`, `assets/hud-dose.svg`, mockup `mockups/belts-radiation.svg`. Renderer notes: `threejs-notes.md` §14; implementation rules: `IMPLEMENTING.md` §5.

### Asteroid belts

- **A belt is an arc of a ring around its star.** Rocks are placed in polar coordinates about the star, with radius spread across the band and seeded from the level. A slow drift rotates the whole belt about its star (0 → −0.5° → 0 over 60 s).
- **Every rock is lit toward its star.** The 6 seeded silhouettes per type are drawn lit from −x and each instance is rotated to point that side at the star. The shape is random, so rotating it costs nothing, and the lighting is always right.
- **Rock construction** (as the v1.4 asteroid field, simplified for instancing): a rim polygon, the face shifted 0.9 units away from the light (so a crisp sunward rim shows), 2–4 accent spots, 1–2 craters, a terminator band with a thin warm `#FF9455` line, and a dark outline.
- **Density tiers** read at a glance:

| Tier | Per 100 px of arc (large / small / dust) | Gap | Haze | Read |
|---|---|---|---|---|
| Sparse | 1.3 / 1.9 / 7 | wide (+30) | none | big rocks, wide gaps: weave through |
| Medium | 2.6 / 7.4 / 26 | +10 | α 0.035 | mixed sizes: pick a gap |
| Dense | 3.7 / 20 / 96 | none | α 0.07 | packed with dust: shielding or go around |

- **Edges** (planning and pause only): two dashed arcs at R ± 0.9 w, `#C9BBA8` α 0.4, 1 px, dash 5 6.
- **Solidity:** rocks with r ≥ 7 are crash bodies; small rocks and dust are visual unless the level gives the tier a dust-damage rate.

| Token | Rim / light / base / dark / night | Accent | Used for |
|---|---|---|---|
| `belt.rockS` | `#F0DCC0` / `#C8A684` / `#9A7A5E` / `#5A4636` / `#120E14` | rust `#C0562A` α 0.45 | Stony rocks (warm) |
| `belt.rockC` | `#D8CCBE` / `#8E8478` / `#62584E` / `#3A332D` / `#0C0B12` | `#2A2420` α 0.5 | Carbonaceous rocks (dark) |
| `belt.rockM` | `#EEF2FA` / `#B6BFD2` / `#8690A8` / `#4E566C` / `#0A0D18` | `#DCE4F6` α 0.35 | Metallic rocks (cool silver) |
| `belt.haze` | `#C9B79E` | | Dust haze arcs (medium, dense) |
| `belt.edge` | `#C9BBA8` | | Planning edges (= `rock.highlight`) |

### Kuiper belt

The outer belt: far out, wide (w 95), faint and mostly ice dust (60 % of specks `#DCEBF5`), with few small bodies (per 100 px of arc: 3.0 large, 8.5 small, 78 dust). Bodies are red-brown tholin crusts patched with bright frost, as real Kuiper objects are. A dwarf planet (r 13) can sit in it as a small mass.

| Token | Hex | Used for |
|---|---|---|
| `kuiper.rock` | `#FFE6D8` / `#C88870` / `#9A5A46` / `#5A2E26` / `#120A10` | Rim / light / base / dark / night |
| `kuiper.frost` | `#DCEBF5` | Frost patches (α 0.75) and ice dust |
| `kuiper.haze` | `#BFD8E8` | Ice haze arcs (α 0.035) |
| `kuiper.dwarf` | `#FFE9DC` → `#D6A08A` → `#5A2E26` | Dwarf planet; ice plain `#F4FAFF`, tholin `#8A3E2E`, night `#0C0A12` |

### Rogue planet

A planet with no star (r 36, crash 36). Nothing lights it, so it is read by its cold rim, its own faint heat, and the stars it hides. It still has gravity but gives no recharge, and it travels in a straight line through the level.

| Token | Hex | Used for |
|---|---|---|
| `rogue.body` | `#1C1024` → `#100C1C` → `#070912` | Dark disc |
| `rogue.thermal` | `#4A1428` / `#2E0C1E` / `#6A2034` / `#22091A` | Thermal bands (α 0.18–0.42), drifting 2 r per 90 s |
| `rogue.hot` | `#FF6A3A` | Hot spots, flickering α 0.5 → 0.15 |
| `rogue.rim` | `#6E7FA6` / `#AFC2EE` | Cold rim (full circle α 0.6) and upper arc (α 0.85) |
| `rogue.airglow` | `#3A5A9A` / `#4E6FB8` | Thin airglow ring (peak α 0.35 at 0.82 of r 43.9) |
| `rogue.drift` | `#8B95B5` | Planning drift arrow (dash 4 5, crawling) |

### Radiation map (R)

A third map, beside Gravity (G) and Magnetism (M), shown in planning and pause. Its grammar is a **halftone dot field** on a fixed 12 px screen grid, so it never reads like the gravity grid (lines) or the magnetism map (flat zones), and it stays crisp at every zoom.

| Zone | Dose rate D (× D1) | Dot radius | Token | Hex |
|---|---|---|---|---|
| Background | < 1 | 0.5 px speck, α 0.25 | `rad.bg` | `#9BE15D` |
| Low | ≥ 1 | 1.0 | `rad.low` | `#9BE15D` |
| Raised | ≥ 3 | 1.6 | `rad.raised` | `#D4F03C` |
| High | ≥ 8 | 2.3 | `rad.high` | `#FFE83A` |
| Severe | ≥ 20 | 3.0 | `rad.severe` | `#FFF4B8` |

- **Sources** (design defaults; the sim owns the numbers): stars `k (r0/d)²` scaled with luminosity; flares add a directed 20° cone; gas giants and magnetars carry radiation belts (an inner and an outer annulus at 2.1 R and 3.2 R); pulsars add their beam; accretion disks add a ring; a constant cosmic background.
- **Shadows:** any body between a point and the star blocks the star and flare terms. The empty strip behind a planet during a flare is the safe place to hide.
- **Sample placeholders:** `radiation-map.svg` stands in plain discs for the star (`#FF8F1F`, rim `#FFD27A`) and the planet (`#3A5A7A`, lit half `#C8A684`) so it shares no ids with the body assets; the game draws the real bodies.
- **Legend** under the map toggles: "RADIATION", the key hint "R", four dots with labels. Dots stay out of the HUD rectangles.
- The lime-to-pale-gold ramp is kept clear of the gravity map's blue-to-orange, the magnetism map's violet-to-pink and solar recharge's gold.

### Dose meter

The third block of the right-hand status stack (fuel 48 · hull 96 · dose 144); status chips move below it to y 170.

- **Bar:** continuous (the hull bar is the segmented one), 220 × 8. `rad.doseOk #9BE15D` below the bonus mark, `rad.doseWarn #FFE83A` to 75 %, `rad.doseCrit #FF5A5F` from 75 % with a 1 s pulse.
- **Marks:** a white tick and a gold star (`#FFD27A`, the star currency) at 25 % of the limit (finish below it for the bonus); a red tick at 100 % (the limit fails the mission).
- **Header:** "DOSE", a trefoil in the bar colour, the total in mSv (red from 75 %).
- **Rate line:** "+2.4 mSv/s · belt" with the dominant source, coloured by its map zone; "0.0 mSv/s · shadow" in `ui.textMuted` while a body shields the ship.
- **Planning:** a ghost segment `#D4F03C` α 0.9 showing the dose the plan will add, and "+10 mSv on this path".

## 12. Ship and planning view (v2.5): burn plume, burn node, gravity grid

Files: `assets/ship/plume-states.svg`, `assets/burn-node.svg`, `assets/overlays/gravity-grid.svg`, `assets/overlays/gravity-sheet.svg`, mockups `mockups/planning-grid.svg` and `mockups/flight-burn.svg`. Renderer notes: `threejs-notes.md` §15.

### Burn plume

One crisp, ragged shape running blue-white into violet, with a white core and no halo or bloom shape behind it.

- **Shape (shader-ready):** half-width `w(t) = W · (0.55 + 0.45 min(1, t/0.25)) · (1 − max(0, (t − 0.25)/0.75))^1.4 · (1 + 0.12 rag(t) min(1, 6t))`, with t = 0 at the nozzle and 1 at the tip. `rag` is the mean of 3 sines (5–11 cycles along the length) whose phases advance with time: the flicker.
- **Length from burn size:** `L = min(110, 44 + 12 |Δv|)` design units, and `W = 6.5 + L/40`. That gives 50 for a small burn, 80 for a medium one and 110 at the cap. It replaces the fixed 96-unit plume, so big burns read as big.
- **States** (sim time, `theme.burn`):

| State | When | Look |
|---|---|---|
| Wind-up | −0.5 → 0 s | Throat glow `#E2D4FF` growing (rx 1.5 → 4.6) and flickering at 9 Hz; a short lick (L 16, W 4.2) |
| Ignition | 0 → 0.12 s | Flash ring at the nozzle, r 4 → 13, `#F7FBFF` 1.2 px, fading; the plume grows to L |
| Full | the burn | L from Δv, flickering every 0.33 s |
| Tail-off | the existing tail time | The root goes first: a cutoff runs from nozzle to tip (soft edge 0.15 L) while the detached plume fades aft |

| Token | Hex | Used for |
|---|---|---|
| `plume.chem` | `#F7FBFF` → `#D6C8FF` (α 0.92, 0.2) → `#A06BFF` (α 0.6, 0.5) → `#7A4AD8` (α 0.2, 0.8) → α 0 | Flame along t |
| `plume.core` | `#FFFFFF` → `#E6F4FF` (α 0.85) → `#C8D8FF` α 0 | White core, 0.42 L × 0.38 W |
| `plume.glow` | `#E2D4FF` | Wind-up throat glow |
| `plume.flash` | `#F7FBFF` | Ignition ring |

Ion and pulse engines keep their own shapes (§10) and use the same wind-up, ignition and tail-off timing.

### Burn node

A ring on the path in the engine family's blue-violet. It replaces the gold disc, which sat next to the gold recharge dots and doubled as `fuel.low`. Screen-space, never scaled with zoom.

| State | Look |
|---|---|
| Idle | Ring r 5, 2 px `#B8A8FF`, fill `#0A0D1A`, core r 1.7 `#F7FBFF`; the burn number (1 or 2) in 9 px mono `#8B95B5` at (+7, −8) |
| Selected | Ring r 6.5 in `#FFFFFF` plus an outer ring r 9.5 `#B8A8FF` α 0.55; a chip by the arrow head ("Δv 1.8 · 12 %", 10.5 px mono on the panel fill); a delete button r 6 at (+13, +11), only while unfired |
| Placing | Dashed ghost line `#FFFFFF` α 0.3 (3 3) to a handle r 4 `#ECF0FA` |
| Over budget | Ring, core and arrow head `#FF5A5F`; the chip reads "Δv 6.2 · +18 % over" in `#FF5A5F` |
| Wind-up | A white arc r 9, 2 px, round caps, filling clockwise from 12 o'clock over the 0.5 s wind-up (sim time) |
| Ignition | A flash ring r 6 → 18, `#F7FBFF` 1.5 px, fading over 0.4 s |
| Fired | Ring dashed 2 2, `#B8A8FF` α 0.45, no core: history, not editable |

The burn arrow keeps the drag-arrow geometry and power ramp (`arrow.power`: `#3DE0C2` → `#FFC857` → `#FF5A5F` by cost / fuel).

| Token | Hex | Used for |
|---|---|---|
| `node.ring` | `#B8A8FF` | Node ring, selected outer ring, fired ring |
| `node.core` | `#F7FBFF` | Core dot, wind-up arc, ignition ring |
| `node.fill` | `#0A0D1A` | Ring fill (= `ship.outline`) |
| `node.selected` | `#FFFFFF` | Selected ring |
| `node.over` | `#FF5A5F` | Over budget (= `fuel.critical`) |

### Gravity grid and sheet

The warp is unchanged: lines still bend and bunch toward masses by the real potential (WP6b). What changes is the ink.

- **Thin and crisp:** minor lines 0.75 px, every fourth line major at 1 px (+0.10 α), with `fwidth` antialiasing.
- **Tinted by well depth:** `d = log(1 + Φ/Φ0) / log(1 + Φmax/Φ0)`, `t = d^2.2`, colour from the ramp below at 1.05 t. Flat space stays faint blue, and only the wells warm up.
- **Alpha:** `(0.16 + 0.62 t + 0.10 major) × edge fade`, where the fade runs from 0 at the screen edge to 1 at 70 px in, so there is no hard border. Lines stop 3 px outside body discs.
- **Tidal ring:** a dashed `#FF5A5F` α 0.8, 1 px, dash 4 4, crawling 8 px/s, at the radius where tidal stress reaches level 1, labelled "tidal stress". It replaces the filled red disc, which looked like the magnetism Lethal zone.
- **Sheet:** cells filled `#0B1430` α 0.55 (dark glass), drawn back to front under the same ink at 0.7 px. Depth is `z = H · d^1.3` with `H = 0.22 ×` the longer side, so funnels read and black holes stay finite. The outer 5 cells fade to nothing. Tilt is 62° with a mild perspective. Bodies sit at the bottom of their wells and the planned path rides the sheet.
- Clock-rate contours (C) are unchanged.

| Token | Hex | Used for |
|---|---|---|
| `grid.depth` | `#2A4A8A` (0) · `#3D8BFF` (0.18) · `#3DE0C2` (0.42) · `#FFC857` (0.68) · `#FF5A1F` (1) | Grid and sheet lines by depth (`#2A4A8A` is new; the rest are existing tokens) |
| `grid.tidal` | `#FF5A5F` | Tidal ring |
| `sheet.glass` | `#0B1430` | Sheet cells, α 0.55 |

## 13. Late game (v2.6): megastructures, wormholes and living surfaces

Files: `assets/mega/stellar-engine.svg`, `dyson-swarm.svg`, `ringworld.svg`, `shkadov-thruster.svg`, `space-elevator.svg`, `wormhole.svg`, `assets/star-surface-motion.svg`, mockup `mockups/late-game.svg`. Each structure is drawn around the level's real star or planet; the assets show a placeholder disc there. Renderer notes: `threejs-notes.md` §4.6 and §16.

| Structure | Read | Gameplay hook (level data) |
|---|---|---|
| Stellar engine | A star with a collimated plasma jet through a magnetic nozzle, mirror collectors behind | Jet core burns; jet margins refill fuel with the gas scoop; the jet pushes the ship along it |
| Dyson swarm | Three tilted collector shells around a dimmed star, gold glints, a deep-red waste-heat ring | Recharge × (1 − coverage); a collector hit costs a little hull; the gaps are safe lanes |
| Ringworld | A tilted ring: land, seas and clouds on the far inner floor, dark hull and city lights near, shadow squares | The band is solid except at transit gaps; inside, the ring's own pull cancels at the centre |
| Shkadov thruster | A star-sized curved mirror; the light escapes the other way as crisp rays | The mirror is solid; every body drifts with a tiny constant acceleration toward the mirror |
| Space elevator | A tether from the equator past a station to a counterweight; climbers ride it | The tether is solid; release at the top gives v = ω × r: a free launch boost |
| Wormhole pair | Each mouth shows the other end's sky, lensed at the rim, with smeared star arcs | Entering a mouth moves the ship to the other one, speed kept; the exit adds its clock offset |

| Token | Hex | Used for |
|---|---|---|
| `engine.jet` | `#FFF6D6` → `#FFD27A` → `#FF9A4A` → `#FF5A8A` → `#E0408A` | Stellar-engine jet: golden-white into hot pink, never brown |
| `engine.jetCore` | `#FFFFFF` / `#FFF6D6` | Jet core and knots (`#FFE7A0` knot edge) |
| `mega.mirror` | `#F4F8FF` / `#AFC2EE` / `#5A6E9E` | Collector tiles, Shkadov mirror (`#FFFFFF` / `#E6F2FF` / `#8FA3D0`), struts |
| `mega.structure` | `#DCE4F6` / `#1A2240` / `#141A33` / `#2A3560` | Nozzle bars, tether, rims, hulls, ribs |
| `swarm.collector` | `#5E8FFF` | Dyson collectors (3 px dashes); glints `#FFE7A0` |
| `swarm.heat` | `#A8303A` / `#8A2A3A` | Waste-heat ring, peak α 0.16 |
| `ring.land` | `#5FA84A` / `#3B7E3A` / `#1E5BD6` / `#36B9D8` / `#E8A85C` | Ringworld floor strips (the ocean-world tokens); night `#050B1E` α 0.65; lights `#FFD9B0` |
| `elevator.climber` | `#FFE08A` | Climbers; station beacon `#5EF2FF`; release arrow and chip `#3DE0C2` |
| `wormhole.warm` / `.cool` | `#8A2A4A` / `#4A1A3A` · `#2A5AB8` / `#0E2A5A` | The sky seen through each mouth; stars `#FFD9B0` / `#B8CCFF`; Einstein ring `#FFFFFF` + `#B8CCFF`; arcs `#E9EEF8` |

Easter-egg and pop-culture nods stay hints only (`ROADMAP.md`): no ring gates, logos or copied ship designs.

### Living surfaces

Bodies should never look like still pictures. The game now animates the sun's rings and haze, but its disc, the planets' surfaces and the gas giants' bands are still. Motion is cosmetic (`frame.now`), slow, and never strobes or flickers fast. The reference is `assets/star-surface-motion.svg`.

**The sun and every star look** (the same layers, each look's own colours):

| Layer | Motion | Values |
|---|---|---|
| Deep plasma | flows west → east | fractalNoise 0.035, 4 octaves; one disc diameter per 140 s |
| Dark plasma (`star.svg` surface) | flows east → west | fractalNoise 0.05, 5 octaves; one diameter per 90 s |
| Cells and filaments | boil | turbulence 0.06, three seeds cross-fading 0 → 0.9 → 0.9 → 0 over 9 s, staggered 3 s, each drifting 8 units |
| Faculae | twinkle | 5 bright patches at 0.85 r, α 0.2 → 1 over 3.7–6 s |
| Limb | shimmers | opacity 1 → 0.9 → 1 over 3 s |
| Rim | wobbles | `star.svg` `#starEdge`, unchanged |

- Two plasma layers moving opposite ways at different speeds read as differential rotation and depth, without the disc visibly spinning.
- Cross-fading seeds make cells form, live about 5 s, and dissolve: a boiling photosphere.
- Red giant: half the frequencies, 1.6× the periods, so big cells churn slowly. White dwarf: no surface motion, since it stays perfectly smooth.

**Planets and moons:** scroll the baked surface strip under a still lighting overlay at the header period (ocean 90 s, Planet X 120 s, moon 180 s and so on), and clouds or wisps at their own period. Layer ids are in each header (`#pxSurfaceAnim`, `#pxWispAnim`, `#psCloud`).

**Gas giants:** three band groups flowing in opposite directions (`#gbAnimA` / `B` / `C` at 180 / 110 / 150 s). The storm spot rides its band.

**Per body type** (periods from each asset header; all cosmetic, `frame.now`):

| Body | Surface motion | Extra life |
|---|---|---|
| Sun (`star.svg`) | Plasma flows 90 / 140 s, cells boil on a 9 s cycle, faculae twinkle | Flame ring +360° / 200 s, wisp ring −360° / 300 s, haze breathes ±3 % / 6 s; prominences on 12 / 16 / 14 s; the flare peaks every 22 s |
| Red dwarf | Plasma and cell periods × 1.4 (calm, deep red) | Flames 260 s, wisps 390 s; its own loops and flare |
| Blue giant | Periods × 0.8, cell frequency × 1.3 (fine, fast) | Flames 200 s, wisps 300 s; loops and flare |
| Red giant | Frequencies × 0.5, periods × 1.6 (big, slow cells) | Drag edge crawls −8 px/s; atmosphere breathes ±2 % / 10 s |
| Binary pair | Each star its own look's values, offset by half a cycle | Orbit from the sim |
| White dwarf | None: perfectly smooth | Glow breathes ±5 % / 4 s |
| Neutron star / pulsar / magnetar | None on the disc | Beams 6 s / 4 s (sim time for the pulsar); magnetar dashes, flicker 1.7–3.4 s, starquake every 18 s |
| Black hole | Accretion disk turns once per 24 s (inner faster, if the shader allows) | Photon ring steady; lensed arcs follow the disk |
| Rocky / ocean / ice / cracked worlds | Surface strip scrolls west → east: rocky 110 s, ocean 90 s, ice 140 s, cracked 100 s | Ocean clouds 64 s with their cast shadow; ice and cracked crack-glints are static |
| Lava world | Surface 95 s | Emissive cracks pulse over 5 s (never faster) |
| Toxic world | Surface 120 s, cloud deck 75 s | — |
| Planet X | Surface 120 s, wisps 80 s | Halo breathes ±4 % / 2.4 s; the target zone pulses over 4 s (§17) |
| Gas giants | Band groups counter-flow 180 / 110 / 150 s (banded), 160 / 120 s (ringed) | Storm spot rides its band; rings stay still |
| Moons | Barren 180 s, icy 150 s, volcanic 120 s, dwarf 160 s | Volcanic glow pulses slowly; moons in a chain keep their lit side to the star |
| Comet | Coma breathes ×1.04 / 5 s | Ion streaks 2.2–3.1 s, knot every 9 s, dust sparkles 9–14 s |
| Nebulae | Two textures cross-fade over 40 s (slow morph) | Never brighter than their α caps |

Never animate the lighting, the crash radius or anything a player reads as a hazard edge.

## 14. Collisions and consumption (v2.7, Living universe LU3)

Files: `assets/events/impact.svg`, `debris-field.svg`, `tidal-disruption.svg`, `burn-up.svg`, `accretion.svg`, `event-telegraphs.svg`, mockup `mockups/showcase-burning-planet.svg` (the Ash level). Renderer notes: `threejs-notes.md` §17. Each sample draws a placeholder disc where the real star or planet goes.

Events are scripted and deterministic, keyed to sim time, so the visuals play on sim time too: they pause, slow down and scrub with the plan. Small cosmetic motion inside them (flicker, sparkle) may use `frame.now`.

| Event | Script (level data) | Timeline |
|---|---|---|
| Impact | `impact { at, into }` | Approach until `at`; flash 0.6 s; shock ring 1.3 s; rim flash 1.8 s; ejecta cone 2.7 s; crater afterglow 3.6 s; then the debris field |
| Debris field | follows an impact | Chunks spread along the orbit; the hazard edge crawls; chips count down the narrowing gap |
| Tidal disruption | proposed `disrupt { centerId, start, end }` | The body stretches toward the mass; a bound stream heats as it falls in, an unbound tail flies out |
| Burning up | `consume { centerId, start, end, radius }` | Heat `u = (t − start) / (end − start)` grows the dayside glow and the ablation tail; at `end`: plunge flash 0.55 s, ripple across the star 1.8 s, star brightening 1.6 s |
| Accretion | proposed `accrete { centerId, start, end }` | The star stretches; a stream arcs from its near side into the disk; a hotspot flickers where they meet; the hole's mass grows |

**Telegraphs** (planning, before the event): the collision course dashed in `event.warn`, a pulsing impact reticle, a countdown chip, and the follow-on (debris, decaying orbit) dashed in `event.next`. Never a tinted fill: low-alpha orange over navy reads brown.

| Token | Hex | Used for |
|---|---|---|
| `event.flash` | `#FFFFFF` → `#FFF6D6` (α 0.9) → `#FFE7A0` α 0 | Impact and plunge flashes, accretion hotspot |
| `event.shock` | `#FFE7A0` | Shock ring, rim flash, star brightening |
| `event.glow` | `#FFE7A0` → `#FF8A3A` (α 0.85) → `#FF6A2A` α 0 | Crater afterglow, stream hotspot, dayside heating |
| `event.ejecta` | `#FFB45A` (hot) · `#C8A684` / `#9A7A5E` / `#8E8478` (rock) | Ejecta and debris dust |
| `event.ablation` | `#FFF6D6` → `#FFB45A` → `#FF5A8A` → `#E0408A` | Ablation tail (hot pink, never brown) |
| `event.stream` | body colours → `#FFB45A` → `#FFF6D6` | Tidal stream heating as it falls; accretion stream `#FFB43A` → `#FF8A3A` → `#FFE7A0` |
| `event.ripple` | `#FFF1C2` | Ripple across the star after a plunge |
| `disk.hot` | `#E6F4FF` → `#FFE7A0` → `#FF8A3A` → `#A8303A` | Accretion disk, hot inside; photon ring `#FFC857` + `#FFFFFF` |
| `event.warn` | `#FF9F43` | The event itself: course, reticle, countdown chip, decaying spiral (= `stress.warn`) |
| `event.next` | `#FFC857` | What follows: debris forecast, "gap narrows", "orbit decaying" |

The showcase mockup also previews where the target will be at arrival (a dashed `#3DE0C2` ring with its capture radius). The ghost-marker design itself is the next request.

## 15. Ghost markers (v2.8, Living universe LU2)

Files: `assets/ghost-markers.svg`, mockup `mockups/planning-ghosts.svg`. Renderer notes: `threejs-notes.md` §18. A ghost shows where a moving body will be at a moment on the plan. Ghosts appear in planning and pause only, take their position from `bodyPose` at the ghost's sim time, and use screen-space strokes that never scale with zoom.

- **Marker:** a ring at the body's radius (minimum 8 px), 1.2 px, plus an inner ring at 0.62 r. The fill is the ghost colour at α 0.07–0.14, in cool colours only, so it never turns brown. Never a filled disc: a ghost must not compete with the real body.
- **Tie line:** a dotted line from the path sample at the same sim time (a small ring on the path) to the ghost, so the pairing is never ambiguous. The cursor's tie line is white, with a solid dot on the path.
- **Future track:** the target's orbit from now to arrival as mint dots with a tick every 10 s of sim time, so direction and speed read at a glance.
- **Limits:** one ghost per body per burn node, one cursor ghost, one arrival ghost. Ghosts more than 3 burns ahead fade to α 0.3.

| State | Look | Label |
|---|---|---|
| At a burn | `ghost.body` ring α 0.85; a badge r 6.5 with the burn number (ring `#B8A8FF`, = `node.ring`) | "+0:24" (time from now) |
| Under the cursor | `ghost.cursor` 1.6 px ring | "+0:51" |
| Target at arrival | `ghost.target` ring plus its capture radius dashed 6 6, crawling 12 px/s | "arrive 1:10" |
| Collision | `ghost.collision` ring pulsing α 1 → 0.45 over 0.8 s, with a cross | "collision 0:48" |
| Gone by then | `ghost.gone` dashed ring (2 3) with a slash: consumed or destroyed before that moment (LU3) | "gone at 1:42" |
| Other bodies | `ghost.body` α 0.6, smaller, no label | — |

| Token | Hex | Used for |
|---|---|---|
| `ghost.body` | `#DCE4FF` | Ghosts of bodies that are not the target; burn ghosts (= `path`) |
| `ghost.cursor` | `#FFFFFF` | The ghost and tie line under the cursor |
| `ghost.target` | `#3DE0C2` | The target's arrival ghost, capture radius and future track (= `planet.x` ring) |
| `ghost.collision` | `#FF5A5F` | A predicted collision (= `fuel.critical`) |
| `ghost.gone` | `#FF9F43` | A body gone by then (= `event.warn`) |
| `ghost.tie` | `#8B95B5` | Tie lines (α 0.75, dash 1.5 3.5, round caps) |

## 16. Supernova, quasar and stray asteroid (v2.9, WP12)

Files: `assets/bodies/supernova-progenitor.svg`, `assets/events/supernova-detonation.svg`, `assets/events/supernova-remnant.svg`, `assets/bodies/quasar.svg`, `assets/events/quasar-sweep.svg`, `assets/bodies/stray-asteroid.svg`, mockup `mockups/supernova-level.svg`. Renderer notes: `threejs-notes.md` §19. The progenitor and detonation samples draw a placeholder disc where the red-giant asset goes.

Both hazards are functions of sim time (`src/sim/events.ts`), so their visuals play on sim time too: they pause and scrub with the plan, and planning shows the frame at the cursor's time. Only flicker and knot shimmer may use `frame.now`.

**Supernova** (`supernova { at, blast, speed, damage }`):

| Phase | Sim time | Look |
|---|---|---|
| Progenitor | before `at` | A red supergiant: the red-giant asset scaled to the body's radius, breathing unevenly (scale ×1 → 1.06 → 0.98 → 1.10 over 5.5 s, keyTimes 0 .2 .45 .8 1) and shedding faint old shells (`nova.shell` α 0.32 / 0.22 / 0.14, drifting out). The crash radius stays `radius`; the breathing is visual only. |
| Detonation | `at` → `at` + 2.6 s | The star shrinks to ×0.8 in the last 0.5 s and vanishes at `at`. `event.novaFlash` grows to 1.2 × `blast` by `at` + 0.85 s and fades out by `at` + 2.6 s: blue-white, the hottest light in the game, never yellow. |
| Ejecta and shock | from `at` | The ejecta shell (`nova.shock` ring plus 46 filaments in `nova.filament`) sits **exactly** at `shellRadius(nova, t)` = `speed · (t − at)`. What the player sees is what hits them. |
| Remnant | after the flash | A filamentary nebula (240 short strokes, 5 : 3 : 2 : 1 in the four `nova.filament` colours) round a synchrotron haze (`nova.haze`), and a pulsar at the centre (beams turning once per 2 s, cosmetic). |

Planning, before `at`: the lethal radius `blast` dashed in `nova.blast` (5 5, crawling 10 px/s) with "lethal blast r N"; a countdown arc (3 px, round caps, `event.warn` over a `#FFFFFF` α 0.12 track) emptying clockwise from 12 o'clock with "supernova in m:ss"; and on the predicted path, "path leaves the blast zone at m:ss · m:ss to spare" in `event.next`, or the path sample at `at` marked like a ghost collision (§15) when it is inside `blast`. After `at`: future shock radii dashed in `event.warn` with "shock +0:20" and "shock +0:40" chips.

**Quasar** (`quasar { angle, cone, reach, damage, period?, sweep? }`): a supermassive black hole with a blazing disk and twin jets along `jetAngle(jet, t)`.

- **Core:** the glow `quasar.glow` (r ≈ 6.4 × the shadow); the disk `quasar.disk` at rx 4.9 × the shadow, ry 0.3 × rx, white-hot inside, with its front half drawn over the shadow (`#000000`, rim `#FFF6D6`).
- **Jets:** start at 1.5 × the shadow and end at `reach`. The violet sheath spans the lethal cone exactly (half-width `d · tan(cone)` at distance d). The blue body runs at 0.45 of that width, and the white core at 2.5 px to 0.6 `reach`. Three knots (`#FFFFFF` α 0.85) race out every 2.4 s. Everything inside the sheath is lethal, nothing outside it is.
- **Planning, swept jets:** dash the extreme cone edges (`angle ± (sweep + cone)`) and the reach arc in `event.warn` (α 0.7, 5 5). Add "jet sweeps ±N° · every N s" and, when the path crosses the swept zone, "safe window m:ss" in `event.next` (the time until the jet leaves the crossing point). A static jet gets only the cone edges.

**Stray asteroid** (a body with `drift { vx, vy }`): the WP11 rock construction (§9 asteroid field, S, mixed or C texture by seed) at its crash radius (here 15), lit toward the nearest star, tumbling 55–90 s. A dust trail of 40 specks (`rock.dust`) fading over 140 px behind its velocity. In planning and pause, a dashed drift arrow `#8B95B5` along its velocity (as on the rogue planet) and its ghost markers (§15). Solid: crash radius = r.

| Token | Hex | Used for |
|---|---|---|
| `nova.shell` | `#FF5A8A` | The progenitor's old shells (1.2 px; pink, so they never turn brown on navy) |
| `nova.blast` | `#FF5A5F` | Lethal blast radius in planning (= `fuel.critical`) |
| `event.novaFlash` | `#FFFFFF` → 0.25 `#E6F4FF` α 0.95 → 0.6 `#9FC4FF` α 0.35 → `#7FB8FF` α 0 | The detonation flash |
| `nova.shock` | `#BFEFFF` | Ejecta and shock front ring (2 px at detonation, 1.4 px on the remnant) |
| `nova.filament` | `#FF5A6A` (H) · `#3DE0C2` (O) · `#FFB45A` (S) · `#E0408A` | Ejecta and remnant filaments |
| `nova.haze` | `#9FC4FF` α 0.35 → `#7FB8FF` α 0.12 → 0 | The remnant's synchrotron haze |
| `nova.pulsar` | `#FFFFFF` → `#DCF6FF` → `#7FDBFF` α 0 | Neutron star and pulsar; beams `#BFEFFF` α 0.6 |
| `quasar.glow` | `#E6F4FF` α 0.5 → `#9FC4FF` α 0.15 → 0 | Glow round the core |
| `quasar.disk` | `#FFFFFF` (0.33) → `#E6F4FF` (0.45) → `#FFE7A0` α 0.95 (0.62) → `#FF8A3A` α 0.7 (0.8) → `#E0408A` α 0 | Accretion disk (hotter and whiter than `disk.hot`) |
| `quasar.jet` | `#FFFFFF` → 0.15 `#DCF6FF` α 0.95 → 0.5 `#5E9BFF` α 0.85 → 0.8 `#8A5CFF` α 0.5 → `#A06BFF` α 0 | Jets: vivid blue into violet, never grey |
| `rock.dust` | `#C8A684` | Stray-asteroid dust trail (= `event.ejecta` rock) |

Chips reuse `event.warn` (`#FF9F43`: countdown, sweep, shock forecast) and `event.next` (`#FFC857`: what follows, "safe window", "path leaves the blast zone"), on the panel fill with a coloured border, never a tinted fill.

## 17. Target zone (v3.0, orbit capture)

Files: `assets/target-zone.svg` (six states), `assets/planet-x.svg` part 8 (the idle zone, spliced into every mockup), mockup `mockups/planning-capture.svg`. Renderer notes: `threejs-notes.md` §20. The zone is Planet X's capture radius: a level is won when the ship is in an orbit around the target that clears the surface and whose apoapsis stays inside the ring (`isCapturedOrbit`). The v1.2 dashed, crawling ring is gone. A solid ring with a soft glow reads as a place to settle into, not a finish line to cross.

- **Ring:** a solid circle at `captureRadius`, 1.5 px in screen space (never scaled with zoom).
- **Band:** a glow under the ring, fading in from 30 px inside it and stopping 9 px outside. Mint only, so it never turns brown or grey on navy. It stays quieter than Planet X's halo and never covers the disc.
- **Subtle:** at rest the zone is the dimmest mint on screen after the dashed planning marks. It brightens only when the ship is in it.

| State | When | Ring | Band | Extras |
|---|---|---|---|---|
| Idle | ship outside the zone | `zone.ring` α 0.55 → 0.78 → 0.55 / 4 s | α 0.14 → 0.24, in phase | — |
| Planning | planning mode | the idle ring | the idle band | entry tick where the predicted path first crosses the ring, "enters zone m:ss"; when a burn inside gives a captured orbit, that orbit dashed `zone.ring` α 0.75 (4 4) with "capture orbit · peri N · apo N" |
| Inside, too fast | ship inside, orbit not captured | α 0.95, steady | α 0.32 | `zone.exit` arc ±10° at the predicted exit point, 3 px, pulsing 1 → 0.45 / 1.2 s, "leaves the zone in m:ss"; hint "too fast · burn Δv N retrograde to capture" |
| Captured | the step `isCapturedOrbit` turns true; plays once | `zone.ring` → `#FFFFFF` (+0.15 s, 3.5 px) → `zone.stable` (+1.1 s, 1.6 px) | α 0.32 → 0.70 (+0.2 s) → 0.32 (+1.5 s) | a wave ring `zone.ring` 2 px from R to R + 34 in 1.4 s (ease-out), α 0.9 → 0; the orbit fades in; "orbit stable" at +0.2 s |
| Stable | after the flash; under the win card | `zone.stable` 1.6 px, α 0.88 → 1 / 6 s (static α 0.95 under the result scrim) | α 0.30 → 0.40 | the closed orbit solid `zone.ring` 1 px α 0.6 with the ship on it; "orbit stable · peri N · apo N" |
| Flyby | ship left the zone unbound (lost, `flyby`) | α 0.30 | α 0.06 | a `zone.lost` cross (8 px, 1.6 px) at the exit point; "flyby · left the zone" |

| Token | Hex | Used for |
|---|---|---|
| `zone.ring` | `#3DE0C2` | Ring, band, capture orbit, wave, mint chips (= `planet.x.ring`) |
| `zone.stable` | `#B5FFF0` | The ring once the orbit is stable (= `planet.x.highlight`): the colour change |
| `zone.flash` | `#FFFFFF` | The ring's peak at the moment of capture |
| `zone.exit` | `#FFC857` | Exit arc and the too-fast hint (= `event.next`) |
| `zone.lost` | `#B48CFF` | The flyby cross and chip (= `result.lost`) |

## 18. Sol bodies (v3.1, the Sol campaign)

Files: `assets/sol/*.svg` (16 assets), mockup `mockups/sol-moon.svg` (mission 1, Moon orbit), gallery `preview/sol.html`. Renderer notes: `threejs-notes.md` §21. These are our own Sun, planets, moons and Kuiper objects. They must read as the real bodies at a glance, in the same realistic, vibrant and crisp style as the library.

- **Size ladder.** r = 34 √(R / R⊕): Earth keeps the home planet's r 34, and the order and proportions stay true while Jupiter still fits on screen. The crash radius is r. The Sun is off the ladder (109 R⊕) and stays a game-scale star, r 46. Arrokoth is drawn at a minimum readable size.
- **Real geography.** Features are placed from longitude and latitude, never random noise: Earth's continents and deserts, the Moon's maria, Mars's albedo features, Jupiter's belts and spots, Saturn's ring radii. Noise only roughens edges and adds texture inside them.
- **Strips.** Rotating bodies use the planet strip construction: x = (lon + 180)/360 · P and y = r − r sin(lat), with every feature drawn at x and x + P. They scroll west → east, except Venus's clouds, which run retrograde. The visual periods are slow game periods, not real ones.
- **Fixed faces.** The Moon, Pluto and Charon are tidally locked and keep fixed faces: the Moon's near side, and the sides New Horizons saw.
- **Lighting.** Everything is lit from the upper-right with the planet reference construction (§4.1). Airless bodies get a hard terminator and no haze. Earth's city lights show on the night side only.
- **Easter-egg hints only:** Voyager's golden record, and the sunspots as a nod to an active, living Sun. No logos, no characters.

| Body | File · group · ids | r | Motion | What makes it read as itself |
|---|---|---|---|---|
| The Sun | `sun.svg` · `#solSun` · `solSun*`, `sol*` | 46 | star.svg motion; spots 180 s | the approved sun J plus five sunspot groups in the ±10–18° activity belts (penumbra `#B8401E`, umbra `#4A1006`) |
| Mercury | `mercury.svg` · `#mercury` · `mer*` | 21 | 300 s | warm tan-grey regolith, craters, Caloris, ray craters; airless |
| Venus | `venus.svg` · `#venus` · `ven*` | 33 | 96 s retrograde | unbroken pale-gold cloud deck, soft bands, faint Y chevrons, bright haze |
| Earth | `earth.svg` · `#earth` · `eth*` | 34 | 90 s, clouds 64 s | real continents with biome colour by latitude, real deserts, shallow shelves, sea ice, clouds weighted to the ITCZ and storm tracks, night-side city lights |
| The Moon | `moon.svg` · `#luna` · `lun*` | 18 | locked | near-side maria, Tycho, Copernicus and Kepler rays; airless |
| Mars | `mars.svg` · `#mars` · `mar*` | 24.8 | 92 s | rust plains, Syrtis Major, Meridiani, Acidalium, Hellas, Argyre, Tharsis, Valles Marineris, caps, thin pink haze |
| Jupiter | `jupiter.svg` · `#jupiter` · `jup*` | 114 | 240 s | the real belts and zones (LUT on latitude), Great Red Spot in its hollow, Oval BA, white ovals, NEB hot spots and festoons, barges, lavender poles |
| Saturn | `saturn.svg` · `#saturn` · `sat*` | 104.6 | 260 s | pale-gold bands, blue polar hexagon; rings at real radii (C, B, Cassini Division, A, Encke Gap, F), back half behind and front half over the planet, the planet's shadow on the rings, the rings' shadow on the globe |
| Titan | `titan.svg` · `#titan` · `tit*` | 21.6 | 160 s | orange haze with no surface, a darker north hood, the detached blue outer haze |
| Uranus | `uranus.svg` · `#uranus` · `ura*` | 68.1 | 140 s | pale cyan; axis tipped 98°, so the bands run pole to pole on screen; faint, nearly face-on rings |
| Neptune | `neptune.svg` · `#neptune` · `nep*` | 67 | 120 s | deep blue, Great Dark Spot with its white companion, the Scooter, D2, white cirrus |
| Pluto | `pluto.svg` · `#pluto` · `plu*` | 14.7 | locked | Tombaugh Regio (the heart), Cthulhu, a thin blue haze |
| Charon | `charon.svg` · `#charon` · `cha*` | 10.5 | locked | grey with the red Mordor Macula at the north pole |
| Eris | `eris.svg` · `#eris` · `eri*` | 14.5 | — | bright ice |
| Arrokoth | `arrokoth.svg` · `#arrokoth` · `arr*` | 6 (min) | — | red two-lobed contact binary |
| Voyager | `voyager.svg` · `#voyager` · `voy*` | — | — | high-gain dish, bus, golden record, RTG and science booms, antennas; not solid |

| Token | Hex | Used for |
|---|---|---|
| `earth.ocean` | `#1D56CF` | Earth's oceans (shelf `#36B9D8` = `ocean.shallow`) |
| `earth.desert` | `#E2B66A` | Real deserts (dunes `#F0CC84`, rock `#B5763E`) |
| `earth.city` | `#FFD27A` | City lights, core `#FFF1C2`, fringe `#FF9A3C`, night side only |
| `mars.rust` / `mars.dark` | `#C8643A` / `#7E3E2A` | Mars plains and albedo features |
| `jupiter.zone` / `jupiter.belt` / `jupiter.grs` | `#F5E3C6` / `#A3502D` / `#DC5C34` | Jupiter's zones, belts and the Great Red Spot |
| `saturn.ringB` / `saturn.ringA` / `saturn.ringC` | `#F2E6D2` / `#DCC398` / `#B49A76` | Saturn's rings (ivory, never grey) |
| `uranus.body` | `#99DDE6` | Uranus |
| `neptune.body` / `neptune.spot` | `#4B7DF2` / `#1C2F86` | Neptune and its dark spot |
| `titan.haze` | `#E2A04A` | Titan (outer haze `#9CC4FF`) |
| `pluto.heart` / `pluto.cthulhu` | `#F6EBDD` / `#6B3322` | Pluto |

Every other hex value is listed in its asset's header, which is canon.

