import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { amazonImports, fbaLedgerDaily, forecastSettings } from "@/db/schema";
import { latestFbaStock, recentSales, type FbaFigures } from "@/lib/amazon/repo";
import { businessTimeZone } from "@/lib/dates";
import { onOrderBySku } from "@/lib/china/repo";
import { sentNotYetReported } from "@/lib/shipments/repo";
import { listSkus, type SkuWithStock } from "@/lib/skus/repo";
import { loadForecastHistory, type ForecastHistory } from "./history";
import { compareUrgency, daysBetween, forecastSku, RULES, type Forecast } from "./rules";
import { averageFactor } from "./seasonal";
import { countBetween } from "./stock-days";

export type SkuForecast = SkuWithStock & {
  fba: FbaFigures | null;
  unitsSold: number | null;
  manualDailySales: number | null;
  manualNote: string | null;
  /** Units marked sent in this app that Amazon's latest stock report does not show yet (Phase 5). */
  sentNotInReport: number;
  /** The listing's seasonal percentages by month (Phase 7), or null when none apply. */
  monthPct: number[] | null;
  /** Units ordered from China and not yet received (Phase 6). */
  onOrder: number;
  forecast: Forecast;
};

export type ForecastBoard = {
  rows: SkuForecast[];
  /** The sales window the rates come from, or null if no sales are loaded. */
  sales: { start: string; end: string; days: number } | null;
  /** When the newest FBA stock figures were true. */
  stockAsOf: Date | null;
  today: string;
  /** Sales history, out-of-stock days and seasonal patterns (Phase 7). */
  history: ForecastHistory;
};

/** The calendar day (YYYY-MM-DD) a moment falls on in the business's time zone. */
export function dayInBusinessZone(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: businessTimeZone() });
}

/** First day of ledger data the app holds, so a short history gives a lower day count. */
async function firstLedgerDay(db: Db): Promise<string | null> {
  const [a] = await db.select({ d: sql<string | null>`min(${fbaLedgerDaily.day})::text` }).from(fbaLedgerDaily);
  const [b] = await db
    .select({ d: sql<string | null>`min(${amazonImports.periodStart})::text` })
    .from(amazonImports)
    .where(eq(amazonImports.kind, "ledger_detail"));
  return [a?.d, b?.d].filter((d): d is string => !!d).sort()[0] ?? null;
}

export async function getForecastSettings(db: Db) {
  const rows = await db.select().from(forecastSettings);
  return new Map(rows.map((r) => [r.skuId, r]));
}

export async function setManualDailySales(
  db: Db,
  skuId: number,
  value: number | null,
  note: string | null,
  userId: number | null,
): Promise<void> {
  await db
    .insert(forecastSettings)
    .values({ skuId, manualDailySales: value, note, updatedBy: userId })
    .onConflictDoUpdate({
      target: forecastSettings.skuId,
      set: { manualDailySales: value, note, updatedBy: userId, updatedAt: new Date() },
    });
}

/** Every SKU with its forecast, most urgent first. */
export async function loadForecastBoard(db: Db, today: string): Promise<ForecastBoard> {
  const [base, fba, sales, settings, firstDay, sent, ordered, history] = await Promise.all([
    listSkus(db),
    latestFbaStock(db),
    recentSales(db, RULES.salesWindowDays),
    getForecastSettings(db),
    firstLedgerDay(db),
    sentNotYetReported(db),
    onOrderBySku(db),
    loadForecastHistory(db),
  ]);

  let salesDays = 0;
  let windowStart: string | null = null;
  if (sales) {
    const start = firstDay && firstDay > sales.start ? firstDay : sales.start;
    windowStart = start;
    salesDays = daysBetween(start, sales.end) + 1;
  }

  const rows: SkuForecast[] = base.map((s) => {
    const f = fba.get(s.id) ?? null;
    const setting = settings.get(s.id);
    const unitsSold = sales ? (sales.bySku.get(s.id) ?? 0) : null;
    const manualDailySales = setting?.manualDailySales ?? null;
    // A shipment marked sent here counts as on the way until Amazon's report shows it.
    const sentNotInReport = sent.get(s.id) ?? 0;
    // Phase 7: leave out days the SKU had nothing to sell, and apply the listing's seasonal pattern.
    const h = history.bySku.get(s.id);
    const outOfStockDays = h && sales && windowStart ? countBetween(h.outOfStock, windowStart, sales.end) : 0;
    const monthPct = history.seasons.get(s.listingId)?.monthPct ?? null;
    const season =
      monthPct && sales && windowStart ? { monthPct, windowFactor: averageFactor(monthPct, windowStart, sales.end) } : null;
    const forecast = forecastSku({
      unitsPerCase: s.unitsPerCase,
      unitsSold,
      salesDays,
      manualDailySales,
      fba: f ? { available: f.fulfillable, inbound: f.inbound + sentNotInReport } : null,
      stockDay: f ? dayInBusinessZone(f.asOf) : null,
      warehouse: s.warehouseOnHand,
      onOrder: ordered.get(s.id) ?? 0,
      today,
      outOfStockDays,
      season,
    });
    return {
      ...s,
      fba: f,
      unitsSold,
      manualDailySales,
      manualNote: setting?.note ?? null,
      sentNotInReport,
      onOrder: ordered.get(s.id) ?? 0,
      monthPct,
      forecast,
    };
  });
  rows.sort((a, b) => compareUrgency(a.forecast, b.forecast) || a.amazonSku.localeCompare(b.amazonSku));

  const stockAsOf = [...fba.values()].map((v) => v.asOf).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    rows,
    sales: sales ? { start: sales.start, end: sales.end, days: salesDays } : null,
    stockAsOf,
    today,
    history,
  };
}
