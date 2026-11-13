"""Tests for the bpy-free trackside planner, on all ten circuit centrelines (run: pytest tools/blender -q)."""
import json
import math
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import trackside as ts  # noqa: E402

DATA = os.path.join(HERE, '..', 'tracks', 'data')
IDS = ['spa', 'monza', 'silverstone', 'suzuka', 'nurburgring', 'monaco', 'interlagos', 'cota', 'laguna', 'bathurst']


def load(tid):
    with open(os.path.join(DATA, tid + '.json'), encoding='utf-8') as f:
        d = json.load(f)
    return [(p[0], -p[1]) for p in d['pts']], float(d.get('widthM', 12))


TRACKS = {tid: load(tid) for tid in IDS}


# ---- today's wall runs, frozen: the physics walls in <id>.json come from these, so they must not move
def _tangents(pts, closed):
    n = len(pts); out = []
    for i in range(n):
        a = pts[(i - 1) % n] if closed or i > 0 else pts[i]
        b = pts[(i + 1) % n] if closed or i < n - 1 else pts[i]
        tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
        out.append((tx / L, ty / L))
    return out


def _offset(pts, d, closed=False):
    T = _tangents(pts, closed)
    return [(p[0] - t[1] * d, p[1] + t[0] * d) for p, t in zip(pts, T)]


def _old_wall_runs(pts, closed, d, width):
    off = _offset(pts, d, closed); keep = []
    n = len(pts)
    for i in range(n):
        ok = True
        p = off[i]
        for j in range(n):
            dj = abs(j - i); dj = min(dj, n - dj) if closed else dj
            if dj <= 15: continue
            q = pts[j]
            if abs(q[0] - p[0]) < width / 2 + 2 and abs(q[1] - p[1]) < width / 2 + 2 and math.hypot(q[0] - p[0], q[1] - p[1]) < width / 2 + 2: ok = False; break
        keep.append(ok)
    runs = []; cur = []
    order = list(range(n))
    if closed:
        if all(keep): return [(off, True)]
        start = keep.index(False); order = [(start + k) % n for k in range(n)]
    for i in order:
        if keep[i]: cur.append(off[i])
        elif cur: runs.append((cur, False)); cur = []
    if cur: runs.append((cur, False))
    return [(r, c) for r, c in runs if len(r) >= 3]


def min_dist(p, pts):
    return min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in pts)


def s_of(pts):
    cum, total = ts.cumulative(pts, True)
    return cum, total


@pytest.mark.parametrize('tid', IDS)
def test_wall_runs_unchanged(tid):
    pts, w = TRACKS[tid]
    for side in (1, -1):
        assert ts.wall_runs(pts, True, side * (w / 2 + ts.WALL_GAP), w) == _old_wall_runs(pts, True, side * (w / 2 + 4.0), w)


@pytest.mark.parametrize('tid', IDS)
def test_barriers_on_wall_line(tid):
    pts, w = TRACKS[tid]
    for side in (1, -1):
        d = side * (w / 2 + ts.WALL_GAP)
        off = ts.offset_polyline(pts, d, True)
        runs = ts.wall_runs(pts, True, d, w)
        idx = ts.wall_run_idx(pts, True, d, w)
        assert [([off[i] for i in ix], c) for ix, c in idx] == runs


@pytest.mark.parametrize('tid', IDS)
def test_racing_line_on_tarmac(tid):
    pts, w = TRACKS[tid]
    line = ts.racing_line(pts, w)
    assert len(line) == len(pts)
    assert max(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(line, pts)) <= w / 2 - 1 + 1e-6


@pytest.mark.parametrize('tid', IDS)
def test_racing_line_takes_the_apex(tid):
    pts, w = TRACKS[tid]
    line = ts.racing_line(pts, w); T = ts.tangents(pts, True)
    n = len(pts); k = [ts.curvature(pts, i, True) for i in range(n)]
    i = max(range(n), key=lambda j: abs(k[j]))
    off = (line[i][0] - pts[i][0]) * -T[i][1] + (line[i][1] - pts[i][1]) * T[i][0]   # + is left of travel
    assert off * k[i] > 0 and abs(off) >= 0.5


@pytest.mark.parametrize('tid', IDS)
def test_kerbs_only_on_bends(tid):
    pts, w = TRACKS[tid]
    n = len(pts); spans = ts.bend_spans(pts, True, 1 / 150)
    assert spans
    for i0, i1, sign in spans:
        assert i0 < i1
        for i in range(i0, i1):
            assert abs(ts.curvature(pts, i % n, True)) > 1 / 150
        assert sign in (1, -1)


@pytest.mark.parametrize('tid', IDS)
def test_tyres_outside_tight_bends(tid):
    pts, w = TRACKS[tid]
    n = len(pts); cum, total = s_of(pts)
    kinds = set()
    for i in range(n):
        k = ts.curvature(pts, i, True)
        for side in (1, -1):
            kind = ts.barrier_kind(pts, w, True, i, side)
            kinds.add(kind)
            if kind == 'tyres':
                assert abs(k) > ts.TYRES_K and side == -(1 if k > 0 else -1)
            if kind == 'wall':
                assert cum[i] <= ts.START_AHEAD or cum[i] >= total - ts.START_BEHIND
    assert 'armco' in kinds and 'wall' in kinds


@pytest.mark.parametrize('tid', IDS)
def test_runoff_gravel_outside_tight_bends(tid):
    pts, w = TRACKS[tid]
    for i in range(len(pts)):
        k = ts.curvature(pts, i, True)
        for side in (1, -1):
            if ts.runoff_kind(pts, True, i, side) == 'gravel':
                assert abs(k) > ts.GRAVEL_K and side == -(1 if k > 0 else -1)


@pytest.mark.parametrize('tid', IDS)
def test_scenery_clear_of_track(tid):
    pts, w = TRACKS[tid]
    trees = ts.trees(pts, w, True, seed=11)
    assert 100 <= len(trees) <= 420
    for x, y, species, h in trees:
        assert species in ('a', 'b') and 6 <= h <= 18
        assert min_dist((x, y), pts) >= ts.TREE_CLEAR - 1e-6
    cum, total = s_of(pts)
    for s, side in ts.marshal_posts(pts, w, True):
        p, t = ts.point_at(pts, cum, total, s, True)
        d = side * (w / 2 + ts.WALL_GAP + ts.MARSHAL_BACK)
        q = (p[0] - t[1] * d, p[1] + t[0] * d)
        assert min_dist(q, pts) >= w / 2 + ts.WALL_GAP
    area = ts.start_area(pts, w, True)
    assert area['gantry'] is not None
    for name in ('stand', 'pits', 'pitlane'):
        band = area[name]
        if band is None: continue
        s0, s1, d0, d1 = band
        s = s0
        while s <= s1:
            p, t = ts.point_at(pts, cum, total, s, True)
            for d in (d0, d1):
                q = (p[0] - t[1] * d, p[1] + t[0] * d)
                assert min_dist(q, pts) >= w / 2 + ts.WALL_GAP - 1e-6, (name, s, d)
            s += 5.0


@pytest.mark.parametrize('tid', IDS)
def test_boards_before_bends(tid):
    pts, w = TRACKS[tid]
    n = len(pts); cum, total = s_of(pts)
    spans = ts.bend_spans(pts, True, 1 / 150)
    starts = {round(cum[i0 % n], 1): (i0, i1, sign) for i0, i1, sign in spans}
    boards = ts.braking_boards(pts, w, True)
    for s, side, label in boards:
        assert label in ('150', '100', '50')
        sb = (s + int(label)) % total
        match = [v for k, v in starts.items() if abs(((k - sb + total / 2) % total) - total / 2) < 1.0]
        assert match, (s, label)
        i0, i1, sign = match[0]
        assert max(abs(ts.curvature(pts, i % n, True)) for i in range(i0, i1)) > ts.BOARD_K
        assert side == -sign
        x = sb - 160
        while x < sb - 5:
            p_i = ts.index_at(cum, total, x)
            assert abs(ts.curvature(pts, p_i, True)) < ts.STRAIGHT_K
            x += 3.0


def test_deterministic():
    pts, w = TRACKS['monaco']
    assert ts.trees(pts, w, True, seed=11) == ts.trees(pts, w, True, seed=11)
    assert ts.racing_line(pts, w) == ts.racing_line(pts, w)


@pytest.mark.parametrize('tid', IDS)
def test_racing_line_keeps_a_wider_band_on_the_tarmac(tid):
    """The 4 m rubber band rides a line kept 2.1 m inside the edge."""
    pts, w = TRACKS[tid]
    line = ts.racing_line(pts, w, margin=2.1)
    assert max(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(line, pts)) <= w / 2 - 2.1 + 1e-6
    assert ts.racing_line(pts, w) == ts.racing_line(pts, w, margin=1.2)


def _band_polygon(pts, band):
    cum, total = s_of(pts)
    s0, s1, d0, d1 = band; L, R = [], []; s = s0
    while s <= s1 + 1e-9:
        p, t = ts.point_at(pts, cum, total, s, True)
        L.append((p[0] - t[1] * d0, p[1] + t[0] * d0)); R.append((p[0] - t[1] * d1, p[1] + t[0] * d1)); s += 5.0
    return L + R[::-1]


def _in_poly(q, poly):
    x, y = q; c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c


@pytest.mark.parametrize('tid', ['spa', 'monza', 'silverstone', 'suzuka', 'bathurst'])   # the long straights
def test_the_start_buildings_flank_the_line(tid):
    """As at the clone's start: from the grid the grandstand (left) and the pits (right) run on past the gantry."""
    pts, w = TRACKS[tid]
    cum, total = s_of(pts)
    area = ts.start_area(pts, w, True)
    for name in ('stand', 'pits', 'pitlane'):
        s0, s1, d0, d1 = area[name]
        assert s0 <= total - 60 and s1 >= total + 30, (name, s0 - total, s1 - total)


@pytest.mark.parametrize('tid', IDS)
def test_trees_keep_out_of_the_start_buildings(tid):
    pts, w = TRACKS[tid]
    area = ts.start_area(pts, w, True)
    polys = [_band_polygon(pts, area[n]) for n in ('stand', 'pits', 'pitlane') if area[n]]
    for x, y, sp, h in ts.trees(pts, w, True):
        r = h * ts.TREE_ASPECT[sp] / 2 + 1.0
        for poly in polys:
            assert not _in_poly((x, y), poly) and min(math.dist((x, y), q) for q in poly) >= r, (x, y)


@pytest.mark.parametrize('tid', IDS)
def test_start_buildings_are_not_squeezed_inside_a_tight_bend(tid):
    """A band on the inside of a bend narrows towards the bend's centre: its far edge stays within 0.6 of the radius."""
    pts, w = TRACKS[tid]
    cum, total = s_of(pts); n = len(pts)
    k = [ts.curvature(pts, i, True) for i in range(n)]
    area = ts.start_area(pts, w, True)
    for name in ('stand', 'pits', 'pitlane'):
        if not area[name]: continue
        s0, s1, d0, d1 = area[name]; sg = 1 if d0 > 0 else -1; depth = max(abs(d0), abs(d1))
        s = s0
        while s <= s1:
            ki = k[ts.index_at(cum, total, s % total)]
            if ki * sg > 0: assert depth * abs(ki) <= 0.6 + 1e-9, (name, round(s - total), round(1 / abs(ki)))
            s += 5.0
