"""Bring hearth.blend closer to the film frame: split firewood, broad bacon, clean eggs.

Run once from the repository root, then run export_glb.py:

    blender -b projects/baconeggs/_source/blender/hearth.blend \
      --python projects/baconeggs/_source/blender/refine_likeness.py

- Two logs, sunk about halfway into the ash, carry the flame on their split
  tops (any earlier HearthLog objects are replaced), and the ash is lowered to
  meet them. Each keeps its pith on the mesh's local x axis, so the renderer
  can paint growth rings on the riven top and the sawn ends from local
  position alone. Materials: M_WoodBark (the rounded sides), M_WoodSplit (the
  riven top), M_WoodEnd (the sawn ends).
- The bacon strips get wider and longer, with pink-red lean, creamy fat bands and
  crisp browned edges painted into their textures.
- The egg whites get fresh planar UVs that follow their reshaped outlines, clean
  white textures, and golden lacy edges where the white fried crisp.
"""

import math
import struct
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


scene = bpy.context.scene
if scene.get("likeness_v1"):
    print("Likeness pass already applied")
    raise SystemExit(0)

rng = np.random.default_rng(7)


def smoothstep(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def value_noise(h, w, cells_y, cells_x, seed):
    """Smooth value noise in [-1, 1] on an h x w grid."""
    g = np.random.default_rng(seed).uniform(-1.0, 1.0, (cells_y + 2, cells_x + 2))
    y = np.linspace(0.0, cells_y, h, dtype=np.float64)[:, None]
    x = np.linspace(0.0, cells_x, w, dtype=np.float64)[None, :]
    iy, ix = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = y - iy, x - ix
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[iy, ix] * (1 - fx) + g[iy, ix + 1] * fx
    b = g[iy + 1, ix] * (1 - fx) + g[iy + 1, ix + 1] * fx
    return a * (1 - fy) + b * fy


def fbm(h, w, cells_y, cells_x, seed, octaves=4):
    total, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        total = total + amp * value_noise(h, w, cells_y * 2 ** o, cells_x * 2 ** o, seed + 31 * o)
        norm += amp
        amp *= 0.5
    return total / norm


def png_bytes(rgb):
    """Encode rows (bottom row first, as Blender stores them) as a compact 8-bit RGB PNG.

    Blender packs edited images as RGBA at a light zlib level; these textures are
    opaque, so dropping alpha and compressing harder keeps the GLB smaller.
    """
    a = (np.clip(rgb, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)[::-1]
    h, w, _ = a.shape
    x = a.reshape(h, w * 3).astype(np.int16)
    up = np.vstack([x[:1], x[1:] - x[:-1]]) % 256
    sub = np.hstack([x[:, :3], x[:, 3:] - x[:, :-3]]) % 256
    rows = []
    for i in range(h):
        # pick the filter whose residuals are smallest (signed), the usual PNG heuristic
        cost_up = np.abs(up[i].astype(np.int8).astype(np.int32)).sum() if i else 1 << 30
        cost_sub = np.abs(sub[i].astype(np.int8).astype(np.int32)).sum()
        rows.append(b"\x02" + up[i].astype(np.uint8).tobytes() if cost_up < cost_sub
                    else b"\x01" + sub[i].astype(np.uint8).tobytes())

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def set_pixels(image, rgb):
    data = png_bytes(rgb)
    # A relative path that doesn't exist, so the image always loads from the
    # packed PNG rather than from wherever the texture was first painted.
    image.filepath_raw = "//" + image.name + ".png"
    image.pack(data=data, data_len=len(data))
    image.reload()


def mix(a, b, t):
    t = np.asarray(t)[..., None]
    return a * (1.0 - t) + np.asarray(b) * t


def material(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


# ---------------------------------------------------------------------------
# Hearth logs
# ---------------------------------------------------------------------------

for obj in [o for o in bpy.data.objects if o.name.startswith("HearthLog")]:
    mesh = obj.data
    bpy.data.objects.remove(obj)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)
for name in ["M_WoodCut", "M_WoodRing"]:
    mat = bpy.data.materials.get(name)
    if mat and mat.users == 0:
        bpy.data.materials.remove(mat)

bark_mat = material("M_WoodBark")
split_mat = material("M_WoodSplit")
end_mat = material("M_WoodEnd")


def hearth_log(name, inner, outer, radius, cut, seed):
    """A round trunk section lying in the ash with its top riven off flat.

    Local x runs along the pith from the inner end to the outer end. The
    cross-section is the trunk's circle with the cap above height `cut` split
    away: a flat riven top (M_WoodSplit) over rounded bark (M_WoodBark), with
    sawn ends (M_WoodEnd). The pith stays on local x, so the renderer paints
    growth rings from local position alone.
    """
    r = np.random.default_rng(seed)
    a, b = Vector(inner), Vector(outer)
    axis = (b - a).normalized()
    length = (b - a).length
    up = Vector((0.0, 0.0, 1.0))
    side = up.cross(axis).normalized()          # local +y
    local_up = axis.cross(side).normalized()    # local +z

    phases = r.uniform(0.0, 2.0 * math.pi, 16)
    n_top, n_arc = 20, 44
    stations = np.concatenate([
        [0.0, 0.006, 0.018],
        np.linspace(0.04, 0.96, 44),
        [0.982, 0.994, 1.0],
    ])
    # a couple of drying checks run partway down the riven top
    checks = [(r.uniform(0.25, 0.75), r.uniform(0.0, 0.5), r.uniform(0.5, 1.0), r.uniform(0.012, 0.02))
              for _ in range(2)]

    def top_relief(s, t):
        """Relief on the riven top: s across it (0..1), t along the log."""
        x = t * length
        sc = min(max(s, 0.0), 1.0)
        env = math.sin(math.pi * sc) ** 0.6
        d = 0.005 * math.sin(sc * 7.0 + phases[8] + 0.9 * math.sin(x * 3.1 + phases[9]))
        d += 0.003 * math.sin(sc * 13.0 + phases[10] + 1.4 * math.sin(x * 5.3))
        for (sc0, t0, t1, depth) in checks:
            along = min(max((t - t0) / max(t1 - t0, 1e-3), 0.0), 1.0)
            if 0.0 < along < 1.0:
                sc2 = sc0 + 0.04 * math.sin(x * 2.3 + phases[11])
                d -= depth * math.sin(math.pi * along) ** 0.7 * math.exp(-((sc - sc2) / 0.03) ** 2)
        # the split never runs perfectly flat
        d += 0.02 * math.sin(x * 1.1 + phases[12]) * math.sin(math.pi * sc)
        return d * env

    def section(t):
        x = t * length
        rad = radius * (1.0 + 0.03 * math.sin(x * 2.1 + phases[0]) + 0.02 * math.sin(x * 5.3 + phases[1]))
        # the sawn ends soften into the sides over a centimetre or two
        end = min(t * length, (1.0 - t) * length)
        rad *= 0.955 + 0.045 * min(end / 0.03, 1.0) ** 0.5
        h = cut + 0.012 * math.sin(x * 1.7 + phases[2])
        phc = math.asin(max(-0.95, min(0.95, h / rad)))
        # the split follows the grain, which twists a little along the trunk
        tw = math.radians(4.0) * math.sin(math.pi * t * 1.3 + phases[7])
        ct, st = math.cos(tw), math.sin(tw)

        def turn(y, z):
            return np.array([ct * y - st * z, st * y + ct * z])

        pts, kinds = [], []
        # bark, counterclockwise from the left corner of the top round the underside to the right
        a0, a1 = math.pi - phc, 2.0 * math.pi + phc
        for k in range(n_arc + 1):
            ang = a0 + (a1 - a0) * k / n_arc
            rb = rad * (1.0 + 0.018 * math.sin(ang * 9.0 + x * 1.3 + phases[4])
                        + 0.012 * math.sin(ang * 23.0 - x * 2.9 + phases[5])
                        + 0.010 * math.sin(x * 11.0 + ang * 4.0 + phases[6]))
            pts.append(turn(math.cos(ang) * rb, math.sin(ang) * rb))
            kinds.append("bark")
        # the riven top, right to left
        half = rad * math.cos(phc)
        for k in range(1, n_top):
            sv = k / n_top
            pts.append(turn(half * (1.0 - 2.0 * sv), h + top_relief(sv, t)))
            kinds.append("split")
        return pts, kinds

    bm = bmesh.new()
    rings = []
    kinds = None
    # neither end is square: the saw ran at a slant
    tilt_dir = r.uniform(0.0, 2.0 * math.pi, 2)
    for t in stations:
        pts, kinds = section(t)
        w_out = smoothstep(0.9, 0.96, t)
        w_in = 1.0 - smoothstep(0.04, 0.1, t)
        ring = []
        for p in pts:
            slant = 0.14 * w_out * (p[0] * math.cos(tilt_dir[0]) + p[1] * math.sin(tilt_dir[0]))
            slant += 0.12 * w_in * (p[0] * math.cos(tilt_dir[1]) + p[1] * math.sin(tilt_dir[1]))
            ring.append(bm.verts.new((t * length + slant, p[0], p[1])))
        rings.append(ring)
    m = len(rings[0])
    # segment k joins perimeter points k and k+1; its material follows the points it joins
    seg_mat = []
    for k in range(m):
        k2 = (k + 1) % m
        seg_mat.append(0 if (kinds[k] == "bark" and kinds[k2] == "bark") else 1)
    for i in range(len(rings) - 1):
        for k in range(m):
            k2 = (k + 1) % m
            f = bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]))
            f.material_index = seg_mat[k]
            f.smooth = True
    for ring, flip in [(rings[0], True), (rings[-1], False)]:
        c = sum((v.co for v in ring), Vector()) / len(ring)
        cv = bm.verts.new(c)
        for k in range(m):
            k2 = (k + 1) % m
            tri = (cv, ring[k2], ring[k]) if flip else (cv, ring[k], ring[k2])
            f = bm.faces.new(tri)
            f.material_index = 2
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # hard edges where bark meets the riven top and around the sawn ends
    for e in bm.edges:
        e.smooth = len({f.material_index for f in e.link_faces}) == 1
    mesh = bpy.data.meshes.new(name + "Mesh")
    bm.to_mesh(mesh)
    bm.free()
    for mat in (bark_mat, split_mat, end_mat):
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    basis = Matrix((axis, side, local_up)).transposed()
    obj.matrix_world = Matrix.Translation(a) @ basis.to_4x4()
    return obj


# As in the film, the spirit sits on its firewood: two logs lie side by side,
# sunk about halfway into the ash, their split tops just under the flame's base
# so it rests on them. They reach a little past the flame on each side, where
# their sawn ends show.
log_top = -0.29             # the flame's underside rests here
log_r, log_cut = 0.46, 0.34     # only a narrow strip riven flat: they still read round
log_z = log_top - log_cut   # pith height
hearth_log("HearthLogFront", (-1.75, -0.47, log_z), (1.95, -0.56, log_z), log_r, log_cut, 11)
hearth_log("HearthLogBack", (-1.65, 0.50, log_z + 0.015), (1.85, 0.59, log_z + 0.015), log_r - 0.02, log_cut, 23)
ground_z = log_z - 0.04     # the ash comes up to just below the logs' middles
bpy.data.objects["HearthStone"].location.z = ground_z


# ---------------------------------------------------------------------------
# Bacon: broad strips shingled into one mass, painted in soft salmon and cream
# ---------------------------------------------------------------------------

# Everything here is in the pan's local frame (z = 0 is the pan floor). As in the
# film, the strips lie diagonally across the back of the pan, parallel to the line
# that divides them from the eggs, each one draped over the edge of the next.
PAN_WALL_R = [0.85, 0.90, 0.96, 1.00, 1.03]
PAN_WALL_Z = [0.00, 0.02, 0.08, 0.17, 0.22]
THICK = 0.03
WIDTH = 0.34
theta = 0.62
along = np.array([math.cos(theta), math.sin(theta)])
across = np.array([-math.sin(theta), math.cos(theta)])   # toward the back-left rim

yolks = []
for index in range(1, 5):
    egg = bpy.data.objects[f"Egg{index}"]
    yolk = bpy.data.objects[f"Egg{index}_Yolk"]
    c = (egg.matrix_basis @ yolk.matrix_basis).translation
    yolks.append((np.array([c.x, c.y]), max(yolk.dimensions.x, yolk.dimensions.y) / 2.0))

# height of whatever is under the bacon: pan floor and wall, egg whites, lower strips
H_RES, H_EXT = 320, 1.1
support = np.zeros((H_RES, H_RES))
gx = np.linspace(-H_EXT, H_EXT, H_RES)
hx, hy = np.meshgrid(gx, gx)
OIL_Z = 0.012   # the grease film sits just above the iron
support = np.maximum(support, np.maximum(OIL_Z, np.interp(np.hypot(hx, hy), PAN_WALL_R, PAN_WALL_Z)))


def splat(points_xy, z):
    ix = np.clip(((points_xy[:, 0] + H_EXT) / (2 * H_EXT) * (H_RES - 1)).round().astype(int), 0, H_RES - 1)
    iy = np.clip(((points_xy[:, 1] + H_EXT) / (2 * H_EXT) * (H_RES - 1)).round().astype(int), 0, H_RES - 1)
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            jx, jy = np.clip(ix + dx, 0, H_RES - 1), np.clip(iy + dy, 0, H_RES - 1)
            np.maximum.at(support, (jy, jx), z)


def support_at(xy):
    fx = (xy[..., 0] + H_EXT) / (2 * H_EXT) * (H_RES - 1)
    fy = (xy[..., 1] + H_EXT) / (2 * H_EXT) * (H_RES - 1)
    ix = np.clip(np.floor(fx).astype(int), 0, H_RES - 2)
    iy = np.clip(np.floor(fy).astype(int), 0, H_RES - 2)
    tx, ty = np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)
    a = support[iy, ix] * (1 - tx) + support[iy, ix + 1] * tx
    b = support[iy + 1, ix] * (1 - tx) + support[iy + 1, ix + 1] * tx
    return a * (1 - ty) + b * ty


for index in range(1, 5):
    egg = bpy.data.objects[f"Egg{index}"]
    m = egg.matrix_basis
    pts = np.array([(m @ v.co)[:] for v in egg.data.vertices])
    splat(pts[:, :2], pts[:, 2])


def fit_run(offset, max_len):
    """Longest stretch along the strip's line that stays in the pan and clear of the yolks."""
    ss = np.arange(-1.0, 1.0, 0.005)
    ok = np.ones_like(ss, dtype=bool)
    for i, sv in enumerate(ss):
        for t in np.linspace(-WIDTH / 2, WIDTH / 2, 9):
            q = offset * across + sv * along + t * across
            if np.hypot(*q) > 0.955 or any(np.hypot(*(q - c)) < r + 0.035 for c, r in yolks):
                ok[i] = False
                break
    best, cur, start = (0, 0), 0, 0
    for i, good in enumerate(ok):
        if good:
            if cur == 0:
                start = i
            cur += 1
            if cur > best[1] - best[0]:
                best = (start, i + 1)
        else:
            cur = 0
    s0, s1 = ss[best[0]], ss[best[1] - 1]
    length = min(s1 - s0, max_len)
    return (s0 + s1) / 2.0, length


# back strip first (it lies lowest), then the middle, then the front one on top
layout = [(3, 0.64, 1.10, 103), (2, 0.40, 1.30, 102), (1, 0.16, 1.30, 101)]
NU, NV = 96, 14
for index, offset, max_len, seed in layout:
    strip = bpy.data.objects[f"Bacon{index}"]
    centre_s, length = fit_run(offset, max_len)
    centre = offset * across + centre_s * along
    rs = np.random.default_rng(seed)
    ph = rs.uniform(0.0, 2.0 * math.pi, 6)
    # a grid over the strip whose outline wanders: the width breathes along the
    # length and the cut ends are rounded and a little ragged
    tu = np.linspace(0.0, 1.0, NU)[None, :]
    tv = np.linspace(-1.0, 1.0, NV)[:, None]
    end_in = 0.035 * tv ** 2 + 0.008 * np.sin(tv * 5.0 + ph[3])
    X = -length / 2 + end_in[:, :1] + tu * (length - 2.0 * end_in[:, :1])
    breathe = 1.0 + 0.06 * np.sin(2 * math.pi * X / 0.55 + ph[4]) + 0.03 * np.sin(2 * math.pi * X / 0.19 + ph[5])
    Y = tv * (WIDTH / 2) * breathe
    world = centre + X[..., None] * along + Y[..., None] * across
    floor = support_at(world) + THICK / 2 + 0.012
    # drape: relax toward the neighbours' average, never sinking below what's underneath
    Z = floor.copy()
    for _ in range(40):
        pad = np.pad(Z, 1, mode="edge")
        Z = np.maximum(floor, 0.25 * (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]))
    # gentle undulation along the strip, ruffled a little more at the long edges
    edge = (Y / (WIDTH / 2)) ** 2
    Z += 0.014 * np.sin(2 * math.pi * X / 0.32 + ph[0]) * (0.6 + 0.4 * np.sin(2 * math.pi * X / 0.9 + ph[1]))
    Z += 0.006 * np.sin(2 * math.pi * X / 0.12 + ph[2]) * edge
    Z = np.maximum(Z, floor - 0.004)   # z stays in the pan's frame; the object sits on the pan floor

    me = bpy.data.meshes.new(f"Bacon{index}Mesh")
    verts = [(float(X[j, i]), float(Y[j, i]), float(Z[j, i])) for j in range(NV) for i in range(NU)]
    faces = [(j * NU + i, j * NU + i + 1, (j + 1) * NU + i + 1, (j + 1) * NU + i)
             for j in range(NV - 1) for i in range(NU - 1)]
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name="UVMap")
    loop_vi = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_vi)
    uvs = np.stack([(np.arange(NU * NV) % NU) / (NU - 1), (np.arange(NU * NV) // NU) / (NV - 1)], -1)
    uv.data.foreach_set("uv", uvs[loop_vi].astype(np.float32).ravel())
    for poly in me.polygons:
        poly.use_smooth = True
    for mat in strip.data.materials:
        me.materials.append(mat)
    old = strip.data
    strip.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    strip.location = (float(centre[0]), float(centre[1]), 0.0)
    strip.rotation_euler = (0.0, 0.0, theta)
    for mod in strip.modifiers:
        if mod.type == "SOLIDIFY":
            mod.thickness = THICK
            mod.offset = 0.0
    # later (higher) strips drape over this one
    world_top = world.reshape(-1, 2)
    splat(world_top, (Z + THICK / 2).reshape(-1))


def paint_bacon(image, seed):
    """Streaky bacon as the film paints it: salmon lean, a few broad cream fat bands, soft edges.

    v runs across the strip (0 at the front edge, which is fat), u along it.
    """
    w, h = image.size
    u = np.linspace(0.0, 1.0, w)[None, :]
    v = np.linspace(0.0, 1.0, h)[:, None]
    n1 = fbm(h, w, 3, 10, seed, octaves=3)
    n2 = fbm(h, w, 5, 24, seed + 5, octaves=3)
    lean_deep = np.array([0.62, 0.19, 0.18])
    lean = np.array([0.78, 0.33, 0.30])
    lean_pink = np.array([0.88, 0.48, 0.44])
    rgb = mix(lean, lean_pink, smoothstep(-0.2, 0.6, n1) * 0.55)
    rgb = mix(rgb, lean_deep, smoothstep(0.2, 0.7, -n1) * 0.5)
    # long, faint muscle streaks
    streak = np.sin(v * 48.0 + 5.0 * n1 + 2.0 * np.sin(u * 7.0 + seed)) * 0.5 + 0.5
    rgb = mix(rgb, lean_pink, smoothstep(0.8, 1.0, streak) * 0.08)

    rs = np.random.default_rng(seed)
    fat_total = np.zeros((h, w))
    bands = [(0.05, 0.085, 0.015), (0.49, 0.095, 0.045), (0.86, 0.035, 0.03)]
    for (c, half_w, amp) in bands:
        phase = rs.uniform(0.0, 2.0 * math.pi)
        centre = c + amp * np.sin(2.0 * math.pi * 1.4 * u + phase) + 0.02 * n2
        half = half_w * (0.8 + 0.3 * (0.5 + 0.5 * np.sin(2.0 * math.pi * 0.9 * u + 2.0 * phase))) + 0.01 * n1
        dist = np.abs(v - centre) - half
        fat = 1.0 - smoothstep(-0.02, 0.012, dist)
        fat_total = np.maximum(fat_total, fat)
        # the lean blushes pink where it meets the fat
        rgb = mix(rgb, lean_pink, (1.0 - smoothstep(0.0, 0.05, dist)) * (1.0 - fat) * 0.5)
        creamy = mix(np.array([0.98, 0.90, 0.85]), np.array([0.93, 0.70, 0.64]), smoothstep(-0.55, 0.0, dist / half))
        rgb = mix(rgb, creamy, fat)
    # crisp edges: a caramel rim on the lean edge and the cut ends, a golden one on the fatty edge
    lean_edge = smoothstep(0.93, 1.0, v + 0.02 * n2)
    ends = 1.0 - smoothstep(0.0, 0.03, np.minimum(u, 1.0 - u) + 0.01 * n2)
    rgb = mix(rgb, np.array([0.62, 0.26, 0.17]), np.maximum(lean_edge, ends * (1.0 - fat_total * 0.5)) * 0.7)
    rgb = mix(rgb, np.array([0.93, 0.74, 0.56]), (1.0 - smoothstep(0.0, 0.03, v)) * 0.6)
    set_pixels(image, rgb)


for index in range(1, 4):
    paint_bacon(bpy.data.images[f"T_Bacon{index}"], 100 + index)


# ---------------------------------------------------------------------------
# Eggs: planar UVs over each reshaped white, clean white texture, lacy golden rim
# ---------------------------------------------------------------------------

def erode(mask):
    m = mask.copy()
    m[1:, :] &= mask[:-1, :]
    m[:-1, :] &= mask[1:, :]
    m[:, 1:] &= mask[:, :-1]
    m[:, :-1] &= mask[:, 1:]
    return m


def erode8(mask):
    m = erode(mask)
    m[1:, 1:] &= mask[:-1, :-1]
    m[:-1, :-1] &= mask[1:, 1:]
    m[1:, :-1] &= mask[:-1, 1:]
    m[:-1, 1:] &= mask[1:, :-1]
    return m


for index in range(1, 5):
    egg = bpy.data.objects[f"Egg{index}"]
    me = egg.data
    image = bpy.data.images[f"T_Egg{index}"]
    size = image.size[0]
    co = np.array([v.co[:] for v in me.vertices])
    lo, hi = co[:, :2].min(0), co[:, :2].max(0)
    centre = (lo + hi) / 2.0
    half = (hi - lo).max() / 2.0 * 1.04
    uv_vert = 0.5 + (co[:, :2] - centre) / (2.0 * half)
    uv_layer = me.uv_layers.active
    loop_vi = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_vi)
    uv_layer.data.foreach_set("uv", uv_vert[loop_vi].astype(np.float32).ravel())

    # rasterise the footprint of the white into texture space
    me.calc_loop_triangles()
    mask = np.zeros((size, size), dtype=bool)
    ys, xs = np.mgrid[0:size, 0:size]
    px = (xs + 0.5) / size
    py = (ys + 0.5) / size
    for tri in me.loop_triangles:
        p = uv_vert[list(tri.vertices)]
        x0, y0 = np.floor(p.min(0) * size).astype(int)
        x1, y1 = np.ceil(p.max(0) * size).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        qx = px[y0:y1 + 1, x0:x1 + 1]
        qy = py[y0:y1 + 1, x0:x1 + 1]
        (ax, ay), (bx, by), (cx, cy) = p
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-12:
            continue
        l1 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / det
        l2 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / det
        inside = (l1 >= -1e-4) & (l2 >= -1e-4) & (l1 + l2 <= 1.0 + 1e-4)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside

    # distance to the outline in texels (alternating 4/8 erosion approximates a disc)
    dist = np.zeros((size, size))
    cur = mask.copy()
    for k in range(1, 200):
        nxt = erode8(cur) if k % 2 else erode(cur)
        dist[cur & ~nxt] = k
        cur = nxt
        if not cur.any():
            break
    dist[cur] = 200
    dist = np.where(mask, dist, 0.0)

    # texel -> egg-local position, for the angle around the yolk
    yolk = bpy.data.objects[f"Egg{index}_Yolk"].location
    lx = centre[0] + (px - 0.5) * 2.0 * half - yolk.x
    ly = centre[1] + (py - 0.5) * 2.0 * half - yolk.y
    ang = np.arctan2(ly, lx)
    rs = np.random.default_rng(300 + index)
    ph = rs.uniform(0.0, 2.0 * math.pi, 4)
    # browning is uneven: heavier on one side, patchy all round
    brown = 0.45 + 0.35 * np.cos(ang - ph[0]) + 0.2 * np.sin(3.0 * ang + ph[1]) + 0.12 * np.sin(7.0 * ang + ph[2])
    brown = np.clip(brown, 0.08, 1.0)
    n1 = value_noise(size, size, 18, 18, 400 + index)
    n2 = value_noise(size, size, 60, 60, 410 + index)
    rim_px = size / (2.0 * half) * (0.008 + 0.034 * brown)      # rim width in texels
    e = (dist + 3.0 * n1 + 1.5 * n2) / rim_px

    white = np.array([0.985, 0.978, 0.955])
    rgb = np.broadcast_to(white, (size, size, 3)).copy()
    # the thick white near the yolk is a touch creamier, the thin outer white a touch cooler
    r_yolk = np.hypot(lx, ly)
    rgb = mix(rgb, np.array([0.995, 0.965, 0.90]), np.exp(-(r_yolk / 0.12) ** 2) * 0.5)
    rgb = mix(rgb, np.array([0.95, 0.955, 0.965]), smoothstep(1.2, 3.5, e) * (1.0 - smoothstep(3.5, 7.0, e)) * 0.35)
    # golden lace: pale gold -> amber -> deep brown at the very edge
    rgb = mix(rgb, np.array([0.98, 0.88, 0.66]), 1.0 - smoothstep(0.9, 1.6, e))
    rgb = mix(rgb, np.array([0.88, 0.62, 0.30]), (1.0 - smoothstep(0.35, 0.95, e)) * (0.55 + 0.45 * brown))
    rgb = mix(rgb, np.array([0.55, 0.30, 0.12]), (1.0 - smoothstep(0.0, 0.35, e)) * brown)
    # little blistered bubbles in the crisp zone
    cell = 11
    gy, gx = ys // cell, xs // cell
    hsh = np.random.default_rng(500 + index).uniform(0.0, 1.0, (size // cell + 2, size // cell + 2, 4))
    hc = hsh[gy, gx]
    cxp = (gx + 0.2 + 0.6 * hc[..., 0]) * cell
    cyp = (gy + 0.2 + 0.6 * hc[..., 1]) * cell
    br = 1.2 + 2.8 * hc[..., 2]
    bd = np.hypot(xs - cxp, ys - cyp)
    live = (hc[..., 3] < 0.35) & (e > 0.25) & (e < 2.0)
    bubble = live & (bd < br)
    ring = live & (np.abs(bd - br) < 0.9)
    rgb = np.where(bubble[..., None], mix(rgb, np.array([1.0, 0.95, 0.82]), 0.55), rgb)
    rgb = np.where(ring[..., None], mix(rgb, np.array([0.66, 0.42, 0.18]), 0.42), rgb)
    rgb = np.where(mask[..., None], rgb, np.array([0.55, 0.30, 0.12]))
    set_pixels(image, rgb)
    me.update()


scene["likeness_v1"] = True
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print("Saved likeness pass to", bpy.data.filepath)
