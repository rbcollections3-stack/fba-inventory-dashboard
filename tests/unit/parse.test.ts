import { describe, expect, it } from "vitest";
import { checkSkuSheet, readDate, recheckRows, type CellValue, type SheetTable } from "@/lib/skus/parse";
import { HEADERS } from "../helpers";

function table(rows: CellValue[][], headers: CellValue[] = HEADERS): SheetTable {
  return { headers, rows: rows.map((cells, i) => ({ rowNumber: i + 2, cells })) };
}

const good: CellValue[] = ["Tote Bags", "RB-TOTE-BLK", "TB-001", 24, 6, 4, 24, 900, "Tote, black", "Aisle 2", "b0abc12345", "2026-11-20", "Labels out"];

describe("checkSkuSheet", () => {
  it("reads a good row with every column", () => {
    const res = checkSkuSheet(table([good]));
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.rows).toEqual([
      {
        rowNumber: 2,
        listing: "Tote Bags",
        amazonSku: "RB-TOTE-BLK",
        inhouseSku: "TB-001",
        unitsPerCase: 24,
        tie: 6,
        high: 4,
        maxCasesPerPallet: 24,
        warehouseOnHand: 900,
        description: "Tote, black",
        warehouseLocation: "Aisle 2",
        asin: "B0ABC12345",
        countDate: "2026-11-20",
        notes: "Labels out",
      },
    ]);
  });

  it("leaves optional columns empty when they are blank or missing", () => {
    const res = checkSkuSheet(table([good.slice(0, 8)], HEADERS.slice(0, 8)));
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ description: null, warehouseLocation: null, asin: null, countDate: null, notes: null });
  });

  it("skips blank rows, including the template's empty bordered rows", () => {
    const res = checkSkuSheet(table([[], good, [null, "", "  "], [...good.slice(0, 1), "RB-2", "TB-2", ...good.slice(3)]]));
    expect(res.errors).toEqual([]);
    expect(res.rows.map((r) => r.rowNumber)).toEqual([3, 5]);
  });

  it("matches headers ignoring case and extra spaces", () => {
    const headers = HEADERS.map((h) => `  ${h.toUpperCase()}  `);
    expect(checkSkuSheet(table([good], headers)).errors).toEqual([]);
  });

  it("finds columns by header, not position", () => {
    const order = [...HEADERS.keys()].reverse();
    const res = checkSkuSheet(table([order.map((i) => good[i])], order.map((i) => HEADERS[i])));
    expect(res.errors).toEqual([]);
    expect(res.rows[0].amazonSku).toBe("RB-TOTE-BLK");
  });

  it("rejects a sheet with missing or renamed required headers", () => {
    const headers = [...HEADERS];
    headers[3] = "Units/case";
    const res = checkSkuSheet(table([good], headers));
    expect(res.rows).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row).toBeNull();
    expect(res.errors[0].message).toContain('"Units per case"');
  });

  it("explains an empty sheet", () => {
    const res = checkSkuSheet(table([[], []]));
    expect(res.errors[0].message).toMatch(/no SKU rows/);
  });

  it("reports every problem on a row, with the row number", () => {
    const bad: CellValue[] = ["", "A1", "", "24 pcs", 2.5, 0, "x", -3, null, null, "B0SHORT", "next week", null];
    const res = checkSkuSheet(table([good, bad]));
    expect(res.rows).toHaveLength(1);
    const msgs = res.errors.map((e) => `${e.row}: ${e.message}`);
    expect(msgs).toEqual([
      "3: Listing is empty.",
      "3: In-house SKU is empty.",
      '3: Units per case must be a whole number, but it says "24 pcs".',
      "3: Tie (cases per layer) must be a whole number, but it says 2.5.",
      "3: High (layers) must be at least 1, but it says 0.",
      '3: Max cases per pallet must be a whole number, but it says "x".',
      "3: Warehouse on hand (units) cannot be negative.",
      '3: ASIN must be 10 letters and numbers, such as B0ABC12345, but it says "B0SHORT".',
      '3: Count date must be a date such as 2026-11-27, but it says "next week".',
    ]);
  });

  it("requires the warehouse on hand count but accepts zero", () => {
    const zero = [...good];
    zero[7] = 0;
    expect(checkSkuSheet(table([zero])).rows[0].warehouseOnHand).toBe(0);
    const blank = [...good];
    blank[7] = null;
    expect(checkSkuSheet(table([blank])).errors[0].message).toBe("Warehouse on hand (units) is empty.");
  });

  it("accepts numbers typed as text, with thousands commas", () => {
    const row = [...good];
    row[3] = " 24 ";
    row[7] = "1,200";
    const res = checkSkuSheet(table([row]));
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ unitsPerCase: 24, warehouseOnHand: 1200 });
  });

  it("flags duplicate Amazon SKUs and in-house SKUs, ignoring case", () => {
    const dupAmazon = [...good];
    dupAmazon[1] = "rb-tote-blk";
    dupAmazon[2] = "TB-999";
    const dupInhouse = [...good];
    dupInhouse[1] = "RB-OTHER";
    dupInhouse[2] = "tb-001";
    const res = checkSkuSheet(table([good, dupAmazon, dupInhouse]));
    expect(res.errors.map((e) => [e.row, e.message])).toEqual([
      [3, 'Amazon SKU "rb-tote-blk" is also on row 2. Each SKU should appear once.'],
      [4, 'In-house SKU "tb-001" is also on row 2. Each SKU should appear once.'],
    ]);
  });

  it("warns, but allows, more max cases than tie x high", () => {
    const row = [...good];
    row[6] = 30;
    const res = checkSkuSheet(table([row]));
    expect(res.errors).toEqual([]);
    expect(res.warnings[0]).toEqual({
      row: 2,
      message: "Max cases per pallet (30) is more than tie x high (6 x 4 = 24). Check this is right.",
    });
  });

  it("trims and collapses spaces in text", () => {
    const row = [...good];
    row[0] = "  Tote   Bags ";
    row[1] = " RB-TOTE-BLK ";
    const res = checkSkuSheet(table([row]));
    expect(res.rows[0]).toMatchObject({ listing: "Tote Bags", amazonSku: "RB-TOTE-BLK" });
  });
});

describe("readDate", () => {
  it.each<[CellValue, string | null]>([
    [null, null],
    ["", null],
    ["2026-11-27", "2026-11-27"],
    ["2026-1-5", "2026-01-05"],
    ["11/27/2026", "2026-11-27"],
    [new Date(Date.UTC(2026, 10, 27)), "2026-11-27"],
    [46353, "2026-11-27"], // Excel serial number
  ])("reads %j as %j", (input, expected) => {
    expect(readDate(input)).toBe(expected);
  });

  it.each<CellValue>(["2026-02-30", "27/11/2026", "yesterday", 0])("rejects %j", (input) => {
    expect(readDate(input)).toBe("invalid");
  });
});

describe("recheckRows", () => {
  const row = checkSkuSheet(table([good])).rows[0];

  it("accepts rows produced by the checker", () => {
    expect(recheckRows([row]).errors).toEqual([]);
  });

  it("rejects rows changed in the browser to break the rules", () => {
    expect(recheckRows([{ ...row, unitsPerCase: 0 }]).errors).toHaveLength(1);
    expect(recheckRows([{ ...row, tie: "6" }]).errors).toHaveLength(1);
    expect(recheckRows("nope").errors).toHaveLength(1);
    expect(recheckRows([]).errors).toHaveLength(1);
  });

  it("still catches duplicates", () => {
    expect(recheckRows([row, { ...row, rowNumber: 3 }]).errors).toHaveLength(2);
  });
});
