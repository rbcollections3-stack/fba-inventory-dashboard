import { count } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { listings, skus, warehouseCounts } from "@/db/schema";
import { checkSkuSheet, type SkuImportRow } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { groupByListing, importSkus, listSkus, planImport, saveSku, skuFormSchema } from "@/lib/skus/repo";
import { readFixture, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

async function sampleRows(): Promise<SkuImportRow[]> {
  const check = checkSkuSheet(await readSpreadsheet("sample.csv", await readFixture(SAMPLE_CSV_PATH)));
  expect(check.errors).toEqual([]);
  return check.rows;
}

const n = async (db: Db, table: typeof skus | typeof listings | typeof warehouseCounts) =>
  (await db.select({ n: count() }).from(table))[0].n;

describe.skipIf(!TEST_DATABASE_URL)("SKU import and editing (database)", () => {
  let db: Db;
  let close: () => Promise<void>;
  const opts = { userId: null, today: "2026-11-27" };

  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => clearData(db));

  it("imports all 21 SKUs into 5 listings, with their warehouse counts", async () => {
    const rows = await sampleRows();
    expect(await importSkus(db, rows, opts)).toEqual({ ok: true, created: 21, updated: 0 });
    expect(await n(db, skus)).toBe(21);
    expect(await n(db, listings)).toBe(5);
    expect(await n(db, warehouseCounts)).toBe(21);

    const list = await listSkus(db);
    expect(list).toHaveLength(21);
    expect(groupByListing(list).map((g) => [g.listing, g.skus.length])).toEqual([
      ["Bamboo Drawer Organizers", 4],
      ["Canvas Tote Bags", 5],
      ["Kitchen Storage Jars", 4],
      ["Silicone Baking Mats", 4],
      ["Travel Packing Cubes", 4],
    ]);
    const first = list.find((s) => s.amazonSku === rows[0].amazonSku)!;
    expect(first).toMatchObject({
      inhouseSku: rows[0].inhouseSku,
      unitsPerCase: rows[0].unitsPerCase,
      tie: rows[0].tie,
      high: rows[0].high,
      maxCasesPerPallet: rows[0].maxCasesPerPallet,
      warehouseOnHand: rows[0].warehouseOnHand,
      countedOn: "2026-11-27",
    });
  });

  it("updates existing SKUs on re-import instead of adding copies, and keeps the newest count", async () => {
    const rows = await sampleRows();
    await importSkus(db, rows, opts);
    const changed = rows.map((r, i) =>
      i === 0 ? { ...r, unitsPerCase: 99, warehouseOnHand: 5, countDate: null, amazonSku: r.amazonSku.toLowerCase() } : r,
    );
    const plan = await planImport(db, changed);
    expect(plan).toMatchObject({ newCount: 0, updateCount: 21, errors: [] });

    expect(await importSkus(db, changed, { ...opts, today: "2026-12-01" })).toEqual({ ok: true, created: 0, updated: 21 });
    expect(await n(db, skus)).toBe(21);
    expect(await n(db, warehouseCounts)).toBe(42);
    const updated = (await listSkus(db)).find((s) => s.inhouseSku === rows[0].inhouseSku)!;
    expect(updated).toMatchObject({ unitsPerCase: 99, warehouseOnHand: 5, countedOn: "2026-12-01" });
  });

  it("refuses an in-house SKU that already belongs to another Amazon SKU, and saves nothing", async () => {
    const rows = await sampleRows();
    await importSkus(db, rows.slice(0, 2), opts);
    const clash = [{ ...rows[2], inhouseSku: rows[0].inhouseSku }, rows[3]];
    const result = await importSkus(db, clash, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        {
          row: rows[2].rowNumber,
          message: `In-house SKU "${rows[0].inhouseSku}" is already used by Amazon SKU "${rows[0].amazonSku}". Each in-house SKU can belong to only one Amazon SKU.`,
        },
      ]);
    }
    expect(await n(db, skus)).toBe(2);
  });

  it("rolls back the whole import if a save fails part way", async () => {
    const rows = await sampleRows();
    await importSkus(db, [rows[0], rows[1]], opts);
    // Swap two in-house SKUs: passes the per-row checks but breaks uniqueness mid-save.
    const swapped = [
      rows[2],
      { ...rows[0], inhouseSku: rows[1].inhouseSku },
      { ...rows[1], inhouseSku: rows[0].inhouseSku },
    ];
    const result = await importSkus(db, swapped, opts);
    expect(result.ok).toBe(false);
    expect(await n(db, skus)).toBe(2);
    expect(await n(db, warehouseCounts)).toBe(2);
  });

  it("adds and edits a single SKU from the form", async () => {
    const form = skuFormSchema.parse({
      listing: "Tote Bags",
      amazonSku: "RB-1",
      inhouseSku: "T-1",
      unitsPerCase: "24",
      tie: "6",
      high: "4",
      maxCasesPerPallet: "24",
      description: "",
      warehouseLocation: " Aisle 1 ",
      asin: "b0abc12345",
      notes: "",
    });
    expect(form).toMatchObject({ unitsPerCase: 24, description: null, warehouseLocation: "Aisle 1", asin: "B0ABC12345" });

    const created = await saveSku(db, null, form);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await saveSku(db, null, { ...form, inhouseSku: "T-2" })).toEqual({ ok: false, error: 'Amazon SKU "RB-1" already exists.' });
    const second = await saveSku(db, null, { ...form, amazonSku: "RB-2", inhouseSku: "T-2", listing: "Jars" });
    expect(second.ok).toBe(true);
    expect(await saveSku(db, created.id, { ...form, inhouseSku: "t-2" })).toEqual({
      ok: false,
      error: 'In-house SKU "t-2" is already used by Amazon SKU "RB-2".',
    });

    expect(await saveSku(db, created.id, { ...form, tie: 8, listing: "Jars" })).toEqual({ ok: true, id: created.id });
    const list = await listSkus(db);
    expect(list.find((s) => s.id === created.id)).toMatchObject({ tie: 8, listingName: "Jars", warehouseOnHand: null });
    expect(await saveSku(db, 9999, form)).toEqual({ ok: false, error: 'Amazon SKU "RB-1" already exists.' });
  });

  it("rejects bad form values with plain messages", () => {
    const res = skuFormSchema.safeParse({
      listing: "",
      amazonSku: "A",
      inhouseSku: "B",
      unitsPerCase: "abc",
      tie: "0",
      high: "2.5",
      maxCasesPerPallet: "10",
      description: "",
      warehouseLocation: "",
      asin: "123",
      notes: "",
    });
    expect(res.success).toBe(false);
    const msgs = Object.fromEntries((res.error?.issues ?? []).map((i) => [i.path[0], i.message]));
    expect(msgs).toEqual({
      listing: "Listing is required.",
      unitsPerCase: "Units per case must be a whole number.",
      tie: "Tie must be at least 1.",
      high: "High must be a whole number.",
      asin: "ASIN must be 10 letters and numbers.",
    });
  });
});
