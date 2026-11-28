import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectKind, parseAmazonReport, parseReportDate, ReportFormatError } from "@/lib/amazon/parse";
import { ROOT } from "../helpers";

const fixture = (name: string) => readFile(path.join(ROOT, "tests/fixtures", name), "utf8");

describe("Amazon report reader", () => {
  it("reads the Inventory Ledger detailed view and sums fulfillment centers per day", async () => {
    const r = parseAmazonReport(await fixture("ledger-detail-sample.tsv"));
    if (r.kind !== "ledger_detail") throw new Error("wrong kind");
    expect(r.rowsRead).toBe(11);
    expect(r.periodStart).toBe("2026-10-01");
    expect(r.periodEnd).toBe("2026-10-31");
    expect(r.badRows).toEqual([]);
    const find = (msku: string, day: string, ev: string) =>
      r.rows.filter((x) => x.msku === msku && x.day === day && x.eventType === ev);
    // Two fulfillment centers on Oct 1 become one row.
    expect(find("EX-TOTE-BLK", "2026-10-01", "Shipments")).toEqual([
      { msku: "EX-TOTE-BLK", day: "2026-10-01", eventType: "Shipments", disposition: "SELLABLE", quantity: -5 },
    ]);
    expect(find("EX-TOTE-BLK", "2026-10-02", "Receipts")[0].quantity).toBe(120);
    expect(find("EX-TOTE-BLK", "2026-10-02", "CustomerReturns")[0].disposition).toBe("CUSTOMER_DAMAGED");
    // Transfers between centers net to zero.
    expect(find("EX-TOTE-NAT", "2026-10-03", "WhseTransfers")[0].quantity).toBe(0);
  });

  it("reads the Manage FBA Inventory report", async () => {
    const r = parseAmazonReport(await fixture("fba-inventory-sample.txt"));
    if (r.kind !== "fba_inventory") throw new Error("wrong kind");
    expect(r.rows.find((x) => x.msku === "EX-TOTE-BLK")).toEqual({
      msku: "EX-TOTE-BLK",
      fulfillable: 240,
      reserved: 18,
      unsellable: 2,
      inboundWorking: 24,
      inboundShipped: 96,
      inboundReceiving: 0,
      researching: 0,
    });
    expect(r.rows).toHaveLength(4);
  });

  it("accepts a comma separated ledger and differently written headers", () => {
    const csv = "date,msku,event-type,quantity,disposition\n2026-11-02,EX-A,Shipments,\"-1,200\",sellable\n";
    const r = parseAmazonReport(csv);
    if (r.kind !== "ledger_detail") throw new Error("wrong kind");
    expect(r.rows).toEqual([{ msku: "EX-A", day: "2026-11-02", eventType: "Shipments", disposition: "SELLABLE", quantity: -1200 }]);
  });

  it("lists rows it cannot read instead of guessing", () => {
    const tsv = "Date\tMSKU\tEvent Type\tQuantity\n13/45/2026\tEX-A\tShipments\t-1\n10/01/2026\tEX-A\tShipments\tlots\n10/02/2026\tEX-A\tShipments\t-2\n";
    const r = parseAmazonReport(tsv);
    expect(r.badRows).toEqual([
      { line: 2, reason: "the date could not be read" },
      { line: 3, reason: "the quantity is not a whole number" },
    ]);
    expect(r.rows).toHaveLength(1);
  });

  it("explains which report to download when the file is something else", () => {
    expect(() => parseAmazonReport("Date,Units Ordered\n10/01/2026,5\n")).toThrow(ReportFormatError);
    expect(() => parseAmazonReport("Date,Units Ordered\n10/01/2026,5\n")).toThrow(/Inventory Ledger/);
    expect(() => parseAmazonReport("")).toThrow(/empty/);
  });

  it("names missing columns", () => {
    expect(() => parseAmazonReport("sku\tafn-fulfillable-quantity\nA\t1\n")).toThrow(/afn-reserved-quantity/);
  });

  it("detects the report from its headers", () => {
    expect(detectKind(["﻿\"Date\"", "MSKU", "Event Type"])).toBe("ledger_detail");
    expect(detectKind(["sku", "afn-fulfillable-quantity"])).toBe("fba_inventory");
    expect(detectKind(["Date", "Ordered Product Sales"])).toBeNull();
  });

  it("reads report dates strictly", () => {
    expect(parseReportDate("10/31/2026")).toBe("2026-10-31");
    expect(parseReportDate("2/3/2026")).toBe("2026-02-03");
    expect(parseReportDate("2026-10-31T00:00:00-0700")).toBe("2026-10-31");
    expect(parseReportDate("02/30/2026")).toBeNull();
    expect(parseReportDate("")).toBeNull();
  });
});
