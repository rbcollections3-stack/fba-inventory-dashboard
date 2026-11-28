import Papa from "papaparse";

/**
 * Readers for the two Seller Central reports the app uses. They work on the
 * report's text only (no database), so the same code reads a file uploaded by
 * hand and, from Phase 3, the same report downloaded through Amazon's
 * Selling Partner API Reports API:
 *
 *  - FBA Inventory Ledger, detailed view (SP-API GET_LEDGER_DETAIL_VIEW_DATA):
 *    daily events per SKU. "Shipments" are units shipped to customers (sales).
 *  - Manage FBA Inventory (SP-API GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA):
 *    current FBA stock per SKU, including units inbound to Amazon.
 */

export type ReportKind = "ledger_detail" | "fba_inventory";

export class ReportFormatError extends Error {}

/** "Event Type", "event-type" and "EVENT_TYPE" all become "eventtype". */
export function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type Table = { headers: string[]; rows: string[][] };

function readTable(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  if (clean.trim() === "") throw new ReportFormatError("This file is empty.");
  const firstLine = clean.slice(0, clean.search(/\r?\n|$/));
  // Seller Central reports are tab separated; the ledger can also be downloaded as .csv.
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const parsed = Papa.parse<string[]>(clean, { delimiter, skipEmptyLines: "greedy" });
  const [headers, ...rows] = parsed.data;
  return { headers: (headers ?? []).map((h) => String(h ?? "").trim()), rows };
}

const LEDGER_REQUIRED = { date: "Date", msku: "MSKU", eventtype: "Event Type", quantity: "Quantity" } as const;
const INVENTORY_REQUIRED = {
  sku: "sku",
  afnfulfillablequantity: "afn-fulfillable-quantity",
  afnreservedquantity: "afn-reserved-quantity",
  afninboundworkingquantity: "afn-inbound-working-quantity",
  afninboundshippedquantity: "afn-inbound-shipped-quantity",
  afninboundreceivingquantity: "afn-inbound-receiving-quantity",
} as const;

const NOT_RECOGNISED =
  "This file is not one of the Amazon reports the app reads. Upload either the FBA Inventory Ledger " +
  "(Reports > Fulfillment > Inventory Ledger, Detailed view) or the Manage FBA Inventory report " +
  "(Reports > Fulfillment > Manage FBA Inventory).";

/** Works out which report a file is from its column headers. */
export function detectKind(headers: string[]): ReportKind | null {
  const h = new Set(headers.map(normalizeHeader));
  if (h.has("msku") && h.has("eventtype")) return "ledger_detail";
  if (h.has("afnfulfillablequantity") || h.has("afninboundshippedquantity")) return "fba_inventory";
  return null;
}

function columnIndex(headers: string[], required: Record<string, string>, reportName: string) {
  const norm = headers.map(normalizeHeader);
  const idx: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, label] of Object.entries(required)) {
    const i = norm.indexOf(key);
    if (i < 0) missing.push(`"${label}"`);
    idx[key] = i;
  }
  if (missing.length > 0) {
    throw new ReportFormatError(
      `This looks like the ${reportName}, but these columns are missing: ${missing.join(", ")}. ` +
        "Download the report again from Seller Central without changing its columns.",
    );
  }
  return { idx, norm };
}

function parseIntCell(v: string | undefined): number | null {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (s === "") return 0;
  if (!/^-?\d+(\.0+)?$/.test(s)) return null;
  return Math.trunc(Number(s));
}

/** Ledger dates are MM/DD/YYYY; ISO dates are accepted too. Returns YYYY-MM-DD. */
export function parseReportDate(v: string | undefined): string | null {
  const s = String(v ?? "").trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (match) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export type LedgerDayRow = {
  msku: string;
  day: string;
  eventType: string;
  disposition: string;
  quantity: number;
};

export type LedgerReport = {
  kind: "ledger_detail";
  /** Summed per SKU, day, event type and disposition across fulfillment centers. */
  rows: LedgerDayRow[];
  rowsRead: number;
  periodStart: string | null;
  periodEnd: string | null;
  /** Rows that could not be read (bad date or quantity), with their line numbers. */
  badRows: { line: number; reason: string }[];
  /** Amazon barcode (FNSKU) per seller SKU, where the report has an FNSKU column. */
  fnskus: Record<string, string>;
};

export type InventoryRow = {
  msku: string;
  fulfillable: number;
  reserved: number;
  unsellable: number;
  inboundWorking: number;
  inboundShipped: number;
  inboundReceiving: number;
  researching: number;
};

export type InventoryReport = {
  kind: "fba_inventory";
  rows: InventoryRow[];
  rowsRead: number;
  badRows: { line: number; reason: string }[];
  fnskus: Record<string, string>;
};

export type AmazonReport = LedgerReport | InventoryReport;

/** FNSKUs are 10 letters and numbers, such as X001ABC123 or, for stickerless items, the ASIN. */
export function cleanFnsku(v: string | undefined): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(s) ? s : null;
}

function readFnsku(fnskus: Record<string, string>, fnskuIdx: number, msku: string, cells: string[]) {
  if (fnskuIdx < 0) return;
  const f = cleanFnsku(cells[fnskuIdx]);
  if (f) fnskus[msku] = f;
}

function parseLedger(t: Table): LedgerReport {
  const { idx, norm } = columnIndex(t.headers, LEDGER_REQUIRED, "FBA Inventory Ledger");
  const dispIdx = norm.indexOf("disposition");
  const fnskuIdx = norm.indexOf("fnsku");
  const fnskus: Record<string, string> = {};
  const sums = new Map<string, LedgerDayRow>();
  const badRows: LedgerReport["badRows"] = [];
  let start: string | null = null;
  let end: string | null = null;
  t.rows.forEach((cells, i) => {
    const line = i + 2;
    const msku = String(cells[idx.msku] ?? "").trim();
    const eventType = String(cells[idx.eventtype] ?? "").trim();
    if (msku === "" && eventType === "") return;
    const day = parseReportDate(cells[idx.date]);
    const qty = parseIntCell(cells[idx.quantity]);
    if (!day) return void badRows.push({ line, reason: "the date could not be read" });
    if (qty === null) return void badRows.push({ line, reason: "the quantity is not a whole number" });
    if (msku === "") return void badRows.push({ line, reason: "the MSKU is blank" });
    readFnsku(fnskus, fnskuIdx, msku, cells);
    const disposition = dispIdx >= 0 ? String(cells[dispIdx] ?? "").trim().toUpperCase() : "";
    if (start === null || day < start) start = day;
    if (end === null || day > end) end = day;
    const key = [msku, day, eventType, disposition].join("\u0000");
    const prev = sums.get(key);
    if (prev) prev.quantity += qty;
    else sums.set(key, { msku, day, eventType, disposition, quantity: qty });
  });
  return { kind: "ledger_detail", rows: [...sums.values()], rowsRead: t.rows.length, periodStart: start, periodEnd: end, badRows, fnskus };
}

function parseInventory(t: Table): InventoryReport {
  const { idx, norm } = columnIndex(t.headers, INVENTORY_REQUIRED, "Manage FBA Inventory report");
  const optional = (name: string) => norm.indexOf(name);
  const unsellableIdx = optional("afnunsellablequantity");
  const researchingIdx = optional("afnresearchingquantity");
  const fnskuIdx = optional("fnsku");
  const fnskus: Record<string, string> = {};
  const bySku = new Map<string, InventoryRow>();
  const badRows: InventoryReport["badRows"] = [];
  t.rows.forEach((cells, i) => {
    const line = i + 2;
    const msku = String(cells[idx.sku] ?? "").trim();
    if (msku === "") return;
    readFnsku(fnskus, fnskuIdx, msku, cells);
    const num = (j: number) => (j < 0 ? 0 : parseIntCell(cells[j]));
    const values = {
      fulfillable: num(idx.afnfulfillablequantity),
      reserved: num(idx.afnreservedquantity),
      unsellable: num(unsellableIdx),
      inboundWorking: num(idx.afninboundworkingquantity),
      inboundShipped: num(idx.afninboundshippedquantity),
      inboundReceiving: num(idx.afninboundreceivingquantity),
      researching: num(researchingIdx),
    };
    if (Object.values(values).some((v) => v === null)) {
      return void badRows.push({ line, reason: "a quantity is not a whole number" });
    }
    const v = values as Record<keyof typeof values, number>;
    const prev = bySku.get(msku);
    if (prev) {
      for (const k of Object.keys(v) as (keyof typeof v)[]) prev[k] += v[k];
    } else {
      bySku.set(msku, { msku, ...v });
    }
  });
  return { kind: "fba_inventory", rows: [...bySku.values()], rowsRead: t.rows.length, badRows, fnskus };
}

/** Reads a Seller Central report's text, working out which report it is. */
export function parseAmazonReport(text: string): AmazonReport {
  const t = readTable(text);
  const kind = detectKind(t.headers);
  if (kind === "ledger_detail") return parseLedger(t);
  if (kind === "fba_inventory") return parseInventory(t);
  throw new ReportFormatError(NOT_RECOGNISED);
}
