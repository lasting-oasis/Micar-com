"""Bake each MiCar category car into a game-ready GLB for the dealer simulator (three.js).

Run inside Blender after builder.py has been exec'd into the same namespace (needs build(), sc, KEEP).

Output per car (forward = +Z, up = +Y, ground at y = 0, centred on x/z, real-world metres):
  body_paint  one mesh, one material named "paint"  -> recolour / clearcoat / rust in the sim
  body_trim   glass, chrome, black trim, head and tail lights
  wheel_FL, wheel_FR, wheel_RL, wheel_RR  origin at the hub, axle along X -> rotateX() rolls them
"""
import bpy, bmesh, math, os, json
from mathutils import Matrix, Vector

ROT = Matrix.Rotation(-math.pi / 2, 4, 'Z')  # Blender +X forward -> -Y, which glTF writes as +Z
WHEELS = ('wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR')
MATNAME = {'NV_paint': 'paint', 'NV_glass': 'glass', 'NV_chrome': 'chrome', 'NV_dark': 'trim',
           'NV_rubber': 'rubber', 'NV_head': 'headlight', 'NV_tail': 'taillight'}


def export_materials():
    """Clean material copies with the names the sim's loader looks for."""
    out = {}
    for src, name in MATNAME.items():
        m = bpy.data.materials.get('EX_' + name)
        if m is None:
            m = bpy.data.materials[src].copy(); m.name = 'EX_' + name
        out[src] = m
    return out


def baked_parts(sc, KEEP):
    dg = bpy.context.evaluated_depsgraph_get()
    parts = []
    for o in list(sc.objects):
        if o.name in KEEP or o.type != 'MESH' or o.hide_render:
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
        me.transform(ROT @ o.matrix_world)
        group = next((w for w in WHEELS if o.name.startswith(w)), None)
        parts.append((group, me))
    return parts


def split(me, keep):
    """Copy of `me` keeping only faces whose material name satisfies keep(name)."""
    bm = bmesh.new(); bm.from_mesh(me)
    mats = [m.name if m else '' for m in me.materials]
    dead = [f for f in bm.faces if not keep(mats[f.material_index] if mats else '')]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context='FACES')
    out = me.copy(); bm.to_mesh(out); bm.free()
    return out if len(out.polygons) else None


def joined(name, meshes, coll, mats):
    objs = []
    for i, me in enumerate(meshes):
        for slot in range(len(me.materials)):
            m = me.materials[slot]
            if m and m.name in mats:
                me.materials[slot] = mats[m.name]
        ob = bpy.data.objects.new('%s_%d' % (name, i), me); coll.objects.link(ob); objs.append(ob)
    with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    ob = objs[0]; ob.name = name; ob.data.name = name
    return ob


def bake(kind, out_dir, sc, KEEP, build):
    build(kind)
    mats = export_materials()
    parts = baked_parts(sc, KEEP)
    coll = bpy.data.collections.get('EXPORT') or bpy.data.collections.new('EXPORT')
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    made = []
    paint = [m for m in (split(me, lambda n: n == 'NV_paint') for g, me in parts if g is None) if m]
    trim = [m for m in (split(me, lambda n: n != 'NV_paint') for g, me in parts if g is None) if m]
    made.append(joined('body_paint', paint, coll, mats))
    made.append(joined('body_trim', trim, coll, mats))
    for w in WHEELS:
        ob = joined(w, [me for g, me in parts if g == w], coll, mats)
        pts = [v.co for v in ob.data.vertices]
        c = Vector(((min(p.x for p in pts) + max(p.x for p in pts)) / 2, (min(p.y for p in pts) + max(p.y for p in pts)) / 2, (min(p.z for p in pts) + max(p.z for p in pts)) / 2))
        ob.data.transform(Matrix.Translation(-c)); ob.location = c
        made.append(ob)
    for g, me in parts:
        if me.users == 0:
            bpy.data.meshes.remove(me)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in made)
    allv = [o.matrix_world @ v.co for o in made for v in o.data.vertices]
    size = [max(v[i] for v in allv) - min(v[i] for v in allv) for i in range(3)]
    for scn in bpy.data.scenes:
        for vl in scn.view_layers:
            for o in vl.objects:
                try: o.select_set(False, view_layer=vl)
                except Exception: pass
    for o in made:
        o.select_set(True)
    path = os.path.join(out_dir, kind + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_animations=False)
    for o in made:
        me = o.data; bpy.data.objects.remove(o, do_unlink=True); bpy.data.meshes.remove(me)
    # Blender is Z-up; glTF swaps to Y-up, so length (Blender -Y after ROT) is the glTF Z extent
    return {'tris': tris, 'bytes': os.path.getsize(path), 'size_m': {'width': round(size[0], 3), 'length': round(size[1], 3), 'height': round(size[2], 3)}}
