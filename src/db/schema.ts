import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
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

export const countSourceEnum = pgEnum("count_source", ["import", "manual"]);

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
