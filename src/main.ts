import './style.css';
import { CONFIG } from './config';
import { attachKeyboard } from './input/keyboard';
import { attachPointer } from './input/pointer';
import { clampCamera, fitCamera, pan, toWorld, zoomAt } from './render/camera';
import { drawOverlay } from './render/overlay';
import { draw } from './render/renderer';
import { bakeTerrain } from './render/terrainArt';
import { loadGame, saveGame } from './save/save';
import type { Vec2 } from './sim/geometry';
import { terrainExtent } from './sim/terrain';
import { activeResort, createWorld, tick, type World, type WorldEvent } from './sim/world';
import { fixFor } from './ui/fixes';
import { money, requestTitle } from './ui/format';
import { createHud, type MenuCommand } from './ui/hud';
import { createMenus, type MenuChoice } from './ui/menu';
import { createPanel, describePanel } from './ui/panel';
import { mountIcons } from './ui/icons';
import { createToast } from './ui/toast';
import { createToolbar, toolFor } from './ui/toolbar';
import { createUiState, runAction, selectTool, strokeEnd, strokeMove, strokeStart, tapMap, type UiAction } from './ui/tools';

mountIcons();
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

// ?seed=123 starts a fresh game on that mountain, so a mountain can be shared by link.
const seedParam = new URLSearchParams(location.search).get('seed');
const randomSeed = (): number => Date.now() % 1e9;
const saved = seedParam ? null : loadSaved();
let world = seedParam ? createWorld(Number(seedParam) || 0) : (saved ?? createWorld(randomSeed()));
let terrain = bakeTerrain(activeResort(world));
const extent = (): number => terrainExtent(activeResort(world).terrain);
const camera = fitCamera(extent(), view);
let speedIndex = 1;
let previous = new Map<number, Vec2>();

function startWorld(next: World): void {
  world = next;
  terrain = bakeTerrain(activeResort(world));
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
  if (e.type === 'requestDone') return toast(`✅ ${requestTitle(e.request)}: +${money(e.request.reward)}`, 5);
  // The game waits at the end of each day until the report is read.
  if (!menus.reportOpen()) speedBeforeReport = speedIndex || speedBeforeReport;
  speedIndex = 0;
  menus.showReport(e);
  const store = storage();
  if (store) saveGame(store, world);
}

function act(action: UiAction): void {
  const message = runAction(world, ui, action);
  if (message) toast(message);
}

function menu(command: MenuCommand): void {
  if (command === 'save') return save();
  if (command === 'pause') return openMenu();
  if (command === 'load') {
    const loaded = loadSaved();
    if (loaded) startWorld(loaded);
    return toast(loaded ? 'Save loaded.' : 'No saved game yet.');
  }
  if (window.confirm('Start a new mountain? Anything since your last save will be lost.')) startWorld(createWorld(randomSeed()));
}

// The game is paused while the start screen or pause menu is up.
let speedBeforeMenu = 1;
function openMenu(): void {
  if (menus.isOpen()) return;
  speedBeforeMenu = speedIndex || 1;
  speedIndex = 0;
  menus.showPause();
}
function closeMenu(): void {
  menus.hide();
  speedIndex = menus.reportOpen() ? 0 : speedBeforeMenu;
}
function choose(choice: MenuChoice): void {
  switch (choice) {
    case 'continue': case 'resume': return closeMenu();
    case 'save': save(); return closeMenu();
    case 'load': menu('load'); return closeMenu();
    case 'new': {
      // A fresh, untouched mountain is already new; anything else asks first.
      const untouched = world.calendar.day === 1 && activeResort(world).lifts.length === 0;
      if (!untouched && !window.confirm('Start a new mountain? Anything since your last save will be lost.')) return;
      if (!untouched) startWorld(createWorld(randomSeed()));
      return closeMenu();
    }
    case 'help': return;
  }
}
let speedBeforeReport = 1;
const menus = createMenus(choose, {
  fixFor: (kind, place) => fixFor(world, kind, place),
  close(fix) {
    // Picking a fix leaves the game paused on the culprit; starting the day resumes at the old speed.
    if (!fix) speedIndex = speedBeforeReport;
    else if (fix.kind === 'select') {
      selectTool(ui, { kind: 'select' });
      ui.selection = fix.selection;
    } else if (fix.kind === 'tool') selectTool(ui, toolFor(fix.tool));
    else act(fix.action);
  },
});

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  view.width = canvas.clientWidth;
  view.height = canvas.clientHeight;
  canvas.width = Math.round(view.width * dpr);
  canvas.height = Math.round(view.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampCamera(camera, extent(), view);
}

// While the day report is up, the clock waits for its Start button.
function setSpeed(index: number): void {
  if (menus.reportOpen()) return toast('Read the day report, then start the next day.');
  speedIndex = index;
}

const refreshHud = createHud({ speed: setSpeed, menu, resort: () => act('resort') });
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
  drawing: () => ui.tool.kind === 'run',
  stroke: (phase, at) => {
    const p = toWorld(camera, view, at);
    if (phase === 'start') strokeStart(world, ui, p);
    else if (phase === 'move') strokeMove(world, ui, p);
    else if (phase === 'cancel') ui.stroking = false;
    else {
      const message = strokeEnd(world, ui, p);
      if (message) toast(message);
    }
  },
});

attachKeyboard((command) => {
  switch (command.type) {
    case 'action': return act(command.action);
    case 'tool': return selectTool(ui, toolFor(command.tool));
    case 'speed': return setSpeed(command.index);
    case 'menu': return menus.isOpen() ? closeMenu() : openMenu();
    case 'togglePause':
      if (menus.reportOpen()) return setSpeed(0);
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
if (!seedParam) {
  speedIndex = 0;
  menus.showStart(saved !== null);
}

// Fixed-timestep loop: the simulation always advances in whole ticks, however fast the screen refreshes.
let lastFrame = performance.now();
let pendingTicks = 0;
function frame(now: number): void {
  const { ticksPerSecond, speeds, maxTicksPerFrame } = CONFIG.loop;
  pendingTicks += (Math.min(now - lastFrame, 250) / 1000) * ticksPerSecond * speeds[speedIndex]!;
  lastFrame = now;
  // Falling this far behind means the device can't keep up; drop the backlog rather than spiral.
  const ticks = Math.min(Math.floor(pendingTicks), maxTicksPerFrame);
  pendingTicks = ticks === maxTicksPerFrame ? 0 : pendingTicks - ticks;
  // Stops early if a tick ends the day, so the report opens on the evening it describes.
  for (let n = 0; n < ticks && speedIndex > 0; n++) {
    // Only the last tick's starting positions matter for drawing between ticks.
    if (n === ticks - 1) previous = new Map(activeResort(world).skiers.map((s) => [s.id, s.pos]));
    tick(world).forEach(onEvent);
  }
  const frameState = { world, ui, camera, view, terrain, previous, alpha: pendingTicks };
  draw(ctx, frameState);
  drawOverlay(ctx, frameState);
  refreshHud(world, speedIndex);
  renderPanel(describePanel(world, ui));
  refreshToolbar(ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
