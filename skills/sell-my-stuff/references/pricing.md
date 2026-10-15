# Pricing

The goal is a price that sells within a couple of weeks without leaving obvious money on the table. Most people want the stuff gone; assume that unless the user says otherwise.

## Research

1. Search the marketplaces the user is likely to post on first, in the local language and currency. `references/marketplaces.md` lists search URLs. Search the exact brand and model, then variants: with and without accents, abbreviations, local words for the item type.
2. Add one wider source when local results are thin: eBay sold listings, a national price comparison site for the new price, or the manufacturer's current price. If a site blocks automated access, move on to another source rather than retrying.
3. Collect three to eight comparables per substantial item. Keep the URL, title, price, and how close the match is.

## Judge the evidence

- Asking prices are not sale prices. Many listings sit unsold for months, so the lower half of a crowded market is closer to reality.
- `exact`: same model, size, and similar condition. `close`: same type and tier, different model, year, or unknown size. `weak`: same category only, a bundle, broken, or modified.
- Discount for wear, missing parts, missing box, older generations, and awkward pickup (large furniture, upper floors without a lift).
- Add value for original packaging, receipts, accessories, and a remaining warranty.
- If you can find the new price, a typical used price is 30 to 60 percent of it for electronics and furniture, higher for premium sports gear and instruments in good condition, lower for anything trendy or fast-moving.

## Set the number

- **Exact comparables:** slightly under their middle.
- **Only close comparables:** start from their middle, adjust for each known difference, and widen `priceRange`.
- **Only weak comparables:** anchor on the new price and the percentages above, and say so in `notes`.
- Recognizable brands: price against the most likely model rather than the generic category. An unconfirmed model is a reason to widen the range, not to drop to the cheapest listing. When this conflicts with the lower-half rule, use the lower half of the brand's own listings.
- Leave a little room for negotiation where haggling is normal.
- Prefer local price endings people search and scan for (289, 49, 15) over arbitrary numbers.
- Low-value items (under about 10 in local currency): price quickly, suggest bundling with similar items, or suggest giving away for pickup. Do not spend long researching them.

## Write it down

Fill `suggestedPrice`, `price`, `priceRange`, a one-sentence `priceReason`, and `evidence` for every item. The user should be able to judge each price in five seconds from the review page.
