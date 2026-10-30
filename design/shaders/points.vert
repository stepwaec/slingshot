// Reference point-particle vertex shader (Rendering v2, R2.5): dust, specks, motes, glints and sparkles as GL points, one draw per set.
attribute vec2  aPos;                    /* world px */
attribute float aSize;                   /* radius, world px (dust 0.7-1.6) */
attribute vec4  aColor;                  /* straight rgb + alpha */
attribute float aPhase;                  /* twinkle phase, 0-1 */
attribute float aShape;                  /* 0 disc, 1 four-point sparkle */
uniform vec2 uRes, uOrigin; uniform float uZoom, uTime, uTwinkle, uTwinkleT, uMinPx;
varying vec4 vColor; varying float vShape, vR;
void main(){
  vec2 c = uOrigin + aPos*uZoom;
  gl_Position = vec4(c/uRes*2.-1., 0., 1.);
  float r = max(aSize*uZoom, uMinPx);                                      /* never below uMinPx: a speck must not vanish when zoomed out */
  float k = aShape > .5 ? 3.2 : 1.;                                        /* a sparkle's arms reach 3.2 x its core radius */
  gl_PointSize = 2.*r*k + 2.;
  float tw = 1. - uTwinkle*.5*(1. + sin(6.2831853*(uTime/uTwinkleT + aPhase)));
  vColor = vec4(aColor.rgb, aColor.a*tw*min(1., aSize*uZoom/uMinPx)); vShape = aShape; vR = r*k;
}
