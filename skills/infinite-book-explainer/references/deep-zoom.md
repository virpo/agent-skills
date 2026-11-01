# Clickable plate and deep zoom

## World coordinates

Plate pixels are the world. Every outline, label, tile rectangle and camera target is stored in them. If the labels need more room than the painting's margins, compose the plate onto a wider canvas of the sampled paper colour and publish that at 2x with a light unsharp mask for sharper zooming.

## Parts

One record per part:

```js
engine: {
  polys: [[[x, y], ...], ...],   // clickable outlines; several polygons allowed
  frame: [x0, y0, x1, y1],       // optional: what the camera fits instead of the outline bounds
  anchor: [x, y],                // where the leader line lands
  label: { x, y, w, from: "bottom", align: "right" },
  elbow: [x, y]                  // optional bend that keeps the leader off busy areas
}
```

- Trace outlines on a full-size image with `scripts/grid.py image.png grid.png 64`, reading coordinates off the labelled lines. Then draw the outlines over the plate in the browser and fix any that miss.
- Labels sit on the paper in plate coordinates, so they scale with the picture like a printed page. When the fitted plate is so small that label text would render under about 8px (phones), hide the printed labels, fit the subject instead of the whole page, and show a row of tappable part names.
- Text per part: name, a one-line note for the label, a lead sentence, two or three numbers, three facts, and a "Can you find it?" prompt that sends the child back into the picture.

## Camera

- The world is one element moved with `translate(x, y) scale(s)`. Pass `--k: 1/s` to the overlay and write stroke widths and dash lengths as `calc(2px * var(--k))`, so outlines stay the same on screen at every zoom.
- Fly in log scale with an ease-in-out cubic, about 1100–1300 ms. On long hops, dip out a little like a camera crane:

```js
const dip = Math.min(.5, Math.max(0, (dist / viewSpan - .6) * .35));
const s = Math.exp(ls0 + (ls1 - ls0) * e - dip * Math.sin(Math.PI * e));
// centre moves linearly with e; screen offset = W/2 - centre * s
```

- Frame a focused part in the space the reading panel leaves free, with about 25% padding, and clamp the zoom between about 1.3x and 4x of the fitted view for parts, and 4x to 18x for sub-parts.
- Dim everything except the focused part with an SVG mask whose hole is the part's outline.
- Wheel, pinch and drag all zoom or pan; a press only counts as a click if it moved less than about 6px. Escape goes up one level, arrow keys step through siblings, and the URL hash records the current part.

## Deeper levels

Each tile is the parent's area, repainted at higher detail and aligned back. `scripts/tile.py` does the deterministic parts.

1. **Plan rectangles.** Pad each part's bounds (about 32% for parts, 12% for sub-parts), grow them to the tile aspect (3:2), enforce a minimum width, and slide them inside the parent. Level-3 rectangles are planned in level-2 tile pixels and converted to plate pixels for the viewer.
2. **Crop.** `tile.py crop parent.png x y w h src.png` cuts the area and enlarges it to 1536 x 1024 with Lanczos. It is blurry by design.
3. **Repaint.** Image-edit with the crop as Image 1:

```text
Image 1 is a crop of a hand-painted ink-and-watercolor cut-away plate of [subject], from a 1990s children's illustrated encyclopedia. It was enlarged from a small area, so it is blurry.

TASK: re-paint THIS EXACT IMAGE at high resolution with much more fine detail, as if the original artist had painted this small area at a far larger size. This is a super-resolution and detail-enhancement job, NOT a new picture.

KEEP EXACTLY:
- the same framing, camera angle and perspective, edge to edge;
- every object, line, edge, person, vehicle and structure in exactly the same place, at the same size, with the same silhouette and the same colors; anything cut by the image border stays cut at the same place;
- the same number of [countable things] and every other countable thing.
Do NOT add, remove, move, rotate or resize anything. Do NOT change the composition or zoom.

ADD ONLY fine detail inside the existing shapes: crisp fine ink linework, [domain details], faces, hands and clothing folds on the small figures, delicate watercolor washes and granulation. Make it technically correct for [type].

WHAT THIS AREA SHOWS: [one sentence naming what is where in this crop]

No text, letters, numbers, labels or logos anywhere. Output a 3:2 landscape image with the same framing as Image 1.
```

4. **Align.** `tile.py align src.png raw.png tile.png` fits a small affine correction with ORB features and RANSAC, rejects implausible fits (scale off by more than 15%, rotation or shear above about 0.06 rad), and keeps the warp only if normalized cross-correlation against the crop improves. It prints `{"before", "after", "warped"}`; store them per tile. In the reference build every accepted tile scored above 0.98. Look at anything under 0.95 side by side with its crop before accepting it; a crisper repaint can score a little lower and still be right.
5. **Trace sub-parts** on the accepted tile with the grid, in tile pixels. In the viewer, `world = rect.xy + p * rect.w / 1536`.

**Stale children.** A child tile is only consistent with the parent it was cropped from. When a parent is regenerated or corrected, regenerate its children from the new parent with the same pipeline. A child repainted independently after a parent fix scored 0.89 and visibly jumped; re-derived from the new parent it scored above 0.98.

Keep a plan file with each tile's rectangle, its parent and its rectangle in parent pixels, and regenerate in parent-first order. Child rectangles and sub-part outlines are stored in the parent tile's pixels: they stay valid only while the parent's rectangle is unchanged and its content stayed put, so re-check them on the grid after any parent change.

Corrections to content (wrong seating, a missing part) are image edits on the tile, followed by alignment and by regenerating everything below it.

## Showing tiles

- Each tile is an absolutely positioned image at its rectangle in plate pixels, inside the transformed world.
- Smaller tiles carry more detail per pixel, so they sit on top; all level-3 tiles sit above level-2 tiles.
- A tile fades in once the camera magnifies its parent beyond the parent's own pixels: with `on = parentDensity * 1.15`, opacity ramps from 0 at `0.7 * on` to 1 at `on`. The focused part's tile and the focused sub-part's tile are always fully shown, whatever the zoom; without that rule some large parts on phones never reached the threshold and showed the blurry plate.
- Feather each tile's edges with a mask so it blends into the layer below.
- Sub-part labels are screen-sized buttons ("+ Fan") placed at the sub-part centre and nudged apart when they collide. Faint dashed outlines alone were not discoverable.
