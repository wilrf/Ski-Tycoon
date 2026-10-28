"""Side-by-side hillshades: real face-sized windows (left) and generated faces (right), one row per range.

Usage: python3 compare.py <generated.bin> <out.png> [--at30], where generated.bin holds float64 160x160 grids,
3 per range, in RANGE order. --at30 averages the generated faces to the real data's 30 m cells, so both sides show
the same level of detail.
"""
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LightSource

RANGES = ["alps", "rockies", "andes", "himalayas", "cascades", "coast", "sierra", "appalachians", "japan_alps", "hokkaido"]
CACHE = Path(__file__).resolve().parents[1] / "terrain-stats" / "cache"
ROWS, COLS = 38, 53  # 1.14 x 1.59 km at 30 m: the game face


def real_faces(key: str, n: int, rng: np.random.Generator) -> list[np.ndarray]:
    wins = []
    for f in sorted((CACHE / key).glob("*.npy")):
        z = np.load(f)
        wins += [z[y:y + ROWS, x:x + COLS] for y in range(0, 333 - ROWS + 1, ROWS) for x in range(0, 333 - COLS + 1, COLS)]
    relief = np.array([np.ptp(w) for w in wins])
    big = [w for w, r in zip(wins, relief) if r >= np.median(relief)]
    return [big[i] for i in rng.choice(len(big), n, replace=False)]


def main() -> None:
    gen = np.fromfile(sys.argv[1]).reshape(len(RANGES), 3, 160, 160)
    at30 = "--at30" in sys.argv
    ls, rng = LightSource(315, 40), np.random.default_rng(3)
    fig, axes = plt.subplots(len(RANGES), 6, figsize=(15, 2.05 * len(RANGES)))
    for row, key, g in zip(axes, RANGES, gen):
        faces = [(h[:114, :159].reshape(38, 3, 53, 3).mean(axis=(1, 3)), 30.0) if at30 else (h[:115], 10.0) for h in g]
        panels = [(w, 30.0) for w in real_faces(key, 3, rng)] + faces
        for col, (ax, (z, res)) in enumerate(zip(row, panels)):
            ax.imshow(ls.hillshade(z, vert_exag=1.4, dx=res, dy=res), cmap="gray", vmin=0, vmax=1)
            ax.set_xticks([]), ax.set_yticks([])
            ax.set_xlabel(f"{'real' if col < 3 else 'generated'} · {np.ptp(z):.0f} m", fontsize=7)
        row[0].set_ylabel(key, fontsize=10, fontweight="bold")
    fig.tight_layout()
    fig.savefig(sys.argv[2], dpi=70)


if __name__ == "__main__":
    main()
