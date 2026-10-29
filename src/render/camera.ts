import * as THREE from "three";
import type { Level } from "../level/passage";
import type { Vec2 } from "../sim/physics";

export interface Camera {
  /** World point kept at the center of the view. */
  x: number;
  y: number;
  /** Screen pixels per world unit. */
  zoom: number;
}

/**
 * The one orthographic camera input and the renderer share.
 * Gameplay stays on the XY plane (y up, z = 0). A later tilted
 * space-time view can render a perspective camera at the same group
 * (see SpaceView); this camera is the top-down projection until then.
 *
 * Three's own OrthographicCamera.zoom stays at 1. Our `Camera.zoom`
 * is pixels per world unit and is baked into the frustum, so the two
 * zooms are not multiplied.
 */
export const topDownCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
topDownCamera.name = "top-down";
topDownCamera.zoom = 1;

const scratch = new THREE.Vector3();

/** Point the shared orthographic camera at `camera` for a CSS-pixel viewport. */
export function syncTopDown(camera: Camera, width: number, height: number): void {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const halfW = width / (2 * zoom);
  const halfH = height / (2 * zoom);
  topDownCamera.zoom = 1;
  topDownCamera.left = -halfW;
  topDownCamera.right = halfW;
  topDownCamera.top = halfH;
  topDownCamera.bottom = -halfH;
  topDownCamera.position.set(camera.x, camera.y, 10);
  topDownCamera.up.set(0, 1, 0);
  topDownCamera.quaternion.identity();
  topDownCamera.updateProjectionMatrix();
  topDownCamera.updateMatrixWorld(true);
}

/** World → CSS pixels. Y grows downward. Requires a prior `syncTopDown` this frame. */
export function projectToScreen(x: number, y: number, width: number, height: number, out: Vec2): void {
  const cam = sheetOn && spaceCam ? spaceCam : topDownCamera;
  scratch.set(x, y, 0).project(cam);
  out.x = (scratch.x * 0.5 + 0.5) * width;
  out.y = (0.5 - scratch.y * 0.5) * height;
}

const sheetNear = new THREE.Vector3();
const sheetFar = new THREE.Vector3();

export function worldToScreen(camera: Camera, width: number, height: number, x: number, y: number): Vec2 {
  if (width < 1 || height < 1) return { x: 0, y: 0 };
  syncTopDown(camera, width, height);
  syncSheetIfActive(camera, width, height);
  const out = { x: 0, y: 0 };
  projectToScreen(x, y, width, height, out);
  return out;
}

export function screenToWorld(camera: Camera, width: number, height: number, x: number, y: number): Vec2 {
  if (width < 1 || height < 1) return { x: camera.x, y: camera.y };
  syncTopDown(camera, width, height);
  if (sheetOn && spaceCam) {
    syncSpaceTime(camera, width, height, spaceCam);
    const ndcX = (x / width) * 2 - 1;
    const ndcY = 1 - (y / height) * 2;
    sheetNear.set(ndcX, ndcY, -1).unproject(spaceCam);
    sheetFar.set(ndcX, ndcY, 1).unproject(spaceCam);
    const dz = sheetFar.z - sheetNear.z;
    if (Math.abs(dz) < 1e-8) return { x: camera.x, y: camera.y };
    const t = -sheetNear.z / dz;
    return {
      x: sheetNear.x + (sheetFar.x - sheetNear.x) * t,
      y: sheetNear.y + (sheetFar.y - sheetNear.y) * t,
    };
  }
  scratch.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0).unproject(topDownCamera);
  return { x: scratch.x, y: scratch.y };
}

export function panBy(camera: Camera, dxPixels: number, dyPixels: number): void {
  camera.x -= dxPixels / camera.zoom;
  camera.y += dyPixels / camera.zoom;
}

/** Zoom toward a screen point, keeping the world point under the cursor fixed. */
export function zoomAt(camera: Camera, width: number, height: number, sx: number, sy: number, factor: number): void {
  const before = screenToWorld(camera, width, height, sx, sy);
  camera.zoom = Math.min(6, Math.max(0.18, camera.zoom * factor));
  const after = screenToWorld(camera, width, height, sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
}

/**
 * The parked perspective camera, framed on the same world point as the
 * orthographic view. The offset keeps the original rig's tilt: south of
 * the chart and above the plane, with world Z as up so a well reads as depth.
 */
const SHEET_SLANT = Math.hypot(1400, 1100);
const SHEET_DIR_Y = -1400 / SHEET_SLANT;
const SHEET_DIR_Z = 1100 / SHEET_SLANT;

let spaceCam: THREE.PerspectiveCamera | null = null;
let sheetOn = false;

export function bindSpaceTimeCamera(camera: THREE.PerspectiveCamera): void {
  spaceCam = camera;
}

/** When set, screen projection uses the tilted sheet camera. */
export function setSheetProjection(on: boolean): void {
  sheetOn = on && spaceCam !== null;
}

export function syncSpaceTime(camera: Camera, width: number, height: number, view: THREE.PerspectiveCamera): void {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const half = Math.max(width / (2 * zoom), height / (2 * zoom), 1);
  const fov = THREE.MathUtils.degToRad(view.fov > 0 ? view.fov : 35);
  const distance = (half / Math.tan(fov / 2)) * 1.22;
  view.position.set(camera.x, camera.y + SHEET_DIR_Y * distance, SHEET_DIR_Z * distance);
  view.up.set(0, 0, 1);
  view.lookAt(camera.x, camera.y, 0);
  view.aspect = width / Math.max(1, height);
  view.near = Math.max(0.1, distance / 400);
  view.far = distance * 12;
  view.updateProjectionMatrix();
  view.updateMatrixWorld(true);
}

function syncSheetIfActive(camera: Camera, width: number, height: number): void {
  if (sheetOn && spaceCam) syncSpaceTime(camera, width, height, spaceCam);
}

export function frameLevel(camera: Camera, width: number, height: number, level: Level): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const body of level.bodies) {
    const pad = Math.max(body.captureRadius ?? 0, body.radius) + 110;
    const cover = orbitCover(body, level.bodies);
    minX = Math.min(minX, cover.x - cover.reach - pad);
    maxX = Math.max(maxX, cover.x + cover.reach + pad);
    minY = Math.min(minY, cover.y - cover.reach - pad);
    maxY = Math.max(maxY, cover.y + cover.reach + pad);
  }
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  camera.zoom = Math.min(width / worldW, height / worldH) * 0.9;
  camera.x = (minX + maxX) / 2;
  camera.y = (minY + maxY) / 2;
}

/** Center and extra radius swept by an analytic orbit. Fixed bodies have reach 0. */
function orbitCover(body: Level["bodies"][number], bodies: Level["bodies"], depth = 0): { x: number; y: number; reach: number } {
  const orbit = body.orbit;
  if (!orbit || depth > 4) return { x: body.x, y: body.y, reach: 0 };
  if (orbit.centerId) {
    const center = bodies.find((item) => item.id === orbit.centerId);
    if (!center) return { x: body.x, y: body.y, reach: orbit.radius };
    const parent = orbitCover(center, bodies, depth + 1);
    return { x: parent.x, y: parent.y, reach: parent.reach + orbit.radius };
  }
  return { x: orbit.cx ?? body.x, y: orbit.cy ?? body.y, reach: orbit.radius };
}
