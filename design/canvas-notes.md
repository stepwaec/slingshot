# Slingshot — Canvas 2D drawing notes

How to draw every element of the visual style in plain Canvas 2D (TypeScript, no engine) and hold a steady 60 fps on an integrated GPU. Every number below is taken from `design/style.md`, the asset SVGs in `design/assets/` and the shared brief; every colour is a palette token written as hex. Snippets are valid TypeScript with no imports — `ctx` is always a `CanvasRenderingContext2D`.

Scene reference used throughout (world units = screen px at zoom 1, 1440×900 mockup): star centre (760, 470) r 46; start planet (250, 690) r 34; planet X (1190, 210) r 30, capture ring r 78; ship 22 px long.

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

`{ alpha: false }` lets the browser skip blending the canvas against the page. All drawing is in CSS pixels; the transform does the scaling. Call `fitCanvas` on resize only, and rebuild every cached sprite in the same handler (see §1, §3).

### Clear strategy
Do not call `clearRect`. The background layer (§1) is an opaque offscreen canvas that already contains `bg.base`, the vignette and the starfield; blitting it with `drawImage` *is* the clear. One `drawImage` of a full-screen opaque bitmap is ~0.2 ms; `clearRect` + `fillRect` + 625 star arcs would be ~1.5 ms.

### Draw order (back to front, every frame)
1. background (cached: base + vignette + starfield) — one `drawImage`
2. star (cached sprite, breathing scale)
3. planets (start, then X with its halo)
4. capture ring (dashed, pulsing)
5. predicted path (planning) **or** trail (flight)
6. drag arrow (planning only)
7. thrust flash (flight, `lighter`), then ship
8. HUD (wordmark, mode label, fuel bar, buttons, telemetry)
9. result overlay (cached card, faded in) — only when a result exists

### Per-frame budget (CSS 1440×900, DPR 2, Intel Iris Xe / Apple M-series integrated GPU)

| Layer | Target ms | How it stays there |
|---|---|---|
| Background blit | 0.20 | one opaque `drawImage`, cached |
| Star | 0.10 | one `drawImage` of a 400×400 sprite |
| Planets (2) | 0.20 | two radial gradients built per frame (gradients are cheap; blur is not) |
| Planet X halo + ring | 0.15 | one gradient fill + one dashed stroke |
| Predicted path (≤ 400 dots) **or** trail (≤ 240 segs) | 0.60 | one `Path2D` fill / 20 gradient-chunk strokes |
| Drag arrow | 0.05 | 3 strokes, 1 fill, 1 `fillText` |
| Ship + thrust | 0.10 | 3 small polygons + 2 triangles |
| HUD | 0.60 | ≤ 10 `fillText` (flight mode has 9), ≤ 6 rounded rects; in the letter-spacing fallback ≤ 21 single-character `fillText` and **zero** `measureText` (advances cached, §10) |
| Result overlay | 0.30 | scrim `fillRect` + one `drawImage` |
| **Render total** | **≈ 2.3 ms** | leaves > 3.5 ms of the 6 ms target for physics and GC |

Target ≤ 6 ms of render per frame, so a 16.7 ms frame keeps slack even when the browser is busy. Measure with `performance.now()` around the draw and show it in the telemetry line while developing.

### Cached offscreen vs. drawn live
| Cached (rebuilt only on resize / state change) | Drawn live every frame |
|---|---|
| Background + vignette + starfield (one canvas) | Planets (gradient per body) |
| Star sprite 400×400 (×DPR) | Ring, path, trail, arrow, ship, thrust |
| Result card 520×232 (+ 64 px shadow margin) | HUD text and bars, scrim |

### The rule
**Never call `shadowBlur` on moving things.** `shadowBlur` forces a full-size readback and a two-pass Gaussian for every draw call that uses it; on a moving object it runs every frame. The one permitted use is the result card (§11), drawn once into an offscreen canvas and then blitted.

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

One offscreen canvas at the full DPR-scaled size holds `bg.base`, the radial vignette and the whole starfield (§2). It is redrawn only on resize.

Vignette: radial gradient centred on the canvas centre, `bg.vignette #0B1024` at r 0 → `bg.base #050710` at r 900 (at 1440×900 the corners are at r ≈ 849, so they sit on base). Fill the base colour first so the gradient never has to cover the corners.

```ts
let bgCanvas: HTMLCanvasElement;

function buildBackground(w: number, h: number): void {
  bgCanvas = document.createElement("canvas");
  bgCanvas.width = Math.round(w * DPR);
  bgCanvas.height = Math.round(h * DPR);
  const g = bgCanvas.getContext("2d", { alpha: false })!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);

  g.fillStyle = "#050710";                        // bg.base
  g.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const v = g.createRadialGradient(cx, cy, 0, cx, cy, 900);
  v.addColorStop(0, "#0B1024");                   // bg.vignette
  v.addColorStop(1, "#050710");                   // bg.base
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);

  drawStarfield(g, w, h);                         // §2 — into the same canvas
}

function blitBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.drawImage(bgCanvas, 0, 0, w, h);            // this is the per-frame "clear"
}
```

The vignette radius is fixed at 900 regardless of window size: on a smaller window it simply gets cropped, which keeps the centre lift identical between the mockups and the game.

---

## 2. Starfield

Three static depth layers, no parallax, drawn **once** into the background canvas. Positions come from a seeded RNG (mulberry32, seed `0x514E47`) so that reloads and resizes agree with each other — the sky never reshuffles under the player. `design/assets/starfield.svg` is a **sample**, not a reference bitmap: it has the same counts, radii, alphas and sparkle treatment, but its dot positions were placed by a different pass of the generator and are not reproduced by the code below. Do not compare the two dot-for-dot; match the table, not the asset.

| Layer | Colour | Radius | Alpha | Count at 1440×900 |
|---|---|---|---|---|
| far  | `stars.far`  `#6E7FA6` | 0.6 px | 0.35 | 420 |
| mid  | `stars.mid`  `#AAB8DD` | 0.9 px | 0.60 | 160 |
| near | `stars.near` `#FFFFFF` | 1.3 px | 0.90 | 45 |

Scale counts with area for other sizes: `count × (w·h) / (1440·900)`.

Sparkles: 4 of the near stars get a 4-point cross — two 5 px lines (±2.5 px) through the centre, `#FFFFFF`, stroke 0.6 px, α 0.5, round caps. Static; no twinkle. The code takes the first 4 near stars the RNG produces; the SVG picked 4 of its own near stars by eye (spread over the frame, away from the bodies). Either is fine — the rule is "4 crosses on near stars", not "these 4 positions".

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

function drawStarfield(g: CanvasRenderingContext2D, w: number, h: number): void {
  const rnd = mulberry32(0x514E47);
  const scale = (w * h) / (1440 * 900);
  const layers = [
    { color: "#6E7FA6", r: 0.6, alpha: 0.35, n: Math.round(420 * scale) }, // stars.far
    { color: "#AAB8DD", r: 0.9, alpha: 0.60, n: Math.round(160 * scale) }, // stars.mid
    { color: "#FFFFFF", r: 1.3, alpha: 0.90, n: Math.round(45 * scale) },  // stars.near
  ];
  const sparkles: [number, number][] = [];

  for (let L = 0; L < layers.length; L++) {
    const { color, r, alpha, n } = layers[L];
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();                                 // one path per layer, one fill
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h;
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, Math.PI * 2);
      if (L === 2 && sparkles.length < 4) sparkles.push([x, y]);
    }
    g.fill();
  }

  g.globalAlpha = 0.5;
  g.strokeStyle = "#FFFFFF";
  g.lineWidth = 0.6;
  g.lineCap = "round";
  g.beginPath();
  for (const [x, y] of sparkles) {
    g.moveTo(x - 2.5, y); g.lineTo(x + 2.5, y);
    g.moveTo(x, y - 2.5); g.lineTo(x, y + 2.5);
  }
  g.stroke();
  g.globalAlpha = 1;
}
```

625 arcs in three `fill()` calls cost ~1.5 ms — once, at build time. Per frame they cost nothing because the whole canvas is blitted.

---

## 3. Star

### Why a cached gradient beats per-frame `shadowBlur`
A `shadowBlur` of 40 on a 100 px circle makes the browser allocate a (100 + 2·40·3)² ≈ 340² px scratch surface (at DPR 2: 680²), run a separable Gaussian over it twice, then composite — on the order of **2–5 ms per call** on an integrated GPU, and it repeats every frame for as long as the star is on screen. The same look as a radial gradient rendered once into a 400×400 sprite is one `drawImage` per frame: **~0.05–0.1 ms**, i.e. 30–50× cheaper, and the breathing animation is free because scaling a bitmap costs the same as not scaling it.

### Sprite
400×400 CSS px (×DPR), centre (200, 200). Three concentric radial gradients drawn back to front, exactly as in `design/assets/star.svg`. Stop offsets are fractions of each layer's own radius (0.23 = 46/200, 0.35 = 46/130).

| Layer | Radius | Stops (offset → hex, alpha) |
|---|---|---|
| glow   | 200 | 0.00 `#FF5A1F` α 0.50 · 0.23 `#FF5A1F` α 0.45 · 0.65 `#FF5A1F` α 0.12 · 1.00 `#FF5A1F` α 0 |
| corona | 130 | 0.00 `#FF8C2E` α 0.90 · 0.35 `#FF8C2E` α 0.70 · 0.62 `#FF8C2E` α 0.22 · 1.00 `#FF8C2E` α 0 |
| body   | 46  | 0.00 `#FFF8E1` · 0.55 `#FFC857` · 1.00 `#FF8C2E` |

The SVG softens the corona with a 3 px blur; in Canvas the gradient's own falloff is enough — do not add blur.

```ts
let starSprite: HTMLCanvasElement;

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
              [0.65, rgba("#FF5A1F", 0.12)], [1, rgba("#FF5A1F", 0)]]);     // star.glow
  layer(130, [[0, rgba("#FF8C2E", 0.90)], [0.35, rgba("#FF8C2E", 0.70)],
              [0.62, rgba("#FF8C2E", 0.22)], [1, rgba("#FF8C2E", 0)]]);     // star.corona
  layer(46,  [[0, "#FFF8E1"], [0.55, "#FFC857"], [1, "#FF8C2E"]]);          // core → body → corona
}

// Breathe: ±3 % over 6 s. tMs = performance.now(). Pass the star's screen position and zoom.
function drawStar(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tMs: number): void {
  const breathe = 1 + 0.03 * Math.sin((tMs / 6000) * Math.PI * 2);
  const size = 400 * zoom * breathe;
  ctx.drawImage(starSprite, sx - size / 2, sy - size / 2, size, size);
}
```

The sprite is built for r 46 at zoom 1; `drawImage` scales it for other zooms. If the game ever zooms past 2×, rebuild the sprite at 800 px so the body edge stays crisp.

---

## 4. Planets

### Body gradient
One `createRadialGradient` per body per frame. Gradients are cheap (a few µs to build, a fill that costs the same as a flat fill); what you must not do is blur them.

Light comes from the star. Gradient centre = planet centre + **0.5 · r** along the unit vector toward the star; gradient radius = **1.25 · r**. Stops: 0.00 highlight · 0.42 base · 1.00 shadow. The SVGs (`planet-start.svg`, `planet-x.svg`) encode the same offset per axis as (±0.36 r, ∓0.36 r) — objectBoundingBox `cx/cy` 0.68/0.32 and 0.32/0.68 — i.e. a diagonal of magnitude 0.51 r, which the code rounds to 0.5 r (a 0.3 px difference at r 34). In the mockups both planets happen to sit on a 45° diagonal from the star, so the SVG's fixed diagonal and the code's star-pointing vector coincide.

| Planet | highlight | base | shadow |
|---|---|---|---|
| start | `#9CCBFF` | `#3D8BFF` | `#142B5E` |
| X     | `#B5FFF0` | `#3DE0C2` | `#0E4A40` |

A 1 px limb line (highlight colour, α 0.16 start / 0.18 X, radius r − 0.5) keeps the dark side legible against `bg.base`.

```ts
interface Body { x: number; y: number; r: number }

function drawPlanet(ctx: CanvasRenderingContext2D, p: Body, star: Body, zoom: number,
                    highlight: string, base: string, shadow: string, limbAlpha: number): void {
  const r = p.r * zoom;
  const dx = star.x - p.x, dy = star.y - p.y, d = Math.hypot(dx, dy) || 1;
  const ox = (dx / d) * 0.5 * r, oy = (dy / d) * 0.5 * r;     // offset toward the star (= SVG's 0.36 r per axis)

  const g = ctx.createRadialGradient(p.x + ox, p.y + oy, 0, p.x + ox, p.y + oy, 1.25 * r);
  g.addColorStop(0, highlight);
  g.addColorStop(0.42, base);
  g.addColorStop(1, shadow);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = rgba(highlight, limbAlpha);
  ctx.lineWidth = 1;                                            // screen px, not scaled
  ctx.beginPath(); ctx.arc(p.x, p.y, r - 0.5, 0, Math.PI * 2); ctx.stroke();
}
```

(`p.x`/`p.y` here are already screen coordinates; the §12 camera does world→screen before calling.)

### Planet X halo + capture ring
Halo: radial gradient `#3DE0C2`, radius **1.8 · r** (54 at r 30), α 0.35 from the centre out to the planet's edge (offset 0.556 = 1/1.8), 0.10 at 0.78, 0 at the rim. Draw it before the body.

Ring: radius 78 at zoom 1, `#3DE0C2`, stroke 1.5 px, `setLineDash([6, 6])`. Two motions, both continuous: the dashes **crawl** via `lineDashOffset` at **−12 px/s** (one 12 px dash period per second, so the pattern never jumps), **and** the ring **pulses** over **2.4 s** (sine): α 0.35 ↔ 0.70, radius ±2 px. Together with the star breathe that is the complete motion list in `style.md` §5; nothing else moves on its own. `setLineDash` is cheap, but it is context state: **reset it to `[]`** (and `lineDashOffset` to 0) afterwards or the trail and HUD hairlines will come out dashed.

```ts
function drawPlanetX(ctx: CanvasRenderingContext2D, p: Body, star: Body, zoom: number, tMs: number): void {
  const r = p.r * zoom;
  const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 1.8 * r);
  halo.addColorStop(0, rgba("#3DE0C2", 0.35));
  halo.addColorStop(0.556, rgba("#3DE0C2", 0.35));
  halo.addColorStop(0.78, rgba("#3DE0C2", 0.10));
  halo.addColorStop(1, rgba("#3DE0C2", 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 * r, 0, Math.PI * 2); ctx.fill();

  drawPlanet(ctx, p, star, zoom, "#B5FFF0", "#3DE0C2", "#0E4A40", 0.18);

  const s = Math.sin((tMs / 2400) * Math.PI * 2) * 0.5 + 0.5;  // 0..1 over 2.4 s
  const ringR = 78 * zoom + (s * 2 - 1) * 2;                   // ±2 px (screen px)
  ctx.strokeStyle = rgba("#3DE0C2", 0.35 + s * 0.35);           // α 0.35 → 0.70
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -((tMs / 1000) * 12) % 12;               // dash crawl −12 px/s (one 12 px period per second)
  ctx.beginPath(); ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;                  // always reset
}
```

On the win overlay the pulse and the crawl stop and the ring is drawn at **full α 1.0** (radius 78, `lineDashOffset` 0), as in `result-win.svg` — the one moment the boundary reads as solid.

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
| Star sprite size (400 · zoom · breathe) | All line widths: ring 1.5, trail 2, path dots r 1.5, arrow 2, outline 1 |
| Positions of trail samples, path dots, ship, planets | Dot spacing on the predicted path (10 px) and the 400-dot cap |
| Gradient offsets (0.5 r) and radii (1.25 r) — they are in r | Ring pulse amplitude (±2 px), dash pattern `[6, 6]` and dash crawl (−12 px/s) |
| | Drag arrow (tick at 242 · power from the ship centre), head, tick, label |
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

When zoom changes, nothing needs rebuilding except the star sprite if zoom > 2 (§3). The background does not zoom at all (no parallax in this prototype).

---

## 13. Cheap vs. expensive checklist

| Cheap — use freely | Expensive — avoid or cache |
|---|---|
| `drawImage` of an opaque cached canvas (0.1–0.2 ms full screen) | `shadowBlur` on anything that moves (2–5 ms per call) |
| `createRadialGradient` / `createLinearGradient` per frame (µs) | `ctx.filter = "blur(...)"` (worse than shadowBlur) |
| One `Path2D` with hundreds of arcs + one `fill()` | Hundreds of separate `beginPath/arc/fill` calls with changing `fillStyle` |
| `setLineDash` + `lineDashOffset` (but reset to `[]`) | `getImageData` / `putImageData` anywhere in the loop |
| `globalCompositeOperation = "lighter"` on two small triangles | `"lighter"` over large areas or many layers |
| `fillText` ≤ 10 per frame at integer positions | Measuring and laying out text every frame (`measureText` in a loop) |
| `translate/rotate/scale` + `save/restore` per sprite | Deep `save/restore` nesting; re-setting `font` for every string |
| Opaque context `{ alpha: false }`, DPR capped at 2 | DPR 3 canvases, transparent contexts, `clearRect` + redraw of a static background |
| Rebuilding sprites on resize | Rebuilding sprites per frame, or per zoom tick |
| Ring buffers and `Float32Array` for trail/path | Allocating arrays per frame (GC pauses show up as dropped frames) |

If a frame ever exceeds 6 ms, the order to look at is: (1) a stray `shadowBlur`, (2) the background being redrawn instead of blitted, (3) the trail drawn per segment with 240 strokes, (4) text drawn with letter-spacing fallback per character. Fix in that order; each one alone can double the frame cost.
