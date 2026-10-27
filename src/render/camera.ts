import { clamp, vec, type Vec2 } from '../sim/geometry';

/** Centre of the view in world metres, and pixels per metre. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface View {
  readonly width: number;
  readonly height: number;
}

const MAX_ZOOM = 8;

export const toScreen = (c: Camera, v: View, p: Vec2): Vec2 => vec((p.x - c.x) * c.zoom + v.width / 2, (p.y - c.y) * c.zoom + v.height / 2);
export const toWorld = (c: Camera, v: View, s: Vec2): Vec2 => vec((s.x - v.width / 2) / c.zoom + c.x, (s.y - v.height / 2) / c.zoom + c.y);

/** Leaves room for the HUD above and the toolbar below. */
const fitZoom = (extent: number, v: View): number => Math.min(v.width - 16, v.height - 150) / extent;

/** Shows the whole map; on a portrait phone, zooms in on the lower mountain where building starts. */
export const fitCamera = (extent: number, v: View): Camera =>
  v.height > v.width ? { x: extent / 2, y: extent * 0.62, zoom: fitZoom(extent, v) * 1.5 } : { x: extent / 2, y: extent / 2, zoom: fitZoom(extent, v) };

/** Keeps the zoom between half the fit-to-screen scale and MAX_ZOOM, and the centre on the map. */
export function clampCamera(c: Camera, extent: number, v: View): void {
  c.zoom = clamp(c.zoom, fitZoom(extent, v) / 2, MAX_ZOOM);
  c.x = clamp(c.x, 0, extent);
  c.y = clamp(c.y, 0, extent);
}

export function pan(c: Camera, dx: number, dy: number): void {
  c.x -= dx / c.zoom;
  c.y -= dy / c.zoom;
}

/** Zooms by `factor` while keeping the world point under `at` fixed on screen. */
export function zoomAt(c: Camera, v: View, at: Vec2, factor: number, extent: number): void {
  const before = toWorld(c, v, at);
  c.zoom *= factor;
  clampCamera(c, extent, v);
  const after = toWorld(c, v, at);
  c.x += before.x - after.x;
  c.y += before.y - after.y;
  clampCamera(c, extent, v);
}
