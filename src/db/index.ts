import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

/** Only a database on this computer may be reached without encryption. */
export function needsTls(url: string): boolean {
  const host = new URL(url).hostname;
  return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  // prepare: false keeps this compatible with Supabase's connection pooler.
  // Any database that is not on this computer must use an encrypted connection.
  const client = postgres(url, {
    prepare: false,
    max: 5,
    onnotice: () => {},
    ssl: needsTls(url) ? "require" : false,
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

const globalForDb = globalThis as unknown as { __fbaDb?: Db };

/** The app's shared database connection. */
export function getDb(): Db {
  if (!globalForDb.__fbaDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. See SETUP.md.");
    }
    globalForDb.__fbaDb = createDb(url).db;
  }
  return globalForDb.__fbaDb;
}
