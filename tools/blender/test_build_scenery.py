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
        assert abs(out - 260) < 1, (x, y, out)
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
