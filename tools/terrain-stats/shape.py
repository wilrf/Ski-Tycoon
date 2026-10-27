"""Shape statistics for one square elevation grid. Each stat answers one question a viewer's eye asks."""
from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter, label, laplace, maximum_filter, minimum_filter

from dem import RES_M

GAME_WINDOW_M = 2000.0  # About the width of the in-game mountain.


def spectral_slope(z: np.ndarray, short_m: float = 120.0, long_m: float = 3000.0) -> float:
    """Exponent beta in P(k) ~ k^-beta between the two wavelengths. Lower beta means more small-scale jaggedness relative to big forms."""
    n = z.shape[0]
    yy, xx = np.mgrid[:n, :n]
    design = np.column_stack([xx.ravel(), yy.ravel(), np.ones(n * n)])
    plane = design @ np.linalg.lstsq(design, z.ravel(), rcond=None)[0]
    win = np.outer(np.hanning(n), np.hanning(n))
    power = np.abs(np.fft.fft2((z - plane.reshape(n, n)) * win)) ** 2
    f = np.fft.fftfreq(n, d=RES_M)
    k = np.hypot(*np.meshgrid(f, f))
    edges = np.geomspace(1 / long_m, 1 / short_m, 13)
    centres, means = [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (k >= lo) & (k < hi)
        if sel.any():
            centres.append(np.sqrt(lo * hi))
            means.append(power[sel].mean())
    return float(-np.polyfit(np.log10(centres), np.log10(means), 1)[0])


def water_mask(grade: np.ndarray, min_km2: float = 0.3) -> np.ndarray:
    """The DEM flattens lakes and sea to one level, so water shows up as large connected areas of near-zero grade."""
    regions, _ = label(grade < 0.002)
    sizes = np.bincount(regions.ravel())
    big = sizes * (RES_M / 1000) ** 2 >= min_km2
    big[0] = False
    return big[regions]


def gully_crossings_per_km(z: np.ndarray, land: np.ndarray) -> float:
    """How often the ground switches between gully and spur along a straight line, at the 50-250 m scale.
    Finely dissected land (Appalachians, Japanese Alps) switches often; glacier-smoothed land rarely."""
    band = gaussian_filter(z, 1.5) - gaussian_filter(z, 8)
    sign = band > 0
    crossings = 0
    length_px = 0
    for s, keep in ((sign, land), (sign.T, land.T)):
        both = keep[:, 1:] & keep[:, :-1]
        crossings += (s[:, 1:] != s[:, :-1])[both].sum()
        length_px += both.sum()
    return float(crossings / (length_px * RES_M / 1000))


def shape_stats(z: np.ndarray) -> dict[str, float]:
    gy, gx = np.gradient(z, RES_M)
    grade = np.hypot(gx, gy)
    slope = np.degrees(np.arctan(grade))
    land = ~water_mask(grade)
    land_slope, land_z = slope[land], z[land]
    lo, hi = np.percentile(land_z, [1, 99])

    # Ridge sharpness: curvature at the most convex 2% of cells, per km. Knife-edge aretes score high, rounded crests low.
    curvature = laplace(gaussian_filter(z, 1)) / RES_M**2
    crest = -np.percentile(curvature[land], 2) * 1000

    # Peaks: highest point within ~1 km that also stands 150 m above its ~2 km surroundings.
    is_peak = (z == maximum_filter(z, 33)) & (z - minimum_filter(z, 67) > 150)
    is_peak[:16, :] = is_peak[-16:, :] = is_peak[:, :16] = is_peak[:, -16:] = False
    inner_km2 = ((z.shape[0] - 32) * RES_M / 1000) ** 2

    w = int(GAME_WINDOW_M / RES_M)
    windows = [z[r:r + w, c:c + w] for r in range(0, z.shape[0] - w + 1, w) for c in range(0, z.shape[1] - w + 1, w)]
    relief_2km = float(np.median([np.ptp(np.percentile(win, [2, 98])) for win in windows]))

    # High ground that is gentle: the flat-topped benches of the Rockies and Sierra, absent from knife-edge ranges.
    high = land & (z > np.percentile(land_z, 70))
    fine = gaussian_filter(z, 1) - gaussian_filter(z, 4)
    coarse = gaussian_filter(z, 4) - gaussian_filter(z, 16)

    return {
        "elev_median_m": float(np.median(land_z)),
        "elev_max_m": float(land_z.max()),
        "water_frac": float(1 - land.mean()),
        "relief_m": float(hi - lo),
        "relief_2km_m": relief_2km,
        "relief_scale_ratio": relief_2km / float(hi - lo),
        "hypsometric": float((land_z.mean() - land_z.min()) / np.ptp(land_z)),
        "slope_mean_deg": float(land_slope.mean()),
        "slope_p90_deg": float(np.percentile(land_slope, 90)),
        "frac_gt30": float((land_slope > 30).mean()),
        "frac_gt45": float((land_slope > 45).mean()),
        "frac_flat_lt10": float((land_slope < 10).mean()),
        "upland_flat_frac": float((slope[high] < 15).mean()),
        "spectral_beta": spectral_slope(z),
        "fine_coarse_ratio": float(fine[land].std() / coarse[land].std()),
        "rough_300m_m": float((z - gaussian_filter(z, 10))[land].std()),
        "gully_crossings_per_km": gully_crossings_per_km(z, land),
        "crest_curv_per_km": float(crest),
        "peaks_per_100km2": float(is_peak.sum() / inner_km2 * 100),
    }
