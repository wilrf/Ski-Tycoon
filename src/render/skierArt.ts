import { vec, type Vec2 } from '../sim/geometry';
import { SELECTED } from './colors';
import { scaleBucket, sprite } from './sprites';

/** On skis, sitting on a lift (skis hidden under the chair), or walking with skis over the shoulder. */
export type Pose = 'skis' | 'seated' | 'walking';

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
  if (pose === 'skis') {
    ctx.strokeStyle = '#20242c';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, u * 0.28);
    for (const side of [-0.38, 0.38]) {
      ctx.beginPath();
      ctx.moveTo(-u * 1.6, side * u);
      ctx.lineTo(u * 1.8, side * u);
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(0.6, u * 0.12);
    ctx.strokeStyle = '#8a8f99';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, side * u * 0.55);
      ctx.lineTo(-u * 1.1, side * u * 1.25);
      ctx.stroke();
    }
  }
  ctx.fillStyle = jacket;
  ctx.beginPath();
  ctx.ellipse(-u * 0.1, 0, u * 0.55, u * 0.75, 0, 0, Math.PI * 2);
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
