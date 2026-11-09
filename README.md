# The Henschel Wish Book

A public, magazine-style Christmas wish list for Alex, Maggie, Averie and Zach.

- **The page** (`index.html` + `images/`) is a static site hosted on GitHub Pages. Anyone with the link can open it; no accounts needed.
- **The data** lives in the private Google Sheet "Henschel Wish Book" in Alex's Drive. Edit gifts and sizes there; the page picks up changes on its next refresh.
- **Purchases**: "I bought this" sends the item to the Sheet's private Purchases tab. The public page only learns that an item was bought, so it hides it. Buyer names and prices stay in the Sheet.
- **Prices** are refreshed every morning by a scheduled Claude task that writes to the Sheet's gray columns.

## Connecting the page to the Sheet

1. Open the Sheet, then **Extensions > Apps Script**.
2. Replace everything in `Code.gs` with the contents of `apps-script/Code.gs`, then save.
3. **Deploy > New deployment**, type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy** and authorize.
4. Copy the **Web app URL** (ends in `/exec`) and paste it into the `wishbook-api` tag near the top of `index.html`.

If you later change `Code.gs`, use **Deploy > Manage deployments > Edit > New version** so the URL stays the same.
