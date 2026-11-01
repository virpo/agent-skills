#!/usr/bin/env python3
"""Deep-zoom tile helpers: crop a parent area for repainting, then align the repaint back.

  tile.py crop <parent.png> <x> <y> <w> <h> <out.png> [--size 1536x1024]
      Cut the rectangle (parent pixels, fractional allowed) and enlarge it with Lanczos.

  tile.py align <crop.png> <repaint.png> <out.png>
      Fit a small affine correction from the repaint to the crop with ORB features and RANSAC.
      The warp is kept only if it is plausible (scale within 15%, rotation and shear under
      0.06 rad) and raises the normalized cross-correlation of the blurred greyscale images.
      Prints {"before", "after", "warped"}; store it with the tile.

The repaint itself is an image-model edit of the crop (see references/deep-zoom.md).
"""
import json
import sys

import numpy as np
from PIL import Image


def crop(parent, x, y, w, h, out, size=(1536, 1024)):
    src = Image.open(parent).convert("RGB")
    src.resize(size, Image.LANCZOS, box=(x, y, x + w, y + h)).save(out)


def gray(im, width):
    height = round(width * im.height / im.width)
    return np.asarray(im.convert("L").resize((width, height), Image.LANCZOS), dtype=np.float32) / 255


def ncc(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def align(crop_path, raw_path, out):
    from scipy.ndimage import gaussian_filter
    from skimage.feature import ORB, match_descriptors
    from skimage.measure import ransac
    from skimage.transform import AffineTransform, warp

    src = Image.open(crop_path).convert("RGB")
    raw = Image.open(raw_path).convert("RGB")
    if abs(raw.width / raw.height - src.width / src.height) > 0.01:
        print(f"align: repaint aspect {raw.width}x{raw.height} differs from crop {src.width}x{src.height}; "
              "it will be stretched, so check the framing", file=sys.stderr)
    raw = raw.resize(src.size, Image.LANCZOS)
    work = min(768, src.width)
    s = work / src.width
    A, B = gray(src, work), gray(raw, work)

    def score(b):
        return ncc(gaussian_filter(A, 2.5), gaussian_filter(b, 2.5))

    before = score(B)
    best_score, best_model = before, None
    try:
        orb = ORB(n_keypoints=1500, fast_threshold=0.05)
        orb.detect_and_extract(A)
        ka, da = orb.keypoints, orb.descriptors
        orb.detect_and_extract(B)
        kb, db = orb.keypoints, orb.descriptors
        m = match_descriptors(da, db, cross_check=True, max_ratio=0.85)
        if len(m) >= 12:
            model, inliers = ransac((kb[m[:, 1]][:, ::-1], ka[m[:, 0]][:, ::-1]), AffineTransform,
                                    min_samples=3, residual_threshold=2.5, max_trials=3000)
            if model is not None and inliers.sum() >= 10:
                sane = (np.all(np.abs(np.atleast_1d(model.scale) - 1) < 0.15)
                        and abs(model.rotation) < 0.06 and abs(model.shear) < 0.06)
                if sane:
                    warped = score(warp(B, model.inverse, mode="edge"))
                    if warped > best_score:
                        best_score, best_model = warped, model
    except Exception as e:                  # too few features, degenerate fit
        print(f"align: feature fit failed: {e}", file=sys.stderr)

    final = raw
    if best_model is not None:
        full = AffineTransform(matrix=np.diag([1 / s, 1 / s, 1]) @ best_model.params @ np.diag([s, s, 1]))
        arr = warp(np.asarray(raw, dtype=np.float32) / 255, full.inverse, mode="edge")
        final = Image.fromarray((arr * 255).clip(0, 255).astype(np.uint8))
    final.save(out)
    result = {"before": round(before, 4), "after": round(best_score, 4), "warped": best_model is not None}
    print(json.dumps(result))
    return result


def main():
    args = sys.argv[1:]
    if args[:1] == ["crop"] and len(args) >= 7:
        size = (1536, 1024)
        if "--size" in args:
            w, h = args[args.index("--size") + 1].lower().split("x")
            size = (int(w), int(h))
        crop(args[1], *map(float, args[2:6]), args[6], size)
    elif args[:1] == ["align"] and len(args) == 4:
        align(*args[1:])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
