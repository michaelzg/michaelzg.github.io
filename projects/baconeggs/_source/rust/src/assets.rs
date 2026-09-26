//! Loads the Blender-exported GLB: node hierarchy, mesh primitives and embedded PNG textures.

use glam::{Quat, Vec3};

pub struct Prim {
    pub pos: Vec<[f32; 3]>,
    pub nrm: Vec<[f32; 3]>,
    pub uv: Option<Vec<[f32; 2]>>,
    pub idx: Vec<u32>,
    pub material: String,
    pub image: Option<usize>,
}

pub struct NodeData {
    pub name: String,
    pub parent: Option<usize>,
    pub t: Vec3,
    pub r: Quat,
    pub s: Vec3,
    pub mesh: Option<usize>,
}

pub struct Image {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

pub struct Asset {
    pub nodes: Vec<NodeData>,
    /// Parents always come before their children.
    pub order: Vec<usize>,
    pub meshes: Vec<Vec<Prim>>,
    pub images: Vec<Image>,
}

fn decode_png(bytes: &[u8]) -> Result<Image, String> {
    let mut dec = png::Decoder::new(bytes);
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut rd = dec.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; rd.output_buffer_size()];
    let info = rd.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let data = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data.chunks(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::GrayscaleAlpha => data.chunks(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        other => return Err(format!("unsupported png colour type {other:?}")),
    };
    Ok(Image { w: info.width, h: info.height, rgba })
}

pub fn load(bytes: &[u8]) -> Result<Asset, String> {
    let g = gltf::Gltf::from_slice(bytes).map_err(|e| e.to_string())?;
    let blob: &[u8] = g.blob.as_deref().ok_or("glb has no binary chunk")?;
    let doc = &g.document;

    let mut images = Vec::new();
    for im in doc.images() {
        match im.source() {
            gltf::image::Source::View { view, .. } => {
                let start = view.offset();
                images.push(decode_png(&blob[start..start + view.length()])?);
            }
            _ => images.push(Image { w: 1, h: 1, rgba: vec![255; 4] }),
        }
    }

    let mut meshes = Vec::new();
    for m in doc.meshes() {
        let mut prims = Vec::new();
        for p in m.primitives() {
            let r = p.reader(|b| if b.index() == 0 { Some(blob) } else { None });
            let pos: Vec<[f32; 3]> = r.read_positions().ok_or("primitive without positions")?.collect();
            let nrm: Vec<[f32; 3]> =
                r.read_normals().map(|n| n.collect()).unwrap_or_else(|| vec![[0.0, 1.0, 0.0]; pos.len()]);
            let uv = r.read_tex_coords(0).map(|t| t.into_f32().collect());
            let idx = r
                .read_indices()
                .map(|i| i.into_u32().collect())
                .unwrap_or_else(|| (0..pos.len() as u32).collect());
            let mat = p.material();
            prims.push(Prim {
                pos,
                nrm,
                uv,
                idx,
                material: mat.name().unwrap_or("").to_string(),
                image: mat.pbr_metallic_roughness().base_color_texture().map(|t| t.texture().source().index()),
            });
        }
        meshes.push(prims);
    }

    let mut nodes: Vec<NodeData> = doc
        .nodes()
        .map(|n| {
            let (t, r, s) = n.transform().decomposed();
            NodeData {
                name: n.name().unwrap_or("").to_string(),
                parent: None,
                t: Vec3::from(t),
                r: Quat::from_array(r),
                s: Vec3::from(s),
                mesh: n.mesh().map(|m| m.index()),
            }
        })
        .collect();
    let mut children = vec![Vec::new(); nodes.len()];
    for n in doc.nodes() {
        for c in n.children() {
            nodes[c.index()].parent = Some(n.index());
            children[n.index()].push(c.index());
        }
    }
    let mut order = Vec::with_capacity(nodes.len());
    let mut stack: Vec<usize> = (0..nodes.len()).filter(|&i| nodes[i].parent.is_none()).rev().collect();
    while let Some(i) = stack.pop() {
        order.push(i);
        for &c in children[i].iter().rev() {
            stack.push(c);
        }
    }
    Ok(Asset { nodes, order, meshes, images })
}
