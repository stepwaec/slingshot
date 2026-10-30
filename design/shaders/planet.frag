// Reference rocky-planet shader (Rendering v2, R2.2). GLSL ES 1.00 (WebGL 1), one impostor quad per body (to 1.08 r for the rim).
// The surface is a baked texture (design/shaders/maps/*.png: the SVG strip, one period, 1024 x 256) wrapped on a rotating sphere;
// locked bodies (the Moon, Pluto, Charon) use a face map instead. Lighting reproduces the planet reference construction (ocean.svg):
// highlight bloom, warm terminator band, navy night, limb haze and rim on the lit side. Numbers: design/shader-specs.md §3.
precision highp float;
uniform vec2  uCenter; uniform float uR; uniform float uTime;
uniform vec3  uLight;                       // unit vector toward the star, screen space, y up, z toward the viewer (the SVG look: (0.83 L, 0.56))
uniform sampler2D uAlbedo, uClouds, uLights, uFace;
uniform float uLocked, uHasClouds, uHasLights;
uniform float uStart, uSpin, uCloudSpin;    // longitude fraction at the centre at t 0; seconds per turn (sign = direction); clouds' own period
uniform float uCloudA, uShadowA, uShadowOff;// cloud opacity; cloud shadow #06122E opacity and its offset away from the light (fraction of a radius)
uniform float uGlint;                       // ocean specular strength (0 = none)
uniform float uLightsA;                     // night-side lights strength
uniform float uGlowDay;                     // 0: lights only at night (cities, cracks); 1: an emissive glow that also shows by day (lava veins)
uniform vec3  uHi;  uniform float uHiA;     // highlight bloom at the sub-stellar point
uniform vec3  uWarm; uniform float uWarmA;  // warm terminator band
uniform vec3  uNight0, uNight1;             // night: uNight0 a0.74 at the terminator -> uNight1 a0.97 -> a1
uniform float uAirless;                     // 1: hard terminator, no haze, no rim
uniform vec3  uHaze0, uHaze1; uniform float uHazeA0, uHazeA1;   // limb haze 0.78 a0 | 0.96 uHaze0 uHazeA0 | 1.0 uHaze1 uHazeA1
uniform vec3  uRim0, uRim1;                 // rim outside the disc to 1.077 r: 0.969 a0 | 1.0 uRim0 a0.95 | 1.028 uRim1 a0.4 | 1.077 a0
const float PI = 3.14159265;
vec4 over(vec4 d, vec3 c, float a){a=clamp(a,0.,1.);return vec4(mix(d.rgb,c,a),d.a+a*(1.-d.a));}
void main(){
  vec2 uv=(gl_FragCoord.xy-uCenter)/uR; float r=length(uv); float px=1./uR;
  vec2 Lxy=normalize(uLight.xy); float s=dot(uv,Lxy)/.706;                     // the lit-side mask coordinate (the SVG's linear mask)
  float mask=s>0.?mix(.45,1.,clamp(s,0.,1.)):mix(.45,.06,clamp(-s,0.,1.));
  vec4 col=vec4(0.);
  if(r<1.+px){
    float rr=min(r,.9999); vec3 n=vec3(uv,sqrt(1.-rr*rr));
    vec3 a; vec4 cl=vec4(0.); vec4 li=vec4(0.);
    if(uLocked>.5){ a=texture2D(uFace,uv*.5+.5).rgb; /* maps are uploaded with UNPACK_FLIP_Y, so t runs up */ }
    else{
      float lon=atan(n.x,n.z); float v=(1.+n.y)*.5; /* strip row = (1 - sin lat)/2 from the top; flipped on upload */
      float u=uStart+lon/(2.*PI)-uTime/uSpin;
      a=texture2D(uAlbedo,vec2(fract(u),v)).rgb;
      if(uHasClouds>.5){ float uc=uStart+lon/(2.*PI)-uTime/uCloudSpin; cl=texture2D(uClouds,vec2(fract(uc),v));
        vec2 so=-uLight.xy*uShadowOff; float us=uStart+atan(n.x-so.x,n.z)/(2.*PI)-uTime/uCloudSpin; float vs=(1.+(n.y-so.y))*.5;
        float sh=texture2D(uClouds,vec2(fract(us),clamp(vs,0.,1.))).a; a=mix(a,vec3(.024,.071,.18),sh*uShadowA); }
      if(uHasLights>.5) li=texture2D(uLights,vec2(fract(u),v));
    }
    vec3 c=a; if(uHasClouds>.5) c=mix(c,cl.rgb,cl.a*uCloudA);
    float d=dot(n,uLight);
    // ocean glint (Blinn), only where the albedo is ocean blue and the clouds are clear
    float ocean=smoothstep(.12,.32,a.b-max(a.r,a.g))*(1.-cl.a*uCloudA);
    vec3 h=normalize(uLight+vec3(0.,0.,1.)); c=mix(c,vec3(1.,.984,.933),uGlint*ocean*pow(max(dot(n,h),0.),48.));
    // highlight bloom
    c=mix(c,uHi,uHiA*pow(max(d,0.),10.));
    // terminator: warm band, then the navy night (airless: a harder edge)
    float w0=uAirless>.5?.03:.06, w1=uAirless>.5?.025:.07;
    c=mix(c,uWarm,uWarmA*(1.-smoothstep(0.,w1,abs(d-w0))));
    float t0=uAirless>.5?-.01:-.02, t1=uAirless>.5?-.06:-.14, t2=uAirless>.5?-.12:-.28;
    float night=d>t0?mix(0.,.74,smoothstep(w0+.06,t0,d)):d>t1?mix(.74,.97,(t0-d)/(t0-t1)):mix(.97,1.,clamp((t1-d)/(t1-t2),0.,1.));
    c=mix(c,d>t1?uNight0:uNight1,night);
    // night-side lights: only where it is dark
    if(uHasLights>.5) c=mix(c,li.rgb,li.a*uLightsA*mix(smoothstep(.02,-.12,d),1.,uGlowDay)*(1.-cl.a*uCloudA*.6));
    // limb haze on the lit side
    if(uAirless<.5){ float ha=rr<.78?0.:rr<.96?mix(0.,uHazeA0,(rr-.78)/.18):mix(uHazeA0,uHazeA1,(rr-.96)/.04);
      c=mix(c,rr<.96?uHaze0:mix(uHaze0,uHaze1,(rr-.96)/.04),ha*mask); }
    col=over(col,c,smoothstep(1.+px*.5,1.-px*.5,r));
  }
  // rim outside the disc, lit side only
  if(uAirless<.5 && r>.96 && r<1.08){ float ra=r<1.?mix(0.,.95,smoothstep(.969,1.,r)):r<1.028?mix(.95,.4,(r-1.)/.028):mix(.4,0.,clamp((r-1.028)/.049,0.,1.));
    col=over(col,r<1.?uRim0:mix(uRim0,uRim1,clamp((r-1.)/.028,0.,1.)),ra*mask); }   /* the rim overlaps the disc edge, as in the SVG (its peak sits at r 1.0) */
  gl_FragColor=vec4(col.rgb*col.a,col.a);
}
