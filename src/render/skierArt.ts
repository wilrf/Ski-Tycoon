import { vec, type Vec2 } from '../sim/geometry';
import { SELECTED } from './colors';
import { scaleBucket, sprite } from './sprites';

/**
 * On skis (side by side, in a snowplough wedge, or in a racer's tuck), sitting on a lift (skis hidden under
 * the chair), or walking with skis over the shoulder.
 */
export type Pose = 'skis' | 'wedge' | 'tuck' | 'seated' | 'walking';

/** Headings are snapped to this many directions for skier sprites; finer turns aren't visible at this size. */
const HEADINGS = 32;

/** Stamps a skier from a cached sprite; the selected skier is drawn live so its highlight can sit underneath. */
export function stampSkier(ctx: CanvasRenderingContext2D, p: Vec2, heading: number, u: number, jacket: string, pose: Pose, selected: boolean): void {
  if (selected) return drawSkier(ctx, p, heading, u, jacket, pose, true);
  const dpr = ctx.getTransform().a, scale = scaleBucket(u * dpr);
  const turn = (((Math.round((heading / (Math.PI * 2)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS);
  // The figure reaches about 2.2u from its centre (ski tips, shadow); 5u square leaves room.
  const image = sprite(`skier${jacket}${pose}${turn}:${scale}`, 5 * scale, (s) => {
    drawSkier(s, vec(2.5 * scale, 2.5 * scale), (turn / HEADINGS) * Math.PI * 2, scale, jacket, pose, false);
  });
  ctx.drawImage(image, p.x - 2.5 * u, p.y - 2.5 * u, 5 * u, 5 * u);
}

/**
 * A skier in the air: the shadow stays on the snow, pushed south-east by the sun as they rise, and the
 * figure grows a little as it nears the camera. `lift` is their height in pixels.
 */
export function airborne(ctx: CanvasRenderingContext2D, p: Vec2, heading: number, u: number, jacket: string, lift: number): void {
  ctx.fillStyle = 'rgba(30, 40, 80, 0.22)';
  ctx.beginPath();
  ctx.ellipse(p.x + u * 0.9 + lift * 0.7, p.y + u * 0.9 + lift * 0.7, u * 1.1, u * 0.7, Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();
  drawSkier(ctx, p, heading, u * (1 + lift / (u * 12)), jacket, 'skis', false, false);
}

/**
 * A skier seen from above, `u` pixels per metre and facing `heading`: skis and poles, a jacket and a helmet,
 * with a shadow to the south-east. Riders sit without skis showing; walkers carry theirs over a shoulder.
 */
export function drawSkier(ctx: CanvasRenderingContext2D, p: Vec2, heading: number, u: number, jacket: string, pose: Pose, selected: boolean, shadow = true): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (selected) {
    ctx.beginPath();
    ctx.arc(0, 0, u * 3.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 183, 3, 0.35)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = SELECTED;
    ctx.stroke();
  }
  if (shadow) {
    ctx.fillStyle = 'rgba(30, 40, 80, 0.3)';
    ctx.beginPath();
    ctx.ellipse(u * 0.9, u * 0.9, u * 1.1, u * 0.7, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.rotate(heading);
  if (pose === 'skis' || pose === 'wedge' || pose === 'tuck') {
    ctx.strokeStyle = '#20242c';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, u * 0.28);
    // A snowplough points the tips together and pushes the tails apart; a tuck keeps the skis tight.
    const tail = pose === 'wedge' ? 1.05 : pose === 'tuck' ? 0.28 : 0.38, tip = pose === 'wedge' ? 0.12 : tail;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-u * 1.6, side * tail * u);
      ctx.lineTo(u * 1.8, side * tip * u);
      ctx.stroke();
    }
    // Poles: planted out to the sides, or tucked back under the arms in a tuck.
    ctx.lineWidth = Math.max(0.6, u * 0.12);
    ctx.strokeStyle = '#8a8f99';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, side * u * 0.55);
      if (pose === 'tuck') ctx.lineTo(-u * 1.5, side * u * 0.45);
      else ctx.lineTo(-u * 1.1, side * u * 1.25);
      ctx.stroke();
    }
  }
  ctx.fillStyle = jacket;
  ctx.beginPath();
  // Crouched low in a tuck, the body is a smaller, rounder shape from above.
  if (pose === 'tuck') ctx.ellipse(-u * 0.05, 0, u * 0.5, u * 0.55, 0, 0, Math.PI * 2);
  else ctx.ellipse(-u * 0.1, 0, u * 0.55, u * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.stroke();
  ctx.fillStyle = '#f2efe9';
  ctx.beginPath();
  ctx.arc(u * 0.15, 0, u * 0.38, 0, Math.PI * 2);
  ctx.fill();
  if (pose === 'walking') {
    // A pair of skis resting on the right shoulder, tips forward and angled across the body.
    ctx.rotate(-0.5);
    ctx.strokeStyle = '#20242c';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, u * 0.22);
    for (const side of [0.42, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(-u * 1.5, side * u);
      ctx.lineTo(u * 1.9, side * u);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Snow kicked up by skiers. White on white snow would vanish, so each puff sits on a faint blue-grey
 * shadow offset to the south-east, matching the light on everything else.
 */
export function drawPuffs(ctx: CanvasRenderingContext2D, puffs: readonly { readonly pos: Vec2; readonly radius: number; readonly alpha: number }[], at: (p: Vec2) => Vec2, zoom: number): void {
  for (const pass of [0, 1]) {
    for (const puff of puffs) {
      const p = at(puff.pos), r = Math.max(0.8, puff.radius * zoom);
      ctx.globalAlpha = puff.alpha * (pass === 0 ? 0.7 : 1);
      ctx.fillStyle = pass === 0 ? '#7d8fb8' : '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x + (pass === 0 ? r * 0.4 : 0), p.y + (pass === 0 ? r * 0.4 : 0), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The fresh line behind a skier, fading with distance. Carvers leave two pencil-thin edge lines; skidders
 * smear one soft, wider track. Breaks where the skier was in the air.
 */
export function drawTrail(ctx: CanvasRenderingContext2D, poses: readonly { readonly pos: Vec2; readonly heading: number; readonly air: number }[], at: (p: Vec2) => Vec2, zoom: number, carving: boolean): void {
  const lines = carving ? [-0.35, 0.35] : [0];
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#7f92bd';
  ctx.lineWidth = carving ? Math.max(0.8, zoom * 0.25) : Math.max(1.5, zoom * 1.1);
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1]!, b = poses[i]!;
    if (a.air > 0 || b.air > 0) continue;
    ctx.globalAlpha = (carving ? 0.55 : 0.3) * (1 - i / poses.length);
    for (const offset of lines) {
      const pa = at(sideways(a, offset)), pb = at(sideways(b, offset));
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** A point `offset` metres to the left of a pose, for drawing each ski's edge. */
const sideways = (p: { readonly pos: Vec2; readonly heading: number }, offset: number): Vec2 =>
  vec(p.pos.x - Math.sin(p.heading) * offset, p.pos.y + Math.cos(p.heading) * offset);
