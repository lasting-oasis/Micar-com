import bpy, bmesh, math, os
from mathutils import Vector
WSEG = 64       # wheel/tyre segments (renders); the game export lowers it
BSEG_MAX = 4    # cap on bevel segments (renders); the game export lowers it
sc = bpy.data.scenes['NexusGarage']; bpy.context.window.scene = sc; coll = sc.collection
M = {k: bpy.data.materials['NV_' + k] for k in ('paint', 'dark', 'glass', 'rubber', 'chrome', 'head', 'tail')}
KEEP = {'floor', 'tubeL', 'tubeR', 'tubeTop', 'softbox', 'key', 'rim', 'fill', 'cam', 'target'}
bpy.data.objects['tubeTop'].visible_camera = False
def clear_car():
    for o in list(sc.objects):
        if o.name not in KEEP: bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0: bpy.data.meshes.remove(me)
def smooth(o, angle=32):
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True)
    try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        try: bpy.ops.object.shade_smooth()
        except Exception: pass
def bevel(o, w=0.035, seg=4, angle=40):
    b = o.modifiers.new('Bevel', 'BEVEL'); b.width = w; b.segments = min(seg, BSEG_MAX); b.limit_method = 'ANGLE'; b.angle_limit = math.radians(angle); b.harden_normals = True; return b
def mesh_obj(name, bm, m, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.location = loc; coll.objects.link(o); o.data.materials.append(m); return o
def box(name, size, loc, m, bev=0.03, rot=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    o = mesh_obj(name, bm, m, loc)
    if rot: o.rotation_euler = rot
    if bev: bevel(o, bev)
    smooth(o); return o
def cutter(name, bm, loc, rot=None):
    c = mesh_obj(name, bm, M['dark'], loc)
    if rot: c.rotation_euler = rot
    c.hide_render = True; c.hide_viewport = True; c.display_type = 'WIRE'; return c
def boolean(o, c):
    md = o.modifiers.new('Cut', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = c; md.solver = 'EXACT'; o.modifiers.move(len(o.modifiers) - 1, 0)
def extrude_profile(bm, pts, half_w):
    vs = [bm.verts.new((x, -half_w, z)) for x, z in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    verts = [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 2 * half_w, 0)), verts=verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
def profile_solid(name, pts, half_w, m, bev=0.05, seg=4, taper=None):
    bm = bmesh.new(); extrude_profile(bm, pts, half_w)
    if taper:
        z0, k = taper
        for v in bm.verts:
            if v.co.z > z0: v.co.y *= k
    o = mesh_obj(name, bm, m); bevel(o, bev, seg); smooth(o); return o
def greenhouse(name, pts, half_w, taper, inset=0.075):
    bm = bmesh.new(); extrude_profile(bm, pts, half_w)
    z0, k = taper
    for v in bm.verts:
        if v.co.z > z0 + 0.01: v.co.y *= k
    bm.normal_update()
    sides = [f for f in bm.faces if abs(f.normal.y) > 0.8]
    bmesh.ops.inset_individual(bm, faces=sides, thickness=inset, depth=0.0); bm.normal_update()
    for f in bm.faces: f.material_index = 0
    for f in sides:
        f.material_index = 1
        for v in f.verts: v.co -= f.normal * 0.025
    for f in bm.faces:
        n = f.normal
        if abs(n.y) < 0.3 and abs(n.x) > 0.45 and n.z > 0.2: f.material_index = 1
    o = mesh_obj(name, bm, M['paint']); o.data.materials.append(M['glass']); bevel(o, 0.03, 3); smooth(o); return o
def wheel(name, loc, R=0.40, w=0.27, spokes=5):
    s = 1 if loc[1] > 0 else -1
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=WSEG, radius1=R, radius2=R, depth=w)
    t = mesh_obj(name + '_tire', bm, M['rubber'], loc); t.rotation_euler = (math.radians(90), 0, 0); bevel(t, 0.05, 4); smooth(t)
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=WSEG, radius1=R * 0.66, radius2=R * 0.66, depth=w + 0.01)
    rim = mesh_obj(name + '_rim', bm, M['chrome'], loc); rim.rotation_euler = (math.radians(90), 0, 0); bevel(rim, 0.015, 2); smooth(rim)
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=WSEG, radius1=R * 0.56, radius2=R * 0.56, depth=w)
    boolean(rim, cutter(name + '_dishcut', bm, (loc[0], loc[1] + s * (w / 2 + 0.04), loc[2]), (math.radians(90), 0, 0)))
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=WSEG, radius1=R * 0.56, radius2=R * 0.56, depth=0.04)
    back = mesh_obj(name + '_back', bm, M['dark'], (loc[0], loc[1] + s * 0.02, loc[2])); back.rotation_euler = (math.radians(90), 0, 0)
    for i in range(spokes):
        a = i * 2 * math.pi / spokes
        sp = box(name + '_sp%d' % i, (0.085, 0.06, R * 0.54), (loc[0] + math.sin(a) * R * 0.28, loc[1] + s * (w / 2 - 0.03), loc[2] + math.cos(a) * R * 0.28), M['chrome'], 0.01)
        sp.rotation_euler = (0, a, 0)
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=max(12, WSEG // 2), radius1=R * 0.15, radius2=R * 0.15, depth=0.07)
    hub = mesh_obj(name + '_hub', bm, M['chrome'], (loc[0], loc[1] + s * (w / 2 - 0.01), loc[2])); hub.rotation_euler = (math.radians(90), 0, 0); bevel(hub, 0.01, 2); smooth(hub)
def front_rear(L, W, zb, zg, zh, zt, mirror, fog=True, grille_w=1.1):
    x = L / 2
    box('bumperF', (0.22, 2 * W + 0.02, 0.24), (x - 0.06, 0, zb), M['dark'], 0.04)
    box('grille', (0.08, grille_w, 0.26), (x, 0, zg), M['dark'], 0.01)
    box('gbar', (0.1, grille_w + 0.04, 0.035), (x + 0.01, 0, zg + 0.09), M['chrome'], 0.008)
    box('gbar2', (0.1, grille_w + 0.04, 0.035), (x + 0.01, 0, zg - 0.09), M['chrome'], 0.008)
    box('bumperR', (0.22, 2 * W + 0.02, 0.24), (-x + 0.06, 0, zb + 0.02), M['dark'], 0.04)
    for s in (1, -1):
        box('head%d' % s, (0.08, 0.3, 0.18), (x - 0.02, (W - 0.26) * s, zh), M['head'], 0.012)
        if fog: box('fog%d' % s, (0.05, 0.14, 0.07), (x + 0.02, (W - 0.3) * s, zb + 0.03), M['head'], 0.006)
        box('tail%d' % s, (0.08, 0.16, 0.24), (-x, (W - 0.12) * s, zt), M['tail'], 0.012)
        box('mirror%d' % s, (0.15, 0.13, 0.1), (mirror[0], (W + 0.07) * s, mirror[1]), M['paint'], 0.015)
        box('mstem%d' % s, (0.05, 0.1, 0.035), (mirror[0], (W + 0.01) * s, mirror[1] - 0.03), M['dark'], 0.0)
def handles(xs, W, z):
    for s in (1, -1):
        for hx in xs: box('handle%d_%d' % (s, int(hx * 100)), (0.15, 0.025, 0.03), (hx, (W + 0.012) * s, z), M['chrome'], 0.005)
def arches_and_wheels(body, wb, W, R, w=0.26):
    for (x, y) in ((wb[0], W), (wb[0], -W), (wb[1], W), (wb[1], -W)):
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=WSEG, radius1=R + 0.12, radius2=R + 0.12, depth=0.6)
        boolean(body, cutter('arch', bm, (x, y, R + 0.02), (math.radians(90), 0, 0)))
    for x, y, n in ((wb[0], W - 0.06, 'FL'), (wb[0], -(W - 0.06), 'FR'), (wb[1], W - 0.06, 'RL'), (wb[1], -(W - 0.06), 'RR')): wheel('wheel_' + n, (x, y, R), R, w)
def pillars(xs, W, z, h):
    for x in xs: box('pillar%d' % int(x * 100), (0.07, 2 * W - 0.1, h), (x, 0, z), M['paint'], 0.01)

def build(kind):
    clear_car()
    if kind == 'pickup':
        W = 0.955; R = 0.41; wb = (1.62, -1.62); L = 5.4
        lower = [(2.62, 0.46), (2.7, 0.72), (2.68, 0.9), (2.58, 1.1), (2.2, 1.16), (1.2, 1.2), (1.05, 1.28), (-0.95, 1.28), (-1.0, 1.32), (-2.66, 1.32), (-2.7, 1.0), (-2.66, 0.5), (-2.3, 0.44), (2.3, 0.44)]
        body = profile_solid('body', lower, W, M['paint'], 0.06, 4, (1.14, 0.985))
        greenhouse('cab', [(1.08, 1.27), (0.5, 1.84), (0.1, 1.87), (-0.72, 1.87), (-0.95, 1.36), (-0.95, 1.27)], W - 0.02, (1.3, 0.88))
        pillars([0.1], W - 0.02, 1.57, 0.5)
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=Vector((1.6, 2 * W - 0.26, 0.5)), verts=bm.verts)
        boolean(body, cutter('bedcut', bm, (-1.83, 0, 1.37))); box('bedfloor', (1.6, 2 * W - 0.26, 0.04), (-1.83, 0, 1.12), M['dark'], 0.0)
        front_rear(L, W, 0.56, 0.9, 0.93, 1.02, (0.92, 1.38)); handles([0.55, -0.55], W, 1.12)
        for s in (1, -1): box('step%d' % s, (2.2, 0.12, 0.05), (0.05, (W + 0.02) * s, 0.5), M['dark'], 0.01)
        arches_and_wheels(body, wb, W, R, 0.27)
    elif kind == 'suv':
        W = 0.95; R = 0.42; wb = (1.42, -1.42); L = 4.85
        lower = [(2.35, 0.5), (2.42, 0.78), (2.4, 0.98), (2.3, 1.12), (1.45, 1.18), (1.0, 1.24), (-2.3, 1.24), (-2.42, 1.0), (-2.4, 0.5), (-2.1, 0.44), (2.1, 0.44)]
        body = profile_solid('body', lower, W, M['paint'], 0.06, 4, (1.1, 0.985))
        greenhouse('cab', [(1.0, 1.23), (0.42, 1.78), (0.0, 1.82), (-2.15, 1.82), (-2.36, 1.5), (-2.36, 1.23)], W - 0.02, (1.3, 0.9), 0.08)
        pillars([0.08, -1.15], W - 0.02, 1.52, 0.5)
        front_rear(L, W, 0.6, 0.92, 0.96, 1.02, (0.85, 1.34)); handles([0.5, -0.65], W, 1.08)
        box('rack', (2.0, 1.3, 0.05), (-1.0, 0, 1.86), M['dark'], 0.01)
        arches_and_wheels(body, wb, W, R, 0.26)
    elif kind == 'sedan':
        W = 0.92; R = 0.35; wb = (1.41, -1.41); L = 4.9
        lower = [(2.4, 0.4), (2.45, 0.62), (2.42, 0.8), (2.3, 0.9), (1.5, 0.98), (1.0, 1.02), (-1.3, 1.02), (-2.1, 1.0), (-2.4, 0.95), (-2.45, 0.75), (-2.42, 0.45), (-2.1, 0.36), (2.1, 0.36)]
        body = profile_solid('body', lower, W, M['paint'], 0.05, 4, (0.95, 0.985))
        greenhouse('cab', [(1.05, 1.01), (0.45, 1.42), (0.0, 1.46), (-0.9, 1.44), (-1.55, 1.05), (-1.55, 1.01)], W - 0.02, (1.05, 0.86))
        pillars([0.0], W - 0.02, 1.22, 0.4)
        front_rear(L, W, 0.5, 0.72, 0.76, 0.72, (0.85, 1.1), grille_w=1.0); handles([0.5, -0.5], W, 0.88)
        arches_and_wheels(body, wb, W, R, 0.23)
    elif kind == 'coupe':
        W = 0.93; R = 0.36; wb = (1.36, -1.36); L = 4.78
        lower = [(2.4, 0.38), (2.42, 0.58), (2.4, 0.78), (2.25, 0.88), (1.2, 0.95), (0.9, 1.0), (-1.2, 1.02), (-2.2, 1.0), (-2.42, 0.9), (-2.42, 0.68), (-2.35, 0.42), (-2.05, 0.34), (2.05, 0.34)]
        body = profile_solid('body', lower, W, M['paint'], 0.05, 4, (0.92, 0.985))
        greenhouse('cab', [(0.95, 0.99), (0.2, 1.36), (-0.3, 1.38), (-1.0, 1.3), (-1.7, 1.02), (-1.7, 0.99)], W - 0.02, (1.0, 0.85))
        front_rear(L, W, 0.48, 0.68, 0.72, 0.7, (0.6, 1.06), grille_w=1.0); handles([0.1], W, 0.86)
        arches_and_wheels(body, wb, W, R, 0.25)
    elif kind == 'hatch':
        W = 0.9; R = 0.33; wb = (1.31, -1.31); L = 4.28
        lower = [(2.1, 0.4), (2.14, 0.62), (2.12, 0.8), (2.0, 0.92), (1.3, 1.0), (0.9, 1.04), (-2.05, 1.04), (-2.14, 0.9), (-2.12, 0.44), (-1.85, 0.36), (1.85, 0.36)]
        body = profile_solid('body', lower, W, M['paint'], 0.05, 4, (0.98, 0.985))
        greenhouse('cab', [(0.95, 1.03), (0.3, 1.42), (-0.1, 1.46), (-1.6, 1.46), (-2.0, 1.2), (-2.0, 1.03)], W - 0.02, (1.1, 0.88))
        pillars([0.05, -1.0], W - 0.02, 1.24, 0.4)
        front_rear(L, W, 0.5, 0.72, 0.76, 0.74, (0.75, 1.12), grille_w=0.9); handles([0.45, -0.5], W, 0.9)
        arches_and_wheels(body, wb, W, R, 0.22)
    elif kind == 'van':
        W = 0.97; R = 0.36; wb = (1.53, -1.53); L = 5.1
        lower = [(2.5, 0.46), (2.55, 0.7), (2.52, 0.95), (2.35, 1.05), (1.6, 1.1), (1.3, 1.14), (-2.45, 1.14), (-2.55, 0.95), (-2.52, 0.46), (-2.2, 0.4), (2.2, 0.4)]
        body = profile_solid('body', lower, W, M['paint'], 0.05, 4, (1.05, 0.985))
        greenhouse('cab', [(1.3, 1.13), (0.4, 1.72), (0.0, 1.78), (-2.3, 1.78), (-2.5, 1.5), (-2.5, 1.13)], W - 0.02, (1.2, 0.93), 0.08)
        pillars([0.3, -0.9, -1.95], W - 0.02, 1.45, 0.55)
        front_rear(L, W, 0.56, 0.82, 0.86, 0.98, (1.25, 1.3), grille_w=1.1); handles([0.75, -0.3], W, 1.0)
        arches_and_wheels(body, wb, W, R, 0.23)
    elif kind == 'wagon':
        W = 0.92; R = 0.37; wb = (1.38, -1.38); L = 4.86
        lower = [(2.4, 0.46), (2.45, 0.68), (2.42, 0.9), (2.3, 1.02), (1.4, 1.08), (1.0, 1.12), (-2.3, 1.12), (-2.42, 0.95), (-2.4, 0.5), (-2.1, 0.42), (2.1, 0.42)]
        body = profile_solid('body', lower, W, M['paint'], 0.05, 4, (1.0, 0.985))
        greenhouse('cab', [(1.0, 1.11), (0.35, 1.6), (0.0, 1.66), (-1.8, 1.66), (-2.3, 1.4), (-2.3, 1.11)], W - 0.02, (1.15, 0.9))
        pillars([0.08, -1.05], W - 0.02, 1.38, 0.45)
        box('rack', (1.9, 1.2, 0.05), (-0.9, 0, 1.7), M['dark'], 0.01)
        front_rear(L, W, 0.54, 0.8, 0.84, 0.92, (0.85, 1.2), grille_w=1.0); handles([0.5, -0.6], W, 0.96)
        arches_and_wheels(body, wb, W, R, 0.24)
    elif kind == 'convertible':
        W = 0.86; R = 0.31; wb = (1.155, -1.155); L = 3.92
        lower = [(1.95, 0.36), (1.98, 0.52), (1.96, 0.7), (1.85, 0.8), (1.0, 0.88), (0.7, 0.94), (-1.0, 0.96), (-1.8, 0.94), (-1.96, 0.86), (-1.96, 0.6), (-1.9, 0.4), (-1.65, 0.32), (1.65, 0.32)]
        body = profile_solid('body', lower, W, M['paint'], 0.05, 4, (0.9, 0.985))
        greenhouse('cab', [(0.75, 0.93), (0.3, 1.24), (0.2, 1.25), (0.1, 0.93)], W - 0.04, (0.95, 0.92), 0.05)
        box('seat1', (0.5, 0.5, 0.42), (-0.35, 0.36, 1.0), M['dark'], 0.05); box('seat2', (0.5, 0.5, 0.42), (-0.35, -0.36, 1.0), M['dark'], 0.05)
        box('hoop', (0.08, 1.3, 0.2), (-0.75, 0, 1.05), M['dark'], 0.03)
        front_rear(L, W, 0.46, 0.64, 0.68, 0.68, (0.55, 0.98), fog=False, grille_w=0.8); handles([0.0], W, 0.82)
        arches_and_wheels(body, wb, W, R, 0.22)
    elif kind == 'sports':
        # Low, wide, long hood, fastback roof, big wheels, rear wing
        W = 0.97; R = 0.355; wb = (1.36, -1.3); L = 4.62
        lower = [(2.3, 0.32), (2.34, 0.46), (2.3, 0.6), (2.12, 0.7), (1.2, 0.8), (0.75, 0.86), (-1.1, 0.9), (-1.95, 0.92), (-2.28, 0.86), (-2.31, 0.62), (-2.25, 0.36), (-1.95, 0.29), (1.95, 0.29)]
        body = profile_solid('body', lower, W, M['paint'], 0.05, 4, (0.78, 0.97))
        greenhouse('cab', [(0.72, 0.85), (0.05, 1.2), (-0.35, 1.23), (-1.05, 1.12), (-1.9, 0.91), (-1.9, 0.85)], W - 0.04, (0.95, 0.84), 0.07)
        box('wing', (0.28, 1.62, 0.035), (-2.08, 0, 1.08), M['dark'], 0.01)
        for s in (1, -1):
            box('wingpost%d' % s, (0.08, 0.04, 0.15), (-2.02, 0.55 * s, 0.99), M['dark'], 0.005)
            box('intake%d' % s, (0.42, 0.03, 0.12), (-0.95, (W - 0.005) * s, 0.62), M['dark'], 0.01)
        box('splitter', (0.24, 2 * W - 0.1, 0.04), (2.24, 0, 0.3), M['dark'], 0.01)
        box('diffuser', (0.2, 1.3, 0.1), (-2.24, 0, 0.36), M['dark'], 0.01)
        front_rear(L, W, 0.4, 0.5, 0.6, 0.7, (0.55, 0.98), fog=False, grille_w=0.9); handles([0.25], W, 0.8)
        arches_and_wheels(body, wb, W, R, 0.27)
    return L

def shoot(kind, path):
    L = build(kind); d = 1.68 * L
    cam = bpy.data.objects['cam']; cam.location = (0.76 * d, -0.615 * d, 0.21 * d); cam.data.lens = 50
    bpy.data.objects['target'].location = (0.1, 0.1, 0.16 * L)
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); return os.path.getsize(path)