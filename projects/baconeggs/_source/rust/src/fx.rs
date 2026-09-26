//! CPU-simulated particles: oil splashes, shell chips, crumbs and sparks. Simulated in Rust,
//! streamed to one dynamic buffer each frame and drawn as point sprites in two batches
//! (alpha-blended chips first, then additive sparks that also feed the glow mask).

use glam::{Mat4, Vec3, Vec4};
use web_sys::{WebGl2RenderingContext as GL, WebGlBuffer, WebGlVertexArrayObject};

use crate::gfx::Prog;

struct Part {
    p: Vec3,
    v: Vec3,
    age: f32,
    life: f32,
    size: f32,
    c0: Vec4,
    c1: Vec4,
    grav: f32,
    drag: f32,
    add: bool,
}

pub struct Fx {
    parts: Vec<Part>,
    vao: WebGlVertexArrayObject,
    buf: WebGlBuffer,
    cap: usize,
    data: Vec<f32>,
    seed: u32,
}

const FLOATS: usize = 8; // xyz size rgba

impl Fx {
    pub fn new(gl: &GL) -> Fx {
        let vao = gl.create_vertex_array().expect("vao");
        gl.bind_vertex_array(Some(&vao));
        let buf = gl.create_buffer().expect("buffer");
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&buf));
        let cap = 1024;
        gl.buffer_data_with_i32(GL::ARRAY_BUFFER, (cap * FLOATS * 4) as i32, GL::DYNAMIC_DRAW);
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 4, GL::FLOAT, false, (FLOATS * 4) as i32, 0);
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 4, GL::FLOAT, false, (FLOATS * 4) as i32, 16);
        gl.bind_vertex_array(None);
        Fx { parts: Vec::new(), vao, buf, cap, data: Vec::new(), seed: 0x2F6B_91D3 }
    }

    fn rnd(&mut self) -> f32 {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        (x.wrapping_mul(0x9E37_79B9) >> 8) as f32 / (1u32 << 24) as f32
    }
    fn r(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.rnd()
    }
    fn dir_up(&mut self, spread: f32) -> Vec3 {
        let a = self.r(0.0, std::f32::consts::TAU);
        let s = self.r(0.2, 1.0) * spread;
        Vec3::new(a.cos() * s, 1.0, a.sin() * s).normalize()
    }
    #[allow(clippy::too_many_arguments)]
    fn push(&mut self, p: Vec3, v: Vec3, life: f32, size: f32, c0: Vec4, c1: Vec4, grav: f32, drag: f32, add: bool) {
        if self.parts.len() < 900 {
            self.parts.push(Part { p, v, age: 0.0, life, size, c0, c1, grav, drag, add });
        }
    }

    /// Hot oil jumping out where something lands in the pan.
    pub fn splash(&mut self, at: Vec3, n: usize) {
        for _ in 0..n {
            let d = self.dir_up(1.3);
            let sp = self.r(0.8, 2.1);
            let (life, size) = (self.r(0.45, 0.8), self.r(0.012, 0.024));
            let oil = Vec4::new(0.72, 0.46, 0.16, 1.0);
            self.push(at, d * sp, life, size, oil, Vec4::new(0.45, 0.25, 0.08, 0.0), 7.5, 0.4, false);
        }
        for _ in 0..n / 2 {
            let d = self.dir_up(1.0);
            let sp = self.r(1.0, 2.4);
            let life = self.r(0.3, 0.55);
            self.push(at, d * sp, life, 0.02, Vec4::new(1.0, 0.85, 0.5, 1.0), Vec4::new(1.0, 0.5, 0.1, 0.0), 6.0, 0.5, true);
        }
    }

    /// Chips of eggshell flying off when an egg cracks.
    pub fn shell_bits(&mut self, at: Vec3) {
        for _ in 0..14 {
            let d = self.dir_up(1.8);
            let sp = self.r(0.7, 1.7);
            let (life, size) = (self.r(0.5, 0.85), self.r(0.018, 0.032));
            let c = Vec4::new(0.95, 0.9, 0.8, 1.0);
            self.push(at + Vec3::Y * 0.05, d * sp, life, size, c, Vec4::new(0.85, 0.78, 0.66, 0.0), 8.0, 0.3, false);
        }
    }

    /// Crumbs and sparks spat out of the mouth while chomping.
    pub fn crumbs(&mut self, at: Vec3, out: Vec3, n: usize) {
        for i in 0..n {
            let spread = Vec3::new(self.r(-0.9, 0.9), self.r(0.3, 1.2), self.r(-0.4, 0.4));
            let v = (out * self.r(0.4, 1.0) + spread) * self.r(0.6, 1.3);
            let (life, size) = (self.r(0.4, 0.75), self.r(0.012, 0.022));
            let c = if i % 3 == 0 { Vec4::new(1.0, 0.95, 0.82, 1.0) } else { Vec4::new(0.78, 0.3, 0.2, 1.0) };
            self.push(at, v, life, size, c, c * Vec4::new(0.8, 0.8, 0.8, 0.0), 6.5, 0.6, false);
        }
        self.sparks(at, n / 2 + 2, 0.9);
    }

    /// Warm additive sparks (glow), drifting up.
    pub fn sparks(&mut self, at: Vec3, n: usize, up: f32) {
        for _ in 0..n {
            let d = self.dir_up(1.2);
            let sp = self.r(0.6, 1.8) * up;
            let life = self.r(0.4, 0.9);
            let size = self.r(0.02, 0.04);
            self.push(at, d * sp, life, size, Vec4::new(1.0, 0.86, 0.45, 1.0), Vec4::new(1.0, 0.35, 0.08, 0.0), -0.6, 1.2, true);
        }
    }

    pub fn update(&mut self, dt: f32) {
        for p in &mut self.parts {
            p.age += dt;
            p.v.y -= p.grav * dt;
            p.v *= (1.0 - p.drag * dt).max(0.0);
            p.p += p.v * dt;
            // chips settle on the hearth rather than falling through it
            if !p.add && p.p.y < -0.29 {
                p.p.y = -0.29;
                p.v = Vec3::ZERO;
            }
        }
        self.parts.retain(|p| p.age < p.life);
    }

    pub fn draw(&mut self, gl: &GL, prog: &Prog, view: &Mat4, proj: &Mat4, scale: f32) {
        if self.parts.is_empty() {
            return;
        }
        self.data.clear();
        let mut counts = [0i32; 2];
        for (pass, add) in [false, true].into_iter().enumerate() {
            for p in self.parts.iter().filter(|p| p.add == add) {
                let t = (p.age / p.life).clamp(0.0, 1.0);
                let c = p.c0.lerp(p.c1, t);
                let a = p.c0.w * (1.0 - t * t);
                self.data.extend_from_slice(&[p.p.x, p.p.y, p.p.z, p.size * (1.0 - 0.35 * t), c.x, c.y, c.z, a]);
                counts[pass] += 1;
            }
        }
        gl.bind_vertex_array(Some(&self.vao));
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&self.buf));
        let n = self.data.len() / FLOATS;
        if n > self.cap {
            self.cap = n.next_power_of_two();
            gl.buffer_data_with_i32(GL::ARRAY_BUFFER, (self.cap * FLOATS * 4) as i32, GL::DYNAMIC_DRAW);
        }
        let arr = js_sys::Float32Array::new_with_length(self.data.len() as u32);
        arr.copy_from(&self.data);
        gl.buffer_sub_data_with_i32_and_array_buffer_view(GL::ARRAY_BUFFER, 0, &arr);

        let u = prog.bind(gl);
        u.m4("uView", view).m4("uProj", proj).f("uScale", scale);
        if counts[0] > 0 {
            gl.blend_func_separate(GL::SRC_ALPHA, GL::ONE_MINUS_SRC_ALPHA, GL::ZERO, GL::ONE);
            u.f("uAdd", 0.0);
            gl.draw_arrays(GL::POINTS, 0, counts[0]);
        }
        if counts[1] > 0 {
            gl.blend_func(GL::ONE, GL::ONE);
            u.f("uAdd", 1.0);
            gl.draw_arrays(GL::POINTS, counts[0], counts[1]);
        }
    }
}
