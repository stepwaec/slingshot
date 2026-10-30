import * as THREE from "three";
import type { BeltMaterial } from "../../sim/belts";

/**
 * Instanced rocks. Port of design/shaders/rock.vert and rock.frag.
 * design/shader-specs.md §6.1. S, C and M are the reference palettes.
 * Kuiper (type 3) keeps the belt atlas's K row so Frost's belt stays icy.
 * The silhouette tumbles. The light stays on uStar.
 */
export const ROCK_VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute float aSize;
attribute float aSeed;
attribute float aType;
attribute float aSpin;
uniform vec2 uRes, uOrigin;
uniform float uZoom, uTime;
uniform vec2 uStar;
varying vec2 vP;
varying float vRot, vSeed, vType, vPx;
varying vec2 vL;
void main() {
  vec2 aCorner = position.xy;
  vec2 c = uOrigin + aPos * uZoom;
  float s = aSize * uZoom * 1.45;
  vec2 px = c + aCorner * s;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vP = aCorner * 1.45;
  vRot = 6.2831853 * uTime / aSpin + aSeed * 6.2831853;
  vSeed = aSeed;
  vType = aType;
  vPx = 1.0 / (aSize * uZoom);
  vL = normalize(uStar - aPos);
}
`;

export const ROCK_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vP;
varying float vRot, vSeed, vType, vPx;
varying vec2 vL;
float h(float n) { return fract(sin(n * 91.3458 + vSeed * 47.13) * 43758.5453); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float shape(vec2 q) {
  float asp = 1.0 + 0.35 * h(1.0);
  q.x /= asp;
  float t = atan(q.y, q.x);
  float r = 0.86;
  for (int k = 2; k < 6; k++) {
    float fk = float(k);
    r += (h(fk) - 0.5) * 0.30 / fk * 2.0 * cos(fk * t + 6.283 * h(fk + 10.0));
  }
  return length(q) - r * mix(1.0, 0.9, asp - 1.0);
}
void main() {
  vec3 rim = vec3(0.941, 0.863, 0.753), lit = vec3(0.784, 0.651, 0.518), base = vec3(0.604, 0.478, 0.369), dark = vec3(0.353, 0.275, 0.212), night = vec3(0.071, 0.055, 0.078), acc = vec3(0.753, 0.337, 0.165);
  float accA = 0.45;
  if (vType > 0.5 && vType < 1.5) {
    rim = vec3(0.847, 0.8, 0.745); lit = vec3(0.557, 0.518, 0.471); base = vec3(0.384, 0.345, 0.306); dark = vec3(0.227, 0.2, 0.176); night = vec3(0.047, 0.043, 0.071); acc = vec3(0.165, 0.141, 0.125); accA = 0.5;
  }
  if (vType > 1.5 && vType < 2.5) {
    rim = vec3(0.933, 0.949, 0.98); lit = vec3(0.714, 0.749, 0.824); base = vec3(0.525, 0.565, 0.659); dark = vec3(0.306, 0.337, 0.424); night = vec3(0.039, 0.051, 0.094); acc = vec3(0.863, 0.894, 0.965); accA = 0.35;
  }
  if (vType > 2.5) {
    rim = vec3(1.0, 0.902, 0.847); lit = vec3(0.784, 0.533, 0.439); base = vec3(0.604, 0.353, 0.275); dark = vec3(0.353, 0.180, 0.149); night = vec3(0.071, 0.039, 0.063); acc = vec3(0.863, 0.922, 0.961); accA = 0.75;
  }
  vec2 q = rot(vP, -vRot);
  float dRim = shape(q);
  float aaRim = 1.0 - smoothstep(-vPx * 0.5, vPx * 0.5, dRim);
  if (aaRim <= 0.0) discard;
  vec4 col = vec4(rim, aaRim);
  vec2 qf = rot(vP + vL * 0.09, -vRot);
  float dFace = shape(qf);
  float u = dot(vP, vL);
  vec3 face = u > 0.0 ? mix(base, lit, clamp(u / 1.0, 0.0, 1.0)) : mix(base, dark, clamp(-u / 1.0, 0.0, 1.0));
  col.rgb = mix(col.rgb, face, 1.0 - smoothstep(-vPx * 0.5, vPx * 0.5, dFace));
  for (int i = 0; i < 4; i++) {
    if (float(i) >= 2.0 + floor(h(20.0) * 3.0)) break;
    vec2 c = (vec2(h(30.0 + float(i)), h(40.0 + float(i))) - 0.5) * 1.1;
    float r = 0.16 + 0.12 * h(50.0 + float(i));
    col.rgb = mix(col.rgb, acc, accA * (1.0 - smoothstep(r - vPx, r, length((q - c) * vec2(1.0, 1.2)))));
  }
  for (int i = 0; i < 2; i++) {
    if (float(i) >= 1.0 + floor(h(60.0) * 2.0)) break;
    vec2 c = (vec2(h(70.0 + float(i)), h(80.0 + float(i))) - 0.5) * 0.9;
    float r = 0.14 + 0.1 * h(90.0 + float(i));
    vec2 cs = rot(c, vRot);
    col.rgb = mix(col.rgb, rim, 0.7 * (1.0 - smoothstep(r - vPx, r, length(vP - cs))));
    col.rgb = mix(col.rgb, dark, 1.0 - smoothstep(r * 0.8 - vPx, r * 0.8, length(vP - cs + vL * r * 0.25)));
  }
  float s = clamp((1.0 - u / 1.0) * 0.5, 0.0, 1.0);
  col.rgb = mix(col.rgb, vec3(1.0, 0.58, 0.333), 0.18 * smoothstep(0.5, 0.6, s) * (1.0 - smoothstep(0.6, 0.64, s)));
  float na = s < 0.6 ? 0.0 : s < 0.64 ? mix(0.0, 0.6, (s - 0.6) / 0.04) : mix(0.6, 0.88, clamp((s - 0.64) / 0.36, 0.0, 1.0));
  col.rgb = mix(col.rgb, night, na);
  col.rgb = mix(col.rgb, night, 0.55 * (1.0 - smoothstep(0.0, vPx * 0.8, abs(dRim + vPx * 0.4))));
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}
`;

/** 0 S, 1 C, 2 M, 3 Kuiper. */
export function rockTypeIndex(material: BeltMaterial): number {
  if (material === "C") return 1;
  if (material === "M") return 2;
  if (material === "K") return 3;
  return 0;
}

/** Cosmetic tumble, seconds per turn. The sign is the direction. */
export function tumblePeriod(seed: number): number {
  const span = 18 + Math.abs(seed % 1) * 40;
  return seed - Math.floor(seed) >= 0.5 ? span : -span;
}

export function rockSeed(index: number, shape: number, distance: number): number {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(shape + 1, 0x85ebca6b);
  h ^= Math.imul(Math.round(distance * 10) + 1, 0xc2b2ae35);
  return (h >>> 0) / 4294967296;
}

export interface RockMesh {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  pos: Float32Array;
  posAttr: THREE.InstancedBufferAttribute;
}

export function createRockMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uOrigin: { value: new THREE.Vector2(0, 0) },
      uZoom: { value: 1 },
      uTime: { value: 0 },
      uStar: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: ROCK_VERTEX,
    fragmentShader: ROCK_FRAGMENT,
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

export function createRockMesh(count: number, name: string): RockMesh {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const pos = new Float32Array(count * 2);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const type = new Float32Array(count);
  const spin = new Float32Array(count);
  const posAttr = new THREE.InstancedBufferAttribute(pos, 2);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aPos", posAttr);
  geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 1));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
  geometry.setAttribute("aType", new THREE.InstancedBufferAttribute(type, 1));
  geometry.setAttribute("aSpin", new THREE.InstancedBufferAttribute(spin, 1));
  const material = createRockMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = name;
  return { mesh, material, pos, posAttr };
}

export function writeRock(
  mesh: RockMesh,
  index: number,
  size: number,
  seed: number,
  type: number,
  spin: number,
): void {
  const geometry = mesh.mesh.geometry;
  (geometry.getAttribute("aSize") as THREE.InstancedBufferAttribute).setX(index, size);
  (geometry.getAttribute("aSeed") as THREE.InstancedBufferAttribute).setX(index, seed);
  (geometry.getAttribute("aType") as THREE.InstancedBufferAttribute).setX(index, type);
  (geometry.getAttribute("aSpin") as THREE.InstancedBufferAttribute).setX(index, spin === 0 ? 30 : spin);
}
