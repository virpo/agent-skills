---
name: infinite-book-explainer
description: Use when a user wants an interactive, zoomable illustrated cross-section or cut-away of a machine, vehicle, building, animal, or other subject in the style of a vintage children's encyclopedia; asks for clickable painted parts, zooming deeper into the same picture, or "how it works" pages that move and have controls; or wants such a page for a young child.
---

# Infinite Book Explainer

## Overview

Turn one subject into a living encyclopedia page. A huge hand-painted cross-section plate is clickable; the camera flies into any part; each deeper level is a repaint of the exact area above it, aligned so you zoom into the same picture; and "how it works" spreads turn out of the painting into diagrams whose parts really move under a child's hands.

The image model paints. Code moves things and draws every label. Nothing generated is trusted until it has been inspected at full size.

## Requirements

- An image model with both generation and image-edit modes. The Codex CLI's built-in image tool works: `codex exec` with a prompt file, and `-i` to attach a reference or the image to edit.
- Python 3 with Pillow, NumPy, SciPy and scikit-image for the bundled scripts.
- A real browser you can drive (for example Playwright) for every visual check.

## Load the judgment

- Read `references/art-direction.md` before writing any image prompt or accepting any image.
- Read `references/deep-zoom.md` before tracing parts, building the camera, or making a deeper level.
- Read `references/living-book.md` before building a "how it works" page.
- Read `references/ship-and-capture.md` before preloading, theming, deploying, or recording a video.

## Workflow

1. **Pin the subject.** One specific subject and era, the child's age and language. List 15–25 parts nose to tail (or top to bottom), the facts an image model tends to get wrong (counts, spacing, symmetry, seating, which way things face), and 3–6 mechanisms a child could operate. Ask once only if the subject itself is ambiguous.
2. **Paint the plate.** Fill the plate template, generate three variants, and pick the technically correct one after full-size crops on a labelled pixel grid. Keep every prompt next to its image and every rejected image in a `rejected` folder.
3. **Paint the close-ups** for the reading panel, with the chosen plate attached as a style reference. Same acceptance checks.
4. **Make the plate clickable.** Trace part outlines in plate pixels from grid overlays, put labels with leader lines on the paper margins, and build the camera.
5. **Go deeper.** For each part, crop the parent, repaint it, and align it back; keep the alignment warp only if it raises the match score, and look at any tile scoring under 0.95 beside its crop before accepting it. Trace sub-parts on the new tile. When a parent tile changes, regenerate its children from the new parent.
6. **Bring the book alive.** For each mechanism, paint a switched-off orthographic diagram and a parts sheet, then move cut-out pieces or exact vector parts over it, with watercolour flows, self-drawing ink arrows, a step spotlight, and real controls.
7. **Look hard.** Check desktop, tablet and phone widths, light and dark system themes, and reduced motion. Zoom to every level, open every page, operate every control through its full range, and watch for blinking.
8. **Ship.** Build a static site and prefetch every image. Serve it locally (for example `python3 -m http.server`) for a tablet on the same network, and deploy publicly only with explicit authorization. Record a frame-exact video only when asked.

## Rules

- Do not use AI video or AI-drawn animation frames for mechanisms. Blade counts, seats and linkages drift between frames.
- No text inside any painting. Labels, numbers and arrows are HTML or SVG, so they stay sharp and translatable.
- Keep the paper look in every theme. Do not add a dark "gallery wall" unless the user asks.
- Moving parts must be mechanically correct at every control value. Check pins, pivots and contact points on screenshots at minimum, middle and maximum.
- Watercolour stays transparent. If air or light hides the painting under it, it is too heavy.
- Write for the stated child: short sentences, true explanations (no popular myths), and something to find or do on every page. For children who cannot read yet, the text is for the adult reading aloud, so the picture, the moving parts and large touch targets must carry the page on their own.
- Deploying, DNS changes and publishing are external writes that need explicit user authorization.

## Output contract

Report, in order:

1. `Subject and facts`: the subject, audience and the technical facts the art was checked against.
2. `Art`: chosen and rejected images with the reason for each rejection, and where the prompts live.
3. `Levels`: part and sub-part counts, and the lowest tile alignment score.
4. `Pages`: each mechanism, its controls and what they move.
5. `Checks`: the widths, themes and interactions actually exercised, with evidence.
6. `Ship`: build output, and the live URL or why it is not deployed.

## Stop conditions

Stop and say what is missing when no image model with an edit mode is available (deep zoom then stays a plain enlargement), when the model keeps failing a technical fact after three focused retries, when a mechanism cannot be shown correctly with the available art, or when deployment lacks authorization or credentials. Never call a level finished without having zoomed into it in a real browser.
