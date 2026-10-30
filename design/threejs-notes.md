# Slingshot — Three.js implementation notes (v2)

How to build the v1.5 realistic look in the game's actual renderer: the orthographic Three.js scene introduced in WP3 (PR #4). `canvas-notes.md` stays the pixel-exact reference for how each SVG recipe looks and what it costs. This file translates those recipes into the game's `Visual` factories and GLSL. Everything here is a recommendation for whoever implements the realistic visuals. It changes no code, and the simulation is never touched.

Read with: `style.md` (tokens and rules), `assets.md` (one row per asset), the asset SVG header comments (the canon for every number), and in the code `src/render/visual.ts`, `src/render/visuals/index.ts`, `src/render/theme.ts`, `src/render/palette.ts`.

Sections: §0 how the renderer is put together · §1 rules for the realistic visuals · §2 translating SVG filter recipes to GLSL · §3 planets · §4 stars · §5 compact objects · §6 moons and moon chains · §7 environment (nebulae, debris, rings) · §8 palette and colour · §9 budget · §10 asset → factory map, with what WP8 needs · §11 the magnetism map and fuzzy prediction (WP9) · §12 comets and the solar recharge indicator (WP10) · §13 the modular ship, damage, hull HUD and upgrade screen (ship systems) · §14 belts, Kuiper belt, rogue planet, radiation map and dose (WP11) · §15 burn plume, burn node and gravity grid styling · §16 late-game megastructures and wormholes; §4.6 living star surfaces · §17 collisions and consumption (LU3) · §18 ghost markers (LU2). Coding agents: `IMPLEMENTING.md` is the rulebook; `IMPLEMENTATION-REVIEW.md` lists fixes for what is already built.

---

## 0. How the renderer is put together (as of `main` a376eee)

- **`SpaceView`** (`src/render/view.ts`) renders three scenes per frame with `autoClear = false`: `background` (screen camera), `world` (top-down orthographic camera, or the tilted perspective camera for the gravity sheet) and `screen` (screen camera, stroke widths do not zoom). `WebGLRenderer` with `antialias: true`, `NoToneMapping`, `outputColorSpace = SRGBColorSpace`.
- **Visuals** implement `Visual { object, space, resize?, update(frame), dispose }` and are created only through `visualFactories` in `src/render/visuals/index.ts`. Swapping one factory swaps one element. Order in that map is draw order within a space.
- **Body quads.** `shader(fragment, uniforms)` (`visuals/materials.ts`) makes a transparent `ShaderMaterial` with no depth test, and the vertex shader passes `vLocal = position.xy`. Bodies use `PlaneGeometry(2, 2)` scaled by the radius, so **`vLocal` runs −1…1 across the body radius**. The star quad is `PlaneGeometry(400, 400)` scaled by `radius / 46`, so its `vLocal` is in **SVG sprite units** (body edge at 46, glow at 200).
- **World units = SVG units at zoom 1.** Level radii match the design (Passage: star r 46, home r 32, target r 26 with capture 72). Every frequency, radius and displacement in an SVG header can be used in world units unchanged.
- **Time.** Positions come from `bodyPose(body, simTime, bodies)`, with `simTime = (planning ? 0 : ship.step) * level.dt`. Cosmetic motion (spin, breathe, flames, pulses) uses `frame.now` in wall-clock ms, so it keeps moving while the sim is paused. Keep both rules: positions on sim time, looks on wall time.
- **Light.** `PlanetsVisual` computes a 2D unit vector from each planet to the star every frame (`planet.light`). Lighting must stay a function of that vector only (it never rotates with the texture).
- **DPR.** `view.ts` uses `min(devicePixelRatio, 2)`. Recommend also clamping below at 1 (`Math.min(2, Math.max(1, dpr))`) so baked textures are never built smaller than their CSS size.
- **Asset URLs.** `theme.assets.*` are kept only as `userData.asset` labels; nothing samples the SVGs today. Colours come from `palette.ts`, which mirrors the v1 tokens of `style.md`.

## 1. Rules for the realistic visuals

1. **Bake, don't recompute.** Anything that does not change per frame (planet surfaces, cloud decks, plasma texture, nebulae, rock sprites, ring bands) is baked once into a texture: at load, and again when the zoom crosses a bucket (25 % steps, `canvas-notes.md` §12). Per frame a body costs texture samples, a UV rotation and lighting math.
2. **Per-pixel noise only where it must move unpredictably**, which means only the star's flame rings. Even those can be 2–3 baked frames cross-faded (§4). The roadmap's no-GPU machine dropped from 23 to 16 fps with the gravity map on, so assume a weak GPU.
3. **Crisp, not blurry.** Thresholds use `fwidth` antialiasing (§2), never a wide `smoothstep`. No post-process blur. If bloom is added, apply it to the world scene only, with a high threshold (§4).
4. **No grey textures on coloured bodies.** Every noise layer is tinted with its zone colour before compositing (the client rejected grey granulation).
5. **Lighting never rotates.** Surface textures spin; the shade, warm terminator band, haze, rim and glint are functions of the light vector and the disc position only.
6. **Simulation untouched.** No visual reads or writes sim state beyond `bodyPose` and the level. Tests already lock prediction against flight.

## 2. Translating SVG filter recipes to GLSL

| SVG | GLSL |
|---|---|
| `feTurbulence type="fractalNoise" baseFrequency f numOctaves n seed s` | `fbm(p * f, n)` of gradient noise with a seeded offset `p + seedOffset(s)`. Chrome's fractalNoise values sit around 0.5 with a narrow spread, so **match thresholds by coverage, not by raw value**. The headers state the intended coverage (land ≈ 32 %, clouds ≈ 30 %), and `canvas-notes.md` §4 has the measured quantile tables. |
| `type="turbulence"` (ridges, filaments) | `abs(noise)` summed over octaves. Ridges are the low values: `1 − smoothstep(0.0, w, ridge)`. |
| `feComponentTransfer feFuncA linear slope s intercept b` | A ramp from `e0 = −b/s` to `e1 = (1 − b)/s`. Make it crisp: `aa(e0, e1, n)` below. |
| `feDisplacementMap scale k` with opaque noise | Domain warp: `p += (vec2(noise(p*f), noise(p*f + 17.3)) − 0.5) * k`. |
| `feGaussianBlur σ ≤ 0.5` | Drop it; the `fwidth` antialiasing replaces it. Larger blurs (flame 0.4/0.8, wisps) belong in the bake. |
| `stitchTiles` + `feTile` (rotating strips) | Not needed. Sample an equirectangular texture with `RepeatWrapping` in u (§3). |

```glsl
// gradient noise (2D) and fbm — compact, deterministic, good enough for bakes and flames
vec2 h2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(h2(i), f), dot(h2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(h2(i + vec2(0, 1)), f - vec2(0, 1)), dot(h2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y) * 0.5 + 0.5;
}
float fbm(vec2 p, int oct) { float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * gnoise(p); n += a; p = p * 2.03 + 11.7; a *= 0.5; } return s / n; }
// crisp threshold: a 1-pixel antialiased edge at the ramp's midpoint, so a steep SVG slope stays steep at every zoom
float aa(float e0, float e1, float v) { float m = 0.5 * (e0 + e1); float w = max(fwidth(v), 0.25 * (e1 - e0)); return smoothstep(m - w, m + w, v); }
```

## 3. Planets (home, target, library planets, moons)

**Bake the surface once as an equirectangular texture** (2:1, width `round(2πr) × bucket × DPR`). There are two ways to fill it:
- **(a) Reuse the SVG recipe directly.** Each asset's strip is already longitude × disc-height with period P (header: "period P", "strip 2P × 2r"). Render one period of the strip group into an offscreen canvas through an `Image` of a small SVG made from the asset's `<defs>` + strip group, then wrap it as a `CanvasTexture`. That gives the exact approved look with zero shader porting. Planet X, ice, lava and the icy moon use the seamless v1.5.1 strips; the rest use stitched noise with `feTile`, which rasterises correctly when rendered on its own (the Chrome artefact in `assets.md` only appears in nested previews).
- **(b) Port the zones to a bake shader** (render to a `WebGLRenderTarget`) using §2. This is faster to iterate on and resolution-independent.

**Draw** with one quad per planet, enlarged to `1.1 × r` so the outer rim fits (divide `vLocal` by 1.1 in the shader). Map the disc onto a real sphere, so features foreshorten at the limb: a visible improvement over the flat scrolling strip of the SVGs.

```glsl
varying vec2 vLocal;            // −1.1 … 1.1 (quad scaled to 1.1 r)
uniform sampler2D uSurface;     // equirect, RepeatWrapping in u
uniform sampler2D uClouds;      // optional, own spin
uniform vec2  uLight;           // planet → star, unit (already computed in PlanetsVisual)
uniform float uSpin, uCloudSpin;// radians, from frame.now and the asset's period (90 s etc.)
uniform vec3  uWarm, uNight, uHaze, uRim;   // #FF9455, #050B1E, #8FD0FF, #A8DBFF (per body, see style.md)
const float PI = 3.14159265;
void main() {
  vec2 q = vLocal / 1.1;
  float r = length(q), fw = fwidth(r);
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r * r)));
  vec2 uv  = vec2(fract((atan(n.x, n.z) + uSpin) / (2.0 * PI)), 0.5 + 0.5 * n.y);   // v linear in disc height, like the strip
  vec3 col = texture2D(uSurface, uv).rgb;
  vec2 cuv = vec2(fract((atan(n.x, n.z) + uCloudSpin) / (2.0 * PI)), uv.y);
  vec4 cl  = texture2D(uClouds, cuv);
  float sh = texture2D(uClouds, cuv + vec2(0.006, -0.006) * vec2(-uLight.x, uLight.y)).a;   // cast shadow, away from the light
  col = mix(col, vec3(0.024, 0.071, 0.18), 0.45 * sh);
  col = mix(col, cl.rgb, cl.a * 0.78);
  vec3 L = normalize(vec3(uLight, 0.62));                 // z = 0.62 reproduces the references' gibbous terminator
  float d = dot(n, L);
  col *= 0.25 + 0.75 * smoothstep(-0.05, 0.55, d);       // day side
  col = mix(col, uWarm, 0.24 * exp(-pow((d - 0.03) / 0.07, 2.0)));   // warm terminator band
  col = mix(col, uNight, smoothstep(0.02, -0.18, d));    // night
  float lit  = smoothstep(-0.35, 0.65, dot(normalize(q + 1e-5), uLight));   // lit-side mask (1 → 0.06 in the SVGs)
  col = mix(col, uHaze, pow(1.0 - n.z, 3.0) * 0.42 * lit);                  // inner haze
  float disc = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, r);
  float rim  = exp(-pow((r - 1.0) / 0.03, 2.0)) * 0.95 * lit;                // thin outer rim at r ≈ 1.0–1.08
  float a = max(disc, rim);
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uRim, col, disc), a);
}
```

- **Airless bodies** (moons, dwarf): drop the clouds, haze and rim, and harden the terminator (`smoothstep(-0.02, 0.12, d)`).
- **Planet X**: keep the existing `haloFrag` and `ringFrag` (dash crawl, pulse, win lock) and swap only the disc shader.
- **Gas giants**: the bands are a texture too. Counter-flowing band groups become 2–3 textures with their own spin uniforms, combined by a latitude mask.
- **Ringed planets**: see §7.

## 4. Stars

One quad as today (`span 400`, scaled `r / 46`), with layers back to front matching `star.svg`:

1. **Haze**: keep the current radial gradient, recoloured to the v1.5 haze tokens.
2. **Flames and wisps**: the ragged look comes from a displaced, solid-filled disc. In GLSL, warp the radius by angular noise in polar coordinates, `rr = r − k * (fbm(vec2(θ * 6.0, r * 0.08) + t) − 0.5)`, then apply the flame gradient to `rr` (stops 0.74 / 0.82 / 0.91 / 1.0 of r 62). Rotate `θ` by `t / 200 s` for the flames and `−t / 300 s` for the wisps. For weak GPUs, bake 3 flame frames at different noise offsets and cross-fade them over 6 s; the rotation stays a cheap UV rotate.
3. **Prominences and flare**: analytic two-tone arcs (outer 2.8 units of the prominence colour at α 0.85, inner 1 unit of `#FFF1C2` at α 0.9), each with its own scale and opacity timeline taken from `star.svg` (12 / 16 / 14 s cycles starting at 0 / 5 / 9 s; flare peak at 13.9 s of 22 s).
4. **Surface**: a baked plasma texture (body gradient + dark plasma regions, alpha ≤ 0.55 + bright filaments). It may spin slowly; it does not need sphere mapping at r 46, but a red giant at r 120 benefits from it.
5. **Limb and wobbling rim**: perturb the disc radius by fine angular noise (`r' = r * (1 + 0.035 * (gnoise(vec2(θ * 9.0, 0.0)) − 0.5))`, the SVG's displacement 6.5 / 46). Draw the limb gradient (0.80 α0 → 0.93 α0.55 → 0.97 α0.9 → 1.0 α0.95) on `r'`, plus a 1.6-unit ragged bright stroke.

**4.6 Living surface.** The disc must move (`style.md` §13 "Living surfaces", reference `assets/star-surface-motion.svg`). The SVG-raster route: bake the body gradient once, then bake the dark-plasma, deep-plasma and three cell layers as separate wide textures (2 × the disc width, so they can slide). Inside the disc clip, slide the plasma layers in opposite directions (one diameter per 90 s and per 140 s), cross-fade the cell layers on a 9 s cycle staggered by 3 s, and draw 5 facula sprites at 0.85 r twinkling over 3.7–6 s. Then draw the limb with a 3 s, 10 % shimmer and the static ragged rim. The shader route: the same three terms with time-offset UVs (`uv.x ± t / P`) on fbm and turbulence noise, plus the faculae. Keep it under 0.3 ms at r 46. Use `frame.now`, never sim time, and keep the rim, the radius and the lighting still.

**Bloom.** The authored haze already gives the glow, so prefer no post-processing. If you add `UnrealBloomPass`, run it on the world scene only, with threshold ≈ 0.85 and strength ≤ 0.6, so only star cores and flare peaks bloom. It needs an `EffectComposer` slotted into `SpaceView.render` between the world pass and the screen pass; budget 1–2 ms.

**What WP8 needs from the code:**
- **Binary stars**: `createStar` draws only the first `kind: "star"` body (`level.bodies.find`). It must create one quad per star, each with its own look (the primary is `binary.hot.*`, the secondary `binary.cool.*`). Planet lighting uses one star today. With two, either light from the brighter star or sum two Lambert terms weighted by luminosity / distance².
- **Red giant**: a separate look (bigger cells: frequencies about half the sun's, gentler filaments, diffuse flames, softer rim) plus the drag atmosphere. The atmosphere radius is physics, so it should come from level data. The schema has `dragStrength` but no radius yet; a body field such as `atmosphereRadius` is an engineering decision. Draw it as a radial gradient (α 0.30 → 0.16 → 0.08 → 0) plus a dashed boundary ring; reuse `ringFrag`'s dash logic with `#FFB07A` at α 0.30, dash 10 / 6, crawling −8 px/s.
- **White dwarf**: a small bright disc with a wide glow and four static diffraction spikes (`white-dwarf.svg`), with a hard crash radius.

## 5. Compact objects

- **Black hole** (today: dark disc + one photon ring): add the accretion disk as its own ring quad, in polar coordinates and scaled `(1, 0.55)` for the tilt. Draw it in two meshes: the back half (`y > 0` in disk space) before the shadow, the front half after it. Apply a Doppler factor (left side brighter, 1.0 → 0.55), a fiery filament texture scrolling in angle, the lensed arcs over and under the shadow, and the faint Einstein ring at 2.1 r. The horizon radius stays `body.radius`. Numbers are in `black-hole.svg`.
- **Neutron star** (quiet): two beam cones rotating 360° per 6 s about a 30°-tilted axis, plus a tight violet glow (`neutron-star.svg`). No beam damage.
- **Pulsar** (WP9, `pulsar.svg`): three layers like the neutron star, but the beam layer is two long narrow cones (base 4, tip 18, reach 228) plus the afterglow fan, in one quad rotated by `2π · simTime / period`. Use **sim time**, not `frame.now`, because the beam is a hazard: what is drawn must be where the damage is, in prediction as in flight. Reach and period come from level data.
- **Magnetar** (WP9, `magnetar.svg`): body and glow as a sprite; the field lines are static, so bake them once into a texture with one channel per line group and animate in the shader: flowing dashes as `step(fract(s / period − t · speed), duty)` along each line's arc length `s` (bake `s` into a second channel), and the uneven flicker as a per-line alpha from `frame.now`. The static grain is one noise texture sampled at two offsets and cross-faded over 5 s, thresholded at about 3 % cover, masked to r 24–120. The starquake ring is cosmetic (`frame.now`).

## 6. Moons and moon chains

- Moons are `kind: "moon"` bodies on `orbit { centerId, radius, phase, omega }`, drawn with the planet shader (airless variant), lit from the star. As in the SVGs (`animateMotion`, no rotation), only the position follows the orbit; the lit side keeps facing the star.
- **Moon chain** (`bodies/moon-chain.svg`): a gas giant with four moons on a 1:2:3:4 resonance, `a_n = 68 n^(2/3)`, periods 18 / 36 / 54 / 72 s in the preview. In a level, set `omega_n = 2π / P_n` with the same ratios. Each moon needs a look (volcanic, icy, barren, dwarf). Today there is no per-body look field; a `look` key in the level JSON, mapped to a texture and palette, is the simplest route (engineering decision).
- The game is top-down: orbits are coplanar circles, so moons never pass in front of or behind their planet. `double.svg` and `moon-system.svg` show tilted orbits with z-order swaps; treat those as previews, and use the moon-chain construction in the game.

## 7. Environment (v1.4 assets)

- **Nebulae**: one big world-space quad per nebula, its texture baked once from the SVG (or two textures cross-faded over 40 s for the slow morph). Draw before the bodies. They are gas, so these are the only soft textures.
- **Asteroid fields and wreck debris**: an `InstancedMesh` of quads sampling a sprite atlas (one cell per rock shape, baked with its two-tone lighting toward the star). Tumble each instance by rotating its UVs inside the cell, never the lighting. Large rocks are the crash bodies; dust stays visual.
- **Rings** (Saturn-like, debris, shepherd): a polar-coordinate ring quad scaled `(1, tilt)`, split into back and front halves like the black-hole disk, with the planet's shadow wedge on the back half and the ring's shadow band on the planet (a uniform passed to the planet shader). Particle sparkle is a baked texture rotating at the Keplerian rates in the asset header.

## 8. Palette and colour

- Keep writing sRGB hex straight out of the shaders (`srgbVec`), with `NoToneMapping`.
- `palette.ts` still holds the v1 tokens (`starBody #FFC857`, `planetStartBase #3D8BFF` and so on). The v1.5 tokens in `style.md` replace them for bodies: ocean `#1E5BD6`, shallow `#36B9D8`, land `#5FA84A`, forest `#3B7E3B`, desert `#D8B26E`, warm terminator `#FF9455`, night `#050B1E` / `#08122E`, sun body `#FFB43A` / `#FF8F1F` / `#FF7A14`, filament `#FFE7A0`, flame `#FFB347` / `#FF6A1A`, and the rest. **UI tokens are unchanged.**
- New WP8 tokens are listed in `style.md` §8 (binary hot and cool, red giant, drag atmosphere).
- New WP9 tokens are listed in `style.md` §8 WP9 (pulsar, magnetar, `magmap.*` zones, `path.ghost`).
- New WP10 tokens are listed in `style.md` §8 WP10 (`comet.*`, `solar.*`).
- Ship systems tokens are in `style.md` §10 (`ship.*`, `plume.*`, `damage.*`, `hull.*`, `stress.*`).
- WP11 tokens are in `style.md` §11 (`belt.*`, `kuiper.*`, `rogue.*`, `rad.*`).

## 9. Budget (targets for an integrated GPU, 1440×900 at DPR 2)

| Item | Per-frame work | Target |
|---|---|---|
| Planet / moon disc | 2–3 texture samples + lighting, quad at 1.1 r | < 0.05 ms each |
| Gas giant | 3 band samples + lighting | < 0.1 ms |
| Star (procedural flames) | 2 × 4-octave fbm per pixel over the flame annulus | 0.3–1.5 ms depending on zoom; **use baked frames when the star covers > 25 % of the screen** |
| Star (baked flame frames) | 3 samples + UV rotate | < 0.1 ms |
| Black hole | hole + 2 disk halves + arcs | < 0.2 ms |
| Nebula | 1–2 samples over its quad | < 0.2 ms |
| Asteroid field (120 rocks) | 1 instanced draw | < 0.1 ms |
| Bloom (optional) | `UnrealBloomPass` on the world scene | 1–2 ms |
| Bakes | at load and on zoom-bucket change only | ≤ 30 ms total, never per frame |

## 10. Asset → factory map

| Design asset(s) | Factory today | What changes |
|---|---|---|
| `planet-start.svg`, `planet-x.svg`, `bodies/*` planets and moons | `createPlanets` (one flat lit disc) | sphere-mapped baked texture + clouds + v1.5 lighting (§3); halo and ring kept for X |
| `star.svg` | `createStar` (radial gradient, first star only) | layered plasma star (§4); one quad per star for binaries |
| `bodies/binary-star.svg` (new, WP8) | — | two star quads with hot / cool looks; planet lighting from two stars |
| `bodies/red-giant.svg` (new, WP8) | — | red-giant look + drag atmosphere ring from level data |
| `bodies/moon-chain.svg` (new, WP8) | `createPlanets` (moons) | per-moon look; resonant orbits are level data |
| `bodies/white-dwarf.svg` | — | small bright disc, wide glow, spikes; hard crash radius |
| `bodies/black-hole.svg` | `createPlanets` (`holeFrag`) | accretion disk halves, Doppler, lensed arcs (WP9) |
| `bodies/neutron-star.svg` | — | quiet neutron star: rotating faint beams (WP9) |
| `bodies/pulsar.svg` (new, WP9) | — | beam quad rotated by sim time; reach and period from level data (§5) |
| `bodies/magnetar.svg` (new, WP9) | — | baked field lines + shader dashes and flicker, static grain, starquake (§5) |
| `overlays/magnetism-heatmap.svg` (new, WP9) | — | new `createMagnetism` visual on M; fuzzy spread on the predicted path (§11) |
| `bodies/comet.svg` (new, WP10) | — | new `createComets` visual: head sprite + tail quads turned away from the star (§12) |
| `solar-recharge.svg` (new, WP10) | path visual, HUD | gold path dots, fuel-block glyph and shimmer, ship pulse (§12) |
| `ship/*.svg` (new, ship systems) | `createShip` (v1 polygons) | layered part sprites per build, one plume per engine, damage overlay by hull % (§13) |
| `hud-hull.svg` (new, ship systems) | HUD (DOM) | hull bar, tidal-stress chip; tidal chevrons as a screen-space visual (§13) |
| `space/belt-*.svg`, `space/kuiper-belt.svg` (new, WP11) | `scenery.ts` (circle rocks) | instanced rock atlas lit toward the star, seeded placement, edges in planning (§14) |
| `bodies/rogue-planet.svg` (new, WP11) | — | dark disc, thermal bands, cold rim, drift arrow (§14) |
| `overlays/radiation-map.svg`, `hud-dose.svg` (new, WP11) | — | halftone dose shader on R; dose meter in the status stack (§14) |
| `space/*` nebulae, asteroid field, wreck | — | WP10 / WP11 layers (§7) |
| `starfield.svg` | `createStarfield` (canvas texture) | add the v1.1 magnitude tints and the faint band when the sky is next touched |
| ship, thrust, path, arrow, HUD | existing factories | unchanged by this design update (the game's own plume already moved past v1). The flown trail was removed from the game in PR #16; `trail.svg` stays as a design reference only |

## 11. Magnetism map and fuzzy prediction (WP9)

The design is `overlays/magnetism-heatmap.svg` (one body) and `mockups/magnetism-map.svg` (in context); values and tokens are in `style.md` §8 WP9.

**Field.** Give each magnetic body `magnet { b1Reach, tilt, averaged? }` in level data: `b1Reach` is R1, the polar reach of the Fuzzy zone; `tilt` is the axis angle from vertical. Choose `k` so that |B| = B1 at r = R1 on the axis: `k = B1 · R1³ / 2`. Then for a point `p`, sum the dipole vectors (not magnitudes), so neighbouring fields can cancel or reinforce:

```glsl
// m = unit magnetic axis, d = p - centre, r = length(d), n = d / r
vec2 dipole(vec2 d, vec2 m, float k) {
  float r = max(length(d), 1.0);
  vec2 n = d / r;
  return k * (3.0 * dot(m, n) * n - m) / (r * r * r);   // |B| = k * sqrt(1 + 3 cos^2) / r^3
}
```

A pulsar's axis spins with its beams, so use the rotation-averaged magnitude `k · 0.894^3 · 2 / r³` (circular zones) rather than a flickering field. Put the field in a pure function next to the physics (`fieldAt(p, time, bodies)`), so the map, the fuzzy prediction and the tests all read the same numbers.

**Map shader.** One screen-space quad (or one quad per magnetic body, padded to 1.1 R1) in the world scene, drawn after the gravity grid and before the bodies. In the fragment shader compute `x = |B| / B1` from up to 8 dipoles in a uniform array, pick the zone with steps on `x` (1, 2.5, 6, 15), and draw the edge where the zone index changes, with a line one pixel wide using `fwidth`:

```glsl
float z = step(1.0, x) + step(2.5, x) + step(6.0, x) + step(15.0, x);   // 0 = safe … 4 = lethal
float lx = log2(max(x, 1e-4));
// distance to the nearest threshold, in log space, converted to pixels
float e = min(min(abs(lx - 0.0), abs(lx - 1.3219)), min(abs(lx - 2.585), abs(lx - 3.9069)));
float edge = 1.0 - smoothstep(0.5, 1.5, e / fwidth(lx));
```

Fill with the zone's colour at its fill alpha, then the edge at its edge alpha. Dash the Fuzzy edge by arc angle around the strongest body (`fract(atan(d.y, d.x) · R / 11.0 − t)`, crawling 11 px/s) and breathe the Lethal edge over 2.4 s with `frame.now`. Keep the zone fills flat: no gradient inside a zone, so the map stays crisp at every zoom.

**Toggle.** M key and a "Magnetism" HUD button next to the gravity button, with `aria-pressed`, shown only when the level has a magnetic body. The legend panel shows while it is on. Like G, the toggle is visual only: tests must show the sim and the prediction are identical with the map on or off.

**Fuzzy prediction.** After predicting the path as today, walk it in 10 px steps and accumulate `σ += 6.0 · log2(max(x, 1.0)) · step / 100.0`, never decreasing. This is deterministic, so prediction and flight still match bit for bit; only the drawing changes. Draw the normal dots while σ < 0.6 px, then fade them, add the ±σ envelope as a triangle strip, and scatter two sets of ghost dots inside it, seeded by sample index so they do not swim, swapping every 0.3 s. Grow the end ring to r 6 + σ. The Sensors upgrade can scale the 6.0 factor down.

**Budget.** One full-screen pass with up to 8 dipoles is about 40 ALU per pixel, well under 0.2 ms on an integrated GPU at DPR 2. Skip the pass entirely when M is off.

## 12. Comets and solar recharge (WP10)

The designs are `bodies/comet.svg`, `solar-recharge.svg` and `mockups/comet-recharge.svg`; values and tokens are in `style.md` §8 WP10.

**Comet orbit.** Comets need eccentric orbits. Suggested level data: `orbit { kind: "ellipse", centerId, a, e, periapsisAngle, phase }`, solved per frame with Kepler's equation (a few Newton steps on `M = E − e sin E`), so the comet is fast near the star and slow far out. Keep it in `bodyPose` so prediction and flight stay bit-for-bit identical.

**Comet visual.** One group per comet in world space, built from three pieces:

1. **Head**: one quad with the coma, core and jets as a baked sprite, plus the nucleus drawn with the airless planet shader (lit from the star).
2. **Tails**: one quad from the nucleus out to the tail length, rotated each frame to `atan2(p.y − star.y, p.x − star.x)` and scaled by `s = clamp(Rperi / d, 0.35, 1)` along the tail. Bake the dust strands and ion rays into a texture (dust in one channel, ion in another, strand index in a third), then colour them in the shader with the two gradients from the asset header.
3. **Motion in the shader**: the solar-wind streaks are `step(fract(x / 100 − t / 2.5), 0.4)` along the ion channel; the disconnection knot is a soft ellipse moving out every 9 s; the dust sparkles are 8 points sampled along strand curves. All of it is cosmetic, so drive it with `frame.now`.

Mirror the tail quad's y when the comet's angular velocity around the star changes sign, so the dust always lags the motion. The harvest ring is a ring quad like Planet X's capture ring, shown in planning and pause only.

**Solar recharge.** Put the rate in a pure function next to the physics, `rechargeRate(p, bodies, ship)`, returning `rateMax · Σ L · min(1, (Rref / d)²)` over stars, so the HUD, the path tint and the fuel integration all read the same number. It must be in the prediction, because fuel collected changes what burns are affordable.

- **Path dots**: after predicting, compute `t = rate / rateMax` per dot and use the colour, radius and alpha rule from `style.md` (a per-instance colour and size on the existing dot mesh). Sum the predicted gain for the end-ring label and the planning ghost segment.
- **HUD**: the glyph, shimmer, sliver and rate text are DOM, next to the fuel bar. Animate the shimmer with a CSS gradient whose `background-position` moves every 1.8 s, or 0.9 s on a close pass (rate ≥ 0.6 · rateMax).
- **Ship pulse**: a ring quad under the ship sprite, radius 9 → 18 and alpha 0.75 → 0 every 1.2 s, while `rate > 0` in flight.

**Budget.** Comet: 2 quads and 2–3 texture samples, under 0.1 ms each. Recharge: per-dot colour on the existing path, so it is free.

## 13. Modular ship, damage and hull HUD (ship systems)

The designs are `assets/ship/*.svg`, `assets/hud-hull.svg`, `mockups/upgrade-screen.svg` and `mockups/flight-damaged.svg`; values and tokens are in `style.md` §10. `preview/ship.html` shows the parts stacked.

**Building the ship.** Keep `createShip` in screen space with the heading lerp. Replace the three v1 polygons with layered quads, one per part, all sharing the 96 × 160 frame (centre at (48, 64)), so every quad has the same size and anchor:

1. Bake each part SVG once into a texture at `scale × DPR` (the base hull is 48.6 units → 22 px, so scale 0.453 × zoom bucket). Rebake only when the build or the zoom bucket changes, never per frame.
2. Add quads in the draw order: back modules → plume → hull (with the nozzle) → front modules → damage. Plating has `#shipModPlatingBack` and `#shipModPlatingFront`; bake them as two textures.
3. The build comes from the ship's upgrade state (level or save data); the visual never changes the sim.

**Plumes.** Keep the existing plume shader for the chemical engine (it already matches `plume.chem`). Add two parameter sets:
- **Ion:** half-width 6 → 6.6, length about 55 units, turbulence near 0, a slow 2 s shimmer. Burns last longer with low thrust, so the beam stays on for the whole burn.
- **Pulse:** no continuous plume. Draw one flash quad per fuel pulse (every 0.6 s of sim time while burning), radius growing 5 → 17 units and fading, plus the plate glow. Key it to sim time so pause and slow motion freeze it.

The burn wind-up and tail timings (`theme.burn`) apply to all three. No separate bloom halo behind the plume.

**Module states** (cosmetic, `frame.now` unless noted): solar frame glows `#FFE08A` while `rechargeRate > 0`; scoop rims pulse while scooping; the shield arc flashes to α 1 for 0.2 s on a hit (sim event); the sensors tip blinks 1.4 s; cryo windows breathe 4 s.

**Damage.** Pick one overlay texture from hull %: none ≥ 80, `damage-75` ≥ 50, `damage-45` ≥ 25, else `damage-15`. The venting puffs, sparks and beacon animate in the overlay; drive them with `frame.now`. On a hit, flash the ship white for 80 ms.

**Hull HUD.** DOM next to the fuel block: 10 segment `div`s, colour by threshold, the critical pulse as a CSS animation. The tidal-stress chip shows only while stress > 0, with its level from the same tidal function the damage uses (`tidalStrength`, WP7c).

**Tidal chevrons.** A screen-space visual: two chevron pairs at 15–24 px from the ship, rotated to the direction of the strongest tidal source (the body with the largest `GM / r³` at the ship), pulsing every 0.8 s (0.5 s at level 3). They are shown in flight and, for the predicted path, at the first predicted point where stress starts.

**Upgrade screen.** DOM over a dimmed sky. The ship preview reuses the same baked part textures at 5.8×, so the shipyard and the game always show the same build. Cards are plain DOM with the thumbnails baked from the module SVGs.

**Budget.** At most 10 small quads plus one plume for the ship: well under 0.1 ms. Part rebakes are under 5 ms total, on build or zoom-bucket change only.

## 14. Belts, Kuiper belt, rogue planet, radiation map and dose (WP11)

Designs: `space/belt-sparse|medium|dense.svg`, `space/kuiper-belt.svg`, `bodies/rogue-planet.svg`, `overlays/radiation-map.svg`, `hud-dose.svg`, `mockups/belts-radiation.svg`. Values in `style.md` §11.

**Belts.** Level data: `belt { centerId, radius, width, tier, seed, arc? }`. Bake a rock atlas once: 6 silhouettes × the tier's types (S, C, M; K for the Kuiper belt), each drawn lit from −x exactly as the asset headers describe, at DPR × zoom bucket. Draw every rock with one `InstancedMesh` of quads: per instance a position (polar about the star from the seed), a scale (radius / 10) and a rotation `atan2(star − rock) − π`, so its lit side faces the star. The drift is one rotation of the whole instanced mesh about the star. Dust specks go into a second instanced mesh of plain discs. Edges are two dashed ring quads (px-space dashes, like the capture ring) in planning and pause.

**Collisions.** Generate the solid rocks (r ≥ 7) from the same seed in the sim, not in the renderer, so prediction sees them. For the dense tier, an optional `dustDamage` rate applies inside the band. Shielding reduces it.

**Kuiper belt.** The same pipeline with the K type, a wider band and mostly frost-coloured dust. The dwarf planet is an ordinary small body with the airless planet shader and the header's colours.

**Rogue planet.** `kind: "rogue"` with `velocity { vx, vy }`: position = start + v·t in `bodyPose`, so it stays deterministic. Draw it with its own small shader: dark radial body, the band strip scrolling west (no light vector), hot spots on `frame.now`, rim and airglow rings. It writes depth-free but opaque, so it covers the starfield. No `rechargeRate` contribution.

**Radiation map.** One full-screen pass in screen space, toggled by R. For each 12 px cell, find the cell centre, convert to world, evaluate `doseAt(p)` (the same pure function the sim uses: stars with luminosity, flare cone, belts, pulsar beam, disks, background, and a line-of-sight shadow test against up to 8 body discs), pick the zone, and draw an anti-aliased dot of the zone radius with `fwidth`. Skip cells inside bodies and inside HUD rectangles. Cost: ≈ 9 000 cells × a few sources, well under 0.3 ms; skip the pass when R is off.

**Dose.** In the sim step: `dose += doseAt(ship) · dosePerD1 · dt`, reduced by shielding. The prediction integrates the same, which gives the planning ghost and "+N mSv on this path". Ending below 25 % of the limit earns the bonus; reaching the limit fails the mission. The HUD block is DOM, as `assets/hud-dose.svg` specifies.

## 15. Burn plume, burn node and gravity grid styling

Designs: `ship/plume-states.svg`, `burn-node.svg`, `overlays/gravity-grid.svg`, `overlays/gravity-sheet.svg`, `mockups/planning-grid.svg`, `mockups/flight-burn.svg`. Values in `style.md` §12.

**Plume.** Keep the one-mesh plume (no bloom pass, no halo) and give the fragment shader the half-width function from §12. In local plume space (t along the axis, s across it), fill where `|s| < w(t)`, antialiased with `fwidth`, colour from the 5-stop ramp along t, plus the core at `0.42 L × 0.38 W`. Drive `rag` phases with `frame.now` (cosmetic). Set the length from the node's Δv: `L = min(110, 44 + 12 |Δv|)`, `W = 6.5 + L/40`. The state timings follow `theme.burn` on sim time: wind-up glow and lick before the node, the ignition ring and grow-in over 0.12 s, then the tail-off cutoff `c = elapsed / tail` (alpha 0 for `t < c`, a 0.15 soft edge), keeping the length.

**Burn node.** Draw it in screen space like today, swapping the disc for the ring, core and states in §12. The wind-up arc is a ring segment with `angle = 2π · (1 − remaining / windup)` on sim time. The ignition ring plays once at the burn step. Fired nodes keep their dashed ring until the level resets. The Δv chip and the delete button are DOM next to the selected node.

**Grid ink.** Keep `sampleGravityGrid` and the warp. Per vertex, compute `d` from the same potential the grid already samples. Pass `t = d^2.2` as a vertex attribute, map it through the `grid.depth` ramp in the fragment shader, and set alpha by §12 (major lines by index). Apply the edge fade in screen space, and skip segments inside body discs. Draw the tidal ring as a ring quad at the radius where the sim's tidal stress reaches level 1, with px-space dashes like the capture ring.

**Sheet.** Same vertices with `z = H · d^1.3`. Draw the cells as one indexed mesh (`#0B1430` α 0.55, depth-sorted, or two-sided with depth test on inside the sheet group only) and the lines on top with the grid ink. Fade the outer 5 cells. Bodies are offset to `z` of their well so they sit in the funnel.

## 16. Late-game megastructures and wormholes

Designs: `mega/*.svg`, `mockups/late-game.svg`. Values in `style.md` §13. Every structure is drawn around a real body, so build it as a group parented to that body's pose and scaled by its radius (the samples use a star of r 25.3 or 23, and the home planet at r 34).

- **Stellar engine:** a collector arc of instanced mirror tiles, two nozzle bars, and the jet as one quad along the engine's axis with the ragged-edge shader (3 phases, 0.5 s) and the 5-stop ramp, plus knot sprites. Jet length and direction are level data. The scoop margins and burning core use the same geometry in the sim.
- **Dyson swarm:** each shell is an ellipse stroke with dashes animated along it (inner shells faster). Split it into back and front halves around the star. The star's opacity and the recharge factor both come from `coverage` in level data. The heat ring is one radial quad.
- **Ringworld:** two half-ellipse bands with clip shapes: the far half shows a scrolling floor texture with cloud sprites and moving shadow-square night patches, and the near half shows the hull. Draw the star between them. Transit gaps cut both bands. The sim treats the ring as a circle of radius R.
- **Shkadov thruster:** a mirror arc mesh, a reflected-glow stroke, and 11 ray quads. The drift is `drift { ax, ay }` in level data, applied in `bodyPose` to every body. It is deterministic, and prediction sees it.
- **Space elevator:** a line from the planet's surface along its spin angle (the planet's own rotation), a station sprite, a counterweight sprite and climber sprites moving along it. Release velocity is `ω × r` at the counterweight, shown by the release arrow in planning.
- **Wormhole pair:** each mouth is a disc sampling a baked sky texture of the other end (rotating slowly) with radial compression toward the rim, an Einstein ring, a halo and a few arc sprites. Transit and the clock offset belong in the sim (`wormhole { a, b, angle, clockOffset }`).

## 17. Collisions and consumption (LU3)

Designs: `events/*.svg`, `mockups/showcase-burning-planet.svg`. Values in `style.md` §14. These replace the placeholder ring in `src/render/visuals/fates.ts`. Every event plays on **sim time**, from the script fields, so scrubbing the plan or pausing shows the same frame.

- **Impact** (`impact { at, into }`): at `at`, spawn at the impact point (the struck body's limb, along the line from the impactor):
  - a flash quad (radial `event.flash`, r 4 → 34 over 0.6 s)
  - a shock ring quad (r 6 → 80 over 1.3 s, px-space stroke)
  - a rim-flash ring on the struck body
  - 20 ejecta points on seeded ease-out paths in a ±35° cone along the surface normal, 2.7 s
  - a crater-glow sprite that fades over 3.6 s

  Afterwards, hand over to the debris field.
- **Debris field:** seeded chunks from the WP11 rock atlas (lit toward the star) placed along the struck body's orbit and spreading with time. Chunks with r ≥ 4 are crash bodies in the sim, so they come from the same seed there. In planning, draw the field's outline as a px-space dashed path, with the narrowing-gap chip.
- **Burning up** (`consume { centerId, start, end, radius }`): with `u = (t − start) / (end − start)`:
  - scale the dayside glow sprite (toward the centre body) and the ablation tail quad (trailing the velocity, length 90 · u, flicker 0.4 s on `frame.now`)
  - at `end`, play the plunge flash, the ripple ring clipped to the star's disc, and the star brightening

  Planning shows the remaining spiral dashed in `event.warn` and a "burns up in m:ss" chip.
- **Tidal disruption** (proposed `disrupt { centerId, start, end }`): scale the body along the line to the mass (1 → 1.55 × 0.7) over the event. Draw the bound stream and the unbound tail as baked strand textures on quads that bend with the orbit, with particles along the strands. The heating gradient runs from the body's colours to `#FFF6D6` at the disk.
- **Accretion** (proposed `accrete { centerId, start, end }`): stretch the star toward the hole (1 → 1.12). Draw a stream of 6 strands from its near side to the disk, a flickering hotspot, and disk rings turning faster inside. Move mass from the star to the hole over the event in the sim, so prediction sees the gravity change.
- **Telegraphs:** for every scripted event the plan reaches, draw the course or spiral dashed in `event.warn`, the reticle at the predicted point, and the countdown chip (DOM), plus the follow-on dashed in `event.next`.

**Budget:** each event is a handful of quads plus at most 30 points, under 0.2 ms.

## 18. Ghost markers (LU2)

Designs: `ghost-markers.svg`, `mockups/planning-ghosts.svg`. Values in `style.md` §15. This replaces the plain rings in `src/render/visuals/ghosts.ts`. Keep `ghostSteps` and `movingBodies`. Per ghost:

1. **Pose.** Take the position from `bodyPose(body, step · dt)`. The ring radius is `max(body.radius, 8)` in world units, but the strokes are px-space (1.2 / 0.7 px, from `fwidth`).
2. **State.** Pick it in this order:
   - *gone* when `bodyPresent` is false (or a `consume` script has ended)
   - *collision* when the predicted ship position at that step is inside the body
   - *arrival* for the target at the capture step
   - *cursor* at `cursorStep`
   - otherwise *at a burn*

   The colours and the badge come from §15.
3. **Tie line.** Draw a px-dashed line quad from the ship's predicted position at the same step to the ghost centre.
4. **Labels.** The time chip is DOM, like the Δv chip; for the target's arrival it reads "arrive m:ss".

The target's future track is one line strip sampled from `bodyPose` between now and the arrival step, dashed in px-space, with a tick quad every 10 s of sim time. Draw it at renderOrder below the path dots. Ghosts never write the sim.

## 19. Supernova, quasar and stray asteroid (WP12)

Designs: `bodies/supernova-progenitor.svg`, `events/supernova-detonation.svg`, `events/supernova-remnant.svg`, `bodies/quasar.svg`, `events/quasar-sweep.svg`, `bodies/stray-asteroid.svg`, `mockups/supernova-level.svg`. Values in `style.md` §16. These replace the placeholder rings and jet bar in `src/render/visuals/hazards.ts`. Keep `shownTime`, `shellRadius` and `jetAngle`: every frame below is a pure function of that time, so the plan cursor scrubs it.

- **Progenitor** (`t < at`): draw the red-giant sprite (`bodies/red-giant.svg`, photosphere r 120) scaled to `body.radius / 120`, whatever the level's `look`. Animate the uneven breathing as a scale on the sprite only. Three shell rings (`nova.shell`, px-space 1.2 px) drift outward on `frame.now`. In planning, add the dashed blast ring at `blast`, the countdown arc (a ring quad with an angular cut at `1 − t/at`) and the DOM chips.
- **Detonation** (`at ≤ t < at + 2.6`): one additive quad with the `event.novaFlash` radial, radius and alpha from the timeline in §16. Hide the star sprite from `at`. The neutron-star dot (r 3, `nova.pulsar`) appears at `at`.
- **Shock** (`t ≥ at`): a ring quad at exactly `shellRadius(nova, t)`, `nova.shock`, px-space width. The filaments are one instanced quad set (46 at detonation, 240 on the remnant, seeded by body id) laid on the ring with ±12 % radial jitter, so the nebula grows with the shock. The haze is one radial quad at 0.8 × the ring. Fade the filaments' α over 40 s of sim time, down to the remnant's 0.35–0.85.
- **Remnant pulsar:** beams on a quad rotated by `frame.now` (cosmetic; no damage unless the level adds a `pulsar` block).
- **Quasar:** a disk quad (back half under the shadow, front half over it), a shadow disc, and a glow quad. Each jet is a quad from 1.5 × the shadow to `reach`, rotated to `jetAngle(jet, t)` and its opposite. A fragment shader reads the half-width `d · tan(cone)` and lays the violet sheath, the blue body and the white core across it, plus three knots moving out on `frame.now`. The sheath edge is the damage edge (gap C: drawn reach and width must equal `quasarDamage`'s). Planning draws the swept edges at `angle ± (sweep + cone)` and the reach arc as dashed px-space line quads.
- **Stray asteroid:** the belt rock instance code from WP11 (§14 of these notes and `space/belt-*.svg`) with one rock at `body.radius`, posed by `bodyPose` (its `drift`). The dust trail is 40 points behind `-velocity`, fading with distance. The drift arrow and ghosts appear in planning only.

**Budget:** under 0.3 ms per hazard (a few quads plus one instanced filament set of at most 240).

## 20. Target zone (orbit capture)

Designs: `target-zone.svg`, `planet-x.svg` part 8, `mockups/planning-capture.svg`. Values in `style.md` §17. This replaces the dashed, crawling ring in `src/render/visuals/planets.ts` (the `ringFrag` path: `uDash`, `uPulsePx`, `ringCrawlPxPerSec`) and the `theme.planet.ring*` constants.

1. **Quads.** Keep the one ring quad per target, sized `captureRadius + pad`. Drop the dash and the radius pulse in the fragment shader. Draw the solid stroke (1.5 px, from `fwidth`) and, in the same shader, the band: `band = smoothstep(R − 30/zoom, R, r) · (1 − smoothstep(R, R + 9/zoom, r))`. Both are px-space, so they hold their width at every zoom.
2. **State.** Pick it each frame from the game:
   - *flyby* when `ship.status === "lost"` and `lostReason === "flyby"`
   - *stable* when the ship has won
   - *inside* when `ship.enteredCapture` is true and the ship is within the radius
   - otherwise *idle*

   The alphas and colours come from §17. Pulse on `frame.now` (cosmetic).
3. **The flash** starts on the frame the status turns `won` and runs on `frame.now` for 1.5 s, once. It is UI feedback, not a hazard. The wave is a second ring quad scaled from R to R + 34 (ease-out). Under the result scrim, freeze the stable look (α 0.95).
4. **Too fast.** The exit arc sits at the first predicted sample outside the radius after the ship's current step, from the same prediction the path uses. For the hint, Δv = |v| − v_max at the current point, with v_max = √(GM (2/r − 2/(r + R))): the most speed a tangential burn may leave for an apoapsis at R. The chips are DOM.
5. **Planning.** The entry tick sits at the first predicted sample inside the radius. When the prediction ends captured, draw its `orbit` (closed, about the target) as a px-dashed line strip (4 4) in `zone.ring` α 0.75, and the "capture orbit · peri · apo" chip from `orbitAbout`.

Moving targets (LU2): every quad and point is posed by `bodyPose` at the sim time, like the ring today.

## 21. Sol bodies (Sol campaign)

Designs: `assets/sol/*.svg`, `mockups/sol-moon.svg`, `preview/sol.html`. Values in `style.md` §18. There is no Sol code yet, so this is new work.

1. **Looks.** Add one `look` per body: `sol-sun`, `mercury`, `venus`, `earth`, `luna`, `mars`, `jupiter`, `saturn`, `titan`, `uranus`, `neptune`, `pluto`, `charon`, `eris`, `arrokoth`, `voyager`. Draw them with the SVG pipeline the library bodies use (`art-sprite.ts`, `gallery.ts`). Bake per layer so the strips and the living surfaces move as their headers say (§4.6). Never freeze a body at t = 0.
2. **Sizes.** Level authors use the ladder for `radius` (= crash radius): r = 34 √(R / R⊕). The Sun is r 46. Distances and periods are compressed per the Sol campaign plan, but orbits stay Kepler (`centerId`, `radius`, `omega` with ω = √(GM/r³)). Moons orbit their planets, and the Moon's orbit is about Earth.
3. **Layers that must stay separate:**
   - Earth's city lights: a night-side layer masked by the live light direction, not baked into the day texture.
   - Saturn's rings: a back-half quad under the planet and a front-half quad over it, sharing one ring texture. The planet's shadow on the rings follows −L.
   - Uranus: the strip is rolled −62°, and the rings split front and back the same way.
   - The Sun's spots scroll inside the photosphere, under the flame ring.
4. **Fixed faces.** The Moon, Pluto and Charon don't scroll. Their lighting follows the star as usual, so their phases change while their features stay put.
5. **Light.** Each body's shade, haze and rim face the system's star, like every planet. Uranus's and Saturn's ring tilts are art, not physics.
6. **Voyager** is a small non-solid prop with a slow drift. It needs no collision.

**Budget:** the same as the library planets: one strip bake per layer and bucket, and two quads for each ring system.

## 22. Astrophage

Designs: `assets/astro/*.svg`, `assets/ship/engine-spin.svg`, `assets/overlays/astrophage-map.svg`, `mockups/planning-astrophage.svg`. Values in `style.md` §19. There is no Astrophage code yet.

1. **Level data (suggested):**
   - `astrophage { level, dims }` on a star; `level` is 1–10 and `dims` is the fraction its luminosity drops.
   - `petrova { from, to, bulge, eaten?, knots: [{ t, fuel, radius }] }`.
   - A `spin` engine type with its own Astrophage tank.

   Dimming multiplies the star's solar recharge and its radiation term. Knots are fixed points on the line: deterministic, seeded, and known to the prediction.
2. **Infected star.** One extra layer over the star sprite: a cells texture (black specks, baked once, rotated by `frame.now`) clipped to the disc, plus about 220 shimmer points on a ring at r + 7. Don't darken the star.
3. **Petrova line.**
   - Build the curve once per level (a quadratic from limb to limb).
   - Draw the glow band and the four strands as triangle strips along it; widths follow w(t), and the dash offsets scroll on `frame.now`.
   - Draw the motes, glints and sparkles as one instanced point set, with glints moving along t and sparkles scaling in and out.
   - Apply the fade mask along t, and the eaten variant's colour change, in the shader.
   - Budget: a few strips and at most 300 points per line.
4. **Knots and harvesting.**
   - A knot is a point cloud plus the planning ring.
   - While the ship is inside a knot's radius with the scoop fitted, the sim adds Astrophage at the knot's rate and drains the knot.
   - The visual streams points from the knot to the two scoop mouths (module-scoop local ±7.5, −13.5) and pulses a ring at each mouth.
5. **Spin drive.** The engine part is a normal ship part. The beam is its own quad from the throat, length L = 44 + 30 · Δv units, capped at 160. Use the beam gradient and a white core, with a cheap UV-noise shimmer instead of the SVG displacement. Idle: ring only.
6. **Fuel row.** DOM, under the fuel bar, shown only with a spin drive. The bar fill is CSS (a gradient plus a repeating speckle), the sparkle is an animated element, and the ghost segment works like the solar-recharge ghost.
7. **Astrophage map (A).**
   - Sample the density on a 14 px screen grid each time the view changes (planning and pause only).
   - Draw the ticks as one instanced line set with head dots, px-space.
   - The gauges, the clean ring and the labels are DOM or px quads.
   - The field formula in the asset header is the design default; the sim owns the numbers.
8. **Tau Ceti.**
   - The star look with a hue tint, or a dedicated `tau-ceti` look.
   - The disk as a belt-like seeded point set, with the back half drawn before the star and the front half after.
   - Three planets on Kepler orbits inside the disk's inner edge.
   - The eaten Petrova line.

## 23. Layers menu

Designs: `assets/layers-menu.svg`, `mockups/planning-layers.svg`. Values in `style.md` §20. This replaces `#gravity-controls` (three buttons) and `#mag-legend` in `index.html`, their styles in `src/style.css`, and the key handling in `src/game/input.ts`.

1. **DOM.**
   - One `<button id="layers">` at the old controls' spot, with the glyph, the label, a badge and a chevron, using `aria-expanded`.
   - One `<div id="layers-panel" role="menu">` with one `<button role="menuitemcheckbox" aria-checked>` per layer. Each holds an inline SVG icon, the name, a `<kbd>`, a CSS switch, and a slot for the legend and the reason.
   - Build the rows from one table (`id`, name, key, `available(level)`, `reason`, legend), so a new layer is one table entry.
2. **State.**
   - Keep the existing view flags (`game.gravity`, `game.magnetism`, and the radiation and Astrophage flags).
   - The panel's open state is UI only. The badge is the number of flags that are on.
   - Unavailable layers are forced off when a level loads.
3. **Keys** in `input.ts`:
   - Add L (toggle the panel) and D (radiation); radiation has no key today. A and T come with their layers.
   - Esc closes the panel before it clears the selection.
   - Ignore repeats and modifier chords, as `applyGravityKey` does.
4. **Flight.** The rows stay readable but their switches are disabled. On pause they come back.
5. **Legends.** Move the magnetism zones and the radiation dots into their rows. Delete the floating legend boxes.

## 24. Gravity and time heat map

Designs: `overlays/gravity-time.svg`, `mockups/planning-gravity-time.svg`. Values in `style.md` §21. This replaces `CLOCK_HEAT_RATES`, `CLOCK_HEAT_COLORS`, `clockHeatRgb` and `clockHeatAlpha` in `src/render/palette.ts`, and `theme.gravity.heatAlpha`, in `src/render/visuals/gravity.ts`. Keep `heatGamma` (2.4).

1. **Bands in the fragment shader.**
   - Pass the rate per vertex (`grid.rate`), not a colour.
   - In the fragment, compute s = rate^2.4 and look up the band.
   - Make each band edge crisp with `fwidth(s)`: a one-pixel `smoothstep` across the edge, not across the band.
   - Draw the contour lines in the same shader, as a px-wide line where s crosses an edge.
   - Alpha is the band's own; full rate is clear. Keep the edge fade and the body cut-outs.
2. **Sample the rate at the display position.** The funnel moves vertices a long way, so evaluate the rate at the pinched (display) position. That way the bands stay at their true radii, independent of the grid warp.
3. **Labels.** One DOM chip per visible contour, at −58° on the ring around the dominant body, skipped when closer than 22 px to the previous label.
4. **Grid ink.**
   - Draw a casing pass (1.9 px, `#050710` α 0.22 + 0.28·depth) under the existing ink.
   - Where s < 0.60 (warm), draw only `#050710` α 0.55 at 0.9 px.
5. **The funnel** (replaces the saturating pull in `pinchTowardMasses`):
   - For each vertex, take the dominant body (the largest Φ contribution).
   - Compute c = r_s / r_b, where r_s = 2GM/c² (`horizonRadius`), clamped to 1. Then r₀ = r_b (1 + 3c) and a = r_b (1 + 2.2c).
   - Map the distance with r′ = r_b + (r − r₀) u / (1 + u), where u = ((r − r₀)/a)².
   - Blend with today's pinch by w = smoothstep(0, 0.6, c).
   - Where w > 0, skip the `PINCH_CELL` clamp: the radial map is monotonic and cannot fold.
   - Vertices with r ≤ r₀ go under the disc: hide them, as today's lines already stop at discs.
   - Between two compact bodies, blend the two maps by their Φ shares.
6. **The Layers legend** (§20) shows the six band swatches.

## 25. Rendering v2: shader bodies

Specs: `shader-specs.md`. Reference shaders: `shaders/*.frag`. Live comparison: `preview/shaders.html`. So far: R2.0 conventions (§1 there), R2.1 stars (§2, `shaders/star.frag`) R2.2 rocky planets and moons (§3, `shaders/planet.frag` with the baked maps in `shaders/maps/`) R2.3 gas giants and rings (§4, `shaders/giant.frag`) R2.4 compact objects (§5, `shaders/compact.frag`) and R2.5 effects (§6: `shaders/rock.*`, `points.*`, `bloom.frag`). The spec set is complete.

- **Port as written.** Port each reference shader into a `THREE.ShaderMaterial` on an impostor quad per body. Keep the uniform names, so the parameter tables apply one to one.
- **Body radius.** `uR` is the body radius in device pixels (r · zoom · DPR).
- **Time.** `uTime` is `frame.now` in seconds. Hazards stay on sim time.
- **Blending.** Premultiplied output: `blending: THREE.CustomBlending`, `blendSrc: THREE.OneFactor`, `blendDst: THREE.OneMinusSrcAlphaFactor`, `transparent: true`, `depthWrite: false`.
- **Fallback.** Behind `rendering.shaders`: when it is off, draw today's sprites. The sprite path stays until every family passes its side-by-side.
- **Budget.** As §9: bake the star rings into frames when a star covers more than a quarter of the screen. Drop to 3 octaves below 6 px.
- **Planets.** Load the maps once as power-of-two textures with `wrapS = RepeatWrapping` and `flipY = true`. `uLight` comes from the brightest star each frame; the art's default only stands in for the preview. Bake new bodies with the procedure in `shader-specs.md` §3.
- **Giants.** Upload `uJet` as a 17-float uniform array. Ring profile maps use `ClampToEdgeWrapping`. Size the quad to the ring's outer edge (`rho1` × r). A ringed giant is one quad, because the shader orders the far ring, the planet and the near ring itself.
- **Compact objects.** The pulsar's `uSimTime` is `shownTime(game)`, the same clock as its damage. Size its quad to the beam reach (2 × `uReach` × r), or draw the beams as a separate long quad, so the body quad stays small.
- **Effects.** Rocks are one `InstancedMesh` per field, with the attributes in §6.1. Dust and motes are one `THREE.Points` per set with the `points.*` material. If bloom is used, render the emissive bodies on their own layer (`camera.layers`) into an `EffectComposer` with the §6.3 passes (or `UnrealBloomPass` at threshold 0.85, strength 0.45, radius 0.35) and add the result over the world scene; the HUD stays outside.

## 26. Tidal stress map

Designs: `overlays/tidal-stress.svg`, `mockups/planning-tidal.svg`. Values in `style.md` §22. This is the Layers menu's Tidal stress row (T).

1. **Sample.** On an 18 px screen grid (planning and pause only, re-sampled when the view changes), for each cell centre in world space:
   - S = `tidalStressAt(x, y, config, time)`
   - the summed tensor, with components txx, txy and tyy from Σ k · 2GM · L / r³ · (3 r̂r̂ − I) / 2 over compact bodies posed by `bodyPose`
   - its larger eigenvalue (the stretch) and that eigenvector's angle, ½ atan2(2 txy, txx − tyy)

   Skip cells with S < 0.06 · `STRESS_WARN` and cells within r + 7 px of a body.
2. **Draw** one instanced ring quad per cell: an ellipse with semi-axes a and b from §22, rotated to the axis, with a px-space 1 px stroke (`fwidth`), coloured by `stressLevel(S)` and filled at α 0.22 at level 3.
3. **Keep** the dashed tidal ring (`gravity.ts`) as the level-3 boundary.
4. **Path chip.** When the prediction spends steps at S ≥ `STRESS_WARN`, chip the longest stretch with its duration and its summed hull loss.
5. **Layers.** Add the row to the menu table, available when `tidalStrength` > 0 and a compact body exists. Its key is T.

## 27. Cryosleep

Designs: `hud-crew.svg`, `cryo-segment.svg`, `ship/cryo-pods.svg`, `mockups/planning-cryosleep.svg`. Values in `style.md` §23.

1. **State.** A plan holds at most one sleep per coast as two sim times, `sleepAt` and `wakeAt`, in ship time. Deterministic: the sim decides asleep from the step's ship time, never from frame time, so 1× and 32× sleep the same steps. `wakeAt` is clamped to 1 s of ship time before the next burn; an auto-wake (optional) moves it to the first predicted step inside a hazard.
2. **Ageing.** Each step adds `dτ` (the ship-time step, already slowed by the clock rate) to `crewAge` unless the crew is asleep. Lifespan left = `lifespan − crewAge`; at 0 the mission is lost. The prediction carries `crewAge` along the path so the HUD ghost can show what the plan uses and what the sleep keeps (the same plan with and without the sleep).
3. **HUD.** A fourth status block in the DOM stack (like `#dose`), placed after the dose block. The ice bar is a CSS gradient with a frost-needle background image and an animated shimmer; the hatch is a repeating linear gradient at −35°.
4. **Path.** Draw the stretch over the prediction stroke: a wide soft line and a narrow core in `cryo.glow` (px-space widths, like the path dots), the dash crawling with time, the dots inside tinted `cryo.ice`, and glints as point sprites. Handles are px-space capsule quads aligned with the path tangent, hit-tested like burn nodes and dragged along the predicted points.
5. **Ship.** While asleep, switch the cryo module to the asleep pod state and add the breathing ring and snowflake around the ship (screen-space, under the ship sprite).
