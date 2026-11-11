"""Export the MiCar card from Blender: the model the browser draws, and one still per foil.

Run inside Blender after tools/blender/build_card.py built the card (it is built here if it is not there yet), then
`export_all()`. Writes into apps/value/public/cards/:

  card.glb              the card with its modifiers applied: Y up, the face toward +Z, metres. Three primitives, one
                        per material ("MiCar Card Face", "MiCar Card Rim", "MiCar Card Back"), each with positions,
                        normals and UVs. No images, no animation, no Draco: packages/holo/src/glb.ts reads exactly this.
  back-<foil>.webp      four stills, 720 x 960 on a transparent background, framed the way the browser frames the
                        live card (24 degree lens, the card 72% of the height) and tilted a little so the foil shows.
                        They stand in where WebGL cannot run and are the tiles of the four-backs page.

Fails loudly (RuntimeError) on a file over budget, a model that is not what the reader expects, or a card that has
been moved off the origin.

A second export of the same build is the same model but not always the same bytes: the rim's UVs, which nothing
reads, were seen to differ in their last bit from one run to the next (measured over six runs in Blender 5.3; every
other byte matched). So compare models by what packages/holo/src/glb.test.ts checks, not by the file's hash.
"""
import json
import math
import os
import struct

import bpy

REPO = os.environ.get('MICAR_REPO', r'C:\Users\Owner\Micar-com')
OUT = os.path.join(REPO, 'apps', 'value', 'public', 'cards')
BUDGET = {'glb': 100_000, 'still': 150_000}
STILL_SIZE = (720, 960)
STILL_QUALITY = 84
FOV_Y = math.radians(24)          # the browser's camera: packages/holo/src/card.ts
FILL = 0.72                       # the card's share of the picture's height
POSE = (math.radians(-6), math.radians(10))   # pitch, yaw: the top and the right edge a little away


def _build_ns():
    path = os.path.join(REPO, 'tools', 'blender', 'build_card.py')
    ns = {}
    with open(path, encoding='utf-8') as f:
        exec(compile(f.read(), path, 'exec'), ns)
    return ns


NS = _build_ns()
CARD, FACE, RIM, BACK = NS['CARD'], NS['FACE'], NS['RIM'], NS['BACK']
FOIL_KINDS = NS['FOIL_KINDS']


def _card():
    card = bpy.data.objects.get(CARD) or NS['build_card']()
    flat = [round(v, 6) for row in card.matrix_world for v in row]
    if flat != [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]:
        raise RuntimeError('"%s" has been moved, turned or scaled: the model is exported as it lies at the origin' % CARD)
    return card


def read_glb(path):
    """The JSON chunk of a .glb and the size of its binary chunk, checking the container as it goes."""
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise RuntimeError('%s is not a glTF 2 binary' % path)
    json_len, json_kind = struct.unpack_from('<I4s', data, 12)
    if json_kind != b'JSON':
        raise RuntimeError('%s does not start with a JSON chunk' % path)
    doc = json.loads(data[20:20 + json_len].decode('utf-8'))
    rest = 20 + json_len
    bin_len = struct.unpack_from('<I', data, rest)[0] if rest < len(data) else 0
    return doc, bin_len


def check_glb(path):
    """Refuse a model packages/holo/src/glb.ts could not read; return what is in it."""
    doc, bin_len = read_glb(path)
    for key in ('extensionsRequired', 'images', 'textures', 'animations', 'skins'):
        if doc.get(key):
            raise RuntimeError('card.glb carries %s, which the card does not use' % key)
    meshes = doc.get('meshes', [])
    if len(meshes) != 1:
        raise RuntimeError('card.glb has %d meshes, not one' % len(meshes))
    parts = {}
    for primitive in meshes[0]['primitives']:
        name = doc['materials'][primitive['material']]['name']
        attributes = primitive['attributes']
        for needed in ('POSITION', 'NORMAL', 'TEXCOORD_0'):
            if needed not in attributes:
                raise RuntimeError('the "%s" part has no %s' % (name, needed))
        if 'indices' not in primitive or primitive.get('mode', 4) != 4:
            raise RuntimeError('the "%s" part is not an indexed triangle list' % name)
        parts[name] = {'vertices': doc['accessors'][attributes['POSITION']]['count'], 'triangles': doc['accessors'][primitive['indices']]['count'] // 3}
    if sorted(parts) != sorted((FACE, RIM, BACK)):
        raise RuntimeError('card.glb has the parts %s, not the face, the rim and the back' % sorted(parts))
    for node in doc.get('nodes', []):
        if any(key in node for key in ('translation', 'rotation', 'scale', 'matrix')):
            raise RuntimeError('card.glb moves the card with a node transform; the reader takes the vertices as they are')
    size = os.path.getsize(path)
    if size > BUDGET['glb']:
        raise RuntimeError('card.glb is %d bytes, over the %d byte budget' % (size, BUDGET['glb']))
    return {'bytes': size, 'binary_bytes': bin_len, 'parts': parts}


def export_glb():
    card = _card()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'card.glb')
    layer = bpy.context.view_layer
    was_hidden = (card.hide_viewport, card.hide_get() if card.name in layer.objects else False)
    was_selected = [o for o in layer.objects if o.select_get()]
    was_active = layer.objects.active
    try:
        card.hide_viewport = False
        layer.update()
        card.hide_set(False)
        for o in layer.objects:
            o.select_set(False)
        card.select_set(True)
        layer.objects.active = card
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
            export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
            export_image_format='NONE', export_vertex_color='NONE', export_all_vertex_colors=False,
            export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False,
            export_extras=False, export_draco_mesh_compression_enable=False, will_save_settings=False)
    finally:
        card.select_set(False)
        card.hide_set(was_hidden[1])
        card.hide_viewport = was_hidden[0]
        for o in was_selected:
            if o.name in layer.objects:
                o.select_set(True)
        layer.objects.active = was_active
    return check_glb(path)


def render_stills():
    """One still per foil, in a scene of its own so nothing in the working scene is touched."""
    card = _card()
    img = bpy.data.images[NS['ART_IMAGE']]
    table = NS['read_foils']()
    height = card.dimensions.z if card.dimensions.z > 0 else NS['WIDTH'] * img.size[1] / img.size[0]
    os.makedirs(OUT, exist_ok=True)
    scene = bpy.data.scenes.new('MiCar Card Stills')
    made = []
    written = {}
    try:
        scene.world = NS['studio']()
        scene.view_settings.view_transform = 'Standard'
        scene.render.resolution_x, scene.render.resolution_y = STILL_SIZE
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        settings = scene.render.image_settings
        if hasattr(settings, 'media_type'):
            settings.media_type = 'IMAGE'
        settings.file_format = 'WEBP'
        settings.color_mode = 'RGBA'
        settings.quality = STILL_QUALITY

        lens = bpy.data.cameras.new('MiCar Card Still Camera')
        lens.sensor_fit = 'VERTICAL'
        lens.angle_y = FOV_Y
        lens.clip_start = 0.01
        lens.clip_end = 10
        camera = bpy.data.objects.new('MiCar Card Still Camera', lens)
        scene.collection.objects.link(camera)
        camera.location = (0.0, -height / (2.0 * FILL * math.tan(FOV_Y / 2.0)), 0.0)
        camera.rotation_euler = (math.radians(90), 0.0, 0.0)
        scene.camera = camera
        made.append(camera)

        for kind in FOIL_KINDS:
            obj = card.copy()
            obj.data = card.data.copy()
            obj.name = 'MiCar Card still ' + kind
            obj.animation_data_clear()
            obj.hide_viewport = False
            obj.hide_render = False
            obj.location = (0.0, 0.0, 0.0)
            obj.rotation_euler = (POSE[0], 0.0, POSE[1])
            obj.data.materials[0] = NS['foil_material'](kind, img, table[kind])
            scene.collection.objects.link(obj)
            path = os.path.join(OUT, 'back-%s.webp' % kind)
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True, scene=scene.name)
            scene.collection.objects.unlink(obj)
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)
            size = os.path.getsize(path)
            if size > BUDGET['still']:
                raise RuntimeError('back-%s.webp is %d bytes, over the %d byte budget' % (kind, size, BUDGET['still']))
            written['back-%s.webp' % kind] = size
    finally:
        for obj in made:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.cameras.remove(data)
        bpy.data.scenes.remove(scene)
    return written


def export_all():
    model = export_glb()
    stills = render_stills()
    return {'dir': OUT, 'card.glb': model, 'stills': stills}
