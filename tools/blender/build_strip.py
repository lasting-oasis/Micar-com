"""Build the Strip in Blender (5.x): the hub and the ten circuits of the track library.

The race data lives in `*.Data` collections (curves, wall meshes, empties); the scenery in `Hub` and
`Track.<id>` collections (exported to glb by tools/blender/export_strip.py). Circuit centrelines come
from tools/tracks/data/<id>.json (OpenStreetMap, see tools/tracks/README.md).

Run inside Blender (Text editor, or exec(open(path).read()) through the MCP connection), then
`build_all()` and `report()`. Idempotent: every builder clears its collections first.

Coordinates: Blender metres, x east, y north, z up. The game reads x = bx, z = -by (the glTF Y-up
conversion); the centreline files are already x east / z south, so Blender y = -z.
A car with heading h faces (sin h, cos h) in game x/z; its right-hand side is (-cos h, sin h) in
game x/z, i.e. right = (-tz, tx) for a tangent (tx, tz) (events.ts places the start grid that way).

Curves are Bezier with explicit handles (a Catmull-Rom tangent) so this script and the exporter sample
the same curve with mathutils.geometry.interpolate_bezier. Circuit centrelines are POLY splines (3 m
points straight from the data). Route curves carry `cp_every` (metres between checkpoints) or `cp_idx`.
"""
import json
import math
import os
import random
import bpy
from mathutils import Vector
from mathutils.geometry import interpolate_bezier

REPO = os.environ.get('MICAR_REPO', r'C:\Users\Owner\Micar-com-strip-tracks')
DATA_DIR = os.path.join(REPO, 'tools', 'tracks', 'data')

TRACK_IDS = ['spa', 'monza', 'silverstone', 'suzuka', 'nurburgring', 'monaco', 'interlagos', 'cota', 'laguna', 'bathurst']
TRACK_NAMES = {'spa': 'Ardennes', 'monza': 'Royal Park', 'silverstone': 'Airfield', 'suzuka': 'Figure Eight', 'nurburgring': 'Eifel',
               'monaco': 'Harbour', 'interlagos': 'Lagoons', 'cota': 'Lone Star', 'laguna': 'Dry Lagoon', 'bathurst': 'The Mountain'}
def offset_of(tid):
    """Circuit cells on an 8 km grid, starting at cell 1: the hub keeps cell 0 (the origin) to itself."""
    k = TRACK_IDS.index(tid) + 1
    return (8000 * (k % 4), 8000 * (k // 4))

# events: id -> (type, track, kind, arg); kind: 'loop' | 'lap' (start to start, non-loop) | 'sector' (s0, s1) | 'drag' (metres, end_before_line or None = the straightest window anywhere)
EVENTS = {
    'harbour_gp': ('circuit', 'monaco', 'loop', None), 'lagoons_sprint': ('sprint', 'interlagos', 'lap', None),
    'harbour_drift': ('drift', 'monaco', 'sector', (1400, 2300)), 'royal_drag': ('drag', 'monza', 'drag', (402, 30)),
    'drylagoon_x': ('streetx', 'laguna', 'loop', None), 'royal_gp': ('circuit', 'monza', 'loop', None),
    'lagoons_gp': ('circuit', 'interlagos', 'loop', None), 'airfield_sprint': ('sprint', 'silverstone', 'lap', None),
    'figure8_drift': ('drift', 'suzuka', 'sector', (300, 1500)), 'mountain_drag': ('drag', 'bathurst', 'drag', (805, None)),
    'figure8_gp': ('circuit', 'suzuka', 'loop', None), 'eifel_gp': ('circuit', 'nurburgring', 'loop', None),
    'harbour_x': ('streetx', 'monaco', 'loop', None), 'mountain_sprint': ('sprint', 'bathurst', 'lap', None),
    'lonestar_gp': ('circuit', 'cota', 'loop', None), 'airfield_gp': ('circuit', 'silverstone', 'loop', None),
    'mountain_drift': ('drift', 'bathurst', 'sector', (2900, 4400)), 'ardennes_gp': ('circuit', 'spa', 'loop', None),
    'mountain_gp': ('circuit', 'bathurst', 'loop', None), 'ardennes_sprint': ('sprint', 'spa', 'lap', None),
}
CP_EVERY = 500.0

# ----------------------------------------------------------------------------------------- materials
MATS = {
    'tarmac': (0.16, 0.17, 0.19), 'kerb_red': (0.78, 0.09, 0.10), 'kerb_white': (0.92, 0.92, 0.90), 'line': (0.95, 0.95, 0.92),
    'gravel': (0.72, 0.62, 0.42), 'barrier': (0.70, 0.72, 0.74), 'concrete': (0.55, 0.56, 0.58), 'steel': (0.30, 0.32, 0.36),
    'foliage': (0.18, 0.40, 0.17), 'bark': (0.30, 0.22, 0.14), 'paint': (1.0, 0.82, 0.25), 'glass': (0.35, 0.50, 0.60),
}
# a circuit's scenery (trk_*): flat preview colours here; the game swaps each for its textured material by name
# (apps/sim/src/world/strip/trackMaterials.ts). UVs are metres on ground, walls and fences, tiles on atlases.
TRK = {   # the exported names (palette members and the two tree species are merged before export: see PALETTES)
    'trk_asphalt': (0.05, 0.05, 0.055), 'trk_rubber': (0.02, 0.02, 0.02), 'trk_marks': (0.95, 0.95, 0.92),
    'trk_grass': (0.13, 0.30, 0.08), 'trk_grass_mow': (0.17, 0.37, 0.10), 'trk_gravel': (0.55, 0.48, 0.36),
    'trk_solid': (0.45, 0.47, 0.50), 'trk_wall': (0.62, 0.62, 0.60), 'trk_boards': (0.95, 0.80, 0.20), 'trk_tyres': (0.05, 0.05, 0.05),
    'trk_fence': (0.42, 0.44, 0.46), 'trk_stand': (0.52, 0.52, 0.54), 'trk_crowd': (0.45, 0.32, 0.30), 'trk_pit': (0.86, 0.86, 0.88),
    'trk_brake': (0.95, 0.95, 0.95), 'trk_trees': (0.14, 0.30, 0.10), 'trk_treeline': (0.10, 0.20, 0.08), 'trk_lamps': (0.25, 0.02, 0.02),
}
MATS.update(TRK)
# Flat colours share a material: each member lands on its own cell of a small palette texture the game makes
# (trackMaterials.ts PALETTES: the same names in the same order), so a circuit draws each group in one call.
PALETTES = {
    'trk_marks': ['trk_line', 'trk_paint', 'trk_kerb_red', 'trk_kerb_white'],              # on the ground, lifted
    'trk_solid': ['trk_steel', 'trk_roof', 'trk_marshal', 'trk_orange', 'trk_canopy', 'trk_armco'],
    # the game lights the five lamps one by one; their box shares the primitive, so compression keeps them apart
    'trk_lamps': ['trk_lamp1', 'trk_lamp2', 'trk_lamp3', 'trk_lamp4', 'trk_lamp5', 'trk_lamp_box'],
}
# Draco quantization (export_strip.py): one range per attribute and primitive, its largest extent. 18 bits put a
# circuit's positions on a 1-3 cm grid (thin posts, kerb sides and the lamps keep their shape) and 16 bits its UVs
# on a grid of 1/65535 of their largest extent (metres along a 5 km rubber line: 8 cm).
DRACO_POS_BITS = 18
DRACO_UV_BITS = 16
TREELINE_TILE = 104.0    # m along one tile of tex/treeline.webp (prep_textures.py), 26.5 m high
BOARD_BACK = 0.7         # braking boards' centre behind the barrier line, m (their 1.1 m face stands clear of it)
def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    r, g, b = MATS[name]; bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9 if name in ('tarmac', 'gravel', 'concrete', 'foliage', 'bark') else 0.5
    if name == 'paint':
        bsdf.inputs['Emission Color'].default_value = (r, g, b, 1.0); bsdf.inputs['Emission Strength'].default_value = 0.3
    if name == 'barrier' or name in TRK:
        mat.use_backface_culling = False
    return mat

# ----------------------------------------------------------------------------------------- geometry
# The geometry helpers and the trackside plan live in trackside.py (no bpy, tested by test_trackside.py).
import sys
try:
    import trackside
except ImportError:                       # beside this script (exec'd with __file__ set), else the repo's tools/blender
    sys.path.insert(0, os.path.dirname(os.path.abspath(globals()['__file__'])) if globals().get('__file__') else os.path.join(REPO, 'tools', 'blender'))
    import trackside
from trackside import (dist, lerp, tangents, offset_polyline, cumulative, point_at, resample, curvature, signed_area,  # noqa: F401
                       wall_runs, longest_straight)

# ----------------------------------------------------------------------------------------- mesh builder
class Builder:
    """Faces per material, with a UV per vertex (shared vertices along strips; boxes get their own per face). One mesh
    object per material in emit(); the meshes carry no normals (the game shades them flat)."""
    def __init__(self):
        self.parts = {}
    def _p(self, m):
        p = self.parts.get(m)
        if p is None: p = self.parts[m] = ([], [], [])
        return p
    def quad(self, m, a, b, c, d, uv=((0, 0), (1, 0), (1, 1), (0, 1))):
        v, f, t = self._p(m); o = len(v); v += [a, b, c, d]; t += [tuple(x) for x in uv]; f.append((o, o + 1, o + 2, o + 3))
    def tri(self, m, a, b, c, uv=((0, 0), (1, 0), (0, 1))):
        v, f, t = self._p(m); o = len(v); v += [a, b, c]; t += [tuple(x) for x in uv]; f.append((o, o + 1, o + 2))
    def box(self, m, cx, cy, z0, sx, sy, sz, ang=0.0, top=True, bottom=True):
        """A box (sx along ang, sy across, sz up); every face its own vertices, UVs in metres."""
        c, s = math.cos(ang), math.sin(ang)
        def P(x, y, z): return (cx + x * c - y * s, cy + x * s + y * c, z)
        hx, hy = sx / 2, sy / 2; z1 = z0 + sz
        sides = [((-hx, -hy), (hx, -hy), sx), ((hx, -hy), (hx, hy), sy), ((hx, hy), (-hx, hy), sx), ((-hx, hy), (-hx, -hy), sy)]
        for (ax, ay), (bx, by), L in sides:
            self.quad(m, P(ax, ay, z0), P(bx, by, z0), P(bx, by, z1), P(ax, ay, z1), ((0, 0), (L, 0), (L, sz), (0, sz)))
        if top: self.quad(m, P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1), ((0, 0), (sx, 0), (sx, sy), (0, sy)))
        if bottom: self.quad(m, P(-hx, hy, z0), P(hx, hy, z0), P(hx, -hy, z0), P(-hx, -hy, z0), ((0, sy), (sx, sy), (sx, 0), (0, 0)))
    def strip3(self, m, left, right, v, u=(0.0, 1.0)):
        """A strip between two 3D polylines of equal length (left of travel first, so it faces up); v per row."""
        verts, f, t = self._p(m); o = len(verts); n = len(left)
        for i in range(n):
            verts.append(tuple(left[i])); verts.append(tuple(right[i])); t.append((u[0], v[i])); t.append((u[1], v[i]))
        for i in range(n - 1): f.append((o + 2 * i, o + 2 * i + 1, o + 2 * i + 3, o + 2 * i + 2))
    def strip(self, m, left, right, z, closed=False, v=None, u=(0.0, 1.0), v_end=None):
        """A flat strip between two polylines (left of travel first, so it faces up); v: the texture coordinate along
        each row (default: metres along `left`). A closed strip repeats its first row at the end with v_end (default: the
        closing length, or one more step of v), so the texture never wraps back."""
        if v is None:
            cum, total = cumulative(left, closed); v = cum
            if v_end is None: v_end = total
        L, R, V = list(left), list(right), list(v)
        if closed:
            if v_end is None: v_end = V[-1] + (V[-1] - V[-2] if len(V) > 1 else 1.0)
            L.append(left[0]); R.append(right[0]); V.append(v_end)
        self.strip3(m, [(p[0], p[1], z) for p in L], [(p[0], p[1], z) for p in R], V, u)
    def ribbon(self, m, pts, width, z, closed=False, v=None, u=(0.0, 1.0), v_end=None):
        self.strip(m, offset_polyline(pts, width / 2, closed), offset_polyline(pts, -width / 2, closed), z, closed, v, u, v_end)
    def wall(self, m, pts, height, closed=False, z0=0.0, v=None, top=None):
        """A vertical strip from z0 to z0 + height along pts; UVs: u metres along (or the given v per point), v metres
        up (or 0 to `top`) (double-sided material)."""
        P = list(pts)
        if closed: P.append(pts[0])
        if v is None: v = cumulative(P, False)[0]
        verts, f, t = self._p(m); o = len(verts)
        for p, s in zip(P, v):
            verts.append((p[0], p[1], z0)); verts.append((p[0], p[1], z0 + height)); t.append((s, 0.0)); t.append((s, height if top is None else top))
        for i in range(len(P) - 1): f.append((o + 2 * i, o + 2 * i + 2, o + 2 * i + 3, o + 2 * i + 1))
    def cone(self, m, cx, cy, z0, r, h, n=6):
        v, f, t = self._p(m); o = len(v)
        for k in range(n): v.append((cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n), z0)); t.append((0, 0))
        v.append((cx, cy, z0 + h)); t.append((0, 0))
        for k in range(n): f.append((o + k, o + (k + 1) % n, o + n))
    def cylinder(self, m, cx, cy, z0, r, h, n=6):
        v, f, t = self._p(m); o = len(v)
        for k in range(n):
            a = 2 * math.pi * k / n; v.append((cx + r * math.cos(a), cy + r * math.sin(a), z0)); v.append((cx + r * math.cos(a), cy + r * math.sin(a), z0 + h)); t += [(0, 0), (0, 0)]
        for k in range(n):
            j = (k + 1) % n; f.append((o + 2 * k, o + 2 * j, o + 2 * j + 1, o + 2 * k + 1))
    def ring(self, m, cx, cy, r0, r1, z, n=40):
        v, f, t = self._p(m); o = len(v)
        for k in range(n):
            a = 2 * math.pi * k / n; v.append((cx + r0 * math.cos(a), cy + r0 * math.sin(a), z)); v.append((cx + r1 * math.cos(a), cy + r1 * math.sin(a), z)); t += [(0, 0), (0, 0)]
        for k in range(n):
            j = (k + 1) % n; f.append((o + 2 * k, o + 2 * k + 1, o + 2 * j + 1, o + 2 * j))
    def merge(self, palettes):
        """Move each palette member's faces into its group, every UV on the member's cell centre ((j + .5) / n, .5)."""
        for g, members in palettes.items():
            n = len(members)
            for j, m in enumerate(members):
                p = self.parts.pop(m, None)
                if not p or not p[1]: continue
                v, f, t = self._p(g); o = len(v)
                v += p[0]; t += [((j + .5) / n, .5)] * len(p[0]); f += [tuple(k + o for k in face) for face in p[1]]
    def emit(self, coll, prefix=''):
        self.merge(PALETTES)
        made = []
        for m, (v, f, t) in self.parts.items():
            if not f: continue
            me = bpy.data.meshes.new(prefix + m); me.from_pydata(v, [], f); me.validate(); me.update()
            uvl = me.uv_layers.new(name='UVMap')
            for li, lp in enumerate(me.loops): uvl.data[li].uv = t[lp.vertex_index]
            me.materials.append(material(m))
            ob = bpy.data.objects.new(prefix + m, me); coll.objects.link(ob); made.append(ob)
        return made

# ----------------------------------------------------------------------------------------- blender data helpers
def collection(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name); (parent or bpy.context.scene.collection).children.link(c)
    return c

def clear(coll):
    for ob in list(coll.objects):
        data = ob.data; bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh): bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve): bpy.data.curves.remove(data)

def catmull_handles(pts, cyclic):
    n = len(pts); out = []
    for i, p in enumerate(pts):
        if cyclic: a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        else: a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        k = 3 if (not cyclic and (i == 0 or i == n - 1)) else 6
        tx, ty = (b[0] - a[0]) / k, (b[1] - a[1]) / k
        out.append((Vector((p[0], p[1], 0)), Vector((p[0] - tx, p[1] - ty, 0)), Vector((p[0] + tx, p[1] + ty, 0))))
    return out

def make_bezier(name, pts, cyclic, coll, props=None):
    cd = bpy.data.curves.new(name, 'CURVE'); cd.dimensions = '2D'
    sp = cd.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1); sp.use_cyclic_u = cyclic
    for bp, (p, hl, hr) in zip(sp.bezier_points, catmull_handles(pts, cyclic)):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'FREE'; bp.handle_left = hl; bp.handle_right = hr
    ob = bpy.data.objects.new(name, cd); coll.objects.link(ob)
    for k, v in (props or {}).items(): ob[k] = v
    return ob

def make_poly(name, pts, cyclic, coll, props=None):
    cd = bpy.data.curves.new(name, 'CURVE'); cd.dimensions = '2D'
    sp = cd.splines.new('POLY'); sp.points.add(len(pts) - 1); sp.use_cyclic_u = cyclic
    for pt, p in zip(sp.points, pts): pt.co = (p[0], p[1], 0, 1)
    ob = bpy.data.objects.new(name, cd); coll.objects.link(ob)
    for k, v in (props or {}).items(): ob[k] = v
    return ob

def sample_curve(ob, step=3.0):
    """Points (x, y) along a curve object at `step` m, and the arc length of each control point."""
    sp = ob.data.splines[0]
    if sp.type == 'POLY':
        pts = [(p.co.x, p.co.y) for p in sp.points]; cum, total = cumulative(pts, sp.use_cyclic_u)
        return resample(pts, step, sp.use_cyclic_u), cum, total
    bps = sp.bezier_points; n = len(bps); segs = n if sp.use_cyclic_u else n - 1
    raw = []; cp_len = [0.0]
    for k in range(segs):
        a, b = bps[k], bps[(k + 1) % n]
        seg = interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, 24)
        if k == 0: raw.append((seg[0].x, seg[0].y))
        for q in seg[1:]: raw.append((q.x, q.y))
        cp_len.append(cumulative(raw, False)[0][-1])
    if sp.use_cyclic_u: raw = raw[:-1]
    cum, total = cumulative(raw, sp.use_cyclic_u)
    return resample(raw, step, sp.use_cyclic_u), cp_len[:n] if sp.use_cyclic_u else cp_len, total

def curve_length(ob):
    return sample_curve(ob)[2]

def wall_object(name, pts, closed, coll):
    me = bpy.data.meshes.new(name); n = len(pts)
    edges = [(i, (i + 1) % n) for i in range(n if closed else n - 1)]
    me.from_pydata([(p[0], p[1], 0.0) for p in pts], edges, []); me.update()
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob); return ob

def empty(name, x, y, z, heading=None, props=None, coll=None):
    """heading: the game heading h in radians (the car faces (sin h, cos h) in game x/z) or None."""
    ob = bpy.data.objects.new(name, None); ob.empty_display_type = 'ARROWS'; ob.empty_display_size = 4
    ob.location = (x, y, z)
    if heading is not None:
        # game forward (sin h, 0, cos h) is Blender (sin h, -cos h): rotate +Y onto it
        ob.rotation_euler = (0, 0, math.atan2(-math.cos(heading), math.sin(heading)) - math.pi / 2)
        ob['h'] = float(heading)
    for k, v in (props or {}).items(): ob[k] = v
    coll.objects.link(ob); return ob

def heading_of(t):
    """Game heading of a Blender tangent (tx, ty): game forward (tx, -ty)."""
    return math.atan2(t[0], -t[1])

# ----------------------------------------------------------------------------------------- the hub
def rounded_rect(x0, y0, x1, y1, r, n=4):
    pts = []
    def arc(cx, cy, a0, a1):
        for k in range(n + 1): a = a0 + (a1 - a0) * k / n; pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts.append(((x0 + x1) / 2, y0)); arc(x1 - r, y0 + r, -math.pi / 2, 0); pts.append((x1, (y0 + y1) / 2)); arc(x1 - r, y1 - r, 0, math.pi / 2)
    pts.append(((x0 + x1) / 2, y1)); arc(x0 + r, y1 - r, math.pi / 2, math.pi); pts.append((x0, (y0 + y1) / 2)); arc(x0 + r, y0 + r, math.pi, 3 * math.pi / 2)
    return pts

APRON = (-160, -130, 160, 120)       # the paddock and the portal boulevard, one tarmac apron
HUB_ROADS = {'loop': (rounded_rect(-300, -160, 300, 160, 60), True, 12), 'paddock_in': ([(0, -160), (0, -145), (0, -130)], False, 12)}
HUB_EMPTIES = {'spawn': (0, -30, 0, math.pi), 'exit': (90, -110, 0, None), 'rental.bay': (-70, -30, 0, math.pi), 'rental.cam': (-92, -52, 5, None), 'rental.kiosk': (-50, -45, 0, None)}
PORTALS = {tid: (-120 + 60 * (k % 5), 40 if k < 5 else 90) for k, tid in enumerate(TRACK_IDS)}

def build_hub():
    hub, data = collection('Hub'), collection('Hub.Data')
    clear(hub); clear(data)
    B = Builder(); x0, y0, x1, y1 = APRON
    road_obs = {n: make_bezier('road.' + n, p, c, data, {'width': float(w)}) for n, (p, c, w) in HUB_ROADS.items()}
    for n, (x, y, z, h) in HUB_EMPTIES.items(): empty(n, x, y, z, h, {'radius': 9.0} if n == 'exit' else None, data)
    for tid, (x, y) in PORTALS.items(): empty('portal.' + tid, x, y, 0, None, None, data)
    B.box('tarmac', (x0 + x1) / 2, (y0 + y1) / 2, -0.02, x1 - x0, y1 - y0, 0.03)
    for n, (p, c, w) in HUB_ROADS.items(): B.ribbon('tarmac', sample_curve(road_obs[n])[0], w, 0.01, c)
    # the fence round the apron, open to the south where paddock_in comes in
    fence = [(-7, y0), (x0, y0), (x0, y1), (x1, y1), (x1, y0), (7, y0)]
    wall_object('wall.apron', fence, False, data); B.wall('barrier', fence, 1.2)
    # garages along the west edge, the sign over them
    for k in range(6): B.box('concrete', x0 + 6, -115 + k * 14, 0, 8, 12, 5); B.box('glass', x0 + 10.2, -115 + k * 14, 0.3, 0.3, 9, 3.8)
    B.box('steel', x0 + 4, -40, 0, 0.4, 0.4, 9); B.box('steel', x0 + 4, -20, 0, 0.4, 0.4, 9); B.box('paint', x0 + 4, -30, 9, 0.6, 24, 3.2)
    # portal rings and their signs (the game labels them)
    for tid, (x, y) in PORTALS.items():
        B.ring('paint', x, y, 6.0, 7.0, 0.02); B.box('steel', x, y + 12, 0, 0.3, 0.3, 4.5); B.box('paint', x, y + 12, 4.5, 8, 0.3, 2.0)
    for x in range(-150, 151, 50): B.cylinder('steel', x, y1 - 3, 0, 0.18, 10); B.cylinder('steel', x, y0 + 3, 0, 0.18, 10)
    rnd = random.Random(3); rpts = [q for n in HUB_ROADS for q in sample_curve(road_obs[n], 6.0)[0]]
    placed = 0
    while placed < 50:
        x, y = rnd.uniform(-380, 380), rnd.uniform(-240, 240)
        if x0 - 8 < x < x1 + 8 and y0 - 8 < y < y1 + 8: continue
        if min(dist((x, y), q) for q in rpts) < 14: continue
        B.cylinder('bark', x, y, 0, 0.25, 1.6); B.cone('foliage', x, y, 1.4, rnd.uniform(1.8, 2.8), rnd.uniform(5, 9)); placed += 1
    B.emit(hub, 'hub.')

# ----------------------------------------------------------------------------------------- a circuit
def load_track(tid):
    with open(os.path.join(DATA_DIR, tid + '.json'), encoding='utf-8') as f: d = json.load(f)
    pts = [(p[0], -p[1]) for p in d['pts']]            # game x/z -> Blender x/y
    return d, pts

def scenery(tid, pts, width, seed=11):
    """A circuit's scenery as a Builder (no bpy: test_build_scenery.py runs it without Blender), from the trackside
    plan. Everything stands on or beside the centreline; barriers on the physics wall line."""
    ts = trackside; closed = True; n = len(pts)
    cum, total = cumulative(pts, closed); k = ts._an(pts, closed)['k']      # bends from the averaged curvature
    e = width / 2 + ts.WALL_GAP; B = Builder()
    def frame(s, d):
        """The point at arc length s, offset d (left +), and the tangent there."""
        p, t = point_at(pts, cum, total, s, closed); return (p[0] - t[1] * d, p[1] + t[0] * d), t
    def off_at(i, d):
        t = T[i % n]; p = pts[i % n]; return (p[0] - t[1] * d, p[1] + t[0] * d)
    T = tangents(pts, closed)
    def band(m, idx, da, db, z, u=None, v=None):
        """A flat strip over point indices idx between offsets da and db (whichever is more to the left goes first)."""
        dl, dr = (da, db) if da > db else (db, da)
        L = [off_at(i, dl) for i in idx]; R = [off_at(i, dr) for i in idx]
        if v is None: v = [cum[i % n] if (j == 0 or cum[i % n] >= cum[idx[0] % n]) else cum[i % n] + total for j, i in enumerate(idx)]
        if v and any(b < a for a, b in zip(v, v[1:])):           # a run that wraps past the line
            base = v[0]; v = [x if x >= base else x + total for x in v]
        B.strip(m, L, R, z, False, v, u if u is not None else (0.0, abs(dl - dr)))
    def runs(flags):
        """Maximal runs of consecutive point indices (cyclic) whose flag is the same, as (flag, [i0 .. i1]) where each
        run includes the next run's first point (so strips meet)."""
        if all(f == flags[0] for f in flags): return [(flags[0], list(range(n)) + [n])]
        start = next(i for i in range(n) if flags[i] != flags[i - 1]); out = []; cur = [start]
        for q in range(1, n + 1):
            i = start + q
            if q < n and flags[i % n] == flags[cur[0] % n]: cur.append(i)
            else: cur.append(i); out.append((flags[cur[0] % n], cur)); cur = [i]
        return out

    # 1. asphalt (metres), the rubbered racing line, edge lines, the start line and grid boxes
    B.strip('trk_asphalt', offset_polyline(pts, width / 2, closed), offset_polyline(pts, -width / 2, closed), 0.01, closed, cum, (0.0, width), total)
    line = ts.racing_line(pts, width, closed, margin=2.1)
    B.strip('trk_rubber', offset_polyline(line, 2.0, closed), offset_polyline(line, -2.0, closed), 0.013, closed, cum, (0.0, 1.0), total)
    for side in (1, -1):
        B.ribbon('trk_line', offset_polyline(pts, side * (width / 2 - 0.3), closed), 0.2, 0.016, closed, cum, (0.0, 1.0), total)
    def paint(s0, s1, d0, d1):
        a, _ = frame(s0, d0); b, _ = frame(s0, d1); c, _ = frame(s1, d1); d, _ = frame(s1, d0)
        B.quad('trk_line', (a[0], a[1], 0.018), (b[0], b[1], 0.018), (c[0], c[1], 0.018), (d[0], d[1], 0.018))
    paint(-0.3, 0.3, width / 2 - 0.1, -width / 2 + 0.1)
    for lane in (-3.0, 3.0):
        for back in (-2.0, -10.0):
            paint(back - 0.15, back, lane + 1.3, lane - 1.3)
            paint(back - 1.4, back, lane + 1.3, lane + 1.15); paint(back - 1.4, back, lane - 1.15, lane - 1.3)

    # 2. kerbs on bends: the inside of every bend, the outside of tighter ones; red and white blocks 1.5 m long
    for i0, i1, sign in ts.bend_spans(pts, closed, ts.KERB_K):
        peak = max(abs(k[q % n]) for q in range(i0, i1))
        s0 = cum[i0 % n]; L = (cum[i1 % n] if i1 % n > i0 % n else cum[i1 % n] + total) - s0
        if i1 - i0 >= n: L = total
        for side in (1, -1):
            if side != sign and peak <= 1 / 100: continue
            q = 0; s = s0
            while s < s0 + L - 0.2:
                s1 = min(s + 1.5, s0 + L)
                a, _ = frame(s, side * (width / 2 - 0.05)); b, _ = frame(s, side * (width / 2 + 0.9))
                c, _ = frame(s1, side * (width / 2 + 0.9)); d, _ = frame(s1, side * (width / 2 - 0.05))
                pa, pb, pc, pd = (a[0], a[1], 0.02), (b[0], b[1], 0.055), (c[0], c[1], 0.055), (d[0], d[1], 0.02)
                m = 'trk_kerb_red' if q % 2 == 0 else 'trk_kerb_white'
                if side > 0: B.quad(m, pb, pa, pd, pc)      # left of travel first: faces up
                else: B.quad(m, pa, pb, pc, pd)
                q += 1; s = s1

    # 3. run-off from the edge to the barrier line: gravel outside tight bends, mown grass (10 m stripes) elsewhere
    for side in (1, -1):
        kinds = []
        for i in range(n):
            if ts.runoff_kind(pts, closed, i, side) == 'gravel': kinds.append('trk_gravel')
            else: kinds.append('trk_grass' if int(cum[i] // 10) % 2 == 0 else 'trk_grass_mow')
        for m, idx in runs(kinds):
            band(m, idx, side * (width / 2 + 0.05), side * e, 0.006)

    # 4. barriers on the physics wall line: concrete with boards on the start straight, tyres outside tight bends, armco
    board = [0]
    def boards(P, side):
        cumP, totP = cumulative(P, False); s = 0.0
        while s + 6.0 <= totP + 1e-6:
            a, ta = point_at(P, cumP, totP, s, False); b, tb = point_at(P, cumP, totP, s + 6.0, False)
            sh = -side * 0.06                                     # 6 cm towards the track
            a = (a[0] - ta[1] * sh, a[1] + ta[0] * sh); b = (b[0] - tb[1] * sh, b[1] + tb[0] * sh)
            j = board[0] % 8; board[0] += 1
            v0, v1 = 1 - (j + 1) / 8, 1 - j / 8                   # board j: the atlas's row j from the top
            u0, u1 = (0.0, 1.0) if side > 0 else (1.0, 0.0)          # read left to right from the track on either side
            B.quad('trk_boards', (a[0], a[1], 0.12), (b[0], b[1], 0.12), (b[0], b[1], 0.92), (a[0], a[1], 0.92), ((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
            s += 6.0
    def posts(P, every, h, side, back, m='trk_steel', w=0.12, z0=0.0):
        cumP, totP = cumulative(P, False); s = 0.0
        while s <= totP + 1e-6:
            p, t = point_at(P, cumP, totP, s, False)
            sh = side * back; c = (p[0] - t[1] * sh, p[1] + t[0] * sh)
            a = (c[0] - t[0] * w / 2, c[1] - t[1] * w / 2); b = (c[0] + t[0] * w / 2, c[1] + t[1] * w / 2)
            B.quad(m, (a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z0 + h), (a[0], a[1], z0 + h), ((0, 0), (w, 0), (w, h), (0, h)))
            s += every
    for side in (1, -1):
        for ix, run_closed in ts.wall_run_idx(pts, closed, side * e, width):
            idx = ix + [ix[0]] if run_closed else ix
            kinds = [ts.barrier_kind(pts, width, closed, i % n, side) for i in idx]
            groups = []
            for i, kind in zip(idx, kinds):
                if groups and groups[-1][0] == kind: groups[-1][1].append(i)
                else:
                    if groups: groups[-1][1].append(i)
                    groups.append((kind, [i]))
            for kind, gi in groups:
                if len(gi) < 2: continue
                P = [off_at(i, side * e) for i in gi]
                if kind == 'armco':
                    B.wall('trk_armco', P, 0.34, False, 0.42); posts(P, 5.0, 0.74, side, 0.14)
                elif kind == 'wall':
                    B.wall('trk_wall', P, 1.05); boards(P, side)
                else:
                    B.wall('trk_tyres', P, 1.0)

    # 5. catch fences: on top of the start straight's walls, 1.5 m behind the barrier outside fast bends
    a_total = total
    for ix, side in ts.fence_runs(pts, width, closed):
        inwin = [cum[i % n] <= ts.START_AHEAD or cum[i % n] >= a_total - ts.START_BEHIND for i in ix]
        cur = [ix[0]]
        def flush(group, win):
            if len(group) < 3: return
            back = 0.1 if win else 1.5; z0 = 1.05 if win else 0.6
            P = [off_at(i, side * (e + back)) for i in group]
            B.wall('trk_fence', P, 4.0 - z0, False, z0); posts(P, 6.0, 4.0, side, 0.0, w=0.1)
        for a_, b_ in zip(range(len(ix) - 1), range(1, len(ix))):
            if inwin[b_] == inwin[a_]: cur.append(ix[b_])
            else: cur.append(ix[b_]); flush(cur, inwin[a_]); cur = [ix[b_]]
        flush(cur, inwin[-1])
    # the cell's fence (the physics fence) as a chain-link fence
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    rect = [(min(xs) - 150, min(ys) - 150), (max(xs) + 150, min(ys) - 150), (max(xs) + 150, max(ys) + 150), (min(xs) - 150, max(ys) + 150)]
    B.wall('trk_fence', rect, 2.6, True, 0.1); posts(rect + [rect[0]], 10.0, 2.7, 1, 0.0, w=0.1)

    # 6. the start: gantry and lamps, grandstand, pit lane and pit building
    area = ts.start_area(pts, width, closed)
    # the gantry in one frame at the line (its tangent): legs behind the barrier lines, the beam across, the lamp box
    # under it and the five lamps 4 cm proud of the box's face towards the grid (behind the line)
    (gx, gy), gt = frame(0.0, 0.0); ang = math.atan2(gt[1], gt[0])
    def G(al, ac): return (gx + gt[0] * al - gt[1] * ac, gy + gt[1] * al + gt[0] * ac)
    leg = e + 0.5
    for side in (1, -1):
        px, py = G(0.0, side * leg); B.box('trk_steel', px, py, 0.0, 0.45, 0.45, 7.6, ang, True, False)
    B.box('trk_steel', gx, gy, 6.9, 0.6, 2 * leg + 0.45, 0.6, ang, True, True)
    bx, by = G(-0.25, 0.0); B.box('trk_lamp_box', bx, by, 5.7, 0.36, 3.6, 1.05, ang, True, True)
    for j in range(5):
        d = (2 - j) * 0.66; a = G(-0.47, d - 0.22); b = G(-0.47, d + 0.22)
        B.quad('trk_lamp%d' % (j + 1), (a[0], a[1], 6.0), (b[0], b[1], 6.0), (b[0], b[1], 6.44), (a[0], a[1], 6.44))
    def bandframe(s0, s1, d, step=5.0):
        out = []; s = s0
        while s < s1 + 1e-6: out.append(frame(s, d)[0]); s += step
        if out and abs((s - step) - s1) > 1e-6: out.append(frame(s1, d)[0])
        return out
    def ups(P, z): return [(p[0], p[1], z) for p in P]
    def along(P): return cumulative(P, False)[0]
    if area['stand']:
        s0, s1, d0, d1 = area['stand']                          # left of the straight, d0 the front
        F, Bk = bandframe(s0, s1, d0), bandframe(s0, s1, d1)
        F1, B1 = bandframe(s0, s1, d0 + 1.0), bandframe(s0, s1, d1 - 1.0)
        B.wall('trk_stand', F, 1.2); B.wall('trk_stand', Bk, 12.0)
        B.strip3('trk_crowd', ups(B1, 9.0), ups(F1, 1.2), along(F1), (8.6 / 3.0, 0.0))
        B.strip3('trk_canopy', ups(bandframe(s0, s1, d1), 12.6), ups(bandframe(s0, s1, d0 + 1.5), 11.2), along(F1), (0.0, 1.0))
        out = 1.0 if d1 > d0 else -1.0; db = d1 - 0.6 * out                # the canopy's posts behind the back row
        zr = 12.6 - 1.4 * abs(d1 - db) / abs(d1 - (d0 + 1.5 * out))       # the canopy's height above them
        for p in bandframe(s0, s1, db, 15.0): B.box('trk_steel', p[0], p[1], 0.0, 0.25, 0.25, zr, ang, False, False)
        for s in (s0, s1):
            a, _ = frame(s, d0); b, _ = frame(s, d1)
            B.quad('trk_stand', (a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], 12.6), (a[0], a[1], 1.2))
    if area['pitlane']:
        s0, s1, d0, d1 = area['pitlane']
        P0, P1 = bandframe(s0, s1, d0, 3.0), bandframe(s0, s1, d1, 3.0)
        L, R = (P0, P1) if d0 > d1 else (P1, P0)
        B.strip('trk_asphalt', L, R, 0.01, False, along(L), (0.0, abs(d1 - d0)))
        B.ribbon('trk_line', bandframe(s0, s1, d1 + (0.4 if d1 < d0 else -0.4), 3.0), 0.2, 0.016)
    if area['pits']:
        s0, s1, d0, d1 = area['pits']                           # right of the straight, d0 the front (facing the track)
        F, Bk = bandframe(s0, s1, d0), bandframe(s0, s1, d1)
        vF = [x / 8.0 for x in along(F)]
        verts_f = list(zip(F, vF))
        for (a, ua), (b, ub) in zip(verts_f, verts_f[1:]):
            B.quad('trk_pit', (a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], 9.0), (a[0], a[1], 9.0), ((ua, 0), (ub, 0), (ub, 1), (ua, 1)))
        B.wall('trk_stand', Bk, 9.0)
        L, R = (F, Bk) if d0 > d1 else (Bk, F)
        B.strip('trk_roof', L, R, 9.0, False, along(L), (0.0, abs(d1 - d0)))
        for s in (s0, s1):
            a, _ = frame(s, d0); b, _ = frame(s, d1)
            B.quad('trk_stand', (a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], 9.0), (a[0], a[1], 9.0))

    # 7. marshal posts, braking boards
    for s, side in ts.marshal_posts(pts, width, closed):
        (mx, my), mt = frame(s, side * (e + ts.MARSHAL_BACK)); a = math.atan2(mt[1], mt[0])
        B.box('trk_marshal', mx, my, 0.0, 2.0, 2.0, 2.2, a, False, False); B.box('trk_orange', mx, my, 2.2, 2.4, 2.4, 0.25, a, True, True)
    for s, side, label in ts.braking_boards(pts, width, closed):
        (cx, cy), t = frame(s, side * (e + BOARD_BACK)); nx, ny = -t[1], t[0]
        j = ('150', '100', '50').index(label)
        a = (cx + nx * 0.55, cy + ny * 0.55); b = (cx - nx * 0.55, cy - ny * 0.55)   # left to right as the approaching driver sees it
        B.quad('trk_brake', (a[0], a[1], 0.6), (b[0], b[1], 0.6), (b[0], b[1], 2.1), (a[0], a[1], 2.1), ((j / 3, 0), ((j + 1) / 3, 0), ((j + 1) / 3, 1), (j / 3, 1)))
        B.quad('trk_steel', (cx - nx * 0.05, cy - ny * 0.05, 0), (cx + nx * 0.05, cy + ny * 0.05, 0), (cx + nx * 0.05, cy + ny * 0.05, 0.6), (cx - nx * 0.05, cy - ny * 0.05, 0.6))

    # 8. trees: two crossed quads each, turned by their position, on the atlas (species a in its left half, b its right)
    for x, y, sp, h in ts.trees(pts, width, closed, seed):
        asp = ts.TREE_ASPECT[sp]; w = h * asp
        cu = 0.25 if sp == 'a' else 0.75; u0, u1 = cu - asp / 4, cu + asp / 4
        r = (x * 12.9898 + y * 78.233) % (math.pi / 2)
        for q in (0.0, math.pi / 2):
            c, s_ = math.cos(r + q) * w / 2, math.sin(r + q) * w / 2
            B.quad('trk_trees', (x - c, y - s_, 0.0), (x + c, y + s_, 0.0), (x + c, y + s_, h), (x - c, y - s_, h), ((u0, 0), (u1, 0), (u1, 1), (u0, 1)))

    # 9. a wood's edge all round: the tree-line strip 170 m outside the centreline's bounds (20 m past the fence), in
    # whole tiles of its texture (u one per tile, so the loop closes on a tile's edge; v 0 to 26 / 26.5)
    ring = outset_rect(min(xs), min(ys), max(xs), max(ys), 170.0)
    cum = cumulative(ring + [ring[0]], False)[0]; tile = cum[-1] / max(1, round(cum[-1] / TREELINE_TILE))
    B.wall('trk_treeline', ring, 26.0, True, 0.0, [c / tile for c in cum], 26.0 / 26.5)
    return B

def outset_rect(x0, y0, x1, y1, d, step=20.0):
    """The points d outside the rectangle (x0, y0)-(x1, y1), counter-clockwise: its sides moved out and quarter circles
    of radius d round its corners, about `step` m apart."""
    out = []
    corners = [((x1, y0), -math.pi / 2), ((x1, y1), 0.0), ((x0, y1), math.pi / 2), ((x0, y0), math.pi)]
    for k, ((cx, cy), a0) in enumerate(corners):
        m = max(2, int(math.ceil(d * math.pi / 2 / step)))
        out += [(cx + d * math.cos(a0 + math.pi / 2 * q / m), cy + d * math.sin(a0 + math.pi / 2 * q / m)) for q in range(m + 1)]
        (nx, ny), _ = corners[(k + 1) % 4]; (ax, ay) = out[-1]
        bx, by = nx + d * math.cos(a0 + math.pi / 2), ny + d * math.sin(a0 + math.pi / 2)
        L = math.hypot(bx - ax, by - ay); m2 = int(L // step)
        out += [(ax + (bx - ax) * q / (m2 + 1), ay + (by - ay) * q / (m2 + 1)) for q in range(1, m2 + 1)]
    return out

def build_track(tid, seed=11):
    d, pts = load_track(tid)
    width = float(d.get('widthM', 12)); closed = True
    cum, total = cumulative(pts, closed)
    vis, data = collection('Track.' + tid), collection('Track.' + tid + '.Data')
    clear(vis); clear(data)
    make_poly(tid + '.centre', pts, True, data, {'width': width, 'name': TRACK_NAMES[tid]})
    B = scenery(tid, pts, width, seed)
    # walls both sides, with gaps where the track folds back or crosses itself
    for side, name in ((1, 'left'), (-1, 'right')):
        for k, (run, c) in enumerate(wall_runs(pts, closed, side * (width / 2 + 4.0), width)):
            wall_object('%s.wall.%s.%d' % (tid, name, k), run, c, data)       # the physics walls (scenery() draws the barriers)
    # the cell's fence
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    fence = [(min(xs) - 150, min(ys) - 150), (max(xs) + 150, min(ys) - 150), (max(xs) + 150, max(ys) + 150), (min(xs) - 150, max(ys) + 150)]
    wall_object(tid + '.wall.fence', fence, True, data)
    # the start: lobby, return portal, markers, gantry, grandstand, pit building (right-hand side = -left)
    def at(s, right=0.0):
        p, t = point_at(pts, cum, total, s, closed); return (p[0] + t[1] * right, p[1] - t[0] * right), t
    (lx, ly), lt = at(total - 60); empty(tid + '.lobby', lx, ly, 0, heading_of(lt), None, data)
    (rx, ry), _ = at(total - 100, width / 2 + 2); empty(tid + '.return', rx, ry, 0, None, None, data); B.ring('trk_paint', rx, ry, 5.5, 6.5, 0.02)
    evs = [e for e, (ty, tr, kind, arg) in EVENTS.items() if tr == tid]
    for k, e in enumerate(evs):
        (mx, my), _ = at(30 * (k + 1), width / 2 + 2); empty('marker.' + e, mx, my, 0, None, None, data)
    # routes
    for e, (ty, tr, kind, arg) in EVENTS.items():
        if tr != tid: continue
        props = {'event': e, 'type': ty}
        if kind == 'loop':
            make_poly('route.' + e, pts, True, data, dict(props, cp_every=CP_EVERY))
        elif kind == 'lap':
            make_poly('route.' + e, pts + [pts[0]], False, data, dict(props, cp_every=CP_EVERY))
        elif kind == 'sector':
            s0, s1 = arg; seg = [point_at(pts, cum, total, s, closed)[0] for s in frange(s0, s1, 3.0)] + [point_at(pts, cum, total, s1, closed)[0]]
            make_poly('route.' + e, seg, False, data, dict(props, cp_every=CP_EVERY, s0=float(s0), s1=float(s1)))
        elif kind == 'drag':
            need, end_before = arg
            if end_before is None: s0, s1 = longest_straight(pts, cum, total, need)
            else: s1 = total - end_before; s0 = s1 - need           # on the start straight, ending before the line
            a, _ = point_at(pts, cum, total, s0, closed); b0, _ = point_at(pts, cum, total, s1, closed)
            L = dist(a, b0); b = (a[0] + (b0[0] - a[0]) / L * need, a[1] + (b0[1] - a[1]) / L * need)   # exactly `need` m along the chord
            make_poly('route.' + e, [a, b], False, data, dict(props, s0=float(s0), s1=float(s1), cp_every=CP_EVERY))
            # the drag marker sits at its start line, off the racing line
            (mx, my), _ = at(s0 - 20, width / 2 + 2); ob = bpy.data.objects.get('marker.' + e)
            if ob: ob.location = (mx, my, 0)
            B.ribbon('trk_line', [a, b], 0.3, 0.02)
    B.emit(vis, tid + '.')
    return {'len': round(total, 1), 'area_sign': 1 if signed_area(pts) > 0 else -1}

def frange(a, b, step):
    s = a
    while s < b: yield s; s += step

def build_all():
    build_hub()
    out = {}
    for tid in TRACK_IDS:
        if os.path.exists(os.path.join(DATA_DIR, tid + '.json')): out[tid] = build_track(tid)
    bpy.context.view_layer.update()
    return out

def report():
    out = {}
    for c in bpy.data.collections:
        if not c.name.endswith('.Data'): continue
        for ob in c.objects:
            if ob.type == 'CURVE': out[c.name + '/' + ob.name] = round(curve_length(ob), 1)
    tris = {}
    for c in bpy.data.collections:
        if c.name.endswith('.Data'): continue
        t = 0
        for ob in c.objects:
            if ob.type == 'MESH': t += sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if t: tris[c.name] = t
    out['_triangles'] = tris
    return out
