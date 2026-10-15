# Posting

## Browser

Use any browser automation that drives a visible browser and can upload local files: a browser-use or Chrome extension, Playwright with a headed persistent profile, `agent-browser --headed --session-name <marketplace>`, or similar. Prefer a persistent session per marketplace so logins survive restarts.

If no browser tool is available, prepare a copy-ready block per listing (title, price, category, description, ordered photo paths) and let the user post by hand.

## Before the first listing

- Open the marketplace and let the user log in. Wait for them to confirm.
- Use the pickup area, shipping choice, contact details, and publish-or-stop answer from the step 9 question. Ask again only if a site needs something new.

## Each listing

1. Open the new-listing form fresh. Do not reuse a half-filled form from a failed attempt.
2. Upload photos in `photos` order. Wait until every upload has finished, then count the previews.
3. Fill title, price, category, condition, description, and location from `listings.json`, using the approved `price`.
4. On the final screen, check: right item, right price, right photo count, category, no group cross-posting, no paid boost.
5. Publish only if the user approved publishing. Otherwise stop on that screen and tell them it is ready.
6. Open the public listing URL. Check the photos and price there. Record the URL, marketplace, price, and date in `posts`, and set `status` to `posted`.

## Pace and safety

- One listing at a time, at least a minute apart on classifieds sites. Batches of five to eight, then a break, if there are many.
- If a site asks for an SMS code, CAPTCHA, or ID check, stop and hand it to the user. Do not retry codes.
- If the site blocks or rate-limits, stop posting there and report it. Do not create new accounts or work around the block.
- Never message buyers or accept offers on the user's behalf unless they explicitly ask in this conversation.

## Later runs

- Mark sold items `sold` with the final price. Help delete the listing.
- Reposting or price drops: edit existing listings where possible instead of deleting and recreating them.
