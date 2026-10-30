// Reference compact-object shader (Rendering v2, R2.4). GLSL ES 1.00 (WebGL 1), one impostor quad per object.
// uKind: 0 quiet neutron star, 1 pulsar, 2 magnetar, 3 black hole. The white dwarf is star.frag's smooth mode (shader-specs.md §2).
// The pulsar's beams are a hazard, so they turn on SIM time (uSimTime) at the level's period; everything else is cosmetic (uTime).
// Numbers: shader-specs.md §5. uv in body radii, y up.
precision highp float;
uniform vec2 uCenter; uniform float uR; uniform float uTime, uSimTime;
uniform float uKind;
uniform float uPeriod, uPhase, uReach;     /* beams: seconds per turn (sign = direction, + clockwise as the SVGs), angle at t 0 (deg from up, clockwise), reach in radii */
uniform float uTilt;                       /* magnetar: field axis, deg clockwise from up */
uniform float uDiskSpin;                   /* black hole: seconds per disk turn, + counter-clockwise (so the bright left side approaches) */
const float PI = 3.14159265;
/* straight-alpha 'over': colour c with alpha a on top of d (d.rgb is straight, not premultiplied) */
vec4 over(vec4 d, vec3 c, float a){a=clamp(a,0.,1.);float o=a+d.a*(1.-a);return vec4(o>0.?(c*a+d.rgb*d.a*(1.-a))/o:c,o);}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+17.1;a*=.5;}return s;}
float turb(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*abs(vnoise(p)*2.-1.);p=p*2.03+5.3;a*=.5;}return s;}
vec2 rot(vec2 p,float deg){float c=cos(radians(deg)),s=sin(radians(deg));return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
vec3 hx(float r,float g,float b){return vec3(r,g,b)/255.;}
/* radial ramp helper: 4 stops (offsets o, alphas a) of one colour */
float ramp4(float t, vec4 o, vec4 a){ if(t<=o.x) return a.x; if(t<=o.y) return mix(a.x,a.y,(t-o.x)/(o.y-o.x)); if(t<=o.z) return mix(a.y,a.z,(t-o.y)/(o.z-o.y)); if(t<=o.w) return mix(a.z,a.w,(t-o.z)/(o.w-o.z)); return a.w; }
/* a tapered wedge along +y from y0 to y1, half-width w0 -> w1, crisp to one pixel */
float wedge(vec2 p,float y0,float y1,float w0,float w1,float px){ if(p.y<y0||p.y>y1) return 0.; float t=(p.y-y0)/(y1-y0); float w=mix(w0,w1,t); return 1.-smoothstep(w-px*.5,w+px*.5,abs(p.x)); }
float ringl(float r,float at,float w,float px){ return 1.-smoothstep(w*.5,w*.5+px,abs(r-at)); }
void main(){
  vec2 uv=(gl_FragCoord.xy-uCenter)/uR; float r=length(uv); float px=1./uR;
  vec4 col=vec4(0.);
  if(uKind<.5){
    // ---------- quiet neutron star (r 8): violet glow, a rotating magnetosphere (6 s), white-violet body ----------
    col=over(col,hx(180.,140.,255.),ramp4(r/5.,vec4(0.,.2,.35,.6),vec4(.65,.48,.22,.07))*(1.-smoothstep(.6,1.,r/5.)));
    vec2 q=rot(uv,-(30.+360.*uTime/6.));                     /* clockwise turn, axis 30 deg at t 0 */
    float hz=1.-smoothstep(.8,1.,length(vec2(q.x/2.5,q.y/.6))); col=over(col,hx(180.,140.,255.),.14*hz);
    for(int k=0;k<2;k++){ vec2 b=k==0?q:-q; float t=clamp((b.y-.875)/3.625,0.,1.);
      float cone=wedge(b,.875,4.5,.4,.875,px); col=over(col,mix(hx(220.,228.,255.),hx(180.,140.,255.),t),cone*mix(.38,0.,t)*(t<.4?1.:1.));
      float sp=wedge(b,.875,4.25,.1,0.,px); col=over(col,vec3(1.),sp*mix(.55,0.,clamp((b.y-.875)/3.375,0.,1.))); }
    vec3 bc=r<.5?vec3(1.):r<.8?mix(vec3(1.),hx(220.,228.,255.),(r-.5)/.3):r<.93?mix(hx(220.,228.,255.),hx(201.,168.,255.),(r-.8)/.13):mix(hx(201.,168.,255.),hx(180.,140.,255.),(r-.93)/.07);
    col=over(col,bc,smoothstep(1.+px*.5,1.-px*.5,r));
    col=over(col,hx(220.,228.,255.),.9*ringl(r,.9375,1./8.,px)); col=over(col,hx(180.,140.,255.),.75*ringl(r,1.0375,.6/8.,px));
  } else if(uKind<1.5){
    // ---------- pulsar (r 8): cyan glow, two long narrow beams on SIM time with afterglow sectors, cyan-white body ----------
    col=over(col,hx(79.,195.,247.),ramp4(r/5.5,vec4(0.,.2,.35,.6),vec4(.7,.45,.18,.05))*(1.-smoothstep(.6,1.,r/5.5)));
    float ang=uPhase+360.*uSimTime/uPeriod;                  /* clockwise from up, deg */
    vec2 q=rot(uv,ang); float a=degrees(atan(q.x,q.y));        /* angle of the pixel from the beam axis, clockwise + */
    for(int k=0;k<2;k++){ float ak=k==0?a:(a>0.?a-180.:a+180.); float rr=r;
      /* afterglow: 8 sectors of 5 deg trailing the beam (counter to the turn), alpha 0.22 fading to 0 */
      float trail=-ak*sign(uPeriod); if(trail>0. && trail<40. && rr<25.3){ float n=floor(trail/5.); col=over(col,hx(127.,219.,255.),.22*pow(.79,n)*(1.-rr/25.3)*.5+.0); }
      vec2 b=vec2(sin(radians(ak)),cos(radians(ak)))*rr; vec2 bb=vec2(b.x,b.y);
      float t=clamp(rr/uReach,0.,1.);
      float cone=step(0.,bb.y)*(1.-smoothstep(mix(.25,1.125,t)-px*.5,mix(.25,1.125,t)+px*.5,abs(bb.x)))*step(rr,uReach);
      float ca=t<.3?mix(.85,.4,t/.3):t<.75?mix(.4,.1,(t-.3)/.45):mix(.1,0.,(t-.75)/.25);
      col=over(col,t<.3?mix(vec3(1.),hx(127.,219.,255.),t/.3):hx(127.,219.,255.),cone*ca);
      float core=step(0.,bb.y)*(1.-smoothstep(.5/8.,.5/8.+px,abs(bb.x)))*step(t,.7); col=over(col,vec3(1.),core*mix(.9,0.,t/.7)); }
    vec3 bc=r<.55?vec3(1.):r<.85?mix(vec3(1.),hx(220.,246.,255.),(r-.55)/.3):mix(hx(220.,246.,255.),hx(127.,219.,255.),(r-.85)/.15);
    col=over(col,bc,smoothstep(1.+px*.5,1.-px*.5,r)); col=over(col,hx(168.,236.,255.),.9*ringl(r,.95,1./8.,px));
  } else if(uKind<2.5){
    // ---------- magnetar (r 9): magenta glow, interference grain, six dipole field lines with flowing dashes, starquake every 18 s ----------
    col=over(col,hx(217.,70.,239.),ramp4(r/6.667,vec4(0.,.15,.35,1.),vec4(.65,.4,.12,0.)));
    /* interference: sparse #FF9BEF specks from r 2.67 to 13.3, two seeds cross-fading over 5 s, layer 0.26 */
    float zone=r<2.67?0.:r<5.33?(r-2.67)/2.67:r<9.33?mix(1.,.55,(r-5.33)/4.):mix(.55,0.,clamp((r-9.33)/4.,0.,1.));
    vec2 cell=floor(uv*9./2.6); float g1=step(.97,hash(cell)), g2=step(.97,hash(cell+31.7));   /* specks about 2.6 local units, the size of the SVG noise blobs */ float xf=.5+.5*cos(2.*PI*uTime/5.);
    col=over(col,hx(255.,155.,239.),.26*zone*mix(g2,g1,xf));
    vec2 p=rot(uv,uTilt); float rp=length(p);
    if(rp>1.){
      float x=max(abs(p.x),1e-4); float Lp=rp*rp*rp/(x*x);
      vec2 gL=vec2(rp/(x*x)*(3.*x-2.*rp*rp/x), 3.*p.y*rp/(x*x)); float gl=max(length(gL),1e-4);
      for(int i=0;i<6;i++){
        float L=i==0?2.222:i==1?3.333:i==2?4.889:i==3?6.889:i==4?9.556:12.889;
        float w=i==0?1.5:i==1?1.36:i==2?1.22:i==3?1.08:i==4?.94:.8; float al=i==0?.75:i==1?.65:i==2?.55:i==3?.45:i==4?.35:.25;
        float dal=i==0?.55:i==1?.49:i==2?.43:i==3?.37:i==4?.31:.25; float dw=i<3?(i==0?.9:i==1?.76:.62):.6;
        float fl=i==0?1.7:i==1?2.3:i==2?3.1:i==3?2.7:i==4?1.9:3.4; float dp=.9+.25*float(i);
        vec3 lc=i<3?hx(255.,122.,230.):hx(199.,125.,255.);
        float d=abs(Lp-L)/gl*uR;                              /* distance in px (first order; valid only near the line) */
        if(abs(Lp-L)>.35*L || rp>L*1.02) d=1e4;               /* off the line, and never along the axis where r^3/x^2 blows up */
        float flick=.85+.15*sin(2.*PI*uTime/fl)*sin(2.*PI*uTime/(fl*.37));
        float wp=w*uR/9., dwp=dw*uR/9.;                        /* the SVG stroke widths are local units: scale with zoom */
        col=over(col,lc,al*flick*(1.-smoothstep(wp*.5,wp*.5+1.,d)));
        float th=atan(p.y,abs(p.x)); float s=th*L*uR/12.;      /* about 12 px per dash period along the line */
        float dash=step(fract(s-uTime/dp),.17);
        col=over(col,vec3(1.),dal*flick*dash*(1.-smoothstep(dwp*.5,dwp*.5+1.,d)));
      }
    }
    /* starquake: every 18 s a ring from the surface to r 16.7 in 1.2 s, white -> magenta, and the body flashes */
    float qt=mod(uTime,18.); if(qt<1.2){ float qr=mix(1.,16.67,qt/1.2); col=over(col,mix(vec3(1.),hx(255.,122.,230.),qt/1.2),(1.-qt/1.2)*ringl(r,qr,2./9.,px)); }
    vec3 bc=r<.5?vec3(1.):r<.82?mix(vec3(1.),hx(255.,224.,250.),(r-.5)/.32):mix(hx(255.,224.,250.),hx(255.,122.,230.),(r-.82)/.18);
    if(qt<.6) bc=mix(bc,vec3(1.),1.-qt/.6);
    col=over(col,bc,smoothstep(1.+px*.5,1.-px*.5,r));
  } else {
    // ---------- black hole (r 22): glow, lensed arcs, the tilted fiery disk (front over the shadow), ragged photon ring, Einstein ring ----------
    col=over(col,hx(255.,140.,46.),ramp4(r/3.,vec4(0.,.35,.6,1.),vec4(.22,.08,.03,0.)));
    float dop=mix(1.,.55,clamp((uv.x+2.6)/5.2,0.,1.));        /* the approaching left side is brighter */
    /* lensed arcs: the far side of the disk bent over the top (a .8) and under the bottom (a .55) of the shadow */
    float arcR=clamp((r-1.15)/.15,0.,1.); float inArc=step(1.15,r)*step(r,1.3);
    float rag=(vnoise(normalize(uv+1e-4)*8.)-.5)*.064;          /* the +-0.7 px wobble */
    vec3 ac=arcR<.333?mix(hx(255.,231.,160.),hx(255.,200.,87.),arcR*3.):arcR<.667?mix(hx(255.,200.,87.),hx(255.,140.,46.),(arcR-.333)*3.):mix(hx(255.,140.,46.),hx(232.,70.,26.),(arcR-.667)*3.);
    float aa=arcR<.333?mix(.95,.85,arcR*3.):arcR<.667?mix(.85,.7,(arcR-.333)*3.):mix(.7,.3,(arcR-.667)*3.);
    float vf=clamp(abs(uv.y)/.91,0.,1.);
    float inArcR=step(1.15+rag,r)*step(r,1.3+rag);
    if(uv.y>0.) col=over(col,ac,inArcR*aa*.8*vf*dop);
    /* the disk, in its own circular frame: X = x, Y = y / 0.2115; inner 1.4 r, outer 2.6 r; turns at uDiskSpin */
    vec2 D=vec2(uv.x,uv.y/.2115); float rd=length(D);
    vec4 disk=vec4(0.);
    if(rd>1.4 && rd<2.6){
      float t=rd/2.6;
      vec3 dc=t<.6?mix(hx(255.,248.,225.),hx(255.,231.,160.),(t-.538)/.062):t<.68?mix(hx(255.,231.,160.),hx(255.,200.,87.),(t-.6)/.08):t<.78?mix(hx(255.,200.,87.),hx(255.,140.,46.),(t-.68)/.1):t<.87?mix(hx(255.,140.,46.),hx(232.,70.,26.),(t-.78)/.09):t<.94?mix(hx(232.,70.,26.),hx(180.,140.,255.),(t-.87)/.07):hx(180.,140.,255.);
      float da=t<.6?mix(.95,.92,(t-.538)/.062):t<.68?.92:t<.78?mix(.92,.82,(t-.68)/.1):t<.87?mix(.82,.6,(t-.78)/.09):t<.94?mix(.6,.32,(t-.87)/.07):mix(.32,.12,(t-.94)/.06);
      vec2 Dr=rot(D,-360.*uTime/uDiskSpin);                    /* the texture turns; + counter-clockwise */
      float nk=fbm(Dr*1.21+3.); dc=mix(dc,hx(128.,33.,5.),clamp(3.4*nk-1.7,0.,1.)*.42);
      float tb=turb(Dr*1.54+9.); dc=mix(dc,hx(255.,231.,160.),clamp(1.25-6.5*tb*.62,0.,1.));
      float ang=atan(Dr.y,Dr.x); float streams=step(.55,vnoise(vec2(rd*9.,ang*3.)))*.25; dc=mix(dc,hx(255.,231.,160.),streams);
      disk=vec4(dc*dop,da);
    }
    if(uv.y>0.) col=over(col,disk.rgb,disk.a);                 /* far half, behind the shadow */
    col=over(col,vec3(0.),smoothstep(1.+px*.5,1.-px*.5,r));     /* the shadow */
    float rp=r+rag;
    col=over(col,hx(255.,200.,87.),.6*ringl(rp,1.09,2./22.,px)); col=over(col,vec3(1.),.95*ringl(rp,1.09,1./22.,px)); col=over(col,hx(255.,241.,194.),.55*ringl(rp,1.041,.6/22.,px));
    if(uv.y<=0.) col=over(col,disk.rgb,disk.a);                /* near half, over the shadow */
    if(uv.y<0.) col=over(col,ac,inArcR*aa*.55*vf*dop);
    col=over(col,hx(127.,184.,255.),.14*ringl(r,2.114,1./22.,px));
  }
  gl_FragColor=vec4(col.rgb*col.a,col.a);
}
