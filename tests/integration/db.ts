import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { createDb, type Db } from "@/db";
import { ROOT } from "../helpers";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** A fresh, migrated test database. Everything in it is wiped first. */
export async function freshDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  if (!/test|e2e/i.test(TEST_DATABASE_URL)) {
    throw new Error("TEST_DATABASE_URL must name a test database (it gets wiped).");
  }
  const conn = createDb(TEST_DATABASE_URL);
  await conn.db.execute(sql`drop schema if exists public cascade`);
  await conn.db.execute(sql`drop schema if exists drizzle cascade`);
  await conn.db.execute(sql`create schema public`);
  await migrate(conn.db, { migrationsFolder: path.join(ROOT, "drizzle") });
  return conn;
}

export async function clearData(db: Db): Promise<void> {
  await db.execute(sql`truncate amazon_sync_requests, fba_ledger_daily, fba_inventory_snapshots, amazon_imports, warehouse_counts, skus, listings, recovery_codes, users restart identity cascade`);
}
