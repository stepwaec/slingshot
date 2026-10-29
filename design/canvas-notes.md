# Slingshot — Canvas 2D drawing notes (v1.3)

How to draw every element of the visual style in plain Canvas 2D (TypeScript, no engine) and hold a steady 60 fps on an integrated GPU. Every number below is taken from `design/style.md`, the asset SVGs in `design/assets/` and the shared brief; every colour is a palette token written as hex. Snippets are valid TypeScript with no imports — `ctx` is always a `CanvasRenderingContext2D`.

v1.1 was the realism pass: the three bodies and the sky got richer, and all of that richness is paid **once**, at build time, into cached bitmaps (background, star sprite, planet sprites). v1.2 is the planet pass: each planet's cached sprite becomes a cached **texture strip** (land / clouds, basins / wisps, polar caps; period P = round(2π r)) that scrolls under a cached **lighting overlay** (limb squash, glint, terminator, limb line, rim) — the surface rotates at 64–120 s per turn, the light never moves, and the per-frame cost is 1 clip + 3 blits per planet (§4). Planet X's halo now breathes with the ring. Star, sky, ship, trail, path, arrow, HUD and overlays (§1–§3, §5–§11) are exactly v1.1. v1.3 is the body library: §3b adds prominence loops and a flare to every main-sequence star (cached pre-blurred sprites scaled and faded by time, one live triangle), §3c draws the three compact objects (white dwarf, neutron star, black hole — sprite stacks with one rotation each), and §4b lists every library body's parameters and the small extensions the §4 pipeline needs for them (three terminator recipes, rim peaks, craters, gas bands, the ring, the lava pulse, the double planet's orbit). Nothing in §1–§11 changes for the original scene.

Scene reference used throughout (world units = screen px at zoom 1, 1440×900 mockup): star centre (760, 470) r 46; start planet (250, 690) r 34; planet X (1190, 210) r 30, capture ring r 78; ship 22 px long. The unit vector from a planet toward the star is called **L** (start planet: (+0.7071, −0.7071), upper-right; planet X: (−0.7071, +0.7071), lower-left). v1.3 scenes swap bodies in and out (`scene-variant`: red dwarf (700, 480) r 40, ringed gas giant (1000, 640) r 44, moon (420, 300) r 14, rocky start (230, 700) r 30, X (1210, 190); `scene-blackhole`: black hole (720, 460) r 22, ice start (230, 690) r 28, moon (900, 250) r 14, X (1200, 200)); L is always computed toward the scene's star (§4 `towardStar`), and `crashRadius` is the solid disc (§4b).

---

## 0. Frame plan & budget

### Device pixel ratio
Cap the DPR at 2. Above 2 the fill cost quadruples for no visible gain on a game this quiet; a 1440×900 CSS canvas at DPR 3 is 11.7 M pixels to clear and composite every frame.

```ts
const DPR = Math.min(window.devicePixelRatio || 1, 2);

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  const ctx = canvas.getContext("2d", { alpha: false })!; // opaque: cheaper compositing
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);                  // draw in CSS px from here on
  return ctx;
}
```

`{ alpha: false }` lets the browser skip blending the canvas against the page. All drawing is in CSS pixels; the transform does the scaling. Call `fitCanvas` on resize only, and rebuild the background and the star sprite in the same handler (§1, §3). The planet strips and lighting overlays (§4) depend only on r, L, the zoom bucket and the constant `DPR`, so resize leaves them alone — they rebuild only when the bucket changes (§12).

### Clear strategy
Do not call `clearRect`. The background layer (§1) is an opaque offscreen canvas that already contains `bg.edge`, the vignette, the Milky Way and the whole starfield; blitting it with `drawImage` *is* the clear. One `drawImage` of a full-screen opaque bitmap is ~0.2 ms; `clearRect` + `fillRect` + ~1005 star arcs + 15 gradients would be ~2.5 ms.

### Draw order (back to front, every frame)
1. background (cached: edge + vignette + Milky Way + starfield) — one `drawImage`
2. star (cached sprite, breathing scale; v1.3: a breathing envelope sprite, ≤ 3 loop sprites + 1 cached flare sprite, then a static body sprite, §3b — or a compact object's sprite stack, §3c)
3. planets (cached texture strips scrolled through a circular clip + cached lighting overlay: start, then X with its **live** breathing halo under the strips; v1.3 library bodies likewise, back to front — the ringed giant's back ring before it and front ring after it, the double pair's companion before or after its primary, §4b)
4. capture ring (dashed, pulsing, live)
5. predicted path (planning) **or** trail (flight)
6. drag arrow (planning only)
7. thrust flash (flight, `lighter`), then ship
8. HUD (wordmark, mode label, fuel bar, buttons, telemetry)
9. result overlay (cached card, faded in) — only when a result exists

**One scene clock.** Every animation in these notes — star breathe, loops, flare, planet X's ring and halo, strips, bands, orbits, beams, the disk — reads the same `tS`: seconds since the scene started, accumulated from the frame `dt` and clamped to ≤ 0.1 s per frame (so a tab switch pauses the sky instead of jumping it), and never simulation time (1x / 2x / 4x do not change it). `performance.now()` is used only to compute `dt`, to time the result overlay's fade-in (§11) and to measure the frame.

### Per-frame budget (CSS 1440×900, DPR 2, Intel Iris Xe / Apple M-series integrated GPU)

| Layer | Target ms | How it stays there |
|---|---|---|
| Background blit | 0.20 | one opaque `drawImage`, cached (Milky Way, halos and ~1005 dots are baked in) |
| Star | 0.10 | one `drawImage` of a 400×400 sprite — richer interior (streamers, chromosphere, limb darkening, granulation), same blit |
| Planets (2) | 0.16 | per planet **1 `arc` clip + 2 strip `drawImage` with a dt-based x offset + 1 lighting-overlay `drawImage`** (≈ 0.08 ms each, §4) — the strips (428 × 68 / 376 × 60 at zoom 1) and overlays (81 / 72 px) are cached, rebuilt only when the zoom bucket changes (§12), never on resize; only the 2r window inside the clip is rasterised |
| Planet X halo + ring | 0.15 | one gradient fill (radius breathing ±4 %) + one dashed stroke, both live |
| Star flares (v1.3, §3b) | 0.05 | ≤ 3 `drawImage` of pre-blurred 96 × 64 loop sprites (scaled, alpha-faded by the wall clock) + 1 `drawImage` of the cached flare sprite — ≤ 4 per star; the star itself becomes 2 blits (envelope + body) instead of 1 |
| Compact object (v1.3, §3c, in place of the star) | 0.05–0.15 | white dwarf 2 blits, neutron star 3 (one rotated 80 px sprite), black hole 5 (2 atlas cells + the ring sprite twice under axis-aligned half clips + 1 front-half Doppler overlay) |
| Library planets (v1.3, §4b, per body) | 0.08–0.25 | as the v1.2 planets: 1 clip + **1–3** strip blits + 1 overlay — the second strip is optional (rocky, ice, cracked, moon, dwarf and both double bodies have one strip; ocean and toxic have clouds; lava's vein strip is its second strip, drawn at a pulsing `globalAlpha`, plus **1 halo blit** before it); gas giants 3 / 2 band strips (`drawGasGiant`, + 2 static ring blits on the ringed one); the double planet = two one-strip planets at moving centres (2 clips + 4 blits) |
| Predicted path (≤ 400 dots) **or** trail (≤ 240 segs) | 0.60 | one `Path2D` fill / 20 gradient-chunk strokes |
| Drag arrow | 0.05 | 3 strokes, 1 fill, 1 `fillText` |
| Ship + thrust | 0.10 | 3 small polygons + 2 triangles |
| HUD | 0.60 | ≤ 10 `fillText` (flight mode has 9), ≤ 6 rounded rects; in the letter-spacing fallback ≤ 21 single-character `fillText` and **zero** `measureText` (advances cached, §10) |
| Result overlay | 0.30 | scrim `fillRect` + one `drawImage` |
| **Render total** | **≈ 2.3 ms** | leaves > 3.5 ms of the 6 ms target for physics and GC |
| Render total, `scene-variant` (red dwarf + flares, ringed giant, moon, rocky, X) | ≈ 2.7 ms | the extra loops / flare, the second band strip and the two ring blits add ≈ 0.4 ms over the original scene |

Target ≤ 6 ms of render per frame, so a 16.7 ms frame keeps slack even when the browser is busy. Measure with `performance.now()` around the draw and show it in the telemetry line while developing.

### One-time build costs (not per frame)

| Build | ≈ ms | When |
|---|---|---|
| Background (§1 + §2): 3 band gradients, 380 + 420 + 160 + 45 dots, 12 halo gradients, 4 sparkles | 2.5 | resize |
| Star sprite (§3): 2 gradient discs, 12 wedges, 3 rings, body gradient, 128² noise tile `multiply` | 1.5 | resize (fixed 400 px bitmap that `drawImage` scales; see §3 if the game ever zooms past 2×) |
| Planet strips + lighting overlay (§4), each planet: 2 noise fields stretched from the 128² tiles (`getImageData` once each), 3 thresholded layers (`putImageData` + 2 blits each), polar-cap bands, overlay (squash, glint, terminator, limb, rim in 2 passes) | ≈ 2 | when the zoom bucket changes (§12: buckets at 1.25^k, 25 % apart, flipping ±11.8 % about each centre) — not on resize; both planets ≈ 4 ms in the same frame |
| Noise tiles (§4 `makeNoiseTile`), each: 128² value noise, 2–4 octaves, `putImageData` | 0.3–0.4 | once per (seed, cells, octaves): 3 (star), 7 / 6, 19 / 12 (start), 11 / 7, 23 / 9 (X) — five tiles, kept across strip rebuilds |
| v1.3 star sprites (§3b): envelope (layers 1–4, S = ceil(2 · max(glowR, 200 k)) = 400 / 348 / 480 px, streamers blurred once in a scratch canvas) + body (layers 5–7) + 3 loop sprites (96 × 64 · k, three strokes each) + 1 flare sprite (0.7 r × (3 k + 2) px) | ≈ 2.5 | once per star kind present in the scene (sun / red dwarf / blue giant) |
| v1.3 compact objects (§3c): white dwarf 2 sprites, neutron star 3, black hole 2-cell atlas (320 × 160) + ring texture at 2× (ramp, 68 streak wedges × 2 fills, radial fade, mottle loop) + Doppler overlay | 0.3 / 0.3 / ≈ 3 | once |
| v1.3 library planets (§4b): as the v1.2 planets per body, plus craters (circles, baked twice), gas band strips (9 polygon bands per group from a noise row, streak overlay), ring back / front sprites (gradient + shadow wedge) | 2 per body (gas giants ≈ 4, double ≈ 4) | when the zoom bucket changes; noise tiles for the new seeds (5, 9, 13, 17, 21, 29, 31, 37, 41, 43, 47, 53, 59, 61 …) once each |

### Cached offscreen vs. drawn live
| Cached (rebuilt only on resize / state change) | Drawn live every frame |
|---|---|
| Background + vignette + Milky Way + starfield (one canvas) | Planet X halo (gradient, breathing) and capture ring |
| Star sprite 400×400 (×DPR) | Ring, path, trail, arrow, ship, thrust |
| Planet texture strips 428×68 / 376×60 (×DPR, two per planet, at the current zoom bucket) | The strips' scroll: a dt-based source offset on two clipped blits per planet — the pixels themselves are never touched |
| Planet lighting overlays 81×81 / 72×72 (×DPR, at the current zoom bucket) | HUD text and bars, scrim |
| Result card 520×232 (+ 64 px shadow margin) | |
| v1.3 star envelope + body sprites, 3 loop sprites and 1 flare sprite per star (§3b) | The loops' and the flare's per-frame transform and `globalAlpha` (blits only — no gradient, path or fill per frame) |
| v1.3 compact-object sprites: white dwarf glow + disc, neutron star glow + magnetosphere + body, black hole 2-cell atlas + ring texture + front-half Doppler overlay (§3c) | The glow breathe (a scale), the magnetosphere rotation and the disk-ring rotation (a `rotate` under a clip) |
| v1.3 library strips and overlays per body, the lava halo sprite, ring back / front sprites — all at the zoom bucket (§4b) | The double planet's orbit (two moving centres), the lava vein strip's `globalAlpha` |

### The rule
**Never call `shadowBlur` on moving things.** `shadowBlur` forces a full-size readback and a two-pass Gaussian for every draw call that uses it; on a moving object it runs every frame. The one permitted use is the result card (§11), drawn once into an offscreen canvas and then blitted. The same goes for everything v1.1 added: noise, blend modes (`multiply`, `destination-in`) and gradient wedges run only inside the sprite builds, never in the frame loop — and for v1.2's rotation, which is nothing but a changing `drawImage` offset on a cached strip (plus the one `getImageData`/`putImageData` per layer at build time that thresholds the noise). Realism comes from richer cached pixels, not from more draw calls; motion comes from where the cached pixels are drawn, not from redrawing them.

```ts
// Helpers used by every section.
// rgba(): CSS colour from a hex token + alpha.
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// roundRectPath(): rounded-rect path with an arcTo fallback. ctx.roundRect is only typed in lib.dom from
// TS 5.0 and missing in Firefox < 112 / Safari < 16, so nothing in these notes calls it directly —
// not even the ship's cockpit slit (§5). The caller fills/strokes the path.
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === "function") { (ctx as any).roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
```

---

## 1. Background + vignette

One offscreen canvas at the full DPR-scaled size holds `bg.edge`, the radial vignette, the Milky Way and the whole starfield (§2). It is redrawn only on resize.

Vignette (v1.1): fill `bg.edge #000000` first, then a radial gradient centred on the canvas centre ((720, 450) at 1440×900), radius 900: **0.00 `bg.vignette #0B1024` · 0.55 `bg.base #050710` · 1.00 `bg.edge #000000`**. The frame now goes vignette → base → black; at 1440×900 the corners sit at r ≈ 849 (t 0.94), so they are near-black, and `bg.base` is what you see over most of the field. Fill the edge colour first so the gradient never has to cover the corners.

```ts
let bgCanvas: HTMLCanvasElement;

interface Zone { x: number; y: number; r: number }   // starfield exclusion zone (screen px, zoom 1)

function buildBackground(w: number, h: number, zones: Zone[]): void {
  bgCanvas = document.createElement("canvas");
  bgCanvas.width = Math.round(w * DPR);
  bgCanvas.height = Math.round(h * DPR);
  const g = bgCanvas.getContext("2d", { alpha: false })!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);

  g.fillStyle = "#000000";                        // bg.edge
  g.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const v = g.createRadialGradient(cx, cy, 0, cx, cy, 900);
  v.addColorStop(0, "#0B1024");                   // bg.vignette
  v.addColorStop(0.55, "#050710");                // bg.base
  v.addColorStop(1, "#000000");                   // bg.edge
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);

  drawStarfield(g, w, h, zones);                  // §2 — Milky Way + three layers, into the same canvas
}

function blitBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.drawImage(bgCanvas, 0, 0, w, h);            // this is the per-frame "clear"
}

// Exclusion zones at the mockup positions: star r 140, start planet r 60, planet X r 80 (brief minimums;
// starfield.svg keeps v1's stricter 140 / 70 / 100 so its v1 dots stay put).
const STAR_ZONES: Zone[] = [{ x: 760, y: 470, r: 140 }, { x: 250, y: 690, r: 60 }, { x: 1190, y: 210, r: 80 }];
```

The vignette radius is fixed at 900 regardless of window size: on a smaller window it simply gets cropped, which keeps the centre lift identical between the mockups and the game. Contrast of the HUD only goes up toward the black edge (`ui.text` 18.4 : 1, `ui.textMuted` 7.1 : 1 on `#000000`, see `style.md` §2).

---

## 2. Starfield

Static, no parallax, drawn **once** into the background canvas: a faint Milky Way band, three depth layers, halos on the brightest stars and four sparkles — about **1005 dots** in all. `design/assets/starfield.svg` is a **sample**, not a reference bitmap: it follows every rule below (same counts, radii, alphas, tints, magnitude rule, halo rule, band geometry) but its dot positions come from a different pass of the generator (clustered placement) and its band is masked by `feTurbulence`, which Canvas replaces with three gradients. Do not compare the two dot-for-dot; match the tables, not the asset.

Three independent `mulberry32` streams keep the sky stable across reloads and resizes:

| Stream | Seed | Draws |
|---|---|---|
| A — positions | `0x514E47` (as v1) | far, mid, near: `x = rnd()·w, y = rnd()·h`, re-drawn while inside an exclusion zone |
| B — magnitude & tint | `0x514E48` | per star in mid, then near: `u` (magnitude) then `t` (tint) |
| C — Milky-Way dots | `0x4D57` ("MW") | per dot: `t` along the band (uniform, ±1000 px), two draws for a Gaussian offset across it (Box–Muller, σ 90 px), re-drawn while out of frame or inside a zone |

### Layers (radius and alpha roles unchanged from v1; the colour is now per star)

| Layer | Colour | Radius | Alpha | Count at 1440×900 |
|---|---|---|---|---|
| milkyway dots | `stars.far` `#6E7FA6` | 0.5 px | 0.28 | 380, Gaussian σ 90 px about the band axis |
| far  | `stars.far` `#6E7FA6` | 0.6 px | 0.35 | 420 (unchanged) |
| mid  | tint (cool / neutral / warm) | 0.8–1.0 px | 0.55–0.65 | 160 |
| near | tint (cool / neutral / warm) | 1.2–1.5 px | 0.85–0.95 | 45; the 12 largest get a halo |

Scale counts with area for other sizes: `count × (w·h) / (1440·900)`.

**Magnitude rule** (mid and near): one draw `u = rnd()` per star sets both size and brightness, `r = rMin + (rMax − rMin)·u³` and `α = aMin + (aMax − aMin)·u³` — the cube gives many faint stars and a few bright ones, and the same `u` means brighter is always also bigger.

**Tint rule** (mid and near): a second draw `t = rnd()`: `t < 0.25` → `stars.cool #B8CCFF`, `t < 0.75` → `stars.neutral #E9EEF8`, else `stars.warm #FFD9B0` (25 / 50 / 25 %). Far stars are too faint to show colour and stay `stars.far`. The SVG sample landed on cool 38 / neutral 85 / warm 37 in mid and 9 / 27 / 9 in near.

**Halos**: the 12 largest near stars (sort by r, take 12) get a circle r 4.5 filled with a radial gradient of their own tint, α 0.18 → 0, drawn **under** the dot. Soft and small — it is the only "glow" in the sky and it never animates.

**Sparkles**: 4 of the near stars get a 4-point cross — two 5 px lines (±2.5 px) through the centre, `#FFFFFF`, stroke 0.6 px, α 0.5, round caps. Static; no twinkle. The code takes the first 4 near stars the RNG produces and forces them to `u = 1`, neutral, so a cross always sits on a maximum-magnitude white star (the SVG forces its 4 v1 sparkle stars the same way).

**Milky Way**: a band from lower-left to upper-right at **−28°** through the canvas centre (720, 450) — it runs behind the star and ends up-right on planet X's side without being centred on it. The SVG draws two rotated ellipses (rx 1100 × ry 150, `milkyway.dust #AAB8DD` α 0.06 → 0.03 at 0.55 → 0; rx 900 × ry 70 offset 25 px, α 0.05 → 0) through a `feTurbulence` mask (fractalNoise 0.0025, 3 octaves, seed 5, contrast 1.5 n − 0.2 — gentle, so the band stays one continuous mottled lane rather than detached patches); its measured peak α after masking is 0.054 (budget ≤ 0.08). Canvas does not mask: it draws **three rotated elliptical radial gradients** (each a circle of radius ry under `scale(rx/ry, 1)`), peak α 0.05 / 0.04 / 0.03, offset 0 / +40 / −50 px across the band — composite peak ≈ 0.076, still inside the budget. It is dust, not detail; if it reads stronger than the asset, scale the three alphas by 0.7. Then the 380 extra far dots along the same axis.

```ts
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star { x: number; y: number; r: number; a: number; tint: number }

const STAR_TINT = ["#B8CCFF", "#E9EEF8", "#FFD9B0"];                 // stars.cool / stars.neutral / stars.warm
const tintOf = (t: number): number => (t < 0.25 ? 0 : t < 0.75 ? 1 : 2);   // 25 / 50 / 25 %

function drawStarfield(g: CanvasRenderingContext2D, w: number, h: number, zones: Zone[]): void {
  const posRnd = mulberry32(0x514E47);           // stream A: positions (as v1)
  const magRnd = mulberry32(0x514E48);           // stream B: magnitude u, tint t
  const mwRnd  = mulberry32(0x4D57);             // stream C: Milky-Way dots
  const scale = (w * h) / (1440 * 900);
  const clear = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x > w || y > h) return false;
    for (const z of zones) if (Math.hypot(x - z.x, y - z.y) < z.r) return false;
    return true;
  };
  const place = (rnd: () => number): [number, number] => {           // uniform, outside the exclusion zones
    for (;;) { const x = rnd() * w, y = rnd() * h; if (clear(x, y)) return [x, y]; }
  };

  // --- Milky Way band: three rotated elliptical gradients, milkyway.dust, −28° through the centre
  const bx = w / 2, by = h / 2, ang = (-28 * Math.PI) / 180;
  const band = (rx: number, ry: number, off: number, stops: [number, number][]): void => {
    g.save();
    g.translate(bx, by); g.rotate(ang); g.scale(rx / ry, 1);         // circle r = ry → ellipse rx × ry
    const grad = g.createRadialGradient(0, off, 0, 0, off, ry);
    for (const [o, a] of stops) grad.addColorStop(o, rgba("#AAB8DD", a));
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, off, ry, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  band(1100, 150,   0, [[0, 0.05], [0.55, 0.025], [1, 0]]);
  band( 900,  70,  40, [[0, 0.04], [1, 0]]);
  band( 700,  60, -50, [[0, 0.03], [1, 0]]);

  // --- Milky Way dots: 380 × stars.far r 0.5 α 0.28, uniform along the axis (±1000 px), Gaussian σ 90 across it
  const ca = Math.cos(ang), sa = Math.sin(ang);
  g.globalAlpha = 0.28; g.fillStyle = "#6E7FA6";
  g.beginPath();
  for (let n = 0, want = Math.round(380 * scale); n < want;) {
    const t = (mwRnd() * 2 - 1) * 1000;
    const s = Math.sqrt(-2 * Math.log(1 - mwRnd())) * Math.cos(2 * Math.PI * mwRnd()) * 90;   // Box–Muller
    const x = bx + t * ca - s * sa, y = by + t * sa + s * ca;
    if (!clear(x, y)) continue;                                         // rejected points are retried
    g.moveTo(x + 0.5, y); g.arc(x, y, 0.5, 0, Math.PI * 2); n++;
  }
  g.fill();

  // --- far: 420 × stars.far r 0.6 α 0.35 — unchanged from v1, one path, one fill
  g.globalAlpha = 0.35;
  g.beginPath();
  for (let i = 0, n = Math.round(420 * scale); i < n; i++) {
    const [x, y] = place(posRnd);
    g.moveTo(x + 0.6, y); g.arc(x, y, 0.6, 0, Math.PI * 2);
  }
  g.fill();
  g.globalAlpha = 1;

  // --- mid + near: magnitude rule (r and α from the same u³) and per-star tint
  const layer = (n: number, rMin: number, rMax: number, aMin: number, aMax: number, forceBright: number): Star[] => {
    const out: Star[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = place(posRnd);
      let u = magRnd(), t = magRnd();                                   // stream B: u, then t
      if (i < forceBright) { u = 1; t = 0.5; }                            // sparkle hosts: max magnitude, neutral
      const u3 = u * u * u;
      out.push({ x, y, r: rMin + (rMax - rMin) * u3, a: aMin + (aMax - aMin) * u3, tint: tintOf(t) });
    }
    return out;
  };
  const mid  = layer(Math.round(160 * scale), 0.8, 1.0, 0.55, 0.65, 0);
  const near = layer(Math.round(45 * scale),  1.2, 1.5, 0.85, 0.95, 4);

  const dots = (stars: Star[]): void => {                               // per-star colour + alpha → one fill each (build time only)
    for (const s of stars) {
      g.fillStyle = rgba(STAR_TINT[s.tint], s.a);
      g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
    }
  };
  dots(mid);

  // --- halos UNDER the 12 largest near stars: r 4.5, own tint, α 0.18 → 0
  const bright = near.slice().sort((p, q) => q.r - p.r).slice(0, 12);
  for (const s of bright) {
    const halo = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, 4.5);
    halo.addColorStop(0, rgba(STAR_TINT[s.tint], 0.18));
    halo.addColorStop(1, rgba(STAR_TINT[s.tint], 0));
    g.fillStyle = halo;
    g.beginPath(); g.arc(s.x, s.y, 4.5, 0, Math.PI * 2); g.fill();
  }
  dots(near);

  // --- sparkles: 4 crosses on the first 4 near stars (forced to u = 1, neutral above)
  g.globalAlpha = 0.5; g.strokeStyle = "#FFFFFF"; g.lineWidth = 0.6; g.lineCap = "round";
  g.beginPath();
  for (const s of near.slice(0, 4)) {
    g.moveTo(s.x - 2.5, s.y); g.lineTo(s.x + 2.5, s.y);
    g.moveTo(s.x, s.y - 2.5); g.lineTo(s.x, s.y + 2.5);
  }
  g.stroke();
  g.globalAlpha = 1;
}
```

Cost: 3 band gradients + 800 batched arcs (two fills) + 205 individual tinted fills + 12 halo gradients + 4 crosses ≈ **2.5 ms — once**, at build time. Per frame it costs nothing because the whole canvas is blitted. The mid/near dots cannot share one path because each has its own colour and alpha; 205 small fills at build time are fine, and the far layers stay batched.

---

## 3. Star

### Why a cached gradient beats per-frame `shadowBlur`
A `shadowBlur` of 40 on a 100 px circle makes the browser allocate a (100 + 2·40·3)² ≈ 340² px scratch surface (at DPR 2: 680²), run a separable Gaussian over it twice, then composite — on the order of **2–5 ms per call** on an integrated GPU, and it repeats every frame for as long as the star is on screen. The same look as a radial gradient rendered once into a 400×400 sprite is one `drawImage` per frame: **~0.05–0.1 ms**, i.e. 30–50× cheaper, and the breathing animation is free because scaling a bitmap costs the same as not scaling it. v1.1 adds streamers, a chromosphere, limb darkening and granulation to that same sprite; the per-frame cost is unchanged because it is still one blit.

### Sprite
400×400 CSS px (×DPR), centre (200, 200). Envelope unchanged (body r 46, corona to r 130, glow to r 200). Drawn back to front exactly as in `design/assets/star.svg`; stop offsets are fractions of each layer's own radius (0.23 = 46/200, 0.35 = 46/130).

| # | Layer | Geometry | Stops / values |
|---|---|---|---|
| 1 | glow | disc r 200 | 0.00 `#FF5A1F` α 0.50 · 0.23 α 0.45 · 0.65 α 0.12 · 1.00 α 0 (as v1) |
| 2 | corona | disc r 130 | 0.00 `#FF8C2E` α 0.90 · 0.35 α 0.70 · 0.62 α 0.22 · 1.00 α 0 (as v1; the SVG blurs it σ 3, Canvas does not) |
| 3 | streamers | 10 wedges `(48, −w/2) → (T, 0) → (48, w/2)` rotated by A | fill `star.corona #FF8C2E`, **blurred once at build time** to match the SVG's σ 6 (`bakeStreamers`): the wedges go into a scratch canvas that is composited onto the sprite through `ctx.filter = "blur(6k·DPR px)"` where supported — flat α a, exactly the SVG's wedge; where the filter is missing, a **mandatory** three-fill fallback: each wedge filled with a linear gradient α a·share at the base (r 48) → 0 at the tip, at width w + 12 k / w + 6 k / w with share 0.25 / 0.35 / 0.40. Hard-edged unblurred wedges read as a busy starburst (the blue giant's 14 most of all) and are not acceptable |
| 4 | helmet lobes | 2 wedges, base 40 at r 48, tip r 150 | `#FF8C2E` α 0.06 → 0, angles 122° and 292° — hand-placed inside the two widest streamer gaps (89.2° → 158.9°, centre 124.0°; 264.0° → 311.3°, centre 287.6°) and rounded, not computed |
| 5 | chromosphere | three 1 px rings at r 46 / 47 / 48 | `#FF8C2E` α 0.60 / 0.35 / 0.15 (the SVG: one 3 px ring at r 47, α 0.60, σ 1.5) |
| 6 | body (limb darkening) | disc r 46, radial from the centre | 0.00 `star.core #FFF8E1` · 0.45 `star.body #FFC857` · 0.78 `#FFC857` · 0.90 `star.corona #FF8C2E` · 1.00 `star.limb #FF5A1F` |
| 7 | granulation | noise tile (§4 `makeNoiseTile(128, 3, 2, 2, 14)`: seed 3, 2 octaves, contrast ×2, 14 cells ≈ 128 · 0.11), clipped to r 46 | `globalCompositeOperation = "multiply"`, α 0.16 |

**Streamer angles** are deterministic: `mulberry32(0x5747)`, draw order per streamer `u₁` → angle `A = 360·u₁` (re-drawn while within 20° of an accepted angle; 23 angle draws for 10 accepted), then **three further independent draws** `u₂`, `u₃`, `u₄`: `w = 10 + 8u₂`, `T = 110 + 65u₃`, `a = 0.10 + 0.06u₄` — four draws per accepted streamer plus one per rejected angle (a single shared `u` for w / T / a does **not** reproduce the table: it gives S1 = (158.9, 11.0, 118.2, 0.108) and 32 angle draws). A is in degrees clockwise from +x with y down — the same convention as SVG `rotate()` and Canvas `rotate()`, so the table transfers 1 : 1. The values, as `star.svg` bakes them:

| | A (°) | w (px) | T (px) | α |
|---|---|---|---|---|
| S1 | 158.9 | 11.0 | 134.0 | 0.110 |
| S2 | 346.7 | 13.8 | 112.0 | 0.160 |
| S3 | 311.3 | 12.8 | 128.9 | 0.113 |
| S4 | 89.2 | 16.1 | 129.3 | 0.124 |
| S5 | 216.1 | 10.8 | 169.9 | 0.104 |
| S6 | 51.7 | 16.7 | 168.7 | 0.115 |
| S7 | 7.4 | 11.5 | 145.6 | 0.137 |
| S8 | 264.0 | 12.7 | 130.9 | 0.150 |
| S9 | 181.0 | 10.1 | 157.0 | 0.140 |
| S10 | 241.3 | 12.5 | 165.2 | 0.142 |
| lobe 1 | 122.0 | 40.0 | 150.0 | 0.060 |
| lobe 2 | 292.0 | 40.0 | 150.0 | 0.060 |

Granulation contrast is ×2 (the planets use ×3): fractal noise clusters around 0.5, and without the stretch the texture is invisible at α 0.16; ×3 on the star read muddy and grey at 3× zoom, so it was pulled back. Draw order is the SVG's: the chromosphere rings go down **before** the body, so the r 46 ring is half-covered by the limb and only a thin bright edge survives — that is the intended look.

```ts
let starSprite: HTMLCanvasElement;

// Build-time blur for the streamers (and lobes). ctx.filter is allowed HERE because this runs once per sprite build;
// §13 bans it in the frame loop only. Feature-test once; the three-fill fallback is mandatory where filter is missing.
const CAN_FILTER = ((): boolean => {
  const t = document.createElement("canvas").getContext("2d")!;
  t.filter = "blur(1px)";
  return t.filter === "blur(1px)";
})();

// Draws the wedges [A°, w, T, α] (base at r 48 k, centre S/2) soft onto dst (an S × S CSS-px sprite built at DPR).
function bakeStreamers(dst: CanvasRenderingContext2D, S: number, k: number,
                       streamers: [number, number, number, number][], colour: string): void {
  const c = S / 2, b = 48 * k;
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = Math.round(S * DPR);
  const g = scratch.getContext("2d")!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const passes: [number, number][] = CAN_FILTER ? [[0, 1]] : [[12 * k, 0.25], [6 * k, 0.35], [0, 0.40]];   // [extra width, α share]
  for (const [A, w, T, a] of streamers) {
    for (const [extra, share] of passes) {
      g.save(); g.translate(c, c); g.rotate((A * Math.PI) / 180);
      if (CAN_FILTER) g.fillStyle = rgba(colour, a);                      // flat α, as the SVG's wedges; the blur fades them
      else {                                                              // fallback: α a·share at the base → 0 at the tip, 3 widths
        const lg = g.createLinearGradient(b, 0, T, 0);
        lg.addColorStop(0, rgba(colour, a * share)); lg.addColorStop(1, rgba(colour, 0));
        g.fillStyle = lg;
      }
      const hw = (w + extra) / 2;
      g.beginPath(); g.moveTo(b, -hw); g.lineTo(T, 0); g.lineTo(b, hw); g.closePath(); g.fill();
      g.restore();
    }
  }
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);                                     // device px 1 : 1 (filter lengths are canvas px)
  if (CAN_FILTER) dst.filter = `blur(${6 * k * DPR}px)`;                  // σ 6 k CSS px = the SVG's streamer blur
  dst.drawImage(scratch, 0, 0);
  dst.restore();                                                          // restores filter = "none" and the DPR transform
}

// [A°, w, T, α] — 10 streamers from mulberry32(0x5747) (see table) + 2 helmet lobes. Part of the sprite; they breathe with it.
const STAR_STREAMERS: [number, number, number, number][] = [
  [158.9, 11.0, 134.0, 0.110], [346.7, 13.8, 112.0, 0.160], [311.3, 12.8, 128.9, 0.113],
  [ 89.2, 16.1, 129.3, 0.124], [216.1, 10.8, 169.9, 0.104], [ 51.7, 16.7, 168.7, 0.115],
  [  7.4, 11.5, 145.6, 0.137], [264.0, 12.7, 130.9, 0.150], [181.0, 10.1, 157.0, 0.140],
  [241.3, 12.5, 165.2, 0.142],
  [122.0, 40.0, 150.0, 0.060], [292.0, 40.0, 150.0, 0.060],
];

function buildStarSprite(): void {
  const S = 400, c = S / 2;
  starSprite = document.createElement("canvas");
  starSprite.width = starSprite.height = S * DPR;
  const g = starSprite.getContext("2d")!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);

  const layer = (r: number, stops: [number, string][]) => {
    const grad = g.createRadialGradient(c, c, 0, c, c, r);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad;
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  };
  layer(200, [[0, rgba("#FF5A1F", 0.50)], [0.23, rgba("#FF5A1F", 0.45)],
              [0.65, rgba("#FF5A1F", 0.12)], [1, rgba("#FF5A1F", 0)]]);     // 1. star.glow
  layer(130, [[0, rgba("#FF8C2E", 0.90)], [0.35, rgba("#FF8C2E", 0.70)],
              [0.62, rgba("#FF8C2E", 0.22)], [1, rgba("#FF8C2E", 0)]]);     // 2. star.corona

  bakeStreamers(g, S, 1, STAR_STREAMERS, "#FF8C2E");                        // 3+4. streamers + lobes, blurred σ 6 once

  g.lineWidth = 1;                                                         // 5. chromosphere: 3 rings for the SVG's σ 1.5
  for (const [r, a] of [[46, 0.60], [47, 0.35], [48, 0.15]] as [number, number][]) {
    g.strokeStyle = rgba("#FF8C2E", a);
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
  }

  layer(46, [[0, "#FFF8E1"], [0.45, "#FFC857"], [0.78, "#FFC857"],
             [0.90, "#FF8C2E"], [1, "#FF5A1F"]]);                           // 6. core → body → corona → star.limb

  g.save();                                                                // 7. granulation, clipped to the body
  g.beginPath(); g.arc(c, c, 46, 0, Math.PI * 2); g.clip();
  g.globalCompositeOperation = "multiply"; g.globalAlpha = 0.16;
  g.fillStyle = g.createPattern(makeNoiseTile(128, 3, 2, 2, 14), "repeat")!;   // §4; seed 3, 2 octaves, ×2, 14 cells
  g.fillRect(c - 46, c - 46, 92, 92);
  g.restore();
}

// Breathe: ±3 % over 6 s. tS = the scene clock in seconds (§0). Pass the star's screen position and zoom.
function drawStar(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tS: number): void {
  const breathe = 1 + 0.03 * Math.sin((tS / 6) * Math.PI * 2);
  const size = 400 * zoom * breathe;
  ctx.drawImage(starSprite, sx - size / 2, sy - size / 2, size, size);
}
```

The sprite is built for r 46 at zoom 1 in a fixed 400 px canvas (`S = 400`, every radius in CSS px — there is no size parameter); `drawImage` scales it for other zooms, and this prototype never zooms past 2× (§12). If it ever did, give `buildStarSprite` a scale `k` (S = 400 k, every radius, the 92 px granulation rect and the tile pattern × k) and rebuild at k = 2 so the body edge, the 1 px chromosphere rings and the granulation stay crisp — not implemented here. The streamers are always soft: `bakeStreamers` blurs them once at build time (filter where supported, the three-fill fallback otherwise), never per frame. No rotation, no flicker: the only motion is the breathe.

v1.3 (§3b) splits this sprite into an **envelope** (layers 1–4, the only part that breathes) and a **body** (layers 5–7, static) so that the prominence loops can be drawn between them, exactly as `star.svg` now layers them; `buildStarSprites` there generalises `buildStarSprite` to the three main-sequence stars. For a scene that uses the yellow sun without flares, this section's single sprite is still correct.

---

## 3b. Flares & prominences (v1.3, all three stars)

v1.3 adds two kinds of motion to every main-sequence star (`star.svg`, `bodies/red-dwarf.svg`, `bodies/blue-giant.svg`): three **prominence loops** that rise from the limb and fade, and one **flare**, a thin bright spike that pops once per 22 s. Both are cheap by construction: a loop is a **cached, pre-blurred sprite** drawn with a time-based scale and alpha, and the flare is one **cached gradient-wedge sprite** drawn with a time-based alpha — **≤ 4 extra `drawImage` per star per frame, no gradient, path, fill or blur at runtime**. The SVGs are the canon; their header comments list every angle, span, peak, path and timing, and the tables below copy them.

### What changes in the star sprite

In the SVG the loops sit **between the chromosphere and the body** so that their feet, which start exactly on the limb, are hidden by the disc at every scale; and the body, chromosphere, loops and flare **do not breathe** — only the glow / corona / streamer layers do (the crash radius never moves; the flares ride on top of the breathe). The v1.1 `drawStar` scales the whole 400 px sprite, body included. v1.3 therefore splits `buildStarSprite` into two bitmaps, built from the same layer list as §3:

- **envelope** sprite — layers 1–4 (glow, corona, streamers blurred once by `bakeStreamers` (§3), lobes), S × S with **S = ceil(2 · max(glowR, 200 k))** = 400 (sun) / 348 (red dwarf) / 480 (blue giant, whose glow reaches r 240), drawn first at `S · zoom · breathe`, scaled by the breathe;
- **body** sprite — layers 5–7 (chromosphere rings, limb-darkened body, granulation), (2 · 48 k + 8) px square, drawn last, never scaled by the breathe.

Per star per frame: envelope → 3 loops → flare → body = **6 `drawImage`** (≤ 4 of them the flares), ≈ 0.15 ms. The loops' feet and the flare's base fall under the body sprite exactly as in the SVG; the chromosphere rings (1 px, α ≤ 0.35 at r 47 / 48) now go down after the loops instead of before — the only ordering difference, invisible.

### Per-star tables

A loop lives in the frame `rotate(A) translate(r 0)`: its base point is the limb at angle **A** (SVG degrees, clockwise from +x, y down — the Canvas convention), x points radially outward, y tangentially. The path is `M x₀ −y₀ C c_x −c_y c_x c_y x₀ y₀` with feet at `x₀ = r cos(s/2) − r`, `y₀ = r sin(s/2)` (span s on the limb), peak height `h = (k − 1) r` and controls `c_x = (8h − 2x₀)/6` (so the cubic's midpoint is exactly the peak), `c_y = 0.8 r sin(s/2)`. Stroke 2.5 k, round caps, colour = corona token, blur σ 1.5 k (baked). Seeds: `mulberry32(seed)`, draws in order angle A = 360u (rejected and redrawn while < 70° from an accepted loop), span s = 18 + 10u °, peak k = 1.25 + 0.20u; the flare angle is the next draw, rejected while < 30° from a loop.

| Star | r · k | seed | Loop | A (°) | s (°) | k | x₀ | y₀ | c_x | c_y | dur (s) | begin (s) | peak at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Yellow sun (`star.svg`) | 46 · 1 | `0x5750` | P1 | 147.5 | 20.5 | 1.313 | −0.74 | 8.19 | 19.43 | 6.56 | 12 | 0 | 6 + 12n |
| | | | P2 | 243.6 | 26.7 | 1.345 | −1.25 | 10.63 | 21.60 | 8.51 | 16 | 5 | 13 + 16n |
| | | | P3 | 314.8 | 20.2 | 1.435 | −0.71 | 8.07 | 26.94 | 6.45 | 14 | 9 | 16 + 14n |
| Red dwarf (`red-dwarf.svg`) | 40 · 0.8696 | `0x5250` | P1 | 338.8 | 26.6 | 1.421 | −1.07 | 9.21 | 22.83 | 7.36 | 12 | 0 | 6 + 12n |
| | | | P2 | 248.0 | 20.2 | 1.440 | −0.62 | 7.02 | 23.69 | 5.62 | 16 | 5 | 13 + 16n |
| | | | P3 | 167.2 | 22.0 | 1.378 | −0.74 | 7.64 | 20.41 | 6.11 | 14 | 9 | 16 + 14n |
| Blue giant (`blue-giant.svg`) | 54 · 1.1739 | `0x4250` | P1 | 332.7 | 21.7 | 1.329 | −0.96 | 10.15 | 24.04 | 8.12 | 12 | 0 | 6 + 12n |
| | | | P2 | 243.5 | 22.9 | 1.314 | −1.08 | 10.74 | 22.95 | 8.59 | 16 | 5 | 13 + 16n |
| | | | P3 | 168.7 | 27.0 | 1.387 | −1.49 | 12.60 | 28.37 | 10.08 | 14 | 9 | 16 + 14n |

| Star | Stroke · σ | Loop colour | Flare A (°) | Flare wedge (base 3 k on the limb, tip at 1.7 r) | Flare gradient (limb → tip) |
|---|---|---|---|---|---|
| Yellow sun | 2.5 · 1.5 | `star.corona #FF8C2E` | 25.0 | `M46 −1.5 L78.2 0 L46 1.5 Z` | `#FFF8E1` → `#FFC857` |
| Red dwarf | 2.2 · 1.3 | `redDwarf.corona #E0432F` | 117.9 | `M40 −1.3 L68 0 L40 1.3 Z` | `#FFD9B0` → `#FF7A4D` |
| Blue giant | 2.9 · 1.8 | `blueGiant.corona #5EA0FF` | 278.3 | `M54 −1.75 L91.8 0 L54 1.75 Z` | `#FFFFFF` → `#B8CCFF` |

**Timing.** Each loop: scale about its base point 0.6 → 1.0 → 0.6 and α 0 → 0.55 → 0 over `dur`, starting at `begin`, repeating for ever, SMIL splines `0.42 0 0.58 1` on both halves. The Canvas form uses the same ease-in-out hump: `hump = sin²(π · u)` with `u = frac((t − begin) / dur)`, `s = 0.6 + 0.4 hump`, `a = 0.55 hump`; before `begin` the loop is invisible (its SVG base attributes are `scale(0.6)`, `opacity 0`, so t = 0 shows a plain star; P1 begins at 0 s and is already at α ≈ 0.14 by 2 s). Peaks fall at 6 + 12n, 13 + 16n and 16 + 14n s — never all three at once. The flare: α `0; 0; 0.7; 0; 0` at keyTimes `0; 0.5909; 0.6318; 0.6727; 1` of a 22 s cycle = invisible until **13.0 s**, peak 0.7 at **13.9 s**, gone at **14.8 s** — a triangle of half-width 0.9 s centred on 13.9 s (not on 13 s: 13 s is where it starts rising).

### Other stars' streamers (the sun's are in §3)

The red dwarf and blue giant scale the v1.1 construction by k = r / 46: base r 48 k, `w = (10 + 8u) k`, `T = (110 + 65u) k`, `α = 0.10 + 0.06u` (× 0.7 on the red dwarf — the "calmer corona"); lobes base 40 k at r 48 k, tip 150 k, α 0.06 (0.042 red dwarf), angles 122° / 292°. The blue giant has **14** streamers with a **14°** minimum spacing (the 20° rule cannot place 14 wedges). `[A°, w, T, α]`:

```ts
// red dwarf: mulberry32(0x5244), 10 streamers (α × 0.7) + 2 lobes (base 34.8 at r 41.7, tip 130.4)
const RED_DWARF_STREAMERS: [number, number, number, number][] = [
  [ 97.8, 14.8, 106.9, 0.096], [174.8, 13.0, 149.8, 0.071], [302.6,  9.7, 131.8, 0.103],
  [148.9, 14.1, 136.2, 0.109], [228.4, 11.6, 126.1, 0.107], [119.0, 13.6, 140.2, 0.082],
  [ 57.4,  9.5, 134.0, 0.109], [ 36.2, 10.4, 130.0, 0.084], [360.0, 15.5, 133.5, 0.101],
  [336.7, 12.8, 130.9, 0.081],
  [122.0, 34.8, 130.4, 0.042], [292.0, 34.8, 130.4, 0.042],
];
// blue giant: mulberry32(0x4247), 14 streamers (≥ 14° apart) + 2 lobes (base 47 at r 56.3, tip 176)
const BLUE_GIANT_STREAMERS: [number, number, number, number][] = [
  [ 29.0, 19.6, 163.1, 0.126], [328.9, 14.5, 145.3, 0.134], [111.1, 17.5, 155.5, 0.143],
  [247.7, 18.6, 142.9, 0.160], [ 51.5, 14.7, 154.7, 0.137], [ 74.7, 17.0, 142.1, 0.135],
  [184.2, 13.1, 205.2, 0.145], [219.5, 15.5, 202.3, 0.121], [128.4, 17.4, 144.4, 0.156],
  [358.9, 16.0, 184.3, 0.112], [310.5, 19.9, 147.0, 0.145], [152.8, 20.9, 177.9, 0.153],
  [292.9, 17.7, 174.6, 0.140], [265.7, 20.7, 152.8, 0.105],
  [122.0, 47.0, 176.0, 0.060], [292.0, 47.0, 176.0, 0.060],
];
```

### Spec and loop sprites

```ts
interface LoopSpec { A: number; x0: number; y0: number; cx: number; cy: number; dur: number; begin: number }
interface FlareSpec { A: number; core: string; body: string }

interface StarSpec {
  r: number;                                   // 46 / 40 / 54 (zoom 1)
  crashRadius: number;                         // = r for every star: 46 / 40 / 54 (contact = the solid disc, §4b)
  core: string; body: string; corona: string; glow: string;
  glowR: number; coronaR: number;              // 200 / 130 · 174 / 113 · 240 / 153
  streamers: [number, number, number, number][];
  granulation: { seed: number; cells: number; alpha: number };   // sun 3 / 14 / 0.16 · red dwarf 5 / 9 / 0.22 · blue giant 9 / 20 / 0.12
  loops: LoopSpec[]; stroke: number; blur: number;             // stroke 2.5 k, σ 1.5 k
  flare: FlareSpec;
}

const SUN: StarSpec = {
  r: 46, crashRadius: 46, core: "#FFF8E1", body: "#FFC857", corona: "#FF8C2E", glow: "#FF5A1F", glowR: 200, coronaR: 130,
  streamers: STAR_STREAMERS, granulation: { seed: 3, cells: 14, alpha: 0.16 },
  loops: [ { A: 147.5, x0: -0.74, y0: 8.19,  cx: 19.43, cy: 6.56, dur: 12, begin: 0 },
           { A: 243.6, x0: -1.25, y0: 10.63, cx: 21.60, cy: 8.51, dur: 16, begin: 5 },
           { A: 314.8, x0: -0.71, y0: 8.07,  cx: 26.94, cy: 6.45, dur: 14, begin: 9 } ],
  stroke: 2.5, blur: 1.5, flare: { A: 25.0, core: "#FFF8E1", body: "#FFC857" },
};
const RED_DWARF: StarSpec = {
  r: 40, crashRadius: 40, core: "#FFD9B0", body: "#FF7A4D", corona: "#E0432F", glow: "#8C1E2A", glowR: 174, coronaR: 113,
  streamers: RED_DWARF_STREAMERS, granulation: { seed: 5, cells: 9, alpha: 0.22 },        // 0.07 · 128 ≈ 9
  loops: [ { A: 338.8, x0: -1.07, y0: 9.21, cx: 22.83, cy: 7.36, dur: 12, begin: 0 },
           { A: 248.0, x0: -0.62, y0: 7.02, cx: 23.69, cy: 5.62, dur: 16, begin: 5 },
           { A: 167.2, x0: -0.74, y0: 7.64, cx: 20.41, cy: 6.11, dur: 14, begin: 9 } ],
  stroke: 2.2, blur: 1.3, flare: { A: 117.9, core: "#FFD9B0", body: "#FF7A4D" },
};
const BLUE_GIANT: StarSpec = {
  r: 54, crashRadius: 54, core: "#FFFFFF", body: "#B8CCFF", corona: "#5EA0FF", glow: "#2C4FBF", glowR: 240, coronaR: 153,
  streamers: BLUE_GIANT_STREAMERS, granulation: { seed: 9, cells: 20, alpha: 0.12 },     // 0.16 · 128 ≈ 20
  loops: [ { A: 332.7, x0: -0.96, y0: 10.15, cx: 24.04, cy: 8.12,  dur: 12, begin: 0 },
           { A: 243.5, x0: -1.08, y0: 10.74, cx: 22.95, cy: 8.59,  dur: 16, begin: 5 },
           { A: 168.7, x0: -1.49, y0: 12.60, cx: 28.37, cy: 10.08, dur: 14, begin: 9 } ],
  stroke: 2.9, blur: 1.8, flare: { A: 278.3, core: "#FFFFFF", body: "#B8CCFF" },
};

// One loop sprite: 96 × 64 CSS px at r 46 (× k, × DPR); the base point sits at (16 k, 32 k) so the whole arc
// (peak ≤ 0.435 r = 20 px, half-span ≤ 12.6 px, plus stroke and 3σ of blur) fits. The blur is baked here, once:
// three strokes of decreasing width stand in for the SVG's feGaussianBlur (no ctx.filter dependency, no shadowBlur).
const LOOP_W = 96, LOOP_H = 64, LOOP_OX = 16, LOOP_OY = 32;

function buildLoopSprite(star: StarSpec, l: LoopSpec): HTMLCanvasElement {
  const k = star.r / 46;
  const c = document.createElement("canvas");
  c.width = Math.ceil(LOOP_W * k * DPR); c.height = Math.ceil(LOOP_H * k * DPR);
  const g = c.getContext("2d")!;
  g.setTransform(DPR, 0, 0, DPR, LOOP_OX * k * DPR, LOOP_OY * k * DPR);   // origin = the base point
  g.lineCap = "round"; g.lineJoin = "round";
  const path = new Path2D(`M${l.x0} ${-l.y0} C${l.cx} ${-l.cy} ${l.cx} ${l.cy} ${l.x0} ${l.y0}`);
  const passes: [number, number][] = [[4 * star.blur, 0.18], [2 * star.blur, 0.30], [0, 1]];   // extra width, alpha share
  for (const [extra, a] of passes) {
    g.strokeStyle = rgba(star.corona, a);
    g.lineWidth = star.stroke + extra;
    g.stroke(path);
  }
  return c;
}

// One flare sprite per star kind: the wedge base 3 k on the limb → tip at 1.7 r, i.e. 0.7 r long, in a 0.7 r × (3 k + 2) px box
// (1 px of padding above and below), core → body gradient along it, built once at DPR. Drawn at the flare angle with globalAlpha.
function buildFlareSprite(star: StarSpec): { canvas: HTMLCanvasElement; w: number; h: number } {
  const k = star.r / 46, w = 0.7 * star.r, h = 3 * k + 2;
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
  const g = c.getContext("2d")!;
  g.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);                    // draw in CSS px, exactly filling the bitmap
  const lg = g.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, star.flare.core); lg.addColorStop(1, star.flare.body);
  g.fillStyle = lg;
  g.beginPath(); g.moveTo(0, h / 2 - 1.5 * k); g.lineTo(w, h / 2); g.lineTo(0, h / 2 + 1.5 * k); g.closePath(); g.fill();
  return { canvas: c, w, h };
}

interface StarSprites {
  S: number;                                   // envelope size in CSS px at zoom 1: 400 / 348 / 480
  envelope: HTMLCanvasElement; body: HTMLCanvasElement; bodySize: number;
  loops: HTMLCanvasElement[];
  flare: HTMLCanvasElement; flareW: number; flareH: number;
}

// envelope = §3 layers 1–4 (S px), body = layers 5–7 ((2 · 48 k + 8) px), 3 loop sprites, 1 flare sprite. ≈ 2.5 ms once per star kind.
function buildStarSprites(star: StarSpec): StarSprites {
  const k = star.r / 46;
  const S = Math.ceil(2 * Math.max(star.glowR, 200 * k)), c = S / 2;        // 400 / 348 / 480 — the whole glow fits
  const envelope = document.createElement("canvas");
  envelope.width = envelope.height = S * DPR;
  const g = envelope.getContext("2d")!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const layer = (ctx: CanvasRenderingContext2D, cx: number, r: number, stops: [number, string][]) => {
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, r);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cx, r, 0, Math.PI * 2); ctx.fill();
  };
  layer(g, c, star.glowR,   [[0, rgba(star.glow, 0.50)],   [0.23, rgba(star.glow, 0.45)],
                             [0.65, rgba(star.glow, 0.12)], [1, rgba(star.glow, 0)]]);          // 1. glow
  layer(g, c, star.coronaR, [[0, rgba(star.corona, 0.90)], [0.35, rgba(star.corona, 0.70)],
                             [0.62, rgba(star.corona, 0.22)], [1, rgba(star.corona, 0)]]);      // 2. corona
  bakeStreamers(g, S, k, star.streamers, star.corona);                                         // 3+4. wedges α a → 0, blurred σ 6 k once (§3)

  const bodySize = Math.ceil(2 * 48 * k + 8), bc = bodySize / 2;
  const body = document.createElement("canvas");
  body.width = body.height = bodySize * DPR;
  const h = body.getContext("2d")!;
  h.setTransform(DPR, 0, 0, DPR, 0, 0);
  h.lineWidth = 1;                                                                              // 5. chromosphere rings
  for (const [rr, a] of [[46, 0.60], [47, 0.35], [48, 0.15]] as [number, number][]) {
    h.strokeStyle = rgba(star.corona, a); h.beginPath(); h.arc(bc, bc, rr * k, 0, Math.PI * 2); h.stroke();
  }
  layer(h, bc, star.r, [[0, star.core], [0.45, star.body], [0.78, star.body], [0.90, star.corona], [1, star.glow]]);   // 6. body
  h.save();                                                                                     // 7. granulation
  h.beginPath(); h.arc(bc, bc, star.r, 0, Math.PI * 2); h.clip();
  h.globalCompositeOperation = "multiply"; h.globalAlpha = star.granulation.alpha;
  h.fillStyle = h.createPattern(makeNoiseTile(128, star.granulation.seed, 2, 2, star.granulation.cells), "repeat")!;
  h.fillRect(bc - star.r, bc - star.r, 2 * star.r, 2 * star.r);
  h.restore();

  const fl = buildFlareSprite(star);
  return { S, envelope, body, bodySize, loops: star.loops.map((l) => buildLoopSprite(star, l)),
           flare: fl.canvas, flareW: fl.w, flareH: fl.h };
}
```

### Per-frame draw

```ts
const hump = (u: number): number => { const s = Math.sin(Math.PI * u); return s * s; };   // 0 → 1 → 0, ease-in-out
const tri = (x: number, hw: number): number => Math.max(0, 1 - Math.abs(x) / hw);

// tS = the scene clock in seconds (§0: dt-accumulated, clamped, never simulation time). sx, sy = screen centre.
// Per frame: drawImage, clip-free transforms and globalAlpha only — no gradient, path, fill or closure is created.
function drawLibraryStar(ctx: CanvasRenderingContext2D, star: StarSpec, sp: StarSprites,
                         sx: number, sy: number, zoom: number, tS: number): void {
  const k = star.r / 46;
  const breathe = 1 + 0.03 * Math.sin((tS / 6) * Math.PI * 2);                 // ±3 % / 6 s, envelope only
  const es = sp.S * zoom * breathe;                                            // the bitmap's own size, never a rounded 400 k
  ctx.drawImage(sp.envelope, sx - es / 2, sy - es / 2, es, es);                // 1. glow + corona + soft streamers

  const r = star.r * zoom;
  for (let i = 0; i < star.loops.length; i++) {                                // 2. prominences: scale + alpha about the base point
    const l = star.loops[i];
    if (tS < l.begin) continue;
    const hmp = hump(frac((tS - l.begin) / l.dur));
    const s = 0.6 + 0.4 * hmp, a = 0.55 * hmp;
    if (a < 0.005) continue;
    const A = (l.A * Math.PI) / 180;
    ctx.save();
    ctx.translate(sx + r * Math.cos(A), sy + r * Math.sin(A));                // base point on the (un-breathed) limb
    ctx.rotate(A);
    ctx.scale(s * zoom, s * zoom);
    ctx.globalAlpha = a;
    ctx.drawImage(sp.loops[i], -LOOP_OX * k, -LOOP_OY * k, LOOP_W * k, LOOP_H * k);
    ctx.restore();
  }

  const fa = 0.7 * tri(((tS % 22) + 22) % 22 - 13.9, 0.9);                     // 3. flare: 13.0 → 13.9 (peak) → 14.8 s of 22
  if (fa > 0) {
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate((star.flare.A * Math.PI) / 180); ctx.scale(zoom, zoom);
    ctx.globalAlpha = fa;
    ctx.drawImage(sp.flare, star.r, -sp.flareH / 2, sp.flareW, sp.flareH);     // cached wedge: limb (r) → tip (1.7 r)
    ctx.restore();
  }

  const bs = sp.bodySize * zoom;                                               // 4. chromosphere + body + granulation, no breathe
  ctx.drawImage(sp.body, sx - bs / 2, sy - bs / 2, bs, bs);
}
```

Everything is a blit: the flare is a cached sprite like the loops (built once at DPR and scaled by `drawImage`, §12), so the frame loop allocates nothing — no gradient, no path, no closure (a plain `for`, not `forEach`). It stays crisp because it is drawn at its built size × zoom and its only motion is `globalAlpha`. `tS` is the scene clock of §0 (the same one as the planet strips: `dt`-accumulated, clamped after a tab switch), so 1x / 2x / 4x do not change the cadence. At `tS = 0` every loop and the flare are at α 0 (a plain star, exactly like the SVG); P1 (begin 0 s) is at α ≈ 0.14 by 2 s and peaks at 6 s; the flare first pops at 13.9 s.

### Cost

Per star per frame: 2 sprite blits + ≤ 3 loop blits (each a 96 k × 64 k source scaled ≤ 1.0; with the a < 0.005 cutoff each is drawn ≈ 94 % of its cycle — the sin² hump is below 0.005 / 0.55 only for ≈ 6 % of it) + ≤ 1 flare blit (only 1.8 s of every 22 s) ≈ **0.15 ms** (the brief's "≈ 0.05 ms per star" for the flares alone holds: ≤ 4 scaled blits of small bitmaps). Build, once per star kind: envelope ≈ 2 ms (the blurred streamer pass included), body ≈ 0.3 ms, three loop sprites ≈ 0.1 ms, flare sprite ≈ 0.02 ms. Memory: three 96 × 64 and one ≈ 32 × 5 (× k × DPR) bitmaps per star — negligible. Zoom: all five bitmaps are fixed-size and scaled by `drawImage` like the v1.1 star sprite; at zoom 2 the loops are 2× upsampled, which on a blurred stroke is invisible.

---

## 3c. Black hole, white dwarf, neutron star (v1.3 compact objects)

Three emissive bodies without a terminator, granulation, streamers, prominences or flares. Each is a small stack of cached sprites; the only live motion is a scale (white dwarf glow), a rotation of one sprite (neutron star beams) and a rotation of one ring sprite drawn twice (black hole disk). Zero `shadowBlur`, zero per-frame blur; the SVGs' `feGaussianBlur`s (white-dwarf corona σ 3, beams σ 0.6, haze σ 1, photon ring σ 1, arcs σ 1, streaks σ 0.7) are baked into the sprites with the three-stroke fake blur of §3b's loops / the multi-fill fallback of §3 `bakeStreamers` (or `ctx.filter` at build time where supported) or skipped where the gradient's own falloff is enough. The headers of `bodies/white-dwarf.svg`, `bodies/neutron-star.svg` and `bodies/black-hole.svg` are the canon. Gameplay: all three crash at their solid disc — **crashRadius 16 / 8 / 22** — and the black hole's gravity is star-class (§4b).

### White dwarf — r 16, two sprites, 2 blits

| Layer | Geometry | Stops / values |
|---|---|---|
| glow (sprite A, breathes) | disc r 6 r = 96 → sprite 200 px | `#7FB8FF` 0.00 α 0.55 · 0.10 α 0.42 · 0.30 α 0.16 · 0.60 α 0.04 · 1.00 α 0; **scale 1 → 1.05 → 1 → 0.95 → 1 over 4 s** (sine), t = 0 = rest |
| corona (sprite B) | disc r 2.25 r = 36 | `#B8CCFF` 0.00 α 0.85 · 0.45 α 0.45 · 0.75 α 0.12 · 1.00 α 0 (the SVG blurs σ 3; the gradient falloff stands in) |
| spikes (B) | 4 lines, 1 px, at 0° / 90° / 180° / 270°, from r 16 to r 64 (4 r) | `#E9EEF8` α 0.30 at the base → 0 at the tip (linear gradient per line), static |
| bloom (B) | disc r 1.4 r = 22.4 | `#FFFFFF` 0.00 α 0.45 · 0.70 α 0.45 · 1.00 α 0 |
| body (B) | disc r 16 | 0.00 `#FFFFFF` · 0.55 `#FFFFFF` · 0.85 `#E9EEF8` · 1.00 `#B8CCFF` |
| limb (B) | 1 px ring at r 15.5 | `#B8CCFF` α 0.85 — the hard thin limb |

Sprite B (corona + spikes + bloom + body + limb, 136 px square) is static; only sprite A scales, so the crash disc never moves (the SVG breathes the glow alone too). Blitting the whole thing with the ±5 % breathe would also be fine visually (0.8 px on the body), but two blits keep the rule "the solid disc never animates".

```ts
let wdGlow: HTMLCanvasElement, wdDisc: HTMLCanvasElement;       // 200 px and 136 px CSS, × DPR, built once (≈ 0.3 ms)

function drawWhiteDwarf(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tS: number): void {
  const b = 1 + 0.05 * Math.sin((tS / 4) * Math.PI * 2);        // glow breathe ±5 % / 4 s
  const gs = 200 * zoom * b, ds = 136 * zoom;
  ctx.drawImage(wdGlow, sx - gs / 2, sy - gs / 2, gs, gs);
  ctx.drawImage(wdDisc, sx - ds / 2, sy - ds / 2, ds, ds);
}
```

### Neutron star — r 8, three sprites, 3 blits

| Layer | Geometry | Stops / values |
|---|---|---|
| glow (sprite A, static) | disc r 5 r = 40 → 84 px sprite | `#B48CFF` 0.00 α 0.60 · 0.18 α 0.42 · 0.45 α 0.14 · 1.00 α 0 |
| magnetosphere (sprite B, **rotates**) | 80 px sprite, drawn with `rotate(30° + 360° · t / 6 s)` — clockwise, t = 0 = the magnetic axis 30° from vertical, top pole toward the upper-right | **haze:** ellipse rx 2.5 r = 20, ry 0.6 r = 4.8, `#B48CFF` α 0.12 (σ 1 baked: fill twice, 22 × 5.5 at α 0.05 then 20 × 4.8 at α 0.09); **beams:** two trapezoids, north `(−3.2, −7) (3.2, −7) (7, −36) (−7, −36)`, south = the same rotated 180° — base width 0.8 r = 6.4 at y −7 (1 px inside the limb), length 3.5 r = 28 (tip at 4.5 r), tip width 14; fill = linear gradient along the axis, base `#DCE4FF` α 0.35 → tip `#B48CFF` α 0 |
| body + limb (sprite C, static) | 20 px sprite | body disc r 8: 0.00 `#FFFFFF` · 0.50 `#FFFFFF` · 0.85 `#DCE4FF` · 1.00 `#B48CFF`; limb 1 px at r 7.5 `#DCE4FF` α 0.9 |

The beams go **under** the body, so the body is its own sprite (or two live ops — a radial fill and a 1 px stroke — which cost the same). The haze turns with the beams: the SVG treats the equatorial belt as tied to the magnetic axis, which keeps every phase coherent (a fixed haze would read as a mismatch twice per turn).

```ts
let nsGlow: HTMLCanvasElement, nsMag: HTMLCanvasElement, nsBody: HTMLCanvasElement;   // 84 / 80 / 20 px CSS, × DPR

function drawNeutronStar(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tS: number): void {
  const gs = 84 * zoom, ms = 80 * zoom, bs = 20 * zoom;
  ctx.drawImage(nsGlow, sx - gs / 2, sy - gs / 2, gs, gs);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.PI / 6 + ((tS % 6) / 6) * Math.PI * 2);        // 30° at t = 0, one turn per 6 s, clockwise
  ctx.drawImage(nsMag, -ms / 2, -ms / 2, ms, ms);
  ctx.restore();
  ctx.drawImage(nsBody, sx - bs / 2, sy - bs / 2, bs, bs);
}
```

### Black hole — r 22, two static cells + one ring sprite drawn twice + one overlay, 5 blits

The SVG's draw order is glow → top lensed arc → **back** half of the disk → shadow → photon ring → **front** half of the disk → bottom lensed arc → Einstein ring, split along the disk's horizontal axis (front = lower half). Because the shadow must occlude the back half and the front half must cover the shadow, the static layers are cached in **one atlas with two cells** and blitted around the two ring draws. The brief caps the black hole at **≤ 5 `drawImage` per frame**; this is the 5-call form (the SVG's bottom arc + Einstein ring are folded into cell B, i.e. drawn *before* the front half instead of after it — see the note below the code):

| Cell | Contents (all static; 160 px square each, centred; built in this order inside the cell) |
|---|---|
| A (before the back half) | **glow** disc r 3 r = 66, `#FF8C2E` 0.00 α 0.20 · 0.45 α 0.09 · 1.00 α 0; **top lensed arc**: annulus sector r 25.3–28.6 (1.15–1.3 r), 190° → 350°, ramp 25.3 `#FFC857` α 0.90 · 26.6 `#FF8C2E` α 0.75 · 28.6 `#B48CFF` α 0.30, multiplied by a vertical alpha 0 at y = 0 → 1 at \|y\| ≥ 20 and by the Doppler mask (below, baked), group α **0.70**, σ 1 (two-fill fake blur) |
| B (between the halves) | 1. **back-half Doppler darkening**: the upper half (y < 0) of the disk's elliptical annulus (outer rx 57.2 × ry 12.1, inner rx 30.8 × ry 6.5 — exactly the disk's edges), filled `#000000` with a linear alpha 0 at x = −57.2 → 0.45 at x = +57.2, then the top-arc band cut out of it (`destination-out` with the arc's annulus sector) so the arc, which has the mask baked in A, is not darkened twice; 2. **shadow** disc r 22 `#000000`; 3. **photon ring** 1.5 px at r 24, `#FFFFFF` α 0.90, σ 1 (stroke 3.5 at α 0.3 under stroke 1.5 at α 0.9) — drawn after the darkening, so it stays at full strength like the SVG's; 4. **bottom lensed arc**: same as the top one, 10° → 170°, Doppler baked, group α **0.50** (the secondary image is weaker — the asymmetric silhouette); 5. **Einstein ring** 1 px at r 2.1 r = 46.2, `#7FB8FF` α 0.12 |

**Ring texture sprite** — the accretion disk as a flat annulus in a *circular* frame, inner 1.4 r = 30.8, outer 2.6 r = 57.2, built at 2× (so the squash does not blur it): colour ramp radial 0.538 (= 30.8/57.2) `#FFF8E1` α 0.90 · 0.62 `#FFC857` α 0.85 · 0.78 `#FF8C2E` α 0.60 · 0.92 `#B48CFF` α 0.28 · 1.00 `#B48CFF` α 0.10 — a hard hot inner edge (clip the annulus at 30.8), a soft violet outer edge; then **radial streaks** from `mulberry32(0xB1AC)`: 40 bright `#FFF8E1` α 0.10–0.24 at angles i · 9° ± 3° and 28 dark `#000000` α 0.10–0.22 at i · 12.86° + 6.4° ± 4°, each a tapered wedge with base width 0.5–1.1 px at a base radius 30.8–38.8, tip width 1.0–2.4 px, length 8–34 px (clamped at 57.2), σ 0.7 (draw each wedge twice: 1 px wider at half alpha, then as is), the whole streak layer faded radially by `destination-in` (α 1.0 at r 30.8 · 0.8 at 48.6 · 0.35 at 57.2); then a **dark mottle** — the 128 px value-noise tile (seed 5, 2 octaves, cells ≈ 0.08 · 115 ≈ 9) painted black with α = clamp(0.9 v − 0.25, 0, 1) per pixel (the SVG's 0.30 (R + G + B) − 0.25 on a grey field; `paintLayer`-style loop at build time) and composited `source-atop` so it darkens ring pixels only. The asset realises the brief's "stretched turbulence 0.9 / 0.02" as these explicit wedges because an SVG filter cannot wrap a strip into a ring; Canvas may bake either look, the wedges are simply what the canon shows. The exact per-streak draw order of the asset's generator is not needed — matching the look is.

**Squash and rotation.** The sprite is drawn with `translate(sx, sy) → scale(1, 0.2115) → rotate(phase)`, phase = 2π · (t mod 24) / 24, **clockwise**. 0.2115 = ry / rx = 0.55 r / 2.6 r: the brief's "ctx.scale(1, 0.55)" is ry **in units of r**, not the squash factor — at a 0.55 squash the back disk would hide the top arc entirely. On screen the outer ellipse is rx 57.2 × ry 12.1, the inner rx 30.8 × ry 6.5. The rotation sits inside the squash, so the motion is correctly elliptical and both halves share one phase (the forced mid-rotation renders show the streaks advancing identically across the split).

**Doppler beaming** — the SVG multiplies the disk and the arcs by a static linear alpha 1.0 at x = −57.2 (the approaching left half) → 0.55 at x = +57.2. Canvas cannot `destination-in` on the main canvas, so the equivalent is a **darkening** in `#000000` at α 0 (left) → 0.45 (right), drawn `source-over` over the disk only: over the near-black field that equals the multiply by 1.0 → 0.55 to within 1 %. It is split by half so it never touches the rings: the **back** half's darkening is baked into cell B *under* the shadow and the photon ring (B step 1); the **front** half's is the cached overlay `bhDoppler` drawn last — the lower half (y ≥ 0) of the same annulus (outer 57.2 × 12.1, inner 30.8 × 6.5), with the bottom-arc band cut out. The arcs carry the mask baked in (cells A and B). Residuals, all invisible at 1×: where the photon ring's lower arc and the Einstein ring show *through* the semi-transparent front half (disk α ≥ 0.6 there) the overlay dims that see-through share too, exactly as the front half itself would.

```ts
let bhAtlas: HTMLCanvasElement;         // 2 cells of 160 × 160 CSS px side by side (320 × 160, × DPR): A | B
let bhRing: HTMLCanvasElement;          // 120 × 120 CSS px annulus r 30.8–57.2, built at 2 × DPR
let bhDoppler: HTMLCanvasElement;       // 160 × 160 CSS px front-half darkening (lower half of the disk annulus, α 0 → 0.45 left → right)
const BH_SQUASH = 0.2115;               // ry / rx = 0.55 r / 2.6 r

function bhCell(ctx: CanvasRenderingContext2D, cell: number, sx: number, sy: number, zoom: number): void {
  const s = 160 * zoom;
  ctx.drawImage(bhAtlas, cell * 160 * DPR, 0, 160 * DPR, 160 * DPR, sx - s / 2, sy - s / 2, s, s);
}

function bhHalf(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, phase: number, upper: boolean): void {
  ctx.save();
  ctx.beginPath();                                                   // clip to one half-plane: back = y < sy, front = y ≥ sy
  ctx.rect(sx - 70 * zoom, upper ? sy - 20 * zoom : sy, 140 * zoom, 20 * zoom);
  ctx.clip();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom * BH_SQUASH);                                 // squash outside …
  ctx.rotate(phase);                                                 // … rotation inside → elliptical motion, one phase for both halves
  ctx.drawImage(bhRing, -60, -60, 120, 120);
  ctx.restore();
}

// 5 drawImage (the brief's cap), zero shadowBlur, ≈ 0.13 ms. tS = the scene clock (§0).
function drawBlackHole(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tS: number): void {
  const phase = ((tS % 24) / 24) * Math.PI * 2;                      // 360° / 24 s, clockwise (positive in Canvas, y down)
  bhCell(ctx, 0, sx, sy, zoom);                                      // 1. A: glow + top lensed arc
  bhHalf(ctx, sx, sy, zoom, phase, true);                            // 2. back half of the disk
  bhCell(ctx, 1, sx, sy, zoom);                                      // 3. B: back Doppler + shadow + photon ring + bottom arc + Einstein ring
  bhHalf(ctx, sx, sy, zoom, phase, false);                           // 4. front half of the disk
  const s = 160 * zoom;
  ctx.drawImage(bhDoppler, sx - s / 2, sy - s / 2, s, s);            // 5. front-half Doppler: left brighter (1.0 → 0.55)
}
```

Order: A → back half → B (+ the SVG's last two layers) → front half → Doppler overlay = **5 `drawImage`**, which is what the brief and `black-hole.svg`'s header specify. Folding the bottom lensed arc and the Einstein ring into B moves them *under* the front half; the only pixels where that matters are where they overlap the front disk — the arc's lowest-α tail at \|y\| < 12 (already faded below α 0.3 × 0.5 by the vertical mask) and the 1 px α 0.12 Einstein ring near y ≈ 0 at x ≈ ±46 — so the difference is invisible at every zoom the prototype uses. **Optional 6-call variant** (the SVG's exact stacking, one blit over the cap): keep the bottom arc and the Einstein ring in a third cell C (atlas 480 × 160) and blit it after the front half, before the Doppler overlay. The half-plane clips are axis-aligned rects, so they cost nothing; the ring sprite is 120 px at 2 × DPR = 480² device px (≈ 0.9 MB), built once (≈ 2 ms: ramp, 68 wedges × 2 fills, fade, mottle loop). Static renders show t = 0 = streak phase 0.

### Cost (per frame)

| Body | Draw calls | ≈ ms |
|---|---|---|
| White dwarf | 2 blits (glow scaled by the 4 s breathe, disc static) | 0.05 |
| Neutron star | 3 blits (glow, rotated 80 px magnetosphere, body) | 0.05 |
| Black hole | **5 blits**: 2 atlas cells + 2 clipped ring draws + 1 front-half Doppler overlay (optional 6-call variant: + cell C) | 0.13 |

All three scale like the star sprite — fixed bitmaps that `drawImage` scales (the prototype never zooms past 2×, §12).

---

## 4. Planets

### v1.2: scrolling strips under a fixed lighting overlay
In v1 each planet was one live radial gradient; v1.1 baked noise, terminator and rim into a cached sprite. v1.2 splits that sprite in two so the surface can **rotate**: a **texture strip** (base colour + thresholded noise layers + polar caps, two tiles wide, period P = round(2π r)) and a second strip for the **clouds / wisps**, both built once and slid under a cached **lighting overlay** (limb squash, glint, terminator, limb line, rim) that never moves. Per frame, per planet: `save` → `clip(arc r)` → `drawImage(surface, x − r − P + φₛ·P)` → `drawImage(cloud, x − r − P + φ꜀·P)` → `restore` → `drawImage(overlay)` — **1 clip + 3 blits ≈ 0.08 ms**, no per-frame noise, no blur, no blend mode. The silhouette is still a circle, so every zoom rule from v1 holds; strips and overlay are re-rendered only when the zoom **bucket** changes (§12). The SVG assets (`planet-start.svg`, `planet-x.svg`) are the canon — their header comments list every frequency, seed, threshold, period and coverage; this section reproduces them with the value-noise tile from v1.1.

Light comes from the star: **L** is the unit vector from the planet to the star (start (+0.7071, −0.7071), X (−0.7071, +0.7071) on the mockup). The bodies never move in this prototype, so L is fixed per overlay; if they ever did, rebuild when L turns by more than ~5°. Rotation is **wall-clock** (`dt` from the frame clock), identical at 1x / 2x / 4x — it is weather, not simulation state — and it keeps running under the result overlays.

### Geometry (both planets)

| | Start planet | Planet X |
|---|---|---|
| r (zoom 1) | 34 | 30 |
| Strip period P = round(2π r) | **214** px | **188** px |
| Tile = P × 2r | 214 × 68 | 188 × 60 |
| Strip bitmap = 2 tiles | 428 × 68 (856 × 136 device px at DPR 2) | 376 × 60 (752 × 120) |
| Surface period / speed at zoom 1 | **90 s** / 2.38 px/s (a feature crosses the disc in ≈ 29 s) | **120 s** / 1.57 px/s (≈ 38 s) |
| Cloud / wisp period / speed | **64 s** / 3.34 px/s (clouds overtake the land at ≈ 1 px/s, lapping it every 90·64/(90−64) ≈ 222 s) | **80 s** / 2.35 px/s (lap every 240 s) |
| Direction | west→east: the texture moves **left→right**, i.e. the drawImage x offset grows with time (the brief's sketch `to="−P 0"` / `−((t/period)·W) mod W` would scroll east→west; +P is what its prose asks for) | same |
| Lighting overlay | (2 · 1.12 r + 4) px square → **81 px** | **72 px** |
| Limb squash | radial, base α 0 at 0.88 r → α 0.45 at r (texture fades to 55 % in the outer 12 % of r) | same, `planet.x.base` |
| Specular glint | ellipse 0.22 r × 0.12 r = 7.5 × 4.1 at 0.45 r·L = (+10.82, −10.82), long axis along L, `planet.specular #FFFFFF` α 0.35 → 0.18 at 50 % → 0 | none (no liquid) |
| Terminator, limb line, rim | v1.1 numbers, unchanged (table below) | v1.1, unchanged |
| Polar caps (in the strip) | top and bottom **12 %** of the disc = 8.16 px bands, `planet.start.ice #E9EEF8` | **18 %** = 10.8 px, `planet.x.ice #B5FFF0` |

### Texture layers (what the strips contain)

The SVG thresholds `feTurbulence` alpha with `feFuncA type="linear"` (slope s, intercept 0.5 − s·T: alpha 0.5 at the threshold T, full ramp over 1/s). Canvas thresholds the **grey value-noise field** the same way, but sets T from a **percentile of its own field** (a 256-bin histogram, O(n)) so the *coverage* matches the asset — the two noise generators have different value distributions, and coverage is what you see. The ramp width is the SVG's 1/s expressed in this field's spread (σ ≈ 31 grey levels at contrast 1): land 0.042 → 12 levels, highlands 0.167 → 46, clouds 0.071 → 24 (the asset also blurs σ 0.8, which the wider ramp stands in for), basins 0.083 → 22. The "turbulence"-type layers (veins, wisps) are **creases**: bright where the field is closest to its median, alpha 1 − |v − median| / d, with d set so the chosen fraction of pixels is lit — the same thin-filament look as `turbulence < 0.07` / `< 0.115` in the asset.

| Layer | Planet | Noise tile (seed / cells / octaves) | Selection | Colour · alpha | Coverage |
|---|---|---|---|---|---|
| land | start | 7 / 6 / 4 (≈ 214 · 0.030) | above p68, ramp 12 | `planet.start.land #8FB07A` · 1.0 | ≈ 32 % (asset 33.5 %) |
| highlands | start | same field | above p90, ramp 46 | `planet.start.shadow #142B5E` · 0.22 | ≈ 10 % (asset threshold 0.643 ≈ p90 of its field) |
| clouds | start | 19 / 12 / 4 (≈ 214 · 0.055) | above p60, ramp 24 | `planet.start.cloud #F2F5FF` · **0.5** baked | ≈ 40 % (asset 39.6 %) |
| basins | X | 11 / 7 / 4 (≈ 188 · 0.035) | above p72, ramp 22 | `planet.x.mineral #0E4A40` · 0.60 | ≈ 28 % (asset 27.3 %) |
| veins | X | same field | crease, 5 % | `planet.x.mineral #0E4A40` · 0.35 | ≈ 5 % |
| wisps | X | 23 / 9 / 2 (≈ 188 · 0.050) | crease, 15 % | `planet.x.wisp #B5FFF0` · 0.35 baked | ≈ 15 % (asset 15.8 %) |

`cells` is the lattice size of octave 0 across one tile period (the asset's `baseFrequency · P`, rounded — `stitchTiles` does the same rounding), so one 128 px tile stretched to P px gives the same feature size as the SVG at every zoom. The cloud and wisp alphas are **baked into the strip** so the per-frame draw needs no `globalAlpha` change (drawing an α 1 strip at `globalAlpha 0.5` is equivalent and is what the brief's sketch shows).

| Planet | r | base | highlight | shadow | atmo | limb α | squash | glint |
|---|---|---|---|---|---|---|---|---|
| start | 34 | `#3D8BFF` | `#9CCBFF` | `#142B5E` | `#7FB8FF` | 0.16 | `#3D8BFF` 0 → 0.45 | yes |
| X | 30 | `#3DE0C2` | `#B5FFF0` | `#0E4A40` | `#8FFFE6` | 0.18 | `#3DE0C2` 0 → 0.45 | no |

Terminator shade (v1.1, both): radial, centre **planet centre + 0.36 r · L**, radius **1.25 r**: 0.00 `highlight` α 0.90 · 0.40 `base` α 0 · 0.70 `shadow` α 0.55 · 0.86 `shadow` α 0.92 · 1.00 `shadow` α 1.0 — the 0.70–0.86 span **is** the terminator; the transparent 0.40 stop lets the texture show on the day side. Rim (v1.1, both): disc **1.12 r**, radial from the centre, `atmo` 0.00 α 0 · 0.80 α 0 · 0.87 α **0.55** · 0.92 α **0.30** · 1.00 α 0, multiplied by a linear alpha along L from +1.12 r·L (α 1.0) to −1.12 r·L (α 0.35) — in the composite ≈ 1.5× brighter on the lit side. Limb line: 1 px at r − 0.5, `highlight` at the α above.

### Noise tile (as v1.1; contrast 1 for the strips)
A 128×128 seamless value-noise tile from `mulberry32`: a wrapping lattice of `cells` random values per edge for octave 0, doubling the lattice and halving the amplitude per octave, smoothstep-interpolated, then **contrast-stretched about 0.5** (`v' = (v − 0.5)·contrast + 0.5`, clamped). The star's granulation (§3) still uses contrast ×2; the planet strips use **contrast 1** (raw), because their thresholds are percentiles and the stretch would only clip the tails. Grey, opaque. ≈ 0.3–0.4 ms per tile with one `putImageData` at startup, kept for ever — five tiles in all (seeds 3 / 7 / 11 / 19 / 23).

```ts
// Seamless grey value-noise tile. size px square; cells = lattice points per edge at octave 0
// (planets: ≈ P · SVG baseFrequency — 6 ≈ 214·0.030, 12 ≈ 214·0.055, 7 ≈ 188·0.035, 9 ≈ 188·0.050; star: 14 ≈ 128·0.11);
// contrast about 0.5 (1 = raw).
function makeNoiseTile(size: number, seed: number, octaves: number, contrast: number, cells: number): HTMLCanvasElement {
  const rnd = mulberry32(seed);
  const lattices: Float32Array[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = cells << o, l = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) l[i] = rnd();
    lattices.push(l);
  }
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const img = new ImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1, norm = 0;
      for (let o = 0; o < octaves; o++) {
        const n = cells << o, l = lattices[o];
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        const tx = smooth(fx - x0), ty = smooth(fy - y0);
        const top = l[y0 * n + x0] + (l[y0 * n + x1] - l[y0 * n + x0]) * tx;
        const bot = l[y1 * n + x0] + (l[y1 * n + x1] - l[y1 * n + x0]) * tx;
        v += amp * (top + (bot - top) * ty);
        norm += amp; amp *= 0.5;
      }
      v = Math.min(1, Math.max(0, ((v / norm) - 0.5) * contrast + 0.5));   // contrast stretch about 0.5
      const k = Math.round(v * 255), i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = k; d[i + 3] = 255;
    }
  }
  const tile = document.createElement("canvas");
  tile.width = tile.height = size;
  tile.getContext("2d")!.putImageData(img, 0, 0);
  return tile;
}
```

### Specs

```ts
interface Body { x: number; y: number; r: number }

type Select = { kind: "above"; cover: number; ramp: number }   // alpha 0.5 where the field crosses the (1 − cover) percentile, full ramp over `ramp` grey levels
            | { kind: "crease"; cover: number };               // alpha 1 at the field's median → 0 at the distance that lights `cover` of the pixels

interface StripLayer { seed: number; cells: number; octaves: number; color: string; alpha: number; sel: Select }

interface PlanetSpec {
  r: number; base: string; highlight: string; shadow: string; atmo: string; limbAlpha: number;
  crashRadius: number;                        // contact radius next to r: = r for every planet (§4b table)
  surface: StripLayer[];                      // drawn over the base fill, in order
  caps: { color: string; frac: number } | null;   // polar bands, fraction of the disc diameter each (null: none)
  cloud?: StripLayer[];                       // OPTIONAL second strip, transparent background, alpha baked (clouds, wisps,
                                              // lava veins); omitted for single-strip bodies (rocky, ice, cracked, moon, dwarf, double)
  cloudAlpha?: (tS: number) => number;        // optional per-frame alpha of the second strip (lava veins: lavaVeinAlpha, §4b)
  specular: boolean;                          // ocean glint in the overlay (start only)
  surfacePeriod: number; cloudPeriod?: number;    // seconds per rotation; no cloudPeriod = locked to the surface (lava)
}

const PLANET_START: PlanetSpec = {
  r: 34, base: "#3D8BFF", highlight: "#9CCBFF", shadow: "#142B5E", atmo: "#7FB8FF", limbAlpha: 0.16, crashRadius: 34,
  surface: [
    { seed: 7, cells: 6, octaves: 4, color: "#8FB07A", alpha: 1,    sel: { kind: "above", cover: 0.32, ramp: 12 } },   // planet.start.land
    { seed: 7, cells: 6, octaves: 4, color: "#142B5E", alpha: 0.22, sel: { kind: "above", cover: 0.10, ramp: 46 } },   // highlands
  ],
  caps: { color: "#E9EEF8", frac: 0.12 },                                                                              // planet.start.ice
  cloud: [{ seed: 19, cells: 12, octaves: 4, color: "#F2F5FF", alpha: 0.5, sel: { kind: "above", cover: 0.40, ramp: 24 } }], // planet.start.cloud
  specular: true, surfacePeriod: 90, cloudPeriod: 64,
};
const PLANET_X: PlanetSpec = {
  r: 30, base: "#3DE0C2", highlight: "#B5FFF0", shadow: "#0E4A40", atmo: "#8FFFE6", limbAlpha: 0.18, crashRadius: 30,
  surface: [
    { seed: 11, cells: 7, octaves: 4, color: "#0E4A40", alpha: 0.60, sel: { kind: "above", cover: 0.28, ramp: 22 } },  // planet.x.mineral basins
    { seed: 11, cells: 7, octaves: 4, color: "#0E4A40", alpha: 0.35, sel: { kind: "crease", cover: 0.05 } },           // veins
  ],
  caps: { color: "#B5FFF0", frac: 0.18 },                                                                              // planet.x.ice
  cloud: [{ seed: 23, cells: 9, octaves: 2, color: "#B5FFF0", alpha: 0.35, sel: { kind: "crease", cover: 0.15 } }],   // planet.x.wisp
  specular: false, surfacePeriod: 120, cloudPeriod: 80,
};

const noiseTiles = new Map<string, HTMLCanvasElement>();            // built once per (seed, cells, octaves), kept
function noiseTile(l: StripLayer): HTMLCanvasElement {
  const key = `${l.seed}/${l.cells}/${l.octaves}`;
  let t = noiseTiles.get(key);
  if (!t) { t = makeNoiseTile(128, l.seed, l.octaves, 1, l.cells); noiseTiles.set(key, t); }
  return t;
}
```

### buildPlanetStrips — once per zoom bucket

Everything here is device pixels (`W = P · zoomB · DPR`, `H = 2r · zoomB · DPR`) so the strip is never resampled twice: one tile of the 128 px noise is stretched to exactly **W** px through a repeating pattern (so the bilinear filter wraps correctly at the tile edge — a plain `drawImage` would clamp and leave a sub-pixel seam), read back **once** with `getImageData`, thresholded in a plain loop, written with `putImageData` into a scratch canvas and composited **twice** side by side. Two copies of a W-periodic image are 2W-periodic, which is what lets the draw wrap (below). The `getImageData`/`putImageData` pair is a build-time cost (≈ 0.3 ms per layer at 428 × 136 px); §13's ban is on the frame loop.

```ts
interface PlanetStrips {
  surface: HTMLCanvasElement;   // 2W × H device px: base + land/basins + caps, two identical tiles side by side
  cloud: HTMLCanvasElement | null;   // 2W × H, transparent background, alpha baked (0.5 clouds / 0.35 wisps); null = single-strip body
  overlay: HTMLCanvasElement;   // S × S (× DPR): squash, glint, shade, limb, rim — fixed to L
  size: number;                 // S in CSS px at the bucket zoom (81 / 72 at zoom 1)
  r: number; P: number;         // CSS px at the bucket zoom
  zoom: number;                 // the bucket this was built at
}

// Grey field of one tile period, W × H device px, from the 128 px tile (R channel of RGBA).
function fieldFromTile(tile: HTMLCanvasElement, W: number, H: number): Uint8ClampedArray {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.scale(W / 128, W / 128);                                           // isotropic: 128 tile px → W device px
  g.fillStyle = g.createPattern(tile, "repeat")!;                      // pattern, not drawImage: wraps at the tile edge
  g.fillRect(0, 0, 128, (128 * H) / W + 1);
  return g.getImageData(0, 0, W, H).data;
}

function percentile(f: Uint8ClampedArray, q: number): number {        // grey level at quantile q of the field
  const hist = new Uint32Array(256);
  for (let i = 0; i < f.length; i += 4) hist[f[i]]++;
  const target = q * (f.length / 4);
  for (let v = 0, acc = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
  return 255;
}

function creaseWidth(f: Uint8ClampedArray, med: number, cover: number): number {   // |v − med| under which `cover` of the pixels lie
  const hist = new Uint32Array(256);
  for (let i = 0; i < f.length; i += 4) hist[Math.abs(f[i] - med)]++;
  const target = cover * (f.length / 4);
  for (let d = 0, acc = 0; d < 256; d++) { acc += hist[d]; if (acc >= target) return Math.max(1, d); }
  return 255;
}

// One thresholded layer: colour + alpha from the field, straight (non-premultiplied) RGBA for putImageData.
function paintLayer(f: Uint8ClampedArray, W: number, H: number, l: StripLayer): ImageData {
  const img = new ImageData(W, H), d = img.data;
  const n = parseInt(l.color.slice(1), 16), R = (n >> 16) & 255, G = (n >> 8) & 255, B = n & 255;
  const crease = l.sel.kind === "crease";
  const med = crease ? percentile(f, 0.5) : 0;
  const T = crease ? 0 : percentile(f, 1 - l.sel.cover);
  const inv = crease ? 1 / creaseWidth(f, med, l.sel.cover) : 1 / (l.sel as { ramp: number }).ramp;
  for (let i = 0; i < d.length; i += 4) {
    const v = f[i];
    let a = crease ? 1 - Math.abs(v - med) * inv : (v - T) * inv + 0.5;   // SVG feFuncA linear: 0.5 at the threshold
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = Math.round(a * l.alpha * 255);
  }
  return img;
}

// A 2W × H strip: optional base fill, thresholded layers composited twice side by side, optional polar caps.
function buildStrip(layers: StripLayer[], base: string | null, caps: { color: string; frac: number } | null,
                    W: number, H: number): HTMLCanvasElement {
  const strip = document.createElement("canvas"); strip.width = 2 * W; strip.height = H;
  const g = strip.getContext("2d")!;
  if (base) { g.fillStyle = base; g.fillRect(0, 0, 2 * W, H); }
  const scratch = document.createElement("canvas"); scratch.width = W; scratch.height = H;
  const s = scratch.getContext("2d")!;
  for (const l of layers) {
    s.putImageData(paintLayer(fieldFromTile(noiseTile(l), W, H), W, H, l), 0, 0);
    g.drawImage(scratch, 0, 0); g.drawImage(scratch, W, 0);             // composite (not putImageData) → alpha blends over the base
  }
  if (caps) {                                                            // bands: α 1 at the pole · 0.9 at 60 % · 0 at the inner edge
    const h = caps.frac * H;
    const band = (y0: number, y1: number) => {
      const lg = g.createLinearGradient(0, y0, 0, y1);
      lg.addColorStop(0, caps.color); lg.addColorStop(0.6, rgba(caps.color, 0.9)); lg.addColorStop(1, rgba(caps.color, 0));
      g.fillStyle = lg; g.fillRect(0, Math.min(y0, y1), 2 * W, h);
    };
    band(0, h); band(H, H - h);
  }
  return strip;
}

// Lighting overlay, S × S CSS px at the bucket zoom (× DPR): everything that is fixed to the star direction.
function buildLightingOverlay(spec: PlanetSpec, lx: number, ly: number, zoomB: number): { canvas: HTMLCanvasElement; size: number } {
  const r = spec.r * zoomB;
  const S = Math.ceil(2 * 1.12 * r + 4), c = S / 2;                     // 81 (start) / 72 (X) at zoom 1
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S * DPR;
  const g = canvas.getContext("2d")!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);

  g.save();                                                             // 1–3 are clipped to the disc
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.clip();

  const sq = g.createRadialGradient(c, c, 0, c, c, r);                  // 1. limb squash: base α 0 at 0.88 r → 0.45 at r
  sq.addColorStop(0.88, rgba(spec.base, 0));
  sq.addColorStop(1,    rgba(spec.base, 0.45));
  g.fillStyle = sq; g.fillRect(0, 0, S, S);

  if (spec.specular) {                                                  // 2. glint: ellipse 0.22 r × 0.12 r at 0.45 r·L, long axis along L
    g.save();
    g.translate(c + 0.45 * r * lx, c + 0.45 * r * ly);
    g.rotate(Math.atan2(ly, lx));
    g.scale(0.22 * r, 0.12 * r);                                        // unit circle → ellipse
    const gl = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gl.addColorStop(0,   "rgba(255,255,255,0.35)");                     // planet.specular
    gl.addColorStop(0.5, "rgba(255,255,255,0.18)");
    gl.addColorStop(1,   "rgba(255,255,255,0)");
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  const sx = c + 0.36 * r * lx, sy = c + 0.36 * r * ly;                 // 3. terminator shade (v1.1): centre +0.36 r·L, radius 1.25 r
  const shade = g.createRadialGradient(sx, sy, 0, sx, sy, 1.25 * r);
  shade.addColorStop(0,    rgba(spec.highlight, 0.90));
  shade.addColorStop(0.40, rgba(spec.base, 0));
  shade.addColorStop(0.70, rgba(spec.shadow, 0.55));
  shade.addColorStop(0.86, rgba(spec.shadow, 0.92));
  shade.addColorStop(1,    rgba(spec.shadow, 1));
  g.fillStyle = shade; g.fillRect(0, 0, S, S);
  g.restore();

  g.strokeStyle = rgba(spec.highlight, spec.limbAlpha); g.lineWidth = 1;   // 4. limb line at r − 0.5
  g.beginPath(); g.arc(c, c, r - 0.5, 0, Math.PI * 2); g.stroke();

  const R = 1.12 * r;                                                   // 5. atmosphere rim (v1.1): two passes in a scratch canvas
  const rim = document.createElement("canvas");
  rim.width = rim.height = S * DPR;
  const h = rim.getContext("2d")!;
  h.setTransform(DPR, 0, 0, DPR, 0, 0);
  const rg = h.createRadialGradient(c, c, 0, c, c, R);
  rg.addColorStop(0,    rgba(spec.atmo, 0));
  rg.addColorStop(0.80, rgba(spec.atmo, 0));
  rg.addColorStop(0.87, rgba(spec.atmo, 0.55));
  rg.addColorStop(0.92, rgba(spec.atmo, 0.30));
  rg.addColorStop(1,    rgba(spec.atmo, 0));
  h.fillStyle = rg; h.beginPath(); h.arc(c, c, R, 0, Math.PI * 2); h.fill();
  h.globalCompositeOperation = "destination-in";                        // × linear alpha along L, 1.0 lit → 0.35 dark
  const lit = h.createLinearGradient(c + R * lx, c + R * ly, c - R * lx, c - R * ly);
  lit.addColorStop(0, "rgba(255,255,255,1)");
  lit.addColorStop(1, "rgba(255,255,255,0.35)");
  h.fillStyle = lit; h.fillRect(0, 0, S, S);
  g.drawImage(rim, 0, 0, S, S);

  return { canvas, size: S };
}

// Zoom bucket (§12): built at 1.25^k; round() flips at the midpoints (±11.8 % about each centre),
// so successive builds are 25 % apart and the residual scale stays within 0.894 … 1.118.
function zoomBucket(zoom: number): number {
  return Math.pow(1.25, Math.round(Math.log(zoom) / Math.log(1.25)));
}

// lx, ly = L (unit vector toward the star). zoomB = zoomBucket(zoom). ≈ 2 ms per planet, once per bucket.
function buildPlanetStrips(spec: PlanetSpec, lx: number, ly: number, zoomB: number): PlanetStrips {
  const r = spec.r * zoomB;
  const P = Math.round(2 * Math.PI * r);                                // 214 (start) / 188 (X) at zoom 1 — one full rotation
  const W = Math.round(P * DPR), H = Math.round(2 * r * DPR);           // one tile in device px
  const surface = buildStrip(spec.surface, spec.base, spec.caps, W, H);
  const cloud   = spec.cloud ? buildStrip(spec.cloud, null, null, W, H) : null;   // only bodies that have a second strip
  const ov = buildLightingOverlay(spec, lx, ly, zoomB);
  return { surface, cloud, overlay: ov.canvas, size: ov.size, r, P, zoom: zoomB };
}
```

### Per-frame draw: dt-based phase and the seamless wrap

Each planet keeps two **phases** in [0, 1) — the fraction of a rotation completed by the surface and by the cloud/wisp strip. They advance by **`dt / period`** from the frame clock (never by frame count: a dropped frame must not freeze the planet, and 2x/4x must not spin it) and are wrapped with `x − floor(x)`, so they never grow and never lose precision. The pixel offset is `phase · P`; because the strip holds two identical tiles, drawing it at `x = cx − r − P + phase · P` always covers the whole disc window [cx − r, cx + r] (left edge ≤ cx − r because phase < 1; right edge = cx − r + P + phase·P ≥ cx + r because P > 2r), and the image at phase → 1 is pixel-identical to phase = 0 — that is the modulo: no seam, no snap, nothing to blend. Sign note: the brief's construction sketch writes `from="0 0" to="−<period> 0"` and `drawImage(surface, −((t/period)·W) mod W)`, which would scroll the texture east→west; the assets (`translate 0 → +P`) and this code (offset grows with time) deliberately use the + direction because the brief's prose specifies "texture moves left→right" and the two statements contradict each other — copy the sign from here, not from the sketch. Do **not** round the offset: at zoom 1 the start planet moves 0.04 px per frame, and the bilinear filter on a fractional `drawImage` is what makes that read as motion instead of a 1 px step every 25 frames.

```ts
interface Spin { surface: number; cloud: number }                      // phases in [0, 1)
const frac = (x: number): number => x - Math.floor(x);

// dtS = seconds since the last frame (clamp to ≤ 0.1 s after a tab switch so the planet does not jump).
function advanceSpin(spin: Spin, spec: PlanetSpec, dtS: number): void {
  spin.surface = frac(spin.surface + dtS / spec.surfacePeriod);         // 90 s / 120 s
  spin.cloud   = spec.cloudPeriod ? frac(spin.cloud + dtS / spec.cloudPeriod) : spin.surface;   // 64 s / 80 s; locked (lava) or unused
}

// 1 clip + 2 drawImage (single strip) or 3 (with the second strip). sx, sy = screen centre; zoom = current camera zoom
// (residual k inside the bucket: 0.894 … 1.118). cloudAlpha: per-frame alpha of the second strip (1 = baked only; lava veins pulse).
function drawPlanet(ctx: CanvasRenderingContext2D, st: PlanetStrips, spin: Spin, sx: number, sy: number, zoom: number,
                    cloudAlpha = 1): void {
  const k = zoom / st.zoom, r = st.r * k, P = st.P * k, D = 2 * r;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(st.surface, sx - r - P + spin.surface * P, sy - r, 2 * P, D);   // west→east: offset grows with time
  if (st.cloud) {                                                               // optional second strip
    ctx.globalAlpha = cloudAlpha;                                               // restored by restore()
    ctx.drawImage(st.cloud, sx - r - P + spin.cloud * P, sy - r, 2 * P, D);     // alpha baked (0.5 / 0.35) × cloudAlpha
  }
  ctx.restore();
  const s = st.size * k;
  ctx.drawImage(st.overlay, sx - s / 2, sy - s / 2, s, s);                      // squash + glint + shade + limb + rim, never rotates
}
```

The strip is 2P wide but only the 2r × 2r window inside the clip is rasterised, so the two strip blits cost like 68 × 68 / 60 × 60 blits, not 428 × 68 ones. Start phase: the Canvas texture is its own noise field, so there is nothing to align with the SVG's t = 0 (which puts tile x 44 / 40 at the disc's left edge); start both phases at 0.

### Keeping the strips current

```ts
let startStrips: PlanetStrips | undefined, xStrips: PlanetStrips | undefined;
const startSpin: Spin = { surface: 0, cloud: 0 }, xSpin: Spin = { surface: 0, cloud: 0 };

function towardStar(p: Body, star: Body): [number, number] {           // L — same direction in world or screen space
  const dx = star.x - p.x, dy = star.y - p.y, d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d];
}

// Call once per frame before drawing. Rebuilds only when the zoom bucket changes; resize does not touch these
// (they depend only on r, L, the bucket and the constant DPR). Phases survive a rebuild.
function ensurePlanetStrips(start: Body, x: Body, star: Body, zoom: number, dtS: number): void {
  const zb = zoomBucket(zoom);
  if (!startStrips || startStrips.zoom !== zb) { const [lx, ly] = towardStar(start, star); startStrips = buildPlanetStrips(PLANET_START, lx, ly, zb); }
  if (!xStrips     || xStrips.zoom     !== zb) { const [lx, ly] = towardStar(x, star);     xStrips     = buildPlanetStrips(PLANET_X, lx, ly, zb); }
  advanceSpin(startSpin, PLANET_START, dtS);
  advanceSpin(xSpin, PLANET_X, dtS);
}

function drawPlanetStart(ctx: CanvasRenderingContext2D, p: Body, zoom: number): void {
  drawPlanet(ctx, startStrips!, startSpin, p.x, p.y, zoom);
}
```

(`p.x`/`p.y` here are already screen coordinates; the §12 camera does world→screen before calling.)

### Cost
Per frame, per planet: 1 `arc` clip + 2 clipped strip blits + 1 overlay blit ≈ **0.08 ms** (0.16 ms for both, the "Planets" row in §0). Build, per planet, once per bucket change: 2 fields (`fieldFromTile` ≈ 0.3 ms each at 428 × 136), 3 `paintLayer` loops (≈ 0.1 ms each), 3 `putImageData` + 6 small blits, caps, overlay (2 gradients, glint, limb, rim ≈ 1 ms) ≈ **2 ms**; both planets ≈ 4 ms in the same frame, once, inside the 6 ms target. Memory: strips 856 × 136 + 752 × 120 device px × 2 each, overlays 162² / 144² — under 1 MB in all. Noise tiles ≈ 0.4 ms each, five in all, built at startup and kept.

### Planet X halo + capture ring (live)
Halo: radial gradient `#3DE0C2`, radius **1.8 · r** (54 at r 30), α 0.35 from the centre out to the planet's edge (offset 0.556 = 1/1.8), 0.10 at 0.78, 0 at the rim. Draw it before the strips. v1.2 makes it **breathe ±4 % over 2.4 s** (sine, in phase with the ring: scale 1 → 1.04 → 1 → 0.96 → 1), which costs nothing because the radius is a parameter of a live gradient. It stays live because it is one gradient fill (~0.05 ms) that scales cleanly with zoom, and because it must not be clipped by the 1.12 r overlay.

Ring: radius 78 at zoom 1, `#3DE0C2`, stroke 1.5 px, `setLineDash([6, 6])`. Two motions, both continuous and now also in the SVG: the dashes **crawl** via `lineDashOffset` at **−12 px/s** (one 12 px dash period per second, so the pattern never jumps), **and** the ring **pulses** over **2.4 s** (sine): α 0.35 ↔ 0.70, radius ±2 px. The sine form below has its rest point at α 0.525; the asset's keyframes (`0.55; 0.70; 0.55; 0.35; 0.55`) start from v1's static 0.55 — 0.025 apart, invisible. `setLineDash` is context state: **reset it to `[]`** (and `lineDashOffset` to 0) afterwards or the trail and HUD hairlines will come out dashed.

```ts
function drawPlanetX(ctx: CanvasRenderingContext2D, p: Body, zoom: number, tS: number): void {   // tS = the scene clock (§0)
  const r = p.r * zoom;
  const w = Math.sin((tS / 2.4) * Math.PI * 2);                        // −1..1 over 2.4 s — one clock for halo and ring
  const haloR = 1.8 * r * (1 + 0.04 * w);                              // halo breathe ±4 %
  const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
  halo.addColorStop(0, rgba("#3DE0C2", 0.35));
  halo.addColorStop(0.556, rgba("#3DE0C2", 0.35));
  halo.addColorStop(0.78, rgba("#3DE0C2", 0.10));
  halo.addColorStop(1, rgba("#3DE0C2", 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2); ctx.fill();

  drawPlanet(ctx, xStrips!, xSpin, p.x, p.y, zoom);                    // strips through the clip + lighting overlay

  const ringR = 78 * zoom + 2 * w;                                     // ±2 px (screen px)
  ctx.strokeStyle = rgba("#3DE0C2", 0.525 + 0.175 * w);                // α 0.35 ↔ 0.70
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -(tS * 12) % 12;                                // dash crawl −12 px/s (one 12 px period per second)
  ctx.beginPath(); ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;                         // always reset
}
```

On the win overlay the pulse and the crawl stop and the ring is drawn at **full α 1.0** (radius 78, `lineDashOffset` 0), as in `result-win.svg` — the one moment the boundary reads as solid. The halo breathe and the surface rotation continue under the scrim.

---

## 4b. Body library parameters (v1.3)

One row per body in `design/assets/bodies/` (plus `planet-x.svg` and `star.svg`), with everything the pipeline needs: radius and crash radius, strip periods, the noise fields with their SVG parameters (type, `baseFrequency`, octaves, seed, threshold → coverage, alpha), the tokens, and what is special. Every planet uses the §4 pipeline (`buildPlanetStrips` → `drawPlanet`); the rows marked *special* need the additions described after the table. Noise `cells` for `makeNoiseTile` = `P · baseFrequency` as in §4 (for an anisotropic `baseFrequency "fx fy"` stretch the tile non-uniformly so the feature size is 1/fx along x and 1/fy along y — `fieldFromTile` gets a second scale). Thresholds are given as the SVG's (slope / intercept → threshold = percentile) and the **coverage** Canvas should reproduce by percentile, as §4 does. `strip period` is the surface; `secondary` is the second strip or the non-strip motion. Lit side L = (+0.7071, −0.7071) for every library planet (the game computes L toward the scene's star).

| Body (file) | r | crash | strip period | secondary | noise params (SVG; Canvas = same coverage by percentile) | colours | special |
|---|---|---|---|---|---|---|---|
| **rocky** (`rocky.svg`) | 30 | 30 | 110 s (P 188, 376 × 60, start tile x 40) | — | dunes fractalNoise `0.008 0.09` · 2 oct · seed 5: light bands slope 8 / −4.084 (0.573 = p75) × 0.40, dark bands slope −8 / 3.892 (< 0.424 = p25) × 0.40; craters fractalNoise 0.12 · 2 oct · seed 31: pits slope 40 / −23.5 (0.600 = p80 → 20 %) × 0.8; walls = pit − offset(±1.2) × 0.6 | base `#C98B5A` · dark `#7A4E33` · highlight `#F0C9A0` · atmo `#E8B07A` | rim peak **0.40**; no caps; soft shade (highlight α 0.90) |
| **ocean** (`ocean.svg` = `planet-start.svg`) | 34 | 34 | 90 s (P 214, 428 × 68) | clouds 64 s | §4 `PLANET_START` | `planet.start.*` | glint; caps 12 %; rim 0.55 |
| **ice** (`ice.svg`) | 28 | 28 | 140 s (P 176, 352 × 56, tile x 24) | — | sheets fractalNoise 0.03 · 4 oct · seed 41: dark plates slope 5 / −2.25 (0.55 = p64) × 0.45, bright plates slope −5 / 2.75 (< 0.45 = p38) × 0.35; cracks turbulence 0.06 · 2 oct · seed 43: veins slope −40 / 4.4 (< 0.085–0.110 = p15 → 15 %) α 1, cores slope −40 / 2.36 (< 0.034–0.059 = p5) × 0.6, lit edge = vein − offset(+0.8, −0.8) × 0.6 | base `#CFE6F5` · dark `#7FA6C9` · highlight `#FFFFFF` · atmo `#BFE3FF` · shadow `#35567A` | caps **30 %** (16.8 px); rim 0.55; crease-type cracks (§4 "crease", 15 %) |
| **lava** (`lava.svg`) | 26 | 26 | 95 s (P 163, 326 × 52, tile x 20) | vein pulse 5 s (same strip group) | crust fractalNoise 0.04 · 4 oct · seed 53: plates slope 6 / −2.5 (0.5 = p49 → 45 %) × 0.8; veins turbulence 0.05 · 2 oct · seed 59: vein slope −12.3 / 1.4 (< 0.114 = p18 → 18 %), hot slope −25.5 / 1.4 (< 0.055 = p5), bloom = vein α blur σ 1.2 × 0.45 under | crust `#3A2A2A` · crustLight `#5A4040` · vein `#FF6A2A` · veinHot `#FFC857` · atmo `#FF8C2E` · shadow `#1E1414` | **halo** r 1.4 r α 0.18 static (the only non-X halo); vein strip at `globalAlpha` 0.85 + 0.15 cos(2π t / 5); rim **0.35**; shade highlight α **0.55**; no caps |
| **toxic** (`toxic.svg`) | 32 | 32 | 120 s (P 201, 402 × 64, tile x 60) | clouds 75 s (tile x 0, α 0.6) | surface fractalNoise 0.035 · 4 oct · seed 29: lowlands slope 12 / −6.088 (0.549 = p70 → 30 %) × 0.60; clouds fractalNoise `0.016 0.070` · 4 oct · seed 37, displaced scale 14 by fractalNoise 0.010 · 2 oct · seed 43, slope 8 / −3.30 (0.475 = p43 → 55 %), blur 0.8; deck shadow = cloud mask offset (−1.5, +1.5) `#2F5A2A` × 0.5 under the clouds | base `#5E8F3A` · dark `#2F5A2A` · cloud `#E6F2C8` · atmo `#C7E97A` | shade highlight = atmo at α **0.70**; cloud alpha 0.6 and the deck shadow baked into the cloud strip; no caps |
| **cracked** (`cracked.svg`) | 27 | 27 | 100 s (P 170, 340 × 54, tile x 30) | night cracks (same strip, same phase) | mottling fractalNoise 0.040 · 4 oct · seed 41: slope 12 / −6.412 (0.576 = p70 → 30 %) × 0.60; cracks fractalNoise 0.035 · 3 oct · seed 61 → **iso-contour** at 0.50 (band 0.48–0.52 → ≈ 10 %, ≈ 1.5 px lines): glow = blur 1.5 × 0.50, lines × 0.80 | base `#4F5B73` · dark `#2A3245` · crack `#FFC857` · atmo `#8FA3C9` | shade highlight = atmo α 0.90; optional 3rd blit: crack-only strip at `globalAlpha` 0.35 clipped to the night half-disc; static glow, no pulse; no caps |
| **gasBanded** (`gas-banded.svg`) | 44 | 44 | bands C 180 s +P · B 110 s −P · A 150 s +P (P 276, 552 × 88 each) | storm spot rides band B | per group: wavy edges fractalNoise `0.012 0.08` · 2 oct · seeds 31 / 37 / 41, contrast ×2, displacement scale 6 (±3 px), blur 0.6; zonal streaks fractalNoise `0.010 0.28` · 2 oct · seeds 5 / 13 / 17, grey, contrast ×2, α 0.30, `overlay` | cream `#F2D9B8` · tan `#E3B07C` (base) · brown `#B9794B` · dark `#8C5A3C` · storm `#D9623E` · atmo `#F5D7B0` · shadow `#4A2E1E` | 3 band strips, counter-flow; 9 bands (layout in `style.md` §8); storm ellipse 6.16 × 3.52 at strip (98.6, 28.6) and (374.6, 28.6); **gas shade** (0.64 α 0.30); rim 0.55; no halo |
| **gasRinged** (`gas-ringed.svg`) | 44 | 44 | bands A 160 s +P · B 120 s −P | ring static | per group as above, wave seeds 43 / 47, streak seeds 21 / 29 | cream `#D5EFEA` · light `#9FD3C7` (base) · mid `#6FA8A0` · dark `#3F7A74` · atmo `#BFE8E0` · ring `#D8E6E3` · shadow `#1C3A36` · ring shadow `bg.base` | 2 band strips; **ring** 1.35–2.2 r, tilt 22°, ry = 0.28 rx, gaps at 1.60 / 1.95 r (0.05 r), α 0.55 peak; back ring + shadow wedge (α 0.80) **before** the planet, front ring (clipped to the lower half-disc) **after** — two cached ring sprites; gas shade; no halo |
| **moon** (`moon.svg`) | 14 | 14 | 180 s (P 88, 176 × 28, tile x 30) | — | maria fractalNoise 0.05 · 3 oct · seed 7: slope 3 / −1.3 × 0.14; pits fractalNoise 0.30 · 1 oct · seed 9: slope 30 / −19.3 (0.66 = p93 → 7 %) × 0.50; **37 craters** seed `0x4D4F4F` (15.2 % of the tile; radii 4.2 … 0.9) | base `#9A9AA6` · crater `#5E5E6B` · highlight `#D8D8E0` · night `bg.base` | **airless shade** (1.5 r, hard step 0.62–0.70); no rim, no caps; limb α 0.14; craters = geometry baked twice (x, x + P) |
| **dwarf** (`dwarf.svg`) | 10 | 10 | 160 s (P 63, 126 × 20, tile x 20) | — | mottle fractalNoise 0.10 · 3 oct · seed 13: dark slope 8 / −4.48 (≈ 22 %) × 0.60, light slope −8 / 3.2 (< 0.40 ≈ 15 %) × 0.45; specks fractalNoise 0.28 · 1 oct · seed 17 (≈ 7 %) × 0.50; **8 pits** seed `0x445741` (3.9 %) | base `#B8A48E` · dark `#6E6052` · highlight `#E8DCC8` · night `bg.base` | airless shade; no rim, no caps |
| **double** (`double.svg`) | 18 + 11 | 18 and 11, moving | big 80 s (P 113, 226 × 36, tile x 40); small 60 s (P 69, 138 × 22, tile x 25) | **orbit 40 s** | big: deep water fractalNoise 0.07 · 3 oct · seed 29: slope 14 / −8.07 (0.612 = p78 → 22 %) × 0.40; pack ice fractalNoise 0.035 · 4 oct · seed 21: slope 30 / −17.4 (0.596 = p70 → 30 %) × 0.80; caps 22 %. small: mottle fractalNoise 0.12 · 2 oct · seed 31: slope 14 / −7.84 (≈ 25 %) × 0.55; specks 0.30 · 1 oct · seed 37 (≈ 8 %) × 0.50; **9 craters** seed `0x534D4C` (4.2 %) | big base `#5E9ED6` · dark `#2C4F7A` · highlight `#DCEFFF` · atmo `#9CCBFF`; small base `#C98B5A` · dark `#7A4E33` (+ `rocky.highlight #F0C9A0`, night `bg.base`) | positions from the orbit (below); big = soft shade + rim 0.55 + caps; small = airless; z-order swap at sin θ = 0 |
| **planetX** (`planet-x.svg`) | 30 | 30 | 120 s (P 188) | wisps 80 s | §4 `PLANET_X` | `planet.x.*` | live halo + ring (§4); L lower-left on the original scene |
| **sunYellow** (`star.svg`) | 46 | 46 | breathe 6 s | loops 12 / 16 / 14 s (begin 0 / 5 / 9), flare 22 s | granulation 0.11 · 2 oct · seed 3 · α 0.16; streamers `0x5747` | `star.*` | §3 + §3b |
| **redDwarf** (`red-dwarf.svg`) | 40 | 40 | breathe 6 s | same | granulation **0.07** · seed 5 · α **0.22**; streamers `0x5244` α × 0.7 | core `#FFD9B0` · body `#FF7A4D` · corona `#E0432F` · glow `#8C1E2A` | §3b; glow r 174, corona r 113 |
| **blueGiant** (`blue-giant.svg`) | 54 | 54 | breathe 6 s | same | granulation **0.16** · seed 9 · α **0.12**; **14** streamers `0x4247` (≥ 14° apart) | core `#FFFFFF` · body `#B8CCFF` · corona `#5EA0FF` · glow `#2C4FBF` | §3b; glow r **240**, corona r 153 |
| **whiteDwarf** (`white-dwarf.svg`) | 16 | 16 | — | glow breathe ±5 % / 4 s | none (smooth) | core `#FFFFFF` · body `#E9EEF8` · corona `#B8CCFF` · glow `#7FB8FF` | §3c: glow to 6 r, 4 spikes to 4 r, bloom 1.4 r, hard limb |
| **neutronStar** (`neutron-star.svg`) | 8 | 8 | — | beams 360° / 6 s | none | core `#FFFFFF` · body `#DCE4FF` · glow `#B48CFF` | §3c: glow to 5 r, two beam cones 3.5 r, haze 2.5 r × 0.6 r |
| **blackHole** (`black-hole.svg`) | 22 (horizon) | 22 | — | disk 360° / 24 s | mottle fractalNoise 0.08 · 2 oct · seed 5; streaks `0xB1AC` | `#000000` · `#FFFFFF` · `#FFF8E1` · `#FFC857` · `#FF8C2E` · `#B48CFF` · `#7FB8FF` | §3c; **gravity star-class**, crash at the horizon only; disk 1.4–2.6 r, squash 0.2115, Doppler 1.0 → 0.55 |

### Extending `PlanetSpec` for the library

Three things the §4 pipeline did not need: a **shade recipe** (soft / gas / airless, with a highlight-alpha override), a **rim peak** (0.55 / 0.40 / 0.35 / none) and an optional **halo** (lava). `buildLightingOverlay` switches on them; everything else (squash, limb line, rim mask, strips, clip, phase) is unchanged.

```ts
type ShadeKind = "soft" | "gas" | "airless";

interface BodyLighting {
  shade: ShadeKind;        // soft = v1.1 (ocean, ice, rocky, cracked, toxic, lava, double.big, X); gas = both giants; airless = moon, dwarf, double.small
  highlightAlpha: number;  // soft 0.90 (toxic 0.70, lava 0.55); gas 0.55; airless 0.55
  rimPeak: number;         // 0.55 default, rocky 0.40, lava 0.35, airless 0 (no rim)
  limbAlpha: number;       // 0.16 / 0.18, airless 0.14
  halo?: { color: string; alpha: number };   // lava only: r 1.4 r, α 0.18 flat to the disc edge → 0.07 at 0.86 → 0 — its OWN cached sprite
}

// Terminator stops per recipe: [offset, which colour, alpha]. "dark" = the body's dark token, "night" = bg.base #050710.
const SHADE_STOPS: Record<ShadeKind, { radius: number; stops: [number, "highlight" | "base" | "shadow" | "dark" | "night", number][] }> = {
  soft:    { radius: 1.25, stops: [[0, "highlight", 0.90], [0.40, "base", 0], [0.70, "shadow", 0.55], [0.86, "shadow", 0.92], [1, "shadow", 1]] },
  gas:     { radius: 1.25, stops: [[0, "highlight", 0.55], [0.40, "base", 0], [0.64, "shadow", 0.30], [0.86, "shadow", 0.90], [1, "shadow", 1]] },
  airless: { radius: 1.5,  stops: [[0, "highlight", 0.55], [0.40, "base", 0], [0.62, "dark", 0.30], [0.70, "night", 0.84], [1, "night", 0.92]] },
};
// In buildLightingOverlay: const rec = SHADE_STOPS[l.shade]; radius rec.radius · r; replace the alpha of the first stop by
// l.highlightAlpha; rim: skip when l.rimPeak === 0, else stops 0.87 → rimPeak and 0.92 → rimPeak · 0.545 (0.55 → 0.30, 0.40 → 0.22, 0.35 → 0.19);
// halo (lava): NOT in the overlay (its (2.24 r + 4) px box cannot hold a 2.8 r disc) — a separate cached sprite, ceil(2.8 r + 4) px
// square (× DPR, 77 px at zoom 1), radial 1.4 r, #FF8C2E 0 α 0.18 · 0.714 α 0.18 · 0.86 α 0.07 · 1 α 0, built with the strips per
// zoom bucket and blitted BEFORE drawPlanet: lava = 1 halo blit + 1 clip + 2 strip blits (crust, veins at lavaVeinAlpha) + 1 overlay.
```

The airless radius is **1.5 r** (the brief's 1.25 r with the 0.62 → 0.70 step turned the lit side into a small round blob; 1.5 r lands the hard step where v1.1's 0.78 mid-stop lands, so the night stays the usual crescent). The overlay bitmap for airless bodies is still (2 · 1.12 r + 4) px: the shade's 1.5 r radius only matters inside the disc clip.

### Craters (moon, dwarf, double.small) — baked geometry, no per-frame cost

Craters are plain circles drawn into the surface strip **after** the noise layers, once per zoom bucket, at x and at x + P (the strip is two periods wide, so every discrete feature must appear once per period or the loop seams). Each: an outer circle R in the highlight colour (α 0.55 moon, 0.5 dwarf / double.small) + a bowl circle 0.82 R offset (+0.18 R, −0.18 R) toward L, filled with a linear gradient from its upper-right (dark α 0.95) via 0.55 α 0.72 to its lower-left (α 0.55) — the uncovered lower-left crescent is the sun-lit inner wall. The tables of (x, y, R) per body are in the headers of `moon.svg` (37), `dwarf.svg` (8) and `double.svg` (9); they were generated with `mulberry32(seed)` — radii largest first, random x in [0, P), y in [R + 0.5, H − R − 0.5], rejected while closer than 0.95 (R₁ + R₂) to an accepted crater — so a Canvas build can either copy the tables or re-run the rule.

```ts
// Bake one crater at (x, y) with radius R into the strip context g (strip space, y down). lx, ly = L.
function bakeCrater(g: CanvasRenderingContext2D, x: number, y: number, R: number, highlight: string, dark: string,
                    rimAlpha: number, lx: number, ly: number): void {
  g.fillStyle = rgba(highlight, rimAlpha);
  g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();                          // rim wall
  const bx = x + 0.18 * R * lx, by = y + 0.18 * R * ly, b = 0.82 * R;
  const lg = g.createLinearGradient(bx + b * lx, by + b * ly, bx - b * lx, by - b * ly);   // upper-right → lower-left
  lg.addColorStop(0, rgba(dark, 0.95)); lg.addColorStop(0.55, rgba(dark, 0.72)); lg.addColorStop(1, rgba(dark, 0.55));
  g.fillStyle = lg;
  g.beginPath(); g.arc(bx, by, b, 0, Math.PI * 2); g.fill();                        // shadowed bowl
}
```

### Lava vein pulse and the cracked world's night cracks

The lava world's veins are their **own strip** in the same animated group as the crust (same phase, same 95 s), drawn at a pulsing alpha: the SVG animates the group opacity `1 → 0.7 → 1` over 5 s (sine), t = 0 = full glow. The bloom (σ 1.2, × 0.45) is part of the vein strip, so it pulses with it and costs nothing at runtime.

```ts
const lavaVeinAlpha = (tS: number): number => 0.85 + 0.15 * Math.cos((tS / 5) * Math.PI * 2);   // 1 → 0.7 → 1 over 5 s, 1 at t = 0

// The veins are lava's optional second strip (spec.cloud = the vein + hot + bloom layers, no cloudPeriod → locked to the crust's
// 95 s phase, spec.cloudAlpha = lavaVeinAlpha). Per frame:
//   ctx.drawImage(lavaHalo, sx - hs / 2, sy - hs / 2, hs, hs);                       // halo sprite first (hs = haloSize · k)
//   drawPlanet(ctx, lavaStrips, lavaSpin, sx, sy, zoom, LAVA.cloudAlpha!(tS));       // crust, veins × pulse, overlay
```

The cracked world's crack glow is **static** (no pulse). Its cracks are emissive, so the SVG draws the crack-only strip a second time at group α 0.35, masked to the night side (linear along −L: 0 at +0.5 r · L → 1 at −0.5 r · L). Canvas: an optional third `drawImage` of a crack-only strip at `globalAlpha 0.35`, clipped to the half-disc beyond the terminator (or masked by the same linear gradient baked as `destination-in` into a copy of the strip) — or skip it: the lit cracks already carry the look, and the brief's "2 drawImage + 1 clip" budget is per strip.

### Gas giants — band strips built from rects, waves and streaks

A gas giant has **no base noise layer**: each band group is a stack of horizontal rects (the 9-band layouts and overdraw ranges in `style.md` §8) whose edges wave ±3 px. The SVG does it with a displacement map; Canvas does it at build time by drawing each band as a polygon whose top and bottom edges are polylines sampled from a noise row — the same look, no filter:

```ts
// One band group strip, 2W × H DEVICE px (W = P · zoomB · DPR, H = 2r · zoomB · DPR, as §4). bands = [y0, y1, colour] in
// strip px at zoom 1 (the style.md §8 layouts, overdraw included); u = H / (2 r) = zoomB · DPR converts them to device px, and the
// ±3 px wave is ±3 strip px, i.e. ±3 u device px — so the layout fills the whole strip and the wave keeps its size at any DPR / zoom.
// edge: the grey field of this group's wave tile (cells ≈ 276 · 0.012 ≈ 3, 2 octaves, contrast ×2), W × H device px, wrapping at W.
// base: the planet's base token for the FIRST group (the SVG's base disc under the bands), null for the others.
function buildBandStrip(bands: [number, number, string][], edge: Uint8ClampedArray, W: number, H: number, u: number,
                        base: string | null, streaks: HTMLCanvasElement): HTMLCanvasElement {
  const strip = document.createElement("canvas"); strip.width = 2 * W; strip.height = H;
  const g = strip.getContext("2d")!;
  if (base) { g.fillStyle = base; g.fillRect(0, 0, 2 * W, H); }
  const n = (x: number, y: number): number => edge[((((y | 0) % H) + H) % H * W + (((x | 0) % W) + W) % W) * 4] / 255;
  const A = 6 * u;                                                                     // wave amplitude ±3 strip px
  for (const [y0, y1, col] of bands) {
    const Y0 = y0 * u, Y1 = y1 * u;                                                    // strip px → device px
    g.fillStyle = col;
    g.beginPath();
    for (let x = 0; x <= 2 * W; x++) g.lineTo(x, Y0 + A * (n(x, Y0) - 0.5));          // top edge, left → right
    for (let x = 2 * W; x >= 0; x--) g.lineTo(x, Y1 + A * (n(x, Y1) - 0.5));          // bottom edge, right → left
    g.closePath(); g.fill();
  }
  g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.30;                        // zonal streaks: grey, contrast ×2
  g.drawImage(streaks, 0, 0, 2 * W, H);                                                // a tile stretched ≈ 100 px along x, 3.6 px along y
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  return strip;
}
```

Edge field: `fieldFromTile` of the group's wave tile (seeds 31 / 37 / 41 banded, 43 / 47 ringed), drawn **anisotropically** (≈ 83 px features along x = 1/0.012, ≈ 12 px along y = 1/0.08) — the y frequency decorrelates neighbouring edges, which is what makes each edge wave independently. Streak tile: seeds 5 / 13 / 17 (banded), 21 / 29 (ringed), 2 octaves, grey, contrast ×2, stretched to ≈ 100 px × 3.6 px features, drawn with `overlay` at α 0.30 (supported in every Canvas 2D). The SVG's 0.6 px edge blur is skipped (a `ctx.filter = "blur(0.6px)"` at build time is optional where supported); at 1× the ±3 px waves read soft already. Per frame a giant is **1 clip + 3 (banded) / 2 (ringed) strip blits + 1 overlay** — each band group with its own phase and direction (`+` groups: offset grows; `−` groups: offset shrinks, i.e. `phase = frac(phase − dt / period)`): banded C 180 s +, B 110 s −, A 150 s +; ringed A 160 s +, B 120 s −. The storm spot is baked into band group B's strip twice (strip x 98.6 and 374.6, y 28.6, rx 6.16, ry 3.52, `#D9623E`, eye rx 3.4 ry 1.8 `#F2D9B8` α 0.30 — all × u like the bands).

`PlanetStrips` has room for two strips and `Spin` for two phases, so a giant gets its own pair — one strip and one signed phase per band group, sharing the §4 clip and lighting overlay (built by `buildLightingOverlay` with the gas recipe):

```ts
interface BandGroup { bands: [number, number, string][]; waveSeed: number; streakSeed: number; period: number; dir: 1 | -1 }
interface GasStrips { groups: HTMLCanvasElement[]; overlay: HTMLCanvasElement; size: number; r: number; P: number; zoom: number }

// banded: C 180 s +1, B 110 s −1, A 150 s +1 (3 groups) · ringed: A 160 s +1, B 120 s −1 (2 groups). One phase per group, in [0, 1).
function advanceBands(phases: number[], groups: BandGroup[], dtS: number): void {
  for (let i = 0; i < groups.length; i++) phases[i] = frac(phases[i] + groups[i].dir * dtS / groups[i].period);
}

// 1 clip + 3 (banded) / 2 (ringed) strip blits + 1 overlay; the ringed giant adds its back ring before and front ring after.
function drawGasGiant(ctx: CanvasRenderingContext2D, st: GasStrips, phases: number[], sx: number, sy: number, zoom: number): void {
  const k = zoom / st.zoom, r = st.r * k, P = st.P * k, D = 2 * r;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
  for (let i = 0; i < st.groups.length; i++)                          // group 0 carries the base fill; later groups are transparent
    ctx.drawImage(st.groups[i], sx - r - P + phases[i] * P, sy - r, 2 * P, D);
  ctx.restore();
  const s = st.size * k;
  ctx.drawImage(st.overlay, sx - s / 2, sy - s / 2, s, s);
}
```

**Ring (gasRinged):** two cached sprites that never animate — a **back** sprite (the ring + the planet's shadow wedge, with the front half-disc of radius 1.12 r = 49.28 erased: `destination-out` of that half-disc) drawn before the planet and a **front** sprite (the ring clipped to that same lower half-disc of radius 1.12 r in ring orientation) drawn after the planet's overlay — so the front ring stays in front of the atmosphere rim where it leaves the limb, as in `gas-ringed.svg`. Build both in "ring space": `translate(c, c) → rotate(−22°) → scale(1, 0.28)`, fill the circle r 96.8 with the radial gradient of `style.md` §8 (`#D8E6E3`, peak α 0.55, gaps at 1.60 / 1.95 r), then for the back sprite the shadow: the half-ellipse `M0 −44 A117 44 0 0 1 0 44 Z` rotated 230° in ring space, `#050710` α 0.80, masked `destination-in` by the ring gradient normalised to peak 1 so it darkens ring material only (two-fill fake blur for the σ 1 × 3.5). Sprite size: the ellipse's bounding box is ≈ 180 × 88 px at zoom 1 (rx 96.8, ry 27.1, tilted 22°) — use 200 × 100 **× zoomB** (× DPR). Both ring sprites belong to the **zoom bucket** like the band strips: build them in `ensure…Strips` with the same `zoomB` and rebuild them with the strips, so the 0.05 r (2.2 px at zoom 1) gaps and the shadow wedge are never upsampled more than the bucket residual (≤ 1.118×) — a ring built once at zoom 1 would be blurred 2× at zoom 2. Draw order: back ring → planet (strips + overlay) → front ring: **2 extra blits** per frame.

### Double planet — orbit, z-order swap, two rotating bodies

Both bodies are ordinary §4 planets (big: soft shade, rim, caps 22 %, P 113 / 80 s; small: airless, craters, P 69 / 60 s) whose **screen centres move**: period **T = 40 s**, uniform angular rate, clockwise on screen. Masses ∝ r³ (5832 : 1331), centre separation d = 38 → the small body's semi-major axis A_s = 0.8142 d = 30.94, the big one's A_b = 0.1858 d = 7.06, 180° apart; the orbit plane is tilted so the screen ellipse has ry = 0.36 rx. θ = 2π · (t mod 40) / 40; small at (A_s cos θ, 0.36 A_s sin θ), big at (−A_b cos θ, −0.36 A_b sin θ) relative to the barycentre. The small body is **in front** while sin θ ≥ 0 (θ 0 → 180°, the lower half of the ellipse) and **behind** while sin θ < 0 — the same rule the SVG implements with two copies and discrete opacity toggles at θ = 0 / 180°, where the limbs are 9 px apart, so the swap is never visible. Lighting on both stays fixed to L; the bodies only translate (the SVG's epicycle of three rotates is just its way of getting an ellipse without an anisotropic scale — Canvas computes the position directly).

```ts
const DOUBLE_T = 40, DOUBLE_AS = 30.94, DOUBLE_AB = 7.06, DOUBLE_RY = 0.36;   // s, px at zoom 1, px, ry/rx
const DOUBLE_R = { big: 18, small: 11 }, DOUBLE_CRASH = { big: 18, small: 11 };  // radius and crashRadius (at the MOVING centres)

// bx, by = the barycentre on screen; bigStrips/smallStrips and their spins come from buildPlanetStrips as in §4.
function drawDoublePlanet(ctx: CanvasRenderingContext2D, bx: number, by: number, zoom: number, tS: number,
                          big: PlanetStrips, bigSpin: Spin, small: PlanetStrips, smallSpin: Spin): void {
  const th = ((tS % DOUBLE_T) / DOUBLE_T) * Math.PI * 2;
  const sxS = bx + DOUBLE_AS * zoom * Math.cos(th), syS = by + DOUBLE_AS * DOUBLE_RY * zoom * Math.sin(th);
  const sxB = bx - DOUBLE_AB * zoom * Math.cos(th), syB = by - DOUBLE_AB * DOUBLE_RY * zoom * Math.sin(th);
  const smallInFront = Math.sin(th) >= 0;
  if (!smallInFront) drawPlanet(ctx, small, smallSpin, sxS, syS, zoom);      // behind (upper half of the ellipse)
  drawPlanet(ctx, big, bigSpin, sxB, syB, zoom);
  if (smallInFront)  drawPlanet(ctx, small, smallSpin, sxS, syS, zoom);      // in front (lower half)
}
```

Per frame: 2 × (1 clip + 2 blits) = 2 clips + 4 blits — both bodies are single-strip (`cloud` omitted in both specs, so `st.cloud` is null and `drawPlanet` skips the second blit). Physics: both discs are solid at their own radii (18 / 11) **at their current positions** — the game must test contact against the moving centres, and a path prediction has to integrate the pair's motion (it is deterministic in wall-clock `tS`, so the predictor can sample it). Gravity: use the barycentre with the combined mass unless the simulation wants the two-body detail.

### Per-scene draw order and L

A level names its star (one of six) and its bodies; `towardStar` (§4) gives each planet its L at build time (the library assets all use the upper-right L = (+0.7071, −0.7071) because the gallery has no star; in a scene L follows the scene's star — the two scene mockups do the same by wrapping only the lighting-overlay layers of the mis-lit bodies in `rotate(angle(L_scene) − angle(L_library))`: the ringed giant −106.9° and the moon +77.7° toward the red dwarf, the moon +175.6° toward the black hole; Canvas simply builds each overlay with the scene's L). Draw order stays §0's: background → star (§3 / §3b / §3c) → planets back to front by y (back ring before its planet, front ring after; double pair as above) → capture ring → path / trail → arrow → thrust + ship → HUD → overlay.

---

## 5. Ship

Geometry from `design/assets/ship.svg`, a 24-unit space, nose pointing up (−y), anchor and centre of rotation at (12, 12). Hull length is 19 units (y 2 → 21).

```
hull   : 12,2   18.5,21  12,16.5  5.5,21        fill ship.hull #F2F5FF
fin L  : 8.2,12.5  4,19.2  7,19.6               fill ship.hull   (starts at y 12.5, sweeps out to x 4)
fin R  : 15.8,12.5 20,19.2 17,19.6              fill ship.hull   (mirror: sweeps out to x 20)
cockpit: rect x 11.2 y 7.5 w 1.6 h 4 rx 0.8     fill ship.cockpit #5EA0FF
outline: ship.outline #0A0D1A, 1 px screen, round joins
```

### Size clamp
`size = max(12, 22 · zoom)` where `size` is the hull length on screen. At zoom 1 the ship is 22 px long (the mockup size); zooming out shrinks it with the world until it would drop below 12 px, where it stops — a ship smaller than 12 px loses its triangle silhouette and the cockpit dot, and the player loses the heading. Bodies keep shrinking; the ship does not. The outline is always 1 screen px, so it is drawn with `lineWidth = 1 / k` inside the scaled space.

### Rotation
The ship eases toward its velocity heading: `angle += wrap(target − angle) · 0.18` per frame. Local "up" is −y, so the target angle for a velocity vector is `atan2(vy, vx) + π/2`.

```ts
const SHIP_HULL  = [12, 2, 18.5, 21, 12, 16.5, 5.5, 21];
const SHIP_FIN_L = [8.2, 12.5, 4, 19.2, 7, 19.6];     // exactly ship.svg's polygons
const SHIP_FIN_R = [15.8, 12.5, 20, 19.2, 17, 19.6];

function poly(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// shipAngle is kept between frames: shipAngle = lerpAngle(shipAngle, Math.atan2(vy, vx) + Math.PI / 2, 0.18)
function drawShip(ctx: CanvasRenderingContext2D, sx: number, sy: number, angle: number, zoom: number): void {
  const size = Math.max(12, 22 * zoom);     // hull length on screen, px
  const k = size / 19;                      // 24-unit space → screen
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(k, k);
  ctx.translate(-12, -12);                  // anchor at the centre of the 24 box
  ctx.fillStyle = "#F2F5FF";                // ship.hull
  ctx.strokeStyle = "#0A0D1A";              // ship.outline
  ctx.lineWidth = 1 / k;                    // 1 screen px regardless of zoom
  ctx.lineJoin = "round";
  poly(ctx, SHIP_FIN_L);
  poly(ctx, SHIP_FIN_R);
  poly(ctx, SHIP_HULL);
  ctx.fillStyle = "#5EA0FF";                // ship.cockpit
  roundRectPath(ctx, 11.2, 7.5, 1.6, 4, 0.8); ctx.fill();   // §0 helper — never ctx.roundRect directly
  ctx.restore();
}
```

Three polygons and a rect: ~0.05 ms. No shadow, no glow, ever. (At 12–24 px the 0.8 radius on the slit is invisible; a `fillRect(11.2, 7.5, 1.6, 4)` is an acceptable shortcut.)

---

## 6. Thrust flash

From `design/assets/ship-thrust.svg`, translated back into the ship's 24-unit space (the SVG offsets the ship by (4, 2)). Two triangles behind the tail notch, additive:

| Layer | Points (24-unit ship space) | Colour | Alpha |
|---|---|---|---|
| outer | 7,17.5 · 17,17.5 · 12,39   (length 21.5 units) | `thrust.outer` `#FF6A2A` | 0.90 |
| core  | 9.4,17.5 · 14.6,17.5 · 12,31.5 (length 14 units) | `thrust.core` `#FFE08A` | 1.00 |

Lifetime: **one frame per thrust tick** — the physics sets `thrusting = true` for the tick, the renderer draws the flash that frame, and nothing persists. With 2×/4× speed the flash is drawn if *any* sub-step of the frame thrust. Draw it before the ship in the same transform, with `globalCompositeOperation = "lighter"` so the two layers add up to a hot core over the star's haze; reset to `"source-over"` straight after. A ±10 % length jitter from `Math.random()` keeps it alive without animation state.

```ts
function drawThrust(ctx: CanvasRenderingContext2D, sx: number, sy: number, angle: number, zoom: number): void {
  const k = Math.max(12, 22 * zoom) / 19;
  const j = 0.9 + Math.random() * 0.2;      // ±10 % flame length
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(angle); ctx.scale(k, k); ctx.translate(-12, -12);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = rgba("#FF6A2A", 0.9);     // thrust.outer
  ctx.beginPath(); ctx.moveTo(7, 17.5); ctx.lineTo(17, 17.5); ctx.lineTo(12, 17.5 + 21.5 * j); ctx.fill();
  ctx.fillStyle = "#FFE08A";                // thrust.core
  ctx.beginPath(); ctx.moveTo(9.4, 17.5); ctx.lineTo(14.6, 17.5); ctx.lineTo(12, 17.5 + 14 * j); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}
```

**Canvas draws no blur.** `ship-thrust.svg` keeps a small presentation blur on its two triangles (`feGaussianBlur` σ 1.2 outer / 0.4 core, and `flight.svg` instances the same asset), but that is for the asset only; at 22 px the additive overlap reads as soft on its own, and a blur on the ship would be a per-frame `shadowBlur`/`filter` on a moving object (§0).

---

## 7. Trail

A ring buffer of **240** world-space points, one pushed per simulation step (so at 4× speed the trail covers less wall-clock time but the same flown distance per sample). Colour `trail #5EA0FF`, `lineWidth 2` (screen px), `lineCap`/`lineJoin round`. Alpha is **always 1 at the ship** and fades to 0 over the last 240 samples: `α(i) = 1 − (count − 1 − i) / 240` with `i` counted from the tail (`i = count − 1` is the newest sample). Until the buffer is full the tail is simply not yet transparent; once it holds 240 samples the oldest one sits at α 0. (Do not use `i / 240` — during the first 4 s of flight that leaves the segment under the ship at ≤ 0.25 α.)

The mockups apply this rule literally to their own segment counts, so none of their tails is transparent: `flight.svg` 56 segments → tail α 0.771, `result-win.svg` 88 → 0.637, `result-crash.svg` 40 → 0.838, `result-lost.svg` 96 → 0.604 (head always 1.000). `trail.svg` is the only place the fade reaches 0: its 24 segments each stand for 10 game samples, i.e. a full 240-sample buffer, so its alphas are the same rule evaluated every 10 samples (1 − (23 − j)/24: 0.042 → 1.0).

Two ways to draw it:

- **Per segment** (240 `stroke()` calls with a different `strokeStyle` each): ~0.6–0.8 ms. Simple, fine for the prototype.
- **Chunked** (20 chunks of 12 segments, each one `stroke()` with a linear gradient from α(i₀) to α(i₁)): ~0.15 ms. 20 draw calls instead of 240, and the fade is visually identical because the per-chunk gradient interpolates the same ramp.

Round caps hide the chunk joins. Skip points that are < 1 screen px apart (ship nearly stationary) so the trail does not pile up into a bright knot.

**No per-frame allocation.** The draw projects every sample once into two preallocated `Float32Array` scratch buffers (`sxs`, `sys`) and strokes from those — no tuple-returning accessor, no `toScreen` closure, no `[x, y]` destructuring. The only objects created per frame are the 20 gradients, which are unavoidable (and cheap). This is what §13 means by "ring buffers and `Float32Array`, not arrays per frame".

```ts
class Trail {
  private xs = new Float32Array(240);     // world x, ring buffer
  private ys = new Float32Array(240);     // world y
  private sxs = new Float32Array(240);    // screen x, scratch, index 0 = oldest
  private sys = new Float32Array(240);    // screen y
  private head = 0; private count = 0;

  push(x: number, y: number): void {
    this.xs[this.head] = x; this.ys[this.head] = y;
    this.head = (this.head + 1) % 240;
    if (this.count < 240) this.count++;
  }
  clear(): void { this.head = 0; this.count = 0; }

  // cam/w/h instead of a toScreen callback: the projection is inlined (§12 formula).
  // 20 chunks × 12 segments, one linear-gradient stroke per chunk.
  draw(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
    const n = this.count;
    if (n < 2) return;
    const { x: cx, y: cy, zoom } = cam, hw = w / 2, hh = h / 2;
    const xs = this.xs, ys = this.ys, sxs = this.sxs, sys = this.sys;
    for (let i = 0; i < n; i++) {                    // project once, in order oldest → newest
      const k = (this.head - n + i + 240) % 240;
      sxs[i] = (xs[k] - cx) * zoom + hw;
      sys[i] = (ys[k] - cy) * zoom + hh;
    }
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const CH = 12, last = n - 1;
    for (let s = 0; s < last; s += CH) {
      const e = Math.min(s + CH, last);
      const g = ctx.createLinearGradient(sxs[s], sys[s], sxs[e], sys[e]);
      g.addColorStop(0, rgba("#5EA0FF", 1 - (last - s) / 240));   // α(i) = 1 − (count−1−i)/240
      g.addColorStop(1, rgba("#5EA0FF", 1 - (last - e) / 240));   // → exactly 1 at the ship
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(sxs[s], sys[s]);
      for (let i = s + 1; i <= e; i++) ctx.lineTo(sxs[i], sys[i]);
      ctx.stroke();
    }
  }
}
```

A chunk gradient is built on the chord from its first to its last point, which is a fine approximation for 12 segments of a gently curving orbit; if the trail ever hairpins inside 12 samples, drop `CH` to 6.

---

## 8. Predicted path

Planning mode only. The simulated look-ahead is sampled **by arc length, not by step**: a dot every **10 screen px** regardless of speed, so the dots do not bunch up near the star where the integrator takes many small steps. Dots: `path #DCE4FF`, r 1.5, α 0.7 for the first 80 % of the dots and α 0.35 for the last 20 % (uncertainty). Cap at **400 dots** (4000 px of path). The path ends with a ring r 6, stroke 1.5, α 0.5, same colour — "this is where the plan runs out".

Build one `Path2D` of arcs for each alpha band and fill it once: two `fill()` calls for up to 400 dots, ~0.3 ms.

```ts
// pts: simulated world positions, in order. Returns screen-space dot centres 10 px apart.
function sampleByArcLength(pts: [number, number][], toScreen: (x: number, y: number) => [number, number],
                           spacing = 10, max = 400): [number, number][] {
  const out: [number, number][] = [];
  if (pts.length === 0) return out;
  let prev = toScreen(...pts[0]);
  let carry = 0;
  out.push(prev);
  for (let i = 1; i < pts.length && out.length < max; i++) {
    const cur = toScreen(...pts[i]);
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    let t = spacing - carry;
    while (t <= seg && out.length < max) {
      const u = t / seg;
      out.push([prev[0] + (cur[0] - prev[0]) * u, prev[1] + (cur[1] - prev[1]) * u]);
      t += spacing;
    }
    carry = (carry + seg) % spacing;
    prev = cur;
  }
  return out;
}

function drawPredictedPath(ctx: CanvasRenderingContext2D, dots: [number, number][]): void {
  if (dots.length === 0) return;
  const split = Math.floor(dots.length * 0.8);
  const sure = new Path2D(), unsure = new Path2D();
  dots.forEach(([x, y], i) => {
    const p = i < split ? sure : unsure;
    p.moveTo(x + 1.5, y);
    p.arc(x, y, 1.5, 0, Math.PI * 2);
  });
  ctx.fillStyle = rgba("#DCE4FF", 0.7);  ctx.fill(sure);
  ctx.fillStyle = rgba("#DCE4FF", 0.35); ctx.fill(unsure);

  const [ex, ey] = dots[dots.length - 1];
  ctx.strokeStyle = rgba("#DCE4FF", 0.5); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.stroke();
}
```

Re-simulate and re-sample only when the drag changes (pointer move), not every frame; cache the `dots` array. Dot spacing is in **screen** px (§12), so zooming does not change the dot density.

---

## 9. Drag arrow

Exactly the geometry of `design/assets/drag-arrow.svg`. Everything is measured **from the ship's centre** along the launch direction (local +x after `rotate(dir)`). One number drives it all: the power tick `T = Lmax · power` with **`Lmax = 242`** px, so 62 % puts the tick at **150**, the tip at 166 and the shaft (16 → 152) is 136 px long — the brief's "~140 px". Parts, in draw order:

| Part | Geometry (local px from the ship centre) | Style |
|---|---|---|
| ghost | line 16 → 258 (= 16 + Lmax) | `#FFFFFF` α 0.16, 1 px, dash `[1, 5]`, round caps — shows the 100 % extent |
| shaft | line 16 → T + 2 (tucks under the head) | `arrow #FFFFFF` α 0.9, 2 px, round caps |
| head | triangle: tip (T + 16, 0), base (T, ±6) | fill + 1 px stroke in the power colour, round joins |
| tick | line (T, −11) → (T, +11) | power colour, 1.5 px, round caps |
| label | `"62 %"` 12 px mono `ui.textMuted #8B95B5`, unrotated, baseline-left at **tip + (2, 25)** screen px — below-right of the tip, as in the asset (tip (193.9, 40.7) → label (196, 66)); if the arrow points downward (`sin(dir) > 0`) use tip + (2, −14) so the label never sits on the head | |

Power colour ramps through the three `arrow.power` stops: `#3DE0C2` (0) → `#FFC857` (0.5) → `#FF5A5F` (1). At 62 % that is `#FFAE59` (t = 0.24 between mid and max). The label is always `ui.textMuted`, never the power colour — the colour lives in the head and tick only.

```ts
function lerpHex(a: string, b: string, t: number): string {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * t);
  return "#" + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0").toUpperCase();
}

function powerColor(p: number): string {                   // p in 0..1
  return p < 0.5 ? lerpHex("#3DE0C2", "#FFC857", p * 2)
                 : lerpHex("#FFC857", "#FF5A5F", (p - 0.5) * 2);
}

function drawDragArrow(ctx: CanvasRenderingContext2D, sx: number, sy: number, dir: number, power: number): void {
  const LMAX = 242, T = LMAX * power, col = powerColor(power);   // T = power tick, from the ship centre
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(dir);
  ctx.lineCap = "round";

  ctx.strokeStyle = rgba("#FFFFFF", 0.16); ctx.lineWidth = 1; ctx.setLineDash([1, 5]);   // ghost
  ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(16 + LMAX, 0); ctx.stroke();            // 16 → 258
  ctx.setLineDash([]);

  ctx.strokeStyle = rgba("#FFFFFF", 0.9); ctx.lineWidth = 2;                 // shaft 16 → T + 2
  ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(T + 2, 0); ctx.stroke();

  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(T + 16, 0); ctx.lineTo(T, -6); ctx.lineTo(T, 6); ctx.closePath();   // head
  ctx.fill(); ctx.stroke();

  ctx.lineWidth = 1.5;                                                        // tick at T, ±11
  ctx.beginPath(); ctx.moveTo(T, -11); ctx.lineTo(T, 11); ctx.stroke();
  ctx.restore();

  // label, unrotated, in screen space: tip + (2, 25), or tip + (2, −14) when the arrow points down
  const tipX = sx + Math.cos(dir) * (T + 16), tipY = sy + Math.sin(dir) * (T + 16);
  const lx = tipX + 2, ly = tipY + (Math.sin(dir) > 0 ? -14 : 25);
  ctx.font = '12px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.fillStyle = "#8B95B5";                                                   // ui.textMuted
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(`${Math.round(power * 100)} %`, Math.round(lx), Math.round(ly));
}
```

Arrow lengths are screen px: the throw power is a UI quantity and must feel the same at every zoom. `planning.svg` shows this same arrow (ghost 16 → 258, shaft 16 → 152, head 150 → 166, tick ±11 at 1.5 px, head/tick `#FFAE59`, label `#8B95B5` at tip + (2, 25)); the ghost's 1-on-5 dots run alongside the first ~90 px of the predicted path there, which is accepted — the ghost is α 0.16 and 1 px against the path's r 1.5 dots at α 0.7.

---

## 10. HUD

The HUD is cheap — a handful of `fillText` and rounded rects — so nothing is cached. Text: `textBaseline = "alphabetic"`, integer pixel positions, no shadow, no stroke. Hairlines (1 px borders) are snapped to `x + 0.5` so they land on one device pixel row instead of smearing across two.

Font strings (from the brief's stacks and scale):

```ts
const UI   = '-apple-system, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const FONT = {
  wordmark:   `500 13px ${UI}`,   // uppercase, letter-spacing 0.18em, ui.textMuted
  mode:       `500 11px ${UI}`,   // uppercase, letter-spacing 0.14em, ui.text
  label:      `400 13px ${UI}`,
  button:     `600 14px ${UI}`,
  telemetry:  `400 12px ${MONO}`,
  resultTitle:`600 40px ${UI}`,
  resultSub:  `400 16px ${UI}`,
};
```

Canvas has `ctx.letterSpacing` in Chrome/Edge/Safari 17+; use it where present and fall back to drawing uppercase microcopy character by character with a manual advance otherwise. Letter-spacing on uppercase microcopy only — never on titles or buttons.

Positions (1440×900; anchor the right-hand group to `w − 40` and the bottom group to `h − 80` on other sizes). These are the pinned values — every mockup (planning, flight and the three results) uses the same ones; `flight.svg` is the reference:

| Element | Spec (explicit edges, 1440×900) |
|---|---|
| Wordmark | `"SLINGSHOT"` 13 px, baseline **(40, 50)**, `#8B95B5`, spacing 0.18em |
| Mode label | `"PLANNING"` / `"IN FLIGHT"` 11 px, baseline **(40, 70)**, `#ECF0FA`, spacing 0.14em |
| FUEL label | `"FUEL"` 11 px uppercase `#8B95B5`, left-aligned at **x 1180, baseline 48** (above the bar's left end) |
| Fuel % | `"100 %"` 12 px mono **`#ECF0FA`** (`ui.text` — it is a reading, not a label), right-aligned at **x 1400, baseline 48** |
| Fuel bar | 220×8, radius 4, at **(1180, 56)** → spans x 1180–1400, y 56–64: track `rgba(255,255,255,0.08)`, fill `fuel.full #3DE0C2` ≥ 30 % / `fuel.low #FFC857` 10–30 % / `fuel.critical #FF5A5F` < 10 %; drains with a 140 ms ease |
| Launch button | 160×44, radius 10, **x 640–800, y 798–842** (centred at (720, 820)): fill `ui.accent #5EA0FF`, text `#050710` 14 px semibold |
| Speed control | three 56×36 cells at **x 580 / 636 / 692, y 802–838** (group spans 580–748, centre 664 = 720 − 56), radius 10 on the outer corners only: active fill `#5EA0FF` + `#050710` text, inactive `ui.panel rgba(10,13,26,0.72)` + `#ECF0FA` text, `ui.border rgba(255,255,255,0.10)` hairline around the group |
| Reset button | 96×36, radius 10, **x 764–860, y 802–838** (16 px gap): `ui.panel` fill, `ui.border`, `#ECF0FA` text. Control + gap + Reset = 280 px, centred as a block on x 720 |
| Telemetry | `"v 1.84  ·  dX 412"` 12 px mono `#8B95B5` at **(40, 864)** baseline; pad numbers to a fixed width so they do not jitter |

`roundRectPath` is the §0 helper. Button labels sit at the cell's vertical centre (`textBaseline = "middle"` at y + h/2 + 1, i.e. the mockups' 14 px labels at baseline 825). The HUD is drawn in every mode, including under a result overlay: draw order §0 puts it at step 8, *before* the scrim, so on the result screens it is dimmed by the scrim like the rest of the scene.

```ts
function fuelColor(f: number): string {           // f in 0..1
  return f >= 0.30 ? "#3DE0C2" : f >= 0.10 ? "#FFC857" : "#FF5A5F";
}

function drawFuelBar(ctx: CanvasRenderingContext2D, x: number, y: number, fuelShown: number): void {
  roundRectPath(ctx, x, y, 220, 8, 4);
  ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
  if (fuelShown > 0) {
    roundRectPath(ctx, x, y, Math.max(8, 220 * fuelShown), 8, 4);
    ctx.fillStyle = fuelColor(fuelShown); ctx.fill();
  }
}

function drawButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
                    label: string, primary: boolean): void {
  if (primary) {
    roundRectPath(ctx, x, y, w, h, 10);                                 // full rect: Launch is 160×44, Fly again 140×40
    ctx.fillStyle = "#5EA0FF"; ctx.fill();                              // ui.accent, no stroke
  } else {
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10);             // hairline-snapped only when stroked
    ctx.fillStyle = "rgba(10,13,26,0.72)"; ctx.fill();                  // ui.panel
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1; ctx.stroke();   // ui.border
  }
  ctx.font = FONT.button;
  ctx.fillStyle = primary ? "#050710" : "#ECF0FA";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, Math.round(x + w / 2), Math.round(y + h / 2) + 1);
  ctx.textBaseline = "alphabetic";
}

// Per-character advances for the letter-spacing fallback, measured once per font and cached:
// key = font + "|" + char. The fallback then does zero measureText per frame (§13).
const advanceCache = new Map<string, number>();

function advance(ctx: CanvasRenderingContext2D, ch: string): number {
  const key = ctx.font + "|" + ch;
  let a = advanceCache.get(key);
  if (a === undefined) { a = ctx.measureText(ch).width; advanceCache.set(key, a); }   // first frame only
  return a;
}

function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, em: number, px: number): void {
  // uppercase microcopy with letter-spacing; falls back to a manual advance from the cache
  const c = ctx as any;
  if (typeof c.letterSpacing === "string") { c.letterSpacing = `${em * px}px`; ctx.fillText(text, x, y); c.letterSpacing = "0px"; return; }
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += advance(ctx, ch) + em * px; }
}
```

Per-frame text cost: 9 `fillText` in flight mode (wordmark, mode, FUEL, %, 1x, 2x, 4x, Reset, telemetry), 7 in planning. Browsers without `letterSpacing` draw SLINGSHOT + IN FLIGHT + FUEL character by character — 21 small `fillText` instead of 3 — but never measure: the cache fills on the first frame and is invalidated only by a font change (there is none).

Hover 120 ms / press 80 ms: tween the button fill toward `lerpHex(fill, "#FFFFFF", 0.08)` on hover and `0.85` brightness on press; no scale, no shadow.

---

## 11. Result overlays

Three states, same layout, over the frozen flight scene:

1. Scrim: `fillRect` the whole canvas with `rgba(5,7,16,0.62)` (`bg.base` at 0.62) — the scene stays faintly visible.
2. Card 520×232, radius 16, fill `ui.panel` at 0.92 α = `rgba(10,13,26,0.92)`, `ui.border` hairline, a 4 px accent bar across the top in the result colour (clipped to the card's radius), title 40 px semibold in the result colour, subtitle 16 px `#8B95B5`, and one primary button `"Fly again"` 140×40 centred below. Interior, measured from the card's top edge `y` exactly as in `result-win/crash/lost.svg` (card at (460, 334)): title baseline **y + 78** (412), subtitle baseline **y + 114** (448), button **y + 148 → y + 188** (482–522), leaving a 44 px bottom margin.
3. Copy / colour: win `result.win #3DE0C2` — "Planet X reached" / "Captured with 34 % fuel to spare."; crash `result.crash #FF5A5F` — "Crashed" / "Too fast, too close to the star."; lost `result.lost #B48CFF` — "Lost in space" / "Out of fuel and out of reach."

The card is the **one place `shadowBlur` is allowed**: `shadowBlur = 16`, `shadowColor = "rgba(5,7,16,0.5)"` (`ui.shadow` = `bg.base` at α 0.5), `shadowOffsetY = 8` — the mockups' `feGaussianBlur stdDeviation="8"` at an 8 px offset, and Canvas defines σ = shadowBlur / 2, hence 16. It is rendered **once** into an offscreen canvas with a **64 px margin** on every side (3σ + offset = 32 px, so nothing clips with room to spare; 648×360) when the result fires. Every frame after that is a scrim `fillRect` and one `drawImage`, faded in over **320 ms** with a **12 px rise**, ease-out cubic. Nothing moves, so the blur never repeats.

```ts
type Result = "win" | "crash" | "lost";
const RESULT = {
  win:   { color: "#3DE0C2", title: "Planet X reached", sub: "Captured with 34 % fuel to spare." },
  crash: { color: "#FF5A5F", title: "Crashed",          sub: "Too fast, too close to the star." },
  lost:  { color: "#B48CFF", title: "Lost in space",    sub: "Out of fuel and out of reach." },
};
const CARD_W = 520, CARD_H = 232, MARGIN = 64;   // margin ≥ 3σ + offset = 3·8 + 8 = 32

function buildResultCard(kind: Result): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = (CARD_W + MARGIN * 2) * DPR; c.height = (CARD_H + MARGIN * 2) * DPR;
  const g = c.getContext("2d")!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const { color, title, sub } = RESULT[kind];
  const x = MARGIN, y = MARGIN;

  g.shadowColor = "rgba(5,7,16,0.5)"; g.shadowBlur = 16; g.shadowOffsetY = 8;  // ui.shadow: the one allowed blur (σ 8, as the mockups)
  roundRectPath(g, x, y, CARD_W, CARD_H, 16);
  g.fillStyle = "rgba(10,13,26,0.92)"; g.fill();                                 // ui.panel @ 0.92
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;

  g.save(); roundRectPath(g, x, y, CARD_W, CARD_H, 16); g.clip();
  g.fillStyle = color; g.fillRect(x, y, CARD_W, 4);                              // accent bar
  g.restore();
  roundRectPath(g, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 16);
  g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 1; g.stroke();         // ui.border

  g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.font = FONT.resultTitle; g.fillStyle = color; g.fillText(title, x + CARD_W / 2, y + 78);   // mockup: 412
  g.font = FONT.resultSub;   g.fillStyle = "#8B95B5"; g.fillText(sub, x + CARD_W / 2, y + 114); // mockup: 448
  drawButton(g, x + CARD_W / 2 - 70, y + 148, 140, 40, "Fly again", true);                        // mockup: 482–522
  return c;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// startMs = performance.now() when the result fired
function drawResultOverlay(ctx: CanvasRenderingContext2D, card: HTMLCanvasElement,
                           w: number, h: number, startMs: number, nowMs: number): void {
  const t = easeOutCubic(Math.min(1, (nowMs - startMs) / 320));
  ctx.fillStyle = `rgba(5,7,16,${0.62 * t})`;                                   // scrim fades with the card
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = t;
  const x = Math.round((w - CARD_W) / 2 - MARGIN);
  const y = Math.round((h - CARD_H) / 2 - MARGIN + 12 * (1 - t));               // 12 px rise
  ctx.drawImage(card, x, y, CARD_W + MARGIN * 2, CARD_H + MARGIN * 2);
  ctx.globalAlpha = 1;
}
```

Scene details under each overlay (all drawn *before* the scrim, together with the HUD, exactly as `result-win/crash/lost.svg` layer them): win — ship inside planet X's ring, ring at α 1.0 with the pulse and crawl stopped (§4); crash — trail ends at the corona, no ship, plus a **crash burst** at the impact point: an outer disc r 7 `thrust.outer #FF6A2A` at α 0.45, 6 spark lines 1.5 px wide and 8–14 px long radiating from r 5 at 60° steps, alternating `thrust.core #FFE08A` / `thrust.outer #FF6A2A`, round caps, and a core disc r 3.5 `#FFE08A` on top — held for the first 12 frames, no blur; lost — trail runs off the top-right edge with the ship at the edge.

---

## 12. Zoom & scaling rules

A single camera `{ x, y, zoom }` maps world → screen: `sx = (wx − cam.x) · zoom + w/2`, `sy = (wy − cam.y) · zoom + h/2`. Everything that is *part of the world* goes through it; everything that is *for the player's eyes* stays in screen pixels.

| Scales with zoom (world) | Fixed in screen px (UI / legibility) |
|---|---|
| Body radii (star 46, planets 34 / 30, halo 1.8 r, ring 78) | Ship **minimum** size (`max(12, 22·zoom)`) |
| Star sprite size (400 · zoom · breathe; library stars `sp.S` · zoom · breathe, S = 400 / 348 / 480) | All line widths: ring 1.5, trail 2, path dots r 1.5, arrow 2, outline 1, planet limb line 1 (baked at the bucket zoom) |
| Planet strip and overlay blit sizes (`2P · zoom / bucketZoom`, `size · zoom / bucketZoom`, §4) | Dot spacing on the predicted path (10 px) and the 400-dot cap |
| Positions of trail samples, path dots, ship, planets | Ring pulse amplitude (±2 px), dash pattern `[6, 6]` and dash crawl (−12 px/s) |
| Strip period P = round(2π r) at the bucket zoom (214 / 188 at zoom 1) and the texture feature size (cells per P) — so the surface speed in px/s scales with zoom while the **rotation periods (90 / 64 / 120 / 80 s) are wall-clock** and never change | Rotation periods: seconds per turn, independent of zoom and of the 1x/2x/4x simulation speed |
| Overlay geometry — squash 0.88–1.0 r, glint 0.45 r·L and 0.22 r × 0.12 r, shade centre 0.36 r·L, shade radius 1.25 r, rim 1.12 r — all in r, baked at the bucket zoom | Drag arrow (tick at 242 · power from the ship centre), head, tick, label |
| v1.3 (§4b): library radii and crash radii; the airless shade radius 1.5 r; the ring ellipse (1.35–2.2 r, ry = 0.28 rx, tilt 22°); the black hole's disk (rx 2.6 r, ry 0.55 r), photon ring r 1.09 r, arcs 1.15–1.3 r, Einstein ring 2.1 r; the neutron star's beams (3.5 r) and haze (2.5 r); the white dwarf's glow (6 r) and spikes (4 r); loop sprites (× zoom × s); the double planet's orbit (30.94 / 7.06 px at zoom 1) | v1.3 periods, all wall-clock: strips 60–180 s, bands 110–180 s, orbit 40 s, loops 12 / 16 / 14 s, flare cycle 22 s, breathes 6 s / 4 s, beams 6 s, disk 24 s, vein pulse 5 s; the 1 px / 1.5 px lines inside the compact-object sprites (photon ring, Einstein ring, spikes, hard limbs) are baked and scale with `drawImage` like the star sprite |
| | HUD, fuel bar, buttons, telemetry, result card |

```ts
interface Camera { x: number; y: number; zoom: number }

function worldToScreen(cam: Camera, w: number, h: number) {
  return (wx: number, wy: number): [number, number] =>
    [(wx - cam.x) * cam.zoom + w / 2, (wy - cam.y) * cam.zoom + h / 2];
}
```

The tuple-returning `worldToScreen` is fine for the handful of bodies and for the predicted path (re-sampled only on pointer move, §8). The trail (§7) is the one hot loop that runs every frame over hundreds of points, so it inlines the same formula into preallocated `Float32Array`s instead of calling this.

Do not use `ctx.scale(zoom, zoom)` for the whole scene: it would scale line widths, dash patterns and the ship with it, and you would spend the frame dividing them back out. Transform positions and radii explicitly; keep the context at DPR scale only.

### Zoom bucket rule (planet strips and overlays)
The planet strips and lighting overlays are bitmaps, so they are built at a **bucketed** zoom and scaled by the residual: `bucketZoom = 1.25^round(log(zoom) / log 1.25)` (§4 `zoomBucket`), which puts the residual `zoom / bucketZoom` inside **0.894 … 1.118** — nothing is stretched or shrunk by more than ~12 %, so the 1 px limb line, the ≈ 1 px coastlines and the thin veins stay clean. They are **re-rendered only when the bucket changes** (buckets … 0.64, 0.8, 1, 1.25, 1.5625 …): `round()` flips at the bucket midpoints, i.e. **±11.8 %** about each centre (`zoomBucket(1.117) = 1`, `zoomBucket(1.119) = 1.25`), so successive builds are always **25 % apart** in zoom — the rule is "25 % between builds", not "25 % since the last build": a zoom sitting right on a boundary can rebuild on a sub-1 % change. Continuous zooming inside a bucket costs nothing. Both planets share the bucket, so a change rebuilds both (≈ 4 ms once); the rotation phases live outside the bitmaps and survive the rebuild, so the surface does not jump. Hysteresis is not needed: a rebuild is cheap enough that chattering across a boundary is harmless, and keeping the residual inside ±11.8 % (rather than the ±25 % a hysteresis band would allow) is what keeps the 1 px limb line clean.

When zoom changes, nothing else needs rebuilding: the star sprite is a fixed 400 px bitmap that `drawImage` scales (§3). The background does not zoom at all (no parallax in this prototype) — the Milky Way and the starfield are screen-space.

---

## 13. Cheap vs. expensive checklist

| Cheap — use freely | Expensive — avoid or cache |
|---|---|
| `drawImage` of an opaque cached canvas (0.1–0.2 ms full screen) | `shadowBlur` on anything that moves (2–5 ms per call) |
| `createRadialGradient` / `createLinearGradient` per frame (µs) — for the few live layers only (X halo); sprites cache theirs | `ctx.filter = "blur(...)"` **per frame** (worse than shadowBlur); once inside a sprite build it is fine (§3 `bakeStreamers`) |
| One `Path2D` with hundreds of arcs + one `fill()` | Hundreds of separate `beginPath/arc/fill` calls with changing `fillStyle` |
| `setLineDash` + `lineDashOffset` (but reset to `[]`) | `getImageData` / `putImageData` anywhere in the loop |
| `globalCompositeOperation = "lighter"` on two small triangles | `"lighter"` over large areas or many layers |
| `"multiply"` / `"destination-in"` **inside a sprite build** (§3, §4) | Blend modes on a live layer every frame |
| A 128² noise tile built once with `putImageData` and reused as a pattern; one `getImageData` per strip layer **at build time** to threshold it (§4) | Noise, `feTurbulence`-style filters or `ctx.filter` per frame |
| Planet strips (428 × 68 / 376 × 60) + lighting overlays (81 / 72 px), rebuilt only when the zoom bucket changes (buckets 25 % apart, flipping at ±11.8 %) | Rebuilding a strip per zoom tick, or drawing the noise + terminator + rim live |
| Rotating a planet by moving the `drawImage` x offset of a cached, 2-tile strip through a circular clip (1 clip + 2–3 blits, dt-based phase, modulo wrap) | Re-rendering the texture per frame, rotating with `ctx.rotate` (the lighting would turn), or a per-frame `ctx.filter`/mask for the "sphere" |
| `fillText` ≤ 10 per frame at integer positions | Measuring and laying out text every frame (`measureText` in a loop) |
| `translate/rotate/scale` + `save/restore` per sprite | Deep `save/restore` nesting; re-setting `font` for every string |
| Opaque context `{ alpha: false }`, DPR capped at 2 | DPR 3 canvases, transparent contexts, `clearRect` + redraw of a static background |
| Rebuilding sprites on resize | Rebuilding sprites per frame, or per zoom tick |
| Ring buffers and `Float32Array` for trail/path | Allocating arrays per frame (GC pauses show up as dropped frames) |
| ~1005 dots, 12 halos and 3 band gradients **once** into the background (≈ 2.5 ms) | Any starfield, halo or band drawing in the frame loop |
| Three pre-blurred 96 × 64 loop sprites and one cached flare sprite per star, scaled and alpha-faded by the scene clock (§3b) | Stroking blurred arcs live, `ctx.filter = "blur()"` or `shadowBlur` on a prominence, or animating the loops by simulation steps |
| The black hole's ring texture drawn twice under two axis-aligned half-plane clips with `scale → rotate` (§3c) | Re-rendering the disk per frame, rotating the squashed ellipse (wrong motion), or masking the Doppler gradient with `destination-in` on the main canvas |
| One 80 px magnetosphere sprite under `ctx.rotate` (§3c); craters as circles baked into the strip (§4b) | Drawing beams or craters live every frame |
| Band strips built once from 9 waved polygons + an `overlay` streak pass; two static ring sprites around the planet (§4b) | A per-frame displacement map, or drawing the ring's front half with a path clip through the planet every frame |

If a frame ever exceeds 6 ms, the order to look at is: (1) a stray `shadowBlur`, (2) the background being redrawn instead of blitted, (3) the planet strips being rebuilt every frame (check that `zoomBucket` is stable and that `ensurePlanetStrips` compares the bucket, not the raw zoom), (4) the trail drawn per segment with 240 strokes, (5) text drawn with letter-spacing fallback per character. Fix in that order; each one alone can double the frame cost. If a planet's surface visibly steps instead of gliding, something is rounding the strip offset — keep it fractional (§4). v1.3 adds two more suspects: (6) a library star's loops drawn with `ctx.filter` / `shadowBlur` instead of the pre-blurred sprites, and (7) the black hole's ring texture or a gas giant's band strips rebuilt per frame (§3b, §3c, §4b).
