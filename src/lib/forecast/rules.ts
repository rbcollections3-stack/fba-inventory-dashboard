/**
 * The forecast rules from the approved build plan ("The rules behind the
 * dates"). Everything here is plain arithmetic with no database, so every rule
 * is covered by tests in tests/unit/forecast.test.ts.
 *
 * Days of cover = units / units sold per day.
 * Ship to Amazon when FBA cover (available + inbound) reaches 45 + 7 = 52 days.
 * Reorder from China when total cover (FBA + inbound + warehouse + on order)
 * reaches 52 + 60 + 14 = 126 days.
 */

export const RULES = {
  /** Sales rate is worked out from this many days of Amazon sales. */
  salesWindowDays: 30,
  /** FBA must never drop below this many days of stock. */
  fbaFloorDays: 45,
  /** Days from leaving the warehouse to available in FBA. */
  warehouseToFbaDays: 7,
  /** Each Amazon shipment covers this many days of sales. */
  shipmentCoverDays: 45,
  /** Days from placing a China order to arrival at the warehouse. */
  chinaLeadDays: 60,
  /** Safety buffer on China orders. */
  chinaBufferDays: 14,
  /** Each China order covers this many days of sales. */
  chinaOrderCoverDays: 120,
  /** Yellow when the ship-by date is this many days away or fewer. */
  shipSoonDays: 7,
  /** Yellow when the reorder-by date is this many days away or fewer. */
  reorderSoonDays: 14,
} as const;

export type Rules = typeof RULES;

/** FBA cover at which a shipment has to leave the warehouse (52 days). */
export function shipPointDays(r: Rules = RULES): number {
  return r.fbaFloorDays + r.warehouseToFbaDays;
}

/** Total cover at which a China order has to be placed (126 days). */
export function reorderPointDays(r: Rules = RULES): number {
  return shipPointDays(r) + r.chinaLeadDays + r.chinaBufferDays;
}

export type ForecastInput = {
  unitsPerCase: number;
  /** Units sold to customers in the sales window, or null if no sales are loaded at all. */
  unitsSold: number | null;
  /** Days of sales data in the window (30, or fewer when less history is loaded). */
  salesDays: number;
  /** Expected units per day typed in by hand. When set, it is used instead of real sales. */
  manualDailySales: number | null;
  /** Latest FBA stock, or null if none is loaded. */
  fba: { available: number; inbound: number } | null;
  /** The day the FBA stock figures are from (YYYY-MM-DD). Dates count from this day. */
  stockDay: string | null;
  /** Latest warehouse count in units, or null if never counted. */
  warehouse: number | null;
  /** Units already ordered from China and not yet received. Phase 6 fills this in. */
  onOrder: number;
  /** Today in the business's time zone (YYYY-MM-DD). Only used for colours. */
  today: string;
};

export type Status = "red" | "yellow" | "green" | "none";

export type Forecast = {
  /** Units per day the dates are planned from, or null when there is nothing to plan from. */
  dailyRate: number | null;
  rateSource: "sales" | "manual" | "none";
  /** Units per day from real sales, shown next to a manual number for comparison. */
  measuredRate: number | null;
  /** Fewer than 30 days of sales history. */
  lowConfidence: boolean;
  fbaUnits: number | null;
  fbaCoverDays: number | null;
  totalUnits: number | null;
  totalCoverDays: number | null;
  shipBy: string | null;
  /** Cases in the next Amazon shipment (45 days of sales, rounded up to full cases). */
  shipCases: number | null;
  shipUnits: number | null;
  /** The warehouse count is lower than the next shipment needs. */
  warehouseShort: boolean;
  /** Full cases the warehouse can actually send, when it is short. */
  shipCasesAvailable: number | null;
  reorderBy: string | null;
  /** Cases in the next China order (120 days of sales, rounded up to full cases). */
  reorderCases: number | null;
  reorderUnits: number | null;
  /** The reorder-by date treats the warehouse as empty because it has not been counted. */
  reorderAssumesEmptyWarehouse: boolean;
  shipStatus: Status;
  reorderStatus: Status;
  status: Status;
  /** Plain-language reasons for the colour, most important first. */
  notes: string[];
};

export function addDays(day: string, days: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}

/** Units for `days` of sales, rounded up to full cases. */
export function casesFor(days: number, dailyRate: number, unitsPerCase: number): number {
  // Round away floating point noise first so 45 x 10 / 24 is exactly 18.75.
  const units = Math.round(days * dailyRate * 1e6) / 1e6;
  return Math.ceil(units / unitsPerCase);
}

function statusFor(due: string | null, today: string, soonDays: number): Status {
  if (!due) return "none";
  const away = daysBetween(today, due);
  if (away <= 0) return "red";
  if (away <= soonDays) return "yellow";
  return "green";
}

const RANK: Record<Status, number> = { red: 3, yellow: 2, green: 1, none: 0 };

function worst(a: Status, b: Status): Status {
  return RANK[a] >= RANK[b] ? a : b;
}

export function forecastSku(input: ForecastInput, r: Rules = RULES): Forecast {
  const notes: string[] = [];
  const measuredRate =
    input.unitsSold !== null && input.salesDays > 0 && input.unitsSold > 0 ? input.unitsSold / input.salesDays : null;

  let dailyRate: number | null = null;
  let rateSource: Forecast["rateSource"] = "none";
  if (input.manualDailySales !== null && input.manualDailySales > 0) {
    dailyRate = input.manualDailySales;
    rateSource = "manual";
  } else if (measuredRate !== null) {
    dailyRate = measuredRate;
    rateSource = "sales";
  }
  const lowConfidence = rateSource === "sales" && input.salesDays < r.salesWindowDays;

  const fbaUnits = input.fba ? input.fba.available + input.fba.inbound : null;
  const totalUnits = fbaUnits === null ? null : fbaUnits + (input.warehouse ?? 0) + input.onOrder;

  const empty: Forecast = {
    dailyRate,
    rateSource,
    measuredRate,
    lowConfidence,
    fbaUnits,
    fbaCoverDays: null,
    totalUnits,
    totalCoverDays: null,
    shipBy: null,
    shipCases: null,
    shipUnits: null,
    warehouseShort: false,
    shipCasesAvailable: null,
    reorderBy: null,
    reorderCases: null,
    reorderUnits: null,
    reorderAssumesEmptyWarehouse: false,
    shipStatus: "none",
    reorderStatus: "none",
    status: "none",
    notes,
  };

  if (dailyRate === null) {
    notes.push(
      input.unitsSold === null
        ? "No Amazon sales loaded yet, so no dates."
        : `No sales in the last ${input.salesDays} days, so no dates. Enter expected daily sales to plan this SKU.`,
    );
    return empty;
  }
  if (!input.fba || !input.stockDay || fbaUnits === null || totalUnits === null) {
    notes.push("No FBA stock loaded yet, so no dates.");
    return empty;
  }

  const fbaCoverDays = fbaUnits / dailyRate;
  const totalCoverDays = totalUnits / dailyRate;
  // Round down so a date is never later than the rule allows.
  const shipBy = addDays(input.stockDay, Math.floor(fbaCoverDays - shipPointDays(r) + 1e-9));
  const reorderBy = addDays(input.stockDay, Math.floor(totalCoverDays - reorderPointDays(r) + 1e-9));
  const shipCases = casesFor(r.shipmentCoverDays, dailyRate, input.unitsPerCase);
  const reorderCases = casesFor(r.chinaOrderCoverDays, dailyRate, input.unitsPerCase);

  const shipStatus = statusFor(shipBy, input.today, r.shipSoonDays);
  let reorderStatus = statusFor(reorderBy, input.today, r.reorderSoonDays);

  let warehouseShort = false;
  let shipCasesAvailable: number | null = null;
  if (input.warehouse !== null && input.warehouse < shipCases * input.unitsPerCase) {
    warehouseShort = true;
    shipCasesAvailable = Math.floor(input.warehouse / input.unitsPerCase);
  }

  if (shipStatus === "red") notes.push(shipBy < input.today ? "Shipment to Amazon is overdue." : "Ship to Amazon today.");
  else if (shipStatus === "yellow") notes.push(`Ship to Amazon within ${daysBetween(input.today, shipBy)} days.`);

  // The plan: if the warehouse cannot fill the shipment that is due, ship what
  // is there and flag the SKU red for reorder.
  if (warehouseShort && (shipStatus === "red" || shipStatus === "yellow")) {
    notes.push(
      shipCasesAvailable === 0
        ? `Warehouse has no full cases for the next shipment (needs ${shipCases}).`
        : `Warehouse is short: ship the ${shipCasesAvailable} cases there are (needs ${shipCases}).`,
    );
    reorderStatus = "red";
  }

  const reorderAssumesEmptyWarehouse = input.warehouse === null;
  if (reorderAssumesEmptyWarehouse) {
    // Without a count the reorder date is only a floor. Don't colour on it.
    notes.push("Warehouse not counted yet. The reorder-by date treats the warehouse as empty.");
    if (!warehouseShort) reorderStatus = "none";
  } else if (reorderStatus === "red" && !warehouseShort) {
    notes.push(reorderBy < input.today ? "China reorder is overdue." : "Reorder from China today.");
  } else if (reorderStatus === "yellow") {
    notes.push(`Reorder from China within ${daysBetween(input.today, reorderBy)} days.`);
  }

  if (rateSource === "manual") notes.push("Planned from expected daily sales you entered.");
  if (lowConfidence) notes.push(`Only ${input.salesDays} days of sales history, so this forecast is low confidence.`);

  return {
    ...empty,
    fbaCoverDays,
    totalCoverDays,
    shipBy,
    shipCases,
    shipUnits: shipCases * input.unitsPerCase,
    warehouseShort,
    shipCasesAvailable,
    reorderBy,
    reorderCases,
    reorderUnits: reorderCases * input.unitsPerCase,
    reorderAssumesEmptyWarehouse,
    shipStatus,
    reorderStatus,
    status: worst(shipStatus, reorderStatus),
    notes,
  };
}

/** The earliest date something has to happen, for sorting most urgent first. */
export function nextActionDate(f: Forecast): string | null {
  const dates = [f.shipBy, f.reorderAssumesEmptyWarehouse ? null : f.reorderBy].filter((d): d is string => !!d);
  return dates.sort()[0] ?? null;
}

/** Most urgent first: colour, then the earliest date, then SKUs with no dates last. */
export function compareUrgency(a: Forecast, b: Forecast): number {
  const byStatus = RANK[b.status] - RANK[a.status];
  if (byStatus !== 0) return byStatus;
  const da = nextActionDate(a);
  const db = nextActionDate(b);
  if (da && db) return da < db ? -1 : da > db ? 1 : 0;
  if (da) return -1;
  if (db) return 1;
  return 0;
}
