import type { Db } from "@/db";
import { forecastDailyLog } from "@/db/schema";
import { combine, summarise, weeklyResults, type AccuracySummary, type RecordedForecast, type WeekResult } from "./accuracy";
import { loadForecastLog } from "./history";
import { loadForecastBoard, type ForecastBoard, type SkuForecast } from "./repo";
import { addDays } from "./rules";

/**
 * Saves today's forecast for every SKU, once a day (the first forecast of the
 * day is kept), so it can be checked against real sales later.
 */
export async function recordDailyForecast(db: Db, board: ForecastBoard): Promise<number> {
  if (board.rows.length === 0) return 0;
  const rows = await db
    .insert(forecastDailyLog)
    .values(
      board.rows.map((r) => ({
        skuId: r.id,
        day: board.today,
        plannedRate: r.forecast.dailyRate === null ? null : Math.round(r.forecast.dailyRate * 10000) / 10000,
        rateSource: r.forecast.rateSource,
        seasonPct: r.forecast.seasonal?.nowPct ?? null,
        outOfStockDays: r.forecast.outOfStockDays,
      })),
    )
    .onConflictDoNothing()
    .returning({ skuId: forecastDailyLog.skuId });
  return rows.length;
}

/** Loads the forecast and records today's, for the daily Amazon pull. */
export async function recordTodaysForecast(db: Db, today: string): Promise<number> {
  return recordDailyForecast(db, await loadForecastBoard(db, today));
}

export type SkuAccuracy = {
  sku: SkuForecast;
  weeks: WeekResult[];
  summary: AccuracySummary;
};

export type AccuracyReport = {
  skus: SkuAccuracy[];
  byListing: { listingId: number; listingName: string; summary: AccuracySummary }[];
  total: AccuracySummary;
};

export async function loadAccuracy(db: Db, board: ForecastBoard): Promise<AccuracyReport> {
  const range = board.history.range;
  const log = range ? await loadForecastLog(db, addDays(range.first, -7)) : new Map();
  const skus: SkuAccuracy[] = board.rows.map((r) => {
    const h = board.history.bySku.get(r.id);
    if (!range || !h) return { sku: r, weeks: [], summary: summarise([]) };
    const recorded = new Map<string, RecordedForecast>();
    for (const [day, v] of (log.get(r.id) ?? new Map()) as Map<string, RecordedForecast>) recorded.set(day, v);
    const weeks = weeklyResults({
      sold: h.sold,
      outOfStock: h.outOfStock,
      firstDay: range.first,
      lastDay: range.last,
      recorded,
      monthPct: r.monthPct,
    });
    return { sku: r, weeks, summary: summarise(weeks) };
  });
  const listingIds = [...new Set(board.rows.map((r) => r.listingId))];
  const byListing = listingIds.map((id) => {
    const members = skus.filter((s) => s.sku.listingId === id);
    return { listingId: id, listingName: members[0].sku.listingName, summary: combine(members.map((m) => m.summary)) };
  });
  byListing.sort((a, b) => a.listingName.localeCompare(b.listingName));
  return { skus, byListing, total: combine(skus.map((s) => s.summary)) };
}
