"""Build the Strip race park in Blender (5.x) from LAYOUT: curves, walls and empties in the `Data`
collection (the race data), visual meshes in the `Track` collection (the scenery; exported to glb).

Run inside Blender (Text editor, or exec(open(path).read()) through the MCP connection), then
`build()` and `report()`. Idempotent: build() clears both collections first.

Coordinates: Blender metres, x east, y north, z up. The game reads x = bx, z = -by (the glTF Y-up
conversion); tools/blender/export_strip.py applies the same mapping to the data.

Curves are Bezier with explicit (FREE) handles set to a Catmull-Rom tangent, so the sweep here and the
exporter sample the very same curve with mathutils.geometry.interpolate_bezier. Route curves carry the
custom property `cp_idx`: the indices of the control points that are checkpoints (always 0; for a
non-cyclic route always the last).
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector
from mathutils.geometry import interpolate_bezier

# ----------------------------------------------------------------------------------------- layout
# materials: flat colours (sRGB 0..1)
MATS = {
    'tarmac': (0.16, 0.17, 0.19), 'kerb_red': (0.78, 0.09, 0.10), 'kerb_white': (0.92, 0.92, 0.90),
    'runoff': (0.72, 0.62, 0.42), 'barrier': (0.62, 0.64, 0.66), 'concrete': (0.55, 0.56, 0.58),
    'steel': (0.30, 0.32, 0.36), 'foliage': (0.18, 0.40, 0.17), 'paint': (1.0, 0.82, 0.25),
    'tree_lights': (0.95, 0.55, 0.12), 'bark': (0.30, 0.22, 0.14), 'glass': (0.35, 0.50, 0.60),
}

def rounded_rect(x0, y0, x1, y1, r, n=3):
    """Control points of a rounded rectangle, anticlockwise from the middle of the south side."""
    pts = []
    def arc(cx, cy, a0, a1):
        for k in range(n + 1):
            a = a0 + (a1 - a0) * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts.append(((x0 + x1) / 2, y0))
    arc(x1 - r, y0 + r, -math.pi / 2, 0)
    pts.append((x1, (y0 + y1) / 2))
    arc(x1 - r, y1 - r, 0, math.pi / 2)
    pts.append(((x0 + x1) / 2, y1))
    arc(x0 + r, y1 - r, math.pi / 2, math.pi)
    pts.append((x0, (y0 + y1) / 2))
    arc(x0 + r, y0 + r, math.pi, 3 * math.pi / 2)
    return pts

RING = rounded_rect(-480, -120, 480, 480, 80)          # anticlockwise: south middle -> east -> north -> west
CIRCUIT = [  # anticlockwise; start/finish on the pit straight heading north
    (-100, -40), (-100, 120), (-100, 250), (-125, 335), (-190, 395), (-280, 420), (-370, 425), (-430, 385),
    (-445, 300), (-400, 240), (-310, 230), (-240, 190), (-245, 120), (-310, 90), (-400, 95), (-445, 30),
    (-420, -45), (-345, -85), (-255, -70), (-195, -95), (-140, -90),
]
STADIUM_C = (300, 200)
STADIUM_SHORT = [(250, 120), (330, 120), (382, 160), (378, 222), (330, 222), (300, 262), (248, 262), (212, 215), (215, 155)]
STADIUM_LONG = [(250, 120), (330, 120), (382, 160), (378, 222), (330, 222), (345, 275), (305, 305), (245, 300), (200, 255), (192, 180), (215, 140)]
DRAG_Y = -250
DRAG = [(-480, DRAG_Y), (520, DRAG_Y)]
DRAG_START = -420
PADDOCK = (-90, -114, 90, -15)                         # x0, y0, x1, y1

ROADS = {  # name: (points, cyclic, width)
    'ring': (RING, True, 12),
    'circuit': (CIRCUIT, True, 12),
    'stadium_short': (STADIUM_SHORT, True, 10),
    'stadium_long': (STADIUM_LONG, True, 10),
    'drag': (DRAG, False, 20),
    'pit_access': ([(-100, -120), (-100, -80), (-100, -40)], False, 10),
    'stadium_access': ([(300, -120), (300, 0), (300, 120)], False, 10),
    'drag_access': ([(-150, -120), (-300, -170), (-440, -225), (-450, DRAG_Y)], False, 10),
    'paddock_in': ([(0, -120), (0, -90), (0, -60)], False, 12),
}

def rev_from(pts, k):
    """A cyclic loop reversed, starting at control point k."""
    p = list(reversed(pts))
    i = p.index(pts[k])
    return p[i:] + p[:i]

# routes: (points, cyclic, checkpoint indices or None for all)
ROUTES = {
    'ci1': (CIRCUIT, True, [0, 3, 6, 9, 12, 15, 18]),
    'ci2': (rev_from(CIRCUIT, 6), True, [0, 3, 6, 9, 12, 15, 18]),
    'sx1': (STADIUM_SHORT, True, [0, 2, 4, 6]),
    'df1': (rev_from(STADIUM_SHORT, 4), True, [0, 2, 4, 6]),
    'sx2': (STADIUM_LONG, True, [0, 2, 4, 6, 8]),
    'df2': (rev_from(STADIUM_LONG, 5), True, [0, 2, 4, 6, 8]),
    'dr1': ([(DRAG_START, DRAG_Y), (DRAG_START + 402, DRAG_Y)], False, None),
    'dr2': ([(DRAG_START, DRAG_Y), (DRAG_START + 805, DRAG_Y)], False, None),
    # sprints start in the paddock, each at its own marker, and run out onto the ring road
    'sp1': ([(-30, -70), (-30, -100), (-70, -120), (-100, -120), (-100, -80), (-100, -40), (-100, 120), (-100, 250), (-125, 335), (-190, 395), (-280, 420)],
            False, [0, 3, 5, 7, 10]),
    'sp2': ([(30, -70), (30, -100), (70, -120)] + RING[1:4] + RING[4:9] + RING[9:14] + RING[14:19] + RING[19:] + [(-150, -120), (0, -120), (150, -120), (300, -120), (300, 0), (300, 120)],
            False, None),
    'sp3': ([(0, -95), (-50, -120), (-100, -120), (-100, -80)] + CIRCUIT + [CIRCUIT[0]], False, None),
}
# checkpoint indices for sp2 / sp3 are chosen after the points are known (every 4th), see _cps()

MARKERS = {'dr1': (DRAG_START - 20, DRAG_Y + 12), 'dr2': (DRAG_START - 20, DRAG_Y - 12)}
EMPTIES = {  # name: (x, y, z, heading_deg from +Y clockwise or None, props)
    'spawn': (0, -30, 0, 0, {}),
    'exit': (70, -70, 0, None, {'radius': 9.0}),
    'rental.bay': (-50, -30, 0, 0, {}),
    'rental.cam': (-72, -52, 5, None, {}),
    'rental.kiosk': (-30, -45, 0, None, {}),
}

def circle(cx, cy, r, n, a0=0.0, a1=2 * math.pi):
    return [(cx + r * math.cos(a0 + (a1 - a0) * k / n), cy + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]

def offset_polyline(pts, d):
    """pts offset to the left (d > 0) of the direction of travel."""
    out = []
    n = len(pts)
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
        out.append((p[0] - ty / L * d, p[1] + tx / L * d))
    return out

# ----------------------------------------------------------------------------------------- curves
def catmull_handles(pts, cyclic):
    """(point, handle_left, handle_right) per control point, Catmull-Rom tangents (tension .5)."""
    n = len(pts); out = []
    for i, p in enumerate(pts):
        if cyclic:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        else:
            a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        tx, ty = (b[0] - a[0]) / 6, (b[1] - a[1]) / 6
        if not cyclic and (i == 0 or i == n - 1):
            tx, ty = (b[0] - a[0]) / 3, (b[1] - a[1]) / 3
        out.append((Vector((p[0], p[1], 0)), Vector((p[0] - tx, p[1] - ty, 0)), Vector((p[0] + tx, p[1] + ty, 0))))
    return out

def make_curve(name, pts, cyclic, coll, props=None):
    cd = bpy.data.curves.new(name, 'CURVE'); cd.dimensions = '2D'
    sp = cd.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1); sp.use_cyclic_u = cyclic
    for bp, (p, hl, hr) in zip(sp.bezier_points, catmull_handles(pts, cyclic)):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'FREE'; bp.handle_left = hl; bp.handle_right = hr
    ob = bpy.data.objects.new(name, cd); coll.objects.link(ob)
    for k, v in (props or {}).items(): ob[k] = v
    return ob

def sample_curve(ob, step=2.0):
    """Points (x, y) along the curve at about `step` m, plus the arc length of every control point."""
    sp = ob.data.splines[0]; bps = sp.bezier_points; n = len(bps); segs = n if sp.use_cyclic_u else n - 1
    raw = []; cp_len = [0.0]; total = 0.0
    for k in range(segs):
        a, b = bps[k], bps[(k + 1) % n]
        seg = interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, 24)
        if k == 0: raw.append((seg[0].x, seg[0].y))
        for q in seg[1:]:
            total += math.hypot(q.x - raw[-1][0], q.y - raw[-1][1]); raw.append((q.x, q.y))
        cp_len.append(total)
    if sp.use_cyclic_u: raw = raw[:-1]
    # resample at `step`
    out = [raw[0]]; acc = 0.0
    for i in range(1, len(raw)):
        a, b = raw[i - 1], raw[i]; L = math.hypot(b[0] - a[0], b[1] - a[1])
        while acc + L >= step:
            t = (step - acc) / L; a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); out.append(a); L -= step - acc; acc = 0.0
        acc += L
    if not sp.use_cyclic_u and (out[-1] != raw[-1]): out.append(raw[-1])
    return out, cp_len[:n] if sp.use_cyclic_u else cp_len, total

def curve_length(ob):
    return sample_curve(ob)[2]

# ----------------------------------------------------------------------------------------- meshes
class Builder:
    """Collects triangles/quads per material; one mesh object per material in the end."""
    def __init__(self):
        self.parts = {m: ([], []) for m in MATS}
    def quad(self, m, a, b, c, d):
        v, f = self.parts[m]; o = len(v); v += [a, b, c, d]; f.append((o, o + 1, o + 2, o + 3))
    def tri(self, m, a, b, c):
        v, f = self.parts[m]; o = len(v); v += [a, b, c]; f.append((o, o + 1, o + 2))
    def box(self, m, cx, cy, z0, sx, sy, sz, ang=0.0):
        c, s = math.cos(ang), math.sin(ang)
        def P(x, y, z): return (cx + x * c - y * s, cy + x * s + y * c, z)
        hx, hy = sx / 2, sy / 2; z1 = z0 + sz
        p = [P(-hx, -hy, z0), P(hx, -hy, z0), P(hx, hy, z0), P(-hx, hy, z0), P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1)]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.quad(m, *[p[i] for i in q])
    def ribbon(self, m, pts, width, z, closed=False):
        L = offset_polyline(pts, width / 2); R = offset_polyline(pts, -width / 2); n = len(pts)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            self.quad(m, (L[i][0], L[i][1], z), (R[i][0], R[i][1], z), (R[j][0], R[j][1], z), (L[j][0], L[j][1], z))
    def wall_strip(self, m, pts, height, thick=0.4, closed=False):
        """A thin vertical wall along pts (both faces and a top)."""
        L = offset_polyline(pts, thick / 2); R = offset_polyline(pts, -thick / 2); n = len(pts)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            self.quad(m, (L[i][0], L[i][1], 0), (L[j][0], L[j][1], 0), (L[j][0], L[j][1], height), (L[i][0], L[i][1], height))
            self.quad(m, (R[j][0], R[j][1], 0), (R[i][0], R[i][1], 0), (R[i][0], R[i][1], height), (R[j][0], R[j][1], height))
            self.quad(m, (L[i][0], L[i][1], height), (L[j][0], L[j][1], height), (R[j][0], R[j][1], height), (R[i][0], R[i][1], height))
    def cone(self, m, cx, cy, z0, r, h, n=7):
        top = (cx, cy, z0 + h)
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            self.tri(m, (cx + r * math.cos(a0), cy + r * math.sin(a0), z0), (cx + r * math.cos(a1), cy + r * math.sin(a1), z0), top)
    def cylinder(self, m, cx, cy, z0, r, h, n=8):
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            self.quad(m, (cx + r * math.cos(a0), cy + r * math.sin(a0), z0), (cx + r * math.cos(a1), cy + r * math.sin(a1), z0),
                      (cx + r * math.cos(a1), cy + r * math.sin(a1), z0 + h), (cx + r * math.cos(a0), cy + r * math.sin(a0), z0 + h))
    def emit(self, coll):
        made = []
        for m, (v, f) in self.parts.items():
            if not f: continue
            me = bpy.data.meshes.new(m); me.from_pydata(v, [], f); me.validate(); me.update()
            mat = material(m); me.materials.append(mat)
            ob = bpy.data.objects.new(m, me); coll.objects.link(ob); made.append(ob)
        return made

def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    r, g, b = MATS[name]; bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9 if name in ('tarmac', 'runoff', 'concrete', 'foliage', 'bark') else 0.5
    if name == 'tree_lights' or name == 'paint':
        bsdf.inputs['Emission Color'].default_value = (r, g, b, 1.0); bsdf.inputs['Emission Strength'].default_value = 1.0 if name == 'tree_lights' else 0.3
    return mat

def curvature(pts, i):
    a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
    ax, ay = b[0] - a[0], b[1] - a[1]; bx, by = c[0] - b[0], c[1] - b[1]
    cross = ax * by - ay * bx; la, lb = math.hypot(ax, ay), math.hypot(bx, by)
    return 0.0 if la * lb == 0 else cross / (la * lb * ((la + lb) / 2))

def kerbs(B, pts, width, closed, walls):
    """Alternating red/white kerbs on both sides where the road bends; tyre barriers outside the corner."""
    n = len(pts); run = []
    for i in range(n if closed else n - 1):
        k = curvature(pts, i) if (closed or 0 < i < n - 1) else 0.0
        bend = abs(k) > 1 / 180
        if bend:
            j = (i + 1) % n
            for side in (1, -1):
                Lp = offset_polyline([pts[i], pts[j]], side * (width / 2 + 0.3))
                B.ribbon('kerb_red' if (i // 1) % 2 == 0 else 'kerb_white', Lp, 0.6, 0.02)
            run.append((i, -1 if k > 0 else 1))
        elif run:
            walls.append(_barrier_run(pts, run, width)); run = []
    if run: walls.append(_barrier_run(pts, run, width))

def _barrier_run(pts, run, width):
    side = run[len(run) // 2][1]; idx = [i for i, _ in run]
    seg = [pts[i] for i in idx] + [pts[(idx[-1] + 1) % len(pts)]]
    return offset_polyline(seg, side * (width / 2 + 5.0))

# ----------------------------------------------------------------------------------------- build
def collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    return c

def clear(coll):
    for ob in list(coll.objects):
        data = ob.data; bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh): bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve): bpy.data.curves.remove(data)

def wall_object(name, pts, closed, coll):
    me = bpy.data.meshes.new(name); n = len(pts)
    edges = [(i, (i + 1) % n) for i in range(n if closed else n - 1)]
    me.from_pydata([(p[0], p[1], 0.0) for p in pts], edges, []); me.update()
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob); return ob

def empty(name, x, y, z, heading_deg, props, coll):
    ob = bpy.data.objects.new(name, None); ob.empty_display_type = 'ARROWS'; ob.empty_display_size = 4
    ob.location = (x, y, z)
    if heading_deg is not None: ob.rotation_euler = (0, 0, -math.radians(heading_deg))  # +Y is heading 0, clockwise positive
    for k, v in props.items(): ob[k] = v
    coll.objects.link(ob); return ob

def _cps(name, pts, cyclic, given):
    if given is not None: return given
    if name == 'sp2': idx = list(range(0, len(pts), 4))
    elif name == 'sp3': idx = [0, 2] + list(range(4, len(pts), 3))
    else: idx = list(range(len(pts)))
    if 0 not in idx: idx = [0] + idx
    if not cyclic and (len(pts) - 1) not in idx: idx.append(len(pts) - 1)
    return sorted(set(idx))

def build(seed=7):
    rnd = random.Random(seed)
    data, track = collection('Data'), collection('Track')
    clear(track); clear(data)
    # --- data: roads, routes, empties
    road_obs = {}
    for name, (pts, cyc, width) in ROADS.items():
        road_obs[name] = make_curve('road.' + name, pts, cyc, data, {'width': float(width)})
    for name, (pts, cyc, cps) in ROUTES.items():
        make_curve('route.' + name, pts, cyc, data, {'cp_idx': _cps(name, pts, cyc, cps)})
    for name, (x, y, z, hd, props) in EMPTIES.items(): empty(name, x, y, z, hd, props, data)
    for name, (x, y) in MARKERS.items(): empty('marker.' + name, x, y, 0, None, {}, data)
    # --- track meshes
    B = Builder(); walls = []
    px0, py0, px1, py1 = PADDOCK
    B.box('tarmac', (px0 + px1) / 2, (py0 + py1) / 2, -0.02, px1 - px0, py1 - py0, 0.03)
    # drag staging apron
    B.box('tarmac', DRAG_START - 35, DRAG_Y, -0.02, 70, 40, 0.03)
    for name, (pts, cyc, width) in ROADS.items():
        spts, _, _ = sample_curve(road_obs[name])
        B.ribbon('tarmac', spts, width, 0.01, closed=cyc)
        if name in ('circuit', 'stadium_short', 'stadium_long'):
            corner_walls = []
            kerbs(B, spts, width, cyc, corner_walls)
            if name == 'circuit':
                for w in corner_walls:
                    if len(w) > 6: walls.append(('wall.circuit_%d' % len(walls), w, False))
            # run-off strip outside the kerbs (sand), both sides
            for side in (1, -1):
                B.ribbon('runoff', offset_polyline(spts, side * (width / 2 + 2.6)), 3.0, 0.004, closed=cyc)
    # drag strip lane lines (paint)
    for lane in (-5, 0, 5):
        B.ribbon('paint', [(DRAG_START, DRAG_Y + lane), (DRAG_START + 820, DRAG_Y + lane)], 0.18, 0.02)
    B.ribbon('paint', [(DRAG_START, DRAG_Y - 10), (DRAG_START, DRAG_Y + 10)], 0.5, 0.02)       # start line
    B.ribbon('paint', [(DRAG_START + 402, DRAG_Y - 10), (DRAG_START + 402, DRAG_Y + 10)], 0.5, 0.02)
    B.ribbon('paint', [(DRAG_START + 805, DRAG_Y - 10), (DRAG_START + 805, DRAG_Y + 10)], 0.5, 0.02)
    # --- walls: outer fence, drag sides, stadium bowl, paddock
    fence = [(-540, -310), (570, -310), (570, 540), (-540, 540)]
    walls.append(('wall.fence', fence, True))
    walls.append(('wall.drag_n', [(-485, DRAG_Y + 12), (525, DRAG_Y + 12)], False))
    walls.append(('wall.drag_s', [(-485, DRAG_Y - 12), (525, DRAG_Y - 12)], False))
    bowl_a0, bowl_a1 = math.radians(285), math.radians(255 + 360)   # open to the south between 255 and 285 deg
    bowl = circle(STADIUM_C[0], STADIUM_C[1], 110, 44, bowl_a0, bowl_a1)
    walls.append(('wall.bowl', bowl, False))
    walls.append(('wall.paddock', [(px0, py0), (px0, py1), (px1, py1), (px1, py0)], False))
    for name, pts, closed in walls:
        wall_object(name, pts, closed, data)
        if name.startswith('wall.circuit'):
            # tyre barrier: boxes 2 m long along the run
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]; ang = math.atan2(b[1] - a[1], b[0] - a[0])
                B.box('barrier', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, math.hypot(b[0] - a[0], b[1] - a[1]), 0.8, 1.1, ang)
        else:
            B.wall_strip('barrier' if 'drag' in name or 'fence' in name else 'concrete', pts, 1.2 if 'bowl' not in name else 1.0, 0.4, closed)
    # --- stadium bowl seating: three stepped rings outside the wall, with the same southern gap
    for k in range(3):
        r0, r1, z = 112 + k * 4, 116 + k * 4, 1.0 + k * 1.6
        inner = circle(STADIUM_C[0], STADIUM_C[1], r0, 44, bowl_a0, bowl_a1); outer = circle(STADIUM_C[0], STADIUM_C[1], r1, 44, bowl_a0, bowl_a1)
        for i in range(len(inner) - 1):
            B.quad('concrete', (inner[i][0], inner[i][1], z), (inner[i + 1][0], inner[i + 1][1], z), (outer[i + 1][0], outer[i + 1][1], z), (outer[i][0], outer[i][1], z))
            B.quad('concrete', (outer[i][0], outer[i][1], z), (outer[i + 1][0], outer[i + 1][1], z), (outer[i + 1][0], outer[i + 1][1], z + 1.6), (outer[i][0], outer[i][1], z + 1.6))
            B.quad('concrete', (inner[i][0], inner[i][1], 0), (inner[i][0], inner[i][1], z), (inner[i + 1][0], inner[i + 1][1], z), (inner[i + 1][0], inner[i + 1][1], 0))
    # --- grandstands: pit straight (infield side, facing east), drag strip (both sides)
    def grandstand(cx, cy, length, ang):
        for k in range(6):
            B.box('concrete', cx + math.sin(ang) * k * 2.2 * -1, cy + math.cos(ang) * k * 2.2, 0, length, 2.2, 0.9 + k * 0.9, ang)
        # roof on posts
        B.box('steel', cx - math.sin(ang) * 6, cy + math.cos(ang) * 6, 7.5, length, 14, 0.3, ang)
    grandstand(-112, 60, 70, math.radians(90))        # west of the pit straight, rising westward
    grandstand(-110, 180, 60, math.radians(90))
    grandstand(DRAG_START + 200, DRAG_Y + 20, 70, math.radians(0))    # north of the strip, rising north
    grandstand(DRAG_START + 300, DRAG_Y - 20, 70, math.radians(180))  # south of the strip, rising south
    # --- pit garages along the paddock's north edge, the MiCar sign over them
    for k in range(6):
        B.box('concrete', 6 + k * 14, py1 - 5, 0, 12, 8, 5)
        B.box('glass', 6 + k * 14, py1 - 9.2, 0.3, 9, 0.3, 3.8)
    B.box('steel', 40, py1 - 2, 0, 0.4, 0.4, 9); B.box('steel', 60, py1 - 2, 0, 0.4, 0.4, 9)
    B.box('paint', 50, py1 - 2, 9, 24, 0.6, 3.2)
    # --- drag Christmas tree and gantries
    B.box('steel', DRAG_START - 4, DRAG_Y - 13, 0, 0.4, 0.4, 7)
    for k in range(6): B.box('tree_lights', DRAG_START - 4, DRAG_Y - 13, 2 + k * 0.8, 0.6, 0.6, 0.6)
    for gx in (DRAG_START + 402, DRAG_START + 805):
        B.box('steel', gx, DRAG_Y - 13, 0, 0.5, 0.5, 9); B.box('steel', gx, DRAG_Y + 13, 0, 0.5, 0.5, 9); B.box('steel', gx, DRAG_Y, 8.5, 0.5, 27, 0.6)
    # --- light poles: ring (outer side), paddock, drag
    rpts, _, rlen = sample_curve(road_obs['ring'], 2.0)
    for i in range(0, len(rpts), 70):
        p = offset_polyline([rpts[i], rpts[(i + 1) % len(rpts)]], -9.0)[0]
        B.cylinder('steel', p[0], p[1], 0, 0.18, 10); B.box('steel', p[0], p[1], 10, 0.5, 0.5, 0.5)
    for x in (-80, -40, 0, 40, 80): B.cylinder('steel', x, py0 + 4, 0, 0.18, 10)
    for k in range(0, 14): B.cylinder('steel', DRAG_START - 40 + k * 70, DRAG_Y + 14, 0, 0.18, 9)
    # --- trees outside the ring road, clear of every road and the drag strip
    road_samples = [q for name in ROADS for q in sample_curve(road_obs[name], 6.0)[0]]
    placed = 0; tries = 0
    while placed < 60 and tries < 4000:
        tries += 1
        x, y = rnd.uniform(-530, 560), rnd.uniform(-130, 530)
        if -470 < x < 470 and -110 < y < 470: continue          # inside the ring: leave the venues clear
        if y < -140: continue                                      # the drag strip's grounds
        if min(math.hypot(x - q[0], y - q[1]) for q in road_samples) < 16: continue
        h = rnd.uniform(5, 9); B.cylinder('bark', x, y, 0, 0.25, 1.6, 6); B.cone('foliage', x, y, 1.4, rnd.uniform(1.8, 2.8), h, 7); placed += 1
    B.emit(track)
    bpy.context.view_layer.update()
    return report()

def report():
    out = {}
    for ob in bpy.data.collections['Data'].objects:
        if ob.type == 'CURVE': out[ob.name] = round(curve_length(ob), 1)
    tris = 0
    for ob in bpy.data.collections['Track'].objects:
        if ob.type == 'MESH': tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    out['_triangles'] = tris
    return out
