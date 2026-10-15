---
name: sell-my-stuff
description: Use when a user wants to sell, declutter, or get rid of things they own by listing them online, or hands over photos of items to sell on Facebook Marketplace, Craigslist, eBay, Vinted, Bazoš, Kleinanzeigen, OLX, Leboncoin, Gumtree, OfferUp, or another second-hand marketplace.
---

# Sell My Stuff

## Overview

Turn a folder of messy photos into priced, approved, posted listings. Do almost all of the work alone: group photos into items, identify them, research prices, write the copy, and choose lead photos. The user does three things: points you at the photos, edits prices on one small review page, and handles logins. Nothing is published before they approve.

## Load the judgment

- Read `references/pricing.md` before setting any price.
- Read `references/marketplaces.md` when researching prices, suggesting where to post, and filling a marketplace form.
- Read `references/posting.md` before opening a browser to post.
- `references/listings-format.md` defines `listings.json`, the single source of truth for every step.

## Workflow

1. **Ask once, then work.** If the user has not said, ask in one message where the photos are and which city they sell from. The city sets currency, language, and marketplaces. If they already told you, just start. Ask nothing else until the review page is ready.
2. **Inventory the photos.** Create a `sell-my-stuff/` work folder inside the photo folder and ignore it when listing photos. List every other image, including subfolders. Convert HEIC or other unsupported formats to JPEG copies in the work folder; never modify originals. Above about 20 photos, build a contact sheet first. Group photos into items by looking at them, not by filename alone. One photo can show several items; a bundle can be one listing.
3. **Identify each item.** Brand, model, size, variant, material, included accessories, visible condition and defects. Crop and enlarge labels, serial plates, and brand marks before deciding. If identity is still uncertain, research the likely candidates and say so in `notes`. Never invent specs you cannot see or verify.
4. **Pick the photos.** Order each item's photos: clearest full view first, then details, labels, and defects. Drop blurry duplicates. Leave out photos where a person is recognizable or documents, addresses, house numbers, or screens with personal data are readable; crop a copy instead when the rest of the photo is useful. Record left-out photos in `excludedPhotos`.
5. **Price it.** Follow `references/pricing.md`. Record the evidence you used.
6. **Write the copy.** Short, search-heavy title with the most important terms first. Plain, honest description: what it is, size or model, condition with flaws, what's included, pickup or shipping. No hype. Listing text uses the main language of the user's city unless they ask otherwise; `notes` and `priceReason` use the language you speak with the user. Write around unknown details instead of leaving placeholders. When a missing detail is a key search term (frame size, storage size, clothing size), ask for it in `notes` and keep the best title you can without it. Every listing must be postable as written.
7. **Open the review page.** Write `listings.json`, then start `node <skill-dir>/scripts/review.mjs <work-folder>/listings.json` in the background and read the URL it prints. Put at most one or two questions per item in `notes`, only ones that change the price or whether it can be listed. Then tell the user, in their language: how many items you found, the total asking value, the URL, that prices, titles, and descriptions are editable and save automatically, that they can untick anything they want to keep, and to answer the notes and say "done" in chat when finished. If `node` is unavailable, write `review.md` with the same table and ask for prices in chat.
8. **Apply the review.** When the user says they are done, re-read `listings.json`. Their edits are the truth; never overwrite `suggestedPrice`. Apply their answers to the notes: update copy, and change `price` only if an answer changes the value, then tell them. Set `status` to `approved` for included items and `skipped` for unticked ones. Stop the review server.
9. **Ask the posting questions in one message.** Which marketplaces (suggest the ones that fit their city and items, see `references/marketplaces.md`); publish each listing or stop on the final screen for them; pickup area or postcode; whether to offer shipping; and any contact details the chosen sites require. Include any item whose `price` is `null`.
10. **Post.** Follow `references/posting.md`: visible browser, user logs in, one listing at a time, no paid boosts, verify every photo uploaded. After each post, record the public URL in `listings.json`.
11. **Hand over.** Summarize what was posted where, with links, the total asking value, anything skipped and why, and how to mark items sold later. Keep `listings.json` so a later run can repost, reprice, or delete listings.

## Rules

- Never publish, message buyers, accept offers, or pay for promotion without explicit approval in the current conversation.
- The user handles passwords, SMS codes, CAPTCHAs, and identity checks. Never ask them to paste a password into chat.
- Be honest about condition. Hidden flaws cost more in returns and bad reviews than a lower price.
- Keep personal contact details out of listing text unless the user asks for them there.
- Do not list items the marketplace prohibits (weapons, medicines, counterfeit goods, recalled items, and so on). Tell the user instead.
- If one item is blocked, keep going with the rest and report it at the end.
- If the user goes quiet with the review page open, leave the server running until the end of the session, then stop it and tell them how to restart it.

## Stop conditions

Stop and say exactly what is missing when the photo folder is empty or unreadable, when you cannot tell what an item is even after research, when a marketplace demands verification only the user can do, or when a form changes in a way you cannot complete safely. Never pretend a listing is live without having opened its public URL.
