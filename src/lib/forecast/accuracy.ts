/**
 * Forecast vs actual. For each full week (Monday to Sunday) the app compares
 * the units the forecast expected at the start of the week with the units that
 * actually sold that week.
 *
 * - The expected units use the forecast the app recorded that Monday (what the
 *   Overview showed, including numbers typed by hand). For weeks before the app
 *   started recording, the same rule is worked out afterwards from the sales
 *   history: last 30 days' sales per in-stock day, with the seasonal pattern.
 * - Days the SKU was out of stock are left out on both sides, because missing
 *   sales then are a stock problem, not a forecast problem.
 *
 * Plain arithmetic, covered by tests/unit/accuracy.test.ts.
 */

import { addDays, daysBetween, RULES } from "./rules";

export type WeekResult = {
  /** Monday of the week (YYYY-MM-DD). */
  weekStart: string;
  forecast: number;
  actual: number;
  /** Days of the week the SKU was in stock (0-7). */
  inStockDays: number;
  /** "recorded" = what the app said that Monday; "worked_out" = calculated afterwards from history. */
  source: "recorded" | "worked_out";
};

export type AccuracySummary = {
  weeks: number;
  forecast: number;
  actual: number;
  /** Sum of each week's miss in units. */
  miss: number;
  /** Sum of each week's miss, as a share of actual sales (0.2 = 20% off). Null with no actual sales. */
  errorShare: number | null;
  /** Forecast minus actual, as a share of actual (positive = forecast too high). */
  biasShare: number | null;
  verdict: Verdict;
};

export type Verdict = "good" | "fair" | "poor" | "too_few" | "none";

export const ACCURACY = {
  /** Weeks summed for the headline accuracy. */
  summaryWeeks: 4,
  /** Weeks shown in the weekly table. */
  tableWeeks: 8,
  /** History needed before the start of a week to work out a forecast for it. */
  minHistoryDays: 14,
  /** Up to this share off is "good", up to fair is "fair". */
  goodShare: 0.2,
  fairShare: 0.4,
  /** Fewer actual units than this over the summary weeks is too few to judge. */
  minUnits: 20,
} as const;

export type RecordedForecast = {
  /** Units a day the app planned with on that day, or null if it had no rate. */
  plannedRate: number | null;
};

export type AccuracyInput = {
  /** Units sold per day. Missing days sold 0. */
  sold: Map<string, number>;
  outOfStock: Set<string>;
  /** First and last day of ledger data. */
  firstDay: string;
  lastDay: string;
  /** What the app recorded each day (from the daily forecast log). */
  recorded: Map<string, RecordedForecast>;
  /** The listing's seasonal percentages by month, or null for none. */
  monthPct: number[] | null;
};

function factor(monthPct: number[] | null, day: string): number {
  return monthPct ? monthPct[Number(day.slice(5, 7)) - 1] / 100 : 1;
}

/** The Monday on or before a day. */
export function mondayOf(day: string): string {
  const dow = new Date(day + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/**
 * The daily rate the 30-day rule would have planned each day of the week
 * starting `weekStart`, from sales before that day. Null if too little history.
 */
export function workedOutRates(input: AccuracyInput, weekStart: string): number[] | null {
  const windowEnd = addDays(weekStart, -1);
  let windowStart = addDays(weekStart, -RULES.salesWindowDays);
  if (windowStart < input.firstDay) windowStart = input.firstDay;
  const days = daysBetween(windowStart, windowEnd) + 1;
  if (days < ACCURACY.minHistoryDays) return null;
  let units = 0;
  let inStock = 0;
  let factorSum = 0;
  for (let d = windowStart; d <= windowEnd; d = addDays(d, 1)) {
    factorSum += factor(input.monthPct, d);
    if (input.outOfStock.has(d)) continue;
    inStock++;
    units += input.sold.get(d) ?? 0;
  }
  if (inStock === 0) return null;
  const base = units / inStock / (factorSum / days);
  return Array.from({ length: 7 }, (_, i) => base * factor(input.monthPct, addDays(weekStart, i)));
}

/** Every full week inside the ledger history, oldest first. */
export function weeklyResults(input: AccuracyInput): WeekResult[] {
  const out: WeekResult[] = [];
  let start = mondayOf(input.firstDay);
  if (start < input.firstDay) start = addDays(start, 7);
  for (; addDays(start, 6) <= input.lastDay; start = addDays(start, 7)) {
    const rec = input.recorded.get(start);
    let rates: number[] | null;
    let source: WeekResult["source"];
    if (rec) {
      source = "recorded";
      rates = rec.plannedRate === null ? null : Array(7).fill(rec.plannedRate);
    } else {
      source = "worked_out";
      rates = workedOutRates(input, start);
    }
    if (!rates) continue;
    let forecast = 0;
    let actual = 0;
    let inStockDays = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (input.outOfStock.has(d)) continue;
      inStockDays++;
      forecast += rates[i];
      actual += input.sold.get(d) ?? 0;
    }
    if (inStockDays === 0) continue;
    out.push({ weekStart: start, forecast: Math.round(forecast * 10) / 10, actual, inStockDays, source });
  }
  return out;
}

export function verdictFor(errorShare: number | null, actual: number): Verdict {
  if (errorShare === null) return "none";
  if (actual < ACCURACY.minUnits) return "too_few";
  if (errorShare <= ACCURACY.goodShare) return "good";
  if (errorShare <= ACCURACY.fairShare) return "fair";
  return "poor";
}

/** Adds up weeks (the last `weeks` of them) into one accuracy figure. */
export function summarise(results: WeekResult[], weeks: number = ACCURACY.summaryWeeks): AccuracySummary {
  const last = results.slice(-weeks);
  const forecast = last.reduce((a, w) => a + w.forecast, 0);
  const actual = last.reduce((a, w) => a + w.actual, 0);
  const miss = last.reduce((a, w) => a + Math.abs(w.forecast - w.actual), 0);
  const errorShare = actual > 0 ? miss / actual : null;
  const biasShare = actual > 0 ? (forecast - actual) / actual : null;
  return {
    weeks: last.length,
    forecast: Math.round(forecast),
    actual,
    miss,
    errorShare,
    biasShare,
    verdict: last.length === 0 ? "none" : verdictFor(errorShare, actual),
  };
}

/** Several SKUs' summaries added into one, for a listing or the whole business. */
export function combine(parts: AccuracySummary[]): AccuracySummary {
  const used = parts.filter((p) => p.weeks > 0);
  const forecast = used.reduce((a, p) => a + p.forecast, 0);
  const actual = used.reduce((a, p) => a + p.actual, 0);
  const miss = used.reduce((a, p) => a + p.miss, 0);
  const errorShare = actual > 0 ? miss / actual : null;
  return {
    weeks: Math.max(0, ...used.map((p) => p.weeks)),
    forecast,
    actual,
    miss,
    errorShare,
    biasShare: actual > 0 ? (forecast - actual) / actual : null,
    verdict: used.length === 0 ? "none" : verdictFor(errorShare, actual),
  };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  too_few: "Too few sales to judge",
  none: "Not enough history yet",
};
