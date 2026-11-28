import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { saveAmazonReport } from "@/lib/amazon/repo";
import { loadForecastBoard } from "@/lib/forecast/repo";
import {
  cancelShipment,
  createShipment,
  expectedLeft,
  getShipment,
  listShipments,
  markShipmentSent,
  readShipmentForm,
  sentNotYetReported,
  skusInOpenShipments,
} from "@/lib/shipments/repo";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { importSkus, listSkus } from "@/lib/skus/repo";
import { recentCounts } from "@/lib/warehouse/counts";
import { readFixture, ROOT, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const fixture = (name: string) => readFile(path.join(ROOT, "tests/fixtures", name), "utf8");
const upload = { source: "upload" as const, fileName: "report.txt", userId: null };

describe("readShipmentForm", () => {
  it("reads only ticked SKUs and flags bad case numbers", () => {
    const f = new FormData();
    f.set("include-1", "on");
    f.set("cases-1", "1,200");
    f.set("cases-2", "9"); // not ticked
    f.set("include-3", "on");
    f.set("cases-3", "0");
    f.set("include-4", "on");
    f.set("cases-4", "99999");
    const { lines, issues } = readShipmentForm(f, [1, 2, 3, 4]);
    expect(lines).toEqual([{ skuId: 1, cases: 1200 }]);
    expect(issues.map((i) => i.skuId)).toEqual([3, 4]);
  });
});

describe("expectedLeft", () => {
  it("subtracts the units shipped and never goes below zero", () => {
    expect(expectedLeft({ warehouseOnHand: 197, units: 120 })).toBe(77);
    expect(expectedLeft({ warehouseOnHand: 50, units: 120 })).toBe(0);
    expect(expectedLeft({ warehouseOnHand: null, units: 120 })).toBeNull();
  });
});

describe.skipIf(!TEST_DATABASE_URL)("shipments (database)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let ids: Map<string, number>;

  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await clearData(db);
    const check = checkSkuSheet(await readSpreadsheet("s.csv", await readFixture(SAMPLE_CSV_PATH)));
    await importSkus(db, check.rows, { userId: null, today: "2026-11-27" });
    ids = new Map((await listSkus(db)).map((s) => [s.amazonSku, s.id]));
  });

  it("creates a shipment with pallets worked out from each SKU's packing", async () => {
    const blk = ids.get("EX-TOTE-BLK")!; // 12 per case, tie 8, high 5, max 40
    const nat = ids.get("EX-TOTE-NAT")!; // 36 per case, tie 5, high 6, max 30
    const r = await createShipment(db, [
      { skuId: blk, cases: 45 },
      { skuId: nat, cases: 7 },
    ], { userId: null, note: " pickup Tuesday " });
    expect(r.ok).toBe(true);
    const s = (await getShipment(db, r.ok ? r.id : 0))!;
    expect(s.status).toBe("requested");
    expect(s.note).toBe("pickup Tuesday");
    expect(s.lines.map((l) => [l.inhouseSku, l.cases, l.units, l.pallets])).toEqual([
      ["X001", 45, 540, 2],
      ["X002", 7, 252, 1],
    ]);
    expect(s.totalPallets).toBe(3);
    expect(s.totalCases).toBe(52);
    expect((await skusInOpenShipments(db)).get(blk)).toBe(s.id);
  });

  it("keeps the packing figures from when the shipment was requested", async () => {
    const blk = ids.get("EX-TOTE-BLK")!;
    const r = await createShipment(db, [{ skuId: blk, cases: 10 }], { userId: null });
    await db.execute(`update skus set tie = 2, units_per_case = 99 where id = ${blk}`);
    const s = (await getShipment(db, r.ok ? r.id : 0))!;
    expect(s.lines[0]).toMatchObject({ tie: 8, unitsPerCase: 12, units: 120 });
  });

  it("refuses an empty shipment or an unknown SKU", async () => {
    expect(await createShipment(db, [], { userId: null })).toMatchObject({ ok: false });
    expect(await createShipment(db, [{ skuId: 999999, cases: 1 }], { userId: null })).toMatchObject({ ok: false });
  });

  it("marking sent saves the count left on the shelf, and only once", async () => {
    const blk = ids.get("EX-TOTE-BLK")!; // 197 units on hand from the spreadsheet
    const r = await createShipment(db, [{ skuId: blk, cases: 10 }], { userId: null });
    const id = r.ok ? r.id : 0;

    // A missing count is refused and nothing changes.
    const missing = await markShipmentSent(db, id, [], { userId: null, today: "2026-11-28" });
    expect(missing).toMatchObject({ ok: false });
    expect((await getShipment(db, id))!.status).toBe("requested");

    // 197 - 120 = 77 expected; staff count 6 cases + 4 loose = 76.
    const ok = await markShipmentSent(db, id, [{ skuId: blk, cases: 6, looseUnits: 4 }], { userId: null, today: "2026-11-28" });
    expect(ok).toEqual({ ok: true });
    const s = (await getShipment(db, id))!;
    expect(s.status).toBe("sent");
    expect(s.sentAt).not.toBeNull();
    expect(s.lines[0].warehouseOnHand).toBe(76);
    const [latest] = await recentCounts(db, 1);
    expect(latest).toMatchObject({ skuId: blk, units: 76, source: "shipment", shipmentId: id, countedOn: "2026-11-28" });

    const again = await markShipmentSent(db, id, [{ skuId: blk, cases: 0, looseUnits: 0 }], { userId: null, today: "2026-11-28" });
    expect(again).toMatchObject({ ok: false });
    expect((await getShipment(db, id))!.lines[0].warehouseOnHand).toBe(76);
    expect((await skusInOpenShipments(db)).size).toBe(0);
  });

  it("a cancelled shipment cannot be sent", async () => {
    const blk = ids.get("EX-TOTE-BLK")!;
    const r = await createShipment(db, [{ skuId: blk, cases: 1 }], { userId: null });
    const id = r.ok ? r.id : 0;
    expect(await cancelShipment(db, id, null)).toBe(true);
    expect(await cancelShipment(db, id, null)).toBe(false);
    expect(await markShipmentSent(db, id, [{ skuId: blk, cases: 1, looseUnits: 0 }], { userId: null, today: "2026-11-28" })).toMatchObject({
      ok: false,
    });
    expect((await listShipments(db, "requested")).length).toBe(0);
    expect((await listShipments(db, "cancelled")).length).toBe(1);
  });

  it("units sent count as on the way until Amazon's next stock report", async () => {
    const blk = ids.get("EX-TOTE-BLK")!;
    // Amazon stock as of Nov 1: 240 available + 120 inbound.
    await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf: new Date("2026-11-01T10:00:00Z") });
    await saveAmazonReport(db, await fixture("ledger-detail-sample.tsv"), upload);
    const before = (await loadForecastBoard(db, "2026-11-02")).rows.find((r) => r.id === blk)!;

    const r = await createShipment(db, [{ skuId: blk, cases: 10 }], { userId: null });
    const id = r.ok ? r.id : 0;
    // Requested but not sent: nothing on the way yet.
    expect((await sentNotYetReported(db)).size).toBe(0);

    await markShipmentSent(db, id, [{ skuId: blk, cases: 6, looseUnits: 5 }], {
      userId: null,
      today: "2026-11-02",
      now: new Date("2026-11-02T18:00:00Z"),
    });
    expect((await sentNotYetReported(db)).get(blk)).toBe(120);
    const after = (await loadForecastBoard(db, "2026-11-02")).rows.find((r) => r.id === blk)!;
    expect(after.sentNotInReport).toBe(120);
    expect(after.forecast.fbaUnits).toBe(before.forecast.fbaUnits! + 120);
    expect(after.warehouseOnHand).toBe(77);

    // Amazon's next report (taken after the shipment was sent) includes it, so stop adding it.
    await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf: new Date("2026-11-03T10:00:00Z") });
    expect((await sentNotYetReported(db)).size).toBe(0);
    const later = (await loadForecastBoard(db, "2026-11-03")).rows.find((r) => r.id === blk)!;
    expect(later.sentNotInReport).toBe(0);
  });
});
