import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { saveAmazonReport } from "@/lib/amazon/repo";
import {
  cancelChinaOrder,
  closeChinaOrder,
  createChinaOrder,
  getChinaOrder,
  listClosedChinaOrders,
  listOpenChinaOrders,
  onOrderBySku,
  receiveChinaOrder,
  updateChinaOrderDetails,
} from "@/lib/china/repo";
import { loadForecastBoard } from "@/lib/forecast/repo";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { importSkus, listSkus } from "@/lib/skus/repo";
import { recentCounts } from "@/lib/warehouse/counts";
import { readFixture, ROOT, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const fixture = (name: string) => readFile(path.join(ROOT, "tests/fixtures", name), "utf8");
const upload = { source: "upload" as const, fileName: "report.txt", userId: null };
const details = (over: Partial<{ orderedOn: string; expectedOn: string }> = {}) => ({
  supplier: "Ningbo Textiles",
  poNumber: "PO-1001",
  orderedOn: "2026-11-28",
  expectedOn: "2027-01-27",
  note: null,
  ...over,
});
const opts = { userId: null, today: "2027-01-27" };

describe.skipIf(!TEST_DATABASE_URL)("China orders (database)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let blk: number; // 12 per case, 197 units on hand
  let nat: number; // 36 per case, 334 units on hand

  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await clearData(db);
    const check = checkSkuSheet(await readSpreadsheet("s.csv", await readFixture(SAMPLE_CSV_PATH)));
    await importSkus(db, check.rows, { userId: null, today: "2026-11-27" });
    const ids = new Map((await listSkus(db)).map((s) => [s.amazonSku, s.id]));
    blk = ids.get("EX-TOTE-BLK")!;
    nat = ids.get("EX-TOTE-NAT")!;
  });

  it("saves an order and counts its units as on order", async () => {
    const r = await createChinaOrder(db, [{ skuId: blk, cases: 50 }, { skuId: nat, cases: 10 }], details(), { userId: null });
    expect(r.ok).toBe(true);
    const o = (await getChinaOrder(db, r.ok ? r.id : 0))!;
    expect(o).toMatchObject({ status: "ordered", supplier: "Ningbo Textiles", totalCases: 60, totalUnits: 960, casesToCome: 60 });
    const on = await onOrderBySku(db);
    expect(on.get(blk)).toBe(600);
    expect(on.get(nat)).toBe(360);
    expect((await listOpenChinaOrders(db)).map((x) => x.id)).toEqual([o.id]);
  });

  it("refuses an empty order, a SKU twice, or an unknown SKU", async () => {
    expect(await createChinaOrder(db, [], details(), { userId: null })).toMatchObject({ ok: false });
    expect(await createChinaOrder(db, [{ skuId: blk, cases: 1 }, { skuId: blk, cases: 2 }], details(), { userId: null })).toMatchObject({ ok: false });
    expect(await createChinaOrder(db, [{ skuId: 999999, cases: 1 }], details(), { userId: null })).toMatchObject({ ok: false });
  });

  it("moves the reorder-by date later and includes on-order units in total cover", async () => {
    await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf: new Date("2026-11-01T10:00:00Z") });
    await saveAmazonReport(db, await fixture("ledger-detail-sample.tsv"), upload);
    const before = (await loadForecastBoard(db, "2026-11-02")).rows.find((r) => r.id === blk)!;
    expect(before.onOrder).toBe(0);
    await createChinaOrder(db, [{ skuId: blk, cases: 50 }], details({ orderedOn: "2026-11-01", expectedOn: "2026-12-31" }), { userId: null });
    const after = (await loadForecastBoard(db, "2026-11-02")).rows.find((r) => r.id === blk)!;
    expect(after.onOrder).toBe(600);
    expect(after.forecast.totalUnits).toBe(before.forecast.totalUnits! + 600);
    expect(after.forecast.reorderBy! > before.forecast.reorderBy!).toBe(true);
  });

  it("a partial delivery saves the shelf count and keeps the rest on order", async () => {
    const r = await createChinaOrder(db, [{ skuId: blk, cases: 50 }, { skuId: nat, cases: 10 }], details(), { userId: null });
    const id = r.ok ? r.id : 0;

    // Both numbers are needed for every SKU.
    const missing = await receiveChinaOrder(db, id, [{ skuId: blk, cases: 40 }], [{ skuId: blk, cases: 56, looseUnits: 5 }], opts);
    expect(missing).toMatchObject({ ok: false });
    // All zeros is refused.
    const zeros = await receiveChinaOrder(
      db,
      id,
      [{ skuId: blk, cases: 0 }, { skuId: nat, cases: 0 }],
      [{ skuId: blk, cases: 16, looseUnits: 5 }, { skuId: nat, cases: 9, looseUnits: 10 }],
      opts,
    );
    expect(zeros).toMatchObject({ ok: false });

    // 40 of 50 BLK came, all 10 NAT. Shelf: 197 + 480 = 677 = 56 cases + 5. NAT: 334 + 360 = 694 = 19 cases + 10.
    const part = await receiveChinaOrder(
      db,
      id,
      [{ skuId: blk, cases: 40 }, { skuId: nat, cases: 10 }],
      [{ skuId: blk, cases: 56, looseUnits: 5 }, { skuId: nat, cases: 19, looseUnits: 10 }],
      opts,
    );
    expect(part).toEqual({ ok: true, complete: false });
    const o = (await getChinaOrder(db, id))!;
    expect(o.status).toBe("ordered");
    expect(o.lines.map((l) => [l.inhouseSku, l.casesReceived, l.casesToCome, l.warehouseOnHand])).toEqual([
      ["X001", 40, 10, 677],
      ["X002", 10, 0, 694],
    ]);
    const on = await onOrderBySku(db);
    expect(on.get(blk)).toBe(120);
    expect(on.has(nat)).toBe(false);
    const [latest] = await recentCounts(db, 1);
    expect(latest).toMatchObject({ source: "china_order", chinaOrderId: id, countedOn: "2027-01-27" });

    // The last 10 cases arrive later: the order closes itself.
    const rest = await receiveChinaOrder(
      db,
      id,
      [{ skuId: blk, cases: 10 }, { skuId: nat, cases: 0 }],
      [{ skuId: blk, cases: 66, looseUnits: 5 }, { skuId: nat, cases: 19, looseUnits: 10 }],
      { ...opts, today: "2027-02-03" },
    );
    expect(rest).toEqual({ ok: true, complete: true });
    const done = (await getChinaOrder(db, id))!;
    expect(done.status).toBe("received");
    expect(done.receipts.length).toBe(4);
    expect((await onOrderBySku(db)).size).toBe(0);
    expect(await receiveChinaOrder(db, id, [{ skuId: blk, cases: 1 }, { skuId: nat, cases: 0 }], [{ skuId: blk, cases: 1, looseUnits: 0 }, { skuId: nat, cases: 1, looseUnits: 0 }], opts)).toMatchObject({ ok: false });
    expect((await listClosedChinaOrders(db)).map((x) => x.id)).toEqual([id]);
  });

  it("extra cases from the supplier close the line without going negative", async () => {
    const r = await createChinaOrder(db, [{ skuId: blk, cases: 5 }], details(), { userId: null });
    const id = r.ok ? r.id : 0;
    const res = await receiveChinaOrder(db, id, [{ skuId: blk, cases: 7 }], [{ skuId: blk, cases: 23, looseUnits: 5 }], opts);
    expect(res).toEqual({ ok: true, complete: true });
    expect((await getChinaOrder(db, id))!.lines[0].casesToCome).toBe(0);
  });

  it("closing a part-received order stops counting the rest; cancelling needs nothing received", async () => {
    const a = await createChinaOrder(db, [{ skuId: blk, cases: 50 }], details(), { userId: null });
    const aId = a.ok ? a.id : 0;
    await receiveChinaOrder(db, aId, [{ skuId: blk, cases: 30 }], [{ skuId: blk, cases: 46, looseUnits: 5 }], opts);
    expect((await cancelChinaOrder(db, aId, null)).ok).toBe(false);
    expect(await closeChinaOrder(db, aId, null)).toBe(true);
    expect((await getChinaOrder(db, aId))!.status).toBe("received");
    expect((await onOrderBySku(db)).size).toBe(0);

    const b = await createChinaOrder(db, [{ skuId: nat, cases: 5 }], details(), { userId: null });
    const bId = b.ok ? b.id : 0;
    expect((await cancelChinaOrder(db, bId, null)).ok).toBe(true);
    expect((await getChinaOrder(db, bId))!.status).toBe("cancelled");
    expect((await cancelChinaOrder(db, bId, null)).ok).toBe(false);
    expect(await receiveChinaOrder(db, bId, [{ skuId: nat, cases: 5 }], [{ skuId: nat, cases: 14, looseUnits: 10 }], opts)).toMatchObject({ ok: false });
  });

  it("keeps units per case from when the order was saved, and lets the admin move the arrival date", async () => {
    const r = await createChinaOrder(db, [{ skuId: blk, cases: 10 }], details(), { userId: null });
    const id = r.ok ? r.id : 0;
    await db.execute(`update skus set units_per_case = 99 where id = ${blk}`);
    expect((await onOrderBySku(db)).get(blk)).toBe(120);
    await updateChinaOrderDetails(db, id, { ...details(), expectedOn: "2027-02-15", poNumber: "PO-2" });
    expect(await getChinaOrder(db, id)).toMatchObject({ expectedOn: "2027-02-15", poNumber: "PO-2" });
  });
});
