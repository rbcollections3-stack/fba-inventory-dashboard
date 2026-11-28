/** Applies database migrations in ./drizzle. Run with `npm run db:migrate`. */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. See SETUP.md.");
    process.exit(1);
  }
  const { db, close } = createDb(url);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await close();
  console.log("Database is up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
