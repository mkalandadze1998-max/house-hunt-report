# House Hunt · Tbilisi

A static shortlist of apartments for rent in Tbilisi, collected from
[myhome.ge](https://www.myhome.ge/) and published with GitHub Pages.

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `script.js` | The site. Bump `?v=` on the CSS/JS links in `index.html` after editing them so GitHub Pages' cache doesn't serve stale assets. |
| `data/properties.json` | The current snapshot, written by the scraper. `data/properties.js` is the same data for opening `index.html` from disk (`file://`). |
| `data/geo.json` | Fallback coordinates. The live copy is on the `geo-data` branch (see below). |
| `tools/geocode.mjs` | Fetches `lat`/`lng` for listings that have no coordinates yet. |
| `.github/workflows/geocode.yml` | Runs the geocoder after every scrape and publishes to the `geo-data` branch. |

## Coordinates and distance

Cards show the straight-line distance from home. Coordinates come from the
myhome.ge statements API (`lat`/`lng` on each statement). The site loads them
in this order:

1. `lat`/`lng` on the listing itself, if the scraper ever adds them
2. `https://raw.githubusercontent.com/<owner>/<repo>/geo-data/data/geo.json`
3. `data/geo.json` in this branch

The GitHub Action keeps (2) current automatically. To refresh locally:

```
node tools/geocode.mjs            # only new listings
node tools/geocode.mjs --force    # everything
```

## Browser-side state

Favorites, hidden listings, the compare set, filters and locally observed
price history live in `localStorage`. Use **⇄ Sync** in the header to move
them to another device (link or JSON backup).

## Recovery

If the page says "Saved data unavailable", make sure the `data` folder sits
next to `index.html` and that `data/properties.json` is valid JSON.
