import { CONFIG, type Level } from '../config';
import { lerp, pointAlong, polylineLength, type Vec2 } from '../sim/geometry';
import { profileRun } from '../sim/runs';
import { terrainExtent } from '../sim/terrain';
import { activeResort, type World } from '../sim/world';
import { pendingLiftPlan, pendingRunPoints, type UiState } from '../ui/tools';
import { toScreen, type Camera, type View } from './camera';
import { LEVEL_COLORS, LIFT_COLORS, SELECTED } from './colors';


export interface Frame {
  readonly world: World;
  readonly ui: UiState;
  readonly camera: Camera;
  readonly view: View;
  readonly terrainImage: HTMLCanvasElement;
  /** Skier positions before the latest tick, and how far (0 to 1) the frame is toward the next tick. */
  readonly previous: ReadonlyMap<number, Vec2>;
  readonly alpha: number;
}

export function draw(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { world, ui, camera, view } = f;
  const resort = activeResort(world);
  const at = (p: Vec2): Vec2 => toScreen(camera, view, p);
  const metres = (m: number, minPx: number): number => Math.max(minPx, m * camera.zoom);
  const isSelected = (kind: 'lift' | 'run' | 'skier', id: number): boolean => ui.selection?.kind === kind && ui.selection.id === id;

  ctx.fillStyle = '#c9d3dd';
  ctx.fillRect(0, 0, view.width, view.height);
  const origin = at({ x: 0, y: 0 });
  const size = terrainExtent(resort.terrain) * camera.zoom;
  ctx.imageSmoothingEnabled = camera.zoom < 1.5;
  ctx.drawImage(f.terrainImage, origin.x, origin.y, size, size);

  const path = (points: readonly Vec2[]): void => {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(at(p).x, at(p).y) : ctx.lineTo(at(p).x, at(p).y)));
  };
  const stroke = (color: string, width: number, dash: number[] = []): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  ctx.lineCap = ctx.lineJoin = 'round';

  const drawRun = (points: readonly Vec2[], level: Level, highlight: boolean): void => {
    const width = metres(10, 3);
    path(points);
    if (highlight) stroke(SELECTED, width + 6);
    stroke(LEVEL_COLORS[level], width);
    // Double blacks get a dashed white core so they read differently from blacks.
    if (level === 3) stroke('#ffffff', width / 3, [width, width]);
  };
  for (const run of resort.runs) drawRun(run.points, run.profile.difficulty, isSelected('run', run.id));

  for (const lift of resort.lifts) {
    path([lift.bottom, lift.top]);
    if (isSelected('lift', lift.id)) stroke(SELECTED, metres(4, 3) + 6);
    stroke(LIFT_COLORS[lift.type], metres(lift.type === 'gondola' ? 4 : 2.5, 2), lift.type === 'ropeTow' ? [6, 4] : []);
    for (const station of [lift.bottom, lift.top]) {
      const s = at(station), r = metres(6, 4);
      ctx.fillStyle = LIFT_COLORS[lift.type];
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
  }

  // Previews for the active build tool.
  const plan = pendingLiftPlan(world, ui);
  if (plan) {
    path([plan.bottom, plan.top]);
    stroke(plan.problems.length > 0 ? '#d62828' : LIFT_COLORS[plan.type], 3, [8, 6]);
    label(ctx, at(plan.top), `${Math.round(plan.length)} m · ↑${Math.round(plan.rise)} m · $${plan.cost.toLocaleString('en-US')}`);
  }
  if (ui.tool.kind === 'lift' && ui.tool.bottom) marker(ctx, at(ui.tool.bottom), LIFT_COLORS[ui.tool.liftType]);
  const runPoints = pendingRunPoints(world, ui);
  if (runPoints.length > 0) {
    const profile = profileRun(resort.terrain, runPoints);
    if (runPoints.length > 1) drawRun(runPoints, profile.difficulty, false);
    runPoints.forEach((p) => marker(ctx, at(p), LEVEL_COLORS[profile.difficulty]));
    if (runPoints.length > 1) label(ctx, at(runPoints[runPoints.length - 1]!), `${Math.round(polylineLength(runPoints))} m · ↓${Math.round(profile.vertical)} m`);
  }

  const radius = metres(2.5, 2.5);
  for (const s of resort.skiers) {
    const prev = f.previous.get(s.id);
    const p = at(prev ? lerp(prev, s.pos, f.alpha) : s.pos);
    if (p.x < -10 || p.y < -10 || p.x > view.width + 10 || p.y > view.height + 10) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, isSelected('skier', s.id) ? radius * 2 : radius, 0, Math.PI * 2);
    ctx.fillStyle = LEVEL_COLORS[s.skill];
    ctx.fill();
    ctx.lineWidth = isSelected('skier', s.id) ? 3 : 1;
    ctx.strokeStyle = isSelected('skier', s.id) ? SELECTED : s.happiness < CONFIG.skiers.fedUpHappiness + 10 ? '#d62828' : '#ffffff';
    ctx.stroke();
  }

  // Names once zoomed in far enough to read them.
  if (camera.zoom > 0.9) {
    for (const run of resort.runs) label(ctx, at(pointAlong(run.points, run.profile.length / 2)), run.name, 0.8);
    for (const lift of resort.lifts) label(ctx, at(lerp(lift.bottom, lift.top, 0.5)), lift.name, 0.8);
  }
}

function marker(ctx: CanvasRenderingContext2D, p: Vec2, color: string): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, p: Vec2, text: string, opacity = 1): void {
  ctx.font = '600 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.globalAlpha = opacity;
  ctx.fillStyle = 'rgba(20, 28, 38, 0.85)';
  ctx.beginPath();
  ctx.roundRect(p.x + 10, p.y - 22, w, 20, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, p.x + 15, p.y - 8);
  ctx.globalAlpha = 1;
}
