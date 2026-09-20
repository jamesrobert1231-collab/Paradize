import bpy
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(root/'.build/characters/human-candidate.blend'))
scene=bpy.context.scene
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'
scene.display.shading.color_type='TEXTURE'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD'
scene.world.color=(.06,.06,.07)
bpy.ops.object.camera_add(location=(2,-4,1.6))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,.9))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=2.15
scene.camera=camera
scene.render.resolution_x=600
scene.render.resolution_y=700
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(root/'.build/characters/human-candidate.png')
bpy.ops.render.render(write_still=True)
