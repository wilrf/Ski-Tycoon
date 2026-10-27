"""Ranks candidate peaks in each range by 12 months of English Wikipedia pageviews and keeps the top 3.

Candidates are the well-known summits inside each range type as defined in zones.py. Fame is measured, not judged:
the pageview count decides the order. Coordinates come from Wikipedia, not from memory.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "ski-tycoon-terrain/0.1 (https://github.com/wilrf/ski-tycoon)"}
WINDOW = ("20251001", "20260930")
RESULTS = Path(__file__).parent / "results"

CANDIDATES: dict[str, list[str]] = {
    "alps": ["Matterhorn", "Mont Blanc", "Eiger", "Jungfrau", "Zugspitze", "Monte Rosa", "Grossglockner", "Mönch",
             "Piz Bernina", "Weisshorn", "Grandes Jorasses", "Aiguille du Midi", "Dent Blanche"],
    "rockies": ["Pikes Peak", "Longs Peak", "Maroon Bells", "Mount Elbert", "Mount Blue Sky", "Capitol Peak (Colorado)",
                "Mount of the Holy Cross", "Mount Sneffels", "Mount Massive", "Crestone Peak"],
    "andes": ["Aconcagua", "Tupungato", "Cerro El Plomo", "Cerro Juncal", "Marmolejo", "San José (volcano)", "Cerro Bonete"],
    "himalayas": ["Mount Everest", "Kangchenjunga", "Lhotse", "Makalu", "Annapurna", "Nanga Parbat", "Ama Dablam",
                  "Cho Oyu", "Dhaulagiri", "Manaslu", "Machapuchare", "Nanda Devi"],
    "cascades": ["Mount Rainier", "Mount St. Helens", "Mount Hood", "Mount Baker", "Mount Shasta", "Mount Adams (Washington)",
                 "Glacier Peak", "Mount Jefferson (Oregon)", "Mount Shuksan"],
    "coast": ["Mount Waddington", "Whistler Mountain", "Blackcomb Peak", "Mount Garibaldi", "The Black Tusk",
              "Wedge Mountain", "Stawamus Chief"],
    "sierra": ["Mount Whitney", "Half Dome", "El Capitan", "Mount Tallac", "Mount Ritter", "Mammoth Mountain",
               "Mount Williamson", "Cathedral Peak (California)", "Mount Lyell (California)", "Clouds Rest"],
    "appalachians": ["Mount Washington (New Hampshire)", "Mount Mitchell", "Clingmans Dome", "Grandfather Mountain",
                     "Mount Katahdin", "Mount Le Conte (Tennessee)", "Mount Rogers", "Spruce Knob", "Mount Mansfield"],
    "japan_alps": ["Mount Hotakadake", "Mount Yari", "Mount Tate", "Mount Shirouma", "Mount Kita", "Mount Ontake",
                   "Mount Norikura", "Mount Tsurugi (Toyama)", "Mount Kashimayari"],
    "hokkaido": ["Mount Yōtei", "Asahi-dake", "Mount Tokachi (Daisetsuzan)", "Mount Rausu", "Mount Rishiri", "Mount Meakan"],
}


def get_json(url: str) -> dict:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(2 + attempt * 3)
    raise RuntimeError("unreachable")


def resolve(titles: list[str]) -> dict[str, dict]:
    """Follows redirects and returns the canonical title and summit coordinates for each candidate."""
    q = urllib.parse.urlencode({"action": "query", "format": "json", "redirects": 1, "prop": "coordinates",
                                "titles": "|".join(titles), "coprimary": "primary", "colimit": "max"})
    data = get_json(f"https://en.wikipedia.org/w/api.php?{q}")["query"]
    canon = {t: t for t in titles}
    for step in ("normalized", "redirects"):
        for m in data.get(step, []):
            for k, v in canon.items():
                if v == m["from"]:
                    canon[k] = m["to"]
    pages = {p["title"]: p for p in data["pages"].values()}
    out = {}
    for asked, title in canon.items():
        page = pages.get(title, {})
        if not page.get("coordinates"):
            print(f"  skip {asked!r}: {'missing' if 'missing' in page else 'no coordinates'}")
            continue
        c = page["coordinates"][0]
        out[asked] = {"title": title, "lat": c["lat"], "lon": c["lon"]}
    return out


def elevations(titles: list[str]) -> dict[str, float]:
    """Summit height in metres from Wikidata (property P2044), keyed by Wikipedia title."""
    q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "pageprops", "ppprop": "wikibase_item", "titles": "|".join(titles)})
    items = {p["title"]: p["pageprops"]["wikibase_item"] for p in get_json(f"https://en.wikipedia.org/w/api.php?{q}")["query"]["pages"].values() if "pageprops" in p}
    q = urllib.parse.urlencode({"action": "wbgetentities", "format": "json", "props": "claims", "ids": "|".join(items.values())})
    entities = get_json(f"https://www.wikidata.org/w/api.php?{q}")["entities"]
    out = {}
    for title, qid in items.items():
        for claim in entities[qid]["claims"].get("P2044", []):
            value = claim["mainsnak"].get("datavalue", {}).get("value")
            if value and claim.get("rank") != "deprecated":
                feet = value["unit"].endswith("Q3710")
                out[title] = round(float(value["amount"]) * (0.3048 if feet else 1.0), 1)
                if claim.get("rank") == "preferred":
                    break
    return out


def pageviews(title: str) -> int:
    path = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{path}/monthly/{WINDOW[0]}/{WINDOW[1]}"
    return sum(i["views"] for i in get_json(url)["items"])


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    ranked: dict[str, list[dict]] = {}
    for key, titles in CANDIDATES.items():
        print(key)
        found = resolve(titles)
        heights = elevations([i["title"] for i in found.values()])
        rows = [{"key": key, **info, "elevationM": heights.get(info["title"]), "views": pageviews(info["title"])} for info in found.values()]
        rows.sort(key=lambda r: -r["views"])
        ranked[key] = rows
        for r in rows:
            print(f"  {r['views']:>9,}  {r['title']}  {r['elevationM']} m")
    (RESULTS / "peak-ranking.json").write_text(json.dumps({"window": WINDOW, "ranges": ranked}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
