import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..");
export const TEMPLATE_PATH = path.join(ROOT, "public/SKU-setup-template.xlsx");
export const SAMPLE_CSV_PATH = path.join(ROOT, "tests/fixtures/sample-skus.csv");

export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function readFixture(p: string): Promise<ArrayBuffer> {
  return toArrayBuffer(await readFile(p));
}

/** Fills the real template's SKUs sheet with rows and returns the .xlsx bytes. */
export async function fillTemplate(rows: ExcelJS.CellValue[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFixture(TEMPLATE_PATH));
  const ws = wb.worksheets[0];
  rows.forEach((values, i) => {
    const row = ws.getRow(i + 2);
    values.forEach((v, c) => {
      row.getCell(c + 1).value = v;
    });
    row.commit();
  });
  const out = await wb.xlsx.writeBuffer();
  return toArrayBuffer(Buffer.from(out));
}

export const HEADERS = [
  "Listing",
  "Amazon SKU",
  "In-house SKU",
  "Units per case",
  "Tie (cases per layer)",
  "High (layers)",
  "Max cases per pallet",
  "Warehouse on hand (units)",
  "Product description",
  "Warehouse location",
  "ASIN",
  "Count date",
  "Notes",
];
