import * as THREE from "three";
import { isEditing, type Game } from "../../game/state";
import { simConfigFromLevel } from "../../level/catalog";
import { bodyPose, gravityConstant, isCompactBody, potentialDepth, tidalDangerRadius, type SimConfig } from "../../sim/physics";
import {
  cellEdgeFade,
  clipSegment,
  deepestFinite,
  fieldSpan,
  framedBounds,
  gridX,
  gridY,
  inkAlpha,
  inkDepth,
  inkTone,
  rampStop,
  sampleGravityGrid,
  screenEdgeFade,
  sheetDrop,
  writeClockContours,
  type Disc,
  type GravityGrid,
} from "../gravityField";
import { gridRamp01, palette, srgb01 } from "../palette";
import { shader, srgbVec } from "./materials";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Gravity map for planning and pause.
 *
 * Grid is an even mesh slid toward each mass along the potential gradient,
 * so the lines pinch around deep wells. Clock-rate contours draw on that
 * mesh. Sheet is the same samples dropped in Z by `wellHeight` and drawn
 * with the perspective camera. Nothing here steps the simulation.
 */
export const createGravity: VisualFactory = (theme) => new GravityVisual(theme);

const MAX_PATH = 1600;

const surfaceVert = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const surfaceFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.001) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

const ribbonVert = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aAcross;
attribute vec3 aEnd;
attribute float aHalfPx;
varying vec3 vColor;
varying float vAlpha;
varying float vAcrossPx;
varying float vHalfPx;
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
  vHalfPx = aHalfPx;
  gl_Position = clip;
}
`;

const ribbonFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vAcrossPx;
varying float vHalfPx;
void main() {
  float aa = fwidth(vAcrossPx);
  float band = 1.0 - smoothstep(vHalfPx - aa, vHalfPx + aa, abs(vAcrossPx));
  float alpha = vAlpha * band;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

const inkVert = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const inkFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(uColor, uAlpha);
}
`;

interface Ink {
  mesh: THREE.Mesh | THREE.LineSegments;
  positions: Float32Array;
  geometry: THREE.BufferGeometry;
}

class GravityVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly cols: number;
  private readonly rows: number;
  private readonly surfacePositions: Float32Array;
  private readonly surfaceColors: Float32Array;
  private readonly surfaceAlphas: Float32Array;
  private readonly surface: THREE.Mesh;
  private readonly ribbonPositions: Float32Array;
  private readonly ribbonColors: Float32Array;
  private readonly ribbonAlphas: Float32Array;
  private readonly ribbonAcross: Float32Array;
  private readonly ribbonEnds: Float32Array;
  private readonly ribbonHalf: Float32Array;
  private readonly gridLines: THREE.Mesh;
  private readonly viewport: THREE.IUniform<THREE.Vector2>;
  private readonly contours: Array<{ level: number; ink: Ink }>;
  private readonly path: Ink;
  private readonly orbit: Ink;
  private readonly pathX = new Float64Array(MAX_PATH);
  private readonly pathY = new Float64Array(MAX_PATH);
  private readonly pathZ = new Float64Array(MAX_PATH);
  private grid: GravityGrid | null = null;
  private span = 1;
  private spanLevel = "";
  private fieldKey = "";
  private drawKey = "";
  private clockKey = "";
  private pathForecast: Game["prediction"] | null = null;
  private pathTime = Number.NaN;
  private pathKnee = Number.NaN;
  private pathAmp = Number.NaN;
  private readonly zones: TidalRing[] = [];
  private label: THREE.Sprite | null = null;

  constructor(theme: Theme) {
    this.theme = theme;
    this.object.name = "gravity-map";
    const cols = Math.max(2, theme.gravity.cols);
    const rows = Math.max(2, theme.gravity.rows);
    this.cols = cols;
    this.rows = rows;
    const count = cols * rows;
    this.surfacePositions = new Float32Array(count * 3);
    this.surfaceColors = new Float32Array(count * 3);
    this.surfaceAlphas = new Float32Array(count);
    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute("position", new THREE.BufferAttribute(this.surfacePositions, 3));
    surfaceGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.surfaceColors, 3));
    surfaceGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.surfaceAlphas, 1));
    surfaceGeometry.setIndex(surfaceIndices(cols, rows));
    this.surface = new THREE.Mesh(
      surfaceGeometry,
      new THREE.ShaderMaterial({
        vertexShader: surfaceVert,
        fragmentShader: surfaceFrag,
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
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.BufferAttribute(this.ribbonPositions, 3));
    gridGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.ribbonColors, 3));
    gridGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.ribbonAlphas, 1));
    gridGeometry.setAttribute("aAcross", new THREE.BufferAttribute(this.ribbonAcross, 1));
    gridGeometry.setAttribute("aEnd", new THREE.BufferAttribute(this.ribbonEnds, 3));
    gridGeometry.setAttribute("aHalfPx", new THREE.BufferAttribute(this.ribbonHalf, 1));
    this.viewport = { value: new THREE.Vector2(1, 1) };
    this.gridLines = new THREE.Mesh(
      gridGeometry,
      new THREE.ShaderMaterial({
        uniforms: { uViewport: this.viewport },
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

    const cellVerts = (cols - 1) * (rows - 1) * 4;
    this.contours = theme.gravity.clockLevels.map((level, index) => {
      const ink = makeInk(cellVerts, contourHex(level), 1, false);
      ink.mesh.name = `gravity-clock-${index}`;
      ink.mesh.visible = false;
      return { level, ink };
    });

    this.path = makeInk((MAX_PATH - 1) * 6, theme.colors.path, 1, true);
    this.path.mesh.name = "gravity-path";
    this.path.mesh.visible = false;
    this.orbit = makeInk((MAX_PATH - 1) * 6, theme.colors.resultWin, 0.9, true);
    this.orbit.mesh.name = "gravity-orbit";
    this.orbit.mesh.visible = false;

    this.object.add(this.surface, this.gridLines, this.path.mesh, this.orbit.mesh);
    for (const contour of this.contours) this.object.add(contour.ink.mesh);
    this.object.visible = false;
  }

  update(frame: VisualFrame): void {
    const game = frame.game;
    const show = game.gravity !== "off" && isEditing(game);
    this.object.visible = show;
    if (!show || frame.width < 2 || frame.height < 2) return;

    const sheet = game.gravity === "sheet";
    const time = chartTime(game);
    const config = simConfigFromLevel(game.level);
    if (this.spanLevel !== game.level.id) {
      this.span = fieldSpan(config);
      this.spanLevel = game.level.id;
    }
    const amplitude = this.span * this.theme.gravity.amplitude;
    const bounds = framedBounds(game.camera, frame.width, frame.height, this.theme.gravity.viewPad);
    const fieldKey = fieldCacheKey(game, time, bounds, frame.width, frame.height);
    if (fieldKey !== this.fieldKey) {
      this.grid = sampleGravityGrid(config, time, bounds, this.cols, this.rows, this.grid ?? undefined);
      this.fieldKey = fieldKey;
    }
    const grid = this.grid;
    if (!grid) return;
    const phiMax = visiblePhiMax(
      grid,
      bodyDiscs(config, time, this.theme.gravity.inkBodyGapPx / Math.max(game.camera.zoom, 0.25)),
    );
    this.syncDanger(config, time, sheet, amplitude, phiMax, frame.now, game.camera.zoom);
    this.viewport.value.set(frame.width, frame.height);

    const material = this.surface.material as THREE.ShaderMaterial;
    material.depthTest = sheet;
    material.depthWrite = sheet;
    this.surface.visible = sheet;
    this.gridLines.visible = true;
    const lineMaterial = this.gridLines.material as THREE.ShaderMaterial;
    lineMaterial.depthTest = sheet;

    const drawKey = `${this.fieldKey}|${sheet}|${amplitude}|${frame.width}|${frame.height}`;
    if (drawKey !== this.drawKey) {
      const verts = writeInk(
        grid,
        sheet,
        amplitude,
        phiMax,
        this.theme,
        game.camera,
        frame.width,
        frame.height,
        config,
        time,
        this.surfacePositions,
        this.surfaceColors,
        this.surfaceAlphas,
        this.ribbonPositions,
        this.ribbonColors,
        this.ribbonAlphas,
        this.ribbonAcross,
        this.ribbonEnds,
        this.ribbonHalf,
      );
      mark(this.surface.geometry);
      this.gridLines.geometry.setDrawRange(0, verts);
      mark(this.gridLines.geometry);
      this.drawKey = drawKey;
      this.clockKey = "";
    }

    const clock = !sheet && game.gravityClock;
    if (!clock) {
      for (const contour of this.contours) contour.ink.mesh.visible = false;
      this.clockKey = "";
    } else if (this.clockKey !== this.fieldKey) {
      for (const contour of this.contours) {
        contour.ink.mesh.visible = true;
        const verts = writeClockContours(grid, contour.level, contour.ink.positions, 0.6);
        contour.ink.geometry.setDrawRange(0, verts);
        mark(contour.ink.geometry);
      }
      this.clockKey = this.fieldKey;
    } else {
      for (const contour of this.contours) contour.ink.mesh.visible = true;
    }

    if (!sheet) {
      this.path.mesh.visible = false;
      this.orbit.mesh.visible = false;
      return;
    }
    this.path.mesh.visible = true;
    if (
      this.pathForecast === game.prediction &&
      this.pathTime === time &&
      this.pathKnee === grid.knee &&
      this.pathAmp === amplitude
    ) {
      return;
    }
    this.pathForecast = game.prediction;
    this.pathTime = time;
    this.pathKnee = grid.knee;
    this.pathAmp = amplitude;
    const bias = Math.max(1.5, amplitude * 0.018);
    const half = Math.max(1.25, this.span * 0.004);
    const pathVerts = writePlanRibbon(
      game.prediction.path,
      config,
      time,
      grid.knee,
      phiMax,
      amplitude,
      this.theme.gravity.sheetDepthExp,
      bias,
      half,
      this.pathX,
      this.pathY,
      this.pathZ,
      this.path.positions,
    );
    this.path.geometry.setDrawRange(0, pathVerts);
    mark(this.path.geometry);
    paintInk(this.path, planHex(game, this.theme));
    const orbit = game.prediction.orbit;
    const orbitVerts = orbit
      ? writePlanRibbon(
          orbit,
          config,
          time,
          grid.knee,
          phiMax,
          amplitude,
          this.theme.gravity.sheetDepthExp,
          bias,
          half * 0.7,
          this.pathX,
          this.pathY,
          this.pathZ,
          this.orbit.positions,
        )
      : 0;
    this.orbit.geometry.setDrawRange(0, orbitVerts);
    mark(this.orbit.geometry);
    this.orbit.mesh.visible = orbitVerts > 0;
  }

  dispose(): void {
    disposeObject(this.object);
  }

  /**
   * Dashed ring where tidal stress reaches the sim's warning line.
   * The header's "level 1" has no finite outer radius (any stress above 0
   * is chip level 1), so the ring sits on `tidalDangerRadius`, which is
   * the filled disc it replaces.
   */
  private syncDanger(
    config: SimConfig,
    time: number,
    sheet: boolean,
    amplitude: number,
    phiMax: number,
    now: number,
    zoom: number,
  ): void {
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
        const d = inkDepth(potentialDepth(pose.x, pose.y, config, time), 1, Math.max(phiMax, 1));
        const z = sheet ? sheetDrop(d, amplitude, spec.sheetDepthExp) + 0.8 : 0.5;
        ring.mesh.visible = true;
        ring.mesh.position.set(pose.x, pose.y, z);
        const pad = (spec.tidalPx + 2) / Math.max(zoom, 0.25);
        ring.mesh.scale.set(radius + pad, radius + pad, 1);
        ring.scale.value = radius + pad;
        ring.radius.value = radius;
        ring.dash.value = (now / 1000) * spec.tidalCrawl;
        ring.zoom.value = zoom > 0 ? zoom : 1;
        if (count === 0) this.placeLabel(pose.x, pose.y - radius, z, zoom);
        count += 1;
      }
    }
    for (let i = count; i < this.zones.length; i++) this.zones[i].mesh.visible = false;
    if (count === 0 && this.label) this.label.visible = false;
  }

  private placeLabel(x: number, y: number, z: number, zoom: number): void {
    if (!this.label) this.label = makeTidalLabel();
    if (!this.label) return;
    if (!this.label.parent) this.object.add(this.label);
    this.label.visible = true;
    this.label.position.set(x, y, z);
    const scale = 70 / Math.max(zoom, 0.25);
    this.label.scale.set(scale, scale * 0.28, 1);
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
}

function writeInk(
  grid: GravityGrid,
  sheet: boolean,
  amplitude: number,
  phiMax: number,
  theme: Theme,
  camera: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  config: SimConfig,
  time: number,
  surfacePositions: Float32Array,
  surfaceColors: Float32Array,
  surfaceAlphas: Float32Array,
  positions: Float32Array,
  colors: Float32Array,
  alphas: Float32Array,
  across: Float32Array,
  ends: Float32Array,
  half: Float32Array,
): number {
  const spec = theme.gravity;
  const glass = srgb01(palette.sheetGlass);
  const cols = grid.cols;
  const rows = grid.rows;
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const discs = bodyDiscs(config, time, spec.inkBodyGapPx / zoom);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const o = i * 3;
      const d = inkDepth(grid.depth[i], grid.knee, phiMax);
      const fade = cellEdgeFade(col, row, cols, rows, spec.sheetFadeCells);
      surfacePositions[o] = sheet ? gridX(grid, col) : grid.pinchX[i];
      surfacePositions[o + 1] = sheet ? gridY(grid, row) : grid.pinchY[i];
      surfacePositions[o + 2] = sheet ? sheetDrop(d, amplitude, spec.sheetDepthExp) : 0;
      surfaceColors[o] = glass[0];
      surfaceColors[o + 1] = glass[1];
      surfaceColors[o + 2] = glass[2];
      surfaceAlphas[i] = sheet ? spec.sheetAlpha * fade : 0;
    }
  }
  const buffers: RibbonBuffers = { positions, colors, alphas, across, ends, half };
  let cursor = 0;
  const room = positions.length / 3 - 6;
  const push = (a: number, b: number, major: boolean) => {
    if (cursor > room) return;
    const ao = a * 3;
    const bo = b * 3;
    const ax = surfacePositions[ao];
    const ay = surfacePositions[ao + 1];
    const az = surfacePositions[ao + 2];
    const bx = surfacePositions[bo];
    const by = surfacePositions[bo + 1];
    const bz = surfacePositions[bo + 2];
    const pieces = clipSegment(ax, ay, bx, by, discs);
    const da = inkDepth(grid.depth[a], grid.knee, phiMax);
    const db = inkDepth(grid.depth[b], grid.knee, phiMax);
    const tone = inkTone((da + db) * 0.5, spec.inkGamma);
    const rgb = gridRamp01(rampStop(tone, spec.inkRamp));
    const cell = Math.min(surfaceAlphas[a], surfaceAlphas[b]) / Math.max(spec.sheetAlpha, 1e-4);
    for (let p = 0; p < pieces.length; p++) {
      if (cursor > room) return;
      const piece = pieces[p];
      const mx = (piece[0] + piece[2]) * 0.5;
      const my = (piece[1] + piece[3]) * 0.5;
      const sx = (mx - camera.x) * zoom + width * 0.5;
      const sy = height * 0.5 - (my - camera.y) * zoom;
      const edge = sheet ? (Number.isFinite(cell) ? cell : 1) : screenEdgeFade(sx, sy, width, height, spec.inkEdgePx);
      const alpha = sheet
        ? inkAlpha(tone, major, edge, spec.sheetLineAlpha, spec.sheetLineDepth, spec.inkMajorAlpha)
        : inkAlpha(tone, major, edge, spec.inkAlpha, spec.inkAlphaDepth, spec.inkMajorAlpha);
      if (alpha < 0.012) continue;
      const px = major ? (sheet ? spec.sheetLinePx : spec.inkMajorPx) : sheet ? spec.sheetLinePx : spec.inkMinorPx;
      const zLift = sheet ? Math.max(0.35, amplitude * 0.004) : 0.4;
      cursor = pushRibbon(buffers, cursor, piece[0], piece[1], az + zLift, piece[2], piece[3], bz + zLift, rgb, alpha, px * 0.5);
    }
  };
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
    buffers.positions[o] = corner[0];
    buffers.positions[o + 1] = corner[1];
    buffers.positions[o + 2] = corner[2];
    buffers.ends[o] = corner[3];
    buffers.ends[o + 1] = corner[4];
    buffers.ends[o + 2] = corner[5];
    buffers.colors[o] = rgb[0];
    buffers.colors[o + 1] = rgb[1];
    buffers.colors[o + 2] = rgb[2];
    buffers.alphas[cursor + i] = alpha;
    buffers.across[cursor + i] = corner[6];
    buffers.half[cursor + i] = halfPx;
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

function writePlanRibbon(
  points: readonly { x: number; y: number }[],
  config: SimConfig,
  time: number,
  knee: number,
  phiMax: number,
  amplitude: number,
  exponent: number,
  bias: number,
  half: number,
  xs: Float64Array,
  ys: Float64Array,
  zs: Float64Array,
  positions: Float32Array,
): number {
  const stride = Math.max(1, Math.ceil(points.length / MAX_PATH));
  let count = 0;
  for (let i = 0; i < points.length && count < MAX_PATH; i += stride) {
    const point = points[i];
    xs[count] = point.x;
    ys[count] = point.y;
    zs[count] = sheetDrop(inkDepth(potentialDepth(point.x, point.y, config, time), knee, phiMax), amplitude, exponent) + bias;
    count += 1;
  }
  if (count > 0 && count < MAX_PATH) {
    const end = points[points.length - 1];
    if (end.x !== xs[count - 1] || end.y !== ys[count - 1]) {
      xs[count] = end.x;
      ys[count] = end.y;
      zs[count] = sheetDrop(inkDepth(potentialDepth(end.x, end.y, config, time), knee, phiMax), amplitude, exponent) + bias;
      count += 1;
    }
  }
  if (count < 2) return 0;
  let cursor = 0;
  const room = positions.length - 17;
  for (let i = 0; i < count - 1; i++) {
    if (cursor > room) break;
    const x0 = xs[i];
    const y0 = ys[i];
    const z0 = zs[i];
    const x1 = xs[i + 1];
    const y1 = ys[i + 1];
    const z1 = zs[i + 1];
    let dx = x1 - x0;
    let dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const px = -dy * half;
    const py = dx * half;
    cursor = put(positions, cursor, x0 + px, y0 + py, z0);
    cursor = put(positions, cursor, x0 - px, y0 - py, z0);
    cursor = put(positions, cursor, x1 + px, y1 + py, z1);
    cursor = put(positions, cursor, x0 - px, y0 - py, z0);
    cursor = put(positions, cursor, x1 - px, y1 - py, z1);
    cursor = put(positions, cursor, x1 + px, y1 + py, z1);
  }
  return cursor / 3;
}

function put(positions: Float32Array, cursor: number, x: number, y: number, z: number): number {
  positions[cursor] = x;
  positions[cursor + 1] = y;
  positions[cursor + 2] = z;
  return cursor + 3;
}

function surfaceIndices(cols: number, rows: number): THREE.BufferAttribute {
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = b;
      indices[cursor + 2] = d;
      indices[cursor + 3] = a;
      indices[cursor + 4] = d;
      indices[cursor + 5] = c;
      cursor += 6;
    }
  }
  return new THREE.BufferAttribute(indices, 1);
}

function makeInk(maxVerts: number, hex: string, alpha: number, ribbon: boolean): Ink {
  const positions = new Float32Array(maxVerts * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...srgb01(hex)) },
      uAlpha: { value: alpha },
    },
    vertexShader: inkVert,
    fragmentShader: inkFrag,
    transparent: true,
    depthTest: ribbon,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = ribbon ? new THREE.Mesh(geometry, material) : new THREE.LineSegments(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = ribbon ? -1 : -2;
  return { mesh, positions, geometry };
}

function paintInk(ink: Ink, hex: string): void {
  const material = ink.mesh.material as THREE.ShaderMaterial;
  const [r, g, b] = srgb01(hex);
  material.uniforms.uColor.value.set(r, g, b);
}

function mark(geometry: THREE.BufferGeometry): void {
  const names = ["position", "aColor", "aAlpha", "aAcross", "aEnd", "aHalfPx"];
  for (let i = 0; i < names.length; i++) {
    const attribute = geometry.getAttribute(names[i]);
    if (attribute) attribute.needsUpdate = true;
  }
}

interface TidalRing {
  mesh: THREE.Mesh;
  radius: THREE.IUniform<number>;
  dash: THREE.IUniform<number>;
  zoom: THREE.IUniform<number>;
  scale: THREE.IUniform<number>;
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
  return { mesh, radius, dash, zoom, scale };
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
  canvas.width = 160;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "500 20px ui-sans-serif, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#0B1024";
  ctx.strokeText("tidal stress", 80, 16);
  ctx.fillStyle = "#FF5A5F";
  ctx.fillText("tidal stress", 80, 16);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  sprite.name = "tidal-label";
  sprite.renderOrder = -1;
  sprite.center.set(0.5, 1);
  return sprite;
}

function contourHex(level: number): string {
  if (level >= 0.85) return palette.text;
  if (level >= 0.65) return palette.path;
  if (level >= 0.4) return palette.fuelLow;
  return palette.starGlow;
}

function planHex(game: Game, theme: Theme): string {
  const forecast = game.prediction;
  const hasBurn = game.nodes.some((node) => Math.hypot(node.dvx, node.dvy) >= 0.05);
  if (forecast.status === "won") return theme.colors.resultWin;
  if (forecast.status === "crashed") return theme.colors.resultCrash;
  if (hasBurn && forecast.status === "lost" && forecast.lostReason === "flyby") return theme.colors.trail;
  return theme.colors.path;
}
