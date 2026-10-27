import type { LiftType } from '../config';
import type { Tool, UiState } from './tools';

export type ToolChoice = 'select' | 'run' | LiftType;

export const toolFor = (choice: ToolChoice): Tool =>
  choice === 'select' ? { kind: 'select' } : choice === 'run' ? { kind: 'run', points: [] } : { kind: 'lift', liftType: choice, bottom: null, top: null };

const choiceOf = (tool: Tool): ToolChoice => (tool.kind === 'lift' ? tool.liftType : tool.kind);

/** Wires the build toolbar and returns a function that highlights the active tool. */
export function createToolbar(el: HTMLElement, onPick: (choice: ToolChoice) => void): (ui: UiState) => void {
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[data-tool]')];
  buttons.forEach((b) => b.addEventListener('click', () => onPick(b.dataset['tool'] as ToolChoice)));
  return (ui) => buttons.forEach((b) => b.classList.toggle('active', b.dataset['tool'] === choiceOf(ui.tool)));
}
