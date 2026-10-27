import { CONFIG } from '../config';
import { dist } from '../sim/geometry';
import { liftCost, rideSeconds, waitSeconds } from '../sim/lifts';
import { isBase, leadsSomewhere, liftsFrom, runsFromLift } from '../sim/network';
import { profileRun, rateRun, runProblems } from '../sim/runs';
import { activeResort, type World } from '../sim/world';
import { LEVEL_COLORS } from '../render/colors';
import { activityText, DIFFICULTY_NAMES, grade, metres, minutes, money, outOfTen, percent, SKILL_NAMES, thoughtText } from './format';
import { pendingLiftPlan, type UiAction, type UiState } from './tools';

export interface PanelButton {
  readonly label: string;
  readonly action: UiAction;
  readonly primary?: boolean;
  readonly disabled?: boolean;
}

export interface PanelModel {
  readonly title: string;
  readonly accent?: string | undefined;
  readonly rows: readonly (readonly [label: string, value: string])[];
  readonly note?: string | undefined;
  readonly actions: readonly PanelButton[];
}

const CLOSE: PanelButton = { label: 'Close', action: 'close' };
const CANCEL: PanelButton = { label: 'Cancel', action: 'cancel' };

/** What the side panel should show for the current tool or selection, or null for nothing. */
export function describePanel(world: World, ui: UiState): PanelModel | null {
  const resort = activeResort(world);
  const { tool, selection } = ui;

  if (tool.kind === 'lift') {
    const spec = CONFIG.lifts[tool.liftType];
    const plan = pendingLiftPlan(world, ui);
    const specRows = [
      ['Speed', `${spec.speed} m/s`],
      ['Capacity', `${spec.capacityPerHour.toLocaleString('en-US')} skiers/hour`],
      ['Max length', metres(spec.maxLength)],
    ] as const;
    if (!plan) {
      return { title: spec.label, rows: specRows, note: tool.bottom ? 'Tap where the top station goes.' : 'Tap where the bottom station goes.', actions: [CANCEL] };
    }
    return {
      title: spec.label,
      rows: [
        ['Length', metres(plan.length)],
        ['Vertical rise', metres(plan.rise)],
        ['Ride time', minutes(plan.length / spec.speed)],
        ['Cost', money(plan.cost)],
        ['Capacity', `${spec.capacityPerHour.toLocaleString('en-US')} skiers/hour`],
      ],
      note: plan.problems.join(' ') || (tool.top ? 'Ready to build.' : 'Tap to place the top station.'),
      actions: [{ label: `Build for ${money(plan.cost)}`, action: 'confirm', primary: true, disabled: !tool.top || plan.problems.length > 0 }, CANCEL],
    };
  }

  if (tool.kind === 'run') {
    const { points } = tool;
    const profile = profileRun(resort.terrain, points);
    const start = points[0], end = points[points.length - 1];
    const startsAtLift = start && resort.lifts.some((l) => dist(l.top, start) <= CONFIG.network.connectRadius);
    const endsSomewhere = end && (isBase(resort, end) || liftsFrom(resort, end).length > 0);
    const problems = runProblems(resort.terrain, points);
    const hint =
      points.length === 0 ? 'Tap near a lift’s top station to start the run, then tap points down the mountain.'
      : !startsAtLift ? 'This run doesn’t start at a lift top, so nobody will find it.'
      : points.length > 1 && !endsSomewhere ? 'This run ends nowhere. Finish it at a lift’s bottom station or the base.'
      : 'Keep tapping downhill, then finish.';
    return {
      title: 'New run',
      accent: points.length > 1 ? LEVEL_COLORS[profile.difficulty] : undefined,
      rows: points.length > 1
        ? [['Difficulty', DIFFICULTY_NAMES[profile.difficulty]], ['Steepest', grade(profile.steepestGrade)], ['Length', metres(profile.length)], ['Vertical', metres(profile.vertical)]]
        : [],
      note: hint,
      actions: [{ label: 'Finish run', action: 'confirm', primary: true, disabled: problems.length > 0 }, { label: 'Undo point', action: 'undoPoint', disabled: points.length === 0 }, CANCEL],
    };
  }

  if (selection?.kind === 'lift') {
    const lift = resort.lifts.find((l) => l.id === selection.id);
    if (!lift) return null;
    const spec = CONFIG.lifts[lift.type];
    const runs = runsFromLift(resort, lift);
    return {
      title: lift.name,
      rows: [
        ['Type', spec.label],
        ['Length', metres(lift.length)],
        ['Vertical rise', metres(lift.rise)],
        ['Ride time', minutes(rideSeconds(lift))],
        ['Capacity', `${spec.capacityPerHour.toLocaleString('en-US')} skiers/hour`],
        ['In line', `${lift.queue.length} (wait ${minutes(waitSeconds(lift))})`],
        ['Riding', String(resort.skiers.filter((s) => s.state.kind === 'riding' && s.state.liftId === lift.id).length)],
        ['Runs from the top', runs.length === 0 ? 'None yet' : runs.map((r) => r.name).join(', ')],
        ['Upkeep', `${money(spec.upkeepPerDay)}/day (from Milestone 2)`],
      ],
      note: runs.length === 0 ? 'Draw a run from the top station so skiers have somewhere to go.' : undefined,
      actions: [{ label: `Remove (refund ${money(liftCost(lift.type, lift.length) * CONFIG.economy.removalRefund)})`, action: 'remove' }, CLOSE],
    };
  }

  if (selection?.kind === 'run') {
    const run = resort.runs.find((r) => r.id === selection.id);
    if (!run) return null;
    const onRun = resort.skiers.filter((s) => s.state.kind === 'skiing' && s.state.runId === run.id).length;
    const ratings = rateRun(run, onRun);
    const end = run.points[run.points.length - 1]!;
    const endsAt = [...liftsFrom(resort, end).map((l) => l.name), ...(isBase(resort, end) ? ['the base'] : [])];
    return {
      title: run.name,
      accent: LEVEL_COLORS[run.profile.difficulty],
      rows: [
        ['Difficulty', `${DIFFICULTY_NAMES[run.profile.difficulty]} (steepest ${grade(run.profile.steepestGrade)})`],
        ['Length', metres(run.profile.length)],
        ['Vertical', metres(run.profile.vertical)],
        ['Fun', outOfTen(ratings.fun)],
        ['Difficulty rating', outOfTen(ratings.difficulty)],
        ['Crowding', outOfTen(ratings.crowding)],
        ['Skiers on it', String(onRun)],
        ['Leads to', endsAt.join(', ') || 'Nowhere'],
      ],
      note: leadsSomewhere(resort, run) ? undefined : 'This run ends nowhere, so skiers won’t use it.',
      actions: [{ label: 'Remove', action: 'remove' }, CLOSE],
    };
  }

  if (selection?.kind === 'skier') {
    const skier = resort.skiers.find((s) => s.id === selection.id);
    if (!skier) return null;
    return {
      title: `Skier #${skier.id}`,
      accent: LEVEL_COLORS[skier.skill],
      rows: [
        ['Skill', SKILL_NAMES[skier.skill]],
        ['Happiness', percent(skier.happiness)],
        ['Energy', percent(skier.energy)],
        ['Cash', money(skier.cash)],
        ['Doing', activityText(skier, resort)],
      ],
      note: `“${thoughtText(skier.thought)}”`,
      actions: [CLOSE],
    };
  }
  return null;
}

/** Renders panel models, rebuilding the DOM only when its structure changes so buttons stay tappable. */
export function createPanel(el: HTMLElement, onAction: (action: UiAction) => void): (model: PanelModel | null) => void {
  let structure = '';
  let values: HTMLElement[] = [];
  let note: HTMLElement | null = null;
  el.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (button && !button.disabled) onAction(button.dataset['action'] as UiAction);
  });

  return (model) => {
    el.hidden = model === null;
    if (!model) return void (structure = '');
    const key = JSON.stringify([model.title, model.accent, model.rows.map(([label]) => label), model.actions, model.note === undefined]);
    if (key !== structure) {
      structure = key;
      el.replaceChildren();
      const title = el.appendChild(document.createElement('h2'));
      title.textContent = model.title;
      if (model.accent) title.style.borderColor = model.accent;
      const table = el.appendChild(document.createElement('dl'));
      values = model.rows.map(([label]) => {
        table.appendChild(document.createElement('dt')).textContent = label;
        return table.appendChild(document.createElement('dd'));
      });
      note = model.note === undefined ? null : el.appendChild(document.createElement('p'));
      const bar = el.appendChild(document.createElement('div'));
      bar.className = 'actions';
      for (const a of model.actions) {
        const b = bar.appendChild(document.createElement('button'));
        b.textContent = a.label;
        b.dataset['action'] = a.action;
        b.disabled = a.disabled ?? false;
        b.classList.toggle('primary', a.primary ?? false);
      }
    }
    model.rows.forEach(([, value], i) => {
      if (values[i]!.textContent !== value) values[i]!.textContent = value;
    });
    if (note && note.textContent !== model.note) note.textContent = model.note ?? '';
  };
}
