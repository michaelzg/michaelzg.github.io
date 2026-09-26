//! Thin WebGL2 helpers: programs with cached uniforms, meshes, textures, render targets.

use std::cell::RefCell;
use std::collections::HashMap;

use glam::{Mat3, Mat4, Vec2, Vec3, Vec4};
use web_sys::{
    WebGl2RenderingContext as GL, WebGlFramebuffer, WebGlProgram, WebGlRenderbuffer, WebGlShader,
    WebGlTexture, WebGlUniformLocation, WebGlVertexArrayObject,
};

pub struct Prog {
    p: WebGlProgram,
    locs: RefCell<HashMap<&'static str, Option<WebGlUniformLocation>>>,
}

fn shader(gl: &GL, kind: u32, src: &str) -> Result<WebGlShader, String> {
    let s = gl.create_shader(kind).ok_or_else(|| "create_shader failed".to_string())?;
    gl.shader_source(&s, src);
    gl.compile_shader(&s);
    if gl.get_shader_parameter(&s, GL::COMPILE_STATUS).as_bool().unwrap_or(false) {
        Ok(s)
    } else {
        Err(gl.get_shader_info_log(&s).unwrap_or_default())
    }
}

pub fn program(gl: &GL, name: &str, vs: &str, fs: &str) -> Result<Prog, String> {
    let v = shader(gl, GL::VERTEX_SHADER, vs).map_err(|e| format!("{name} (vertex): {e}"))?;
    let f = shader(gl, GL::FRAGMENT_SHADER, fs).map_err(|e| format!("{name} (fragment): {e}"))?;
    let p = gl.create_program().ok_or_else(|| "create_program failed".to_string())?;
    gl.attach_shader(&p, &v);
    gl.attach_shader(&p, &f);
    gl.link_program(&p);
    if !gl.get_program_parameter(&p, GL::LINK_STATUS).as_bool().unwrap_or(false) {
        return Err(format!("{name} (link): {}", gl.get_program_info_log(&p).unwrap_or_default()));
    }
    Ok(Prog { p, locs: RefCell::new(HashMap::new()) })
}

pub struct U<'a> {
    gl: &'a GL,
    p: &'a Prog,
}

impl Prog {
    pub fn bind<'a>(&'a self, gl: &'a GL) -> U<'a> {
        gl.use_program(Some(&self.p));
        U { gl, p: self }
    }
}

impl<'a> U<'a> {
    fn loc(&self, n: &'static str) -> Option<WebGlUniformLocation> {
        self.p
            .locs
            .borrow_mut()
            .entry(n)
            .or_insert_with(|| self.gl.get_uniform_location(&self.p.p, n))
            .clone()
    }
    pub fn f(&self, n: &'static str, v: f32) -> &Self {
        self.gl.uniform1f(self.loc(n).as_ref(), v);
        self
    }
    pub fn i(&self, n: &'static str, v: i32) -> &Self {
        self.gl.uniform1i(self.loc(n).as_ref(), v);
        self
    }
    pub fn v2(&self, n: &'static str, v: Vec2) -> &Self {
        self.gl.uniform2f(self.loc(n).as_ref(), v.x, v.y);
        self
    }
    pub fn v3(&self, n: &'static str, v: Vec3) -> &Self {
        self.gl.uniform3f(self.loc(n).as_ref(), v.x, v.y, v.z);
        self
    }
    pub fn v4(&self, n: &'static str, v: Vec4) -> &Self {
        self.gl.uniform4f(self.loc(n).as_ref(), v.x, v.y, v.z, v.w);
        self
    }
    pub fn m4(&self, n: &'static str, m: &Mat4) -> &Self {
        self.gl.uniform_matrix4fv_with_f32_array(self.loc(n).as_ref(), false, &m.to_cols_array());
        self
    }
    pub fn m3(&self, n: &'static str, m: &Mat3) -> &Self {
        self.gl.uniform_matrix3fv_with_f32_array(self.loc(n).as_ref(), false, &m.to_cols_array());
        self
    }
}

pub struct Mesh {
    vao: WebGlVertexArrayObject,
    count: i32,
    indexed: bool,
}

impl Mesh {
    pub fn draw(&self, gl: &GL, mode: u32) {
        gl.bind_vertex_array(Some(&self.vao));
        if self.indexed {
            gl.draw_elements_with_i32(mode, self.count, GL::UNSIGNED_INT, 0);
        } else {
            gl.draw_arrays(mode, 0, self.count);
        }
    }
}

/// `attrs`: (location, components, data). The vertex count comes from location 0.
pub fn mesh(gl: &GL, attrs: &[(u32, i32, &[f32])], idx: Option<&[u32]>) -> Mesh {
    let vao = gl.create_vertex_array().expect("vao");
    gl.bind_vertex_array(Some(&vao));
    let mut verts = 0;
    for &(loc, size, data) in attrs {
        let b = gl.create_buffer().expect("buffer");
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&b));
        let a = js_sys::Float32Array::new_with_length(data.len() as u32);
        a.copy_from(data);
        gl.buffer_data_with_array_buffer_view(GL::ARRAY_BUFFER, &a, GL::STATIC_DRAW);
        gl.enable_vertex_attrib_array(loc);
        gl.vertex_attrib_pointer_with_i32(loc, size, GL::FLOAT, false, 0, 0);
        if loc == 0 {
            verts = data.len() as i32 / size;
        }
    }
    let (count, indexed) = match idx {
        Some(ix) => {
            let b = gl.create_buffer().expect("buffer");
            gl.bind_buffer(GL::ELEMENT_ARRAY_BUFFER, Some(&b));
            let a = js_sys::Uint32Array::new_with_length(ix.len() as u32);
            a.copy_from(ix);
            gl.buffer_data_with_array_buffer_view(GL::ELEMENT_ARRAY_BUFFER, &a, GL::STATIC_DRAW);
            (ix.len() as i32, true)
        }
        None => (verts, false),
    };
    gl.bind_vertex_array(None);
    Mesh { vao, count, indexed }
}

fn tex_params(gl: &GL, min: u32) {
    gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MIN_FILTER, min as i32);
    gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MAG_FILTER, GL::LINEAR as i32);
    gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_S, GL::CLAMP_TO_EDGE as i32);
    gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_T, GL::CLAMP_TO_EDGE as i32);
}

/// An sRGB colour texture (sampling returns linear values), mipmapped.
pub fn texture(gl: &GL, w: i32, h: i32, rgba: &[u8]) -> WebGlTexture {
    let t = gl.create_texture().expect("texture");
    gl.bind_texture(GL::TEXTURE_2D, Some(&t));
    gl.pixel_storei(GL::UNPACK_ALIGNMENT, 1);
    let _ = gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
        GL::TEXTURE_2D,
        0,
        GL::SRGB8_ALPHA8 as i32,
        w,
        h,
        0,
        GL::RGBA,
        GL::UNSIGNED_BYTE,
        Some(rgba),
    );
    gl.generate_mipmap(GL::TEXTURE_2D);
    tex_params(gl, GL::LINEAR_MIPMAP_LINEAR);
    t
}

pub struct Target {
    pub fb: WebGlFramebuffer,
    pub tex: WebGlTexture,
    pub w: i32,
    pub h: i32,
}

impl Target {
    pub fn new(gl: &GL, w: i32, h: i32, hdr: bool) -> Target {
        let tex = gl.create_texture().expect("texture");
        gl.bind_texture(GL::TEXTURE_2D, Some(&tex));
        let (ifmt, ty) = if hdr { (GL::RGBA16F, GL::HALF_FLOAT) } else { (GL::RGBA8, GL::UNSIGNED_BYTE) };
        let _ = gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            GL::TEXTURE_2D,
            0,
            ifmt as i32,
            w,
            h,
            0,
            GL::RGBA,
            ty,
            None,
        );
        tex_params(gl, GL::LINEAR);
        let fb = gl.create_framebuffer().expect("framebuffer");
        gl.bind_framebuffer(GL::FRAMEBUFFER, Some(&fb));
        gl.framebuffer_texture_2d(GL::FRAMEBUFFER, GL::COLOR_ATTACHMENT0, GL::TEXTURE_2D, Some(&tex), 0);
        gl.bind_framebuffer(GL::FRAMEBUFFER, None);
        Target { fb, tex, w, h }
    }
    pub fn free(&self, gl: &GL) {
        gl.delete_framebuffer(Some(&self.fb));
        gl.delete_texture(Some(&self.tex));
    }
}

/// Multisampled colour + glow + depth buffer the scene is drawn into before resolving.
/// Attachment 1 is the glow layer: whatever is written there blooms (fire, embers, sparks).
pub struct Msaa {
    pub fb: WebGlFramebuffer,
    color: WebGlRenderbuffer,
    glow: WebGlRenderbuffer,
    depth: WebGlRenderbuffer,
}

impl Msaa {
    pub fn new(gl: &GL, w: i32, h: i32, samples: i32, hdr: bool) -> Msaa {
        let fb = gl.create_framebuffer().expect("framebuffer");
        gl.bind_framebuffer(GL::FRAMEBUFFER, Some(&fb));
        let color = gl.create_renderbuffer().expect("renderbuffer");
        gl.bind_renderbuffer(GL::RENDERBUFFER, Some(&color));
        let fmt = if hdr { GL::RGBA16F } else { GL::RGBA8 };
        gl.renderbuffer_storage_multisample(GL::RENDERBUFFER, samples, fmt, w, h);
        gl.framebuffer_renderbuffer(GL::FRAMEBUFFER, GL::COLOR_ATTACHMENT0, GL::RENDERBUFFER, Some(&color));
        let glow = gl.create_renderbuffer().expect("renderbuffer");
        gl.bind_renderbuffer(GL::RENDERBUFFER, Some(&glow));
        gl.renderbuffer_storage_multisample(GL::RENDERBUFFER, samples, GL::RGBA8, w, h);
        gl.framebuffer_renderbuffer(GL::FRAMEBUFFER, GL::COLOR_ATTACHMENT1, GL::RENDERBUFFER, Some(&glow));
        let bufs = js_sys::Array::of2(&GL::COLOR_ATTACHMENT0.into(), &GL::COLOR_ATTACHMENT1.into());
        gl.draw_buffers(&bufs);
        let depth = gl.create_renderbuffer().expect("renderbuffer");
        gl.bind_renderbuffer(GL::RENDERBUFFER, Some(&depth));
        gl.renderbuffer_storage_multisample(GL::RENDERBUFFER, samples, GL::DEPTH_COMPONENT24, w, h);
        gl.framebuffer_renderbuffer(GL::FRAMEBUFFER, GL::DEPTH_ATTACHMENT, GL::RENDERBUFFER, Some(&depth));
        gl.bind_framebuffer(GL::FRAMEBUFFER, None);
        Msaa { fb, color, glow, depth }
    }
    pub fn free(&self, gl: &GL) {
        gl.delete_framebuffer(Some(&self.fb));
        gl.delete_renderbuffer(Some(&self.color));
        gl.delete_renderbuffer(Some(&self.glow));
        gl.delete_renderbuffer(Some(&self.depth));
    }
}
