"""Draw the circuit textures that carry MiCar's own names or simple patterns (Pillow; run here, not in Blender):

    python3 tools/blender/draw_textures.py <out dir> [Barlow Condensed 800 .ttf]

boards.png   8 trackside boards, stacked: board j is v from j/8 to (j+1)/8 (the wall boards are 6 m x 0.8 m)
brake.png    150 / 100 / 50 braking boards side by side: board j is u from j/3 to (j+1)/3 (1.1 m x 1.5 m)
tyres.jpg    a tyre wall, three tyres high, with a red and white belt across its middle third; 2 m along by 1 m up
crowd.jpg    seated spectators in muted clothes; u runs across the rows (3 rows a tile), v along the stand (4 m a tile)
pit.jpg      one garage bay of the pit building: a roller door below, glazing above (8 m x 9 m)
rubber.png   the rubbered racing line: a faint, soft band where the wheels run, across u (4 m), drifting along v (8 m)
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

NIGHT, ACCENT, INK, BLUE, RED, WHITE = (14, 18, 23), (255, 210, 63), (231, 234, 238), (61, 123, 255), (224, 40, 45), (245, 246, 247)


def font(path, size):
    for p in ([path] if path else []) + ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf']:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def centred(d, box, text, f, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((x0 + x1 - (r - l)) / 2 - l, (y0 + y1 - (b - t)) / 2 - t), text, font=f, fill=fill)


def boards(out, fp):
    W, H = 1024, 1024; slot = H // 8
    im = Image.new('RGB', (W, H), NIGHT); d = ImageDraw.Draw(im)
    designs = [  # background, text, accent stripe, words
        (ACCENT, NIGHT, NIGHT, 'MiCar'), (NIGHT, ACCENT, ACCENT, 'THE STRIP'), (BLUE, WHITE, WHITE, 'OCTANE'),
        (NIGHT, WHITE, ACCENT, 'MiCar GARAGE'), (RED, WHITE, WHITE, 'CDS'), ((22, 130, 72), WHITE, ACCENT, 'MiCar VALUE'),
        (NIGHT, WHITE, (230, 40, 45), 'MiCar'), ((240, 240, 236), (180, 20, 30), NIGHT, 'STRIP RACING'),
    ]
    for j, (bg, fg, stripe, word) in enumerate(designs):
        y0 = j * slot; d.rectangle((0, y0, W, y0 + slot), fill=bg)
        d.rectangle((0, y0, W, y0 + 6), fill=stripe); d.rectangle((0, y0 + slot - 6, W, y0 + slot), fill=stripe)
        f = font(fp, int(slot * 0.62))
        if word.startswith('MiCar') and len(word) > 5:                    # MiCar in the accent, the rest in the text colour
            rest = word[5:]
            wa = d.textlength('MiCar', font=f); wb = d.textlength(rest, font=f); x = (W - wa - wb) / 2
            l, t, r, b = d.textbbox((0, 0), 'MiCar', font=f); y = y0 + (slot - (b - t)) / 2 - t
            d.text((x, y), 'MiCar', font=f, fill=ACCENT if bg != ACCENT else NIGHT); d.text((x + wa, y), rest, font=f, fill=fg)
        else:
            for k in (-1, 1):                                              # repeated small marks either side
                cx = W / 2 + k * W * 0.38; d.polygon([(cx - 22, y0 + slot * .3), (cx + 4, y0 + slot * .3), (cx + 22, y0 + slot * .7), (cx - 4, y0 + slot * .7)], fill=stripe)
            centred(d, (0, y0, W, y0 + slot), word, f, fg)
    im.save(os.path.join(out, 'boards.png'), optimize=True)


def brake(out, fp):
    W, H = 768, 352; im = Image.new('RGB', (W, H), WHITE); d = ImageDraw.Draw(im); sw = W // 3
    for j, lab in enumerate(('150', '100', '50')):
        x0 = j * sw; d.rectangle((x0, 0, x0 + sw, H), fill=WHITE)
        d.rectangle((x0 + 10, 10, x0 + sw - 10, H - 10), outline=RED, width=16)
        centred(d, (x0, 0, x0 + sw, H), lab, font(fp, 150), NIGHT)
    im.save(os.path.join(out, 'brake.png'), optimize=True)


def tyres(out, rnd):
    """Stacked tyres, three high, with a bolted belt across the middle third only (a belt over most of the height read
    as a red and white block): one tile is 2 m along by 1 m up, the belt's red and white panels 1 m each."""
    W, H = 512, 256; im = Image.new('RGB', (W, H), (10, 10, 11)); d = ImageDraw.Draw(im)
    r = W // 8
    for row, cy in enumerate((H * 0.17, H * 0.5, H * 0.83)):            # 4 tyres across, 3 high (0.33 m each)
        for col in range(4):
            cx = col * W // 4 + W // 8 + (r // 2 if row == 1 else 0)
            d.ellipse((cx - r, cy - r * .66, cx + r, cy + r * .66), fill=(24, 24, 26), outline=(40, 40, 42), width=5)
            d.ellipse((cx - r * .45, cy - r * .3, cx + r * .45, cy + r * .3), fill=(7, 7, 8))
    y0, y1 = int(H * .34), int(H * .66)
    for k in range(2):                                                    # the belt: red and white panels, 1 m each
        x0 = k * W // 2; d.rectangle((x0, y0, x0 + W // 2, y1), fill=(176, 30, 34) if k == 0 else (214, 214, 208))
        for bx in (x0 + 18, x0 + W // 2 - 18):                            # the bolts
            for by in (y0 + 12, y1 - 12): d.ellipse((bx - 4, by - 4, bx + 4, by + 4), fill=(90, 90, 92))
    d.line((0, y0, W, y0), fill=(30, 30, 32), width=3); d.line((0, y1, W, y1), fill=(30, 30, 32), width=3)
    for _ in range(1400):                                                 # grime
        x, y = rnd.randrange(W), rnd.randrange(H); v = rnd.randint(-26, 8)
        p = im.getpixel((x, y)); im.putpixel((x, y), tuple(max(0, min(255, c + v)) for c in p))
    im.filter(ImageFilter.GaussianBlur(0.6)).save(os.path.join(out, 'tyres.jpg'), quality=82)


def crowd(out, rnd):
    """Seated spectators under the roof, seen from the front and above: u runs across the rows (3 rows a tile, about
    1 m each), v along the stand (4 m a tile, 10 seats). Clothes are muted and the seats dark, so at a distance the
    stand reads as a crowd's speckle, not as coloured sweets."""
    import colorsys
    W, H = 512, 512; im = Image.new('RGB', (W, H), (44, 47, 54)); d = ImageDraw.Draw(im)
    base = [(200, 50, 50), (230, 230, 228), (240, 200, 70), (70, 110, 200), (28, 28, 32), (60, 140, 90), (220, 120, 50),
            (120, 70, 140), (95, 105, 120), (150, 130, 110), (40, 50, 80)]
    def muted(c):
        h, l, sat = colorsys.rgb_to_hls(*(x / 255 for x in c)); r, g, b = colorsys.hls_to_rgb(h, l * .78, sat * .42)
        return (int(r * 255), int(g * 255), int(b * 255))
    shirts = [muted(c) for c in base]
    skins = [(196, 160, 135), (182, 142, 110), (160, 115, 85), (118, 80, 58), (84, 58, 44)]
    hair = [(30, 26, 24), (60, 44, 32), (110, 90, 60), (140, 140, 140)]
    rows = 3; rw = W // rows; per = 10
    for i in range(rows):
        x0 = i * rw
        d.rectangle((x0, 0, x0 + rw, H), fill=(48, 52, 60)); d.rectangle((x0 + rw - 12, 0, x0 + rw, H), fill=(30, 33, 39))
        for k in range(per):
            y = k * H // per + H // (per * 2) + rnd.randint(-4, 4)
            if rnd.random() < 0.15: continue                              # an empty seat
            c = rnd.choice(shirts); x = x0 + rw * .40 + rnd.randint(-6, 6)
            d.rounded_rectangle((x - 30, y - 19, x + 18, y + 19), 9, fill=c)            # shoulders and back
            d.rounded_rectangle((x - 30, y - 19, x - 20, y + 19), 4, fill=tuple(int(v * .7) for v in c))   # shade
            d.ellipse((x + 12, y - 10, x + 32, y + 10), fill=rnd.choice(skins))         # head, towards the track side
            d.chord((x + 10, y - 11, x + 30, y + 11), 90, 270, fill=rnd.choice(hair))   # hair at the back of the head
    im.filter(ImageFilter.GaussianBlur(1.0)).save(os.path.join(out, 'crowd.jpg'), quality=80)


def pit(out, rnd):
    W, H = 512, 512; im = Image.new('RGB', (W, H), (226, 228, 232)); d = ImageDraw.Draw(im)
    py = lambda m: H - int(m / 9.0 * H)                                   # metres up -> pixel row
    d.rectangle((0, py(9.0), W, py(8.4)), fill=(60, 64, 72))              # roof edge
    d.rectangle((W * .06, py(8.0), W * .94, py(5.6)), fill=(40, 58, 78))  # glazing
    for k in range(1, 6): x = W * .06 + k * W * .88 / 6; d.line((x, py(8.0), x, py(5.6)), fill=(150, 160, 170), width=4)
    d.rectangle((0, py(5.0), W, py(4.7)), fill=(255, 210, 63))            # the team band
    d.rectangle((W * .12, py(4.4), W * .88, py(0)), fill=(150, 156, 164)) # the roller door
    for y in range(py(4.4), py(0), 9): d.line((W * .12, y, W * .88, y), fill=(120, 126, 134), width=2)
    d.rectangle((0, py(0.25), W, H), fill=(90, 92, 96))
    im.save(os.path.join(out, 'pit.jpg'), quality=82)


def rubber(out, rnd):
    """The rubbered line, 4 m across (u) and 8 m along (v; it tiles): a faint darker band where the wheels run, about
    1.6 m apart, soft-edged and drifting slowly along the track. Black streaks read as burnout marks, not a racing
    line, so the rubber darkens the asphalt by at most a fifth and never in a hard line."""
    import math
    W, H = 256, 512; im = Image.new('RGBA', (W, H), (12, 12, 13, 0)); px = im.load()
    paths = [(c + rnd.uniform(-0.03, 0.03), rnd.uniform(0.07, 0.09), rnd.uniform(0.10, 0.13), rnd.randint(1, 2), rnd.uniform(0, 2 * math.pi))
             for c in (0.3, 0.7)]
    for y in range(H):
        for x in range(W):
            u = (x + 0.5) / W; a = max(0.0, 1 - abs(2 * u - 1) ** 2) * 0.04            # the band
            for c, w, s, k, ph in paths:
                dd = (u - c - 0.01 * math.sin(2 * math.pi * y / H + ph)) / w
                a += s * math.exp(-dd * dd) * (0.8 + 0.2 * math.sin(2 * math.pi * k * y / H + ph))
            px[x, y] = (12, 12, 13, int(255 * min(0.2, a)))
    im.save(os.path.join(out, 'rubber.png'), optimize=True)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'sim', 'public', 'strip', 'tex')
    fp = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(out, exist_ok=True); rnd = random.Random(7)
    boards(out, fp); brake(out, fp); tyres(out, rnd); crowd(out, rnd); pit(out, rnd); rubber(out, rnd)


if __name__ == '__main__':
    main()
