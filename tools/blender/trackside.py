"""Where a circuit's trackside goes, without Blender: plain Python on Blender x/y metres (x east, y north).

build_strip.py turns these plans into meshes. Everything here is deterministic and tested by test_trackside.py on
the ten circuit centrelines (closed polylines with points ~3 m apart). Offsets follow offset_polyline: d > 0 is the
left of travel, d < 0 the right. The physics walls stand at +-(width/2 + WALL_GAP); every barrier is drawn there.
"""
import math
import random

WALL_GAP = 4.0          # track edge to the physics wall (the barrier line), m
KERB_K = 1 / 150        # a bend: |curvature| above this (as the old build)
GRAVEL_K = 1 / 80       # gravel on the outside of bends tighter than this
TYRES_K = 1 / 60        # tyre walls on the outside of bends tighter than this
FENCE_K = 1 / 250       # catch fences on the outside of bends tighter than this
BOARD_K = 1 / 60        # braking boards before bends tighter than this...
STRAIGHT_K = 1 / 250    # ...that end a straight (|curvature| below this for 160 m)
START_AHEAD = 150.0     # concrete walls from the line this far ahead...
START_BEHIND = 250.0    # ...and this far behind it (the start straight)
GRID_CLEAR = (60.0, 20.0)   # no kerbs from this far behind the line to this far past it: the grid has walls, not kerbs
MARSHAL_BACK = 3.0      # marshal posts stand this far behind the barrier
TREE_CLEAR = 25.0       # no tree nearer the centreline than this
K_SMOOTH = 6            # curvature averaged over 2 * 6 + 1 points (about 40 m)
MIN_BEND_PTS = 4        # a bend (kerbs) is at least 4 points (12 m); same-sign bends closer than GAP_PTS merge
MIN_RUN_PTS = 7         # tyre walls, gravel beds and bend fences run at least 7 points (21 m)
GAP_PTS = 5             # gaps under 5 points (15 m) between two such runs are filled
TREE_ASPECT = {'a': 0.946, 'b': 0.363}   # the tree sprites' width / height (tex/trees.webp, made by prep_textures.py)


# ----------------------------------------------------------------------------------------- geometry (moved from build_strip.py)
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
    # (as built: on a closed line, s past the last point extrapolates the last segment; the routes in <id>.json were
    # sampled this way, so it stays)
    a = pts[lo]; b = pts[(lo + 1) % n] if (lo + 1 < n or closed) else pts[lo]
    segL = (cum[lo + 1] if lo + 1 < len(cum) else total) - cum[lo]
    if closed and lo == n - 1: segL = total - cum[lo]
    t = 0.0 if segL <= 1e-9 else (s - cum[lo]) / segL
    p = lerp(a, b, t); tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
    return p, (tx / L, ty / L)

def index_at(cum, total, s):
    """The index of the point at or before arc length s on a closed line."""
    s = s % total
    lo, hi = 0, len(cum) - 1
    if s >= cum[hi]: return hi
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum[mid] <= s: lo = mid
        else: hi = mid
    return lo

def resample(pts, step, closed):
    """Points every `step` m along the polyline (the first point kept)."""
    cum, total = cumulative(pts, closed)
    n = int(total // step) if closed else int(math.floor(total / step))
    out = [point_at(pts, cum, total, k * step, closed)[0] for k in range(n + (0 if closed else 1))]
    if not closed and dist(out[-1], pts[-1]) > 0.05: out.append(pts[-1])   # the true end, unless the last step landed on it
    return out

def curvature(pts, i, closed, w=3):
    """Signed curvature (1/m) at i from points w back and w ahead (smoothed over 6 w metres); + is a left bend."""
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


class Grid:
    """The centreline points bucketed for nearest-distance queries."""
    def __init__(self, pts, cell=25.0):
        self.cell = cell; self.b = {}
        for p in pts: self.b.setdefault((int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell))), []).append(p)
    def near(self, p, r):
        """True when any point lies within r of p."""
        c = self.cell; cx, cy = int(math.floor(p[0] / c)), int(math.floor(p[1] / c)); k = int(math.ceil(r / c)); r2 = r * r
        for gx in range(cx - k, cx + k + 1):
            for gy in range(cy - k, cy + k + 1):
                for q in self.b.get((gx, gy), ()):
                    if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r2: return True
        return False
    def min_dist(self, p, r_max):
        """The distance to the nearest point, or r_max when none is nearer."""
        c = self.cell; cx, cy = int(math.floor(p[0] / c)), int(math.floor(p[1] / c)); k = int(math.ceil(r_max / c)); best = r_max * r_max
        for gx in range(cx - k, cx + k + 1):
            for gy in range(cy - k, cy + k + 1):
                for q in self.b.get((gx, gy), ()):
                    d2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
                    if d2 < best: best = d2
        return math.sqrt(best)


def wall_run_idx(pts, closed, d, width):
    """The barrier runs at offset d as point indices. An offset point within width/2 + 2 of a centreline point is
    dropped. Near another part of the track (more than 15 points away: a crossing or a close approach) that opens the
    barrier, as it always has. Where only its own stretch of road is that near (the inside of a bend tighter than |d|
    folds the offset line back over the road) the run bridges the fold instead, straight from the last point before
    it to the first after it, when that chord keeps width/2 + 1 off every part of the centreline. So no barrier stands
    on the road, and a fold leaves no hole a car fits through."""
    off = offset_polyline(pts, d, closed); n = len(pts); lim = width / 2 + 2; road = width / 2 + 1
    G = Grid([(p[0], p[1], j) for j, p in enumerate(pts)], cell=max(8.0, lim))
    far = [False] * n; own = [False] * n
    for i, p in enumerate(off):
        c = G.cell; cx, cy = int(math.floor(p[0] / c)), int(math.floor(p[1] / c))
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for q in G.b.get((gx, gy), ()):
                    if math.hypot(q[0] - p[0], q[1] - p[1]) >= lim: continue
                    dj = abs(q[2] - i); dj = min(dj, n - dj) if closed else dj
                    if dj > 15: far[i] = True
                    else: own[i] = True
    keep = [not (far[i] or own[i]) for i in range(n)]
    order = list(range(n))
    if closed:
        if all(keep): return [(list(range(n)), True)]
        start = keep.index(False); order = [(start + k) % n for k in range(n)]
    runs = []; cur = []
    for i in order:
        if keep[i]: cur.append(i)
        elif cur: runs.append(cur); cur = []
    if cur: runs.append(cur)
    if not runs: return []
    G1 = Grid(pts)
    def bridge(a, b):
        """Whether the hole from point a to point b is only a fold of this stretch and the chord over it clears the road."""
        hole = [(a + 1 + m) % n for m in range((b - a - 1) % n)]
        if not hole or any(far[i] for i in hole): return False
        A, B = off[a], off[b]; k = max(1, int(math.ceil(math.hypot(B[0] - A[0], B[1] - A[1]))))
        return not any(G1.near((A[0] + (B[0] - A[0]) * t / k, A[1] + (B[1] - A[1]) * t / k), road) for t in range(k + 1))
    groups = [runs[0]]
    for r in runs[1:]:
        if bridge(groups[-1][-1], r[0]): groups[-1] = groups[-1] + r
        else: groups.append(r)
    loop = False
    if closed and bridge(groups[-1][-1], groups[0][0]):        # the hole that holds the first dropped point
        if len(groups) == 1: loop = True
        else: groups[0] = groups.pop() + groups[0]
    return [(g, loop) for g in groups if len(g) >= 3]

def clear_runs(P, closed, G, need):
    """The runs of polyline P whose points and segment middles all keep `need` off every point in G: [(indices, True)]
    when a closed P loses nothing, else open runs (on a loop an index may pass len(P), so a run's v can keep counting)."""
    n = len(P)
    ok = [not G.near(p, need) for p in P]
    def seg(i):
        a, b = P[i % n], P[(i + 1) % n]
        return ok[i % n] and ok[(i + 1) % n] and not G.near(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), need)
    segs = list(range(n if closed else n - 1)); good = [seg(i) for i in segs]
    if closed and all(good): return [(list(range(n)), True)]
    start = (good.index(False) + 1) if closed else 0
    runs = []; cur = []
    for j in range(start, start + len(segs)):
        if good[j % len(segs)]:
            if not cur: cur = [j]
            cur.append(j + 1)
        elif cur: runs.append((cur, False)); cur = []
    if cur: runs.append((cur, False))
    return runs

def wall_runs(pts, closed, d, width):
    """Offset polyline split into runs, dropping points that would fall on another part of the track."""
    off = offset_polyline(pts, d, closed)
    return [([off[i] for i in ix], c) for ix, c in wall_run_idx(pts, closed, d, width)]

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


# ----------------------------------------------------------------------------------------- per-circuit analysis (cached)
_CACHE = {}
def _an(pts, closed):
    key = (id(pts), closed); a = _CACHE.get(key)
    if a is None or a['pts'] is not pts:
        if len(_CACHE) > 32: _CACHE.clear()
        cum, total = cumulative(pts, closed)
        raw = [curvature(pts, i, closed) for i in range(len(pts))]
        # the scenery reads bends from curvature averaged over about 40 m: the centreline (every 3 m) wobbles, and the
        # raw curvature put kerb, tyre and gravel stubs on straights
        a = {'pts': pts, 'k_raw': raw, 'k': _smooth(raw, K_SMOOTH) if closed else raw, 'cum': cum, 'total': total,
             'T': tangents(pts, closed), 'grid': Grid(pts)}
        _CACHE[key] = a
    return a

def _smooth(v, m):
    n = len(v); out = []; acc = sum(v[j % n] for j in range(-m, m + 1))
    for i in range(n):
        out.append(acc / (2 * m + 1)); acc += v[(i + m + 1) % n] - v[(i - m) % n]
    return out

def _outside(k):
    """The outside of a bend of curvature k: the right (-1) of a left bend, the left (+1) of a right bend."""
    return -1 if k > 0 else 1


# ----------------------------------------------------------------------------------------- the plan
def racing_line(pts, width, closed=True, margin=1.2):
    """A racing line: out wide before each bend, inside at its apex (the sharpest point), out wide after, eased between.
    Visual only (the rubbered line). Gentle bends move it less. It stays `margin` m inside the edge."""
    a = _an(pts, closed); n = len(pts); k = a['k']
    lim = width / 2 - margin
    ctrl = {}
    def put(i, v):
        i %= n; ctrl.setdefault(i, []).append(v)
    for i0, i1, sign in bend_spans(pts, closed, KERB_K):
        p = max(range(i0, i1), key=lambda q: abs(k[q % n]))
        amt = min(1.0, abs(k[p % n]) / (1 / 60)) * lim
        L = max(10, min(30, i1 - i0))
        put(i0 - L, -sign * amt); put(p, sign * amt); put(i1 + L, -sign * amt)
    if not ctrl: return list(pts)
    keys = sorted(ctrl); vals = {i: sum(v) / len(v) for i, v in ctrl.items()}
    off = [0.0] * n
    for j, i in enumerate(keys):
        nxt = keys[(j + 1) % len(keys)]; span = (nxt - i) % n or n
        for q in range(span):
            t = q / span; e = 0.5 - 0.5 * math.cos(math.pi * t)
            off[(i + q) % n] = vals[i] + (vals[nxt] - vals[i]) * e
    off = [max(-lim, min(lim, o)) for o in _smooth(off, 3)]
    T = a['T']
    return [(p[0] - t[1] * o, p[1] + t[0] * o) for p, t, o in zip(pts, T, off)]

def _clean_runs(flags, min_pts, gap_pts, closed):
    """flags with False gaps shorter than gap_pts between True runs filled, then True runs shorter than min_pts
    dropped; cyclic when closed."""
    n = len(flags); f = list(flags)
    if all(f) or not any(f): return f
    def runs(val):
        start = f.index(not val) if closed else 0; out = []; q = 0
        while q < n:
            i = (start + q) % n if closed else q
            if f[i] != val: q += 1; continue
            j = q
            while j < n and f[((start + j) % n) if closed else j] == val: j += 1
            out.append([((start + t) % n) if closed else t for t in range(q, j)]); q = j
        return out
    for g in runs(False):
        inner = (closed or (g[0] > 0 and g[-1] < n - 1))
        if inner and len(g) < gap_pts:
            for i in g: f[i] = True
    if all(f): return f
    for r in runs(True):
        if len(r) < min_pts:
            for i in r: f[i] = False
    return f

def _bend_flags(pts, closed, side, kmin):
    """Points where side (+1 left, -1 right) is the outside of a bend sharper than kmin, outside the start window, in
    runs of at least MIN_RUN_PTS (cached)."""
    a = _an(pts, closed); key = ('bend', side, kmin)
    if key not in a:
        cum, total = a['cum'], a['total']
        f = [abs(x) > kmin and side == _outside(x) and not (cum[i] <= START_AHEAD or cum[i] >= total - START_BEHIND) for i, x in enumerate(a['k'])]
        a[key] = _clean_runs(f, MIN_RUN_PTS, GAP_PTS, closed)
    return a[key]

def bend_spans(pts, closed, kmin):
    """Runs of points with |curvature| > kmin: (i0, i1 exclusive, sign of the peak), at least MIN_BEND_PTS long, the
    same-sign ones less than GAP_PTS apart merged. On a closed line a run may wrap: i1 can pass len(pts) (index
    modulo n)."""
    a = _an(pts, closed); n = len(pts); k = a['k']
    flag = [abs(x) > kmin for x in k]
    pos = _clean_runs([f and x > 0 for f, x in zip(flag, k)], MIN_BEND_PTS, GAP_PTS, closed)
    neg = _clean_runs([f and x < 0 for f, x in zip(flag, k)], MIN_BEND_PTS, GAP_PTS, closed)
    flag = [p or q for p, q in zip(pos, neg)]
    if all(flag):
        peak = max(range(n), key=lambda i: abs(k[i])); return [(0, n, 1 if k[peak] > 0 else -1)]
    if not any(flag): return []
    start = flag.index(False) if closed else 0
    spans = []; i = 0
    while i < n:
        j = (start + i) % n if closed else i
        if not flag[j]: i += 1; continue
        i0 = start + i if closed else i; e = i
        while e < n and flag[((start + e) % n) if closed else e]: e += 1
        i1 = start + e if closed else e
        peak = max(range(i0, i1), key=lambda q: abs(k[q % n]))
        spans.append((i0, i1, 1 if k[peak % n] > 0 else -1)); i = e
    return spans

def barrier_kind(pts, width, closed, i, side):
    """What stands on the barrier line at point i, side +1 (left) or -1 (right): concrete walls with boards on the
    start straight, tyre walls on the outside of tight bends, armco elsewhere."""
    a = _an(pts, closed); s = a['cum'][i]
    if s <= START_AHEAD or s >= a['total'] - START_BEHIND: return 'wall'
    if _bend_flags(pts, closed, side, TYRES_K)[i]: return 'tyres'
    return 'armco'

def runoff_kind(pts, closed, i, side):
    """Gravel on the outside of tight bends, grass elsewhere."""
    return 'gravel' if _bend_flags(pts, closed, side, GRAVEL_K)[i] else 'grass'

def fence_runs(pts, width, closed=True):
    """Catch fences, 1.5 m behind the barrier (0.1 m along the start straight, on its wall): (point indices, side)
    along the start straight and outside fast bends, only where the barrier itself runs and the fence keeps off the
    road (width/2 + 2 m from every part of the centreline, like the barriers)."""
    a = _an(pts, closed); out = []; n = len(pts); G = a['grid']; T = a['T']; lim = width / 2 + 2
    for side in (1, -1):
        bend = _bend_flags(pts, closed, side, FENCE_K); mine = []
        for ix, _c in wall_run_idx(pts, closed, side * (width / 2 + WALL_GAP), width):
            cur = []
            for i in ix:
                s = a['cum'][i % n]; win = s <= START_AHEAD or s >= a['total'] - START_BEHIND
                d = side * (width / 2 + WALL_GAP + (0.1 if win else 1.5)); p, t = pts[i % n], T[i % n]
                want = (win or bend[i % n]) and not G.near((p[0] - t[1] * d, p[1] + t[0] * d), lim)
                if want: cur.append(i)
                else:
                    if len(cur) >= 5: mine.append(cur)
                    cur = []
            if len(cur) >= 5: mine.append(cur)
        # on a loop, a run that ends on the last point and one that starts on the first are one fence through the line
        if closed:
            last = next((r for r in mine if r[-1] % n == n - 1), None); first = next((r for r in mine if r[0] % n == 0), None)
            if last is not None and first is not None and last is not first:
                mine.remove(first); last.extend(n + (i % n) for i in first)
        out += [(r, side) for r in mine]
    return out

def _band_clear(pts, closed, width, s0, s1, d0, d1):
    """Clear of every part of the track, and not squeezed on the inside of a bend (its far edge within 0.6 of the
    bend's radius)."""
    a = _an(pts, closed); G = a['grid']; need = width / 2 + WALL_GAP
    sg = 1 if d0 > 0 else -1; depth = max(abs(d0), abs(d1))
    s = s0
    while s <= s1 + 1e-9:
        p, t = point_at(pts, a['cum'], a['total'], s, closed)
        for d in (d0, d1, (d0 + d1) / 2):
            q = (p[0] - t[1] * d, p[1] + t[0] * d)
            if G.near(q, need): return False
        k = a['k'][index_at(a['cum'], a['total'], s % a['total'] if closed else s)]
        if k * sg > 0 and depth * abs(k) > 0.6: return False
        s += 5.0
    return True

def _fit_band(pts, closed, width, s0, s1, d0, d1, min_len):
    """The band, shortened until it is clear of the track, or None: the part past the line (s1 > total) comes back
    until it is clear (to 10 m past the line at least), then the start (s0) moves up to the line."""
    total = _an(pts, closed)['total']
    while s1 > total + 10.0 and not _band_clear(pts, closed, width, total, s1, d0, d1): s1 -= 10.0
    while s1 - s0 >= min_len:
        if _band_clear(pts, closed, width, s0, s1, d0, d1): return (s0, s1, d0, d1)
        s0 += 10.0
    return None

def start_area(pts, width, closed=True):
    """The start: the gantry over the line (s = 0); the grandstand on the left of the straight, the pit lane and the
    pit building on the right, each running on past the line as at the clone's start (so they flank the grid's view).
    Bands are (s0, s1, d0, d1) in arc length (s1 may pass `total`: the line) and signed offset, or None when the
    straight has no room (another part of the track too near)."""
    a = _an(pts, closed); total = a['total']; e = width / 2 + WALL_GAP
    return {
        'gantry': 0.0,
        'stand': _fit_band(pts, closed, width, total - 120.0, total + 50.0, e + 3.0, e + 19.0, 40.0),
        'pitlane': _fit_band(pts, closed, width, total - 200.0, total + 60.0, -(e + 1.0), -(e + 9.0), 60.0),
        'pits': _fit_band(pts, closed, width, total - 150.0, total + 40.0, -(e + 10.0), -(e + 22.0), 40.0),
    }

def _band_poly(pts, closed, band, margin):
    """The band's outline grown by `margin` m all round, as a polygon."""
    a = _an(pts, closed); s0, s1, d0, d1 = band; sg = 1 if d1 > d0 else -1
    L, R = [], []; s = s0 - margin
    while True:
        p, t = point_at(pts, a['cum'], a['total'], min(s, s1 + margin), closed)
        for d, out in ((d0 - sg * margin, L), (d1 + sg * margin, R)): out.append((p[0] - t[1] * d, p[1] + t[0] * d))
        if s >= s1 + margin: break
        s += 5.0
    return L + R[::-1]

def _in_poly(q, poly):
    x, y = q; c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def marshal_posts(pts, width, closed=True, every=350.0):
    """(s, side) for marshal posts every `every` m behind the barrier, on the outside of the next bend; skipped where
    another part of the track is near. None in the start area."""
    a = _an(pts, closed); total = a['total']; G = a['grid']; n = len(pts); out = []
    s = every / 2
    while s < total - START_BEHIND:
        i = index_at(a['cum'], total, s); side = 1
        for j in range(i, i + 70):                      # the next bend within ~200 m
            k = a['k'][j % n]
            if abs(k) > KERB_K: side = _outside(k); break
        for sd in (side, -side):
            p, t = point_at(pts, a['cum'], total, s, closed); d = sd * (width / 2 + WALL_GAP + MARSHAL_BACK)
            q = (p[0] - t[1] * d, p[1] + t[0] * d)
            if not G.near(q, width / 2 + WALL_GAP + 2.0): out.append((round(s, 2), sd)); break
        s += every
    return out

def braking_boards(pts, width, closed=True, corners=4):
    """(s, side, label) for 150 / 100 / 50 boards before the sharpest bends that end a straight, on the outside."""
    a = _an(pts, closed); n = len(pts); cum, total, k = a['cum'], a['total'], a['k']
    found = []
    for i0, i1, sign in bend_spans(pts, closed, KERB_K):
        peak = max(abs(k[i % n]) for i in range(i0, i1))
        if peak <= BOARD_K: continue
        sb = cum[i0 % n]; x = sb - 160; ok = True
        while x < sb - 5:
            if abs(k[index_at(cum, total, x)]) >= STRAIGHT_K: ok = False; break
            x += 3.0
        if ok: found.append((peak, sb, sign))
    found.sort(key=lambda f: -f[0])
    out = []
    for _peak, sb, sign in found[:corners]:
        for lab in ('150', '100', '50'): out.append((round((sb - int(lab)) % total, 3), -sign, lab))
    return out

def trees(pts, width, closed=True, seed=11, target=950):
    """(x, y, species, height): clusters of 8-16 trees, 30-150 m out, inside the cell's fence (the track's box + 150 m).
    Species 'a' is a broadleaf, 'b' a conifer."""
    a = _an(pts, closed); G = a['grid']; rnd = random.Random(seed)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs) - 140, max(xs) + 140, min(ys) - 140, max(ys) + 140
    area = start_area(pts, width, closed)                 # no tree through the grandstand, pit lane or pits
    keep_out = [_band_poly(pts, closed, area[k], 9.0) for k in ('stand', 'pitlane', 'pits') if area[k]]
    out = []; tries = 0
    while len(out) < target and tries < 12000:
        tries += 1
        cx, cy = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        dm = G.min_dist((cx, cy), 160.0)
        if dm < 30.0 or dm >= 150.0: continue
        for _ in range(rnd.randint(8, 16)):
            r = 22.0 * math.sqrt(rnd.random()); th = rnd.uniform(0, 2 * math.pi)
            x, y = cx + r * math.cos(th), cy + r * math.sin(th)
            if not (x0 < x < x1 and y0 < y < y1): continue
            if G.near((x, y), TREE_CLEAR) or any(_in_poly((x, y), P) for P in keep_out): continue
            if any((x - q[0]) ** 2 + (y - q[1]) ** 2 < 16.0 for q in out[-14:]): continue
            sp = 'a' if rnd.random() < 0.7 else 'b'
            h = rnd.uniform(9.0, 18.0) if sp == 'a' else rnd.uniform(11.0, 19.0)
            out.append((round(x, 2), round(y, 2), sp, round(h, 2)))
            if len(out) >= target: break
    return out


def on_grid(s0, s1, total):
    """Whether arc lengths s0..s1 (s1 may run past total) touch the grid's kerb-free window around the line."""
    behind, ahead = GRID_CLEAR
    for a, b in ((s0, s1), (s0 - total, s1 - total), (s0 + total, s1 + total)):
        if b > -behind and a < ahead: return True
    return False
