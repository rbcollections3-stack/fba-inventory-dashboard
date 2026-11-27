import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDb } from "../../src/db";
import { fillTemplate, ROOT, SAMPLE_CSV_PATH } from "../helpers";

export const E2E_DIR = path.join(ROOT, "test-results", "e2e-files");

/** Wipes the end-to-end database and writes the spreadsheets the tests upload. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/fba_e2e";
  if (!/e2e|test/i.test(url)) throw new Error("E2E_DATABASE_URL must name a test database (it gets wiped).");
  const { db, close } = createDb(url);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") });
  await close();

  // The 21 example SKUs, typed into a copy of the real template.
  const csv = (await readFile(SAMPLE_CSV_PATH, "utf8")).trim().split("\n").slice(1);
  const rows = csv.map((line) =>
    (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
      .slice(0, 13)
      .map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, ""))
      .map((cell, i) => (i >= 3 && i <= 7 ? Number(cell) : cell || null)),
  );
  await mkdir(E2E_DIR, { recursive: true });
  await writeFile(path.join(E2E_DIR, "skus-filled.xlsx"), Buffer.from(await fillTemplate(rows)));
  const bad = [...rows.slice(0, 2)];
  bad[1] = [...bad[1]];
  bad[1][3] = "24 pcs";
  await writeFile(path.join(E2E_DIR, "skus-bad.xlsx"), Buffer.from(await fillTemplate(bad)));
}
