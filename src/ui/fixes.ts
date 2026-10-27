import type { FeelingKind } from '../sim/skiers';
import { activeResort, type World } from '../sim/world';
import type { ToolChoice } from './toolbar';
import type { Selection, UiAction } from './tools';

/** What a Fix button in the day report does: select the culprit, pick a tool, or run a panel action. */
export type FixTarget =
  | { readonly kind: 'select'; readonly selection: Selection }
  | { readonly kind: 'tool'; readonly tool: ToolChoice }
  | { readonly kind: 'action'; readonly action: UiAction };

export interface Fix {
  /** What a resort manager would do about it, in a sentence. */
  readonly advice: string;
  readonly label: string;
  readonly target: FixTarget;
}

/** How to fix a complaint, pointed at the lift, run or building where it happened most. */
export function fixFor(world: World, kind: FeelingKind, place: string): Fix | null {
  const resort = activeResort(world);
  const lift = resort.lifts.find((l) => l.name === place);
  const run = resort.runs.find((r) => r.name === place);
  const building = resort.buildings.find((b) => b.name === place);
  const show = (selection: Selection, label: string, advice: string): Fix => ({ advice, label, target: { kind: 'select', selection } });
  const tool = (choice: ToolChoice, label: string, advice: string): Fix => ({ advice, label, target: { kind: 'tool', tool: choice } });
  switch (kind) {
    case 'longLine':
      return lift
        ? show({ kind: 'lift', id: lift.id }, `Show ${lift.name}`, 'Upgrade it to carry more skiers an hour, or build a second lift beside it to split the line.')
        : null;
    case 'tiringTow':
      return lift
        ? show({ kind: 'lift', id: lift.id }, `Show ${lift.name}`, 'Long rope tows wear skiers out. Upgrade to a T-bar, or replace it with a chairlift.')
        : null;
    case 'nothingForMe':
      return tool('run', 'Draw a run', `Skiers rode ${place || 'a lift'} and found nothing at their level. Cut an easier run from its top.`);
    case 'scared':
      return run
        ? show({ kind: 'run', id: run.id }, `Show ${run.name}`, 'Skiers ended up on terrain above their level. Give that lift an easier way down too.')
        : null;
    case 'crowdedRun':
      return tool('run', 'Draw a run', `${place || 'A run'} was packed. Add another run off the same lift to spread skiers out.`);
    case 'boredRun':
      return tool('run', 'Draw a run', 'Good skiers want steeper terrain. Cut a blue or black run.');
    case 'overpriced':
      return { advice: 'Skiers think tickets cost too much. Lower the price, or make the day worth it.', label: 'Open Resort', target: { kind: 'action', action: 'resort' } };
    case 'lodgeFull':
      return building
        ? show({ kind: 'building', id: building.id }, `Show ${building.name}`, 'Extend it for more seats, or open a mountain hut to take the lunch rush.')
        : tool('lodge', 'Build a lodge', 'Skiers couldn’t get a seat. Build another lodge.');
    case 'windHold':
      return tool('gondola', 'Build a gondola', 'Exposed chairs stop in high wind. Gondolas and bubble chairs keep running.');
    case 'noLift':
      return tool('chairlift', 'Build a lift', 'Some skiers couldn’t find a lift to ride. Build one from the base.');
    default:
      return null;
  }
}
