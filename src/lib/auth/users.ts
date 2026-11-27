import bcrypt from "bcryptjs";
import { count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { users, type Role, type User } from "@/db/schema";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 72) return "Passwords can be at most 72 characters.";
  return null;
}

/** Reads ADMIN_USERNAME, ADMIN_PASSWORD, STAFF_USERNAME and STAFF_PASSWORD. */
export type BootstrapEnv = Record<string, string | undefined>;

export type BootstrapStatus = "ready" | "created" | "missing-env";

/**
 * Creates the two logins the first time the app runs, from the
 * ADMIN_PASSWORD and STAFF_PASSWORD settings. After that the passwords are
 * changed on the Accounts screen and these settings are no longer used.
 */
export async function ensureUsers(db: Db, env: BootstrapEnv = process.env): Promise<BootstrapStatus> {
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return "ready";
  const adminPw = env.ADMIN_PASSWORD ?? "";
  const staffPw = env.STAFF_PASSWORD ?? "";
  if (passwordProblem(adminPw) || passwordProblem(staffPw)) return "missing-env";
  await db
    .insert(users)
    .values([
      {
        username: (env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
        passwordHash: await hashPassword(adminPw),
        role: "admin" as Role,
      },
      {
        username: (env.STAFF_USERNAME || "warehouse").trim().toLowerCase(),
        passwordHash: await hashPassword(staffPw),
        role: "staff" as Role,
      },
    ])
    .onConflictDoNothing();
  return "created";
}

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "locked" | "setup-needed"; minutesLeft?: number };

// Compared against when the username does not exist, so a wrong username
// takes as long as a wrong password.
const DUMMY_HASH = "$2b$12$MpSvnU8VrwiFp/kn6jHAje1wvm/a5sfViduzdc2BrcHpTow2xiTXC";

export async function checkLogin(
  db: Db,
  username: string,
  password: string,
  now = new Date(),
  env: BootstrapEnv = process.env,
): Promise<LoginResult> {
  if ((await ensureUsers(db, env)) === "missing-env") return { ok: false, reason: "setup-needed" };

  const name = username.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.username, name));
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
    return { ok: false, reason: "locked", minutesLeft };
  }
  const good = await bcrypt.compare(password, user.passwordHash);
  if (!good) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db
      .update(users)
      .set({
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null,
      })
      .where(eq(users.id, user.id));
    if (lock) return { ok: false, reason: "locked", minutesLeft: LOCK_MINUTES };
    return { ok: false, reason: "invalid" };
  }
  if (user.failedLogins > 0 || user.lockedUntil) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
  return { ok: true, user };
}

export async function getUserById(db: Db, id: number): Promise<User | null> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u ?? null;
}

export async function listUsers(db: Db): Promise<Pick<User, "id" | "username" | "role">[]> {
  return db.select({ id: users.id, username: users.username, role: users.role }).from(users).orderBy(users.id);
}

/** Sets a new password and signs that login out everywhere else. */
export async function setPassword(db: Db, userId: number, password: string): Promise<User | null> {
  const [u] = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      sessionVersion: sql`${users.sessionVersion} + 1`,
      failedLogins: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  return u ?? null;
}
