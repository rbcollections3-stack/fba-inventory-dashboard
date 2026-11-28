/**
 * Loads 21 made-up example SKUs into the database, for trying the app out
 * on your own computer. Run with `npm run db:sample`. Not for real data.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { readFile } from "node:fs/promises";
import { createDb } from "../src/db";
import { checkSkuSheet } from "../src/lib/skus/parse";
import { readSpreadsheet } from "../src/lib/skus/read-file";
import { importSkus } from "../src/lib/skus/repo";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const file = process.argv[2] ?? "tests/fixtures/sample-skus.csv";
  const buf = await readFile(file);
  const table = await readSpreadsheet(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const check = checkSkuSheet(table);
  if (check.errors.length) {
    console.error(check.errors);
    process.exit(1);
  }
  const { db, close } = createDb(url);
  const result = await importSkus(db, check.rows, { userId: null, today: new Date().toISOString().slice(0, 10) });
  await close();
  console.log(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
