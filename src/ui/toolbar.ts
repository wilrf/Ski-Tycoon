import type { BuildingType, LiftType } from '../config';
import type { Tool, UiState } from './tools';

export type ToolChoice = 'select' | 'run' | LiftType | BuildingType;

export function toolFor(choice: ToolChoice): Tool {
  switch (choice) {
    case 'select': return { kind: 'select' };
    case 'run': return { kind: 'run', points: [] };
    case 'lodge': case 'hut': return { kind: 'building', buildingType: choice, pos: null };
    default: return { kind: 'lift', liftType: choice, bottom: null, top: null };
  }
}

const choiceOf = (tool: Tool): ToolChoice =>
  tool.kind === 'lift' ? tool.liftType : tool.kind === 'building' ? tool.buildingType : tool.kind === 'feature' ? 'select' : tool.kind;

/** Wires the build toolbar and returns a function that highlights the active tool. */
export function createToolbar(el: HTMLElement, onPick: (choice: ToolChoice) => void): (ui: UiState) => void {
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[data-tool]')];
  buttons.forEach((b) => b.addEventListener('click', () => onPick(b.dataset['tool'] as ToolChoice)));
  return (ui) => buttons.forEach((b) => b.classList.toggle('active', b.dataset['tool'] === choiceOf(ui.tool)));
}
