import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { saveAmazonReport } from "@/lib/amazon/repo";
import { getForecastSettings, loadForecastBoard, setManualDailySales } from "@/lib/forecast/repo";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { importSkus, listSkus, recordCount } from "@/lib/skus/repo";
import { readFixture, ROOT, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const fixture = (name: string) => readFile(path.join(ROOT, "tests/fixtures", name), "utf8");
const upload = { source: "upload" as const, fileName: "report.txt", userId: null };

describe.skipIf(!TEST_DATABASE_URL)("forecast board (database)", () => {
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

  it("gives every SKU a 'no sales loaded' note before any report", async () => {
    const board = await loadForecastBoard(db, "2026-11-28");
    expect(board.rows).toHaveLength(21);
    expect(board.sales).toBeNull();
    expect(board.rows.every((r) => r.forecast.status === "none")).toBe(true);
    expect(board.rows[0].forecast.notes[0]).toBe("No Amazon sales loaded yet, so no dates.");
  });

  it("plans from loaded sales and FBA stock, dating from the stock day", async () => {
    // 10:00 UTC on Nov 1 is Nov 1 in Pacific time (Amazon US reports).
    await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf: new Date("2026-11-01T10:00:00Z") });
    await saveAmazonReport(db, await fixture("ledger-detail-sample.tsv"), upload);
    const board = await loadForecastBoard(db, "2026-11-01");
    expect(board.sales).toEqual({ start: "2026-10-02", end: "2026-10-31", days: 30 });

    const blk = board.rows.find((r) => r.amazonSku === "EX-TOTE-BLK")!;
    // 4 sold in 30 days; 240 available + 120 inbound; 197 in the warehouse; 12 per case.
    expect(blk.unitsSold).toBe(4);
    expect(blk.forecast.dailyRate).toBeCloseTo(4 / 30);
    expect(blk.forecast.fbaCoverDays).toBeCloseTo(2700);
    expect(blk.forecast.shipBy).toBe("2034-01-31"); // Nov 1, 2026 + 2,648 days
    expect(blk.forecast.shipCases).toBe(1);
    expect(blk.forecast.status).toBe("green");

    // Untouched SKUs come last.
    expect(board.rows.at(-1)!.forecast.status).toBe("none");
  });

  it("uses fewer days and marks low confidence when the ledger history is short", async () => {
    const short = (await fixture("ledger-detail-sample.tsv"))
      .split("\n")
      .filter((l, i) => i === 0 || /"10\/(2[2-9]|3[01])\/2026"/.test(l))
      .join("\n");
    const extra =
      '\n"10/22/2026"\t"X000EXAMPL"\t"B000EXAMPL"\t"EX-TOTE-BLK"\t"Example product"\t"Shipments"\t""\t"-20"\t"ABC1"\t"SELLABLE"\t""\t"US"\t""\t""\t"2026-10-22T00:00:00-0700"\t""';
    await saveAmazonReport(db, short + extra, upload);
    await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf: new Date("2026-11-01T10:00:00Z") });
    const board = await loadForecastBoard(db, "2026-11-01");
    expect(board.sales!.days).toBe(10);
    const blk = board.rows.find((r) => r.amazonSku === "EX-TOTE-BLK")!;
    expect(blk.forecast.dailyRate).toBe(2);
    expect(blk.forecast.lowConfidence).toBe(true);
  });

  it("uses the expected daily sales typed in, and a warehouse count changes the reorder date", async () => {
    await saveAmazonReport(db, await fixture("fba-inventory-sample.txt"), { ...upload, asOf: new Date("2026-11-01T10:00:00Z") });
    await saveAmazonReport(db, await fixture("ledger-detail-sample.tsv"), upload);
    const red = ids.get("EX-TOTE-RED")!;
    await setManualDailySales(db, red, 5, "back in stock", null);
    expect((await getForecastSettings(db)).get(red)).toMatchObject({ manualDailySales: 5, note: "back in stock" });

    let row = (await loadForecastBoard(db, "2026-11-01")).rows.find((r) => r.id === red)!;
    expect(row.forecast.rateSource).toBe("manual");
    // Nothing at FBA, so the shipment is already 52 days late and it sorts first.
    expect(row.forecast.shipBy).toBe("2026-09-10");
    expect(row.forecast.status).toBe("red");

    await recordCount(db, red, 1000, { userId: null, countedOn: "2026-11-01" });
    row = (await loadForecastBoard(db, "2026-11-01")).rows.find((r) => r.id === red)!;
    expect(row.forecast.totalCoverDays).toBe(200);
    expect(row.forecast.reorderBy).toBe("2027-01-14"); // Nov 1 + 74 days

    await setManualDailySales(db, red, null, null, null);
    row = (await loadForecastBoard(db, "2026-11-01")).rows.find((r) => r.id === red)!;
    expect(row.forecast.rateSource).toBe("none");
  });
});
