import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { canAccess, homeFor, isPublicPath } from "@/lib/auth/access";
import { signPending, signSession, verifyPending, verifySession } from "@/lib/auth/token";
import { needsNewPassword, passwordExpiresOn, passwordProblem } from "@/lib/auth/users";
import { needsTls } from "@/db";

const SECRET = "test-secret-test-secret-test-secret-123";

describe("who can open which screen", () => {
  it("lets the admin open everything", () => {
    for (const p of ["/skus", "/skus/import", "/skus/3", "/accounts", "/warehouse"]) {
      expect(canAccess("admin", p)).toBe(true);
    }
  });

  it("keeps warehouse staff on warehouse screens only", () => {
    expect(canAccess("staff", "/warehouse")).toBe(true);
    expect(canAccess("staff", "/warehouse/pallets/1")).toBe(true);
    for (const p of ["/skus", "/skus/import", "/accounts", "/warehouse-admin", "/"]) {
      expect(canAccess("staff", p)).toBe(false);
    }
  });

  it("sends each login to its own home screen", () => {
    expect(homeFor("admin")).toBe("/skus");
    expect(homeFor("staff")).toBe("/warehouse");
  });

  it("only the login page is public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/skus")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips the user, role and session version", async () => {
    const token = await signSession({ userId: 7, role: "staff", v: 3 }, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ userId: 7, role: "staff", v: 3 });
  });

  it("rejects missing, tampered and wrongly signed tokens", async () => {
    const token = await signSession({ userId: 1, role: "staff", v: 1 }, SECRET);
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession(token, SECRET + "x")).toBeNull();
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "1", role: "admin", v: 1 })).toString("base64url");
    expect(await verifySession(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const old = await new SignJWT({ typ: "session", role: "admin", v: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifySession(old, SECRET)).toBeNull();
  });

  it("refuses to sign with a short or missing secret", async () => {
    await expect(signSession({ userId: 1, role: "admin", v: 1 }, "short")).rejects.toThrow(/AUTH_SECRET/);
    await expect(signSession({ userId: 1, role: "admin", v: 1 }, "")).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("half-finished logins", () => {
  it("round-trips and is never accepted as a full session", async () => {
    const pending = await signPending({ userId: 4, v: 2, mfa: false }, SECRET);
    expect(await verifyPending(pending, SECRET)).toEqual({ userId: 4, v: 2, mfa: false });
    expect(await verifySession(pending, SECRET)).toBeNull();
    const session = await signSession({ userId: 4, role: "admin", v: 2 }, SECRET);
    expect(await verifyPending(session, SECRET)).toBeNull();
  });
});

describe("password rules", () => {
  it("needs 12 to 72 characters", () => {
    expect(passwordProblem("short!")).toMatch(/at least 12/);
    expect(passwordProblem("abcdefghijk!")).toBeNull();
    expect(passwordProblem("a".repeat(72) + "!")).toMatch(/at most 72/);
  });

  it("needs a special character", () => {
    expect(passwordProblem("abcdefghijkl")).toMatch(/special character/);
    expect(passwordProblem("Abcdefghijk1")).toMatch(/special character/);
    expect(passwordProblem("abcdef ghijk")).toBeNull();
    expect(passwordProblem("abcdefghij-1")).toBeNull();
  });

  it("cannot contain the username", () => {
    expect(passwordProblem("Warehouse-2026!", "warehouse")).toMatch(/username/);
    expect(passwordProblem("Shelves-2026!", "warehouse")).toBeNull();
  });

  it("expire 365 days after they were set", () => {
    const set = new Date("2026-01-01T00:00:00Z");
    expect(passwordExpiresOn({ passwordChangedAt: set }).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    const user = { passwordChangedAt: set, mustChangePassword: false };
    expect(needsNewPassword(user, new Date("2026-12-31T23:59:59Z"))).toBe(false);
    expect(needsNewPassword(user, new Date("2027-01-01T00:00:00Z"))).toBe(true);
    expect(needsNewPassword({ ...user, mustChangePassword: true }, set)).toBe(true);
  });
});

describe("database connections", () => {
  it("require encryption for any database not on this computer", () => {
    expect(needsTls("postgres://u:p@localhost:5432/db")).toBe(false);
    expect(needsTls("postgres://u:p@127.0.0.1:5432/db")).toBe(false);
    expect(needsTls("postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres")).toBe(true);
  });
});
