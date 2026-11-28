/**
 * The seasonal pattern, per listing: how busy each calendar month is compared
 * with a normal month, as a percentage (100 = normal, 150 = sells half as much
 * again, 70 = sells 30% less).
 *
 * - Automatic: once a listing has sales history for every calendar month
 *   (12 months), each month's percentage is that month's sales per in-stock day
 *   divided by the average month. Out-of-stock days are left out first.
 * - By hand: the owner can type a percentage for any month. A typed month
 *   always wins over the automatic one. Months with neither are 100.
 * - Off: the listing plans from the last 30 days as they are.
 *
 * The sales rate from the last 30 days is first turned into a "normal month"
 * rate (divided by how busy those 30 days were), then each future day is
 * planned at that rate times its own month's percentage.
 *
 * Plain arithmetic, covered by tests/unit/seasonal.test.ts.
 */

import { addDays } from "./rules";

/** One listing's sales in one calendar month (YYYY-MM). */
export type MonthStat = {
  month: string;
  /** Units sold across the listing's SKUs. */
  units: number;
  /** Days of ledger data the app holds in this month. */
  dataDays: number;
  /** Sum over the listing's SKUs of days in stock (within dataDays). */
  inStockSkuDays: number;
  /** SKUs in the listing. */
  skuCount: number;
};

export const SEASON = {
  /** A month counts for the automatic pattern when it has at least this many days of data. */
  minDataDays: 20,
  /** ...and the listing's SKUs were in stock for at least this share of those days. */
  minInStockShare: 0.5,
  /** Automatic percentages are kept between these, so one odd month cannot swing plans wildly. */
  minPct: 25,
  maxPct: 400,
  /** Typed percentages must be between these. */
  inputMin: 10,
  inputMax: 500,
} as const;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type AutoSeason =
  | { ready: true; pct: number[]; usableMonths: number }
  /** Not enough history yet: which calendar months (1-12) are covered so far. */
  | { ready: false; coveredMonths: number[] };

/** Sales per day with every SKU in stock, or null when the month has too little data. */
export function monthRate(s: MonthStat): number | null {
  if (s.dataDays < SEASON.minDataDays || s.skuCount <= 0) return null;
  if (s.inStockSkuDays < SEASON.minInStockShare * s.skuCount * s.dataDays) return null;
  // Units per in-stock SKU-day, times the number of SKUs = the listing's daily sales with all in stock.
  return (s.units / s.inStockSkuDays) * s.skuCount;
}

/** The automatic pattern for a listing, once every calendar month has usable history. */
export function autoSeason(stats: MonthStat[]): AutoSeason {
  const byCalMonth = new Map<number, number[]>();
  for (const s of stats) {
    const r = monthRate(s);
    if (r === null) continue;
    const m = Number(s.month.slice(5, 7));
    byCalMonth.set(m, [...(byCalMonth.get(m) ?? []), r]);
  }
  const covered = [...byCalMonth.keys()].sort((a, b) => a - b);
  if (covered.length < 12) return { ready: false, coveredMonths: covered };
  // Average years first, so a month seen twice does not count double.
  const rates = Array.from({ length: 12 }, (_, i) => {
    const v = byCalMonth.get(i + 1)!;
    return v.reduce((a, b) => a + b, 0) / v.length;
  });
  const mean = rates.reduce((a, b) => a + b, 0) / 12;
  if (mean <= 0) return { ready: false, coveredMonths: covered };
  const pct = rates.map((r) => Math.min(SEASON.maxPct, Math.max(SEASON.minPct, Math.round((r / mean) * 100))));
  return { ready: true, pct, usableMonths: stats.filter((s) => monthRate(s) !== null).length };
}

export type SeasonSetting = {
  enabled: boolean;
  /** Typed percentages by calendar month (1-12). */
  typed: Map<number, number>;
};

/**
 * The percentage used for each calendar month (index 0 = January), or null
 * when the listing plans without a seasonal pattern (switched off, or every
 * month would be 100).
 */
export function effectiveSeason(setting: SeasonSetting, auto: AutoSeason): number[] | null {
  if (!setting.enabled) return null;
  const pct = Array.from({ length: 12 }, (_, i) => setting.typed.get(i + 1) ?? (auto.ready ? auto.pct[i] : 100));
  return pct.every((p) => p === 100) ? null : pct;
}

/** The month percentage for a day (YYYY-MM-DD) as a multiplier (150% = 1.5). */
export function factorOn(monthPct: number[], day: string): number {
  return monthPct[Number(day.slice(5, 7)) - 1] / 100;
}

/** Average multiplier over the days from `from` to `to`, both included. */
export function averageFactor(monthPct: number[], from: string, to: string): number {
  let sum = 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    sum += factorOn(monthPct, d);
    n++;
  }
  return n === 0 ? 1 : sum / n;
}

/** Reads a typed percentage box. Blank means "use automatic / normal". */
export function parseSeasonPct(text: string): { value: number | null } | { error: string } {
  const t = text.trim().replace(/%$/, "").trim();
  if (t === "") return { value: null };
  if (!/^\d{1,3}$/.test(t)) return { error: "Enter a whole percentage, for example 150 for a busy month or 70 for a slow one." };
  const v = Number(t);
  if (v < SEASON.inputMin || v > SEASON.inputMax) {
    return { error: `Enter a percentage between ${SEASON.inputMin} and ${SEASON.inputMax}, or leave the box blank.` };
  }
  return { value: v };
}
