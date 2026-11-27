import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { CellValue, SheetTable } from "./parse";

export class UnreadableFileError extends Error {}

const MAX_ROWS = 1000;

/** Turns an ExcelJS cell value (which can be rich text, a formula, a link...) into a plain value. */
function plainExcelValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((p) => p.text).join("");
    }
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      if (result === undefined || result === null) return null;
      if (typeof result === "object" && "error" in result) return null;
      return result as CellValue;
    }
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("error" in v) return null;
  }
  return String(v);
}

async function readXlsx(data: ArrayBuffer): Promise<SheetTable> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new UnreadableFileError(
      "This file could not be opened as an Excel workbook. Save it as .xlsx or .csv and try again.",
    );
  }
  // The SKU sheet is the first sheet in the template.
  const ws = wb.worksheets[0];
  if (!ws) throw new UnreadableFileError("This workbook has no sheets.");

  const width = Math.max(ws.columnCount, 1);
  const readRow = (r: ExcelJS.Row): CellValue[] => {
    const out: CellValue[] = [];
    for (let c = 1; c <= width; c++) out.push(plainExcelValue(r.getCell(c).value));
    return out;
  };

  const headers = readRow(ws.getRow(1));
  const rows: SheetTable["rows"] = [];
  const last = Math.min(ws.rowCount, MAX_ROWS + 1);
  for (let i = 2; i <= last; i++) {
    rows.push({ rowNumber: i, cells: readRow(ws.getRow(i)) });
  }
  return { headers, rows };
}

function readCsv(text: string): SheetTable {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false });
  const data = parsed.data;
  if (data.length === 0) throw new UnreadableFileError("This file is empty.");
  return {
    headers: data[0],
    rows: data.slice(1, MAX_ROWS + 1).map((cells, i) => ({ rowNumber: i + 2, cells })),
  };
}

/** Reads an uploaded .xlsx or .csv file into rows. */
export async function readSpreadsheet(fileName: string, data: ArrayBuffer): Promise<SheetTable> {
  const name = fileName.toLowerCase();
  if (name.endsWith(".xlsx")) return readXlsx(data);
  if (name.endsWith(".csv")) return readCsv(new TextDecoder("utf-8").decode(data));
  if (name.endsWith(".xls") || name.endsWith(".numbers") || name.endsWith(".ods")) {
    throw new UnreadableFileError(
      "This file type is not supported. In Excel or Google Sheets, save or download it as .xlsx and try again.",
    );
  }
  throw new UnreadableFileError("Please upload the SKU template as an .xlsx or .csv file.");
}
