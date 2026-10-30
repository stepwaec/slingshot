// Reference point-particle fragment shader (Rendering v2, R2.5): a crisp disc, or a four-point sparkle with a bright core.
precision highp float;
varying vec4 vColor; varying float vShape, vR;
void main(){
  vec2 p=(gl_PointCoord-.5)*(2.*vR+2.);                                    /* px from the centre */
  float a;
  if(vShape<.5){ a=1.-smoothstep(vR/1.-.5, vR/1.+.5, length(p)); }
  else{ float core=vR/3.2; float arm=max(1.-smoothstep(core*.18,core*.18+.8,abs(p.x))*1., 0.)*step(abs(p.y),vR)*(1.-abs(p.y)/vR)
                          + max(1.-smoothstep(core*.18,core*.18+.8,abs(p.y)), 0.)*step(abs(p.x),vR)*(1.-abs(p.x)/vR);
        a=clamp(arm+1.-smoothstep(core*.9-.5,core*.9+.5,length(p)),0.,1.); }
  a*=vColor.a; if(a<.004) discard;
  gl_FragColor=vec4(vColor.rgb*a,a);
}
