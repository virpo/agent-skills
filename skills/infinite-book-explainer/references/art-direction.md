# Art direction

## Calling the image model

Keep one prompt file per image and pass it verbatim. With the Codex CLI:

```bash
# generate (optionally with a style reference)
echo "Use your built-in image generation tool exactly once to generate an image from the prompt in art/prompts/plate.txt (pass the file contents as the image prompt, verbatim). Size: 16:9 landscape at the highest available resolution. Then copy the resulting PNG file to art/plate-a.png. Do nothing else. Print the final file path and pixel dimensions." \
  | codex exec --skip-git-repo-check -s workspace-write [-i art/plate.png]

# edit: the attached image is Image 1, the image being changed
echo "Use your built-in image generation tool exactly once, in IMAGE-EDIT mode with the attached image as Image 1 (the image to edit), passing the contents of art/book/prompts/cockpit-base.txt verbatim as the prompt. Size: same aspect as the input, highest available resolution. Then copy the resulting PNG file to art/book/cockpit-base.png. Do nothing else." \
  | codex exec --skip-git-repo-check -s workspace-write -i art/detail/cockpit.png
```

When a reference is attached to a fresh generation, say what it is for: "The attached image is a STYLE REFERENCE ONLY (ink and watercolour treatment, palette, level of detail, livery); follow the written prompt for composition and content." Run batches of about five in parallel in the background and inspect results while the next batch renders.

Expect roughly 1.5 megapixels per image whatever size you ask for: the reference plate came back at 1672 x 941 for a 16:9 request, and close-ups and diagrams at about 1448 x 1086 or 1536 x 1024. That ceiling is why deeper levels are repaints rather than crops. Read the real size of every result and store coordinates in those pixels.

## Plate template

```text
You are a historical illustrator, [engineer for the domain] and technical draftsman specializing in illustrated encyclopedias for children.

Subject: [specific subject, model/type, era, setting, what is happening]. [Neutral livery.] NO brand names, NO logos, NO registration or serial text.

Generate one vast illustrated encyclopedic plate: the whole [subject] seen from its [LEFT] side, [front] pointing to the [LEFT], viewed from slightly in front and slightly above (about 15-20 degrees). Large portions of the outer skin are cut away to reveal everything inside, in the style of a classic cutaway drawing.

ARTISTIC DIRECTION
- Aesthetic of the great illustrated children's encyclopedias of the 1980s-1990s (Dorling Kindersley "Incredible Cross-Sections", Stephen Biesty style).
- Extremely detailed fine ink linework and traditional watercolor washes. Warm natural colors on slightly ivory paper.
- Precise engineering lines, realistic materials: [list].
- No 3D render, no cartoon, no photographic look. Educational, elegant, timeless.

WHAT MUST BE VISIBLE (technically correct for [type])
- [One bullet per zone, front to back, naming every part you will make clickable.]
- [Every fact the model gets wrong, stated as a count and a position: "EXACTLY FOUR IN TOTAL: the near side carries exactly TWO, clearly separated, the inboard one about one third of the way out, the outboard one about two thirds of the way out".]
- Dozens of tiny people to scale doing realistic things, where the subject allows.

COMPOSITION
- Wide 16:9 landscape plate. The whole subject fits comfortably INSIDE the frame, about 80% of the width, centered, with calm empty ivory paper margins on all sides (about 8% left and right, 14% top, 10% bottom). These margins stay completely empty for annotations added later. The ground fades softly into the paper with an irregular watercolor edge, not a hard rectangle.
- Keep [tall foreground objects] low and small so they never hide [important parts].
- ABSOLUTELY NO TEXT anywhere: no letters, labels, numbers, annotation lines, title or signage text. Pure illustration only.
- Rich but perfectly organized, many small details to explore for minutes.
```

The viral version of this prompt asks the model to draw its own annotations. Do not: painted text is gibberish, and the margins are needed for real, clickable labels.

## Close-up template

```text
Same artist and same book as the attached plate: a close-up cut-away vignette for a children's illustrated encyclopedia of the 1980s-1990s. [Same style sentence as the plate.]

The [subject] is the same [livery] as in the attached plate. Technically accurate for [type].

SUBJECT: [one part, what is cut away, the exact counts and positions, a person for scale].

COMPOSITION: 4:3 landscape. The subject is large and fills most of the picture. The edges fade organically into plain ivory paper, like a vignette in a book, never a hard rectangle or frame.
ABSOLUTELY NO TEXT: no letters, words, labels, numbers, logos, placards or annotation lines anywhere.
```

Tight subjects fail less than wide ones. When a close-up gets geometry wrong, crop the subject tighter rather than adding more words.

## Diagram templates for "how it works" pages

Open with a shared style block: "A page illustration from a classic 1980s-1990s children's 'how things work' encyclopedia of machines: precise fine pen-and-ink linework with transparent traditional watercolor washes on warm ivory paper, a clear explanatory cross-section diagram, friendly but technically accurate…" plus the no-text line, which here also forbids arrows.

- **Base diagram:** "drawn as an exact ORTHOGRAPHIC SIDE SECTION (pure side elevation, no perspective at all)". Fix the layout in numbers: axis horizontal through the exact vertical centre, spans 86% of the width. Paint it **switched off**: "no flame, no glow, no fire, no airflow lines, no smoke, no heat". Ask for **empty channels** where animated air, belts or loads will travel ("the bypass duct, an EMPTY smooth channel"; "the belt is completely EMPTY"). Leave out anything that will move ("NO box, NO scissor arms").
- **Parts sheet:** the moving pieces "in exact side view, all at the same scale", "in a neat grid with wide empty paper gaps between them; no item touches another or the edge. No shadows." Flat views (face-on, from above) for anything that will rotate.
- **Background:** "The painting fills the whole frame edge to edge, with NO paper margins", horizon "perfectly level, crossing the EXACT middle", plus "show ONLY the landscape and sky. NO window frames, NO vehicle parts anywhere." Without that last line a cockpit frame got painted into the landscape.
- **Edit to free the moving parts:** "EDIT THIS EXACT IMAGE, keeping the same framing, perspective, style, colours and every other detail, with ONLY these changes:" then a numbered list: remove the levers and wheels and show what was behind them, rest the people's hands away from controls, and "Fill EVERY window pane with ONE perfectly flat, uniform pure magenta colour (#FF00FF), edge to edge, with no texture, gradient, scenery or reflections" for areas the code will replace.
- **Correction edit:** say what is wrong and why, then the fix and what must stay. For example, pilots drawn one behind the other: "That is wrong: in this aircraft the two pilots sit SIDE BY SIDE… the empty space becomes an observer's seat and the rear wall. Do not move, add or remove anything else."

## Accepting an image

1. Generate three variants of the plate; close-ups and diagrams get one attempt each and are regenerated when they fail. The first single attempt had the engines bunched at one wing root, no winglets and cropped edges.
2. Look at a contact sheet only to shortlist. Then open full-size crops of every zone with `scripts/grid.py` and check against the fact list:
   - counts: engines, wheels, blades, seats per row, windows, people at controls;
   - placement and spacing: things evenly spread versus bunched, both sides symmetric where they should be;
   - orientation: vehicles facing the right way, intakes forward, seats facing forward;
   - human logic: seating side by side or in tandem, people standing on floors;
   - text-like marks, hard rectangular edges, cropped subjects, empty margins actually empty.
3. Reject and regenerate rather than explaining an error away. Errors seen in one airliner run: a 9-across seat row instead of 3-4-3, a fuel truck drawn backwards, overlapping wings in a wing close-up, engines too close to the root, pilots in tandem like a fighter jet, a cockpit frame in a landscape.
4. Move rejects to `rejected/` and keep the prompt that produced the keeper.

## Moderation false positives

Benign technical prompts are sometimes blocked (a plain fuselage panel, cockpit windows). Reword the area description with concrete neutral nouns ("the smooth white upper body panels above the passenger cabin, with frames and stringers visible") and retry once or twice. Do not argue with the filter or weaken the technical constraints. If a model refuses named illustrators or publishers, drop the names and keep the style description, which carries most of the look.
