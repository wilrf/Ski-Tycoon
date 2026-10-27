import { CONFIG, type LiftType } from '../config';
import { dist, vec, type Vec2 } from '../sim/geometry';
import type { View } from './camera';
import { INVALID, LIFT_COLORS, SELECTED } from './colors';
import { drawSkier } from './skierArt';

/** Metres between carriers on a cable. */
const SPACING = { rope: 0, tbar: 12, chair: 22, cabin: 45 } as const;
/** Below this zoom, carriers are plain dots: seats and riders would be a pixel wide. */
const DETAIL_ZOOM = 0.8;

type Carrier =
  | { readonly kind: 'rope' }
  | { readonly kind: 'tbar' }
  | { readonly kind: 'chair'; readonly seats: number; readonly bubble: boolean }
  | { readonly kind: 'cabin'; readonly seats: number };

/** What hangs off the cable for each lift type and upgrade tier, matching the tier names in the config. */
function carrierFor(type: LiftType, tier: number): Carrier {
  if (type === 'ropeTow') return tier === 0 ? { kind: 'rope' } : { kind: 'tbar' };
  if (type === 'gondola') return { kind: 'cabin', seats: tier === 0 ? 8 : 10 };
  return { kind: 'chair', seats: [2, 4, 4, 6][tier] ?? 4, bubble: tier >= 3 };
}

export interface Rider {
  readonly id: number;
  readonly jacket: string;
  /** Metres from the bottom station. */
  readonly d: number;
  readonly down: boolean;
  readonly selected: boolean;
}

export interface CarrierView {
  readonly at: (p: Vec2) => Vec2;
  readonly zoom: number;
  readonly view: View;
  /** Pixels per metre for people and carriers, which are drawn larger than life like the skiers. */
  readonly u: number;
}

export interface LiftLine {
  readonly type: LiftType;
  readonly tier: number;
  readonly bottom: Vec2;
  readonly top: Vec2;
  /** Metres per second along the cable. */
  readonly speed: number;
}

/** Cable offsets from the lift's centre line: one line for tows, an up and a down cable otherwise. */
export const cableGap = (type: LiftType): number => (type === 'ropeTow' ? 0 : type === 'gondola' ? 4 : 3);

/**
 * The moving parts of a lift: chairs, cabins or T-bars travelling at the lift's speed, up on one cable and
 * down the other, with the skiers riding them sitting in the seats.
 */
export function drawCarriers(ctx: CanvasRenderingContext2D, lift: LiftLine, time: number, v: CarrierView, riders: readonly Rider[], invalid = false): void {
  const length = dist(lift.bottom, lift.top);
  if (length === 0) return;
  const along = vec((lift.top.x - lift.bottom.x) / length, (lift.top.y - lift.bottom.y) / length);
  const side = vec(-along.y, along.x);
  const gap = cableGap(lift.type);
  const point = (s: number, d: number): Vec2 => v.at(vec(lift.bottom.x + side.x * s + along.x * d, lift.bottom.y + side.y * s + along.y * d));
  const onScreen = (c: Vec2, r: number): boolean => c.x > -r && c.y > -r && c.x < v.view.width + r && c.y < v.view.height + r;
  const color = invalid ? INVALID : LIFT_COLORS[lift.type];
  const carrier = carrierFor(lift.type, lift.tier);
  const u = v.u, up = Math.atan2(along.y, along.x);

  if (carrier.kind === 'rope') {
    // Tow riders hold the rope and slide up on their skis.
    for (const r of riders) {
      const c = point(0, r.d);
      if (onScreen(c, 4 * u)) rider(ctx, c, up, u, r, false);
    }
    return;
  }

  const spacing = SPACING[carrier.kind], shift = (time * lift.speed) % spacing;
  // T-bars only run up; chairs and cabins go up on the left cable and come down on the right.
  const lines = carrier.kind === 'tbar' ? [{ s: 0, start: shift, heading: up }] : [
    { s: -gap, start: shift, heading: up },
    { s: gap, start: spacing - shift, heading: up + Math.PI },
  ];
  for (const [i, line] of lines.entries()) {
    // Each rider takes a seat on the carrier nearest their place on the cable.
    const seated = new Map<number, Rider[]>();
    for (const r of riders) {
      if ((i === 1) !== r.down) continue;
      const k = Math.round((r.d - line.start) / spacing);
      seated.set(k, [...(seated.get(k) ?? []), r]);
    }
    for (let k = 0, d = line.start; d < length; k++, d += spacing) {
      const c = point(line.s, d);
      if (!onScreen(c, 6 * u)) continue;
      const aboard = seated.get(k) ?? [];
      if (v.zoom < DETAIL_ZOOM) {
        const box = Math.max(2, (carrier.kind === 'cabin' ? 3.5 : 2.2) * v.zoom);
        ctx.fillStyle = color;
        ctx.fillRect(c.x - box / 2, c.y - box / 2, box, box);
        continue;
      }
      if (carrier.kind === 'tbar') tbar(ctx, c, line.heading, u, aboard);
      else if (carrier.kind === 'chair') chair(ctx, c, line.heading, u, color, carrier.seats, carrier.bubble, aboard);
      else cabin(ctx, c, line.heading, u, color, carrier.seats, aboard);
    }
  }
}

/** Runs `paint` in a frame centred on `c` with +x along `heading`, then restores the canvas. */
function framed(ctx: CanvasRenderingContext2D, c: Vec2, heading: number, paint: () => void): void {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(heading);
  paint();
  ctx.restore();
}

/** A carrier's shadow on the snow, pushed south-east by the sun because it hangs high above. */
function hangingShadow(ctx: CanvasRenderingContext2D, c: Vec2, u: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(30, 40, 80, 0.16)';
  ctx.beginPath();
  ctx.ellipse(c.x + 4 * u, c.y + 4 * u, w, h, Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();
}

function rider(ctx: CanvasRenderingContext2D, c: Vec2, heading: number, u: number, r: Rider, seated: boolean): void {
  if (r.selected) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, u * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 183, 3, 0.4)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = SELECTED;
    ctx.stroke();
  }
  drawSkier(ctx, c, heading, u * (seated ? 0.8 : 1), r.jacket, seated, false, !seated);
}

function chair(ctx: CanvasRenderingContext2D, c: Vec2, heading: number, u: number, color: string, seats: number, bubble: boolean, aboard: readonly Rider[]): void {
  const pitch = 1.1 * u, width = seats * pitch, depth = 0.9 * u;
  hangingShadow(ctx, c, u, width * 0.5, depth * 0.6);
  framed(ctx, c, heading, () => {
    // Seat, then the backrest behind the riders, who face the way the chair travels.
    ctx.fillStyle = '#3b3f4a';
    ctx.fillRect(-depth / 2, -width / 2, depth, width);
    ctx.fillStyle = color;
    ctx.fillRect(-depth / 2 - 0.25 * u, -width / 2, 0.35 * u, width);
    // Riders' skis dangle forward off the seat.
    ctx.strokeStyle = '#20242c';
    ctx.lineWidth = Math.max(1, u * 0.22);
    ctx.beginPath();
    aboard.slice(0, seats).forEach((_, i) => {
      const y = (i - (seats - 1) / 2) * pitch;
      for (const ski of [-0.22, 0.22]) {
        ctx.moveTo(depth / 2, y + ski * u);
        ctx.lineTo(depth / 2 + 1.3 * u, y + ski * u);
      }
    });
    ctx.stroke();
  });
  aboard.slice(0, seats).forEach((r, i) => {
    const y = (i - (seats - 1) / 2) * pitch;
    rider(ctx, vec(c.x - Math.sin(heading) * y, c.y + Math.cos(heading) * y), heading, u, r, true);
  });
  if (bubble) {
    framed(ctx, c, heading, () => {
      ctx.fillStyle = 'rgba(120, 170, 230, 0.35)';
      ctx.beginPath();
      ctx.roundRect(-depth / 2, -width / 2 - 0.2 * u, depth + 1.6 * u, width + 0.4 * u, 0.6 * u);
      ctx.fill();
    });
  }
}

function cabin(ctx: CanvasRenderingContext2D, c: Vec2, heading: number, u: number, color: string, seats: number, aboard: readonly Rider[]): void {
  const length = (seats === 10 ? 2.7 : 2.4) * u, width = (seats === 10 ? 2.2 : 2) * u, inset = 0.2 * u;
  hangingShadow(ctx, c, u, length * 0.55, width * 0.45);
  framed(ctx, c, heading, () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-length / 2, -width / 2, length, width, 0.45 * u);
    ctx.fill();
    // Glass all round, with passengers on the two facing benches showing through at each end.
    ctx.fillStyle = 'rgba(28, 44, 70, 0.85)';
    ctx.beginPath();
    ctx.roundRect(-length / 2 + inset, -width / 2 + inset, length - inset * 2, width - inset * 2, 0.3 * u);
    ctx.fill();
    const perBench = seats / 2;
    aboard.slice(0, seats).forEach((r, i) => {
      const end = i % 2 === 0 ? -1 : 1, j = Math.floor(i / 2);
      ctx.fillStyle = r.selected ? SELECTED : r.jacket;
      ctx.beginPath();
      ctx.arc(end * (length / 2 - 0.5 * u), (j - (perBench - 1) / 2) * ((width - inset * 3) / perBench), 0.24 * u, 0, Math.PI * 2);
      ctx.fill();
    });
    // The roof covers the middle of the cabin, with the grip on top.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.beginPath();
    ctx.roundRect(-length / 2 + 0.85 * u, -width / 2 + inset, length - 1.7 * u, width - inset * 2, 0.25 * u);
    ctx.fill();
    ctx.fillStyle = '#3b3f4a';
    ctx.fillRect(-0.25 * u, -0.25 * u, 0.5 * u, 0.5 * u);
  });
}

function tbar(ctx: CanvasRenderingContext2D, c: Vec2, heading: number, u: number, aboard: readonly Rider[]): void {
  // Two riders lean back against the bar, one either side of the stem, sliding on their skis.
  aboard.slice(0, 2).forEach((r, i) => {
    const y = (i === 0 ? -0.75 : 0.75) * u, x = -0.5 * u;
    rider(ctx, vec(c.x + Math.cos(heading) * x - Math.sin(heading) * y, c.y + Math.sin(heading) * x + Math.cos(heading) * y), heading, u, r, false);
  });
  framed(ctx, c, heading, () => {
    ctx.strokeStyle = '#3b3f4a';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, 0.25 * u);
    ctx.beginPath();
    ctx.moveTo(0, -1.3 * u);
    ctx.lineTo(0, 1.3 * u);
    ctx.stroke();
  });
}

/** How fast a lift preview's carriers move: the base speed for its type, since it has no tier yet. */
export const baseSpeed = (type: LiftType): number => CONFIG.lifts[type].speed;
