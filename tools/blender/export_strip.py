"""Export the Strip from Blender: hub.glb + hub.json, tracks/<id>.glb + tracks/<id>.json, tracks.json.

Run inside Blender after tools/blender/build_strip.py built the scene (or headless:
blender -b apps/sim/assets/strip/district.blend -P tools/blender/export_strip.py), then `export_all()`.

Game coordinates: x = Blender x, z = -Blender y (what the glTF exporter's Y-up conversion does to the
meshes); headings come from the empties' `h` property. Circuit data is written LOCAL to the circuit
(the game adds the track's offset). Fails loudly (RuntimeError) on a missing route, a bent drag, bad
checkpoints, a non-finite number or a file over budget.
"""
import json
import math
import os
import bpy

REPO = os.environ.get('MICAR_REPO', r'C:\Users\Owner\Micar-com-strip-tracks')
PUBLIC = os.path.join(REPO, 'apps', 'sim', 'public', 'strip')
SRC = os.path.join(REPO, 'apps', 'sim', 'src', 'world', 'strip')
TRACK_IDS = ['spa', 'monza', 'silverstone', 'suzuka', 'nurburgring', 'monaco', 'interlagos', 'cota', 'laguna', 'bathurst']
EVENTS = {  # id -> (track, type); mirrors apps/sim/src/world/data.ts
    'harbour_gp': ('monaco', 'circuit'), 'lagoons_sprint': ('interlagos', 'sprint'), 'harbour_drift': ('monaco', 'drift'),
    'royal_drag': ('monza', 'drag'), 'drylagoon_x': ('laguna', 'streetx'), 'royal_gp': ('monza', 'circuit'),
    'lagoons_gp': ('interlagos', 'circuit'), 'airfield_sprint': ('silverstone', 'sprint'), 'figure8_drift': ('suzuka', 'drift'),
    'mountain_drag': ('bathurst', 'drag'), 'figure8_gp': ('suzuka', 'circuit'), 'eifel_gp': ('nurburgring', 'circuit'),
    'harbour_x': ('monaco', 'streetx'), 'mountain_sprint': ('bathurst', 'sprint'), 'lonestar_gp': ('cota', 'circuit'),
    'airfield_gp': ('silverstone', 'circuit'), 'mountain_drift': ('bathurst', 'drift'), 'ardennes_gp': ('spa', 'circuit'),
    'mountain_gp': ('bathurst', 'circuit'), 'ardennes_sprint': ('spa', 'sprint'),
}
BUDGET = {'hub_glb': 1_500_000, 'track_glb': 800_000, 'json': 200_000}
STEP = 3.0

def _build_ns():
    src = open(os.path.join(REPO, 'tools', 'blender', 'build_strip.py'), encoding='utf-8').read()
    ns = {}; exec(compile(src, 'build_strip.py', 'exec'), ns); return ns
NS = _build_ns()
sample_curve, cumulative, point_at = NS['sample_curve'], NS['cumulative'], NS['point_at']

def g1(p):
    """Blender (x, y) -> game (x, z), 1 decimal (walls)."""
    return [round(p[0], 1), round(-p[1], 1)]
def g(p):
    """Blender (x, y) -> game (x, z), rounded."""
    return [round(p[0], 2), round(-p[1], 2)]
def fin(v):
    if isinstance(v, (int, float)):
        if not math.isfinite(v): raise RuntimeError('non-finite value')
    elif isinstance(v, dict):
        for x in v.values(): fin(x)
    elif isinstance(v, (list, tuple)):
        for x in v: fin(x)
    return v

def world_xy(ob):
    m = ob.matrix_world; return (m[0][3], m[1][3], m[2][3])

def route_data(ob):
    sp = ob.data.splines[0]; loop = bool(sp.use_cyclic_u)
    pts, _, _ = sample_curve(ob, STEP)
    _, total = cumulative(pts, loop)            # the length of the EXPORTED points (the game's buildRoute gives the same)
    if 'cp_every' in ob:
        n = max(1, round(total / float(ob['cp_every']))); cps = [round(total * k / n, 2) for k in range(n if loop else n + 1)]
        if not loop: cps[-1] = round(total, 2)
    else:
        cps = [0.0] if loop else [0.0, round(total, 2)]
    if cps[0] != 0.0: raise RuntimeError(ob.name + ': cps[0] must be 0')
    for a, b in zip(cps, cps[1:]):
        if not b > a: raise RuntimeError(ob.name + ': cps not increasing')
    if not loop and abs(cps[-1] - total) > 0.05: raise RuntimeError(ob.name + ': last cp must be the end')
    return {'pts': [g(p) for p in pts], 'loop': loop, 'cps': cps}, total

def walls_of(coll, prefix='wall.'):
    out = []
    for ob in coll.objects:
        if ob.type != 'MESH' or not ob.name.startswith(prefix): continue
        me = ob.data; m = ob.matrix_world
        verts = [m @ v.co for v in me.vertices]
        # chain edges into polylines
        adj = {}
        for e in me.edges:
            a, b = e.vertices
            if verts[a].z > 1 or verts[b].z > 1: continue
            adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
        seen = set()
        for start in sorted(adj):
            if start in seen or len(adj[start]) == 2: continue
            chain = [start]; seen.add(start); prev = None; cur = start
            while True:
                nxt = [v for v in adj[cur] if v != prev and v not in seen]
                if not nxt: break
                prev, cur = cur, nxt[0]; chain.append(cur); seen.add(cur)
            if len(chain) >= 2: out.append([g1((verts[i].x, verts[i].y)) for i in chain])
        for start in sorted(adj):  # closed loops (every vertex has two neighbours)
            if start in seen: continue
            chain = [start]; seen.add(start); prev = None; cur = start
            while True:
                nxt = [v for v in adj[cur] if v != prev and v not in seen]
                if not nxt: break
                prev, cur = cur, nxt[0]; chain.append(cur); seen.add(cur)
            chain.append(start)
            out.append([g1((verts[i].x, verts[i].y)) for i in chain])
    return out

def bounds_of(ptss):
    xs = [p[0] for pts in ptss for p in pts]; zs = [p[1] for pts in ptss for p in pts]
    return {'minX': round(min(xs), 1), 'minZ': round(min(zs), 1), 'maxX': round(max(xs), 1), 'maxZ': round(max(zs), 1)}

def export_glb(coll, path, budget):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in coll.objects:
        if ob.type == 'MESH': ob.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_animations=False, export_cameras=False, export_lights=False, export_normals=False,
                              export_materials='EXPORT', export_texcoords=False, export_extras=False)
    size = os.path.getsize(path)
    if size > budget: raise RuntimeError('%s is %d bytes, over the budget of %d' % (path, size, budget))
    return size

def write_json(path, data, budget=BUDGET['json']):
    fin(data)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    txt = json.dumps(data, separators=(',', ':'))
    if len(txt.encode('utf-8')) > budget: raise RuntimeError('%s is %d bytes, over the budget of %d' % (path, len(txt), budget))
    with open(path, 'w', encoding='utf-8', newline='\n') as f: f.write(txt + '\n')
    return len(txt)

def export_hub():
    hub, data = bpy.data.collections['Hub'], bpy.data.collections['Hub.Data']
    roads = []
    for ob in data.objects:
        if ob.type == 'CURVE' and ob.name.startswith('road.'):
            pts, _, _ = sample_curve(ob, STEP)
            roads.append({'id': ob.name[5:], 'pts': [g(p) for p in pts], 'loop': bool(ob.data.splines[0].use_cyclic_u), 'width': float(ob['width'])})
    E = {ob.name: ob for ob in data.objects if ob.type == 'EMPTY'}
    def xz(name): x, y, _ = world_xy(E[name]); return g((x, y))
    sp = xz('spawn'); bay = xz('rental.bay'); cam = world_xy(E['rental.cam']); kiosk = xz('rental.kiosk'); ex = xz('exit')
    out = {
        'version': 1, 'bounds': bounds_of([r['pts'] for r in roads]),
        'spawn': {'x': sp[0], 'z': sp[1], 'h': round(float(E['spawn']['h']), 4)}, 'exit': {'x': ex[0], 'z': ex[1], 'r': float(E['exit']['radius'])},
        'rental': {'bay': {'x': bay[0], 'z': bay[1], 'h': round(float(E['rental.bay']['h']), 4)}, 'cam': {'x': round(cam[0], 2), 'y': round(cam[2], 2), 'z': round(-cam[1], 2)}, 'kiosk': {'x': kiosk[0], 'z': kiosk[1]}},
        'roads': roads, 'wander': 'loop', 'walls': walls_of(data), 'portals': {n[7:]: xz(n) for n in E if n.startswith('portal.')},
    }
    for tid in TRACK_IDS:
        if tid not in out['portals']: raise RuntimeError('hub: no portal for ' + tid)
    sizes = {'hub.glb': export_glb(hub, os.path.join(PUBLIC, 'hub.glb'), BUDGET['hub_glb']), 'hub.json': write_json(os.path.join(SRC, 'hub.json'), out)}
    return sizes

def export_track(tid):
    vis, data = bpy.data.collections['Track.' + tid], bpy.data.collections['Track.' + tid + '.Data']
    centre = data.objects[tid + '.centre']; cpts, _, clen = sample_curve(centre, STEP); width = float(centre['width'])
    routes = {}; lens = {}
    for ob in data.objects:
        if ob.type == 'CURVE' and ob.name.startswith('route.'):
            e = ob.name[6:]; routes[e], lens[e] = route_data(ob)
    want = {e for e, (tr, ty) in EVENTS.items() if tr == tid}
    if set(routes) != want: raise RuntimeError('%s: routes %s but events %s' % (tid, sorted(routes), sorted(want)))
    for e, (tr, ty) in EVENTS.items():
        if tr != tid: continue
        r = routes[e]
        if ty == 'drag':
            a, b = r['pts'][0], r['pts'][-1]; L = math.hypot(b[0] - a[0], b[1] - a[1])
            if abs(L - 402) > 2 and abs(L - 805) > 2: raise RuntimeError('%s: drag %s is %.1f m' % (tid, e, L))
            for p in r['pts']:
                dev = abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L
                if dev > 0.5: raise RuntimeError('%s: drag %s bends %.2f m' % (tid, e, dev))
            # the chord stays on the tarmac: within 1.5 m of the centreline
            for p in (a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]):
                if min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in [g(c) for c in cpts]) > 1.5 + STEP / 2: raise RuntimeError('%s: drag %s leaves the tarmac' % (tid, e))
    E = {ob.name: ob for ob in data.objects if ob.type == 'EMPTY'}
    def xz(name): x, y, _ = world_xy(E[name]); return g((x, y))
    lob = xz(tid + '.lobby'); ret = xz(tid + '.return')
    markers = {n[7:]: xz(n) for n in E if n.startswith('marker.')}
    for e in routes:
        markers.setdefault(e, routes[e]['pts'][0])
    out = {
        'version': 1, 'id': tid, 'name': NS['TRACK_NAMES'][tid], 'offset': list(NS['offset_of'](tid)),
        'source': 'OpenStreetMap', 'licence': 'ODbL 1.0', 'attribution': 'Map data © OpenStreetMap contributors (ODbL)',
        'bounds': bounds_of([[g(p) for p in cpts]] + walls_of(data, tid + '.wall.')),
        'lobby': {'x': lob[0], 'z': lob[1], 'h': round(float(E[tid + '.lobby']['h']), 4)}, 'return': ret,
        'centre': {'pts': [g(p) for p in cpts], 'width': width, 'loop': True},
        'routes': routes, 'walls': walls_of(data, tid + '.wall.'), 'markers': markers,
    }
    sizes = {tid + '.glb': export_glb(vis, os.path.join(PUBLIC, 'tracks', tid + '.glb'), BUDGET['track_glb']),
             tid + '.json': write_json(os.path.join(PUBLIC, 'tracks', tid + '.json'), out)}
    return sizes, clen, sorted(routes), lens

def export_all():
    sizes = export_hub(); index = []
    for tid in TRACK_IDS:
        if 'Track.' + tid not in bpy.data.collections: raise RuntimeError('no collection for ' + tid)
        s, clen, evs, lens = export_track(tid); sizes.update(s)
        index.append({'id': tid, 'name': NS['TRACK_NAMES'][tid], 'offset': list(NS['offset_of'](tid)), 'lenM': round(clen, 1), 'events': evs, 'routeLenM': {e: round(lens[e], 1) for e in evs}})
    sizes['tracks.json'] = write_json(os.path.join(SRC, 'tracks.json'), {'version': 1, 'tracks': index})
    return sizes

if __name__ == '__main__' and bpy.app.background:
    print(json.dumps(export_all(), indent=1))
