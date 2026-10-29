# Slingshot — Three.js implementation notes (v2)

How to build the v1.5 realistic look in the game's actual renderer: the orthographic Three.js scene introduced in WP3 (PR #4). `canvas-notes.md` stays the pixel-exact reference for how each SVG recipe looks and what it costs. This file translates those recipes into the game's `Visual` factories and GLSL. Everything here is a recommendation for whoever implements the realistic visuals. It changes no code, and the simulation is never touched.

Read with: `style.md` (tokens and rules), `assets.md` (one row per asset), the asset SVG header comments (the canon for every number), and in the code `src/render/visual.ts`, `src/render/visuals/index.ts`, `src/render/theme.ts`, `src/render/palette.ts`.

Sections: §0 how the renderer is put together · §1 rules for the realistic visuals · §2 translating SVG filter recipes to GLSL · §3 planets · §4 stars · §5 compact objects · §6 moons and moon chains · §7 environment (nebulae, debris, rings) · §8 palette and colour · §9 budget · §10 asset → factory map, with what WP8 needs · §11 the magnetism map and fuzzy prediction (WP9) · §12 comets and the solar recharge indicator (WP10) · §13 the modular ship, damage, hull HUD and upgrade screen (ship systems).

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
