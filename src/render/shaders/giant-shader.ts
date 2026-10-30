import * as THREE from "three";
import { srgbVec } from "../visuals/materials";
import { blankRingMap, giantTexture } from "./giant-maps";
import { GIANTS, giantExtent, type GiantKey } from "./giant-params";
import { impostorMaterial } from "./impostor";

/**
 * Gas giants and rings. Port of design/shaders/giant.frag.
 * design/shader-specs.md §4. The outer rim's night stop is 0, the same
 * night-limb arc removed in #76 and #78. The disc haze keeps 0.06.
 */
export const GIANT_FRAGMENT = /* glsl */ `
uniform vec2 uCenter;
uniform float uR;
uniform float uTime;
uniform float uExtent;
uniform vec3 uLight;
uniform sampler2D uAlbedo;
uniform sampler2D uRings;
uniform float uStart;
uniform float uSpin;
uniform float uJet[17];
uniform float uRoll;
uniform vec3 uHi;
uniform float uHiA;
uniform vec3 uWarm;
uniform float uWarmA;
uniform vec3 uNight0;
uniform vec3 uNight1;
uniform vec3 uHaze0;
uniform vec3 uHaze1;
uniform float uHazeA0;
uniform float uHazeA1;
uniform vec3 uRim0;
uniform vec3 uRim1;
uniform vec3 uLimb;
uniform float uLimbA;
uniform float uHasRings;
uniform float uB;
uniform float uRho0;
uniform float uRho1;
uniform vec3 uRingShadow;
uniform float uRingShadowA;
uniform float uPlanetShadowA;
uniform float uSparkle;
uniform float uSparkleT;
uniform float uSparkleRho;
uniform float uHex;
uniform vec3 uHexCol;
uniform vec3 uHexEdge;
uniform float uPole;
uniform vec3 uPoleCol;
uniform float uPoleA;
const float PI = 3.14159265;
/* straight-alpha over. Premultiply only the final pixel. design/shader-specs.md §1. */
vec4 over(vec4 d, vec3 c, float a) {
  a = clamp(a, 0.0, 1.0);
  float o = a + d.a * (1.0 - a);
  return vec4(o > 0.0 ? (c * a + d.rgb * d.a * (1.0 - a)) / o : c, o);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float jet(float v) {
  float r = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) / 16.0;
    if (v >= a && v <= a + 1.0 / 16.0) r = mix(uJet[i], uJet[i + 1], (v - a) * 16.0);
  }
  return r;
}
vec4 ring(float rho) {
  if (rho < uRho0 || rho > uRho1) return vec4(0.0);
  return texture2D(uRings, vec2((rho - uRho0) / (uRho1 - uRho0), 0.5));
}
vec4 ringAA(float rho, float f) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 5; i++) {
    vec4 t = ring(rho + f * (float(i) / 4.0 - 0.5));
    acc += vec4(t.rgb * t.a, t.a);
  }
  acc /= 5.0;
  return vec4(acc.rgb / max(acc.a, 1e-4), acc.a);
}
void main() {
  float px = 1.0 / uR;
  float c = cos(radians(uRoll));
  float s = sin(radians(uRoll));
  vec2 sc = (gl_FragCoord.xy - uCenter) / uR;
  if (length(sc) > uExtent + 3.0 * px) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 uv = vec2(c * sc.x + s * sc.y, -s * sc.x + c * sc.y);
  vec3 L = normalize(vec3(c * uLight.x + s * uLight.y, -s * uLight.x + c * uLight.y, uLight.z));
  float r = length(uv);
  float cosI = sqrt(1.0 - uB * uB);
  vec2 Lxy = normalize(L.xy);
  float sm = dot(uv, Lxy) / 0.706;
  float mask = sm > 0.0 ? mix(0.45, 1.0, clamp(sm, 0.0, 1.0)) : mix(0.45, 0.06, clamp(-sm, 0.0, 1.0));
  // Rim night edge is 0, not the 0.06 floor (#76, #78).
  float rimMask = sm > 0.0 ? mix(0.45, 1.0, clamp(sm, 0.0, 1.0)) : mix(0.45, 0.0, clamp(-sm, 0.0, 1.0));
  vec4 rc = vec4(0.0);
  float bb = 0.0;
  if (uHasRings > 0.5) {
    bb = uv.y / uB;
    float rho = length(vec2(uv.x, bb));
    float fp = px * length(vec2(uv.x, uv.y / (uB * uB))) / max(rho, 1e-4);
    rc = ringAA(rho, fp);
    if (rc.a > 0.0) {
      vec3 P = vec3(uv.x, uv.y, -bb * cosI);
      float pl = dot(P, L);
      float disc = pl * pl - (dot(P, P) - 1.0);
      float shad = (disc > 0.0 && -pl - sqrt(max(disc, 0.0)) > 0.0) ? smoothstep(0.0, 0.02, disc) : 0.0;
      rc.rgb = mix(rc.rgb, vec3(0.02, 0.043, 0.118), shad * uPlanetShadowA);
      if (uSparkle > 0.5) {
        float w = 2.0 * PI / (uSparkleT * pow(rho / uSparkleRho, 1.5));
        float ph = atan(bb, uv.x) + w * uTime;
        float h = hash(vec2(floor(rho * uR * 0.9), floor(ph * rho * uR * 0.45)));
        rc.rgb = mix(rc.rgb, vec3(1.0), step(0.93, h) * (0.3 + 0.3 * hash(vec2(h, 3.0))) * (1.0 - shad));
      }
    }
  }
  vec4 col = vec4(0.0);
  if (rc.a > 0.0 && bb > 0.0) col = over(col, rc.rgb, rc.a);
  if (r < 1.0 + px) {
    float rr = min(r, 0.9999);
    vec3 n = vec3(uv, sqrt(1.0 - rr * rr));
    float lon = atan(n.x, n.z);
    float v = (1.0 + n.y) * 0.5;
    float vs = 1.0 - v;
    float u = uStart + lon / (2.0 * PI) - uTime * (1.0 / uSpin + jet(vs));
    vec3 a = texture2D(uAlbedo, vec2(fract(u), v)).rgb;
    if (uHex > 0.5) {
      float colat = acos(clamp(n.y, -1.0, 1.0));
      float az = atan(n.z, n.x) + uTime * 2.0 * PI / uSpin;
      float k = mod(az, PI / 3.0) - PI / 6.0;
      float hb = 0.26 / cos(k);
      float e = colat - hb;
      a = mix(a, uHexCol, 0.5 * (1.0 - smoothstep(-px * 2.0, 0.0, e)));
      a = mix(a, uHexEdge, 0.5 * (1.0 - smoothstep(0.0, px * 2.0, abs(e))));
    }
    if (uPole > 0.5) a = mix(a, uPoleCol, uPoleA * smoothstep(0.55, 0.98, n.y));
    float d = dot(n, L);
    vec3 cc = mix(a, uLimb, uLimbA * smoothstep(0.7, 1.0, rr));
    if (uHasRings > 0.5) {
      vec3 nr = vec3(0.0, cosI, uB);
      float dn = dot(L, nr);
      if (abs(dn) > 1e-3) {
        float t = -dot(n, nr) / dn;
        if (t > 0.0) {
          vec3 Q = n + t * L;
          float rho = length(vec2(Q.x, dot(Q, vec3(0.0, uB, -cosI))));
          cc = mix(cc, uRingShadow, ringAA(rho, 3.0 * px).a * uRingShadowA * step(0.0, d));
        }
      }
    }
    cc = mix(cc, uHi, uHiA * pow(max(d, 0.0), 10.0));
    cc = mix(cc, uWarm, uWarmA * (1.0 - smoothstep(0.0, 0.07, abs(d - 0.06))));
    float night = d > -0.02
      ? mix(0.0, 0.74, smoothstep(0.12, -0.02, d))
      : d > -0.14
        ? mix(0.74, 0.97, (-0.02 - d) / 0.12)
        : mix(0.97, 1.0, clamp((-0.14 - d) / 0.14, 0.0, 1.0));
    cc = mix(cc, d > -0.14 ? uNight0 : uNight1, night);
    float ha = rr < 0.78 ? 0.0 : rr < 0.96 ? mix(0.0, uHazeA0, (rr - 0.78) / 0.18) : mix(uHazeA0, uHazeA1, (rr - 0.96) / 0.04);
    cc = mix(cc, rr < 0.96 ? uHaze0 : mix(uHaze0, uHaze1, (rr - 0.96) / 0.04), ha * mask);
    col = over(col, cc, smoothstep(1.0 + px * 0.5, 1.0 - px * 0.5, r));
  }
  if (r > 0.96 && r < 1.08) {
    float ra = r < 1.0
      ? mix(0.0, 0.95, smoothstep(0.969, 1.0, r))
      : r < 1.028
        ? mix(0.95, 0.4, (r - 1.0) / 0.028)
        : mix(0.4, 0.0, clamp((r - 1.028) / 0.049, 0.0, 1.0));
    col = over(col, r < 1.0 ? uRim0 : mix(uRim0, uRim1, clamp((r - 1.0) / 0.028, 0.0, 1.0)), ra * rimMask);
  }
  if (rc.a > 0.0 && bb <= 0.0) col = over(col, rc.rgb, rc.a);
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}
`;

export function createGiantMaterial(key: GiantKey): THREE.ShaderMaterial {
  const look = GIANTS[key];
  const light = look.light;
  return impostorMaterial(GIANT_FRAGMENT, {
    uCenter: { value: new THREE.Vector2() },
    uR: { value: look.designR },
    uTime: { value: 0 },
    uExtent: { value: giantExtent(key) },
    uLight: { value: new THREE.Vector3(light[0], light[1], light[2]) },
    uAlbedo: { value: giantTexture(look.albedo) },
    uRings: { value: look.rings ? giantTexture(look.rings) : blankRingMap() },
    uStart: { value: look.start },
    uSpin: { value: look.spin },
    uJet: { value: new Float32Array(look.jet) },
    uRoll: { value: look.roll },
    uHi: { value: srgbVec(look.hi) },
    uHiA: { value: look.hiA },
    uWarm: { value: srgbVec(look.warm) },
    uWarmA: { value: look.warmA },
    uNight0: { value: srgbVec(look.night0) },
    uNight1: { value: srgbVec(look.night1) },
    uHaze0: { value: srgbVec(look.haze0) },
    uHaze1: { value: srgbVec(look.haze1) },
    uHazeA0: { value: look.hazeA0 },
    uHazeA1: { value: look.hazeA1 },
    uRim0: { value: srgbVec(look.rim0) },
    uRim1: { value: srgbVec(look.rim1) },
    uLimb: { value: srgbVec(look.limb) },
    uLimbA: { value: look.limbA },
    uHasRings: { value: look.hasRings },
    uB: { value: look.B },
    uRho0: { value: look.rho0 },
    uRho1: { value: look.rho1 },
    uRingShadow: { value: srgbVec(look.ringShadow) },
    uRingShadowA: { value: look.ringShadowA },
    uPlanetShadowA: { value: look.planetShadowA },
    uSparkle: { value: look.sparkle },
    uSparkleT: { value: look.sparkleT },
    uSparkleRho: { value: look.sparkleRho },
    uHex: { value: look.hex },
    uHexCol: { value: srgbVec(look.hexCol) },
    uHexEdge: { value: srgbVec(look.hexEdge) },
    uPole: { value: look.pole },
    uPoleCol: { value: srgbVec(look.poleCol) },
    uPoleA: { value: look.poleA },
  });
}
