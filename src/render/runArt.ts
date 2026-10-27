import type { Level } from '../config';
import { vec, type Vec2 } from '../sim/geometry';
import { LEVEL_COLORS } from './colors';

/** Groomed width of a run in metres. */
export const RUN_WIDTH = 22;
const HALF = RUN_WIDTH / 2;
const POLE_SPACING = 25;
/** Below these zooms (pixels per metre) the detail is too small to see, so it isn't drawn. */
const TEXTURE_ZOOM = 0.9;
const POLE_ZOOM = 0.6;

/** Where a run's decoration sits, in world metres. Built once per run and reused every frame. */
interface RunDecor {
  readonly tracks: readonly (readonly Vec2[])[];
  readonly moguls: readonly Vec2[];
  readonly poles: readonly Vec2[];
  readonly min: Vec2;
  readonly max: Vec2;
}

interface Sample {
  readonly p: Vec2;
  /** Unit normal, pointing to the skier's left. */
  readonly n: Vec2;
  /** Distance along the run in metres. */
  readonly d: number;
}

/** Points every `step` metres along a polyline, each with its normal, walking the segments once. */
function sample(points: readonly Vec2[], step: number): Sample[] {
  const out: Sample[] = [];
  let travelled = 0, next = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const n = vec(-(b.y - a.y) / len, (b.x - a.x) / len);
    for (; next <= travelled + len; next += step) {
      const t = (next - travelled) / len;
      out.push({ p: vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), n, d: next });
    }
    travelled += len;
  }
  return out;
}

const offset = (s: Sample, by: number): Vec2 => vec(s.p.x + s.n.x * by, s.p.y + s.n.y * by);
/** A stable pseudo-random value in [0, 1) so moguls don't shimmer between frames. */
const hash = (i: number, j: number): number => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Each grade has its own snow, so runs read apart even without colour: greens are smooth corduroy with a
 * couple of lazy turns, blues are carved S-tracks, and blacks are mogul fields (denser on double blacks).
 */
function decorate(points: readonly Vec2[], level: Level): RunDecor {
  const fine = sample(points, 2);
  const wavy = (count: number, amplitude: number, wave: (k: number) => number): Vec2[][] =>
    Array.from({ length: count }, (_, k) => {
      const centre = count === 1 ? 0 : (k / (count - 1) - 0.5) * HALF * 0.6;
      return fine.map((s) => offset(s, centre + Math.sin(s.d / wave(k) + k * 1.9) * amplitude));
    });
  const corduroy = (): Vec2[][] =>
    Array.from({ length: 9 }, (_, k) => fine.map((s) => offset(s, (k / 8 - 0.5) * RUN_WIDTH * 0.85)));

  let tracks: Vec2[][] = [];
  const moguls: Vec2[] = [];
  if (level === 0) tracks = [...corduroy(), ...wavy(2, 4, (k) => 9 + k * 2)];
  else if (level === 1) tracks = wavy(6, HALF * 0.55, (k) => 5 + k * 1.3);
  else {
    const rowGap = level === 3 ? 3.4 : 4.5;
    for (const [i, s] of sample(points, rowGap).entries()) {
      for (let j = -2; j <= 2; j++) {
        const across = (j + (i % 2) * 0.5) * (HALF * 0.38) + (hash(i, j) - 0.5) * 1.5;
        if (Math.abs(across) < HALF - 2) moguls.push(offset(s, across));
      }
    }
    tracks = wavy(2, HALF * 0.5, (k) => 3 + k);
  }

  const poles = sample(points, POLE_SPACING).flatMap((s) => [offset(s, HALF + 1.5), offset(s, -HALF - 1.5)]);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = HALF + 4;
  return {
    tracks,
    moguls,
    poles,
    min: vec(Math.min(...xs) - pad, Math.min(...ys) - pad),
    max: vec(Math.max(...xs) + pad, Math.max(...ys) + pad),
  };
}

const cache = new WeakMap<readonly Vec2[], { level: Level; decor: RunDecor }>();
function decorFor(points: readonly Vec2[], level: Level): RunDecor {
  const hit = cache.get(points);
  if (hit && hit.level === level) return hit.decor;
  const decor = decorate(points, level);
  cache.set(points, { level, decor });
  return decor;
}

export interface RunView {
  readonly zoom: number;
  readonly at: (p: Vec2) => Vec2;
  /** The visible part of the world, so off-screen runs skip their detail. */
  readonly min: Vec2;
  readonly max: Vec2;
}

/**
 * A run as it looks from above: a groomed swath edged in its difficulty colour, its snow texture, and
 * piste poles in its colour down both sides. Detail drops away as the camera zooms out.
 */
export function drawRun(ctx: CanvasRenderingContext2D, points: readonly Vec2[], level: Level, outline: string | null, v: RunView): void {
  const color = LEVEL_COLORS[level];
  const width = Math.max(6, RUN_WIDTH * v.zoom);
  const line = (pts: readonly Vec2[]): void => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = v.at(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
  };
  const stroke = (style: string, w: number): void => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.stroke();
  };

  line(points);
  if (outline) stroke(outline, width + 7);
  stroke(color, width + 3);
  stroke('#f7faff', width);
  // Zoomed out, the texture and poles vanish, so a centre stripe keeps the grade readable.
  if (v.zoom < TEXTURE_ZOOM) stroke(color, Math.max(2, width * 0.18));

  const d = decorFor(points, level);
  if (v.zoom < POLE_ZOOM || d.max.x < v.min.x || d.min.x > v.max.x || d.max.y < v.min.y || d.min.y > v.max.y) return;

  if (v.zoom >= TEXTURE_ZOOM) {
    for (const track of d.tracks) {
      line(track);
      stroke(level === 0 ? 'rgba(150, 168, 205, 0.22)' : 'rgba(105, 125, 175, 0.42)', Math.max(0.8, v.zoom * 0.45));
    }
    const r = (level === 3 ? 1.9 : 1.6) * v.zoom;
    for (const m of d.moguls) {
      const s = v.at(m);
      // Sun from the north-west: shadowed south-east flank, bright north-west cap.
      ctx.fillStyle = 'rgba(110, 130, 185, 0.38)';
      ctx.beginPath();
      ctx.ellipse(s.x + r * 0.35, s.y + r * 0.35, r, r * 0.8, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.ellipse(s.x - r * 0.25, s.y - r * 0.25, r * 0.6, r * 0.45, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const head = Math.max(2.2, v.zoom * 1.1), lean = Math.max(4, v.zoom * 2.5);
  const dark = level >= 2;
  for (const pole of d.poles) {
    const s = v.at(pole);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + lean * 0.7, s.y + lean * 0.45);
    stroke('rgba(20, 30, 60, 0.3)', 1.5);
    ctx.beginPath();
    ctx.arc(s.x, s.y, head, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    // Black poles get a bright cap so they don't read as holes in the snow.
    stroke(dark ? '#ffd23f' : '#ffffff', dark ? 1.5 : 1);
  }
}
