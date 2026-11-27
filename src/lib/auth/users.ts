import bcrypt from "bcryptjs";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { recoveryCodes, users, type User } from "@/db/schema";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "./totp";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 72;
export const PASSWORD_MAX_AGE_DAYS = 365;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const BCRYPT_COST = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** The password rules. Returns a plain-language problem, or null if the password is fine. */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return `Passwords can be at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Passwords must include at least one special character, such as ! @ # $ % or -.";
  }
  if (username && password.toLowerCase().includes(username.trim().toLowerCase())) {
    return "Passwords cannot contain the username.";
  }
  return null;
}

export function passwordExpiresOn(user: Pick<User, "passwordChangedAt">): Date {
  return new Date(user.passwordChangedAt.getTime() + PASSWORD_MAX_AGE_DAYS * DAY_MS);
}

/** True when the user must pick a new password before they can use the app. */
export function needsNewPassword(user: Pick<User, "passwordChangedAt" | "mustChangePassword">, now = new Date()): boolean {
  return user.mustChangePassword || passwordExpiresOn(user) <= now;
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Reads ADMIN_USERNAME, ADMIN_PASSWORD, STAFF_USERNAME and STAFF_PASSWORD. */
export type BootstrapEnv = Record<string, string | undefined>;

export type BootstrapStatus = "ready" | "created" | "missing-env";

/**
 * Creates the first admin and first warehouse staff login the first time the
 * app runs, from the ADMIN_PASSWORD and STAFF_PASSWORD settings. Both must
 * choose a new password and set up an authenticator app at their first login.
 */
export async function ensureUsers(db: Db, env: BootstrapEnv = process.env): Promise<BootstrapStatus> {
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return "ready";
  const adminName = normalizeUsername(env.ADMIN_USERNAME || "admin");
  const staffName = normalizeUsername(env.STAFF_USERNAME || "warehouse");
  const adminPw = env.ADMIN_PASSWORD ?? "";
  const staffPw = env.STAFF_PASSWORD ?? "";
  if (passwordProblem(adminPw, adminName) || passwordProblem(staffPw, staffName) || adminName === staffName) {
    return "missing-env";
  }
  await db
    .insert(users)
    .values([
      { username: adminName, passwordHash: await hashPassword(adminPw), role: "admin", mustChangePassword: true },
      { username: staffName, passwordHash: await hashPassword(staffPw), role: "staff", mustChangePassword: true },
    ])
    .onConflictDoNothing();
  return "created";
}

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "locked" | "setup-needed" | "disabled"; minutesLeft?: number };

// Compared against when the username does not exist, so a wrong username
// takes as long as a wrong password.
const DUMMY_HASH = "$2b$12$MpSvnU8VrwiFp/kn6jHAje1wvm/a5sfViduzdc2BrcHpTow2xiTXC";

function lockedFor(user: User, now: Date): number | null {
  if (user.lockedUntil && user.lockedUntil > now) {
    return Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
  }
  return null;
}

/** Counts a wrong password or code. Returns minutes locked, or null if not locked. */
async function recordFailure(db: Db, user: User, now: Date): Promise<number | null> {
  const failed = user.failedLogins + 1;
  const lock = failed >= MAX_FAILED_LOGINS;
  await db
    .update(users)
    .set({
      failedLogins: lock ? 0 : failed,
      lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null,
    })
    .where(eq(users.id, user.id));
  return lock ? LOCK_MINUTES : null;
}

async function clearFailures(db: Db, user: User): Promise<void> {
  if (user.failedLogins > 0 || user.lockedUntil) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
}

/** Step 1 of logging in: username and password. */
export async function checkLogin(
  db: Db,
  username: string,
  password: string,
  now = new Date(),
  env: BootstrapEnv = process.env,
): Promise<LoginResult> {
  if ((await ensureUsers(db, env)) === "missing-env") return { ok: false, reason: "setup-needed" };

  const [user] = await db.select().from(users).where(eq(users.username, normalizeUsername(username)));
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, reason: "invalid" };
  }
  const locked = lockedFor(user, now);
  if (locked) return { ok: false, reason: "locked", minutesLeft: locked };
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const nowLocked = await recordFailure(db, user, now);
    return nowLocked ? { ok: false, reason: "locked", minutesLeft: nowLocked } : { ok: false, reason: "invalid" };
  }
  if (user.disabledAt) return { ok: false, reason: "disabled" };
  return { ok: true, user };
}

export type CodeResult =
  | { ok: true; usedRecoveryCode: boolean; recoveryCodesLeft: number }
  | { ok: false; reason: "invalid" | "locked" | "not-set-up"; minutesLeft?: number };

/** Step 2 of logging in: a code from the authenticator app, or a backup code. */
export async function checkLoginCode(db: Db, userId: number, code: string, now = new Date()): Promise<CodeResult> {
  const user = await getUserById(db, userId);
  if (!user || user.disabledAt) return { ok: false, reason: "invalid" };
  if (!user.totpSecretEnc || !user.totpEnabledAt) return { ok: false, reason: "not-set-up" };
  const locked = lockedFor(user, now);
  if (locked) return { ok: false, reason: "locked", minutesLeft: locked };

  const typed = code.trim();
  if (/^\d[\d\s]*$/.test(typed)) {
    const step = verifyTotp(decryptSecret(user.totpSecretEnc), typed, now, user.totpLastStep);
    if (step !== null) {
      // Only accept the step if no other request used it first.
      const updated = await db
        .update(users)
        .set({ totpLastStep: step, failedLogins: 0, lockedUntil: null })
        .where(and(eq(users.id, user.id), sql`coalesce(${users.totpLastStep}, -1) < ${step}`))
        .returning({ id: users.id });
      if (updated.length === 1) {
        return { ok: true, usedRecoveryCode: false, recoveryCodesLeft: await countRecoveryCodes(db, user.id) };
      }
    }
  } else {
    const used = await db
      .update(recoveryCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(recoveryCodes.userId, user.id),
          eq(recoveryCodes.codeHash, hashRecoveryCode(typed)),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .returning({ id: recoveryCodes.id });
    if (used.length === 1) {
      await clearFailures(db, user);
      return { ok: true, usedRecoveryCode: true, recoveryCodesLeft: await countRecoveryCodes(db, user.id) };
    }
  }
  const nowLocked = await recordFailure(db, user, now);
  return nowLocked ? { ok: false, reason: "locked", minutesLeft: nowLocked } : { ok: false, reason: "invalid" };
}

export async function countRecoveryCodes(db: Db, userId: number): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return n;
}

/**
 * Starts authenticator setup. Keeps the same secret if setup was started
 * and not finished, so reloading the page shows the same QR code.
 */
export async function beginTotpSetup(db: Db, userId: number): Promise<string | null> {
  const user = await getUserById(db, userId);
  if (!user || user.totpEnabledAt) return null;
  if (user.totpSecretEnc) return decryptSecret(user.totpSecretEnc);
  const secret = generateTotpSecret();
  await db.update(users).set({ totpSecretEnc: encryptSecret(secret) }).where(eq(users.id, userId));
  return secret;
}

export type SetupResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: "invalid" | "locked" | "already-set-up"; minutesLeft?: number };

/** Finishes authenticator setup once the user types a code from the app. Returns their backup codes. */
export async function confirmTotpSetup(db: Db, userId: number, code: string, now = new Date()): Promise<SetupResult> {
  const user = await getUserById(db, userId);
  if (!user || user.disabledAt) return { ok: false, reason: "invalid" };
  if (user.totpEnabledAt) return { ok: false, reason: "already-set-up" };
  if (!user.totpSecretEnc) return { ok: false, reason: "invalid" };
  const locked = lockedFor(user, now);
  if (locked) return { ok: false, reason: "locked", minutesLeft: locked };

  const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, now, null);
  if (step === null) {
    const nowLocked = await recordFailure(db, user, now);
    return nowLocked ? { ok: false, reason: "locked", minutesLeft: nowLocked } : { ok: false, reason: "invalid" };
  }
  const codes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ totpEnabledAt: now, totpLastStep: step, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
  });
  return { ok: true, recoveryCodes: codes };
}

/** Removes someone's authenticator so they set it up again at their next login. Signs them out. */
export async function resetTotp(db: Db, userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  });
}

export async function getUserById(db: Db, id: number): Promise<User | null> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u ?? null;
}

export type UserSummary = Pick<
  User,
  "id" | "username" | "role" | "passwordChangedAt" | "mustChangePassword" | "totpEnabledAt" | "disabledAt"
>;

export async function listUsers(db: Db): Promise<UserSummary[]> {
  return db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      passwordChangedAt: users.passwordChangedAt,
      mustChangePassword: users.mustChangePassword,
      totpEnabledAt: users.totpEnabledAt,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .orderBy(asc(users.role), asc(users.username));
}

/**
 * Sets a new password and signs that login out everywhere else. When an
 * admin sets someone else's password, mustChange makes them pick their own
 * at the next login.
 */
export async function setPassword(
  db: Db,
  userId: number,
  password: string,
  opts: { mustChange?: boolean; now?: Date } = {},
): Promise<User | null> {
  const [u] = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      passwordChangedAt: opts.now ?? new Date(),
      mustChangePassword: opts.mustChange ?? false,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      failedLogins: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  return u ?? null;
}

export type ChangePasswordResult = { ok: true; user: User } | { ok: false; error: string };

/** A user choosing their own new password. It must follow the rules and differ from the current one. */
export async function changeOwnPassword(
  db: Db,
  userId: number,
  newPassword: string,
  opts: { currentPassword?: string; now?: Date } = {},
): Promise<ChangePasswordResult> {
  const user = await getUserById(db, userId);
  if (!user) return { ok: false, error: "That login no longer exists." };
  if (opts.currentPassword !== undefined && !(await bcrypt.compare(opts.currentPassword, user.passwordHash))) {
    return { ok: false, error: "Your current password is not right." };
  }
  const problem = passwordProblem(newPassword, user.username);
  if (problem) return { ok: false, error: problem };
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return { ok: false, error: "Choose a password you have not used for this login before." };
  }
  const updated = await setPassword(db, userId, newPassword, { mustChange: false, now: opts.now });
  return updated ? { ok: true, user: updated } : { ok: false, error: "That login no longer exists." };
}

export type CreateUserResult = { ok: true; user: User } | { ok: false; error: string };

/** Adds a login for one warehouse employee. They choose their own password at first login. */
export async function createStaffUser(db: Db, username: string, tempPassword: string): Promise<CreateUserResult> {
  const name = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(name)) {
    return { ok: false, error: "Usernames are 3 to 40 letters, numbers, dots, dashes or underscores, with no spaces." };
  }
  const problem = passwordProblem(tempPassword, name);
  if (problem) return { ok: false, error: problem };
  const [created] = await db
    .insert(users)
    .values({ username: name, passwordHash: await hashPassword(tempPassword), role: "staff", mustChangePassword: true })
    .onConflictDoNothing()
    .returning();
  if (!created) return { ok: false, error: `The username "${name}" is already taken.` };
  return { ok: true, user: created };
}

/** Turns a login off (they are signed out and cannot log in) or back on. */
export async function setDisabled(db: Db, userId: number, disabled: boolean): Promise<void> {
  await db
    .update(users)
    .set({
      disabledAt: disabled ? new Date() : null,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
