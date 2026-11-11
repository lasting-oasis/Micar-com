"""Build the MiCar card in Blender (5.x): the physical card the Garage's card back draws, and a preview of its foils.

The card is 63 mm wide, as tall as the artwork's own proportions make it (87.86 mm) and 1 mm thick, with corners
rounded to follow the frame drawn in the artwork and a bevelled edge. The artwork (assets/cards/micar-card-back.png)
is mapped flat onto the face, uncropped. It is never edited: this script only reads it.
tools/blender/export_card.py writes the model and the stills the site ships.

Run inside Blender (Text editor, or exec(compile(open(path).read(), path, 'exec')) through the MCP connection), then
`build_card()`, `build_preview()` and `report()`. Idempotent: each builder clears its own collection first, and build_card() clears the preview with it.

`build_card()`     the export object "MiCar Card" in the collection "MiCar Card": upright in the XZ plane, facing -Y
                   (the front view) and centred on the origin, so the glTF Y-up conversion leaves it in XY facing +Z,
                   toward the browser's camera. Three materials: the face, the rim, the back.
`build_preview()`  four copies side by side in "MiCar Card Preview", one per foil, their materials built from
                   packages/holo/src/foils.json (the same numbers the browser's shader reads), with a neutral studio,
                   a camera and a 96-frame tilt. Put the mouse over the 3D view and press Space to watch them move.
                   It sets the scene it runs in: world, camera, frame range and the Standard view transform (so the
                   artwork's colours are shown as they are). Run it in a scene of its own.

The preview materials follow the recipe in docs/superpowers/specs/2026-11-11-holo-card-back-design.md. Every colour
comes from the half vector between the eye and one fixed key light, taken into the card's own frame, so the foil
answers the card's real angle and nothing is driven by the clock. Blender ray-traces a studio and the browser
evaluates a small procedural one, so the two are close, not identical: this scene is the reference the shader is
tuned against by eye.
"""
import json
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector

REPO = os.environ.get('MICAR_REPO', r'C:\Users\Owner\Micar-com')
ART = os.path.join(REPO, 'assets', 'cards', 'micar-card-back.png')
FOILS = os.path.join(REPO, 'packages', 'holo', 'src', 'foils.json')

WIDTH = 0.063            # metres: a standard trading card is 63 mm wide
THICKNESS = 0.0010
BEVEL = 0.00025
CORNER_SEGMENTS = 16
CARD = 'MiCar Card'
CARD_COLLECTION = 'MiCar Card'
PREVIEW_COLLECTION = 'MiCar Card Preview'
FACE, RIM, BACK = 'MiCar Card Face', 'MiCar Card Rim', 'MiCar Card Back'
ART_IMAGE = 'micar-card-back'
STUDIO = 'MiCar Card Studio'
CAMERA = 'MiCar Card Camera'
FOIL_KINDS = ('gloss', 'holo', 'rainbow', 'prismatic')
# Which rarities carry each foil: mirrors foilForRarity() in packages/holo/src/foils.ts.
FOIL_TIERS = {'gloss': 'COMMON  ·  UNCOMMON', 'holo': 'RARE', 'rainbow': 'EPIC', 'prismatic': 'LEGENDARY  ·  MYTHIC  ·  ONE-OF-ONE'}
FOIL_NAMES = {'gloss': 'gloss only', 'holo': 'standard holo', 'rainbow': 'full-spectrum rainbow', 'prismatic': 'refractive prismatic'}
# The key light, from the card toward the light, in Blender's axes (the card faces -Y, z is up).
# The browser's shader uses the same light in its own axes: normalize(-0.30, 0.45, 0.84).
KEY_LIGHT = (-0.30, -0.84, 0.45)
TILT = math.radians(16)  # the preview rocks through what a finger can tilt the card on the phone
# The studio. At this strength and turn, with ART_EMISSION of the artwork's own light, the gloss card seen flat-on
# measures as bright as the artwork itself (mean luminance ratio 1.00), and the HDRI's big softbox is out of the
# mirror direction at rest, so it does not wash the art out. Measured in Blender 5.3; change one and re-measure.
STUDIO_STRENGTH = 0.3
STUDIO_TURN = math.radians(180)
ART_EMISSION = 0.55
SQRT3 = math.sqrt(3.0)


# ---------------------------------------------------------------- the artwork ----

def load_art():
    """The master artwork as an image in this file, packed so the scene does not depend on the path."""
    old = bpy.data.images.get(ART_IMAGE)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.load(ART)
    img.name = ART_IMAGE
    img.colorspace_settings.name = 'sRGB'
    img.pack()
    return img


def measure_corner_radius(img):
    """The radius to cut the card's corners at, as a fraction of its width, read off the artwork.

    The art is a frame with rounded corners inside a thin dark margin. For each corner: the margin is how far the
    frame's bright outer edge sits from the two image edges beside it, and the frame's own radius follows from how far
    along the diagonal that edge is first met (a corner of radius r set in by m is met at m + r (1 - 1/sqrt 2)). A cut
    of radius r + m is concentric with the frame and leaves the margin around it. The smallest of the four is used, so
    the cut can never bite into the frame.
    """
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1]                     # Blender keeps rows bottom-up; make row 0 the top
    lum = px[:, :, 0] * 0.2126 + px[:, :, 1] * 0.7152 + px[:, :, 2] * 0.0722
    bright = 0.5

    def first_bright(line):
        hits = np.nonzero(line > bright)[0]
        return int(hits[0]) if len(hits) else None

    def margin(side):
        found = []
        if side in ('left', 'right'):
            for y in range(int(h * 0.4), int(h * 0.6), 4):
                row = lum[y] if side == 'left' else lum[y, ::-1]
                found.append(first_bright(row[: w // 4]))
        else:
            for x in range(int(w * 0.4), int(w * 0.6), 4):
                col = lum[:, x] if side == 'top' else lum[::-1, x]
                found.append(first_bright(col[: h // 4]))
        found = [v for v in found if v is not None]
        if not found:
            raise RuntimeError('no frame found along the %s side of the artwork' % side)
        return float(np.median(found))

    margins = {side: margin(side) for side in ('left', 'right', 'top', 'bottom')}
    reach = 1.0 - 1.0 / math.sqrt(2.0)
    cuts = {}
    for corner, (sx, sy) in {'tl': ('left', 'top'), 'tr': ('right', 'top'), 'bl': ('left', 'bottom'), 'br': ('right', 'bottom')}.items():
        a = lum[::-1] if sy == 'bottom' else lum
        a = a[:, ::-1] if sx == 'right' else a
        met = first_bright(np.array([a[i, i] for i in range(min(w, h) // 4)]))
        if met is None:
            raise RuntimeError('no frame found on the diagonal of the %s corner' % corner)
        m = (margins[sx] + margins[sy]) / 2.0
        cuts[corner] = (met - m) / reach + m
    fraction = min(cuts.values()) / w
    if not 0.03 <= fraction <= 0.10:
        raise RuntimeError('measured corner radius %.4f of the width is not a card corner' % fraction)
    return fraction


# ------------------------------------------------------------------- the card ----

def _in_use(data):
    """Whether any object still uses this data. The objects are asked, not the user count: the glTF exporter
    (5.3) leaves a count behind on a mesh it has exported, which would keep a dead mesh, and its name, for ever."""
    return any(obj.data == data for obj in bpy.data.objects)


def _drop_collection(name):
    """Remove a collection this script made, with its objects and whatever data only they used."""
    coll = bpy.data.collections.get(name)
    if coll is None:
        return
    used = []
    for obj in list(coll.objects):
        if obj.data is not None and obj.data not in used:
            used.append(obj.data)
        bpy.data.objects.remove(obj, do_unlink=True)
    for data in used:
        if not _in_use(data):
            (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.curves if isinstance(data, bpy.types.Curve) else bpy.data.cameras).remove(data)
    bpy.data.collections.remove(coll)


def _fresh_collection(name):
    _drop_collection(name)
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def _material(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (400, 300)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (100, 300)
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return mat, nt, bsdf


def _plain(name, colour, metallic, roughness):
    mat, _, bsdf = _material(name)
    bsdf.inputs['Base Color'].default_value = colour
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def _card_mesh(name, width, height, radius):
    """A rounded rectangle in the XZ plane facing -Y, with the artwork's UVs: u across the width, v up the height."""
    points = []
    for cx, cz, start in ((width / 2 - radius, -height / 2 + radius, -90), (width / 2 - radius, height / 2 - radius, 0),
                          (-width / 2 + radius, height / 2 - radius, 90), (-width / 2 + radius, -height / 2 + radius, 180)):
        for i in range(CORNER_SEGMENTS + 1):
            a = math.radians(start + 90.0 * i / CORNER_SEGMENTS)
            points.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, 0.0, z)) for x, z in points])
    bm.normal_update()
    if face.normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=[face])
    uv = bm.loops.layers.uv.new('UVMap')
    for loop in face.loops:
        loop[uv].uv = (loop.vert.co.x / width + 0.5, loop.vert.co.z / height + 0.5)
    face.smooth = True
    stale = bpy.data.meshes.get(name)
    if stale is not None and not _in_use(stale):
        bpy.data.meshes.remove(stale)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def _modifiers(obj):
    """Thickness, the bevelled edge and clean shading, as modifiers so each stays adjustable in the panel."""
    solid = obj.modifiers.new('Thickness', 'SOLIDIFY')
    solid.thickness = THICKNESS
    solid.offset = -1.0
    solid.use_rim = True
    solid.use_even_offset = True
    solid.material_offset = 2          # the far side takes the third material (the back)
    solid.material_offset_rim = 1      # the edge takes the second (the rim)
    bevel = obj.modifiers.new('Edge bevel', 'BEVEL')
    bevel.width = BEVEL
    bevel.segments = 3
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = math.radians(40)
    normals = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    normals.mode = 'FACE_AREA'
    normals.weight = 100
    normals.keep_sharp = False


def build_card():
    """The export object: one card at the origin with the face, rim and back materials.

    Also clears the preview, which was made from the card this replaces: run build_preview() again after it.
    """
    _drop_collection(PREVIEW_COLLECTION)
    img = load_art()
    fraction = measure_corner_radius(img)
    height = WIDTH * img.size[1] / img.size[0]
    coll = _fresh_collection(CARD_COLLECTION)
    mesh = _card_mesh('MiCarCardMesh', WIDTH, height, WIDTH * fraction)
    obj = bpy.data.objects.new(CARD, mesh)
    coll.objects.link(obj)
    mesh.materials.append(foil_material('gloss', img, None, FACE))
    mesh.materials.append(_plain(RIM, (0.80, 0.82, 0.86, 1.0), 1.0, 0.26))
    mesh.materials.append(_plain(BACK, (0.020, 0.022, 0.030, 1.0), 0.0, 0.5))
    _modifiers(obj)
    obj['corner_fraction'] = fraction
    obj['corner_radius_mm'] = WIDTH * fraction * 1000.0
    return obj


# ------------------------------------------------------------- the foil preview ----

class _Graph:
    """Lays a node graph out left to right and keeps the wiring short to write."""

    def __init__(self, nt):
        self.nt = nt
        self.count = 0

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        n.location = (-2600 + (self.count % 10) * 200, 900 - (self.count // 10) * 230)
        self.count += 1
        for key, value in props.items():
            setattr(n, key, value)
        return n

    def put(self, socket, value):
        if value is None:
            return
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, socket)
        else:
            socket.default_value = value

    def m(self, op, a, b=None, c=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, value in enumerate((a, b, c)):
            self.put(n.inputs[i], value)
        return n.outputs[0]

    def v(self, op, a, b=None, scale=None, out=0):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self.put(n.inputs[0], a)
        self.put(n.inputs[1], b)
        if scale is not None:
            self.put(n.inputs[3], scale)
        return n.outputs[out]

    def xyz(self, x=0.0, y=0.0, z=0.0):
        n = self.node('ShaderNodeCombineXYZ')
        self.put(n.inputs[0], x)
        self.put(n.inputs[1], y)
        self.put(n.inputs[2], z)
        return n.outputs[0]

    def sep(self, vec):
        n = self.node('ShaderNodeSeparateXYZ')
        self.put(n.inputs[0], vec)
        return n.outputs

    def hsv(self, hue, sat, val=1.0):
        n = self.node('ShaderNodeCombineColor', mode='HSV')
        self.put(n.inputs[0], hue)
        self.put(n.inputs[1], sat)
        self.put(n.inputs[2], val)
        return n.outputs[0]

    def art(self, img, uv, label='Artwork (untouched)'):
        n = self.node('ShaderNodeTexImage', image=img, extension='EXTEND', interpolation='Cubic', label=label)
        self.put(n.inputs[0], uv)
        return n.outputs[0]

    def lum(self, colour):
        n = self.node('ShaderNodeRGBToBW')
        self.put(n.inputs[0], colour)
        return n.outputs[0]

    def smooth(self, value, lo, hi, to_min=0.0, to_max=1.0):
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.put(n.inputs[0], value)
        n.inputs[1].default_value = lo
        n.inputs[2].default_value = hi
        n.inputs[3].default_value = to_min
        n.inputs[4].default_value = to_max
        return n.outputs[0]


def _phase(g, half, uv, grating, sweep, across, bands, extra=None):
    """dot(half, grating) * sweep + dot(uv, across) * bands (+ extra): where on the spectrum this point sits."""
    a = g.v('DOT_PRODUCT', half, (grating[0], grating[1], 0.0), out=1)
    b = g.v('DOT_PRODUCT', uv, (across[0], across[1], 0.0), out=1)
    p = g.m('MULTIPLY_ADD', a, sweep, g.m('MULTIPLY', b, bands))
    return g.m('ADD', p, extra) if extra is not None else p


def _band(g, phase):
    """A soft brightness band riding on the colour bands: (0.5 + 0.5 cos(pi phase)) squared."""
    return g.m('POWER', g.m('MULTIPLY_ADD', g.m('COSINE', g.m('MULTIPLY', phase, math.pi)), 0.5, 0.5), 2.0)


def foil_material(kind, img, q, name=None):
    """The face material for one foil. `q` is that foil's row of foils.json (unused for gloss)."""
    mat, nt, bsdf = _material(name or 'MiCar Foil ' + kind)
    g = _Graph(nt)
    uv = g.node('ShaderNodeTexCoord').outputs['UV']
    bsdf.inputs['Coat Weight'].default_value = 1.0
    bsdf.inputs['Coat Roughness'].default_value = 0.035
    bsdf.inputs['Roughness'].default_value = 0.34
    bsdf.inputs['Emission Strength'].default_value = 1.0
    if kind == 'gloss':
        art = g.art(img, uv)
        nt.links.new(art, bsdf.inputs['Base Color'])
        nt.links.new(g.v('SCALE', art, scale=ART_EMISSION), bsdf.inputs['Emission Color'])
        return mat

    width_mm = WIDTH * 1000.0
    height_mm = width_mm * img.size[1] / img.size[0]
    aspect = height_mm / width_mm
    # The half vector between the eye and the key light, in the card's own frame (x to its right, y up it).
    geometry = g.node('ShaderNodeNewGeometry')
    light = g.v('NORMALIZE', KEY_LIGHT)
    half_world = g.v('NORMALIZE', g.v('ADD', geometry.outputs['Incoming'], light))
    to_card = g.node('ShaderNodeVectorTransform', vector_type='VECTOR', convert_from='WORLD', convert_to='OBJECT')
    g.put(to_card.inputs[0], half_world)
    parts = g.sep(to_card.outputs[0])
    half = g.xyz(parts[0], parts[2], 0.0)
    square = g.v('MULTIPLY', uv, (1.0, aspect, 0.0))
    noise = g.node('ShaderNodeTexNoise', noise_dimensions='2D')
    g.put(noise.inputs['Vector'], square)
    noise.inputs['Scale'].default_value = 420.0
    noise.inputs['Detail'].default_value = 1.0
    grain = g.m('MULTIPLY', g.m('SUBTRACT', noise.outputs[0], 0.5), 0.14)

    if kind == 'prismatic':
        # A lattice of triangular facets `cell` millimetres across, each with its own random tilt.
        p = g.sep(g.v('SCALE', g.v('MULTIPLY', uv, (width_mm, height_mm, 0.0)), scale=1.0 / q['cell']))
        b_ = g.m('MULTIPLY', p[1], 2.0 / SQRT3)
        a_ = g.m('SUBTRACT', p[0], g.m('MULTIPLY', b_, 0.5))
        fa = g.m('FRACT', a_)
        fb = g.m('FRACT', b_)
        s_ab = g.m('ADD', fa, fb)
        upper_half = g.m('GREATER_THAN', s_ab, 1.0)
        white = g.node('ShaderNodeTexWhiteNoise', noise_dimensions='3D')
        g.put(white.inputs['Vector'], g.xyz(g.m('FLOOR', a_), g.m('FLOOR', b_), upper_half))
        random = white.outputs[1]
        tilt = g.v('MULTIPLY', g.v('SCALE', g.v('SUBTRACT', random, (0.5, 0.5, 0.5)), scale=2.0), (1.0, 1.0, 0.0))
        lower = g.m('MINIMUM', g.m('MINIMUM', fa, fb), g.m('SUBTRACT', 1.0, s_ab))
        upper = g.m('MINIMUM', g.m('MINIMUM', g.m('SUBTRACT', 1.0, fa), g.m('SUBTRACT', 1.0, fb)), g.m('SUBTRACT', s_ab, 1.0))
        edge = g.smooth(g.m('ADD', lower, g.m('MULTIPLY', upper_half, g.m('SUBTRACT', upper, lower))), 0.0, q['edge'])
        # The art is seen through each facet a little displaced, its colours pulled slightly apart. The displacement
        # fades to nothing near the card's border so the frame of the art stays crisp.
        us = g.sep(uv)
        du = g.m('MINIMUM', us[0], g.m('SUBTRACT', 1.0, us[0]))
        dv = g.m('MULTIPLY', g.m('MINIMUM', us[1], g.m('SUBTRACT', 1.0, us[1])), aspect)
        fade = g.smooth(g.m('MINIMUM', du, dv), 0.03, 0.10)
        displaced = g.v('SCALE', tilt, scale=fade)

        def refracted(k):
            return g.v('ADD', uv, g.v('MULTIPLY', displaced, (q['refr'] * k, q['refr'] * k / aspect, 0.0)))

        channels = [g.node('ShaderNodeSeparateColor') for _ in range(3)]
        for node, k in zip(channels, (0.6, 1.0, 1.4)):
            g.put(node.inputs[0], g.art(img, refracted(k), 'Artwork (refracted)'))
        joined = g.node('ShaderNodeCombineColor')
        for i in range(3):
            g.put(joined.inputs[i], channels[i].outputs[i])
        art = joined.outputs[0]
        facet_half = g.v('SUBTRACT', half, g.v('SCALE', tilt, scale=q['amp']))
        lobe = g.m('POWER', g.m('SUBTRACT', 1.0, g.m('DIVIDE', g.v('LENGTH', facet_half, out=1), q['lobe']), clamp=True), 2.0)
        phase = _phase(g, facet_half, uv, (0.94, 0.34), q['K'], (0.7, 0.7), q['S'], g.m('ADD', g.sep(random)[2], grain))
        colour = g.hsv(g.m('FRACT', phase), q['sat'])
        mask = g.smooth(g.lum(art), q['m0'], q['m1'], q['cover'], 1.0)
        shape = g.m('MULTIPLY', g.m('MULTIPLY_ADD', lobe, 0.78, 0.22), g.m('MULTIPLY_ADD', edge, 0.25, 0.75))
        intensity = g.m('MULTIPLY', g.m('MULTIPLY', mask, q['strength']), shape)
        intensity = g.m('ADD', intensity, g.m('MULTIPLY', g.m('SUBTRACT', 1.0, edge), g.m('MULTIPLY', mask, 0.16)))
    else:
        art = g.art(img, uv)
        phase = _phase(g, half, uv, (0.94, 0.34), q['K'], (0.8, 0.6) if kind == 'holo' else (0.75, 0.66), q['S'], grain)
        mask = g.smooth(g.lum(art), q['m0'], q['m1'], q['cover'], 1.0)
        if kind == 'holo':
            colour = g.hsv(g.m('FRACT', phase), q['sat'])
            intensity = g.m('MULTIPLY', g.m('MULTIPLY', mask, q['strength']), g.m('MULTIPLY_ADD', _band(g, phase), 0.6, 0.4))
        else:
            second = _phase(g, half, uv, (-0.34, 0.94), q['K2'], (-0.6, 0.8), q['S2'], g.m('ADD', grain, 0.33))
            colour = g.v('ADD', g.v('SCALE', g.hsv(g.m('FRACT', phase), q['sat']), scale=0.58), g.v('SCALE', g.hsv(g.m('FRACT', second), q['sat']), scale=0.42))
            intensity = g.m('MULTIPLY', g.m('MULTIPLY', mask, q['strength']), g.m('MULTIPLY_ADD', _band(g, second), 0.45, 0.55))

    # Sparkle: tiny flakes, each lit only when the half vector lines up with its own tilt, on a fifth of the cells.
    flakes = g.node('ShaderNodeTexVoronoi', voronoi_dimensions='2D', feature='F1')
    g.put(flakes.inputs['Vector'], square)
    flakes.inputs['Scale'].default_value = 190.0
    flake = flakes.outputs['Color']
    flake_tilt = g.v('MULTIPLY', g.v('SCALE', g.v('SUBTRACT', flake, (0.5, 0.5, 0.5)), scale=1.1), (1.0, 1.0, 0.0))
    glint = g.m('POWER', g.m('SUBTRACT', 1.0, g.m('DIVIDE', g.v('LENGTH', g.v('SUBTRACT', half, flake_tilt), out=1), 0.11), clamp=True), 3.0)
    gate = g.m('MULTIPLY', g.m('GREATER_THAN', g.sep(flake)[2], 0.80), g.m('LESS_THAN', flakes.outputs['Distance'], 0.34))
    sparkle = g.m('MULTIPLY', g.m('MULTIPLY', glint, gate), g.m('MULTIPLY', q['sparkle'], g.m('MULTIPLY_ADD', mask, 0.7, 0.3)))

    # Light off the foil is tinted by the ink over it (mul), plus a share that shows on dark ink too (add).
    tint = g.v('ADD', g.v('SCALE', art, scale=q['mul']), (q['add'], q['add'], q['add']))
    foil = g.v('SCALE', g.v('MULTIPLY', colour, tint), scale=intensity)
    glitter = g.v('SCALE', g.v('ADD', g.v('SCALE', colour, scale=0.35), (0.65, 0.65, 0.65)), scale=sparkle)
    emission = g.v('ADD', g.v('ADD', g.v('SCALE', art, scale=ART_EMISSION), foil), glitter)
    nt.links.new(art, bsdf.inputs['Base Color'])
    nt.links.new(emission, bsdf.inputs['Emission Color'])
    nt.links.new(g.m('MULTIPLY', mask, q['metal']), bsdf.inputs['Metallic'])
    return mat


def read_foils():
    with open(FOILS, encoding='utf-8') as f:
        table = json.load(f)
    missing = [kind for kind in FOIL_KINDS if kind not in table]
    if missing:
        raise RuntimeError('foils.json has no ' + ', '.join(missing))
    return table


def studio():
    """A neutral studio: Blender's bundled studio HDRI lights the card, and the camera sees a dark backdrop."""
    world = bpy.data.worlds.get(STUDIO) or bpy.data.worlds.new(STUDIO)
    try:
        world.use_nodes = True
    except Exception:
        pass
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    mix = nt.nodes.new('ShaderNodeMixShader')
    path = nt.nodes.new('ShaderNodeLightPath')
    lit = nt.nodes.new('ShaderNodeBackground')
    dark = nt.nodes.new('ShaderNodeBackground')
    dark.inputs[0].default_value = (0.010, 0.012, 0.018, 1.0)
    lit.inputs[1].default_value = STUDIO_STRENGTH
    hdri = os.path.join(bpy.utils.system_resource('DATAFILES'), 'studiolights', 'world', 'studio.exr')
    if os.path.isfile(hdri):
        coords = nt.nodes.new('ShaderNodeTexCoord')
        turn = nt.nodes.new('ShaderNodeMapping')
        turn.inputs['Rotation'].default_value = (0.0, 0.0, STUDIO_TURN)
        env = nt.nodes.new('ShaderNodeTexEnvironment')
        env.image = bpy.data.images.load(hdri, check_existing=True)
        nt.links.new(coords.outputs['Generated'], turn.inputs[0])
        nt.links.new(turn.outputs[0], env.inputs[0])
        nt.links.new(env.outputs[0], lit.inputs[0])
    nt.links.new(path.outputs['Is Camera Ray'], mix.inputs[0])
    nt.links.new(lit.outputs[0], mix.inputs[1])
    nt.links.new(dark.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return world


def build_preview():
    """Four cards in a row, one per foil, rocking through the tilt a finger gives one on the phone."""
    scene = bpy.context.scene
    card = bpy.data.objects.get(CARD) or build_card()
    img = bpy.data.images[ART_IMAGE]
    table = read_foils()
    coll = _fresh_collection(PREVIEW_COLLECTION)

    label = _material('MiCar Card Label')[0]
    label_bsdf = next(n for n in label.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    label_bsdf.inputs['Base Color'].default_value = (0.0, 0.0, 0.0, 1.0)
    label_bsdf.inputs['Emission Color'].default_value = (0.90, 0.92, 0.96, 1.0)
    label_bsdf.inputs['Emission Strength'].default_value = 1.0

    for i, kind in enumerate(FOIL_KINDS):
        obj = card.copy()
        obj.data = card.data.copy()
        obj.name = 'MiCar Card ' + kind
        obj.animation_data_clear()
        obj.hide_viewport = False
        obj.hide_render = False
        coll.objects.link(obj)
        obj.location = ((i - 1.5) * 0.075, 0.0, 0.06)
        obj.data.materials[0] = foil_material(kind, img, table[kind])
        for frame in range(1, 98, 4):
            turn = 2.0 * math.pi * (frame - 1) / 96.0
            obj.rotation_euler = (TILT * math.sin(turn), 0.0, TILT * math.cos(turn))
            obj.keyframe_insert('rotation_euler', frame=frame)
        text = bpy.data.curves.new(obj.name + ' label', 'FONT')
        text.body = FOIL_TIERS[kind] + '\n' + FOIL_NAMES[kind]
        text.size = 0.0030
        text.align_x = 'CENTER'
        text.space_line = 1.25
        text.materials.append(label)
        caption = bpy.data.objects.new(obj.name + ' label', text)
        coll.objects.link(caption)
        caption.location = (obj.location.x, 0.0, 0.0105)
        caption.rotation_euler = (math.radians(90), 0.0, 0.0)

    # The export card sits at the origin, inside the row: keep it out of the picture.
    card.hide_viewport = True
    card.hide_render = True

    scene.world = studio()
    camera_data = bpy.data.cameras.get(CAMERA) or bpy.data.cameras.new(CAMERA)
    camera_data.lens = 85
    camera_data.clip_start = 0.01
    camera_data.clip_end = 10
    camera = bpy.data.objects.new(CAMERA, camera_data)
    coll.objects.link(camera)
    camera.location = (0.0, -0.80, 0.056)
    camera.rotation_euler = (math.radians(90), 0.0, 0.0)
    scene.camera = camera
    scene.frame_start = 1
    scene.frame_end = 96
    scene.render.fps = 24
    scene.frame_set(13)
    scene.view_settings.view_transform = 'Standard'

    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != 'VIEW_3D':
                continue
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            space.shading.use_scene_world = True
            space.shading.use_scene_lights = False
            space.clip_start = 0.001
            view = space.region_3d
            view.view_perspective = 'PERSP'
            view.view_location = Vector((0.0, 0.0, 0.052))
            view.view_distance = 0.50
            view.view_rotation = Euler((math.radians(86), 0.0, math.radians(8)), 'XYZ').to_quaternion()
            area.tag_redraw()
    return [o.name for o in coll.objects if o.type == 'MESH']


def report():
    """What was built, as numbers: for the log, and for checking against the spec."""
    card = bpy.data.objects.get(CARD)
    if card is None:
        return {'card': None}
    hidden = card.hide_viewport
    card.hide_viewport = False
    bpy.context.view_layer.update()
    evaluated = card.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    stats = {
        'size_mm': [round(d * 1000.0, 2) for d in evaluated.dimensions],
        'vertices': len(mesh.vertices),
        'triangles': sum(len(p.vertices) - 2 for p in mesh.polygons),
    }
    evaluated.to_mesh_clear()
    card.hide_viewport = hidden
    preview = bpy.data.collections.get(PREVIEW_COLLECTION)
    return {
        'card': stats,
        'corner_fraction_of_width': round(card.get('corner_fraction', 0.0), 4),
        'corner_radius_mm': round(card.get('corner_radius_mm', 0.0), 2),
        'materials': [m.name for m in card.data.materials],
        'location': [round(v, 6) for v in card.location],
        'artwork': list(bpy.data.images[ART_IMAGE].size) if ART_IMAGE in bpy.data.images else None,
        'preview': sorted(o.name for o in preview.objects if o.type == 'MESH') if preview else [],
        'foils': sorted(read_foils().keys()),
    }
