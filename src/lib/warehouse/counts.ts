import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { skus, users, warehouseCounts } from "@/db/schema";

export type CountEntry = {
  skuId: number;
  /** Full cases counted. */
  cases: number;
  /** Loose units outside full cases. */
  looseUnits: number;
};

export type CountIssue = { skuId: number; message: string };

const MAX_UNITS = 10_000_000;

/** Reads the count form: fields cases-<id> and loose-<id>. Blank rows are not counted. */
export function readCountForm(form: FormData, skuIds: number[]): { entries: CountEntry[]; issues: CountIssue[] } {
  const entries: CountEntry[] = [];
  const issues: CountIssue[] = [];
  for (const id of skuIds) {
    const casesText = String(form.get(`cases-${id}`) ?? "").trim().replace(/,/g, "");
    const looseText = String(form.get(`loose-${id}`) ?? "").trim().replace(/,/g, "");
    if (casesText === "" && looseText === "") continue;
    const ok = (t: string) => t === "" || /^\d+$/.test(t);
    if (!ok(casesText) || !ok(looseText)) {
      issues.push({ skuId: id, message: "Enter whole numbers, 0 or more." });
      continue;
    }
    entries.push({ skuId: id, cases: Number(casesText || 0), looseUnits: Number(looseText || 0) });
  }
  return { entries, issues };
}

/**
 * Saves warehouse counts. A second count for the same SKU on the same day
 * replaces the first, so a mistake is corrected by counting again.
 */
export async function saveCounts(
  db: Db,
  entries: CountEntry[],
  opts: { userId: number | null; countedOn: string },
): Promise<{ saved: number; issues: CountIssue[] }> {
  if (entries.length === 0) return { saved: 0, issues: [] };
  const found = await db
    .select({ id: skus.id, unitsPerCase: skus.unitsPerCase })
    .from(skus)
    .where(inArray(skus.id, entries.map((e) => e.skuId)));
  const perCase = new Map(found.map((s) => [s.id, s.unitsPerCase]));
  const issues: CountIssue[] = [];
  const toSave: { skuId: number; units: number }[] = [];
  for (const e of entries) {
    const upc = perCase.get(e.skuId);
    if (upc === undefined) issues.push({ skuId: e.skuId, message: "This SKU no longer exists." });
    else if (e.cases * upc + e.looseUnits > MAX_UNITS) issues.push({ skuId: e.skuId, message: "That count is too large. Check the numbers." });
    else toSave.push({ skuId: e.skuId, units: e.cases * upc + e.looseUnits });
  }
  // Nothing is saved unless every filled-in row is valid.
  if (issues.length > 0) return { saved: 0, issues };

  await db.transaction(async (tx) => {
    for (const c of toSave) {
      const sameDay = await tx
        .select({ id: warehouseCounts.id })
        .from(warehouseCounts)
        .where(
          and(
            eq(warehouseCounts.skuId, c.skuId),
            eq(warehouseCounts.countedOn, opts.countedOn),
            eq(warehouseCounts.source, "manual"),
          ),
        )
        .orderBy(desc(warehouseCounts.createdAt), desc(warehouseCounts.id))
        .limit(1);
      if (sameDay.length > 0) {
        await tx
          .update(warehouseCounts)
          .set({ units: c.units, createdBy: opts.userId, createdAt: new Date() })
          .where(eq(warehouseCounts.id, sameDay[0].id));
      } else {
        await tx.insert(warehouseCounts).values({
          skuId: c.skuId,
          units: c.units,
          countedOn: opts.countedOn,
          source: "manual",
          createdBy: opts.userId,
        });
      }
    }
  });
  return { saved: toSave.length, issues: [] };
}

export type CountHistoryRow = {
  id: number;
  skuId: number;
  units: number;
  countedOn: string;
  source: "import" | "manual";
  by: string | null;
  at: Date;
};

/** Recent counts, newest first. */
export async function recentCounts(db: Db, limit = 40): Promise<CountHistoryRow[]> {
  return db
    .select({
      id: warehouseCounts.id,
      skuId: warehouseCounts.skuId,
      units: warehouseCounts.units,
      countedOn: warehouseCounts.countedOn,
      source: warehouseCounts.source,
      by: users.username,
      at: warehouseCounts.createdAt,
    })
    .from(warehouseCounts)
    .leftJoin(users, eq(users.id, warehouseCounts.createdBy))
    .orderBy(desc(warehouseCounts.createdAt), desc(warehouseCounts.id))
    .limit(limit);
}
