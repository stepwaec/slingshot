// Reference gas-giant shader (Rendering v2, R2.3). GLSL ES 1.00 (WebGL 1), one impostor quad per giant (to the ring's outer edge).
// Bands: a baked strip (design/shaders/maps/*-bands.png) on a rotating sphere whose rate varies with latitude (differential rotation, uJet).
// Rings: a plane through the equator, tilted to the viewer (opening uB = sin i) and rolled by uRoll, its radial profile a baked 1D map
// (*-rings.png). True 3D shadows both ways: the planet's shadow on the rings and the rings' shadow on the globe. Numbers: shader-specs.md §4.
precision highp float;
uniform vec2  uCenter; uniform float uR; uniform float uTime;
uniform vec3  uLight;                       /* toward the star, screen space, y up, z toward the viewer */
uniform sampler2D uAlbedo, uRings;
uniform float uStart, uSpin;                /* longitude fraction at the centre at t 0; base seconds per turn */
uniform float uJet[17];                     /* extra turns per second at v = i/16 (v = (1 - sin lat)/2): the zonal wind profile */
uniform float uRoll;                        /* degrees: the body frame (spin axis, ring plane) rolled on screen, counter-clockwise + */
uniform vec3  uHi;  uniform float uHiA;  uniform vec3 uWarm; uniform float uWarmA; uniform vec3 uNight0, uNight1;
uniform vec3  uHaze0, uHaze1; uniform float uHazeA0, uHazeA1; uniform vec3 uRim0, uRim1;
uniform vec3  uLimb; uniform float uLimbA;  /* limb darkening tint (Jupiter #3A2440 a0.35) */
uniform float uHasRings, uB, uRho0, uRho1;  /* ring opening sin i; the profile spans rho0..rho1 planet radii */
uniform vec3  uRingShadow; uniform float uRingShadowA;   /* the rings' shadow on the globe */
uniform float uPlanetShadowA;               /* the planet's shadow on the rings (#050B1E) */
uniform float uSparkle, uSparkleT, uSparkleRho;          /* ring particle sparkle; Keplerian period uSparkleT at uSparkleRho */
uniform float uHex; uniform vec3 uHexCol, uHexEdge;      /* Saturn's north-polar hexagon */
uniform float uPole; uniform vec3 uPoleCol; uniform float uPoleA;   /* a bright polar cap (Uranus) */
const float PI = 3.14159265;
/* straight-alpha 'over': colour c with alpha a on top of d (d.rgb is straight, not premultiplied) */
vec4 over(vec4 d, vec3 c, float a){a=clamp(a,0.,1.);float o=a+d.a*(1.-a);return vec4(o>0.?(c*a+d.rgb*d.a*(1.-a))/o:c,o);}
vec4 under(vec4 d, vec3 c, float a){a=clamp(a,0.,1.)*(1.-d.a);return vec4((d.rgb*d.a+c*a)/max(d.a+a,1e-5),d.a+a);}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float jet(float v){ float r=0.; for(int i=0;i<16;i++){ float a=float(i)/16.; if(v>=a && v<=a+1./16.) r=mix(uJet[i],uJet[i+1],(v-a)*16.); } return r; }
vec4 ring(float rho){ if(rho<uRho0||rho>uRho1) return vec4(0.); return texture2D(uRings,vec2((rho-uRho0)/(uRho1-uRho0),.5)); }
/* box-filter the profile over one pixel's footprint in rho (f), so rings thinner than a pixel stay continuous instead of aliasing to dots */
vec4 ringAA(float rho, float f){ vec4 acc=vec4(0.); for(int i=0;i<5;i++){ vec4 t=ring(rho+f*(float(i)/4.-.5)); acc+=vec4(t.rgb*t.a,t.a); } acc/=5.; return vec4(acc.rgb/max(acc.a,1e-4),acc.a); }
void main(){
  float px=1./uR; float c=cos(radians(uRoll)), s=sin(radians(uRoll));
  vec2 sc=(gl_FragCoord.xy-uCenter)/uR; vec2 uv=vec2(c*sc.x+s*sc.y,-s*sc.x+c*sc.y);      /* into the body frame */
  vec3 L=normalize(vec3(c*uLight.x+s*uLight.y,-s*uLight.x+c*uLight.y,uLight.z));
  float r=length(uv); float cosI=sqrt(1.-uB*uB);
  vec2 Lxy=normalize(L.xy); float sm=dot(uv,Lxy)/.706; float mask=sm>0.?mix(.45,1.,clamp(sm,0.,1.)):mix(.45,.06,clamp(-sm,0.,1.));
  // --- the ring at this pixel: b < 0 is the near half (in front of the planet) ---
  vec4 rc=vec4(0.); float bb=0.;
  if(uHasRings>.5){
    bb=uv.y/uB; float rho=length(vec2(uv.x,bb)); float fp=px*length(vec2(uv.x,uv.y/(uB*uB)))/max(rho,1e-4); rc=ringAA(rho,fp);
    if(rc.a>0.){
      vec3 P=vec3(uv.x,uv.y,-bb*cosI); float pl=dot(P,L); float disc=pl*pl-(dot(P,P)-1.);
      float shad=(disc>0. && -pl-sqrt(max(disc,0.))>0.)?smoothstep(0.,.02,disc):0.;
      rc.rgb=mix(rc.rgb,vec3(.02,.043,.118),shad*uPlanetShadowA);
      if(uSparkle>.5){ float w=2.*PI/(uSparkleT*pow(rho/uSparkleRho,1.5)); float ph=atan(bb,uv.x)+w*uTime;
        float h=hash(vec2(floor(rho*uR*.9),floor(ph*rho*uR*.45))); rc.rgb=mix(rc.rgb,vec3(1.),step(.93,h)*(.3+.3*hash(vec2(h,3.)))*(1.-shad)); }
    }
  }
  vec4 col=vec4(0.);
  if(rc.a>0. && bb>0.) col=over(col,rc.rgb,rc.a);                                      /* far half, behind the planet */
  // --- the planet ---
  if(r<1.+px){
    float rr=min(r,.9999); vec3 n=vec3(uv,sqrt(1.-rr*rr));
    float lon=atan(n.x,n.z); float v=(1.+n.y)*.5; float vs=1.-v;                        /* vs: strip row from the north pole */
    float u=uStart+lon/(2.*PI)-uTime*(1./uSpin+jet(vs));
    vec3 a=texture2D(uAlbedo,vec2(fract(u),v)).rgb;
    if(uHex>.5){ float colat=acos(clamp(n.y,-1.,1.)); float az=atan(n.z,n.x)+uTime*2.*PI/uSpin;
      float k=mod(az,PI/3.)-PI/6.; float hb=.26/cos(k); float e=colat-hb;
      a=mix(a,uHexCol,.5*(1.-smoothstep(-px*2.,0.,e))); a=mix(a,uHexEdge,.5*(1.-smoothstep(0.,px*2.,abs(e)))); }
    if(uPole>.5) a=mix(a,uPoleCol,uPoleA*smoothstep(.55,.98,n.y));
    float d=dot(n,L);
    vec3 cc=mix(a,uLimb,uLimbA*smoothstep(.7,1.,rr));
    if(uHasRings>.5){                                                                    /* the rings' shadow on the globe */
      vec3 nr=vec3(0.,cosI,uB); float dn=dot(L,nr);
      if(abs(dn)>1e-3){ float t=-dot(n,nr)/dn; if(t>0.){ vec3 Q=n+t*L; float rho=length(vec2(Q.x,dot(Q,vec3(0.,uB,-cosI))));
        cc=mix(cc,uRingShadow,ringAA(rho,3.*px).a*uRingShadowA*step(0.,d)); } } }
    cc=mix(cc,uHi,uHiA*pow(max(d,0.),10.));
    cc=mix(cc,uWarm,uWarmA*(1.-smoothstep(0.,.07,abs(d-.06))));
    float night=d>-.02?mix(0.,.74,smoothstep(.12,-.02,d)):d>-.14?mix(.74,.97,(-.02-d)/.12):mix(.97,1.,clamp((-.14-d)/.14,0.,1.));
    cc=mix(cc,d>-.14?uNight0:uNight1,night);
    float ha=rr<.78?0.:rr<.96?mix(0.,uHazeA0,(rr-.78)/.18):mix(uHazeA0,uHazeA1,(rr-.96)/.04);
    cc=mix(cc,rr<.96?uHaze0:mix(uHaze0,uHaze1,(rr-.96)/.04),ha*mask);
    col=over(col,cc,smoothstep(1.+px*.5,1.-px*.5,r));
  }
  if(r>.96 && r<1.08){ float ra=r<1.?mix(0.,.95,smoothstep(.969,1.,r)):r<1.028?mix(.95,.4,(r-1.)/.028):mix(.4,0.,clamp((r-1.028)/.049,0.,1.));
    col=over(col,r<1.?uRim0:mix(uRim0,uRim1,clamp((r-1.)/.028,0.,1.)),ra*mask); }
  if(rc.a>0. && bb<=0.) col=over(col,rc.rgb,rc.a);                                     /* near half, over the planet */
  gl_FragColor=vec4(col.rgb*col.a,col.a);
}
