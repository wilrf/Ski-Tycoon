import { dist, lerp, vec, type Vec2 } from '../sim/geometry';

export interface PointerHandlers {
  pan(dx: number, dy: number): void;
  zoom(factor: number, at: Vec2): void;
  tap(at: Vec2): void;
  /** Mouse position with no button held, or null when it leaves. Touch never hovers. */
  hover(at: Vec2 | null): void;
  /** Whether a one-finger or left-button drag should draw instead of pan right now. */
  drawing(): boolean;
  stroke(phase: 'start' | 'move' | 'end' | 'cancel', at: Vec2): void;
}

/** Movement under this many pixels still counts as a tap, so shaky fingers can build. */
const TAP_SLOP = 8;

/**
 * One finger or mouse drag pans, two fingers pinch-zoom and pan, the wheel zooms at the cursor,
 * and a press that barely moves is a tap. While drawing (the run tool), one finger or the left button
 * draws instead, and two fingers or the right or middle button still pan.
 * Pointer Events cover mouse, touch and pen in one path.
 */
export function attachPointer(el: HTMLElement, h: PointerHandlers): void {
  const pointers = new Map<number, Vec2>();
  let travelled = 0;
  let multiTouch = false;
  let drawButton = false;
  let stroking = false;
  const local = (e: PointerEvent | WheelEvent): Vec2 => {
    const r = el.getBoundingClientRect();
    return vec(e.clientX - r.left, e.clientY - r.top);
  };

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      travelled = 0;
      drawButton = e.button === 0 && h.drawing();
    }
    multiTouch ||= pointers.size > 1;
    if (multiTouch && stroking) {
      stroking = false;
      h.stroke('cancel', local(e));
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = local(e);
    const last = pointers.get(e.pointerId);
    if (!last) return h.hover(e.pointerType === 'mouse' ? p : null);
    if (pointers.size === 1 && !multiTouch) {
      travelled += dist(last, p);
      if (travelled <= TAP_SLOP) {
        // Not a drag yet.
      } else if (drawButton && !stroking) {
        stroking = true;
        h.stroke('start', last);
        h.stroke('move', p);
      } else if (stroking) h.stroke('move', p);
      else h.pan(p.x - last.x, p.y - last.y);
    } else if (pointers.size === 2) {
      const other = [...pointers].find(([id]) => id !== e.pointerId)![1];
      const before = lerp(last, other, 0.5), after = lerp(p, other, 0.5);
      h.zoom(dist(p, other) / Math.max(1, dist(last, other)), after);
      h.pan(after.x - before.x, after.y - before.y);
    }
    pointers.set(e.pointerId, p);
  });

  const release = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (stroking && pointers.size === 0) {
      stroking = false;
      h.stroke(e.type === 'pointerup' ? 'end' : 'cancel', local(e));
    } else if (e.type === 'pointerup' && pointers.size === 0 && !multiTouch && travelled <= TAP_SLOP) h.tap(local(e));
    if (pointers.size === 0) multiTouch = false;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && h.hover(null));

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    h.zoom(Math.exp(-e.deltaY * 0.0015), local(e));
  }, { passive: false });
}
