/**
 * Plain rules for China orders (Phase 6), with no database, so they are
 * covered by tests in tests/unit/china.test.ts.
 */
import { addDays, daysBetween, RULES, type Rules } from "@/lib/forecast/rules";

/** Largest number of cases one line of a China order can ask for, to catch typos. */
export const MAX_ORDER_CASES = 20_000;

/** The day an order placed on `orderedOn` should reach the warehouse (60 days later). */
export function defaultExpectedOn(orderedOn: string, r: Rules = RULES): string {
  return addDays(orderedOn, r.chinaLeadDays);
}

export type OrderLineFigures = { cases: number; casesReceived: number; unitsPerCase: number };

/** Cases still to come on a line. A supplier who sends extra never makes this negative. */
export function casesStillToCome(l: Pick<OrderLineFigures, "cases" | "casesReceived">): number {
  return Math.max(0, l.cases - l.casesReceived);
}

/** Units still to come on a line. */
export function unitsStillToCome(l: OrderLineFigures): number {
  return casesStillToCome(l) * l.unitsPerCase;
}

export type ArrivalRisk = {
  /** The day stock at Amazon plus the warehouse runs out without this order. */
  runsOutOn: string;
  /** The day the order's stock can be selling at Amazon (arrival + 7 days to reach FBA). */
  sellingFrom: string;
  /** Days of sales lost between the two, 0 when the order is in time. */
  gapDays: number;
};

/**
 * Will an order arrive before the SKU runs out? Stock on hand (FBA, on the way
 * to FBA, and the warehouse) is used up at the daily rate. The order only helps
 * once it has reached the warehouse and then Amazon.
 */
export function arrivalRisk(
  input: { stockDay: string; unitsOnHand: number; dailyRate: number; expectedOn: string },
  r: Rules = RULES,
): ArrivalRisk {
  const runsOutOn = addDays(input.stockDay, Math.floor(input.unitsOnHand / input.dailyRate + 1e-9));
  const sellingFrom = addDays(input.expectedOn, r.warehouseToFbaDays);
  return { runsOutOn, sellingFrom, gapDays: Math.max(0, daysBetween(runsOutOn, sellingFrom)) };
}

export type DetailsIssue = { field: "orderedOn" | "expectedOn"; message: string };

export type OrderDetails = {
  supplier: string | null;
  poNumber: string | null;
  orderedOn: string;
  expectedOn: string;
  note: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const clean = (v: FormDataEntryValue | null, max: number) => {
  const t = String(v ?? "").trim().slice(0, max);
  return t === "" ? null : t;
};

/**
 * Reads supplier, PO number, order date, expected arrival and note. The order
 * date may be in the past, so orders already on the way can be entered, but not
 * in the future. A blank expected arrival becomes order date + 60 days.
 */
export function readOrderDetails(
  form: FormData,
  today: string,
): { details: OrderDetails | null; issues: DetailsIssue[] } {
  const issues: DetailsIssue[] = [];
  const orderedOn = clean(form.get("orderedOn"), 10) ?? today;
  if (!isRealDay(orderedOn)) issues.push({ field: "orderedOn", message: "Pick the day the order was placed." });
  else if (orderedOn > today) issues.push({ field: "orderedOn", message: "The order date cannot be in the future." });
  else if (daysBetween(orderedOn, today) > 365) issues.push({ field: "orderedOn", message: "That is more than a year ago. Check the date." });

  let expectedOn = clean(form.get("expectedOn"), 10);
  if (expectedOn === null && issues.length === 0) expectedOn = defaultExpectedOn(orderedOn);
  if (expectedOn !== null && !isRealDay(expectedOn)) {
    issues.push({ field: "expectedOn", message: "Pick the day the order should reach the warehouse." });
  } else if (expectedOn !== null && isRealDay(orderedOn) && expectedOn < orderedOn) {
    issues.push({ field: "expectedOn", message: "The arrival date cannot be before the order date." });
  } else if (expectedOn !== null && isRealDay(orderedOn) && daysBetween(orderedOn, expectedOn) > 365) {
    issues.push({ field: "expectedOn", message: "That is more than a year after the order date. Check the date." });
  }
  if (issues.length > 0 || expectedOn === null) return { details: null, issues };
  return {
    details: {
      supplier: clean(form.get("supplier"), 120),
      poNumber: clean(form.get("poNumber"), 80),
      orderedOn,
      expectedOn,
      note: clean(form.get("note"), 500),
    },
    issues,
  };
}

export type OrderLine = { skuId: number; cases: number };
export type LineIssue = { skuId: number; message: string };

/** Reads the order form: include-<id> ticks a SKU, cases-<id> is how many cases. */
export function readOrderLines(form: FormData, skuIds: number[]): { lines: OrderLine[]; issues: LineIssue[] } {
  const lines: OrderLine[] = [];
  const issues: LineIssue[] = [];
  for (const id of skuIds) {
    if (!form.get(`include-${id}`)) continue;
    const text = String(form.get(`cases-${id}`) ?? "").trim().replace(/,/g, "");
    if (!/^\d+$/.test(text) || Number(text) < 1) {
      issues.push({ skuId: id, message: "Enter a whole number of cases, 1 or more, or untick this SKU." });
    } else if (Number(text) > MAX_ORDER_CASES) {
      issues.push({ skuId: id, message: `That is more than ${MAX_ORDER_CASES.toLocaleString("en-US")} cases. Check the number.` });
    } else {
      lines.push({ skuId: id, cases: Number(text) });
    }
  }
  return { lines, issues };
}

export type ArrivedEntry = { skuId: number; cases: number };

/** Reads "cases that arrived" from the receive form: arrived-<id>. Every SKU in the order needs a number. */
export function readArrivedForm(form: FormData, skuIds: number[]): { entries: ArrivedEntry[]; issues: LineIssue[] } {
  const entries: ArrivedEntry[] = [];
  const issues: LineIssue[] = [];
  for (const id of skuIds) {
    const text = String(form.get(`arrived-${id}`) ?? "").trim().replace(/,/g, "");
    if (text === "") issues.push({ skuId: id, message: "Type how many full cases arrived. Type 0 if none came." });
    else if (!/^\d+$/.test(text)) issues.push({ skuId: id, message: "Enter a whole number of cases, 0 or more." });
    else if (Number(text) > MAX_ORDER_CASES) issues.push({ skuId: id, message: "That is too many cases. Check the number." });
    else entries.push({ skuId: id, cases: Number(text) });
  }
  return { entries, issues };
}
