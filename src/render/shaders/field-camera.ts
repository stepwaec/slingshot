import * as THREE from "three";
import type { Camera } from "../camera";

/**
 * Screen placement for the R2.5 rock and point shaders.
 * design/shaders/rock.vert, points.vert. y is up, matching the preview.
 * Units are device pixels so `gl_PointSize` and the rock's pixel AA match the buffer.
 */
export function syncField(
  uniforms: Record<string, THREE.IUniform | undefined>,
  camera: Camera,
  width: number,
  height: number,
  dpr: number,
  time: number,
): void {
  const density = dpr > 0 ? dpr : 1;
  const zoom = (camera.zoom > 0 ? camera.zoom : 1) * density;
  const resX = Math.max(1, width) * density;
  const resY = Math.max(1, height) * density;
  const res = uniforms.uRes?.value as THREE.Vector2 | undefined;
  const origin = uniforms.uOrigin?.value as THREE.Vector2 | undefined;
  res?.set(resX, resY);
  origin?.set(resX * 0.5 - camera.x * zoom, resY * 0.5 - camera.y * zoom);
  if (uniforms.uZoom) uniforms.uZoom.value = zoom;
  if (uniforms.uTime) uniforms.uTime.value = time;
  if (uniforms.uMinPx) uniforms.uMinPx.value = 0.7 * density;
}
