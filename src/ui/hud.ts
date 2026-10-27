import { liftsFrom } from '../sim/network';
import { activeResort, isClosed, type World } from '../sim/world';
import { clock, money, percent } from './format';

export type MenuCommand = 'save' | 'load' | 'new';

export interface HudHandlers {
  speed(index: number): void;
  menu(command: MenuCommand): void;
}

const byId = (id: string): HTMLElement => document.getElementById(id)!;

/** Wires the top bar and returns a function that refreshes it each frame. */
export function createHud(h: HudHandlers): (world: World, speedIndex: number) => void {
  const fields = { day: byId('hud-day'), time: byId('hud-time'), money: byId('hud-money'), skiers: byId('hud-skiers'), happiness: byId('hud-happiness'), hint: byId('hint') };
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
    set(fields.time, isClosed(world) ? 'Closed' : clock(world.calendar.time));
    set(fields.money, money(world.company.money));
    set(fields.skiers, String(skiers.length));
    set(fields.happiness, skiers.length ? percent(skiers.reduce((sum, s) => sum + s.happiness, 0) / skiers.length) : '–');
    speedButtons.forEach((b, i) => b.classList.toggle('active', i === speedIndex));
    const hint = liftsFrom(resort, resort.entrance).length > 0 ? '' : 'Build a lift starting in the flat base area at the bottom to open the mountain.';
    set(fields.hint, hint);
    fields.hint.hidden = hint === '';
  };
}
