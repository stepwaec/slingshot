# Slingshot — Canvas 2D drawing notes (v1.5)

> **Renderer note (v2).** Since WP3 (PR #4) the game draws with an orthographic Three.js scene, not Canvas 2D. These notes remain the pixel-exact reference for how each SVG recipe looks and what it costs; `threejs-notes.md` translates them into the game's `Visual` factories and GLSL.

How to draw every element of the visual style in plain Canvas 2D (TypeScript, no engine) and hold a steady 60 fps on an integrated GPU. Every number below is taken from `design/style.md`, the asset SVGs in `design/assets/` (their header comments are the canon) and the shared brief; every colour is a palette token written as hex. Snippets are valid TypeScript with no imports — `ctx` is always a `CanvasRenderingContext2D`.

**What changed in v1.5 (revised).** The look is now the client-approved reference look (`style.md` §4.1): vivid multi-zone surfaces with crisp thresholds, cloud strips that carry their own cast shadow, a warm terminator band and lit-side haze + rim in every planet's lighting overlay, and a fiery plasma sun with ragged flame rings, a wobbling rim and two-tone prominences. The runtime rules do not change — everything is still cached pixels moved by wall-clock time, 0 `shadowBlur`, 0 per-frame noise, blur or displacement, and composite modes per frame only in the small scratch-buffer cases listed in §0 "The rule" — but the **builds** grow: noise tiles are mapped onto the SVG's own value scale (§4, measured quantile tables) so the SVG slopes apply unchanged, displacement (flames, rim wobble, photon ring) is baked in JavaScript at build time (§3), and the DPR rules tighten (§0, §12). v1.4 adds §2b nebulae, §4c moons and orbits, §4d rings and particles and §4e debris fields.

Sections: §0 frame plan, budget, DPR · §1 background · §2 starfield · §2b nebulae · §3 star (sun construction) · §3b prominences and flare · §3c compact objects · §4 planet sprite pipeline · §4b body library parameters · §4c moons and orbits · §4d rings and particles · §4e debris fields · §5–§11 ship, thrust, trail, path, arrow, HUD, overlays (unchanged) · §12 zoom, scaling and DPR · §13 cheap vs expensive.

Scene reference (world units = screen px at zoom 1, 1440×900): star (760, 470) r 46; start planet (250, 690) r 34; planet X (1190, 210) r 30, capture ring r 78; ship 22 px. **L** is the unit vector from a body toward the scene's star (start planet (+0.7071, −0.7071); planet X (−0.7071, +0.7071); library assets upper-right). `scene-variant`: red dwarf (700, 480), ringed gas giant (1000, 640), moon (420, 300), rocky start (230, 700), X (1210, 190). `scene-blackhole`: black hole (720, 460), ice start (230, 690), moon (900, 250), X (1200, 200). `scene-nebula`: emission nebula behind the left half, asteroid band across the middle, sun (760, 470), Saturn-ringed planet (1040, 650), icy moon (520, 260), ocean start (250, 690), X (1190, 210). `crashRadius` is the solid disc (§4b).

---

## 0. Frame plan & budget

### Device pixel ratio (v1.5 rules)
**Render at `devicePixelRatio`, clamped to [1, 2].** Below 1 (zoomed-out browsers) sprites would be built smaller than their CSS size and look soft; above 2 the fill cost quadruples for no visible gain (a 1440×900 canvas at DPR 3 is 11.7 M pixels per frame). Every cached sprite is built at **its size in CSS px × DPR × the zoom bucket** (§12), so a blit is never a resample of more than the bucket residual. **Never scale a cached sprite above 1.25× its built size — rebuild it instead** (the zoom bucket keeps residuals in 0.894–1.118; a DPR change rebuilds everything). Scaled blits use `imageSmoothingQuality = "high"`.

```ts
let DPR = clampDPR();
function clampDPR(): number { return Math.min(2, Math.max(1, window.devicePixelRatio || 1)); }

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  const ctx = canvas.getContext("2d", { alpha: false })!;   // opaque: cheaper compositing
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);                   // draw in CSS px from here on
  ctx.imageSmoothingEnabled = true;                          // resizing a canvas resets context state,
  ctx.imageSmoothingQuality = "high";                        // so set these here, every time
  return ctx;
}

// Call once at startup. Fires when the window moves to a screen with another DPR (or the browser zoom changes it).
// onChange must refit the canvas and rebuild EVERY cached sprite (background, stars, strips, overlays, rings, rocks, nebulae).
function watchDPR(onChange: () => void): void {
  const listen = (): void => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener("change", () => {
      const d = clampDPR();
      if (d !== DPR) { DPR = d; onChange(); }
      listen();                                              // re-arm for the new resolution
    }, { once: true });
  };
  listen();
}
```

Every offscreen build context that is later scaled also sets `imageSmoothingQuality = "high"` before it draws scaled images (noise tiles stretched into fields, frames rotated into place). `{ alpha: false }` lets the browser skip blending the canvas against the page. Call `fitCanvas` on resize; rebuild the background in the same handler (§1). Body sprites depend on r, L, the zoom bucket and DPR — resize alone leaves them alone; a DPR or bucket change rebuilds them (§12).

### Clear strategy
Do not call `clearRect`. The background layer (§1) is an opaque offscreen canvas that already contains `bg.edge`, the vignette, the Milky Way, the starfield and — when a level has them and they are static — the nebulae and the asteroid dust (§2b, §4e). Blitting it with `drawImage` *is* the clear (~0.2 ms full screen).

### Draw order (back to front, every frame)
The `style.md` §9 order: **starfield → nebulae → debris dust → bodies → rocks → trail / path → ship → HUD**.
1. background (cached: edge + vignette + Milky Way + starfield [+ static nebulae, dark cloud, belt dust]) — one `drawImage`
2. animated nebula layers (two cross-fading sprites, §2b) — only if the level animates them
3. belt dust layer (drifting, §4e) — only if not baked
4. star (§3 / §3b) or compact object (§3c)
5. bodies back to front: ringed planets as back ring → planet → front ring (§4d); moon systems and the double planet with their z-order swaps (§4b, §4c); planet X with its live halo under its strips
6. rocks and wreck pieces (§4e)
7. capture ring (v3.0: the solid target zone, `style.md` §17)
8. predicted path (planning) **or** trail (flight)
9. drag arrow (planning only)
10. thrust flash (flight, `lighter`), then ship
11. HUD
12. result overlay (cached card, faded in) — only when a result exists

**One scene clock.** Every animation reads the same `tS`: seconds since the scene started, accumulated from the frame `dt` clamped to ≤ 0.1 s (a tab switch pauses the sky instead of jumping it), never simulation time (1x / 2x / 4x do not change it). `performance.now()` is used only for `dt`, the result fade-in (§11) and frame timing.

### Per-frame budget (CSS 1440×900, DPR 2, Intel Iris Xe / Apple M-series integrated GPU)

| Layer | Target ms | How it stays there |
|---|---|---|
| Background blit | 0.20 | one opaque `drawImage` (sky, and static nebulae / dust when baked) |
| Animated nebula (§2b, optional) | 0.30 | 3 large sprite blits (layer A, layer B with a `globalAlpha` cross-fade, the static rims / lanes / stars) at a 1 % breathe scale; 0 when baked into the background |
| Star (§3, §3b) | 0.25 | haze sprite (breathing) + per ring 2 rotated frame blits into a small scratch buffer (`lighter` = exact cross-fade) + 1 buffer blit + ≤ 3 prominence blits + ≤ 1 flare blit + 1 disc blit = ≤ 12 draws of cached bitmaps (4 of them into the scratch buffers) |
| Compact object (§3c, in place of the star) | 0.05–0.15 | white dwarf 2, neutron star 3, black hole 5 blits |
| Planets (2, original scene) | 0.18 | per planet 1 clip + 2 strip blits (surface; clouds with their shadow baked) + 1 overlay blit |
| Planet X halo + ring | 0.15 | one live gradient fill + one dashed stroke |
| Library planets (§4b, per body) | 0.08–0.25 | 1 clip + 1–3 strip blits + 1 overlay (+ lava halo, + gas band groups, + cracked night strip) |
| Moons and systems (§4c) | 0.05–0.25 | each moon a small planet; system = planet + 2 moons + 2 orbit-line blits + eclipse discs |
| Ringed planet (§4d) | 0.15–0.30 | planet + ≤ 6 ring blits (Saturn: bands back/front + 2 particle sub-rings × 2 halves) |
| Debris (§4e) | 0.10–0.25 | 1 dust-layer blit + 1 frame blit per small / large rock (26) + 1–2 per wreck piece (≤ 30) + glints |
| Predicted path (≤ 400 dots) **or** trail (≤ 240 segs) | 0.60 | one `Path2D` fill / 20 gradient-chunk strokes |
| Drag arrow | 0.05 | 3 strokes, 1 fill, 1 `fillText` |
| Ship + thrust | 0.10 | 3 small polygons + 2 triangles |
| HUD | 0.60 | ≤ 10 `fillText`, ≤ 6 rounded rects |
| Result overlay | 0.30 | scrim `fillRect` + one `drawImage` |
| **Render total, original scene** | **≈ 2.5 ms** | leaves > 3.5 ms of the 6 ms target for physics and GC |
| Render total, `scene-variant` | ≈ 2.9 ms | red dwarf, ringed giant (2 band strips + 2 ring blits), moon, rocky, X |
| Render total, `scene-nebula` | ≈ 3.6 ms | + animated emission nebula, asteroid belt (dust layer + 26 rocks), Saturn ring (6 ring blits), icy moon |

Target ≤ 6 ms of render per frame. Measure with `performance.now()` around the draw and show it in the telemetry line while developing.

### One-time build costs (not per frame)

Measured in headless Chrome on an Apple M-series CPU at DPR 2 with the snippets below ("warm" = noise tiles already cached; the first build also pays for its tiles):

| Build | ≈ ms (DPR 2) | When |
|---|---|---|
| Background (§1 + §2): 3 band gradients, ~1005 dots, 12 halos, 4 sparkles | 2.5 | resize, DPR change |
| Noise tiles (§0 `makeNoiseTile`), gradient noise, 128²–512² (≥ 2 px per finest lattice cell), 1–6 octaves | 2–25 | once per (type, seed, octaves, cells), kept for the session; build them during the level's fade-in |
| Sun (§3): haze sprite; 3 flame + 3 wisp frames (each: fill + JS displacement + build-time blur); disc sprite (body, plasma zones from 2 fields, limb, JS edge wobble, ragged rim); 3 prominence sprites; 1 flare sprite | ≈ 45 warm, ≈ 105 cold | once per star kind and zoom bucket; spread over several frames (haze + disc + frame 0 first, the boil frames after) or build in a Worker with `OffscreenCanvas` |
| Compact objects (§3c) | 0.3 / 0.3 / ≈ 20 | once per bucket (the black hole's plasma ring sprite and the ragged photon ring cost most) |
| Planet strips + overlay (§4), per planet: 2–4 fields mapped to SVG scale, 4–7 zone passes, caps, cloud + shadow strip, overlay (shade, haze × lit mask, rim × lit mask, glint) | ≈ 10 warm, ≈ 50 cold | per zoom bucket; rebuild one body per frame when a bucket flips |
| Library planets / moons / rings (§4b–§4d) | 5–15 per body warm (gas giants and ringed planets ≈ 15–25) | per zoom bucket, one body per frame |
| Nebula layers (§2b): mask, density, 2 colour layers, rims, lanes, stars at 640 × 400 × DPR | ≈ 150 per nebula | once per level, in idle callbacks or a Worker behind the level's fade-in; baked into the background when static |
| Rock and wreck frames (§4e): 12–36 frames per piece | ≈ 40 for the asteroid field, ≈ 50 for the wreck | once per level and bucket, in idle time |

### Cached offscreen vs. drawn live
| Cached (rebuilt only on resize / DPR / bucket / level change) | Drawn live every frame |
|---|---|
| Background + vignette + Milky Way + starfield (+ static nebulae, dark cloud, belt dust) | Planet X halo (gradient, breathing) and capture ring |
| Star: haze sprite, flame / wisp ring frames, disc sprite, prominence and flare sprites | Their transforms: breathe scale, ring rotations, frame cross-fade alphas, prominence scale / alpha, flare alpha |
| Planet strips (surface; clouds + cast shadow; emissive layers) and lighting overlays | Strip scroll offsets, gas band phases, lava / volcanic pulse alphas |
| Ring band sprites (back with the shadow, front), particle sub-ring sprites, rock clump sprites, orbit-line sprites | Particle / clump rotations and positions, moon positions and z-order, eclipse discs (one tiny gradient sprite) |
| Rock and wreck frames, glint sprite | Frame selection by angle, belt drift, glint alphas |
| Nebula layer sprites | Their `globalAlpha` cross-fade and 1 % breathe |
| Result card 520×232 (+ 64 px shadow margin) | Ring, path, trail, arrow, ship, thrust, HUD, scrim |

### The rule
**Never call `shadowBlur` on moving things**, and never run noise, blur, displacement, `getImageData` or per-pixel loops in the frame loop. They all run inside sprite builds — `ctx.filter = "blur(…)"`, `multiply`, `destination-in`, per-pixel loops over `ImageData` are fine there. Realism comes from richer cached pixels; motion comes from where the cached pixels are drawn. The one permitted `shadowBlur` is the result card (§11), drawn once.

**Composite modes per frame — the explicit, bounded exception (v1.5.1).** The per-frame toolkit is `drawImage`, `clip`, `globalAlpha` and transforms, **plus** `globalCompositeOperation` `"lighter"` or `"destination-in"` used *only* between cached bitmaps inside a **small transparent scratch buffer no larger than the sprite it blends**, or on the two thrust triangles the brief specifies. Never a composite mode over a large area of the main canvas. Each use has a no-composite fallback that draws exactly the SVG:

| Where | Mode, buffer | Why | Cost / frame | Fallback (exactly the SVG) |
|---|---|---|---|---|
| Star flame + wisp boil (§3 `blendRing`) | `"lighter"`, 2 rotated frames into a scratch the size of the ring frame (flame ring r 62, wisp ring r 78 plus the displacement margin, × DPR) | exact linear cross-fade of the optional boil frames (`source-over` dips in alpha) | ≈ 0.06 ms of the star's 0.25 ms | `BOIL = false` → frame 0 rotated, 1 blit per ring |
| Lava emissive (§4b Lighting variants) | `"destination-in"` of the cached limb-mask sprite, into a 2 r scratch disc | the emissive strip scrolls, the limb fade must not | ≈ 0.03 ms of the 0.12 ms | draw the emissive strip straight into the clip with the pulse `globalAlpha` (no scratch, 1 blit); only the limb foreshortening (0.8 r α 1 → r α 0.55) is lost |
| Cracked night cracks (§4b, optional) | `"destination-in"` of the cached dark-half mask, 2 r scratch | as lava | ≈ 0.03 ms | skip the third blit (the lit cracks carry the look) |
| Captured moon tumble (§4c) | `"lighter"`, 2 adjacent lit frames into a 30 × 30 px scratch | exact cross-fade between 10° frames | ≈ 0.01 ms | nearest frame (10° steps, 2 s apart) |
| Tumbling rocks / wreck pieces (§4e `drawTumbler`) | `"lighter"`, 2 adjacent lit frames into a per-rock scratch (≤ 30 px) | as above | ≈ 0.004 ms per blended rock (6 + 9 on screen) | nearest frame (`blend = false`) |
| Thrust flash (§6) | `"lighter"` on the main canvas, two triangles ≤ 40 × 12 px | the brief's hot core over the haze | < 0.01 ms | — (brief-mandated) |

Composite-mode state is always reset to `"source-over"` straight after. Nothing else in the frame loop changes `globalCompositeOperation`.

```ts
// Helpers used by every section.
// rgba(): CSS colour from a hex token + alpha.
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function hexRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const frac = (x: number): number => x - Math.floor(x);
const smoothstep = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// makeCanvas(): an offscreen canvas of w × h CSS px built at DPR (× an optional extra scale), drawing in CSS px.
function makeCanvas(w: number, h: number, scale = 1): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * DPR * scale); c.height = Math.ceil(h * DPR * scale);
  const g = c.getContext("2d")!;
  g.setTransform(DPR * scale, 0, 0, DPR * scale, 0, 0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  return { c, g };
}

// Build-time blur of src into dst (same pixel size): ctx.filter where supported (feature-tested once), else the average
// of 5 offset copies (a plus shape) summed with "lighter" (dst must be a fresh, transparent canvas). Allowed ONLY inside sprite builds (§13).
const CAN_FILTER = ((): boolean => {
  const t = document.createElement("canvas").getContext("2d")!;
  t.filter = "blur(1px)";
  return t.filter === "blur(1px)";
})();
function blurInto(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, sigmaCss: number): void {
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);                              // device px 1 : 1
  if (sigmaCss <= 0) { dst.drawImage(src, 0, 0); dst.restore(); return; }
  if (CAN_FILTER) { dst.filter = `blur(${sigmaCss * DPR}px)`; dst.drawImage(src, 0, 0); }
  else {                                                            // 3 offset copies ≈ a small Gaussian
    const o = sigmaCss * DPR;
    dst.globalCompositeOperation = "lighter"; dst.globalAlpha = 1 / 5;
    for (const [dx, dy] of [[0, 0], [-o, 0], [o, 0], [0, -o], [0, o]] as [number, number][]) dst.drawImage(src, dx, dy);
  }
  dst.restore();
}

// roundRectPath(): rounded-rect path with an arcTo fallback (ctx.roundRect is missing in older engines).
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

### Noise toolkit (build-time; used by §2b, §3, §3c, §4–§4e)

The SVGs threshold Chrome's `feTurbulence` with exact slopes (`alpha = s·n + i`). Canvas has no `feTurbulence`, so it builds seamless **gradient-noise tiles** (Perlin-style, the same family as `feTurbulence`; value noise shows axis-aligned blocks at 6 octaves) and then **maps each field onto the SVG's value scale by quantile**: every pixel's rank in its own field is looked up in a measured quantile table of Chrome's noise (21 points, every 5 %, `color-interpolation-filters="sRGB"`, R channel, 1024² renders, two seeds averaged). After that mapping the header slopes and intercepts apply **unchanged** — that is what keeps the Canvas zones as crisp and as large as the SVG's. Measured: fractal noise has mean 0.50 and σ ≈ 0.117 for 2–6 octaves (σ 0.103 for 1 octave); turbulence (1 octave) has median 0.133 with 10 % of pixels at 0 (the ridges).

```ts
// Quantiles of Chrome's feTurbulence (sRGB filters, R channel) at ranks 0, 0.05, … 1.
const Q_FRACTAL   = [0.037,0.296,0.341,0.371,0.396,0.418,0.437,0.455,0.471,0.486,0.502,0.516,0.531,0.547,0.563,0.582,0.604,0.628,0.659,0.704,0.951]; // 2–6 octaves
const Q_FRACTAL_1 = [0.149,0.322,0.361,0.388,0.412,0.431,0.447,0.463,0.475,0.486,0.502,0.514,0.529,0.541,0.553,0.569,0.588,0.612,0.639,0.675,0.851]; // 1 octave
const Q_TURB_1    = [0,0,0,0.027,0.047,0.063,0.078,0.090,0.110,0.125,0.141,0.161,0.180,0.204,0.231,0.255,0.286,0.325,0.365,0.424,1];            // 1 octave
const Q_TURB_2    = [0,0.059,0.086,0.110,0.129,0.149,0.165,0.184,0.204,0.224,0.243,0.263,0.282,0.306,0.329,0.357,0.384,0.420,0.463,0.522,1];      // 2–3 octaves
const Q_TURB_4    = [0,0.114,0.145,0.169,0.192,0.212,0.229,0.249,0.267,0.284,0.304,0.324,0.345,0.367,0.390,0.418,0.449,0.484,0.525,0.584,0.959];  // 4–6 octaves

interface NoiseDef { type: "fractal" | "turbulence"; f: number | [number, number]; octaves: number; seed: number }

function quantileTable(n: NoiseDef): number[] {
  if (n.type === "fractal") return n.octaves <= 1 ? Q_FRACTAL_1 : Q_FRACTAL;
  return n.octaves <= 1 ? Q_TURB_1 : n.octaves <= 3 ? Q_TURB_2 : Q_TURB_4;
}

// Seamless gradient-noise tile (Perlin-style, like feTurbulence), size px square. cellsX × cellsY lattice cells at octave 0,
// doubling per octave; the lattice wraps, so the tile repeats seamlessly in x and y. ridged = true gives the turbulence form
// (sum of |noise|, ridges at 0); otherwise the fractal form (sum of noise). Raw values: svgField() maps them by rank anyway.
function makeNoiseTile(size: number, seed: number, octaves: number, cellsX: number, cellsY: number, ridged = false): HTMLCanvasElement {
  const rnd = mulberry32(seed);                                       // §2
  const gx: Float32Array[] = [], gy: Float32Array[] = [];
  for (let o = 0; o < octaves; o++) {                                 // one random unit gradient per lattice point
    const nx = cellsX << o, ny = cellsY << o, ax = new Float32Array(nx * ny), ay = new Float32Array(nx * ny);
    for (let i = 0; i < nx * ny; i++) { const a = rnd() * Math.PI * 2; ax[i] = Math.cos(a); ay[i] = Math.sin(a); }
    gx.push(ax); gy.push(ay);
  }
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const vals = new Float32Array(size * size);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 1;
    for (let o = 0; o < octaves; o++) {
      const nx = cellsX << o, ny = cellsY << o, ax = gx[o], ay = gy[o];
      const fx = (x / size) * nx, fy = (y / size) * ny;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
      const i00 = y0 * nx + x0, i10 = y0 * nx + (x0 + 1) % nx, i01 = ((y0 + 1) % ny) * nx + x0, i11 = ((y0 + 1) % ny) * nx + (x0 + 1) % nx;
      const d00 = ax[i00] * dx + ay[i00] * dy,       d10 = ax[i10] * (dx - 1) + ay[i10] * dy;
      const d01 = ax[i01] * dx + ay[i01] * (dy - 1), d11 = ax[i11] * (dx - 1) + ay[i11] * (dy - 1);
      const u = fade(dx), w = fade(dy);
      const top = d00 + (d10 - d00) * u, bot = d01 + (d11 - d01) * u;
      const s = top + (bot - top) * w;                                // ≈ −0.7 … 0.7
      v += amp * (ridged ? Math.abs(s) : s); amp *= 0.5;
    }
    vals[y * size + x] = v; if (v < lo) lo = v; if (v > hi) hi = v;
  }
  const img = new ImageData(size, size), d = img.data;
  for (let i = 0; i < vals.length; i++) {                             // normalise to 0..255 (ranks are what matter)
    const k = Math.round(((vals[i] - lo) / (hi - lo || 1)) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = k; d[i * 4 + 3] = 255;
  }
  const tile = document.createElement("canvas"); tile.width = tile.height = size;
  tile.getContext("2d")!.putImageData(img, 0, 0);
  return tile;
}

// Tile size: ≥ 2 px per finest lattice cell (no aliasing into blocks), 128 … 512 px.
const tileSize = (cells: number, octaves: number): number =>
  Math.min(512, Math.max(128, 1 << Math.ceil(Math.log2(2 * cells * (1 << (octaves - 1))))));

const noiseTiles = new Map<string, HTMLCanvasElement>();             // kept for the session
function tileFor(n: NoiseDef, cellsX: number, cellsY: number): HTMLCanvasElement {
  const key = `${n.type}/${n.seed}/${n.octaves}/${cellsX}/${cellsY}`;
  let t = noiseTiles.get(key);
  if (!t) {
    t = makeNoiseTile(tileSize(Math.max(cellsX, cellsY), n.octaves), n.seed, n.octaves, cellsX, cellsY, n.type === "turbulence");
    noiseTiles.set(key, t);
  }
  return t;
}

// A W × H DEVICE-px field on the SVG value scale. periodX: the width in device px over which the field must repeat
// (a strip's tile width W for planets; 0 = no constraint, e.g. star discs and rocks). zoomDpr = CSS → device px factor.
function svgField(n: NoiseDef, W: number, H: number, periodX: number, zoomDpr: number): Float32Array {
  const [fx, fy] = typeof n.f === "number" ? [n.f, n.f] : n.f;
  // Strips (periodX > 0): round(P·fx) cells across the period and round(2r·fy) down the height — exactly like stitchTiles,
  // which makes the SVG tile periodic in both directions. Free fields (star discs, rocks, nebulae): 8 × 8 cells.
  const cellsX = periodX > 0 ? Math.max(1, Math.round((periodX / zoomDpr) * fx)) : 8;
  const cellsY = periodX > 0 ? Math.max(1, Math.round((H / zoomDpr) * fy)) : 8;
  const tile = tileFor(n, cellsX, cellsY);
  const spanX = periodX > 0 ? periodX : (cellsX / fx) * zoomDpr;    // device px covered by one tile, along x …
  const spanY = periodX > 0 ? H : (cellsY / fy) * zoomDpr;          // … and along y (anisotropic f stretches y)
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.scale(spanX / tile.width, spanY / tile.height);
  g.fillStyle = g.createPattern(tile, "repeat")!;                     // a pattern wraps at the tile edge (no seam)
  g.fillRect(0, 0, (W * tile.width) / spanX + 1, (H * tile.height) / spanY + 1);
  const px = g.getImageData(0, 0, W, H).data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
  const cdf = new Float32Array(256);                                  // mid-rank of each grey level
  for (let v = 0, acc = 0, N = W * H; v < 256; v++) { cdf[v] = (acc + hist[v] / 2) / N; acc += hist[v]; }
  const q = quantileTable(n), out = new Float32Array(W * H);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const p = cdf[px[i]] * 20, k = Math.min(19, Math.floor(p));
    out[j] = q[k] + (q[k + 1] - q[k]) * (p - k);
  }
  return out;
}

// Zone alpha exactly as the SVG writes it.
const ramp = (n: number, slope: number, intercept: number): number => clamp01(slope * n + intercept);   // feFuncA linear
const contour = (n: number, level: number, half: number): number => clamp01(1 - Math.abs(n - level) / half);  // iso-line table

// feDisplacementMap at build time: out(x, y) = src(x + s·(mx − 0.5), y + s·(my − 0.5)), bilinear. s is in DEVICE px
// (= the SVG's scale × zoom bucket × DPR). mx / my: svgField()s (src-sized) of two OPAQUE fractal fields — the SVG forces
// the noise alpha to 1 before feDisplacementMap, so the map never collapses at transparent pixels.
function displaceCanvas(src: HTMLCanvasElement, s: number, mx: Float32Array, my: Float32Array): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const a = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const out = new ImageData(W, H), o = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x;
    const sx = x + s * (mx[j] - 0.5), sy = y + s * (my[j] - 0.5);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
    if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) continue;   // outside the source: transparent (the sprites are padded)
    const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    for (let ch = 0; ch < 4; ch++) o[j * 4 + ch] = a[i00 + ch] * w00 + a[i10 + ch] * w10 + a[i01 + ch] * w01 + a[i11 + ch] * w11;
  }
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}
```

Two notes. The SVG's displacement maps use the R and G channels of **one** turbulence; Canvas uses two fields with seeds `seed` and `seed + 1` — statistically the same. And the Canvas noise is its own pattern: shapes will not match the SVG pixel for pixel, but sizes, coverage, edge width and colour do, because the frequencies, octaves, quantiles and slopes are the SVG's. Compare against renders of the assets, not dot for dot.

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

## 2b. Nebulae (v1.4)

Three background-pass assets (`design/assets/space/nebula-emission.svg`, `nebula-reflection.svg`, `nebula-dark.svg`; tokens and construction in `style.md` §9). They sit **between the starfield and the bodies**. Each is built once per level into cached sprites at its CSS size × DPR (640 × 400 / 640 × 400 / 480 × 320 → 1280 × 800 at DPR 2) with per-pixel loops over `svgField`s — ≈ 150 ms per nebula (four million-pixel fields), done in idle callbacks or a Worker behind the level's fade-in, never in a frame. Gas stays soft (it is gas); only the rims, filament edges and lanes are crisp.

**Two modes.** *Static* (default on low-end machines, and for the dark cloud): bake every sprite into the background canvas at t = 0 — **0 blits per frame**. *Animated*: blit layer A and layer B with the 40 s cross-fade and the static sprite (rims, lanes, stars) on top, all at the 30 s, 1 % breathe scale — **3 blits per frame** (the dark cloud: 1). The breathe and cross-fade are so slow that the static mode loses almost nothing.

| Nebula | Sprites | Per-pixel recipe (SVG scale; `d` = density) | Motion |
|---|---|---|---|
| Emission (`ne*`) | A, B (violet + rose), S (rims, lanes, stars) | mask m = 4 ellipses (cx cy rx ry rot: (−95 −5 200 135 −12) (75 25 175 120 18) (150 −70 120 85 0) (−175 65 125 80 0)) filled with a white radial (0 α 1 · 0.5 α 0.65 · 1 α 0), displaced by the big noise (scale 60), blur 1. n = 0.6 big + 0.4 fine (big fractal 0.006 / 4 oct / seed 5; fine 0.012 / 4 oct / seed 11 for A, 17 for B), d = clamp(2.2 n − 0.75) · m. Violet `#B48CFF` α 0.16·smoothstep(0.00, 0.40, d), then rose `#E0566F` α 0.22·smoothstep(0.28, 0.65, d) over it. S: D = smoothstep(0.24, 0.27, d of layer A) → blur 0.5 → rim = D · (1 − blur(D, 2.2)) · clamp(3.5 g − 1.45) (g = fractal 0.02 / 3 oct / seed 3), `#FF9DB0` α 0.5, × the star-light mask (α 0.12 floor + white radial pools 0 α 1 · 0.45 α 0.75 · 1 α 0 of r 150 / 170 / 80 at (−150, −22), (42, −38), (168, −82); v1.5.1, was α 0.75 everywhere); lanes = clamp(1 − 5 R) (R = turbulence `0.006 0.024` / 4 oct / seed 27) × the lane mask (white radial 1 · 0.6 α 0.7 · 1 α 0 in a 520 × 180 rect at (40, 12) rotated 20°), `#050710` × 0.35; 8 stars (`style.md` §9) with halos r 4.5 (two r 7 with spikes) | A α = 1 − 0.4·hump(t / 40), B α = 0.6 + 0.4·hump(t / 40); breathe 1 + 0.01·hump(t / 30) |
| Reflection (`nr*`) | A, B (blue + pale), S (filament edges, star, small stars) | 11 teardrop fans about the star at (−110, 10) (rot, length, width): (−75 210 158) (−50 245 184) (−25 370 210) (0 380 210) (25 315 210) (50 220 165) (75 190 142) (115 170 160) (155 160 150) (−155 160 150) (−115 170 160); each fan's mask = radial teardrop (focus 0.04 at the star end: 0 α 0.9 · 0.4 α 0.45 · 1 α 0) and its **own** noise, stretched along the fan (rotate the field with the fan: build the fan's field in fan space and draw it rotated). n = 0.55 big + 0.45 fine (big `0.004 0.02` / 5 oct / seed 7; fine `0.008 0.045` / 4 oct / seed 11 A, 19 B), d = clamp(2.6 n − 0.9) · mask. Blue `#5EA0FF` α 0.16·smoothstep(0.03, 0.45, d), pale `#B8CCFF` α 0.14·smoothstep(0.40, 0.75, d). S: D = smoothstep(0.52, 0.58, clamp(2.6 n − 0.9)) → blur 0.5 → edge = D · (1 − blur(D, 2)), `#DCE4FF` α 0.35 × the fan masks; star halo r 26 (0 `#FFFFFF` α 0.85 · 0.08 `#B8CCFF` α 0.55 · 0.35 α 0.16 · 1 α 0), core r 2.2, spikes 18 px α 0.55 + diagonals 8 px α 0.3; 5 small stars | as emission; the star does not breathe |
| Dark (`nd*`) | one sprite | 8 black radial ellipses (0 α 1 · 0.35 α 0.75 · 1 α 0) displaced by fractal 0.012 / 4 oct / seed 31 (scale 64), blur 0.8, × clumps (0.15 + 1.8 R, R = fractal 0.035 / 5 oct / seed 37) = m. Body `#000000` α 0.85·smoothstep(0.03, 0.75, m). S = smoothstep(0.07, 0.10, m) → blur 0.5; rim = S · (1 − S shifted (−1.6, +1.6)) `#FFD9B0` α 0.25; inner glow = blur(S · (1 − S shifted (−9, +9)), 3) · S `#FFD9B0` α 0.07; tail = blur(S shifted (−20, +20), 12) × clumps `#000000` α 0.55. Order: tail → body → glow → rim | breathe 1 % / 30 s (or static); drawn **over** the stars it hides |

`hump(u) = sin²(π u)` is the eased 0 → 1 → 0 the SVG's splines describe (§3b). "Shifted (dx, dy)" means the image moved by (dx, dy): `out(x, y) = S(x − dx, y − dy)`.

```ts
interface NebulaSprites { A: HTMLCanvasElement; B: HTMLCanvasElement | null; S: HTMLCanvasElement | null; w: number; h: number }

// Composite two straight-alpha tinted layers into one RGBA ImageData (lower first), as feMerge does.
function paintTwoTone(W: number, H: number, lo: string, aLo: Float32Array, hi: string, aHi: Float32Array): ImageData {
  const img = new ImageData(W, H), o = img.data, [r1, g1, b1] = hexRGB(lo), [r2, g2, b2] = hexRGB(hi);
  for (let j = 0; j < W * H; j++) {
    const a1 = aLo[j], a2 = aHi[j], a = a2 + a1 * (1 - a2);
    if (a <= 0) continue;
    const w1 = (a1 * (1 - a2)) / a, w2 = a2 / a;
    o[j * 4] = r1 * w1 + r2 * w2; o[j * 4 + 1] = g1 * w1 + g2 * w2; o[j * 4 + 2] = b1 * w1 + b2 * w2; o[j * 4 + 3] = a * 255;
  }
  return img;
}

// Emission-nebula layer (A: fineSeed 11, B: 17). mask = the displaced, blurred ellipse mask as a W × H alpha field (0..1).
function emissionLayer(W: number, H: number, mask: Float32Array, fineSeed: number): { img: ImageData; d: Float32Array } {
  const big  = svgField({ type: "fractal", f: 0.006, octaves: 4, seed: 5 }, W, H, 0, DPR);
  const fine = svgField({ type: "fractal", f: 0.012, octaves: 4, seed: fineSeed }, W, H, 0, DPR);
  const d = new Float32Array(W * H), av = new Float32Array(W * H), ar = new Float32Array(W * H);
  for (let j = 0; j < d.length; j++) {
    d[j] = clamp01(2.2 * (0.6 * big[j] + 0.4 * fine[j]) - 0.75) * mask[j];
    av[j] = 0.16 * smoothstep(0.02, 0.40, d[j]);          // neb.emission.edge #B48CFF
    ar[j] = 0.22 * smoothstep(0.28, 0.62, d[j]);          // neb.emission.core #E0566F
  }
  return { img: paintTwoTone(W, H, "#B48CFF", av, "#E0566F", ar), d };
}

// Per frame (animated mode). The sprites are centred on the nebula's group origin; sx, sy = its screen position.
const hump = (u: number): number => { const s = Math.sin(Math.PI * u); return s * s; };
function drawNebula(ctx: CanvasRenderingContext2D, n: NebulaSprites, sx: number, sy: number, zoom: number, tS: number): void {
  const s = zoom * (1 + 0.01 * hump(frac(tS / 30)));      // 1 % breathe over 30 s
  const w = n.w * s, h = n.h * s, x = sx - w / 2, y = sy - h / 2;
  const x40 = hump(frac(tS / 40));
  ctx.globalAlpha = 1 - 0.4 * x40;  ctx.drawImage(n.A, x, y, w, h);              // layer A 1 → 0.6 → 1
  if (n.B) { ctx.globalAlpha = 0.6 + 0.4 * x40; ctx.drawImage(n.B, x, y, w, h); } // layer B 0.6 → 1 → 0.6
  ctx.globalAlpha = 1;
  if (n.S) ctx.drawImage(n.S, x, y, w, h);                                       // rims, lanes, stars
}
```

The layers are drawn `source-over` (as in the SVG): drawing A at α a and B at α b is not an exact linear blend, but both layers share the big noise, so they agree on every large shape and only the fine structure morphs — exactly the "two noise layers cross-fading" the brief describes. Zoom: in static mode the nebulae are part of the screen-space background, which never zooms (no parallax, like the starfield). In animated mode they are world objects and follow the §12 bucket rule like every other sprite: rebuild rather than scale beyond 1.25× (the 1 px rims are what would soften first). Gameplay hooks (drag zones) are **not in scope** (`style.md` §9).

---

## 3. Star (v1.5: the sun reference, baked into cached sprites)

### Why cached sprites beat per-frame effects
A `shadowBlur` of 40 on a 100 px circle costs 2–5 ms per call on an integrated GPU, every frame; an SVG-style displacement filter in Canvas would have to be a per-pixel JavaScript loop. The v1.5 sun is richer than v1.1's — ragged flames, a plasma surface, a wobbling rim — but all of it is computed **once** into bitmaps and the frame only moves them: a scale (breathe), two rotations (flame and wisp rings), a cross-fade, and the prominence / flare transforms. Per frame ≤ 12 small draws, ≈ 0.25 ms.

### Construction (from `star.svg` = the approved `star-ref.svg`, variant J)

| # | Layer | Sprite | Built from | Per frame |
|---|---|---|---|---|
| 1 | haze r 200 | **haze** (S = 2 · hazeR = 400 / 360 / 480 CSS px) | radial gradient (`style.md` §2 table) | scaled by the breathe ±3 % / 6 s |
| 2 | wisp ring r 78 | **wisp frames** × 3 (≈ 196 px) | disc r 78 filled solid to the centre with the wisp gradient → `displaceCanvas` (fractal 0.05, 5 oct, seed 33 / 34, scale 34) → build-time blur 0.8 | rotated −2π t / 300 s; 2 adjacent frames blended (boil); inside the breathe |
| 3 | flame ring r 62 | **flame frames** × 3 (≈ 150 px) | disc r 62 solid with the flame gradient → displace (fractal 0.08, 4 oct, seed 21 / 22, scale 20) → blur 0.4 | rotated +2π t / 200 s; blended; inside the breathe |
| 4 | 3 prominences | **loop sprites** × 3 (§3b) | two-tone strokes, no blur | scale 0.6 → 1 → 0.6, α 0 → 1 → 0 about the base point |
| 5 | flare | **flare sprite** (§3b) | wedge with its gradient | α 0 → 1 → 0 at 13.0 / 13.9 / 14.8 s of 22 |
| 6–7 | disc: body + plasma + limb, edge wobble, ragged rim | **disc** (≈ 2 · (r + 6) px) | body gradient → plasma zones (dark cells + filaments) composited per pixel → limb gradient → `displaceCanvas` of the whole disc (fractal 0.11, 3 oct, seed 44, scale 6.5, no blur) → ragged rim stroke displaced (fractal 0.22, 2 oct, seed 57, scale 5) and blurred 0.35 | static: **never breathes** (the crash disc never moves) |

**Flame frames are rigid, the SVG's own motion is rotation.** In the SVG the displacement filter lives inside the rotating group, so the noise turns with the ring — the ragged edge does not change shape, it rotates. Frame 0 (seed as in the header) reproduces that exactly. Frames 1 and 2 (seeds + 101 / + 202, same frequency, octaves and scale) are **optional "boil"**: two adjacent frames are blended so the ragged edge slowly re-forms while it rotates — the brief's "2–3 rotating sprite frames, cross-faded". A plain `source-over` cross-fade of two semi-transparent sprites dips in alpha mid-way; summing the two with weights w and 1 − w under `"lighter"` into a small **transparent scratch buffer** is an exact linear blend of premultiplied colour, so the buffer is cleared, the two rotated frames are added, and the buffer is blitted. Boil cycle 36 s (12 s per frame); set `BOIL = false` to draw frame 0 only (1 blit per ring, exactly the SVG).

**Plasma surface, tinted.** Dark cells and filaments are tinted per pixel — never a grey `multiply` (the v1.1 granulation is gone): dark = `ramp(n, 3.4, −1.6) × 0.55` in `#802105` from fractal 0.05 / 5 oct / seed 4; filaments = `ramp(t, −6.5, 1.25) × 0.85` in `#FFE7A0` from turbulence 0.06 / 5 oct / seed 9 (both via `svgField`, so the alpha formulas are the header's). Red dwarf and blue giant swap in their own fields, colours and caps (table below).

### Spec

```ts
interface Ring { r: number; stops: [number, string, number][]; noise: NoiseDef; scale: number; blur: number; period: number } // period: +CW / −CCW s per turn
interface Plasma { dark: NoiseDef; darkColor: string; darkSlope: number; darkIntercept: number; darkCap: number;
                   fil: NoiseDef; filColor: string; filCap: number }                 // filament alpha = 1.25 − 6.5 t
interface LoopSpec { A: number; x0: number; y0: number; cx: number; cy: number; dur: number; begin: number } // path M x0 −y0 C cx −cy cx cy x0 y0
interface StarSpec {
  r: number; crashRadius: number; hazeR: number;
  haze: [number, string, number][]; wisp: Ring; flame: Ring;
  body: [number, string][]; plasma: Plasma; limb: [number, string, number][];
  edge: { f: number; seed: number; scale: number };                                   // 3 octaves, no blur
  rim: { r: number; color: string; width: number; f: number; seed: number; scale: number };   // 2 octaves, blur 0.35, α 0.75
  prom: { outer: string; outerW: number; inner: string; innerW: number; loops: LoopSpec[] };
  flare: { A: number; x0: number; x1: number; hw: number; tip: string };              // wedge M x0 −hw L x1 0 L x0 hw, #FFFFFF → tip α 0.15
}

const SUN: StarSpec = {
  r: 46, crashRadius: 46, hazeR: 200,
  haze: [[0, "#FF7A2A", 0.6], [0.23, "#FF7A2A", 0.52], [0.33, "#E8461A", 0.3], [0.55, "#A8240E", 0.15], [0.8, "#6A1408", 0.06], [1, "#6A1408", 0]],
  wisp:  { r: 78, stops: [[0, "#FFB347", 0.55], [0.62, "#FFB347", 0.55], [0.8, "#FF6A1A", 0.22], [1, "#E8461A", 0]],
           noise: { type: "fractal", f: 0.05, octaves: 5, seed: 33 }, scale: 34, blur: 0.8, period: -300 },
  flame: { r: 62, stops: [[0, "#FFE7A0", 0.95], [0.74, "#FFE7A0", 0.95], [0.82, "#FFB347", 0.8], [0.91, "#FF6A1A", 0.38], [1, "#FF5A1F", 0]],
           noise: { type: "fractal", f: 0.08, octaves: 4, seed: 21 }, scale: 20, blur: 0.4, period: 200 },
  body: [[0, "#FFB43A"], [0.65, "#FF8F1F"], [1, "#FF7A14"]],
  plasma: { dark: { type: "fractal", f: 0.05, octaves: 5, seed: 4 }, darkColor: "#802105", darkSlope: 3.4, darkIntercept: -1.6, darkCap: 0.55,
            fil: { type: "turbulence", f: 0.06, octaves: 5, seed: 9 }, filColor: "#FFE7A0", filCap: 0.85 },
  limb: [[0.8, "#FFD27A", 0], [0.93, "#FFD27A", 0.55], [0.97, "#FFF1C2", 0.9], [1, "#FFFFFF", 0.95]],
  edge: { f: 0.11, seed: 44, scale: 6.5 },
  rim: { r: 46.2, color: "#FFF1C2", width: 1.6, f: 0.22, seed: 57, scale: 5 },
  prom: { outer: "#FF8C2E", outerW: 2.8, inner: "#FFF1C2", innerW: 1, loops: [
    { A: 147.5, x0: -0.9, y0: 9,   cx: 21,   cy: 7.2, dur: 12, begin: 0 },
    { A: 243.6, x0: -1.3, y0: 11,  cx: 23.5, cy: 9,   dur: 16, begin: 5 },
    { A: 314.8, x0: -0.8, y0: 8.5, cx: 29,   cy: 6.8, dur: 14, begin: 9 } ] },
  flare: { A: 25, x0: 46, x1: 86, hw: 1.8, tip: "#FFD27A" },
};

const RED_DWARF: StarSpec = {
  r: 40, crashRadius: 40, hazeR: 180,
  haze: [[0, "#F0502A", 0.6], [0.23, "#F0502A", 0.5], [0.33, "#C8301C", 0.3], [0.55, "#8C1E2A", 0.15], [0.8, "#4E0C16", 0.06], [1, "#4E0C16", 0]],
  wisp:  { r: 67.8, stops: [[0, "#FF6A3A", 0.5], [0.62, "#FF6A3A", 0.5], [0.8, "#E0432F", 0.22], [1, "#A8240E", 0]],
           noise: { type: "fractal", f: 0.05, octaves: 5, seed: 37 }, scale: 24, blur: 0.8, period: -390 },
  flame: { r: 53.9, stops: [[0, "#FFB27A", 0.92], [0.74, "#FFB27A", 0.92], [0.82, "#FF6A3A", 0.78], [0.91, "#E0432F", 0.36], [1, "#B0281A", 0]],
           noise: { type: "fractal", f: 0.08, octaves: 4, seed: 25 }, scale: 14, blur: 0.4, period: 260 },
  body: [[0, "#FF8A4A"], [0.65, "#F0502A"], [1, "#D63A1E"]],
  plasma: { dark: { type: "fractal", f: 0.032, octaves: 5, seed: 8 }, darkColor: "#4A0A06", darkSlope: 4, darkIntercept: -1.6, darkCap: 0.55,
            fil: { type: "turbulence", f: 0.05, octaves: 5, seed: 13 }, filColor: "#FFB36B", filCap: 0.8 },
  limb: [[0.8, "#FF9A6E", 0], [0.93, "#FF9A6E", 0.55], [0.97, "#FFD9B0", 0.9], [1, "#FFEBDA", 0.95]],
  edge: { f: 0.11, seed: 46, scale: 5 },
  rim: { r: 40.2, color: "#FFD9B0", width: 1.4, f: 0.22, seed: 59, scale: 4.2 },
  prom: { outer: "#E0432F", outerW: 2.4, inner: "#FFD9B0", innerW: 0.9, loops: [
    { A: 338.8, x0: -1.18, y0: 10.13, cx: 25.11, cy: 8.1,  dur: 12, begin: 0 },
    { A: 248,   x0: -0.68, y0: 7.72,  cx: 26.06, cy: 6.18, dur: 16, begin: 5 },
    { A: 167.2, x0: -0.81, y0: 8.4,   cx: 22.45, cy: 6.72, dur: 14, begin: 9 } ] },
  flare: { A: 117.9, x0: 40, x1: 74.8, hw: 1.55, tip: "#FFD9B0" },
};

const BLUE_GIANT: StarSpec = {
  r: 54, crashRadius: 54, hazeR: 240,
  haze: [[0, "#5E9BFF", 0.55], [0.23, "#5E9BFF", 0.48], [0.33, "#3A6AF0", 0.3], [0.55, "#2C4FBF", 0.14], [0.8, "#15287A", 0.05], [1, "#15287A", 0]],
  wisp:  { r: 91.6, stops: [[0, "#7FB2FF", 0.55], [0.62, "#7FB2FF", 0.55], [0.8, "#4F8DFF", 0.24], [1, "#3A6AF0", 0]],
           noise: { type: "fractal", f: 0.065, octaves: 6, seed: 39 }, scale: 40, blur: 0.8, period: -300 },
  flame: { r: 72.8, stops: [[0, "#F4F8FF", 0.95], [0.74, "#F4F8FF", 0.95], [0.8, "#A9C8FF", 0.85], [0.9, "#4F8DFF", 0.45], [1, "#2C4FBF", 0]],
           noise: { type: "fractal", f: 0.1, octaves: 5, seed: 27 }, scale: 24, blur: 0.4, period: 200 },
  body: [[0, "#EAF1FF"], [0.65, "#A6C0FF"], [1, "#7FA3FF"]],
  plasma: { dark: { type: "fractal", f: 0.08, octaves: 5, seed: 6 }, darkColor: "#2F5BD8", darkSlope: 3.4, darkIntercept: -1.6, darkCap: 0.45,
            fil: { type: "turbulence", f: 0.1, octaves: 5, seed: 15 }, filColor: "#FFFFFF", filCap: 0.9 },
  limb: [[0.8, "#CFE0FF", 0], [0.93, "#CFE0FF", 0.55], [0.97, "#F4F8FF", 0.9], [1, "#FFFFFF", 0.95]],
  edge: { f: 0.13, seed: 48, scale: 7 },
  rim: { r: 54.2, color: "#F4F8FF", width: 1.8, f: 0.26, seed: 61, scale: 5.5 },
  prom: { outer: "#5EA0FF", outerW: 3.2, inner: "#F4F8FF", innerW: 1.15, loops: [
    { A: 332.7, x0: -1.06, y0: 11.17, cx: 26.44, cy: 8.93,  dur: 12, begin: 0 },
    { A: 243.5, x0: -1.19, y0: 11.81, cx: 25.25, cy: 9.45,  dur: 16, begin: 5 },
    { A: 168.7, x0: -1.64, y0: 13.86, cx: 31.21, cy: 11.09, dur: 14, begin: 9 } ] },
  flare: { A: 278.3, x0: 54, x1: 101, hw: 2.1, tip: "#B8CCFF" },
};
```

### Builds

```ts
const BOIL = true;                                   // false = 1 rigid frame per ring (exactly the SVG)
const BOIL_PERIOD = 36;                              // s for a full A → B → C → A cycle (12 s per frame)

function radialDisc(g: CanvasRenderingContext2D, c: number, r: number, stops: [number, string, number][]): void {
  const gr = g.createRadialGradient(c, c, 0, c, c, r);
  for (const [o, col, a] of stops) gr.addColorStop(o, rgba(col, a));
  g.fillStyle = gr; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
}

// One displaced ring frame. zb = zoom bucket (§12). Returns a square canvas, side S CSS px (× zb × DPR).
function buildRingFrame(ring: Ring, frame: number, zb: number): { canvas: HTMLCanvasElement; S: number } {
  const S = Math.ceil(2 * (ring.r + ring.scale / 2 + 4)), c = S / 2;
  const { c: disc, g } = makeCanvas(S, S, zb);
  radialDisc(g, c, ring.r, ring.stops);                                     // filled SOLID to the centre (no annulus gaps)
  const W = disc.width, H = disc.height, k = zb * DPR;
  const seed = ring.noise.seed + 101 * frame;
  const mx = svgField({ ...ring.noise, seed },     W, H, 0, k);             // two opaque fractal maps (R / G)
  const my = svgField({ ...ring.noise, seed: seed + 1 }, W, H, 0, k);
  const shaped = displaceCanvas(disc, ring.scale * k, mx, my);              // ragged outer edge, never a gap
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  blurInto(out.getContext("2d")!, shaped, ring.blur * zb);                  // flame softness: 0.4 / 0.8, as the reference
  return { canvas: out, S };
}

// The static disc: body + tinted plasma + limb, displaced as a whole (edge wobble), then the ragged rim on top.
function buildStarDisc(star: StarSpec, zb: number): { canvas: HTMLCanvasElement; S: number } {
  const S = Math.ceil(2 * (star.r + star.edge.scale / 2 + star.rim.scale / 2 + 3)), c = S / 2;
  const { c: cv, g } = makeCanvas(S, S, zb);
  const gb = g.createRadialGradient(c, c, 0, c, c, star.r);
  for (const [o, col] of star.body) gb.addColorStop(o, col);
  g.fillStyle = gb; g.beginPath(); g.arc(c, c, star.r, 0, Math.PI * 2); g.fill();

  const W = cv.width, H = cv.height, k = zb * DPR, p = star.plasma;          // plasma zones, per pixel, tinted
  const dn = svgField(p.dark, W, H, 0, k), tn = svgField(p.fil, W, H, 0, k);
  const img = cv.getContext("2d")!.getImageData(0, 0, W, H), d = img.data;
  const [dr, dg, db] = hexRGB(p.darkColor), [fr, fg, fb] = hexRGB(p.filColor);
  for (let j = 0; j < W * H; j++) {
    if (d[j * 4 + 3] === 0) continue;                                       // outside the disc (composited IN the body)
    const ad = ramp(dn[j], p.darkSlope, p.darkIntercept) * p.darkCap;       // darker cells, capped = "less dark"
    const af = ramp(tn[j], -6.5, 1.25) * p.filCap;                          // bright filaments: 1.25 − 6.5 t
    d[j * 4] += (dr - d[j * 4]) * ad; d[j * 4 + 1] += (dg - d[j * 4 + 1]) * ad; d[j * 4 + 2] += (db - d[j * 4 + 2]) * ad;
    d[j * 4] += (fr - d[j * 4]) * af; d[j * 4 + 1] += (fg - d[j * 4 + 1]) * af; d[j * 4 + 2] += (fb - d[j * 4 + 2]) * af;
  }
  cv.getContext("2d")!.putImageData(img, 0, 0);
  radialDisc(g, c, star.r, star.limb);                                      // bright limb 0.80 → 1.00

  const em = (seed: number): Float32Array => svgField({ type: "fractal", f: star.edge.f, octaves: 3, seed }, W, H, 0, k);
  const wobbled = displaceCanvas(cv, star.edge.scale * k, em(star.edge.seed), em(star.edge.seed + 1));   // not perfectly round

  const { c: rimC, g: rg } = makeCanvas(S, S, zb);                          // ragged rim stroke
  rg.strokeStyle = rgba(star.rim.color, 0.75); rg.lineWidth = star.rim.width;
  rg.beginPath(); rg.arc(c, c, star.rim.r, 0, Math.PI * 2); rg.stroke();
  const rm = (seed: number): Float32Array => svgField({ type: "fractal", f: star.rim.f, octaves: 2, seed }, W, H, 0, k);
  const ragged = displaceCanvas(rimC, star.rim.scale * k, rm(star.rim.seed), rm(star.rim.seed + 1));

  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const og = out.getContext("2d")!;
  og.drawImage(wobbled, 0, 0);
  const rimBlur = document.createElement("canvas"); rimBlur.width = W; rimBlur.height = H;
  blurInto(rimBlur.getContext("2d")!, ragged, 0.35 * zb);
  og.drawImage(rimBlur, 0, 0);
  return { canvas: out, S };
}

interface StarSprites {
  zb: number; hazeS: number; haze: HTMLCanvasElement;
  flame: HTMLCanvasElement[]; flameS: number; wisp: HTMLCanvasElement[]; wispS: number;
  scratchF: HTMLCanvasElement; scratchW: HTMLCanvasElement;    // per-ring blend buffers, same size as the frames
  disc: HTMLCanvasElement; discS: number;
  loops: { canvas: HTMLCanvasElement; ox: number; oy: number; w: number; h: number }[];
  flare: { canvas: HTMLCanvasElement; w: number; h: number };
}

function buildStarSprites(star: StarSpec, zb: number): StarSprites {
  const hazeS = 2 * star.hazeR;
  const { c: haze, g } = makeCanvas(hazeS, hazeS, zb);
  radialDisc(g, hazeS / 2, star.hazeR, star.haze);
  const n = BOIL ? 3 : 1;
  const flames = Array.from({ length: n }, (_, i) => buildRingFrame(star.flame, i, zb));
  const wisps  = Array.from({ length: n }, (_, i) => buildRingFrame(star.wisp, i, zb));
  const scratch = (cv: HTMLCanvasElement): HTMLCanvasElement => { const s = document.createElement("canvas"); s.width = cv.width; s.height = cv.height; return s; };
  const disc = buildStarDisc(star, zb);
  return { zb, hazeS, haze,
           flame: flames.map((f) => f.canvas), flameS: flames[0].S, wisp: wisps.map((f) => f.canvas), wispS: wisps[0].S,
           scratchF: scratch(flames[0].canvas), scratchW: scratch(wisps[0].canvas),
           disc: disc.canvas, discS: disc.S,
           loops: star.prom.loops.map((l) => buildLoopSprite(star, l, zb)), flare: buildFlareSprite(star, zb) };   // §3b
}
```

Build cost at DPR 2, zoom 1 (measured): ≈ 45 ms with boil once the noise tiles exist, ≈ 105 ms on the very first build (the tiles take ≈ 60 ms); the ring frames and the disc's two displacements dominate. Build the haze, the disc and frame 0 first (≈ 20 ms) and the boil frames over the next frames — until they exist, draw frame 0 alone — or build everything in a Worker with `OffscreenCanvas`.

### Per-frame draw

```ts
// Blend two rotated ring frames into a transparent scratch buffer with "lighter" (exact cross-fade), return the buffer.
function blendRing(frames: HTMLCanvasElement[], scratch: HTMLCanvasElement, angle: number, tS: number): HTMLCanvasElement {
  const g = scratch.getContext("2d")!, W = scratch.width, H = scratch.height;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.translate(W / 2, H / 2); g.rotate(angle);
  if (frames.length === 1) { g.drawImage(frames[0], -W / 2, -H / 2); return scratch; }
  const u = frac(tS / BOIL_PERIOD) * frames.length, i = Math.floor(u), w = smoothstep(0, 1, u - i);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 1 - w; g.drawImage(frames[i], -W / 2, -H / 2);
  g.globalAlpha = w;     g.drawImage(frames[(i + 1) % frames.length], -W / 2, -H / 2);
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  return scratch;
}

// sx, sy = screen centre; zoom = camera zoom (residual zoom / sp.zb stays within the bucket, §12); tS = scene clock.
function drawStar(ctx: CanvasRenderingContext2D, star: StarSpec, sp: StarSprites, sx: number, sy: number, zoom: number, tS: number): void {
  const breathe = 1 + 0.03 * Math.sin((tS / 6) * Math.PI * 2);              // ±3 % / 6 s: haze, wisps, flames only
  const blitC = (img: HTMLCanvasElement, sizeCss: number, s: number): void => {
    const z = sizeCss * zoom * s; ctx.drawImage(img, sx - z / 2, sy - z / 2, z, z);
  };
  blitC(sp.haze, sp.hazeS, breathe);                                                                 // 1. haze
  blitC(blendRing(sp.wisp, sp.scratchW, (2 * Math.PI * tS) / star.wisp.period, tS), sp.wispS, breathe);    // 2. wisps (−300 s)
  blitC(blendRing(sp.flame, sp.scratchF, (2 * Math.PI * tS) / star.flame.period, tS), sp.flameS, breathe); // 3. flames (+200 s)
  drawProminencesAndFlare(ctx, star, sp, sx, sy, zoom, tS);                                          // 4–5. §3b
  blitC(sp.disc, sp.discS, 1);                                                                       // 6–7. disc + rim, no breathe
}
```

The disc sprite goes on last, so the prominence feet and the flare base disappear under the limb exactly as in the SVG. Only the haze and the two rings scale with the breathe; the crash disc never moves. Rotation is wall-clock, the same at 1x / 2x / 4x.

---

## 3b. Prominences & flare (v1.5: two-tone, unblurred)

Three loops and one flare per main-sequence star, as in v1.3, but now **crisp**: each loop is a two-tone stroke (outer colour at α 0.85 + a thin hot core at α 0.90), no blur, and both loops and flare peak at **opacity 1** — the strokes and the flare gradient carry their own alpha, as the reference shows them. Timings are unchanged: loops 12 / 16 / 14 s from 0 / 5 / 9 s, flare once per 22 s.

| Star | Loop A (°) | Path in `rotate(A) translate(r 0)` (x radial, y tangential) | dur · begin | Strokes (outer · core) | Flare |
|---|---|---|---|---|---|
| Sun | 147.5 · 243.6 · 314.8 | `M-0.9 -9 C21 -7.2 21 7.2 -0.9 9` · `M-1.3 -11 C23.5 -9 23.5 9 -1.3 11` · `M-0.8 -8.5 C29 -6.8 29 6.8 -0.8 8.5` | 12 · 0 / 16 · 5 / 14 · 9 | `#FF8C2E` 2.8 · `#FFF1C2` 1.0 | 25°, `M46 -1.8 L86 0 L46 1.8 Z`, `#FFFFFF` → `#FFD27A` α 0.15 |
| Red dwarf | 338.8 · 248 · 167.2 | `M-1.18 -10.13 C25.11 -8.1 …` · `M-0.68 -7.72 C26.06 -6.18 …` · `M-0.81 -8.4 C22.45 -6.72 …` | same | `#E0432F` 2.4 · `#FFD9B0` 0.9 | 117.9°, `M40 -1.55 L74.8 0 L40 1.55 Z`, → `#FFD9B0` α 0.15 |
| Blue giant | 332.7 · 243.5 · 168.7 | `M-1.06 -11.17 C26.44 -8.93 …` · `M-1.19 -11.81 C25.25 -9.45 …` · `M-1.64 -13.86 C31.21 -11.09 …` | same | `#5EA0FF` 3.2 · `#F4F8FF` 1.15 | 278.3°, `M54 -2.1 L101 0 L54 2.1 Z`, → `#B8CCFF` α 0.15 |

(Paths are symmetric: `M x0 −y0 C cx −cy cx cy x0 y0`; the full numbers are in `StarSpec.prom` above and in each header.) **Timing:** loop i: `u = frac((t − begin) / dur)`, `h = sin²(π u)`, scale `0.6 + 0.4 h` about the base point, `globalAlpha = h`; invisible before `begin` and at t = 0; peaks at 6 + 12n, 13 + 16n, 16 + 14n s. **Flare:** α = triangle peaking at 1 at 13.9 s with half-width 0.9 s inside a 22 s cycle (keyTimes 0.5909 / 0.6318 / 0.6727).

```ts
// One loop sprite: the path's bounding box + stroke padding, origin offset so (0,0) = the base point on the limb.
function buildLoopSprite(star: StarSpec, l: LoopSpec, zb: number): { canvas: HTMLCanvasElement; ox: number; oy: number; w: number; h: number } {
  const pad = star.prom.outerW;
  const xMax = 0.75 * l.cx + 0.25 * l.x0;                                   // the cubic's peak (its midpoint)
  const ox = -Math.min(l.x0, 0) + pad, oy = l.y0 + pad;
  const w = Math.ceil(xMax + ox + pad), h = Math.ceil(2 * oy);
  const { c, g } = makeCanvas(w, h, zb);
  g.translate(ox, oy); g.lineCap = "round";
  const path = new Path2D(`M${l.x0} ${-l.y0} C${l.cx} ${-l.cy} ${l.cx} ${l.cy} ${l.x0} ${l.y0}`);
  g.strokeStyle = rgba(star.prom.outer, 0.85); g.lineWidth = star.prom.outerW; g.stroke(path);   // outer, no blur
  g.strokeStyle = rgba(star.prom.inner, 0.9);  g.lineWidth = star.prom.innerW; g.stroke(path);   // hot core
  return { canvas: c, ox, oy, w, h };
}

function buildFlareSprite(star: StarSpec, zb: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const f = star.flare, w = f.x1 - f.x0, h = 2 * f.hw + 2;
  const { c, g } = makeCanvas(w, h, zb);
  const lg = g.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, "#FFFFFF"); lg.addColorStop(1, rgba(f.tip, 0.15));
  g.fillStyle = lg;
  g.beginPath(); g.moveTo(0, h / 2 - f.hw); g.lineTo(w, h / 2); g.lineTo(0, h / 2 + f.hw); g.closePath(); g.fill();
  return { canvas: c, w, h };
}

const tri = (x: number, hw: number): number => Math.max(0, 1 - Math.abs(x) / hw);

function drawProminencesAndFlare(ctx: CanvasRenderingContext2D, star: StarSpec, sp: StarSprites,
                                 sx: number, sy: number, zoom: number, tS: number): void {
  for (let i = 0; i < star.prom.loops.length; i++) {
    const l = star.prom.loops[i], s = sp.loops[i];
    if (tS < l.begin) continue;
    const h = hump(frac((tS - l.begin) / l.dur));                             // §2b: sin²(π u)
    if (h < 0.005) continue;
    const A = (l.A * Math.PI) / 180, sc = (0.6 + 0.4 * h) * zoom;
    ctx.save();
    ctx.translate(sx + star.r * zoom * Math.cos(A), sy + star.r * zoom * Math.sin(A));   // base point on the limb
    ctx.rotate(A); ctx.scale(sc, sc);
    ctx.globalAlpha = h;                                                      // 0 → 1 → 0: the strokes carry α 0.85 / 0.90
    ctx.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
    ctx.restore();
  }
  const fa = tri((((tS % 22) + 22) % 22) - 13.9, 0.9);                        // 13.0 → 13.9 (α 1) → 14.8 s
  if (fa > 0) {
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate((star.flare.A * Math.PI) / 180); ctx.scale(zoom, zoom);
    ctx.globalAlpha = fa;
    ctx.drawImage(sp.flare.canvas, star.flare.x0, -sp.flare.h / 2, sp.flare.w, sp.flare.h);
    ctx.restore();
  }
}
```

Cost per star per frame: ≤ 3 loop blits (each ≈ 36 × 32 px) + ≤ 1 flare blit, no gradient, path or allocation in the loop (a plain `for`), ≈ 0.04 ms. A loop is scaled by at most 1.0 × zoom residual, so the crisp strokes never exceed the 1.25× rule.

---

## 3c. Black hole, white dwarf, neutron star (compact objects, v1.5 crispness)

Emissive, no terminator, no flames. Each is a small stack of cached sprites; the only live motion is a scale (white dwarf glow), one rotation (neutron star magnetosphere) and one rotation of one ring sprite drawn twice (black hole disk). v1.5 removes every blur above 0.5 except glow gradients, tints the black hole's disk with the sun's plasma recipe and makes its photon ring two-tone and slightly ragged. Crash at the solid disc: **crashRadius 16 / 8 / 22**; the black hole's gravity is star-class.

### White dwarf — r 16, two sprites, 2 blits

| Layer | Geometry | Stops / values |
|---|---|---|
| glow (sprite A, breathes ±5 % / 4 s) | disc r 96 → 200 px sprite | `#7FB8FF` 0 α 0.60 · 0.10 α 0.46 · 0.20 α 0.22 · 0.35 α 0.09 · 0.60 α 0.025 · 1 α 0 |
| corona (B) | disc r 36 | `#B8CCFF` 0 α 0.90 · 0.44 α 0.70 · 0.56 α 0.30 · 0.75 α 0.08 · 1 α 0 — no blur |
| spikes (B) | 4 tapered wedges `M16 -0.8 L64 0 L16 0.8 Z` at 0° / 90° / 180° / 270° | linear along the spike: `#FFFFFF` α 0.55 (r 16) · `#B8CCFF` α 0.25 (r 32) · `#B8CCFF` α 0 (r 64) |
| bloom (B) | disc r 22.4 | `#FFFFFF` 0 α 0.50 · 0.71 α 0.50 · 0.80 α 0.16 · 1 α 0 |
| body (B) | disc r 16 | 0 `#FFFFFF` · 0.55 `#FFFFFF` · 0.80 `#E9EEF8` · 0.93 `#B8CCFF` · 1 `#7FB8FF` |
| limb (B) | two rings | r 15.5, 1 px, `#7FB8FF` α 0.9 + r 14.6, 0.6 px, `#FFFFFF` α 0.7 |

```ts
let wdGlow!: HTMLCanvasElement, wdDisc!: HTMLCanvasElement;    // 200 px and 136 px CSS × zoom bucket × DPR
function drawWhiteDwarf(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tS: number): void {
  const b = 1 + 0.05 * Math.sin((tS / 4) * Math.PI * 2);
  const gs = 200 * zoom * b, ds = 136 * zoom;
  ctx.drawImage(wdGlow, sx - gs / 2, sy - gs / 2, gs, gs);
  ctx.drawImage(wdDisc, sx - ds / 2, sy - ds / 2, ds, ds);
}
```

### Neutron star — r 8, three sprites, 3 blits

| Layer | Geometry | Stops / values |
|---|---|---|
| glow (A, static) | disc r 40 → 84 px | `#B48CFF` 0 α 0.65 · 0.20 α 0.48 · 0.35 α 0.22 · 0.60 α 0.07 · 1 α 0 |
| magnetosphere (B, rotates 30° + 360° · t / 6 s, clockwise) | 80 px | haze ellipse 20 × 4.8 `#B48CFF` α 0.14 (blur 0.75 baked); beams `(−3.2, −7) (3.2, −7) (7, −36) (−7, −36)` + mirror, linear `#DCE4FF` α 0.38 · 0.4 `#C9A8FF` α 0.20 · `#B48CFF` α 0, blur 0.5 baked; **core spikes** `M−0.8 −7 L0 −34 L0.8 −7 Z` + mirror, `#FFFFFF` α 0.55 → `#DCE4FF` α 0, unblurred |
| body + limb (C, static) | 20 px | body 0 `#FFFFFF` · 0.5 `#FFFFFF` · 0.8 `#DCE4FF` · 0.93 `#C9A8FF` · 1 `#B48CFF`; limb r 7.5, 1 px, `#DCE4FF` α 0.9 + hairline r 8.3, 0.6 px, `#B48CFF` α 0.75 |

```ts
let nsGlow!: HTMLCanvasElement, nsMag!: HTMLCanvasElement, nsBody!: HTMLCanvasElement;   // 84 / 80 / 20 px CSS
function drawNeutronStar(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tS: number): void {
  const gs = 84 * zoom, ms = 80 * zoom, bs = 20 * zoom;
  ctx.drawImage(nsGlow, sx - gs / 2, sy - gs / 2, gs, gs);
  ctx.save(); ctx.translate(sx, sy);
  ctx.rotate(Math.PI / 6 + ((tS % 6) / 6) * Math.PI * 2);
  ctx.drawImage(nsMag, -ms / 2, -ms / 2, ms, ms);
  ctx.restore();
  ctx.drawImage(nsBody, sx - bs / 2, sy - bs / 2, bs, bs);
}
```

### Black hole — r 22, two static cells + one plasma ring drawn twice + one overlay, 5 blits

Draw order (SVG): glow → top lensed arc → **back** half of the disk → shadow → photon ring → **front** half → bottom lensed arc → Einstein ring. Canvas folds the last two into cell B (they then sit under the front half; the overlap is the arc's faded tail and a 1 px α 0.14 ring — invisible), which gives the brief's cap of **5 `drawImage`**.

| Sprite | Contents (all built at the zoom bucket × DPR) |
|---|---|
| cell A (160 px) | **glow** r 66 `#FF8C2E` 0 α 0.22 · 0.35 α 0.08 · 0.60 α 0.03 · 1 α 0; **top lensed arc** sector r 25.3–28.6, 190° → 350°, ramp 25.3 `#FFE7A0` α 0.95 · 26.4 `#FFC857` α 0.85 · 27.5 `#FF8C2E` α 0.7 · 28.6 `#E8461A` α 0.3, × vertical fade (0 at y = 0 → 1 at \|y\| ≥ 20), × the Doppler mask (baked), group α 0.80; displaced (fractal 0.25, 2 oct, seed 73, scale 1.4) and blurred 0.5 |
| cell B (160 px) | back-half Doppler darkening (upper half of the disk annulus 57.2 × 12.1 / 30.8 × 6.5, `#000000` α 0 → 0.45 left → right, the arc band cut out) → **shadow** r 22 `#000000` → **photon ring**, two-tone and ragged: r 24 `#FFC857` 2 px α 0.6 + r 24 `#FFFFFF` 1 px α 0.95 + r 22.9 `#FFF1C2` 0.6 px α 0.55, the three strokes displaced together (`displaceCanvas`, fractal 0.25, 2 oct, seed 71, scale 1.4) and blurred 0.3 — the ±0.7 px wobble is **baked here** → **bottom lensed arc** (10° → 170°, group α 0.55, same ramp, displacement and blur) → **Einstein ring** r 46.5, 1 px, `#7FB8FF` α 0.14 |
| plasma ring (120 px at 2 × the bucket × DPR) | flat annulus 30.8–57.2 in a circular frame: radial ramp (userSpace r 57.2) 0.538 `#FFF8E1` α 0.95 · 0.6 `#FFE7A0` α 0.92 · 0.68 `#FFC857` α 0.92 · 0.78 `#FF8C2E` α 0.82 · 0.87 `#E8461A` α 0.6 · 0.94 `#B48CFF` α 0.32 · 1 `#B48CFF` α 0.12; **plasma** per pixel over it (clipped to the ring): dark `#802105` ramp(n, 3.4, −1.5) × 0.42 (fractal 0.055 / 5 oct / seed 12), filaments `#FFE7A0` ramp(t, −6.5, 1.25) × 1.0 (turbulence 0.07 / 5 oct / seed 19); **8 stream arcs**: dashed circles r 33.5 / 36 / 39.5 / 41 / 43 / 47 / 50.5 / 53.5, stroke 1.4–2.4, 5 bright `#FFE7A0` α 0.21–0.32 and 3 dark `#802105` α 0.24–0.32 (dash arrays as in the markup) |
| Doppler overlay (160 px) | lower half (y ≥ 0) of the same annulus, `#000000` α 0 (left) → 0.45 (right), the bottom-arc band cut out |

The squash turns the Cartesian plasma into tangential filaments, so the texture must be baked in the **circular** frame and squashed at draw time: `translate → scale(1, 0.2115) → rotate(phase)`, phase = 2π · (t mod 24) / 24, clockwise. 0.2115 = ry / rx = 0.55 r / 2.6 r. The Doppler mask (×1.0 left → ×0.55 right in the SVG) is a `#000000` darkening at α 0 → 0.45 over the near-black sky — equal to the multiply within 1 %.

```ts
let bhAtlas!: HTMLCanvasElement;         // cells A | B, 160 × 160 CSS px each (× zoom bucket × DPR)
let bhRing!: HTMLCanvasElement;          // 120 × 120 CSS px plasma annulus, built at 2 × bucket × DPR
let bhDoppler!: HTMLCanvasElement;       // 160 × 160 CSS px front-half darkening
let bhZb = 1;                           // the zoom bucket the three were built at
const BH_SQUASH = 0.2115;

function bhCell(ctx: CanvasRenderingContext2D, cell: number, sx: number, sy: number, zoom: number): void {
  const s = 160 * zoom, src = 160 * bhZb * DPR;
  ctx.drawImage(bhAtlas, cell * src, 0, src, src, sx - s / 2, sy - s / 2, s, s);
}
function bhHalf(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, phase: number, upper: boolean): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(sx - 70 * zoom, upper ? sy - 20 * zoom : sy, 140 * zoom, 20 * zoom); ctx.clip();
  ctx.translate(sx, sy); ctx.scale(zoom, zoom * BH_SQUASH); ctx.rotate(phase);
  ctx.drawImage(bhRing, -60, -60, 120, 120);
  ctx.restore();
}
function drawBlackHole(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, tS: number): void {
  const phase = ((tS % 24) / 24) * Math.PI * 2;
  bhCell(ctx, 0, sx, sy, zoom);                 // 1. glow + top arc
  bhHalf(ctx, sx, sy, zoom, phase, true);       // 2. back half
  bhCell(ctx, 1, sx, sy, zoom);                 // 3. back Doppler + shadow + ragged photon ring + bottom arc + Einstein ring
  bhHalf(ctx, sx, sy, zoom, phase, false);      // 4. front half
  const s = 160 * zoom;
  ctx.drawImage(bhDoppler, sx - s / 2, sy - s / 2, s, s);   // 5. front-half Doppler
}
```

### Cost (per frame)

| Body | Draw calls | ≈ ms |
|---|---|---|
| White dwarf | 2 blits | 0.05 |
| Neutron star | 3 blits (one rotated) | 0.05 |
| Black hole | 5 blits (2 cells, 2 clipped ring draws, 1 overlay) | 0.13 |

Builds: white dwarf and neutron star ≈ 0.3 ms each; black hole ≈ 20 ms (the plasma loop over a 480² ring at DPR 2, two displacements for the photon ring and arcs). All three follow the zoom bucket (§12).

---

## 4. Planets (v1.5 sprite pipeline: crisp zones, cloud-shadow strip, warm terminator band)

### Scrolling strips under a fixed lighting overlay
The v1.2 structure stays: each planet is a **surface strip** (period P = round(2π r), two identical tiles wide) and an optional **cloud strip**, slid under a **lighting overlay** that never moves. Per frame, per planet: `save` → `clip(arc r)` → surface blit → cloud blit → `restore` → overlay blit — **1 clip + 2–3 blits ≈ 0.09 ms**. What v1.5 changes is what the bitmaps contain:

- **Surface strip:** 3–7 **zones** computed per pixel from noise fields on the SVG value scale (§0 toolkit), each `alpha = ramp(n, slope, intercept) × cap` with the header's own slope and intercept (coast ~70, zones 12–60), tinted, composited in the header's merge order; zones can be composited **in** another zone (desert in land), be iso-lines (cracks, lineae) or be **walls** (a zone minus itself shifted: crater walls, lit crack edges); polar caps on top. Crisp by construction — no soft percentile ramps any more.
- **Cloud strip:** the cast **shadow first** (the cloud mask shifted away from the light, blurred 0.45, in `cloud.shadow #06122E` at α 0.32–0.45), then the clouds (blur ≤ 0.2, α 0.70–0.92) — both baked into one transparent strip, so the shadow scrolls with its clouds at no cost.
- **Lighting overlay:** glint (ocean worlds) → **shade** (highlight bloom → **warm terminator band** `#FF9455` at 0.705 → night navy `#08122E` → `#050B1E`) → inner **haze** × lit mask → outer **rim** (1.077 r) × lit mask. No limb line, no squash ring.
- **Emissive strip** (lava; the volcanic moon's hot spots, §4c): drawn **after** the overlay so it glows on the night side.

Light comes from the scene's star: **L** = unit vector from the planet to the star. The overlay is built for that L; rebuild it if L turns by more than ~5° (bodies do not move in this prototype). Rotation is wall-clock, identical at 1x / 2x / 4x, and keeps running under the result overlays.

### Geometry (the two original planets)

| | Start planet (ocean world, the reference) | Planet X |
|---|---|---|
| r · P · tile · strip bitmap | 34 · **214** · 214 × 68 · 428 × 68 (856 × 136 device px at DPR 2) | 30 · **188** · 188 × 60 · 376 × 60 |
| Surface / cloud period | **90 s** / **64 s** | **120 s** / **80 s** (wisps) |
| Direction | west → east: the texture moves left → right (offset grows with time; SVG `translate 0 → +P`) | same |
| Overlay bitmap | ceil(2 · 1.077 r + 4) = **78 px** | **69 px**, + the live halo (1.8 r) and ring (§4 end) |
| Zones (merge order) | shallow · land · forest · desert **in** land · highland; caps 12 % | plains · frost **in** plains · basins · ice · lineae; caps 18 % |
| Clouds | `0.042 0.085`, 6 oct, seed 19, 26 c − 13.93, blur 0.2, α 0.78; shadow (−0.85, +0.85) blur 0.45 α 0.45 (v1.5.1: down-left, away from the light) | wisps `0.025 0.12`, 6 oct, seed 23, 26 c − 15.99, blur 0.2, α 0.70; shadow (+1, −1) blur 0.45 α 0.32 |
| Shade (centre +0.36 r·L, radius 1.25 r) | 0 `#E6F2FF` α 0.38 · 0.32 α 0 · 0.64 `#FF9455` α 0 · 0.705 α 0.24 · 0.76 `#08122E` α 0.74 · 0.84 `#050B1E` α 0.97 · 1 α 1 | same with `#B5FFF0` α 0.28 and warm α 0.22 |
| Haze (r) · rim (1.077 r) | 0.78 `#8FD0FF` α 0 · 0.96 α 0.42 · 1 `#BFE6FF` α 0.65 · rim 0.90 `#A8DBFF` α 0 · 0.928 α 0.95 · 0.955 `#7FC4FF` α 0.40 · 1 α 0 | haze `#8FFFE6` → `#E6FFF9`; rim `#B5FFF0` → `#8FFFE6` |
| Glint | ellipse 6.4 × 3.6 at 0.45 r·L, long axis along L, `#FFFBEE` 0 α 0.60 · 0.45 α 0.25 · 1 α 0 | none |

### Specs

```ts
interface ZoneDef {
  field: number;                                   // index into PlanetSpec.fields
  color: string;
  slope?: number; intercept?: number;              // alpha = ramp(n, slope, intercept)       (feFuncA linear)
  contour?: { level: number; half: number };       // or alpha = contour(n, level, half)     (feFuncA table)
  cap?: number;                                    // × cap (the colour matrix's alpha factor), default 1
  inside?: number;                                 // × the alpha of zones[inside] (feComposite in)
  wall?: { of: number; dx: number; dy: number };   // alpha = a_of(x, y) · (1 − a_of(x − dx, y − dy)), then × cap (pit minus shifted pit)
}
interface CloudDef { field: NoiseDef; color: string; slope: number; intercept: number; blur: number; alpha: number;
                     shadow?: { color: string; dx: number; dy: number; blur: number; alpha: number } }
interface LightDef {
  shade: [number, string, number][];               // radial, centre +0.36 r·L, radius 1.25 r
  haze?: [number, string, number][];               // radial r, × lit mask
  rim?: [number, string, number][];                // radial 1.077 r, × lit mask
  glint?: { rx: number; ry: number; color: string; stops: [number, number][] };   // at 0.45 r·L, long axis along L
}
interface PlanetSpec {
  r: number; crashRadius: number; base: string;
  fields: NoiseDef[];                              // all stitched to the strip period P
  zones: ZoneDef[];                                // merge order = array order
  caps?: { color: string; frac: number;            // bands: α 1 at the pole · 0.95 at 78 % · 0 at the inner edge
           noisy?: { reach: number; field: number; tau: number; slope: number } }; // v1.5.1: α = ramp(slope·(capRamp + (n − 0.5) − tau)),
                                                   // capRamp = 1 at the pole → 0 at reach·H — a ragged edge instead of the ruled band
  clouds?: CloudDef;
  light: LightDef;
  surfacePeriod: number; cloudPeriod?: number;
}

const ATMO_LIT = (bloom: string, bloomA: number, warmA: number): [number, string, number][] => [
  [0, bloom, bloomA], [0.32, bloom, 0], [0.64, "#FF9455", 0], [0.705, "#FF9455", warmA],
  [0.76, "#08122E", 0.74], [0.84, "#050B1E", 0.97], [1, "#050B1E", 1]];
const AIRLESS_LIT = (bloom: string, bloomA: number): [number, string, number][] => [
  [0, bloom, bloomA], [0.30, bloom, 0], [0.69, "#FF9455", 0], [0.73, "#FF9455", 0.18],
  [0.755, "#08122E", 0.82], [0.80, "#050B1E", 0.97], [1, "#050B1E", 1]];
const RIM = (rim: string, outer: string, peak = 0.95, outerA = 0.4): [number, string, number][] => [
  [0.90, rim, 0], [0.928, rim, peak], [0.955, outer, outerA], [1, outer, 0]];

const OCEAN: PlanetSpec = {                        // planet-start.svg = ocean.svg = the approved reference
  r: 34, crashRadius: 34, base: "#1E5BD6",
  fields: [{ type: "fractal", f: 0.030, octaves: 6, seed: 7 }, { type: "fractal", f: 0.045, octaves: 3, seed: 23 }],
  zones: [
    { field: 0, color: "#36B9D8", slope: 9.5, intercept: -4.655 },            // shallow
    { field: 0, color: "#5FA84A", slope: 70,  intercept: -38.21 },            // land (≈ 1 px coast)
    { field: 0, color: "#3B7E3B", slope: 18,  intercept: -10.44 },            // forest
    { field: 1, color: "#D8B26E", slope: 14,  intercept: -7.9, inside: 1 },   // desert IN land
    { field: 0, color: "#5B5A33", slope: 12,  intercept: -7.68 },             // highland
  ],
  caps: { color: "#F4F8FF", frac: 0.12 },
  clouds: { field: { type: "fractal", f: [0.042, 0.085], octaves: 6, seed: 19 }, color: "#FFFFFF", slope: 26, intercept: -13.93,
            blur: 0.2, alpha: 0.78, shadow: { color: "#06122E", dx: -0.85, dy: 0.85, blur: 0.45, alpha: 0.45 } },   // down-left, away from the light (v1.5.1)
  light: { shade: ATMO_LIT("#E6F2FF", 0.38, 0.24),
           haze: [[0.78, "#8FD0FF", 0], [0.96, "#8FD0FF", 0.42], [1, "#BFE6FF", 0.65]],
           rim: RIM("#A8DBFF", "#7FC4FF"),
           glint: { rx: 6.4, ry: 3.6, color: "#FFFBEE", stops: [[0, 0.6], [0.45, 0.25], [1, 0]] } },
  surfacePeriod: 90, cloudPeriod: 64,
};

const PLANET_X: PlanetSpec = {
  r: 30, crashRadius: 30, base: "#17B39C",
  fields: [{ type: "fractal", f: 0.035, octaves: 6, seed: 11 }, { type: "fractal", f: 0.05, octaves: 4, seed: 17 },
           { type: "turbulence", f: 0.06, octaves: 1, seed: 11 }],
  zones: [
    { field: 0, color: "#3DE0C2", slope: 60,    intercept: -30 },             // mint plains
    { field: 1, color: "#44CFE8", slope: 14,    intercept: -7.98, inside: 0 },// cyan frost IN the plains
    { field: 0, color: "#0E4A40", slope: -15.3, intercept: 6.273 },           // dark basins
    { field: 0, color: "#B5FFF0", slope: 16,    intercept: -10.08 },          // ice fields
    { field: 2, color: "#17B39C", slope: -50,   intercept: 1.5, cap: 0.85 },  // thin lineae (tinted, never grey)
  ],
  caps: { color: "#E6FFF9", frac: 0.18, noisy: { reach: 0.23, field: 0, tau: 0.217, slope: 12 } },  // mean edge 18 %, ±0.1 capRamp of terrain
  clouds: { field: { type: "fractal", f: [0.025, 0.12], octaves: 6, seed: 23 }, color: "#E6FFF9", slope: 26, intercept: -15.99,
            blur: 0.2, alpha: 0.70, shadow: { color: "#06122E", dx: 1, dy: -1, blur: 0.45, alpha: 0.32 } },
  light: { shade: ATMO_LIT("#B5FFF0", 0.28, 0.22),
           haze: [[0.78, "#8FFFE6", 0], [0.96, "#8FFFE6", 0.42], [1, "#E6FFF9", 0.65]],
           rim: RIM("#B5FFF0", "#8FFFE6") },
  surfacePeriod: 120, cloudPeriod: 80,
};
```

### buildPlanetStrips — once per zoom bucket

Everything is in device pixels: `W = P · zb · DPR`, `H = 2 r · zb · DPR`. Each field is an `svgField` periodic in W (cells = round(P · f), exactly like `stitchTiles`), so a strip made of two identical tiles is seamless. Zones are composited per pixel in straight alpha (`c ← c + (zone − c) · a`, `a_total ← a + a_total (1 − a)`), as `feMerge` does.

```ts
interface PlanetStrips { surface: HTMLCanvasElement; cloud: HTMLCanvasElement | null; overlay: HTMLCanvasElement;
                         size: number; r: number; P: number; zoom: number }

function zoneAlphas(spec: { zones: ZoneDef[] }, F: Float32Array[], W: number, H: number, k: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (const z of spec.zones) {
    const n = F[z.field], a = new Float32Array(W * H), cap = z.cap ?? 1;
    if (z.wall) {                                                            // pit minus the pit shifted by (dx, dy) CSS px
      const src = out[z.wall.of], dx = Math.round(z.wall.dx * k), dy = Math.round(z.wall.dy * k);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const xs = (((x - dx) % W) + W) % W, ys = y - dy;                    // wraps in x (periodic strip), clamps in y
        const b = ys < 0 || ys >= H ? 0 : src[ys * W + xs];
        a[y * W + x] = src[y * W + x] * (1 - b) * cap;
      }
    } else {
      for (let j = 0; j < a.length; j++)
        a[j] = (z.contour ? contour(n[j], z.contour.level, z.contour.half) : ramp(n[j], z.slope!, z.intercept!)) * cap;
    }
    if (z.inside !== undefined) { const m = out[z.inside]; for (let j = 0; j < a.length; j++) a[j] *= m[j]; }
    out.push(a);
  }
  return out;
}

function paintZones(base: string | null, zones: ZoneDef[], A: Float32Array[], W: number, H: number): ImageData {
  const img = new ImageData(W, H), d = img.data;
  const b = base ? hexRGB(base) : [0, 0, 0];
  const cols = zones.map((z) => hexRGB(z.color));
  for (let j = 0; j < W * H; j++) {
    let r = b[0], g = b[1], bl = b[2], at = base ? 1 : 0;
    for (let i = 0; i < zones.length; i++) {
      const a = A[i][j]; if (a <= 0) continue;
      const c = cols[i], w = at > 0 ? a / (a + at * (1 - a)) : 1;           // straight-alpha "over"
      r += (c[0] - r) * w; g += (c[1] - g) * w; bl += (c[2] - bl) * w; at = a + at * (1 - a);
    }
    d[j * 4] = r; d[j * 4 + 1] = g; d[j * 4 + 2] = bl; d[j * 4 + 3] = at * 255;
  }
  return img;
}

function twoTiles(tile: HTMLCanvasElement): HTMLCanvasElement {           // 2W × H: the seamless-wrap trick
  const s = document.createElement("canvas"); s.width = 2 * tile.width; s.height = tile.height;
  const g = s.getContext("2d")!; g.drawImage(tile, 0, 0); g.drawImage(tile, tile.width, 0);
  return s;
}

function buildSurfaceTile(spec: PlanetSpec, W: number, H: number, k: number): HTMLCanvasElement {
  const F = spec.fields.map((f) => svgField(f, W, H, W, k));
  const A = zoneAlphas(spec, F, W, H, k);
  const tile = document.createElement("canvas"); tile.width = W; tile.height = H;
  const g = tile.getContext("2d")!;
  g.putImageData(paintZones(spec.base, spec.zones, A, W, H), 0, 0);
  if (spec.caps?.noisy) {                                                    // v1.5.1 ragged caps (planet X, ice): per-pixel, baked once
    const { reach, field, tau, slope } = spec.caps.noisy, n = F[field], img = g.getImageData(0, 0, W, H), [cr, cg, cb] = hexRGB(spec.caps.color);
    for (let y = 0; y < H; y++) {
      const ramp = Math.max(0, 1 - Math.min(y + 0.5, H - y - 0.5) / (reach * H));
      for (let x = 0; x < W; x++) {
        const j = y * W + x, a = Math.min(1, Math.max(0, slope * (ramp + n[j] - 0.5 - tau))), o = j * 4;
        img.data[o] += (cr - img.data[o]) * a; img.data[o + 1] += (cg - img.data[o + 1]) * a; img.data[o + 2] += (cb - img.data[o + 2]) * a;
      }
    }
    g.putImageData(img, 0, 0);
  } else if (spec.caps) {                                                    // polar bands, inside the strip so they look fixed
    const h = spec.caps.frac * H, c = spec.caps.color;
    const band = (y0: number, y1: number): void => {
      const lg = g.createLinearGradient(0, y0, 0, y1);
      lg.addColorStop(0, c); lg.addColorStop(0.78, rgba(c, 0.95)); lg.addColorStop(1, rgba(c, 0));
      g.fillStyle = lg; g.fillRect(0, Math.min(y0, y1), W, h);
    };
    band(0, h); band(H, H - h);
  }
  return tile;
}

// Clouds with their cast shadow baked underneath, one transparent tile.
function buildCloudTile(cd: CloudDef, W: number, H: number, k: number): HTMLCanvasElement {
  const n = svgField(cd.field, W, H, W, k);
  const mask = document.createElement("canvas"); mask.width = W; mask.height = H;
  const mi = new ImageData(W, H), md = mi.data;
  for (let j = 0; j < W * H; j++) { md[j * 4 + 3] = ramp(n[j], cd.slope, cd.intercept) * 255; }
  mask.getContext("2d")!.putImageData(mi, 0, 0);                             // alpha only; colour comes from source-in below
  const layer = (color: string, blur: number, alpha: number, dx: number, dy: number): HTMLCanvasElement => {
    const t = document.createElement("canvas"); t.width = W; t.height = H;
    const g = t.getContext("2d")!;
    const b = document.createElement("canvas"); b.width = W; b.height = H;
    blurInto(b.getContext("2d")!, mask, (blur * k) / DPR);                  // blur 0.2 clouds / 0.45 shadow, × the zoom bucket
    for (const ox of [-W, 0, W]) g.drawImage(b, ox + dx * k, dy * k);       // shifted, wrapped across the period
    g.globalCompositeOperation = "source-in"; g.fillStyle = rgba(color, alpha); g.fillRect(0, 0, W, H);
    return t;
  };
  const tile = document.createElement("canvas"); tile.width = W; tile.height = H;
  const g = tile.getContext("2d")!;
  if (cd.shadow) g.drawImage(layer(cd.shadow.color, cd.shadow.blur, cd.shadow.alpha, cd.shadow.dx, cd.shadow.dy), 0, 0);
  g.drawImage(layer(cd.color, cd.blur, cd.alpha, 0, 0), 0, 0);
  return tile;
}

// Lighting overlay, S × S CSS px at the bucket zoom: glint → shade → haze × lit mask → rim × lit mask. Fixed to L.
function buildLightingOverlay(light: LightDef, r0: number, lx: number, ly: number, zb: number): { canvas: HTMLCanvasElement; size: number } {
  const r = r0 * zb, R = 1.077 * r, S = Math.ceil(2 * R + 4), c = S / 2;
  const { c: canvas, g } = makeCanvas(S, S);
  g.save(); g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.clip();         // glint, shade and haze live inside the disc
  if (light.glint) {
    const gl = light.glint;
    g.save(); g.translate(c + 0.45 * r * lx, c + 0.45 * r * ly); g.rotate(Math.atan2(ly, lx));
    g.scale(gl.rx * zb, gl.ry * zb);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [o, a] of gl.stops) rg.addColorStop(o, rgba(gl.color, a));
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
  }
  const sx = c + 0.36 * r * lx, sy = c + 0.36 * r * ly;
  const sh = g.createRadialGradient(sx, sy, 0, sx, sy, 1.25 * r);
  for (const [o, col, a] of light.shade) sh.addColorStop(o, rgba(col, a));   // bloom → warm band 0.705 → night navy
  g.fillStyle = sh; g.fillRect(0, 0, S, S);
  g.restore();

  const litLayer = (stops: [number, string, number][], radius: number): void => {
    const { c: tmp, g: h } = makeCanvas(S, S);
    const rg = h.createRadialGradient(c, c, 0, c, c, radius);
    for (const [o, col, a] of stops) rg.addColorStop(o, rgba(col, a));
    h.fillStyle = rg; h.beginPath(); h.arc(c, c, radius, 0, Math.PI * 2); h.fill();
    h.globalCompositeOperation = "destination-in";                           // × lit mask along L: 1 → 0.45 → 0.06
    const lm = h.createLinearGradient(c + r * lx, c + r * ly, c - r * lx, c - r * ly);
    lm.addColorStop(0, "rgba(255,255,255,1)"); lm.addColorStop(0.5, "rgba(255,255,255,0.45)"); lm.addColorStop(1, "rgba(255,255,255,0.06)");
    h.fillStyle = lm; h.fillRect(0, 0, S, S);
    g.drawImage(tmp, 0, 0, S, S);
  };
  if (light.haze) litLayer(light.haze, r);                                    // inner haze does the limb
  if (light.rim) litLayer(light.rim, R);                                      // thin bright rim, peak at 0.928 of 1.077 r
  return { canvas, size: S };
}

function zoomBucket(zoom: number): number { return Math.pow(1.25, Math.round(Math.log(zoom) / Math.log(1.25))); }   // §12

// lx, ly = L. ≈ 10 ms per planet at DPR 2 with cached tiles (fields dominate), once per bucket / DPR change.
function buildPlanetStrips(spec: PlanetSpec, lx: number, ly: number, zb: number): PlanetStrips {
  const r = spec.r * zb, P = Math.round(2 * Math.PI * spec.r) * zb, k = zb * DPR;
  const W = Math.round(Math.round(2 * Math.PI * spec.r) * k), H = Math.round(2 * spec.r * k);
  const surface = twoTiles(buildSurfaceTile(spec, W, H, k));
  const cloud = spec.clouds ? twoTiles(buildCloudTile(spec.clouds, W, H, k)) : null;
  const ov = buildLightingOverlay(spec.light, spec.r, lx, ly, zb);
  return { surface, cloud, overlay: ov.canvas, size: ov.size, r, P, zoom: zb };
}
```

### Per-frame draw: dt-based phase and the seamless wrap

Each planet keeps two phases in [0, 1) advanced by `dt / period` (never by frame count) and wrapped with `frac`. The strip is drawn at `x = cx − r − P + φ · P`: because it holds two identical tiles, that always covers the disc window and φ → 1 is pixel-identical to φ = 0. **Never round the offset** — at zoom 1 the start planet moves 0.04 px per frame and the bilinear filter on a fractional `drawImage` is what reads as motion. The sign is the assets' (+P, texture left → right).

```ts
interface Spin { surface: number; cloud: number }
function advanceSpin(spin: Spin, spec: PlanetSpec, dtS: number): void {
  spin.surface = frac(spin.surface + dtS / spec.surfacePeriod);
  spin.cloud = spec.cloudPeriod ? frac(spin.cloud + dtS / spec.cloudPeriod) : spin.surface;
}

// 1 clip + 1–2 strip blits + 1 overlay blit. zoom = camera zoom (residual zoom / st.zoom within 0.894 … 1.118).
function drawPlanet(ctx: CanvasRenderingContext2D, st: PlanetStrips, spin: Spin, sx: number, sy: number, zoom: number): void {
  const k = zoom / st.zoom, r = st.r * k, P = st.P * k, D = 2 * r;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(st.surface, sx - r - P + spin.surface * P, sy - r, 2 * P, D);
  if (st.cloud) ctx.drawImage(st.cloud, sx - r - P + spin.cloud * P, sy - r, 2 * P, D);   // clouds + their shadow
  ctx.restore();
  const s = st.size * k;
  ctx.drawImage(st.overlay, sx - s / 2, sy - s / 2, s, s);                  // glint, shade + warm band, haze, rim — never rotates
}

function towardStar(p: { x: number; y: number }, star: { x: number; y: number }): [number, number] {
  const dx = star.x - p.x, dy = star.y - p.y, d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d];
}
```

Keep the strips current exactly as in v1.2: compare `zoomBucket(zoom)` (and DPR) with the bucket the strips were built at and rebuild only on a change; the phases live outside the bitmaps and survive a rebuild. Start phases may be 0 — the Canvas noise is its own pattern, so there is nothing to align with the SVG's t = 0 window.

### Cost
Per frame, per planet: 1 clip + 2 strip blits (only the 2r window is rasterised) + 1 overlay blit ≈ **0.09 ms**. Build per planet per bucket at DPR 2 (measured): ≈ **10 ms** with the noise tiles cached, ≈ 50 ms on the first build (2–4 gradient-noise tiles at 512²); tiles are shared and kept, so later buckets cost the 10 ms. When a bucket flips, rebuild one body per frame and keep drawing the others from their old bitmaps (residual ≤ 1.25× for one frame).

### Planet X halo + capture ring (live)

> **Superseded for the ring (v3.0):** the capture ring is now the solid target zone in `style.md` §17 and `threejs-notes.md` §20 (no dash, no crawl, a glow band, states). The halo below still stands; the ring code is the v1.2 history.
Halo: live radial gradient `#3DE0C2`, radius 1.8 r (54 at r 30): 0 α 0.35 · 0.556 α 0.35 (disc edge) · 0.62 α 0.22 · 0.78 α 0.08 · 1 α 0 — v1.5's steeper falloff so the disc edge reads sharply against it — breathing ±4 % over 2.4 s. Ring: r 78, `#3DE0C2`, 1.5 px, `setLineDash([6, 6])`, dash crawl −12 px/s, pulse α 0.55 → 0.70 → 0.55 → 0.35 → 0.55 and r ±2 over 2.4 s (sine; α 0.55 at rest, as the SVG's `values`); reset the dash state afterwards.

```ts
let xStrips: PlanetStrips | undefined;
const xSpin: Spin = { surface: 0, cloud: 0 };
function drawPlanetX(ctx: CanvasRenderingContext2D, p: { x: number; y: number; r: number }, zoom: number, tS: number): void {
  const r = p.r * zoom, w = Math.sin((tS / 2.4) * Math.PI * 2);
  const haloR = 1.8 * r * (1 + 0.04 * w);
  const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
  halo.addColorStop(0, rgba("#3DE0C2", 0.35)); halo.addColorStop(0.556, rgba("#3DE0C2", 0.35));
  halo.addColorStop(0.62, rgba("#3DE0C2", 0.22)); halo.addColorStop(0.78, rgba("#3DE0C2", 0.08)); halo.addColorStop(1, rgba("#3DE0C2", 0));
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2); ctx.fill();
  drawPlanet(ctx, xStrips!, xSpin, p.x, p.y, zoom);
  ctx.strokeStyle = rgba("#3DE0C2", 0.55 + (w >= 0 ? 0.15 : 0.20) * w); ctx.lineWidth = 1.5;   // 0.55 at rest (t = 0) → 0.70 → 0.55 → 0.35, = the SVG
  ctx.setLineDash([6, 6]); ctx.lineDashOffset = -(tS * 12) % 12;
  ctx.beginPath(); ctx.arc(p.x, p.y, 78 * zoom + 2 * w, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
}
```

On a win the ring locks at α 1.0 (r 78, offset 0); the halo breathe and the surface rotation continue under the scrim.

---

## 4b. Body library parameters (v1.5)

One row per planet in `design/assets/bodies/` (stars and compact objects: §3, §3c; moons: §4c; ringed planets: §4d). Every value is the asset header's; Canvas feeds them into the §4 pipeline unchanged (fields through `svgField`, zones as `ZoneDef`s with the header's slope / intercept / cap, lighting through `ATMO_LIT` / `AIRLESS_LIT` / `RIM`). Notation: field = type `f` / octaves / seed; zone = colour `slope n + intercept` × cap; "in Z" = composited inside zone Z. Library light is upper-right; a level passes its own L.

| Body | r · crash · P · strip · period | Fields | Zones (merge order) | Clouds / emissive | Light (bloom α · warm α · haze peak / edge · rim peak) | Special |
|---|---|---|---|---|---|---|
| **rocky** | 30 · 30 · 188 · 376 × 60 · 110 s | n fractal 0.032/6/5 · du fractal `0.016 0.06`/6/13 · ru fractal 0.05/4/29 · cr fractal 0.17/1/31 | sand `#E8A85C` 30 du − 18 · rust `#B04A22` 18 ru − 10.08 · basalt `#6B3820` −50 n + 20.75 · plateau `#F7D8B0` 16 n − 10.56 · pits `#6B3820` 40 cr − 26.4 × 0.85 · dark wall `#4A2414` wall(pits, −1, +1) × 0.75 · lit wall `#F7D8B0` wall(pits, +1, −1) × 0.55 | — | `#FFF0DC` 0.20 · 0.26 · `#E8B07A` 0.30 → `#FFD9B0` 0.48 (haze from 0.80) · `#FFD9B0` / `#E8B07A` 0.75 / 0.3 | no caps |
| **ocean** | 34 · 34 · 214 · 428 × 68 · 90 s | §4 `OCEAN` | §4 | clouds 64 s + shadow | §4 | glint |
| **ice** | 28 · 28 · 176 · 352 × 56 · 140 s | n fractal 0.034/6/41 · m fractal 0.06/4/47 · v turbulence 0.09/1/43 (the SVG carries it as signed fractal s, v = \|2s − 1\|) | glacier `#5E9BDB` −40 n + 18.6 · melt `#3FC1DE` 16 m − 9.12 in glacier · snow `#FFFFFF` 30 n − 17.4 · lineae `#4A8AD0` −40 v + 1.8 · cores `#2A4A70` −70 v + 1 × 0.55 (v1.5.1: 0 at v 0.0143, max α 0.55 — junctions no longer pool into blots) · lit edge `#E6F6FF` wall(lineae, +0.8, −0.8) × 0.3 | — | `#FFFFFF` 0.22 · 0.20 · `#8FD0FF` 0.40 → `#E6F6FF` 0.62 · `#BFE3FF` / `#8FD0FF` 0.95 | caps `#F4F8FF` noisy (v1.5.1): `{ reach: 0.36, field: 0, tau: 0.222, slope: 12 }`, mean edge 28 % of H, ±4 px |
| **lava** | 26 · 26 · 163 · 326 × 52 · 95 s | n fractal 0.04/6/53 · v turbulence 0.07/1/59 (SVG: signed fractal s, v = \|2s − 1\|) · m fractal 0.07/4/61 (v1.5.1: the w field is retired) | crust: plates `#664438` 18 n − 9 · basalt `#1E1414` −18 n + 7.2 · ash `#8A6450` 14 n − 8.68 | **emissive strip** (same phase, drawn after the overlay): bloom `#FF6A2A` blur 0.8 × 0.5 under · fine `#FF6A2A` contour(n, 0.5, 0.013) × 0.6 (v1.5.1: glowing cracks round the cooled plates) · vein `#FF6A2A` −30 v + 1.9 · hot `#FFC857` −50 v + 1.1 · lake `#FF6A2A` 24 m − 16.32 in basalt · lake hot `#FFC857` 24 m − 17.28 in basalt; pulse α 0.85 + 0.15 cos(2π t / 5); limb mask 0.8 r α 1 → r α 0.55 | emissive recipe: 0 `#FFD9B0` 0.26 · 0.32 0 · 0.64 `#1E1414` 0 · 0.705 α 0.45 · 0.76 `#050B1E` 0.80 · 0.84 0.97 · 1 1; haze `#FF8C2E` 0.26 → `#FFB347` 0.42 (from 0.80); rim `#FFB347` / `#FF8C2E` 0.70 / 0.3 | halo sprite r 1.4 r: `#FF8C2E` 0 α 0.20 · 0.714 0.20 · 0.78 0.10 · 0.88 0.035 · 1 0 |
| **toxic** | 32 · 32 · 201 · 402 × 64 · 120 s | n fractal 0.032/6/29 · d fractal 0.055/3/31 | lowland `#164A1E` −16 n + 7.52 × 0.9 · upland mask 14 n − 6.5 (not painted) · acid `#C8DC3C` 14 d − 7.34 in upland × 0.85 · ridge `#5FA632` 12 n − 6.94 × 0.6 | clouds 75 s, α 0.92: swirl w fractal 0.010/2/43 (opaque); lower deck fractal `0.026 0.08`/5/47 displaced by w × 10, field blur 0.2, `#BFD83C` 20 c − 9.93 × 0.85, blur 0.2; shadow = upper mask shifted (−1.2, +1.2), blur 0.45 (the only softer copy), `#0B2410` × 0.45; upper deck fractal `0.03 0.085`/6/37 displaced by w × 20, field blur 0.2, `#EEF7C2` 26 c − 14.27, blur 0.2 (v1.5.1: field blur 0.6 → 0.2, slopes 22 / 16 → 26 / 20, the reference cloud crispness) | `#F4FFD6` 0.22 · 0.20 · `#C7E97A` 0.40 → `#E4F7B0` 0.62 · `#DDF59A` / `#A8D850` 0.95 | no caps; clouds tile x 94 at t = 0 |
| **cracked** | 27 · 27 · 170 · 340 × 54 · 100 s | n fractal 0.038/6/41 · d fractal 0.07/3/53 · k fractal 0.035/4/61 · k2 fractal 0.075/3/67 | basins `#1E2742` −22 n + 9.9 × 0.85 · plates `#5D72A2` 18 d − 9.58 × 0.55 · frost `#A4B8DE` 18 n − 10.3 × 0.55 · glow `#FF8C2E` contour(k, 0.5, 0.025) blurred 0.9 × 1.2 · fine `#FFC857` contour(k2, 0.5, 0.0083) × (10 k2 − 4.7) × 0.4 · line `#FFC857` contour(k, 0.5, 0.0125) × 0.95 · core `#FFF1C2` contour(k, 0.5, 0.005) × 0.9 | **night cracks**: the four crack zones again as a transparent strip (same phase), drawn after the overlay at α 0.6, clipped to the dark half (mask along −L: 0 at +0.5 r·L → 1 at −0.5 r·L, baked into a copy of the overlay-sized mask) | `#D2DEF6` 0.30 · 0.14 · `#8FA3C9` 0.30 → `#B8CAEE` 0.50 · `#B8CAEE` / `#8FA3C9` 0.95 | static glow, no pulse |
| **gasBanded** | 44 · 44 · 276 · 552 × 88 per group | per group: wave fractal `0.014 0.09`/4/31, 37, 41 (contrast ×2) · streak fractal `0.008 0.32`/3/5, 13, 17 | band LUT (below): C brown −8..9 · tan 9..54 · cream 54..69 · tan 69..79 · brown 79..96; B cream 18..31 · dark 31..46; A tan 40..49 · brown 49..58 — `#BE6830` / `#EBA75E` / `#F8DDB0` / `#7C3C1E`; streaks light `#FFF0D2` 14 s − 8.04 × 0.3, dark `#6E331A` −14 s + 5.6 × 0.32 | groups C 180 s +P, B 110 s −P, A 150 s +P; storm `#E4512A` 6.16 × 3.52 at strip (98.6, 28.6) and (374.6, 28.6), collar `#8E3518` 0.8 px α 0.7, eye `#F8DDB0` 3.4 × 1.8 α 0.45, glint `#FFF0D2` 1.5 × 0.8 α 0.6 at (+0.6, −0.3) | `#FFF3DE` 0.20 · 0.24 · `#F5D7B0` 0.38 → `#FFE6C4` 0.60 · `#FFE3BC` / `#F2B877` 0.95 | wave displacement 9 → ±4.5 px, blur 0.25 (the LUT's 1 px anti-alias stands in) |
| **gasRinged** | 44 · 44 · 276 · 552 × 88 per group | wave seeds 43 / 47 · streak seeds 21 / 29 | A mid −8..10 · light 10..54 · cream 54..69 · light 69..78 · mid 78..96; B cream 19..29 · dark 29..37 · mid 51..59 — `#58B0A3` / `#8FD9C9` / `#DDF8F1` / `#2A7A73`; streaks `#EFFFFA` / `#1F5F59` | A 160 s +P, B 120 s −P | `#E8FFFA` 0.20 · 0.22 · `#BFE8E0` 0.38 → `#DDF7F1` 0.60 · `#D3FBF2` / `#8EDCCC` 0.95 | static ring (below) |
| **moon** | 14 · 14 · 88 · 176 × 28 · 180 s | n fractal 0.06/6/7 · h fractal 0.11/4/11 · p fractal 0.30/1/9 | shelf `#7A7694` −36 n + 18 × 0.5 · maria `#4B4866` −40 n + 18.2 × 0.9 · upland 14 n − 6.36 (mask) · bright `#DDD9EC` 28 h − 15.74 in upland × 0.5 · pits `#3C3955` 30 p − 18.79 × 0.6; + 37 baked craters (rim `#EFECF8` α 0.75, bowl `#3C3955` 0.95 / 0.75 / 0.5) | — | airless: `#F4F2FC` 0.24 | no haze, rim, caps |
| **dwarf** | 10 · 10 · 63 · 126 × 20 · 160 s | n fractal 0.09/6/13 · h fractal 0.07/3/19 · p fractal 0.28/1/17 | shelf `#A8744C` −36 n + 17.64 × 0.55 · dark `#6A402A` −40 n + 17.8 × 0.85 · upland 14 n − 6.08 · plains `#F6EBD6` 28 h − 15.18 in upland × 0.9 · pits `#573522` 30 p − 18.79 × 0.5; + 8 baked pits (rim `#F6EBD6` α 0.7, bowl `#573522`) | — | airless: `#FFF6E6` 0.18 | |
| **double** | big 18 · 18 · 113 · 226 × 36 · 80 s; small 11 · 11 · 69 · 138 × 22 · 60 s | big: n fractal 0.05/6/29 · i fractal 0.05/5/21 · cap warp fractal 0.09/4/5; small: n 0.10/6/31 · h 0.08/3/37 · p 0.30/1/33 | big: deep `#1B4FA8` −18 n + 8.55 × 0.85 · shallows `#4CC0E4` 10 n − 5.35 (0 at 0.535, full at 0.635) · ice `#EAF6FF` 60 i − 36.1 × 0.95; caps `#F2F8FF` 16 % solid α 0.95, edges displaced (scale 6, blur 0.2). small: shelf `#B06A38` × 0.5 · dark `#6E3A1E` × 0.85 · bright `#F2C994` 28 h − 15.32 in upland × 0.7 · pits `#5A2E16` × 0.5; + 9 craters (rim `#F6D2A2` α 0.7) | — | big: `#E6F2FF` 0.26 · 0.24 · `#9CCBFF` 0.42 → `#CFE6FF` 0.65 · `#BFE3FF` / `#8CC4FF` 0.95; glint `#FFFBEE` 3.4 × 1.9 α 0.5. small: airless `#FFF0DC` 0.24 | orbit 40 s (below) |
| **planetX** | 30 · 30 · 188 · 376 × 60 · 120 s | §4 `PLANET_X` | §4 | wisps 80 s + shadow | §4 | live halo + ring; caps noisy (v1.5.1, §4 `PLANET_X`) |

**v1.5.1 SVG strips (planet X, ice, lava, icy moon).** These four SVGs no longer use `stitchTiles` + `feTile`: Chrome evaluated the stitched tile differently depending on clipping/culling and transforms, and drew a straight-edged block (planet X) or straight lineae and plate edges (lava, icy moon) at the period boundary. They now blend two unstitched noise copies across each period (rect A = N(u), rect B = N(u − P) through a 0 → 1 alpha ramp, contrast kept by a (1 + 0.5 c) scale — see the `planet-x.svg` header) and threshold the result in a pointwise filter. This is an SVG rendering fix only: Canvas strips are built from wrapping value-noise tiles (§0), which are seamless by construction, so the fields and zones above apply unchanged; only the noise *phase* differs, so a Canvas build matches the SVG's character, not its exact pixels.

Intercepts above that the headers give as thresholds are converted with `intercept = 0.5 − slope · threshold` (alpha 0.5 at the threshold) or, for "alpha 1 below a, 0 at b", `slope = −1 / (b − a)`, `intercept = b / (b − a)`.

### Lighting variants
- **Atmosphere** (`ATMO_LIT` + haze + rim): ocean, ice, toxic, cracked, rocky, both gas giants, double.big, planet X, and the ringed planets (§4d).
- **Airless** (`AIRLESS_LIT`, no haze, no rim): moon, dwarf, double.small, the four v1.4 moons (the icy and volcanic moons add a rim, §4c). Radius 1.25 r like the others (the v1.3 1.5 r is retired).
- **Emissive** (lava): the shade above, plus the emissive strip drawn **after** the overlay through a cached limb mask. Per frame: `drawImage(halo)` → `drawPlanet` (crust) → emissive: clear a small scratch disc buffer, draw the emissive strip into it at the crust's offset, `destination-in` the cached limb-mask sprite (radial 0.8 r α 1 → r α 0.55), blit the buffer at `globalAlpha = 0.85 + 0.15 cos(2π t / 5)` — 1 + 4 + 3 draws, ≈ 0.12 ms.
- **Cracked night**: an optional third blit of the crack-only strip at α 0.6 through the same scratch-buffer trick with a cached "dark-half" mask — or skip it; the lit cracks carry the look.

### Craters (moon, dwarf, double.small) — baked geometry
Plain circles drawn into the surface tile **after** the zones, at x and x + P: an outer circle R in the crater-rim colour (α 0.75 moon, 0.7 others), and a bowl 0.82 R offset (+0.18 R, −0.18 R) toward L, filled with a linear gradient from its upper-right (pit α 0.95) through 0.55 (α 0.75) to its lower-left (α 0.5). Tables in the headers (moon 37 · `0x4D4F4F`, dwarf 8 · `0x445741`, double.small 9 · `0x534D4C`).

```ts
function bakeCrater(g: CanvasRenderingContext2D, x: number, y: number, R: number, rim: string, rimA: number, pit: string,
                    lx: number, ly: number): void {
  g.fillStyle = rgba(rim, rimA); g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
  const bx = x + 0.18 * R * lx, by = y + 0.18 * R * ly, b = 0.82 * R;
  const lg = g.createLinearGradient(bx + b * lx, by + b * ly, bx - b * lx, by - b * ly);
  lg.addColorStop(0, rgba(pit, 0.95)); lg.addColorStop(0.55, rgba(pit, 0.75)); lg.addColorStop(1, rgba(pit, 0.5));
  g.fillStyle = lg; g.beginPath(); g.arc(bx, by, b, 0, Math.PI * 2); g.fill();
}
```

### Gas giants — band look-up tables (gasBanded, gasRinged, ring-saturn, ring-shepherd)
All four giants are the same construction in Canvas: each band group is a strip whose pixel colour is a **look-up by latitude**, the latitude offset by a periodic wave field — the SVG's displacement map (gasBanded / gasRinged, `y ← R`, scale 9, contrast ×2) and its look-up-table latitude field (ring-saturn / ring-shepherd, `lat + amp · (n − 0.5)`) both reduce to `yy = y + A · (c(n) − 0.5)`. Band edges get a 1 px linear anti-alias (the SVGs' 0.25 blur / one-entry-per-px tables), so they are crisp at every zoom. Tinted zonal streaks go on top as two zones; storms and other discrete features are baked at x and x + P.

```ts
interface BandGroup {
  bands: [number, number, string][];      // [y0, y1, colour] in strip px (0 = north pole), overdraw included
  wave: NoiseDef; A: number; contrast: number;   // yy = y + A·(clamp((n − 0.5)·contrast + 0.5) − 0.5)
  streaks?: { field: NoiseDef; light: string; dark: string; lightZone: [number, number, number]; darkZone: [number, number, number] }; // [slope, intercept, cap]
  opaqueBase: string | null;              // the first group carries the planet's base colour; later groups are transparent outside their bands
  period: number; dir: 1 | -1;            // s per turn; +1 offset grows (left → right), −1 shrinks
}
// gasBanded C: A 9, contrast 2 · ring-saturn: A = 0.12 · 104 = 12.5, contrast 1 · ring-shepherd: A = 0.10 · 68 = 6.8, contrast 1.

function buildBandTile(gr: BandGroup, Hstrip: number, W: number, H: number, k: number): HTMLCanvasElement {
  const n = svgField(gr.wave, W, H, W, k), u = H / Hstrip;                  // u: strip px → device px
  const img = new ImageData(W, H), d = img.data;
  const base = gr.opaqueBase ? hexRGB(gr.opaqueBase) : null;
  const cols = gr.bands.map((b) => hexRGB(b[2]));
  const S = gr.streaks ? svgField(gr.streaks.field, W, H, W, k) : null;
  const L = gr.streaks ? hexRGB(gr.streaks.light) : null, D = gr.streaks ? hexRGB(gr.streaks.dark) : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x;
    const yy = y / u + gr.A * (clamp01((n[j] - 0.5) * gr.contrast + 0.5) - 0.5);
    let r = base ? base[0] : 0, g = base ? base[1] : 0, b = base ? base[2] : 0, a = base ? 1 : 0;
    for (let i = 0; i < gr.bands.length; i++) {                             // later bands win; 1 px anti-aliased edges
      const [y0, y1] = gr.bands[i], cov = clamp01(Math.min(yy - y0, y1 - yy) * u + 0.5);
      if (cov <= 0) continue;
      const c = cols[i]; r += (c[0] - r) * cov; g += (c[1] - g) * cov; b += (c[2] - b) * cov; a = cov + a * (1 - cov);
    }
    if (S && L && D && a > 0) {                                             // tinted streaks, cropped to the bands
      const s = gr.streaks!, al = ramp(S[j], s.lightZone[0], s.lightZone[1]) * s.lightZone[2];
      const ad = ramp(S[j], s.darkZone[0], s.darkZone[1]) * s.darkZone[2];
      r += (L[0] - r) * al; g += (L[1] - g) * al; b += (L[2] - b) * al;
      r += (D[0] - r) * ad; g += (D[1] - g) * ad; b += (D[2] - b) * ad;
    }
    d[j * 4] = r; d[j * 4 + 1] = g; d[j * 4 + 2] = b; d[j * 4 + 3] = a * 255;
  }
  const t = document.createElement("canvas"); t.width = W; t.height = H;
  t.getContext("2d")!.putImageData(img, 0, 0);
  return t;
}
```

Per frame a giant is 1 clip + one blit per band group (each with its own signed phase: `phase = frac(phase + dir · dt / period)`) + 1 overlay. **gasRinged's ring** (static): two cached sprites per bucket built in ring space `rotate(−22°) scale(1, 0.28)` — the radial gradient of hard-stepped ringlets from `style.md` §8 (two stops per boundary), the back sprite with the planet's shadow (half-ellipse 117 × 44 rotated 230°, `#050710` α 0.85, blur 0.5 × 1.5 in ring space, masked by the ring profile normalised to 0.86) and with the front half-disc (r 1.12 r = 49.28 in ring orientation) erased; the front sprite = the ring clipped to that half-disc. Back sprite → planet → front sprite: **2 extra blits**.

### Double planet — orbit, z-order swap
Unchanged since v1.3: T = 40 s, clockwise; small at (30.94 cos θ, 0.36 · 30.94 sin θ), big at (−7.06 cos θ, −0.36 · 7.06 sin θ) from the barycentre; the small body is in front while sin θ ≥ 0. Lighting stays fixed; only the centres move. Crash discs 18 and 11 at the moving centres.

```ts
function drawDoublePlanet(ctx: CanvasRenderingContext2D, bx: number, by: number, zoom: number, tS: number,
                          big: PlanetStrips, bigSpin: Spin, small: PlanetStrips, smallSpin: Spin): void {
  const th = ((tS % 40) / 40) * Math.PI * 2;
  const sxS = bx + 30.94 * zoom * Math.cos(th), syS = by + 30.94 * 0.36 * zoom * Math.sin(th);
  const sxB = bx - 7.06 * zoom * Math.cos(th),  syB = by - 7.06 * 0.36 * zoom * Math.sin(th);
  const front = Math.sin(th) >= 0;
  if (!front) drawPlanet(ctx, small, smallSpin, sxS, syS, zoom);
  drawPlanet(ctx, big, bigSpin, sxB, syB, zoom);
  if (front) drawPlanet(ctx, small, smallSpin, sxS, syS, zoom);
}
```

### Per-scene draw order and L
A level names its star and its bodies; `towardStar` gives each body its L when its overlay is built (the library assets use the upper-right L because the gallery has no star; the scene mockups wrap only a body's lighting layers in `rotate(angle(L_scene) − angle(L_library))`). Draw order is §0's.

---

## 4c. Moons & orbits (v1.4)

The four v1.4 moons (`moon-icy.svg`, `moon-volcanic.svg`, `moon-captured.svg`, `moon-system.svg`) are small planets on the §4 pipeline with **airless** lighting (`AIRLESS_LIT`); orbits are computed positions with a z-order rule, never rotations of the lit sprite. Tokens: `style.md` §8 "Moons".

| Moon | r · P · strip · period | Fields → zones (header values) | Light | Extra per frame |
|---|---|---|---|---|
| Icy (`mi*`) | 12 · 75 · 150 × 24 · 150 s | n fractal 0.11/6/41: blue ice `#7FA6E0` 36 n − 20.88 × 0.9 · frost `#FFFFFF` −36 n + 14.4 · chaos `#C4987C` 30 l − 20.1 × 0.78 (v1.5.1: from the lineae field l below, so chaos patches sit inside the l = 0.57 lineae; the separate fractal 0.06/6/43 is retired) · k fractal 0.07/5/47: crack halo `#7FA6C9` contour(k, 0.5, 0.035) × 0.7 · crack core `#4E78A8` contour(k, 0.5, 0.014) × 0.95 · l fractal 0.05/4/53: lineae `#A5684E` contour(l, 0.44, 0.009) and contour(l, 0.57, 0.009) × 0.85 | airless, bloom `#FFFFFF` 0.28; rim r 12.92 `#BFE3FF` 0.90 α 0 · 0.928 α 0.75 · 0.955 α 0.30 · 1 α 0, × lit mask | — |
| Volcanic (`mv*`) | 13 · 82 · 164 × 26 · 120 s | n fractal 0.075/6/61: frost `#F6EBA8` 30 n − 17.4 × 0.85 · orange `#E0892E` −30 n + 12.9 × 0.8 · f fractal 0.055/6/67: dark flows `#8C6A2A` 30 f − 18 × 0.9 · lava `#3A2A2A` 30 f − 20.1 × 0.85 · s fractal 0.30/2/71: specks `#3A2A2A` 40 s − 27.2 × 0.75; polar bands 4 px `#A0603A` α 0.55 → 0; 5 calderas baked at x and x + P (plume ring 0 `#D9622B` α 0.15 · 0.55 α 0.22 · 0.8 `#C9502A` α 0.62 · 1 α 0; vent r 1 `#3A2A2A`) | airless, bloom `#FFF6D8` 0.30; rim r 14 `#FFE08A` peak α 0.70, 0.955 α 0.28 | **hot spots** after the overlay (below) |
| Captured (`mc*`) | mean 9, non-circular, no strip | albedo (rotating): base `#7E7468`; warm `#A07E5A` (fractal 0.16/6/83, 30 n − 16.8, × 0.85); rust `#8A5A3C` (ejecta field < 0.39, × 0.6); dark `#3E3833` (< 0.42, × 0.6); ejecta `#C9BBA8` (fractal 0.22/6/89, 30 e − 18.6, × 0.7); grooves `#3E3833` (contours 0.46 / 0.56, half 0.012, of fractal `0.035 0.2`/4/97, × 0.6); specks `#3E3833` (fractal 0.45/2/101, 40 s − 27.6, × 0.7); 10 craters | shape-aware filter (below) | **36 lit frames** per 70 s tumble |
| System (`ms*`) | planet 26 · 163 · 326 × 52 · 110 s; moon A 5 · 31 · 30 s; moon B 7 · 44 · 52 s | planet = rocky zones re-tuned for r 26 (sand `#F0C47E` 30 du − 16.5 × 0.9 · rust `#B04A22` 18 ru − 10.08 × 0.9 · basalt `#6B3820` −30 n + 12.6 · plateau `#F7D8B0` 18 n − 11 × 0.85 · pits `#6B3820` 40 cr − 26.4 × 0.85 · walls ±1 px × 0.7 / 0.6); moon A icy (fractal 0.2/6/41 blue ice / frost; cracks contour(0.5, 0.02) of fractal 0.16/5/47 `#4E78A8` × 0.9); moon B asteroid (warm / dark / ejecta as the captured moon; pits fractal 0.3/2/37 36 p − 23.4 × 0.8, walls 0.8 px) | planet: atmosphere, bloom `#FFF0DC` 0.32, warm 0.26, haze `#E8B07A` 0.30 → `#FFD9B0` 0.48, rim `#FFD9B0` / `#E8B07A` 0.75 / 0.3; A airless bloom `#FFFFFF` 0.28 + rim `#BFE3FF` 0.75; B airless bloom `#E8DCC8` 0.30 | orbits, eclipse discs, orbit lines (below) |

### Volcanic hot spots — five independent pulses
The SVG draws an emissive strip whose five calderas pulse out of step (α 0.55 ↔ 1 over 6 s, begins 0 / −2 / −4 / −6 / −8 s). One strip blit cannot carry five alphas, so Canvas draws each **visible** caldera's hot spot as its own tiny sprite (r 1.5: 0 `#FFC857` · 0.3 `#FF6A2A` α 0.95 · 1 `#FF6A2A` α 0) at the caldera's current position, inside the disc clip, after the overlay — 1–3 are visible at a time, ≈ 0.01 ms.

```ts
const MV_CALDERAS: [number, number][] = [[14, 9], [31, 21], [43, 14], [57, 20.5], [68, 6.5]];   // strip px on the 82 × 26 tile
let mvHot!: HTMLCanvasElement;                                                                      // 3 × 3 CSS px sprite at the bucket × DPR

function drawVolcanicHotSpots(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, surfacePhase: number, tS: number): void {
  const r = 13 * zoom, P = 82 * zoom, s = 3 * zoom;
  ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
  for (let i = 0; i < MV_CALDERAS.length; i++) {
    const [cx, cy] = MV_CALDERAS[i];
    for (const rep of [0, P]) {                                                     // each caldera exists at x and x + P
      const x = sx - r - P + surfacePhase * P + cx * zoom + rep, y = sy - r + cy * zoom;
      if (Math.abs(x - sx) > r + s) continue;
      ctx.globalAlpha = 0.775 - 0.225 * Math.cos(((tS + 2 * i) / 6) * Math.PI * 2);   // 0.55 ↔ 1, begin −2 i s
      ctx.drawImage(mvHot, x - s / 2, y - s / 2, s, s);
    }
  }
  ctx.restore();
}
```

(`x` is the caldera's screen position for the same strip offset `drawPlanet` uses: the window starts at the disc's left edge `sx − r`, minus P, plus the phase.)

### Captured moon — tumble with fixed light, baked as frames
The SVG rotates the albedo and computes the light afterwards from the silhouette (filter `#mcLight`). Canvas bakes that into **36 frames** (every 10°) per bucket; per frame it draws the two frames around the current angle and blends them in a 30 × 30 px scratch buffer with `"lighter"` (exact cross-fade, as §3's flames) — or simply the nearest frame (10° steps are 2 s apart at 70 s per turn). Frame build, per angle θ:

1. **Albedo**: rotate by θ; fill the silhouette (16 radii at 22.5°, raw `11.8 11 9.2 7.8 7.3 7.6 8.4 10.2 11.4 10.6 8.2 6.6 6.9 7.2 8 10.4` × 1.0108, closed Catmull-Rom → cubic Béziers) with `#7E7468`; paint the zones in the rotated frame (fields fixed to the body); draw the 10 craters at their rotated positions with the bowl offset (+0.15 R, −0.15 R) applied **after** rotation (it always points at the light).
2. **Light** in the fixed frame, from the silhouette alpha S: lit mask M = blur(S shifted (+2.6, −2.6), 0.6); volume V = blur(S shifted (+1.6, −1.6), 2.4); albedo × (0.6 + 0.45 V); warm band = (M − M′) with M′ = S shifted (+3.2, −3.2) blurred 0.6, `#FF9455` α 0.2; night `#050B1E` α 0.97 × (1 − M); lit edge = S · (1 − S shifted (−0.9, +0.9)) · M, `#E6D8C4` α 0.7; all × S.

36 frames × 30² CSS px × DPR² ≈ 0.5 MB at DPR 2; build ≈ 12 ms once. Crash: a circle of the mean radius 9 (a polygon test is an optional refinement).

### Moon system — orbits, z-order, eclipses, orbit lines
Each moon moves on an inclined ellipse; its frame never rotates, so its overlay stays lit from the upper-right (or toward the scene's star). Positions: θ(t) = θ₀ + 2π t / T; in the orbit plane (A cos θ, B sin θ), then rotated by the inclination φ. The moon is **in front** of the planet while sin θ ≥ 0 (the lower half of the ellipse), behind otherwise; the swap happens at the ellipse ends, 50 / 96 px from the planet centre, well clear of the disc.

| Moon | r | A × B | φ | T | θ₀ | P · strip period |
|---|---|---|---|---|---|---|
| A (inner, icy) | 5 | 50 × 15 | −14° | 30 s | 60° | 31 · 30 s (tidally locked) |
| B (outer, asteroid) | 7 | 96 × 21.12 | +8° | 52 s | 200° | 44 · 52 s |

```ts
interface Orbit { A: number; B: number; phi: number; T: number; th0: number }           // px at zoom 1, degrees, s, degrees
const MS_ORBITS: Orbit[] = [{ A: 50, B: 15, phi: -14, T: 30, th0: 60 }, { A: 96, B: 21.12, phi: 8, T: 52, th0: 200 }];

function orbitPos(o: Orbit, tS: number): { x: number; y: number; front: boolean } {
  const th = ((o.th0 + (360 * tS) / o.T) * Math.PI) / 180, p = (o.phi * Math.PI) / 180;
  const ex = o.A * Math.cos(th), ey = o.B * Math.sin(th);
  return { x: ex * Math.cos(p) - ey * Math.sin(p), y: ex * Math.sin(p) + ey * Math.cos(p), front: Math.sin(th) >= 0 };
}

// planet: the r 26 rocky planet (§4); moons[i]: §4 strips of the two moons; arcsBack / arcsFront: cached orbit-line sprites
// (1 px #ECF0FA α 0.08, dash 2 6, the back half-ellipses through the top / the front halves), 360 × 260 CSS px each.
function drawMoonSystem(ctx: CanvasRenderingContext2D, cx: number, cy: number, zoom: number, tS: number,
                        planet: PlanetStrips, pSpin: Spin, moons: PlanetStrips[], mSpins: Spin[],
                        arcsBack: HTMLCanvasElement, arcsFront: HTMLCanvasElement, eclipse: HTMLCanvasElement): void {
  const w = 360 * zoom, h = 260 * zoom;
  const pos = MS_ORBITS.map((o) => orbitPos(o, tS));
  ctx.drawImage(arcsBack, cx - w / 2, cy - h / 2, w, h);
  for (const i of [1, 0]) if (!pos[i].front) drawPlanet(ctx, moons[i], mSpins[i], cx + pos[i].x * zoom, cy + pos[i].y * zoom, zoom);   // back: B, A
  drawPlanetWithEclipses(ctx, planet, pSpin, cx, cy, zoom, pos, eclipse);
  ctx.drawImage(arcsFront, cx - w / 2, cy - h / 2, w, h);
  for (const i of [0, 1]) if (pos[i].front) drawPlanet(ctx, moons[i], mSpins[i], cx + pos[i].x * zoom, cy + pos[i].y * zoom, zoom);   // front: A, B
}

// Eclipse shadows: inside the planet clip, after the strips, BEFORE the overlay — a cached disc sprite of the moon's radius
// (radial #050B1E 0.7 α 0.6 → 1 α 0), offset (−3.5, +3.5) away from L, only while that moon is in front.
function drawPlanetWithEclipses(ctx: CanvasRenderingContext2D, st: PlanetStrips, spin: Spin, sx: number, sy: number, zoom: number,
                                pos: { x: number; y: number; front: boolean }[], eclipse: HTMLCanvasElement): void {
  const k = zoom / st.zoom, r = st.r * k, P = st.P * k;
  ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(st.surface, sx - r - P + spin.surface * P, sy - r, 2 * P, 2 * r);
  const radii = [5, 7];
  for (let i = 0; i < pos.length; i++) {
    if (!pos[i].front) continue;
    const d = 2 * radii[i] * zoom;
    ctx.drawImage(eclipse, sx + (pos[i].x - 3.5) * zoom - d / 2, sy + (pos[i].y + 3.5) * zoom - d / 2, d, d);
  }
  ctx.restore();
  const s = st.size * k;
  ctx.drawImage(st.overlay, sx - s / 2, sy - s / 2, s, s);
}
```

When the system is placed in a level, the eclipse offset points away from the scene's star (−3.5 · L̂ scaled to 4.95 px), like the overlays. Crash discs: planet 26, moons 5 and 7 at their current positions; a path prediction must sample the moons' deterministic positions over time. Per frame: 2 orbit-line blits + 3 planets (each 1 clip + 1–2 blits + 1 overlay) + ≤ 2 eclipse blits ≈ 0.3 ms.

---

## 4d. Rings & particles (v1.4)

`ring-saturn.svg`, `ring-debris.svg`, `ring-shepherd.svg` (and the v1.3 `gas-ringed.svg`, §4b). The SVG draws the ring material **twice**: a back pass before the planet (through the planet-shadow mask) and a front pass after it, clipped to the lower half of the planet disc in ring orientation. Canvas does the same with cached sprites; moving material is a **ring-plane sprite** drawn with `translate → rotate(roll) → scale(1, opening) → rotate(phase)` under a half-plane clip — the black hole's trick (§3c). Shadows are static in screen space and baked.

**Ring space.** `rotate(roll) · scale(1, k)`: Saturn roll −22°, k 0.31 (opening 18°); debris −32°, 0.42 (25°); shepherd −24°, 0.26 (15°). The half-plane split is the ring's own major axis: in ring space y < 0 is the back, y ≥ 0 the front, and the front clip is the lower half of the **planet disc** (radius r), so the planet edge and the clip edge coincide and no seam appears.

| Ringed planet | Static sprites (per bucket) | Moving material | Draws per frame (ring only) |
|---|---|---|---|
| Saturn | **back**: the 6 density strokes (centre / width in r: 1.37 / 0.22 `#B49A76` α 0.40 · 1.53 / 0.10 `#EAD7B4` 0.68 · 1.65 / 0.14 `#F2E6D2` 0.86 · 1.855 / 0.15 `#D9BF92` 0.66 · 2.015 / 0.13 `#D8C9AE` 0.52 · 2.16 / 0.012 `#F2E6D2` 0.60) + ringlet grain (13 hard ringlets `#FFF6E6` / `#6E5A40`) + the planet's shadow (half-ellipse 91.1 × 44 rotated −148.3° in ring space, `#050710` α 0.85, blur 0.8 in ring space), drawn in ring space; **front**: the same strokes and grain, lower half (ring-space y ≥ 0); the planet's **ring-shadow bands** (`#050B1E` α 0.25 / 0.62 / 0.45 for 1.26–1.48 / 1.48–1.72 / 1.78–2.08 r) are baked into the planet's overlay, under the terminator | 370 particles `#FFFFFF` r 0.4–0.75, α 0.3–0.6 in 3 Keplerian sub-rings (60 / 90 / 130 s, 150 / 120 / 100 particles) — each sub-ring one circular ring-plane sprite | **6 (default)**: back particles (inner, merged mid + outer) → back band sprite (bands + shadow, drawn **over** the back particles so the shadow darkens them too) → planet → front band sprite → front particles × 2. Exact variant: 3 sub-rings → 8 draws |
| Debris | dust band (ring space, `#C9BBA8` 1.45 r 0 · 1.6 0.10 · 1.75 0.14 · 1.9 0.10 · 2.05 0) back with the planet shadow (58.2 × 24, −149.9°, α 0.85, blur 0.6) and front; ring-shadow bands on the planet in its overlay (1.6–1.9 r α 0.28, dust 1.5–2.0 r α 0.10) | 21 rock **clump sprites** (108 rocks, 7–10-vertex polygons r 0.8–2.2, shading `#C9BBA8` → `#7E7468` ‖ `#3E3833` along the upper-right → lower-left diagonal) carried along the ellipse **without rotating** (their light stays upper-right): inner 1.60–1.75 r / 45 s / 11 clumps, outer 1.75–1.90 r / 70 s / 10 clumps; dust specks (`#C9BBA8` r 0.3–0.55) as 2 rotating ring-plane sprites | 2 dust-band blits + 4 speck-ring draws + 21 clump blits (rocks follow the §4e rock budget: ≈ 0.002 ms each) |
| Shepherd | two 1 px rings `#ECF0FA` α 0.7, drawn as **screen-space** ellipses (rotate −24° only: r 45.5 / 57.2, ry 11.83 / 14.87) so the hairline stays 1 px; back half with the planet shadow (60.1 × 26, −146.9°, blur 0.6), front half; ring-shadow hairlines on the planet (R ± 0.6 px, `#050B1E` α 0.55) in its overlay | 2 shepherd moons r 2.5 (`#DCE4FF`, crater `#7FA6C9` α 0.8, hard terminator: centre (0.64, −0.64) r 3.12, 0 `#FFFFFF` α 0.5 · 0.32 α 0 · 0.64 `#FF9455` α 0 · 0.71 α 0.22 · 0.76 `#050B1E` α 0.8 · 0.84 α 0.97 · 1 α 1) at ring radius 54 / 60.4, 36 s / 40 s, start 35° / 205° — positioned, never rotated; behind the planet while in the back half | 2 ring blits + 2 moon blits |

```ts
// One circular ring-plane sprite (particles or specks), drawn as the back (ring-space y < 0) or front (y ≥ 0) half.
// cx, cy = planet centre; roll in radians (−22° → −0.384); k = opening (0.31); phase = −2π t / period (prograde).
function drawRingHalf(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, sizeCss: number, cx: number, cy: number,
                      zoom: number, roll: number, k: number, phase: number, back: boolean): void {
  const R = sizeCss * zoom;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(roll);
  ctx.beginPath(); ctx.rect(-R, back ? -R : 0, 2 * R, R); ctx.clip();   // the half-plane split along the ring's major axis
  ctx.scale(zoom, zoom * k); ctx.rotate(phase);                        // squash outside, rotation inside: elliptical motion
  ctx.drawImage(sprite, -sizeCss / 2, -sizeCss / 2, sizeCss, sizeCss);
  ctx.restore();
}
```

Canvas splits by the **half-plane** (back half before the planet, front half after it) instead of the SVG's "whole ring behind, front half-disc in front": the result is the same wherever ring and planet overlap, the static band sprites are made as matching halves (back half with the planet's shadow, front half), and the planet's shadow lies in the back half for all three rolls. The one difference: outside the disc the SVG draws its rim under the back ring, Canvas draws the overlay's rim over it — a 2 px, lit-side-only sliver, invisible at 1×.

**Rocks and moons keep their light.** The SVG carries each clump (or shepherd moon) round its orbit with a counter-rotation, so its own frame never turns or squashes. Canvas computes the position in screen space and blits an upright sprite:

```ts
// Ring-space circle (radius R, angle a) → screen offset from the planet centre.
function ringToScreen(R: number, a: number, roll: number, k: number): [number, number] {
  const u = R * Math.cos(a), v = R * Math.sin(a) * k;                 // squash in ring space
  return [u * Math.cos(roll) - v * Math.sin(roll), u * Math.sin(roll) + v * Math.cos(roll)];
}
// Clump i: a(t) = a0 − 2π t / period (prograde: the near side moves left → right); in the back half while sin(a) < 0.
```

Draw back-half clumps before the planet (darkened by the shadow overlay when inside the planet's shadow wedge — the wedge is static, so test the clump's screen point against the cached wedge polygon and draw it at `globalAlpha` 0.15 there, as the SVG's mask keeps 15 %), front-half clumps after it. Ring sprites, particle sprites and clump sprites all belong to the zoom bucket (§12): the Saturn ring's 0.53 px F ring and 2.6 px Cassini gap would soften first if a ring sprite were upscaled.

Cost per ringed planet (rings only): Saturn 6 draws ≈ 0.12 ms; debris ≈ 0.10 ms; shepherd 4 draws ≈ 0.05 ms. Builds per bucket: ring sprites ≈ 2 ms each (ring space, gradients, shadow blur), particle sprites ≈ 0.5 ms (370 tiny discs), clump sprites ≈ 1 ms in all.

---

## 4e. Debris fields (v1.4)

`asteroid-field.svg` (88 rocks) and `wreck-debris.svg` (20 pieces). Every rock and piece **tumbles while its light stays fixed** (upper-right, or toward the scene's star): the lit sliver along the sunward edges, the warm terminator and the crater walls are re-computed for each angle. A cached sprite rotated with `ctx.rotate` would rotate its light, so Canvas bakes **lit frames** per piece and selects by angle.

| Class | Frames per turn | Draw per frame | Notes |
|---|---|---|---|
| Dust rocks (62, r 1.5–3) | — | **1 dust-layer blit** for all 62 + the haze | at ≤ 6 px a tumble is invisible: bake the dust (lit, at t = 0) and the haze (ellipse 380 × 62 at −18°, `#AAB8DD` 0 α 0.05 · 0.55 α 0.035 · 1 α 0, streaked by fractal `0.006 0.03`/4/41) into one sprite drawn with the belt drift; or bake it into the background if the drift is dropped |
| Small rocks (20, r 4–7) | 16 | nearest frame | 22.5° steps at 35–70 s per turn = one step per 2–4 s, below notice at 8–14 px |
| Large rocks (6, r 9–14) | 24 | 2 adjacent frames blended in a small scratch buffer with `"lighter"` (exact cross-fade, §3) — or nearest | 15° steps at 55–90 s per turn |
| Wreck pieces R ≥ 10 (9) | 36 | 2 adjacent frames, blended | the truss (R 43.9, 200 s) and hull panel (R 36.1, 150 s) need the blend |
| Wreck flakes (10, R 1.8–4) | 12 | nearest frame | |
| Glints (7) | — | 1 glint sprite each at its piece's rotated corner, `globalAlpha` 0.4 + 0.2 sin(2π (t + phase) / period) (3.1–6.4 s) | the glint rides the rotation; it is not lit |

**Rock frame at angle θ** (all from the header's per-rock table: position, rmean, vertices, period, direction, texture, craters):
1. **Silhouette** = the rock polygon rotated by θ (7–11 vertices, angular jitter ±0.3 step, radial ±0.18 r, potato aspect 1.0–1.3, from `mulberry32(0xA57E01D)` — or copied from the markup).
2. **Lit rim**: fill the silhouette with `#C9BBA8`; **face**: the silhouette shifted by a **static** (−s, +s) (s = 0.9 large / 0.6 small), clipped to the silhouette, filled with the rock's texture rotated by θ — A / B / C on `#7E7468`: rust `#B04A22` smoothstep(0.50, 0.60) × 0.70 / 0.40 / 0.16 (fractal 0.07, 3 oct), mottle `#3E3833` smoothstep(0.40, 0.52) × 0.50 / 0.60 / 0.72 (fractal 0.16, 4 oct), ochre `#D8B26E` smoothstep(0.58, 0.66) × 0.42 (same field), specks `#C9BBA8` smoothstep(0.64, 0.70) × 0.65 (fractal 0.70, 1 oct); seeds (mottle, rust, speck) A 3/8/12 · B 5/14/17 · C 9/21/23. The uncovered sliver is the crisp sunward rim at every angle.
3. **Craters** at their rotated positions: lit wall disc `#C9BBA8`, bowl 0.78 rc `#3E3833` offset by a **static** (+0.3 rc, −0.3 rc).
4. **Light** (static, clipped to the silhouette): radial, centre 1.8 rmean outside the rock along L, radius 3.2 rmean: 0.25 `#FFF0DC` α 0.34 · 0.50 α 0.08 · 0.535 `#FF9455` α 0 · 0.575 α 0.20 · 0.597 `#3E3833` α 0.80 · 0.72 `#050B1E` α 0.86 · 1 α 0.92 — a lit half and a shadow half split by one crisp, gently curved terminator.

**Wreck frame at angle θ**: shadow bevel = silhouette `#2A3245`; lit bevel = silhouette shifted static (+s, −s) `#ECF0FA`; face = silhouette shifted (−s, +s) clipped by both the silhouette and its (+s, −s) copy, filled with the rotated brushed-metal pattern (`#8B95B5` with `#ECF0FA` streaks smoothstep(0.56, 0.68) × 0.30 and `#4B5470` (1 − smoothstep(0.32, 0.44)) × 0.40 from fractal `0.03 0.55`/3/13; dark variant `#4B5470` with `#8B95B5` × 0.38 / `#2A3245` × 0.45, seed 19) and the rotated details (seams `#2A3245` 1 px + `#ECF0FA` α 0.35 lip, rivets r 0.6, hazard stripe `#FFC857` hatched `#2A3245`, scorch `#3A2A2A`, puncture `#050710`, solar cells `#5EA0FF` → `#142B5E` → `#0A0D1A`); then the static broad light (centre (0.78, 0.22) of the bounding box, r 1): 0 `#ECF0FA` α 0.34 · 0.38 α 0 · 0.58 `#050B1E` α 0.30 · 1 α 0.66.

```ts
interface Tumbler { x: number; y: number; period: number; dir: 1 | -1; frames: HTMLCanvasElement[]; size: number; blend: boolean }

// angle at time t: dir · 2π t / period; frame index from the angle; two-frame blend through a scratch buffer when blend = true.
function drawTumbler(ctx: CanvasRenderingContext2D, tb: Tumbler, scratch: HTMLCanvasElement, ox: number, oy: number, zoom: number, tS: number): void {
  const n = tb.frames.length, a = frac((tb.dir * tS) / tb.period) * n, i = Math.floor(a) % n;
  const s = tb.size * zoom, x = ox + tb.x * zoom - s / 2, y = oy + tb.y * zoom - s / 2;
  if (!tb.blend) { ctx.drawImage(tb.frames[Math.round(a) % n], x, y, s, s); return; }
  const g = scratch.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, scratch.width, scratch.height);
  g.globalCompositeOperation = "lighter";
  const w = a - Math.floor(a);
  g.globalAlpha = 1 - w; g.drawImage(tb.frames[i], 0, 0, scratch.width, scratch.height);
  g.globalAlpha = w;     g.drawImage(tb.frames[(i + 1) % n], 0, 0, scratch.width, scratch.height);
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, x, y, s, s);
}

// Belt drift: the whole field (dust layer + rocks) moves ±6 px along the axis (−18°) over 60 s, eased.
const beltDrift = (tS: number): [number, number] => {
  const d = 6 * Math.sin((tS / 60) * Math.PI * 2);                     // 0 → +6 → 0 → −6 → 0
  return [d * 0.951, d * -0.309];
};
```

Draw order (`style.md` §9): the dust layer before the bodies, the 26 small / large rocks and the wreck pieces after them. Cost per frame: asteroid field 1 dust blit + 20 single + 6 blended rocks ≈ 0.15 ms; wreck 10 single + 9 blended + 7 glints ≈ 0.12 ms — under the brief's ≈ 0.002 ms per rock and its cap of 120 rocks on screen. Builds per level and bucket: rock frames ≈ 40 ms (6 × 24 + 20 × 16 frames, small canvases; the three textures are built once and drawn rotated), wreck frames ≈ 50 ms (9 × 36 + 10 × 12) — spread over idle time; memory ≈ 6 MB at DPR 2. Gameplay hooks (large rocks and wreck pieces as crash bodies) are **not in scope** (`style.md` §9).

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

Scene details under each overlay (all drawn *before* the scrim, together with the HUD, exactly as `result-win/crash/lost.svg` layer them): win — ship inside planet X's ring, ring at α 1.0 with the pulse and crawl stopped (§4); crash — trail ends at the star's flame ring (r 62, ragged to ≈ 72 — where v1.3 had the corona), no ship, plus a **crash burst** at the impact point: an outer disc r 7 `thrust.outer #FF6A2A` at α 0.45, 6 spark lines 1.5 px wide and 8–14 px long radiating from r 5 at 60° steps, alternating `thrust.core #FFE08A` / `thrust.outer #FF6A2A`, round caps, and a core disc r 3.5 `#FFE08A` on top — held for the first 12 frames, no blur; lost — trail runs off the top-right edge with the ship at the edge.

---


## 12. Zoom, scaling & DPR rules

A single camera `{ x, y, zoom }` maps world → screen: `sx = (wx − cam.x) · zoom + w/2`, `sy = (wy − cam.y) · zoom + h/2`. Everything that is *part of the world* goes through it; everything that is *for the player's eyes* stays in screen pixels.

| Scales with zoom (world) | Fixed in screen px (UI / legibility) |
|---|---|
| Body radii and crash radii; star haze (S · zoom · breathe), flame / wisp rings, disc, prominences (× s), flare | Ship **minimum** size (`max(12, 22·zoom)`) |
| Planet strip and overlay blit sizes (`2P · zoom / bucket`, `size · zoom / bucket`) | Line widths of live strokes: capture ring 1.5, trail 2, path dots r 1.5, arrow 2, ship outline 1 |
| Strip period P = round(2π r) and every texture feature size (cells per P); overlay geometry (shade centre 0.36 r·L, radius 1.25 r, haze r, rim 1.077 r, glint 0.45 r·L) | Dot spacing on the predicted path (10 px) and the 400-dot cap |
| Ring geometry (ring space, opening, roll), particle and clump orbits, moon orbits (A × B), rock and wreck positions, nebula extent (animated mode) | Capture-ring pulse amplitude (±2 px), dash `[6, 6]` and crawl (−12 px/s) |
| Compact-object geometry (black-hole disk 1.4–2.6 r, photon ring 1.09 r, arcs, Einstein ring; neutron beams 3.5 r; white-dwarf glow 6 r, spikes 4 r) | Drag arrow, HUD, fuel bar, buttons, telemetry, result card |
| Strokes **baked** into sprites (prominence strokes, ragged rims, photon ring, Einstein ring, shepherd rings, limb hairlines) — they scale with the sprite and are re-baked per bucket | All periods: rotation, orbit, breathe, pulse, cross-fade — wall-clock seconds, independent of zoom and of 1x / 2x / 4x |

```ts
interface Camera { x: number; y: number; zoom: number }
function worldToScreen(cam: Camera, w: number, h: number) {
  return (wx: number, wy: number): [number, number] => [(wx - cam.x) * cam.zoom + w / 2, (wy - cam.y) * cam.zoom + h / 2];
}
```

The trail (§7) inlines the same formula into preallocated `Float32Array`s. Do not `ctx.scale(zoom, zoom)` the whole scene: it would scale line widths, dash patterns and the ship. Transform positions and radii explicitly; keep the context at DPR scale only.

### Crispness rules for cached sprites (v1.5)

1. **Render at DPR, clamped to [1, 2]** (§0 `clampDPR`). The main canvas, the background and every sprite are built at their CSS size × DPR.
2. **Build at the zoom bucket.** Every world sprite — star haze, ring frames and disc, prominence and flare sprites, compact-object sprites, planet strips and overlays, ring / particle / clump sprites, rock and wreck frames, animated nebula layers — is built at `bucket = 1.25^round(log(zoom) / log 1.25)` (`zoomBucket`, §4) × DPR, and blitted at `zoom / bucket`, which stays within **0.894 … 1.118**.
3. **Never upscale a cached sprite beyond 1.25× its built size — rebuild instead.** The bucket rule guarantees it for zoom; a **DPR change** (window moved to another screen, browser zoom) rebuilds everything through `watchDPR`. The old exception "the star sprite is a fixed 400 px bitmap that `drawImage` scales up to 2×" is withdrawn: the v1.5 sun has a 1.6 px ragged rim and 1 px prominence cores that would soften.
4. **`imageSmoothingQuality = "high"`** on the main context (set in `fitCanvas`, because resizing a canvas resets context state) and on every build context that draws scaled images. Downscaling inside a bucket (≥ 0.894) is then clean; upscaling never exceeds 1.118.
5. **Never round strip offsets or orbit positions** — sub-pixel `drawImage` is what makes slow motion read as glide (§4). Do round the positions of **static** crisp strokes drawn live (capture ring centre, HUD) to whole / half pixels as before.

### Zoom bucket rule
Buckets … 0.64, 0.8, 1, 1.25, 1.5625 …; `round()` flips at the midpoints (±11.8 % about each centre), so successive builds are always 25 % apart in zoom. Continuous zooming inside a bucket costs nothing. All world sprites share the bucket, so a change rebuilds all of them — ≈ 45 ms for the sun and ≈ 10 ms per planet (measured, tiles cached), ≈ 15–25 ms per ringed planet. Spread the work: one body per frame, the sun's boil frames last, or a Worker with `OffscreenCanvas`; bodies not yet rebuilt keep drawing their previous bitmaps, whose residual is still ≤ 1.25× for those few frames. Optionally pre-build the neighbouring buckets in idle time when the camera zooms. Rotation, orbit and boil phases live outside the bitmaps and survive the rebuild, so nothing jumps. No hysteresis: a rebuild is cheap enough that chattering across a boundary is harmless, and keeping the residual inside ±11.8 % is what keeps 1 px edges clean. The background (sky, static nebulae, static belt dust) is screen-space and does not zoom (no parallax).

---

## 13. Cheap vs. expensive checklist

| Cheap — use freely | Expensive — avoid or cache |
|---|---|
| `drawImage` of a cached canvas, scaled ≤ 1.25× its built size (`imageSmoothingQuality = "high"`) | Upscaling a cached sprite beyond 1.25× (soft rims, fat 1 px lines) — rebuild at the new bucket / DPR instead |
| `createRadialGradient` per frame for the few live layers (planet X halo) | `shadowBlur` on anything that moves (2–5 ms per call) |
| Per-pixel loops, `getImageData` / `putImageData`, `ctx.filter = "blur()"`, `multiply` / `destination-in`, JS displacement — **inside sprite builds** (§0 toolkit, §3, §4) | Any of those **per frame**; `feTurbulence`-style noise or displacement in the loop |
| Noise tiles built once and kept; fields mapped onto the SVG scale by quantile (§0) | Re-thresholding or re-displacing per zoom tick (only per bucket) |
| Planet strips (surface; clouds + baked shadow) + lighting overlay (shade with warm band, lit haze, lit rim): 1 clip + 2–3 blits | Drawing the terminator, haze, rim or cloud shadow live; rotating a planet with `ctx.rotate` (the light would turn) |
| Star: haze scaled by the breathe, flame / wisp frames rotated and blended in a small scratch buffer with `"lighter"`, unblurred prominence sprites, one static disc sprite | Re-displacing the flames per frame; `source-over` cross-fades of semi-transparent frames (alpha dip); stroking prominences live |
| Two-tone, unblurred baked strokes (prominences, photon ring, rims) | Blur standing in for detail: no blur > 0.5 on bodies except glows and hazes (`style.md` §4.1) |
| Lit frames for tumbling rocks and wreck pieces, selected by angle (§4e); dust baked into one drifting layer | Rotating a lit rock sprite (its light turns with it); drawing 62 dust rocks individually |
| Ring-plane sprites under `rotate(roll) → scale(1, k) → rotate(phase)` with half-plane clips (§3c, §4d) | Re-rendering ring particles per frame; rotating a squashed ellipse sprite (wrong motion) |
| Moons as small planets at computed orbit positions, z-order by `sin θ` (§4c) | Rotating a moon sprite around the planet (its terminator would turn) |
| Nebulae baked into the background, or 3 large blits with a `globalAlpha` cross-fade (§2b) | Rebuilding nebula density fields at runtime |
| `setLineDash` + `lineDashOffset` (reset to `[]`); `"lighter"` / `"destination-in"` only in the six bounded cases of §0 "The rule" (thrust triangles; star boil, lava / cracked emissive masks, tumbler and captured-moon frame blends, each in a transparent scratch buffer no larger than the sprite it blends, each with a no-composite fallback) | Any other composite mode per frame; `"lighter"` or `"destination-in"` over large areas of the main canvas |
| One `Path2D` with hundreds of arcs + one `fill()`; ring buffers and `Float32Array` for trail / path | Hundreds of separate `beginPath/arc/fill` calls; allocating arrays per frame |
| Opaque context `{ alpha: false }`, DPR clamped to [1, 2] | DPR 3 canvases, transparent main context, `clearRect` + redraw of a static background |
| `fillText` ≤ 10 per frame at integer positions | `measureText` in a loop |

If a frame ever exceeds 6 ms, look in this order: (1) a stray `shadowBlur`, (2) the background redrawn instead of blitted, (3) a sprite rebuilt every frame (check that bucket and DPR comparisons are stable — compare the bucket, not the raw zoom), (4) the trail drawn as 240 strokes, (5) text with the per-character letter-spacing fallback, (6) a star's flame frames or a planet's fields being re-built instead of reused, (7) nebula layers or debris frames built inside the frame instead of at load, (8) a ring's particle sprites drawn per particle. If a surface steps instead of gliding, something is rounding an offset (§4). If a rim or a prominence looks soft, something is being upscaled beyond 1.25× (§12).
