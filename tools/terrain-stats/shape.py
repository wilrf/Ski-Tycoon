"""Shape statistics for one square elevation grid. Each stat answers one question a viewer's eye asks."""
import numpy as np
from scipy.ndimage import gaussian_filter, laplace, maximum_filter, minimum_filter

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


def shape_stats(z: np.ndarray) -> dict[str, float]:
    gy, gx = np.gradient(z, RES_M)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    lo, hi = np.percentile(z, [1, 99])

    # Ridge sharpness: curvature at the most convex 2% of cells, per km. Knife-edge aretes score high, rounded crests low.
    curvature = laplace(gaussian_filter(z, 1)) / RES_M**2
    crest = -np.percentile(curvature, 2) * 1000

    # Peaks: highest point within ~1 km that also stands 150 m above its ~2 km surroundings.
    is_peak = (z == maximum_filter(z, 33)) & (z - minimum_filter(z, 67) > 150)
    is_peak[:16, :] = is_peak[-16:, :] = is_peak[:, :16] = is_peak[:, -16:] = False
    inner_km2 = ((z.shape[0] - 32) * RES_M / 1000) ** 2

    w = int(GAME_WINDOW_M / RES_M)
    windows = [z[r:r + w, c:c + w] for r in range(0, z.shape[0] - w + 1, w) for c in range(0, z.shape[1] - w + 1, w)]

    return {
        "elev_median_m": float(np.median(z)),
        "elev_max_m": float(z.max()),
        "relief_m": float(hi - lo),
        "relief_2km_m": float(np.median([np.ptp(np.percentile(win, [2, 98])) for win in windows])),
        "hypsometric": float((z.mean() - z.min()) / np.ptp(z)),
        "slope_mean_deg": float(slope.mean()),
        "slope_p90_deg": float(np.percentile(slope, 90)),
        "frac_gt30": float((slope > 30).mean()),
        "frac_gt45": float((slope > 45).mean()),
        "frac_flat_lt10": float((slope < 10).mean()),
        "spectral_beta": spectral_slope(z),
        "rough_300m_m": float((z - gaussian_filter(z, 10)).std()),
        "crest_curv_per_km": float(crest),
        "peaks_per_100km2": float(is_peak.sum() / inner_km2 * 100),
    }
