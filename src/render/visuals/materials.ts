import * as THREE from "three";
import { srgb01 } from "../palette";

export const localVert = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function shader(fragment: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: localVert,
    fragmentShader: fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    // Desktop WebGL2 is highp. Asking for it keeps the sphere solve from
    // collapsing when a WebKit context would otherwise drop to mediump.
    precision: "highp",
  });
}

export function srgbVec(hex: string): THREE.Vector3 {
  const [r, g, b] = srgb01(hex);
  return new THREE.Vector3(r, g, b);
}
