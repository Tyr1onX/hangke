"""Refresh the bundled OurAirports selection using only the Python standard library."""
import csv
import io
import json
import math
from pathlib import Path
from urllib.request import urlopen

URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"

def main():
    with urlopen(URL, timeout=90) as response:
        rows = csv.DictReader(io.StringIO(response.read().decode("utf-8-sig")))
    airports = {}
    for row in rows:
        iata = row["iata_code"].strip().upper()
        if len(iata) != 3 or row["scheduled_service"] != "yes" or row["type"] not in ("large_airport", "medium_airport", "small_airport"):
            continue
        try:
            lat, lon = float(row["latitude_deg"]), float(row["longitude_deg"])
        except ValueError:
            continue
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        if iata in airports:
            raise ValueError(f"Duplicate IATA: {iata}; review upstream data")
        airports[iata] = dict(ident=row["ident"], iata=iata, name=row["name"], city=row["municipality"], country=row["iso_country"], latitude=lat, longitude=lon)
    if len(airports) < 1000 or not {"CGQ", "HND"} <= airports.keys():
        raise ValueError("Incomplete airport dataset")
    target = Path(__file__).resolve().parents[1] / "src/data/airports.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(sorted(airports.values(), key=lambda a: a["iata"]), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(target)
    print(f"Updated {len(airports)} airports")

if __name__ == "__main__":
    main()
