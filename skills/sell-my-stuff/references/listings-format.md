# listings.json

One file holds the whole run. The review page reads and writes it; posting reads it; later runs pick up from it. Keep it in the `sell-my-stuff/` work folder inside the photo folder, never inside the skill folder.

```json
{
  "version": 1,
  "photosDir": "/absolute/path/to/photos",
  "city": "Lyon",
  "currency": "EUR",
  "language": "fr",
  "items": [
    {
      "id": "armchair",
      "title": "Fauteuil IKEA Poäng bouleau, coussin beige",
      "description": "Fauteuil IKEA Poäng, structure bouleau, coussin beige déhoussable. ...",
      "category": "Furniture > Armchairs",
      "condition": "good",
      "conditionNote": "Light marks on one armrest, cushion recently washed",
      "photos": ["photo-07.jpg", "photo-08.jpg", "sell-my-stuff/converted/photo-09.jpg"],
      "excludedPhotos": [{ "photo": "photo-10.jpg", "reason": "neighbour visible in the window" }],
      "suggestedPrice": 45,
      "price": 45,
      "priceRange": { "low": 35, "high": 70 },
      "priceReason": "Same model and colour asks 40 to 70 nearby; ours has marks, so the lower half.",
      "evidence": [
        { "source": "leboncoin.fr", "title": "Fauteuil Poäng bouleau", "price": 50, "url": "https://...", "match": "exact" }
      ],
      "notes": "Does the cushion cover come off for washing?",
      "include": true,
      "status": "draft",
      "posts": []
    }
  ],
  "review": { "done": false }
}
```

## Fields

- `photosDir`: the photo folder the review page serves images from. `photos` entries are paths relative to it, so converted or cropped copies live under `sell-my-stuff/`.
- `photos`: lead photo first. The review page shows them in this order.
- `excludedPhotos`: photos left out for privacy or quality, with a short reason.
- `category`: plain words, not tied to one marketplace. Map it to the site's category tree when posting.
- `condition`: one of `new`, `like new`, `good`, `fair`, `for parts`. Map it to the site's fixed choices when posting. `conditionNote` holds the specifics.
- `suggestedPrice`: your proposal. Never overwrite it after review.
- `price`: the price to post. Starts equal to `suggestedPrice`; the user's edits land here. `null` means the user cleared it; ask before posting that item.
- `priceRange`, `priceReason`, `evidence`: shown under "Why this price". `match` is `exact`, `close`, or `weak`. Record asking prices as asking prices, not as sold prices. Use `price: null` in evidence for a reference you could not confirm a number for.
- `notes`: at most one or two questions or warnings for the user, shown in orange on the review page. Empty when there is nothing to say.
- `include`: `false` means the user wants to keep it for now. Set its `status` to `skipped`.
- `status`: `draft`, `approved`, `skipped`, `posted`, `sold`, or `expired`.
- `posts`: one entry per marketplace: `{ "marketplace": "leboncoin", "url": "https://...", "price": 45, "postedAt": "2026-10-15" }`.
- `review.done`: set by the "I'm done" button, with `doneAt`. The user saying "done" in chat counts the same.

The review server only lets the page change `price`, `title`, `description`, and `include`. Everything else is yours to maintain.
