/** A point on the ground plane, in metres. x grows east, y grows south (downhill toward the base). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (len2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2, 0, 1);
  return dist(p, lerp(a, b, t));
}

const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Shortest distance between segments a1-a2 and b1-b2; zero when they cross. */
export function segmentDistance(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  const d1 = cross(b1, b2, a1), d2 = cross(b1, b2, a2), d3 = cross(a1, a2, b1), d4 = cross(a1, a2, b2);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(distToSegment(a1, b1, b2), distToSegment(a2, b1, b2), distToSegment(b1, a1, a2), distToSegment(b2, a1, a2));
}

export const polylineLength = (points: readonly Vec2[]): number =>
  points.slice(1).reduce((sum, p, i) => sum + dist(points[i]!, p), 0);

export function pointAlong(points: readonly Vec2[], distance: number): Vec2 {
  let left = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, len = dist(a, b);
    if (left <= len) return lerp(a, b, len === 0 ? 0 : left / len);
    left -= len;
  }
  return points[points.length - 1]!;
}

export function distToPolyline(p: Vec2, points: readonly Vec2[]): number {
  if (points.length === 1) return dist(p, points[0]!);
  return Math.min(...points.slice(1).map((b, i) => distToSegment(p, points[i]!, b)));
}

/** The point on a polyline nearest to p, with its distance along the line and from p. */
export function projectOnPolyline(p: Vec2, points: readonly Vec2[]): { readonly at: number; readonly point: Vec2; readonly gap: number } {
  let best = { at: 0, point: points[0]!, gap: dist(p, points[0]!) };
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, len = dist(a, b);
    const t = len === 0 ? 0 : clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len), 0, 1);
    const point = lerp(a, b, t), gap = dist(p, point);
    if (gap < best.gap) best = { at: along + t * len, point, gap };
    along += len;
  }
  return best;
}
