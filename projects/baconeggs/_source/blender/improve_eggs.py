"""One-time egg art pass for hearth.blend.

Run from the repository root:
    blender -b projects/baconeggs/_source/blender/hearth.blend \
      --python projects/baconeggs/_source/blender/improve_eggs.py

The script saves the .blend file. Re-export hearth.glb with export_glb.py.
"""

import math

import bpy
import numpy as np


scene = bpy.context.scene
if scene.get("egg_art_v1"):
    print("Egg art pass already applied")
    raise SystemExit(0)


def smoothstep(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def set_pixels(image, rgb):
    h, w = image.size[1], image.size[0]
    rgba = np.empty((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0.0, 1.0)
    rgba[:, :, 3] = 1.0
    image.pixels.foreach_set(rgba.ravel())
    image.update()
    image.pack()


# Egg whites spread asymmetrically into one another, as fried eggs do. Preserve
# object transforms and child yolks for the renderer's refill animation.
egg_scales = [(1.25, 1.20), (1.24, 1.25), (1.30, 1.13), (1.22, 1.22)]
yolk_scales = [(1.35, 1.02), (1.05, 1.34), (1.28, 1.06), (1.19, 0.99)]
yolk_offsets = [(-0.025, 0.008), (0.02, -0.015), (-0.01, 0.022), (0.018, -0.01)]
for index in range(1, 5):
    egg = bpy.data.objects[f"Egg{index}"]
    sx, sy = egg_scales[index - 1]
    for vertex in egg.data.vertices:
        x, y, z = vertex.co
        angle = math.atan2(y, x)
        radius = min(1.0, math.hypot(x / 0.27, y / 0.27))
        edge = max(0.0, (radius - 0.55) / 0.45)
        ripple = 1.0 + edge * (
            0.052 * math.sin(5.0 * angle + index * 1.8)
            + 0.027 * math.sin(9.0 * angle - index * 0.9)
        )
        vertex.co.x = x * sx * ripple + 0.015 * edge * math.sin(index * 2.1)
        vertex.co.y = y * sy * ripple - 0.012 * edge * math.cos(index * 1.7)
        vertex.co.z = z
    egg.data.update()
    yolk = bpy.data.objects[f"Egg{index}_Yolk"]
    yolk.scale.x *= yolk_scales[index - 1][0]
    yolk.scale.y *= yolk_scales[index - 1][1]
    yolk.scale.z *= 0.88
    yolk.location.x += yolk_offsets[index - 1][0]
    yolk.location.y += yolk_offsets[index - 1][1]

# Let the whites touch and pool without moving them beyond the skillet rim.
for name, dx, dy in [
    ("Egg2", -0.055, -0.025),
    ("Egg3", -0.025, 0.045),
    ("Egg4", -0.035, 0.02),
]:
    egg = bpy.data.objects[name]
    egg.location.x += dx
    egg.location.y += dy


# Warm translucent whites with a few soft coral oil streaks, strongest on the
# egg closest to the viewer. Retain the existing irregular, crisp outer rims.
for index in range(1, 5):
    image = bpy.data.images[f"T_Egg{index}"]
    w, h = image.size
    rgba = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(rgba)
    rgb = rgba.reshape((h, w, 4))[:, :, :3].copy()
    x = np.linspace(-1.0, 1.0, w, dtype=np.float32)[None, :]
    y = np.linspace(-1.0, 1.0, h, dtype=np.float32)[:, None]
    pale = smoothstep(0.77, 0.92, rgb.mean(axis=-1))
    yolk_halo = np.exp(-((x - 0.06) ** 2 + (y + 0.02) ** 2) / 0.23)
    rgb = rgb * (1.0 - (0.07 * pale * yolk_halo)[..., None]) + np.array([1.0, 0.83, 0.67]) * (0.07 * pale * yolk_halo)[..., None]
    vein_y = -0.28 + 0.13 * np.sin(4.5 * x + index * 0.8)
    vein = np.exp(-((y - vein_y) / 0.07) ** 2) * np.exp(-((x + 0.08) / 0.70) ** 4)
    vein += 0.55 * np.exp(-((y - 0.20 - 0.08 * np.sin(5.0 * x - index)) / 0.05) ** 2)
    strength = (0.29 if index == 3 else 0.15) * pale * np.clip(vein, 0.0, 1.0)
    rgb = rgb * (1.0 - strength[..., None]) + np.array([1.0, 0.53, 0.46]) * strength[..., None]
    set_pixels(image, rgb)


scene["egg_art_v1"] = True
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print("Saved improved egg art to", bpy.data.filepath)
