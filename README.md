# House Hunt · Tbilisi

A static shortlist of apartments for rent in Tbilisi, collected from
[myhome.ge](https://www.myhome.ge/) (external scraper), [ss.ge](https://home.ss.ge/) and
[korter.ge](https://korter.ge/) (GitHub Action), published with GitHub Pages.

## Branches

| Branch | Who writes it | What's there |
|---|---|---|
| `main` (default, GitHub Pages) | you / Claude, plus the scraper for two files | The site, tools, workflow. The myhome.ge scraper ([house-hunt](https://github.com/mkalandadze1998-max/house-hunt)) publishes **only** `data/properties.json` and `data/properties.js` here. |
| `geo-data` | the GitHub Action | `ss.json`, `korter.json`, `geo.json`, `commute.json`, `history.json`. |

The page reads `properties.json` locally (and from `main` over raw.githubusercontent.com when
previewing elsewhere) and the rest from `geo-data`.

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `script.js` | The site. Bump `?v=` on the CSS/JS links in `index.html` after editing them so GitHub Pages' cache doesn't serve stale assets. |
| `data/properties.json` | The current snapshot, written by the scraper. `data/properties.js` is the same data for opening `index.html` from disk (`file://`); it is only loaded in that case. `requirements.excluded_locations` in the snapshot is the source of truth for excluded sub-districts (site, ss.ge collector and alerts all read it). |
| `data/geo.json` | Fallback coordinates. The live copy is on the `geo-data` branch (see below). |
| `data/ss.json` | ss.ge listings in the same schema (fallback; live copy on `geo-data`). Merged with myhome listings on the page; duplicates by location + size + rooms + floor are collapsed with an "Also on …" link, and same-source re-posts (same place + address under a new id) fold into the newest copy with a "Re-posted ×N" pill. |
| `tools/collect-ss.mjs` | Collects long-term rentals from ss.ge for the target districts (search API + detail pages). |
| `tools/collect-korter.mjs` | Collects long-term rentals from korter.ge (server-rendered `INITIAL_STATE` on listing + detail pages; USD prices converted at korter's rate). |
| `tools/commute.mjs`, `data/commute.json` | Driving minutes from home per listing via the public OSRM router (OpenStreetMap); cached, only new listings are routed. Shown on cards (🚗) and as a sort. |
| `tools/flights.mjs`, `tools/flights-google.py`, `data/flights.json` | ✈ Flight price tracker: the routes/dates in `data/flights.json` are checked every run — the live fare from Google Flights (which asks Wizz Air directly; `fast-flights`) is the headline price, the Travelpayouts (Aviasales) data API is the fallback and supplies the cheaper-nearby-dates table — price history, published as `flights.json` on `geo-data`, shown in the "✈ Flights" tab and in the Telegram digest when the fare changes. Needs the `TRAVELPAYOUTS_TOKEN` secret (free token from app.travelpayouts.com → Profile → API token). |
| `data/excluded.json` | Published by the scraper: myhome.ge listings its screening dropped in the last 14 days, with reasons — the site's "Why excluded?" tab. |
| `data/history.json` | Fallback price history. The live copy is on the `geo-data` branch. |
| `tools/alerts.mjs`, `data/alerts.json` | Telegram digest after each run: new listings, price drops/rises, listings gone. Needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` repo secrets; `alerts.json` holds exclusions/thresholds. With the `HH_PASSWORD` secret (the site password) it also reads the shared favorites and puts their price drops / rises / disappearances in a ♥ section at the top. |
| `tools/history.mjs` | Appends each listing's price to `history.json` when it changes; records first/last seen. |
| `tools/geocode.mjs` | Fetches `lat`/`lng` for listings that have no coordinates yet. |
| `.github/workflows/geocode.yml` | Runs the geocoder after every scrape and publishes to the `geo-data` branch. |

## Coordinates and distance

Cards show the straight-line distance from home. Coordinates come from the
myhome.ge statements API (`lat`/`lng` on each statement). The site loads them
in this order:

1. `lat`/`lng` on the listing itself, if the scraper ever adds them
2. `https://raw.githubusercontent.com/<owner>/<repo>/geo-data/data/geo.json`
3. `data/geo.json` in this branch

The GitHub Action keeps (2) current automatically.

## Price history

`history.json` holds `{first_seen, last_seen, prices:[{at, price}]}` per listing.
The Action appends a price point whenever a snapshot shows a different price,
so cards can show ↓/↑ markers, days on market and price cuts on every device.
Records also keep lat/lng, rooms, floor and address so `alerts.mjs` recognises a re-posted flat. To refresh coordinates locally:

```
node tools/geocode.mjs            # only new listings
node tools/geocode.mjs --force    # everything
```

## Login and shared state (Supabase)

The site is gated by a password screen. The password signs in to the default
Supabase Auth user (`mariami@house-hunt.local`; sign-ups are disabled in the
dashboard; a second user `aslani@house-hunt.local` exists but is unused and can be deleted). After signing in, the header switch sets who is using the site
(Mariami by default, or Aslani); the choice is remembered per device and
stamped on every change.

Favorites, hidden listings, the compare set and per-listing notes live in the
`public.shortlist` table and sync live between devices (Supabase Realtime).
Row-level security allows access only to signed-in users. `cloud.js` holds the
project URL and the *publishable* key (safe to embed). Filters and the chosen
identity stay in `localStorage`. Each tab re-reads the table when it becomes
visible, so changes missed while a device slept are picked up without a reload.
The library loads from jsDelivr with unpkg as a fallback.

Note: the listing data itself is in this public repository; the login protects
the interface and the shared shortlist, not the raw JSON.

## Recovery

If the page says "Saved data unavailable", make sure the `data` folder sits
next to `index.html` and that `data/properties.json` is valid JSON.
