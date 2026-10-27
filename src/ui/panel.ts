import { CONFIG, type FeatureType, type LiftTier } from '../config';
import { buildingInvested, nextLodgeUpgrade, seatsOf } from '../sim/buildings';
import { income } from '../sim/economy';
import { liftCapacity, liftTier, type Lift, nextTier, rideSeconds, upgradeCost, waitSeconds } from '../sim/lifts';
import { branchesOf, isBase, leadsSomewhere, liftsFrom, mergeOf, runsFromLift } from '../sim/network';
import { GRIPES, PRAISE, topFeelings } from '../sim/progress';
import { featureUpkeep, funFor, profileRun, rateRun, runLevel } from '../sim/runs';
import { weatherSpec } from '../sim/weather';
import { activeResort, affordableLength, forecastDay, buildingProblemsHere, heldLifts, runEndAt, runProblemsHere, upgradeProblem, type World } from '../sim/world';
import { LEVEL_COLORS } from '../render/colors';
import { activityText, DIFFICULTY_NAMES, FEELING_EMOJI, feelingText, grade, metres, minutes, money, outOfTen, percent, requestTitle, SKILL_NAMES, stars, tallyText, thoughtText, weatherText } from './format';
import { pendingLiftPlan, RESORT_TABS, runStartsConnected, type ResortTab, type UiAction, type UiState } from './tools';

export interface PanelButton {
  readonly label: string;
  readonly action: UiAction;
  readonly primary?: boolean;
  readonly disabled?: boolean;
}

export interface PanelSlider {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
}

export interface PanelModel {
  readonly title: string;
  readonly accent?: string | undefined;
  /** Tab buttons along the top; the active one is highlighted. */
  readonly tabs?: readonly (PanelButton & { readonly active: boolean })[];
  /** A slider with a typed box beside it, for the ticket price. */
  readonly slider?: PanelSlider;
  readonly rows: readonly (readonly [label: string, value: string])[];
  readonly note?: string | undefined;
  readonly actions: readonly PanelButton[];
}

const FEATURE_TYPES = Object.keys(CONFIG.features) as FeatureType[];
const SKILL_LEVELS = [0, 1, 2, 3, 4] as const;
const SKIER_GROUPS = ['beginners', 'intermediates', 'experts', 'pros', 'olympians'] as const;

const CLOSE: PanelButton = { label: 'Close', action: 'close' };
const CANCEL: PanelButton = { label: 'Cancel', action: 'cancel' };

/** Before → after numbers for a lift's next upgrade. */
function upgradeRows(lift: Lift, next: LiftTier): (readonly [string, string])[] {
  const now = liftTier(lift);
  const spec = CONFIG.lifts[lift.type];
  const speed = (t: LiftTier): string => `${Math.round(spec.speed * t.speedFactor * 10) / 10} m/s`;
  const capacity = (t: LiftTier): string => Math.round(spec.capacityPerHour * t.capacityFactor).toLocaleString('en-US');
  const effort = (t: LiftTier): string => (t.effort >= 1 ? 'tiring' : t.effort > 0 ? 'light' : 'none');
  return [
    ['After upgrade', next.name],
    ['Capacity', `${capacity(now)} → ${capacity(next)}/hour`],
    ['Speed', `${speed(now)} → ${speed(next)}`],
    ...(now.effort !== next.effort ? [['Effort on the way up', `${effort(now)} → ${effort(next)}`] as const] : []),
    ...(now.covered !== next.covered ? [['Seats', 'open → covered, runs in storms'] as const] : []),
  ];
}

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

  if (selection?.kind === 'resort') return describeResort(world, ui.resortTab);

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
        ['Upgrade path', CONFIG.liftTiers[lift.type].map((t, i) => (i === lift.tier ? `[${t.name}]` : i < lift.tier ? t.name : `${t.name} ${t.stars}★`)).join(' → ')],
        ...(next ? upgradeRows(lift, next) : []),
      ],
      note: held ? 'Stopped on wind hold. Covered seats (bubble chairs and gondolas) keep running in storms.'
        : runs.length === 0 ? 'Draw a run from the top station so skiers have somewhere to go.'
        : next && problem ? problem : undefined,
      actions: [
        // Never disabled: a click on a locked upgrade says what it needs, through the toast.
        ...(next ? [{ label: world.company.stars < next.stars ? `${next.name} needs ${next.stars}★` : `Upgrade to ${next.name} (${money(upgradeCost(lift)!)})`, action: 'upgrade', primary: problem === null } as const] : []),
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
    const inside = resort.skiers.filter((s) => 'buildingId' in s.state && s.state.buildingId === building.id).length;
    const isLodge = building.type === 'lodge';
    const next = nextLodgeUpgrade(building);
    const drinks = CONFIG.apres.prices[resort.apresPrice];
    const built = CONFIG.lodgeUpgrades.slice(0, building.upgrades).map((u) => u.name);
    return {
      title: building.name,
      rows: [
        ['Type', spec.label],
        ['Seats taken', `${inside} of ${seatsOf(building)}`],
        ['Meal price', money(spec.mealPrice)],
        ['Meals today (resort)', String(resort.today.meals)],
        ...(isLodge ? [
          ['Extensions', built.join(', ') || 'None yet'],
          ['Après drinks', `${drinks.label}, ${money(drinks.drinkPrice)} each`],
          ['Après today (resort)', `${resort.today.apresGuests} guests, ${money(world.company.today.apres)}`],
        ] as const : []),
      ],
      note: isLodge ? 'From 2:30 PM until 8 PM the lodge bar serves après. Low prices bring more guests and loyalty; high prices earn more per drink but put some skiers off.' : undefined,
      actions: [
        ...(next ? [{ label: `Add ${next.name.toLowerCase()} (+${next.seats} seats, ${money(next.cost)})`, action: 'upgrade', primary: true, disabled: world.company.money < next.cost } as const] : []),
        ...(isLodge ? [{ label: `Drinks: ${drinks.label}`, action: 'apresPrice' } as const] : []),
        { label: `Remove (refund ${money(buildingInvested(building) * CONFIG.economy.removalRefund)})`, action: 'remove' },
        CLOSE,
      ],
    };
  }

  if (selection?.kind === 'skier') {
    const skier = resort.skiers.find((s) => s.id === selection.id);
    if (!skier) return null;
    const guest = resort.guests.find((g) => g.id === skier.guestId);
    const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;
    return {
      title: skier.name,
      accent: LEVEL_COLORS[runLevel(skier.skill)],
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

const TAB_LABELS: Record<ResortTab, string> = { overview: 'Overview', prices: 'Prices', goals: 'Goals', land: 'Land' };

/** The resort window, in tabs: how it's doing, what tickets cost, what to aim for, and land to buy. */
function describeResort(world: World, tab: ResortTab): PanelModel {
  const resort = activeResort(world);
  const { company } = world;
  const tabs = RESORT_TABS.map((t) => ({ label: TAB_LABELS[t], action: `tab:${t}` as const, active: t === tab }));
  const base = { title: resort.name, tabs };
  const { everyDays } = CONFIG.review;
  const nextReview = Math.ceil(world.calendar.day / everyDays) * everyDays;
  switch (tab) {
    case 'overview':
      return {
        ...base,
        rows: [
          ['Rating', stars(company.stars)],
          ['Next review', `End of day ${nextReview}`],
          ['Reputation', percent(resort.reputation)],
          ['Income today', money(income(company.today))],
          ['Skiers today', `${resort.today.arrivals} (${resort.today.regulars} regulars)`],
          ['Today', weatherText(world.weather.today)],
          ['Tomorrow', weatherText(world.weather.tomorrow)],
        ],
        note: `${CONFIG.review.magazine} reviews you every ${everyDays} days. Stars unlock lifts, upgrades, huts and land.`,
        actions: [CLOSE],
      };
    case 'prices': {
      const [min, max] = CONFIG.economy.ticketPriceRange;
      const { fairTicketPrice } = CONFIG.economy;
      const f = forecastDay(world, resort, resort.ticketPrice);
      const busy = f.comfortable > 0 && f.skiers > f.comfortable;
      const lines = f.comfortable === 0 ? '–' : busy ? `long (${Math.round((f.skiers / f.comfortable) * 100)}% of what your lifts carry)` : 'short';
      const feel = resort.ticketPrice < fairTicketPrice * 0.8 ? 'a bargain' : resort.ticketPrice > fairTicketPrice * 1.2 ? 'pricey' : 'fair';
      return {
        ...base,
        slider: { label: 'Ticket price', min, max, step: 1, value: resort.ticketPrice },
        rows: [
          ['Fair price', money(fairTicketPrice)],
          ['Skiers think it’s', feel],
          ['Expected skiers a day', f.skiers.toLocaleString('en-US')],
          ['Lifts carry comfortably', f.comfortable.toLocaleString('en-US')],
          ['Lines', lines],
          ['Ticket money a day', money(f.tickets)],
        ],
        note: busy
          ? 'More skiers than your lifts can carry means long lines and packed runs. Raise the price, or add and upgrade lifts.'
          : 'Cheaper tickets bring more skiers but less per head. Dearer ones keep skiers away and make the ones who come pickier.',
        actions: [CLOSE],
      };
    }
    case 'goals': {
      const tally = resort.today.feelings;
      const said = [...topFeelings(tally, PRAISE, 3), ...topFeelings(tally, GRIPES, 3)];
      const active = world.requests.filter((r) => r.status === 'active');
      return {
        ...base,
        rows: [
          ...active.map((r) => [requestTitle(r), `${money(r.reward)} · by day ${r.deadline}`] as const),
          ...said.map((k) => [tallyText(k, tally[k]!.count), `${tally[k]!.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(tally[k]!.delta))}`] as const),
        ],
        note: 'Requests pay a bonus if you meet them in time. Below them is what skiers are saying today, and how much it moved their mood.',
        actions: [CLOSE],
      };
    }
    case 'land': {
      const land = CONFIG.land[resort.land];
      if (!land) return { ...base, rows: [['Land', 'You own the whole mountain']], actions: [CLOSE] };
      const locked = company.stars < land.stars;
      const short = land.cost - company.money;
      return {
        ...base,
        rows: [
          ['Next land', land.name],
          ['Price', money(land.cost)],
          ['Needs', `${land.stars}★ (you have ${company.stars}★)`],
          ['Next review', `End of day ${nextReview}`],
        ],
        note: locked
          ? `${land.name} goes on sale once you’re rated ${land.stars}★.`
          : short > 0 ? `You need ${money(short)} more.` : 'On sale now. You can build on it as soon as it’s yours.',
        // Never disabled: a locked purchase still answers a click with why, through the toast.
        actions: [{ label: locked ? `Needs ${land.stars}★ · review day ${nextReview}` : `Buy ${land.name} (${money(land.cost)})`, action: 'buyLand', primary: !locked && short <= 0 }, CLOSE],
      };
    }
  }
}

/** Renders panel models, rebuilding the DOM only when its structure changes so buttons stay tappable. */
export function createPanel(el: HTMLElement, onAction: (action: UiAction) => void, onSlide: (value: number) => void): (model: PanelModel | null) => void {
  let structure = '';
  let tabs: HTMLButtonElement[] = [];
  let range: HTMLInputElement | null = null;
  let typed: HTMLInputElement | null = null;
  let labels: HTMLElement[] = [];
  let values: HTMLElement[] = [];
  let buttons: HTMLButtonElement[] = [];
  let note: HTMLElement | null = null;
  el.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (button && !button.disabled) onAction(button.dataset['action'] as UiAction);
  });
  const set = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
  };

  // The DOM is rebuilt only when the panel's shape changes. Text and enabled states are updated in place,
  // so a button under the pointer is never swapped out mid-click while the game runs.
  return (model) => {
    el.hidden = model === null;
    if (!model) return void (structure = '');
    const key = JSON.stringify([
      model.title, model.accent, model.tabs?.map((t) => t.action), model.slider?.label, model.rows.length,
      model.actions.map((a) => [a.action, a.primary]), model.note === undefined,
    ]);
    if (key !== structure) {
      structure = key;
      el.replaceChildren();
      const title = el.appendChild(document.createElement('h2'));
      title.textContent = model.title;
      if (model.accent) title.style.borderColor = model.accent;
      const tabBar = el.appendChild(document.createElement('div'));
      tabBar.className = 'tabs';
      tabBar.hidden = !model.tabs;
      tabs = (model.tabs ?? []).map((t) => {
        const b = tabBar.appendChild(document.createElement('button'));
        b.dataset['action'] = t.action;
        b.textContent = t.label;
        return b;
      });
      range = typed = null;
      if (model.slider) {
        const { label, min, max, step } = model.slider;
        const row = el.appendChild(document.createElement('label'));
        row.className = 'slider';
        row.appendChild(document.createElement('span')).textContent = label;
        range = row.appendChild(document.createElement('input'));
        typed = row.appendChild(document.createElement('input'));
        Object.assign(range, { type: 'range', min, max, step });
        Object.assign(typed, { type: 'number', min, max, step, inputMode: 'numeric' });
        typed.setAttribute('aria-label', label);
        range.addEventListener('input', () => onSlide(Number(range!.value)));
        typed.addEventListener('change', () => onSlide(Number(typed!.value)));
      }
      const table = el.appendChild(document.createElement('dl'));
      labels = [];
      values = model.rows.map(() => {
        labels.push(table.appendChild(document.createElement('dt')));
        return table.appendChild(document.createElement('dd'));
      });
      note = model.note === undefined ? null : el.appendChild(document.createElement('p'));
      const bar = el.appendChild(document.createElement('div'));
      bar.className = 'actions';
      buttons = model.actions.map((a) => {
        const b = bar.appendChild(document.createElement('button'));
        b.dataset['action'] = a.action;
        b.classList.toggle('primary', a.primary ?? false);
        return b;
      });
    }
    model.tabs?.forEach((t, i) => tabs[i]!.classList.toggle('active', t.active));
    // Leave the inputs alone while they're being used, so a running game never fights the player's hand.
    if (model.slider && range && typed) {
      const value = String(model.slider.value);
      if (document.activeElement !== range && range.value !== value) range.value = value;
      if (document.activeElement !== typed && typed.value !== value) typed.value = value;
    }
    model.rows.forEach(([label, value], i) => {
      set(labels[i]!, label);
      set(values[i]!, value);
    });
    model.actions.forEach((a, i) => {
      set(buttons[i]!, a.label);
      buttons[i]!.disabled = a.disabled ?? false;
    });
    if (note && note.textContent !== model.note) note.textContent = model.note ?? '';
  };
}
