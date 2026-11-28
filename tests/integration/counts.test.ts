import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { importSkus, listSkus } from "@/lib/skus/repo";
import { readCountForm, recentCounts, saveCounts } from "@/lib/warehouse/counts";
import { readFixture, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

describe("count form", () => {
  it("reads cases and loose units, ignoring rows left empty", () => {
    const f = new FormData();
    f.set("cases-1", "10");
    f.set("loose-1", "");
    f.set("cases-2", "");
    f.set("loose-2", "1,005");
    f.set("cases-3", "");
    f.set("cases-4", "2.5");
    const r = readCountForm(f, [1, 2, 3, 4]);
    expect(r.entries).toEqual([
      { skuId: 1, cases: 10, looseUnits: 0 },
      { skuId: 2, cases: 0, looseUnits: 1005 },
    ]);
    expect(r.issues).toEqual([{ skuId: 4, message: "Enter whole numbers, 0 or more." }]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("warehouse counts (database)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let blk: { id: number; unitsPerCase: number };

  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await clearData(db);
    const check = checkSkuSheet(await readSpreadsheet("s.csv", await readFixture(SAMPLE_CSV_PATH)));
    await importSkus(db, check.rows, { userId: null, today: "2026-11-27" });
    blk = (await listSkus(db)).find((s) => s.amazonSku === "EX-TOTE-BLK")!;
  });

  it("turns cases plus loose units into units and makes it the current count", async () => {
    const r = await saveCounts(db, [{ skuId: blk.id, cases: 10, looseUnits: 5 }], { userId: null, countedOn: "2026-11-28" });
    expect(r).toEqual({ saved: 1, issues: [] });
    const now = (await listSkus(db)).find((s) => s.id === blk.id)!;
    expect(now.warehouseOnHand).toBe(10 * blk.unitsPerCase + 5);
    expect(now.countedOn).toBe("2026-11-28");
  });

  it("corrects a count by replacing the same day's count", async () => {
    const opts = { userId: null, countedOn: "2026-11-28" };
    await saveCounts(db, [{ skuId: blk.id, cases: 10, looseUnits: 0 }], opts);
    await saveCounts(db, [{ skuId: blk.id, cases: 9, looseUnits: 0 }], opts);
    expect((await listSkus(db)).find((s) => s.id === blk.id)!.warehouseOnHand).toBe(9 * blk.unitsPerCase);
    const mine = (await recentCounts(db)).filter((c) => c.skuId === blk.id && c.source === "manual");
    expect(mine).toHaveLength(1);
  });

  it("keeps a new row for a count on a later day", async () => {
    await saveCounts(db, [{ skuId: blk.id, cases: 10, looseUnits: 0 }], { userId: null, countedOn: "2026-11-28" });
    await saveCounts(db, [{ skuId: blk.id, cases: 8, looseUnits: 0 }], { userId: null, countedOn: "2026-11-29" });
    const mine = (await recentCounts(db)).filter((c) => c.skuId === blk.id && c.source === "manual");
    expect(mine.map((c) => c.units)).toEqual([8 * blk.unitsPerCase, 10 * blk.unitsPerCase]);
  });

  it("saves nothing if any row is invalid", async () => {
    const r = await saveCounts(
      db,
      [
        { skuId: blk.id, cases: 1, looseUnits: 0 },
        { skuId: 999999, cases: 1, looseUnits: 0 },
      ],
      { userId: null, countedOn: "2026-11-28" },
    );
    expect(r.saved).toBe(0);
    expect(r.issues).toHaveLength(1);
    expect((await listSkus(db)).find((s) => s.id === blk.id)!.countedOn).toBe("2026-11-27");
  });
});
