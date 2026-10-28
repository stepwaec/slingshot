import type { Level } from "../level/passage";
import type { Vec2 } from "../sim/physics";

export interface Camera {
  /** World point kept at the center of the view. */
  x: number;
  y: number;
  /** Screen pixels per world unit. */
  zoom: number;
}

export function worldToScreen(camera: Camera, width: number, height: number, x: number, y: number): Vec2 {
  return {
    x: (x - camera.x) * camera.zoom + width / 2,
    y: (camera.y - y) * camera.zoom + height / 2,
  };
}

export function screenToWorld(camera: Camera, width: number, height: number, x: number, y: number): Vec2 {
  return {
    x: (x - width / 2) / camera.zoom + camera.x,
    y: camera.y - (y - height / 2) / camera.zoom,
  };
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
