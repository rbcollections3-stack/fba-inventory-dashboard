/**
 * Out-of-stock days. A day when a SKU had nothing to sell must not count as a
 * day of zero sales, or the sales rate (and every date after it) comes out too
 * low. This is plain arithmetic with no database, covered by
 * tests/unit/stock-days.test.ts.
 *
 * The Inventory Ledger lists every unit that moved in or out of Amazon's
 * sellable stock each day, but not the stock level itself. The latest FBA stock
 * report gives the level on one day, so the level on every other day is worked
 * back (or forward) from it with the ledger. A day counts as out of stock when
 * nothing sold that day and either
 *  - the worked-out sellable stock at the start of the day was 0 or less, or
 *  - an FBA stock report from that day showed 0 available.
 * A day with any sale is always in stock.
 */

import { addDays } from "./rules";

export type DayFlow = {
  /** Units shipped to customers that day. */
  sold: number;
  /** Net change in SELLABLE stock that day (receipts, returns, sales, adjustments, transfers). */
  sellableNet: number;
};

export type StockAnchor = {
  /** The day the stock figure is from: the level at the start of this day. */
  day: string;
  /** Sellable units Amazon holds (available + reserved). */
  sellable: number;
};

export type StockDaysInput = {
  /** Ledger figures per day (YYYY-MM-DD). Days missing from the map had no movement. */
  flows: Map<string, DayFlow>;
  /** First and last day of ledger data the app holds. */
  firstDay: string;
  lastDay: string;
  /** The latest FBA stock figure, or null if none is loaded. */
  anchor: StockAnchor | null;
  /** Days on which an FBA stock report showed 0 available. */
  zeroStockDays?: Set<string>;
};

/** Every day from `from` to `to`, both included. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The days a SKU was out of stock between firstDay and lastDay. */
export function outOfStockDays(input: StockDaysInput): Set<string> {
  const out = new Set<string>();
  if (input.firstDay > input.lastDay) return out;
  const days = eachDay(input.firstDay, input.lastDay);
  const net = (d: string) => input.flows.get(d)?.sellableNet ?? 0;

  // Opening sellable stock for each day, worked from the anchor day.
  const opening = new Map<string, number>();
  const a = input.anchor;
  // A day with sales proves there was stock to sell, so a worked-out opening
  // level too low for that day's sales (after what arrived that day) is lifted.
  // The ledger and the stock report never match to the unit, and this stops
  // small gaps from adding up into false stock-outs.
  const sold = (d: string) => {
    const f = input.flows.get(d);
    if (!f || f.sold <= 0) return 0;
    const arrived = Math.max(0, f.sellableNet + f.sold);
    return Math.max(0, f.sold - arrived);
  };
  if (a) {
    // Days on and after the anchor: walk forward.
    let level = a.sellable;
    for (let d = a.day; d <= input.lastDay; d = addDays(d, 1)) {
      level = Math.max(level, sold(d));
      opening.set(d, level);
      level += net(d);
    }
    // Days before the anchor: walk back.
    level = a.sellable;
    for (let d = addDays(a.day, -1); d >= input.firstDay; d = addDays(d, -1)) {
      level = Math.max(level - net(d), sold(d));
      opening.set(d, level);
    }
  }

  for (const d of days) {
    if ((input.flows.get(d)?.sold ?? 0) > 0) continue;
    const open = opening.get(d);
    if ((open !== undefined && open <= 0) || input.zeroStockDays?.has(d)) out.add(d);
  }
  return out;
}

/** How many of `days` fall between from and to (both included). */
export function countBetween(days: Set<string>, from: string, to: string): number {
  let n = 0;
  for (const d of days) if (d >= from && d <= to) n++;
  return n;
}
