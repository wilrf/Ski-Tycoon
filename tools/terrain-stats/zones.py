"""Sampling zones for each mountain range: boxes of (west, south, east, north) in degrees around each range's core."""
from dataclasses import dataclass

Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class Zone:
    key: str
    name: str
    boxes: tuple[Box, ...]


ZONES: tuple[Zone, ...] = (
    Zone("alps", "Alps", (
        (6.5, 45.7, 8.2, 46.6),     # Mont Blanc, Valais
        (8.0, 46.3, 10.5, 47.0),    # Bernese Oberland, Glarus, Engadin
        (10.5, 46.6, 12.8, 47.3),   # Tyrol
    )),
    Zone("rockies", "Colorado Rockies", (
        (-107.2, 38.8, -105.5, 40.0),  # Elk, Sawatch, Front Range
        (-108.0, 37.6, -107.0, 38.2),  # San Juans
    )),
    Zone("andes", "Central Andes", (
        (-70.5, -34.5, -69.6, -32.3),  # Aconcagua to Portillo and Valle Nevado
    )),
    Zone("himalayas", "Himalayas", (
        (86.4, 27.6, 87.3, 28.2),   # Khumbu
        (83.6, 28.4, 84.2, 28.8),   # Annapurna
        (78.8, 30.6, 80.0, 31.0),   # Garhwal
    )),
    Zone("cascades", "Cascades", (
        (-121.6, 48.3, -120.7, 48.9),  # North Cascades
        (-121.9, 46.7, -121.3, 47.6),  # Rainier to Snoqualmie
    )),
    Zone("coast", "Coast Mountains", (
        (-123.4, 49.7, -122.5, 50.5),  # Whistler, Garibaldi
        (-125.5, 50.8, -124.4, 51.5),  # Waddington
    )),
    Zone("sierra", "Sierra Nevada", (
        (-119.4, 36.5, -118.3, 38.0),  # High Sierra crest, Mammoth
    )),
    Zone("appalachians", "Appalachians", (
        (-84.0, 35.4, -82.0, 36.2),  # Great Smokies, Black Mountains
        (-71.6, 44.0, -71.1, 44.4),  # White Mountains
    )),
    Zone("japan_alps", "Japanese Alps", (
        (137.4, 35.9, 137.9, 36.9),  # Hida range, Hakuba
    )),
    Zone("hokkaido", "Hokkaido", (
        (140.5, 42.6, 141.0, 43.0),  # Niseko, Yotei
        (142.7, 43.5, 143.1, 43.8),  # Daisetsuzan
    )),
)
