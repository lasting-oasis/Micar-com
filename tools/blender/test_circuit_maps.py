"""circuit_maps.py: the race menu's circuit maps (apps/sim/src/world/strip/circuitMaps.json)."""
import json
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import circuit_maps as cm  # noqa: E402

INDEX = json.load(open(cm.INDEX))['tracks']
IDS = [t['id'] for t in INDEX]
DATA = cm.build()


def seg_dist(p, a, b):
    ax, az, bx, bz = a[0], a[1], b[0], b[1]
    L2 = (bx - ax) ** 2 + (bz - az) ** 2
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * (bx - ax) + (p[1] - az) * (bz - az)) / L2))
    return math.hypot(p[0] - (ax + (bx - ax) * t), p[1] - (az + (bz - az) * t))


def centre(tid):
    return json.load(open(os.path.join(cm.TRACKS, tid + '.json')))['centre']['pts']


def test_every_circuit_and_event_is_there():
    assert list(DATA['circuits']) == IDS
    want = {e for t in INDEX for e in t['events']}
    assert set(DATA['events']) == want


@pytest.mark.parametrize('tid', IDS)
def test_outline_is_the_centre_line_from_the_start(tid):
    c = DATA['circuits'][tid]; pts = c['pts']; lenM = next(t['lenM'] for t in INDEX if t['id'] == tid)
    assert len(pts) == cm.N
    L = sum(math.dist(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts)))
    assert abs(L - lenM) / lenM < 0.02 and abs(c['len'] - lenM) < 1
    first = centre(tid)[0]
    assert math.dist(pts[0], first) < 0.2                                  # the start line
    assert c['sectors'] == [cm.N // 3, 2 * cm.N // 3]


@pytest.mark.parametrize('tid', IDS)
def test_corners_are_numbered_bends_on_the_line_with_labels_off_it(tid):
    c = DATA['circuits'][tid]; cl = centre(tid); n = len(cl)
    xs = [p[0] for p in cl]; zs = [p[1] for p in cl]; diag = math.hypot(max(xs) - min(xs), max(zs) - min(zs))
    assert 6 <= len(c['corners']) <= 30
    last = -1
    for ax, az, lx, lz in c['corners']:
        i = min(range(n), key=lambda j: (cl[j][0] - ax) ** 2 + (cl[j][1] - az) ** 2)
        assert math.dist((ax, az), cl[i]) < 0.2                             # an apex is a centre-line point
        assert i > last; last = i                                          # numbered from the start line
        near = min(seg_dist((lx, lz), cl[j], cl[(j + 1) % n]) for j in range(n))
        assert near > 0.015 * diag                                        # its label sits off the track


def test_events_follow_their_routes():
    for t in INDEX:
        track = json.load(open(os.path.join(cm.TRACKS, t['id'] + '.json')))
        for e in t['events']:
            got = DATA['events'][e]; src = track['routes'][e]
            assert got['loop'] == bool(src.get('loop')) and 2 <= len(got['pts']) <= cm.EV_N
            assert math.dist(got['pts'][0], src['pts'][0]) < 0.2
            if not got['loop']: assert math.dist(got['pts'][-1], src['pts'][-1]) < 0.2


def test_written_file_matches_and_is_deterministic():
    a = cm.dumps(cm.build()); b = cm.dumps(cm.build())
    assert a == b
    assert open(cm.OUT).read() == a


@pytest.mark.parametrize('tid', IDS)
def test_corner_labels_keep_apart(tid):
    c = DATA['circuits'][tid]; cl = centre(tid)
    xs = [p[0] for p in cl]; zs = [p[1] for p in cl]; diag = math.hypot(max(xs) - min(xs), max(zs) - min(zs))
    L = [(q[2], q[3]) for q in c['corners']]
    for i in range(len(L)):
        for j in range(i + 1, len(L)): assert math.dist(L[i], L[j]) > 0.025 * diag, (i + 1, j + 1)

