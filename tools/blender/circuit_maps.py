"""The race menu's circuit maps (apps/sim/src/world/strip/circuitMaps.json), from each circuit's centre line and event
routes in apps/sim/public/strip/tracks/<id>.json (game coordinates, x and z in metres). No Blender:

    python3 tools/blender/circuit_maps.py

Each circuit: its centre line resampled to N points from the start line, its length, where sectors 2 and 3 start
(equal thirds by distance, as the race timing splits a lap) and its corners: [apex x, apex z, label x, label z], the
label just outside the bend. Each event: its route resampled (at most EV_N points) and whether it loops.

A corner is a run of the smoothed curvature (trackside's) above CORNER_K of one sign; runs of one sign closer than
CORNER_GAP merge, and a run counts when it turns at least CORNER_TURN. Its apex is its sharpest point.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import trackside as ts  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
TRACKS = os.path.join(REPO, 'apps', 'sim', 'public', 'strip', 'tracks')
INDEX = os.path.join(REPO, 'apps', 'sim', 'src', 'world', 'strip', 'tracks.json')
OUT = os.path.join(REPO, 'apps', 'sim', 'src', 'world', 'strip', 'circuitMaps.json')
N = 180                       # points per circuit outline
EV_N = 120                    # at most this many per event route
CORNER_K = 1 / 300            # 1/m: tighter than a 300 m radius
CORNER_GAP = 25.0             # m: runs of one sign closer than this are one corner
CORNER_TURN = math.radians(25)
LABEL_OUT = 0.03              # a corner's label sits about this share of the circuit's diagonal outside the apex,
LABEL_CLEAR = 0.02            # and at least this share clear of every part of the track (else the clearest place tried)
LABEL_APART = 0.03            # labels keep this share apart from each other


def _r(p):
    return [round(p[0], 1), round(p[1], 1)]


def resample(pts, n, closed):
    """n points evenly spaced along the polyline (closed: around the loop), from pts[0] (and, open, to pts[-1])."""
    P = list(pts) + ([pts[0]] if closed else [])
    cum = [0.0]
    for a, b in zip(P, P[1:]): cum.append(cum[-1] + math.dist(a, b))
    total = cum[-1]; out = []; j = 0
    steps = n if closed else n - 1
    for k in range(n):
        s = total * k / steps
        while j < len(cum) - 2 and cum[j + 1] < s: j += 1
        L = cum[j + 1] - cum[j]; t = 0.0 if L <= 0 else (s - cum[j]) / L
        a, b = P[j], P[j + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out, total


def corners(pts):
    """[apex x, apex z, label x, label z] of each corner of the closed centre line, in order from pts[0]."""
    a = ts._an(pts, True); k = a['k']; cum = a['cum']; n = len(pts)
    sign = [1 if v > CORNER_K else -1 if v < -CORNER_K else 0 for v in k]
    if all(sign): return []
    start = sign.index(0)
    order = [(start + i) % n for i in range(n)]
    runs = []                                   # [sign, [indices]]
    for pos, i in enumerate(order):
        if not sign[i]: continue
        if runs and runs[-1][0] == sign[i] and runs[-1][1][-1] == order[pos - 1]: runs[-1][1].append(i)
        else: runs.append([sign[i], [i]])
    def gap(i, j):                              # metres along the line from point i to point j
        d = cum[j] - cum[i]
        return d if d >= 0 else d + a['total']
    merged = []
    for r in runs:
        if merged and merged[-1][0] == r[0] and gap(merged[-1][1][-1], r[1][0]) < CORNER_GAP: merged[-1][1].extend(r[1])
        else: merged.append([r[0], list(r[1])])
    if len(merged) > 1 and merged[0][0] == merged[-1][0] and gap(merged[-1][1][-1], merged[0][1][0]) < CORNER_GAP:
        last = merged.pop(); merged[0][1] = last[1] + merged[0][1]
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]; diag = math.hypot(max(xs) - min(xs), max(zs) - min(zs))
    out_d = LABEL_OUT * diag; G = ts.Grid(pts, cell=max(25.0, out_d))
    placed = []
    def label(p, nx, nz):
        """Outside the bend first, then turned towards its sides, further out, then inside: the first place clear of the
        track and of the labels placed so far, or the clearest tried."""
        best = None
        for f in (1.0, 1.4, 1.8, 2.4):
            for ang in (0, 30, -30, 60, -60, 90, -90, 180):
                c, s_ = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                dx, dz = nx * c - nz * s_, nx * s_ + nz * c
                q = (p[0] + dx * out_d * f, p[1] + dz * out_d * f)
                clear = min(G.min_dist(q, 4 * out_d) / LABEL_CLEAR, min((math.dist(q, o) for o in placed), default=1e9) / LABEL_APART)
                if clear >= diag: placed.append(q); return q
                if best is None or clear > best[0]: best = (clear, q)
        placed.append(best[1]); return best[1]
    found = []
    for sg, idx in merged:
        turn = sum(abs(k[i]) * math.dist(pts[i], pts[(i + 1) % n]) for i in idx)
        if turn < CORNER_TURN: continue
        i = max(idx, key=lambda q: abs(k[q]))
        p0, p1, p2 = pts[(i - 3) % n], pts[i], pts[(i + 3) % n]
        tx, tz = p2[0] - p0[0], p2[1] - p0[1]; L = math.hypot(tx, tz) or 1.0; tx, tz = tx / L, tz / L
        cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
        lx, lz = -tz, tx                        # the left normal (in these axes)
        if cross > 0: lx, lz = -lx, -lz         # the bend turns left: its outside is on the right
        q = label(p1, lx, lz)
        found.append((cum[i], [round(p1[0], 1), round(p1[1], 1), round(q[0], 1), round(q[1], 1)]))
    return [c for _s, c in sorted(found)]


def circuit(track, lenM):
    pts = [tuple(p) for p in track['centre']['pts']]
    out, _total = resample(pts, N, True)
    return {'len': lenM, 'pts': [_r(p) for p in out], 'sectors': [N // 3, 2 * N // 3], 'corners': corners(pts)}


def build():
    index = json.load(open(INDEX))['tracks']
    circuits, events = {}, {}
    for t in index:
        track = json.load(open(os.path.join(TRACKS, t['id'] + '.json')))
        circuits[t['id']] = circuit(track, t['lenM'])
        for e in t['events']:
            R = track['routes'][e]; loop = bool(R.get('loop')); pts = [tuple(p) for p in R['pts']]
            out, _total = resample(pts, min(EV_N, len(pts)), loop)
            events[e] = {'loop': loop, 'pts': [_r(p) for p in out]}
    return {'version': 1, 'circuits': circuits, 'events': events}


def dumps(data):
    return json.dumps(data, separators=(',', ':')) + '\n'


def main():
    with open(OUT, 'w') as f: f.write(dumps(build()))
    print(OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
