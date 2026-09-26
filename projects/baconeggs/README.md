# Breakfast at the Hearth

A fire spirit keeps a skillet of bacon and eggs sizzling. Drag to orbit, pinch or scroll to zoom, tap to toss the pan. Live at [michaelzg.com/projects/baconeggs/](https://michaelzg.com/projects/baconeggs/).

## Architecture

```
_source/blender/hearth.blend ──export──▶ hearth.glb ──┐
_source/rust/ ──cargo + wasm-bindgen──▶ pkg/         ├──▶ index.html (one WebGL2 canvas)
```

- **Model (Blender).** The pan, the food (four eggs with yolks, three bacon strips, numpy-painted textures), the shell used for falling eggs, and the hearth floor. It's exported to `hearth.glb` with modifiers applied and Y up. The fire spirit isn't a mesh.
- **Renderer (Rust compiled to wasm).** It drives raw WebGL2 through `web-sys`, with no JS framework:
  - `lib.rs`: app state and animation. This covers the orbit camera, the pan toss with per-item flips, flame arms that catch and feed food, chewing, random expressions, and breakfast falling from the sky once the pan is empty. It also holds the render loop.
  - `shaders.rs`: the GLSL. Cel shading with screen-space outlines, a ray-marched fire built from signed distance fields (body, tongues, arms and a painted face; partly see-through, writes depth), oil bubbles, steam, and bloom.
  - `gfx.rs`: WebGL helpers, including multisampling with a separate glow buffer.
  - `assets.rs`: the GLB loader.
  - `fx.rs`: CPU particles.
- **Frame.** Opaque cel pass, then outlines, then the blended fire, then steam and particles, then MSAA resolve, then bloom from the glow buffer, then the composite.
- **Page.** `index.html` loads `pkg/hearth.js`, the wasm and `hearth.glb`, all relative to this folder. It forwards pointer, wheel and resize events and calls `App.frame(dt)` on every `requestAnimationFrame`. It has no external dependencies.

## Local dev

Prerequisites:

- Rust, with `rustup target add wasm32-unknown-unknown`.
- `wasm-bindgen-cli` 0.2.100, which must match the crate: `cargo install wasm-bindgen-cli --version 0.2.100`.
- Python 3.
- Blender 4.2 or later, only if you change the model. On macOS the binary is `/Applications/Blender.app/Contents/MacOS/Blender`.

From this folder:

```bash
# rebuild the wasm after editing _source/rust
(cd _source/rust && cargo build --release --target wasm32-unknown-unknown)
wasm-bindgen --target web --no-typescript --out-dir pkg _source/rust/target/wasm32-unknown-unknown/release/hearth.wasm

# re-export the model after editing the Blender scene
blender -b _source/blender/hearth.blend --python _source/blender/export_glb.py

# preview on its own at http://localhost:8000/
python3 -m http.server 8000
```

To preview it inside the blog, run `make serve` from the repo root and open http://localhost:4000/projects/baconeggs/.

Jekyll skips `_source/` because of the leading underscore, so only `index.html`, `pkg/` and `hearth.glb` are published. On deploy, `.github/workflows/pages.yml` rebuilds `pkg/` from the Rust source before building the site. CI has no Blender, so commit `hearth.glb` whenever you re-export the model.
