import { CONFIG, type BuildingType } from '../config';
import { lerp, projectOnPolyline, vec, type Vec2 } from '../sim/geometry';
import { landEdge } from '../sim/progress';
import { featureProblem, gradeToDifficulty } from '../sim/runs';
import { drawFeature } from './featureArt';
import { cellGrade, terrainExtent, type Terrain } from '../sim/terrain';
import { activeResort, buildingProblemsHere, heldLifts, runStartAt } from '../sim/world';
import { money } from '../ui/format';
import { toScreen } from './camera';
import type { Frame } from './renderer';

/**
 * Gameplay layers drawn on top of the map: the slope guide while drawing a run, land the resort hasn't
 * bought, lodges and huts, wind holds and falling snow.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { world, ui, camera, view } = f;
  const resort = activeResort(world);
  const at = (p: Vec2): Vec2 => toScreen(camera, view, p);
  const extent = terrainExtent(resort.terrain);
  const origin = at(vec(0, 0));

  if (ui.tool.kind === 'run') {
    ctx.globalAlpha = 0.33;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(slopeGuide(resort.terrain), origin.x, origin.y, extent * camera.zoom, extent * camera.zoom);
    ctx.globalAlpha = 1;
    // Before the first point, ring every lift top a run can start from, and show where a press would snap.
    if (ui.tool.points.length === 0) {
      for (const l of resort.lifts) ring(ctx, at(l.top), 14, 'rgba(255, 255, 255, 0.9)');
      const snap = ui.hover && runStartAt(world, ui.hover);
      if (snap) ring(ctx, at(snap), 9, '#ffb703', true);
    }
  }

  // Land that isn't bought yet is under cloud, with what it costs to open it up.
  const edge = landEdge(resort);
  if (edge > 0) {
    const bottom = at(vec(0, edge)).y;
    const fog = ctx.createLinearGradient(0, bottom - 60, 0, bottom);
    fog.addColorStop(0, 'rgba(225, 232, 245, 0.78)');
    fog.addColorStop(1, 'rgba(225, 232, 245, 0.35)');
    ctx.fillStyle = fog;
    ctx.fillRect(origin.x, origin.y, extent * camera.zoom, bottom - origin.y);
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = 'rgba(23, 35, 61, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(origin.x, bottom);
    ctx.lineTo(origin.x + extent * camera.zoom, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    const next = CONFIG.land[resort.land]!;
    // Just above the edge, unless that's under the HUD; then just below it.
    pill(ctx, vec(view.width / 2, bottom > 190 ? bottom - 20 : bottom + 20), `🔒 ${next.name} · ${next.stars}★ · ${money(next.cost)}`);
  }

  if (ui.tool.kind === 'feature' && ui.hover) {
    const { featureType, runId } = ui.tool;
    const run = resort.runs.find((r) => r.id === runId);
    if (run) {
      const spot = projectOnPolyline(ui.hover, run.points);
      ctx.globalAlpha = featureProblem(run, featureType, spot.at) ? 0.35 : 0.85;
      drawFeature(ctx, run, featureType, spot.at, at, camera.zoom, 'ground');
      drawFeature(ctx, run, featureType, spot.at, at, camera.zoom, 'roof');
      ctx.globalAlpha = 1;
    }
  }

  for (const b of resort.buildings) building(ctx, at(b.pos), b.type, b.name, camera.zoom, ui.selection?.kind === 'building' && ui.selection.id === b.id);
  if (ui.tool.kind === 'building') {
    const p = ui.tool.pos ?? ui.hover;
    if (p) {
      ctx.globalAlpha = buildingProblemsHere(world, ui.tool.buildingType, p).length > 0 ? 0.4 : 0.85;
      building(ctx, at(p), ui.tool.buildingType, CONFIG.buildings[ui.tool.buildingType].label, camera.zoom, false);
      ctx.globalAlpha = 1;
    }
  }

  for (const id of heldLifts(world, resort)) {
    const lift = resort.lifts.find((l) => l.id === id)!;
    pill(ctx, at(lerp(lift.bottom, lift.top, 0.35)), '🌬️ Wind hold');
  }

  const weather = CONFIG.weather.kinds[world.weather.today];
  if (world.weather.today === 'storm' || world.weather.today === 'powder') snow(ctx, view.width, view.height, world.calendar.time, weather.windHold ? 160 : 60);
}

const GUIDE_COLORS = ['rgba(31, 157, 85, 1)', 'rgba(29, 111, 224, 1)', 'rgba(21, 24, 29, 1)', 'rgba(214, 40, 40, 1)'];
const guides = new WeakMap<Terrain, HTMLCanvasElement>();

/** Each terrain cell tinted by the run colour its slope would give, so runs can be aimed at a difficulty. */
function slopeGuide(t: Terrain): HTMLCanvasElement {
  const cached = guides.get(t);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = t.size;
  const g = canvas.getContext('2d')!;
  for (let cy = 0; cy < t.size; cy++) for (let cx = 0; cx < t.size; cx++) {
    g.fillStyle = GUIDE_COLORS[gradeToDifficulty(cellGrade(t, cx, cy))]!;
    g.fillRect(cx, cy, 1, 1);
  }
  guides.set(t, canvas);
  return canvas;
}

function building(ctx: CanvasRenderingContext2D, p: Vec2, type: BuildingType, name: string, zoom: number, selected: boolean): void {
  const r = Math.max(9, 14 * zoom);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = type === 'lodge' ? '#7a4a2a' : '#5b3a8a';
  ctx.fill();
  ctx.lineWidth = selected ? 4 : 2;
  ctx.strokeStyle = selected ? '#ffb703' : '#ffffff';
  ctx.stroke();
  ctx.font = `${Math.round(r * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(type === 'lodge' ? '🏠' : '🛖', p.x, p.y + 1);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  if (zoom > 0.45) pill(ctx, vec(p.x, p.y + r + 12), name);
}

function ring(ctx: CanvasRenderingContext2D, c: Vec2, r: number, color: string, fill = false): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.setLineDash(fill ? [] : [4, 4]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = fill ? '#17233d' : color;
  ctx.stroke();
  ctx.setLineDash([]);
}

function pill(ctx: CanvasRenderingContext2D, c: Vec2, text: string): void {
  ctx.font = '800 12px "Nunito", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = 'rgba(23, 35, 61, 0.88)';
  ctx.beginPath();
  ctx.roundRect(c.x - w / 2, c.y - 11, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#fdf8ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.x, c.y + 1);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/** Screen-space snowflakes drifting with game time, so they pause with the game. */
function snow(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, count: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  for (let i = 0; i < count; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const x = ((seed / 233280) * w + time * 0.4 * (1 + (i % 3))) % w;
    const y = (((i * 7919) % h) + time * (1.5 + (i % 4) * 0.5)) % h;
    ctx.fillRect(x, y, 1.5 + (i % 2), 1.5 + (i % 2));
  }
}
