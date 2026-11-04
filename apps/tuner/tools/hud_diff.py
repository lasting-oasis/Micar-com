#!/usr/bin/env python3
"""HUD-only parity: same metrics as rea_diff.py but restricted to the chrome the replica reproduces
(left dock, right dock, bottom panel, home button), excluding the stage whose art is original by design.
  python3 tools/hud_diff.py original.png replica.png -o diff/hud_colors
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageFilter

P = argparse.ArgumentParser(); P.add_argument('original'); P.add_argument('replica'); P.add_argument('-o', '--out', default='diff/hud')
a = P.parse_args(); os.makedirs(a.out, exist_ok=True)
A = Image.open(a.original).convert('RGB'); B = Image.open(a.replica).convert('RGB').resize(A.size)
W, H = A.size; sx, sy = W / 1440, H / 900
# regions in 1440x900 coordinates: bottom panel, right dock, left dock, home button
regions = [(0, 780, 1440, 900), (1373, 40, 1440, 780), (0, 640, 67, 780), (0, 10, 65, 85)]
mask = np.zeros((H, W), bool)
for x0, y0, x1, y1 in regions: mask[int(y0 * sy):int(y1 * sy), int(x0 * sx):int(x1 * sx)] = True
a_ = np.asarray(A.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.int16); b_ = np.asarray(B.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.int16)
d = np.abs(a_ - b_).max(axis=2)
mism = (d[mask] > 40).mean() * 100
bs = 16; hb, wb = H // bs, W // bs
blk = lambda x: x[:hb * bs, :wb * bs].reshape(hb, bs, wb, bs, 3).mean(axis=(1, 3))
bm = mask[:hb * bs, :wb * bs].reshape(hb, bs, wb, bs).mean(axis=(1, 3)) > 0.5
layout = (np.abs(blk(a_) - blk(b_)).max(axis=2)[bm] > 25).mean() * 100
heat = np.asarray(B).copy(); m = (d > 40) & mask; heat[m] = (0.4 * heat[m] + 0.6 * np.array([255, 0, 60])).astype(np.uint8); heat[~mask] = (heat[~mask] * 0.35).astype(np.uint8)
Image.fromarray(heat).save(os.path.join(a.out, 'heatmap.png'))
res = {'hud_pixel_mismatch_pct': round(float(mism), 2), 'hud_layout_mismatch_pct': round(float(layout), 2), 'regions_1440x900': regions}
json.dump(res, open(os.path.join(a.out, 'score.json'), 'w'), indent=2); print(json.dumps(res))
