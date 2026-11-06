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
    k = TRACK_IDS.index(tid)
    return (8000 * (k % 4), 8000 * (k // 4))

# events: id -> (type, track, kind, arg); kind: 'loop' | 'lap' (start to start, non-loop) | ('sector', s0, s1) | ('drag', metres)
EVENTS = {
    'harbour_gp': ('circuit', 'monaco', 'loop', None), 'lagoons_sprint': ('sprint', 'interlagos', 'lap', None),
    'harbour_drift': ('drift', 'monaco', 'sector', (1400, 2300)), 'royal_drag': ('drag', 'monza', 'drag', 402),
    'drylagoon_x': ('streetx', 'laguna', 'loop', None), 'royal_gp': ('circuit', 'monza', 'loop', None),
    'lagoons_gp': ('circuit', 'interlagos', 'loop', None), 'airfield_sprint': ('sprint', 'silverstone', 'lap', None),
    'figure8_drift': ('drift', 'suzuka', 'sector', (300, 1500)), 'mountain_drag': ('drag', 'bathurst', 'drag', 805),
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
def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    r, g, b = MATS[name]; bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9 if name in ('tarmac', 'gravel', 'concrete', 'foliage', 'bark') else 0.5
    if name == 'paint':
        bsdf.inputs['Emission Color'].default_value = (r, g, b, 1.0); bsdf.inputs['Emission Strength'].default_value = 0.3
    if name == 'barrier':
        mat.use_backface_culling = False
    return mat

# ----------------------------------------------------------------------------------------- geometry
def dist(a, b): return math.hypot(b[0] - a[0], b[1] - a[1])
def lerp(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

def tangents(pts, closed):
    n = len(pts); out = []
    for i in range(n):
        a = pts[(i - 1) % n] if closed or i > 0 else pts[i]
        b = pts[(i + 1) % n] if closed or i < n - 1 else pts[i]
        tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
        out.append((tx / L, ty / L))
    return out

def offset_polyline(pts, d, closed=False):
    """pts offset by d to the LEFT of travel in Blender x/y (so d < 0 is the right-hand side)."""
    T = tangents(pts, closed)
    return [(p[0] - t[1] * d, p[1] + t[0] * d) for p, t in zip(pts, T)]

def cumulative(pts, closed):
    cum = [0.0]
    for i in range(1, len(pts)): cum.append(cum[-1] + dist(pts[i - 1], pts[i]))
    total = cum[-1] + (dist(pts[-1], pts[0]) if closed else 0.0)
    return cum, total

def point_at(pts, cum, total, s, closed):
    if closed: s = s % total
    else: s = max(0.0, min(total, s))
    n = len(pts)
    lo, hi = 0, len(cum) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum[mid] <= s: lo = mid
        else: hi = mid
    a = pts[lo]; b = pts[(lo + 1) % n] if (lo + 1 < n or closed) else pts[lo]
    segL = (cum[lo + 1] if lo + 1 < len(cum) else total) - cum[lo]
    if closed and lo == n - 1: segL = total - cum[lo]
    t = 0.0 if segL <= 1e-9 else (s - cum[lo]) / segL
    p = lerp(a, b, t); tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
    return p, (tx / L, ty / L)

def resample(pts, step, closed):
    """Points every `step` m along the polyline (the first point kept)."""
    cum, total = cumulative(pts, closed)
    n = int(total // step) if closed else int(math.floor(total / step))
    out = [point_at(pts, cum, total, k * step, closed)[0] for k in range(n + (0 if closed else 1))]
    if not closed and dist(out[-1], pts[-1]) > 1e-6: out.append(pts[-1])
    return out

def curvature(pts, i, closed, w=3):
    """Signed curvature (1/m) at i from points w back and w ahead (smoothed over 6 w metres)."""
    n = len(pts)
    if not closed and (i - w < 0 or i + w >= n): return 0.0
    a, b, c = pts[(i - w) % n], pts[i], pts[(i + w) % n]
    ax, ay = b[0] - a[0], b[1] - a[1]; bx, by = c[0] - b[0], c[1] - b[1]
    cross = ax * by - ay * bx; la, lb = math.hypot(ax, ay), math.hypot(bx, by)
    return 0.0 if la * lb == 0 else 2 * cross / (la * lb * (la + lb))

def signed_area(pts):
    a = 0.0; n = len(pts)
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]
    return a / 2

# ----------------------------------------------------------------------------------------- mesh builder
class Builder:
    """Faces per material, with shared vertices for strips; one mesh object per material in emit()."""
    def __init__(self):
        self.parts = {m: ([], []) for m in MATS}
    def _add(self, m, verts):
        v, _ = self.parts[m]; o = len(v); v.extend(verts); return o
    def quad(self, m, a, b, c, d):
        v, f = self.parts[m]; o = len(v); v += [a, b, c, d]; f.append((o, o + 1, o + 2, o + 3))
    def tri(self, m, a, b, c):
        v, f = self.parts[m]; o = len(v); v += [a, b, c]; f.append((o, o + 1, o + 2))
    def box(self, m, cx, cy, z0, sx, sy, sz, ang=0.0):
        c, s = math.cos(ang), math.sin(ang)
        def P(x, y, z): return (cx + x * c - y * s, cy + x * s + y * c, z)
        hx, hy = sx / 2, sy / 2; z1 = z0 + sz
        p = [P(-hx, -hy, z0), P(hx, -hy, z0), P(hx, hy, z0), P(-hx, hy, z0), P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1)]
        v, f = self.parts[m]; o = len(v); v.extend(p)
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)): f.append(tuple(o + i for i in q))
    def strip(self, m, left, right, z, closed=False):
        """A flat strip between two polylines of equal length, vertices shared along the run."""
        v, f = self.parts[m]; o = len(v); n = len(left)
        for i in range(n): v.append((left[i][0], left[i][1], z)); v.append((right[i][0], right[i][1], z))
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f.append((o + 2 * i, o + 2 * i + 1, o + 2 * j + 1, o + 2 * j))
    def ribbon(self, m, pts, width, z, closed=False):
        self.strip(m, offset_polyline(pts, width / 2, closed), offset_polyline(pts, -width / 2, closed), z, closed)
    def wall(self, m, pts, height, closed=False):
        """A vertical single-sided strip (the material is double-sided)."""
        v, f = self.parts[m]; o = len(v); n = len(pts)
        for p in pts: v.append((p[0], p[1], 0.0)); v.append((p[0], p[1], height))
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f.append((o + 2 * i, o + 2 * j, o + 2 * j + 1, o + 2 * i + 1))
    def cone(self, m, cx, cy, z0, r, h, n=6):
        v, f = self.parts[m]; o = len(v)
        for k in range(n): v.append((cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n), z0))
        v.append((cx, cy, z0 + h))
        for k in range(n): f.append((o + k, o + (k + 1) % n, o + n))
    def cylinder(self, m, cx, cy, z0, r, h, n=6):
        v, f = self.parts[m]; o = len(v)
        for k in range(n):
            a = 2 * math.pi * k / n; v.append((cx + r * math.cos(a), cy + r * math.sin(a), z0)); v.append((cx + r * math.cos(a), cy + r * math.sin(a), z0 + h))
        for k in range(n):
            j = (k + 1) % n; f.append((o + 2 * k, o + 2 * j, o + 2 * j + 1, o + 2 * k + 1))
    def ring(self, m, cx, cy, r0, r1, z, n=40):
        v, f = self.parts[m]; o = len(v)
        for k in range(n):
            a = 2 * math.pi * k / n; v.append((cx + r0 * math.cos(a), cy + r0 * math.sin(a), z)); v.append((cx + r1 * math.cos(a), cy + r1 * math.sin(a), z))
        for k in range(n):
            j = (k + 1) % n; f.append((o + 2 * k, o + 2 * k + 1, o + 2 * j + 1, o + 2 * j))
    def emit(self, coll, prefix=''):
        made = []
        for m, (v, f) in self.parts.items():
            if not f: continue
            me = bpy.data.meshes.new(prefix + m); me.from_pydata(v, [], f); me.validate(); me.update()
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

def nonadjacent_near(pts, closed, i, radius, skip):
    """True when pts[i] is within `radius` of a point more than `skip` indices away (the track folds back or crosses)."""
    n = len(pts); p = pts[i]
    for j in range(n):
        dj = abs(j - i)
        if closed: dj = min(dj, n - dj)
        if dj <= skip: continue
        q = pts[j]
        if abs(q[0] - p[0]) < radius and abs(q[1] - p[1]) < radius and dist(p, q) < radius: return True
    return False

def wall_runs(pts, closed, d, width):
    """Offset polyline split into runs, dropping points that would fall on another part of the track."""
    off = offset_polyline(pts, d, closed); keep = []
    n = len(pts)
    for i in range(n):
        ok = True
        # the wall point against the centreline: near a non-adjacent part -> gap
        p = off[i]
        for j in range(n):
            dj = abs(j - i); dj = min(dj, n - dj) if closed else dj
            if dj <= 15: continue
            q = pts[j]
            if abs(q[0] - p[0]) < width / 2 + 2 and abs(q[1] - p[1]) < width / 2 + 2 and dist(p, q) < width / 2 + 2: ok = False; break
        keep.append(ok)
    runs = []; cur = []
    order = list(range(n))
    if closed:
        # start a run boundary at a dropped point so a closed wall without gaps stays one closed run
        if all(keep): return [(off, True)]
        start = keep.index(False); order = [(start + k) % n for k in range(n)]
    for i in order:
        if keep[i]: cur.append(off[i])
        elif cur: runs.append((cur, False)); cur = []
    if cur: runs.append((cur, False))
    return [(r, c) for r, c in runs if len(r) >= 3]

def longest_straight(pts, cum, total, need):
    """(s0, s1) of the window of length `need` whose points deviate least from its chord."""
    n = len(pts); best = (1e9, 0.0)
    step = 3
    for i in range(0, n, 2):
        s0 = cum[i]; s1 = s0 + need
        a, _ = point_at(pts, cum, total, s0, True); b, _ = point_at(pts, cum, total, s1, True)
        L = dist(a, b)
        if L < need * 0.9: continue
        dev = 0.0; s = s0
        while s < s1:
            p, _ = point_at(pts, cum, total, s, True)
            dev = max(dev, abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L); s += step
            if dev > best[0]: break
        if dev < best[0]: best = (dev, s0)
    return best[1], best[1] + need

def build_track(tid, seed=11):
    d, pts = load_track(tid)
    width = float(d.get('widthM', 12)); closed = True
    cum, total = cumulative(pts, closed)
    vis, data = collection('Track.' + tid), collection('Track.' + tid + '.Data')
    clear(vis); clear(data)
    make_poly(tid + '.centre', pts, True, data, {'width': width, 'name': TRACK_NAMES[tid]})
    T = tangents(pts, closed); n = len(pts)
    B = Builder()
    # tarmac, edge lines, kerbs and gravel on bends
    B.ribbon('tarmac', pts, width, 0.01, closed)
    for side in (1, -1):
        B.ribbon('line', offset_polyline(pts, side * (width / 2 - 0.3), closed), 0.2, 0.02, closed)
    bend = [abs(curvature(pts, i, closed)) > 1 / 150 for i in range(n)]
    i = 0
    while i < n:
        if not bend[i]: i += 1; continue
        j = i
        while j < n and bend[j]: j += 1
        seg = [pts[k % n] for k in range(i - 1, j + 1)]
        for side in (1, -1):
            kerb = offset_polyline(seg, side * (width / 2 + 0.3))
            for k in range(len(kerb) - 1):
                B.strip('kerb_red' if k % 2 == 0 else 'kerb_white', offset_polyline([kerb[k], kerb[k + 1]], side * 0.6), [kerb[k], kerb[k + 1]], 0.02)
            B.ribbon('gravel', offset_polyline(seg, side * (width / 2 + 2.8)), 4.0, 0.004)
        i = j
    # walls both sides, with gaps where the track folds back or crosses itself
    for side, name in ((1, 'left'), (-1, 'right')):
        for k, (run, c) in enumerate(wall_runs(pts, closed, side * (width / 2 + 4.0), width)):
            wall_object('%s.wall.%s.%d' % (tid, name, k), run, c, data); B.wall('barrier', run, 1.0, c)
    # the cell's fence
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    fence = [(min(xs) - 150, min(ys) - 150), (max(xs) + 150, min(ys) - 150), (max(xs) + 150, max(ys) + 150), (min(xs) - 150, max(ys) + 150)]
    wall_object(tid + '.wall.fence', fence, True, data); B.wall('barrier', fence, 1.2, True)
    # the start: lobby, return portal, markers, gantry, grandstand, pit building (right-hand side = -left)
    def at(s, right=0.0):
        p, t = point_at(pts, cum, total, s, closed); return (p[0] + t[1] * right, p[1] - t[0] * right), t
    (lx, ly), lt = at(total - 60); empty(tid + '.lobby', lx, ly, 0, heading_of(lt), None, data)
    (rx, ry), _ = at(total - 100, 8 + width / 2); empty(tid + '.return', rx, ry, 0, None, None, data); B.ring('paint', rx, ry, 5.5, 6.5, 0.02)
    evs = [e for e, (ty, tr, kind, arg) in EVENTS.items() if tr == tid]
    for k, e in enumerate(evs):
        (mx, my), _ = at(30 * (k + 1), 8 + width / 2); empty('marker.' + e, mx, my, 0, None, None, data)
    (gx, gy), gt = at(0.0)
    for side in (1, -1):
        px, py = gx - gt[1] * side * (width / 2 + 1.5), gy + gt[0] * side * (width / 2 + 1.5); B.box('steel', px, py, 0, 0.5, 0.5, 8)
    B.box('steel', gx, gy, 7.5, 0.5, width + 3.5, 0.6, math.atan2(gt[1], gt[0]) + math.pi / 2)
    # grandstand on the left, pit building on the right, along the straight before the line
    for k in range(5):
        (sx, sy), st = at(total - 40, (width / 2 + 10 + k * 2.4) * -1)
        B.box('concrete', sx, sy, 0, 60, 2.4, 0.9 + k * 0.9, math.atan2(st[1], st[0]))
    (bx, by), bt = at(total - 100, width / 2 + 14); B.box('concrete', bx, by, 0, 50, 12, 6, math.atan2(bt[1], bt[0]))
    B.box('glass', bx, by, 1.0, 50.2, 12.2, 2.5, math.atan2(bt[1], bt[0]))
    # light poles every ~len/30 on the left, trees around
    for k in range(30):
        (qx, qy), _ = at(total * k / 30, -(width / 2 + 7)); B.cylinder('steel', qx, qy, 0, 0.18, 10)
    rnd = random.Random(seed); coarse = pts[::5]; placed = 0; tries = 0
    while placed < 120 and tries < 6000:
        tries += 1
        x, y = rnd.uniform(min(xs) - 120, max(xs) + 120), rnd.uniform(min(ys) - 120, max(ys) + 120)
        dmin = min(dist((x, y), q) for q in coarse)
        if dmin < 30 or dmin > 200: continue
        B.cylinder('bark', x, y, 0, 0.3, 1.8); B.cone('foliage', x, y, 1.5, rnd.uniform(2.2, 3.4), rnd.uniform(6, 11)); placed += 1
    B.emit(vis, tid + '.')
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
            s0, s1 = longest_straight(pts, cum, total, arg)
            a, _ = point_at(pts, cum, total, s0, closed); b0, _ = point_at(pts, cum, total, s1, closed)
            L = dist(a, b0); b = (a[0] + (b0[0] - a[0]) / L * arg, a[1] + (b0[1] - a[1]) / L * arg)   # exactly `arg` m along the chord
            make_poly('route.' + e, [a, b], False, data, dict(props, s0=float(s0), s1=float(s1)))
            # the drag marker sits at its start line, off the racing line
            (mx, my), _ = at(s0 - 20, 8 + width / 2); ob = bpy.data.objects.get('marker.' + e)
            if ob: ob.location = (mx, my, 0)
            B2 = Builder(); B2.ribbon('line', [a, b], 0.3, 0.02); B2.emit(vis, tid + '.drag.')
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
