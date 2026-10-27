import type { LiftType } from '../config';
import { dist, distToPolyline, distToSegment, type Vec2 } from '../sim/geometry';
import { planLift, type LiftPlan } from '../sim/lifts';
import { runPointProblem } from '../sim/runs';
import { activeResort, applyCommand, type Command, type World } from '../sim/world';

export type Tool =
  | { readonly kind: 'select' }
  | { readonly kind: 'lift'; readonly liftType: LiftType; readonly bottom: Vec2 | null; readonly top: Vec2 | null }
  | { readonly kind: 'run'; readonly points: readonly Vec2[] };

export type Selection = { readonly kind: 'lift' | 'run' | 'skier'; readonly id: number } | null;

export interface UiState {
  tool: Tool;
  selection: Selection;
  /** World point under the mouse, for live previews; null on touch screens. */
  hover: Vec2 | null;
}

export type UiAction = 'confirm' | 'cancel' | 'undoPoint' | 'remove' | 'close';

export const createUiState = (): UiState => ({ tool: { kind: 'select' }, selection: null, hover: null });

/** The lift being placed: confirmed top station if there is one, else the hovered point. */
export function pendingLiftPlan(world: World, ui: UiState): LiftPlan | null {
  const { tool } = ui;
  const top = tool.kind === 'lift' ? (tool.top ?? ui.hover) : null;
  if (tool.kind !== 'lift' || !tool.bottom || !top) return null;
  const resort = activeResort(world);
  return planLift(resort.terrain, resort.lifts, world.company.money, tool.liftType, tool.bottom, top);
}

/** The run being drawn, plus the hovered point when it would be a valid next point. */
export function pendingRunPoints(world: World, ui: UiState): readonly Vec2[] {
  if (ui.tool.kind !== 'run') return [];
  const { points } = ui.tool;
  const hover = ui.hover;
  return hover && !runPointProblem(activeResort(world).terrain, points[points.length - 1], hover) ? [...points, hover] : points;
}

/** The nearest skier, lift or run within `radius` metres, in that order of priority. */
function hitTest(world: World, p: Vec2, radius: number): Selection {
  const resort = activeResort(world);
  const nearest = <T>(items: readonly T[], distance: (item: T) => number): T | undefined =>
    items.reduce<{ item?: T; d: number }>((best, item) => (distance(item) < best.d ? { item, d: distance(item) } : best), { d: radius }).item;
  const skier = nearest(resort.skiers, (s) => dist(s.pos, p));
  if (skier) return { kind: 'skier', id: skier.id };
  const lift = nearest(resort.lifts, (l) => distToSegment(p, l.bottom, l.top));
  if (lift) return { kind: 'lift', id: lift.id };
  const run = nearest(resort.runs, (r) => distToPolyline(p, r.points));
  return run ? { kind: 'run', id: run.id } : null;
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
    case 'run': {
      const problem = runPointProblem(activeResort(world).terrain, tool.points[tool.points.length - 1], p);
      if (!problem) ui.tool = { kind: 'run', points: [...tool.points, p] };
      return problem;
    }
  }
}

export function selectTool(ui: UiState, tool: Tool): void {
  ui.tool = tool;
  ui.selection = null;
}

/** Runs a panel or keyboard action. Returns a message for the player, if any. */
export function runAction(world: World, ui: UiState, action: UiAction): string | null {
  const { tool, selection } = ui;
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
      return tool.kind === 'run' ? build({ type: 'buildRun', points: tool.points }, { kind: 'run', points: [] }, 'Run opened.') : null;
    }
    case 'undoPoint':
      if (tool.kind === 'run') ui.tool = { kind: 'run', points: tool.points.slice(0, -1) };
      return null;
    case 'cancel':
      selectTool(ui, { kind: 'select' });
      return null;
    case 'close':
      ui.selection = null;
      return null;
    case 'remove': {
      if (!selection || selection.kind === 'skier') return null;
      const result = applyCommand(world, { type: selection.kind === 'lift' ? 'removeLift' : 'removeRun', id: selection.id });
      ui.selection = null;
      return result.ok ? null : result.reason;
    }
  }
}
