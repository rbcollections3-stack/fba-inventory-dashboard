import { describe, expect, it } from "vitest";
import { checkSkuSheet } from "@/lib/skus/parse";
import { readSpreadsheet, UnreadableFileError } from "@/lib/skus/read-file";
import { fillTemplate, readFixture, SAMPLE_CSV_PATH, TEMPLATE_PATH } from "../helpers";

describe("readSpreadsheet", () => {
  it("reads the blank template's headers and treats its empty rows as no SKUs", async () => {
    const table = await readSpreadsheet("SKU-setup-template.xlsx", await readFixture(TEMPLATE_PATH));
    expect(table.headers.slice(0, 8)).toEqual([
      "Listing",
      "Amazon SKU",
      "In-house SKU",
      "Units per case",
      "Tie (cases per layer)",
      "High (layers)",
      "Max cases per pallet",
      "Warehouse on hand (units)",
    ]);
    const check = checkSkuSheet(table);
    expect(check.rows).toEqual([]);
    expect(check.errors[0].message).toMatch(/no SKU rows/);
  });

  it("imports a filled-in copy of the real template", async () => {
    const data = await fillTemplate([
      ["Tote Bags", "RB-TOTE-BLK", "TB-001", 24, 6, 4, 24, 900, "Tote, black", "Aisle 2", "B0ABC12345", new Date(Date.UTC(2026, 10, 27)), null],
      // Rich text, a formula and a hyperlink-style cell, as Excel can save them.
      [
        { richText: [{ text: "Tote " }, { text: "Bags" }] },
        "RB-TOTE-NAT",
        { text: "TB-002", hyperlink: "https://example.com" },
        12,
        8,
        5,
        { formula: "E3*F3", result: 40 },
        "1,200",
        null,
        null,
        null,
        "11/26/2026",
        "Fragile",
      ],
    ]);
    const check = checkSkuSheet(await readSpreadsheet("filled.xlsx", data));
    expect(check.errors).toEqual([]);
    expect(check.rows).toHaveLength(2);
    expect(check.rows[0]).toMatchObject({ rowNumber: 2, amazonSku: "RB-TOTE-BLK", countDate: "2026-11-27" });
    expect(check.rows[1]).toMatchObject({
      rowNumber: 3,
      listing: "Tote Bags",
      inhouseSku: "TB-002",
      maxCasesPerPallet: 40,
      warehouseOnHand: 1200,
      countDate: "2026-11-26",
      notes: "Fragile",
    });
  });

  it("reads the 21 example SKUs from CSV", async () => {
    const check = checkSkuSheet(await readSpreadsheet("sample-skus.csv", await readFixture(SAMPLE_CSV_PATH)));
    expect(check.errors).toEqual([]);
    expect(check.rows).toHaveLength(21);
    expect(new Set(check.rows.map((r) => r.listing)).size).toBe(5);
  });

  it("explains unsupported and broken files", async () => {
    const junk = new TextEncoder().encode("not a spreadsheet").buffer as ArrayBuffer;
    await expect(readSpreadsheet("old.xls", junk)).rejects.toThrow(UnreadableFileError);
    await expect(readSpreadsheet("notes.txt", junk)).rejects.toThrow(/\.xlsx or \.csv/);
    await expect(readSpreadsheet("broken.xlsx", junk)).rejects.toThrow(/could not be opened/);
  });
});
