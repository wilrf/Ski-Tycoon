"""Draws random 10 km tiles inside each zone and caches the accepted grids as .npy files."""
from __future__ import annotations

import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from dem import read_grid
from zones import ZONES, Zone

TILE_M = 10_000.0
PER_ZONE = 50
MAX_TRIES = 300
MIN_RELIEF_M = 400.0  # Below this a tile is foothills or a valley floor, not the range.
MAX_FLAT = 0.5        # Above this share of near-flat ground a tile is mostly valley or lake.
CACHE = Path(__file__).parent / "cache"


def random_point(zone: Zone, rng: random.Random) -> tuple[float, float]:
    """Uniform over the union of boxes, weighted by box area."""
    w, s, e, n = rng.choices(zone.boxes, weights=[(b[2] - b[0]) * (b[3] - b[1]) for b in zone.boxes])[0]
    return rng.uniform(s, n), rng.uniform(w, e)


def accept(z: np.ndarray | None) -> bool:
    if z is None:
        return False
    gy, gx = np.gradient(z, 30.0)
    return np.ptp(np.percentile(z, [1, 99])) >= MIN_RELIEF_M and (np.hypot(gx, gy) < np.tan(np.radians(10))).mean() <= MAX_FLAT


def sample_zone(zone: Zone, seed: int) -> list[dict[str, float]]:
    out = CACHE / zone.key
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    points = [random_point(zone, rng) for _ in range(MAX_TRIES)]
    kept: list[dict[str, float]] = []
    with ThreadPoolExecutor(8) as pool:
        # Batches keep the pool busy without fetching far past the quota.
        for start in range(0, MAX_TRIES, 16):
            batch = points[start:start + 16]
            for (lat, lon), z in zip(batch, pool.map(lambda p: read_grid(*p, TILE_M), batch)):
                if accept(z) and len(kept) < PER_ZONE:
                    np.save(out / f"{len(kept):03d}.npy", z.astype(np.float32))
                    kept.append({"lat": lat, "lon": lon})
            if len(kept) >= PER_ZONE:
                break
    (out / "centres.json").write_text(json.dumps(kept, indent=1))
    print(f"{zone.name}: {len(kept)} tiles", flush=True)
    return kept


if __name__ == "__main__":
    wanted = set(sys.argv[1:])
    for i, zone in enumerate(ZONES):
        if not wanted or zone.key in wanted:
            sample_zone(zone, seed=1000 + i)
