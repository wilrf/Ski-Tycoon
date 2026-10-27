/**
 * Small pictures painted once and then stamped with drawImage, which is much cheaper than redrawing
 * the same shapes for every tree and skier on every frame. Callers bucket their keys (size, heading,
 * variant) so a few hundred sprites cover everything on screen.
 */
const sprites = new Map<string, HTMLCanvasElement>();
/** Zooming through many sizes would grow the cache forever; past this it starts over. */
const LIMIT = 3000;

export function sprite(key: string, size: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let canvas = sprites.get(key);
  if (!canvas) {
    if (sprites.size >= LIMIT) sprites.clear();
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.max(1, Math.ceil(size));
    paint(canvas.getContext('2d')!);
    sprites.set(key, canvas);
  }
  return canvas;
}

/** Rounds a scale to steps of about 6%, so smooth zooming reuses sprites instead of painting new ones. */
export const scaleBucket = (scale: number): number => Math.pow(1.06, Math.round(Math.log(scale) / Math.log(1.06)));
