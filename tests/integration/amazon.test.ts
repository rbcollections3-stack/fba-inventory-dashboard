import { readFile } from "node:fs/promises";
import path from "node:path";
import { count } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { amazonImports, fbaLedgerDaily } from "@/db/schema";
import { ReportFormatError } from "@/lib/amazon/parse";
import { latestFbaStock, listAmazonImports, recentSales, saveAmazonReport } from "@/lib/amazon/repo";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { importSkus, listSkus } from "@/lib/skus/repo";
import { readFixture, ROOT, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const fixture = (name: string) => readFile(path.join(ROOT, "tests/fixtures", name), "utf8");
const upload = { source: "upload" as const, fileName: "report.txt", userId: null };

describe.skipIf(!TEST_DATABASE_URL)("Amazon reports (database)", () => {
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

  it("saves FBA stock and inbound, skipping SKUs that are not tracked", async () => {
    const asOf = new Date("2026-11-27T15:00:00Z");
    const res = await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf });
    expect(res.kind).toBe("fba_inventory");
    expect(res.skusMatched).toBe(2);
    expect(res.rowsSkipped).toBe(2);
    expect(res.untrackedSkus).toEqual(["OTHER-PRODUCT"]);
    expect(res.skusMissing).toHaveLength(19);

    const stock = await latestFbaStock(db);
    const blk = stock.get(ids.get("EX-TOTE-BLK")!)!;
    expect(blk).toMatchObject({ fulfillable: 240, reserved: 18, inboundWorking: 24, inboundShipped: 96, inbound: 120 });
    expect(blk.asOf.toISOString()).toBe(asOf.toISOString());
    // A tracked SKU that is not in the report has nothing at Amazon.
    expect(stock.get(ids.get("EX-TOTE-RED")!)).toMatchObject({ fulfillable: 0, inbound: 0 });
    expect(stock.size).toBe(21);
  });

  it("shows the newest FBA stock after a second upload", async () => {
    await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf: new Date("2026-11-20T00:00:00Z") });
    const newer = (await fixture("fba-inventory-sample.txt")).replace(/^EX-TOTE-BLK(\t[^\t]*){9}\t240/m, (m) => m.replace(/240$/, "199"));
    await saveAmazonReport(db, newer, { ...upload, asOf: new Date("2026-11-27T00:00:00Z") });
    expect((await latestFbaStock(db)).get(ids.get("EX-TOTE-BLK")!)!.fulfillable).toBe(199);
  });

  it("saves ledger sales and gives 30 day totals ending on the last ledger day", async () => {
    const res = await saveAmazonReport(db, await fixture("ledger-detail-sample.tsv"), upload);
    expect(res).toMatchObject({ kind: "ledger_detail", skusMatched: 2, periodStart: "2026-10-01", periodEnd: "2026-10-31", rowsSkipped: 2 });
    const sales = await recentSales(db, 30);
    expect(sales).not.toBeNull();
    expect(sales!.start).toBe("2026-10-02");
    expect(sales!.end).toBe("2026-10-31");
    // Oct 1 (5 units) falls outside the 30 days ending Oct 31.
    expect(sales!.bySku.get(ids.get("EX-TOTE-BLK")!)).toBe(4);
    expect(sales!.bySku.get(ids.get("EX-TOTE-NAT")!)).toBe(7);
    const all = await recentSales(db, 31);
    expect(all!.bySku.get(ids.get("EX-TOTE-BLK")!)).toBe(9);
  });

  it("never counts a sale twice when the same days are uploaded again", async () => {
    const text = await fixture("ledger-detail-sample.tsv");
    await saveAmazonReport(db, text, upload);
    const before = (await db.select({ n: count() }).from(fbaLedgerDaily))[0].n;
    await saveAmazonReport(db, text, upload);
    expect((await db.select({ n: count() }).from(fbaLedgerDaily))[0].n).toBe(before);
    expect((await recentSales(db, 31))!.bySku.get(ids.get("EX-TOTE-BLK")!)).toBe(9);
    expect((await db.select({ n: count() }).from(amazonImports))[0].n).toBe(2);
  });

  it("keeps earlier days when a later, overlapping report is uploaded", async () => {
    await saveAmazonReport(db, await fixture("ledger-detail-sample.tsv"), upload);
    const later = "Date\tMSKU\tEvent Type\tQuantity\tDisposition\n10/31/2026\tEX-TOTE-NAT\tShipments\t-2\tSELLABLE\n11/01/2026\tEX-TOTE-NAT\tShipments\t-3\tSELLABLE\n";
    await saveAmazonReport(db, later, upload);
    const s = (await recentSales(db, 60))!;
    expect(s.end).toBe("2026-11-01");
    // Oct 3 (6) is kept, Oct 31 is replaced by the newer 2, Nov 1 adds 3.
    expect(s.bySku.get(ids.get("EX-TOTE-NAT")!)).toBe(11);
  });

  it("rejects a report the app does not read, saving nothing", async () => {
    await expect(saveAmazonReport(db, "Date,Units Ordered\n10/01/2026,5\n", upload)).rejects.toThrow(ReportFormatError);
    expect(await listAmazonImports(db)).toEqual([]);
  });

  it("returns no sales window before any ledger is loaded", async () => {
    expect(await recentSales(db)).toBeNull();
    expect((await latestFbaStock(db)).size).toBe(0);
  });
});
