import { drawBaseBustle } from './baseArt';
import { drawnSkiers } from './crowd';
import { CONFIG, type Level } from '../config';
import { clamp, dist, lerp, pointAlong, polylineLength, vec, type Vec2 } from '../sim/geometry';
import { liftSpeed, rideSeconds, type Lift } from '../sim/lifts';
import { profileRun, snowOf, type Run } from '../sim/runs';
import type { Skier } from '../sim/skiers';
import { activeResort, type World } from '../sim/world';
import { pendingLiftPlan, pendingRunPoints, type UiState } from '../ui/tools';
import { SIN, toScreen, visibleBounds, type Camera, type View } from './camera';
import { drawTilted, SUNRISE } from './tilt';
import { INVALID, LEVEL_COLORS, LIFT_COLORS, SELECTED, skillJacket } from './colors';
import { drawRun as paintRun, type RunView } from './runArt';
import { baseSpeed, cableGap, drawCarriers, drawCorral, queueSlots, type CarrierView, type Rider } from './liftArt';
import { drawFeature } from './featureArt';
import { airborne, drawPuffs, drawTrail, stampSkier, type Pose } from './skierArt';
import { skiingPose, snowPuffs, trailPoses, type Stance } from './skierMotion';
import type { TerrainArt } from './terrainArt';

export interface Frame {
  readonly world: World;
  readonly ui: UiState;
  readonly camera: Camera;
  readonly view: View;
  readonly terrain: TerrainArt;
  /** Skier positions before the latest tick, and how far (0 to 1) the frame is toward the next tick. */
  readonly previous: ReadonlyMap<number, Vec2>;
  readonly alpha: number;
  /** Index into CONFIG.loop.speeds; fast speeds draw only a sample of skiers. */
  readonly speedIndex: number;
}

const TOWER_SPACING = 70;
const UI_FONT = '"Nunito", system-ui, sans-serif';
/** Snow spray is too small to see below this zoom, so it isn't worked out at all. */
const SPRAY_ZOOM = 1.2;
/** Trails are drawn for at most this many skiers, those nearest the middle of the screen. */
const MAX_TRAILS = 60;

/** Helpers bound to one canvas and camera, shared by the still and live layers. */
function painter(ctx: CanvasRenderingContext2D, camera: Camera, view: View) {
  const at = (p: Vec2): Vec2 => toScreen(camera, view, p);
  /** A world size in pixels, never smaller than minPx so things stay visible when zoomed out. */
  const px = (m: number, minPx: number): number => Math.max(minPx, m * camera.zoom);
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
  const runView: RunView = { zoom: camera.zoom, at, ...visibleBounds(camera, view) };
  const drawRun = (points: readonly Vec2[], level: Level, outline: string | null, wear = 0): void =>
    paintRun(ctx, points, level, outline, runView, wear);

  type LiftShape = Pick<Lift, 'type' | 'bottom' | 'top'>;
  const frameOf = (lift: LiftShape) => {
    const length = dist(lift.bottom, lift.top);
    const along = vec((lift.top.x - lift.bottom.x) / length, (lift.top.y - lift.bottom.y) / length);
    const side = vec(-along.y, along.x);
    const offset = (p: Vec2, s: number, a = 0): Vec2 => vec(p.x + side.x * s + along.x * a, p.y + side.y * s + along.y * a);
    const gap = cableGap(lift.type);
    return { length, offset, gap, cables: gap === 0 ? [0] : [-gap, gap] };
  };

  /** Towers, cables and stations: everything about a lift that doesn't move. */
  function liftStructure(lift: LiftShape, selected: boolean, invalid = false): void {
    if (dist(lift.bottom, lift.top) === 0) return;
    const { length, offset, gap, cables } = frameOf(lift);
    const color = invalid ? INVALID : LIFT_COLORS[lift.type];
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
    for (const s of cables) {
      path([offset(lift.bottom, s), offset(lift.top, s)]);
      stroke('#2b2f38', px(0.6, 1));
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

  return { at, px, stroke, drawRun, liftStructure };
}

const isSelected = (ui: UiState, kind: 'lift' | 'run' | 'skier', id: number): boolean => ui.selection?.kind === kind && ui.selection.id === id;

/**
 * The parts of the map that only change when the camera moves or something is built: terrain, trees,
 * runs and lift structures. They are painted once into an offscreen canvas and pasted every frame, which
 * is far cheaper than redrawing thousands of trees and snow marks.
 */
function drawStill(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { world, ui, camera, view } = f;
  const resort = activeResort(world);
  const { drawRun, liftStructure } = painter(ctx, camera, view);

  drawTilted(ctx, f.terrain.tilted, camera, view);

  ctx.lineCap = ctx.lineJoin = 'round';
  for (const run of resort.runs) drawRun(run.points, run.profile.difficulty, isSelected(ui, 'run', run.id) ? SELECTED : null, runWear(run));
  for (const lift of resort.lifts) liftStructure(lift, isSelected(ui, 'lift', lift.id));
}

/**
 * How skied-in each run looks, from 0 (fresh corduroy) to 1, by counting the different skiers who have
 * skied it today. Resets each morning, after the night's grooming. Cosmetic, so it lives here, not in the sim.
 */
const skiedBy = new Map<number, Set<number>>();
let wearDay = -1;
/** Skiers it takes to fully wear in a run. */
const FULL_WEAR = 30;

function noteSkiers(world: World): void {
  if (world.calendar.day !== wearDay) {
    skiedBy.clear();
    wearDay = world.calendar.day;
  }
  for (const s of activeResort(world).skiers) {
    if (s.state.kind !== 'skiing') continue;
    let seen = skiedBy.get(s.state.runId);
    if (!seen) skiedBy.set(s.state.runId, (seen = new Set()));
    if (seen.size < FULL_WEAR) seen.add(s.id);
  }
}

/**
 * Snapped to sixths so the cached map is repainted only a few times as a run wears in. A run the cats skipped
 * last night starts the morning as worn as the sim's snow says, so ungroomed runs show their bumps all day.
 */
const runWear = (run: Run): number => {
  const today = (skiedBy.get(run.id)?.size ?? 0) / FULL_WEAR;
  const unGroomed = (1 - snowOf(run)) / (1 - CONFIG.grooming.roughest);
  return Math.round(Math.min(1, Math.max(today, unGroomed)) * 6) / 6;
};

/** Everything except the camera's position that changes what drawStill paints. Cheap, so it is checked every frame. */
function stillKey(f: Frame, canvas: { width: number; height: number }): string {
  const { world, ui, camera, view } = f;
  const resort = activeResort(world);
  return [
    camera.zoom, view.width, view.height, canvas.width, canvas.height,
    ui.selection ? `${ui.selection.kind}${'id' in ui.selection ? ui.selection.id : ''}` : '',
    resort.runs.map((r) => `${r.id}:${r.points.length}:${r.profile.difficulty}:${runWear(r)}`).join(','),
    resort.lifts.map((l) => `${l.id}:${l.type}`).join(','),
  ].join('|');
}

/**
 * The still layer at device pixels, and the camera centre it was painted for. `spare` is a second buffer
 * for scrolling, so panning shifts the old picture and paints only the strip that slid into view.
 */
interface Still {
  canvas: HTMLCanvasElement;
  spare: HTMLCanvasElement;
  key: string;
  terrain: TerrainArt;
  x: number;
  y: number;
}
let still: Still | null = null;

function updateStill(ctx: CanvasRenderingContext2D, f: Frame): Still {
  const { camera } = f;
  const dpr = ctx.getTransform().a;
  const key = stillKey(f, ctx.canvas);
  const paint = (target: HTMLCanvasElement, at: Camera, clip?: (c: CanvasRenderingContext2D) => void): void => {
    const sctx = target.getContext('2d')!;
    sctx.save();
    sctx.setTransform(ctx.getTransform());
    clip?.(sctx);
    drawStill(sctx, { ...f, camera: at });
    sctx.restore();
  };

  if (!still || still.key !== key || still.terrain !== f.terrain) {
    const canvas = still?.canvas ?? document.createElement('canvas'), spare = still?.spare ?? document.createElement('canvas');
    for (const c of [canvas, spare]) {
      c.width = ctx.canvas.width;
      c.height = ctx.canvas.height;
    }
    paint(canvas, camera);
    return (still = { canvas, spare, key, terrain: f.terrain, x: camera.x, y: camera.y });
  }

  // Shift by whole device pixels so the copied picture never blurs; the leftover fraction is applied when pasting.
  const scale = camera.zoom * dpr;
  const sx = Math.round((still.x - camera.x) * scale), sy = Math.round((still.y - camera.y) * scale * SIN);
  if (sx === 0 && sy === 0) return still;
  const { canvas, spare } = still;
  const at = { x: still.x - sx / scale, y: still.y - sy / (scale * SIN), zoom: camera.zoom };
  if (Math.abs(sx) >= canvas.width || Math.abs(sy) >= canvas.height) {
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    paint(canvas, at);
    return Object.assign(still, at);
  }
  const sctx = spare.getContext('2d')!;
  sctx.clearRect(0, 0, spare.width, spare.height);
  sctx.drawImage(canvas, sx, sy);
  paint(spare, at, (c) => {
    // Everything except where the old picture landed.
    c.beginPath();
    c.rect(0, 0, f.view.width, f.view.height);
    c.rect(sx / dpr, sy / dpr, f.view.width, f.view.height);
    c.clip('evenodd');
  });
  return Object.assign(still, { canvas: spare, spare: canvas }, at);
}

export function draw(ctx: CanvasRenderingContext2D, f: Frame): void {
  // A canvas with no size yet (a page still laying out) would make a zero-size cached layer, and pasting that throws.
  if (ctx.canvas.width === 0 || ctx.canvas.height === 0) return;
  const { world, ui, camera, view } = f;
  const resort = activeResort(world);
  const { at, px, stroke, drawRun, liftStructure } = painter(ctx, camera, view);
  const time = world.calendar.time + f.alpha * CONFIG.loop.gameSecondsPerTick;

  drawSky(ctx, f);
  noteSkiers(world);
  const layer = updateStill(ctx, f);
  // The layer is at device pixels, so paste it with the canvas's scale undone.
  const dpr = ctx.getTransform().a;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, (layer.x - camera.x) * camera.zoom * dpr, (layer.y - camera.y) * SIN * camera.zoom * dpr);
  ctx.restore();

  ctx.lineCap = ctx.lineJoin = 'round';
  // Riders are drawn in their seats by the lifts; everyone else is drawn below.
  const shown = drawnSkiers(world, f.speedIndex, ui.selection);
  const carrierView: CarrierView = { at, zoom: camera.zoom, view, u: px(1.6, 1.8) };
  const riders = new Map<number, Rider[]>();
  for (const s of shown) {
    const state = s.state;
    if (state.kind !== 'riding') continue;
    const lift = resort.lifts.find((l) => l.id === state.liftId);
    if (!lift) continue;
    const progress = clamp(state.progress - ((1 - f.alpha) * CONFIG.loop.gameSecondsPerTick) / rideSeconds(lift), 0, 1);
    const rider = { id: s.id, jacket: skillJacket(s), d: (state.down ? 1 - progress : progress) * lift.length, down: state.down, selected: isSelected(ui, 'skier', s.id) };
    riders.set(lift.id, [...(riders.get(lift.id) ?? []), rider]);
  }
  for (const lift of resort.lifts) {
    drawCarriers(ctx, { ...lift, speed: liftSpeed(lift) }, time, carrierView, (riders.get(lift.id) ?? []).sort((a, b) => a.id - b.id));
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
      liftStructure(plan, false, plan.problems.length > 0);
      drawCarriers(ctx, { ...plan, tier: 0, speed: baseSpeed(plan.type) }, time, carrierView, [], plan.problems.length > 0);
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

  drawBaseBustle(ctx, resort.entrance, time, resort.skiers.length, at, px(1.6, 1.8));

  // Lift lines stand in roped corrals behind each bottom station instead of piling onto one spot.
  const inLine = new Map<number, { pos: Vec2; heading: number }>();
  for (const lift of resort.lifts) {
    const slots = queueSlots(lift, lift.queue.length);
    drawCorral(ctx, lift, lift.queue.length, carrierView);
    lift.queue.forEach((id, i) => inLine.set(id, slots[i]!));
  }

  for (const run of resort.runs) for (const ft of run.features) drawFeature(ctx, run, ft.type, ft.at, at, camera.zoom, 'ground');
  if (camera.zoom >= SPRAY_ZOOM) drawTrails(ctx, shown, f, at);

  for (const s of shown) {
    if (s.state.kind === 'riding') continue;
    const queued = inLine.get(s.id);
    const prev = f.previous.get(s.id);
    const skiing = skiingPose(s, resort.runs, f.alpha);
    const pos = skiing?.pos ?? queued?.pos ?? (prev ? lerp(prev, s.pos, f.alpha) : s.pos);
    const p = at(pos);
    if (p.x < -20 || p.y < -20 || p.x > view.width + 20 || p.y > view.height + 20) continue;
    if (skiing?.hidden) continue;
    const placed = skiing ?? queued;
    if (placed) headings.set(s.id, placed.heading);
    else if (prev && dist(prev, s.pos) > 0.05) headings.set(s.id, Math.atan2(s.pos.y - prev.y, s.pos.x - prev.x));
    // Figures are drawn at 1.6× life size so they read as people at every zoom.
    if (skiing && camera.zoom >= SPRAY_ZOOM) drawPuffs(ctx, snowPuffs(s, resort.runs, f.alpha), at, camera.zoom);
    const u = px(1.6, 1.8), jacket = skillJacket(s), heading = headings.get(s.id) ?? Math.PI / 2;
    if (skiing && skiing.air > 0) airborne(ctx, p, heading, u, jacket, skiing.air * camera.zoom);
    else stampSkier(ctx, p, heading, u, jacket, skiing ? stancePose(skiing.stance) : placed ? 'skis' : 'walking', isSelected(ui, 'skier', s.id));
  }
  // Tunnel roofs go over the skiers passing through them.
  for (const run of resort.runs) for (const ft of run.features) drawFeature(ctx, run, ft.type, ft.at, at, camera.zoom, 'roof');
  // Forget headings of skiers who have gone home.
  if (headings.size > resort.skiers.length * 2 + 100) {
    const here = new Set(resort.skiers.map((s) => s.id));
    for (const id of headings.keys()) if (!here.has(id)) headings.delete(id);
  }

  // Until the first lift goes in, a card names the mountain, like the sign at the foot of a real one.
  if (world.calendar.day === 1 && resort.lifts.length === 0) nameCard(ctx, resort.name, Math.max(...resort.terrain.heights));

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
 * A sunrise sky: deep blue overhead paling to peach at the skyline, the sun's glow low in the east, and a few
 * streaks of lit cloud. It sits behind the far ranges baked into the mountain picture.
 */
function drawSky(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { camera, view } = f;
  const horizon = (f.terrain.tilted.horizon - camera.y * SIN) * camera.zoom + view.height / 2;
  const bottom = Math.max(80, horizon);
  const sky = ctx.createLinearGradient(0, 0, 0, bottom);
  SUNRISE.sky.forEach((c, i) => sky.addColorStop(i / (SUNRISE.sky.length - 1), c));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, view.width, view.height);
  // Below the horizon lies the sea of cloud the mountain rises from, past the edge of the painted land too.
  const sea = ctx.createLinearGradient(0, bottom, 0, view.height);
  sea.addColorStop(0, '#ffe9dc');
  sea.addColorStop(0.35, SUNRISE.cloud);
  sea.addColorStop(1, '#e4d3e2');
  ctx.fillStyle = sea;
  ctx.fillRect(0, bottom, view.width, view.height - bottom);
  const sx = view.width * 0.86, sy = bottom - 60;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, view.width * 0.5);
  glow.addColorStop(0, 'rgba(255, 224, 168, 0.95)');
  glow.addColorStop(0.08, 'rgba(255, 224, 168, 0.6)');
  glow.addColorStop(0.4, 'rgba(255, 224, 168, 0.18)');
  glow.addColorStop(1, 'rgba(255, 224, 168, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, view.width, view.height);
  // Cloud streaks hang at fixed places over the skyline, so they drift past as the camera pans.
  const drift = -camera.x * camera.zoom * 0.3;
  for (let i = 0; i < 5; i++) {
    const w = view.width * (0.16 + 0.05 * (i % 3)), x = ((view.width * (0.1 + 0.21 * i) + drift) % (view.width * 1.2) + view.width * 1.2) % (view.width * 1.2) - view.width * 0.1;
    const y = bottom - 150 - (i % 2) * 70 - (i % 3) * 25;
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = k === 0 ? 'rgba(255, 210, 166, 0.85)' : 'rgba(190, 170, 205, 0.7)';
      ctx.beginPath();
      ctx.roundRect(x + k * w * 0.12, y + k * 7, w * (1 - k * 0.25), 6, 3);
      ctx.fill();
    }
  }
}

const stancePose = (stance: Stance): Pose => (stance === 'parallel' ? 'skis' : stance);

/** The fresh lines behind skiers nearest the middle of the screen, under every figure. */
function drawTrails(ctx: CanvasRenderingContext2D, shown: readonly Skier[], f: Frame, at: (p: Vec2) => Vec2): void {
  const runs = activeResort(f.world).runs, centre = vec(f.view.width / 2, f.view.height / 2);
  const skiing = shown
    .filter((s) => s.state.kind === 'skiing')
    .map((s) => ({ s, gap: dist(at(s.pos), centre) }))
    .filter(({ gap }) => gap < Math.max(f.view.width, f.view.height))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, MAX_TRAILS);
  for (const { s } of skiing) {
    const trail = trailPoses(s, runs, f.alpha);
    if (trail[0]) drawTrail(ctx, trail, at, f.camera.zoom, trail[0].carving);
  }
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

function nameCard(ctx: CanvasRenderingContext2D, name: string, summit: number): void {
  // Generated mountains have no real elevation, so only real peaks state their summit.
  const detail = summit > 1500 ? `Summit ${Math.round(summit).toLocaleString('en-US')} m · first morning` : 'First morning';
  ctx.font = `900 26px ${UI_FONT}`;
  const w = Math.max(ctx.measureText(name).width, (ctx.font = `700 13px ${UI_FONT}`, ctx.measureText(detail).width)) + 36;
  ctx.fillStyle = 'rgba(16, 28, 56, 0.62)';
  ctx.beginPath();
  ctx.roundRect(16, 76, w, 66, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 26px ${UI_FONT}`;
  ctx.fillText(name, 34, 108);
  ctx.fillStyle = '#ffd27a';
  ctx.font = `700 13px ${UI_FONT}`;
  ctx.fillText(detail, 34, 130);
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
