import * as THREE from "three";

/**
 * Point particles. Port of design/shaders/points.vert and points.frag.
 * design/shader-specs.md §6.2. Discs and four-point sparkles, twinkle,
 * and a floor of 0.7 px (uMinPx, scaled by the device pixel ratio).
 */
export const POINTS_VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute float aSize;
attribute vec4 aColor;
attribute float aPhase;
attribute float aShape;
uniform vec2 uRes, uOrigin;
uniform float uZoom, uTime, uTwinkle, uTwinkleT, uMinPx;
varying vec4 vColor;
varying float vShape, vR;
void main() {
  vec2 c = uOrigin + aPos * uZoom;
  gl_Position = vec4(c / uRes * 2.0 - 1.0, 0.0, 1.0);
  float r = max(aSize * uZoom, uMinPx);
  float k = aShape > 0.5 ? 3.2 : 1.0;
  gl_PointSize = 2.0 * r * k + 2.0;
  float tw = 1.0 - uTwinkle * 0.5 * (1.0 + sin(6.2831853 * (uTime / uTwinkleT + aPhase)));
  vColor = vec4(aColor.rgb, aColor.a * tw * min(1.0, aSize * uZoom / uMinPx));
  vShape = aShape;
  vR = r * k;
}
`;

export const POINTS_FRAGMENT = /* glsl */ `
precision highp float;
varying vec4 vColor;
varying float vShape, vR;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * (2.0 * vR + 2.0);
  float a;
  if (vShape < 0.5) {
    a = 1.0 - smoothstep(vR - 0.5, vR + 0.5, length(p));
  } else {
    float core = vR / 3.2;
    float arm = max(1.0 - smoothstep(core * 0.18, core * 0.18 + 0.8, abs(p.x)) * 1.0, 0.0) * step(abs(p.y), vR) * (1.0 - abs(p.y) / vR)
      + max(1.0 - smoothstep(core * 0.18, core * 0.18 + 0.8, abs(p.y)), 0.0) * step(abs(p.x), vR) * (1.0 - abs(p.x) / vR);
    a = clamp(arm + 1.0 - smoothstep(core * 0.9 - 0.5, core * 0.9 + 0.5, length(p)), 0.0, 1.0);
  }
  a *= vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

/** Spec floor, in CSS pixels. syncField multiplies by the device pixel ratio. */
export const POINT_MIN_PX = 0.7;

export interface PointCloud {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  pos: Float32Array;
  posAttr: THREE.BufferAttribute;
}

export function createPointMaterial(twinkle: number, twinkleT: number): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uOrigin: { value: new THREE.Vector2(0, 0) },
      uZoom: { value: 1 },
      uTime: { value: 0 },
      uTwinkle: { value: twinkle },
      uTwinkleT: { value: twinkleT },
      uMinPx: { value: POINT_MIN_PX },
    },
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    precision: "highp",
  });
  material.premultipliedAlpha = true;
  return material;
}

export function createPointCloud(count: number, twinkle: number, twinkleT: number, name: string): PointCloud {
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 2);
  const position = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const color = new Float32Array(count * 4);
  const phase = new Float32Array(count);
  const shape = new Float32Array(count);
  const posAttr = new THREE.BufferAttribute(pos, 2);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aPos", posAttr);
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 4));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute("aShape", new THREE.BufferAttribute(shape, 1));
  const material = createPointMaterial(twinkle, twinkleT);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 0;
  points.name = name;
  return { points, material, pos, posAttr };
}
