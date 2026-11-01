# Ship and capture

## Build

- One HTML page with the scripts inlined, plus an `assets/` folder: the plate at 2x, panel close-ups at about 1200px, tiles at 1536 x 1024, book art and cut pieces, all WebP.
- Keep exact prompts, rejected images and alignment scores in the source tree, not in the published folder.

## One look in every theme

Commit to the paper. A dark-mode "gallery wall" behind the painting looked wrong on a computer set to dark mode; the fix was ivory paper in every theme. Set `color-scheme: light` and an explicit paper background, and test with the browser emulating dark mode.

## No blinking

Loading images only when the camera reached them made tiles and panel pictures blink in. What fixed it:

- Once the plate has painted, prefetch every image in the background, nearest-first: level-2 tiles, panel close-ups, book art, then level-3 tiles. Run about six workers, call `decode()` on each, and keep references to the decoded images so the browser does not drop them.
- Swap a panel image only after the new one's `decode()` resolves, so the old picture stays until the new one is ready.
- Measure it over the real network. The reference build downloaded about 20 MB this way in under 10 s; say so, because it matters on mobile data.

## Deploy as a static site

Only with explicit authorization. With Netlify's API:

1. Zip `index.html`, `assets/` and a `_headers` file with long cache lifetimes for assets.
2. Create the site once, persist its ID locally, and refuse to deploy if the fetched site's ID or name does not match.
3. `POST /api/v1/sites/{site_id}/deploys` with `Content-Type: application/zip` and the zip as the body.
4. For a custom subdomain, the user adds a CNAME from the subdomain to `<site-name>.netlify.app` at their DNS provider.
5. After the name resolves, `POST /api/v1/sites/{site_id}/ssl`. A 422 right after the DNS change usually means the check has not caught up; retry every minute or so. When the certificate is issued, `PATCH /api/v1/sites/{site_id}` with `{"force_ssl": true}` and confirm plain HTTP redirects.

Read the token from the CLI's credential store, never print it, and run the browser checks again against the live URL.

## Frame-exact video

Screen recording drops frames. Capture the real app frame by frame instead:

1. Add a video mode to the page (a query parameter) that hides hints, fixes random seeds and exposes live values (thrust, speed, which bag landed) on a global for sound sync.
2. Inject `scripts/virtual-clock.js` before any page script (Playwright `context.addInitScript({ path })`). It replaces `setTimeout`, `setInterval`, `requestAnimationFrame`, `performance.now`, `Date.now` and `Math.random`, and pins CSS animations and transitions to virtual time. Call `window.__clock.advance(ms)` once per frame.
3. Use a desktop viewport (1920 x 1200 at device scale 1.5) and frame a square or vertical crop afterwards. A square 1080 x 1080 viewport switched the book to its phone layout and pushed the controls off-screen, so scripted drags missed.
4. Preload every image before the first frame.
5. Capture each frame with CDP `Page.captureScreenshot` and an explicit `clip: { x: 0, y: 0, width, height, scale }`. Without the clip, frames came back smaller than the viewport and cropped.
6. Capture at 120 fps and average each pair of frames into 60 fps output for natural motion blur.
7. Move the cursor on eased paths of 350–500 ms with a slight overshoot; log every click and event time so each sound can be placed on the exact frame its event starts, and drive pitch or volume from the logged live values.

For a short social clip: motion in frame 0, the first click by about 0.3 s, captions that tell the story with sound off, every sound tied to something visible on that frame, and a last frame that matches the first so the loop is seamless. Use recorded sounds with a licence you have checked.
