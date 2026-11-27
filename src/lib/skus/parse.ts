import { z } from "zod";
import { normalizeHeader, SKU_COLUMNS, type SkuColumnKey } from "./columns";

/** A cell value after reading a spreadsheet: text, number, date or empty. */
export type CellValue = string | number | boolean | Date | null;

export type SheetTable = {
  headers: CellValue[];
  /** rowNumber is the spreadsheet row number, as the user sees it. */
  rows: { rowNumber: number; cells: CellValue[] }[];
};

export type RowIssue = {
  /** Spreadsheet row number, or null for a problem with the whole file. */
  row: number | null;
  message: string;
};

export const skuImportRowSchema = z.object({
  rowNumber: z.number().int(),
  listing: z.string().trim().min(1).max(200),
  amazonSku: z.string().trim().min(1).max(100),
  inhouseSku: z.string().trim().min(1).max(100),
  unitsPerCase: z.number().int().min(1),
  tie: z.number().int().min(1),
  high: z.number().int().min(1),
  maxCasesPerPallet: z.number().int().min(1),
  warehouseOnHand: z.number().int().min(0),
  description: z.string().max(500).nullable(),
  warehouseLocation: z.string().max(200).nullable(),
  asin: z
    .string()
    .regex(/^[A-Z0-9]{10}$/)
    .nullable(),
  countDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  notes: z.string().max(2000).nullable(),
});

export type SkuImportRow = z.infer<typeof skuImportRowSchema>;

export type ImportCheck = {
  rows: SkuImportRow[];
  errors: RowIssue[];
  warnings: RowIssue[];
};

const LABEL: Record<SkuColumnKey, string> = Object.fromEntries(
  SKU_COLUMNS.map((c) => [c.key, c.header]),
) as Record<SkuColumnKey, string>;

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function isBlank(v: CellValue): boolean {
  return cellText(v) === "";
}

/** Reads a whole number. Accepts 24, "24", "1,200". Rejects "24 pcs" and 2.5. */
function readWholeNumber(
  v: CellValue,
  key: SkuColumnKey,
  min: number,
  issues: string[],
): number | null {
  const label = LABEL[key];
  if (isBlank(v)) {
    issues.push(`${label} is empty.`);
    return null;
  }
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else {
    const text = cellText(v).replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(text)) {
      issues.push(`${label} must be a whole number, but it says "${cellText(v)}".`);
      return null;
    }
    n = Number(text);
  }
  if (!Number.isInteger(n)) {
    issues.push(`${label} must be a whole number, but it says ${n}.`);
    return null;
  }
  if (n < min) {
    issues.push(
      min === 0
        ? `${label} cannot be negative.`
        : `${label} must be at least ${min}, but it says ${n}.`,
    );
    return null;
  }
  return n;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Reads a date as YYYY-MM-DD. Accepts real spreadsheet dates, 2026-11-27 and 11/27/2026. */
export function readDate(v: CellValue): string | null | "invalid" {
  if (isBlank(v)) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "invalid";
    return validDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) ?? "invalid";
  }
  if (typeof v === "number") {
    // An Excel date serial number (days since 1899-12-30).
    if (v < 1 || v > 2958465) return "invalid";
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) ?? "invalid";
  }
  const text = cellText(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return validDate(+m[1], +m[2], +m[3]) ?? "invalid";
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) return validDate(+m[3], +m[1], +m[2]) ?? "invalid";
  return "invalid";
}

function optionalText(v: CellValue): string | null {
  const t = cellText(v).replace(/\s+/g, " ");
  return t === "" ? null : t;
}

/**
 * Checks a spreadsheet against the SKU template and turns each filled row
 * into a SKU. Any error means nothing should be imported.
 */
export function checkSkuSheet(table: SheetTable): ImportCheck {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  // 1. Match headers to columns.
  const positions = new Map<SkuColumnKey, number>();
  table.headers.forEach((h, i) => {
    const name = normalizeHeader(cellText(h));
    const col = SKU_COLUMNS.find((c) => normalizeHeader(c.header) === name);
    if (col && !positions.has(col.key)) positions.set(col.key, i);
  });
  const missing = SKU_COLUMNS.filter((c) => c.required && !positions.has(c.key));
  if (missing.length > 0) {
    errors.push({
      row: null,
      message:
        `The first row must have the template's column headers. Missing: ` +
        missing.map((c) => `"${c.header}"`).join(", ") +
        `. Download the template from this page and copy your rows into it.`,
    });
    return { rows: [], errors, warnings };
  }

  const get = (cells: CellValue[], key: SkuColumnKey): CellValue => {
    const i = positions.get(key);
    return i === undefined ? null : (cells[i] ?? null);
  };

  // 2. Read each row that has anything in it.
  const rows: SkuImportRow[] = [];
  for (const { rowNumber, cells } of table.rows) {
    const used = [...positions.values()].some((i) => !isBlank(cells[i] ?? null));
    if (!used) continue;

    const issues: string[] = [];
    const requiredText = (key: SkuColumnKey): string => {
      const t = cellText(get(cells, key)).replace(/\s+/g, " ");
      if (t === "") issues.push(`${LABEL[key]} is empty.`);
      return t;
    };

    const listing = requiredText("listing");
    const amazonSku = requiredText("amazonSku");
    const inhouseSku = requiredText("inhouseSku");
    const unitsPerCase = readWholeNumber(get(cells, "unitsPerCase"), "unitsPerCase", 1, issues);
    const tie = readWholeNumber(get(cells, "tie"), "tie", 1, issues);
    const high = readWholeNumber(get(cells, "high"), "high", 1, issues);
    const maxCasesPerPallet = readWholeNumber(
      get(cells, "maxCasesPerPallet"),
      "maxCasesPerPallet",
      1,
      issues,
    );
    const warehouseOnHand = readWholeNumber(
      get(cells, "warehouseOnHand"),
      "warehouseOnHand",
      0,
      issues,
    );

    let asin = optionalText(get(cells, "asin"));
    if (asin !== null) {
      asin = asin.toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) {
        issues.push(`ASIN must be 10 letters and numbers, such as B0ABC12345, but it says "${asin}".`);
      }
    }

    const countDate = readDate(get(cells, "countDate"));
    if (countDate === "invalid") {
      issues.push(
        `Count date must be a date such as 2026-11-27, but it says "${cellText(get(cells, "countDate"))}".`,
      );
    }

    if (issues.length > 0) {
      for (const message of issues) errors.push({ row: rowNumber, message });
      continue;
    }

    const row: SkuImportRow = {
      rowNumber,
      listing,
      amazonSku,
      inhouseSku,
      unitsPerCase: unitsPerCase!,
      tie: tie!,
      high: high!,
      maxCasesPerPallet: maxCasesPerPallet!,
      warehouseOnHand: warehouseOnHand!,
      description: optionalText(get(cells, "description")),
      warehouseLocation: optionalText(get(cells, "warehouseLocation")),
      asin,
      countDate: countDate as string | null,
      notes: optionalText(get(cells, "notes")),
    };
    rows.push(row);
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: null, message: "The sheet has no SKU rows. Fill in one row per SKU, starting in row 2." });
  }

  const cross = checkAcrossRows(rows);
  errors.push(...cross.errors);
  warnings.push(...cross.warnings);
  return { rows, errors, warnings };
}

/** Checks that need every row at once: duplicates and pallet sanity. */
export function checkAcrossRows(rows: SkuImportRow[]): { errors: RowIssue[]; warnings: RowIssue[] } {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const seenAmazon = new Map<string, number>();
  const seenInhouse = new Map<string, number>();
  for (const r of rows) {
    const a = r.amazonSku.toLowerCase();
    const h = r.inhouseSku.toLowerCase();
    if (seenAmazon.has(a)) {
      errors.push({
        row: r.rowNumber,
        message: `Amazon SKU "${r.amazonSku}" is also on row ${seenAmazon.get(a)}. Each SKU should appear once.`,
      });
    } else seenAmazon.set(a, r.rowNumber);
    if (seenInhouse.has(h)) {
      errors.push({
        row: r.rowNumber,
        message: `In-house SKU "${r.inhouseSku}" is also on row ${seenInhouse.get(h)}. Each SKU should appear once.`,
      });
    } else seenInhouse.set(h, r.rowNumber);

    if (r.maxCasesPerPallet > r.tie * r.high) {
      warnings.push({
        row: r.rowNumber,
        message: `Max cases per pallet (${r.maxCasesPerPallet}) is more than tie x high (${r.tie} x ${r.high} = ${r.tie * r.high}). Check this is right.`,
      });
    }
  }
  return { errors, warnings };
}

/**
 * Re-checks rows sent back from the browser before they are saved, so the
 * save step never trusts the browser.
 */
export function recheckRows(input: unknown): ImportCheck {
  const parsed = z.array(skuImportRowSchema).min(1).max(1000).safeParse(input);
  if (!parsed.success) {
    return {
      rows: [],
      errors: [{ row: null, message: "The import could not be read. Please upload the file again." }],
      warnings: [],
    };
  }
  const cross = checkAcrossRows(parsed.data);
  return { rows: parsed.data, ...cross };
}
