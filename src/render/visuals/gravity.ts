import * as THREE from "three";
import { isEditing, type Game } from "../../game/state";
import { simConfigFromLevel } from "../../level/catalog";
import { bodyPose, gravityConstant, isCompactBody, potentialDepth, tidalDangerRadius, type SimConfig } from "../../sim/physics";
import {
  fieldSpan,
  framedBounds,
  gridX,
  gridY,
  sampleGravityGrid,
  scaleWellDepth,
  wellHeight,
  writeClockContours,
  type GravityGrid,
} from "../gravityField";
import { palette, srgb01 } from "../palette";
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
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const surfaceFrag = /* glsl */ `
varying vec3 vColor;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(vColor, uAlpha);
}
`;

const lineVert = /* glsl */ `
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const lineFrag = /* glsl */ `
varying vec3 vColor;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(vColor, uAlpha);
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

const RAMP: ReadonlyArray<readonly [number, [number, number, number]]> = [
  [0, srgb01(palette.planetStartShadow)],
  [0.18, srgb01(palette.planetStartBase)],
  [0.42, srgb01(palette.planetXBase)],
  [0.68, srgb01(palette.fuelLow)],
  [1, srgb01(palette.starGlow)],
];

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
  private readonly surface: THREE.Mesh;
  private readonly surfaceAlpha: THREE.IUniform;
  private readonly gridPositions: Float32Array;
  private readonly gridColors: Float32Array;
  private readonly gridLines: THREE.LineSegments;
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
  private readonly zones: THREE.Mesh[] = [];
  private readonly zoneMaterial = new THREE.MeshBasicMaterial({
    color: 0xff5a5f,
    transparent: true,
    opacity: 0.33,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

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
    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute("position", new THREE.BufferAttribute(this.surfacePositions, 3));
    surfaceGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.surfaceColors, 3));
    surfaceGeometry.setIndex(surfaceIndices(cols, rows));
    this.surfaceAlpha = { value: theme.gravity.sheetAlpha };
    this.surface = new THREE.Mesh(
      surfaceGeometry,
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: this.surfaceAlpha },
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
    this.gridPositions = new Float32Array(segments * 2 * 3);
    this.gridColors = new Float32Array(segments * 2 * 3);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.BufferAttribute(this.gridPositions, 3));
    gridGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.gridColors, 3));
    this.gridLines = new THREE.LineSegments(
      gridGeometry,
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0.95 } },
        vertexShader: lineVert,
        fragmentShader: lineFrag,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
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
    this.syncDanger(config, time);

    const material = this.surface.material as THREE.ShaderMaterial;
    material.depthTest = sheet;
    material.depthWrite = sheet;
    this.surface.visible = sheet;
    this.surfaceAlpha.value = this.theme.gravity.sheetAlpha;
    this.gridLines.visible = true;
    const lineMaterial = this.gridLines.material as THREE.ShaderMaterial;
    lineMaterial.depthTest = sheet;

    const drawKey = `${this.fieldKey}|${sheet}|${amplitude}`;
    if (drawKey !== this.drawKey) {
      if (sheet) {
        writeSurface(grid, this.surfacePositions, this.surfaceColors, true, amplitude);
        mark(this.surface.geometry);
        writeGridLines(grid, this.surfacePositions, this.surfaceColors, this.gridPositions, this.gridColors, amplitude);
        this.gridLines.geometry.setDrawRange(0, this.gridPositions.length / 3);
      } else {
        const verts = writePinchedLines(grid, this.gridPositions, this.gridColors, this.theme.gravity.flatStride);
        this.gridLines.geometry.setDrawRange(0, verts);
      }
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
      amplitude,
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
          amplitude,
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
    this.zoneMaterial.dispose();
    disposeObject(this.object);
  }

  /** Red discs where tidal stress reaches the warning line. Hidden when the knob is off. */
  private syncDanger(config: SimConfig, time: number): void {
    const strength = config.tidalStrength ?? 0;
    const g = gravityConstant(config);
    let count = 0;
    if (strength > 0) {
      for (let i = 0; i < config.bodies.length; i++) {
        const body = config.bodies[i];
        if (!isCompactBody(body)) continue;
        const radius = tidalDangerRadius(body, g, strength);
        if (!(radius > 0)) continue;
        let mesh = this.zones[count];
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.zoneMaterial);
          mesh.name = "tidal-zone";
          mesh.renderOrder = 2;
          this.object.add(mesh);
          this.zones.push(mesh);
        }
        const pose = bodyPose(body, time, config.bodies);
        mesh.visible = true;
        mesh.position.set(pose.x, pose.y, 0);
        mesh.scale.set(radius, radius, 1);
        count += 1;
      }
    }
    for (let i = count; i < this.zones.length; i++) this.zones[i].visible = false;
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

function writePinchedLines(grid: GravityGrid, positions: Float32Array, colors: Float32Array, stride: number): number {
  const cols = grid.cols;
  const rows = grid.rows;
  const step = Math.max(1, stride);
  const [r, g, b] = srgb01(palette.text);
  let cursor = 0;
  const room = positions.length - 5;
  const push = (a: number, bIndex: number) => {
    if (cursor > room) return;
    positions[cursor] = grid.pinchX[a];
    positions[cursor + 1] = grid.pinchY[a];
    positions[cursor + 2] = 0.4;
    positions[cursor + 3] = grid.pinchX[bIndex];
    positions[cursor + 4] = grid.pinchY[bIndex];
    positions[cursor + 5] = 0.4;
    colors[cursor] = r;
    colors[cursor + 1] = g;
    colors[cursor + 2] = b;
    colors[cursor + 3] = r;
    colors[cursor + 4] = g;
    colors[cursor + 5] = b;
    cursor += 6;
  };
  for (let row = 0; row < rows; row += step) {
    for (let col = 0; col < cols - 1; col++) push(row * cols + col, row * cols + col + 1);
  }
  for (let col = 0; col < cols; col += step) {
    for (let row = 0; row < rows - 1; row++) push(row * cols + col, (row + 1) * cols + col);
  }
  return cursor / 3;
}

function writeSurface(
  grid: GravityGrid,
  positions: Float32Array,
  colors: Float32Array,
  sheet: boolean,
  amplitude: number,
): void {
  const cols = grid.cols;
  const rows = grid.rows;
  for (let row = 0; row < rows; row++) {
    const y = gridY(grid, row);
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const o = i * 3;
      positions[o] = gridX(grid, col);
      positions[o + 1] = y;
      positions[o + 2] = sheet ? wellHeight(grid.scale[i], amplitude) : 0;
      writeRamp(grid.scale[i], colors, o);
    }
  }
}

function writeGridLines(
  grid: GravityGrid,
  surfacePositions: Float32Array,
  surfaceColors: Float32Array,
  positions: Float32Array,
  colors: Float32Array,
  amplitude: number,
): void {
  const cols = grid.cols;
  const rows = grid.rows;
  const liftZ = Math.max(0.4, amplitude * 0.006);
  let cursor = 0;
  const push = (a: number, b: number) => {
    const ao = a * 3;
    const bo = b * 3;
    positions[cursor] = surfacePositions[ao];
    positions[cursor + 1] = surfacePositions[ao + 1];
    positions[cursor + 2] = surfacePositions[ao + 2] + liftZ;
    positions[cursor + 3] = surfacePositions[bo];
    positions[cursor + 4] = surfacePositions[bo + 1];
    positions[cursor + 5] = surfacePositions[bo + 2] + liftZ;
    for (let k = 0; k < 3; k++) {
      colors[cursor + k] = lift(surfaceColors[ao + k]);
      colors[cursor + 3 + k] = lift(surfaceColors[bo + k]);
    }
    cursor += 6;
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols - 1; col++) push(row * cols + col, row * cols + col + 1);
  }
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows - 1; row++) push(row * cols + col, (row + 1) * cols + col);
  }
}

function writePlanRibbon(
  points: readonly { x: number; y: number }[],
  config: SimConfig,
  time: number,
  knee: number,
  amplitude: number,
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
    zs[count] = wellHeight(scaleWellDepth(potentialDepth(point.x, point.y, config, time), knee), amplitude) + bias;
    count += 1;
  }
  if (count > 0 && count < MAX_PATH) {
    const end = points[points.length - 1];
    if (end.x !== xs[count - 1] || end.y !== ys[count - 1]) {
      xs[count] = end.x;
      ys[count] = end.y;
      zs[count] = wellHeight(scaleWellDepth(potentialDepth(end.x, end.y, config, time), knee), amplitude) + bias;
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

function writeRamp(scale: number, out: Float32Array, offset: number): void {
  const u = scale < 0 ? 0 : scale > 1 ? 1 : scale;
  let i = 1;
  while (i < RAMP.length - 1 && RAMP[i][0] < u) i += 1;
  const [t0, c0] = RAMP[i - 1];
  const [t1, c1] = RAMP[i];
  const k = (u - t0) / (t1 - t0 || 1);
  out[offset] = c0[0] + (c1[0] - c0[0]) * k;
  out[offset + 1] = c0[1] + (c1[1] - c0[1]) * k;
  out[offset + 2] = c0[2] + (c1[2] - c0[2]) * k;
}

function lift(channel: number): number {
  return channel + (1 - channel) * 0.32;
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
  const position = geometry.getAttribute("position");
  position.needsUpdate = true;
  const color = geometry.getAttribute("aColor");
  if (color) color.needsUpdate = true;
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
