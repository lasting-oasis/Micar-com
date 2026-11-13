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
MARSHAL_BACK = 3.0      # marshal posts stand this far behind the barrier
TREE_CLEAR = 25.0       # no tree nearer the centreline than this
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
    """The barrier runs at offset d as point indices: offset points that would fall on another part of the track
    (within width/2 + 2 of a centreline point more than 15 points away) are dropped, splitting the runs."""
    off = offset_polyline(pts, d, closed); n = len(pts); lim = width / 2 + 2
    G = Grid([(p[0], p[1], j) for j, p in enumerate(pts)], cell=max(8.0, lim))
    keep = []
    for i in range(n):
        p = off[i]; ok = True
        c = G.cell; cx, cy = int(math.floor(p[0] / c)), int(math.floor(p[1] / c))
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for q in G.b.get((gx, gy), ()):
                    j = q[2]; dj = abs(j - i); dj = min(dj, n - dj) if closed else dj
                    if dj <= 15: continue
                    if abs(q[0] - p[0]) < lim and abs(q[1] - p[1]) < lim and math.hypot(q[0] - p[0], q[1] - p[1]) < lim: ok = False; break
                if not ok: break
            if not ok: break
        keep.append(ok)
    order = list(range(n))
    if closed:
        if all(keep): return [(list(range(n)), True)]
        start = keep.index(False); order = [(start + k) % n for k in range(n)]
    runs = []; cur = []
    for i in order:
        if keep[i]: cur.append(i)
        elif cur: runs.append((cur, False)); cur = []
    if cur: runs.append((cur, False))
    return [(r, c) for r, c in runs if len(r) >= 3]

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
        a = {'pts': pts, 'k': [curvature(pts, i, closed) for i in range(len(pts))], 'cum': cum, 'total': total,
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

def bend_spans(pts, closed, kmin):
    """Runs of points with |curvature| > kmin: (i0, i1 exclusive, sign of the peak). On a closed line a run may wrap:
    i1 can pass len(pts) (index modulo n)."""
    a = _an(pts, closed); n = len(pts); k = a['k']
    flag = [abs(x) > kmin for x in k]
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
    a = _an(pts, closed); s = a['cum'][i]; k = a['k'][i]
    if s <= START_AHEAD or s >= a['total'] - START_BEHIND: return 'wall'
    if abs(k) > TYRES_K and side == _outside(k): return 'tyres'
    return 'armco'

def runoff_kind(pts, closed, i, side):
    """Gravel on the outside of tight bends, grass elsewhere."""
    k = _an(pts, closed)['k'][i]
    return 'gravel' if abs(k) > GRAVEL_K and side == _outside(k) else 'grass'

def fence_runs(pts, width, closed=True):
    """Catch fences, 1.5 m behind the barrier: (point indices, side) along the start straight and outside fast bends,
    only where the barrier itself runs."""
    a = _an(pts, closed); out = []
    for side in (1, -1):
        for ix, _c in wall_run_idx(pts, closed, side * (width / 2 + WALL_GAP), width):
            cur = []
            for i in ix:
                s = a['cum'][i]; k = a['k'][i]
                want = s <= START_AHEAD or s >= a['total'] - START_BEHIND or (abs(k) > FENCE_K and side == _outside(k))
                if want: cur.append(i)
                else:
                    if len(cur) >= 5: out.append((cur, side))
                    cur = []
            if len(cur) >= 5: out.append((cur, side))
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

def trees(pts, width, closed=True, seed=11, target=400):
    """(x, y, species, height): clusters of trees 25-150 m out, inside the cell's fence (the track's box + 150 m).
    Species 'a' is a broadleaf, 'b' a conifer."""
    a = _an(pts, closed); G = a['grid']; rnd = random.Random(seed)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs) - 140, max(xs) + 140, min(ys) - 140, max(ys) + 140
    area = start_area(pts, width, closed)                 # no tree through the grandstand, pit lane or pits
    keep_out = [_band_poly(pts, closed, area[k], 9.0) for k in ('stand', 'pitlane', 'pits') if area[k]]
    out = []; tries = 0
    while len(out) < target and tries < 4000:
        tries += 1
        cx, cy = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        dm = G.min_dist((cx, cy), 160.0)
        if dm < 35.0 or dm >= 150.0: continue
        for _ in range(rnd.randint(6, 13)):
            r = 14.0 * math.sqrt(rnd.random()); th = rnd.uniform(0, 2 * math.pi)
            x, y = cx + r * math.cos(th), cy + r * math.sin(th)
            if not (x0 < x < x1 and y0 < y < y1): continue
            if G.near((x, y), TREE_CLEAR) or any(_in_poly((x, y), P) for P in keep_out): continue
            if any((x - q[0]) ** 2 + (y - q[1]) ** 2 < 16.0 for q in out[-14:]): continue
            sp = 'a' if rnd.random() < 0.7 else 'b'
            h = rnd.uniform(8.0, 16.0) if sp == 'a' else rnd.uniform(10.0, 17.0)
            out.append((round(x, 2), round(y, 2), sp, round(h, 2)))
            if len(out) >= target: break
    return out
