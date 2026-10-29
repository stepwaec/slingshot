# Slingshot — Canvas 2D drawing notes (v1.2)

How to draw every element of the visual style in plain Canvas 2D (TypeScript, no engine) and hold a steady 60 fps on an integrated GPU. Every number below is taken from `design/style.md`, the asset SVGs in `design/assets/` and the shared brief; every colour is a palette token written as hex. Snippets are valid TypeScript with no imports — `ctx` is always a `CanvasRenderingContext2D`.

v1.1 was the realism pass: the three bodies and the sky got richer, and all of that richness is paid **once**, at build time, into cached bitmaps (background, star sprite, planet sprites). v1.2 is the planet pass: each planet's cached sprite becomes a cached **texture strip** (land / clouds, basins / wisps, polar caps; period P = round(2π r)) that scrolls under a cached **lighting overlay** (limb squash, glint, terminator, limb line, rim) — the surface rotates at 64–120 s per turn, the light never moves, and the per-frame cost is 1 clip + 3 blits per planet (§4). Planet X's halo now breathes with the ring. Star, sky, ship, trail, path, arrow, HUD and overlays (§1–§3, §5–§11) are exactly v1.1.

Scene reference used throughout (world units = screen px at zoom 1, 1440×900 mockup): star centre (760, 470) r 46; start planet (250, 690) r 34; planet X (1190, 210) r 30, capture ring r 78; ship 22 px long. The unit vector from a planet toward the star is called **L** (start planet: (+0.7071, −0.7071), upper-right; planet X: (−0.7071, +0.7071), lower-left).

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
2. star (cached sprite, breathing scale)
3. planets (cached texture strips scrolled through a circular clip + cached lighting overlay: start, then X with its **live** breathing halo under the strips)
4. capture ring (dashed, pulsing, live)
5. predicted path (planning) **or** trail (flight)
6. drag arrow (planning only)
7. thrust flash (flight, `lighter`), then ship
8. HUD (wordmark, mode label, fuel bar, buttons, telemetry)
9. result overlay (cached card, faded in) — only when a result exists

### Per-frame budget (CSS 1440×900, DPR 2, Intel Iris Xe / Apple M-series integrated GPU)

| Layer | Target ms | How it stays there |
|---|---|---|
| Background blit | 0.20 | one opaque `drawImage`, cached (Milky Way, halos and ~1005 dots are baked in) |
| Star | 0.10 | one `drawImage` of a 400×400 sprite — richer interior (streamers, chromosphere, limb darkening, granulation), same blit |
| Planets (2) | 0.16 | per planet **1 `arc` clip + 2 strip `drawImage` with a dt-based x offset + 1 lighting-overlay `drawImage`** (≈ 0.08 ms each, §4) — the strips (428 × 68 / 376 × 60 at zoom 1) and overlays (81 / 72 px) are cached, rebuilt only when the zoom bucket changes (§12), never on resize; only the 2r window inside the clip is rasterised |
| Planet X halo + ring | 0.15 | one gradient fill (radius breathing ±4 %) + one dashed stroke, both live |
| Predicted path (≤ 400 dots) **or** trail (≤ 240 segs) | 0.60 | one `Path2D` fill / 20 gradient-chunk strokes |
| Drag arrow | 0.05 | 3 strokes, 1 fill, 1 `fillText` |
| Ship + thrust | 0.10 | 3 small polygons + 2 triangles |
| HUD | 0.60 | ≤ 10 `fillText` (flight mode has 9), ≤ 6 rounded rects; in the letter-spacing fallback ≤ 21 single-character `fillText` and **zero** `measureText` (advances cached, §10) |
| Result overlay | 0.30 | scrim `fillRect` + one `drawImage` |
| **Render total** | **≈ 2.3 ms** | leaves > 3.5 ms of the 6 ms target for physics and GC |

Target ≤ 6 ms of render per frame, so a 16.7 ms frame keeps slack even when the browser is busy. Measure with `performance.now()` around the draw and show it in the telemetry line while developing.

### One-time build costs (not per frame)

| Build | ≈ ms | When |
|---|---|---|
| Background (§1 + §2): 3 band gradients, 380 + 420 + 160 + 45 dots, 12 halo gradients, 4 sparkles | 2.5 | resize |
| Star sprite (§3): 2 gradient discs, 12 wedges, 3 rings, body gradient, 128² noise tile `multiply` | 1.5 | resize (fixed 400 px bitmap that `drawImage` scales; see §3 if the game ever zooms past 2×) |
| Planet strips + lighting overlay (§4), each planet: 2 noise fields stretched from the 128² tiles (`getImageData` once each), 3 thresholded layers (`putImageData` + 2 blits each), polar-cap bands, overlay (squash, glint, terminator, limb, rim in 2 passes) | ≈ 2 | when the zoom bucket changes (§12: buckets at 1.25^k, 25 % apart, flipping ±11.8 % about each centre) — not on resize; both planets ≈ 4 ms in the same frame |
| Noise tiles (§4 `makeNoiseTile`), each: 128² value noise, 2–4 octaves, `putImageData` | 0.3–0.4 | once per (seed, cells, octaves): 3 (star), 7 / 6, 19 / 12 (start), 11 / 7, 23 / 9 (X) — five tiles, kept across strip rebuilds |

### Cached offscreen vs. drawn live
| Cached (rebuilt only on resize / state change) | Drawn live every frame |
|---|---|
| Background + vignette + Milky Way + starfield (one canvas) | Planet X halo (gradient, breathing) and capture ring |
| Star sprite 400×400 (×DPR) | Ring, path, trail, arrow, ship, thrust |
| Planet texture strips 428×68 / 376×60 (×DPR, two per planet, at the current zoom bucket) | The strips' scroll: a dt-based source offset on two clipped blits per planet — the pixels themselves are never touched |
| Planet lighting overlays 81×81 / 72×72 (×DPR, at the current zoom bucket) | HUD text and bars, scrim |
| Result card 520×232 (+ 64 px shadow margin) | |

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
| 3 | streamers | 10 wedges `(48, −w/2) → (T, 0) → (48, w/2)` rotated by A | fill `star.corona #FF8C2E`; **linear gradient along the wedge, α a at the base (r 48) → 0 at the tip** instead of the SVG's σ 6 blur |
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

  for (const [A, w, T, a] of STAR_STREAMERS) {                             // 3+4. streamers + lobes, no blur
    g.save();
    g.translate(c, c); g.rotate((A * Math.PI) / 180);
    const lg = g.createLinearGradient(48, 0, T, 0);                        // α a at the base → 0 at the tip
    lg.addColorStop(0, rgba("#FF8C2E", a)); lg.addColorStop(1, rgba("#FF8C2E", 0));
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(48, -w / 2); g.lineTo(T, 0); g.lineTo(48, w / 2); g.closePath(); g.fill();
    g.restore();
  }

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

// Breathe: ±3 % over 6 s. tMs = performance.now(). Pass the star's screen position and zoom.
function drawStar(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tMs: number): void {
  const breathe = 1 + 0.03 * Math.sin((tMs / 6000) * Math.PI * 2);
  const size = 400 * zoom * breathe;
  ctx.drawImage(starSprite, sx - size / 2, sy - size / 2, size, size);
}
```

The sprite is built for r 46 at zoom 1 in a fixed 400 px canvas (`S = 400`, every radius in CSS px — there is no size parameter); `drawImage` scales it for other zooms, and this prototype never zooms past 2× (§12). If it ever did, give `buildStarSprite` a scale `k` (S = 400 k, every radius, the 92 px granulation rect and the tile pattern × k) and rebuild at k = 2 so the body edge, the 1 px chromosphere rings and the granulation stay crisp — not implemented here. If the wedge edges read hard at DPR 2 (they should not at α ≤ 0.16 over the corona), draw each wedge twice — once at `w + 6` and half its alpha, then at `w` — a two-fill fake blur that is still build-time only. No rotation, no flicker: the only motion is the breathe.

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
  surface: StripLayer[];                      // drawn over the base fill, in order
  caps: { color: string; frac: number };      // polar bands, fraction of the disc diameter each
  cloud: StripLayer;                          // second strip, transparent background, alpha baked
  specular: boolean;                          // ocean glint in the overlay (start only)
  surfacePeriod: number; cloudPeriod: number; // seconds per rotation
}

const PLANET_START: PlanetSpec = {
  r: 34, base: "#3D8BFF", highlight: "#9CCBFF", shadow: "#142B5E", atmo: "#7FB8FF", limbAlpha: 0.16,
  surface: [
    { seed: 7, cells: 6, octaves: 4, color: "#8FB07A", alpha: 1,    sel: { kind: "above", cover: 0.32, ramp: 12 } },   // planet.start.land
    { seed: 7, cells: 6, octaves: 4, color: "#142B5E", alpha: 0.22, sel: { kind: "above", cover: 0.10, ramp: 46 } },   // highlands
  ],
  caps: { color: "#E9EEF8", frac: 0.12 },                                                                              // planet.start.ice
  cloud: { seed: 19, cells: 12, octaves: 4, color: "#F2F5FF", alpha: 0.5, sel: { kind: "above", cover: 0.40, ramp: 24 } }, // planet.start.cloud
  specular: true, surfacePeriod: 90, cloudPeriod: 64,
};
const PLANET_X: PlanetSpec = {
  r: 30, base: "#3DE0C2", highlight: "#B5FFF0", shadow: "#0E4A40", atmo: "#8FFFE6", limbAlpha: 0.18,
  surface: [
    { seed: 11, cells: 7, octaves: 4, color: "#0E4A40", alpha: 0.60, sel: { kind: "above", cover: 0.28, ramp: 22 } },  // planet.x.mineral basins
    { seed: 11, cells: 7, octaves: 4, color: "#0E4A40", alpha: 0.35, sel: { kind: "crease", cover: 0.05 } },           // veins
  ],
  caps: { color: "#B5FFF0", frac: 0.18 },                                                                              // planet.x.ice
  cloud: { seed: 23, cells: 9, octaves: 2, color: "#B5FFF0", alpha: 0.35, sel: { kind: "crease", cover: 0.15 } },     // planet.x.wisp
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
  cloud: HTMLCanvasElement;     // 2W × H, transparent background, alpha baked (0.5 clouds / 0.35 wisps)
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
  const cloud   = buildStrip([spec.cloud], null, null, W, H);
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
  spin.cloud   = frac(spin.cloud   + dtS / spec.cloudPeriod);           // 64 s / 80 s — drifts relative to the surface
}

// 1 clip + 3 drawImage. sx, sy = screen centre; zoom = current camera zoom (residual k inside the bucket: 0.894 … 1.118).
function drawPlanet(ctx: CanvasRenderingContext2D, st: PlanetStrips, spin: Spin, sx: number, sy: number, zoom: number): void {
  const k = zoom / st.zoom, r = st.r * k, P = st.P * k, D = 2 * r;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(st.surface, sx - r - P + spin.surface * P, sy - r, 2 * P, D);   // west→east: offset grows with time
  ctx.drawImage(st.cloud,   sx - r - P + spin.cloud   * P, sy - r, 2 * P, D);   // alpha baked (0.5 / 0.35)
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
function drawPlanetX(ctx: CanvasRenderingContext2D, p: Body, zoom: number, tMs: number): void {
  const r = p.r * zoom;
  const w = Math.sin((tMs / 2400) * Math.PI * 2);                      // −1..1 over 2.4 s — one clock for halo and ring
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
  ctx.lineDashOffset = -((tMs / 1000) * 12) % 12;                      // dash crawl −12 px/s (one 12 px period per second)
  ctx.beginPath(); ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;                         // always reset
}
```

On the win overlay the pulse and the crawl stop and the ring is drawn at **full α 1.0** (radius 78, `lineDashOffset` 0), as in `result-win.svg` — the one moment the boundary reads as solid. The halo breathe and the surface rotation continue under the scrim.

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
| Star sprite size (400 · zoom · breathe) | All line widths: ring 1.5, trail 2, path dots r 1.5, arrow 2, outline 1, planet limb line 1 (baked at the bucket zoom) |
| Planet strip and overlay blit sizes (`2P · zoom / bucketZoom`, `size · zoom / bucketZoom`, §4) | Dot spacing on the predicted path (10 px) and the 400-dot cap |
| Positions of trail samples, path dots, ship, planets | Ring pulse amplitude (±2 px), dash pattern `[6, 6]` and dash crawl (−12 px/s) |
| Strip period P = round(2π r) at the bucket zoom (214 / 188 at zoom 1) and the texture feature size (cells per P) — so the surface speed in px/s scales with zoom while the **rotation periods (90 / 64 / 120 / 80 s) are wall-clock** and never change | Rotation periods: seconds per turn, independent of zoom and of the 1x/2x/4x simulation speed |
| Overlay geometry — squash 0.88–1.0 r, glint 0.45 r·L and 0.22 r × 0.12 r, shade centre 0.36 r·L, shade radius 1.25 r, rim 1.12 r — all in r, baked at the bucket zoom | Drag arrow (tick at 242 · power from the ship centre), head, tick, label |
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
| `createRadialGradient` / `createLinearGradient` per frame (µs) | `ctx.filter = "blur(...)"` (worse than shadowBlur) |
| One `Path2D` with hundreds of arcs + one `fill()` | Hundreds of separate `beginPath/arc/fill` calls with changing `fillStyle` |
| `setLineDash` + `lineDashOffset` (but reset to `[]`) | `getImageData` / `putImageData` anywhere in the loop |
| `globalCompositeOperation = "lighter"` on two small triangles | `"lighter"` over large areas or many layers |
| `"multiply"` / `"destination-in"` **inside a sprite build** (§3, §4) | Blend modes on a live layer every frame |
| A 128² noise tile built once with `putImageData` and reused as a pattern; one `getImageData` per strip layer **at build time** to threshold it (§4) | Noise, `feTurbulence`-style filters or `ctx.filter` per frame |
| Planet strips (428 × 68 / 376 × 60) + lighting overlays (81 / 72 px), rebuilt only when the zoom bucket changes (buckets 25 % apart, flipping at ±11.8 %) | Rebuilding a strip per zoom tick, or drawing the noise + terminator + rim live |
| Rotating a planet by moving the `drawImage` x offset of a cached, 2-tile strip through a circular clip (1 clip + 3 blits, dt-based phase, modulo wrap) | Re-rendering the texture per frame, rotating with `ctx.rotate` (the lighting would turn), or a per-frame `ctx.filter`/mask for the "sphere" |
| `fillText` ≤ 10 per frame at integer positions | Measuring and laying out text every frame (`measureText` in a loop) |
| `translate/rotate/scale` + `save/restore` per sprite | Deep `save/restore` nesting; re-setting `font` for every string |
| Opaque context `{ alpha: false }`, DPR capped at 2 | DPR 3 canvases, transparent contexts, `clearRect` + redraw of a static background |
| Rebuilding sprites on resize | Rebuilding sprites per frame, or per zoom tick |
| Ring buffers and `Float32Array` for trail/path | Allocating arrays per frame (GC pauses show up as dropped frames) |
| ~1005 dots, 12 halos and 3 band gradients **once** into the background (≈ 2.5 ms) | Any starfield, halo or band drawing in the frame loop |

If a frame ever exceeds 6 ms, the order to look at is: (1) a stray `shadowBlur`, (2) the background being redrawn instead of blitted, (3) the planet strips being rebuilt every frame (check that `zoomBucket` is stable and that `ensurePlanetStrips` compares the bucket, not the raw zoom), (4) the trail drawn per segment with 240 strokes, (5) text drawn with letter-spacing fallback per character. Fix in that order; each one alone can double the frame cost. If a planet's surface visibly steps instead of gliding, something is rounding the strip offset — keep it fractional (§4).
