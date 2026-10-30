// Reference selective-bloom passes (Rendering v2, R2.5). Run on the EMISSIVE layer only (stars, compact objects, plumes, the target-ring flash,
// Astrophage glints), never on planets, rings, belts or the HUD - a luminance threshold alone would bloom ice caps and cream bands.
// uMode 0: bright pass (threshold + soft knee) with a 4-tap downsample; 1: 9-tap gaussian along uDir; 2: composite scene + strength x (blur1 + blur2).
precision highp float;
uniform sampler2D uTex, uTex2, uTex3; uniform vec2 uTexel, uDir; uniform float uMode, uThreshold, uKnee, uStrength;
varying vec2 vUv;
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){
  if(uMode<.5){
    vec3 c=.25*(texture2D(uTex,vUv+uTexel*vec2(-.5,-.5)).rgb+texture2D(uTex,vUv+uTexel*vec2(.5,-.5)).rgb+texture2D(uTex,vUv+uTexel*vec2(-.5,.5)).rgb+texture2D(uTex,vUv+uTexel*vec2(.5,.5)).rgb);
    float l=luma(c); float k=clamp(l-uThreshold+uKnee,0.,2.*uKnee); float w=max(k*k/(4.*uKnee+1e-5),l-uThreshold)/max(l,1e-5);
    gl_FragColor=vec4(c*max(w,0.),1.);
  } else if(uMode<1.5){
    vec3 s=texture2D(uTex,vUv).rgb*.2270;
    s+=(texture2D(uTex,vUv+uDir*uTexel*1.3846).rgb+texture2D(uTex,vUv-uDir*uTexel*1.3846).rgb)*.3162;
    s+=(texture2D(uTex,vUv+uDir*uTexel*3.2308).rgb+texture2D(uTex,vUv-uDir*uTexel*3.2308).rgb)*.0703;
    gl_FragColor=vec4(s,1.);
  } else {
    vec3 sc=texture2D(uTex,vUv).rgb; vec3 b=texture2D(uTex2,vUv).rgb+texture2D(uTex3,vUv).rgb;
    gl_FragColor=vec4(sc+uStrength*b,1.);                                  /* additive; the authored hazes already carry most of the glow */
  }
}
