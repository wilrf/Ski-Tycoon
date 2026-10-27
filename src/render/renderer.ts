import { CONFIG, type Level, type LiftType } from '../config';
import { dist, lerp, pointAlong, polylineLength, vec, type Vec2 } from '../sim/geometry';
import type { Lift } from '../sim/lifts';
import { profileRun } from '../sim/runs';
import { terrainExtent } from '../sim/terrain';
import { activeResort, type World } from '../sim/world';
import { pendingLiftPlan, pendingRunPoints, type UiState } from '../ui/tools';
import { toScreen, toWorld, type Camera, type View } from './camera';
import { INVALID, JACKETS, LEVEL_COLORS, LIFT_COLORS, SELECTED } from './colors';
import { drawRun as paintRun, type RunView } from './runArt';
import { pine, type TerrainArt } from './terrainArt';

export interface Frame {
  readonly world: World;
  readonly ui: UiState;
  readonly camera: Camera;
  readonly view: View;
  readonly terrain: TerrainArt;
  /** Skier positions before the latest tick, and how far (0 to 1) the frame is toward the next tick. */
  readonly previous: ReadonlyMap<number, Vec2>;
  readonly alpha: number;
}

const TOWER_SPACING = 70;
const CARRIER_SPACING: Record<LiftType, number> = { ropeTow: 12, chairlift: 22, gondola: 45 };
const UI_FONT = '"Nunito", system-ui, sans-serif';
const VECTOR_TREE_ZOOM = 1.2;

export function draw(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { world, ui, camera, view } = f;
  const resort = activeResort(world);
  const at = (p: Vec2): Vec2 => toScreen(camera, view, p);
  /** A world size in pixels, never smaller than minPx so things stay visible when zoomed out. */
  const px = (m: number, minPx: number): number => Math.max(minPx, m * camera.zoom);
  const isSelected = (kind: 'lift' | 'run' | 'skier', id: number): boolean => ui.selection?.kind === kind && ui.selection.id === id;
  const time = world.calendar.time + f.alpha * CONFIG.loop.gameSecondsPerTick;

  const sky = ctx.createLinearGradient(0, 0, 0, view.height);
  sky.addColorStop(0, '#2b4c7e');
  sky.addColorStop(1, '#8fb3d9');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, view.width, view.height);
  const origin = at(vec(0, 0));
  const size = terrainExtent(resort.terrain) * camera.zoom;
  ctx.shadowColor = 'rgba(10, 20, 50, 0.45)';
  ctx.shadowBlur = 30;
  // Close up, the baked trees would blur, so draw the visible ones as vectors over the bare ground.
  const vectorTrees = camera.zoom >= VECTOR_TREE_ZOOM;
  ctx.drawImage(vectorTrees ? f.terrain.ground : f.terrain.withTrees, origin.x, origin.y, size, size);
  ctx.shadowColor = 'transparent';
  if (vectorTrees) {
    const min = toWorld(camera, view, vec(-20, -20)), max = toWorld(camera, view, vec(view.width + 20, view.height + 20));
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(camera.zoom, camera.zoom);
    for (const tree of f.terrain.trees) if (tree.x > min.x && tree.x < max.x && tree.y > min.y && tree.y < max.y) pine(ctx, tree);
    ctx.restore();
  }

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

  const runView: RunView = {
    zoom: camera.zoom,
    at,
    min: toWorld(camera, view, vec(0, 0)),
    max: toWorld(camera, view, vec(view.width, view.height)),
  };
  const drawRun = (points: readonly Vec2[], level: Level, outline: string | null): void => paintRun(ctx, points, level, outline, runView);
  for (const run of resort.runs) drawRun(run.points, run.profile.difficulty, isSelected('run', run.id) ? SELECTED : null);

  for (const lift of resort.lifts) drawLift(lift, isSelected('lift', lift.id));

  function drawLift(lift: Pick<Lift, 'type' | 'bottom' | 'top'>, selected: boolean, invalid = false): void {
    const length = dist(lift.bottom, lift.top);
    if (length === 0) return;
    const along = vec((lift.top.x - lift.bottom.x) / length, (lift.top.y - lift.bottom.y) / length);
    const side = vec(-along.y, along.x);
    const offset = (p: Vec2, s: number, a = 0): Vec2 => vec(p.x + side.x * s + along.x * a, p.y + side.y * s + along.y * a);
    const color = invalid ? INVALID : LIFT_COLORS[lift.type];
    const gap = lift.type === 'ropeTow' ? 0 : lift.type === 'gondola' ? 4 : 3;
    if (selected) {
      path([lift.bottom, lift.top]);
      stroke(SELECTED, px(gap * 2 + 8, 10));
    }
    for (let d = TOWER_SPACING / 2; d < length; d += TOWER_SPACING) {
      const t = at(offset(lift.bottom, 0, d)), a = at(offset(lift.bottom, -gap - 1.5, d)), b = at(offset(lift.bottom, gap + 1.5, d));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      stroke('#3b3f4a', px(1.5, 1.5));
      ctx.fillStyle = '#3b3f4a';
      ctx.fillRect(t.x - 1.5, t.y - 1.5, 3, 3);
    }
    // Carriers go up on one cable and down the other, moving at the lift's speed.
    const spacing = CARRIER_SPACING[lift.type], shift = (time * CONFIG.lifts[lift.type].speed) % spacing;
    for (const s of gap === 0 ? [0] : [-gap, gap]) {
      path([offset(lift.bottom, s), offset(lift.top, s)]);
      stroke('#2b2f38', px(0.6, 1));
      if (camera.zoom < 0.6 || lift.type === 'ropeTow') continue;
      const box = px(lift.type === 'gondola' ? 3.5 : 2.2, 2);
      for (let d = s < 0 ? shift : spacing - shift; d < length; d += spacing) {
        const c = at(offset(lift.bottom, s, d));
        ctx.fillStyle = color;
        ctx.fillRect(c.x - box / 2, c.y - box / 2, box, box);
      }
    }
    for (const [station, dir] of [[lift.bottom, -1], [lift.top, 1]] as const) {
      const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([s, a]) => at(offset(station, s! * (gap + 5), dir * a! * 9 - dir * 3)));
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  // Previews for the active build tool.
  if (ui.tool.kind === 'lift') {
    // The longest lift of this type the company can pay for, so the player knows their reach before committing.
    const spec = CONFIG.lifts[ui.tool.liftType];
    const reach = Math.min(spec.maxLength, Math.max(0, (world.company.money - spec.baseCost) / spec.costPerMetre));
    const affordable = reach >= CONFIG.liftRules.minLength;
    const { bottom } = ui.tool;
    if (bottom && affordable) {
      const c = at(bottom);
      ctx.beginPath();
      ctx.arc(c.x, c.y, reach * camera.zoom, 0, Math.PI * 2);
      stroke('rgba(255, 255, 255, 0.85)', 2, [8, 6]);
    }
    const plan = pendingLiftPlan(world, ui);
    if (plan) {
      drawLift(plan, false, plan.problems.length > 0);
      tag(ctx, at(plan.top), `${Math.round(plan.length)} m · ↑${Math.round(plan.rise)} m · $${plan.cost.toLocaleString('en-US')}`, plan.cost > world.company.money);
    } else if (ui.hover || bottom) {
      const where = at(ui.hover ?? bottom!);
      tag(ctx, where, affordable ? `${spec.label}: up to ${Math.round(reach)} m for $${Math.floor(world.company.money).toLocaleString('en-US')}` : `Can't afford a ${spec.label.toLowerCase()} yet`, !affordable);
    }
    if (bottom) marker(ctx, at(bottom), LIFT_COLORS[ui.tool.liftType]);
  }
  const runPoints = pendingRunPoints(world, ui);
  if (runPoints.length > 0) {
    const profile = profileRun(resort.terrain, runPoints);
    if (runPoints.length > 1) drawRun(runPoints, profile.difficulty, 'rgba(255, 183, 3, 0.6)');
    // Only the ends get markers: a drag-drawn run has a point every few metres.
    const last = runPoints[runPoints.length - 1]!;
    marker(ctx, at(runPoints[0]!), LEVEL_COLORS[profile.difficulty]);
    if (runPoints.length > 1) {
      marker(ctx, at(last), LEVEL_COLORS[profile.difficulty]);
      tag(ctx, at(last), `${Math.round(polylineLength(runPoints))} m · ↓${Math.round(profile.vertical)} m`);
    }
  }

  for (const s of resort.skiers) {
    const prev = f.previous.get(s.id);
    const pos = prev ? lerp(prev, s.pos, f.alpha) : s.pos;
    const p = at(pos);
    if (p.x < -20 || p.y < -20 || p.x > view.width + 20 || p.y > view.height + 20) continue;
    if (prev && dist(prev, s.pos) > 0.05) headings.set(s.id, Math.atan2(s.pos.y - prev.y, s.pos.x - prev.x));
    const riding = s.state.kind === 'riding';
    // Figures are drawn at 1.6× life size so they read as people at every zoom.
    drawSkier(ctx, p, headings.get(s.id) ?? Math.PI / 2, px(1.6, 1.8), JACKETS[s.id % JACKETS.length]!, riding, isSelected('skier', s.id));
  }
  // Forget headings of skiers who have gone home.
  if (headings.size > resort.skiers.length * 2 + 100) {
    const here = new Set(resort.skiers.map((s) => s.id));
    for (const id of headings.keys()) if (!here.has(id)) headings.delete(id);
  }

  // Trail-map labels once zoomed in far enough to read them.
  if (camera.zoom > 0.45) {
    for (const run of resort.runs) {
      const p = at(pointAlong(run.points, Math.min(60, run.profile.length / 3)));
      difficultySymbol(ctx, vec(p.x + 14, p.y), run.profile.difficulty, 6);
      mapLabel(ctx, vec(p.x + 24, p.y), run.name);
    }
    for (const lift of resort.lifts) mapLabel(ctx, at(lerp(lift.bottom, lift.top, 0.5)), lift.name, true);
  }
}

const headings = new Map<number, number>();

/**
 * A skier seen from above, `u` pixels per metre and facing `heading`: skis and poles, a jacket and a helmet,
 * with a shadow to the south-east. Riders sit without skis showing.
 */
function drawSkier(ctx: CanvasRenderingContext2D, p: Vec2, heading: number, u: number, jacket: string, riding: boolean, selected: boolean): void {
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
  ctx.fillStyle = 'rgba(30, 40, 80, 0.3)';
  ctx.beginPath();
  ctx.ellipse(u * 0.9, u * 0.9, u * 1.1, u * 0.7, Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(heading);
  if (!riding) {
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
  ctx.restore();
}

/** The standard ski-area symbols: green circle, blue square, black diamond, double black diamond. */
export function difficultySymbol(ctx: CanvasRenderingContext2D, c: Vec2, level: Level, r: number): void {
  ctx.fillStyle = LEVEL_COLORS[level];
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  const diamond = (x: number): void => {
    ctx.beginPath();
    ctx.moveTo(x, c.y - r * 1.2);
    ctx.lineTo(x + r, c.y);
    ctx.lineTo(x, c.y + r * 1.2);
    ctx.lineTo(x - r, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  ctx.beginPath();
  if (level === 0) ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  if (level === 1) ctx.rect(c.x - r * 0.9, c.y - r * 0.9, r * 1.8, r * 1.8);
  if (level <= 1) {
    ctx.fill();
    ctx.stroke();
  }
  if (level === 2) diamond(c.x);
  if (level === 3) [-r * 0.9, r * 0.9].forEach((dx) => diamond(c.x + dx));
}

function mapLabel(ctx: CanvasRenderingContext2D, p: Vec2, text: string, italic = false): void {
  ctx.font = `${italic ? 'italic ' : ''}800 12px ${UI_FONT}`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeText(text, p.x, p.y + 4);
  ctx.fillStyle = '#1d2a44';
  ctx.fillText(text, p.x, p.y + 4);
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

/** A dark rounded tag for build previews; red when it carries a warning. */
function tag(ctx: CanvasRenderingContext2D, p: Vec2, text: string, warning = false): void {
  ctx.font = `700 12px ${UI_FONT}`;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = warning ? 'rgba(180, 35, 50, 0.92)' : 'rgba(23, 35, 61, 0.9)';
  ctx.beginPath();
  ctx.roundRect(p.x + 10, p.y - 24, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, p.x + 16, p.y - 9);
}
