"""Add the skillet rim to hearth.blend.

Run once from the repository root, then run export_glb.py. The rim keeps its own
material so the Rust renderer can shade it as polished iron. The hearth logs come
from refine_likeness.py.
"""

import bpy


scene = bpy.context.scene
if scene.get("hearth_art_v1"):
    print("Hearth art pass already applied")
    raise SystemExit(0)


def material(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


iron_rim = material("M_IronRim")

# A rounded cast-iron lip catches a restrained highlight at the pan edge.
bpy.ops.mesh.primitive_torus_add(
    major_segments=64,
    minor_segments=8,
    location=(0.0, 0.0, 0.0),
    major_radius=1.005,
    minor_radius=0.052,
)
rim = bpy.context.object
rim.name = "PanRim"
rim.data.materials.append(iron_rim)
rim.parent = bpy.data.objects["Pan"]
rim.location = (0.0, 0.0, 0.168)

scene["hearth_art_v1"] = True
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print("Saved hearth art to", bpy.data.filepath)
