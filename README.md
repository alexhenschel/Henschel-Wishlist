# The Henschel Wish Book

A public, magazine-style Christmas wish list for Alex, Maggie, Averie, Zach and the household.

## How the system fits together

The Google Sheet **"Henschel Wish Book"** is the single source of truth. Everything else reads from it or writes to it.

| Piece | What it does | Reads | Writes |
|---|---|---|---|
| **This site** (`index.html`, GitHub Pages) | Catalog, Inspo corner per person, "Add a wish" uploader, "I bought this" | Items, People, Sizes, Profiles (rows ticked "Show on site"), Settings | Inbox, Profiles, Purchases (through Apps Script) |
| **Apps Script** (`apps-script/Code.gs`, inside the Sheet) | The site's back end | the whole Sheet | Inbox, Profiles, Purchases, the Drive folder "Wish Book Inbox" |
| **Daily price check** (scheduled Claude task, 5:37am ET) | Turns Inbox rows into Items, prices every item, flags clashes with Profiles | Items, Inbox, Profiles, Sizes, Purchases | Items (gray columns + new rows), Inbox status, Settings |
| **Shopping Scout** (claude.ai page) | Swipe deck of new ideas built from Profiles | Profiles (copied in by Claude) | Loved cards go to the Inbox |
| **Claude in chat** (`wish-book` skill) | Adds wishes, preferences and sizes on request | the Sheet | the Sheet |

## Sheet tabs

- **Inbox**: anything added from the site. Status: New → Added / Needs info / Skipped.
- **Items**: green columns are yours; gray columns (Price onward) belong to the daily check.
- **Profiles**: Person, Type, Value, Show on site. Types: Needs, Loves, Style, Colors, Avoid colors, Brands, Stores, Avoid, Allergies, Already owns, Notes.
- **People**, **Sizes**: section headlines and sizes.
- **Purchases**: private log. Tick Restored to put an item back.
- **Settings**: `max_price` (items at or above it are hidden from the public site), `inbox_folder`, last price check.

## Connecting the page to the Sheet

1. Open the Sheet, then **Extensions > Apps Script**.
2. Replace everything in `Code.gs` with the contents of `apps-script/Code.gs`, then save.
3. **Project Settings > Script properties > Add script property**: `FAMILY_CODE` = the passcode family will use to add wishes and preferences. Without it, adding from the site stays off. Add `OWNER_CODE` too (Alex and Maggie only): it unlocks **Manage list** in the site's footer, where you can remove items. Removed items move to a **Removed** tab in the Sheet and can be undone.
4. **Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy.** Approve the new Google Drive permission (screenshots are saved to your Drive). The web app URL stays the same.

First-time setup only: **Deploy > New deployment**, type **Web app**, Execute as **Me**, access **Anyone**, then paste the `/exec` URL into the `wishbook-api` tag near the top of `index.html`.
