"""The circuit scenery build, run here without Blender: bpy and mathutils are stubbed, and the Builder only collects
vertices, faces and UVs per material (run: pytest tools/blender -q)."""
import json
import math
import os
import sys
import types

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for name in ('bpy', 'mathutils', 'mathutils.geometry'):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules['mathutils'].Vector = lambda v: v
sys.modules['mathutils.geometry'].interpolate_bezier = lambda *a: []
import build_strip as bs  # noqa: E402

IDS = ['spa', 'monza', 'silverstone', 'suzuka', 'nurburgring', 'monaco', 'interlagos', 'cota', 'laguna', 'bathurst']
# what a circuit exports: flat colours share palettes, the two tree species one atlas (one draw call each)
NEW = {'trk_asphalt', 'trk_rubber', 'trk_marks', 'trk_grass', 'trk_grass_mow', 'trk_gravel', 'trk_solid', 'trk_wall',
       'trk_boards', 'trk_tyres', 'trk_fence', 'trk_stand', 'trk_crowd', 'trk_pit', 'trk_brake', 'trk_trees', 'trk_lamps',
       'trk_treeline'}
MERGED = {m for ms in bs.PALETTES.values() for m in ms} | {'trk_tree_a', 'trk_tree_b'}
OLD = {'tarmac', 'barrier', 'concrete', 'foliage', 'bark', 'gravel', 'kerb_red', 'kerb_white', 'line', 'paint', 'steel', 'glass'}
GAME = os.path.join(HERE, '..', '..', 'apps', 'sim', 'src', 'world', 'strip', 'trackMaterials.ts')


def load(tid):
    with open(os.path.join(HERE, '..', 'tracks', 'data', tid + '.json'), encoding='utf-8') as f:
        d = json.load(f)
    return [(p[0], -p[1]) for p in d['pts']], float(d.get('widthM', 12))


BUILT = {}
def built(tid):
    if tid not in BUILT:
        pts, w = load(tid)
        B = bs.scenery(tid, pts, w); B.merge(bs.PALETTES)
        BUILT[tid] = B
    return BUILT[tid]


def tris(B, m):
    v, f, uv = B.parts[m]
    return sum(len(face) - 2 for face in f)


@pytest.mark.parametrize('tid', IDS)
def test_materials(tid):
    B = built(tid)
    used = {m for m, (v, f, uv) in B.parts.items() if f}
    missing = NEW - used
    # a circuit without a tight enough bend has no tyre wall or gravel, one without a long straight no braking boards
    assert missing <= {'trk_tyres', 'trk_gravel', 'trk_brake'}, missing
    assert not (used & OLD) and not (used & MERGED), used & (OLD | MERGED)
    assert used <= set(bs.TRK), used - set(bs.TRK)          # Blender has a preview colour for each


@pytest.mark.parametrize('tid', IDS)
def test_palette_parts_sit_on_their_cells(tid):
    B = built(tid)
    for g, members in bs.PALETTES.items():
        n = len(members); cells = {((j + .5) / n, .5) for j in range(n)}
        v, f, uv = B.parts[g]
        assert f and all((round(u, 9), round(t, 9)) in {(round(a, 9), round(b, 9)) for a, b in cells} for u, t in uv), g
    used = {round(u * len(bs.PALETTES['trk_marks']) - .5) for u, t in B.parts['trk_marks'][2]}
    want = [bs.PALETTES['trk_marks'].index(m) for m in ('trk_line', 'trk_kerb_red', 'trk_kerb_white')]
    assert set(want) <= used
    assert {round(u * 5 - .5) for u, t in B.parts['trk_lamps'][2]} == {0, 1, 2, 3, 4}


@pytest.mark.parametrize('tid', ['monaco', 'spa'])
def test_trees_take_their_species_cell_at_the_sprites_aspect(tid):
    v, f, uv = built(tid).parts['trk_trees']
    assert f
    for face in f:
        us = [uv[k][0] for k in face]; P = [v[k] for k in face]
        u0, u1 = min(us), max(us)
        sp = 'a' if u1 <= .5 else 'b'
        assert (u0 >= 0 and u1 <= .5) or (u0 >= .5 and u1 <= 1), us
        assert abs((u1 - u0) - bs.trackside.TREE_ASPECT[sp] / 2) < 1e-6        # the cell is 512 px of 1024 wide, full height
        w = math.dist(P[0][:2], P[1][:2]); h = max(p[2] for p in P) - min(p[2] for p in P)
        assert abs(w / h - bs.trackside.TREE_ASPECT[sp]) < 1e-6


@pytest.mark.parametrize('tid', IDS)
def test_the_tree_line_rings_the_circuit_outside_the_fence(tid):
    pts, w = load(tid)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    v, f, uv = built(tid).parts['trk_treeline']
    assert f
    for x, y, z in v:
        out = math.hypot(max(min(xs) - x, 0, x - max(xs)), max(min(ys) - y, 0, y - max(ys)))   # from the centreline's bounds
        assert abs(out - 170) < 1, (x, y, out)
        assert 0 <= z <= 26.0 + 1e-6


@pytest.mark.parametrize('tid', ['monaco', 'suzuka'])
def test_the_rubber_is_four_metres_wide(tid):
    v, f, uv = built(tid).parts['trk_rubber']
    widths = sorted(math.dist(v[2 * i][:2], v[2 * i + 1][:2]) for i in range(len(v) // 2))
    assert abs(widths[len(widths) // 2] - 4.0) < 0.05


def test_palettes_match_the_game():
    """trackMaterials.ts colours the same cells in the same order (PALETTES there: group → member → colour)."""
    import re
    src = open(GAME, encoding='utf-8').read()
    block = src[src.index('export const PALETTES'):]
    block = block[:block.index('};')]
    game = {g: re.findall(r'(trk_\w+)\s*:', body) for g, body in re.findall(r'(trk_\w+)\s*:\s*\{([^}]*)\}', block)}
    assert game == bs.PALETTES


@pytest.mark.parametrize('tid', IDS)
def test_budget_and_finite(tid):
    B = built(tid)
    total = sum(tris(B, m) for m in B.parts if B.parts[m][1])
    assert total <= 120_000, total
    for m, (v, f, uv) in B.parts.items():
        if not f: continue
        assert len(uv) == len(v), m
        for p in v: assert all(math.isfinite(c) for c in p) and p[2] >= -0.05, (m, p)
        for t in uv: assert all(math.isfinite(c) for c in t), m
        for face in f: assert all(0 <= k < len(v) for k in face), m


def test_no_old_props_on_monaco():
    """The bare poles, slab grandstand, box pit building and cone trees are gone: nothing stands 10 m tall and thin
    except the gantry, fence and grandstand posts."""
    B = built('monaco')
    for m, (v, f, uv) in B.parts.items():
        if not f or m == 'trk_treeline': continue   # the tree line stands 260 m and more out, a wood's edge
        assert max(p[2] for p in v) <= 19.0, m      # the tallest trees


def quantized(part, pos_bits, uv_bits):
    """A part as Draco decodes it: each attribute quantized over one range, its largest extent, from its minimum."""
    v, f, uv = part
    def q(vals, bits):
        dims = len(vals[0]); lo = [min(p[d] for p in vals) for d in range(dims)]
        rng = max(max(p[d] for p in vals) - lo[d] for d in range(dims)) or 1.0; m = (1 << bits) - 1
        return [tuple(lo[d] + round((p[d] - lo[d]) / rng * m) * rng / m for d in range(dims)) for p in vals]
    return q(v, pos_bits), f, q(uv, uv_bits)


def gantry_frame(tid):
    """The start line's point and its direction of travel (the gantry stands on it)."""
    pts, w = load(tid)
    cum, total = bs.cumulative(pts, True)
    p, t = bs.point_at(pts, cum, total, 0.0, True)               # the builder's frame(0, 0)
    return p, t, w


@pytest.mark.parametrize('tid', IDS)
def test_the_lamps_face_the_grid_in_front_of_their_box_after_compression(tid):
    """The five lamps stand clear in front of the lamp box (the side the grid sees), as the game decodes them."""
    B = built(tid)
    v, f, uv = quantized(B.parts['trk_lamps'], bs.DRACO_POS_BITS, bs.DRACO_UV_BITS)
    (px, py), (tx, ty), w = gantry_frame(tid)
    cells = bs.PALETTES['trk_lamps']; n = len(cells); box = cells.index('trk_lamp_box')
    along = lambda q: (q[0] - px) * tx + (q[1] - py) * ty
    lamp_at = {}; face_at = []
    for face in f:
        j = round(uv[face[0]][0] * n - .5)
        a = [along(v[k]) for k in face]
        if j == box: face_at.append(min(a))
        else: lamp_at.setdefault(j, []).append(max(a))
    assert sorted(lamp_at) == [j for j in range(n) if j != box]
    front = min(face_at)                                         # the box's face towards the grid (behind the line)
    for j, a in lamp_at.items(): assert max(a) <= front - 0.02, (j, max(a), front)


@pytest.mark.parametrize('tid', IDS)
def test_nothing_low_stands_on_the_road_or_its_verge(tid):
    """No solid part below the gantry's beam (posts, barriers, boards, marshal posts) within width/2 + 2 m of any part
    of the centreline: cars could drive into it."""
    pts, w = load(tid); lim = w / 2 + 2
    B = bs.scenery(tid, pts, w)                                     # before the palettes merge, by part
    G = bs.trackside.Grid(pts)
    for m in ('trk_steel', 'trk_brake', 'trk_marshal', 'trk_orange', 'trk_armco', 'trk_wall', 'trk_tyres', 'trk_boards'):
        v, f, uv = B.parts.get(m, ([], [], []))
        for x, y, z in v:
            if z < 4.5: assert not G.near((x, y), lim - 0.3), (m, x, y, z)


@pytest.mark.parametrize('tid', IDS)
def test_the_gantry_legs_boards_and_posts_stand_behind_the_barrier_line(tid):
    """The gantry's legs, the braking boards and the marshal posts stand on or behind the barrier line (half the
    width + 4 m), where the physics walls keep the cars off them."""
    pts, w = load(tid); e = w / 2 + bs.trackside.WALL_GAP
    B = bs.scenery(tid, pts, w); G = bs.trackside.Grid(pts)
    (px, py), (tx, ty), _ = gantry_frame(tid)
    v, f, uv = B.parts['trk_steel']
    legs = [(x, y) for x, y, z in v if z < 4.5 and abs((x - px) * tx + (y - py) * ty) < 1.0]
    assert legs
    for x, y in legs: assert abs(-(x - px) * ty + (y - py) * tx) >= e - 0.3, (x, y)
    for m in ('trk_brake', 'trk_marshal', 'trk_orange'):
        for x, y, z in B.parts.get(m, ([], [], []))[0]: assert not G.near((x, y), e - 0.3), (m, x, y, z)


@pytest.mark.parametrize('tid', IDS)
def test_textures_keep_their_size_after_compression(tid):
    """UVs survive Draco: the rubber spans its band once (two wheel tracks, not three or four) and the tree line's v
    stays inside one tile (no clear rows at its foot)."""
    B = built(tid)
    v, f, uv = quantized(B.parts['trk_rubber'], bs.DRACO_POS_BITS, bs.DRACO_UV_BITS)
    us = [p[0] for p in uv]; assert min(us) > -0.05 and max(us) < 1.05
    v, f, uv = quantized(B.parts['trk_treeline'], bs.DRACO_POS_BITS, bs.DRACO_UV_BITS)
    vs = [p[1] for p in uv]; assert min(vs) >= -1e-3 and max(vs) <= 1.0


@pytest.mark.parametrize('tid', ['monaco', 'spa', 'bathurst'])
def test_no_face_collapses_after_compression(tid):
    """Thin parts (posts, rails, lines) keep their width as the game decodes them: no face loses its area."""
    B = built(tid)
    for m, part in B.parts.items():
        v0, f, _ = part
        v, f, _ = quantized(part, bs.DRACO_POS_BITS, bs.DRACO_UV_BITS)
        def area(P, face):
            a, b, c = (P[k] for k in face[:3])
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]; vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            return math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2) / 2
        bad = [face for face in f if area(v0, face) > 1e-4 and area(v, face) < 1e-5]
        assert not bad, (m, len(bad))


def test_the_stand_roof_is_a_red_canopy_held_from_the_back():
    B = bs.scenery('monza', *load('monza'))
    assert B.parts['trk_canopy'][1] and 'trk_canopy' in bs.PALETTES['trk_solid']

