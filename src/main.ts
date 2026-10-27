import './style.css';
import { CONFIG } from './config';
import { attachKeyboard } from './input/keyboard';
import { attachPointer } from './input/pointer';
import { clampCamera, fitCamera, pan, toWorld, zoomAt } from './render/camera';
import { draw } from './render/renderer';
import { bakeTerrain } from './render/terrainImage';
import { loadGame, saveGame } from './save/save';
import type { Vec2 } from './sim/geometry';
import { terrainExtent } from './sim/terrain';
import { activeResort, createWorld, tick, type World, type WorldEvent } from './sim/world';
import { money } from './ui/format';
import { createHud, type MenuCommand } from './ui/hud';
import { createPanel, describePanel } from './ui/panel';
import { createToast } from './ui/toast';
import { createToolbar, toolFor } from './ui/toolbar';
import { createUiState, runAction, selectTool, tapMap, type UiAction } from './ui/tools';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const toast = createToast(document.getElementById('toast')!);
const ui = createUiState();
const view = { width: canvas.clientWidth, height: canvas.clientHeight };

// Private browsing can make localStorage throw; the game still runs, it just can't save.
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadSaved(): World | null {
  const store = storage();
  const result = store && loadGame(store);
  if (result && !result.ok) toast(`Couldn’t load your save: ${result.error}`, 6);
  return result?.ok ? result.world : null;
}

let world = loadSaved() ?? createWorld(Date.now() % 1e9);
let terrainImage = bakeTerrain(activeResort(world).terrain);
const extent = (): number => terrainExtent(activeResort(world).terrain);
const camera = fitCamera(extent(), view);
let speedIndex = 1;
let previous = new Map<number, Vec2>();

function startWorld(next: World): void {
  world = next;
  terrainImage = bakeTerrain(activeResort(world).terrain);
  selectTool(ui, { kind: 'select' });
  Object.assign(camera, fitCamera(extent(), view));
  previous = new Map();
}

function save(): void {
  const store = storage();
  if (!store) return toast('Saving isn’t available in this browser mode.');
  try {
    saveGame(store, world);
    toast('Game saved.');
  } catch {
    toast('Couldn’t save: browser storage is full.');
  }
}

function onEvent(e: WorldEvent): void {
  const { stats, ledger } = e;
  toast(`Day ${e.day} over: ${stats.arrivals} skiers, ${money(ledger.tickets)} in tickets. ${stats.leftHappy} went home happy, ${stats.leftUnhappy} unhappy.`, 6);
  save();
}

function act(action: UiAction): void {
  const message = runAction(world, ui, action);
  if (message) toast(message);
}

function menu(command: MenuCommand): void {
  if (command === 'save') return save();
  if (command === 'load') {
    const loaded = loadSaved();
    if (loaded) startWorld(loaded);
    return toast(loaded ? 'Save loaded.' : 'No saved game yet.');
  }
  if (window.confirm('Start a new mountain? Anything since your last save will be lost.')) startWorld(createWorld(Date.now() % 1e9));
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  view.width = canvas.clientWidth;
  view.height = canvas.clientHeight;
  canvas.width = Math.round(view.width * dpr);
  canvas.height = Math.round(view.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampCamera(camera, extent(), view);
}

const refreshHud = createHud({ speed: (i) => void (speedIndex = i), menu });
const renderPanel = createPanel(document.getElementById('panel')!, act);
const refreshToolbar = createToolbar(document.getElementById('toolbar')!, (choice) => selectTool(ui, toolFor(choice)));
let speedBeforePause = 1;

attachPointer(canvas, {
  pan: (dx, dy) => {
    pan(camera, dx, dy);
    clampCamera(camera, extent(), view);
  },
  zoom: (factor, at) => zoomAt(camera, view, at, factor, extent()),
  tap: (at) => {
    // Hit radius is a fixed size on screen so small things stay tappable when zoomed out.
    const message = tapMap(world, ui, toWorld(camera, view, at), 14 / camera.zoom);
    if (message) toast(message);
  },
  hover: (at) => {
    ui.hover = at && toWorld(camera, view, at);
  },
});

attachKeyboard((command) => {
  switch (command.type) {
    case 'action': return act(command.action);
    case 'tool': return selectTool(ui, toolFor(command.tool));
    case 'speed': return void (speedIndex = command.index);
    case 'togglePause':
      if (speedIndex > 0) speedBeforePause = speedIndex;
      speedIndex = speedIndex > 0 ? 0 : speedBeforePause;
  }
});

window.addEventListener('resize', resize);
// Phones often kill a backgrounded tab, so save whenever the page is hidden.
document.addEventListener('visibilitychange', () => {
  const store = storage();
  if (document.hidden && store) saveGame(store, world);
});
resize();

// Fixed-timestep loop: the simulation always advances in whole ticks, however fast the screen refreshes.
let lastFrame = performance.now();
let pendingTicks = 0;
function frame(now: number): void {
  const { ticksPerSecond, speeds, maxTicksPerFrame } = CONFIG.loop;
  pendingTicks += (Math.min(now - lastFrame, 250) / 1000) * ticksPerSecond * speeds[speedIndex]!;
  lastFrame = now;
  for (let n = 0; pendingTicks >= 1; n++) {
    // Falling this far behind means the device can't keep up; drop the backlog rather than spiral.
    if (n === maxTicksPerFrame) pendingTicks = 0;
    else {
      previous = new Map(activeResort(world).skiers.map((s) => [s.id, s.pos]));
      tick(world).forEach(onEvent);
      pendingTicks--;
    }
  }
  draw(ctx, { world, ui, camera, view, terrainImage, previous, alpha: pendingTicks });
  refreshHud(world, speedIndex);
  renderPanel(describePanel(world, ui));
  refreshToolbar(ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
