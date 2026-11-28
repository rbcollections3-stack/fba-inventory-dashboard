import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { amazonImports, amazonSyncRequests } from "@/db/schema";
import { latestFbaStock, recentSales } from "@/lib/amazon/repo";
import { SpApiError, type ReportsClient, type ReportStatus, type ReportType } from "@/lib/amazon/sp-api";
import { amazonSyncStatus, syncAmazon } from "@/lib/amazon/sync";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet } from "@/lib/skus/read-file";
import { importSkus, listSkus } from "@/lib/skus/repo";
import { readFixture, ROOT, SAMPLE_CSV_PATH } from "../helpers";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const fixture = (name: string) => readFile(path.join(ROOT, "tests/fixtures", name), "utf8");

/** Nov 1 2026, 10 AM Pacific: the ledger range is Oct 1 to Oct 31, matching the fixture. */
const NOW = new Date("2026-11-01T17:00:00Z");

/** A pretend Amazon: each report is "in progress" for `delayChecks` checks, then done. */
class FakeAmazon implements ReportsClient {
  created: { type: ReportType; range?: { start: Date; end: Date } }[] = [];
  checks = new Map<string, number>();
  docs: Record<string, string> = {};
  constructor(
    private files: Record<ReportType, string>,
    public delayChecks = 1,
    public finalStatus: ReportStatus["processingStatus"] = "DONE",
  ) {}
  async createReport(type: ReportType, range?: { start: Date; end: Date }) {
    this.created.push({ type, range });
    const id = `R${this.created.length}`;
    this.docs[id] = this.files[type];
    return id;
  }
  async getReport(id: string): Promise<ReportStatus> {
    const n = (this.checks.get(id) ?? 0) + 1;
    this.checks.set(id, n);
    if (n <= this.delayChecks) return { processingStatus: "IN_PROGRESS" };
    return { processingStatus: this.finalStatus, reportDocumentId: `D-${id}`, processingEndTime: "2026-11-01T16:58:00Z" };
  }
  async downloadReport(docId: string) {
    return this.docs[docId.replace(/^D-/, "")];
  }
}

describe.skipIf(!TEST_DATABASE_URL)("Automatic Amazon pull (database)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let ids: Map<string, number>;
  let files: Record<ReportType, string>;
  const noSleep = async () => {};
  const opts = { now: () => NOW, sleep: noSleep, deadline: NOW.getTime() + 600_000 };

  beforeAll(async () => {
    ({ db, close } = await freshDb());
    files = {
      GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA: await fixture("fba-inventory-sample.txt"),
      GET_LEDGER_DETAIL_VIEW_DATA: await fixture("ledger-detail-sample.tsv"),
    };
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await clearData(db);
    const check = checkSkuSheet(await readSpreadsheet("s.csv", await readFixture(SAMPLE_CSV_PATH)));
    await importSkus(db, check.rows, { userId: null, today: "2026-11-27" });
    ids = new Map((await listSkus(db)).map((s) => [s.amazonSku, s.id]));
  });

  it("requests both reports, waits for Amazon, and loads them like an upload", async () => {
    const amazon = new FakeAmazon(files, 2);
    const out = await syncAmazon(db, amazon, { ...opts, trigger: "schedule" });
    expect(out.map((o) => [o.kind, o.status])).toEqual([
      ["fba_inventory", "saved"],
      ["ledger_detail", "saved"],
    ]);
    const ledger = amazon.created.find((c) => c.type === "GET_LEDGER_DETAIL_VIEW_DATA")!;
    expect(ledger.range?.start.toISOString()).toBe("2026-10-01T07:00:00.000Z");

    const stock = await latestFbaStock(db);
    expect(stock.get(ids.get("EX-TOTE-BLK")!)?.fulfillable).toBe(240);
    expect(stock.get(ids.get("EX-TOTE-BLK")!)?.inbound).toBe(120);
    expect(stock.get(ids.get("EX-TOTE-BLK")!)?.asOf.toISOString()).toBe("2026-11-01T16:58:00.000Z");
    const sales = await recentSales(db);
    expect(sales?.bySku.get(ids.get("EX-TOTE-BLK")!)).toBeGreaterThan(0);

    const imports = await db.select().from(amazonImports);
    expect(imports.every((i) => i.source === "sp_api")).toBe(true);
    const status = await amazonSyncStatus(db);
    expect(status.every((s) => s.latest?.status === "saved" && s.lastSaved)).toBe(true);
  });

  it("does not ask again on the second scheduled run of the day, but Refresh does", async () => {
    const amazon = new FakeAmazon(files, 0);
    await syncAmazon(db, amazon, { ...opts, trigger: "schedule" });
    const again = await syncAmazon(db, amazon, { ...opts, trigger: "schedule" });
    expect(again.map((o) => o.status)).toEqual(["skipped", "skipped"]);
    expect(amazon.created).toHaveLength(2);
    await syncAmazon(db, amazon, { ...opts, trigger: "manual" });
    expect(amazon.created).toHaveLength(4);
  });

  it("re-pulling overlapping days replaces sales instead of adding them", async () => {
    const amazon = new FakeAmazon(files, 0);
    await syncAmazon(db, amazon, { ...opts, trigger: "manual" });
    const first = await recentSales(db);
    await syncAmazon(db, amazon, { ...opts, trigger: "manual" });
    const second = await recentSales(db);
    expect([...second!.bySku]).toEqual([...first!.bySku]);
  });

  it("leaves a report that is not ready for the next run to pick up", async () => {
    const amazon = new FakeAmazon(files, 5);
    const out = await syncAmazon(db, amazon, { ...opts, trigger: "schedule", deadline: NOW.getTime() });
    expect(out.map((o) => o.status)).toEqual(["waiting", "waiting"]);
    // The next run finds the waiting requests instead of asking Amazon again.
    const later = await syncAmazon(db, amazon, { ...opts, trigger: "schedule" });
    expect(later.map((o) => o.status)).toEqual(["saved", "saved"]);
    expect(amazon.created).toHaveLength(2);
  });

  it("records no data and failures without stopping", async () => {
    const empty = new FakeAmazon(files, 0, "CANCELLED");
    const out = await syncAmazon(db, empty, { ...opts, trigger: "manual" });
    expect(out.map((o) => o.status)).toEqual(["no_data", "no_data"]);

    const denied: ReportsClient = {
      createReport: async () => {
        throw new SpApiError("Amazon refused access (403). Check the Amazon Fulfillment role.", 403);
      },
      getReport: async () => ({ processingStatus: "DONE" }),
      downloadReport: async () => "",
    };
    const out2 = await syncAmazon(db, denied, { ...opts, trigger: "manual" });
    expect(out2.every((o) => o.status === "failed" && /Fulfillment role/.test(o.message))).toBe(true);
    const status = await amazonSyncStatus(db);
    expect(status[0].latest?.status).toBe("failed");
  });

  it("fails a report whose contents are not the report asked for", async () => {
    const mixed = new FakeAmazon(
      { ...files, GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA: files.GET_LEDGER_DETAIL_VIEW_DATA },
      0,
    );
    const out = await syncAmazon(db, mixed, { ...opts, trigger: "manual" });
    expect(out[0]).toMatchObject({ kind: "fba_inventory", status: "failed" });
    expect(out[1].status).toBe("saved");
  });

  it("gives up on a report Amazon never finished after a day", async () => {
    await db.insert(amazonSyncRequests).values({
      kind: "fba_inventory",
      reportType: "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA",
      amazonReportId: "OLD",
      trigger: "schedule",
      requestedAt: new Date(NOW.getTime() - 25 * 3600 * 1000),
    });
    const amazon = new FakeAmazon(files, 0);
    await syncAmazon(db, amazon, { ...opts, trigger: "schedule" });
    const [old] = await db.select().from(amazonSyncRequests).where(eq(amazonSyncRequests.amazonReportId, "OLD"));
    expect(old.status).toBe("failed");
    expect(amazon.created).toHaveLength(2);
  });
});
