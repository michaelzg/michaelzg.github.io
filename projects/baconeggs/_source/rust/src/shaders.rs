//! GLSL ES 3.0 sources. Everything is shaded in linear space; the composite pass encodes sRGB.
//! Scene shaders write two targets: colour, and a glow layer that feeds the bloom (fire, sparks).

pub const HEAD: &str = "#version 300 es\nprecision highp float;\nprecision highp int;\n";

pub const COMMON: &str = r#"
vec3 s2l(vec3 c){ return pow(c, vec3(2.2)); }
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
vec3 hash3(vec2 p){
  vec3 q = vec3(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)), dot(p,vec2(419.2,371.9)));
  return fract(sin(q)*43758.5453);
}
"#;

/// Bacon sizzle: x = length axis, y = up. uDeform = (enabled, half length, curl 0..1, phase).
/// Kept small: the strips lie shingled over one another and must not cut through.
const DEFORM: &str = r#"
uniform vec4 uDeform; uniform float uTime;
vec3 deform(vec3 p){
  if (uDeform.x > 0.5) {
    float u = p.x / uDeform.y;
    p.y += 0.035*uDeform.z*u*u*u*u
         + 0.004*sin(p.x*11.0 + uTime*3.2 + uDeform.w)
         + 0.002*sin(p.x*23.0 - uTime*5.0 + uDeform.w*2.0);
  }
  return p;
}
"#;

pub fn cel_vs() -> String {
    format!(
        "{HEAD}{DEFORM}{}",
        r#"
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
uniform mat4 uModel; uniform mat4 uViewProj; uniform mat3 uNrmMat;
out vec3 vW; out vec3 vN; out vec2 vUv; out vec3 vL;
void main(){
  vec3 p = deform(aPos); vL = p;
  vec4 w = uModel * vec4(p, 1.0);
  vW = w.xyz; vN = normalize(uNrmMat * aNrm); vUv = aUv;
  gl_Position = uViewProj * w;
}"#
    )
}

const LIGHTS: &str = r#"
uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uAmbTop; uniform vec3 uAmbBot;
uniform vec3 uFirePos; uniform vec3 uFireCol; uniform float uFireRange;
uniform vec3 uCam; uniform vec3 uFogCol; uniform vec2 uFog;
"#;

/// Bump mapping without tangents (Mikkelsen's surface gradient): tilt the normal by the screen-space
/// slope of a height field given in world units.
const BUMP: &str = r#"
vec3 bumped(vec3 n, vec3 pos, float h){
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det)*(hx*r1 + hy*r2);
  return normalize(abs(det)*n - g);
}
"#;

/// Soft two-tone anime shading with tinted shadows, a hard specular "sticker" and fire rim light.
pub fn cel_fs() -> String {
    format!(
        "{HEAD}{LIGHTS}{}",
        r#"
uniform vec3 uBase; uniform sampler2D uTex; uniform float uHasTex;
uniform vec3 uShade; uniform vec3 uSpec; uniform float uFireAmt; uniform float uRim; uniform float uTopGrad;
uniform vec4 uEdge; uniform float uSheen;
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vL;
layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uCam - vW);
  vec3 base = uBase;
  if (uHasTex > 0.5) base *= texture(uTex, vUv).rgb;
  // a deeper tone where the surface turns away, like the painted rim of a yolk
  base = mix(base, uEdge.rgb, pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 1.6)*uEdge.a);
  base *= 1.0 + uTopGrad*(n.y - 0.35);
  float lit = smoothstep(-0.04, 0.10, dot(n, uKeyDir));
  vec3 amb = mix(uAmbBot, uAmbTop, n.y*0.5 + 0.5);
  vec3 col = base * (mix(uShade, vec3(1.0), lit) * uKeyCol + amb);
  vec3 lf = uFirePos - vW; float d = length(lf); lf /= max(d, 1e-4);
  float att = pow(clamp(1.0 - d/uFireRange, 0.0, 1.0), 1.5);
  col += base * uFireCol * smoothstep(-0.15, 0.35, dot(n, lf)) * att * uFireAmt;
  vec3 h = normalize(uKeyDir + v);
  col += smoothstep(uSpec.y - uSpec.z, uSpec.y + uSpec.z, dot(n, h)) * uSpec.x * uKeyCol;
  col += smoothstep(0.80, 0.97, dot(n, h)) * uSheen * uKeyCol;
  col += uFireCol * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.5) * uRim * att;
  col = mix(col, uFogCol, smoothstep(uFog.x, uFog.y, length(uCam - vW)));
  o = vec4(col, 1.0);
  oG = vec4(0.0);
}"#
    )
}

/// Split firewood, painted like the film's backgrounds rather than cel shaded. Each log mesh keeps its
/// pith on local x, so growth rings are circles about that axis: straight stripes on the riven faces,
/// rings on the sawn ends. uWood: 0 bark, 1 riven face, 2 sawn end. Near the fire the wood chars and
/// its cracks glow.
pub fn wood_fs() -> String {
    format!(
        "{HEAD}{COMMON}{LIGHTS}{BUMP}{}",
        r#"
uniform float uWood; uniform float uSeed; uniform float uRad; uniform float uTime; uniform float uFlicker; uniform float uGround;
uniform float uBurn;
uniform vec3 uBody; uniform vec3 uBodyR;
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vL;
layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float x = vL.x;
  vec2 cs = vL.yz;
  float rho = length(cs);
  float ang = atan(cs.y, cs.x);
  float s = uSeed;

  // growth rings about the pith, unevenly spaced; latewood is the darker, sharper side of each ring
  float wob = 0.010*snoise(vec3(ang*1.4, x*0.35, s)) + 0.004*snoise(vec3(ang*5.0, x*1.2, s + 3.0));
  float ph = (rho + wob)*27.0 + 1.3*snoise(vec3(rho*3.5, s, 0.5));
  float fw = fwidth(ph);
  float fr = fract(ph);
  float late = smoothstep(0.55, 0.88, fr)*(1.0 - smoothstep(0.94, 0.94 + max(fw, 0.02), fr));
  late *= 1.0 - smoothstep(0.35, 0.7, fw);
  // how much fine detail the pixel can hold across the grain (world units per pixel)
  float px = fwidth(rho) + 1e-5;

  vec3 base; float h; float crack = 0.0;
  if (uWood < 0.5) {
    // bark: deep furrows running with the trunk between raised, ash-dusted plates
    float arc = ang*uRad;
    // stretched hard along the trunk, so the furrows run its length
    float n1 = snoise(vec3(x*0.45, arc*11.0, s));
    float n2 = snoise(vec3(x*1.4, arc*26.0, s + 2.0));
    float n3 = snoise(vec3(x*4.0, arc*50.0, s + 5.0))*(1.0 - smoothstep(0.004, 0.01, px));
    float furrow = 1.0 - smoothstep(0.0, 0.16, abs(n1 + 0.2*n2));
    base = mix(s2l(vec3(0.34, 0.25, 0.18)), s2l(vec3(0.54, 0.43, 0.33)), clamp(0.5 + 0.4*n2 + 0.1*n3, 0.0, 1.0));
    base = mix(base, s2l(vec3(0.10, 0.07, 0.05)), furrow*0.7);
    base = mix(base, s2l(vec3(0.55, 0.52, 0.47)), smoothstep(0.45, 0.95, n.y)*smoothstep(0.1, 0.6, n2)*0.35);
    h = -furrow*0.016 + n2*0.003 + n3*0.0012;
    crack = furrow;
  } else if (uWood < 1.5) {
    // riven face: long fibres that wander with the split, ring stripes, drying checks, the odd knot
    float wander = 0.9*snoise(vec3(x*0.33, rho*5.0, s + 6.0)) + 0.35*snoise(vec3(x*1.1, rho*14.0, s + 8.0));
    float knotX = fract(s*0.37)*1.2 + 0.5, knotR = 0.12 + 0.2*fract(s*0.71);
    vec2 kq = vec2((x - knotX)/0.10, (rho - knotR)/0.035);
    float knot = exp(-dot(kq, kq));
    float gp = rho*95.0 + 4.0*wander + 6.0*knot*sign(rho - knotR);
    float gfw = fwidth(gp);
    float gd = abs(fract(gp) - 0.5);
    float grain = smoothstep(0.30, 0.46 + gfw*0.5, gd)*(1.0 - smoothstep(0.35, 0.8, gfw));
    float fib = snoise(vec3(x*0.7, rho*45.0 + 2.0*wander, s))*(1.0 - smoothstep(0.012, 0.03, px));
    float tone = snoise(vec3(x*0.40, rho*5.0, s + 4.0)) + 0.4*snoise(vec3(x*1.6, rho*11.0, s + 12.0));
    base = mix(s2l(vec3(0.38, 0.23, 0.13)), s2l(vec3(0.64, 0.45, 0.28)), clamp(0.55 + 0.3*tone + 0.12*fib, 0.0, 1.0));
    base *= 1.0 - 0.20*late - 0.28*grain;
    base = mix(base, s2l(vec3(0.20, 0.10, 0.05)), knot*0.7);
    // long checks, wider where the wood dried fastest
    float cl = abs(snoise(vec3(x*0.26, rho*4.5 + 0.5*wander, s + 7.0)));
    float run = smoothstep(0.05, 0.35, snoise(vec3(x*0.5, rho*2.5, s + 9.0)));
    float cw = 0.03 + 0.045*run;
    crack = (1.0 - smoothstep(cw*0.5, cw + fwidth(cl), cl))*run*mix(1.0, 0.55, smoothstep(0.004, 0.012, px));
    base = mix(base, s2l(vec3(0.08, 0.04, 0.025)), crack*0.92);
    // worn arrises catch the light: along the pith edge and where the face meets the bark
    float arris = 1.0 - smoothstep(0.0, 0.03, min(rho, uRad*0.97 - rho));
    base = mix(base, s2l(vec3(0.82, 0.62, 0.42)), arris*0.35);
    h = -crack*0.03 + fib*0.002 - grain*0.0012 - late*0.001 + knot*0.004;
  } else {
    // sawn end: darker heartwood, rings, saw marks, radial checks and a rim of bark
    base = mix(s2l(vec3(0.30, 0.17, 0.09)), s2l(vec3(0.58, 0.39, 0.23)), smoothstep(0.05, 0.8, rho/uRad));
    base *= 1.0 - 0.36*late;
    float saw = snoise(vec3(dot(cs, vec2(0.8, 0.6))*3.0, dot(cs, vec2(-0.6, 0.8))*60.0, s + 11.0))
              *(1.0 - smoothstep(0.004, 0.012, px));
    base *= 0.94 + 0.06*saw;
    float k = ang*9.0/6.2831853 + 0.25*snoise(vec3(rho*5.0, s, 1.0));
    float cid = floor(k + 0.5);
    float live = step(0.4, fract(sin(cid*91.7 + s*13.1)*43758.5));
    float dc = abs(k - cid)*6.2831853/9.0*rho;
    float wc = 0.002 + 0.012*smoothstep(0.15, 0.95, rho/uRad);
    crack = (1.0 - smoothstep(wc*0.4, wc + fwidth(dc), dc))*live*smoothstep(0.04, 0.12, rho);
    base = mix(base, s2l(vec3(0.07, 0.04, 0.025)), crack*0.92);
    float barkRim = smoothstep(0.90, 0.95, rho/uRad);
    base = mix(base, s2l(vec3(0.16, 0.11, 0.08)), barkRim);
    h = -crack*0.012 - late*0.0015 + saw*0.0006;
  }

  // ---- where the spirit has sat so long the wood has burned to cracked charcoal. hd measures the
  // flame's footprint (1 at its edge); heat reaches up the sides of the logs toward it.
  vec2 fp = (vW.xz - uBody.xz)/uBodyR.xz;
  float cn = snoise(vec3(vW.xz*2.2, s*0.3 + 9.0));
  float cn2 = snoise(vec3(vW.xz*7.0, s + 4.0));
  float hd = length(fp) + 0.2*cn + 0.07*cn2;
  // uBurn grows the burn from where the flame's front meets each log's top (one spot per log): it
  // creeps faster along the grain than across it, with a ragged front, and works from the tops down
  // the sides. Brown scorch runs ahead of the char; embers glow wherever it has charred near the flame.
  float g = uBurn;
  vec2 spot = vec2(vW.x - uBody.x, abs(vW.z - uBody.z) - 0.72);
  float dG = length(spot*vec2(0.62, 1.15)) + (0.12*cn + 0.06*cn2)*smoothstep(0.0, 0.2, g + 0.1);
  float rG = mix(0.12, 1.15, g), wG = mix(0.08, 0.3, g);
  float growC = 1.0 - smoothstep(rG, rG + wG, dG);
  float growS = 1.0 - smoothstep(rG + 0.05, rG + wG + 0.35, dG);
  float heatUp = smoothstep(uGround + mix(0.26, 0.02, g), uGround + 0.34, vW.y);
  float scorch = (1.0 - smoothstep(1.1, 1.95, hd))*mix(0.35, 1.0, heatUp)*growS;
  float charA = (1.0 - smoothstep(0.92, 1.45, hd))*mix(0.3, 1.0, heatUp)*growC;
  float core = (1.0 - smoothstep(0.7, 1.12, hd))*heatUp*growC;
  // scorched: the wood darkens and browns before it chars
  base = mix(base, base*0.42 + s2l(vec3(0.06, 0.03, 0.015)), scorch*0.75);
  // alligator char: rows of blocks running with the grain; the long splits wander with it, the deeper
  // cross-grain checks fall at irregular spacings in each row
  vec2 cq = uWood > 1.5 ? vec2(atan(cs.y, cs.x)*uRad, rho)*vec2(1.0, 1.4) : vec2(x, ang*uRad);
  float warp = 0.35*snoise(vec3(cq*vec2(1.2, 3.0), s + 21.0));
  float rowP = cq.y*13.0 + warp;
  float row = floor(rowP);
  vec3 rh = hash3(vec2(row, s));
  float colP = cq.x*(4.5 + 3.5*rh.x) + rh.y*9.0 + 0.6*snoise(vec3(cq*vec2(2.0, 6.0), s + 33.0));
  float colId = floor(colP);
  vec3 blockId = hash3(vec2(row*7.0 + colId, s + 3.0));
  float dRow = min(fract(rowP), 1.0 - fract(rowP));
  float dCol = min(fract(colP), 1.0 - fract(colP));
  float fwR = fwidth(rowP), fwC = fwidth(colP);
  float split = 1.0 - smoothstep(0.03, 0.09 + fwR, dRow);
  float across = 1.0 - smoothstep(0.04, 0.12 + fwC, dCol);
  float check = max(split*0.8, across);
  check *= 1.0 - smoothstep(0.35, 0.8, max(fwR, fwC));   // too small to see: let it settle to char
  float edge = min(dRow/0.5, dCol/0.5);                  // 0 at a check, 1 mid-block
  vec3 charcoal = mix(s2l(vec3(0.035, 0.03, 0.028)), s2l(vec3(0.12, 0.11, 0.10)), blockId.z*0.6 + 0.2*cn);
  // a thin film of pale ash on a few upturned blocks away from the hottest spot
  float ashFilm = smoothstep(0.45, 0.9, n.y)*step(0.7, blockId.x)*(1.0 - core)*smoothstep(0.6, 1.0, g);
  charcoal = mix(charcoal, s2l(vec3(0.42, 0.40, 0.38)), ashFilm*0.35);
  charcoal = mix(charcoal, s2l(vec3(0.012, 0.01, 0.008)), check);
  base = mix(base, charcoal, charA);
  h = mix(h, smoothstep(0.0, 0.5, edge)*0.012 - check*0.012, charA);
  crack = max(crack*(1.0 - charA), check*charA);

  vec3 nb = bumped(n, vW, h);
  // a soft painted terminator, plus a gentle falloff so faces turned from the key read darker
  float ndl = dot(nb, uKeyDir);
  float lit = smoothstep(-0.2, 0.65, ndl)*(0.55 + 0.45*clamp(ndl, 0.0, 1.0));
  vec3 amb = mix(uAmbBot, uAmbTop, nb.y*0.5 + 0.5)*0.8;
  vec3 col = base*(mix(vec3(0.30, 0.25, 0.25), vec3(1.05), lit)*uKeyCol*0.95 + amb);
  vec3 lf = uFirePos - vW; float d = length(lf); lf /= max(d, 1e-4);
  float att = pow(clamp(1.0 - d/uFireRange, 0.0, 1.0), 1.4);
  col += base*uFireCol*smoothstep(-0.35, 0.7, dot(nb, lf))*att*1.1;
  // the flame sitting on the logs washes the wood around it in its glow
  float near = 1.0 - smoothstep(0.95, 2.1, length(fp));
  col += base*uFireCol*near*near*0.5*uFlicker;
  // charcoal has a faint silvery lustre
  col += smoothstep(0.95, 0.995, dot(nb, normalize(uKeyDir + normalize(uCam - vW))))*0.06*charA*uKeyCol;
  // cracks stay dark whatever lights them; the ash hugs the bottom of the log
  col *= 1.0 - crack*0.5;
  col *= mix(0.45, 1.0, smoothstep(uGround - 0.02, uGround + 0.2, vW.y));
  // embers: only some deep checks right under the flame glow, dull red, breathing slowly in patches
  float breathe = 0.5 + 0.5*snoise(vec3(cq*vec2(1.5, 3.0), uTime*0.35 + s));
  float live = smoothstep(0.45, 0.85, breathe)*smoothstep(0.35, 0.8, core);
  float emb = across*check*charA*live*(0.6 + 0.4*blockId.y)*uFlicker;
  vec3 ember = mix(s2l(vec3(0.75, 0.12, 0.03)), s2l(vec3(1.0, 0.45, 0.10)), breathe)*emb;
  col += ember*1.3;
  col = mix(col, uFogCol, smoothstep(uFog.x, uFog.y, length(uCam - vW)));
  o = vec4(col, 1.0);
  oG = vec4(ember*0.8, 0.0);
}"#
    )
}

/// Inverted hull outline with a constant on-screen width.
pub fn hull_vs() -> String {
    format!(
        "{HEAD}{DEFORM}{}",
        r#"
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
uniform mat4 uModel; uniform mat4 uView; uniform mat4 uProj; uniform mat3 uNrmMV;
uniform float uWidth; uniform vec2 uRes;
void main(){
  vec4 mv = uView * uModel * vec4(deform(aPos), 1.0);
  vec3 nv = normalize(uNrmMV * aNrm);
  vec4 clip = uProj * mv;
  vec2 d = (uProj * vec4(nv, 0.0)).xy * uRes;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(0.0);
  clip.xy += d * uWidth * 2.0 / uRes * clip.w;
  gl_Position = clip;
}"#
    )
}

pub fn hull_fs() -> String {
    format!(
        "{HEAD}{}",
        r#"
uniform vec3 uCol; layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
void main(){ o = vec4(uCol, 1.0); oG = vec4(0.0); }"#
    )
}

/// Anime colour bands for fire: rim red -> orange -> amber -> yellow -> pale core.
const FIRE_RAMP: &str = r#"
vec3 fireRamp(float h){
  vec3 c = s2l(vec3(0.78, 0.17, 0.06));
  c = mix(c, s2l(vec3(0.93, 0.30, 0.09)), smoothstep(0.08, 0.13, h));
  c = mix(c, s2l(vec3(1.00, 0.47, 0.12)), smoothstep(0.24, 0.32, h));
  c = mix(c, s2l(vec3(1.00, 0.63, 0.19)), smoothstep(0.46, 0.54, h));
  c = mix(c, s2l(vec3(1.00, 0.81, 0.36)), smoothstep(0.66, 0.74, h));
  c = mix(c, s2l(vec3(1.00, 0.94, 0.70)), smoothstep(0.86, 0.94, h));
  return c;
}
"#;

/// The spirit's painted face. Every feature is driven by uniforms so the expression can blend between
/// moods: per-eye openness/size/gaze, spinning spiral eyes (dizzy), brows, a head tilt, and a mouth
/// that morphs from a wavy smile to a squiggle or a slack "o".
const FACE: &str = r#"
uniform vec2 uEyeL; uniform vec2 uEyeR; uniform vec2 uEyeRad; uniform float uPupilR;
uniform vec3 uFaceR; uniform vec3 uFaceU; uniform vec3 uFaceF;
uniform vec2 uLids; uniform vec2 uEyeScale; uniform vec4 uGaze2; uniform float uPupilScale;
uniform float uSpiral; uniform float uSpin;
uniform vec4 uBrow; uniform float uBrowAmt;
uniform float uTilt; uniform vec2 uFaceOff; uniform float uHappy;
uniform vec2 uMouth; uniform vec3 uMouthP; uniform float uMumble; uniform vec2 uMouthX;
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
const vec2 MP[8] = vec2[8](vec2(-1.0,0.62), vec2(-0.82,0.10), vec2(-0.52,-0.36), vec2(-0.16,-0.54),
                           vec2(0.20,-0.40), vec2(0.52,-0.14), vec2(0.80,0.16), vec2(1.0,0.36));
vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c*v.x - s*v.y, s*v.x + c*v.y); }
vec2 mouthPt(int i){
  vec2 m = MP[i];
  float y = m.y*(1.0 + 0.45*sin(uMumble + m.x*3.4)) + uMouthX.x*1.5*sin(m.x*9.4 + uMumble*1.7);
  return uMouth + rot2(vec2(m.x*uMouthP.x, y*uMouthP.y), uMouthX.y);
}
vec4 drawFace(vec2 q0, float aa){
  vec3 ink = s2l(vec3(0.17, 0.06, 0.03));
  vec3 white = vec3(0.93, 0.91, 0.85);
  float lw = 0.0055;
  // head tilt / sway about the middle of the face
  vec2 pivot = 0.5*(uEyeL + uEyeR) + vec2(0.0, -0.08);
  vec2 q = rot2(q0 - uFaceOff - pivot, -uTilt) + pivot;
  vec4 face = vec4(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 c = k == 0 ? uEyeL : uEyeR;
    float sc = k == 0 ? uEyeScale.x : uEyeScale.y;
    float lid = k == 0 ? uLids.x : uLids.y;
    vec2 g = k == 0 ? uGaze2.xy : uGaze2.zw;
    vec2 R0 = uEyeRad*sc;
    if (uHappy > 0.5) {
      float x = (q.x - c.x)/R0.x;
      float y = c.y - 0.02 + 0.55*R0.y*(1.0 - x*x);
      face = mix(face, vec4(ink, 1.0), (1.0 - smoothstep(lw*1.3 - aa, lw*1.3 + aa, abs(q.y - y)))*(1.0 - smoothstep(0.95, 1.05, abs(x))));
    } else if (lid > 0.2) {
      vec2 r = vec2(R0.x, R0.y*lid);
      float el = length((q - c)/r);
      float dEdge = (el - 1.0)*min(r.x, r.y);
      float inside = 1.0 - smoothstep(-aa, aa, dEdge);
      float ring = 1.0 - smoothstep(lw - aa, lw + aa, abs(dEdge));
      // pupil (clamped inside the white)
      vec2 gg = g; float lim = max(r.x - uPupilR*uPupilScale*sc - 0.01, 0.0);
      if (length(gg) > lim) gg *= lim/max(length(gg), 1e-5);
      float pupil = (1.0 - smoothstep(-aa, aa, length(q - c - gg) - uPupilR*uPupilScale*sc))*inside;
      // spiral "@" eye, spinning opposite ways
      vec2 d = q - c;
      float rr = length(d)/R0.x;
      float dirS = k == 0 ? 1.0 : -1.0;
      float sArm = rr*2.6 - (atan(d.y, d.x)*dirS + uSpin*dirS)/6.2831853;
      float fa = fract(sArm);
      float dArm = min(fa, 1.0 - fa)/2.6*R0.x;
      float spiral = (1.0 - smoothstep(lw - aa, lw + aa, dArm))*inside*(1.0 - smoothstep(0.82, 0.92, rr))*step(0.06, rr);
      float mark = mix(pupil, spiral, uSpiral);
      face = mix(face, vec4(mix(white, ink, mark), 1.0), inside);
      face = mix(face, vec4(ink, 1.0), ring);
    } else {
      float x = (q.x - c.x)/R0.x;
      float y = c.y - 0.012 - 0.22*R0.y*(1.0 - x*x);
      face = mix(face, vec4(ink, 1.0), (1.0 - smoothstep(lw - aa, lw + aa, abs(q.y - y)))*step(abs(x), 1.0));
    }
    // Calcifer's darker flame ridge over each eye, sloping down toward the middle
    {
      float side = k == 0 ? 1.0 : -1.0;
      vec2 rc = c + vec2(0.0, R0.y*max(lid, 0.7) + 0.03);
      vec2 rd = rot2(vec2(1.0, 0.0), 0.28*side);
      float rdist = sdSeg(q, rc - rd*0.09, rc + rd*0.09);
      float ridge = (1.0 - smoothstep(0.012, 0.03, rdist))*0.55*(1.0 - uBrowAmt);
      face = mix(face, vec4(s2l(vec3(0.82, 0.24, 0.07)), 1.0), ridge);
    }
    // brows: angle > 0 drops the inner end (furrowed), raise lifts the whole brow
    if (uBrowAmt > 0.01) {
      float ang = k == 0 ? uBrow.x : uBrow.z;
      float raise = k == 0 ? uBrow.y : uBrow.w;
      vec2 bc = c + vec2(0.0, R0.y*max(lid, 0.7) + 0.035 + raise);
      vec2 dir = rot2(vec2(1.0, 0.0), k == 0 ? -ang : ang);
      float bd = sdSeg(q, bc - dir*0.07, bc + dir*0.07);
      face = mix(face, vec4(ink, 1.0), (1.0 - smoothstep(lw*1.25 - aa, lw*1.25 + aa, bd))*uBrowAmt);
    }
  }
  float md = 1e3;
  for (int i = 0; i < 7; i++) md = min(md, sdSeg(q, mouthPt(i), mouthPt(i + 1)));
  float open = uMouthP.z;
  if (open > 0.01) {
    vec2 qm = rot2(q - uMouth, -uMouthX.y) + uMouth;
    float x = (qm.x - uMouth.x)/uMouthP.x;
    if (abs(x) < 1.0) {
      float yu = uMouth.y;
      for (int i = 0; i < 7; i++) {
        vec2 a = rot2(mouthPt(i) - uMouth, -uMouthX.y) + uMouth, b = rot2(mouthPt(i + 1) - uMouth, -uMouthX.y) + uMouth;
        if (qm.x >= a.x && qm.x <= b.x) yu = mix(a.y, b.y, (qm.x - a.x)/max(b.x - a.x, 1e-5));
      }
      float ylo = yu - open*0.075*(1.0 - x*x);
      float inM = (1.0 - smoothstep(-aa, aa, qm.y - yu))*(1.0 - smoothstep(-aa, aa, ylo - qm.y));
      float depth = (yu - qm.y)/max(yu - ylo, 1e-4);
      vec3 mc = mix(s2l(vec3(0.42, 0.08, 0.04)), s2l(vec3(0.85, 0.30, 0.16)), smoothstep(0.55, 1.0, depth));
      // a pale row of teeth along the top of an open mouth
      float teeth = (1.0 - smoothstep(0.016 - aa, 0.016 + aa, yu - qm.y))*smoothstep(0.35, 0.6, open)*(1.0 - smoothstep(0.8, 0.98, abs(x)));
      mc = mix(mc, s2l(vec3(1.0, 0.93, 0.76)), teeth);
      face = mix(face, vec4(mc, 1.0), inM);
    }
  }
  face = mix(face, vec4(ink, 1.0), 1.0 - smoothstep(lw - aa, lw + aa, md));
  return face;
}
"#;

/// Volumetric anime fire, ray-marched inside a proxy box: a mound under the pan plus a curtain of
/// tongues wrapped around the pan's outer wall. Rising noise carves the tongues; nothing may enter the pan.
pub fn fire_vs() -> String {
    format!(
        "{HEAD}{}",
        r#"
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
out vec3 vW;
void main(){ vW = aPos; gl_Position = uViewProj*vec4(aPos, 1.0); }"#
    )
}

pub fn fire_fs() -> String {
    format!(
        "{HEAD}{COMMON}{FIRE_RAMP}{FACE}{}",
        r#"
uniform mat4 uViewProj; uniform vec3 uCam; uniform vec3 uBoxMin; uniform vec3 uBoxMax;
uniform vec3 uBody; uniform vec3 uBodyR; uniform vec3 uSquash; uniform vec3 uPan;
uniform float uTime; uniform float uFlare;
uniform highp sampler3D uNoise;
in vec3 vW; layout(location=0) out vec4 o; layout(location=1) out vec4 oG;

float nz(vec3 p){ return texture(uNoise, p).r; }
float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0 - 1.0)/max(k1, 1e-4); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }

float hash11(float n){ return fract(sin(n*127.1 + 311.7)*43758.5453); }

// flame tongues rooted in the body's upper rim: each one is the body's own surface rising around the pan wall
float tongues(vec3 p){
  vec2 d2 = p.xz - uPan.xz;
  float rho = length(d2);
  if (rho < 0.72) return 0.82 - rho;               // well inside: cheap lower bound
  float th = atan(d2.y, d2.x);
  const float K = 12.0;
  float u = th/6.2831853*K;
  float best = 1e3;
  for (int k = -1; k <= 1; k++) {
    float s = floor(u + 0.5) + float(k);
    float sm = mod(s, K);
    float h1 = hash11(sm), h2 = hash11(sm + 17.0), h3 = hash11(sm + 41.0);
    float ang = (s + (h1 - 0.5)*0.3)/K*6.2831853;
    float dF = abs(atan(sin(ang - 1.5708), cos(ang - 1.5708)));   // away from the face (+z)
    float gap = smoothstep(0.8, 1.2, dF);
    float c = cos(ang);
    float side = 0.35 + 0.8*abs(c) + 0.3*max(-c, 0.0);          // flanks tall, handle side tallest
    float t = uTime*(0.85 + 0.3*h2) + h3*10.0;
    float L = (0.2 + 0.55*side)*(0.8 + 0.3*h2 + 0.12*sin(t*2.3))*gap*(1.0 + 0.35*uFlare);
    if (L < 0.05) continue;
    float yr = 0.18;                                             // root, inside the body's rim
    float hy = clamp((p.y - yr)/L, 0.0, 1.0);
    float sway = (0.08*sin(hy*3.0 - t*2.4) + 0.04*sin(hy*6.0 - t*3.7 + h1*6.0))*hy;
    float R = 1.10 + 0.10*hy*hy;                                 // hug the pan wall, tip leans out a touch
    float da = atan(sin(th - ang - sway/R), cos(th - ang - sway/R))*rho;
    float w = (0.17 + 0.05*h1)*pow(1.0 - hy, 0.85) + 0.004;
    float d = length(vec2(da, (rho - R)*1.2)) - w;
    d = max(d, max(p.y - (yr + L), (yr - 0.22) - p.y));           // capped: the root sits in the body
    best = min(best, d);
  }
  return best;
}

// flame arms: a tapered, curving limb from the body's side ending in a three-fingered hand
uniform vec3 uArmS0; uniform vec3 uArmC0; uniform vec3 uArmH0; uniform vec3 uArmD0; uniform vec3 uArmP0; uniform vec3 uArmQ0;
uniform vec3 uArmS1; uniform vec3 uArmC1; uniform vec3 uArmH1; uniform vec3 uArmD1; uniform vec3 uArmP1; uniform vec3 uArmQ1;
uniform vec2 uArmG; uniform vec2 uArmE;
float sdCone(vec3 p, vec3 a, vec3 b, float ra, float rb){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba)/max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba*h) - mix(ra, rb, h);
}
vec3 bez3(vec3 a, vec3 c, vec3 b, float t){ return mix(mix(a, c, t), mix(c, b, t), t); }
float armSDF(vec3 p, vec3 S, vec3 C, vec3 H, vec3 D, vec3 P, vec3 Q, float g, float e){
  if (e < 0.02) return 1e3;
  float bound = length(p - bez3(S, C, H, 0.5)) - (length(H - S)*0.6 + 0.6);
  if (bound > 0.25) return bound;
  float d = 1e3;
  vec3 a = S; float ra = 0.21*e;
  for (int i = 1; i <= 5; i++) {
    float t = float(i)/5.0;
    vec3 b = bez3(S, C, H, t);
    float rb = mix(0.21, 0.1, t)*e;
    d = min(d, sdCone(p, a, b, ra, rb));
    a = b; ra = rb;
  }
  d = smin(d, length(p - H) - 0.13*e, 0.06);
  float L = 0.25*e;
  // open: fingers fan out along the reach; grip: they curl down around what the hand holds
  vec3 f1 = normalize(mix(D + P*0.8 + Q*0.15, D*0.3 + P*0.35 - Q*0.95, g));
  vec3 f2 = normalize(mix(D - P*0.8 + Q*0.15, D*0.3 - P*0.35 - Q*0.95, g));
  vec3 f3 = normalize(mix(D + Q*0.85, D*0.45 + Q*0.1, g));
  d = smin(d, sdCone(p, H, H + f1*L, 0.062*e, 0.008), 0.045);
  d = smin(d, sdCone(p, H, H + f2*L, 0.062*e, 0.008), 0.045);
  d = smin(d, sdCone(p, H, H + f3*L*0.85, 0.062*e, 0.008), 0.045);
  return d;
}

// < 0 inside the fire; m = distance to the mound (for the face)
float field(vec3 p, out float m){
  vec3 q = p - uBody;
  m = sdEll(q, uBodyR);
  float f = smin(m, tongues(p), 0.24);                          // one continuous flame body
  f = smin(f, armSDF(p, uArmS0, uArmC0, uArmH0, uArmD0, uArmP0, uArmQ0, uArmG.x, uArmE.x), 0.14);
  f = smin(f, armSDF(p, uArmS1, uArmC1, uArmH1, uArmD1, uArmP1, uArmQ1, uArmG.y, uArmE.y), 0.14);
  // gentle rising noise: the surface flickers but never breaks apart
  float t = uTime;
  vec3 np = vec3(p.x*0.42, p.y*0.21 - t*0.27, p.z*0.42);
  float n = nz(np)*0.65 + nz(np*2.1 + vec3(0.31, -t*0.2, 0.17))*0.35;
  float up = clamp((p.y - 0.1)/1.0, 0.0, 1.0);
  float calm = smoothstep(0.2, 0.7, q.z/uBodyR.z)*smoothstep(0.3, -0.1, q.y)*(1.0 - smoothstep(0.55, 0.95, abs(q.x)/uBodyR.x));
  f += (n - 0.5)*2.0*mix(0.035 + 0.07*up, 0.012, calm);
  // flames wrap around the pan, never into it
  if (p.y > uPan.y - 0.07) f = max(f, 1.06 - length(p.xz - uPan.xz));
  return f;
}

void main(){
  vec3 ro = uCam, rd = normalize(vW - uCam);
  vec3 inv = 1.0/rd;
  vec3 ta = (uBoxMin - ro)*inv, tb = (uBoxMax - ro)*inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tf <= tn) discard;
  float t = tn, tp = tn, m = 1.0, f = 1.0;
  bool hit = false;
  for (int i = 0; i < 80; i++) {
    f = field(ro + rd*t, m);
    if (f < 0.0) { hit = true; break; }
    tp = t;
    t += max(f*0.5, 0.012);
    if (t > tf) break;
  }
  if (!hit) discard;
  for (int i = 0; i < 5; i++) {                 // refine the crossing
    float tm = 0.5*(tp + t);
    if (field(ro + rd*tm, m) < 0.0) t = tm; else tp = tm;
  }
  vec3 p = ro + rd*t;
  field(p, m);

  // colour bands follow each tongue: sample how deep we are just behind the surface
  float mm;
  float depth = -(field(p + rd*0.05, mm) + field(p + rd*0.12, mm) + field(p + rd*0.21, mm))/3.0;
  float inner = nz(vec3(p.x*0.5, p.y*0.24 - uTime*0.33, p.z*0.5) + 0.5);
  float heat = smoothstep(0.0, 0.2, depth)*0.55 + smoothstep(0.56, 0.76, inner)*0.14
             - clamp((p.y - 0.6)/1.2, 0.0, 1.0)*0.26 + 0.28 + uFlare*0.06;
  {
    vec3 qc = (p - uBody)/uSquash;
    vec2 fqc = vec2(dot(qc, uFaceR), dot(qc, uFaceU)) - vec2(-0.05, -0.68);
    float frontc = smoothstep(0.0, 0.3, dot(normalize(qc/(uBodyR*uBodyR)), uFaceF));
    heat += 0.24*exp(-dot(fqc, fqc)/0.12)*frontc;
  }
  vec3 col = fireRamp(clamp(heat, 0.0, 1.0))*0.9;

  // painted face on the calm front of the mound
  vec3 ql = (p - uBody)/uSquash;
  vec2 fq = vec2(dot(ql, uFaceR), dot(ql, uFaceU));
  vec3 nE = normalize(ql/(uBodyR*uBodyR));
  float front = smoothstep(0.1, 0.35, dot(nE, uFaceF))*(1.0 - smoothstep(0.035, 0.07, abs(m)));
  float aa = length(fwidth(fq))*0.75 + 1e-5;
  vec4 face = drawFace(fq, aa);
  face.a *= front;
  col = mix(col, face.rgb, face.a);

  // some transparency, like the film: thin tongues and the flame tips let the pan rim, the handle and
  // the food show through; the body and the painted face stay solid
  float thick = smoothstep(0.02, 0.2, depth);
  float a = mix(0.5, 0.97, thick)*(1.0 - 0.3*smoothstep(0.6, 1.4, p.y));
  // where the flame passes in front of the pan, the pan shows through it (never around the face)
  {
    vec2 o2 = p.xz - uPan.xz, d2 = rd.xz;
    float qa = dot(d2, d2), qb = 2.0*dot(o2, d2), qc = dot(o2, o2) - 1.06*1.06;
    float disc = qb*qb - 4.0*qa*qc;
    float over = 0.0;
    if (disc > 0.0 && rd.y < -0.01) {
      float s1 = (-qb - sqrt(disc))/(2.0*qa), s2 = (-qb + sqrt(disc))/(2.0*qa);
      float sTop = (uPan.y + 0.24 - p.y)/rd.y, sBot = (uPan.y - 0.03 - p.y)/rd.y;
      over = step(max(max(s1, sTop), 0.0), min(s2, sBot));
    }
    float faceZone = (1.0 - smoothstep(0.4, 0.58, length(fq - vec2(-0.05, -0.68))))*smoothstep(0.0, 0.3, dot(nE, uFaceF));
    a *= 1.0 - 0.42*over*(1.0 - faceZone);
  }
  a = mix(a, 1.0, face.a);
  // the flame is light: where it is see-through it keeps its glow and only lets the background show
  float lum = mix(a, 1.0, 0.6);

  vec4 clip = uViewProj*vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z/clip.w*0.5 + 0.5, 0.0, 1.0);
  o = vec4(col*lum, a);
  oG = vec4(col*(0.5 - 0.1*uFlare)*(1.0 - face.a), a);
}"#
    )
}

/// Ghibli-style steam: soft white puffs that billow up a curling column and thin out.
pub fn steam_vs() -> String {
    format!(
        "{HEAD}{}",
        r#"
layout(location=0) in vec3 aPos; layout(location=2) in vec2 aUv;
uniform mat4 uViewProj; uniform vec3 uCenter; uniform vec3 uRight; uniform vec3 uUp; uniform vec2 uSize;
out vec2 vUv;
void main(){
  vUv = aUv;
  vec3 wp = uCenter + uRight*aPos.x*uSize.x + uUp*aPos.y*uSize.y;
  gl_Position = uViewProj * vec4(wp, 1.0);
}"#
    )
}

pub fn steam_fs() -> String {
    format!(
        "{HEAD}{COMMON}{}",
        r#"
uniform float uTime; uniform float uSeed; uniform float uOpacity; uniform float uAspect;
in vec2 vUv; layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
void main(){
  vec2 p = vec2((vUv.x - 0.5)*uAspect, vUv.y);
  float t = uTime*0.33 + uSeed*7.0;
  // wispy warp
  p.x += 0.06*snoise(vec3(p*2.2 - vec2(0.0, t*0.8), uSeed));
  float a = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float life = fract(t*0.55 + fi/7.0);
    float yy = 0.04 + life*0.92;
    float xx = (0.04 + 0.08*life)*sin(life*5.5 + uSeed*3.0 + fi*1.9);
    float r = 0.05 + 0.12*life;
    vec2 d = p - vec2(xx, yy);
    float ang = atan(d.y, d.x);
    float rr = r*(1.0 + 0.08*sin(ang*3.0 + t*2.0 + fi) + 0.035*sin(ang*5.0 - t*1.3));
    float dd = length(d)/rr;
    float puff = 1.0 - smoothstep(0.25, 1.0, dd);
    float fade = smoothstep(0.08, 0.3, life) * (1.0 - smoothstep(0.5, 1.0, life));
    a = max(a, puff*fade*(0.8 + 0.4*(1.0 - dd)));
  }
  a *= smoothstep(0.5, 0.36, abs(vUv.x - 0.5)) * smoothstep(1.0, 0.8, vUv.y);
  o = vec4(vec3(1.0), a*uOpacity);
  oG = vec4(0.0);
}"#
    )
}

/// Pan floor: amber bacon grease strewn with crisp brown bits (thickest around the bacon), a few
/// popping bubbles, and a gloss that catches the key light and the fire.
pub fn oil_fs() -> String {
    format!(
        "{HEAD}{COMMON}{LIGHTS}{}",
        r#"
uniform float uTime; uniform vec4 uS0; uniform vec4 uS1; uniform vec4 uS2; uniform vec3 uHL; uniform vec3 uHW;
uniform float uBoost;
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vL;
layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
float strip(vec2 p, vec4 s, float hl, float hw){
  vec2 d = p - s.xy; vec2 dir = s.zw; vec2 q = vec2(dot(d, dir), dot(d, vec2(-dir.y, dir.x)));
  vec2 e = abs(q) - vec2(hl, hw);
  return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
}
// one crumb per jittered cell: a rough nugget lit from the key side, with a short shadow
void crumbs(inout vec3 col, vec2 p, float scale, float dens, float seed){
  vec2 g = p*scale + seed*vec2(5.3, 1.7);
  vec2 id = floor(g), f = fract(g);
  vec3 h = hash3(id + seed*13.0);
  if (h.z > dens) return;
  vec2 d = f - (0.32 + 0.36*h.xy);
  float a = atan(d.y, d.x);
  float rr = (0.10 + 0.13*fract(h.z*23.1))*(1.0 + 0.28*sin(3.0*a + h.x*6.3) + 0.14*sin(6.0*a + h.y*6.3));
  float len = length(d);
  float aa = length(fwidth(g))*0.6;
  float m = 1.0 - smoothstep(rr - aa, rr + aa, len);
  float sh = (1.0 - smoothstep(rr - aa, rr + aa, length(d + uKeyDir.xz*rr*0.9)))*(1.0 - m);
  vec2 q = d/max(rr, 1e-3);
  vec3 nn = normalize(vec3(q.x, 0.6*sqrt(max(1.0 - dot(q, q), 0.0)) + 0.35, q.y));
  float tone = smoothstep(-0.05, 0.75, dot(nn, uKeyDir));
  vec3 crumb = mix(s2l(vec3(0.24, 0.11, 0.04)), s2l(vec3(0.78, 0.53, 0.25)), tone);
  crumb = mix(crumb, s2l(vec3(0.16, 0.07, 0.03)), step(0.72, fract(h.z*57.3))*0.6);
  col = mix(col, col*0.45, sh*0.7);
  col = mix(col, crumb, m);
}
void main(){
  vec2 p = vL.xz;
  float r = length(p);
  float m1 = snoise(vec3(p*3.2, uTime*0.06));
  float m2 = snoise(vec3(p*9.0 + 3.0, uTime*0.10));
  vec3 col = mix(s2l(vec3(0.20, 0.105, 0.045)), s2l(vec3(0.40, 0.23, 0.09)), clamp(0.5 + 0.35*m1 + 0.15*m2, 0.0, 1.0));
  col = mix(col, s2l(vec3(0.11, 0.065, 0.035)), smoothstep(0.64, 0.9, r)*0.55);
  float db = min(min(strip(p, uS0, uHL.x, uHW.x), strip(p, uS1, uHL.y, uHW.y)), strip(p, uS2, uHL.z, uHW.z));
  float nearBacon = 1.0 - smoothstep(0.0, 0.26, db);
  col = mix(col, s2l(vec3(0.50, 0.30, 0.11)), nearBacon*0.35);
  float grit = 0.30 + 0.45*nearBacon + 0.18*smoothstep(0.55, 0.85, r);
  crumbs(col, p, 24.0, grit, 1.0);
  crumbs(col, p, 43.0, grit*0.9, 2.0);
  float dens = nearBacon*0.62 + smoothstep(0.67, 0.93, r)*0.19 + 0.03;
  dens = min(dens*(1.0 + uBoost), 1.0);
  // Each bubble stays in its own jittered cell, avoiding nine neighbour tests.
  vec2 g = p*18.0; vec2 id = floor(g); vec2 f = fract(g);
  vec3 h = hash3(id);
  if (h.z < dens) {
    vec2 c = 0.27 + 0.46*h.xy;
    float life = fract(uTime*(0.35 + 0.55*h.x)*(1.0 + uBoost) + h.y*7.0);
    float rad = 0.25*sqrt(max(sin(life*3.14159), 0.0))*(0.55 + 0.45*fract(h.z*13.7));
    float d = length(f - c);
    float fill = 1.0 - smoothstep(rad - 0.055, rad, d);
    float ring = (1.0 - smoothstep(0.02, 0.065, abs(d - rad))) * step(0.05, rad);
    float hi = 1.0 - smoothstep(0.0, 0.07, length(f - c - vec2(-0.30, 0.32)*rad));
    col = mix(col, s2l(vec3(0.71, 0.51, 0.27)), fill*0.48);
    col = mix(col, s2l(vec3(0.20, 0.10, 0.05)), ring*0.42);
    col = mix(col, s2l(vec3(1.0, 0.91, 0.72)), hi*fill*0.65);
  }
  // gloss: a rippled glint of the key light, and the fire's glow at grazing angles
  vec3 n = normalize(vN); vec3 v = normalize(uCam - vW); vec3 hh = normalize(uKeyDir + v);
  col += smoothstep(0.978, 0.994, dot(n, hh) + 0.006*m2)*0.3*uKeyCol;
  col *= uKeyCol*0.9 + uAmbTop*0.6;
  col += s2l(vec3(1.0, 0.55, 0.22))*pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0)*0.18;
  o = vec4(col, 1.0);
  oG = vec4(0.0);
}"#
    )
}

/// Hearth ash, painted: lumpy grey-beige drifts strewn with cinders and pale stones that catch the key
/// light and throw short shadows. Warm around the fire, dark where the logs sit in it.
pub fn ground_fs() -> String {
    format!(
        "{HEAD}{COMMON}{LIGHTS}{BUMP}{}",
        r#"
uniform float uTime; uniform float uFlare; uniform float uFlicker;
uniform vec4 uLog0; uniform vec4 uLog1; uniform vec2 uLogR; uniform float uLogH; uniform float uBurn;
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vL;
layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h); }
// one stone per jittered cell (no neighbour search), sized so it and its shadow stay inside the cell;
// pale sets how many are ash-white rather than cinder, amt how strongly they read
void stones(inout vec3 col, inout float hgt, vec2 p, float scale, float dens, float seed, float pale, float amt){
  vec2 g = p*scale + seed*vec2(7.1, 3.3);
  vec2 id = floor(g), f = fract(g);
  vec3 h = hash3(id + seed*17.0);
  if (h.z > dens) return;
  vec2 d = f - (0.36 + 0.28*h.xy);
  float a = atan(d.y, d.x);
  float rr = (0.07 + 0.10*fract(h.z*31.7))*(1.0 + 0.17*sin(3.0*a + h.x*6.3) + 0.08*sin(5.0*a + h.y*6.3));
  float len = length(d);
  float aa = length(fwidth(g))*0.7;
  float m = 1.0 - smoothstep(rr - aa, rr + aa, len);
  float sh = (1.0 - smoothstep(rr*0.9 - aa, rr*1.05 + aa, length(d + uKeyDir.xz*rr*0.8)))*(1.0 - m);
  vec2 q = d/max(rr, 1e-3);
  vec3 nn = normalize(vec3(q.x, 0.7*sqrt(max(1.0 - dot(q, q), 0.0)) + 0.3, q.y));
  float tone = smoothstep(-0.1, 0.7, dot(nn, uKeyDir));
  vec3 stone = fract(h.z*57.3) < pale
    ? mix(s2l(vec3(0.44, 0.40, 0.34)), s2l(vec3(0.76, 0.71, 0.62)), tone)
    : mix(s2l(vec3(0.10, 0.085, 0.075)), s2l(vec3(0.40, 0.35, 0.30)), tone);
  col = mix(col, col*0.55, sh*0.7*amt);
  col = mix(col, stone, m*amt);
  hgt += m*0.004;
}
void main(){
  vec2 p = vW.xz;
  float warp = snoise(vec3(p*0.7, 7.0));
  vec2 q = p + warp*vec2(0.14, 0.09);
  float broad = fbm(vec3(q*0.55, 1.3));
  float mid = snoise(vec3(q*2.3, 4.1));
  float fine = snoise(vec3(q*6.0, 9.0));
  float speck = snoise(vec3(p*17.0, 2.0));
  vec3 ashLight = s2l(vec3(0.76, 0.70, 0.59));
  vec3 ashMid = s2l(vec3(0.60, 0.54, 0.44));
  vec3 ashDark = s2l(vec3(0.39, 0.34, 0.28));
  vec3 soot = s2l(vec3(0.20, 0.17, 0.15));
  vec3 base = mix(ashMid, ashLight, smoothstep(-0.15, 0.45, broad + 0.2*mid));
  base = mix(base, ashDark, smoothstep(0.15, 0.65, -broad - 0.35*mid)*0.7);
  base = mix(base, soot, smoothstep(0.55, 0.85, -mid - 0.3*fine)*0.45);
  base *= 0.94 + 0.06*speck;
  // soft drifts: a gentle relief the light rakes across
  float hgt = 0.030*mid + 0.012*fine + 0.0015*speck;
  // soot and spent charcoal where the fire has burned in this spot for a long time
  float hearthD = length(p/vec2(1.35, 1.2)) + 0.35*mid + 0.15*fine;
  float sooty = (1.0 - smoothstep(0.95, 2.4, hearthD))*mix(0.3, 1.0, uBurn);
  base = mix(base, s2l(vec3(0.17, 0.15, 0.14)), sooty*0.6);
  stones(base, hgt, p, 2.3, 0.22, 1.0, 0.30, 1.0);
  stones(base, hgt, p, 4.9, 0.34, 2.0, 0.25, 0.85);
  stones(base, hgt, p, 11.0, 0.40, 3.0, 0.30, 0.6);
  stones(base, hgt, p, 7.3, 0.6*sooty, 4.0, 0.0, 0.9);
  // a few embers still glowing in the ash right at the logs' feet
  vec2 eg = p*16.0; vec3 eh = hash3(floor(eg) + 91.0);
  float ec = length(fract(eg) - 0.3 - 0.4*eh.xy);
  float emberAsh = (1.0 - smoothstep(0.05, 0.13, ec))*step(eh.z, 0.10)*(1.0 - smoothstep(0.85, 1.25, hearthD))
                 *(0.5 + 0.5*sin(uTime*(1.1 + eh.x) + eh.y*6.3))*uFlicker*smoothstep(0.35, 0.8, uBurn);
  vec3 nb = bumped(normalize(vN), vW, hgt);
  float lam = clamp(dot(nb, uKeyDir)/max(uKeyDir.y, 0.1), 0.35, 1.25);
  // the logs sit down in the ash: a tight contact shadow, and their cast shadow away from the key light
  float dl = min(segDist(p, uLog0.xy, uLog0.zw) - uLogR.x, segDist(p, uLog1.xy, uLog1.zw) - uLogR.y);
  vec2 throwDir = uKeyDir.xz/max(uKeyDir.y, 0.2)*uLogH;
  float ds = min(segDist(p + throwDir, uLog0.xy, uLog0.zw) - uLogR.x*1.1,
                 segDist(p + throwDir*0.85, uLog1.xy, uLog1.zw) - uLogR.y*1.1);
  float occ = mix(0.42, 1.0, smoothstep(-0.03, 0.17, dl))*mix(0.58, 1.0, smoothstep(-0.02, 0.10, ds));
  vec3 col = base*(uKeyCol*0.85*lam + uAmbTop*0.5)*occ;
  float d = length(vW.xz - uFirePos.xz);
  float glow = pow(clamp(1.0 - d/3.4, 0.0, 1.0), 2.0)*(1.0 + 0.35*uFlare)*uFlicker;
  col += base*uFireCol*glow*0.85*mix(0.45, 1.0, occ);
  col += uFireCol*pow(clamp(1.0 - d/1.9, 0.0, 1.0), 3.0)*0.05*uFlicker;
  vec3 emberCol = s2l(vec3(1.0, 0.36, 0.08))*emberAsh;
  col += emberCol*1.5;
  col = mix(col, uFogCol, smoothstep(uFog.x, uFog.y, length(uCam - vW)));
  o = vec4(col, 1.0);
  oG = vec4(emberCol*0.9, 0.0);
}"#
    )
}

/// Point sprites: 0 embers, 1 oil sparks, 2 poke burst, 3 grease beads on the bacon.
pub fn points_vs() -> String {
    format!(
        "{HEAD}{}",
        r#"
layout(location=0) in vec4 aA; layout(location=1) in vec4 aB;
uniform mat4 uModel; uniform mat4 uView; uniform mat4 uProj;
uniform float uTime; uniform float uScale; uniform float uMode; uniform float uBurst; uniform float uHide; uniform vec3 uBurstOff;
out float vLife; out float vAlpha;
void main(){
  vec3 p; float life = 0.0; float size = 0.0; vAlpha = 1.0;
  if (uMode < 0.5) {
    life = fract(uTime*aB.x*0.3 + aA.w);
    p = aA.xyz + vec3(sin(life*6.0 + aB.z)*0.22, life*aB.y, cos(life*4.0 + aB.z)*0.14);
    size = 0.03*(1.0 - life);
    vAlpha = smoothstep(0.0, 0.1, life)*(1.0 - life);
  } else if (uMode < 1.5) {
    life = fract(uTime/aB.x + aA.w);
    float k = life/0.3;
    p = aA.xyz + vec3(aB.z*k, aB.y*4.0*k*(1.0 - k), aB.w*k);
    size = (k < 1.0 ? 0.016 : 0.0)*(1.0 - uHide);
    vAlpha = 1.0 - 0.6*k;
  } else if (uMode < 2.5) {
    float age = uTime - uBurst;
    life = clamp(age/(0.7 + aB.x*1.5), 0.0, 1.0);
    vec3 v = vec3(cos(aB.z)*aB.y*0.55, 2.1 + aB.y*0.8, sin(aB.z)*aB.y*0.45);
    p = aA.xyz + uBurstOff + v*age + vec3(0.0, -2.3, 0.0)*age*age*0.5;
    size = (age >= 0.0 && age < 2.5) ? 0.045*(1.0 - life) : 0.0;
    vAlpha = 1.0 - life;
  } else {
    life = fract(uTime/aB.x + aA.w);
    float s = life < 0.4 ? sin(life/0.4*3.14159) : 0.0;
    p = aA.xyz;
    size = s*aB.y*(1.0 - uHide);
  }
  vLife = life;
  vec4 mv = uView*uModel*vec4(p, 1.0);
  gl_PointSize = size*uScale/max(-mv.z, 0.1);
  gl_Position = uProj*mv;
}"#
    )
}

pub fn points_fs() -> String {
    format!(
        "{HEAD}{}",
        r#"
uniform float uMode;
in float vLife; in float vAlpha; layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  if (uMode > 2.5) {
    float body = 1.0 - smoothstep(0.40, 0.5, d);
    if (body < 0.01) discard;
    float rim = smoothstep(0.26, 0.44, d);
    float hi = 1.0 - smoothstep(0.0, 0.13, length(c - vec2(-0.13, -0.13)));
    vec3 col = mix(vec3(0.92, 0.72, 0.46), vec3(0.36, 0.14, 0.05), rim);
    col = mix(col, vec3(1.0), hi);
    o = vec4(col, body*0.95);
    oG = vec4(0.0);
  } else {
    float a = (1.0 - smoothstep(0.0, 0.5, d))*vAlpha;
    vec3 col = mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.42, 0.1), vLife);
    o = vec4(col*a, a);
    oG = vec4(col*a, 0.0);
  }
}"#
    )
}

pub fn fullscreen_vs() -> String {
    format!(
        "{HEAD}{}",
        r#"
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p*2.0 - 1.0, 0.0, 1.0); }"#
    )
}

pub fn bright_fs() -> String {
    format!(
        "{HEAD}{}",
        r#"
uniform sampler2D uTex; in vec2 vUv; out vec4 o;
void main(){ o = vec4(texture(uTex, vUv).rgb, 1.0); }"#
    )
}

pub fn blur_fs() -> String {
    format!(
        "{HEAD}{}",
        r#"
uniform sampler2D uTex; uniform vec2 uDir; in vec2 vUv; out vec4 o;
void main(){
  float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 c = texture(uTex, vUv).rgb*w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uTex, vUv + uDir*float(i)).rgb*w[i];
    c += texture(uTex, vUv - uDir*float(i)).rgb*w[i];
  }
  o = vec4(c, 1.0);
}"#
    )
}

pub fn composite_fs() -> String {
    format!(
        "{HEAD}{}",
        r#"
uniform sampler2D uScene; uniform sampler2D uB1; uniform sampler2D uB2;
uniform float uStrength; uniform float uTime;
in vec2 vUv; out vec4 o;
void main(){
  vec3 c = texture(uScene, vUv).rgb + uStrength*(texture(uB1, vUv).rgb*0.7 + texture(uB2, vUv).rgb*1.1);
  vec2 p = vUv - 0.5;
  float vig = smoothstep(0.95, 0.30, length(p*vec2(1.15, 1.0)));
  c *= mix(vec3(0.62, 0.48, 0.40), vec3(1.0), vig);
  c = clamp(c, 0.0, 1.0);
  vec3 s = mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime)*97.0, vec2(12.9898, 78.233)))*43758.5453);
  s += (g - 0.5)*(2.0/255.0);
  o = vec4(s, 1.0);
}"#
    )
}


/// CPU particles: xyz + size, rgba. uAdd picks additive sparks vs alpha-blended chips.
pub fn fx_vs() -> String {
    format!(
        "{HEAD}{}",
        r#"
layout(location=0) in vec4 aPS; layout(location=1) in vec4 aC;
uniform mat4 uView; uniform mat4 uProj; uniform float uScale;
out vec4 vC;
void main(){
  vec4 mv = uView*vec4(aPS.xyz, 1.0);
  gl_PointSize = aPS.w*uScale/max(-mv.z, 0.1);
  gl_Position = uProj*mv;
  vC = aC;
}"#
    )
}

pub fn fx_fs() -> String {
    format!(
        "{HEAD}{}",
        r#"
uniform float uAdd; in vec4 vC; layout(location=0) out vec4 o; layout(location=1) out vec4 oG;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  if (uAdd > 0.5) {
    float a = (1.0 - smoothstep(0.0, 0.5, d))*vC.a;
    o = vec4(vC.rgb*a*1.6, a);
    oG = vec4(vC.rgb*a, 0.0);
  } else {
    float a = (1.0 - smoothstep(0.36, 0.5, d))*vC.a;
    if (a < 0.01) discard;
    float hi = 1.0 - smoothstep(0.0, 0.22, length(c - vec2(-0.12, -0.12)));
    o = vec4(mix(vC.rgb, vec3(1.0), hi*0.35), a);
    oG = vec4(0.0);
  }
}"#
    )
}
