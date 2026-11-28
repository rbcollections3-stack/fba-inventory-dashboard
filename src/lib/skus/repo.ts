import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { listings, skus, warehouseCounts } from "@/db/schema";
import type { RowIssue, SkuImportRow } from "./parse";

export type SkuWithStock = {
  id: number;
  listingId: number;
  listingName: string;
  amazonSku: string;
  inhouseSku: string;
  unitsPerCase: number;
  tie: number;
  high: number;
  maxCasesPerPallet: number;
  description: string | null;
  warehouseLocation: string | null;
  asin: string | null;
  fnsku: string | null;
  notes: string | null;
  warehouseOnHand: number | null;
  countedOn: string | null;
};

/** Every SKU with its listing and latest warehouse count, sorted by listing then Amazon SKU. */
export async function listSkus(db: Db): Promise<SkuWithStock[]> {
  const latest = db
    .selectDistinctOn([warehouseCounts.skuId], {
      skuId: warehouseCounts.skuId,
      units: warehouseCounts.units,
      countedOn: warehouseCounts.countedOn,
    })
    .from(warehouseCounts)
    .orderBy(warehouseCounts.skuId, sql`${warehouseCounts.createdAt} desc`, sql`${warehouseCounts.id} desc`)
    .as("latest");

  const rows = await db
    .select({
      id: skus.id,
      listingId: skus.listingId,
      listingName: listings.name,
      amazonSku: skus.amazonSku,
      inhouseSku: skus.inhouseSku,
      unitsPerCase: skus.unitsPerCase,
      tie: skus.tie,
      high: skus.high,
      maxCasesPerPallet: skus.maxCasesPerPallet,
      description: skus.description,
      warehouseLocation: skus.warehouseLocation,
      asin: skus.asin,
      fnsku: skus.fnsku,
      notes: skus.notes,
      warehouseOnHand: latest.units,
      countedOn: latest.countedOn,
    })
    .from(skus)
    .innerJoin(listings, eq(listings.id, skus.listingId))
    .leftJoin(latest, eq(latest.skuId, skus.id))
    .orderBy(asc(listings.name), asc(skus.amazonSku));
  return rows;
}

export function groupByListing<T extends { listingName: string }>(rows: T[]): { listing: string; skus: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const g = groups.get(r.listingName) ?? [];
    g.push(r);
    groups.set(r.listingName, g);
  }
  return [...groups.entries()].map(([listing, list]) => ({ listing, skus: list }));
}

export type ImportPlan = {
  newCount: number;
  updateCount: number;
  /** Amazon SKUs that already exist and will be updated. */
  existing: Set<string>;
  errors: RowIssue[];
};

/**
 * Compares the import with what is already saved. Rows match existing SKUs by
 * Amazon SKU. An in-house SKU that already belongs to a different Amazon SKU
 * is an error, because warehouse labels must point at one product.
 */
export async function planImport(db: Db, rows: SkuImportRow[]): Promise<ImportPlan> {
  const amazon = rows.map((r) => r.amazonSku);
  const inhouse = rows.map((r) => r.inhouseSku);
  const found = await db
    .select({ amazonSku: skus.amazonSku, inhouseSku: skus.inhouseSku })
    .from(skus)
    .where(sql`lower(${skus.amazonSku}) in ${amazon.map((a) => a.toLowerCase())} or lower(${skus.inhouseSku}) in ${inhouse.map((h) => h.toLowerCase())}`);

  const byAmazon = new Map(found.map((f) => [f.amazonSku.toLowerCase(), f]));
  const byInhouse = new Map(found.map((f) => [f.inhouseSku.toLowerCase(), f]));
  const existing = new Set<string>();
  const errors: RowIssue[] = [];
  for (const r of rows) {
    if (byAmazon.has(r.amazonSku.toLowerCase())) existing.add(r.amazonSku.toLowerCase());
    const owner = byInhouse.get(r.inhouseSku.toLowerCase());
    if (owner && owner.amazonSku.toLowerCase() !== r.amazonSku.toLowerCase()) {
      errors.push({
        row: r.rowNumber,
        message: `In-house SKU "${r.inhouseSku}" is already used by Amazon SKU "${owner.amazonSku}". Each in-house SKU can belong to only one Amazon SKU.`,
      });
    }
  }
  return {
    newCount: rows.length - existing.size,
    updateCount: existing.size,
    existing,
    errors,
  };
}

export type ImportResult =
  | { ok: true; created: number; updated: number }
  | { ok: false; errors: RowIssue[] };

/**
 * Saves the rows in one transaction: creates missing listings, adds new SKUs,
 * updates existing ones (matched by Amazon SKU) and records each row's
 * warehouse on-hand count. Either everything is saved or nothing is.
 */
export async function importSkus(
  db: Db,
  rows: SkuImportRow[],
  opts: { userId: number | null; today: string },
): Promise<ImportResult> {
  try {
    return await db.transaction(async (tx) => {
      const plan = await planImport(tx as unknown as Db, rows);
      if (plan.errors.length > 0) return { ok: false, errors: plan.errors };

      const listingNames = [...new Set(rows.map((r) => r.listing))];
      await tx.insert(listings).values(listingNames.map((name) => ({ name }))).onConflictDoNothing();
      const listingRows = await tx
        .select({ id: listings.id, name: listings.name })
        .from(listings)
        .where(inArray(listings.name, listingNames));
      const listingId = new Map(listingRows.map((l) => [l.name, l.id]));

      let created = 0;
      let updated = 0;
      for (const r of rows) {
        const values = {
          listingId: listingId.get(r.listing)!,
          amazonSku: r.amazonSku,
          inhouseSku: r.inhouseSku,
          unitsPerCase: r.unitsPerCase,
          tie: r.tie,
          high: r.high,
          maxCasesPerPallet: r.maxCasesPerPallet,
          description: r.description,
          warehouseLocation: r.warehouseLocation,
          asin: r.asin,
          notes: r.notes,
        };
        let skuId: number;
        const [match] = await tx
          .select({ id: skus.id })
          .from(skus)
          .where(sql`lower(${skus.amazonSku}) = ${r.amazonSku.toLowerCase()}`);
        if (match) {
          await tx.update(skus).set({ ...values, updatedAt: new Date() }).where(eq(skus.id, match.id));
          skuId = match.id;
          updated++;
        } else {
          const [ins] = await tx.insert(skus).values(values).returning({ id: skus.id });
          skuId = ins.id;
          created++;
        }
        if (r.warehouseOnHand !== null) {
          await tx.insert(warehouseCounts).values({
            skuId,
            units: r.warehouseOnHand,
            countedOn: r.countDate ?? opts.today,
            source: "import",
            createdBy: opts.userId,
          });
        }
      }
      return { ok: true as const, created, updated };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        errors: [
          {
            row: null,
            message:
              "Two SKUs ended up with the same Amazon SKU or in-house SKU. Nothing was saved. Check for swapped SKUs and try again.",
          },
        ],
      };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "23505") {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** The fields an admin can edit on the SKU form. */
export const skuFormSchema = z.object({
  listing: z.string().trim().min(1, "Listing is required.").max(200),
  amazonSku: z.string().trim().min(1, "Amazon SKU is required.").max(100),
  inhouseSku: z.string().trim().min(1, "In-house SKU is required.").max(100),
  unitsPerCase: z.coerce.number({ error: "Units per case must be a whole number." }).int("Units per case must be a whole number.").min(1, "Units per case must be at least 1."),
  tie: z.coerce.number({ error: "Tie must be a whole number." }).int("Tie must be a whole number.").min(1, "Tie must be at least 1."),
  high: z.coerce.number({ error: "High must be a whole number." }).int("High must be a whole number.").min(1, "High must be at least 1."),
  maxCasesPerPallet: z.coerce
    .number({ error: "Max cases per pallet must be a whole number." })
    .int("Max cases per pallet must be a whole number.")
    .min(1, "Max cases per pallet must be at least 1."),
  description: z.string().trim().max(500).transform((s) => s || null),
  warehouseLocation: z.string().trim().max(200).transform((s) => s || null),
  asin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => s === "" || /^[A-Z0-9]{10}$/.test(s), "ASIN must be 10 letters and numbers.")
    .transform((s) => s || null),
  fnsku: z
    .string()
    .default("")
    .transform((s) => s.trim())
    .transform((s) => s.toUpperCase())
    .refine((s) => s === "" || /^[A-Z0-9]{10}$/.test(s), "FNSKU must be 10 letters and numbers, such as X001ABC123.")
    .transform((s) => s || null),
  notes: z.string().trim().max(2000).transform((s) => s || null),
});

export type SkuFormValues = z.infer<typeof skuFormSchema>;

export type SaveSkuResult = { ok: true; id: number } | { ok: false; error: string };

/** Creates a SKU (id null) or updates one. */
export async function saveSku(db: Db, id: number | null, v: SkuFormValues): Promise<SaveSkuResult> {
  const clash = await db
    .select({ id: skus.id, amazonSku: skus.amazonSku, inhouseSku: skus.inhouseSku })
    .from(skus)
    .where(
      and(
        sql`(lower(${skus.amazonSku}) = ${v.amazonSku.toLowerCase()} or lower(${skus.inhouseSku}) = ${v.inhouseSku.toLowerCase()})`,
        id === null ? undefined : ne(skus.id, id),
      ),
    );
  if (clash.length > 0) {
    const c = clash[0];
    return {
      ok: false,
      error:
        c.amazonSku.toLowerCase() === v.amazonSku.toLowerCase()
          ? `Amazon SKU "${v.amazonSku}" already exists.`
          : `In-house SKU "${v.inhouseSku}" is already used by Amazon SKU "${c.amazonSku}".`,
    };
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(listings).values({ name: v.listing }).onConflictDoNothing();
      const [l] = await tx.select({ id: listings.id }).from(listings).where(eq(listings.name, v.listing));
      const values = {
        listingId: l.id,
        amazonSku: v.amazonSku,
        inhouseSku: v.inhouseSku,
        unitsPerCase: v.unitsPerCase,
        tie: v.tie,
        high: v.high,
        maxCasesPerPallet: v.maxCasesPerPallet,
        description: v.description,
        warehouseLocation: v.warehouseLocation,
        asin: v.asin,
        fnsku: v.fnsku,
        notes: v.notes,
      };
      if (id === null) {
        const [ins] = await tx.insert(skus).values(values).returning({ id: skus.id });
        return { ok: true as const, id: ins.id };
      }
      const upd = await tx
        .update(skus)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(skus.id, id))
        .returning({ id: skus.id });
      if (upd.length === 0) return { ok: false as const, error: "This SKU no longer exists." };
      return { ok: true as const, id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "That Amazon SKU or in-house SKU is already in use." };
    throw err;
  }
}

/** Records a warehouse count typed in by hand. */
export async function recordCount(
  db: Db,
  skuId: number,
  units: number,
  opts: { userId: number | null; countedOn: string },
): Promise<void> {
  await db.insert(warehouseCounts).values({
    skuId,
    units,
    countedOn: opts.countedOn,
    source: "manual",
    createdBy: opts.userId,
  });
}

export async function getSku(db: Db, id: number): Promise<SkuWithStock | null> {
  const all = await listSkus(db);
  return all.find((s) => s.id === id) ?? null;
}

export async function listListingNames(db: Db): Promise<string[]> {
  const rows = await db.select({ name: listings.name }).from(listings).orderBy(asc(listings.name));
  return rows.map((r) => r.name);
}
