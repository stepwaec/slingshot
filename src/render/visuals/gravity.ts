import * as THREE from "three";
import { isEditing, type Game } from "../../game/state";
import { simConfigFromLevel } from "../../level/catalog";
import { worldToScreen } from "../camera";
import { bodyPose, gravityConstant, isCompactBody, properTimeRate, tidalDangerRadius, type SimConfig } from "../../sim/physics";
import {
  clipSegment,
  deepestFinite,
  framedBounds,
  gridX,
  gridY,
  inkAlpha,
  inkDepth,
  inkTone,
  placeContourLabels,
  rampStop,
  sampleGravityGrid,
  screenEdgeFade,
  type Disc,
  type GravityGrid,
} from "../gravityField";
import { TIME_BANDS, TIME_WARM_S, clockDisplayS, gridRamp01, palette, srgb01 } from "../palette";
import { shader, srgbVec } from "./materials";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Gravity layer for planning and pause.
 *
 * The field is six crisp clock-rate bands (design/style.md §21), evaluated in
 * the fragment shader from the body uniforms. The bent grid is a cached mesh,
 * rebuilt only when the level or the view changes. Compact wells funnel that
 * mesh. Band colour is the rate at the fragment's world position, so the
 * contours stay on their true radii. Nothing here steps the simulation.
 */
export const createGravity: VisualFactory = (theme) => new GravityVisual(theme);

function glslVec(hex: string): string {
  const [r, g, b] = srgb01(hex);
  return `vec3(${r.toFixed(6)}, ${g.toFixed(6)}, ${b.toFixed(6)})`;
}

function surfaceFragment(): string {
  let bandAt = "vec4 bandAt(float s) {\n";
  bandAt += `  if (!(s < ${TIME_BANDS[0].sHigh.toFixed(4)})) return vec4(0.0);\n`;
  for (let i = 0; i < TIME_BANDS.length - 1; i++) {
    const band = TIME_BANDS[i];
    const next = TIME_BANDS[i + 1];
    bandAt += `  if (s >= ${next.sHigh.toFixed(4)}) return vec4(${glslVec(band.color)}, ${band.alpha.toFixed(4)});\n`;
  }
  const stop = TIME_BANDS[TIME_BANDS.length - 1];
  bandAt += `  return vec4(${glslVec(stop.color)}, ${stop.alpha.toFixed(4)});\n}\n`;
  let contourAt = "vec4 contourAt(float edge) {\n";
  for (let i = 0; i < TIME_BANDS.length; i++) {
    const band = TIME_BANDS[i];
    contourAt += `  if (abs(edge - ${band.sHigh.toFixed(4)}) < 1e-3) return vec4(${glslVec(band.contour)}, ${band.contourAlpha.toFixed(4)});\n`;
  }
  contourAt += "  return vec4(0.0);\n}\n";
  const scans = TIME_BANDS.slice(1)
    .map((band) => {
      const edge = band.sHigh.toFixed(4);
      return `  { float d = abs(s - ${edge}); if (d < best) { best = d; nearest = ${edge}; } }`;
    })
    .join("\n");
  return /* glsl */ `
varying vec2 vWorld;
uniform vec2 uCam;
uniform float uZoom;
uniform vec2 uView;
uniform float uEdge;
${fieldRateGlsl()}
${bandAt}
${contourAt}
void main() {
  if (coveredByBody(vWorld) > 0.5) discard;
  vec2 screen = vec2(
    (vWorld.x - uCam.x) * uZoom + uView.x * 0.5,
    uView.y * 0.5 - (vWorld.y - uCam.y) * uZoom
  );
  float inset = min(min(screen.x, screen.y), min(uView.x - screen.x, uView.y - screen.y));
  float fade = clamp(inset / max(uEdge, 1.0), 0.0, 1.0);
  if (fade <= 0.001) discard;
  float s = pow(clamp(clockRate(vWorld), 0.0, 1.0), uGamma);
  float fw = max(fwidth(s), 1e-5);
  vec4 fill = bandAt(s);
  float nearest = ${TIME_BANDS[0].sHigh.toFixed(4)};
  float best = abs(s - nearest);
${scans}
  float halfPx = 0.5 * fw;
  if (best < fw) {
    float t = smoothstep(nearest - halfPx, nearest + halfPx, s);
    fill = mix(bandAt(nearest - fw), bandAt(nearest + fw), t);
  }
  float dPx = best / fw;
  float line = 1.0 - smoothstep(0.5, 1.0, dPx);
  vec4 contour = contourAt(nearest);
  float cover = contour.a * line;
  float outA = cover + fill.a * (1.0 - cover);
  if (outA <= 0.001) discard;
  vec3 outC = (contour.rgb * cover + fill.rgb * fill.a * (1.0 - cover)) / max(outA, 1e-4);
  gl_FragColor = vec4(outC, outA * fade);
}
`;
}

/** Point masses packed for the fragment shader. Observatory is the wide case. */
const FIELD_BODIES = 48;

function fieldRateGlsl(): string {
  return /* glsl */ `
uniform vec4 uBody[${FIELD_BODIES}];
uniform int uCount;
uniform float uG;
uniform float uC2;
uniform float uStrength;
uniform float uHasCap;
uniform float uCap;
uniform float uGamma;
float clockRate(vec2 p) {
  float phi = 0.0;
  for (int i = 0; i < ${FIELD_BODIES}; i++) {
    if (i >= uCount) break;
    float mass = uBody[i].z;
    vec2 d = p - uBody[i].xy;
    phi += uG * mass * inversesqrt(max(dot(d, d), 1e-12));
  }
  float bare = 1.0 - uStrength * (2.0 * phi / max(uC2, 1e-6));
  if (uHasCap < 0.5) return bare > 0.0 ? sqrt(bare) : 0.0;
  float floorV = 1.0 / max(uCap, 1.0);
  float lo = floorV * floorV;
  float knee = min(1.0, lo * 4.0);
  if (bare >= knee) return sqrt(max(bare, 0.0));
  float span = max(knee - lo, 1e-8);
  float rad = lo + (span * span) / (span + (knee - bare));
  return sqrt(max(rad, 0.0));
}
float coveredByBody(vec2 p) {
  for (int i = 0; i < ${FIELD_BODIES}; i++) {
    if (i >= uCount) break;
    float rad = uBody[i].w;
    if (rad <= 0.0) continue;
    vec2 d = p - uBody[i].xy;
    if (dot(d, d) <= rad * rad) return 1.0;
  }
  return 0.0;
}
`;
}

const surfaceVert = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ribbonVert = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aAcross;
attribute vec3 aEnd;
attribute float aHalfPx;
attribute float aDepth;
attribute float aInkHalf;
attribute float aEdge;
varying vec3 vColor;
varying float vAlpha;
varying float vAcrossPx;
varying vec2 vWorld;
varying float vDepth;
varying float vInkHalf;
varying float vEdge;
uniform vec2 uViewport;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 clipB = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  vec2 dir = clipB.xy / max(clipB.w, 1e-4) - clip.xy / max(clip.w, 1e-4);
  float len = length(dir);
  vec2 perp = len > 1e-6 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);
  float pad = 1.25;
  float halfPx = aHalfPx + pad;
  vec2 ndc = vec2(2.0 / max(uViewport.x, 1.0), 2.0 / max(uViewport.y, 1.0));
  clip.xy += perp * aAcross * halfPx * ndc * clip.w;
  vColor = aColor;
  vAlpha = aAlpha;
  vAcrossPx = aAcross * halfPx;
  vWorld = position.xy;
  vDepth = aDepth;
  vInkHalf = aInkHalf;
  vEdge = aEdge;
  gl_Position = clip;
}
`;

const ribbonFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vAcrossPx;
varying vec2 vWorld;
varying float vDepth;
varying float vInkHalf;
varying float vEdge;
${fieldRateGlsl()}
uniform vec3 uNavy;
uniform float uCasingAlpha;
uniform float uCasingDepth;
uniform float uCasingHalf;
uniform float uWarm;
uniform float uWarmHalf;
uniform float uWarmAlpha;
void main() {
  float across = abs(vAcrossPx);
  float aa = fwidth(across);
  float s = pow(clamp(clockRate(vWorld), 0.0, 1.0), uGamma);
  float fw = max(fwidth(s), 1e-5);
  float warm = 1.0 - smoothstep(uWarm - 0.5 * fw, uWarm + 0.5 * fw, s);
  float casing = 1.0 - smoothstep(uCasingHalf - aa, uCasingHalf + aa, across);
  float ink = 1.0 - smoothstep(vInkHalf - aa, vInkHalf + aa, across);
  float warmLine = 1.0 - smoothstep(uWarmHalf - aa, uWarmHalf + aa, across);
  float edge = clamp(vEdge, 0.0, 1.0);
  float casingA = (uCasingAlpha + uCasingDepth * clamp(vDepth, 0.0, 1.0)) * casing * edge;
  float inkA = vAlpha * ink * edge;
  float coolA = inkA + casingA * (1.0 - inkA);
  vec3 coolC = coolA > 1e-4 ? (vColor * inkA + uNavy * casingA * (1.0 - inkA)) / coolA : uNavy;
  float warmA = uWarmAlpha * warmLine * edge;
  float outA = mix(coolA, warmA, warm);
  if (outA <= 0.01) discard;
  gl_FragColor = vec4(mix(coolC, uNavy, warm), outA);
}
`;

class GravityVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly cols: number;
  private readonly rows: number;
  private readonly surface: THREE.Mesh;
  private readonly fieldBodies: THREE.Vector4[];
  private readonly fieldCount: THREE.IUniform<number>;
  private readonly fieldG: THREE.IUniform<number>;
  private readonly fieldC2: THREE.IUniform<number>;
  private readonly fieldStrength: THREE.IUniform<number>;
  private readonly fieldHasCap: THREE.IUniform<number>;
  private readonly fieldCap: THREE.IUniform<number>;
  private readonly fieldCam: THREE.IUniform<THREE.Vector2>;
  private readonly fieldZoom: THREE.IUniform<number>;
  private readonly fieldView: THREE.IUniform<THREE.Vector2>;
  private readonly ribbonPositions: Float32Array;
  private readonly ribbonColors: Float32Array;
  private readonly ribbonAlphas: Float32Array;
  private readonly ribbonAcross: Float32Array;
  private readonly ribbonEnds: Float32Array;
  private readonly ribbonHalf: Float32Array;
  private readonly ribbonDepths: Float32Array;
  private readonly ribbonInkHalf: Float32Array;
  private readonly ribbonEdges: Float32Array;
  private readonly gridLines: THREE.Mesh;
  private readonly viewport: THREE.IUniform<THREE.Vector2>;
  private grid: GravityGrid | null = null;
  private fieldKey = "";
  private bodyKey = "";
  private bandsVisible = false;
  private readonly zones: TidalRing[] = [];
  private readonly contours: HTMLElement | null;
  private readonly chips: HTMLElement[] = [];

  constructor(theme: Theme) {
    this.theme = theme;
    this.object.name = "gravity-map";
    const cols = Math.max(2, theme.gravity.cols);
    const rows = Math.max(2, theme.gravity.rows);
    this.cols = cols;
    this.rows = rows;
    this.fieldBodies = Array.from({ length: FIELD_BODIES }, () => new THREE.Vector4());
    this.fieldCount = { value: 0 };
    this.fieldG = { value: 1 };
    this.fieldC2 = { value: 1 };
    this.fieldStrength = { value: 1 };
    this.fieldHasCap = { value: 0 };
    this.fieldCap = { value: 1 };
    this.fieldCam = { value: new THREE.Vector2() };
    this.fieldZoom = { value: 1 };
    this.fieldView = { value: new THREE.Vector2(1, 1) };
    const fieldUniforms = {
      uBody: { value: this.fieldBodies },
      uCount: this.fieldCount,
      uG: this.fieldG,
      uC2: this.fieldC2,
      uStrength: this.fieldStrength,
      uHasCap: this.fieldHasCap,
      uCap: this.fieldCap,
      uGamma: { value: theme.gravity.heatGamma },
      uCam: this.fieldCam,
      uZoom: this.fieldZoom,
      uView: this.fieldView,
      uEdge: { value: theme.gravity.inkEdgePx },
    };
    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: fieldUniforms,
        vertexShader: surfaceVert,
        fragmentShader: surfaceFragment(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.surface.frustumCulled = false;
    this.surface.renderOrder = -4;
    this.surface.name = "gravity-surface";

    const segments = rows * (cols - 1) + cols * (rows - 1);
    const ribbonVerts = segments * 4 * 6;
    this.ribbonPositions = new Float32Array(ribbonVerts * 3);
    this.ribbonColors = new Float32Array(ribbonVerts * 3);
    this.ribbonAlphas = new Float32Array(ribbonVerts);
    this.ribbonAcross = new Float32Array(ribbonVerts);
    this.ribbonEnds = new Float32Array(ribbonVerts * 3);
    this.ribbonHalf = new Float32Array(ribbonVerts);
    this.ribbonDepths = new Float32Array(ribbonVerts);
    this.ribbonInkHalf = new Float32Array(ribbonVerts);
    this.ribbonEdges = new Float32Array(ribbonVerts);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.BufferAttribute(this.ribbonPositions, 3));
    gridGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.ribbonColors, 3));
    gridGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.ribbonAlphas, 1));
    gridGeometry.setAttribute("aAcross", new THREE.BufferAttribute(this.ribbonAcross, 1));
    gridGeometry.setAttribute("aEnd", new THREE.BufferAttribute(this.ribbonEnds, 3));
    gridGeometry.setAttribute("aHalfPx", new THREE.BufferAttribute(this.ribbonHalf, 1));
    gridGeometry.setAttribute("aDepth", new THREE.BufferAttribute(this.ribbonDepths, 1));
    gridGeometry.setAttribute("aInkHalf", new THREE.BufferAttribute(this.ribbonInkHalf, 1));
    gridGeometry.setAttribute("aEdge", new THREE.BufferAttribute(this.ribbonEdges, 1));
    this.viewport = { value: new THREE.Vector2(1, 1) };
    const spec = theme.gravity;
    this.gridLines = new THREE.Mesh(
      gridGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          ...fieldUniforms,
          uViewport: this.viewport,
          uNavy: { value: srgbVec(palette.timeCasing) },
          uCasingAlpha: { value: spec.casingAlpha },
          uCasingDepth: { value: spec.casingDepth },
          uCasingHalf: { value: spec.casingPx * 0.5 },
          uWarm: { value: TIME_WARM_S },
          uWarmHalf: { value: spec.warmPx * 0.5 },
          uWarmAlpha: { value: spec.warmAlpha },
        },
        vertexShader: ribbonVert,
        fragmentShader: ribbonFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.gridLines.frustumCulled = false;
    this.gridLines.renderOrder = -3;
    this.gridLines.name = "gravity-grid";
    this.gridLines.visible = false;

    this.object.add(this.surface, this.gridLines);
    this.object.visible = false;
    this.contours = createContourLayer();
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const editing = isEditing(game);
    const gridOn = game.gravity === "on" && editing;
    // The dashed level-3 ring stays with this visual. The tidal layer shows it
    // on its own; gravity still shows it when that layer is on.
    const ringsOn = editing && (gridOn || game.tidal);
    this.object.visible = gridOn || ringsOn;
    if (this.contours) this.contours.hidden = !gridOn;
    if ((!gridOn && !ringsOn) || frame.width < 2 || frame.height < 2) {
      if (!ringsOn) this.hideDanger();
      return;
    }

    const time = chartTime(game);
    const config = simConfigFromLevel(game.level);
    const zoom = game.camera.zoom > 0 ? game.camera.zoom : 1;
    // The lattice draws its own chip above the rings. This label is the
    // gravity-only copy, so the two do not stack.
    this.syncDanger(config, time, frame.now, zoom, !game.tidal);
    if (!gridOn) {
      this.surface.visible = false;
      this.gridLines.visible = false;
      return;
    }
    this.fieldCam.value.set(game.camera.x, game.camera.y);
    this.fieldZoom.value = zoom;
    this.fieldView.value.set(frame.width, frame.height);
    this.surface.position.set(game.camera.x, game.camera.y, 0);
    this.surface.scale.set(frame.width / zoom, frame.height / zoom, 1);
    const bodyKey = `${game.level.id}|${time}`;
    if (bodyKey !== this.bodyKey) {
      this.uploadBodies(config, time);
      this.bandsVisible = bandsInView(config, time, this.theme.gravity.heatGamma);
      this.bodyKey = bodyKey;
    }
    this.surface.visible = this.bandsVisible;

    const bounds = framedBounds(game.camera, frame.width, frame.height, this.theme.gravity.viewPad);
    const fieldKey = fieldCacheKey(game, time, bounds, frame.width, frame.height);
    this.viewport.value.set(frame.width, frame.height);
    this.gridLines.visible = true;
    if (fieldKey === this.fieldKey) return;
    this.grid = sampleGravityGrid(config, time, bounds, this.cols, this.rows, this.grid ?? undefined);
    const grid = this.grid;
    if (!grid) return;
    const phiMax = visiblePhiMax(
      grid,
      bodyDiscs(config, time, this.theme.gravity.inkBodyGapPx / Math.max(zoom, 0.25)),
    );
    const verts = writeInk(
      grid,
      phiMax,
      this.theme,
      game.camera,
      frame.width,
      frame.height,
      config,
      time,
      this.ribbonPositions,
      this.ribbonColors,
      this.ribbonAlphas,
      this.ribbonAcross,
      this.ribbonEnds,
      this.ribbonHalf,
      this.ribbonDepths,
      this.ribbonInkHalf,
      this.ribbonEdges,
    );
    this.gridLines.geometry.setDrawRange(0, verts);
    mark(this.gridLines.geometry);
    this.syncContours(config, time, game.camera, frame.width, frame.height);
    this.fieldKey = fieldKey;
  }

  /** Body uniforms for the fragment shader. Not a texture, and not every frame. */
  private uploadBodies(config: SimConfig, time: number): void {
    const g = gravityConstant(config);
    const ranked = config.bodies.filter((body) => body.mass > 0).sort((a, b) => b.mass - a.mass);
    const count = Math.min(FIELD_BODIES, ranked.length);
    for (let i = 0; i < FIELD_BODIES; i++) {
      const slot = this.fieldBodies[i];
      if (i >= count) {
        slot.set(0, 0, 0, 0);
        continue;
      }
      const body = ranked[i];
      const pose = bodyPose(body, time, config.bodies, g);
      slot.set(pose.x, pose.y, body.mass, body.radius > 0 ? body.radius : 0);
    }
    this.fieldCount.value = count;
    this.fieldG.value = g;
    const c = config.c > 0 ? config.c : 1;
    this.fieldC2.value = c * c;
    this.fieldStrength.value = config.dilationStrength ?? 1;
    const cap = config.dilationCap ?? Number.POSITIVE_INFINITY;
    const hasCap = cap >= 1 && Number.isFinite(cap);
    this.fieldHasCap.value = hasCap ? 1 : 0;
    this.fieldCap.value = hasCap ? cap : 1;
  }

  dispose(): void {
    this.contours?.remove();
    disposeObject(this.object);
  }

  /**
   * Dashed ring where tidal stress reaches level 3 (`STRESS_WARN`).
   * design/style.md §22 keeps this ring as the level-3 boundary.
   * The chip reads "tidal 3 · hull".
   */
  private hideDanger(): void {
    for (let i = 0; i < this.zones.length; i++) {
      const zone = this.zones[i];
      zone.mesh.visible = false;
      if (zone.label) zone.label.visible = false;
    }
  }

  private syncDanger(config: SimConfig, time: number, now: number, zoom: number, showLabel: boolean): void {
    const strength = config.tidalStrength ?? 0;
    const g = gravityConstant(config);
    const spec = this.theme.gravity;
    let count = 0;
    if (strength > 0) {
      for (let i = 0; i < config.bodies.length; i++) {
        const body = config.bodies[i];
        if (!isCompactBody(body)) continue;
        const radius = tidalDangerRadius(body, g, strength);
        if (!(radius > 0)) continue;
        let ring = this.zones[count];
        if (!ring) {
          ring = makeTidalRing(spec.tidalPx, spec.tidalAlpha);
          this.object.add(ring.mesh);
          this.zones.push(ring);
        }
        const pose = bodyPose(body, time, config.bodies);
        const z = 0.5;
        ring.mesh.visible = true;
        ring.mesh.position.set(pose.x, pose.y, z);
        const pad = (spec.tidalPx + 2) / Math.max(zoom, 0.25);
        ring.mesh.scale.set(radius + pad, radius + pad, 1);
        ring.scale.value = radius + pad;
        ring.radius.value = radius;
        ring.dash.value = (now / 1000) * spec.tidalCrawl;
        ring.zoom.value = zoom > 0 ? zoom : 1;
        if (showLabel) {
          if (!ring.label) {
            ring.label = makeTidalLabel();
            if (ring.label) this.object.add(ring.label);
          }
          if (ring.label) this.placeLabel(ring.label, pose.x, pose.y, radius, z, zoom);
        } else if (ring.label) {
          ring.label.visible = false;
        }
        count += 1;
      }
    }
    for (let i = count; i < this.zones.length; i++) {
      const zone = this.zones[i];
      zone.mesh.visible = false;
      if (zone.label) zone.label.visible = false;
    }
  }

  private syncContours(
    config: SimConfig,
    time: number,
    camera: { x: number; y: number; zoom: number },
    width: number,
    height: number,
  ): void {
    const layer = this.contours;
    if (!layer) return;
    const spec = this.theme.gravity;
    const chips = placeContourLabels(
      config,
      time,
      (x, y) => worldToScreen(camera, width, height, x, y),
      width,
      height,
      spec.heatGamma,
      spec.labelAngle,
      spec.labelGapPx,
    );
    while (this.chips.length < chips.length) {
      const chip = document.createElement("span");
      chip.className = "time-chip";
      layer.append(chip);
      this.chips.push(chip);
    }
    for (let i = 0; i < this.chips.length; i++) {
      const node = this.chips[i];
      const chip = chips[i];
      if (!chip) {
        node.hidden = true;
        continue;
      }
      const screen = worldToScreen(camera, width, height, chip.x, chip.y);
      node.hidden = false;
      node.textContent = chip.text;
      node.style.color = chip.color;
      node.style.left = `${screen.x}px`;
      node.style.top = `${screen.y}px`;
    }
  }

  private placeLabel(label: THREE.Sprite, x: number, y: number, radius: number, z: number, zoom: number): void {
    const ang = Math.atan2(1, 0.8);
    const zf = Math.max(zoom, 0.25);
    label.visible = true;
    label.position.set(x + Math.cos(ang) * radius, y + Math.sin(ang) * radius, z);
    label.scale.set(90 / zf, 16 / zf, 1);
    label.center.set(0, 0.5);
  }
}

function chartTime(game: Game): number {
  const step = game.mode === "planning" ? 0 : game.ship.step;
  return step * game.level.dt;
}

function fieldCacheKey(
  game: Game,
  time: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  width: number,
  height: number,
): string {
  return [
    game.level.id,
    time,
    width,
    height,
    game.camera.x,
    game.camera.y,
    game.camera.zoom,
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
  ].join("|");
}

interface RibbonBuffers {
  positions: Float32Array;
  colors: Float32Array;
  alphas: Float32Array;
  across: Float32Array;
  ends: Float32Array;
  half: Float32Array;
  depths: Float32Array;
  inkHalf: Float32Array;
  edges: Float32Array;
}

function writeInk(
  grid: GravityGrid,
  phiMax: number,
  theme: Theme,
  camera: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  config: SimConfig,
  time: number,
  positions: Float32Array,
  colors: Float32Array,
  alphas: Float32Array,
  across: Float32Array,
  ends: Float32Array,
  half: Float32Array,
  depths: Float32Array,
  inkHalf: Float32Array,
  edges: Float32Array,
): number {
  const spec = theme.gravity;
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const lineDiscs = bodyDiscs(config, time, spec.inkBodyGapPx / zoom);
  const buffers: RibbonBuffers = { positions, colors, alphas, across, ends, half, depths, inkHalf, edges };
  let cursor = 0;
  const room = positions.length / 3 - 6;
  const casingHalf = spec.casingPx * 0.5;
  const push = (a: number, b: number, major: boolean) => {
    if (cursor > room) return;
    const ax = grid.pinchX[a];
    const ay = grid.pinchY[a];
    const bx = grid.pinchX[b];
    const by = grid.pinchY[b];
    const pieces = clipSegment(ax, ay, bx, by, lineDiscs);
    const da = inkDepth(grid.depth[a], grid.knee, phiMax);
    const db = inkDepth(grid.depth[b], grid.knee, phiMax);
    const tone = inkTone((da + db) * 0.5, spec.inkGamma);
    const rgb = gridRamp01(rampStop(tone, spec.inkRamp));
    const depth = (da + db) * 0.5;
    for (let p = 0; p < pieces.length; p++) {
      if (cursor > room) return;
      const piece = pieces[p];
      const mx = (piece[0] + piece[2]) * 0.5;
      const my = (piece[1] + piece[3]) * 0.5;
      const sx = (mx - camera.x) * zoom + width * 0.5;
      const sy = height * 0.5 - (my - camera.y) * zoom;
      const edge = screenEdgeFade(sx, sy, width, height, spec.inkEdgePx);
      const alpha = inkAlpha(tone, major, 1, spec.inkAlpha, spec.inkAlphaDepth, spec.inkMajorAlpha);
      if (edge < 0.02) continue;
      const px = major ? spec.inkMajorPx : spec.inkMinorPx;
      const zLift = 0.4;
      cursor = pushRibbon(
        buffers,
        cursor,
        piece[0],
        piece[1],
        zLift,
        piece[2],
        piece[3],
        zLift,
        rgb,
        alpha,
        casingHalf,
        depth,
        px * 0.5,
        edge,
      );
    }
  };
  const cols = grid.cols;
  const rows = grid.rows;
  const every = Math.max(1, spec.inkMajorEvery);
  for (let row = 0; row < rows; row++) {
    const major = row % every === 0;
    for (let col = 0; col < cols - 1; col++) push(row * cols + col, row * cols + col + 1, major);
  }
  for (let col = 0; col < cols; col++) {
    const major = col % every === 0;
    for (let row = 0; row < rows - 1; row++) push(row * cols + col, (row + 1) * cols + col, major);
  }
  return cursor;
}

function pushRibbon(
  buffers: RibbonBuffers,
  cursor: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  rgb: readonly [number, number, number],
  alpha: number,
  halfPx: number,
  depth: number,
  inkHalfPx: number,
  edge: number,
): number {
  const quad: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
    [ax, ay, az, bx, by, bz, -1],
    [bx, by, bz, ax, ay, az, -1],
    [bx, by, bz, ax, ay, az, 1],
    [ax, ay, az, bx, by, bz, -1],
    [bx, by, bz, ax, ay, az, 1],
    [ax, ay, az, bx, by, bz, 1],
  ];
  for (let i = 0; i < quad.length; i++) {
    const corner = quad[i];
    const o = (cursor + i) * 3;
    const v = cursor + i;
    buffers.positions[o] = corner[0];
    buffers.positions[o + 1] = corner[1];
    buffers.positions[o + 2] = corner[2];
    buffers.ends[o] = corner[3];
    buffers.ends[o + 1] = corner[4];
    buffers.ends[o + 2] = corner[5];
    buffers.colors[o] = rgb[0];
    buffers.colors[o + 1] = rgb[1];
    buffers.colors[o + 2] = rgb[2];
    buffers.alphas[v] = alpha;
    buffers.across[v] = corner[6];
    buffers.half[v] = halfPx;
    buffers.depths[v] = depth;
    buffers.inkHalf[v] = inkHalfPx;
    buffers.edges[v] = edge;
  }
  return cursor + 6;
}

/** Deepest finite sample outside the body discs, so the ramp's warm end is a line we actually draw. */
function visiblePhiMax(grid: GravityGrid, discs: readonly Disc[]): number {
  let max = 0;
  const cols = grid.cols;
  for (let i = 0; i < grid.depth.length; i++) {
    const depth = grid.depth[i];
    if (!Number.isFinite(depth) || !(depth > max)) continue;
    const col = i % cols;
    const row = (i - col) / cols;
    const x = gridX(grid, col);
    const y = gridY(grid, row);
    let hidden = false;
    for (let d = 0; d < discs.length; d++) {
      const disc = discs[d];
      const dx = x - disc.x;
      const dy = y - disc.y;
      if (dx * dx + dy * dy <= disc.r * disc.r) {
        hidden = true;
        break;
      }
    }
    if (!hidden) max = depth;
  }
  if (max > 0) return max;
  const finite = deepestFinite(grid.depth);
  return finite > 0 ? finite : grid.knee;
}

/** True when a body's limb is slow enough to show a band. Clear levels skip the quad. */
function bandsInView(config: SimConfig, time: number, gamma: number): boolean {
  const edge = TIME_BANDS[0].sHigh;
  const bodies = config.bodies;
  const g = gravityConstant(config);
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!(body.mass > 0) || !(body.radius > 0)) continue;
    const pose = bodyPose(body, time, bodies, g);
    const rate = properTimeRate(pose.x + body.radius * 1.01, pose.y, 0, 0, config, time);
    if (clockDisplayS(rate, gamma) < edge) return true;
  }
  return false;
}

function bodyDiscs(config: SimConfig, time: number, pad: number): Disc[] {
  const discs: Disc[] = [];
  const bodies = config.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!(body.radius > 0)) continue;
    const pose = bodyPose(body, time, bodies);
    discs.push({ x: pose.x, y: pose.y, r: body.radius + (pad > 0 ? pad : 0) });
  }
  return discs;
}

function mark(geometry: THREE.BufferGeometry): void {
  const names = ["position", "aColor", "aAlpha", "aAcross", "aEnd", "aHalfPx", "aDepth", "aInkHalf", "aEdge"];
  for (let i = 0; i < names.length; i++) {
    const attribute = geometry.getAttribute(names[i]);
    if (attribute) attribute.needsUpdate = true;
  }
}

function createContourLayer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const host = document.getElementById("app") ?? document.body;
  const layer = document.createElement("div");
  layer.id = "gravity-contours";
  host.append(layer);
  return layer;
}

interface TidalRing {
  mesh: THREE.Mesh;
  radius: THREE.IUniform<number>;
  dash: THREE.IUniform<number>;
  zoom: THREE.IUniform<number>;
  scale: THREE.IUniform<number>;
  label: THREE.Sprite | null;
}

function makeTidalRing(widthPx: number, alpha: number): TidalRing {
  const radius = { value: 1 };
  const dash = { value: 0 };
  const zoom = { value: 1 };
  const scale = { value: 1 };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    shader(tidalFrag, {
      uColor: { value: srgbVec(palette.gridTidal) },
      uRadius: radius,
      uZoom: zoom,
      uDash: dash,
      uAlpha: { value: alpha },
      uWidth: { value: widthPx },
      uScale: scale,
    }),
  );
  mesh.name = "tidal-ring";
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return { mesh, radius, dash, zoom, scale, label: null };
}

const tidalFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uRadius;
uniform float uZoom;
uniform float uDash;
uniform float uAlpha;
uniform float uWidth;
uniform float uScale;
void main() {
  float distPx = length(vLocal) * uScale * uZoom;
  float ringPx = uRadius * uZoom;
  float aa = fwidth(distPx);
  float band = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + aa, abs(distPx - ringPx));
  if (band <= 0.0) discard;
  float along = atan(vLocal.y, vLocal.x) * ringPx;
  float u = fract((along - uDash) / 8.0);
  if (u > 0.5) discard;
  gl_FragColor = vec4(uColor, uAlpha * band);
}
`;

function makeTidalLabel(): THREE.Sprite | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const dpr = 2;
  const cssW = 90;
  const cssH = 16;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, cssW - 1, cssH - 1, 4);
  ctx.fillStyle = "rgba(10, 13, 26, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 90, 95, 0.6)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = "9.5px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
  ctx.fillStyle = "#FF5A5F";
  ctx.textBaseline = "middle";
  ctx.fillText("tidal 3 · hull", 5, cssH / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  sprite.name = "tidal-label";
  sprite.renderOrder = -1;
  sprite.center.set(0, 0.5);
  return sprite;
}
