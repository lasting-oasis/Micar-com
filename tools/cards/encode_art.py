#!/usr/bin/env python3
"""Write the card back's web copies from the master artwork.

    python3 tools/cards/encode_art.py

Reads assets/cards/micar-card-back.png, refusing a file that is not the master (by its SHA-256), and writes two
copies of the same pixels into apps/value/public/cards/:

  back.avif   quality 90, full colour resolution (4:4:4). The copy browsers load first.
  back.webp   quality 95. For a browser that cannot read AVIF. WebP always halves the colour resolution
              (4:2:0), which on artwork this finely coloured costs fidelity that no quality setting buys back:
              measured on the master, its brightness channel matches to 43 dB but the whole picture only to 32.5.

Two more are the small ones every card on the site turns over to show: the same picture at half size (531x741),
for a back face a few hundred pixels wide, where the full-size copies would cost a page three quarters of a megabyte.

  back-face.avif   quality 68, full colour resolution. Loaded first.
  back-face.webp   quality 80. For a browser that cannot read AVIF.

The artwork is never edited: no crop, no colour change, and no resize but that one plain halving. Each copy is decoded again and compared with
the master, and the script prints its size and its PSNR. It exits 1 when a copy is the wrong size, over its
budget or too far from the master.

Needs Pillow 11.3 or later, built with AVIF and WebP (pip install pillow).
"""
import hashlib
import math
import os
import sys

from PIL import Image, ImageChops, ImageStat, features

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MASTER = os.path.join(REPO, 'assets', 'cards', 'micar-card-back.png')
OUT_DIR = os.path.join(REPO, 'apps', 'value', 'public', 'cards')
MASTER_SHA256 = '5bd441b57e7becbb812469ae4f61eebbea991c59ad955293dee80ce1852c3c95'
BUDGET_BYTES = 900_000
FACE_SIZE = (531, 741)          # the master (1062x1481) halved
FACE_BUDGET_BYTES = 160_000
# name, Pillow format, save options, the least PSNR accepted against the halved master
FACES = [
    ('back-face.avif', 'AVIF', {'quality': 68, 'subsampling': '4:4:4', 'speed': 4}, 31.0),
    ('back-face.webp', 'WEBP', {'quality': 80, 'method': 6}, 27.0),
]

# name, Pillow format, save options, the least PSNR accepted over the whole picture, and over brightness alone
COPIES = [
    ('back.avif', 'AVIF', {'quality': 90, 'subsampling': '4:4:4', 'speed': 4}, 38.0, 42.0),
    ('back.webp', 'WEBP', {'quality': 95, 'method': 6}, 32.0, 42.0),
]


def psnr(a, b):
    """Peak signal-to-noise ratio in decibels over every channel of two images of one size. Identical: infinity."""
    squares = ImageStat.Stat(ImageChops.difference(a, b)).sum2
    mse = sum(squares) / (len(squares) * a.size[0] * a.size[1])
    return math.inf if mse == 0 else 10 * math.log10(255 * 255 / mse)


def main():
    missing = [f for f in ('avif', 'webp') if not features.check(f)]
    if missing:
        print('This Pillow cannot write ' + ' or '.join(missing) + '. Nothing written.', file=sys.stderr)
        return 1
    with open(MASTER, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != MASTER_SHA256:
        print(f'{MASTER} is not the master artwork (SHA-256 {digest}). Nothing written.', file=sys.stderr)
        return 1
    master = Image.open(MASTER).convert('RGB')
    luma = master.convert('L')
    os.makedirs(OUT_DIR, exist_ok=True)
    problems = []
    for name, fmt, options, least, least_luma in COPIES:
        path = os.path.join(OUT_DIR, name)
        master.save(path, fmt, **options)
        copy = Image.open(path).convert('RGB')
        size = os.path.getsize(path)
        same = copy.size == master.size
        whole = psnr(master, copy) if same else 0.0
        bright = psnr(luma, copy.convert('L')) if same else 0.0
        print(f'{name}: {copy.size[0]}x{copy.size[1]}, {size} bytes, PSNR {whole:.1f} dB (brightness {bright:.1f} dB) against the master')
        if not same:
            problems.append(f'{name}: size {copy.size} is not the master\'s {master.size}')
        if size > BUDGET_BYTES:
            problems.append(f'{name}: {size} bytes is over the {BUDGET_BYTES} byte budget')
        if whole < least:
            problems.append(f'{name}: PSNR {whole:.1f} dB is under {least} dB')
        if bright < least_luma:
            problems.append(f'{name}: brightness PSNR {bright:.1f} dB is under {least_luma} dB')
    face = master.resize(FACE_SIZE, Image.LANCZOS)
    for name, fmt, options, least in FACES:
        path = os.path.join(OUT_DIR, name)
        face.save(path, fmt, **options)
        size = os.path.getsize(path)
        near = psnr(face, Image.open(path).convert('RGB'))
        print(f'{name}: {FACE_SIZE[0]}x{FACE_SIZE[1]}, {size} bytes, PSNR {near:.1f} dB against the halved master')
        if size > FACE_BUDGET_BYTES:
            problems.append(f'{name}: {size} bytes is over the {FACE_BUDGET_BYTES} byte budget')
        if near < least:
            problems.append(f'{name}: PSNR {near:.1f} dB is under {least} dB')
    for p in problems:
        print('FAILED: ' + p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
