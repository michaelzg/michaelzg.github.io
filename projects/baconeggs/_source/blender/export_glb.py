"""Re-export the Blender scene to projects/baconeggs/hearth.glb, the model the page loads.

Run from the projects/baconeggs/ folder:

    blender -b _source/blender/hearth.blend --python _source/blender/export_glb.py
"""
import os

import bpy

here = os.path.dirname(os.path.abspath(bpy.data.filepath))
out = os.path.normpath(os.path.join(here, "..", "..", "hearth.glb"))
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_apply=True,        # bake modifiers (pan thickness/smoothing, bacon thickness)
    export_yup=True,
    export_cameras=False,
    export_lights=False,
    export_animations=False,  # all motion is procedural, in the Rust app
)
print("wrote", out)
