#!/usr/bin/env python3
"""Live fares from Google Flights for the routes in data/flights.json.

    pip install fast-flights
    python tools/flights-google.py --out out/flights-google.json

Google Flights asks the airlines directly (Wizz Air included), so this is as
close to a live Wizz fare as an unattended job can get. fast-flights fetches
the results page with a browser-like client and parses it; no API key.
Output: { generated_at, routes: { <id>: { price, currency, airlines, legs,
         fetched_at, url, error? } } }
"""
import json, sys, time, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
args = sys.argv[1:]
out_file = pathlib.Path(args[args.index("--out") + 1] if "--out" in args else ROOT / "data" / "flights-google.json")
cfg = json.loads((ROOT / "data" / "flights.json").read_text("utf-8"))
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
out = {"generated_at": now, "source": "Google Flights (fast-flights)", "routes": {}}

try:
    from fast_flights import FlightQuery, Passengers, create_query, get_flights
except Exception as e:  # library missing → leave an empty file, the merge step tolerates it
    print(f"flights-google: fast-flights unavailable ({e})")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(out, indent=1))
    sys.exit(0)

WIZZ = ("wizz",)

for route in cfg.get("routes", []):
    rid = route["id"]
    rec = {"fetched_at": now, "currency": (route.get("currency") or "gel").upper()}
    try:
        q = create_query(
            flights=[
                FlightQuery(date=route["depart"], from_airport=route["from"], to_airport=route["to"]),
                FlightQuery(date=route["return"], from_airport=route["to"], to_airport=route["from"]),
            ],
            trip="round-trip",
            seat="economy",
            passengers=Passengers(adults=int(route.get("adults") or 1)),
            language="en",
            currency=rec["currency"],
            max_stops=0 if route.get("direct") else None,
        )
        rec["url"] = q.url()
        results = None
        for attempt in range(3):
            try:
                results = get_flights(q)
                break
            except Exception as e:
                last = e
                time.sleep(4 * (attempt + 1))
        if results is None:
            raise last
        offers = []
        for f in results:
            if not getattr(f, "price", None):
                continue
            legs = [{
                "from": s.from_airport.code, "to": s.to_airport.code,
                "dep": "%04d-%02d-%02dT%02d:%02d" % (*s.departure.date, *s.departure.time),
                "arr": "%04d-%02d-%02dT%02d:%02d" % (*s.arrival.date, *s.arrival.time),
                "duration": s.duration,
            } for s in f.flights]
            offers.append({"price": int(f.price), "airlines": list(f.airlines), "type": f.type, "legs": legs})
        offers.sort(key=lambda o: o["price"])
        wizz_only = [o for o in offers if o["airlines"] and all(any(w in a.lower() for w in WIZZ) for a in o["airlines"])]
        best = (wizz_only or offers)[0] if offers else None
        if best:
            rec.update(best)
            rec["offers"] = offers[:8]
            rec["wizz_direct"] = bool(wizz_only)
            print(f"flights-google: {rid} — {best['price']} {rec['currency']} {'/'.join(best['airlines'])} ({len(offers)} offers)")
        else:
            rec["error"] = "no offers parsed"
            print(f"flights-google: {rid} — no offers")
    except Exception as e:
        rec["error"] = str(e)[:300]
        print(f"flights-google: {rid} failed — {rec['error']}")
    out["routes"][rid] = rec
    time.sleep(2)

out_file.parent.mkdir(parents=True, exist_ok=True)
out_file.write_text(json.dumps(out, indent=1))
print(f"flights-google: {len(out['routes'])} route(s) → {out_file}")
