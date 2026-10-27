import { CONFIG, type FeatureType } from '../config';
import { income } from '../sim/economy';
import { liftCapacity, liftTier, nextTier, rideSeconds, upgradeCost, waitSeconds } from '../sim/lifts';
import { branchesOf, isBase, leadsSomewhere, liftsFrom, mergeOf, runsFromLift } from '../sim/network';
import { GRIPES, PRAISE, topFeelings } from '../sim/progress';
import { featureUpkeep, funFor, profileRun, rateRun } from '../sim/runs';
import { weatherSpec } from '../sim/weather';
import { activeResort, affordableLength, buildingProblemsHere, heldLifts, runEndAt, runProblemsHere, upgradeProblem, type World } from '../sim/world';
import { LEVEL_COLORS } from '../render/colors';
import { activityText, DIFFICULTY_NAMES, FEELING_EMOJI, feelingText, grade, metres, minutes, money, outOfTen, percent, requestTitle, SKILL_NAMES, stars, tallyText, thoughtText, weatherText } from './format';
import { pendingLiftPlan, runStartsConnected, type UiAction, type UiState } from './tools';

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

const FEATURE_TYPES = Object.keys(CONFIG.features) as FeatureType[];
const SKILL_LEVELS = [0, 1, 2, 3] as const;
const SKIER_GROUPS = ['beginners', 'intermediates', 'advanced skiers', 'experts'] as const;

const CLOSE: PanelButton = { label: 'Close', action: 'close' };
const CANCEL: PanelButton = { label: 'Cancel', action: 'cancel' };

/** What the side panel should show for the current tool or selection, or null for nothing. */
export function describePanel(world: World, ui: UiState): PanelModel | null {
  const resort = activeResort(world);
  const { tool, selection } = ui;

  if (tool.kind === 'lift') {
    const spec = CONFIG.lifts[tool.liftType];
    const plan = pendingLiftPlan(world, ui);
    const stars = CONFIG.liftStars[tool.liftType];
    const locked = world.company.stars < stars;
    const specRows = [
      ['Speed', `${spec.speed} m/s`],
      ['Capacity', `${spec.capacityPerHour.toLocaleString('en-US')} skiers/hour`],
      ['Max length', metres(spec.maxLength)],
      ['You can afford', metres(affordableLength(world, tool.liftType))],
    ] as const;
    if (!plan) {
      const note = locked ? `Unlocks when a ${CONFIG.review.magazine} review gives you ${stars}★.`
        : tool.bottom ? 'Tap where the top station goes.' : 'Tap where the bottom station goes.';
      return { title: spec.label, rows: specRows, note, actions: [CANCEL] };
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

  if (tool.kind === 'feature') {
    const run = resort.runs.find((r) => r.id === tool.runId);
    if (!run) return null;
    const spec = CONFIG.features[tool.featureType];
    const loves = SKILL_LEVELS.filter((skill) => spec.appeal[skill] >= 0.5).map((skill) => SKIER_GROUPS[skill]);
    return {
      title: `${spec.label} on ${run.name}`,
      accent: LEVEL_COLORS[run.profile.difficulty],
      rows: [
        ['Cost', money(spec.cost)],
        ['Upkeep', `${money(spec.upkeepPerDay)} a day`],
        ['Loved by', loves.join(', ')],
        ['On this run', `${run.features.length} of ${CONFIG.featureRules.maxPerRun}`],
      ],
      note: `Tap a spot on ${run.name}. Skiers who like it choose this run more often and enjoy it more; anyone else rides around it.`,
      actions: [
        ...FEATURE_TYPES.map((type) => ({ label: `${CONFIG.features[type].label} ${money(CONFIG.features[type].cost)}`, action: `feature:${type}`, primary: type === tool.featureType } as const)),
        { label: 'Done', action: 'cancel' },
      ],
    };
  }

  if (tool.kind === 'building') {
    const spec = CONFIG.buildings[tool.buildingType];
    const problems = tool.pos ? buildingProblemsHere(world, tool.buildingType, tool.pos) : [];
    const where = tool.buildingType === 'lodge' ? 'in the flat base area' : 'next to a lift’s top station';
    return {
      title: spec.label,
      rows: [['Cost', money(spec.cost)], ['Seats', String(spec.seats)], ['Meal price', money(spec.mealPrice)]],
      note: world.company.stars < spec.stars ? `Unlocks at ${spec.stars}★.` : !tool.pos ? `Tap ${where}. Hungry and tired skiers stop in to eat and rest.` : problems.join(' ') || 'Ready to build.',
      actions: [{ label: `Build for ${money(spec.cost)}`, action: 'confirm', primary: true, disabled: !tool.pos || problems.length > 0 }, CANCEL],
    };
  }

  if (tool.kind === 'run') {
    const { points } = tool;
    const profile = profileRun(resort.terrain, points);
    const start = points[0], end = points[points.length - 1];
    const startsConnected = runStartsConnected(world, start);
    const endsSomewhere = end && runEndAt(world, end) !== null;
    const problems = runProblemsHere(world, points);
    const hint =
      points.length === 0 ? 'Drag down the mountain from a lift’s top station, or from another run, to paint a run. The slope colours show how steep the ground is.'
      : !startsConnected ? 'This run doesn’t start at a lift top or on another run, so nobody will find it.'
      : points.length > 1 && !endsSomewhere ? 'Keep going down to a lift’s bottom station, the base, or another run.'
      : problems[0] ?? 'Looks good. Finish it, or keep adding points.';
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

  if (selection?.kind === 'resort') return describeResort(world);

  if (selection?.kind === 'lift') {
    const lift = resort.lifts.find((l) => l.id === selection.id);
    if (!lift) return null;
    const runs = runsFromLift(resort, lift);
    const next = nextTier(lift);
    const problem = upgradeProblem(world, lift);
    const held = heldLifts(world, resort).has(lift.id);
    return {
      title: lift.name,
      rows: [
        ['Type', liftTier(lift).name],
        ['Length', metres(lift.length)],
        ['Vertical rise', metres(lift.rise)],
        ['Ride time', minutes(rideSeconds(lift))],
        ['Capacity', `${Math.round(liftCapacity(lift)).toLocaleString('en-US')} skiers/hour`],
        ['In line', `${lift.queue.length} (wait ${minutes(waitSeconds(lift))})`],
        ['Riding', String(resort.skiers.filter((s) => s.state.kind === 'riding' && s.state.liftId === lift.id).length)],
        ['Runs from the top', runs.length === 0 ? 'None yet' : runs.map((r) => r.name).join(', ')],
        ...(next ? [['Next upgrade', `${next.name}: ${Math.round(CONFIG.lifts[lift.type].speed * next.speedFactor * 10) / 10} m/s, ${Math.round(CONFIG.lifts[lift.type].capacityPerHour * next.capacityFactor).toLocaleString('en-US')}/hour`] as const] : []),
      ],
      note: held ? 'Stopped on wind hold. Covered seats (bubble chairs and gondolas) keep running in storms.'
        : runs.length === 0 ? 'Draw a run from the top station so skiers have somewhere to go.'
        : next && problem ? problem : undefined,
      actions: [
        ...(next ? [{ label: `Upgrade (${money(upgradeCost(lift)!)})`, action: 'upgrade', primary: true, disabled: problem !== null } as const] : []),
        { label: `Remove (refund ${money(lift.invested * CONFIG.economy.removalRefund)})`, action: 'remove' },
        CLOSE,
      ],
    };
  }

  if (selection?.kind === 'run') {
    const run = resort.runs.find((r) => r.id === selection.id);
    if (!run) return null;
    const onRun = resort.skiers.filter((s) => s.state.kind === 'skiing' && s.state.runId === run.id).length;
    const ratings = rateRun(run, onRun);
    const end = run.points[run.points.length - 1]!;
    const merge = mergeOf(resort, run);
    const endsAt = [...liftsFrom(resort, end).map((l) => l.name), ...(isBase(resort, end) ? ['the base'] : []), ...(merge ? [merge.run.name] : [])];
    const fun = ([0, 1, 2, 3] as const).map((skill) => funFor(run, skill, onRun, weatherSpec(world.weather.today).fun).toFixed(1)).join(' · ');
    return {
      title: run.name,
      accent: LEVEL_COLORS[run.profile.difficulty],
      rows: [
        ['Difficulty', `${DIFFICULTY_NAMES[run.profile.difficulty]} (steepest ${grade(run.profile.steepestGrade)})`],
        ['Length', metres(run.profile.length)],
        ['Vertical', metres(run.profile.vertical)],
        ['Fun by skill', fun],
        ['Crowding', outOfTen(ratings.crowding)],
        ['Skiers on it', String(onRun)],
        ['Branches', branchesOf(resort, run).map((b) => b.run.name).join(', ') || 'None'],
        ['Leads to', endsAt.join(', ') || 'Nowhere'],
        ['Curves', run.profile.curviness >= CONFIG.runs.fullCurviness ? 'Plenty' : run.profile.curviness >= CONFIG.runs.fullCurviness / 3 ? 'Some' : 'Straight'],
        ['Features', run.features.map((f) => CONFIG.features[f.type].label).join(', ') || 'None'],
        ...(run.features.length > 0 ? [['Feature upkeep', `${money(featureUpkeep(run))} a day`] as const] : []),
      ],
      note: leadsSomewhere(resort, run) ? 'Fun is out of 10 for beginners · intermediates · advanced · experts. Skiers like runs at their own level.' : 'This run ends nowhere, so skiers won’t use it.',
      actions: [
        { label: 'Add feature', action: 'addFeature', primary: true },
        ...(run.features.length > 0 ? [{ label: 'Clear features', action: 'clearFeatures' } as const] : []),
        { label: 'Remove', action: 'remove' },
        CLOSE,
      ],
    };
  }

  if (selection?.kind === 'building') {
    const building = resort.buildings.find((b) => b.id === selection.id);
    if (!building) return null;
    const spec = CONFIG.buildings[building.type];
    const inside = resort.skiers.filter((s) => (s.state.kind === 'eating' || s.state.kind === 'toBuilding') && s.state.buildingId === building.id).length;
    return {
      title: building.name,
      rows: [['Type', spec.label], ['Seats taken', `${inside} of ${spec.seats}`], ['Meal price', money(spec.mealPrice)], ['Meals today (resort)', String(resort.today.meals)]],
      actions: [{ label: `Remove (refund ${money(spec.cost * CONFIG.economy.removalRefund)})`, action: 'remove' }, CLOSE],
    };
  }

  if (selection?.kind === 'skier') {
    const skier = resort.skiers.find((s) => s.id === selection.id);
    if (!skier) return null;
    const guest = resort.guests.find((g) => g.id === skier.guestId);
    const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;
    return {
      title: skier.name,
      accent: LEVEL_COLORS[skier.skill],
      rows: [
        ['Skill', SKILL_NAMES[skier.skill]],
        ['Visit', guest ? `#${guest.visits + 1} (loyalty ${percent(guest.loyalty)})` : 'First'],
        ['Happiness', percent(skier.happiness)],
        ['Energy', percent(skier.energy)],
        ['Cash', money(skier.cash)],
        ['Doing', activityText(skier, resort)],
        ...[...skier.log].reverse().map((f) => [`${FEELING_EMOJI[f.kind]} ${feelingText(f.kind, f.place)}`, signed(f.delta)] as const),
      ],
      note: `“${thoughtText(skier.thought)}”`,
      actions: [CLOSE],
    };
  }
  return null;
}

/** The resort overview: rating, money, price, land, requests and what skiers are saying today. */
function describeResort(world: World): PanelModel {
  const resort = activeResort(world);
  const { company } = world;
  const land = CONFIG.land[resort.land];
  const tally = resort.today.feelings;
  const said = [...topFeelings(tally, PRAISE, 3), ...topFeelings(tally, GRIPES, 3)];
  const active = world.requests.filter((r) => r.status === 'active');
  return {
    title: resort.name,
    rows: [
      ['Rating', stars(company.stars)],
      ['Reputation', percent(resort.reputation)],
      ['Ticket price', `${money(resort.ticketPrice)} (fair ${money(CONFIG.economy.fairTicketPrice)})`],
      ['Income today', money(income(company.today))],
      ['Skiers today', `${resort.today.arrivals} (${resort.today.regulars} regulars)`],
      ['Today', weatherText(world.weather.today)],
      ['Tomorrow', weatherText(world.weather.tomorrow)],
      ['Next land', land ? `${land.name}, ${land.stars}★` : 'All yours'],
      ...active.map((r) => [`📋 ${requestTitle(r)}`, `${money(r.reward)} · by day ${r.deadline}`] as const),
      ...said.map((k) => [`${FEELING_EMOJI[k]} ${tallyText(k, tally[k]!.count)}`, `${tally[k]!.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(tally[k]!.delta))}`] as const),
    ],
    note: `${CONFIG.review.magazine} reviews you every ${CONFIG.review.everyDays} days. Stars unlock lifts, upgrades, huts and land.`,
    actions: [
      { label: '− $5', action: 'priceDown' },
      { label: '+ $5', action: 'priceUp' },
      ...(land ? [{ label: `Buy land (${money(land.cost)})`, action: 'buyLand', primary: true, disabled: company.stars < land.stars || company.money < land.cost } as const] : []),
      CLOSE,
    ],
  };
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
