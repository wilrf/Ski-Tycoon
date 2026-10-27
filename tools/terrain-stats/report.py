"""Computes shape stats for every cached tile, summarises them per range, and tests whether the stats tell the ranges apart."""
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LightSource

from sample import CACHE
from shape import shape_stats
from zones import ZONES

RESULTS = Path(__file__).parent / "results"
# Absolute height is left out of the look test: the game rescales heights, so the eye judges shape, not altitude.
ALTITUDE = {"elev_median_m", "elev_max_m"}


def load_tiles() -> dict[str, list[np.ndarray]]:
    return {z.key: [np.load(f).astype(np.float64) for f in sorted((CACHE / z.key).glob("*.npy"))] for z in ZONES}


def summarise(rows: list[dict[str, float]]) -> dict[str, dict[str, float]]:
    out = {}
    for stat in rows[0]:
        v = np.array([r[stat] for r in rows])
        out[stat] = {"mean": v.mean(), "sd": v.std(ddof=1), **{f"p{q}": np.percentile(v, q) for q in (10, 50, 90)}}
    return {s: {k: round(float(x), 4) for k, x in d.items()} for s, d in out.items()}


def separability(per_range: dict[str, list[dict[str, float]]], stats: list[str]) -> dict:
    """Leave-one-out nearest-centroid classification on z-scored stats, plus each stat's between/within variance ratio."""
    keys = list(per_range)
    X = np.array([[r[s] for s in stats] for k in keys for r in per_range[k]])
    y = np.array([i for i, k in enumerate(keys) for _ in per_range[k]])
    X = (X - X.mean(0)) / X.std(0)
    confusion = np.zeros((len(keys), len(keys)), int)
    for i in range(len(X)):
        mask = np.arange(len(X)) != i
        centroids = np.array([X[mask & (y == c)].mean(0) for c in range(len(keys))])
        confusion[y[i], np.argmin(((centroids - X[i]) ** 2).sum(1))] += 1
    grand = X.mean(0)
    between = sum((y == c).sum() * (X[y == c].mean(0) - grand) ** 2 for c in range(len(keys)))
    within = sum(((X[y == c] - X[y == c].mean(0)) ** 2).sum(0) for c in range(len(keys)))
    f_ratio = between / within
    return {
        "accuracy": round(float(np.trace(confusion) / confusion.sum()), 3),
        "per_range_accuracy": {k: round(float(confusion[i, i] / confusion[i].sum()), 3) for i, k in enumerate(keys)},
        "confusions": sorted(
            ({"true": keys[i], "guessed": keys[j], "count": int(confusion[i, j])} for i in range(len(keys)) for j in range(len(keys)) if i != j and confusion[i, j]),
            key=lambda c: -c["count"])[:8],
        "stat_power": dict(sorted(((s, round(float(f), 3)) for s, f in zip(stats, f_ratio)), key=lambda p: -p[1])),
    }


def contact_sheet(tiles: dict[str, list[np.ndarray]], path: Path, per_row: int = 5) -> None:
    """Hillshaded sample tiles, one row per range, each tile shaded at its own height range so shape, not altitude, shows."""
    ls = LightSource(azdeg=315, altdeg=40)
    fig, axes = plt.subplots(len(ZONES), per_row, figsize=(per_row * 2.2, len(ZONES) * 2.3))
    for row, zone in zip(axes, ZONES):
        for col, ax in enumerate(row):
            z = tiles[zone.key][col * len(tiles[zone.key]) // per_row]
            ax.imshow(ls.shade(z, cmap=plt.cm.gist_earth, vert_exag=1.5, dx=30, dy=30, blend_mode="soft"))
            ax.set_xticks([]), ax.set_yticks([])
            ax.set_xlabel(f"{np.ptp(z):,.0f} m relief", fontsize=7)
        row[0].set_ylabel(zone.name, fontsize=10, fontweight="bold")
    fig.suptitle("Real 10 km tiles, Copernicus GLO-30", fontsize=12)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    tiles = load_tiles()
    per_range = {k: [shape_stats(z) for z in zs] for k, zs in tiles.items() if zs}
    names = {z.key: z.name for z in ZONES}
    all_stats = list(next(iter(per_range.values()))[0])
    shape_only = [s for s in all_stats if s not in ALTITUDE]
    result = {
        "source": "Copernicus GLO-30 DEM, random 10 km tiles inside each zone (tools/terrain-stats/zones.py)",
        "ranges": {k: {"name": names[k], "tiles": len(rows), "stats": summarise(rows)} for k, rows in per_range.items()},
        "separability": {"shape_only": separability(per_range, shape_only), "with_altitude": separability(per_range, all_stats)},
    }
    (RESULTS / "range-shape-stats.json").write_text(json.dumps(result, indent=1))
    (RESULTS / "tile-stats.json").write_text(json.dumps({k: [{s: round(v, 4) for s, v in r.items()} for r in rows] for k, rows in per_range.items()}))
    contact_sheet(tiles, RESULTS / "real-tiles.png")
    print(json.dumps(result["separability"], indent=1))


if __name__ == "__main__":
    main()
