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
  scratch.set(x, y, 0).project(topDownCamera);
  out.x = (scratch.x * 0.5 + 0.5) * width;
  out.y = (0.5 - scratch.y * 0.5) * height;
}

export function worldToScreen(camera: Camera, width: number, height: number, x: number, y: number): Vec2 {
  if (width < 1 || height < 1) return { x: 0, y: 0 };
  syncTopDown(camera, width, height);
  const out = { x: 0, y: 0 };
  projectToScreen(x, y, width, height, out);
  return out;
}

export function screenToWorld(camera: Camera, width: number, height: number, x: number, y: number): Vec2 {
  if (width < 1 || height < 1) return { x: camera.x, y: camera.y };
  syncTopDown(camera, width, height);
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

export function frameLevel(camera: Camera, width: number, height: number, level: Level): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const body of level.bodies) {
    const pad = Math.max(body.captureRadius ?? 0, body.radius) + 110;
    minX = Math.min(minX, body.x - pad);
    maxX = Math.max(maxX, body.x + pad);
    minY = Math.min(minY, body.y - pad);
    maxY = Math.max(maxY, body.y + pad);
  }
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  camera.zoom = Math.min(width / worldW, height / worldH) * 0.9;
  camera.x = (minX + maxX) / 2;
  camera.y = (minY + maxY) / 2;
}
