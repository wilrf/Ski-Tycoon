"""Builds game-ready heightmaps of the top 3 peaks in each range from real elevation data.

Each map is the game's 160 x 160 grid. The summit sits at top centre, the map is turned so the lowest ground faces the
bottom edge (where the game puts the base area), and the bottom strip is eased into a gentle bench for the village.
Everything above that strip is the real terrain, unedited.
"""
from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d, maximum_filter

from dem import offset, read_grid

GRID = 160                 # Matches CONFIG.terrain.size.
SUMMIT_ROW = 0.22          # Summit sits this far down from the top edge.
BASE_LINE = 0.82           # Matches CONFIG.terrain.baseLine.
DEFAULT_WINDOW_M = 6000.0
# Big volcanoes and massifs need room to read as themselves; cliffs need to be close to read as cliffs.
WINDOW_M = {
    "Mount Rainier": 10000, "Mount Shasta": 10000, "Mount Yōtei": 9000, "Mount St. Helens": 8000, "Mount Everest": 8000,
    "Kangchenjunga": 8000, "Aconcagua": 8000, "Pikes Peak": 8000, "Matterhorn": 4500, "El Capitan": 3000, "Half Dome": 3000,
    "Stawamus Chief": 2500,
}
ROOT = Path(__file__).resolve().parents[2]
RESULTS = Path(__file__).parent / "results"


def slug(title: str) -> str:
    ascii_ = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"\(.*?\)", "", ascii_).lower()).strip("-")


def find_summit(lat: float, lon: float, true_m: float | None) -> tuple[float, float, float]:
    """The summit is the highest point within 500 m of Wikipedia's coordinates, unless its height disagrees with the
    recorded one. Then the coordinates are off (they can sit over a kilometre away) or the point is higher ground
    behind a cliff top, so among local high points within 2 km the one whose height best matches the record wins,
    paying 1 m of mismatch per 5 m of distance."""
    half, res = 2000.0, 10.0
    g = read_grid(lat, lon, 2 * half, res_m=res)
    yy, xx = (np.mgrid[:len(g), :len(g)] + 0.5) * res - half
    dist = np.hypot(xx, yy)
    # The highest point near the given coordinates is the summit when its height agrees with the record (ice caps and
    # tree canopy put the data up to ~60 m above it); only when it doesn't, search wider by height.
    r, c = np.unravel_index(np.argmax(np.where(dist <= 500, g, -np.inf)), g.shape)
    if true_m and abs(g[r, c] - true_m) > 60:
        cost = np.where(g == maximum_filter(g, 7), np.abs(g - true_m) + dist / 5, np.inf)
        r, c = np.unravel_index(np.argmin(cost), g.shape)
    la, lo = offset(lat, lon, xx[r, c], -yy[r, c])
    return float(la), float(lo), float(g[r, c])


def grid_centre(lat: float, lon: float, size_m: float, bearing: float) -> tuple[float, float]:
    """Centre that puts the summit exactly on the centre of cell (SUMMIT_ROW * GRID, GRID / 2)."""
    res = size_m / GRID
    x = (GRID // 2 + 0.5) * res - size_m / 2
    y = size_m / 2 - (round(SUMMIT_ROW * GRID) + 0.5) * res
    b = math.radians(bearing)
    east, north = x * math.cos(b) + y * math.sin(b), -x * math.sin(b) + y * math.cos(b)
    la, lo = offset(lat, lon, -east, -north)
    return float(la), float(lo)


def best_bearing(lat: float, lon: float, size_m: float) -> float:
    """The turn whose face straight below the summit drops furthest: the face the eye goes to, and the one you ski."""
    def drop(bearing: float) -> float:
        g = read_grid(*grid_centre(lat, lon, size_m, bearing), size_m, res_m=size_m / 40, bearing_deg=bearing)
        return -math.inf if g is None else float(g.max() - g[16:32, 14:26].mean())
    return max(range(0, 360, 15), key=drop)


def base_bench(h: np.ndarray, cell_m: float) -> np.ndarray:
    """Carries the ground at the 72% line down into the bottom strip at a 4% grade, smoothed across, so the game finds
    flat base ground without a cliff where the real terrain ends."""
    n = len(h)
    r0 = int(0.72 * n)
    rows = np.arange(n)[:, None]
    anchor = gaussian_filter1d(h[r0], 25, mode="nearest")
    bench = anchor[None, :] - (rows - r0) * cell_m * 0.04
    t = np.clip((rows - r0) / (0.12 * n), 0, 1)
    w = t * t * (3 - 2 * t)
    return h * (1 - w) + bench * w


def restore_tip(h: np.ndarray, cell_m: float, true_m: float | None) -> np.ndarray:
    """30 m elevation data shaves needle summits (the Matterhorn loses ~150 m). A narrow bump at the summit cell puts
    back the height Wikidata records; it is about as wide as it is tall, like the tips it replaces."""
    r, c = round(SUMMIT_ROW * GRID), GRID // 2
    lost = (true_m or 0) - h[r, c]
    if lost < 15:
        return h
    sigma = max(cell_m, lost / 1.5)
    yy, xx = (np.mgrid[:GRID, :GRID] - np.array([r, c])[:, None, None]) * cell_m
    return h + lost * np.exp(-(xx**2 + yy**2) / (2 * sigma**2))


def build(peak: dict) -> dict:
    size = float(WINDOW_M.get(peak["title"], DEFAULT_WINDOW_M))
    lat, lon, top = find_summit(peak["lat"], peak["lon"], peak.get("elevationM"))
    bearing = best_bearing(lat, lon, size)
    h = read_grid(*grid_centre(lat, lon, size, bearing), size, res_m=size / GRID, bearing_deg=bearing)
    if h is None:
        raise RuntimeError(f"no elevation data around {peak['title']}")
    cell = size / GRID
    h = base_bench(restore_tip(h, cell, peak.get("elevationM")), cell)
    lo = float(h.min())
    dm = np.round((h - lo) * 10)
    if dm.max() > 65535:
        raise RuntimeError(f"{peak['title']}: relief too large for 16-bit decimetres")
    pid = slug(peak["title"])
    out = ROOT / "public" / "terrain" / "peaks" / f"{pid}.bin"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(dm.astype("<u2").tobytes())
    print(f"{peak['title']:32s} {size / 1000:4.1f} km  turned {bearing:3d}°  data {top:6.0f} m  true {peak.get('elevationM') or 0:6.0f} m  relief {h.max() - lo:5.0f} m")
    return {"id": pid, "name": peak["title"], "range": peak["key"], "views": peak["views"],
            "lat": round(lat, 5), "lon": round(lon, 5), "summitM": round(peak.get("elevationM") or top), "bearingDeg": bearing,
            "cellSize": cell, "minHeight": round(lo, 1)}


def write_manifest(entries: list[dict]) -> None:
    rows = ",\n".join("  " + json.dumps(e, ensure_ascii=False) for e in entries)
    (ROOT / "src" / "data" / "peaks.ts").parent.mkdir(exist_ok=True)
    (ROOT / "src" / "data" / "peaks.ts").write_text(
        "// Generated by tools/terrain-stats/peakmaps.py. Do not edit by hand.\n"
        "// Heights live in public/terrain/peaks/<id>.bin as little-endian uint16 decimetres above minHeight,\n"
        "// row-major on a 160 x 160 grid, row 0 at the top (back) of the map.\n\n"
        "import type { RangeKey } from '../sim/ranges';\n\n"
        "export interface PeakEntry {\n  readonly id: string;\n  readonly name: string;\n  readonly range: RangeKey;\n"
        "  /** English Wikipedia pageviews, Oct 2025 to Sep 2026: how fame was ranked. */\n  readonly views: number;\n"
        "  readonly lat: number;\n  readonly lon: number;\n  readonly summitM: number;\n"
        "  /** Compass direction that points up the screen. */\n  readonly bearingDeg: number;\n"
        "  readonly cellSize: number;\n  readonly minHeight: number;\n}\n\n"
        f"export const PEAKS: readonly PeakEntry[] = [\n{rows},\n];\n")


def main() -> None:
    ranking = json.loads((RESULTS / "peak-ranking.json").read_text())["ranges"]
    only = set(sys.argv[1:])
    peaks = [p for rows in ranking.values() for p in rows[:3] if not only or slug(p["title"]) in only]
    write_manifest([build(p) for p in peaks])


if __name__ == "__main__":
    main()
