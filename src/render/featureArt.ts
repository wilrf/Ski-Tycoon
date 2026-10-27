import type { FeatureType } from '../config';
import { pointAlong, vec, type Vec2 } from '../sim/geometry';
import type { Run } from '../sim/runs';
import { RUN_WIDTH } from './runArt';
import { FEATURE_SHAPES } from './skierMotion';

const HALF = RUN_WIDTH / 2;
const SNOW = '#fbfcff';
const SHADE = 'rgba(110, 128, 175, 0.5)';
/** Cast shadows fall down and to the right, like the trees'. */
const CAST = 'rgba(70, 88, 135, 0.3)';
const castFrom = (at: (p: Vec2) => Vec2, height: number) => (p: Vec2): Vec2 => at(vec(p.x + height * 0.7, p.y + height * 0.7));
const EDGE = 'rgba(95, 112, 155, 0.7)';
/** Freestyle terrain is signed with an orange oval and S, M or L, as at real parks. */
const PARK_ORANGE = '#f77f00';
const JUMP_LETTER: Partial<Record<FeatureType, string>> = { smallJump: 'S', mediumJump: 'M', largeJump: 'L' };

/** A point `side` metres to the left of the run line, `d` metres down it. */
function place(run: Run, d: number, side: number): Vec2 {
  const a = pointAlong(run.points, Math.max(0, d - 0.5)), b = pointAlong(run.points, d + 0.5), here = pointAlong(run.points, d);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return vec(here.x - ((b.y - a.y) / len) * side, here.y + ((b.x - a.x) / len) * side);
}

/** Fills the patch of run between `from` and `to` metres down it, between `left` and `right` (functions of d). */
function patch(ctx: CanvasRenderingContext2D, run: Run, at: (p: Vec2) => Vec2, from: number, to: number, left: (d: number) => number, right: (d: number) => number, fill: string, stroke?: string): void {
  const steps = Math.max(2, Math.ceil((to - from) / 1.5));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const d = from + ((to - from) * i) / steps, p = at(place(run, d, left(d)));
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i--) {
    const d = from + ((to - from) * i) / steps, p = at(place(run, d, right(d)));
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

const flat = (side: number) => (): number => side;

/**
 * A feature drawn as the snow shapes it really is, sized in metres so skiers ride exactly what's drawn
 * (see FEATURE_SHAPES). The 'ground' pass goes under skiers; the 'roof' pass, the tunnel's top, goes over
 * them so they disappear inside it.
 */
export function drawFeature(ctx: CanvasRenderingContext2D, run: Run, type: FeatureType, from: number, at: (p: Vec2) => Vec2, zoom: number, pass: 'ground' | 'roof'): void {
  ctx.lineWidth = Math.max(0.75, 0.15 * zoom);
  ctx.lineJoin = 'round';
  if (pass === 'roof') {
    if (type === 'tunnel') tunnelRoof(ctx, run, from, at);
    return;
  }
  switch (type) {
    case 'rollers': {
      // Each roller lit on its uphill face and shaded on the downhill face, across the whole run.
      const { length, spacing } = FEATURE_SHAPES.rollers, w = HALF - 1;
      for (let crest = from + spacing / 2; crest < from + length; crest += spacing) {
        patch(ctx, run, at, crest - spacing / 2 + 0.5, crest, flat(-w), flat(w), SNOW);
        patch(ctx, run, at, crest, crest + spacing / 2 - 0.5, flat(-w), flat(w), SHADE);
      }
      return;
    }
    case 'berms': {
      // A banked wall on the outside of each swing, shaded on its steep inner face.
      const { length, spacing } = FEATURE_SHAPES.berms;
      for (let wall = spacing / 2; wall < length; wall += spacing) {
        const out = Math.sign(Math.sin((Math.PI * wall) / spacing)), c = from + wall;
        const bulge = (d: number): number => Math.cos(((d - c) / (spacing / 2 + 1)) * (Math.PI / 2));
        patch(ctx, run, at, c - spacing / 2 - 1, c + spacing / 2 + 1, (d) => out * (HALF - 4.5 * bulge(d)), (d) => out * (HALF - 2 * bulge(d)), SHADE);
        patch(ctx, run, at, c - spacing / 2 - 1, c + spacing / 2 + 1, (d) => out * (HALF - 2 * bulge(d)), flat(out * (HALF + 0.5)), SNOW, EDGE);
      }
      return;
    }
    case 'tunnel': {
      // The groomed track through, darkened where the tunnel's shadow falls just beyond each mouth.
      const { length, width } = FEATURE_SHAPES.tunnel;
      patch(ctx, run, at, from - 2, from + length + 2, flat(-width / 2), flat(width / 2), 'rgba(23, 35, 61, 0.18)');
      return;
    }
    default: {
      // A tabletop: run-in ramp up to the lip, flat deck (the gap to clear), then the landing slope.
      const shape = FEATURE_SHAPES[type], hw = shape.width / 2, deck = shape.length * 0.6;
      const lip = from + 0.6, land = from + shape.length + 4;
      patch(ctx, run, castFrom(at, shape.peak * 0.6), from - 2, from + deck + 2, flat(-hw), flat(hw), CAST);
      patch(ctx, run, at, from - 5, lip, flat(-hw), flat(hw), SNOW, EDGE);
      patch(ctx, run, at, lip, from + deck, flat(-hw), flat(hw), '#e6ecf7', EDGE);
      patch(ctx, run, at, from + deck, land, (d) => -hw - (d - from - deck) * 0.15, (d) => hw + (d - from - deck) * 0.15, SNOW, EDGE);
      // The lip's shadow falls on the deck just below it.
      patch(ctx, run, at, lip, lip + 1.2 + shape.peak * 0.4, flat(-hw), flat(hw), SHADE);
      sign(ctx, at(place(run, from - 4, hw + 2.5)), JUMP_LETTER[type] ?? '', zoom);
    }
  }
}

function tunnelRoof(ctx: CanvasRenderingContext2D, run: Run, from: number, at: (p: Vec2) => Vec2): void {
  const { length, width } = FEATURE_SHAPES.tunnel, hw = width / 2 + 1;
  // A rounded snow dome, banded in family-zone orange at each mouth.
  const round = (d: number): number => hw * Math.sqrt(Math.max(0.35, 1 - Math.pow((d - from - length / 2) / (length / 2 + 0.5), 8)));
  patch(ctx, run, castFrom(at, 3), from, from + length, (d) => -round(d), round, CAST);
  patch(ctx, run, at, from, from + length, (d) => -round(d), round, SNOW, EDGE);
  patch(ctx, run, at, from + 1.2, from + length - 1.2, (d) => -round(d) * 0.35, (d) => round(d) * 0.35, 'rgba(125, 143, 184, 0.18)');
  patch(ctx, run, at, from, from + 1.2, (d) => -round(d), round, PARK_ORANGE);
  patch(ctx, run, at, from + length - 1.2, from + length, (d) => -round(d), round, PARK_ORANGE);
}

/** The orange oval sign beside a jump's run-in. */
function sign(ctx: CanvasRenderingContext2D, p: Vec2, letter: string, zoom: number): void {
  const r = Math.max(4, 1.6 * zoom);
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * 1.25, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = PARK_ORANGE;
  ctx.fill();
  ctx.strokeStyle = 'rgba(23, 35, 61, 0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (r < 5) return;
  ctx.font = `800 ${Math.round(r * 1.3)}px "Nunito", system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, p.x, p.y + 1);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
