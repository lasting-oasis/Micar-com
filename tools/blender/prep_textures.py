"""Size the CC0 source textures for phones and write the game's set (Pillow; run here):

    python3 tools/blender/prep_textures.py <source dir> <out dir>

The sources come from Poly Haven and ambientCG (CC0), fetched in Blender on the owner's PC (see stage notes in
docs/superpowers/plans/2026-11-13-track-look.md); tree_a_src.png / tree_b_src.png are renders of two Poly Haven tree
models (island_tree_01, fir_tree_01). Opaque maps go to JPEG, maps with alpha to WebP. Also made here: the trees' atlas
and the tree line (from the two tree renders), the overcast sky, and the asphalt lifted to a mid grey.
"""
import os
import random
import sys

from PIL import Image, ImageEnhance

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trackside import TREE_ASPECT  # noqa: E402  (the trees' quads in build_strip.py use the same aspects)

JOBS = [  # out name, source, size (w, h), quality
    ('asphalt_n.jpg', 'asphalt_track_nor_gl_1k.jpg', (512, 512), 85),
    ('grass.jpg', 'Grass001_1K-JPG_Color.jpg', (1024, 1024), 78),
    ('grass_n.jpg', 'Grass001_1K-JPG_NormalGL.jpg', (512, 512), 85),
    ('gravel.jpg', 'gravel_floor_02_Diffuse_1k.jpg', (512, 512), 80),
    ('gravel_n.jpg', 'gravel_floor_02_nor_gl_1k.jpg', (512, 512), 85),
    ('concrete.jpg', 'concrete_wall_008_Diffuse_1k.jpg', (512, 512), 80),
    ('concrete_n.jpg', 'concrete_wall_008_nor_gl_1k.jpg', (512, 512), 85),
]
SKY = ('overcast_soil_puresky_tonemapped.jpg', (2048, 1024), 0.86)     # source, size, brightness


def opaque_mean(im):
    """The mean colour of an RGBA image's opaque pixels."""
    a = im.getchannel('A').point(lambda v: 255 if v > 127 else 0)
    rgb = Image.new('RGB', im.size); rgb.paste(im.convert('RGB'), mask=a)
    n = max(1, a.histogram()[255]); hist = rgb.histogram()
    return tuple(round(sum(i * c for i, c in enumerate(hist[256 * k:256 * (k + 1)])) / n) for k in range(3))


def bleed(im):
    """Fill the clear pixels' colour with the opaque mean, so filtering never pulls black into the edges."""
    bg = Image.new('RGBA', im.size, opaque_mean(im) + (0,))
    bg.paste(im.convert('RGB'), mask=im.getchannel('A').point(lambda v: 255 if v > 0 else 0))
    bg.putalpha(im.getchannel('A')); return bg


def sprite(src, sp):
    im = Image.open(os.path.join(src, 'tree_' + sp + '_src.png')).convert('RGBA')
    return im.crop(im.getbbox())


def trees_atlas(src, out):
    """trees.webp, 1024 x 512: species a centred in the left half, b in the right, full height, at TREE_ASPECT."""
    atlas = Image.new('RGBA', (1024, 512), (0, 0, 0, 0))
    for sp, cx in (('a', 256), ('b', 768)):
        w = round(512 * TREE_ASPECT[sp])
        atlas.alpha_composite(sprite(src, sp).resize((w, 512), Image.LANCZOS), (cx - w // 2, 0))
    bleed(atlas).save(os.path.join(out, 'trees.webp'), quality=85, method=6)


def treeline(src, out, seed=5):
    """treeline.webp, 1024 x 256, tiling across: a back row of smaller, darker trees, a front row of larger ones over a
    dark understorey; the top rows stay clear."""
    rnd = random.Random(seed); W, H = 1024, 256
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    spr = {sp: sprite(src, sp) for sp in 'ab'}
    def row(n, h0, h1, dim):
        for _ in range(n):
            sp = 'a' if rnd.random() < 0.65 else 'b'; h = rnd.randint(h0, h1); w = max(8, round(h * TREE_ASPECT[sp]))
            t = ImageEnhance.Brightness(spr[sp].resize((w, h), Image.LANCZOS)).enhance(dim)
            x = rnd.randint(0, W - 1) - w // 2; y = H - h
            for dx in (-W, 0, W): paste_clip(im, t, x + dx, y)     # wrap round: the strip tiles
    def paste_clip(dst, t, x, y):
        """t at (x, y), the part inside dst only."""
        l = max(0, -x); r = min(t.width, W - x)
        if r > l: dst.alpha_composite(t.crop((l, 0, r, t.height)), (x + l, y))
    row(70, 150, 205, 0.62)
    row(55, 175, 244, 0.85)
    # the understorey: a dark band with a bumpy top, so the wood never shows the sky between the trunks
    floor = Image.new('RGBA', (W, H), (0, 0, 0, 0)); fp = floor.load(); top = [0.0] * W; y = 0.0
    for x in range(W): y = 0.97 * y + rnd.uniform(-1, 1) * 1.6; top[x] = y
    for x in range(W):
        t = H - 62 + top[x] - top[0] * (1 - x / (W - 1)) - top[-1] * (x / (W - 1))     # pinned to 0 at both ends: it tiles
        for yy in range(max(0, int(t)), H): fp[x, yy] = (32, 42, 25, 255)
    im = Image.alpha_composite(im, floor)
    bleed(im).save(os.path.join(out, 'treeline.webp'), quality=82, method=6)


def asphalt(src, out):
    """The track's asphalt, lifted from near black to a mid grey (the clone's), its grain kept, almost no colour."""
    im = Image.open(os.path.join(src, 'asphalt_track_Diffuse_1k.jpg')).convert('RGB').resize((1024, 1024), Image.LANCZOS)
    im = ImageEnhance.Color(im).enhance(0.25)
    m = sum(opaque_mean(im.convert('RGBA'))) / 3
    im = im.point(lambda v: max(0, min(255, round(118 + (v - m) * 1.9))))
    im.save(os.path.join(out, 'asphalt.jpg'), quality=82, optimize=True, progressive=True)


def sky(src, out):
    name, size, k = SKY
    im = Image.open(os.path.join(src, name)).convert('RGB').resize(size, Image.LANCZOS)
    ImageEnhance.Brightness(im).enhance(k).save(os.path.join(out, 'sky.jpg'), quality=82, optimize=True, progressive=True)


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = None
    for name, s, size, q in JOBS:
        im = Image.open(os.path.join(src, s)).convert('RGB').resize(size, Image.LANCZOS)
        im.save(os.path.join(out, name), quality=q, optimize=True, progressive=True)
    # the chain-link fence: colour with the opacity map as alpha, never below 14% (the game blends it: a faint veil
    # between the wires that stays when the wires are too fine to see)
    c = Image.open(os.path.join(src, 'Fence003_1K-PNG_Color.png')).convert('RGB').resize((512, 512), Image.LANCZOS)
    a = Image.open(os.path.join(src, 'Fence003_1K-PNG_Opacity.png')).convert('L').resize((512, 512), Image.LANCZOS).point(lambda v: max(v, 36))
    c.putalpha(a); c.save(os.path.join(out, 'fence.webp'), quality=82, method=6)
    for sp in 'ab':
        im = sprite(src, sp); print('tree', sp, 'aspect', round(im.width / im.height, 3), 'used', TREE_ASPECT[sp])
    trees_atlas(src, out); treeline(src, out); asphalt(src, out); sky(src, out)


if __name__ == '__main__':
    main()
