import { CONFIG } from '../config';

/** Money in and out since the day began. */
export interface Ledger {
  tickets: number;
  construction: number;
  refunds: number;
}

export interface Company {
  readonly name: string;
  money: number;
  today: Ledger;
}

export const emptyLedger = (): Ledger => ({ tickets: 0, construction: 0, refunds: 0 });

export const createCompany = (name: string): Company => ({ name, money: CONFIG.economy.startingCash, today: emptyLedger() });

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

/** Sells a day ticket to a skier who can pay for it. */
export function sellTicket(company: Company, skier: { cash: number }): boolean {
  const price = CONFIG.economy.ticketPrice;
  if (skier.cash < price) return false;
  skier.cash -= price;
  company.money += price;
  company.today.tickets += price;
  return true;
}
