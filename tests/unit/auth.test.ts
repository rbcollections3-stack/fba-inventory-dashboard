import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { canAccess, homeFor, isPublicPath } from "@/lib/auth/access";
import { signSession, verifySession } from "@/lib/auth/token";
import { passwordProblem } from "@/lib/auth/users";

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
    const old = await new SignJWT({ role: "admin", v: 1 })
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

describe("password rules", () => {
  it("needs 10 to 72 characters", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("a".repeat(10))).toBeNull();
    expect(passwordProblem("a".repeat(73))).toMatch(/at most 72/);
  });
});
