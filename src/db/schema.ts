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

export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type Sku = typeof skus.$inferSelect;
export type Listing = typeof listings.$inferSelect;
