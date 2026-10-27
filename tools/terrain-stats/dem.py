"""Reads square metric elevation grids from the Copernicus GLO-30 DEM on AWS Open Data."""
from __future__ import annotations

import math
import os

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import map_coordinates

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


def read_grid(lat: float, lon: float, size_m: float) -> np.ndarray | None:
    """Square grid of side `size_m` at RES_M spacing, north up. None if the square leaves its 1-degree tile, has no data, or the tile does not exist (open sea)."""
    half = size_m / 2
    dlat, dlon = half / M_PER_DEG, half / (M_PER_DEG * math.cos(math.radians(lat)))
    south, north, west, east = lat - dlat, lat + dlat, lon - dlon, lon + dlon
    if math.floor(south) != math.floor(north) or math.floor(west) != math.floor(east):
        return None
    try:
        with rasterio.open(tile_url(lat, lon)) as src:
            win = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
            raw = src.read(1, window=win, boundless=False).astype(np.float64)
            inv = ~src.window_transform(win)
    except rasterio.errors.RasterioIOError:
        return None
    if raw.size == 0 or not np.isfinite(raw).all() or raw.min() < -500:
        return None
    n = int(size_m / RES_M)
    offs = (np.arange(n) + 0.5) * RES_M - half
    east_m, north_m = np.meshgrid(offs, offs[::-1])
    cols, rows = inv * (lon + east_m / (M_PER_DEG * math.cos(math.radians(lat))), lat + north_m / M_PER_DEG)
    # Window coordinates put pixel centres at +0.5; map_coordinates indexes pixel centres at integers.
    return map_coordinates(raw, [rows - 0.5, cols - 0.5], order=1, mode="nearest")
