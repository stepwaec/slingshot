// Reference star shader (Rendering v2, R2.1). GLSL ES 1.00 (WebGL 1), one impostor quad per star.
// Every number here is the spec: design/shader-specs.md §2 lists the per-star values, and these defaults are the sun (star.svg, variant J).
// Coordinates: uv in units of the body radius, centred on the star, y up. Time uTime in seconds (frame.now: all star motion is cosmetic).
precision highp float;
uniform vec2  uCenter;      // px, the star's centre on the canvas
uniform float uR;           // px, body radius (= crash radius x zoom)
uniform float uTime;
// photosphere
uniform vec3  uCore, uMid, uEdge;          // body ramp at r 0, 0.65, 1
uniform vec3  uDeep;  uniform float uDeepAmt, uDeepFreq, uDeepFlow;   // deep plasma, flows west -> east
uniform vec3  uDark;  uniform float uDarkAmt, uDarkFreq, uDarkFlow;   // dark plasma, flows the other way
uniform vec3  uFil;   uniform float uFilAmt,  uFilFreq,  uBoil, uFilGain;   // granulation filaments, three seeds cross-faded over uBoil seconds
uniform float uLimbDark;                   // I(mu) = 1 - uLimbDark (1 - mu): gentle, so the star stays vibrant
uniform vec3  uLimbA, uLimbB;              // the approved bright rim: 0.80 a0 | 0.93 uLimbA a0.55 | 0.97 uLimbB a0.9 | 1.0 white a0.95
uniform float uRimA;                       // rim strength (1 sun, 0.6 red giant)
uniform float uWobble;                     // ragged edge: radius x (1 + uWobble n)
uniform float uFaculae;                    // bright patches hugging the limb
// spots (Sol sun)
uniform float uSpots; uniform vec3 uPen, uUmb; uniform float uSpotSpin;
// atmosphere
uniform vec3  uHaze0, uHaze1, uHaze2; uniform float uHazeR, uHazeA;   // haze radius in body radii
uniform vec3  uFl0, uFl1, uFl2;  uniform float uFlR, uFlAmp, uFlFreq, uFlSpin, uFlA;   // flame ring
uniform vec3  uWi0, uWi1, uWi2;  uniform float uWiR, uWiAmp, uWiFreq, uWiSpin, uWiA;   // wisp ring
uniform float uBreathe, uBreatheT;         // +-amplitude and period of the atmosphere's breathe (never the disc)
uniform vec3  uProOut, uProIn; uniform float uProm, uProW;                             // prominences
uniform float uFlare;
uniform float uNoiseGain;                  // contrast of the ring noise: (fbm*2-1)*uNoiseGain, clamped to +-1 (the SVG displacement maps are high-contrast)
// white dwarf mode: a smooth disc, hard limb, wide glow and four spikes
uniform float uSmooth;

// --- noise: 3D simplex (Gustavson / Ashima), fbm and turbulence ---
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return mod289(((x*34.)+1.)*x);} vec4 tis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
 vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
 vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
 vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
 float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
 vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
 vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
 vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
 vec4 norm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
 vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
 return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*snoise(p);p*=2.02;a*=.5;}return .5+.5*s;}      // ~0..1, mean 0.5 (the SVG fractalNoise)
float turb(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*abs(snoise(p));p*=2.03;a*=.5;}return s;}    // ~0..1 (the SVG turbulence)
vec3 rotY(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
/* straight-alpha 'over': colour c with alpha a on top of d (d.rgb is straight, not premultiplied) */
vec4 over(vec4 d, vec3 c, float a){a=clamp(a,0.,1.);float o=a+d.a*(1.-a);return vec4(o>0.?(c*a+d.rgb*d.a*(1.-a))/o:c,o);}
float band(float x,float a,float b,float c,float d){return smoothstep(a,b,x)*(1.-smoothstep(c,d,x));}
vec3 ramp3(float t,vec3 a,vec3 b,vec3 c,float tb){return t<tb?mix(a,b,t/tb):mix(b,c,(t-tb)/(1.-tb));}

void main(){
  vec2 uv=(gl_FragCoord.xy-uCenter)/uR; float r=length(uv); float th=atan(uv.y,uv.x); vec2 dir=uv/max(r,1e-5);
  float px=1./uR;                         // one pixel in body radii
  float br=1.+uBreathe*sin(6.2831853*uTime/uBreatheT); float q=r/br;
  vec4 col=vec4(0.);
  if(uSmooth<.5){
    // 1. haze: 0 a0.6 | 0.23 a0.52 | 0.33 haze1 a0.3 | 0.55 haze2 a0.15 | 0.8 a0.06 | 1 a0   (fractions of uHazeR)
    float h=q/uHazeR; float ha=h<.23?mix(.6,.52,h/.23):h<.33?mix(.52,.3,(h-.23)/.1):h<.55?mix(.3,.15,(h-.33)/.22):h<.8?mix(.15,.06,(h-.55)/.25):mix(.06,0.,(h-.8)/.2);
    vec3 hc=h<.23?uHaze0:h<.55?mix(uHaze0,uHaze1,(h-.23)/.32):mix(uHaze1,uHaze2,clamp((h-.55)/.45,0.,1.));
    col=over(col,hc,ha*uHazeA*step(h,1.));
    // 2. wisp ring and 3. flame ring: radial ramps displaced by noise on the ring, turning in opposite directions
    float aw=th-6.2831853*uTime/uWiSpin; vec3 pw=vec3(cos(aw),sin(aw),0.)*uWiFreq; pw.z=q*uWiFreq*.6;
    float rw=q+uWiAmp*clamp((fbm(pw)*2.-1.)*uNoiseGain,-1.,1.); float tw=rw/uWiR;
    float wa=tw<.62?.55:tw<.8?mix(.55,.22,(tw-.62)/.18):tw<1.?mix(.22,0.,(tw-.8)/.2):0.;
    col=over(col,tw<.62?uWi0:tw<.8?mix(uWi0,uWi1,(tw-.62)/.18):mix(uWi1,uWi2,clamp((tw-.8)/.2,0.,1.)),wa*uWiA);
    float af=th-6.2831853*uTime/uFlSpin; vec3 pf=vec3(cos(af),sin(af),0.)*uFlFreq; pf.z=q*uFlFreq*.6+17.;
    float rf=q+uFlAmp*clamp((fbm(pf)*2.-1.)*uNoiseGain,-1.,1.); float tf=rf/uFlR;
    float fa=tf<.74?.95:tf<.82?mix(.95,.8,(tf-.74)/.08):tf<.91?mix(.8,.38,(tf-.82)/.09):tf<1.?mix(.38,0.,(tf-.91)/.09):0.;
    col=over(col,tf<.74?uFl0:tf<.82?mix(uFl0,uFl1,(tf-.74)/.08):mix(uFl1,uFl2,clamp((tf-.82)/.18,0.,1.)),fa*uFlA);
    // 4. prominences: three two-tone loops footed on the limb, swelling 0.6 -> 1 and fading in and out (never all at once)
    if(uProm>.5){
      for(int i=0;i<3;i++){
        float A= -(i==0?147.5:i==1?243.6:314.8); /* the SVG angles are clockwise (y down): negated for y up */ float hgt= i==0?.34:i==1?.38:.47; float wid= i==0?.20:i==1?.24:.185;
        float dur= i==0?12.:i==1?16.:14.; float beg= i==0?0.:i==1?5.:9.;
        float ph=sin(3.14159265*(uTime-beg)/dur); float s=.6+.4*ph*ph; float op=ph*ph;
        vec2 d=vec2(cos(radians(A)),sin(radians(A))); vec2 t=vec2(-d.y,d.x); vec2 l=uv-d; float x=dot(l,d); float y=dot(l,t);
        if(x>-.02){ float e=length(vec2(x/(hgt*s),y/(wid*s))); float dist=abs(e-1.)*min(hgt,wid)*s;
          col=over(col,uProOut,.85*op*(1.-smoothstep(uProW*px*.5,uProW*px*.5+px,dist)));
          col=over(col,uProIn, .9*op*(1.-smoothstep(uProW*.36*px*.5,uProW*.36*px*.5+px,dist))); }
      }
    }
  } else {
    // white dwarf: glow r 6.25 (#7FB8FF), spikes to r 4, tight bloom to 1.4
    float g=q/6.25; col=over(col,uHaze0,uHazeA*(1.-smoothstep(0.,1.,g))*(1.-smoothstep(0.,1.,g)));
    float sp=0.; for(int i=0;i<4;i++){ float a=float(i)*1.5707963; vec2 d=vec2(cos(a),sin(a)); float x=dot(uv,d), y=abs(dot(uv,vec2(-d.y,d.x)));
      float w=.05*(1.-clamp((x-1.)/3.,0.,1.)); sp=max(sp,step(1.,x)*step(x,4.)*(1.-smoothstep(w,w+px,y))*mix(.55,0.,clamp((x-1.)/3.,0.,1.))); }
    col=over(col,mix(vec3(1.),uHaze1,.5),sp);
    col=over(col,vec3(1.),.5*(1.-smoothstep(1.,1.4,r)));
  }
  // 6. the disc: a sphere, so texture foreshortens toward the limb and the flows read as rotation
  float edge=1.+uWobble*(fbm(vec3(dir*3.2,uTime*.02))*2.-1.);
  float aa=smoothstep(edge+px*.5,edge-px*.5,r);
  if(aa>0.){
    float rr=clamp(r/edge,0.,.9999); vec3 p=vec3(uv/edge,sqrt(1.-rr*rr)); float mu=p.z;
    vec3 c=ramp3(rr,uCore,uMid,uEdge,.65);
    if(uSmooth<.5){
      float nd=fbm(rotY(p,uTime*uDeepFlow)*uDeepFreq+3.1); c=mix(c,uDeep,clamp(3.0*nd-1.55,0.,1.)*uDeepAmt);
      float nk=fbm(rotY(p,uTime*uDarkFlow)*uDarkFreq+7.7); c=mix(c,uDark,clamp(3.4*nk-1.6,0.,1.)*uDarkAmt);
      // boiling granulation: three seeds, each fading 0 -> 0.9 -> 0.9 -> 0 over uBoil s (keyTimes 0 .33 .55 1), staggered by a third
      float fil=0.; for(int k=0;k<3;k++){ float ph=fract(uTime/uBoil+float(k)/3.); float w=ph<.33?ph/.33:ph<.55?1.:1.-(ph-.55)/.45;
        float tb=turb(rotY(p,uTime*uDarkFlow*.6)*uFilFreq+vec3(float(k)*11.3,0.,ph*.35)); fil=max(fil,clamp(1.25-6.5*tb*uFilGain,0.,1.)*w*.9); }   // uFilGain maps this turbulence onto the SVG feTurbulence range
      c=mix(c,uFil,clamp(fil,0.,1.)*uFilAmt);
      // faculae: bright patches near the limb, twinkling
      float fac=smoothstep(.72,.95,rr)*smoothstep(.6,.85,fbm(p*6.+vec3(0.,0.,uTime*.08)));
      c=mix(c,vec3(1.,.965,.84),fac*uFaculae);
      // spots (Sol sun): six spots in the +-10-18 deg activity belts, turning with the surface
      if(uSpots>.5){ for(int s=0;s<6;s++){ float lon= float(s)*1.13+.4; float lat= (mod(float(s),2.)<.5? .21:-.25)+.04*sin(float(s)*3.);
          vec3 sd=vec3(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon)); sd=rotY(sd,uTime*uSpotSpin); float dd=acos(clamp(dot(p,sd),-1.,1.));
          float sz=.045+.025*sin(float(s)*1.7); c=mix(c,uPen,.75*(1.-smoothstep(sz*1.9,sz*1.9+.012,dd))); c=mix(c,uUmb,1.-smoothstep(sz*.85,sz*.85+.01,dd)); } }
      c*=1.-uLimbDark*(1.-mu);
    }
    // the approved bright rim on top of the (gently darkened) photosphere
    float la=rr<.8?0.:rr<.93?mix(0.,.55,(rr-.8)/.13):rr<.97?mix(.55,.9,(rr-.93)/.04):mix(.9,.95,(rr-.97)/.03);
    vec3 lc=rr<.93?uLimbA:rr<.97?mix(uLimbA,uLimbB,(rr-.93)/.04):mix(uLimbB,vec3(1.),(rr-.97)/.03);
    c=mix(c,lc,la*uRimA);
    col=over(col,c,aa);
  }
  // 7. the ragged rim stroke, 1.6 px
  if(uSmooth<.5) col=over(col,uLimbB,.75*uRimA*(1.-smoothstep(.8*px,1.8*px,abs(r-edge))));
  // 5. the flare: a thin wedge at 25 deg, one flash per 22 s (0 until 13 s, 1 at 13.9 s, 0 at 14.8 s)
  if(uFlare>.5){ float ct=mod(uTime,22.); float fo=ct<13.?0.:ct<13.9?(ct-13.)/.9:ct<14.8?1.-(ct-13.9)/.9:0.;
    vec2 d=vec2(cos(radians(25.)),sin(radians(25.))); float x=dot(uv,d), y=abs(dot(uv,vec2(-d.y,d.x))); float w=(1.8/46.)*(1.-clamp((x-1.)/.87,0.,1.));
    col=over(col,mix(vec3(1.),vec3(1.,.824,.478),clamp((x-1.)/.87,0.,1.)),fo*step(1.,x)*step(x,1.87)*(1.-smoothstep(w,w+px,y))*mix(1.,.15,clamp((x-1.)/.87,0.,1.))); }
  gl_FragColor=vec4(col.rgb*col.a,col.a);   // premultiplied
}
