// Reference instanced-rock vertex shader (Rendering v2, R2.5). One quad per rock, one draw call per field (InstancedMesh / ANGLE_instanced_arrays).
// Belts, the Kuiper belt, the asteroid field, debris fields, debris rings and the stray asteroid all use it. Numbers: shader-specs.md §6.
attribute vec2  aCorner;                 /* the quad corner, -1..1 */
attribute vec2  aPos;                    /* rock centre, world px (= the sim's position for solid rocks: bodyPose on sim time) */
attribute float aSize;                   /* mean radius, world px (crash radius for solid rocks) */
attribute float aSeed;                   /* shape, craters, spots */
attribute float aType;                   /* 0 S stony, 1 C carbonaceous, 2 M metallic */
attribute float aSpin;                   /* tumble period, s (sign = direction) - cosmetic, frame.now */
uniform vec2  uRes, uOrigin;             /* canvas size; world origin on the canvas (px) */
uniform float uZoom, uTime;
uniform vec2  uStar;                     /* the lighting star, world px */
varying vec2  vP; varying float vRot, vSeed, vType, vPx; varying vec2 vL;
void main(){
  vec2 c = uOrigin + aPos*uZoom; float s = aSize*uZoom*1.45;           /* the quad covers the silhouette's jitter */
  vec2 px = c + aCorner*s;
  gl_Position = vec4(px/uRes*2.-1., 0., 1.);
  vP = aCorner*1.45; vRot = 6.2831853*uTime/aSpin + aSeed*6.2831853; vSeed = aSeed; vType = aType;
  vPx = 1./(aSize*uZoom); vL = normalize(uStar - aPos);
}
