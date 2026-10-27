"""Reads square metric elevation grids from the Copernicus GLO-30 DEM on AWS Open Data."""
from __future__ import annotations

import math
import os

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import gaussian_filter, map_coordinates

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
if os.path.exists("/root/.ccr/ca-bundle.crt"):
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

RES_M = 30.0
M_PER_DEG = 111_320.0
BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"


def tile_url(lat: float, lon: float) -> str:
    la, lo = math.floor(lat), math.floor(lon)
    name = f"Copernicus_DSM_COG_10_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM"
    return f"/vsicurl/{BUCKET}/{name}/{name}.tif"


def offset(lat: float, lon: float, east_m: np.ndarray | float, north_m: np.ndarray | float) -> tuple:
    """Lat/lon of points given in metres east and north of (lat, lon). Flat-earth, fine over a few kilometres."""
    return lat + np.asarray(north_m) / M_PER_DEG, lon + np.asarray(east_m) / (M_PER_DEG * math.cos(math.radians(lat)))


def crosses_tile(lat: float, lon: float, size_m: float) -> bool:
    (s, n), (w, e) = offset(lat, lon, [-size_m / 2, size_m / 2], [-size_m / 2, size_m / 2])
    return math.floor(s) != math.floor(n) or math.floor(w) != math.floor(e)


def sample_latlon(lats: np.ndarray, lons: np.ndarray, blur_px: float = 0.0) -> np.ndarray | None:
    """Bilinear DEM heights at the given points, across as many 1-degree tiles as they touch.
    None if any tile is missing (open sea) or holds no data. `blur_px` pre-smooths so coarse grids don't alias."""
    out = np.empty(lats.shape)
    for la, lo in {(math.floor(a), math.floor(o)) for a, o in zip(lats.ravel(), lons.ravel())}:
        sel = (np.floor(lats) == la) & (np.floor(lons) == lo)
        pad = 4 / 3600
        try:
            with rasterio.open(tile_url(la + 0.5, lo + 0.5)) as src:
                win = from_bounds(lons[sel].min() - pad, lats[sel].min() - pad, lons[sel].max() + pad, lats[sel].max() + pad, src.transform)
                win = win.round_offsets().round_lengths().intersection(rasterio.windows.Window(0, 0, src.width, src.height))
                raw = src.read(1, window=win).astype(np.float64)
                inv = ~src.window_transform(win)
        except rasterio.errors.RasterioIOError:
            return None
        if raw.size == 0 or not np.isfinite(raw).all() or raw.min() < -500:
            return None
        if blur_px > 0:
            raw = gaussian_filter(raw, blur_px)
        cols, rows = inv * (lons[sel], lats[sel])
        # Window coordinates put pixel centres at +0.5; map_coordinates indexes pixel centres at integers.
        out[sel] = map_coordinates(raw, [rows - 0.5, cols - 0.5], order=1, mode="nearest")
    return out


def read_grid(lat: float, lon: float, size_m: float, res_m: float = RES_M, bearing_deg: float = 0.0) -> np.ndarray | None:
    """Square grid of side `size_m` centred on (lat, lon). Row 0 is the far edge in the direction `bearing_deg`
    (0 = north up), so a bearing turns the map until that compass direction points up the screen."""
    n = round(size_m / res_m)
    offs = (np.arange(n) + 0.5) * res_m - size_m / 2
    x, y = np.meshgrid(offs, offs[::-1])
    b = math.radians(bearing_deg)
    east, north = x * math.cos(b) + y * math.sin(b), -x * math.sin(b) + y * math.cos(b)
    return sample_latlon(*offset(lat, lon, east, north), blur_px=max(0.0, 0.5 * (res_m / RES_M - 1)))
