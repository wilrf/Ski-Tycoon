import './menu.css';
import { CONFIG } from '../config';
import { income } from '../sim/economy';
import { GRIPES, PRAISE, topFeelings, worstPlace } from '../sim/progress';
import type { FeelingKind } from '../sim/skiers';
import type { DayReport } from '../sim/world';
import type { Fix, FixTarget } from './fixes';
import { money, quoteText, requestTitle, stars, tallyText, weatherText } from './format';

export type MenuChoice = 'continue' | 'new' | 'resume' | 'save' | 'load' | 'help';

const el = (tag: string, className = '', text = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

const HELP: readonly (readonly [string, string])[] = [
  ['Open the mountain', 'Build a lift that starts in the flat base area at the bottom. Skiers only come once one does.'],
  ['Draw runs', 'Pick Run and drag down the mountain from a lift’s top station or from another run. The slope colours show how steep each spot is (green, blue, black, red for double black). The end snaps to a lift, the base or another run, and the run opens when you let go.'],
  ['Watch your skiers', 'Tap a skier to see how they feel and why, or open Resort to see what everyone is saying today. Each evening the day report pauses the game, lists the top complaints and takes you straight to the fix.'],
  ['Grow', 'Happy skiers come back, and beginners who enjoy your greens move up a level. Every few days a magazine rates you. Stars pay a bonus and unlock lifts, upgrades, huts and land further up the mountain.'],
  ['Earn', 'Set the ticket price in Resort: higher brings fewer, grumpier skiers. Lodges and huts sell lunch. Requests pay a bonus if you meet them in time.'],
  ['Weather', 'Check tomorrow’s forecast in the day report. Powder days pull in experts, and storms stop exposed lifts high on the mountain.'],
  ['Keys', 'P (or Space) play and pause, 1–4 speed, V select, T tow, C chair, G gondola, R run, L lodge, H hut, O resort, U upgrade, M menu, Esc cancel.'],
];

export interface ReportHandlers {
  /** How to fix a complaint that happened most at `place`. */
  fixFor(kind: FeelingKind, place: string): Fix | null;
  /** The report was closed, by its button or by picking a fix. */
  close(fix: FixTarget | null): void;
}

/** The start screen, pause menu and end-of-day report; each pauses the game while it's up. */
export function createMenus(onChoice: (choice: MenuChoice) => void, handlers: ReportHandlers): {
  showStart(hasSave: boolean): void;
  showPause(): void;
  hide(): void;
  isOpen(): boolean;
  showReport(report: DayReport): void;
  reportOpen(): boolean;
} {
  const screen = document.body.appendChild(el('div', 'menu-screen'));
  screen.hidden = true;
  const reportScreen = document.body.appendChild(el('div', 'menu-screen report-screen'));
  reportScreen.hidden = true;
  const report = reportScreen.appendChild(el('section', 'day-report'));
  const closeReport = (fix: FixTarget | null): void => {
    reportScreen.hidden = true;
    handlers.close(fix);
  };

  const render = (title: string, subtitle: string, choices: readonly (readonly [MenuChoice, string, boolean?])[]): void => {
    screen.replaceChildren();
    const card = screen.appendChild(el('div', 'menu-card'));
    card.appendChild(el('h1', '', title));
    card.appendChild(el('p', 'tagline', subtitle));
    const buttons = card.appendChild(el('div', 'menu-buttons'));
    for (const [choice, label, primary] of choices) {
      const b = buttons.appendChild(el('button', primary ? 'primary' : '', label)) as HTMLButtonElement;
      b.addEventListener('click', () => {
        if (choice === 'help') return showHelp(card);
        onChoice(choice);
      });
    }
    screen.hidden = false;
  };

  const showHelp = (card: HTMLElement): void => {
    card.querySelector('.help')?.remove();
    const help = card.appendChild(el('dl', 'help'));
    for (const [term, text] of HELP) {
      help.appendChild(el('dt', '', term));
      help.appendChild(el('dd', '', text));
    }
  };

  return {
    showStart(hasSave) {
      render('Summit Tycoon', 'Carve a ski resort out of a wild mountain. Keep your skiers happy and they’ll keep coming back.', [
        ...(hasSave ? [['continue', 'Continue', true] as const] : []),
        ['new', 'New mountain', !hasSave],
        ['help', 'How to play'],
      ]);
    },
    showPause() {
      render('Paused', 'The mountain waits for you.', [['resume', 'Resume', true], ['save', 'Save'], ['load', 'Load'], ['new', 'New mountain'], ['help', 'How to play']]);
    },
    hide() {
      screen.hidden = true;
    },
    isOpen: () => !screen.hidden,
    reportOpen: () => !reportScreen.hidden,
    showReport(r) {
      report.replaceChildren();
      report.appendChild(el('h2', '', `Day ${r.day} report`));
      const left = r.stats.leftHappy + r.stats.leftUnhappy;
      const happyShare = left ? Math.round((r.stats.leftHappy / left) * 100) : 0;
      const rows: [string, string][] = [
        ['Skiers', `${r.stats.arrivals} (${r.stats.regulars} regulars)`],
        ['Went home happy', `${happyShare}%`],
        ['Income', `${money(income(r.ledger))} (tickets ${money(r.ledger.tickets)}, food ${money(r.ledger.food)}${r.ledger.apres ? `, après ${money(r.ledger.apres)}` : ''}${r.ledger.bonuses ? `, bonuses ${money(r.ledger.bonuses)}` : ''})`],
        ...(r.ledger.upkeep ? [['Feature upkeep', money(r.ledger.upkeep)] as [string, string]] : []),
        ...(r.stats.apresGuests || r.stats.apresTurnedAway
          ? [['Après', `${r.stats.apresGuests} guests${r.stats.apresTurnedAway ? `, ${r.stats.apresTurnedAway} turned away for lack of seats` : ''}`] as [string, string]]
          : []),
        ['Reputation', `${Math.round(r.reputation.before)}% → ${Math.round(r.reputation.after)}%`],
        ...(r.stats.movedUp ? [['Moved up a level', `${r.stats.movedUp} skiers`] as [string, string]] : []),
        ['Tomorrow', weatherText(r.forecast.today)],
        ['Next review', `End of day ${Math.ceil((r.day + 1) / CONFIG.review.everyDays) * CONFIG.review.everyDays}`],
      ];
      const dl = report.appendChild(el('dl'));
      for (const [k, v] of rows) {
        dl.appendChild(el('dt', '', k));
        dl.appendChild(el('dd', '', v));
      }
      if (r.review) {
        const review = report.appendChild(el('section', 'review'));
        review.appendChild(el('h3', '', `${CONFIG.review.magazine} rates you ${stars(r.review.stars)}`));
        if (r.newStars > 0) review.appendChild(el('p', 'good', `New rating! ${money(r.starBonus)} bonus. Check the toolbar and Resort for what unlocked.`));
        for (const q of r.review.quotes) review.appendChild(el('p', 'quote', quoteText(q)));
      }
      const list = (title: string, lines: string[], cls = ''): void => {
        if (lines.length === 0) return;
        report.appendChild(el('h3', '', title));
        const ul = report.appendChild(el('ul', cls));
        for (const line of lines) ul.appendChild(el('li', '', line));
      };
      const tally = r.stats.feelings;
      list('Skiers loved', topFeelings(tally, PRAISE, 3).map((k) => tallyText(k, tally[k]!.count)), 'good');
      const gripes = topFeelings(tally, GRIPES, 3);
      if (gripes.length > 0) {
        report.appendChild(el('h3', '', 'Skiers complained'));
        const ul = report.appendChild(el('ul', 'gripes'));
        for (const kind of gripes) {
          const place = worstPlace(tally, kind);
          const li = ul.appendChild(el('li'));
          li.appendChild(el('span', 'bad', `${tallyText(kind, tally[kind]!.count)}${place ? `, mostly at ${place}` : ''}`));
          const fix = handlers.fixFor(kind, place);
          if (!fix) continue;
          li.appendChild(el('p', 'advice', fix.advice));
          const b = li.appendChild(el('button', '', fix.label)) as HTMLButtonElement;
          b.addEventListener('click', () => closeReport(fix.target));
        }
      }
      list('Requests', [
        ...r.done.map((q) => `✅ ${requestTitle(q)}: +${money(q.reward)}`),
        ...r.failed.map((q) => `❌ ${requestTitle(q)}: missed`),
        ...r.offered.map((q) => `📋 New: ${requestTitle(q)}, ${money(q.reward)} by day ${q.deadline}`),
      ]);
      const start = report.appendChild(el('button', 'primary start-day', `Start day ${r.day + 1}`)) as HTMLButtonElement;
      start.addEventListener('click', () => closeReport(null));
      reportScreen.hidden = false;
    },
  };
}
