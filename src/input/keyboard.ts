import type { BuildingType, LiftType } from '../config';
import type { UiAction } from '../ui/tools';

export type KeyCommand =
  | { readonly type: 'action'; readonly action: UiAction }
  | { readonly type: 'tool'; readonly tool: 'select' | 'run' | LiftType | BuildingType }
  | { readonly type: 'speed'; readonly index: number }
  | { readonly type: 'togglePause' }
  | { readonly type: 'menu' };

const BINDINGS: Readonly<Record<string, KeyCommand>> = {
  ' ': { type: 'togglePause' },
  '1': { type: 'speed', index: 1 },
  '2': { type: 'speed', index: 2 },
  '3': { type: 'speed', index: 3 },
  m: { type: 'menu' },
  p: { type: 'togglePause' },
  o: { type: 'action', action: 'resort' },
  l: { type: 'tool', tool: 'lodge' },
  h: { type: 'tool', tool: 'hut' },
  u: { type: 'action', action: 'upgrade' },
  Escape: { type: 'action', action: 'cancel' },
  Enter: { type: 'action', action: 'confirm' },
  Backspace: { type: 'action', action: 'undoPoint' },
  Delete: { type: 'action', action: 'remove' },
  v: { type: 'tool', tool: 'select' },
  t: { type: 'tool', tool: 'ropeTow' },
  c: { type: 'tool', tool: 'chairlift' },
  g: { type: 'tool', tool: 'gondola' },
  r: { type: 'tool', tool: 'run' },
};

export function attachKeyboard(onCommand: (command: KeyCommand) => void): void {
  window.addEventListener('keydown', (e) => {
    const command = BINDINGS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!command || e.metaKey || e.ctrlKey || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    onCommand(command);
  });
}
