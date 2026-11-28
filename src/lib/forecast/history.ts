import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  amazonImports,
  fbaInventorySnapshots,
  fbaLedgerDaily,
  forecastDailyLog,
  listings,
  seasonMonths,
  seasonSettings,
  skus,
} from "@/db/schema";
import { businessTimeZone } from "@/lib/dates";
import { daysBetween } from "./rules";
import { autoSeason, effectiveSeason, type AutoSeason, type MonthStat, type SeasonSetting } from "./seasonal";
import { eachDay, outOfStockDays, type DayFlow } from "./stock-days";

/**
 * Everything Phase 7 needs from the sales history: out-of-stock days per SKU,
 * the seasonal pattern per listing, and the daily sales used to check the
 * forecast. Loaded in one go for all SKUs (20 SKUs x 18 months is about 11,000
 * day rows, which is small).
 */

export type SkuHistory = {
  skuId: number;
  listingId: number;
  /** Units sold per day. */
  sold: Map<string, number>;
  outOfStock: Set<string>;
};

export type ListingSeason = {
  listingId: number;
  listingName: string;
  setting: SeasonSetting;
  auto: AutoSeason;
  /** Percentages used for planning (index 0 = January), or null when no pattern applies. */
  monthPct: number[] | null;
  /** Full months of usable history (any year). */
  months: MonthStat[];
};

export type ForecastHistory = {
  /** First and last day of ledger data, or null with none loaded. */
  range: { first: string; last: string; days: number } | null;
  bySku: Map<number, SkuHistory>;
  seasons: Map<number, ListingSeason>;
};

function dayOf(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: businessTimeZone() });
}

/** First and last day of ledger data: ledger rows and the periods reports covered. */
export async function ledgerRange(db: Db): Promise<ForecastHistory["range"]> {
  const [a] = await db
    .select({ first: sql<string | null>`min(${fbaLedgerDaily.day})::text`, last: sql<string | null>`max(${fbaLedgerDaily.day})::text` })
    .from(fbaLedgerDaily);
  const [b] = await db
    .select({
      first: sql<string | null>`min(${amazonImports.periodStart})::text`,
      last: sql<string | null>`max(${amazonImports.periodEnd})::text`,
    })
    .from(amazonImports)
    .where(eq(amazonImports.kind, "ledger_detail"));
  const first = [a?.first, b?.first].filter((d): d is string => !!d).sort()[0];
  const last = [a?.last, b?.last].filter((d): d is string => !!d).sort().at(-1);
  if (!first || !last) return null;
  return { first, last, days: daysBetween(first, last) + 1 };
}

export async function loadSeasonSettings(db: Db): Promise<Map<number, SeasonSetting>> {
  const [settings, months] = await Promise.all([db.select().from(seasonSettings), db.select().from(seasonMonths)]);
  const out = new Map<number, SeasonSetting>();
  const get = (id: number) => {
    let s = out.get(id);
    if (!s) {
      s = { enabled: true, typed: new Map() };
      out.set(id, s);
    }
    return s;
  };
  for (const s of settings) get(s.listingId).enabled = s.enabled;
  for (const m of months) get(m.listingId).typed.set(m.month, m.percent);
  return out;
}

export async function loadForecastHistory(db: Db): Promise<ForecastHistory> {
  const [range, skuRows, listingRows, flowRows, snapRows, seasonSet] = await Promise.all([
    ledgerRange(db),
    db.select({ id: skus.id, listingId: skus.listingId }).from(skus),
    db.select({ id: listings.id, name: listings.name }).from(listings),
    db
      .select({
        skuId: fbaLedgerDaily.skuId,
        day: sql<string>`${fbaLedgerDaily.day}::text`,
        sold: sql<string>`coalesce(sum(-${fbaLedgerDaily.quantity}) filter (where ${fbaLedgerDaily.eventType} = 'Shipments'), 0)`,
        net: sql<string>`coalesce(sum(${fbaLedgerDaily.quantity}) filter (where ${fbaLedgerDaily.disposition} = 'SELLABLE'), 0)`,
      })
      .from(fbaLedgerDaily)
      .groupBy(fbaLedgerDaily.skuId, fbaLedgerDaily.day),
    db
      .select({
        skuId: fbaInventorySnapshots.skuId,
        asOf: fbaInventorySnapshots.asOf,
        fulfillable: fbaInventorySnapshots.fulfillable,
        reserved: fbaInventorySnapshots.reserved,
      })
      .from(fbaInventorySnapshots)
      .orderBy(fbaInventorySnapshots.asOf, fbaInventorySnapshots.id),
    loadSeasonSettings(db),
  ]);

  const flows = new Map<number, Map<string, DayFlow>>();
  for (const r of flowRows) {
    let m = flows.get(r.skuId);
    if (!m) flows.set(r.skuId, (m = new Map()));
    m.set(r.day, { sold: Number(r.sold), sellableNet: Number(r.net) });
  }
  // Latest snapshot per SKU (the anchor), and days a snapshot showed nothing available.
  const anchors = new Map<number, { day: string; sellable: number }>();
  const zero = new Map<number, Set<string>>();
  for (const s of snapRows) {
    const day = dayOf(s.asOf);
    anchors.set(s.skuId, { day, sellable: s.fulfillable + s.reserved });
    if (s.fulfillable <= 0) {
      if (!zero.has(s.skuId)) zero.set(s.skuId, new Set());
      zero.get(s.skuId)!.add(day);
    }
  }

  const bySku = new Map<number, SkuHistory>();
  for (const s of skuRows) {
    const f = flows.get(s.id) ?? new Map<string, DayFlow>();
    const sold = new Map<string, number>();
    for (const [d, v] of f) if (v.sold !== 0) sold.set(d, v.sold);
    const outOfStock = range
      ? outOfStockDays({
          flows: f,
          firstDay: range.first,
          lastDay: range.last,
          anchor: anchors.get(s.id) ?? null,
          zeroStockDays: zero.get(s.id),
        })
      : new Set<string>();
    bySku.set(s.id, { skuId: s.id, listingId: s.listingId, sold, outOfStock });
  }

  // Monthly totals per listing for the automatic seasonal pattern.
  const seasons = new Map<number, ListingSeason>();
  const allDays = range ? eachDay(range.first, range.last) : [];
  for (const l of listingRows) {
    const members = [...bySku.values()].filter((h) => h.listingId === l.id);
    const months = new Map<string, MonthStat>();
    for (const d of allDays) {
      const key = d.slice(0, 7);
      let m = months.get(key);
      if (!m) months.set(key, (m = { month: key, units: 0, dataDays: 0, inStockSkuDays: 0, skuCount: members.length }));
      m.dataDays++;
      for (const h of members) {
        if (h.outOfStock.has(d)) continue;
        m.inStockSkuDays++;
        m.units += h.sold.get(d) ?? 0;
      }
    }
    const stats = [...months.values()];
    const setting = seasonSet.get(l.id) ?? { enabled: true, typed: new Map() };
    const auto = autoSeason(stats);
    seasons.set(l.id, {
      listingId: l.id,
      listingName: l.name,
      setting,
      auto,
      monthPct: effectiveSeason(setting, auto),
      months: stats,
    });
  }

  return { range, bySku, seasons };
}

/** What the app recorded each day per SKU, from `since` on. */
export async function loadForecastLog(db: Db, since: string) {
  const rows = await db
    .select({
      skuId: forecastDailyLog.skuId,
      day: sql<string>`${forecastDailyLog.day}::text`,
      plannedRate: forecastDailyLog.plannedRate,
      rateSource: forecastDailyLog.rateSource,
    })
    .from(forecastDailyLog)
    .where(and(gte(forecastDailyLog.day, since)));
  const out = new Map<number, Map<string, { plannedRate: number | null; rateSource: string }>>();
  for (const r of rows) {
    if (!out.has(r.skuId)) out.set(r.skuId, new Map());
    out.get(r.skuId)!.set(r.day, { plannedRate: r.plannedRate === null ? null : Number(r.plannedRate), rateSource: r.rateSource });
  }
  return out;
}
