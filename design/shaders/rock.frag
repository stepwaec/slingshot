// Reference instanced-rock fragment shader (Rendering v2, R2.5): the WP11 belt construction, procedural per instance.
// The silhouette and its spots and craters tumble; the light stays fixed toward the star, so every rock is lit correctly at any angle.
precision highp float;
varying vec2 vP; varying float vRot, vSeed, vType, vPx; varying vec2 vL;
float h(float n){return fract(sin(n*91.3458+vSeed*47.13)*43758.5453);}
vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
/* silhouette radius at angle t: a lumpy potato, +-20 % radius jitter, aspect 1.0-1.35 */
float shape(vec2 q){ float asp=1.+.35*h(1.); q.x/=asp; float t=atan(q.y,q.x); float r=.86;
  for(int k=2;k<6;k++){ float fk=float(k); r+=(h(fk)-.5)*.30/fk*2.*cos(fk*t+6.283*h(fk+10.)); }
  return length(q)-r*mix(1.,.9,asp-1.); }
vec4 over(vec4 d, vec3 c, float a){a=clamp(a,0.,1.);float o=a+d.a*(1.-a);return vec4(o>0.?(c*a+d.rgb*d.a*(1.-a))/o:c,o);}
void main(){
  /* palettes (rim, light, base, dark, night, accent + alpha): style.md §11 belt.rockS / rockC / rockM */
  vec3 rim=vec3(.941,.863,.753), lit=vec3(.784,.651,.518), base=vec3(.604,.478,.369), dark=vec3(.353,.275,.212), night=vec3(.071,.055,.078), acc=vec3(.753,.337,.165); float accA=.45;
  if(vType>.5 && vType<1.5){ rim=vec3(.847,.8,.745); lit=vec3(.557,.518,.471); base=vec3(.384,.345,.306); dark=vec3(.227,.2,.176); night=vec3(.047,.043,.071); acc=vec3(.165,.141,.125); accA=.5; }
  if(vType>1.5){ rim=vec3(.933,.949,.98); lit=vec3(.714,.749,.824); base=vec3(.525,.565,.659); dark=vec3(.306,.337,.424); night=vec3(.039,.051,.094); acc=vec3(.863,.894,.965); accA=.35; }
  vec2 q=rot(vP,-vRot);
  float dRim=shape(q);
  float aaRim=1.-smoothstep(-vPx*.5,vPx*.5,dRim);
  if(aaRim<=0.) discard;
  vec4 col=vec4(rim,aaRim);                                                 /* the rim: the whole silhouette in the rim colour */
  vec2 qf=rot(vP+vL*.09,-vRot); float dFace=shape(qf);                      /* the face: the silhouette shifted 0.09 r away from the light */
  float u=dot(vP,vL);                                                       /* -1.45 far side .. +1.45 sunward */
  vec3 face=u>0.?mix(base,lit,clamp(u/1.,0.,1.)):mix(base,dark,clamp(-u/1.,0.,1.));
  col.rgb=mix(col.rgb,face,1.-smoothstep(-vPx*.5,vPx*.5,dFace));
  /* 2-4 accent spots and 1-2 craters, in the rock's own (tumbling) frame */
  for(int i=0;i<4;i++){ if(float(i)>=2.+floor(h(20.)*3.)) break; vec2 c=(vec2(h(30.+float(i)),h(40.+float(i)))-.5)*1.1; float r=.16+.12*h(50.+float(i));
    col.rgb=mix(col.rgb,acc,accA*(1.-smoothstep(r-vPx,r,length((q-c)*vec2(1.,1.2))))); }
  for(int i=0;i<2;i++){ if(float(i)>=1.+floor(h(60.)*2.)) break; vec2 c=(vec2(h(70.+float(i)),h(80.+float(i)))-.5)*.9; float r=.14+.1*h(90.+float(i));
    vec2 cs=rot(c,vRot);                                                    /* back to screen space, so the bowl offset follows the light */
    col.rgb=mix(col.rgb,rim,.7*(1.-smoothstep(r-vPx,r,length(vP-cs))));
    col.rgb=mix(col.rgb,dark,1.-smoothstep(r*.8-vPx,r*.8,length(vP-cs+vL*r*.25))); }
  /* terminator band across the rock: 0.5 a0 | 0.6 warm #FF9455 a0.18 | 0.64 night a0.6 | far side night a0.88 */
  float s=clamp((1.-u/1.)*.5,0.,1.);
  col.rgb=mix(col.rgb,vec3(1.,.58,.333),.18*smoothstep(.5,.6,s)*(1.-smoothstep(.6,.64,s)));
  float na=s<.6?0.:s<.64?mix(0.,.6,(s-.6)/.04):mix(.6,.88,clamp((s-.64)/.36,0.,1.));
  col.rgb=mix(col.rgb,night,na);
  /* the outline: night a0.55, 0.5 px */
  col.rgb=mix(col.rgb,night,.55*(1.-smoothstep(0.,vPx*.8,abs(dRim+vPx*.4))));
  gl_FragColor=vec4(col.rgb*col.a,col.a);
}
