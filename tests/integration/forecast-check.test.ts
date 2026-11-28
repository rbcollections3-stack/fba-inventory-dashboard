import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { forecastDailyLog, listings, seasonMonths, seasonSettings } from "@/db/schema";
import { saveAmazonReport } from "@/lib/amazon/repo";
import type { ReportsClient, ReportStatus, ReportType } from "@/lib/amazon/sp-api";
import { latestHistoryRequest, requestLedgerHistory, syncAmazon } from "@/lib/amazon/sync";
import { loadAccuracy, recordDailyForecast } from "@/lib/forecast/check";
import { loadForecastHistory } from "@/lib/forecast/history";
import { loadForecastBoard } from "@/lib/forecast/repo";
import { eachDay } from "@/lib/forecast/stock-days";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { importSkus, listSkus } from "@/lib/skus/repo";
import { readFixture, ROOT, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const fixture = (name: string) => readFile(path.join(ROOT, "tests/fixtures", name), "utf8");
const upload = { source: "upload" as const, fileName: "report.txt", userId: null };

const HEAD =
  '"Date"\t"FNSKU"\t"ASIN"\t"MSKU"\t"Title"\t"Event Type"\t"Reference ID"\t"Quantity"\t"Fulfillment Center"\t"Disposition"\t"Reason"\t"Country"\t"Reconciled Quantity"\t"Unreconciled Quantity"\t"Date and Time"\t"Store"';

function ledgerRow(day: string, msku: string, event: string, qty: number) {
  const [y, m, d] = day.split("-");
  return `"${m}/${d}/${y}"\t"X000EXAMPL"\t"B000EXAMPL"\t"${msku}"\t"Example"\t"${event}"\t""\t"${qty}"\t"ABC1"\t"SELLABLE"\t""\t"US"\t""\t""\t"${day}T00:00:00-0700"\t""`;
}

/** EX-TOTE-BLK sells 4 a day Oct 1-20, then is out of stock to the end of October. */
function ledger(): string {
  const rows = eachDay("2026-10-01", "2026-10-20").map((d) => ledgerRow(d, "EX-TOTE-BLK", "Shipments", -4));
  return [HEAD, ...rows].join("\n");
}

/** Manage FBA Inventory with EX-TOTE-BLK at zero. */
async function inventory(): Promise<string> {
  const text = await fixture("fba-inventory-sample.txt");
  return text
    .split("\n")
    .map((l) => (l.startsWith("EX-TOTE-BLK\t") ? l.replace("260\t240\t2\t18\t380\t0.5\t24\t96", "0\t0\t0\t0\t0\t0.5\t0\t96") : l))
    .join("\n");
}

class FakeAmazon implements ReportsClient {
  created: { type: ReportType; range?: { start: Date; end: Date } }[] = [];
  constructor(private text: string) {}
  async createReport(type: ReportType, range?: { start: Date; end: Date }) {
    this.created.push({ type, range });
    return `R${this.created.length}`;
  }
  async getReport(): Promise<ReportStatus> {
    return { processingStatus: "DONE", reportDocumentId: "D1", processingEndTime: "2026-11-01T16:58:00Z" };
  }
  async downloadReport() {
    return this.text;
  }
}

describe.skipIf(!TEST_DATABASE_URL)("forecast check (database)", () => {
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

  async function loadData() {
    await saveAmazonReport(db, ledger(), upload);
    await saveAmazonReport(db, await inventory(), { ...upload, asOf: new Date("2026-11-01T10:00:00Z") });
  }

  it("leaves out out-of-stock days from the sales rate", async () => {
    await loadData();
    const history = await loadForecastHistory(db);
    expect(history.range).toEqual({ first: "2026-10-01", last: "2026-10-20", days: 20 });
    const board = await loadForecastBoard(db, "2026-11-01");
    const blk = board.rows.find((r) => r.amazonSku === "EX-TOTE-BLK")!;
    // Window Oct 1-20 (history starts Oct 1, ledger ends Oct 20): 80 units, all 20 days in stock.
    expect(blk.forecast.measuredRate).toBe(4);
    expect(blk.forecast.outOfStockDays).toBe(0);
  });

  it("counts the days after the last sale as out of stock when Amazon has none", async () => {
    // A later, empty report for Oct 21-31 says nothing moved on those days.
    await loadData();
    await saveAmazonReport(db, [HEAD, ledgerRow("2026-10-31", "EX-TOTE-NAT", "Shipments", -1)].join("\n"), upload);
    const board = await loadForecastBoard(db, "2026-11-01");
    const blk = board.rows.find((r) => r.amazonSku === "EX-TOTE-BLK")!;
    // Oct 2-31 window: 76 units in 19 days in stock (Oct 21-31 out of stock) = 4 a day, not 76 / 30.
    expect(blk.forecast.outOfStockDays).toBe(11);
    expect(blk.forecast.measuredRate).toBe(4);
    expect(blk.forecast.notes.some((n) => n.startsWith("Out of stock 11 of the last 30 days"))).toBe(true);
  });

  it("applies a typed seasonal pattern, and can be switched off", async () => {
    await loadData();
    const blkId = ids.get("EX-TOTE-BLK")!;
    const [listing] = await db.select().from(listings);
    await db.insert(seasonMonths).values({ listingId: listing.id, month: 12, percent: 200 });
    let board = await loadForecastBoard(db, "2026-11-01");
    let blk = board.rows.find((r) => r.id === blkId)!;
    expect(blk.monthPct![11]).toBe(200);
    expect(blk.forecast.seasonal).toEqual({ baseRate: 4, windowPct: 100, nowPct: 100 });
    const season = board.history.seasons.get(listing.id)!;
    expect(season.auto.ready).toBe(false);

    await db.insert(seasonSettings).values({ listingId: listing.id, enabled: false });
    board = await loadForecastBoard(db, "2026-11-01");
    blk = board.rows.find((r) => r.id === blkId)!;
    expect(blk.forecast.seasonal).toBeNull();
  });

  it("records the forecast once a day and checks it against sales", async () => {
    await loadData();
    const board = await loadForecastBoard(db, "2026-11-01");
    expect(await recordDailyForecast(db, board)).toBe(board.rows.length);
    expect(await recordDailyForecast(db, board)).toBe(0);
    const logged = await db.select().from(forecastDailyLog);
    const blk = logged.find((l) => l.skuId === ids.get("EX-TOTE-BLK"))!;
    expect(blk).toMatchObject({ day: "2026-11-01", plannedRate: 4, rateSource: "sales" });

    const report = await loadAccuracy(db, board);
    const acc = report.skus.find((s) => s.sku.amazonSku === "EX-TOTE-BLK")!;
    // Full weeks with two weeks of history before them: only Oct 19-25 is not full (ends Oct 20). None yet.
    expect(acc.weeks).toEqual([]);
    expect(report.total.verdict).toBe("none");
  });

  it("asks Amazon for 18 months of history and saves it through the normal check", async () => {
    const now = new Date("2026-11-01T17:00:00Z");
    const amazon = new FakeAmazon(ledger());
    expect(await requestLedgerHistory(db, amazon, { now })).toEqual({ status: "requested" });
    expect(amazon.created[0].range!.start.toISOString()).toBe("2025-05-10T07:00:00.000Z");
    // A second request while the first is waiting is refused.
    expect(await requestLedgerHistory(db, amazon, { now })).toEqual({ status: "busy" });
    const out = await syncAmazon(db, amazon, {
      trigger: "manual",
      request: false,
      now: () => now,
      deadline: now.getTime() + 60_000,
      sleep: async () => {},
    });
    expect(out.find((o) => o.kind === "ledger_detail")?.status).toBe("saved");
    expect((await latestHistoryRequest(db))?.status).toBe("saved");
    const history = await loadForecastHistory(db);
    expect(history.range!.first).toBe("2025-05-10");
  });
});
