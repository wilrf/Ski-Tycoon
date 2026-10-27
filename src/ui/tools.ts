import { CONFIG, type BuildingType, type FeatureType, type LiftType } from '../config';
import { dist, distToPolyline, distToSegment, projectOnPolyline, type Vec2 } from '../sim/geometry';
import type { LiftPlan } from '../sim/lifts';
import { runAt } from '../sim/network';
import { runPointProblem } from '../sim/runs';
import { activeResort, applyCommand, planLiftHere, runEndAt, runProblemsHere, runStartAt, type Command, type World } from '../sim/world';

export type Tool =
  | { readonly kind: 'select' }
  | { readonly kind: 'lift'; readonly liftType: LiftType; readonly bottom: Vec2 | null; readonly top: Vec2 | null }
  | { readonly kind: 'run'; readonly points: readonly Vec2[] }
  | { readonly kind: 'building'; readonly buildingType: BuildingType; readonly pos: Vec2 | null }
  | { readonly kind: 'feature'; readonly runId: number; readonly featureType: FeatureType };

export type Selection = { readonly kind: 'lift' | 'run' | 'skier' | 'building'; readonly id: number } | { readonly kind: 'resort' } | null;

export interface UiState {
  tool: Tool;
  selection: Selection;
  /** World point under the mouse, for live previews; null on touch screens. */
  hover: Vec2 | null;
  /** A run is being drawn by dragging. */
  stroking: boolean;
}

export type UiAction =
  | 'confirm' | 'cancel' | 'undoPoint' | 'remove' | 'close' | 'upgrade' | 'priceUp' | 'priceDown' | 'buyLand' | 'resort'
  | 'addFeature' | 'clearFeatures' | `feature:${FeatureType}`;

export const createUiState = (): UiState => ({ tool: { kind: 'select' }, selection: null, hover: null, stroking: false });

/** Drag-drawn runs keep a point about this often, in metres. */
const STROKE_SPACING = 20;

/** The lift being placed: confirmed top station if there is one, else the hovered point. */
export function pendingLiftPlan(world: World, ui: UiState): LiftPlan | null {
  const { tool } = ui;
  const top = tool.kind === 'lift' ? (tool.top ?? ui.hover) : null;
  if (tool.kind !== 'lift' || !tool.bottom || !top) return null;
  return planLiftHere(world, tool.liftType, tool.bottom, top);
}

/** The run being drawn, plus the hovered point when it would be a valid next point. */
export function pendingRunPoints(world: World, ui: UiState): readonly Vec2[] {
  if (ui.tool.kind !== 'run') return [];
  const { points } = ui.tool;
  const hover = ui.hover;
  return hover && !ui.stroking && !runPointProblem(activeResort(world).terrain, points[points.length - 1], hover) ? [...points, hover] : points;
}

/** Whether a run starting here joins the network, at a lift top or on another run. */
export function runStartsConnected(world: World, start: Vec2 | undefined): boolean {
  const resort = activeResort(world);
  return !!start && (resort.lifts.some((l) => dist(l.top, start) <= CONFIG.network.connectRadius) || runAt(resort, start) !== null);
}

/** The nearest skier, lift, building or run within `radius` metres, in that order of priority. */
function hitTest(world: World, p: Vec2, radius: number): Selection {
  const resort = activeResort(world);
  const nearest = <T>(items: readonly T[], distance: (item: T) => number): T | undefined =>
    items.reduce<{ item?: T; d: number }>((best, item) => (distance(item) < best.d ? { item, d: distance(item) } : best), { d: radius }).item;
  const skier = nearest(resort.skiers, (s) => dist(s.pos, p));
  if (skier) return { kind: 'skier', id: skier.id };
  const building = nearest(resort.buildings, (b) => dist(b.pos, p) - 8);
  if (building) return { kind: 'building', id: building.id };
  const lift = nearest(resort.lifts, (l) => distToSegment(p, l.bottom, l.top));
  if (lift) return { kind: 'lift', id: lift.id };
  const run = nearest(resort.runs, (r) => distToPolyline(p, r.points));
  return run ? { kind: 'run', id: run.id } : null;
}

/** Appends p to the run being drawn if it's downhill of the last point; the first point snaps onto the network. */
function addRunPoint(world: World, ui: UiState, p: Vec2): string | null {
  if (ui.tool.kind !== 'run') return null;
  const { points } = ui.tool;
  const point = points.length === 0 ? (runStartAt(world, p) ?? p) : p;
  const problem = runPointProblem(activeResort(world).terrain, points[points.length - 1], point);
  if (!problem) ui.tool = { kind: 'run', points: [...points, point] };
  return problem;
}

/** Handles a tap on the map. Returns a message for the player, if any. */
export function tapMap(world: World, ui: UiState, p: Vec2, hitRadius: number): string | null {
  const { tool } = ui;
  switch (tool.kind) {
    case 'select':
      ui.selection = hitTest(world, p, hitRadius);
      return null;
    case 'lift':
      ui.tool = !tool.bottom || tool.top ? { ...tool, bottom: p, top: null } : { ...tool, top: p };
      return null;
    case 'run':
      return addRunPoint(world, ui, p);
    case 'building':
      ui.tool = { ...tool, pos: p };
      return null;
    case 'feature': {
      const run = activeResort(world).runs.find((r) => r.id === tool.runId);
      if (!run) return null;
      const spot = projectOnPolyline(p, run.points);
      if (spot.gap > hitRadius * 1.5) return `Tap on ${run.name} to place it.`;
      const result = applyCommand(world, { type: 'addFeature', runId: run.id, featureType: tool.featureType, at: spot.at });
      return result.ok ? `${CONFIG.features[tool.featureType].label} built on ${run.name}.` : result.reason;
    }
  }
}

/** Starts drawing a run by dragging, continuing any points already tapped. */
export function strokeStart(world: World, ui: UiState, p: Vec2): void {
  if (ui.tool.kind !== 'run') return;
  ui.stroking = true;
  addRunPoint(world, ui, p);
}

/** Adds points as the drag moves; uphill bits are skipped rather than refused, so a wobbly line still works. */
export function strokeMove(world: World, ui: UiState, p: Vec2): void {
  if (ui.tool.kind !== 'run' || !ui.stroking) return;
  const last = ui.tool.points[ui.tool.points.length - 1];
  if (!last || dist(last, p) >= STROKE_SPACING) addRunPoint(world, ui, p);
}

/**
 * Finishes the drag: the end snaps to a nearby lift bottom, the base or another run, and if the run is
 * valid and joins the network at both ends it opens straight away. Otherwise it stays as a draft.
 */
export function strokeEnd(world: World, ui: UiState, p: Vec2): string | null {
  if (ui.tool.kind !== 'run' || !ui.stroking) return null;
  ui.stroking = false;
  strokeMove(world, ui, p);
  const points = ui.tool.points;
  const last = points[points.length - 1];
  const end = last && runEndAt(world, last);
  if (end && end !== last && dist(end, last) > 1) addRunPoint(world, ui, end);
  const tool = ui.tool;
  if (tool.kind !== 'run' || tool.points.length < 2) return null;
  const finished = runEndAt(world, tool.points[tool.points.length - 1]!) !== null;
  if (!runStartsConnected(world, tool.points[0]) || !finished) return null;
  return runProblemsHere(world, tool.points).length === 0 ? runAction(world, ui, 'confirm') : null;
}

export function selectTool(ui: UiState, tool: Tool): void {
  ui.tool = tool;
  ui.selection = null;
  ui.stroking = false;
}

/** Runs a panel or keyboard action. Returns a message for the player, if any. */
export function runAction(world: World, ui: UiState, action: UiAction): string | null {
  const { tool, selection } = ui;
  const resort = activeResort(world);
  const apply = (command: Command, done: string | null = null): string | null => {
    const result = applyCommand(world, command);
    return result.ok ? done : result.reason;
  };
  switch (action) {
    case 'confirm': {
      const build = (command: Command, next: Tool, done: string): string => {
        const result = applyCommand(world, command);
        if (!result.ok) return result.reason;
        ui.tool = next;
        return done;
      };
      if (tool.kind === 'lift' && tool.bottom && tool.top) {
        return build({ type: 'buildLift', liftType: tool.liftType, bottom: tool.bottom, top: tool.top }, { ...tool, bottom: null, top: null }, 'Lift built.');
      }
      if (tool.kind === 'building' && tool.pos) {
        return build({ type: 'buildBuilding', buildingType: tool.buildingType, pos: tool.pos }, { ...tool, pos: null }, `${CONFIG.buildings[tool.buildingType].label} open.`);
      }
      return tool.kind === 'run' ? build({ type: 'buildRun', points: tool.points }, { kind: 'run', points: [] }, 'Run opened.') : null;
    }
    case 'undoPoint':
      if (tool.kind === 'run') ui.tool = { kind: 'run', points: tool.points.slice(0, -1) };
      return null;
    case 'cancel':
      selectTool(ui, { kind: 'select' });
      // Leaving the feature tool goes back to the run it was building on.
      if (tool.kind === 'feature') ui.selection = { kind: 'run', id: tool.runId };
      return null;
    case 'addFeature':
      if (selection?.kind === 'run') selectTool(ui, { kind: 'feature', runId: selection.id, featureType: 'berms' });
      return null;
    case 'clearFeatures':
      return selection?.kind === 'run' ? apply({ type: 'clearFeatures', runId: selection.id }, 'Features removed.') : null;
    case 'close':
      ui.selection = null;
      return null;
    case 'resort':
      selectTool(ui, { kind: 'select' });
      ui.selection = { kind: 'resort' };
      return null;
    case 'priceUp':
    case 'priceDown': {
      const step = CONFIG.economy.ticketPriceStep * (action === 'priceUp' ? 1 : -1);
      return apply({ type: 'setTicketPrice', price: resort.ticketPrice + step });
    }
    case 'buyLand':
      return apply({ type: 'buyLand' }, 'Land bought. Build on it right away.');
    case 'upgrade':
      return selection?.kind === 'lift' ? apply({ type: 'upgradeLift', id: selection.id }, 'Lift upgraded.') : null;
    case 'feature:rollers':
    case 'feature:berms':
    case 'feature:tunnel':
    case 'feature:smallJump':
    case 'feature:mediumJump':
    case 'feature:largeJump':
      if (tool.kind === 'feature') ui.tool = { ...tool, featureType: action.slice('feature:'.length) as FeatureType };
      return null;
    case 'remove': {
      if (!selection || selection.kind === 'skier' || selection.kind === 'resort') return null;
      const type = selection.kind === 'lift' ? 'removeLift' : selection.kind === 'run' ? 'removeRun' : 'removeBuilding';
      ui.selection = null;
      return apply({ type, id: selection.id });
    }
  }
}
