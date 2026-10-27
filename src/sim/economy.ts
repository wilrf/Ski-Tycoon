import { CONFIG } from '../config';

/** Money in and out since the day began. */
export interface Ledger {
  tickets: number;
  food: number;
  /** Après drinks after the lifts close. */
  apres: number;
  bonuses: number;
  construction: number;
  refunds: number;
}

export interface Company {
  readonly name: string;
  money: number;
  today: Ledger;
  /** The best magazine rating the company has earned; stars unlock lifts, upgrades, buildings and land. */
  stars: number;
}

export const emptyLedger = (): Ledger => ({ tickets: 0, food: 0, apres: 0, bonuses: 0, construction: 0, refunds: 0 });

export const income = (l: Ledger): number => l.tickets + l.food + l.apres + l.bonuses;

export const createCompany = (name: string): Company => ({ name, money: CONFIG.economy.startingCash, today: emptyLedger(), stars: 0 });

/** Pays for construction; returns false and changes nothing when the company can't afford it. */
export function build(company: Company, cost: number): boolean {
  if (cost > company.money) return false;
  company.money -= cost;
  company.today.construction += cost;
  return true;
}

export function refund(company: Company, cost: number): void {
  const amount = Math.round(cost * CONFIG.economy.removalRefund);
  company.money += amount;
  company.today.refunds += amount;
}

export function earn(company: Company, kind: 'tickets' | 'food' | 'apres' | 'bonuses', amount: number): void {
  company.money += amount;
  company.today[kind] += amount;
}

/** Sells a day ticket to a skier who can pay for it. */
export function sellTicket(company: Company, skier: { cash: number }, price: number): boolean {
  if (skier.cash < price) return false;
  skier.cash -= price;
  earn(company, 'tickets', price);
  return true;
}

/** Arrivals scale down as the price rises above what skiers think is fair, and up below it. */
export const priceDemand = (price: number): number => (CONFIG.economy.fairTicketPrice / price) ** CONFIG.economy.priceSensitivity;
