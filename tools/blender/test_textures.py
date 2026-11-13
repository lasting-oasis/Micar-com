"""The drawn circuit textures (draw_textures.py), checked as pictures: run pytest tools/blender -q."""
import colorsys
import os
import random
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
Image = pytest.importorskip('PIL.Image')
import draw_textures as dt  # noqa: E402


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    d = str(tmp_path_factory.mktemp('tex')); rnd = random.Random(7)
    dt.tyres(d, rnd); dt.crowd(d, rnd); dt.rubber(d, rnd)
    return d


def pixels(path):
    im = Image.open(path); return list(im.getdata()), im.size


def test_the_rubber_darkens_the_road_faintly_not_like_skid_marks(out):
    """Seen from the chase camera the old streaks (up to 45% black) read as burnout marks. The rubbered line darkens the
    asphalt by at most 22%, on average under 9% across the band, and has no hard line: neighbouring columns differ by
    at most 3% in alpha."""
    px, (W, H) = pixels(os.path.join(out, 'rubber.png'))
    a = [p[3] / 255 for p in px]
    assert max(a) <= 0.22
    assert sum(a) / len(a) <= 0.09
    for y in range(0, H, 37):
        row = a[y * W:(y + 1) * W]
        assert max(abs(p - q) for p, q in zip(row, row[1:])) <= 0.03


def test_the_crowd_is_people_not_sweets(out):
    """Spectators were saturated coloured ovals. The crowd is muted (mean saturation under 0.32, under 4% of pixels
    above 0.75 saturation) and mostly darker than mid-grey, as a crowd under a roof reads."""
    px, _ = pixels(os.path.join(out, 'crowd.jpg'))
    hsv = [colorsys.rgb_to_hsv(r / 255, g / 255, b / 255) for r, g, b in px]
    assert sum(s for h, s, v in hsv) / len(hsv) < 0.32
    assert sum(1 for h, s, v in hsv if s > 0.75) / len(hsv) < 0.04
    assert sum(v for h, s, v in hsv) / len(hsv) < 0.45


def test_the_tyre_wall_shows_its_tyres_under_a_narrow_belt(out):
    """The belt covered 72% of the wall's height, so the wall read as a red and white block. It now covers at most 40%,
    and the rest of the wall is dark tyres."""
    px, (W, H) = pixels(os.path.join(out, 'tyres.jpg'))
    bright = lambda p: max(p) > 110
    rows = [sum(1 for x in range(W) if bright(px[y * W + x])) / W for y in range(H)]
    belt = sum(1 for r in rows if r > 0.4) / H
    assert belt <= 0.40
    assert sum(1 for r in rows if r < 0.05) / H >= 0.45
