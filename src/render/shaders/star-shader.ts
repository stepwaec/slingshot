import * as THREE from "three";
import { srgb01 } from "../palette";
import { impostorMaterial } from "./impostor";
import { NOISE_GLSL } from "./noise";
import { STAR_PARAMS, type StarKind, type StarParams } from "./star-params";

/**
 * Port of design/shaders/star.frag. Uniform names match the reference so the
 * §2 table applies one to one. Ring noise goes through `fbmRing` so a large
 * star can drop to 3 octaves (threejs-notes.md §9) without changing the
 * 5-octave sum used everywhere else.
 */
export const STAR_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec2  uCenter;
uniform float uR;
uniform float uTime;
uniform float uSimTime;
uniform vec2  uLightDir;
uniform float uZoom;
uniform float uDPR;
uniform float uOctaves;
uniform float uRingOct;
uniform float uCoverage;
uniform vec3  uCore, uMid, uEdge;
uniform vec3  uDeep;  uniform float uDeepAmt, uDeepFreq, uDeepFlow;
uniform vec3  uDark;  uniform float uDarkAmt, uDarkFreq, uDarkFlow;
uniform vec3  uFil;   uniform float uFilAmt,  uFilFreq,  uBoil, uFilGain;
uniform float uLimbDark;
uniform vec3  uLimbA, uLimbB;
uniform float uRimA;
uniform float uWobble;
uniform float uFaculae;
uniform float uSpots; uniform vec3 uPen, uUmb; uniform float uSpotSpin;
uniform vec3  uHaze0, uHaze1, uHaze2; uniform float uHazeR, uHazeA;
uniform vec3  uFl0, uFl1, uFl2;  uniform float uFlR, uFlAmp, uFlFreq, uFlSpin, uFlA;
uniform vec3  uWi0, uWi1, uWi2;  uniform float uWiR, uWiAmp, uWiFreq, uWiSpin, uWiA;
uniform float uBreathe, uBreatheT;
uniform vec3  uProOut, uProIn; uniform float uProm, uProW;
uniform float uFlare;
uniform float uNoiseGain;
uniform float uSmooth;
${NOISE_GLSL}
vec4 over(vec4 dst, vec3 c, float a){a=clamp(a,0.,1.);return vec4(mix(dst.rgb,c,a),dst.a+a*(1.-dst.a));}
vec3 ramp3(float t,vec3 a,vec3 b,vec3 c,float tb){return t<tb?mix(a,b,t/tb):mix(b,c,(t-tb)/(1.-tb));}

void main(){
  vec2 uv=(gl_FragCoord.xy-uCenter)/uR; float r=length(uv); float th=atan(uv.y,uv.x); vec2 dir=uv/max(r,1e-5);
  float px=1./uR;
  float br=1.+uBreathe*sin(6.2831853*uTime/uBreatheT); float q=r/br;
  vec4 col=vec4(0.);
  if(uSmooth<.5){
    float h=q/uHazeR; float ha=h<.23?mix(.6,.52,h/.23):h<.33?mix(.52,.3,(h-.23)/.1):h<.55?mix(.3,.15,(h-.33)/.22):h<.8?mix(.15,.06,(h-.55)/.25):mix(.06,0.,(h-.8)/.2);
    vec3 hc=h<.23?uHaze0:h<.55?mix(uHaze0,uHaze1,(h-.23)/.32):mix(uHaze1,uHaze2,clamp((h-.55)/.45,0.,1.));
    col=over(col,hc,ha*uHazeA*step(h,1.));
    float aw=th-6.2831853*uTime/uWiSpin; vec3 pw=vec3(cos(aw),sin(aw),0.)*uWiFreq; pw.z=q*uWiFreq*.6;
    float rw=q+uWiAmp*clamp((fbmRing(pw)*2.-1.)*uNoiseGain,-1.,1.); float tw=rw/uWiR;
    float wa=tw<.62?.55:tw<.8?mix(.55,.22,(tw-.62)/.18):tw<1.?mix(.22,0.,(tw-.8)/.2):0.;
    col=over(col,tw<.62?uWi0:tw<.8?mix(uWi0,uWi1,(tw-.62)/.18):mix(uWi1,uWi2,clamp((tw-.8)/.2,0.,1.)),wa*uWiA);
    float af=th-6.2831853*uTime/uFlSpin; vec3 pf=vec3(cos(af),sin(af),0.)*uFlFreq; pf.z=q*uFlFreq*.6+17.;
    float rf=q+uFlAmp*clamp((fbmRing(pf)*2.-1.)*uNoiseGain,-1.,1.); float tf=rf/uFlR;
    float fa=tf<.74?.95:tf<.82?mix(.95,.8,(tf-.74)/.08):tf<.91?mix(.8,.38,(tf-.82)/.09):tf<1.?mix(.38,0.,(tf-.91)/.09):0.;
    col=over(col,tf<.74?uFl0:tf<.82?mix(uFl0,uFl1,(tf-.74)/.08):mix(uFl1,uFl2,clamp((tf-.82)/.18,0.,1.)),fa*uFlA);
    if(uProm>.5){
      for(int i=0;i<3;i++){
        float A= -(i==0?147.5:i==1?243.6:314.8);
        float hgt= i==0?.34:i==1?.38:.47; float wid= i==0?.20:i==1?.24:.185;
        float dur= i==0?12.:i==1?16.:14.; float beg= i==0?0.:i==1?5.:9.;
        float ph=sin(3.14159265*(uTime-beg)/dur); float s=.6+.4*ph*ph; float op=ph*ph;
        vec2 d=vec2(cos(radians(A)),sin(radians(A))); vec2 t=vec2(-d.y,d.x); vec2 l=uv-d; float x=dot(l,d); float y=dot(l,t);
        if(x>-.02){ float e=length(vec2(x/(hgt*s),y/(wid*s))); float dist=abs(e-1.)*min(hgt,wid)*s;
          col=over(col,uProOut,.85*op*(1.-smoothstep(uProW*px*.5,uProW*px*.5+px,dist)));
          col=over(col,uProIn, .9*op*(1.-smoothstep(uProW*.36*px*.5,uProW*.36*px*.5+px,dist))); }
      }
    }
  } else {
    float g=q/6.25; col=over(col,uHaze0,uHazeA*(1.-smoothstep(0.,1.,g))*(1.-smoothstep(0.,1.,g)));
    float sp=0.; for(int i=0;i<4;i++){ float a=float(i)*1.5707963; vec2 d=vec2(cos(a),sin(a)); float x=dot(uv,d), y=abs(dot(uv,vec2(-d.y,d.x)));
      float w=.05*(1.-clamp((x-1.)/3.,0.,1.)); sp=max(sp,step(1.,x)*step(x,4.)*(1.-smoothstep(w,w+px,y))*mix(.55,0.,clamp((x-1.)/3.,0.,1.))); }
    col=over(col,mix(vec3(1.),uHaze1,.5),sp);
    col=over(col,vec3(1.),.5*(1.-smoothstep(1.,1.4,r)));
  }
  float edge=1.+uWobble*(fbm(vec3(dir*3.2,uTime*.02))*2.-1.);
  float aa=smoothstep(edge+px*.5,edge-px*.5,r);
  if(aa>0.){
    float rr=clamp(r/edge,0.,.9999); vec3 p=vec3(uv/edge,sqrt(1.-rr*rr)); float mu=p.z;
    vec3 c=ramp3(rr,uCore,uMid,uEdge,.65);
    if(uSmooth<.5){
      float nd=fbm(rotY(p,uTime*uDeepFlow)*uDeepFreq+3.1); c=mix(c,uDeep,clamp(3.0*nd-1.55,0.,1.)*uDeepAmt);
      float nk=fbm(rotY(p,uTime*uDarkFlow)*uDarkFreq+7.7); c=mix(c,uDark,clamp(3.4*nk-1.6,0.,1.)*uDarkAmt);
      float fil=0.; for(int k=0;k<3;k++){ float ph=fract(uTime/uBoil+float(k)/3.); float w=ph<.33?ph/.33:ph<.55?1.:1.-(ph-.55)/.45;
        float tb=turb(rotY(p,uTime*uDarkFlow*.6)*uFilFreq+vec3(float(k)*11.3,0.,ph*.35)); fil=max(fil,clamp(1.25-6.5*tb*uFilGain,0.,1.)*w*.9); }
      c=mix(c,uFil,clamp(fil,0.,1.)*uFilAmt);
      float fac=smoothstep(.72,.95,rr)*smoothstep(.6,.85,fbm(p*6.+vec3(0.,0.,uTime*.08)));
      c=mix(c,vec3(1.,.965,.84),fac*uFaculae);
      if(uSpots>.5){ for(int s=0;s<6;s++){ float lon= float(s)*1.13+.4; float lat= (mod(float(s),2.)<.5? .21:-.25)+.04*sin(float(s)*3.);
          vec3 sd=vec3(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon)); sd=rotY(sd,uTime*uSpotSpin); float dd=acos(clamp(dot(p,sd),-1.,1.));
          float sz=.045+.025*sin(float(s)*1.7); c=mix(c,uPen,.75*(1.-smoothstep(sz*1.9,sz*1.9+.012,dd))); c=mix(c,uUmb,1.-smoothstep(sz*.85,sz*.85+.01,dd)); } }
      c*=1.-uLimbDark*(1.-mu);
    }
    float la=rr<.8?0.:rr<.93?mix(0.,.55,(rr-.8)/.13):rr<.97?mix(.55,.9,(rr-.93)/.04):mix(.9,.95,(rr-.97)/.03);
    vec3 lc=rr<.93?uLimbA:rr<.97?mix(uLimbA,uLimbB,(rr-.93)/.04):mix(uLimbB,vec3(1.),(rr-.97)/.03);
    c=mix(c,lc,la*uRimA);
    col=over(col,c,aa);
  }
  if(uSmooth<.5) col=over(col,uLimbB,.75*uRimA*(1.-smoothstep(.8*px,1.8*px,abs(r-edge))));
  if(uFlare>.5){ float ct=mod(uTime,22.); float fo=ct<13.?0.:ct<13.9?(ct-13.)/.9:ct<14.8?1.-(ct-13.9)/.9:0.;
    vec2 d=vec2(cos(radians(25.)),sin(radians(25.))); float x=dot(uv,d), y=abs(dot(uv,vec2(-d.y,d.x))); float w=(1.8/46.)*(1.-clamp((x-1.)/.87,0.,1.));
    col=over(col,mix(vec3(1.),vec3(1.,.824,.478),clamp((x-1.)/.87,0.,1.)),fo*step(1.,x)*step(x,1.87)*(1.-smoothstep(w,w+px,y))*mix(1.,.15,clamp((x-1.)/.87,0.,1.))); }
  col.a *= clamp(1.-uCoverage, 0., 1.);
  col.rgb += vec3(uSimTime * 0. + uLightDir.x * 0. + uZoom * 0. + uDPR * 0.);
  gl_FragColor=vec4(col.rgb*col.a,col.a);
}
`;

function vec(hex: string): THREE.Vector3 {
  const [r, g, b] = srgb01(hex);
  return new THREE.Vector3(r, g, b);
}

export function createStarMaterial(kind: StarKind): THREE.ShaderMaterial {
  const p: StarParams = STAR_PARAMS[kind];
  return impostorMaterial(STAR_FRAGMENT, {
    uCenter: { value: new THREE.Vector2() },
    uR: { value: p.R },
    uTime: { value: 0 },
    uSimTime: { value: 0 },
    uLightDir: { value: new THREE.Vector2(1, 0) },
    uZoom: { value: 1 },
    uDPR: { value: 1 },
    uOctaves: { value: 5 },
    uRingOct: { value: 5 },
    uCoverage: { value: 0 },
    uDesignR: { value: p.R },
    uCore: { value: vec(p.core) },
    uMid: { value: vec(p.mid) },
    uEdge: { value: vec(p.edge) },
    uDeep: { value: vec(p.deep) },
    uDeepAmt: { value: p.deepAmt },
    uDeepFreq: { value: p.deepFreq },
    uDeepFlow: { value: p.deepFlow },
    uDark: { value: vec(p.dark) },
    uDarkAmt: { value: p.darkAmt },
    uDarkFreq: { value: p.darkFreq },
    uDarkFlow: { value: p.darkFlow },
    uFil: { value: vec(p.fil) },
    uFilAmt: { value: p.filAmt },
    uFilFreq: { value: p.filFreq },
    uBoil: { value: p.boil },
    uFilGain: { value: p.filGain },
    uLimbDark: { value: p.limbDark },
    uLimbA: { value: vec(p.limbA) },
    uLimbB: { value: vec(p.limbB) },
    uRimA: { value: p.rimA },
    uWobble: { value: p.wobble },
    uFaculae: { value: p.faculae },
    uSpots: { value: p.spots },
    uPen: { value: vec(p.pen) },
    uUmb: { value: vec(p.umb) },
    uSpotSpin: { value: p.spotSpin },
    uHaze0: { value: vec(p.haze0) },
    uHaze1: { value: vec(p.haze1) },
    uHaze2: { value: vec(p.haze2) },
    uHazeR: { value: p.hazeR },
    uHazeA: { value: p.hazeA },
    uFl0: { value: vec(p.fl0) },
    uFl1: { value: vec(p.fl1) },
    uFl2: { value: vec(p.fl2) },
    uFlR: { value: p.flR },
    uFlAmp: { value: p.flAmp },
    uFlFreq: { value: p.flFreq },
    uFlSpin: { value: p.flSpin },
    uFlA: { value: p.flA },
    uWi0: { value: vec(p.wi0) },
    uWi1: { value: vec(p.wi1) },
    uWi2: { value: vec(p.wi2) },
    uWiR: { value: p.wiR },
    uWiAmp: { value: p.wiAmp },
    uWiFreq: { value: p.wiFreq },
    uWiSpin: { value: p.wiSpin },
    uWiA: { value: p.wiA },
    uBreathe: { value: p.breathe },
    uBreatheT: { value: p.breatheT },
    uProOut: { value: vec(p.proOut) },
    uProIn: { value: vec(p.proIn) },
    uProm: { value: p.prom },
    uProW: { value: p.proW },
    uFlare: { value: p.flare },
    uNoiseGain: { value: p.noiseGain },
    uSmooth: { value: p.smooth },
  });
}
