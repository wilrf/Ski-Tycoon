import { CONFIG } from '../config';
import { income } from '../sim/economy';
import { liftsFrom } from '../sim/network';
import { activeResort, isApres, isClosed, type World } from '../sim/world';
import { clock, money, percent, requestTitle } from './format';

export type MenuCommand = 'save' | 'load' | 'new' | 'pause';

export interface HudHandlers {
  speed(index: number): void;
  menu(command: MenuCommand): void;
  resort(): void;
}

/** The next thing to do, so there's always a goal on screen. */
function nextStep(world: World): string {
  const resort = activeResort(world);
  if (liftsFrom(resort, resort.entrance).length === 0) return 'Build a lift starting in the flat base area at the bottom to open the mountain.';
  if (resort.runs.length === 0) return 'Pick Run and drag from the lift’s top station down to the base.';
  const goal = world.requests.filter((r) => r.status === 'active').sort((a, b) => a.deadline - b.deadline)[0];
  return goal ? `📋 ${requestTitle(goal)}: ${money(goal.reward)} by day ${goal.deadline}` : '';
}

const byId = (id: string): HTMLElement => document.getElementById(id)!;

/** Wires the top bar and returns a function that refreshes it each frame. */
export function createHud(h: HudHandlers): (world: World, speedIndex: number) => void {
  const fields = {
    day: byId('hud-day'), time: byId('hud-time'), money: byId('hud-money'), skiers: byId('hud-skiers'), happiness: byId('hud-happiness'),
    income: byId('hud-income'), weather: byId('hud-weather'), rating: byId('hud-rating'), hint: byId('hint'),
  };
  fields.rating.addEventListener('click', () => h.resort());
  fields.hint.addEventListener('click', () => h.resort());
  const speedButtons = [...byId('speed').querySelectorAll<HTMLButtonElement>('button')];
  speedButtons.forEach((b, i) => b.addEventListener('click', () => h.speed(i)));
  byId('menu').addEventListener('click', (e) => {
    const command = (e.target as HTMLElement).closest<HTMLElement>('[data-menu]')?.dataset['menu'];
    if (command) h.menu(command as MenuCommand);
  });
  const set = (el: HTMLElement, text: string): void => {
    if (el.textContent !== text) el.textContent = text;
  };

  return (world, speedIndex) => {
    const resort = activeResort(world);
    const { skiers } = resort;
    set(fields.day, `Day ${world.calendar.day}`);
    set(fields.time, isApres(world) ? `Après ${clock(world.calendar.time)}` : isClosed(world) ? 'Closed' : clock(world.calendar.time));
    set(fields.money, money(world.company.money));
    set(fields.skiers, String(skiers.length));
    set(fields.happiness, skiers.length ? percent(skiers.reduce((sum, s) => sum + s.happiness, 0) / skiers.length) : '–');
    set(fields.income, `+${money(income(world.company.today))} today`);
    const weather = CONFIG.weather.kinds;
    set(fields.weather, `${weather[world.weather.today].emoji} → ${weather[world.weather.tomorrow].emoji}`);
    set(fields.rating, world.company.stars > 0 ? `${'★'.repeat(world.company.stars)} Resort` : '☆ Resort');
    speedButtons.forEach((b, i) => b.classList.toggle('active', i === speedIndex));
    const hint = nextStep(world);
    set(fields.hint, hint);
    fields.hint.hidden = hint === '';
  };
}
