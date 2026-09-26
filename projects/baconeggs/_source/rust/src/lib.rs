//! Breakfast at the Hearth — a fire spirit keeping a skillet of bacon and eggs sizzling.
//! Blender-built assets (GLB) rendered with a hand-written WebGL2 pipeline.

mod assets;
mod fx;
mod gfx;
mod shaders;

use std::collections::HashMap;

use glam::{Mat3, Mat4, Quat, Vec2, Vec3, Vec4};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext as GL, WebGlTexture, WebGlVertexArrayObject};

use gfx::{Mesh, Msaa, Prog, Target};

const TAU: f32 = std::f32::consts::TAU;
const PI: f32 = std::f32::consts::PI;

fn srgb(hex: u32) -> Vec3 {
    let f = |c: u32| {
        let c = c as f32 / 255.0;
        if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    Vec3::new(f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255))
}

struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        // scramble the state so successive draws aren't correlated
        (x.wrapping_mul(0x9E37_79B9) >> 8) as f32 / (1u32 << 24) as f32
    }
    fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.next()
    }
}

/// Everything the painted face can do, blended smoothly between moods.
#[derive(Clone, Copy)]
struct Expr {
    lids: Vec2,
    scale: Vec2,
    gaze_l: Vec2,
    gaze_r: Vec2,
    pupil: f32,
    spiral: f32,
    brow: Vec4,
    brow_amt: f32,
    tilt: f32,
    mouth_w: f32,
    mouth_amp: f32,
    open: f32,
    zig: f32,
    mouth_tilt: f32,
    happy: f32,
}

impl Expr {
    fn content() -> Expr {
        Expr {
            lids: Vec2::ONE,
            scale: Vec2::ONE,
            gaze_l: Vec2::new(-0.014, 0.006),
            gaze_r: Vec2::new(-0.014, 0.006),
            pupil: 1.0,
            spiral: 0.0,
            brow: Vec4::ZERO,
            brow_amt: 0.0,
            tilt: 0.0,
            mouth_w: 1.0,
            mouth_amp: 1.0,
            open: 0.0,
            zig: 0.0,
            mouth_tilt: 0.0,
            happy: 0.0,
        }
    }
    /// ^ ^ eyes and an open grin.
    fn happy() -> Expr {
        Expr { happy: 1.0, mouth_w: 1.15, mouth_amp: 1.1, open: 0.8, gaze_l: Vec2::ZERO, gaze_r: Vec2::ZERO, ..Expr::content() }
    }
    /// Heavy lids, pupils drooping, mouth a little slack.
    fn sleepy() -> Expr {
        Expr {
            lids: Vec2::splat(0.42),
            gaze_l: Vec2::new(0.0, -0.012),
            gaze_r: Vec2::new(0.0, -0.012),
            pupil: 0.95,
            tilt: 0.06,
            mouth_w: 0.7,
            mouth_amp: 0.6,
            open: 0.12,
            ..Expr::content()
        }
    }
    /// One eye squinting, the other wide; one brow up, one furrowed; squiggly mouth; head tilted. `s` picks the side.
    fn confused(s: f32, rng: &mut Rng) -> Expr {
        let (squint, wide) = (rng.range(0.42, 0.6), rng.range(1.08, 1.2));
        let lids = if s > 0.0 { Vec2::new(squint, wide) } else { Vec2::new(wide, squint) };
        let scale = if s > 0.0 { Vec2::new(0.92, 1.1) } else { Vec2::new(1.1, 0.92) };
        let (furrow, arch) = (Vec2::new(0.35, -0.004), Vec2::new(-0.28, rng.range(0.03, 0.045)));
        let brow = if s > 0.0 { Vec4::new(furrow.x, furrow.y, arch.x, arch.y) } else { Vec4::new(arch.x, arch.y, furrow.x, furrow.y) };
        Expr {
            lids,
            scale,
            gaze_l: Vec2::new(0.02 * s, 0.018),
            gaze_r: Vec2::new(0.02 * s, 0.018),
            pupil: 0.9,
            spiral: 0.0,
            brow,
            brow_amt: 1.0,
            tilt: rng.range(0.1, 0.18) * s,
            mouth_w: 0.8,
            mouth_amp: 0.7,
            open: 0.0,
            zig: rng.range(0.45, 0.7),
            mouth_tilt: -0.12 * s,
            happy: 0.0,
        }
    }
    /// Spiral eyes, worried brows, slack wobbly mouth (the sway is added per frame).
    fn dizzy() -> Expr {
        Expr {
            lids: Vec2::splat(1.05),
            scale: Vec2::splat(1.08),
            gaze_l: Vec2::ZERO,
            gaze_r: Vec2::ZERO,
            pupil: 1.0,
            spiral: 1.0,
            brow: Vec4::new(-0.3, 0.02, -0.3, 0.02),
            brow_amt: 0.8,
            tilt: 0.0,
            mouth_w: 0.85,
            mouth_amp: 1.0,
            open: 0.35,
            zig: 0.45,
            mouth_tilt: 0.0,
            happy: 0.0,
        }
    }
    /// Wide eager eyes looking up, brows raised, mouth wide open for the incoming snack.
    fn gobble() -> Expr {
        Expr {
            lids: Vec2::splat(1.15),
            scale: Vec2::splat(1.1),
            gaze_l: Vec2::new(0.0, 0.022),
            gaze_r: Vec2::new(0.0, 0.022),
            pupil: 0.8,
            brow: Vec4::new(-0.15, 0.04, -0.15, 0.04),
            brow_amt: 1.0,
            mouth_w: 1.3,
            mouth_amp: 1.1,
            open: 1.5,
            ..Expr::content()
        }
    }
    /// Blissful ^ ^ while munching (the chomp itself is animated per frame).
    fn chew() -> Expr {
        Expr { happy: 1.0, mouth_w: 0.95, mouth_amp: 0.9, open: 0.3, zig: 0.2, ..Expr::content() }
    }
    fn surprised() -> Expr {
        Expr {
            lids: Vec2::splat(1.2),
            scale: Vec2::splat(1.14),
            gaze_l: Vec2::new(0.0, 0.004),
            gaze_r: Vec2::new(0.0, 0.004),
            pupil: 0.62,
            spiral: 0.0,
            brow: Vec4::new(-0.1, 0.045, -0.1, 0.045),
            brow_amt: 1.0,
            tilt: 0.0,
            mouth_w: 0.4,
            mouth_amp: 0.4,
            open: 1.0,
            zig: 0.0,
            mouth_tilt: 0.0,
            happy: 0.0,
        }
    }
    fn lerp(&self, o: &Expr, k: f32) -> Expr {
        let f = |a: f32, b: f32| a + (b - a) * k;
        Expr {
            lids: self.lids.lerp(o.lids, k),
            scale: self.scale.lerp(o.scale, k),
            gaze_l: self.gaze_l.lerp(o.gaze_l, k),
            gaze_r: self.gaze_r.lerp(o.gaze_r, k),
            pupil: f(self.pupil, o.pupil),
            spiral: f(self.spiral, o.spiral),
            brow: self.brow.lerp(o.brow, k),
            brow_amt: f(self.brow_amt, o.brow_amt),
            tilt: f(self.tilt, o.tilt),
            mouth_w: f(self.mouth_w, o.mouth_w),
            mouth_amp: f(self.mouth_amp, o.mouth_amp),
            open: f(self.open, o.open),
            zig: f(self.zig, o.zig),
            mouth_tilt: f(self.mouth_tilt, o.mouth_tilt),
            happy: f(self.happy, o.happy),
        }
    }
}

struct Node {
    parent: Option<usize>,
    bt: Vec3,
    br: Quat,
    bs: Vec3,
    t: Vec3,
    r: Quat,
    s: Vec3,
    mesh: Option<usize>,
    world: Mat4,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Iron,
    Oil,
    Bacon,
    Egg,
    Yolk,
    Fire,
    Ground,
    Shell,
}

struct Prim {
    mesh: Mesh,
    kind: Kind,
    tex: Option<WebGlTexture>,
    half: f32,
}

struct Plume {
    pos: Vec3,
    w: f32,
    h: f32,
    seed: f32,
}

#[derive(Clone, Copy, PartialEq)]
enum FState {
    Pan,
    Held,
    Eaten,
    Falling,
}

/// One piece of food. Its flight is re-rolled on every flip; `drop` sends it to a flame hand instead.
#[derive(Clone, Copy)]
struct Food {
    node: usize,
    is_egg: bool,
    state: FState,
    delay: f32,
    dur: f32,
    height: f32,
    axis: Vec3,
    turns: f32,
    yaw: f32,
    wobble: f32,
    drift: Vec3,
    drop: bool,
    arm: usize,
    catch_pt: Vec3,
    hold_rot: Quat,
    fall_t0: f32,
    fall_h: f32,
    fall_off: Vec3,
    fall_ph: f32,
    land_t: f32,
    cracked: bool,
}

impl Food {
    fn new(node: usize, is_egg: bool) -> Food {
        Food {
            node,
            is_egg,
            state: FState::Pan,
            delay: 0.1,
            dur: 0.6,
            height: 0.8,
            axis: Vec3::X,
            turns: TAU,
            yaw: 0.0,
            wobble: 0.0,
            drift: Vec3::ZERO,
            drop: false,
            arm: 0,
            catch_pt: Vec3::ZERO,
            hold_rot: Quat::IDENTITY,
            fall_t0: -99.0,
            fall_h: 3.0,
            fall_off: Vec3::ZERO,
            fall_ph: 0.0,
            land_t: -99.0,
            cracked: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum APhase {
    Rest,
    Reach,
    Wait,
    Carry,
    Feed,
    Retract,
}

/// A flame arm: grows out of the body's side, catches food, carries it to the mouth, feeds, retracts.
#[derive(Clone, Copy)]
struct Arm {
    side: f32,
    phase: APhase,
    t0: f32,
    dur: f32,
    from: Vec3,
    to: Vec3,
    item: Option<usize>,
    reach_at: f32,
    hand: Vec3,
    grip: f32,
    ext: f32,
    s: Vec3,
    c: Vec3,
    d: Vec3,
    p: Vec3,
    q: Vec3,
}

impl Arm {
    fn new(side: f32) -> Arm {
        Arm {
            side,
            phase: APhase::Rest,
            t0: 0.0,
            dur: 1.0,
            from: Vec3::ZERO,
            to: Vec3::ZERO,
            item: None,
            reach_at: 0.0,
            hand: Vec3::ZERO,
            grip: 0.0,
            ext: 0.0,
            s: Vec3::ZERO,
            c: Vec3::ZERO,
            d: Vec3::X,
            p: Vec3::Z,
            q: Vec3::Y,
        }
    }
    fn go(&mut self, phase: APhase, t: f32, dur: f32, to: Vec3) {
        self.phase = phase;
        self.t0 = t;
        self.dur = dur;
        self.from = self.hand;
        self.to = to;
    }
}

const REACH_T: f32 = 0.5;
const CARRY_T: f32 = 0.62;
const FEED_T: f32 = 0.38;
const RETRACT_T: f32 = 0.5;
const CHEW_T: f32 = 2.8;

fn ease_io(x: f32) -> f32 {
    if x < 0.5 { 2.0 * x * x } else { 1.0 - (-2.0 * x + 2.0).powi(2) / 2.0 }
}
fn ease_out(x: f32) -> f32 {
    1.0 - (1.0 - x).powi(3)
}
fn bez(a: Vec3, c: Vec3, b: Vec3, t: f32) -> Vec3 {
    a.lerp(c, t).lerp(c.lerp(b, t), t)
}
fn smooth(a: f32, b: f32, x: f32) -> f32 {
    let u = ((x - a) / (b - a)).clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

const EYE_L: Vec2 = Vec2::new(-0.35, -0.63);
const EYE_R: Vec2 = Vec2::new(0.25, -0.63);
const MOUTH: Vec2 = Vec2::new(-0.07, -0.775);

fn ease_out_back(u: f32) -> f32 {
    let (c1, c3) = (1.70158, 2.70158);
    1.0 + c3 * (u - 1.0).powi(3) + c1 * (u - 1.0).powi(2)
}

struct Pointer {
    id: i32,
    x: f32,
    y: f32,
}

struct Progs {
    cel: Prog,
    hull: Prog,
    fire: Prog,
    steam: Prog,
    oil: Prog,
    ground: Prog,
    points: Prog,
    bright: Prog,
    blur: Prog,
    comp: Prog,
    fx: Prog,
}

struct Targets {
    msaa: Msaa,
    scene: Target,
    glow: Target,
    half_a: Target,
    half_b: Target,
    q_a: Target,
    q_b: Target,
}

#[wasm_bindgen]
pub struct App {
    gl: GL,
    p: Progs,
    nodes: Vec<Node>,
    order: Vec<usize>,
    meshes: Vec<Vec<Prim>>,
    names: HashMap<String, usize>,
    quad: Mesh,
    empty: WebGlVertexArrayObject,
    embers: (Mesh, i32),
    burst: (Mesh, i32),
    sparks: (Mesh, i32),
    beads: (Mesh, i32),
    fire_box: Mesh,
    noise: WebGlTexture,
    plumes: Vec<Plume>,
    food: Vec<Food>,
    strips: [Vec4; 3],
    strip_hl: Vec3,
    strip_hw: Vec3,
    bacon_phase: HashMap<usize, f32>,
    // framebuffer
    w: i32,
    h: i32,
    css_w: f32,
    css_h: f32,
    hdr: bool,
    samples: i32,
    rt: Option<Targets>,
    // camera
    target: Vec3,
    radius: f32,
    theta: f32,
    phi: f32,
    d_theta: f32,
    d_phi: f32,
    fov: f32,
    pointers: Vec<Pointer>,
    down_at: Option<(f32, f32, f64)>,
    moved: f32,
    pinch: Option<f32>,
    pointer_ndc: Vec2,
    pointer_seen: f32,
    // animation
    clock: f32,
    time: f32,
    reduced: bool,
    rng: Rng,
    next_blink: f32,
    blink_t: f32,
    double_blink: bool,
    gaze: Vec2,
    gaze_target: Vec2,
    next_glance: f32,
    mumble_t: f32,
    next_mumble: f32,
    mumble_phase: f32,
    poke_t: f32,
    saute_t: f32,
    burst_at: f32,
    expr: Expr,
    expr_goal: Expr,
    expr_kind: u8,
    next_expr: f32,
    dart_t: f32,
    dart_side: f32,
    spin: f32,
    face_off: Vec2,
    after_flip: Vec<(u8, f32)>,
    toss_dur: f32,
    toss_lift: f32,
    toss_tilt: f32,
    toss_push: f32,
    arms: [Arm; 2],
    fx: fx::Fx,
    snack_on: bool,
    chomp_t: f32,
    chew_until: f32,
    last_jaw: f32,
    gulp_fired: bool,
    refill_on: bool,
    last_eat: f32,
    lean: Vec3,
    shells: Vec<Mat4>,
    shell_mesh: Option<usize>,
    burst_offset: Vec3,
    last_reaction: u8,
    forced_drops: usize,
    dizzy_amt: f32,
    // derived each frame
    flare: f32,
    happy: f32,
    lid: f32,
    mumble: f32,
    tossing: bool,
    boost: f32,
    flicker: f32,
    i_pan: usize,
    i_root: usize,
    i_body: usize,
}

fn err(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn points_mesh(gl: &GL, a: &[f32], b: &[f32]) -> (Mesh, i32) {
    (gfx::mesh(gl, &[(0, 4, a), (1, 4, b)], None), (a.len() / 4) as i32)
}

/// Box the flame volume is ray-marched inside (world space).
const FIRE_MIN: Vec3 = Vec3::new(-1.95, -0.36, -1.95);
const FIRE_MAX: Vec3 = Vec3::new(1.95, 2.1, 2.05);

fn box_mesh(gl: &GL, lo: Vec3, hi: Vec3) -> Mesh {
    let pos: Vec<f32> = (0..8u32)
        .flat_map(|i| {
            [
                if i & 1 != 0 { hi.x } else { lo.x },
                if i & 2 != 0 { hi.y } else { lo.y },
                if i & 4 != 0 { hi.z } else { lo.z },
            ]
        })
        .collect();
    let idx: [u32; 36] = [0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3];
    gfx::mesh(gl, &[(0, 3, &pos)], Some(&idx))
}

/// Tileable 3D value noise (two octaves) that the flames scroll through.
fn noise_texture(gl: &GL) -> WebGlTexture {
    const N: usize = 64;
    let mut rng = Rng(0x0BAD_5EED);
    let lat_a: Vec<f32> = (0..8 * 8 * 8).map(|_| rng.next()).collect();
    let lat_b: Vec<f32> = (0..16 * 16 * 16).map(|_| rng.next()).collect();
    let fade = |t: f32| t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    let sample = |lat: &[f32], per: usize, x: f32, y: f32, z: f32| -> f32 {
        let (x0, y0, z0) = (x.floor(), y.floor(), z.floor());
        let (fx, fy, fz) = (fade(x - x0), fade(y - y0), fade(z - z0));
        let at = |i: usize, j: usize, k: usize| lat[((k % per) * per + (j % per)) * per + (i % per)];
        let (i, j, k) = (x0 as usize, y0 as usize, z0 as usize);
        let l = |a: f32, b: f32, t: f32| a + (b - a) * t;
        l(
            l(l(at(i, j, k), at(i + 1, j, k), fx), l(at(i, j + 1, k), at(i + 1, j + 1, k), fx), fy),
            l(l(at(i, j, k + 1), at(i + 1, j, k + 1), fx), l(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), fx), fy),
            fz,
        )
    };
    let mut data = vec![0u8; N * N * N];
    for z in 0..N {
        for y in 0..N {
            for x in 0..N {
                let (u, v, w) = (x as f32 / N as f32, y as f32 / N as f32, z as f32 / N as f32);
                let n = sample(&lat_a, 8, u * 8.0, v * 8.0, w * 8.0) * 0.68 + sample(&lat_b, 16, u * 16.0, v * 16.0, w * 16.0) * 0.32;
                data[(z * N + y) * N + x] = (n.clamp(0.0, 1.0) * 255.0) as u8;
            }
        }
    }
    let t = gl.create_texture().expect("texture");
    gl.bind_texture(GL::TEXTURE_3D, Some(&t));
    gl.pixel_storei(GL::UNPACK_ALIGNMENT, 1);
    let _ = gl.tex_image_3d_with_opt_u8_array(GL::TEXTURE_3D, 0, GL::R8 as i32, N as i32, N as i32, N as i32, 0, GL::RED, GL::UNSIGNED_BYTE, Some(&data));
    for (k, v) in [
        (GL::TEXTURE_MIN_FILTER, GL::LINEAR),
        (GL::TEXTURE_MAG_FILTER, GL::LINEAR),
        (GL::TEXTURE_WRAP_S, GL::REPEAT),
        (GL::TEXTURE_WRAP_T, GL::REPEAT),
        (GL::TEXTURE_WRAP_R, GL::REPEAT),
    ] {
        gl.tex_parameteri(GL::TEXTURE_3D, k, v as i32);
    }
    t
}

// face layout, in the body's local space projected along the default view
const FACE_F: Vec3 = Vec3::new(0.0, 0.819, 0.574);
const FACE_U: Vec3 = Vec3::new(0.0, 0.574, -0.819);
const BODY_RAD: Vec3 = Vec3::new(1.22, 0.42, 1.10);

#[wasm_bindgen]
impl App {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas: HtmlCanvasElement, glb: &[u8], reduced: bool) -> Result<App, JsValue> {
        let opts = js_sys::Object::new();
        js_sys::Reflect::set(&opts, &"antialias".into(), &false.into())?;
        js_sys::Reflect::set(&opts, &"alpha".into(), &false.into())?;
        js_sys::Reflect::set(&opts, &"powerPreference".into(), &"high-performance".into())?;
        let gl: GL = canvas.get_context_with_context_options("webgl2", &opts)?.ok_or("WebGL2 unavailable")?.dyn_into()?;
        let hdr = gl.get_extension("EXT_color_buffer_float").ok().flatten().is_some();
        let max_samples = gl.get_parameter(GL::MAX_SAMPLES)?.as_f64().unwrap_or(4.0) as i32;
        let samples = max_samples.clamp(0, 4);

        use shaders::*;
        let prog = |name: &str, vs: String, fs: String| gfx::program(&gl, name, &vs, &fs).map_err(err);
        let p = Progs {
            cel: prog("cel", cel_vs(), cel_fs())?,
            hull: prog("hull", hull_vs(), hull_fs())?,
            fire: prog("fire", fire_vs(), fire_fs())?,
            steam: prog("steam", steam_vs(), steam_fs())?,
            oil: prog("oil", cel_vs(), oil_fs())?,
            ground: prog("ground", cel_vs(), ground_fs())?,
            points: prog("points", points_vs(), points_fs())?,
            bright: prog("bright", fullscreen_vs(), bright_fs())?,
            blur: prog("blur", fullscreen_vs(), blur_fs())?,
            comp: prog("composite", fullscreen_vs(), composite_fs())?,
            fx: prog("fx", fx_vs(), fx_fs())?,
        };

        // ---- the Blender asset
        let asset = assets::load(glb).map_err(err)?;
        let mut textures: HashMap<usize, WebGlTexture> = HashMap::new();
        let mut meshes = Vec::new();
        for prims in &asset.meshes {
            let mut out = Vec::new();
            for pr in prims {
                let pos: Vec<f32> = pr.pos.iter().flatten().copied().collect();
                let nrm: Vec<f32> = pr.nrm.iter().flatten().copied().collect();
                let uv: Vec<f32> = match &pr.uv {
                    Some(u) => u.iter().flatten().copied().collect(),
                    None => vec![0.0; pr.pos.len() * 2],
                };
                let mesh = gfx::mesh(&gl, &[(0, 3, &pos), (1, 3, &nrm), (2, 2, &uv)], Some(&pr.idx));
                let m = pr.material.as_str();
                let kind = if m.starts_with("M_Bacon") {
                    Kind::Bacon
                } else if m.starts_with("M_Egg") {
                    Kind::Egg
                } else {
                    match m {
                        "M_Oil" => Kind::Oil,
                        "M_Yolk" => Kind::Yolk,
                        "M_Fire" => Kind::Fire,
                        "M_Shell" => Kind::Shell,
                        "M_Ground" => Kind::Ground,
                        _ => Kind::Iron,
                    }
                };
                let tex = pr.image.map(|i| {
                    textures
                        .entry(i)
                        .or_insert_with(|| {
                            let im = &asset.images[i];
                            gfx::texture(&gl, im.w as i32, im.h as i32, &im.rgba)
                        })
                        .clone()
                });
                let half = pr.pos.iter().fold(0f32, |a, v| a.max(v[0].abs()));
                out.push(Prim { mesh, kind, tex, half });
            }
            meshes.push(out);
        }
        let mut names = HashMap::new();
        let mut nodes: Vec<Node> = Vec::new();
        for (i, n) in asset.nodes.iter().enumerate() {
            names.insert(n.name.clone(), i);
            nodes.push(Node {
                parent: n.parent,
                bt: n.t,
                br: n.r,
                bs: n.s,
                t: n.t,
                r: n.r,
                s: n.s,
                mesh: n.mesh,
                world: Mat4::IDENTITY,
            });
        }
        let get = |n: &str| names.get(n).copied().ok_or_else(|| err(format!("missing node {n}")));
        let i_pan = get("Pan")?;
        let i_root = get("SpiritRoot")?;
        let i_body = get("SpiritBody")?;
        // the mound sits centred under the pan, its face peeking below the front rim
        nodes[i_body].bt = Vec3::new(0.0, 0.12, 0.0);
        nodes[i_body].t = nodes[i_body].bt;

        // quad: x -0.5..0.5, y 0..1
        let quad = gfx::mesh(
            &gl,
            &[
                (0, 3, &[-0.5, 0.0, 0.0, 0.5, 0.0, 0.0, 0.5, 1.0, 0.0, -0.5, 0.0, 0.0, 0.5, 1.0, 0.0, -0.5, 1.0, 0.0]),
                (2, 2, &[0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0]),
            ],
            None,
        );
        let empty = gl.create_vertex_array().ok_or("vao")?;
        // placeholders, replaced in build_effects once the scene is laid out
        let dummy = || points_mesh(&gl, &[0.0; 4], &[1.0; 4]);
        let (d1, d2, d3, d4) = (dummy(), dummy(), dummy(), dummy());
        let fire_box = box_mesh(&gl, FIRE_MIN, FIRE_MAX);
        let fxs = fx::Fx::new(&gl);
        let shell_mesh = names.get("EggShell").and_then(|&i| nodes[i].mesh);
        let noise = noise_texture(&gl);

        let mut app = App {
            gl,
            p,
            nodes,
            order: asset.order.clone(),
            meshes,
            names,
            quad,
            empty,
            embers: d1,
            burst: d2,
            sparks: d3,
            beads: d4,
            fire_box,
            noise,
            plumes: Vec::new(),
            food: Vec::new(),
            strips: [Vec4::ZERO; 3],
            strip_hl: Vec3::ZERO,
            strip_hw: Vec3::ZERO,
            bacon_phase: HashMap::new(),
            w: 1,
            h: 1,
            css_w: 1.0,
            css_h: 1.0,
            hdr,
            samples,
            rt: None,
            target: Vec3::new(0.0, 0.40, 0.14),
            radius: 5.6,
            theta: 0.0,
            phi: 0.95,
            d_theta: 0.0,
            d_phi: 0.0,
            fov: 32f32.to_radians(),
            pointers: Vec::new(),
            down_at: None,
            moved: 0.0,
            pinch: None,
            pointer_ndc: Vec2::ZERO,
            pointer_seen: -99.0,
            clock: 0.0,
            time: 0.0,
            reduced,
            rng: Rng(0x9E3779B9),
            next_blink: 1.8,
            blink_t: -1.0,
            double_blink: false,
            gaze: Vec2::new(-0.012, 0.006),
            gaze_target: Vec2::new(-0.012, 0.006),
            next_glance: 2.5,
            mumble_t: -99.0,
            next_mumble: 4.0,
            mumble_phase: 0.0,
            poke_t: -99.0,
            saute_t: -99.0,
            burst_at: -99.0,
            expr: Expr::content(),
            expr_goal: Expr::content(),
            expr_kind: 0,
            next_expr: 1.5,
            dart_t: 0.0,
            dart_side: 1.0,
            spin: 0.0,
            face_off: Vec2::ZERO,
            after_flip: Vec::new(),
            toss_dur: 1.35,
            toss_lift: 0.24,
            toss_tilt: 0.24,
            toss_push: 0.16,
            arms: [Arm::new(-1.0), Arm::new(1.0)],
            fx: fxs,
            snack_on: false,
            chomp_t: -99.0,
            chew_until: -99.0,
            last_jaw: 0.0,
            gulp_fired: false,
            refill_on: false,
            last_eat: -99.0,
            lean: Vec3::ZERO,
            shells: Vec::new(),
            shell_mesh,
            burst_offset: Vec3::ZERO,
            last_reaction: 0,
            forced_drops: 0,
            dizzy_amt: 0.0,
            flare: 0.0,
            happy: 0.0,
            lid: 1.0,
            mumble: 0.0,
            tossing: false,
            boost: 0.0,
            flicker: 1.0,
            i_pan,
            i_root,
            i_body,
        };
        app.update_world();
        app.build_effects(&asset);
        Ok(app)
    }

    pub fn resize(&mut self, w: i32, h: i32, css_w: f32, css_h: f32) {
        self.w = w.max(1);
        self.h = h.max(1);
        self.css_w = css_w.max(1.0);
        self.css_h = css_h.max(1.0);
        let aspect = self.w as f32 / self.h as f32;
        let base = 32f32.to_radians();
        self.fov = if aspect >= 1.0 { base } else { (2.0 * ((base * 0.5).tan() / aspect).atan()).min(75f32.to_radians()) };
        let gl = &self.gl;
        if let Some(rt) = self.rt.take() {
            rt.msaa.free(gl);
            for t in [&rt.scene, &rt.glow, &rt.half_a, &rt.half_b, &rt.q_a, &rt.q_b] {
                t.free(gl);
            }
        }
        let (w, h) = (self.w, self.h);
        self.rt = Some(Targets {
            msaa: Msaa::new(gl, w, h, self.samples, self.hdr),
            scene: Target::new(gl, w, h, self.hdr),
            glow: Target::new(gl, w, h, false),
            half_a: Target::new(gl, (w / 2).max(1), (h / 2).max(1), self.hdr),
            half_b: Target::new(gl, (w / 2).max(1), (h / 2).max(1), self.hdr),
            q_a: Target::new(gl, (w / 4).max(1), (h / 4).max(1), self.hdr),
            q_b: Target::new(gl, (w / 4).max(1), (h / 4).max(1), self.hdr),
        });
    }

    pub fn pointer_down(&mut self, id: i32, x: f32, y: f32, now: f64) {
        self.pointers.retain(|p| p.id != id);
        self.pointers.push(Pointer { id, x, y });
        if self.pointers.len() == 1 {
            self.down_at = Some((x, y, now));
            self.moved = 0.0;
        } else {
            self.down_at = None;
            self.pinch = Some(self.pinch_dist());
        }
        self.note_pointer(x, y);
    }

    pub fn pointer_move(&mut self, id: i32, x: f32, y: f32) {
        self.note_pointer(x, y);
        let Some(k) = self.pointers.iter().position(|p| p.id == id) else { return };
        let (px, py) = (self.pointers[k].x, self.pointers[k].y);
        self.pointers[k].x = x;
        self.pointers[k].y = y;
        if self.pointers.len() == 1 {
            let (dx, dy) = (x - px, y - py);
            self.moved += dx.abs() + dy.abs();
            let s = TAU / self.css_h * 0.75;
            self.d_theta -= dx * s;
            self.d_phi -= dy * s;
        } else {
            let d = self.pinch_dist();
            if let Some(p0) = self.pinch {
                if d > 1.0 && p0 > 1.0 {
                    self.radius = (self.radius * p0 / d).clamp(2.8, 9.0);
                }
            }
            self.pinch = Some(d);
        }
    }

    pub fn pointer_up(&mut self, id: i32, _x: f32, _y: f32, now: f64) {
        let single = self.pointers.len() == 1;
        self.pointers.retain(|p| p.id != id);
        if single {
            if let Some((_, _, t0)) = self.down_at.take() {
                if self.moved < 8.0 && now - t0 < 450.0 {
                    self.tap();
                }
            }
        }
        if self.pointers.len() < 2 {
            self.pinch = None;
        }
    }

    /// Testing aid (#snack in the URL): every flip sends `n` pieces to the flame hands.
    pub fn force_drops(&mut self, n: u32) {
        self.forced_drops = n.min(2) as usize;
    }

    /// Testing aid: empty the pan at once so the refill from the sky starts now.
    pub fn debug_refill(&mut self) {
        for f in &mut self.food {
            f.state = FState::Eaten;
        }
        self.snack_on = false;
        self.last_eat = self.clock - 2.0;
    }

    /// Debug readout of the choreography (arms, food, face) as JSON.
    pub fn debug_state(&self) -> String {
        let ph = |p: APhase| match p {
            APhase::Rest => "rest",
            APhase::Reach => "reach",
            APhase::Wait => "wait",
            APhase::Carry => "carry",
            APhase::Feed => "feed",
            APhase::Retract => "retract",
        };
        let fs = |s: FState| match s {
            FState::Pan => "pan",
            FState::Held => "held",
            FState::Eaten => "eaten",
            FState::Falling => "falling",
        };
        let arms: Vec<String> = self.arms.iter().map(|a| format!("\"{}:{:?}\"", ph(a.phase), a.item)).collect();
        let food: Vec<String> = self.food.iter().map(|f| format!("\"{}\"", fs(f.state))).collect();
        format!(
            "{{\"t\":{:.2},\"flip\":{:.2},\"arms\":[{}],\"food\":[{}],\"expr\":{},\"snack\":{},\"chomp\":{:.2},\"chew_until\":{:.2},\"refill\":{}}}",
            self.clock, self.saute_t, arms.join(","), food.join(","), self.expr_kind, self.snack_on, self.chomp_t, self.chew_until.min(9999.0), self.refill_on
        )
    }

    /// Testing aid: put the camera at an exact orbit position.
    pub fn debug_view(&mut self, theta: f32, phi: f32, radius: f32) {
        self.theta = theta;
        self.phi = phi.clamp(0.22, 1.38);
        self.radius = radius.clamp(2.8, 9.0);
        self.d_theta = 0.0;
        self.d_phi = 0.0;
    }

    pub fn wheel(&mut self, dy: f32) {
        self.radius = (self.radius * (1.0 + dy.clamp(-120.0, 120.0) * 0.0012)).clamp(2.8, 9.0);
    }

    pub fn frame(&mut self, dt: f32) {
        self.update(dt.clamp(0.0, 0.05));
        self.render();
    }
}

impl App {
    fn pinch_dist(&self) -> f32 {
        if self.pointers.len() < 2 {
            return 0.0;
        }
        let (a, b) = (&self.pointers[0], &self.pointers[1]);
        ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
    }

    fn note_pointer(&mut self, x: f32, y: f32) {
        self.pointer_ndc = Vec2::new(x / self.css_w * 2.0 - 1.0, -(y / self.css_h * 2.0 - 1.0));
        self.pointer_seen = self.clock;
    }

    fn tap(&mut self) {
        let t = self.clock;
        let busy = self.refill_on
            || self.snack_on
            || t - self.saute_t < self.toss_dur + 0.1
            || self.arms.iter().any(|a| a.phase != APhase::Rest)
            || !self.food.iter().any(|f| f.state == FState::Pan);
        if busy {
            return; // one thing at a time
        }
        self.saute_t = t;
        self.poke_t = t;
        self.burst_at = self.time;
        self.burst_offset = Vec3::ZERO;
        let xs: Vec<f32> = self.food.iter().map(|f| self.nodes[f.node].world.w_axis.x).collect();
        let rng = &mut self.rng;
        self.toss_dur = rng.range(1.2, 1.5);
        self.toss_lift = rng.range(0.17, 0.3);
        self.toss_tilt = rng.range(0.16, 0.3);
        self.toss_push = rng.range(0.09, 0.2);

        // sometimes one or two pieces fly off the pan and a flame hand snatches each one
        let mut pool: Vec<usize> = (0..self.food.len()).filter(|&k| self.food[k].state == FState::Pan).collect();
        let roll = rng.next();
        let want = if self.forced_drops > 0 { self.forced_drops } else if roll < 0.5 { 0 } else if roll < 0.85 { 1 } else { 2 };
        let mut drops = Vec::new();
        while drops.len() < want && !pool.is_empty() {
            let i = (rng.next() * pool.len() as f32) as usize % pool.len();
            drops.push(pool.swap_remove(i));
        }
        drops.sort_by(|&a, &b| xs[a].partial_cmp(&xs[b]).unwrap_or(std::cmp::Ordering::Equal));

        for f in self.food.iter_mut().filter(|f| f.state == FState::Pan) {
            f.drop = false;
            f.delay = rng.range(0.04, 0.28);
            f.dur = rng.range(0.5, 0.78);
            f.height = if f.is_egg { rng.range(0.45, 0.85) } else { rng.range(0.6, 1.15) };
            let a = rng.range(0.0, TAU);
            f.axis = Vec3::new(a.cos(), rng.range(-0.3, 0.3), a.sin()).normalize();
            let roll = rng.next();
            let turns = if f.is_egg {
                if roll < 0.3 { 0.0 } else { TAU }
            } else if roll < 0.15 {
                0.0
            } else if roll < 0.75 {
                TAU
            } else {
                2.0 * TAU
            };
            f.turns = if rng.next() < 0.5 { turns } else { -turns };
            f.yaw = if rng.next() < 0.25 { if rng.next() < 0.5 { TAU } else { -TAU } } else { 0.0 };
            f.wobble = rng.range(-0.35, 0.35);
            let (da, dl) = (rng.range(0.0, TAU), rng.range(0.0, 0.18));
            f.drift = Vec3::new(da.cos() * dl, 0.0, da.sin() * dl);
        }
        for (i, &k) in drops.iter().enumerate() {
            let arm = if drops.len() == 2 { i } else if xs[k] < 0.15 { 0 } else { 1 };
            let side = if arm == 0 { -1.0 } else { 1.0 };
            let f = &mut self.food[k];
            f.drop = true;
            f.arm = arm;
            f.catch_pt = Vec3::new(side * rng.range(1.45, 1.6), rng.range(0.62, 0.78), rng.range(0.95, 1.12));
            f.delay = rng.range(0.05, 0.12);
            f.dur = rng.range(0.74, 0.9);
            f.height = rng.range(0.4, 0.7);
            self.arms[arm].item = Some(k);
            self.arms[arm].reach_at = t + f.delay + f.dur - REACH_T;
        }

        // face: surprised in the air, then either a snack or a dizzy/confused landing
        self.set_expr(3);
        if drops.is_empty() {
            self.next_expr = t + 1.3;
            let repeat = self.rng.next() < 0.35;
            let reaction = match (self.last_reaction, repeat) {
                (2, false) | (1, true) => 1,
                (1, false) | (2, true) => 2,
                _ => if self.rng.next() < 0.5 { 2 } else { 1 },
            };
            self.last_reaction = reaction;
            self.after_flip = vec![(reaction, self.rng.range(3.0, 4.2))];
        } else {
            self.snack_on = true;
            self.chomp_t = -99.0;
            self.chew_until = f32::MAX;
            self.gulp_fired = false;
            self.after_flip.clear();
            self.next_expr = t + 99.0;
        }
    }

    /// World position + rotation (+ scale factor) of a piece held by a flame hand.
    fn held_pose(&self, k: usize, mouth: Vec3) -> (Vec3, Quat, f32) {
        let f = &self.food[k];
        let arm = &self.arms[f.arm];
        let x = -FACE_F;
        let y = (Vec3::Y - x * Vec3::Y.dot(x)).normalize();
        let feed_rot = Quat::from_mat3(&Mat3::from_cols(x, y, x.cross(y)));
        let u = ((self.clock - arm.t0) / arm.dur).clamp(0.0, 1.0);
        let grip_at = arm.hand + arm.d * 0.17 + Vec3::Y * 0.02;
        match arm.phase {
            APhase::Carry => (grip_at, f.hold_rot.slerp(feed_rot, ease_io(u)), 1.0),
            APhase::Feed => (mouth + FACE_F * (0.16 - 0.8 * ease_io(u)), feed_rot, 1.0 - 0.15 * u),
            _ => (grip_at, f.hold_rot, 1.0),
        }
    }

    /// The food the eyes should follow (whatever a hand is going for or holding).
    fn tracked_food(&self) -> Option<Vec3> {
        self.arms.iter().filter_map(|a| a.item).map(|k| self.nodes[self.food[k].node].world.w_axis.truncate()).next()
    }

    fn gaze_at(&self, p: Vec3) -> (Vec2, Vec2) {
        let body = &self.nodes[self.i_body];
        let ql = (p - body.world.transform_point3(Vec3::ZERO)) / (body.s / body.bs);
        let fq = Vec2::new(ql.x, ql.dot(FACE_U));
        ((fq - EYE_L).normalize_or_zero() * 0.03, (fq - EYE_R).normalize_or_zero() * 0.03)
    }

    /// Advance both flame arms through reach -> grab -> carry -> feed -> retract.
    fn step_arms(&mut self, t: f32, mouth: Vec3, body_c: Vec3, squash: Vec3) {
        for a in 0..2 {
            let other = self.arms[1 - a].phase;
            let other_has_item = self.arms[1 - a].item.is_some();
            let side = self.arms[a].side;
            let shoulder = body_c + Vec3::new(side * 0.9, -0.05, 0.34) * squash;
            let rest = body_c + Vec3::new(side * 1.0, -0.12, 0.5) * squash;
            let mouth_front = mouth + FACE_F * 0.26 + Vec3::new(side * 0.06, 0.0, 0.0);
            let item = self.arms[a].item;
            let held = item.map(|k| self.food[k].state == FState::Held).unwrap_or(false);
            let catch = item.map(|k| self.food[k].catch_pt).unwrap_or(rest);
            let arm = &mut self.arms[a];
            let u = ((t - arm.t0) / arm.dur).clamp(0.0, 1.0);
            match arm.phase {
                APhase::Rest => {
                    arm.hand = rest;
                    arm.ext = 0.0;
                    arm.grip = 0.0;
                    if item.is_some() && t >= arm.reach_at {
                        arm.go(APhase::Reach, t, REACH_T, catch);
                    }
                }
                APhase::Reach => {
                    arm.hand = arm.from.lerp(arm.to, ease_out(u));
                    arm.ext = smooth(0.0, 0.35, u);
                    arm.grip = 0.0;
                    if u >= 1.0 && held {
                        let to = arm.to;
                        arm.go(APhase::Wait, t, 1.0, to);
                    }
                }
                APhase::Wait => {
                    arm.hand = arm.to + Vec3::Y * 0.015 * ((t - arm.t0) * 9.0).sin();
                    arm.ext = 1.0;
                    arm.grip = ((t - arm.t0) / 0.14).min(1.0);
                    let mouth_busy = matches!(other, APhase::Carry | APhase::Feed) || (a == 1 && other == APhase::Wait);
                    if t - arm.t0 > 0.18 && !mouth_busy {
                        arm.go(APhase::Carry, t, CARRY_T, mouth_front);
                    }
                }
                APhase::Carry => {
                    arm.hand = arm.from.lerp(arm.to, ease_io(u)) + Vec3::Y * 0.14 * (PI * u).sin();
                    arm.ext = 1.0;
                    arm.grip = 1.0;
                    if u >= 1.0 {
                        arm.go(APhase::Feed, t, FEED_T, mouth + FACE_F * 0.05);
                    }
                }
                APhase::Feed => {
                    arm.hand = arm.from.lerp(arm.to, ease_io(u));
                    arm.ext = 1.0;
                    arm.grip = 1.0;
                    if u >= 1.0 {
                        if let Some(k) = item {
                            self.food[k].state = FState::Eaten;
                        }
                        self.last_eat = t;
                        arm.item = None;
                        arm.go(APhase::Retract, t, RETRACT_T, rest);
                        if !other_has_item {
                            // CHOMP
                            self.chomp_t = t;
                            self.chew_until = t + CHEW_T;
                            self.fx.crumbs(mouth + FACE_F * 0.06, FACE_F, 10);
                            self.fx.sparks(mouth + FACE_F * 0.05, 10, 1.1);
                        }
                    }
                }
                APhase::Retract => {
                    arm.hand = arm.from.lerp(rest, ease_io(u));
                    arm.ext = 1.0 - smooth(0.45, 1.0, u);
                    arm.grip = 0.0;
                    if u >= 1.0 {
                        arm.phase = APhase::Rest;
                    }
                }
            }
            // pose for the shader: shoulder -> elbow bulge -> hand, plus a frame for the fingers
            arm.s = shoulder;
            arm.c = (shoulder + arm.hand) * 0.5 + Vec3::new(side * 0.32, 0.18, 0.08);
            let fore = (arm.hand - bez(arm.s, arm.c, arm.hand, 0.8)).normalize_or(Vec3::new(side, 0.0, 0.0));
            arm.d = fore;
            arm.p = fore.cross(Vec3::Y).normalize_or(Vec3::Z);
            arm.q = arm.p.cross(fore).normalize_or(Vec3::Y);
        }
    }

    /// Where the painted mouth sits on the flame body, in world space (the snack's target).
    fn mouth_world(&self) -> Vec3 {
        let body = &self.nodes[self.i_body];
        let squash = body.s / body.bs;
        let a = Vec3::X * MOUTH.x + FACE_U * MOUTH.y;
        let (fr, ar) = (FACE_F / BODY_RAD, a / BODY_RAD);
        let (qa, qb, qc) = (fr.dot(fr), 2.0 * ar.dot(fr), ar.dot(ar) - 1.0);
        let sdist = (-qb + (qb * qb - 4.0 * qa * qc).max(0.0).sqrt()) / (2.0 * qa);
        body.world.transform_point3(Vec3::ZERO) + (a + FACE_F * (sdist + 0.03)) * squash
    }

    fn set_expr(&mut self, kind: u8) {
        self.expr_kind = kind;
        let s = if self.rng.next() < 0.5 { 1.0 } else { -1.0 };
        self.dart_side = s;
        self.expr_goal = match kind {
            1 => Expr::confused(s, &mut self.rng),
            2 => Expr::dizzy(),
            3 => Expr::surprised(),
            4 => Expr::happy(),
            5 => Expr::sleepy(),
            6 => Expr::gobble(),
            7 => Expr::chew(),
            _ => Expr::content(),
        };
    }

    fn node(&self, n: &str) -> usize {
        self.names[n]
    }

    fn local(&self, i: usize) -> Mat4 {
        let n = &self.nodes[i];
        Mat4::from_scale_rotation_translation(n.s, n.r, n.t)
    }

    fn update_world(&mut self) {
        for k in 0..self.order.len() {
            let i = self.order[k];
            let l = self.local(i);
            self.nodes[i].world = match self.nodes[i].parent {
                Some(p) => self.nodes[p].world * l,
                None => l,
            };
        }
    }

    /// Flames, steam, sparks, beads and the foam map — all laid out once from the loaded scene.
    fn build_effects(&mut self, asset: &assets::Asset) {
        let pan_inv = self.nodes[self.i_pan].world.inverse();
        let mut rng = Rng(0x2545F491);

        // steam columns rising off the food
        for (i, (x, z, w, h)) in [(-0.28, -0.36, 1.2, 1.8), (0.36, -0.08, 1.1, 1.6), (0.06, 0.28, 1.1, 1.7)]
            .into_iter()
            .enumerate()
        {
            self.plumes.push(Plume { pos: Vec3::new(x, 0.68, z), w, h, seed: i as f32 * 1.7 + 0.3 });
        }

        // sauté: everything that flips (bacon strips and four separate eggs)
        for n in ["Bacon1", "Bacon2", "Bacon3", "Egg1", "Egg2", "Egg3", "Egg4"] {
            let node = self.node(n);
            self.food.push(Food::new(node, n.starts_with("Egg")));
        }
        let _ = &mut rng;

        // bacon strips as boxes in the oil disc's space (for foam hugging the bacon), bead spots on top of them
        let oil_inv = self.nodes[self.node("PanOil")].world.inverse();
        let mut beads_a = Vec::new();
        let mut beads_b = Vec::new();
        for (k, n) in ["Bacon1", "Bacon2", "Bacon3"].iter().enumerate() {
            let bi = self.node(n);
            self.bacon_phase.insert(bi, [0.4, 1.9, 3.3][k]);
            let to_oil = oil_inv * self.nodes[bi].world;
            let c = to_oil.transform_point3(Vec3::ZERO);
            let d = to_oil.transform_vector3(Vec3::X);
            let mi = self.nodes[bi].mesh.unwrap_or(0);
            let prim = &asset.meshes[mi][0];
            let hl = prim.pos.iter().fold(0f32, |a, v| a.max(v[0].abs())) * d.length();
            let hw = prim.pos.iter().fold(0f32, |a, v| a.max(v[2].abs())) * to_oil.transform_vector3(Vec3::Z).length();
            let dir = Vec2::new(d.x, d.z).normalize();
            self.strips[k] = Vec4::new(c.x, c.z, dir.x, dir.y);
            self.strip_hl[k] = hl;
            self.strip_hw[k] = hw;
            let to_pan = pan_inv * self.nodes[bi].world;
            let tops: Vec<usize> = (0..prim.pos.len()).filter(|&j| prim.nrm[j][1] > 0.6).collect();
            for _ in 0..16 {
                if tops.is_empty() {
                    break;
                }
                let j = tops[(rng.next() * tops.len() as f32) as usize % tops.len()];
                let pp = to_pan.transform_point3(Vec3::from(prim.pos[j])) + Vec3::Y * 0.01;
                beads_a.extend_from_slice(&[pp.x, pp.y, pp.z, rng.next()]);
                beads_b.extend_from_slice(&[rng.range(0.5, 1.3), rng.range(0.022, 0.04), 0.0, 0.0]);
            }
        }
        self.beads = points_mesh(&self.gl, &beads_a, &beads_b);

        // oil sparks hopping out of the pan (pan-local)
        let (mut a, mut b) = (Vec::new(), Vec::new());
        for _ in 0..40 {
            let ang = rng.range(0.0, TAU);
            let r = rng.range(0.1, 0.8);
            a.extend_from_slice(&[ang.cos() * r, rng.range(0.05, 0.1), ang.sin() * r, rng.next()]);
            b.extend_from_slice(&[rng.range(0.9, 2.6), rng.range(0.12, 0.4), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)]);
        }
        self.sparks = points_mesh(&self.gl, &a, &b);

        // embers drifting off the flames (world)
        let (mut a, mut b) = (Vec::new(), Vec::new());
        for _ in 0..40 {
            let ang = rng.range(0.0, TAU);
            let r = rng.range(1.0, 1.3);
            a.extend_from_slice(&[ang.cos() * r, rng.range(0.4, 0.9), ang.sin() * r * 0.9, rng.next()]);
            b.extend_from_slice(&[rng.range(0.3, 0.6), rng.range(1.2, 2.4), rng.range(0.0, TAU), 0.0]);
        }
        self.embers = points_mesh(&self.gl, &a, &b);

        // poke burst (world, from the spirit's face)
        let (mut a, mut b) = (Vec::new(), Vec::new());
        for _ in 0..70 {
            let ang = rng.range(0.0, TAU);
            a.extend_from_slice(&[ang.cos() * 0.25, 0.25, 0.75 + ang.sin() * 0.1, 0.0]);
            b.extend_from_slice(&[rng.next(), rng.range(0.5, 2.8), rng.range(0.0, TAU), 0.0]);
        }
        self.burst = points_mesh(&self.gl, &a, &b);
    }

    fn update(&mut self, dt: f32) {
        self.clock += dt;
        self.time += if self.reduced { dt * 0.35 } else { dt };
        let (t, tt) = (self.clock, self.time);

        // orbit damping
        let damp = 1.0 - (1.0f32 - 0.12).powf(dt * 60.0);
        self.theta += self.d_theta * damp;
        self.phi = (self.phi + self.d_phi * damp).clamp(0.22, 1.38);
        self.d_theta *= 1.0 - damp;
        self.d_phi *= 1.0 - damp;

        // poke: flare + happy face
        let pk = t - self.poke_t;
        self.flare = if (0.0..1.6).contains(&pk) { (pk / 1.6 * PI).sin() * (1.0 - pk / 1.6 * 0.4) } else { 0.0 };
        self.happy = 0.0;

        // snack choreography that drives the body: CHOMP, big chews, a gulp
        let ct = t - self.chomp_t;
        let snack_active = self.snack_on && self.chomp_t > self.saute_t;
        let jaw = if snack_active && ct > 0.14 && ct < CHEW_T - 0.5 { ((ct - 0.14) * TAU * 1.9).sin().max(0.0).powf(0.7) } else { 0.0 };
        let chomp_imp = if snack_active && ct < 0.25 { 1.0 - ct / 0.25 } else { 0.0 };
        let gulp = if snack_active && ct > CHEW_T - 0.5 && ct < CHEW_T { ((ct - (CHEW_T - 0.5)) / 0.5 * PI).sin() } else { 0.0 };
        self.flare = self.flare.max(0.22 * jaw).max(0.7 * chomp_imp).max(gulp);

        // breathing (+ dizzy wobble, chewing, and a lean toward whichever hand is busy)
        let br = (tt * 2.1).sin();
        let root = self.i_root;
        let wob = (tt * 4.4).sin() * self.dizzy_amt;
        let lean_goal = self
            .arms
            .iter()
            .filter(|a| matches!(a.phase, APhase::Reach | APhase::Wait | APhase::Carry))
            .map(|a| Vec3::new(a.side * 0.05, 0.03, 0.05))
            .fold(Vec3::ZERO, |a, b| a + b);
        self.lean = self.lean.lerp(lean_goal, 1.0 - 0.02f32.powf(dt));
        self.nodes[root].t = self.nodes[root].bt
            + Vec3::Y * (0.018 * br + self.flare * 0.04)
            + Vec3::X * (0.03 * (t * 2.3).sin() * self.dizzy_amt)
            + self.lean;
        let bb = self.i_body;
        let bs = self.nodes[bb].bs;
        self.nodes[bb].s = bs
            * Vec3::new(
                1.0 - 0.015 * br + 0.03 * self.flare + 0.035 * wob + 0.06 * jaw + 0.08 * chomp_imp - 0.03 * gulp,
                1.0 + 0.05 * br + 0.06 * self.flare - 0.035 * wob - 0.09 * jaw - 0.14 * chomp_imp + 0.1 * gulp,
                1.0 - 0.012 * br,
            );

        // blinks (sometimes twice)
        if t > self.next_blink && self.blink_t < 0.0 {
            self.blink_t = 0.0;
            self.double_blink = self.rng.next() < 0.3;
        }
        self.lid = 1.0;
        if self.blink_t >= 0.0 {
            self.blink_t += dt;
            let dur = 0.17;
            let total = if self.double_blink { 0.48 } else { dur };
            let local = if self.double_blink && self.blink_t > 0.31 { self.blink_t - 0.31 } else { self.blink_t };
            if local < dur {
                self.lid = ((local / dur) * PI).cos().abs();
            }
            if self.blink_t > total {
                self.blink_t = -1.0;
                self.next_blink = t + self.rng.range(2.2, 5.5);
            }
        }

        // gaze: follows the pointer when it moves, otherwise glances about (the default look is off to the left)
        if t - self.pointer_seen < 2.5 {
            self.gaze_target = Vec2::new(self.pointer_ndc.x * 0.03, self.pointer_ndc.y * 0.02);
        } else if t > self.next_glance {
            let opts = [(-0.014, 0.006), (-0.014, 0.006), (0.0, 0.0), (0.016, 0.008), (-0.02, 0.016), (0.01, -0.01)];
            let o = opts[(self.rng.next() * opts.len() as f32) as usize % opts.len()];
            self.gaze_target = Vec2::new(o.0, o.1);
            self.next_glance = t + self.rng.range(1.2, 3.2);
        }
        let g = 1.0 - 0.0015f32.powf(dt);
        self.gaze = self.gaze.lerp(self.gaze_target, g);

        // mumbling (the mouth wobbles as if grumbling to itself)
        if t > self.next_mumble && t - self.mumble_t > 1.4 {
            self.mumble_t = t;
            self.next_mumble = t + self.rng.range(4.0, 9.0);
        }
        let mk = t - self.mumble_t;
        self.mumble = if (0.0..1.3).contains(&mk) { (mk / 1.3 * PI).sin() } else { 0.0 };
        self.mumble_phase += dt * (1.2 + 9.0 * self.mumble + 6.0 * self.expr.zig);

        // ---- faces: snack sequence first, then the random idle moods
        let mouth = self.mouth_world();
        if self.snack_on {
            let busy = self.arms.iter().any(|a| matches!(a.phase, APhase::Reach | APhase::Wait | APhase::Carry | APhase::Feed));
            if self.chomp_t > self.saute_t {
                if t >= self.chew_until {
                    self.snack_on = false;
                    self.set_expr(4);
                    self.next_expr = t + 1.6;
                } else if self.expr_kind != 7 {
                    self.set_expr(7);
                }
            } else if busy && self.expr_kind != 6 {
                self.set_expr(6);
            }
        }
        if t > self.next_expr && !self.snack_on && !self.refill_on {
            let (kind, dur) = match self.after_flip.pop() {
                Some(next) => next,
                None => {
                    let r = self.rng.next();
                    let k = if r < 0.5 { 0 } else if r < 0.7 { 4 } else if r < 0.88 { 5 } else { 3 };
                    let k = if k == self.expr_kind && k != 0 { 0 } else { k };
                    (k, if k == 0 { self.rng.range(3.0, 6.0) } else { self.rng.range(2.4, 4.2) })
                }
            };
            self.set_expr(kind);
            self.next_expr = t + dur;
        }
        let mut goal = self.expr_goal;
        match self.expr_kind {
            1 => {
                // confused: pupils dart from side to side
                if t > self.dart_t {
                    self.dart_side = -self.dart_side;
                    self.dart_t = t + self.rng.range(0.55, 1.2);
                }
                goal.gaze_l = Vec2::new(0.02 * self.dart_side, 0.018);
                goal.gaze_r = goal.gaze_l;
            }
            2 => goal.tilt = 0.24 * (t * 2.3).sin(),
            6 => {
                // eyes locked on the food as the hand brings it in
                if let Some(p) = self.tracked_food() {
                    let (gl, gr) = self.gaze_at(p);
                    goal.gaze_l = gl;
                    goal.gaze_r = gr;
                }
            }
            7 => {}
            _ => {
                let gz = if self.refill_on { Vec2::new(0.0, 0.026) } else { self.gaze };
                goal.gaze_l = gz;
                goal.gaze_r = gz;
            }
        }
        let k = 1.0 - 0.002f32.powf(dt);
        self.expr = self.expr.lerp(&goal, k);
        if self.expr_kind == 7 {
            // big, readable chews: the jaw drives the mouth directly
            self.expr.open = 0.04 + 0.85 * jaw;
            self.expr.mouth_w = 0.9 + 0.22 * jaw;
            self.expr.mouth_tilt = 0.14 * (ct * TAU * 0.95).sin();
            self.expr.happy = 1.0;
        }
        self.dizzy_amt = self.expr.spiral;
        self.spin += dt * 7.0 * (0.3 + self.dizzy_amt);
        self.face_off = Vec2::new(0.025 * (t * 2.3 + 1.2).sin(), 0.012 * (t * 4.6).sin()) * self.dizzy_amt + Vec2::new(0.0, -0.022 * jaw);
        if jaw >= 0.85 && self.last_jaw < 0.85 {
            self.fx.crumbs(mouth + FACE_F * 0.06, FACE_F, 6);
        }
        self.last_jaw = jaw;
        if gulp > 0.0 && !self.gulp_fired {
            self.gulp_fired = true;
            let top = self.nodes[self.i_body].world.transform_point3(Vec3::ZERO) + Vec3::new(0.0, 0.42, 0.55);
            self.fx.sparks(top, 18, 1.6);
        }

        self.flicker = 1.0 + 0.08 * (tt * 13.0).sin() + 0.06 * (tt * 5.3 + 1.0).sin() + 0.5 * self.flare;

        // ---- sauté toss (every flip rolls its own strength, timing and item flights)
        let tf = t - self.saute_t;
        let su = tf / self.toss_dur;
        self.tossing = (0.0..1.0).contains(&su);
        self.boost = if (0.8..2.6).contains(&su) { 1.0 - (su - 0.8) / 1.8 } else { 0.0 };
        let pan = self.i_pan;
        let handle = Vec3::new(-0.94, 0.0, 0.34);
        let axis = Vec3::new(0.34, 0.0, 0.94);
        {
            let (lift, tilt, push) = (self.toss_lift, self.toss_tilt, self.toss_push);
            let n = &mut self.nodes[pan];
            if self.tossing {
                let damp = 1.0 - su;
                n.t = n.bt - handle * push * (TAU * su).sin() * damp + Vec3::Y * lift * (PI * su).sin() * (1.0 - 0.3 * su);
                n.r = Quat::from_axis_angle(axis, tilt * (TAU * su).sin() * damp) * n.br;
            } else {
                n.t = n.bt;
                n.r = n.br;
            }
        }
        let pan_w = Mat4::from_scale_rotation_translation(self.nodes[pan].s, self.nodes[pan].r, self.nodes[pan].t);
        let pan_inv = pan_w.inverse();
        let pan_r = self.nodes[pan].r;
        let body_c = self.nodes[self.i_body].world.transform_point3(Vec3::ZERO);
        let squash = self.nodes[self.i_body].s / self.nodes[self.i_body].bs;
        self.step_arms(t, mouth, body_c, squash);
        self.fx.update(dt);

        // ---- every piece of food: in the pan, flying to a hand, held, eaten, or falling from the sky
        self.shells.clear();
        for k in 0..self.food.len() {
            let f = self.food[k];
            let ni = f.node;
            let (bt, br, bs) = (self.nodes[ni].bt, self.nodes[ni].br, self.nodes[ni].bs);
            let kk = if tf >= 0.0 { (tf - f.delay) / f.dur } else { -1.0 };
            let mut world: Option<(Vec3, Quat, Vec3)> = None;
            match f.state {
                FState::Eaten => {
                    let n = &mut self.nodes[ni];
                    n.t = bt;
                    n.r = br;
                    n.s = Vec3::ZERO;
                }
                FState::Held => {
                    let (p, r, sc) = self.held_pose(k, mouth);
                    world = Some((p, r, bs * sc));
                }
                FState::Falling => {
                    let tau = t - f.fall_t0;
                    let g = if f.is_egg { 9.0 } else { 4.0 };
                    let t_fall = (2.0 * f.fall_h / g).sqrt();
                    let n = &mut self.nodes[ni];
                    n.t = bt;
                    n.r = br;
                    if tau < 0.0 {
                        n.s = Vec3::ZERO;
                    } else if tau < t_fall {
                        let y = f.fall_h - 0.5 * g * tau * tau;
                        let w = 1.0 - tau / t_fall;
                        let off = f.fall_off * w * w;
                        if f.is_egg {
                            // a raw egg in its shell, tumbling down
                            n.s = Vec3::ZERO;
                            let rot = Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.5).normalize(), tau * 5.0 + f.fall_ph);
                            self.shells.push(pan_w * Mat4::from_rotation_translation(rot, bt + Vec3::Y * (y + 0.09) + off));
                        } else {
                            // bacon flutters as it drops
                            n.t = bt + Vec3::Y * y + off;
                            n.r = br * Quat::from_rotation_y(0.7 * w * (tau * 2.3 + f.fall_ph).sin()) * Quat::from_rotation_x(0.9 * w * (tau * 7.0 + f.fall_ph).sin());
                            n.s = bs;
                        }
                    } else {
                        n.s = bs;
                        let at = pan_w.transform_point3(bt + Vec3::Y * 0.06);
                        let food = &mut self.food[k];
                        food.state = FState::Pan;
                        food.land_t = t;
                        food.cracked = food.is_egg;
                        if food.is_egg {
                            self.fx.shell_bits(at);
                            self.fx.splash(at, 10);
                        } else {
                            self.fx.splash(at, 14);
                        }
                    }
                }
                FState::Pan => {
                    if f.drop && kk > 0.0 {
                        // flung off the pan toward a waiting flame hand
                        let v = kk.min(1.0);
                        let p0 = pan_w.transform_point3(bt);
                        let ctrl = (p0 + f.catch_pt) * 0.5 + Vec3::Y * (f.height + 0.35);
                        let wr = pan_r * br * Quat::from_axis_angle(f.axis, f.turns * ease_io(v));
                        world = Some((bez(p0, ctrl, f.catch_pt, v), wr, bs));
                        if v >= 1.0 {
                            let food = &mut self.food[k];
                            food.state = FState::Held;
                            food.hold_rot = wr;
                            food.drop = false;
                        }
                    } else {
                        let n = &mut self.nodes[ni];
                        if !f.drop && kk > 0.0 && kk < 1.0 {
                            let ee = ease_io(kk);
                            let arc = (PI * kk).sin();
                            n.t = bt + Vec3::Y * f.height * 4.0 * kk * (1.0 - kk) + f.drift * arc;
                            n.r = br * Quat::from_rotation_y(f.yaw * ee + f.wobble * arc) * Quat::from_axis_angle(f.axis, f.turns * ee);
                            n.s = bs;
                        } else {
                            n.t = bt;
                            n.r = br;
                            let mut sc = bs;
                            let land = if kk >= 1.0 { (kk - 1.0) * f.dur / 0.18 } else { 2.0 };
                            if land < 1.0 {
                                let q = (PI * land).sin();
                                sc = bs * Vec3::new(1.0 + 0.07 * q, 1.0 - 0.14 * q, 1.0 + 0.07 * q);
                            }
                            let lt = t - f.land_t;
                            if f.is_egg && f.cracked && lt < 0.55 {
                                // cracked open: the egg spreads out into the pan
                                let u = lt / 0.55;
                                let e = ease_out_back(u);
                                sc = bs * Vec3::new(0.25 + 0.75 * e, 1.8 - 0.8 * ease_out(u), 0.25 + 0.75 * e);
                            } else if !f.is_egg && lt < 0.3 {
                                let q = (PI * lt / 0.3).sin();
                                sc = bs * Vec3::new(1.0 + 0.1 * q, 1.0 - 0.25 * q, 1.0 + 0.1 * q);
                            }
                            n.s = sc;
                        }
                    }
                }
            }
            if let Some((p, r, sc)) = world {
                let (ls, lr, lt) = (pan_inv * Mat4::from_scale_rotation_translation(sc, r, p)).to_scale_rotation_translation();
                let n = &mut self.nodes[ni];
                n.t = lt;
                n.r = lr;
                n.s = ls;
            }
        }

        // ---- he ate everything: after a beat, breakfast rains down from above
        if !self.refill_on
            && !self.snack_on
            && self.food.iter().all(|f| f.state == FState::Eaten)
            && self.arms.iter().all(|a| a.phase == APhase::Rest)
            && t > self.last_eat + 1.4
        {
            self.refill_on = true;
            let mut order: Vec<usize> = (0..self.food.len()).collect();
            for i in (1..order.len()).rev() {
                let j = (self.rng.next() * (i + 1) as f32) as usize % (i + 1);
                order.swap(i, j);
            }
            for (i, &k) in order.iter().enumerate() {
                let rng = &mut self.rng;
                let f = &mut self.food[k];
                f.state = FState::Falling;
                f.fall_t0 = t + 0.5 + i as f32 * 0.34 + rng.range(0.0, 0.1);
                f.fall_h = rng.range(2.8, 3.4);
                let (a, l) = (rng.range(0.0, TAU), rng.range(0.1, 0.35));
                f.fall_off = Vec3::new(a.cos() * l, 0.0, a.sin() * l);
                f.fall_ph = rng.range(0.0, TAU);
                f.cracked = false;
                f.drop = false;
            }
            self.set_expr(3);
            self.next_expr = t + 99.0;
            self.after_flip.clear();
        }
        if self.refill_on
            && self.food.iter().all(|f| f.state == FState::Pan)
            && t > self.food.iter().map(|f| f.land_t).fold(0.0f32, f32::max) + 0.7
        {
            self.refill_on = false;
            self.set_expr(4);
            self.next_expr = t + 1.8;
        }
        // yolks jiggle
        for i in 1..=4 {
            if let Some(&yi) = self.names.get(&format!("Egg{i}_Yolk")) {
                let j = (tt * 6.3 + i as f32 * 1.7).sin() * 0.03 * (1.0 + 2.0 * self.boost);
                let bs = self.nodes[yi].bs;
                self.nodes[yi].s = bs * Vec3::new(1.0 - j * 0.5, 1.0 + j, 1.0 - j * 0.5);
            }
        }
        self.update_world();
    }

    fn camera(&self) -> (Mat4, Mat4, Vec3) {
        let eye = self.target
            + self.radius * Vec3::new(self.phi.sin() * self.theta.sin(), self.phi.cos(), self.phi.sin() * self.theta.cos());
        let view = Mat4::look_at_rh(eye, self.target, Vec3::Y);
        let proj = Mat4::perspective_rh_gl(self.fov, self.w as f32 / self.h as f32, 0.05, 60.0);
        (view, proj, eye)
    }

    fn lights(&self, u: &gfx::U, cam: Vec3) {
        let fire = srgb(0xff7a2a) * 1.35 * self.flicker.min(1.25);
        u.v3("uKeyDir", Vec3::new(-0.45, 1.0, 0.5).normalize())
            .v3("uKeyCol", srgb(0xfff1df) * 0.86)
            .v3("uAmbTop", srgb(0x8f8078) * 0.42)
            .v3("uAmbBot", srgb(0x6a4030) * 0.45)
            .v3("uFirePos", Vec3::new(0.0, 0.12, 0.35))
            .v3("uFireCol", fire)
            .f("uFireRange", 3.6)
            .v3("uCam", cam)
            .v3("uFogCol", srgb(0x3b2a20))
            .v2("uFog", Vec2::new(6.5, 15.0));
    }

    fn render(&mut self) {
        let Some(rt) = &self.rt else { return };
        let gl = &self.gl;
        let (view, proj, cam) = self.camera();
        let vp = proj * view;
        let right = Vec3::new(view.x_axis.x, view.y_axis.x, view.z_axis.x);
        let res = Vec2::new(self.w as f32, self.h as f32);
        let dpr = self.w as f32 / self.css_w;
        let tt = self.time;

        gl.bind_framebuffer(GL::FRAMEBUFFER, Some(&rt.msaa.fb));
        gl.viewport(0, 0, self.w, self.h);
        let bg = srgb(0x3b2a20);
        gl.depth_mask(true);
        gl.clear_bufferfv_with_f32_array(GL::COLOR, 0, &[bg.x, bg.y, bg.z, 1.0]);
        gl.clear_bufferfv_with_f32_array(GL::COLOR, 1, &[0.0, 0.0, 0.0, 0.0]);
        gl.clear(GL::DEPTH_BUFFER_BIT);
        gl.enable(GL::DEPTH_TEST);
        gl.depth_func(GL::LEQUAL);
        gl.disable(GL::BLEND);
        gl.enable(GL::CULL_FACE);
        gl.cull_face(GL::BACK);

        // ---- opaque pass
        for &ni in &self.order {
            let Some(mi) = self.nodes[ni].mesh else { continue };
            let model = self.nodes[ni].world;
            let nrm = Mat3::from_mat4(model).inverse().transpose();
            for prim in &self.meshes[mi] {
                match prim.kind {
                    Kind::Fire | Kind::Shell => {}
                    Kind::Ground => {
                        let u = self.p.ground.bind(gl);
                        self.lights(&u, cam);
                        u.m4("uModel", &model)
                            .m4("uViewProj", &vp)
                            .m3("uNrmMat", &nrm)
                            .v4("uDeform", Vec4::ZERO)
                            .f("uTime", tt)
                            .f("uFlare", self.flare)
                            .f("uFlicker", self.flicker);
                        prim.mesh.draw(gl, GL::TRIANGLES);
                    }
                    Kind::Oil => {
                        let u = self.p.oil.bind(gl);
                        self.lights(&u, cam);
                        u.m4("uModel", &model)
                            .m4("uViewProj", &vp)
                            .m3("uNrmMat", &nrm)
                            .v4("uDeform", Vec4::ZERO)
                            .f("uTime", tt)
                            .v4("uS0", self.strips[0])
                            .v4("uS1", self.strips[1])
                            .v4("uS2", self.strips[2])
                            .v3("uHL", self.strip_hl)
                            .v3("uHW", self.strip_hw)
                            .f("uBoost", self.boost * 1.5);
                        prim.mesh.draw(gl, GL::TRIANGLES);
                    }
                    k => {
                        let u = self.p.cel.bind(gl);
                        self.lights(&u, cam);
                        u.m4("uModel", &model).m4("uViewProj", &vp).m3("uNrmMat", &nrm).f("uTime", tt);
                        let deform = if k == Kind::Bacon {
                            let curl = 0.5 + 0.5 * (tt * 1.6 + self.bacon_phase.get(&ni).copied().unwrap_or(0.0)).sin();
                            Vec4::new(1.0, prim.half, curl * (1.0 + self.boost), self.bacon_phase.get(&ni).copied().unwrap_or(0.0))
                        } else {
                            Vec4::ZERO
                        };
                        u.v4("uDeform", deform);
                        // base, shadow tint, spec (strength, threshold, softness), fire amount, rim, top gradient
                        let (base, shade, spec, fire, rim, top) = match k {
                            Kind::Iron => (srgb(0x2a292f), Vec3::new(0.5, 0.5, 0.56), Vec3::new(0.7, 0.978, 0.006), 1.25, 0.9, 0.0),
                            Kind::Bacon => (Vec3::new(1.0, 0.97, 0.96), Vec3::new(0.84, 0.64, 0.62), Vec3::new(0.5, 0.955, 0.02), 0.12, 0.0, 0.0),
                            Kind::Egg => (Vec3::ONE, Vec3::new(0.80, 0.82, 0.94), Vec3::new(0.42, 0.968, 0.014), 0.12, 0.0, 0.0),
                            Kind::Yolk => (srgb(0xf5bc58), Vec3::new(0.93, 0.62, 0.42), Vec3::new(0.9, 0.986, 0.006), 0.12, 0.0, 0.22),
                            _ => (Vec3::splat(0.5), Vec3::splat(0.6), Vec3::ZERO, 0.0, 0.0, 0.0),
                        };
                        u.v3("uBase", base).v3("uShade", shade).v3("uSpec", spec).f("uFireAmt", fire).f("uRim", rim).f("uTopGrad", top);
                        if let Some(tex) = &prim.tex {
                            gl.active_texture(GL::TEXTURE0);
                            gl.bind_texture(GL::TEXTURE_2D, Some(tex));
                            u.i("uTex", 0).f("uHasTex", 1.0);
                        } else {
                            u.f("uHasTex", 0.0);
                        }
                        prim.mesh.draw(gl, GL::TRIANGLES);
                    }
                }
            }
        }

        // ---- raw eggs falling in their shells (during a refill)
        if let (false, Some(mi)) = (self.shells.is_empty(), self.shell_mesh) {
            let u = self.p.cel.bind(gl);
            self.lights(&u, cam);
            u.m4("uViewProj", &vp)
                .f("uTime", tt)
                .v4("uDeform", Vec4::ZERO)
                .v3("uBase", srgb(0xf1e6cf))
                .v3("uShade", Vec3::new(0.78, 0.72, 0.7))
                .v3("uSpec", Vec3::new(0.35, 0.97, 0.01))
                .f("uFireAmt", 0.5)
                .f("uRim", 0.3)
                .f("uTopGrad", 0.0)
                .f("uHasTex", 0.0);
            for m in &self.shells {
                u.m4("uModel", m).m3("uNrmMat", &Mat3::from_mat4(*m).inverse().transpose());
                for prim in &self.meshes[mi] {
                    prim.mesh.draw(gl, GL::TRIANGLES);
                }
            }
            gl.cull_face(GL::FRONT);
            let h = self.p.hull.bind(gl);
            h.m4("uView", &view).m4("uProj", &proj).v2("uRes", res).f("uTime", tt).v4("uDeform", Vec4::ZERO).f("uWidth", 1.2 * dpr).v3("uCol", srgb(0x8a7a66));
            for m in &self.shells {
                h.m4("uModel", m).m3("uNrmMV", &Mat3::from_mat4(view * *m).inverse().transpose());
                for prim in &self.meshes[mi] {
                    prim.mesh.draw(gl, GL::TRIANGLES);
                }
            }
            gl.cull_face(GL::BACK);
        }

        // ---- thin coloured outlines (anime line art)
        gl.cull_face(GL::FRONT);
        let u = self.p.hull.bind(gl);
        u.m4("uView", &view).m4("uProj", &proj).v2("uRes", res).f("uTime", tt);
        for &ni in &self.order {
            let Some(mi) = self.nodes[ni].mesh else { continue };
            let model = self.nodes[ni].world;
            for prim in &self.meshes[mi] {
                let (w, col) = match prim.kind {
                    Kind::Iron => (1.7, srgb(0x0c0a0c)),
                    Kind::Bacon => (1.25, srgb(0x7a2416)),
                    Kind::Egg => (1.05, srgb(0xa0907e)),
                    Kind::Yolk => (1.2, srgb(0xc27a2a)),
                    _ => continue,
                };
                let deform = if prim.kind == Kind::Bacon {
                    let ph = self.bacon_phase.get(&ni).copied().unwrap_or(0.0);
                    let curl = 0.5 + 0.5 * (tt * 1.6 + ph).sin();
                    Vec4::new(1.0, prim.half, curl * (1.0 + self.boost), ph)
                } else {
                    Vec4::ZERO
                };
                u.m4("uModel", &model)
                    .m3("uNrmMV", &Mat3::from_mat4(view * model).inverse().transpose())
                    .v4("uDeform", deform)
                    .f("uWidth", w * dpr)
                    .v3("uCol", col);
                prim.mesh.draw(gl, GL::TRIANGLES);
            }
        }
        gl.cull_face(GL::BACK);

        // ---- the fire spirit: a ray-marched flame volume that writes its own depth, blended over what's behind
        {
            gl.enable(GL::BLEND);
            gl.blend_func(GL::ONE, GL::ONE_MINUS_SRC_ALPHA);
            let body = &self.nodes[self.i_body];
            let squash = body.s / body.bs;
            let pan_c = self.nodes[self.i_pan].world.transform_point3(Vec3::ZERO);
            gl.cull_face(GL::FRONT);
            let u = self.p.fire.bind(gl);
            gl.active_texture(GL::TEXTURE3);
            gl.bind_texture(GL::TEXTURE_3D, Some(&self.noise));
            u.i("uNoise", 3)
                .m4("uViewProj", &vp)
                .v3("uCam", cam)
                .v3("uBoxMin", FIRE_MIN)
                .v3("uBoxMax", FIRE_MAX)
                .v3("uBody", body.world.transform_point3(Vec3::ZERO))
                .v3("uBodyR", BODY_RAD * squash)
                .v3("uSquash", squash)
                .v3("uPan", pan_c)
                .f("uTime", tt)
                .f("uFlare", self.flare)
                .v3("uFaceR", Vec3::X)
                .v3("uFaceU", FACE_U)
                .v3("uFaceF", FACE_F)
                .v2("uEyeL", EYE_L)
                .v2("uEyeR", EYE_R)
                .v2("uEyeRad", Vec2::new(0.098, 0.122))
                .f("uPupilR", 0.034)
                .v2("uLids", self.expr.lids * self.lid)
                .v2("uEyeScale", self.expr.scale)
                .v4("uGaze2", Vec4::new(self.expr.gaze_l.x, self.expr.gaze_l.y, self.expr.gaze_r.x, self.expr.gaze_r.y))
                .f("uPupilScale", self.expr.pupil)
                .f("uSpiral", self.expr.spiral)
                .f("uSpin", self.spin)
                .v4("uBrow", self.expr.brow)
                .f("uBrowAmt", self.expr.brow_amt)
                .f("uTilt", self.expr.tilt)
                .v2("uFaceOff", self.face_off)
                .f("uHappy", self.expr.happy)
                .v2("uMouth", MOUTH)
                .v3("uMouthP", Vec3::new(0.10 * self.expr.mouth_w, 0.03 * self.expr.mouth_amp * (1.0 + 0.2 * self.mumble), self.expr.open + self.mumble * 0.2))
                .v2("uMouthX", Vec2::new(self.expr.zig, self.expr.mouth_tilt))
                .f("uMumble", self.mumble_phase);
            let (a0, a1) = (&self.arms[0], &self.arms[1]);
            u.v3("uArmS0", a0.s)
                .v3("uArmC0", a0.c)
                .v3("uArmH0", a0.hand)
                .v3("uArmD0", a0.d)
                .v3("uArmP0", a0.p)
                .v3("uArmQ0", a0.q)
                .v3("uArmS1", a1.s)
                .v3("uArmC1", a1.c)
                .v3("uArmH1", a1.hand)
                .v3("uArmD1", a1.d)
                .v3("uArmP1", a1.p)
                .v3("uArmQ1", a1.q)
                .v2("uArmG", Vec2::new(a0.grip, a1.grip))
                .v2("uArmE", Vec2::new(a0.ext, a1.ext));
            self.fire_box.draw(gl, GL::TRIANGLES);
            gl.active_texture(GL::TEXTURE0);
            gl.cull_face(GL::BACK);
            gl.disable(GL::BLEND);
        }

        // ---- transparent pass
        gl.enable(GL::BLEND);
        gl.depth_mask(false);
        gl.disable(GL::CULL_FACE);

        // grease beads on the bacon (ride with the pan)
        gl.blend_func_separate(GL::SRC_ALPHA, GL::ONE_MINUS_SRC_ALPHA, GL::ZERO, GL::ONE);
        let scale = self.h as f32 / (2.0 * (self.fov * 0.5).tan());
        let pan_w = self.nodes[self.i_pan].world;
        let hide = if self.tossing { 1.0 } else { 0.0 };
        let u = self.p.points.bind(gl);
        u.m4("uView", &view).m4("uProj", &proj).f("uTime", tt).f("uScale", scale).f("uHide", hide).f("uBurst", self.burst_at).v3("uBurstOff", self.burst_offset);
        u.m4("uModel", &pan_w).f("uMode", 3.0);
        self.beads.0.draw(gl, GL::POINTS);

        // steam
        let u = self.p.steam.bind(gl);
        let cam_up = Vec3::new(view.x_axis.y, view.y_axis.y, view.z_axis.y);
        u.m4("uViewProj", &vp).v3("uRight", right).v3("uUp", (cam_up + Vec3::Y * 0.35).normalize()).f("uTime", tt);
        let steam_op = 0.5 * (1.0 + 0.9 * self.boost);
        for pl in &self.plumes {
            u.v3("uCenter", pl.pos).v2("uSize", Vec2::new(pl.w, pl.h)).f("uSeed", pl.seed).f("uAspect", pl.w / pl.h).f("uOpacity", steam_op);
            self.quad.draw(gl, GL::TRIANGLES);
        }

        // splashes, shell chips, crumbs and sparks
        self.fx.draw(gl, &self.p.fx, &view, &proj, scale);

        // additive sparks + embers + poke burst (they glow)
        gl.blend_func(GL::ONE, GL::ONE);
        let u = self.p.points.bind(gl);
        u.m4("uView", &view).m4("uProj", &proj).f("uTime", tt).f("uScale", scale).f("uHide", hide).f("uBurst", self.burst_at).v3("uBurstOff", self.burst_offset);
        u.m4("uModel", &pan_w).f("uMode", 1.0);
        self.sparks.0.draw(gl, GL::POINTS);
        u.m4("uModel", &Mat4::IDENTITY).f("uMode", 0.0);
        self.embers.0.draw(gl, GL::POINTS);
        u.f("uMode", 2.0);
        self.burst.0.draw(gl, GL::POINTS);

        gl.depth_mask(true);
        gl.disable(GL::BLEND);
        gl.disable(GL::DEPTH_TEST);

        // ---- resolve + bloom + composite
        gl.bind_framebuffer(GL::READ_FRAMEBUFFER, Some(&rt.msaa.fb));
        gl.read_buffer(GL::COLOR_ATTACHMENT0);
        gl.bind_framebuffer(GL::DRAW_FRAMEBUFFER, Some(&rt.scene.fb));
        gl.blit_framebuffer(0, 0, self.w, self.h, 0, 0, self.w, self.h, GL::COLOR_BUFFER_BIT, GL::NEAREST);
        gl.read_buffer(GL::COLOR_ATTACHMENT1);
        gl.bind_framebuffer(GL::DRAW_FRAMEBUFFER, Some(&rt.glow.fb));
        gl.blit_framebuffer(0, 0, self.w, self.h, 0, 0, self.w, self.h, GL::COLOR_BUFFER_BIT, GL::NEAREST);
        gl.bind_framebuffer(GL::READ_FRAMEBUFFER, Some(&rt.msaa.fb));
        gl.read_buffer(GL::COLOR_ATTACHMENT0);
        gl.bind_vertex_array(Some(&self.empty));
        gl.active_texture(GL::TEXTURE0);

        let pass = |dst: &Target, prog: &Prog, src: &Target, dir: Option<Vec2>| {
            gl.bind_framebuffer(GL::FRAMEBUFFER, Some(&dst.fb));
            gl.viewport(0, 0, dst.w, dst.h);
            let u = prog.bind(gl);
            gl.bind_texture(GL::TEXTURE_2D, Some(&src.tex));
            u.i("uTex", 0);
            if let Some(d) = dir {
                u.v2("uDir", d);
            }
            gl.draw_arrays(GL::TRIANGLES, 0, 3);
        };
        pass(&rt.half_a, &self.p.bright, &rt.glow, None);
        for _ in 0..2 {
            pass(&rt.half_b, &self.p.blur, &rt.half_a, Some(Vec2::new(1.4 / rt.half_a.w as f32, 0.0)));
            pass(&rt.half_a, &self.p.blur, &rt.half_b, Some(Vec2::new(0.0, 1.4 / rt.half_a.h as f32)));
        }
        pass(&rt.q_a, &self.p.blur, &rt.half_a, Some(Vec2::new(1.0 / rt.half_a.w as f32, 0.0)));
        for _ in 0..2 {
            pass(&rt.q_b, &self.p.blur, &rt.q_a, Some(Vec2::new(2.0 / rt.q_a.w as f32, 0.0)));
            pass(&rt.q_a, &self.p.blur, &rt.q_b, Some(Vec2::new(0.0, 2.0 / rt.q_a.h as f32)));
        }

        gl.bind_framebuffer(GL::FRAMEBUFFER, None);
        gl.viewport(0, 0, self.w, self.h);
        let u = self.p.comp.bind(gl);
        gl.active_texture(GL::TEXTURE0);
        gl.bind_texture(GL::TEXTURE_2D, Some(&rt.scene.tex));
        gl.active_texture(GL::TEXTURE1);
        gl.bind_texture(GL::TEXTURE_2D, Some(&rt.half_a.tex));
        gl.active_texture(GL::TEXTURE2);
        gl.bind_texture(GL::TEXTURE_2D, Some(&rt.q_a.tex));
        u.i("uScene", 0).i("uB1", 1).i("uB2", 2).f("uStrength", 0.45 + 0.1 * self.flare).f("uTime", tt);
        gl.draw_arrays(GL::TRIANGLES, 0, 3);
        gl.active_texture(GL::TEXTURE0);
    }
}
