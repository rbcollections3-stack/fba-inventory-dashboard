import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { checkLogin, ensureUsers, listUsers, LOCK_MINUTES, MAX_FAILED_LOGINS, setPassword } from "@/lib/auth/users";
import { clearData, freshDb, TEST_DATABASE_URL } from "./db";

const env = { ADMIN_PASSWORD: "admin-password-1", STAFF_PASSWORD: "staff-password-1" };

describe.skipIf(!TEST_DATABASE_URL)("logins (database)", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => clearData(db));

  it("needs both passwords set before the first login", async () => {
    expect(await ensureUsers(db, {})).toBe("missing-env");
    expect(await ensureUsers(db, { ADMIN_PASSWORD: "admin-password-1", STAFF_PASSWORD: "short" })).toBe("missing-env");
    expect(await checkLogin(db, "admin", "whatever", new Date(), {})).toEqual({ ok: false, reason: "setup-needed" });
    expect(await listUsers(db)).toEqual([]);
  });

  it("creates exactly one admin and one staff login, once", async () => {
    expect(await ensureUsers(db, env)).toBe("created");
    expect(await ensureUsers(db, { ...env, ADMIN_PASSWORD: "different-pass-9" })).toBe("ready");
    expect((await listUsers(db)).map((u) => [u.username, u.role])).toEqual([
      ["admin", "admin"],
      ["warehouse", "staff"],
    ]);
  });

  it("uses custom usernames when set", async () => {
    await ensureUsers(db, { ...env, ADMIN_USERNAME: " Mo ", STAFF_USERNAME: "Floor" });
    expect((await listUsers(db)).map((u) => u.username)).toEqual(["mo", "floor"]);
  });

  it("logs in with the right password, any username case", async () => {
    const admin = await checkLogin(db, "ADMIN", "admin-password-1", new Date(), env);
    expect(admin.ok && admin.user.role).toBe("admin");
    const staff = await checkLogin(db, "warehouse", "staff-password-1", new Date(), env);
    expect(staff.ok && staff.user.role).toBe("staff");
    expect(await checkLogin(db, "warehouse", "admin-password-1", new Date(), env)).toEqual({ ok: false, reason: "invalid" });
    expect(await checkLogin(db, "nobody", "admin-password-1", new Date(), env)).toEqual({ ok: false, reason: "invalid" });
  });

  it(`locks a login for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong passwords`, async () => {
    const t0 = new Date("2026-11-27T10:00:00Z");
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      expect(await checkLogin(db, "admin", "wrong-password", t0, env)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await checkLogin(db, "admin", "wrong-password", t0, env)).toEqual({ ok: false, reason: "locked", minutesLeft: LOCK_MINUTES });
    // Even the right password is refused while locked.
    const t1 = new Date(t0.getTime() + 5 * 60000);
    expect(await checkLogin(db, "admin", "admin-password-1", t1, env)).toEqual({ ok: false, reason: "locked", minutesLeft: 10 });
    // The staff login is not affected.
    expect((await checkLogin(db, "warehouse", "staff-password-1", t1, env)).ok).toBe(true);
    const t2 = new Date(t0.getTime() + (LOCK_MINUTES + 1) * 60000);
    expect((await checkLogin(db, "admin", "admin-password-1", t2, env)).ok).toBe(true);
  });

  it("changing a password replaces the old one and bumps the session version", async () => {
    const first = await checkLogin(db, "warehouse", "staff-password-1", new Date(), env);
    if (!first.ok) throw new Error("login failed");
    const updated = await setPassword(db, first.user.id, "new-staff-password");
    expect(updated?.sessionVersion).toBe(first.user.sessionVersion + 1);
    expect(await checkLogin(db, "warehouse", "staff-password-1", new Date(), env)).toEqual({ ok: false, reason: "invalid" });
    expect((await checkLogin(db, "warehouse", "new-staff-password", new Date(), env)).ok).toBe(true);
  });
});
