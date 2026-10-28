import { clamp, vec, type Vec2 } from '../sim/geometry';
import { heightAt, terrainExtent, type Terrain } from '../sim/terrain';

/**
 * The map is seen from the south at a fixed tilt, like a low pass in Google Earth: ground is foreshortened by
 * sin(PITCH) and height lifts a point up the screen by cos(PITCH). The view stays orthographic, so panning and
 * zooming only move and scale the picture.
 */
export let SIN = Math.sin((38 * Math.PI) / 180), COS = Math.cos((38 * Math.PI) / 180);
/** Changes the tilt; mountains baked before must be baked again. */
export function setPitch(degrees: number): void {
  SIN = Math.sin((degrees * Math.PI) / 180);
  COS = Math.cos((degrees * Math.PI) / 180);
}

/** Height above the lowest point of the current mountain, which the projection lifts by. */
let ground: (p: Vec2) => number = () => 0;
let groundExtent = 1600;
let relief = 0;
/** The highest point of the current mountain, which the opening view frames. */
let summit: Vec2 = vec(800, 0);

/** Points the camera at a new mountain's ground. */
export function setGround(t: Terrain): void {
  let low = Infinity;
  for (const h of t.heights) low = Math.min(low, h);
  ground = (p) => heightAt(t, p) - low;
  groundExtent = terrainExtent(t);
  relief = Math.max(...t.heights) - low;
  const top = t.heights.indexOf(Math.max(...t.heights));
  summit = vec(((top % t.size) + 0.5) * t.cellSize, (Math.floor(top / t.size) + 0.5) * t.cellSize);
}

/** Height on screen of a world point, in metres along the screen's vertical, before zoom. */
export const lifted = (p: Vec2): number => p.y * SIN - ground(p) * COS;
/** How far up the screen the tallest point of the mountain can rise, in world-y metres. */
export const reliefRise = (): number => (relief * COS) / SIN;

/** Centre of the view in world metres (as if at the lowest ground), and pixels per metre. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface View {
  readonly width: number;
  readonly height: number;
}

const MAX_ZOOM = 3;

export const toScreen = (c: Camera, v: View, p: Vec2): Vec2 => vec((p.x - c.x) * c.zoom + v.width / 2, (lifted(p) - c.y * SIN) * c.zoom + v.height / 2);

/**
 * The ground point under a screen point: the first place, marching back from the front of the map, where the
 * surface rises to that screen row. Off the front or above the skyline it falls back to the flat ground plane.
 */
export function toWorld(c: Camera, v: View, s: Vec2): Vec2 {
  const x = (s.x - v.width / 2) / c.zoom + c.x, row = (s.y - v.height / 2) / c.zoom + c.y * SIN;
  const above = (y: number): number => lifted(vec(x, y)) - row;
  const flat = (edge: number): Vec2 => vec(x, (row + ground(vec(x, edge)) * COS) / SIN);
  if (above(groundExtent) < 0) return flat(groundExtent);
  const step = 4;
  for (let y = groundExtent - step; y >= 0; y -= step) {
    if (above(y) > 0) continue;
    let front = y + step, back = y;
    for (let i = 0; i < 12; i++) {
      const mid = (front + back) / 2;
      if (above(mid) > 0) front = mid;
      else back = mid;
    }
    return vec(x, (front + back) / 2);
  }
  return flat(0);
}

/** A rough world rectangle that covers the screen, for skipping things far out of view. */
export function visibleBounds(c: Camera, v: View, margin = 0): { min: Vec2; max: Vec2 } {
  const half = (v.width / 2 + margin) / c.zoom, tall = (v.height / 2 + margin) / (c.zoom * SIN);
  return { min: vec(c.x - half, c.y - tall), max: vec(c.x + half, c.y + tall + reliefRise()) };
}

/** Leaves room for the HUD above and the toolbar below. */
/** Zoomed out, the map and the made-up land either side of it still fill the screen's width. */
const fitZoom = (extent: number, v: View): number => (v.width / extent) * 1.15;

/**
 * The opening view: the summit high in the frame with the base village at the bottom, the way a mountain is first
 * seen from the valley road, and never narrower than the screen.
 */
export function fitCamera(extent: number, v: View): Camera {
  const base = vec(extent / 2, extent);
  const zoom = Math.min(v.width / extent, (v.height * 0.64) / Math.max(1, lifted(base) - lifted(summit)));
  const x = (summit.x + extent / 2) / 2;
  return { x, y: (lifted(summit) - (v.height * 0.28 - v.height / 2) / zoom) / SIN, zoom };
}

/** Keeps the zoom between half the fit-to-screen scale and MAX_ZOOM, and the centre on the map. */
export function clampCamera(c: Camera, extent: number, v: View): void {
  c.zoom = clamp(c.zoom, fitZoom(extent, v) / 2, MAX_ZOOM);
  c.x = clamp(c.x, 0, extent);
  c.y = clamp(c.y, -reliefRise(), extent);
}

export function pan(c: Camera, dx: number, dy: number): void {
  c.x -= dx / c.zoom;
  c.y -= dy / (c.zoom * SIN);
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

/**
 * Eases the camera toward `target` so a followed skier stays centred without the view jerking each tick.
 * Frame-rate independent: the same share of the gap closes per second however often it's called.
 */
export function follow(c: Camera, target: Vec2, seconds: number): void {
  const k = 1 - Math.exp(-seconds * 5);
  c.x += (target.x - c.x) * k;
  c.y += (lifted(target) / SIN - c.y) * k;
}
