import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("user_role", ["admin", "staff"]);

/** Logins: one admin, plus one per warehouse employee (no shared logins). */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  /** Bumped on password change so older sessions stop working. */
  sessionVersion: integer("session_version").notNull().default(1),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Passwords expire PASSWORD_MAX_AGE_DAYS after this. */
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set for first logins and after an admin sets someone's password. */
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  /** Authenticator app secret, encrypted with a key derived from AUTH_SECRET. */
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** Last 30-second step a code was accepted for, so a code cannot be reused. */
  totpLastStep: integer("totp_last_step"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time backup codes for when someone loses their phone. Stored hashed. */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

/** An Amazon listing (parent). Each listing has one or more SKUs. */
export const listings = pgTable("listings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skus = pgTable(
  "skus",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "restrict" }),
    amazonSku: text("amazon_sku").notNull().unique(),
    inhouseSku: text("inhouse_sku").notNull().unique(),
    unitsPerCase: integer("units_per_case").notNull(),
    /** Cases per layer on a pallet. */
    tie: integer("tie").notNull(),
    /** Layers per pallet. */
    high: integer("high").notNull(),
    maxCasesPerPallet: integer("max_cases_per_pallet").notNull(),
    description: text("description"),
    warehouseLocation: text("warehouse_location"),
    asin: text("asin"),
    /** Amazon's barcode for this SKU (X00... or the ASIN for stickerless items), copied from Amazon reports. */
    fnsku: text("fnsku"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("skus_listing_idx").on(t.listingId),
    check("skus_units_per_case_positive", sql`${t.unitsPerCase} > 0`),
    check("skus_tie_positive", sql`${t.tie} > 0`),
    check("skus_high_positive", sql`${t.high} > 0`),
    check("skus_max_cases_positive", sql`${t.maxCasesPerPallet} > 0`),
  ],
);

/**
 * import: SKU spreadsheet. manual: Stock counts screen. shipment: counted after
 * an Amazon shipment left (Phase 5). china_order: counted after a China order
 * was put away (Phase 6).
 */
export const countSourceEnum = pgEnum("count_source", ["import", "manual", "shipment", "china_order"]);

/**
 * Warehouse on-hand counts, one row per count. The latest row per SKU is the
 * current warehouse stock. Phase 1 writes these from the SKU spreadsheet;
 * Phase 2 adds the Warehouse counts screen.
 */
export const warehouseCounts = pgTable(
  "warehouse_counts",
  {
    id: serial("id").primaryKey(),
    skuId: integer("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    units: integer("units").notNull(),
    countedOn: date("counted_on", { mode: "string" }).notNull(),
    source: countSourceEnum("source").notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the count was taken as an Amazon shipment left (Phase 5). */
    shipmentId: integer("shipment_id").references((): AnyPgColumn => shipments.id, { onDelete: "set null" }),
    /** Set when the count was taken after a China order was received (Phase 6). */
    chinaOrderId: integer("china_order_id").references((): AnyPgColumn => chinaOrders.id, { onDelete: "set null" }),
  },
  (t) => [
    index("warehouse_counts_sku_idx").on(t.skuId, t.createdAt),
    check("warehouse_counts_units_nonnegative", sql`${t.units} >= 0`),
  ],
);

export const amazonReportKindEnum = pgEnum("amazon_report_kind", ["ledger_detail", "fba_inventory"]);
export const amazonReportSourceEnum = pgEnum("amazon_report_source", ["upload", "sp_api"]);

/**
 * One row per Amazon report loaded into the app, whether uploaded by hand or
 * (from Phase 3) pulled automatically through the Selling Partner API.
 */
export const amazonImports = pgTable(
  "amazon_imports",
  {
    id: serial("id").primaryKey(),
    kind: amazonReportKindEnum("kind").notNull(),
    source: amazonReportSourceEnum("source").notNull(),
    fileName: text("file_name"),
    /** For the inventory report: when Amazon's numbers were true. */
    asOf: timestamp("as_of", { withTimezone: true }),
    /** For the ledger: first and last day covered. */
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    rowsRead: integer("rows_read").notNull(),
    rowsUsed: integer("rows_used").notNull(),
    skusMatched: integer("skus_matched").notNull(),
    /** Rows for SKUs that are not in the SKU list (other SKUs, amzn.gr.* resale SKUs). */
    rowsSkipped: integer("rows_skipped").notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("amazon_imports_kind_idx").on(t.kind, t.createdAt)],
);

/**
 * FBA Inventory Ledger events summed per SKU, day, event type and disposition
 * (all fulfillment centers added together). "Shipments" rows are units shipped
 * to customers, which is the daily sales figure.
 */
export const fbaLedgerDaily = pgTable(
  "fba_ledger_daily",
  {
    id: serial("id").primaryKey(),
    skuId: integer("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    eventType: text("event_type").notNull(),
    disposition: text("disposition").notNull(),
    quantity: integer("quantity").notNull(),
    importId: integer("import_id")
      .notNull()
      .references(() => amazonImports.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("fba_ledger_daily_key").on(t.skuId, t.day, t.eventType, t.disposition),
    index("fba_ledger_daily_day_idx").on(t.day),
  ],
);

/**
 * FBA stock per SKU at a point in time. The latest row per SKU is what the
 * app shows; older rows are kept as history (for out-of-stock days later).
 */
export const fbaInventorySnapshots = pgTable(
  "fba_inventory_snapshots",
  {
    id: serial("id").primaryKey(),
    skuId: integer("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    importId: integer("import_id")
      .notNull()
      .references(() => amazonImports.id, { onDelete: "cascade" }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    /** Available to sell (Amazon: fulfillable). */
    fulfillable: integer("fulfillable").notNull(),
    /** Held by Amazon for open orders, transfers between centers and processing. */
    reserved: integer("reserved").notNull(),
    unsellable: integer("unsellable").notNull(),
    /** Shipment created in Seller Central but not yet sent. */
    inboundWorking: integer("inbound_working").notNull(),
    /** Sent and on the way to Amazon. */
    inboundShipped: integer("inbound_shipped").notNull(),
    /** Arrived at Amazon and being checked in. */
    inboundReceiving: integer("inbound_receiving").notNull(),
    researching: integer("researching").notNull(),
  },
  (t) => [index("fba_inventory_snapshots_sku_idx").on(t.skuId, t.asOf)],
);

export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type Sku = typeof skus.$inferSelect;
export type Listing = typeof listings.$inferSelect;

/**
 * Reports the app has asked Amazon for through the Selling Partner API.
 * Amazon takes a few minutes to prepare a report, so a request is saved here
 * and picked up on the next check once Amazon says it is ready.
 * status: requested (waiting for Amazon), saved (loaded into the app),
 * no_data (Amazon had nothing for that period), failed (see message).
 */
export const amazonSyncRequests = pgTable(
  "amazon_sync_requests",
  {
    id: serial("id").primaryKey(),
    kind: amazonReportKindEnum("kind").notNull(),
    /** Amazon's report type, for example GET_LEDGER_DETAIL_VIEW_DATA. */
    reportType: text("report_type").notNull(),
    /** Amazon's report id. Blank only for a moment while the request is sent. */
    amazonReportId: text("amazon_report_id"),
    /** "schedule" for the daily pull, "manual" for the Refresh button. */
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("requested"),
    dataStart: timestamp("data_start", { withTimezone: true }),
    dataEnd: timestamp("data_end", { withTimezone: true }),
    message: text("message"),
    importId: integer("import_id").references(() => amazonImports.id, { onDelete: "set null" }),
    requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last time the app asked Amazon whether the report is ready. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // At most one report of each kind waiting on Amazon at a time.
    uniqueIndex("amazon_sync_requests_one_waiting").on(t.kind).where(sql`${t.status} = 'requested'`),
    index("amazon_sync_requests_kind_idx").on(t.kind, t.requestedAt),
    check(
      "amazon_sync_requests_status_valid",
      sql`${t.status} in ('requested', 'saved', 'no_data', 'failed')`,
    ),
  ],
);

/**
 * Per-SKU forecast settings (Phase 4). One row per SKU at most; a SKU with no
 * row plans from its real Amazon sales.
 */
export const forecastSettings = pgTable(
  "forecast_settings",
  {
    skuId: integer("sku_id")
      .primaryKey()
      .references(() => skus.id, { onDelete: "cascade" }),
    /** Expected units sold per day, typed in by hand. Used instead of real sales while set. */
    manualDailySales: numeric("manual_daily_sales", { precision: 10, scale: 2, mode: "number" }),
    note: text("note"),
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("forecast_settings_manual_positive", sql`${t.manualDailySales} is null or ${t.manualDailySales} > 0`)],
);

/**
 * Shipments to Amazon (Phase 5). The admin requests a shipment; warehouse
 * staff build the pallets from the sheets and mark it sent, confirming what
 * is left on the shelf. The app never creates anything in Seller Central.
 * status: requested (waiting to be built and sent), sent, cancelled.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    status: text("status").notNull().default("requested"),
    /** Amazon's shipment ID from Seller Central (for example FBA15XXXXXXX), typed in for reference. */
    amazonShipmentId: text("amazon_shipment_id"),
    /** Where each Amazon shipment ID was found in Amazon's inbound plans, so labels load faster next time. */
    amazonLookup: jsonb("amazon_lookup").$type<Record<string, { inboundPlanId: string; shipmentId: string }>>(),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: integer("sent_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("shipments_status_idx").on(t.status, t.createdAt),
    check("shipments_status_valid", sql`${t.status} in ('requested', 'sent', 'cancelled')`),
  ],
);

/**
 * One row per SKU in a shipment. The packing figures are copied from the SKU
 * when the shipment is requested, so a later SKU edit does not change pallet
 * sheets that are already printed.
 */
export const shipmentLines = pgTable(
  "shipment_lines",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    skuId: integer("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    cases: integer("cases").notNull(),
    unitsPerCase: integer("units_per_case").notNull(),
    tie: integer("tie").notNull(),
    high: integer("high").notNull(),
    maxCasesPerPallet: integer("max_cases_per_pallet").notNull(),
  },
  (t) => [
    uniqueIndex("shipment_lines_sku_key").on(t.shipmentId, t.skuId),
    index("shipment_lines_sku_idx").on(t.skuId),
    check("shipment_lines_cases_positive", sql`${t.cases} > 0`),
    check("shipment_lines_units_per_case_positive", sql`${t.unitsPerCase} > 0`),
    check("shipment_lines_tie_positive", sql`${t.tie} > 0`),
    check("shipment_lines_high_positive", sql`${t.high} > 0`),
    check("shipment_lines_max_cases_positive", sql`${t.maxCasesPerPallet} > 0`),
  ],
);

export type Shipment = typeof shipments.$inferSelect;
export type ShipmentStatus = "requested" | "sent" | "cancelled";

/**
 * The forecast the app made for each SKU each day (Phase 7), so it can later
 * be checked against what actually sold. Written once a day by the morning
 * Amazon pull and the first time the Overview opens that day.
 */
export const forecastDailyLog = pgTable(
  "forecast_daily_log",
  {
    skuId: integer("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    /** Units a day the dates were planned from that day. Null when there was nothing to plan from. */
    plannedRate: numeric("planned_rate", { precision: 12, scale: 4, mode: "number" }),
    /** "sales", "manual" or "none". */
    rateSource: text("rate_source").notNull(),
    /** Seasonal percentage applied that day, or null when no seasonal pattern was on. */
    seasonPct: integer("season_pct"),
    outOfStockDays: integer("out_of_stock_days").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.skuId, t.day] }), index("forecast_daily_log_day_idx").on(t.day)],
);

/** Seasonal pattern on or off, per listing (Phase 7). A listing with no row is on. */
export const seasonSettings = pgTable("season_settings", {
  listingId: integer("listing_id")
    .primaryKey()
    .references(() => listings.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Month percentages typed by hand per listing (Phase 7): how busy a calendar
 * month is compared with a normal month (100). A typed month wins over the
 * automatic pattern.
 */
export const seasonMonths = pgTable(
  "season_months",
  {
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    month: integer("month").notNull(),
    percent: integer("percent").notNull(),
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.month] }),
    check("season_months_month_valid", sql`${t.month} between 1 and 12`),
    check("season_months_percent_valid", sql`${t.percent} between 10 and 500`),
  ],
);

/**
 * Orders placed with China suppliers (Phase 6). The admin records the order
 * here after placing it with the supplier; units on an open order count as
 * "on order" in the reorder-by date until the warehouse receives them.
 * status: ordered (on the way, or partly received), received (closed: all
 * in, or the admin said nothing more is coming), cancelled.
 */
export const chinaOrders = pgTable(
  "china_orders",
  {
    id: serial("id").primaryKey(),
    status: text("status").notNull().default("ordered"),
    supplier: text("supplier"),
    /** The supplier's order or PO number, for reference. */
    poNumber: text("po_number"),
    orderedOn: date("ordered_on", { mode: "string" }).notNull(),
    /** Expected arrival at the warehouse. Starts at order date + 60 days; the admin can change it. */
    expectedOn: date("expected_on", { mode: "string" }).notNull(),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: integer("closed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("china_orders_status_idx").on(t.status, t.expectedOn),
    check("china_orders_status_valid", sql`${t.status} in ('ordered', 'received', 'cancelled')`),
  ],
);

/** One row per SKU in a China order. Units per case are copied when the order is saved. */
export const chinaOrderLines = pgTable(
  "china_order_lines",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => chinaOrders.id, { onDelete: "cascade" }),
    skuId: integer("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    cases: integer("cases").notNull(),
    unitsPerCase: integer("units_per_case").notNull(),
  },
  (t) => [
    uniqueIndex("china_order_lines_sku_key").on(t.orderId, t.skuId),
    index("china_order_lines_sku_idx").on(t.skuId),
    check("china_order_lines_cases_positive", sql`${t.cases} > 0`),
    check("china_order_lines_units_per_case_positive", sql`${t.unitsPerCase} > 0`),
  ],
);

/**
 * What the warehouse received against a China order, one row per SKU per
 * delivery. An order can arrive in more than one delivery.
 */
export const chinaReceipts = pgTable(
  "china_receipts",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => chinaOrders.id, { onDelete: "cascade" }),
    skuId: integer("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    /** Full cases that arrived in this delivery (0 if none of this SKU came). */
    cases: integer("cases").notNull(),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("china_receipts_order_idx").on(t.orderId),
    check("china_receipts_cases_nonnegative", sql`${t.cases} >= 0`),
  ],
);

export type ChinaOrderStatus = "ordered" | "received" | "cancelled";
