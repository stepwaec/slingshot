import * as THREE from "three";
import { palette } from "../palette";
import { theme } from "../theme";
import { srgbVec } from "../visuals/materials";
import { impostorMaterial } from "./impostor";
import { planetMapOrBlank } from "./planet-maps";
import { PLANETS, type PlanetKey } from "./planet-params";

/**
 * Rocky planets and moons. Port of design/shaders/planet.frag.
 * design/shader-specs.md §3. Two departures, both named:
 * the rim's night stop is 0 (the night-limb arc from #76 and #78),
 * and Titan draws the detached haze from sol/titan.svg, which planet.frag omits.
 */
export const PLANET_FRAGMENT = /* glsl */ `
uniform vec2 uCenter;
uniform float uR;
uniform float uTime;
uniform float uExtent;
uniform vec3 uLight;
uniform sampler2D uAlbedo;
uniform sampler2D uClouds;
uniform sampler2D uLights;
uniform sampler2D uFace;
uniform float uLocked;
uniform float uHasClouds;
uniform float uHasLights;
uniform float uStart;
uniform float uSpin;
uniform float uCloudSpin;
uniform float uCloudA;
uniform float uShadowA;
uniform float uShadowOff;
uniform float uGlint;
uniform float uLightsA;
uniform float uGlowDay;
uniform vec3 uHi;
uniform float uHiA;
uniform vec3 uWarm;
uniform float uWarmA;
uniform vec3 uNight0;
uniform vec3 uNight1;
uniform float uAirless;
uniform vec3 uHaze0;
uniform vec3 uHaze1;
uniform float uHazeA0;
uniform float uHazeA1;
uniform vec3 uRim0;
uniform vec3 uRim1;
uniform float uDetached;
uniform vec3 uDet0;
uniform vec3 uDet1;
uniform vec3 uDet2;
uniform float uProc;
const float PI = 3.14159265;
float phash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pvnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = phash(i);
  float b = phash(i + vec2(1.0, 0.0));
  float c = phash(i + vec2(0.0, 1.0));
  float d = phash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/* moon-captured.svg radii, Fourier fit, mean radius = 1. Angle is clockwise from +x. */
float potatoRadius(float ang) {
  return 1.00097
    + 0.02365 * cos(ang) + 0.04134 * sin(ang)
    + 0.25540 * cos(2.0 * ang) + 0.02000 * sin(2.0 * ang)
    - 0.00749 * cos(3.0 * ang) + 0.00228 * sin(3.0 * ang)
    + 0.05054 * cos(4.0 * ang) + 0.01965 * sin(4.0 * ang)
    + 0.00681 * cos(5.0 * ang) - 0.01428 * sin(5.0 * ang);
}
vec3 procAlbedo(vec3 n, float proc, float spin) {
  float lon = atan(n.x, n.z) - spin;
  float lat = n.y;
  float n0 = pvnoise(vec2(lon * 3.2, lat * 4.0));
  float n1 = pvnoise(vec2(lon * 5.0 + 4.0, lat * 6.0));
  if (proc < 1.5) {
    vec3 c = vec3(0.184, 0.525, 0.878);
    c = mix(c, vec3(0.106, 0.310, 0.659), smoothstep(0.48, 0.38, n0));
    c = mix(c, vec3(0.298, 0.753, 0.894), smoothstep(0.54, 0.66, n0));
    c = mix(c, vec3(0.918, 0.965, 1.0), smoothstep(0.58, 0.72, n1));
    c = mix(c, vec3(0.949, 0.973, 1.0), smoothstep(0.62, 0.78, abs(lat)));
    return c;
  }
  vec3 c = vec3(0.816, 0.541, 0.306);
  c = mix(c, vec3(0.690, 0.416, 0.220), smoothstep(0.48, 0.38, n0));
  c = mix(c, vec3(0.431, 0.227, 0.118), smoothstep(0.42, 0.32, n0));
  c = mix(c, vec3(0.949, 0.788, 0.580), smoothstep(0.55, 0.7, n1) * step(0.47, n0));
  c = mix(c, vec3(0.353, 0.180, 0.086), smoothstep(0.62, 0.75, pvnoise(vec2(lon * 14.0, lat * 14.0))));
  return c;
}
/* straight-alpha over. Premultiply only the final pixel. design/shader-specs.md §1. */
vec4 over(vec4 d, vec3 c, float a) {
  a = clamp(a, 0.0, 1.0);
  float o = a + d.a * (1.0 - a);
  return vec4(o > 0.0 ? (c * a + d.rgb * d.a * (1.0 - a)) / o : c, o);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - uCenter) / uR;
  float r = length(uv);
  float px = 1.0 / uR;
  if (r > uExtent) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 Lxy = normalize(uLight.xy);
  float s = dot(uv, Lxy) / 0.706;
  float mask = s > 0.0 ? mix(0.45, 1.0, clamp(s, 0.0, 1.0)) : mix(0.45, 0.06, clamp(-s, 0.0, 1.0));
  // Rim and Titan's outer haze: night edge is 0, not the 0.06 floor (#76, #78).
  float rimMask = s > 0.0 ? mix(0.45, 1.0, clamp(s, 0.0, 1.0)) : mix(0.45, 0.0, clamp(-s, 0.0, 1.0));
  vec4 col = vec4(0.0);
  float spin = uTime * 6.2831853 / max(uSpin, 1.0);
  float edge = 1.0;
  if (uProc > 2.5) edge = potatoRadius(-atan(uv.y, uv.x) - spin);
  if (r < edge + px) {
    float rr = min(r / max(edge, 0.2), 0.9999);
    vec3 n = uProc > 2.5 ? vec3(uv / max(edge, 0.2), sqrt(max(0.0, 1.0 - rr * rr))) : vec3(uv, sqrt(max(0.0, 1.0 - min(r, 0.9999) * min(r, 0.9999))));
    vec3 a;
    vec4 cl = vec4(0.0);
    vec4 li = vec4(0.0);
    if (uProc > 2.5) {
      float ang = -atan(uv.y, uv.x) - spin;
      float lat = clamp(uv.y / max(edge, 0.2), -1.0, 1.0);
      float n0 = pvnoise(vec2(ang * 2.2, lat * 3.0));
      float n1 = pvnoise(vec2(ang * 4.4 + 2.0, lat * 5.0));
      a = vec3(0.494, 0.455, 0.408);
      a = mix(a, vec3(0.627, 0.494, 0.353), smoothstep(0.5, 0.7, n0));
      a = mix(a, vec3(0.541, 0.353, 0.235), smoothstep(0.62, 0.4, n1));
      a = mix(a, vec3(0.243, 0.220, 0.200), smoothstep(0.35, 0.2, n0));
      a = mix(a, vec3(0.788, 0.733, 0.659), smoothstep(0.62, 0.8, n1));
    } else if (uProc > 0.5) {
      a = procAlbedo(n, uProc, spin);
    } else if (uLocked > 0.5) {
      a = texture2D(uFace, uv * 0.5 + 0.5).rgb;
    } else {
      float lon = atan(n.x, n.z);
      float v = (1.0 + n.y) * 0.5;
      float u = uStart + lon / (2.0 * PI) - uTime / uSpin;
      a = texture2D(uAlbedo, vec2(fract(u), v)).rgb;
      if (uHasClouds > 0.5) {
        float uc = uStart + lon / (2.0 * PI) - uTime / uCloudSpin;
        cl = texture2D(uClouds, vec2(fract(uc), v));
        vec2 so = -uLight.xy * uShadowOff;
        float us = uStart + atan(n.x - so.x, n.z) / (2.0 * PI) - uTime / uCloudSpin;
        float vs = (1.0 + (n.y - so.y)) * 0.5;
        float sh = texture2D(uClouds, vec2(fract(us), clamp(vs, 0.0, 1.0))).a;
        a = mix(a, vec3(0.024, 0.071, 0.18), sh * uShadowA);
      }
      if (uHasLights > 0.5) li = texture2D(uLights, vec2(fract(u), v));
    }
    vec3 c = a;
    if (uHasClouds > 0.5) c = mix(c, cl.rgb, cl.a * uCloudA);
    float d = dot(n, uLight);
    float ocean = smoothstep(0.12, 0.32, a.b - max(a.r, a.g)) * (1.0 - cl.a * uCloudA);
    vec3 h = normalize(uLight + vec3(0.0, 0.0, 1.0));
    c = mix(c, vec3(1.0, 0.984, 0.933), uGlint * ocean * pow(max(dot(n, h), 0.0), 48.0));
    c = mix(c, uHi, uHiA * pow(max(d, 0.0), 10.0));
    float w0 = uAirless > 0.5 ? 0.03 : 0.06;
    float w1 = uAirless > 0.5 ? 0.025 : 0.07;
    c = mix(c, uWarm, uWarmA * (1.0 - smoothstep(0.0, w1, abs(d - w0))));
    float t0 = uAirless > 0.5 ? -0.01 : -0.02;
    float t1 = uAirless > 0.5 ? -0.06 : -0.14;
    float t2 = uAirless > 0.5 ? -0.12 : -0.28;
    float night = d > t0
      ? mix(0.0, 0.74, smoothstep(w0 + 0.06, t0, d))
      : d > t1
        ? mix(0.74, 0.97, (t0 - d) / (t0 - t1))
        : mix(0.97, 1.0, clamp((t1 - d) / (t1 - t2), 0.0, 1.0));
    c = mix(c, d > t1 ? uNight0 : uNight1, night);
    if (uHasLights > 0.5) {
      c = mix(c, li.rgb, li.a * uLightsA * mix(smoothstep(0.02, -0.12, d), 1.0, uGlowDay) * (1.0 - cl.a * uCloudA * 0.6));
    }
    if (uAirless < 0.5) {
      float ha = rr < 0.78 ? 0.0 : rr < 0.96 ? mix(0.0, uHazeA0, (rr - 0.78) / 0.18) : mix(uHazeA0, uHazeA1, (rr - 0.96) / 0.04);
      c = mix(c, rr < 0.96 ? uHaze0 : mix(uHaze0, uHaze1, (rr - 0.96) / 0.04), ha * mask);
    }
    col = over(col, c, smoothstep(edge + px * 0.5, edge - px * 0.5, r));
  }
  if (uAirless < 0.5 && r > 0.96 && r < 1.08) {
    float ra = r < 1.0
      ? mix(0.0, 0.95, smoothstep(0.969, 1.0, r))
      : r < 1.028
        ? mix(0.95, 0.4, (r - 1.0) / 0.028)
        : mix(0.4, 0.0, clamp((r - 1.028) / 0.049, 0.0, 1.0));
    col = over(col, r < 1.0 ? uRim0 : mix(uRim0, uRim1, clamp((r - 1.0) / 0.028, 0.0, 1.0)), ra * rimMask);
  }
  // sol/titan.svg #titBlue. Offsets are fractions of the 1.12 r gradient.
  if (uDetached > 0.5 && r > 0.88 * 1.12 && r < 1.12) {
    float q = r / 1.12;
    float ta = q < 0.915
      ? mix(0.0, 0.75, (q - 0.88) / 0.035)
      : q < 0.95
        ? mix(0.75, 0.25, (q - 0.915) / 0.035)
        : mix(0.25, 0.0, clamp((q - 0.95) / 0.05, 0.0, 1.0));
    vec3 tc = q < 0.915
      ? mix(uDet0, uDet1, clamp((q - 0.88) / 0.035, 0.0, 1.0))
      : mix(uDet1, uDet2, clamp((q - 0.915) / 0.035, 0.0, 1.0));
    col = over(col, tc, ta * rimMask);
  }
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}
`;

export function createPlanetMaterial(key: PlanetKey): THREE.ShaderMaterial {
  const look = PLANETS[key];
  const light = look.light;
  const detached = key === "titan";
  const potato = key === "moon-captured";
  return impostorMaterial(PLANET_FRAGMENT, {
    uCenter: { value: new THREE.Vector2() },
    uR: { value: look.designR },
    uTime: { value: 0 },
    uExtent: { value: potato ? 1.45 : detached ? theme.planetShader.titanExtent : theme.planetShader.rimExtent },
    uLight: { value: new THREE.Vector3(light[0], light[1], light[2]) },
    uAlbedo: { value: planetMapOrBlank(look.maps.albedo) },
    uClouds: { value: planetMapOrBlank(look.maps.clouds) },
    uLights: { value: planetMapOrBlank(look.maps.lights) },
    uFace: { value: planetMapOrBlank(look.maps.face) },
    uLocked: { value: look.locked },
    uHasClouds: { value: look.hasClouds },
    uHasLights: { value: look.hasLights },
    uStart: { value: look.start },
    uSpin: { value: look.spin },
    uCloudSpin: { value: look.cloudSpin },
    uCloudA: { value: look.cloudA },
    uShadowA: { value: look.shadowA },
    uShadowOff: { value: look.shadowOff },
    uGlint: { value: look.glint },
    uLightsA: { value: look.lightsA },
    uGlowDay: { value: look.glowDay },
    uHi: { value: srgbVec(look.hi) },
    uHiA: { value: look.hiA },
    uWarm: { value: srgbVec(look.warm) },
    uWarmA: { value: look.warmA },
    uNight0: { value: srgbVec(look.night0) },
    uNight1: { value: srgbVec(look.night1) },
    uAirless: { value: look.airless },
    uHaze0: { value: srgbVec(look.haze0) },
    uHaze1: { value: srgbVec(look.haze1) },
    uHazeA0: { value: look.hazeA0 },
    uHazeA1: { value: look.hazeA1 },
    uRim0: { value: srgbVec(look.rim0) },
    uRim1: { value: srgbVec(look.rim1) },
    uDetached: { value: detached ? 1 : 0 },
    uDet0: { value: srgbVec(palette.titanDetached0) },
    uDet1: { value: srgbVec(palette.titanDetached1) },
    uDet2: { value: srgbVec(palette.titanDetached2) },
    uProc: { value: look.proc },
  });
}
