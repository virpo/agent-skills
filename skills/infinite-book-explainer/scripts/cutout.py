#!/usr/bin/env python3
"""Cut painted pieces off their paper.

  cutout.py <in.png> <out-prefix> [min_area] [--punch]

The paper colour is sampled from the image border and flood-filled from the edges, so the fill
stops at ink outlines and white objects stay solid. Enclosed holes are filled only when they are
large (a white box body) or painted; bare paper inside a handle loop stays see-through. With
--punch, paper-coloured pixels inside each piece also become transparent (stubborn handles).

Each piece is saved as <out-prefix>-<n>.png (RGBA, cropped, soft edge), numbered top-to-bottom
then left-to-right, and the boxes are printed as JSON.
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.segmentation import flood


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        sys.exit(__doc__)
    src, prefix = args[0], args[1]
    min_area = int(args[2]) if len(args) > 2 else 4000
    punch = "--punch" in sys.argv

    a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    h, w, _ = a.shape
    border = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    paper = np.median(border, 0)
    dist = np.sqrt(((a - paper) ** 2).sum(-1))
    near = (dist < 16).astype(np.uint8)

    bg = np.zeros((h, w), bool)
    for y, x in [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1), (0, w // 2), (h - 1, w // 2), (h // 2, 0), (h // 2, w - 1)]:
        if near[y, x]:
            bg |= flood(near, (y, x), connectivity=1)
    obj = ndi.binary_closing(~bg, iterations=2)

    holes, _ = ndi.label(ndi.binary_fill_holes(obj) & ~obj)
    for j, sl in enumerate(ndi.find_objects(holes), 1):
        hm = holes[sl] == j
        if hm.sum() > 30000 or dist[sl][hm].mean() > 16:
            obj[sl] |= hm
    obj = ndi.binary_opening(obj, iterations=2)

    lab, _ = ndi.label(obj)
    boxes = [(sl, i) for i, sl in enumerate(ndi.find_objects(lab), 1) if (lab[sl] == i).sum() >= min_area]
    boxes.sort(key=lambda b: (round(b[0][0].start / 120), b[0][1].start))

    out = []
    for k, (sl, i) in enumerate(boxes, 1):
        pad = 6
        y0, y1 = max(0, sl[0].start - pad), min(h, sl[0].stop + pad)
        x0, x1 = max(0, sl[1].start - pad), min(w, sl[1].stop + pad)
        m = ndi.gaussian_filter((lab[y0:y1, x0:x1] == i).astype(np.float32), 1.0)   # soft watercolour edge
        if punch:
            m *= np.clip((dist[y0:y1, x0:x1] - 8) / 10, 0, 1)
        rgba = np.dstack([a[y0:y1, x0:x1], np.clip(m * 255, 0, 255)]).astype(np.uint8)
        Image.fromarray(rgba).save(f"{prefix}-{k}.png")
        out.append({"n": k, "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0})
    print(json.dumps(out))


if __name__ == "__main__":
    main()
