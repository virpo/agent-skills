# Infinite Book Explainer Skill Test

## No-skill control

Scenario: a parent asks for an interactive cross-section of a steam locomotive for a three-year-old, in the style of a 1980s–90s children's encyclopedia, with tap-to-zoom, deeper zoom into the same painting, and "how it works" pages with moving pistons and levers, as a tablet website. The agent has an image-model CLI, Python and Node, and was asked for the concrete build plan it would execute.

The control was strong on general engineering. It used plate pixels as world coordinates, log-scale camera interpolation, image-to-image repaints for deeper levels, code-driven kinematics with tests, `decode()` before showing an image, big touch targets, and a parent-hash lock so a changed plate could not silently break its children.

## Portable gap

The control did not:

- align a repaint back to its parent geometrically. It planned a strength-limited img2img pass with the outer 12% forced to equal the parent pixels and an SSIM gate. Interior drift then stays in place and the forced ring becomes a visible seam;
- write a "super-resolution, keep every shape, position, count and colour, add only fine detail" repaint prompt with a per-tile description of what is where;
- generate the plate with empty paper margins for real labels, explicit counts and spacing for the facts image models get wrong, or a pixel-grid acceptance step. It also left out the named style references on purpose, although they were part of the prompt that produced the look in the source project;
- know how to paint art that can be animated: orthographic, switched-off diagrams with empty channels where air or loads will move, parts sheets with gaps for cutting out, edits that remove moving parts, and flat chroma-key fills for areas the code replaces;
- cover cutting pieces off paper, or the trapped-paper and erased-white-part failures;
- plan the "book comes alive" layer: the page turn from the painting, watercolour flows composited with multiply and kept transparent, self-drawing ink arrows layered above the art and spotlight, a step spotlight, physical lag and spring-back in controls, and demos when a step is selected;
- prefetch everything after first paint. It planned to evict decoded images more than one level away, which reintroduces the blinking seen in the source project;
- keep the paper look regardless of dark mode;
- recognise that frame-exact video capture needs a virtual clock, a desktop viewport and an explicit screenshot clip.

## GREEN criteria

A fresh agent using `$infinite-book-explainer` must:

1. Fill the plate template with explicit counts and positions, empty paper margins, and no painted text, and plan three variants checked on full-size grid crops against a written fact list.
2. Make deeper tiles by crop, repaint with the keep-everything prompt, then an affine alignment warp kept only when it raises the match score, and regenerate children when a parent changes.
3. Paint switched-off orthographic base diagrams and parts sheets, and move cut-out or exact vector parts over them; never AI video.
4. Layer flows, arrows and callouts above the art and spotlight, keep watercolour transparent, and give controls physical lag, spring-back, a live status sentence and step demos.
5. Prefetch every image nearest-first after first paint and swap panel images only after `decode()`.
6. Keep one paper look in every theme and treat deployment as an external write that needs authorization.

## Completed forward test

A fresh agent used the skill on the same locomotive request without generating images. It filled the plate template with exact wheel counts per side, the coupling and connecting rod attachments, firebox and tube placement, empty paper margins and a no-text rule, and wrote a ten-point fact list for grid-crop acceptance. It planned crop, repaint, align tiles with stale-subtree regeneration, switched-off orthographic base diagrams with parts sheets, vector crank-slider and coupling-rod motion, flows and arrows above the spotlight, controls with lag and spring-back, nearest-first prefetch, paper in every theme, and no deployment without explicit authorization. It ran every bundled script on synthetic images: alignment raised a distorted repaint from 0.787 to 0.992 and left an unrelated image unwarped.

Its feedback led to these revisions: one tile acceptance rule, the real output size of the image tool, a plan file and grid re-check for child tiles, a warning when a repaint's aspect differs from its crop, guidance for children who cannot read, a fallback when named styles are refused, local serving for a tablet, and a crank-slider recipe.
