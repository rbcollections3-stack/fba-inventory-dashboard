import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import { decryptSecret, totpCode } from "@/lib/auth/totp";
import {
  beginTotpSetup,
  changeOwnPassword,
  checkLogin,
  checkLoginCode,
  confirmTotpSetup,
  countRecoveryCodes,
  createStaffUser,
  ensureUsers,
  getUserById,
  listUsers,
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  needsNewPassword,
  resetTotp,
  setDisabled,
  setPassword,
} from "@/lib/auth/users";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const env = { ADMIN_PASSWORD: "Dashboard-key-01!", STAFF_PASSWORD: "Shelf-pallet-02!" };
const AUTH_SECRET = "integration-secret-integration-secret-1";

describe.skipIf(!TEST_DATABASE_URL)("logins (database)", () => {
  let db: Db;
  let close: () => Promise<void>;
  const before = process.env.AUTH_SECRET;

  beforeAll(async () => {
    process.env.AUTH_SECRET = AUTH_SECRET;
    ({ db, close } = await freshDb());
  });
  afterAll(async () => {
    process.env.AUTH_SECRET = before;
    await close?.();
  });
  beforeEach(async () => clearData(db));

  async function login(username: string, password: string, now = new Date()) {
    const r = await checkLogin(db, username, password, now, env);
    if (!r.ok) throw new Error(`login failed: ${r.reason}`);
    return r.user;
  }

  /** Sets up the authenticator for a user and returns their secret and backup codes. */
  async function enroll(userId: number, now = new Date()) {
    const secret = (await beginTotpSetup(db, userId))!;
    const r = await confirmTotpSetup(db, userId, totpCode(secret, now), now);
    if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
    return { secret, codes: r.recoveryCodes };
  }

  it("needs both passwords set, following the rules, before the first login", async () => {
    expect(await ensureUsers(db, {})).toBe("missing-env");
    expect(await ensureUsers(db, { ADMIN_PASSWORD: "Dashboard-key-01!", STAFF_PASSWORD: "no-special1" })).toBe(
      "missing-env",
    );
    expect(await ensureUsers(db, { ADMIN_PASSWORD: "longbutnospecial", STAFF_PASSWORD: "Shelf-pallet-02!" })).toBe(
      "missing-env",
    );
    expect(await checkLogin(db, "admin", "whatever", new Date(), {})).toEqual({ ok: false, reason: "setup-needed" });
    expect(await listUsers(db)).toEqual([]);
  });

  it("creates one admin and one staff login, once, both needing a new password", async () => {
    expect(await ensureUsers(db, env)).toBe("created");
    expect(await ensureUsers(db, { ...env, ADMIN_PASSWORD: "different-pass-9!" })).toBe("ready");
    const list = await listUsers(db);
    expect(list.map((u) => [u.username, u.role, u.mustChangePassword, u.totpEnabledAt])).toEqual([
      ["admin", "admin", true, null],
      ["warehouse", "staff", true, null],
    ]);
  });

  it("checks the password, any username case", async () => {
    expect((await login("ADMIN", env.ADMIN_PASSWORD)).role).toBe("admin");
    expect((await login("warehouse", env.STAFF_PASSWORD)).role).toBe("staff");
    expect(await checkLogin(db, "warehouse", env.ADMIN_PASSWORD, new Date(), env)).toEqual({ ok: false, reason: "invalid" });
    expect(await checkLogin(db, "nobody", env.ADMIN_PASSWORD, new Date(), env)).toEqual({ ok: false, reason: "invalid" });
  });

  it("sets up the authenticator app and then needs a fresh code at each login", async () => {
    const admin = await login("admin", env.ADMIN_PASSWORD);
    const now = new Date("2026-11-27T12:00:00Z");
    expect(await checkLoginCode(db, admin.id, "123456", now)).toEqual({ ok: false, reason: "not-set-up" });

    const secret = (await beginTotpSetup(db, admin.id))!;
    // Reloading the setup page keeps the same secret, stored encrypted.
    expect(await beginTotpSetup(db, admin.id)).toBe(secret);
    const stored = (await getUserById(db, admin.id))!.totpSecretEnc!;
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);

    expect(await confirmTotpSetup(db, admin.id, "000000", now)).toEqual({ ok: false, reason: "invalid" });
    const setup = await confirmTotpSetup(db, admin.id, totpCode(secret, now), now);
    expect(setup.ok && setup.recoveryCodes).toHaveLength(8);
    expect(await beginTotpSetup(db, admin.id)).toBeNull();
    expect(await confirmTotpSetup(db, admin.id, totpCode(secret, now), now)).toEqual({
      ok: false,
      reason: "already-set-up",
    });

    // The code used for setup cannot be used again.
    expect((await checkLoginCode(db, admin.id, totpCode(secret, now), now)).ok).toBe(false);
    const later = new Date(now.getTime() + 60_000);
    expect(await checkLoginCode(db, admin.id, totpCode(secret, later), later)).toEqual({
      ok: true,
      usedRecoveryCode: false,
      recoveryCodesLeft: 8,
    });
    expect((await checkLoginCode(db, admin.id, totpCode(secret, later), later)).ok).toBe(false);
  });

  it("accepts each backup code once", async () => {
    const staff = await login("warehouse", env.STAFF_PASSWORD);
    const { codes } = await enroll(staff.id);
    expect(await checkLoginCode(db, staff.id, codes[3].toUpperCase())).toEqual({
      ok: true,
      usedRecoveryCode: true,
      recoveryCodesLeft: 7,
    });
    expect((await checkLoginCode(db, staff.id, codes[3])).ok).toBe(false);
    expect(await countRecoveryCodes(db, staff.id)).toBe(7);
  });

  it(`locks a login for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong passwords or codes`, async () => {
    const t0 = new Date("2026-11-27T10:00:00Z");
    const admin = await login("admin", env.ADMIN_PASSWORD, t0);
    const { secret } = await enroll(admin.id, t0);

    for (let i = 1; i < MAX_FAILED_LOGINS - 1; i++) {
      expect(await checkLogin(db, "admin", "wrong-password", t0, env)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await checkLoginCode(db, admin.id, "000000", t0)).toEqual({ ok: false, reason: "invalid" });
    expect(await checkLoginCode(db, admin.id, "nope-nope-nope", t0)).toEqual({
      ok: false,
      reason: "locked",
      minutesLeft: LOCK_MINUTES,
    });
    const t1 = new Date(t0.getTime() + 5 * 60000);
    expect(await checkLogin(db, "admin", env.ADMIN_PASSWORD, t1, env)).toEqual({ ok: false, reason: "locked", minutesLeft: 10 });
    expect(await checkLoginCode(db, admin.id, totpCode(secret, t1), t1)).toEqual({
      ok: false,
      reason: "locked",
      minutesLeft: 10,
    });
    // The staff login is not affected.
    expect((await checkLogin(db, "warehouse", env.STAFF_PASSWORD, t1, env)).ok).toBe(true);
    const t2 = new Date(t0.getTime() + (LOCK_MINUTES + 1) * 60000);
    expect((await checkLogin(db, "admin", env.ADMIN_PASSWORD, t2, env)).ok).toBe(true);
  });

  it("makes people choose a new password: first login, after an admin reset, and after 365 days", async () => {
    const staff = await login("warehouse", env.STAFF_PASSWORD);
    expect(needsNewPassword(staff)).toBe(true);

    expect(await changeOwnPassword(db, staff.id, "short!")).toMatchObject({ ok: false });
    expect(await changeOwnPassword(db, staff.id, env.STAFF_PASSWORD)).toEqual({
      ok: false,
      error: "Choose a password you have not used for this login before.",
    });
    const changed = await changeOwnPassword(db, staff.id, "pallets-and-cases-9!", {
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.user.sessionVersion).toBe(staff.sessionVersion + 1);
    expect(needsNewPassword(changed.user, new Date("2026-12-31T00:00:00Z"))).toBe(false);
    expect(needsNewPassword(changed.user, new Date("2027-01-02T00:00:00Z"))).toBe(true);
    expect(await checkLogin(db, "warehouse", env.STAFF_PASSWORD, new Date(), env)).toEqual({ ok: false, reason: "invalid" });

    // An admin-set temporary password must be replaced at the next login.
    const temp = await setPassword(db, staff.id, "temporary-pass-1!", { mustChange: true });
    expect(temp?.mustChangePassword).toBe(true);
    expect(needsNewPassword(temp!)).toBe(true);

    // Changing your own password while logged in needs the current one.
    expect(await changeOwnPassword(db, staff.id, "another-good-one-2!", { currentPassword: "wrong" })).toEqual({
      ok: false,
      error: "Your current password is not right.",
    });
    expect(
      (await changeOwnPassword(db, staff.id, "another-good-one-2!", { currentPassword: "temporary-pass-1!" })).ok,
    ).toBe(true);
  });

  it("lets the admin add individual staff logins, turn them off, and reset their authenticator", async () => {
    await ensureUsers(db, env);
    expect(await createStaffUser(db, "Maria", "temporary-pass-1!")).toMatchObject({ ok: true });
    expect(await createStaffUser(db, "maria", "temporary-pass-1!")).toEqual({
      ok: false,
      error: 'The username "maria" is already taken.',
    });
    expect(await createStaffUser(db, "two words", "temporary-pass-1!")).toMatchObject({ ok: false });
    expect(await createStaffUser(db, "sam", "nospecialchars")).toMatchObject({ ok: false });

    const maria = await login("maria", "temporary-pass-1!");
    expect(maria).toMatchObject({ role: "staff", mustChangePassword: true });
    await enroll(maria.id);

    await setDisabled(db, maria.id, true);
    expect(await checkLogin(db, "maria", "temporary-pass-1!", new Date(), env)).toEqual({ ok: false, reason: "disabled" });
    // A wrong password on a turned-off login says nothing about it being turned off.
    expect(await checkLogin(db, "maria", "wrong-password!", new Date(), env)).toEqual({ ok: false, reason: "invalid" });
    await setDisabled(db, maria.id, false);
    expect((await checkLogin(db, "maria", "temporary-pass-1!", new Date(), env)).ok).toBe(true);

    const beforeReset = (await getUserById(db, maria.id))!;
    await resetTotp(db, maria.id);
    const after = (await getUserById(db, maria.id))!;
    expect(after).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null });
    expect(after.sessionVersion).toBe(beforeReset.sessionVersion + 1);
    expect(await countRecoveryCodes(db, maria.id)).toBe(0);
    expect(await db.select({ id: users.id }).from(users).where(eq(users.username, "maria"))).toHaveLength(1);
  });
});
