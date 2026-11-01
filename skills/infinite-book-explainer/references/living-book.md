# The book that comes alive

## Choose the pages

Pick mechanisms a child can operate and see the result of: a lever that spools up an engine, a dial that heats an oven, a button that drops a bag on a belt, a wheel that banks an aircraft. Four to six pages is plenty. Start with the richest one, prove the whole stack there, then do the rest.

Explanations must be true. Prefer the real cause over the popular simplification (for wings, air turned downward, not "the air on top must arrive at the same time").

## Why code moves the parts

Image and video models cannot keep mechanics consistent across frames: blade counts change, levers stop connecting, seat counts drift, and files are large. Paint still pictures, then animate in code:

- **Cut-out pieces** from paintings, for parts whose look matters (a fan disc, a pulley, suitcases, a truck body).
- **Exact vector shapes** computed from geometry every frame, for linkages that must stay connected (scissor arms, rams, rods), given a painterly fill with an SVG turbulence filter.

## The spread

- Left page: running head, title, intro, numbered steps (each a button), "Did you know?", "Play the steps". Right page: the diagram, a caption telling the child what to do, and the control.
- Open it from the panel card with a page turn from the painting the child was just looking at: that image lies across the spread as a printed page, its right half lifts and turns over (about 1.1 s, CSS 3D `rotateY(-180deg)` with a shading sweep), then the diagram inks in and step 1 lights up. Skip the turn for reduced motion and on phones.
- Paper grain over everything, paintings included, so painted and coded parts sit in the same material.

## Stage layers

Diagram coordinates are the base painting's pixels; position HTML sprites by percentages so the stage scales. Bottom to top:

1. base painting (`img`);
2. sprites that sit behind moving parts;
3. SVG art: vector moving parts, then the spotlight veil;
4. canvas for watercolour flows, composited with `multiply`;
5. sprites in front;
6. top SVG: ink arrows, numbered callouts, hand-lettered words.

Arrows, flows and callouts must sit above the art and the veil. In the first build the airflow sat under the spotlight veil and was dimmed with everything else, and a hydraulic ram was hidden behind the arms it pushed.

Each mechanism is data plus `setup(stage)` returning `{ tick(dt, t), step(n), control(value), dispose() }`. Clear the canvas every frame, cap `dt` at about 0.05 s, and slow `dt` down for reduced motion.

## Cut-out pieces

`scripts/cutout.py sheet.png out/piece [min_area] [--punch]` flood-fills the paper from the border (it stops at ink outlines), keeps each remaining piece as a cropped RGBA image with a soft edge, and prints the boxes.

- Paper trapped inside handles and loops: the script fills enclosed holes only when they are large (a white box body) or painted. For the stubborn rest, `--punch` makes paper-coloured pixels inside the piece transparent.
- Cream and white parts (lever handles) get erased by paper removal. Cut those with an explicit mask instead.
- A part that spins: cut a circular disc with an antialiased mask, keep the still ring around it as a separate layer, and pre-render a motion-blurred disc by averaging about 16 slightly rotated copies; cross-fade to it at speed.
- Areas painted flat magenta: un-mix the fringe instead of thresholding.

```python
mag = np.clip((np.minimum(r, b) - g - 60) / 140, 0, 1)   # 1 = pure magenta
alpha = 1 - mag
fg = (rgb - (1 - alpha)[..., None] * [255, 0, 255]) / np.maximum(alpha, .05)[..., None]
```

  Put the replacement (a sky, a runway) behind the keyed image. Mirror a background side by side so it tiles seamlessly when it scrolls.

## Vector linkages

Compute every joint from the control value, then place parts on the joints. For a scissor lift: one end of each arm is pinned, the other rolls on a track; arm angle `th = asin(H / L)`, sliding end `x = xF + L cos(th)`; the ram runs from a pin on the chassis to a pin at a fixed fraction of the arm's length. Wheels and rods follow the same idea: a crank pin at `C + r(cos θ, sin θ)`, a slider at `Cx + r cos θ + sqrt(L² - (r sin θ)²)`, and a coupling rod translated (never rotated) between pins that share one angle. Draw pins and wheels at the computed points so a mis-attachment is visible. Then screenshot the minimum, middle and maximum positions and check that every pin lands on both parts it joins.

## Watercolour flows

- Pre-render a few "dab" sprites per colour on 64px canvases: a wobbly blob, a light blur, a darker edge stroke, and granulation punched out with `destination-out` specks.
- A flow is particles moving along a polyline. Draw each particle as a short brush stroke of three trailing dabs, fading in and out at the path ends, with colour ramped along the path (cool blue air to hot orange gas).
- Composite with `multiply` and keep alpha low (about 0.5 for the leading dab). The first engine page's blue air was opaque enough to hide the painting; watercolour should be see-through.
- Tie speed and density to the control so the child sees cause and effect.

## Ink arrows, spotlight, callouts

- An arrow is an SVG path drawn by animating `stroke-dashoffset` (about 900 ms), over a wider paper-coloured halo stroke so it reads on busy art, with a turbulence displacement filter for a hand-inked wobble. The head appears as the line arrives.
- The step spotlight is a veil (opacity about 0.5) with soft elliptical holes (a blurred mask) over the parts that step is about. Holes and numbered callouts follow moving parts.
- Selecting a step plays a short demo: the page moves the control itself, the way a teacher would show it.

## Controls

- Paint the lever, wheel or knob, but back it with a native control (`input type=range` or buttons) for keyboard and screen readers. Make touch targets large.
- Things in the world respond with physical delay: `v += (target - v) * (1 - Math.exp(-rate * dt))` for engines spooling up and heaters warming; a constant-rate limit for slow hydraulics. Springy controls (a steering wheel, a tiller) return to centre when released.
- A live status sentence (`aria-live`) says what is happening in words ("The box floor is 4.1 m up").
- Grabbing a control yourself clears the step spotlight so the whole picture is visible.
- When the page uses arrow keys for steps, let them through to a focused control.
- A second small live diagram (a plan view, a pedal inset) can show what the control moves elsewhere. Check it does not collapse on phones.
