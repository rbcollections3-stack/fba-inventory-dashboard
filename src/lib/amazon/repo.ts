import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { amazonImports, fbaInventorySnapshots, fbaLedgerDaily, skus } from "@/db/schema";
import {
  parseAmazonReport,
  type AmazonReport,
  type InventoryReport,
  type LedgerReport,
} from "./parse";

export type ReportSource = "upload" | "sp_api";

export type SaveMeta = {
  source: ReportSource;
  fileName: string | null;
  userId: number | null;
  /** When the inventory numbers were true. Uploads use the upload time. */
  asOf?: Date;
};

export type SaveResult = {
  importId: number;
  kind: AmazonReport["kind"];
  rowsRead: number;
  rowsUsed: number;
  rowsSkipped: number;
  skusMatched: number;
  /** Tracked SKUs that had no rows in the report. */
  skusMissing: string[];
  /** SKUs in the report that are not tracked (amzn.gr.* resale SKUs are counted, not listed). */
  untrackedSkus: string[];
  badRows: { line: number; reason: string }[];
  periodStart: string | null;
  periodEnd: string | null;
  asOf: Date | null;
};

/**
 * Matches report SKUs to the SKU list. Amazon's MSKU is matched exactly
 * first, then ignoring upper/lower case. Anything else (other products,
 * Amazon's amzn.gr.* resale SKUs) is skipped, never an error.
 */
async function skuMatcher(db: Db) {
  const all = await db.select({ id: skus.id, amazonSku: skus.amazonSku }).from(skus);
  const exact = new Map(all.map((s) => [s.amazonSku, s.id]));
  const loose = new Map(all.map((s) => [s.amazonSku.toLowerCase(), s.id]));
  return {
    all,
    match: (msku: string): number | undefined => exact.get(msku) ?? loose.get(msku.toLowerCase()),
  };
}

function untrackedList(mskus: Iterable<string>): string[] {
  return [...new Set(mskus)].filter((m) => !m.toLowerCase().startsWith("amzn.gr.")).sort();
}

export async function saveLedgerReport(db: Db, report: LedgerReport, meta: SaveMeta): Promise<SaveResult> {
  const { all, match } = await skuMatcher(db);
  const used = report.rows.flatMap((r) => {
    const skuId = match(r.msku);
    return skuId === undefined ? [] : [{ ...r, skuId }];
  });
  const skipped = report.rows.filter((r) => match(r.msku) === undefined);
  const matchedIds = new Set(used.map((r) => r.skuId));

  return db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(amazonImports)
      .values({
        kind: "ledger_detail",
        source: meta.source,
        fileName: meta.fileName,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        rowsRead: report.rowsRead,
        rowsUsed: used.length,
        skusMatched: matchedIds.size,
        rowsSkipped: skipped.length,
        createdBy: meta.userId,
      })
      .returning({ id: amazonImports.id });

    // A newer report replaces what was saved before for the same SKUs and days,
    // so uploading overlapping date ranges never counts a sale twice.
    if (used.length > 0 && report.periodStart && report.periodEnd) {
      await tx
        .delete(fbaLedgerDaily)
        .where(
          and(
            inArray(fbaLedgerDaily.skuId, [...matchedIds]),
            gte(fbaLedgerDaily.day, report.periodStart),
            lte(fbaLedgerDaily.day, report.periodEnd),
          ),
        );
      for (let i = 0; i < used.length; i += 1000) {
        await tx.insert(fbaLedgerDaily).values(
          used.slice(i, i + 1000).map((r) => ({
            skuId: r.skuId,
            day: r.day,
            eventType: r.eventType,
            disposition: r.disposition,
            quantity: r.quantity,
            importId: imp.id,
          })),
        );
      }
    }
    return {
      importId: imp.id,
      kind: "ledger_detail" as const,
      rowsRead: report.rowsRead,
      rowsUsed: used.length,
      rowsSkipped: skipped.length,
      skusMatched: matchedIds.size,
      skusMissing: all.filter((s) => !matchedIds.has(s.id)).map((s) => s.amazonSku).sort(),
      untrackedSkus: untrackedList(skipped.map((r) => r.msku)),
      badRows: report.badRows,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      asOf: null,
    };
  });
}

export async function saveInventoryReport(db: Db, report: InventoryReport, meta: SaveMeta): Promise<SaveResult> {
  const { all, match } = await skuMatcher(db);
  const asOf = meta.asOf ?? new Date();
  const used = report.rows.flatMap((r) => {
    const skuId = match(r.msku);
    return skuId === undefined ? [] : [{ ...r, skuId }];
  });
  const skipped = report.rows.filter((r) => match(r.msku) === undefined);
  const matchedIds = new Set(used.map((r) => r.skuId));

  return db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(amazonImports)
      .values({
        kind: "fba_inventory",
        source: meta.source,
        fileName: meta.fileName,
        asOf,
        rowsRead: report.rowsRead,
        rowsUsed: used.length,
        skusMatched: matchedIds.size,
        rowsSkipped: skipped.length,
        createdBy: meta.userId,
      })
      .returning({ id: amazonImports.id });

    // A tracked SKU missing from the report has no FBA stock and nothing
    // inbound, so it gets a row of zeros rather than keeping an old number.
    const rows = all.map((s) => {
      const r = used.find((u) => u.skuId === s.id);
      return {
        skuId: s.id,
        importId: imp.id,
        asOf,
        fulfillable: r?.fulfillable ?? 0,
        reserved: r?.reserved ?? 0,
        unsellable: r?.unsellable ?? 0,
        inboundWorking: r?.inboundWorking ?? 0,
        inboundShipped: r?.inboundShipped ?? 0,
        inboundReceiving: r?.inboundReceiving ?? 0,
        researching: r?.researching ?? 0,
      };
    });
    if (rows.length > 0) await tx.insert(fbaInventorySnapshots).values(rows);
    return {
      importId: imp.id,
      kind: "fba_inventory" as const,
      rowsRead: report.rowsRead,
      rowsUsed: used.length,
      rowsSkipped: skipped.length,
      skusMatched: matchedIds.size,
      skusMissing: all.filter((s) => !matchedIds.has(s.id)).map((s) => s.amazonSku).sort(),
      untrackedSkus: untrackedList(skipped.map((r) => r.msku)),
      badRows: report.badRows,
      periodStart: null,
      periodEnd: null,
      asOf,
    };
  });
}

/**
 * Reads and saves one Seller Central report. This is the single entry point
 * for both hand uploads and (Phase 3) the daily Selling Partner API pull.
 * Throws ReportFormatError when the file is not a report the app reads.
 */
export async function saveAmazonReport(db: Db, text: string, meta: SaveMeta): Promise<SaveResult> {
  const report = parseAmazonReport(text);
  return report.kind === "ledger_detail"
    ? saveLedgerReport(db, report, meta)
    : saveInventoryReport(db, report, meta);
}

export type FbaFigures = {
  skuId: number;
  fulfillable: number;
  reserved: number;
  unsellable: number;
  inboundWorking: number;
  inboundShipped: number;
  inboundReceiving: number;
  /** Working + shipped + receiving, the same "Inbound" Seller Central shows. */
  inbound: number;
  asOf: Date;
};

/** The latest FBA stock per SKU. */
export async function latestFbaStock(db: Db): Promise<Map<number, FbaFigures>> {
  const rows = await db
    .selectDistinctOn([fbaInventorySnapshots.skuId])
    .from(fbaInventorySnapshots)
    .orderBy(fbaInventorySnapshots.skuId, desc(fbaInventorySnapshots.asOf), desc(fbaInventorySnapshots.id));
  return new Map(
    rows.map((r) => [
      r.skuId,
      {
        skuId: r.skuId,
        fulfillable: r.fulfillable,
        reserved: r.reserved,
        unsellable: r.unsellable,
        inboundWorking: r.inboundWorking,
        inboundShipped: r.inboundShipped,
        inboundReceiving: r.inboundReceiving,
        inbound: r.inboundWorking + r.inboundShipped + r.inboundReceiving,
        asOf: r.asOf,
      },
    ]),
  );
}

export type SalesWindow = { start: string; end: string; bySku: Map<number, number> } | null;

/**
 * Units shipped to customers per SKU over the last `days` days of ledger data
 * (ending on the latest day any ledger report covers, not today, because
 * reports are uploaded a few days late).
 */
export async function recentSales(db: Db, days = 30): Promise<SalesWindow> {
  const [last] = await db
    .select({ end: sql<string | null>`max(${fbaLedgerDaily.day})::text` })
    .from(fbaLedgerDaily);
  const [lastPeriod] = await db
    .select({ end: sql<string | null>`max(${amazonImports.periodEnd})::text` })
    .from(amazonImports)
    .where(eq(amazonImports.kind, "ledger_detail"));
  const end = [last?.end, lastPeriod?.end].filter((d): d is string => !!d).sort().at(-1);
  if (!end) return null;
  const startDate = new Date(end + "T00:00:00Z");
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const start = startDate.toISOString().slice(0, 10);
  const rows = await db
    .select({ skuId: fbaLedgerDaily.skuId, units: sql<string>`sum(-${fbaLedgerDaily.quantity})` })
    .from(fbaLedgerDaily)
    .where(and(eq(fbaLedgerDaily.eventType, "Shipments"), gte(fbaLedgerDaily.day, start), lte(fbaLedgerDaily.day, end)))
    .groupBy(fbaLedgerDaily.skuId);
  return { start, end, bySku: new Map(rows.map((r) => [r.skuId, Number(r.units)])) };
}

export async function listAmazonImports(db: Db, limit = 20) {
  return db.select().from(amazonImports).orderBy(desc(amazonImports.createdAt), desc(amazonImports.id)).limit(limit);
}
