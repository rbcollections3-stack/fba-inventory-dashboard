import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  otpauthUrl,
  timeStep,
  totpCode,
  verifyTotp,
} from "@/lib/auth/totp";

const SECRET = "test-secret-test-secret-test-secret-123";

describe("authenticator codes", () => {
  // Test vectors from RFC 6238, appendix B (SHA-1, 8 digits).
  const rfcKey = Buffer.from("12345678901234567890");
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("matches RFC 6238 at time %i", (t, code) => {
    expect(hotp(rfcKey, Math.floor(t / 30), 8)).toBe(code);
  });

  it("base32 round-trips", () => {
    expect(base32Encode(Buffer.from("12345678901234567890"))).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv-gy3t qojq gezdgnbvgy3tqojq").toString()).toBe("12345678901234567890");
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it("accepts the current code and its neighbours, once each", () => {
    const secret = generateTotpSecret();
    const now = new Date("2026-11-27T12:00:10Z");
    const step = timeStep(now);
    expect(verifyTotp(secret, totpCode(secret, now), now, null)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() - 30000)), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() + 30000)), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() - 90000)), now, null)).toBeNull();
    // Already used: refused.
    expect(verifyTotp(secret, totpCode(secret, now), now, step)).toBeNull();
    // Spaces are fine; letters and wrong lengths are not.
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).toBe(step);
    expect(verifyTotp(secret, "12345", now, null)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now, null)).toBeNull();
  });

  it("builds the QR link authenticator apps read", () => {
    const url = otpauthUrl("GEZDGNBV", "admin");
    expect(url).toBe(
      "otpauth://totp/RB%20Collections%20FBA%3Aadmin?secret=GEZDGNBV&issuer=RB+Collections+FBA&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("stored secrets", () => {
  it("are encrypted and only readable with the same AUTH_SECRET", () => {
    const stored = encryptSecret("GEZDGNBVGY3TQOJQ", SECRET);
    expect(stored).not.toContain("GEZDGNBV");
    expect(encryptSecret("GEZDGNBVGY3TQOJQ", SECRET)).not.toBe(stored);
    expect(decryptSecret(stored, SECRET)).toBe("GEZDGNBVGY3TQOJQ");
    expect(() => decryptSecret(stored, SECRET + "x")).toThrow();
    const [v, iv, tag, enc] = stored.split(".");
    const tampered = [v, iv, tag, enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA")].join(".");
    expect(() => decryptSecret(tampered, SECRET)).toThrow();
  });
});

describe("backup codes", () => {
  it("are 8 different codes, matched ignoring case and dashes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(hashRecoveryCode(codes[0].toUpperCase().replace(/-/g, " "))).toBe(hashRecoveryCode(codes[0]));
    expect(hashRecoveryCode(codes[0])).not.toBe(hashRecoveryCode(codes[1]));
  });
});
